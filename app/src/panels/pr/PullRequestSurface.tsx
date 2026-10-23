// OWNER: header/git agent. Right-panel Pull request surface, after
// apps/web/src/components/pullRequest/{PullRequestDetailPanel.tsx,PullRequestDetailCrumbs.tsx,
// PullRequestDetailLayout.tsx,PullRequestSummaryTab.tsx,PullRequestTimelineTab.tsx,
// PullRequestCodeTab.tsx,ThreadPullRequestsPanel.tsx}. Read-only apart from the header's
// primary action; review, comment, label and edit flows stay on the host.
import { useAtom, useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type PullRequestAction,
  type PullRequestActivity,
  type PullRequestComment,
  type PullRequestCommit,
  type PullRequestDetail,
  type PullRequestRef,
  type PullRequestReviewThread,
  type ThreadId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import {
  pullRequestListLines,
  resolveThreadPullRequestChains,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { projectIndexAtom } from "../../state/environment.ts";
import {
  openPullRequestSurface,
  pullRequestDetailTabAtom,
  pullRequestEnvironment,
  selectedPullRequestAtom,
  type PullRequestDetailTab,
} from "../../state/gitPullRequests.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Dialog, Menu, MenuItem, MenuSeparator, Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import {
  allowedPullRequestMergeMethods,
  canPerformPullRequestAction,
  orderPullRequestComments,
  pullRequestChecksState,
  resolvePullRequestDetailChecks,
  resolvePullRequestPrimaryControl,
} from "../../web/components/pullRequest/pullRequestDetail.logic.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { readEnvironmentScope } from "../../web/state/session.ts";
import { openExternalUrl } from "./openExternal.ts";
import {
  ActorAvatar,
  ChecksPopover,
  DiffStatText,
  formatAgo,
  hostMarkdownToGpuix,
  resolvePullRequestState,
} from "./pullRequestPresentation.tsx";
import { pullRequestReferenceFor, useServerCapabilities, useThreadPullRequest, useThreadShell } from "./useThreadPullRequest.ts";

const TABS: ReadonlyArray<{ value: PullRequestDetailTab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
];

function hoverWash(theme: Palette) {
  return theme.appearance === "dark" ? alpha("#ffffff", 0.08) : alpha("#000000", 0.035);
}

function CenteredNote({ title, detail }: { title: string; detail?: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingLeft: 24, paddingRight: 24 }}>
      <Text weight={500}>{title}</Text>
      {detail ? (
        <Text size="xs" color={alpha(theme.mutedForeground, 0.8)} style={{ textAlign: "center" }}>
          {detail}
        </Text>
      ) : null}
    </div>
  );
}

function SkeletonBar({ width, height = 12 }: { width: number | "100%"; height?: number }) {
  const theme = useTheme();
  return <div style={{ width, height, borderRadius: height / 2, backgroundColor: alpha(theme.foreground, 0.06), flexShrink: 0 }} />;
}

