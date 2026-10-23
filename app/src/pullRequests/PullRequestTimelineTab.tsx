// Port of apps/web/src/components/pullRequest/PullRequestTimelineTab.tsx: the pull request's
// history as one rail, with remarks the viewer may rewrite in place and reaction bars on
// remarks and verdicts. A commit row scopes the Code tab to that commit.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PullRequestActor, PullRequestComment, PullRequestRef } from "@t3tools/contracts";
import { createContext, useContext, useState, type ReactNode } from "react";

import { pullRequestEnvironment } from "../state/pullRequests.ts";
import { toast } from "../ui/toast.tsx";
import { canEditPullRequestComment } from "../web/components/pullRequest/pullRequestEditing.logic.ts";
import { PrEditButton } from "./prControls.tsx";
import { PullRequestMarkdownEditor } from "./PullRequestMarkdownEditor.tsx";
import { PullRequestReactionBar } from "./PullRequestReactions.tsx";
import { PullRequestMoreReplies } from "./PullRequestSummaryTab.tsx";
import { PullRequestActivityUnavailableState } from "./PullRequestUnavailableStates.tsx";
import { PullRequestDryRunError, runPullRequestWrite } from "./pullRequestWrites.ts";

/** What every remark on the rail needs to be rewritten or reacted to (web: ReactionSurface). */
interface TimelineSurface {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly canReact: boolean;
  readonly editable: ReadonlyMap<string, PullRequestComment>;
  readonly onRefresh: () => void;
  readonly onOpenCommit: (oid: string) => void;
}

const TimelineSurfaceContext = createContext<TimelineSurface | null>(null);

import { Icon, type IconName } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { FONTS, alpha, useTheme } from "../ui/theme.ts";
import { openExternalUrl } from "../usage/openExternal.ts";
import {
  buildPullRequestTimeline,
  groupPullRequestTimelineConversations,
  isPullRequestVerdictStale,
  newestPullRequestCommitAt,
  pullRequestReviewOutcome,
  type PullRequestReviewOutcome,
  type PullRequestTimelineEvent,
  type PullRequestTimelineThread,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import type { PullRequestDetailView } from "./PullRequestDetailPanel.tsx";
import { GhostBar } from "./PullRequestListStates.tsx";
import { PrMarkdown } from "./PullRequestSummaryTab.tsx";
import {
  PullRequestActorAvatar,
  PullRequestDiffStat,
  PullRequestGlyph,
  TW,
  formatRelativeTimeLabel,
} from "./pullRequestPresentation.tsx";

const ROW_GAP = 20;

function TimelineRow({
  children,
  marker,
  markerTop = 6,
  onClick,
}: {
  children: ReactNode;
  marker: ReactNode;
  markerTop?: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        marginBottom: ROW_GAP,
        paddingLeft: 48,
        flexShrink: 0,
        ...(onClick ? { cursor: "pointer" } : {}),
      }}
    >
      <div style={{ position: "absolute", left: 0, top: markerTop, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {marker}
      </div>
      {children}
    </div>
  );
}

function IconMarker({ icon }: { icon: IconName }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, backgroundColor: theme.background }}>
      <Icon name={icon} size={14} color={theme.mutedForeground} />
    </div>
  );
}

function ActorMarker({ actors, fallback, muted = false }: { actors: ReadonlyArray<PullRequestActor>; fallback: IconName; muted?: boolean }) {
  const theme = useTheme();
  const actor = actors[0];
  if (actor === undefined) return <IconMarker icon={fallback} />;
  return (
    <div style={{ display: "flex", padding: 2, backgroundColor: theme.background, borderRadius: 16, opacity: muted ? 0.45 : 1 }}>
      <PullRequestActorAvatar actor={actor} size={28} />
    </div>
  );
}

function ActorName({ actor }: { actor: PullRequestActor | null }) {
  return (
    <Text size="xs" weight={600}>
      {actor?.login ?? "ghost"}
    </Text>
  );
}

function friendlyReviewState(value: string): string {
  const words = value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  return words.replace(/^\w/u, (letter) => letter.toUpperCase());
}

