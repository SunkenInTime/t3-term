// apps/web/src/components/pullRequest/ThreadPullRequestsPanel.tsx: the right panel's "Linked pull
// requests" surface. Every pull request linked to the thread, stacks indented under their base,
// with watch/checks/review signals, the diff stat (a breakdown on hover), author, repository,
// branches and age; Shift shows each row's quick actions; a row's "..." button or a right click
// offers Copy link, Open, Watch and Unlink. The footer counts open and linked pull requests and
// links another one.
//
// Not ported: web's LegendList windowing (rows are a plain scroller here; a thread links tens of
// pull requests, not thousands) and dragging a row into the composer as a context chip.
import { useAtomValue } from "@effect/atom-react";
import { sourceControlClients, UNKNOWN_SOURCE_CONTROL_CLIENT } from "@t3tools/client-runtime/source-control-clients";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ContextMenuItem, ProjectId, ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import {
  type PullRequestListLine,
  pullRequestListLines,
  resolveThreadPullRequestChains,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { memo, useState } from "react";

import { copyTextToClipboard } from "../../chat/header/osActions.ts";
import { openLinkPullRequestDialog } from "../../dialogs/LinkPullRequestDialog.tsx";
import { openPullRequestLink } from "../../pullRequests/openPullRequestLink.ts";
import { PullRequestChangeBreakdownStat } from "../../pullRequests/PullRequestHeaderPieces.tsx";
import { PullRequestsUnavailableState } from "../../pullRequests/PullRequestListStates.tsx";
import {
  PullRequestActorAvatar,
  PullRequestDiffStat,
  PullRequestGlyph,
  PullRequestReviewDecisionGlyph,
  PullRequestRowGlyph,
  formatRelativeTimeLabel,
  mixColors,
  pullRequestChecksStatePresentation,
} from "../../pullRequests/pullRequestPresentation.tsx";
import { markRowControlClick, wasStackClick } from "../../pullRequests/PullRequestStack.tsx";
import { PullRequestSpeedActions } from "../../pullRequests/PullRequestSpeedActions.tsx";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentProjects, threadEnvironment } from "../../state/environment.ts";
import { shiftOnlyHeldAtom } from "../../state/keybindings.ts";
import { pullRequestEnvironmentsAtom } from "../../state/pullRequests.ts";
import { ContextMenu } from "../../sidebar/ContextMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import type { EnvironmentPullRequestEntry } from "../../web/components/pullRequest/pullRequestList.logic.ts";
import { pullRequestQuickActions } from "../../web/components/pullRequest/pullRequestList.logic.ts";
import { findProjectForChangeRequest } from "../../web/lib/openPullRequestLink.ts";
import { useThreadShell } from "./useThreadPullRequest.ts";

const SOURCE_LABELS: Record<ThreadPullRequestLink["source"], string> = {
  manual: "Linked by you",
  created: "Created from this thread",
  agent: "Linked by the agent",
  stack: "Found in the stack",
  "stack-dismissed": "Dismissed",
};

const WATCH_TOOLTIP = "Watching: the agent wakes when checks finish, someone comments, or the branch conflicts";

type RowMenuAction = "copy" | "open" | "watch" | "unlink";

function rowMenuItems(link: ThreadPullRequestLink, canWatch: boolean): ReadonlyArray<ContextMenuItem<RowMenuAction>> {
  const open = link.snapshot === null || link.snapshot.state === "open";
  const watching = link.watch !== undefined;
  return [
    { id: "copy", label: "Copy link", icon: "link" },
    { id: "open", label: "Open", icon: "arrow-up-right" },
    ...(canWatch && open
      ? [{ id: "watch" as const, label: watching ? "Stop watching" : "Watch for changes", icon: watching ? "eye-off" : "eye" }]
      : []),
    { id: "unlink", label: link.source === "stack" ? "Dismiss from thread" : "Unlink from thread", icon: PullRequestGlyph.unlink },
  ];
}