/** The thread's pull requests, when it has several and none is picked (ThreadPullRequestsPanel). */
function PullRequestList({
  environmentId,
  threadId,
  links,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  links: ReadonlyArray<ThreadPullRequestLink>;
}) {
  const theme = useTheme();
  const projectIndex = useAtomValue(projectIndexAtom);
  const lines = pullRequestListLines(resolveThreadPullRequestChains(visibleThreadPullRequests(links)));
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar, padding: 8 }}>
      <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 8 }}>
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          {`Pull requests (${lines.length})`}
        </Text>
      </div>
      {lines.map(({ link }) => {
        const snapshot = link.snapshot;
        const state = snapshot ? resolvePullRequestState(theme, { state: snapshot.state, isDraft: snapshot.isDraft }) : null;
        const project = [...projectIndex.entries()].find(
          ([key, candidate]) => key.startsWith(`${environmentId}:`) && candidate.repositoryIdentity?.name !== undefined && link.repository.toLowerCase().endsWith(`/${candidate.repositoryIdentity.name.toLowerCase()}`),
        )?.[1];
        return (
          <div
            key={threadPullRequestKeyOf(link)}
            testId={`pr-list-${link.number}`}
            onClick={() => openPullRequestSurface({ environmentId, threadId }, pullRequestReferenceFor(project ?? null, link.number, link))}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: RADIUS.lg, cursor: "pointer", flexShrink: 0, hover: { backgroundColor: hoverWash(theme) } }}
          >
            <Icon name={state?.icon ?? "git-pull-request-arrow"} size={16} color={state?.color ?? theme.mutedForeground} />
            <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>{`#${link.number}`}</Text>
            <Text truncate style={{ flexGrow: 1 }}>
              {snapshot?.title ?? link.url}
            </Text>
            <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
              {link.repository}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

export function PullRequestSurface({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const threadKey = scopedThreadKey({ environmentId, threadId });
  const shell = useThreadShell(environmentId, threadId);
  const projectIndex = useAtomValue(projectIndexAtom);
  const project = shell ? (projectIndex.get(`${environmentId}:${shell.projectId}`) ?? null) : null;
  const gitCwd = shell?.worktreePath ?? project?.workspaceRoot ?? null;
  const resolved = useThreadPullRequest({ environmentId, threadId, gitCwd });
  const selected = useAtomValue(selectedPullRequestAtom(threadKey));
  const capabilities = useServerCapabilities(environmentId);
  const visibleLinks = visibleThreadPullRequests(resolved.links);

  if (!capabilities.known) return <PullRequestDetailGhost />;
  if (!capabilities.pullRequests) {
    return <CenteredNote title="Pull requests unavailable" detail="Update this environment's T3 Code server to browse pull requests." />;
  }
  if (selected === null && visibleLinks.length > 1) {
    return <PullRequestList environmentId={environmentId} threadId={threadId} links={resolved.links} />;
  }
  const reference = selected ?? resolved.reference;
  if (reference === null) {
    return <CenteredNote title="No pull request" detail="This thread is not linked to a pull request yet." />;
  }
  return (
    <PullRequestDetailPanel
      key={`${threadKey}:${reference.repository}#${reference.number}`}
      environmentId={environmentId}
      threadId={threadId}
      reference={reference}
      onBack={visibleLinks.length > 1 ? () => appAtomRegistry.set(selectedPullRequestAtom(threadKey), null) : undefined}
    />
  );
}

function PullRequestDetailGhost() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <SkeletonBar width={180} />
      <SkeletonBar width={"100%"} height={16} />
      <SkeletonBar width={240} />
      <div style={{ height: 12 }} />
      <SkeletonBar width={"100%"} />
      <SkeletonBar width={"100%"} />
      <SkeletonBar width={320} />
    </div>
  );
}

function PullRequestDetailPanel({
  environmentId,
  threadId,
  reference,
  onBack,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  reference: PullRequestRef;
  onBack: (() => void) | undefined;
}) {
  const theme = useTheme();
  const threadKey = scopedThreadKey({ environmentId, threadId });
  const [tab, setTab] = useAtom(pullRequestDetailTabAtom(threadKey));
  const capabilities = useServerCapabilities(environmentId);
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({ environmentId, input: { ...reference, allowStale: false } }),
  );
  const checksQuery = useEnvironmentQuery(
    capabilities.pullRequestChecks && detailQuery.data !== null
      ? pullRequestEnvironment.checks({ environmentId, input: reference })
      : null,
  );
  const activityQuery = useEnvironmentQuery(pullRequestEnvironment.activity({ environmentId, input: reference }));
  const detail = resolvePullRequestDetailChecks(
    detailQuery.data,
    checksQuery.data,
    checksQuery.dataUpdatedAt >= detailQuery.dataUpdatedAt,
  );
  const [pendingAction, setPendingAction] = useState<PullRequestAction | null>(null);
  const [confirmingMerge, setConfirmingMerge] = useState(false);

  if (detail === null) {
    if (detailQuery.error !== null && !detailQuery.isPending) {
      return <CenteredNote title="Pull request unavailable" detail={detailQuery.error} />;
    }
    return <PullRequestDetailGhost />;
  }

  const client = sourceControlClients.get(detail.provider);
  const openOnHostText = `Open on ${client.label}`;
  const state = resolvePullRequestState(theme, { state: detail.state, isDraft: detail.isDraft });
  const checksRollup = pullRequestChecksState(detail.checks);
  const allowedMergeMethods = allowedPullRequestMergeMethods(detail);
  const mergeMethod = allowedMergeMethods[0] ?? null;
  const can = (action: PullRequestAction) => canPerformPullRequestAction(detail, action);
  const primary = resolvePullRequestPrimaryControl({
    state: detail.state,
    isDraft: detail.isDraft,
    mergeability: detail.mergeability,
    checksState: checksRollup,
    autoMergeEnabled: detail.autoMergeEnabled,
    hasMergeMethod: allowedMergeMethods.length > 0,
    canMerge: can("merge"),
    canMarkReady: can("ready"),
    canEnableAutoMerge: can("enable-auto-merge"),
  });
  const checkoutCommand = client.checkoutCommand({
    number: detail.number,
    headBranch: detail.headBranch,
    headRepositoryNameWithOwner: detail.headRepositoryNameWithOwner ?? null,
  });
  const refresh = () => {
    detailQuery.refresh();
    checksQuery.refresh();
    activityQuery.refresh();
  };

  const perform = async (action: PullRequestAction) => {
    if (pendingAction !== null) return;
    if (!readEnvironmentScope(environmentId, AuthSourceControlWriteScope)) {
      toast({ type: "error", title: "Action unavailable", description: "This connection cannot change source control." });
      return;
    }
    setPendingAction(action);
    const result = await runAtomCommand(appAtomRegistry, pullRequestEnvironment.runAction, {
      environmentId,
      input: { ...reference, action, ...(action === "merge" && mergeMethod ? { mergeMethod } : {}) },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toast({ type: "error", title: "Pull request action failed", description: error instanceof Error ? error.message : "An error occurred." });
      }
      return;
    }
    refresh();
  };

  const primaryButton =
    primary === "resolve" ? (
      <Tooltip content={`Resolve the conflicts on ${client.label}`}>
        <HeaderButton tone="destructive" icon="triangle-alert" testId="pr-primary" onClick={() => openExternalUrl(detail.url)}>
          Resolve conflicts
        </HeaderButton>
      </Tooltip>
    ) : primary === "ready" ? (
      <HeaderButton tone="default" testId="pr-primary" onClick={() => void perform("ready")} disabled={pendingAction !== null}>
        {pendingAction === "ready" ? "Marking..." : "Ready for review"}
      </HeaderButton>
    ) : primary === "merge" ? (
      <HeaderButton tone="success" icon="git-merge" testId="pr-primary" onClick={() => setConfirmingMerge(true)} disabled={pendingAction !== null}>
        {pendingAction === "merge" ? "Merging..." : "Merge"}
      </HeaderButton>
    ) : primary === "auto-merge-armed" ? (
      <HeaderButton tone="default" testId="pr-primary" disabled>
        Auto-merge on
      </HeaderButton>
    ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.background }}>
      {/* Header: crumbs + actions, title, author line, branches line. */}
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 28, paddingLeft: 16, paddingRight: 16, gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexGrow: 1, minWidth: 0 }}>
            {onBack ? (
              <Tooltip content="Back to pull requests" side="top">
                <div testId="pr-back" onClick={onBack} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, marginLeft: -6, borderRadius: RADIUS.sm, cursor: "pointer", hover: { backgroundColor: hoverWash(theme) } }}>
                  <Icon name="arrow-left" size={14} color={theme.mutedForeground} />
                </div>
              </Tooltip>
            ) : null}
            <Text size="xs" weight={500} color={theme.mutedForeground} truncate>
              {detail.repository}
            </Text>
            <Tooltip content={openOnHostText} side="top">
              <div testId="pr-number-link" onClick={() => openExternalUrl(detail.url)} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, cursor: "pointer", flexShrink: 0 }}>
                <text style={{ color: state.color, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>{`#${detail.number}`}</text>
                <Icon name="external-link" size={10} color={state.color} />
              </div>
            </Tooltip>
          </div>
          {primaryButton}
          <Menu
            align="end"
            minWidth={200}
            trigger={({ toggle }) => (
              <div testId="pr-more" onClick={toggle} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: RADIUS.md, cursor: "pointer", hover: { backgroundColor: hoverWash(theme) } }}>
                <Icon name="ellipsis" size={16} color={theme.mutedForeground} />
              </div>
            )}
          >
            <MenuItem icon="external-link" onSelect={() => openExternalUrl(detail.url)}>
              {openOnHostText}
            </MenuItem>
            <MenuItem icon="refresh-cw" onSelect={refresh}>
              Refresh
            </MenuItem>
            {detail.state === "open" && can("close") ? (
              <>
                <MenuSeparator />
                <MenuItem icon="git-pull-request-closed" destructive onSelect={() => void perform("close")}>
                  Close pull request
                </MenuItem>
              </>
            ) : null}
          </Menu>
        </div>
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingBottom: 16, marginTop: 4 }}>
          <Tooltip content="Select to copy" side="top">
            <text style={{ color: theme.foreground, fontSize: 16, lineHeight: 24, fontWeight: 600, fontFamily: FONTS.sans, userSelect: "text" } as never}>
              {detail.title}
            </text>
          </Tooltip>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20, marginTop: 8 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>
              <ActorAvatar actor={detail.author} size={16} />
              <Text size="xs" weight={500} truncate>
                {detail.author?.login ?? "unknown"}
              </Text>
              <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
                {`· updated ${formatAgo(detail.updatedAt)}`}
              </Text>
            </div>
            <div style={{ flexGrow: 1 }} />
            {checkoutCommand ? (
              <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono, flexShrink: 0, userSelect: "text" } as never}>{checkoutCommand}</text>
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20, marginTop: 16 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }}>
              <text style={{ color: alpha(theme.mutedForeground, 0.7), fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono, flexShrink: 0 }}>{detail.baseBranch}</text>
              <Icon name="arrow-left" size={12} color={alpha(theme.mutedForeground, 0.6)} />
              <text style={{ color: alpha(theme.mutedForeground, 0.7), fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
                {detail.headBranch}
              </text>
            </div>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <Icon name="file-diff" size={14} color={theme.mutedForeground} />
              <Text size="xs" color={theme.mutedForeground}>
                {`${detail.changedFiles.toLocaleString()} ${detail.changedFiles === 1 ? "file" : "files"}`}
              </Text>
              <DiffStatText additions={detail.additions} deletions={detail.deletions} size={12} />
            </div>
          </div>
        </div>
        {/* Tab bar (PullRequestDetailTabBar). */}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
          <SegmentedTabs value={tab} onChange={setTab} />
          <div style={{ flexGrow: 1 }} />
          {tab === "summary" && checksRollup !== null ? (
            <ChecksPopover checksState={checksRollup} checks={detail.checks} variant="summary" testId="pr-checks" />
          ) : tab === "timeline" && activityQuery.data ? (
            <TimelineMeta activity={activityQuery.data} />
          ) : null}
        </div>
      </div>
      {tab === "summary" ? (
        <SummaryTab detail={detail} reviewers={activityQuery.data?.reviewers?.length ? activityQuery.data.reviewers : detail.reviewers} />
      ) : tab === "timeline" ? (
        <TimelineTab activity={activityQuery.data} pending={activityQuery.isPending} error={activityQuery.error} />
      ) : (
        <CodeTab environmentId={environmentId} reference={reference} detail={detail} />
      )}
      <Dialog
        open={confirmingMerge}
        onOpenChange={setConfirmingMerge}
        title="Merge pull request?"
        description={`This merges #${detail.number} using ${mergeMethod ?? "merge"}.`}
        width={420}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmingMerge(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setConfirmingMerge(false);
                void perform("merge");
              }}
            >
              Merge
            </Button>
          </>
        }
      />
    </div>
  );
}