function OpenOnHostButton({ url }: { url: string | null }) {
  if (url === null) return null;
  return (
    <Tooltip content="Open activity on host">
      <div style={{ display: "flex", marginRight: -4, marginTop: -4 }}>
        <IconButton icon="external-link" size={24} iconSize={12} onClick={() => openExternalUrl(url)} />
      </div>
    </Tooltip>
  );
}

function MetaLine({ children }: { children: ReactNode[] }) {
  const theme = useTheme();
  const parts = children.filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, minWidth: 0 }}>
      {parts.flatMap((part, index) =>
        index === 0
          ? [part]
          : [
              <text key={`sep${index}`} style={{ color: alpha(theme.mutedForeground, 0.5), fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans }}>
                ·
              </text>,
              part,
            ],
      )}
    </div>
  );
}

function PathLabel({ path }: { path: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
      <Icon name="file-code-2" size={12} color={theme.mutedForeground} />
      <Text size="2xs" color={theme.mutedForeground} truncate>
        {path}
      </Text>
    </div>
  );
}

function TimelineBody({ body, markdown }: { body: string; markdown: boolean }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", marginTop: 12 }}>
      {markdown ? (
        <PrMarkdown source={body} />
      ) : (
        <Text size="xs" color={theme.mutedForeground}>
          {body}
        </Text>
      )}
    </div>
  );
}

function ConversationCard({ event, showPath = true }: { event: PullRequestTimelineEvent; showPath?: boolean }) {
  const theme = useTheme();
  const surface = useContext(TimelineSurfaceContext);
  const editable = surface?.editable.get(event.id) ?? null;
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async (body: string) => {
    // A review's own summary is not a kind any host rewrites, which is why `editable` is never one.
    if (surface === null || editable === null || saving || editable.kind === "review") return;
    setSaving(true);
    const result = await runPullRequestWrite(pullRequestEnvironment.updateComment, {
      environmentId: surface.environmentId,
      input: { ...surface.reference, commentId: editable.id, kind: editable.kind, body },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      toast({
        type: "error",
        title: "Could not save the comment",
        ...(failure instanceof PullRequestDryRunError ? { description: failure.message } : {}),
      });
      return;
    }
    setEditing(false);
    surface.onRefresh();
  };
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", flexDirection: "column", paddingTop: 8, paddingBottom: 8 }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: 8, paddingLeft: 8, paddingRight: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <ActorName actor={event.actor} />
            <Text size="xs" color={theme.mutedForeground}>
              {event.title}
            </Text>
            {event.reviewState ? (
              <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontWeight: 500, fontFamily: FONTS.sans }}>
                {friendlyReviewState(event.reviewState)}
              </text>
            ) : null}
          </div>
          <div style={{ marginTop: 4 }}>
            <MetaLine>
              {[
                <Text key="at" size="2xs" color={theme.mutedForeground}>
                  {formatRelativeTimeLabel(event.at)}
                </Text>,
                showPath && event.path ? <PathLabel key="path" path={event.path} /> : null,
              ]}
            </MetaLine>
          </div>
        </div>
        {editable !== null && !editing ? (
          <PrEditButton
            visible={hovered}
            label="Edit comment"
            onClick={() => setEditing(true)}
            testId="pr-timeline-edit"
            style={{ marginTop: -4 }}
          />
        ) : null}
        {surface !== null && (surface.canReact || event.reactions.length > 0) ? (
          <PullRequestReactionBar
            reactions={event.reactions}
            canReact={surface.canReact}
            subjectId={event.id}
            environmentId={surface.environmentId}
            reference={surface.reference}
            onRefresh={surface.onRefresh}
          />
        ) : null}
        <OpenOnHostButton url={event.url} />
      </div>
      {editing && editable !== null && surface !== null ? (
        <div style={{ display: "flex", paddingLeft: 8, paddingRight: 8, paddingBottom: 8, paddingTop: 12 }}>
          <PullRequestMarkdownEditor
            value={editable.body}
            environmentId={surface.environmentId}
            saving={saving}
            onSave={(body) => void save(body)}
            onCancel={() => setEditing(false)}
            testId="pr-timeline-editor"
          />
        </div>
      ) : event.body ? (
        <div style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}>
          <TimelineBody body={event.body} markdown={event.markdown} />
        </div>
      ) : null}
    </div>
  );
}