function LinkRowImpl({
  line,
  threadRef,
  projectId,
  speedMode,
  canWatch,
  onMenuAction,
}: {
  line: PullRequestListLine;
  threadRef: ScopedThreadRef;
  projectId: ProjectId | null;
  speedMode: boolean;
  canWatch: boolean;
  onMenuAction: (link: ThreadPullRequestLink, action: RowMenuAction) => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { link, depth, stack } = line;
  const snapshot = link.snapshot;
  const open = snapshot === null || snapshot.state === "open";
  const watching = link.watch !== undefined;
  const muted = theme.mutedForeground;
  const meta = { fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans, color: muted } as const;
  const linkHostActions = (sourceControlClients.findByChangeRequestUrl(link.url) ?? UNKNOWN_SOURCE_CONTROL_CLIENT)
    .changeRequestActions;
  // The quick actions read only these fields of a list entry.
  const actionEntry =
    projectId !== null && snapshot !== null && snapshot.state !== "merged"
      ? ({
          environmentId: threadRef.environmentId,
          projectId,
          host: link.host,
          repository: link.repository,
          number: link.number,
          state: snapshot.state,
          isDraft: snapshot.isDraft,
          ...(link.stack === null ? {} : { stack: link.stack }),
        } as unknown as EnvironmentPullRequestEntry)
      : null;
  const hasQuickActions = actionEntry !== null && pullRequestQuickActions(actionEntry, linkHostActions).length > 0;
  const showMenuButton = (hovered || menu !== null) && !(speedMode && hasQuickActions);
  const rowBackground = alpha(theme.accent, 0.6);
  const washOverBackground = washOver(theme.accent, 0.6, theme.background);
  return (
    <div
      testId={`linked-pr-${link.number}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(event) => {
        if (!wasStackClick(event)) openPullRequestLink(link.url, { threadRef, modifiers: event.modifiers });
      }}
      onAuxClick={(event) => {
        if (event.isRightClick) setMenu({ x: event.x ?? 0, y: event.y ?? 0 });
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        width: "100%",
        paddingTop: 4,
        paddingBottom: 4,
        paddingRight: 4,
        paddingLeft: 8 + Math.min(depth, 3) * 20,
        borderRadius: RADIUS.md,
        cursor: "pointer",
        flexShrink: 0,
        backgroundColor: hovered || menu !== null ? rowBackground : "#00000000",
      }}
    >
      {depth > 0 ? (
        <div style={{ marginLeft: -8, width: 1, height: 24, flexShrink: 0, backgroundColor: alpha(theme.border, 0.7) }} />
      ) : null}
      {snapshot === null ? (
        <Tooltip content="Waiting for host state" side="top">
          <Icon name={PullRequestGlyph.pullRequest} size={16} color={muted} />
        </Tooltip>
      ) : (
        <PullRequestRowGlyph
          state={snapshot.state}
          isDraft={snapshot.isDraft}
          mergeability={snapshot.mergeability}
          baseBranch={snapshot.baseBranch}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, height: 20 }}>
          <Tooltip content={`${SOURCE_LABELS[link.source]} · ${formatRelativeTimeLabel(link.linkedAt)}`} side="top">
            <text style={{ color: muted, fontSize: 12, lineHeight: 16, fontFamily: FONTS.mono, flexShrink: 0 }}>
              {`#${link.number}`}
            </text>
          </Tooltip>
          <Text truncate style={{ flexShrink: 1 }}>
            {snapshot?.title ?? link.repository}
          </Text>
          {open ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {watching ? (
                <Tooltip content={WATCH_TOOLTIP} side="top">
                  <Icon name="eye" size={14} color={muted} />
                </Tooltip>
              ) : null}
              {snapshot?.checksState ? <ChecksGlyph state={snapshot.checksState} /> : null}
              {snapshot?.reviewDecision ? <PullRequestReviewDecisionGlyph decision={snapshot.reviewDecision} /> : null}
            </div>
          ) : null}
          <div style={{ flexGrow: 1, minWidth: 0 }} />
          {projectId === null ? (
            <PullRequestDiffStat additions={snapshot?.additions ?? 0} deletions={snapshot?.deletions ?? 0} />
          ) : (
            <PullRequestChangeBreakdownStat
              environmentId={threadRef.environmentId}
              reference={{ projectId, host: link.host, repository: link.repository, number: link.number }}
              additions={snapshot?.additions ?? 0}
              deletions={snapshot?.deletions ?? 0}
            />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, height: 16, overflow: "hidden" }}>
          {stack ? (
            <Tooltip
              content={
                stack.kind === "native"
                  ? `${sourceControlClients.hostLabelForChangeRequestUrl(link.url)} stack of ${stack.size}: merging a layer lands the ones below it.`
                  : `${stack.size} pull requests chained by base branch.`
              }
              side="top"
            >
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
                <Icon name={PullRequestGlyph.stack} size={12} color={alpha(theme.foreground, 0.7)} />
                <text style={{ ...meta, color: alpha(theme.foreground, 0.7) }}>{String(stack.size)}</text>
              </div>
            </Tooltip>
          ) : null}
          {snapshot?.author ? (
            <Tooltip
              content={
                snapshot.author.name && snapshot.author.name !== snapshot.author.login
                  ? `${snapshot.author.name} (@${snapshot.author.login})`
                  : snapshot.author.login
              }
              side="top"
            >
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 128, flexShrink: 0 }}>
                <PullRequestActorAvatar actor={snapshot.author} size={14} />
                <text style={{ ...meta, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, maxWidth: 112 }}>
                  {snapshot.author.login}
                </text>
              </div>
            </Tooltip>
          ) : null}
          {snapshot !== null ? (
            <>
              <Tooltip content={link.repository} side="top">
                <text style={{ ...meta, fontFamily: FONTS.mono, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, maxWidth: 128 }}>
                  {link.repository}
                </text>
              </Tooltip>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 1 }}>
                <text style={{ ...meta, fontFamily: FONTS.mono, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>
                  {snapshot.headBranch}
                </text>
                <text style={{ ...meta, flexShrink: 0 }}>→</text>
                <text style={{ ...meta, fontFamily: FONTS.mono, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 0 }}>
                  {snapshot.baseBranch}
                </text>
              </div>
            </>
          ) : (
            <text style={{ ...meta, fontFamily: FONTS.mono, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
              {`${link.host}/${link.repository}`}
            </text>
          )}
          <div style={{ flexGrow: 1, minWidth: 0 }} />
          {snapshot?.updatedAt ? (
            <text style={{ ...meta, whiteSpace: "nowrap", flexShrink: 0 }}>{formatRelativeTimeLabel(snapshot.updatedAt)}</text>
          ) : null}
        </div>
      </div>
      {actionEntry !== null ? <PullRequestSpeedActions entry={actionEntry} hostActions={linkHostActions} /> : null}
      {showMenuButton ? (
        // web: a "..." button over the row's bottom-right corner, shown while the row is hovered,
        // on the row's own hover wash so the age under it is covered.
        <div
          testId={`linked-pr-${link.number}-menu`}
          onClick={(event) => {
            markRowControlClick(event);
            setMenu({ x: (event.x ?? 0) - 150, y: (event.y ?? 0) + 12 });
          }}
          style={{
            position: "absolute",
            right: 0,
            bottom: 2,
            display: "flex",
            alignItems: "center",
            paddingLeft: 20,
            paddingRight: 4,
            borderTopRightRadius: RADIUS.md,
            borderBottomRightRadius: RADIUS.md,
            // web: bg-background under an accent/60 wash, masked in over its first 16px.
            background: {
              type: "linear-gradient",
              angle: 90,
              stops: [
                { color: alpha(washOverBackground, 0), position: 0 },
                { color: washOverBackground, position: 0.36 },
              ],
            },
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              borderRadius: RADIUS.sm,
              cursor: "pointer",
              hover: { backgroundColor: theme.accent },
            }}
          >
            <Icon name="ellipsis" size={14} color={theme.foreground} />
          </div>
        </div>
      ) : null}
      {menu ? (
        <ContextMenu
          testId={`linked-pr-${link.number}-actions`}
          items={rowMenuItems(link, canWatch)}
          x={menu.x}
          y={menu.y}
          onSelect={(action) => onMenuAction(link, action)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/** `color` (#rrggbb or #rrggbbaa) at `opacity` composited over an opaque background. */
function washOver(color: string, opacity: number, background: string): string {
  const hex = color.replace(/^#/, "");
  const ownAlpha = hex.length >= 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return mixColors(`#${hex.slice(0, 6)}`, ownAlpha * opacity, background);
}

/** Memoized so a modifier key or a sync of one link re-renders only the rows that changed. */
const LinkRow = memo(LinkRowImpl);

function ChecksGlyph({ state }: { state: NonNullable<NonNullable<ThreadPullRequestLink["snapshot"]>["checksState"]> }) {
  const theme = useTheme();
  const presentation = pullRequestChecksStatePresentation(state, theme);
  return (
    <Tooltip content={presentation.label} side="top">
      <Icon name={presentation.icon} size={14} color={presentation.tone} />
    </Tooltip>
  );
}

function latestSyncedAt(links: ReadonlyArray<ThreadPullRequestLink>): string | null {
  let latest: string | null = null;
  for (const link of links) {
    const at = link.snapshot?.syncedAt;
    if (at !== undefined && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

const lineKey = (line: PullRequestListLine) => `${line.link.host}/${line.link.repository}#${line.link.number}`;

export function ThreadPullRequestsPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const environments = useAtomValue(pullRequestEnvironmentsAtom);
  const capabilities = environments.find((environment) => environment.environmentId === threadRef.environmentId)
    ?.serverConfig?.environment.capabilities;
  if (capabilities?.threadPullRequests !== true) {
    return (
      <PullRequestsUnavailableState
        title="Linked pull requests unavailable"
        error="This environment does not support multiple linked pull requests."
      />
    );
  }
  return <EnabledThreadPullRequestsPanel threadRef={threadRef} />;
}

function EnabledThreadPullRequestsPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const theme = useTheme();
  const thread = useThreadShell(threadRef.environmentId, threadRef.threadId);
  const allProjects = useAtomValue(environmentProjects.projectsAtom) as ReadonlyArray<EnvironmentProject>;
  const environments = useAtomValue(pullRequestEnvironmentsAtom);
  const capabilities = environments.find((environment) => environment.environmentId === threadRef.environmentId)
    ?.serverConfig?.environment.capabilities;
  const projects = allProjects
    .filter((project) => project.environmentId === threadRef.environmentId)
    .toSorted((left, right) => (left.id === thread?.projectId ? -1 : right.id === thread?.projectId ? 1 : 0));
  const links = visibleThreadPullRequests(thread?.pullRequests ?? []);
  const lines = pullRequestListLines(resolveThreadPullRequestChains(links));
  const openCount = links.filter((link) => link.snapshot === null || link.snapshot.state === "open").length;
  const lastSynced = latestSyncedAt(links);
  const speedMode = useAtomValue(shiftOnlyHeldAtom);
  const canWatch = capabilities?.threadPullRequestWatch === true;
  const openLinkDialog = () => openLinkPullRequestDialog(threadRef);

  const reportFailure = (title: string) => (result: Awaited<ReturnType<typeof runAtomCommand>>) => {
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toast({ type: "error", title, description: error instanceof Error ? error.message : "An error occurred." });
    }
  };
  const onMenuAction = (link: ThreadPullRequestLink, action: RowMenuAction) => {
    const input = { threadId: threadRef.threadId, host: link.host, repository: link.repository, number: link.number };
    switch (action) {
      case "copy":
        void copyTextToClipboard(link.url).then(
          () => toast({ type: "success", title: "Link copied" }),
          (error: unknown) => toast({ type: "error", title: "Failed to copy link", ...(error instanceof Error ? { description: error.message } : {}) }),
        );
        return;
      case "open":
        openPullRequestLink(link.url, { threadRef });
        return;
      case "watch":
        void runAtomCommand(appAtomRegistry, threadEnvironment.watchPullRequest, {
          environmentId: threadRef.environmentId,
          input: { ...input, watching: link.watch === undefined },
        }).then(reportFailure(link.watch === undefined ? "Could not watch the pull request" : "Could not stop watching"));
        return;
      case "unlink":
        void runAtomCommand(appAtomRegistry, threadEnvironment.unlinkPullRequest, {
          environmentId: threadRef.environmentId,
          input,
        }).then(reportFailure("Could not unlink the pull request"));
        return;
    }
  };

  if (links.length === 0) {
    return (
      <div
        testId="linked-prs-empty"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, flexGrow: 1, padding: 24 }}
      >
        <Icon name={PullRequestGlyph.link} size={24} color={alpha(theme.mutedForeground, 0.6)} />
        <Text weight={500}>No linked pull requests</Text>
        <Text size="xs" color={theme.mutedForeground} style={{ maxWidth: 240, textAlign: "center" }}>
          Pull requests the agent opens from this thread land here. Link one yourself from a URL or a number.
        </Text>
        <Button size="sm" variant="outline" icon="plus" testId="linked-prs-link" onClick={openLinkDialog}>
          Link pull request
        </Button>
      </div>
    );
  }

  return (
    <div testId="linked-prs" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, width: "100%" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          overflowY: "scroll",
          scrollbarColor: theme.scrollbar,
        }}
      >
        {/* The padding sits on a wrapper: on the scroller itself GPUI counted it
            into the scroll extent, so a one-row list showed a full-length thumb. */}
        <div style={{ display: "flex", flexDirection: "column", width: "100%", flexShrink: 0, padding: 6 }}>
        {lines.map((line) => (
          <LinkRow
            key={lineKey(line)}
            line={line}
            threadRef={threadRef}
            projectId={
              capabilities?.pullRequests === true
                ? ((findProjectForChangeRequest(projects, line.link)?.id ?? thread?.projectId ?? null) as ProjectId | null)
                : null
            }
            speedMode={speedMode}
            canWatch={canWatch}
            onMenuAction={onMenuAction}
          />
        ))}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderTopWidth: 1,
          borderColor: alpha(theme.border, 0.6),
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 6,
          paddingBottom: 6,
          flexShrink: 0,
        }}
      >
        <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans }}>
          {`${openCount} open · ${links.length} linked${lastSynced ? ` · synced ${formatRelativeTimeLabel(lastSynced)}` : ""}`}
        </text>
        <Button size="xs" variant="ghost" icon="plus" testId="linked-prs-footer-link" onClick={openLinkDialog}>
          Link
        </Button>
      </div>
    </div>
  );
}