function HeaderButton({
  children,
  tone,
  icon,
  onClick,
  disabled,
  testId,
}: {
  children: ReactNode;
  tone: "default" | "destructive" | "success";
  icon?: IconName;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  const color = tone === "destructive" ? theme.errorForeground : tone === "success" ? theme.successForeground : theme.foreground;
  const border = tone === "destructive" ? alpha(theme.error, 0.32) : tone === "success" ? alpha(theme.success, 0.32) : theme.input;
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 24,
        paddingLeft: 6,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: tone === "destructive" ? alpha(theme.error, 0.08) : tone === "success" ? alpha(theme.success, 0.08) : "#00000000",
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled ? {} : { hover: { backgroundColor: tone === "destructive" ? alpha(theme.error, 0.14) : hoverWash(theme) } }),
      }}
    >
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <text style={{ color, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>{children}</text>
    </div>
  );
}

/** ToggleGroup variant="segmented": pill tabs, the selected one on an accent fill. */
function SegmentedTabs({ value, onChange }: { value: PullRequestDetailTab; onChange: (tab: PullRequestDetailTab) => void }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, padding: 2, borderRadius: RADIUS.md, backgroundColor: alpha(theme.foreground, 0.03), flexShrink: 0 }}>
      {TABS.map((item) => {
        const active = item.value === value;
        return (
          <div
            key={item.value}
            testId={`pr-tab-${item.value}`}
            onClick={() => onChange(item.value)}
            style={{
              display: "flex",
              alignItems: "center",
              height: 24,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: RADIUS.sm,
              cursor: "pointer",
              backgroundColor: active ? alpha(theme.foreground, 0.08) : "#00000000",
              ...(active ? {} : { hover: { backgroundColor: alpha(theme.foreground, 0.05) } }),
            }}
          >
            <text style={{ color: active ? theme.foreground : theme.mutedForeground, fontSize: 14, lineHeight: 20, fontWeight: active ? 600 : 500, fontFamily: FONTS.sans }}>
              {item.label}
            </text>
          </div>
        );
      })}
    </div>
  );
}