function uniqueConversationActors(events: ReadonlyArray<PullRequestTimelineEvent>) {
  const actors = new Map<string, PullRequestActor>();
  for (const event of events) {
    const actor = event.actor;
    if (actor !== null && !actors.has(actor.login)) actors.set(actor.login, actor);
  }
  return [...actors.values()];
}

function ConversationGroup({ events }: { events: ReadonlyArray<PullRequestTimelineEvent> }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const actors = uniqueConversationActors(events);
  const first = events[0];
  if (first === undefined) return null;
  return (
    <TimelineRow marker={<ActorMarker actors={actors} fallback="message-square" muted={!open} />} markerTop={8}>
      <div
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingTop: 8,
          paddingBottom: 8,
          cursor: "pointer",
          opacity: open || hovered ? 1 : 0.55,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          <Text size="xs" weight={600} color={open || hovered ? theme.foreground : theme.mutedForeground}>
            {`${events.length.toLocaleString()} ${events.length === 1 ? "comment" : "comments"}`}
          </Text>
          <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontFamily: FONTS.sans, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
            {`${actors.length.toLocaleString()} ${actors.length === 1 ? "author" : "authors"} · ${formatRelativeTimeLabel(first.at)}`}
          </text>
        </div>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
      </div>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {events.map((event) => (
            <ConversationCard key={event.id} event={event} />
          ))}
        </div>
      ) : null}
    </TimelineRow>
  );
}

function ReviewThreadEvent({ event, thread }: { event: PullRequestTimelineEvent; thread: PullRequestTimelineThread }) {
  const theme = useTheme();
  const dismissed = pullRequestReviewOutcome(event.reviewState) === "dismissed";
  const [expanded, setExpanded] = useState(!thread.isResolved && !dismissed);
  const replyCount = thread.replies.length + thread.moreReplies;
  const muted = theme.mutedForeground;
  return (
    <TimelineRow marker={<ActorMarker actors={event.actor ? [event.actor] : []} fallback="message-square" muted={!expanded} />} markerTop={8}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 8, paddingBottom: 8, cursor: "pointer", minWidth: 0 }}
      >
        <Icon name="file-code-2" size={12} color={muted} />
        <text style={{ color: muted, fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
          {thread.line === null ? thread.path : `${thread.path}:${thread.line}`}
        </text>
        {thread.isResolved ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <Icon name="circle-check" size={12} color={theme.successForeground} />
            <Text size="2xs" weight={500} color={theme.successForeground}>
              Resolved
            </Text>
          </div>
        ) : null}
        {dismissed ? (
          <Text size="2xs" weight={500} color={muted}>
            Review dismissed
          </Text>
        ) : null}
        {thread.isOutdated ? (
          <Text size="2xs" weight={500} color={muted}>
            Outdated
          </Text>
        ) : null}
        {expanded ? null : (
          <Text size="2xs" color={muted} style={{ whiteSpace: "nowrap" }}>
            {`· ${event.actor?.login ?? "ghost"}${replyCount > 0 ? ` · ${replyCount.toLocaleString()} ${replyCount === 1 ? "reply" : "replies"}` : ""}`}
          </Text>
        )}
        <div style={{ flexGrow: 1 }} />
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} color={muted} />
      </div>
      {expanded ? (
        <>
          <ConversationCard event={event} showPath={false} />
          {thread.replies.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: 8, paddingLeft: 12, borderLeftWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
              {thread.replies.map((reply) => (
                <ConversationCard key={reply.id} event={reply} showPath={false} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {thread.hasMoreReplies ? (
        <div style={{ paddingLeft: 8, paddingRight: 8 }}>
          <PullRequestMoreReplies {...thread} />
        </div>
      ) : null}
    </TimelineRow>
  );
}

function CommitEvent({ event }: { event: PullRequestTimelineEvent }) {
  const theme = useTheme();
  const surface = useContext(TimelineSurfaceContext);
  const [hovered, setHovered] = useState(false);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ display: "flex", flexDirection: "column" }}>
      <TimelineRow
        marker={<ActorMarker actors={event.commitAuthors} fallback="git-commit-horizontal" />}
        {...(surface ? { onClick: () => surface.onOpenCommit(event.id) } : {})}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 6, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
            <Text size="xs" weight={600} color={hovered ? theme.primary : theme.foreground} truncate>
              {event.body ?? "Untitled commit"}
            </Text>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
              <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontFamily: FONTS.mono }}>{event.id.slice(0, 7)}</text>
              <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontFamily: FONTS.sans }}>{formatRelativeTimeLabel(event.at)}</text>
            </div>
          </div>
          {event.additions !== null && event.deletions !== null ? (
            <PullRequestDiffStat additions={event.additions} deletions={event.deletions} fontSize={10} lineHeight={14} />
          ) : null}
        </div>
      </TimelineRow>
    </div>
  );
}

function LifecycleEvent({ event }: { event: PullRequestTimelineEvent }) {
  const theme = useTheme();
  const presentation =
    event.kind === "opened"
      ? { icon: PullRequestGlyph.pullRequest, label: "Pull request opened" }
      : event.kind === "merged"
        ? { icon: PullRequestGlyph.merged, label: "Pull request merged" }
        : { icon: PullRequestGlyph.closed, label: "Pull request closed" };
  return (
    <TimelineRow marker={<IconMarker icon={presentation.icon} />}>
      <div style={{ display: "flex", flexDirection: "column", paddingTop: 6, paddingBottom: 6 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          {event.actor ? <ActorName actor={event.actor} /> : null}
          <Text size="xs" weight={600}>
            {presentation.label}
          </Text>
        </div>
        <Text size="2xs" color={theme.mutedForeground} style={{ marginTop: 2 }}>
          {formatRelativeTimeLabel(event.at)}
        </Text>
      </div>
    </TimelineRow>
  );
}

function outcomeTone(outcome: PullRequestReviewOutcome, dark: boolean, error: string, muted: string) {
  return outcome === "approved" ? (dark ? alpha(TW.emerald300, 0.9) : TW.emerald600) : outcome === "changes-requested" ? error : alpha(muted, 0.7);
}

function ReviewVerdictEvent({ event, outcome, stale }: { event: PullRequestTimelineEvent; outcome: PullRequestReviewOutcome; stale: boolean }) {
  const theme = useTheme();
  const surface = useContext(TimelineSurfaceContext);
  const label = outcome === "approved" ? "approved" : outcome === "changes-requested" ? "changes requested" : "review dismissed";
  const verdict = (
    <Text size="xs" weight={500} color={stale ? alpha(theme.mutedForeground, 0.7) : outcomeTone(outcome, theme.appearance === "dark", theme.error, theme.mutedForeground)}>
      {label}
    </Text>
  );
  return (
    <TimelineRow
      marker={<ActorMarker actors={event.actor ? [event.actor] : []} fallback={outcome === "approved" ? "circle-check" : outcome === "changes-requested" ? "circle-x" : "circle-dashed"} />}
      markerTop={8}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8, paddingTop: 6, paddingBottom: 6 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <ActorName actor={event.actor} />
            {stale ? (
              <Tooltip content={`${outcome === "approved" ? "Approved" : outcome === "changes-requested" ? "Changes requested" : "Review dismissed"} earlier changes`}>
                <div style={{ display: "flex" }}>{verdict}</div>
              </Tooltip>
            ) : (
              verdict
            )}
          </div>
          <div style={{ marginTop: 2 }}>
            <MetaLine>
              {[
                <Text key="at" size="2xs" color={theme.mutedForeground}>
                  {formatRelativeTimeLabel(event.at)}
                </Text>,
                event.path ? <PathLabel key="path" path={event.path} /> : null,
              ]}
            </MetaLine>
          </div>
        </div>
        {surface !== null && (surface.canReact || event.reactions.length > 0) ? (
          <PullRequestReactionBar
            reactions={event.reactions}
            canReact={surface.canReact}
            subjectId={event.id}
            environmentId={surface.environmentId}
            reference={surface.reference}
            onRefresh={surface.onRefresh}
          />
        ) : null}
        <OpenOnHostButton url={event.url} />
      </div>
      {event.body ? <TimelineBody body={event.body} markdown={event.markdown} /> : null}
    </TimelineRow>
  );
}

function TimelineGhost({ rows = 6 }: { rows?: number }) {
  const theme = useTheme();
  const widths = ["60%", "40%", "50%", "66.6667%", "40%", "60%"];
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingTop: 20, paddingBottom: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", marginLeft: 8, paddingLeft: 20, borderLeftWidth: 1, borderColor: alpha(theme.border, 0.7) }}>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 20 }}>
            <GhostBar width={widths[index % widths.length]!} height={14} />
            <GhostBar width={64} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PullRequestTimelineTab({
  detail,
  environmentId,
  reference,
  order,
  activityPending,
  activityError,
  onRetry,
  onRefresh,
  onOpenCommit,
  onScrollTop,
}: {
  detail: PullRequestDetailView;
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  order: "newest" | "oldest";
  activityPending: boolean;
  activityError: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  onOpenCommit: (oid: string) => void;
  onScrollTop: (top: number) => void;
}) {
  const theme = useTheme();
  if (activityPending) return <TimelineGhost />;
  if (activityError) return <PullRequestActivityUnavailableState error={activityError} onRetry={onRetry} />;
  const events = buildPullRequestTimeline(detail);
  const newestCommitAt = newestPullRequestCommitAt(detail.commits);
  const orderedEvents = order === "newest" ? events : events.toReversed();
  const rows = groupPullRequestTimelineConversations(orderedEvents);
  const surface: TimelineSurface = {
    environmentId,
    reference,
    canReact: detail.capabilities.reactions === true,
    editable: new Map(
      events
        .flatMap((event) => [event, ...(event.thread?.replies ?? [])])
        .flatMap((event) => (event.comment ? [event.comment] : []))
        .filter((comment) => canEditPullRequestComment(detail, comment))
        .map((comment) => [comment.id, comment] as const),
    ),
    onRefresh,
    onOpenCommit,
  };
  return (
    <TimelineSurfaceContext.Provider value={surface}>
    <div
      testId="pr-timeline-scroll"
      onScrollChange={(event) => onScrollTop(Math.abs(event.scrollY ?? 0))}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar, paddingLeft: 22, paddingRight: 22, paddingTop: 20, paddingBottom: 20 }}
    >
      <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", maxWidth: 768, flexShrink: 0 }}>
        <div style={{ position: "absolute", left: 15, top: 4, bottom: 20, width: 1, backgroundColor: alpha(theme.border, 0.45) }} />
        {rows.map((row) => {
          if (row.kind === "comments") {
            return <ConversationGroup key={`comments:${row.events[0]?.id ?? "empty"}`} events={row.events} />;
          }
          const event = row.event;
          if (event.thread !== undefined) {
            return <ReviewThreadEvent key={`thread:${event.id}`} event={event} thread={event.thread} />;
          }
          if (event.kind === "commit") {
            return <CommitEvent key={event.id} event={event} />;
          }
          const outcome = pullRequestReviewOutcome(event.reviewState);
          if (outcome !== null) {
            return (
              <ReviewVerdictEvent
                key={event.id}
                event={event}
                outcome={outcome}
                stale={isPullRequestVerdictStale(event.at, newestCommitAt)}
              />
            );
          }
          return <LifecycleEvent key={event.id} event={event} />;
        })}
        {events.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 64, paddingBottom: 64 }}>
            <Icon name={PullRequestGlyph.pullRequest} size={20} color={theme.mutedForeground} />
            <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 8 }}>
              No activity yet.
            </Text>
          </div>
        ) : null}
      </div>
    </div>
    </TimelineSurfaceContext.Provider>
  );
}