// ── Summary ───────────────────────────────────────────────────────────────

function SummaryRow({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minHeight: 32, flexShrink: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: 104, flexShrink: 0 }}>
        <Icon name={icon} size={14} color={theme.mutedForeground} />
        <Text size="xs" color={theme.mutedForeground}>
          {label}
        </Text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexGrow: 1, minWidth: 0, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function labelChipColors(theme: Palette, color: string | null) {
  const hex = color && /^[0-9a-f]{6}$/i.test(color.replace(/^#/, "")) ? `#${color.replace(/^#/, "")}` : null;
  if (hex === null) return { bg: alpha(theme.foreground, 0.08), fg: theme.foreground };
  return { bg: alpha(hex, 0.28), fg: theme.appearance === "dark" ? hex : theme.foreground };
}

function SummaryTab({ detail, reviewers }: { detail: PullRequestDetail; reviewers: PullRequestDetail["reviewers"] }) {
  const theme = useTheme();
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  return (
    <div testId="pr-summary" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 24 }}>
      <SummaryRow icon="users" label="Reviewers">
        {reviewers.length === 0 ? (
          <Text size="xs" color={alpha(theme.mutedForeground, 0.7)}>
            None
          </Text>
        ) : (
          reviewers.map((reviewer) => (
            <Tooltip key={reviewer.login} content={reviewer.name ?? reviewer.login} side="top">
              <div style={{ display: "flex", marginRight: -6 }}>
                <ActorAvatar actor={reviewer} size={18} />
              </div>
            </Tooltip>
          ))
        )}
      </SummaryRow>
      <SummaryRow icon="tag" label="Labels">
        {detail.labels.length === 0 ? (
          <Text size="xs" color={alpha(theme.mutedForeground, 0.7)}>
            None
          </Text>
        ) : (
          detail.labels.map((label) => {
            const colors = labelChipColors(theme, label.color);
            return (
              <div key={label.name} style={{ display: "flex", alignItems: "center", height: 20, paddingLeft: 6, paddingRight: 6, borderRadius: RADIUS.sm, backgroundColor: colors.bg }}>
                <text style={{ color: colors.fg, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>{label.name}</text>
              </div>
            );
          })
        )}
      </SummaryRow>
      <div
        testId="pr-description-toggle"
        onClick={() => setDescriptionOpen(!descriptionOpen)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 32, cursor: "pointer", flexShrink: 0 }}
      >
        <Text size="xs" color={theme.mutedForeground}>
          Description
        </Text>
        <Icon name={descriptionOpen ? "chevron-down" : "chevron-right"} size={14} color={theme.mutedForeground} />
      </div>
      {descriptionOpen ? (
        detail.body.trim().length === 0 ? (
          <Text size="sm" color={alpha(theme.mutedForeground, 0.7)}>
            No description provided.
          </Text>
        ) : (
          <markdown
            source={hostMarkdownToGpuix(detail.body)}
            onLinkClick={(event: { value?: string }) => event.value && openExternalUrl(event.value)}
            theme={{
              appearance: theme.appearance,
              text: alpha(theme.foreground, 0.8),
              bg: theme.background,
              accent: theme.infoForeground,
              fontSans: FONTS.sans,
              fontMono: FONTS.mono,
              metrics: { mdTextSize: 14, mdLineHeight: 23, mdBlockGap: 10, mdHeadingSizes: [20, 18, 16, 14] },
            }}
            style={{ flexShrink: 0 }}
          />
        )
      ) : null}
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────

type TimelineEntry =
  | { kind: "comment"; at: string; comment: PullRequestComment }
  | { kind: "commit"; at: string; commit: PullRequestCommit }
  | { kind: "thread"; at: string; thread: PullRequestReviewThread };

function TimelineMeta({ activity }: { activity: PullRequestActivity }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name="message-square" size={12} color={theme.mutedForeground} />
      <Text size="xs" color={theme.mutedForeground}>{`${activity.commentCount}`}</Text>
      <Text size="xs" color={alpha(theme.mutedForeground, 0.5)}>·</Text>
      <Icon name="git-commit-horizontal" size={12} color={theme.mutedForeground} />
      <Text size="xs" color={theme.mutedForeground}>{`${activity.commits.length}`}</Text>
    </div>
  );
}

function TimelineTab({ activity, pending, error }: { activity: PullRequestActivity | null; pending: boolean; error: string | null }) {
  const theme = useTheme();
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  if (activity === null) {
    if (error !== null && !pending) return <CenteredNote title="Activity unavailable" detail={error} />;
    return <PullRequestDetailGhost />;
  }
  const entries: TimelineEntry[] = [
    ...activity.comments.map((comment) => ({ kind: "comment" as const, at: comment.createdAt, comment })),
    ...activity.commits.map((commit) => ({ kind: "commit" as const, at: commit.committedDate, commit })),
    ...activity.reviewThreads
      .filter((thread) => thread.comments.length > 0)
      .map((thread) => ({ kind: "thread" as const, at: thread.comments[0]!.createdAt, thread })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const ordered = orderPullRequestComments(
    entries.map((entry) => ({ ...entry, createdAt: entry.at })),
    order,
  );
  return (
    <div testId="pr-timeline" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 24, gap: 4 }}>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", flexShrink: 0 }}>
        <div testId="pr-timeline-order" onClick={() => setOrder(order === "newest" ? "oldest" : "newest")} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 24, paddingLeft: 6, paddingRight: 6, borderRadius: RADIUS.sm, cursor: "pointer", hover: { backgroundColor: hoverWash(theme) } }}>
          <Icon name="arrow-down-up" size={12} color={theme.mutedForeground} />
          <Text size="xs" color={theme.mutedForeground}>
            {order === "newest" ? "Newest first" : "Oldest first"}
          </Text>
        </div>
      </div>
      {ordered.length === 0 ? (
        <Text size="xs" color={alpha(theme.mutedForeground, 0.7)}>
          No activity yet.
        </Text>
      ) : (
        groupTimeline(ordered).map((entry, index) =>
          entry.kind === "commit" ? (
            <CommitRow key={`commit:${entry.commit.oid}:${index}`} commit={entry.commit} />
          ) : entry.kind === "thread" ? (
            <ReviewThreadRow key={`thread:${entry.thread.id}`} thread={entry.thread} />
          ) : entry.kind === "comments" ? (
            <CommentGroupRow key={`comments:${entry.comments[0]!.id}`} comments={entry.comments} />
          ) : (
            <CommentRow key={`comment:${entry.comment.id}`} comment={entry.comment} />
          ),
        )
      )}
      {activity.commentsTruncated ? (
        <Text size="xs" color={alpha(theme.mutedForeground, 0.7)}>
          Older comments are on the host.
        </Text>
      ) : null}
    </div>
  );
}

type GroupedTimelineEntry = TimelineEntry | { kind: "comments"; comments: ReadonlyArray<PullRequestComment> };

/** Runs of plain comments fold into one "N comments" row, as web's timeline does. */
function groupTimeline(entries: ReadonlyArray<TimelineEntry>): ReadonlyArray<GroupedTimelineEntry> {
  const out: GroupedTimelineEntry[] = [];
  let run: PullRequestComment[] = [];
  const flush = () => {
    if (run.length > 0) out.push({ kind: "comments", comments: run });
    run = [];
  };
  for (const entry of entries) {
    if (entry.kind === "comment" && entry.comment.kind === "issue-comment") {
      run.push(entry.comment);
      continue;
    }
    flush();
    out.push(entry);
  }
  flush();
  return out;
}

function CommentGroupRow({ comments }: { comments: ReadonlyArray<PullRequestComment> }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const authors = new Set(comments.map((comment) => comment.author?.login ?? "unknown"));
  const latest = comments.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div
        testId="pr-timeline-comment-group"
        onClick={() => setOpen(!open)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10, paddingBottom: 10, cursor: "pointer", borderRadius: RADIUS.md }}
      >
        <div style={{ opacity: 0.6 }}>
          <ActorAvatar actor={latest.author} size={26} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          <Text size="xs" color={theme.mutedForeground}>
            {`${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}
          </Text>
          <Text size="2xs" color={alpha(theme.mutedForeground, 0.7)}>
            {`${authors.size} ${authors.size === 1 ? "author" : "authors"} · ${formatAgo(latest.createdAt)}`}
          </Text>
        </div>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
      </div>
      {open ? comments.map((comment) => <CommentRow key={comment.id} comment={comment} />) : null}
    </div>
  );
}

function CommitRow({ commit }: { commit: PullRequestCommit }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 12, paddingTop: 10, paddingBottom: 10, flexShrink: 0 }}>
      <ActorAvatar actor={commit.authors?.[0] ?? null} size={26} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 }}>
        <Text size="xs" weight={600} truncate>
          {commit.messageHeadline}
        </Text>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono }}>{commit.oid.slice(0, 7)}</text>
          <Text size="2xs" color={theme.mutedForeground}>
            {formatAgo(commit.committedDate)}
          </Text>
        </div>
      </div>
      {commit.additions !== undefined && commit.deletions !== undefined ? (
        <DiffStatText additions={commit.additions} deletions={commit.deletions} size={10} />
      ) : null}
    </div>
  );
}

function CommentRow({ comment }: { comment: PullRequestComment }) {
  const theme = useTheme();
  const verb =
    comment.kind === "review"
      ? comment.reviewState
        ? reviewStateVerb(comment.reviewState)
        : "reviewed"
      : comment.kind === "review-comment"
        ? "commented on a file"
        : "commented";
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 12, paddingTop: 10, paddingBottom: 10, flexShrink: 0 }}>
      <ActorAvatar actor={comment.author} size={26} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text size="xs" weight={600}>
            {comment.author?.login ?? "unknown"}
          </Text>
          <Text size="xs" color={theme.mutedForeground}>
            {verb}
          </Text>
          <div style={{ flexGrow: 1 }} />
          {comment.url ? (
            <Tooltip content="Open on host" side="top">
              <div onClick={() => comment.url && openExternalUrl(comment.url)} style={{ display: "flex", cursor: "pointer" }}>
                <Icon name="external-link" size={12} color={theme.mutedForeground} />
              </div>
            </Tooltip>
          ) : null}
        </div>
        <Text size="2xs" color={theme.mutedForeground}>
          {formatAgo(comment.createdAt)}
        </Text>
        {hostMarkdownToGpuix(comment.body).length > 0 ? (
          <markdown
            source={hostMarkdownToGpuix(comment.body)}
            onLinkClick={(event: { value?: string }) => event.value && openExternalUrl(event.value)}
            theme={{
              appearance: theme.appearance,
              text: alpha(theme.foreground, 0.8),
              bg: theme.background,
              accent: theme.infoForeground,
              fontSans: FONTS.sans,
              fontMono: FONTS.mono,
              metrics: { mdTextSize: 13, mdLineHeight: 20, mdBlockGap: 8, mdHeadingSizes: [18, 16, 14, 13] },
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function reviewStateVerb(state: string): string {
  const normalized = state.toLowerCase().replaceAll("_", "-");
  if (normalized === "approved") return "approved these changes";
  if (normalized === "changes-requested") return "requested changes";
  if (normalized === "dismissed") return "review dismissed";
  return "reviewed";
}

function ReviewThreadRow({ thread }: { thread: PullRequestReviewThread }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const first = thread.comments[0]!;
  const replies = (thread.commentCount ?? thread.comments.length) - 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, paddingTop: 6, paddingBottom: 6 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28, cursor: "pointer", borderRadius: RADIUS.md, paddingLeft: 4, paddingRight: 4, hover: { backgroundColor: hoverWash(theme) } }}>
        <ActorAvatar actor={first.author} size={22} />
        <Icon name="file-diff" size={12} color={theme.mutedForeground} />
        <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono, whiteSpace: "nowrap", textOverflow: "ellipsis-start", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>
          {thread.path}
        </text>
        {thread.isResolved ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0 }}>
            <Icon name="circle-check" size={12} color={theme.successForeground} />
            <Text size="xs" color={theme.successForeground}>
              Resolved
            </Text>
          </div>
        ) : null}
        {thread.isOutdated ? (
          <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
            Outdated
          </Text>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
          {`${first.author?.login ?? "unknown"}${replies > 0 ? ` · ${replies} ${replies === 1 ? "reply" : "replies"}` : ""}`}
        </Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={12} color={theme.mutedForeground} />
      </div>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 30 }}>
          {thread.comments.map((comment) => (
            <CommentRow key={comment.id} comment={{ ...comment, kind: "review-comment", path: thread.path, reviewState: null }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Code ──────────────────────────────────────────────────────────────────

function patchFilePaths(patch: string): string[] {
  const paths: string[] = [];
  for (const line of patch.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const match = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(line);
    if (match) paths.push(match[2] ?? match[1]!);
  }
  return paths;
}

function CodeTab({ environmentId, reference, detail }: { environmentId: EnvironmentId; reference: PullRequestRef; detail: PullRequestDetail }) {
  const theme = useTheme();
  const diffQuery = useEnvironmentQuery(pullRequestEnvironment.diff({ environmentId, input: reference }));
  const patch = diffQuery.data?.patch ?? null;
  const paths = patch === null ? [] : patchFilePaths(patch);
  // Web lists every file folded until opened; null means "all folded".
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const collapsed = paths.filter((path) => !expanded.has(path));
  const allExpanded = paths.length > 0 && collapsed.length === 0;
  if (patch === null) {
    if (diffQuery.error !== null && !diffQuery.isPending) return <CenteredNote title="Diff unavailable" detail={diffQuery.error} />;
    return <PullRequestDetailGhost />;
  }
  return (
    <div testId="pr-code" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 40, paddingLeft: 16, paddingRight: 12, flexShrink: 0, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
        <Text size="xs" weight={600}>
          All commits
        </Text>
        <Text size="xs" color={theme.mutedForeground}>
          {`${detail.changedFiles.toLocaleString()} ${detail.changedFiles === 1 ? "file" : "files"}`}
        </Text>
        <div style={{ flexGrow: 1 }} />
        <Tooltip content={allExpanded ? "Collapse all files" : "Expand all files"} side="top">
          <div
            testId="pr-code-toggle-all"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(paths))}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: RADIUS.md, cursor: "pointer", hover: { backgroundColor: hoverWash(theme) } }}
          >
            <Icon name={allExpanded ? "chevrons-down-up" : "chevrons-up-down"} size={14} color={theme.mutedForeground} />
          </div>
        </Tooltip>
      </div>
      {diffQuery.data?.nextCursor || diffQuery.data?.truncated ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 16, paddingRight: 16, paddingTop: 6, paddingBottom: 6, flexShrink: 0, backgroundColor: alpha(theme.muted, 0.4), borderBottomWidth: 1, borderColor: alpha(theme.border, 0.7) }}>
          <Text size="2xs" color={theme.mutedForeground} style={{ flexGrow: 1 }}>
            {diffQuery.data?.nextCursor ? "This diff is large; only the first part is shown here." : "Part of this diff cannot be shown inline."}
          </Text>
          <div onClick={() => openExternalUrl(`${detail.url}/files`)} style={{ cursor: "pointer" }}>
            <Text size="2xs" color={theme.infoForeground}>
              View on host
            </Text>
          </div>
        </div>
      ) : null}
      {patch.trim().length === 0 ? (
        <CenteredNote title="No changes" />
      ) : (
        <diff
          patch={patch}
          wordDiff
          scroll
          collapsedPaths={collapsed}
          onToggleFile={(event: { value?: string }) => {
            const path = event.value;
            if (!path) return;
            const next = new Set(expanded);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            setExpanded(next);
          }}
          theme={{
            appearance: theme.appearance,
            bg: theme.background,
            text: theme.foreground,
            fontSans: FONTS.sans,
            fontMono: FONTS.mono,
            metrics: { diffTextSize: 12, diffLineHeight: 20, diffFileHeaderHeight: 32 },
          }}
          style={{ flexGrow: 1, minHeight: 0 }}
        />
      )}
    </div>
  );
}

