// Port of apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx (and PullRequestMarkdown /
// PullRequestCommentBody for the bodies): reviewers and labels with their pickers, the editable
// description, checks with "Fix", and the conversation with editing, reactions and "Fix in a
// thread". gpuix has no sticky positioning, so the heading of the section crossing the top edge
// is painted again over the scroller (web: `sticky top-0` headings), pushed up by the next one.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestComment,
  PullRequestRef,
  PullRequestReviewThread,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useContext, useRef, useState, type ReactNode } from "react";
import { splitPullRequestBody } from "@t3tools/client-runtime/pull-request-markdown";

import { pullRequestEnvironment, pullRequestStorage } from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem, MenuLabel, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast } from "../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../ui/theme.ts";
import { openExternalUrl } from "../usage/openExternal.ts";
import {
  filterPullRequestConversationItems,
  isPullRequestCommentFinished,
  latestPullRequestReviewOutcomes,
  orderPullRequestComments,
  pagePullRequestConversationItems,
  pullRequestConversationItemComments,
  pullRequestConversationItems,
  pullRequestFindingKey,
  pullRequestReviewOutcome,
  visibleBody,
  type PullRequestConversationItem,
  type PullRequestFinding,
  type PullRequestReviewOutcome,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import {
  canEditPullRequestChangeRequest,
  canEditPullRequestComment,
} from "../web/components/pullRequest/pullRequestEditing.logic.ts";
import type { PullRequestDetailView } from "./PullRequestDetailPanel.tsx";
import { GhostBar } from "./PullRequestListStates.tsx";
import { PrButton, PrEditButton } from "./prControls.tsx";
import { PullRequestMarkdownEditor } from "./PullRequestMarkdownEditor.tsx";
import { PullRequestLabelPicker, PullRequestReviewerPicker } from "./PullRequestPickers.tsx";
import { PullRequestReactionBar } from "./PullRequestReactions.tsx";
import { PullRequestActivityUnavailableState } from "./PullRequestUnavailableStates.tsx";
import {
  PullRequestActorAvatar,
  PullRequestLabelChip,
  TW,
  checkStatusPresentation,
  formatRelativeTimeLabel,
  pullRequestCheckStatusLabel,
} from "./pullRequestPresentation.tsx";
import { PullRequestDryRunError, runPullRequestWrite } from "./pullRequestWrites.ts";
import { openPullRequestLink } from "./openPullRequestLink.ts";
import { autolinkPullRequestMarkdown } from "./pullRequestMarkdownAutolinks.ts";
import { PullRequestMarkdownContext } from "./pullRequestMarkdownContext.ts";
import { sectionCollapseAnchorScrollTop } from "../web/components/pullRequest/pullRequestSummaryScroll.logic.ts";

const COMMENT_PAGE = 10;
const COMMENT_FILTER_STORAGE_KEY = "t3code:pull-request-comment-filter:v1";
const DEFAULT_COMMENT_FILTER = { bots: false, resolved: false };

function readCommentFilter(): { bots: boolean; resolved: boolean } {
  try {
    const raw = pullRequestStorage.getItem(COMMENT_FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_COMMENT_FILTER;
    const parsed = JSON.parse(raw) as { bots?: unknown; resolved?: unknown };
    return typeof parsed.bots === "boolean" && typeof parsed.resolved === "boolean"
      ? { bots: parsed.bots, resolved: parsed.resolved }
      : DEFAULT_COMMENT_FILTER;
  } catch {
    return DEFAULT_COMMENT_FILTER;
  }
}

/**
 * web PullRequestMarkdown: the body split into prose and attachments (splitPullRequestBody),
 * repository autolinks for `#123` and commit SHAs, and links that open pull requests inside
 * t3-term (a thread's panel, or the Pull requests page) before falling back to the browser.
 *
 * Not ported: web plays videos inline (MediaVideoPlayer, with GitHub's authenticated media);
 * gpuix has no video element, so a video line is an "Open video on GitHub" row like web's
 * attachment fallback. Native <markdown> reports link clicks only, so its links have no hover
 * preview or right-click menu.
 */
export function PrMarkdown({ source, size = 14 }: { source: string; size?: number }) {
  const segments = splitPullRequestBody(source.replace(/<!--[\s\S]*?-->/gu, ""));
  if (segments.length <= 1 && segments[0]?.kind !== "attachment") {
    return <PrMarkdownText source={segments[0]?.kind === "markdown" ? segments[0].text : ""} size={size} />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, flexGrow: 1 }}>
      {segments.map((segment) =>
        segment.kind === "markdown" || segment.media === "image" ? (
          <PrMarkdownText
            key={segment.id}
            source={segment.kind === "markdown" ? segment.text : `![](<${segment.url}>)`}
            size={size}
          />
        ) : (
          <PrAttachmentRow key={segment.id} url={segment.url} video={segment.media === "video"} />
        ),
      )}
    </div>
  );
}

function PrAttachmentRow({ url, video }: { url: string; video: boolean }) {
  const theme = useTheme();
  return (
    <div
      testId="pr-markdown-attachment"
      onClick={() => openExternalUrl(url)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        backgroundColor: alpha(theme.muted, 0.3),
        cursor: "pointer",
        hover: { backgroundColor: alpha(theme.muted, 0.6) },
      }}
    >
      <Icon name={video ? "video" : "paperclip"} size={14} color={theme.mutedForeground} />
      <Text truncate style={{ flexGrow: 1 }}>
        {video ? "Open video on GitHub" : "Open attachment on GitHub"}
      </Text>
      <Icon name="external-link" size={12} color={theme.mutedForeground} />
    </div>
  );
}

/** Markdown as web's ChatMarkdown sets it: 14px, 1.625 line height, foreground at 80%. */
function PrMarkdownText({ source, size }: { source: string; size: number }) {
  const theme = useTheme();
  const context = useContext(PullRequestMarkdownContext);
  return (
    <markdown
      source={autolinkPullRequestMarkdown(source, context?.repositoryUrl ?? null)}
      onLinkClick={(event) => {
        if (!event.value) return;
        openPullRequestLink(event.value, {
          threadRef: context?.threadRef ?? null,
          environmentId: context?.environmentId ?? null,
          modifiers: event.modifiers,
        });
      }}
      style={{ minWidth: 0, flexGrow: 1 }}
      theme={{
        appearance: theme.appearance,
        text: alpha(theme.foreground, 0.8),
        bg: theme.background,
        accent: theme.infoForeground,
        fontSans: FONTS.sans,
        fontMono: FONTS.mono,
        metrics: {
          mdTextSize: size,
          mdLineHeight: Math.round(size * 1.625),
          mdBlockGap: 12,
          mdHeadingSizes: [20, 18, 16, 14],
        },
      }}
    />
  );
}

function outcomeTone(outcome: PullRequestReviewOutcome, theme: Palette): string {
  switch (outcome) {
    case "approved":
      return theme.appearance === "dark" ? "#00d492" : TW.emerald600;
    case "changes-requested":
      return theme.error;
    case "dismissed":
      return alpha(theme.mutedForeground, 0.6);
  }
}

function outcomeLabel(outcome: PullRequestReviewOutcome): string {
  return outcome === "approved" ? "Approved" : outcome === "changes-requested" ? "Changes requested" : "Review dismissed";
}

function MetaRow({ icon, label, children }: { icon: "users" | "tag"; label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: 96, flexShrink: 0 }}>
        <Icon name={icon} size={14} color={theme.mutedForeground} />
        <Text size="xs" color={theme.mutedForeground}>
          {label}
        </Text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, minWidth: 0, flexGrow: 1 }}>
        {children}
      </div>
    </div>
  );
}

const SECTION_KEYS = ["description", "checks", "comments"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
const SECTION_DEFAULT_OPEN: Record<SectionKey, boolean> = { description: true, checks: false, comments: true };

/** py-3 around a 16px xs line. */
const SECTION_HEADING_HEIGHT = 40;

function SectionHeading({
  title,
  open,
  onToggle,
  actions,
  testId,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: SECTION_HEADING_HEIGHT, flexShrink: 0, paddingRight: 16, backgroundColor: theme.background }}>
      <div
        testId={testId}
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          flexGrow: 1,
          minWidth: 0,
          height: "100%",
          paddingLeft: 16,
          paddingRight: 16,
          cursor: "pointer",
        }}
      >
        <Text size="xs" weight={500} color={hovered ? theme.foreground : theme.mutedForeground}>
          {title}
        </Text>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={alpha(theme.mutedForeground, 0.6)} />
      </div>
      {actions}
    </div>
  );
}

interface SectionProps {
  readonly title: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly actions?: ReactNode;
  readonly testId?: string;
}

function Section({
  heading,
  onHeight,
  children,
}: {
  heading: SectionProps;
  /** The section's height, for placing the pinned heading. */
  onHeight: (height: number) => void;
  children: ReactNode;
}) {
  return (
    <div
      onLayout={(event) => onHeight(Number(event.height ?? 0))}
      style={{ display: "flex", flexDirection: "column", width: "100%", flexShrink: 0 }}
    >
      <SectionHeading {...heading} />
      {heading.open ? <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}>{children}</div> : null}
    </div>
  );
}

function SmallGhostButton({
  icon,
  children,
  onClick,
}: {
  icon: "list-filter" | "arrow-down-up";
  children: string;
  onClick?: () => void;
}) {
  const theme = useTheme();
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 24,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        cursor: "pointer",
        hover: { backgroundColor: theme.accent },
      }}
    >
      <Icon name={icon} size={12} color={theme.mutedForeground} />
      <Text size="xs" weight={500} color={theme.mutedForeground}>
        {children}
      </Text>
    </div>
  );
}

function CommentIdentity({ comment }: { comment: PullRequestComment }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        <PullRequestActorAvatar actor={comment.author} />
        <Text size="xs" weight={500} truncate>
          {comment.author?.login ?? "ghost"}
        </Text>
      </div>
      <Tooltip content={`${new Date(comment.createdAt).toLocaleString()}${comment.url ? " · Open comment on host" : ""}`}>
        <div
          onClick={comment.url ? () => openExternalUrl(comment.url!) : undefined}
          style={{ display: "flex", cursor: comment.url ? "pointer" : "default", flexShrink: 0 }}
        >
          <Text size="xs" color={theme.mutedForeground}>
            {formatRelativeTimeLabel(comment.createdAt)}
          </Text>
        </div>
      </Tooltip>
    </div>
  );
}

function CommentLocation({ comment, thread }: { comment: PullRequestComment; thread: PullRequestReviewThread | undefined }) {
  const theme = useTheme();
  const path = thread?.path ?? comment.path;
  if (!path) return null;
  const label = `${path}${thread?.line ? `:${thread.line}` : ""}`;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, minWidth: 0 }}>
      <text
        style={{
          color: theme.mutedForeground,
          fontSize: 12,
          lineHeight: 16,
          fontFamily: FONTS.mono,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {label}
      </text>
      {thread?.isOutdated ? (
        <Text size="xs" color={theme.mutedForeground}>
          Outdated
        </Text>
      ) : null}
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: PullRequestReviewOutcome }) {
  const theme = useTheme();
  const tone = outcomeTone(outcome, theme);
  const icon = outcome === "approved" ? "circle-check" : outcome === "changes-requested" ? "circle-x" : "circle-dashed";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 16,
        paddingLeft: 3,
        paddingRight: 3,
        borderRadius: 4,
        flexShrink: 0,
        backgroundColor: outcome === "dismissed" ? "#00000000" : alpha(outcome === "approved" ? theme.success : theme.error, 0.16),
        ...(outcome === "dismissed" ? { borderWidth: 1, borderColor: theme.input } : {}),
      }}
    >
      <Icon name={icon} size={12} color={outcome === "approved" ? theme.successForeground : outcome === "changes-requested" ? theme.errorForeground : tone} />
      <text style={{ color: outcome === "approved" ? theme.successForeground : outcome === "changes-requested" ? theme.errorForeground : theme.foreground, fontSize: 10, lineHeight: 12, fontWeight: 500, fontFamily: FONTS.sans }}>
        {outcomeLabel(outcome)}
      </text>
    </div>
  );
}

function reviewStateLabel(state: string): string {
  const words = state.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a remark needs to be edited in place (web: CommentEditing). */
interface CommentEditing {
  readonly environmentId: EnvironmentId;
  readonly canEdit: (comment: PullRequestComment) => boolean;
  readonly editingId: string | null;
  readonly saving: boolean;
  readonly onEdit: (comment: PullRequestComment | null) => void;
  readonly onSave: (comment: PullRequestComment, body: string) => void;
}

/** The remark's body, or its editor, with the hover-revealed pencil beside it. */
function CommentBody({
  comment,
  body,
  editing,
  hovered,
}: {
  comment: PullRequestComment;
  body: string | null;
  editing: CommentEditing;
  hovered: boolean;
}) {
  if (editing.editingId === comment.id) {
    return (
      <PullRequestMarkdownEditor
        value={comment.body}
        environmentId={editing.environmentId}
        saving={editing.saving}
        onSave={(next) => editing.onSave(comment, next)}
        onCancel={() => editing.onEdit(null)}
        testId="pr-comment-editor"
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 4, minWidth: 0 }}>
      {body === null ? <div style={{ flexGrow: 1 }} /> : <PrMarkdown source={body} />}
      {editing.canEdit(comment) ? (
        <PrEditButton visible={hovered} label="Edit comment" onClick={() => editing.onEdit(comment)} testId="pr-edit-comment" />
      ) : null}
    </div>
  );
}

function CommentCard({
  comment,
  thread,
  reply = false,
  editing,
  reactionBar,
  fixButton,
}: {
  comment: PullRequestComment;
  thread: PullRequestReviewThread | undefined;
  reply?: boolean;
  editing: CommentEditing;
  reactionBar: ReactNode;
  fixButton: ReactNode;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const body = visibleBody(comment.body);
  const outcome = pullRequestReviewOutcome(comment.reviewState);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        backgroundColor: theme.background,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 10,
          paddingBottom: 10,
          borderTopLeftRadius: RADIUS.lg,
          borderTopRightRadius: RADIUS.lg,
          backgroundColor: alpha(theme.appearance === "dark" ? "#ffffff" : theme.muted, 0.025),
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, flexGrow: 1, minWidth: 0 }}>
          <CommentIdentity comment={comment} />
          {outcome ? (
            <OutcomeBadge outcome={outcome} />
          ) : comment.reviewState ? (
            <Text size="xs" color={theme.mutedForeground}>
              {reviewStateLabel(comment.reviewState)}
            </Text>
          ) : null}
        </div>
        {fixButton}
        {reactionBar}
      </div>
      {reply ? null : (
        <div style={{ paddingLeft: 12, paddingRight: 12 }}>
          <CommentLocation comment={comment} thread={thread} />
        </div>
      )}
      {body === null && !editing.canEdit(comment) ? null : (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12 }}>
          <CommentBody comment={comment} body={body} editing={editing} hovered={hovered} />
        </div>
      )}
    </div>
  );
}

function collapsedPreview(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/^\s*>?\s*\[!\w+\]\s*$/gmu, "")
    .replace(/!?(\[([^\]]+)\])\([^)]*\)/gu, "$2")
    .replace(/^[\s>#*-]+/gmu, "")
    .replace(/[*`]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function CollapsedComment({
  comment,
  thread,
  label,
  replyCount,
  replies,
  moreReplies,
  editing,
  reactionBar,
}: {
  comment: PullRequestComment;
  thread: PullRequestReviewThread | undefined;
  label: string;
  replyCount: number;
  replies: ReactNode;
  moreReplies: ReactNode;
  editing: CommentEditing;
  reactionBar: ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const body = visibleBody(comment.body);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: 12 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <CommentIdentity comment={comment} />
          <div style={{ flexGrow: 1 }} />
          {replyCount > 0 ? (
            <Text size="xs" color={theme.mutedForeground}>
              {`${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
            </Text>
          ) : null}
          <div
            onClick={() => setOpen(!open)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 4,
              paddingBottom: 4,
              borderRadius: RADIUS.md,
              cursor: "pointer",
              hover: { backgroundColor: theme.muted },
            }}
          >
            <Text size="xs" color={theme.mutedForeground}>
              {label}
            </Text>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
          </div>
          {reactionBar}
        </div>
        <CommentLocation comment={comment} thread={thread} />
        {!open && body ? (
          <div onClick={() => setOpen(true)} style={{ display: "flex", marginTop: 8, cursor: "pointer", minWidth: 0 }}>
            <Text size="xs" color={theme.mutedForeground} truncate>
              {collapsedPreview(body)}
            </Text>
          </div>
        ) : null}
      </div>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 12, paddingRight: 12, paddingBottom: 12, gap: 12 }}>
          {body === null && !editing.canEdit(comment) ? null : (
            <CommentBody comment={comment} body={body} editing={editing} hovered={hovered} />
          )}
          {replies}
        </div>
      ) : null}
      {moreReplies ? <div style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 12 }}>{moreReplies}</div> : null}
    </div>
  );
}

/** apps/web/src/components/pullRequest/PullRequestMoreReplies.tsx */
export function PullRequestMoreReplies({
  moreReplies,
  hasMoreReplies,
  url,
}: {
  moreReplies: number;
  hasMoreReplies: boolean;
  url: string | null;
}) {
  const theme = useTheme();
  if (!hasMoreReplies) return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 4, paddingBottom: 4 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {moreReplies > 0
          ? `${moreReplies.toLocaleString()} more ${moreReplies === 1 ? "reply" : "replies"}`
          : "More replies"}
      </Text>
      {url ? (
        <div onClick={() => openExternalUrl(url)} style={{ display: "flex", cursor: "pointer" }}>
          <Text size="xs" color={theme.mutedForeground}>
            View on host
          </Text>
        </div>
      ) : null}
    </div>
  );
}

function ConversationItem({
  item,
  editing,
  reactionBarFor,
  fixButtonFor,
}: {
  item: PullRequestConversationItem;
  editing: CommentEditing;
  reactionBarFor: (comment: PullRequestComment) => ReactNode;
  fixButtonFor: (comment: PullRequestComment, thread: PullRequestReviewThread | undefined, reply: boolean) => ReactNode;
}) {
  const theme = useTheme();
  const comment = item.kind === "comment" ? item.comment : item.root;
  const thread = item.kind === "thread" ? item.thread : undefined;
  const card = (target: PullRequestComment, targetThread: PullRequestReviewThread | undefined, reply: boolean) => (
    <CommentCard
      key={target.id}
      comment={target}
      thread={targetThread}
      reply={reply}
      editing={editing}
      reactionBar={reactionBarFor(target)}
      fixButton={fixButtonFor(target, targetThread, reply)}
    />
  );
  const replies =
    item.kind === "thread" && item.replies.length > 0 ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginLeft: 16, paddingLeft: 12, borderLeftWidth: 2, borderColor: alpha(theme.border, 0.6) }}>
        {item.replies.map((reply) => card(reply, undefined, true))}
      </div>
    ) : null;
  const moreReplies = item.kind === "thread" && item.hasMoreReplies ? <PullRequestMoreReplies {...item} /> : null;
  if (isPullRequestCommentFinished(comment, thread)) {
    return (
      <CollapsedComment
        comment={comment}
        thread={thread}
        label={thread?.isResolved ? "Resolved" : "Review dismissed"}
        replyCount={item.kind === "thread" ? item.replies.length + item.moreReplies : 0}
        replies={replies}
        moreReplies={moreReplies}
        editing={editing}
        reactionBar={reactionBarFor(comment)}
      />
    );
  }
  if (item.kind === "comment") return card(comment, undefined, false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
      {card(comment, thread, false)}
      {replies}
      {moreReplies}
    </div>
  );
}

function ConversationGhost({ rows = 3 }: { rows?: number }) {
  const widths = ["40%", "33.3333%", "40%"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8, paddingBottom: 8 }}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <GhostBar width={20} height={20} radius={10} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1 }}>
            <GhostBar width={widths[index % widths.length]!} />
            <GhostBar width="100%" />
            <GhostBar width="75%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PullRequestSummaryTab({
  environmentId,
  reference,
  detail,
  activityPending,
  checksStale = false,
  activityError,
  pendingFinding = null,
  fixFindingLabel = "Fix in a thread",
  fixCheckLabel = "Fix",
  onFixFinding,
  onRefresh,
  onRefreshChecks = onRefresh,
  onScrollTop,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  activityPending: boolean;
  checksStale?: boolean;
  activityError: string | null;
  pendingFinding?: string | null;
  fixFindingLabel?: string;
  fixCheckLabel?: string;
  onFixFinding?: (finding: PullRequestFinding) => void;
  onRefresh: () => void;
  onRefreshChecks?: () => void;
  onScrollTop: (top: number) => void;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  // ── Pinned section headings ──
  // Content offsets come from measured heights (layout reports carry size changes only), and
  // the heading over the top edge is drawn again above the scroller.
  const scrollerRef = useRef<PublicInstance | null>(null);
  const scrollTopRef = useRef(0);
  const metaHeightRef = useRef(0);
  const sectionHeightsRef = useRef(new Map<SectionKey, number>());
  const [pinned, setPinned] = useState<{ readonly key: SectionKey; readonly top: number } | null>(null);
  const [openSections, setOpenSections] = useState<Readonly<Record<string, boolean>>>({});
  // Keyed by pull request: another one opens with web's defaults.
  const isOpen = (key: SectionKey) => openSections[`${detail.url}:${key}`] ?? SECTION_DEFAULT_OPEN[key];
  const sectionTop = (key: SectionKey) => {
    let top = metaHeightRef.current;
    for (const candidate of SECTION_KEYS) {
      if (candidate === key) return top;
      top += sectionHeightsRef.current.get(candidate) ?? 0;
    }
    return top;
  };
  const updatePinned = () => {
    const scrollTop = scrollTopRef.current;
    let next: { key: SectionKey; top: number } | null = null;
    for (const key of SECTION_KEYS) {
      const top = sectionTop(key);
      const height = sectionHeightsRef.current.get(key) ?? 0;
      if (scrollTop > top + 0.5 && scrollTop < top + height) {
        // CSS sticky: the heading stays inside its section, so the section's end pushes it up.
        next = { key, top: Math.min(0, top + height - SECTION_HEADING_HEIGHT - scrollTop) };
        break;
      }
    }
    setPinned((current) =>
      current === null && next === null
        ? current
        : current !== null && next !== null && current.key === next.key && current.top === next.top
          ? current
          : next,
    );
  };
  const toggleSection = (key: SectionKey) => {
    const open = isOpen(key);
    if (open) {
      // web setOpenWithScrollAnchor: collapsing a section whose heading is pinned keeps that
      // heading where it was pressed instead of jumping to whatever slides under it.
      const scrollTop = scrollTopRef.current;
      const top = sectionTop(key);
      const target = sectionCollapseAnchorScrollTop({
        scrollTop,
        viewportTop: 0,
        sectionTop: top - scrollTop,
        headingTop: pinned?.key === key ? pinned.top : top - scrollTop,
      });
      const scroller = scrollerRef.current;
      if (target !== null && scroller) {
        renderer.scrollTo?.(scroller.id, 0, -target);
        scrollTopRef.current = target;
      }
    }
    setOpenSections((current) => ({ ...current, [`${detail.url}:${key}`]: !open }));
  };
  const measureSection = (key: SectionKey) => (height: number) => {
    if (sectionHeightsRef.current.get(key) === height) return;
    sectionHeightsRef.current.set(key, height);
    updatePinned();
  };
  const [shown, setShown] = useState({ url: detail.url, count: COMMENT_PAGE });
  const shownConversations = shown.url === detail.url ? shown.count : COMMENT_PAGE;
  const [commentFilter, setCommentFilterState] = useState(readCommentFilter);
  const setCommentFilter = (next: { bots: boolean; resolved: boolean }) => {
    setCommentFilterState(next);
    pullRequestStorage.setItem(COMMENT_FILTER_STORAGE_KEY, JSON.stringify(next));
  };
  const items = pullRequestConversationItems(detail.comments, detail.reviewThreads);
  const filteredItems = filterPullRequestConversationItems(items, commentFilter);
  const commentCount = items.reduce((count, item) => count + pullRequestConversationItemComments(item).length, 0);
  const filteredOutCount =
    commentCount - filteredItems.reduce((count, item) => count + pullRequestConversationItemComments(item).length, 0);
  const { shown: recentItems, hidden: hiddenConversationCount } = pagePullRequestConversationItems(
    filteredItems,
    shownConversations,
  );
  const [commentOrder, setCommentOrder] = useState<"newest" | "oldest">("newest");
  const visibleItems = orderPullRequestComments(recentItems, commentOrder);
  const showOldest =
    hiddenConversationCount > 0 ? (
      <div
        onClick={() => setShown({ url: detail.url, count: shownConversations + COMMENT_PAGE })}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 28,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: theme.input,
          backgroundColor: alpha(theme.input, 0.32),
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <Text weight={500}>
          {`Show ${Math.min(hiddenConversationCount, COMMENT_PAGE)} older conversation${hiddenConversationCount === 1 ? "" : "s"} (${hiddenConversationCount} hidden)`}
        </Text>
      </div>
    ) : null;
  // Read from the whole conversation, not the window shown: a verdict older than the visible
  // comments still stands.
  const reviewOutcomes = latestPullRequestReviewOutcomes(detail.comments, detail.commits);
  const outcomeByLogin = new Map(
    reviewOutcomes.flatMap((entry) => (entry.actor ? [[entry.actor.login.toLowerCase(), entry] as const] : [])),
  );
  const reviewerEntries = [
    ...detail.reviewers.map((actor) => ({
      key: actor.login,
      actor,
      outcome: outcomeByLogin.get(actor.login.toLowerCase())?.outcome ?? null,
      stale: outcomeByLogin.get(actor.login.toLowerCase())?.stale ?? false,
    })),
    ...reviewOutcomes
      .filter(
        (entry) =>
          !detail.reviewers.some(
            (actor) => entry.actor !== null && actor.login.toLowerCase() === entry.actor.login.toLowerCase(),
          ),
      )
      .map((entry) => ({ key: entry.key, actor: entry.actor, outcome: entry.outcome, stale: entry.stale })),
  ];

  // ── Editing ──
  const [bodyScope, setBodyScope] = useState<string | null>(null);
  const [bodySaving, setBodySaving] = useState(false);
  const [descriptionHovered, setDescriptionHovered] = useState(false);
  // The remark being rewritten, named with its pull request: a host's comment id is only unique
  // within it, and a like-numbered remark elsewhere must not open in an editor.
  const [commentScope, setCommentScope] = useState<{ readonly pullRequest: string; readonly commentId: string } | null>(
    null,
  );
  const [commentSaving, setCommentSaving] = useState(false);
  const editingCommentId = commentScope?.pullRequest === detail.url ? commentScope.commentId : null;
  const saveBody = async (body: string) => {
    if (bodySaving) return;
    setBodySaving(true);
    const result = await runPullRequestWrite(pullRequestEnvironment.update, { environmentId, input: { ...reference, body } });
    setBodySaving(false);
    if (result._tag === "Failure") {
      toast({ type: "error", title: "Could not save the description", ...dryRunDescription(result) });
      return;
    }
    setBodyScope(null);
    onRefresh();
  };
  const commentEditing: CommentEditing = {
    environmentId,
    canEdit: (comment) => canEditPullRequestComment(detail, comment),
    editingId: editingCommentId,
    saving: commentSaving,
    onEdit: (comment) => setCommentScope(comment === null ? null : { pullRequest: detail.url, commentId: comment.id }),
    onSave: async (comment, body) => {
      if (commentSaving || comment.kind === "review") return;
      setCommentSaving(true);
      const result = await runPullRequestWrite(pullRequestEnvironment.updateComment, {
        environmentId,
        input: { ...reference, commentId: comment.id, kind: comment.kind, body },
      });
      setCommentSaving(false);
      if (result._tag === "Failure") {
        toast({ type: "error", title: "Could not save the comment", ...dryRunDescription(result) });
        return;
      }
      setCommentScope(null);
      onRefresh();
    },
  };
  const reactionBarFor = (comment: PullRequestComment) => (
    <PullRequestReactionBar
      reactions={comment.reactions ?? []}
      canReact={detail.capabilities.reactions === true}
      subjectId={comment.id}
      environmentId={environmentId}
      reference={reference}
      onRefresh={onRefresh}
      justifyEnd
    />
  );
  const fixButtonFor = (comment: PullRequestComment, thread: PullRequestReviewThread | undefined, reply: boolean) => {
    if (!onFixFinding) return null;
    const outcome = pullRequestReviewOutcome(comment.reviewState);
    const finding: PullRequestFinding | null =
      reply || (comment.kind !== "review" && comment.kind !== "review-comment") || outcome === "approved"
        ? null
        : thread === undefined
          ? visibleBody(comment.body) === null
            ? null
            : { kind: "comment", comment }
          : { kind: "thread", thread };
    if (finding === null) return null;
    return (
      <PrButton
        variant="ghost"
        icon="hammer"
        disabled={pendingFinding !== null}
        onClick={() => onFixFinding(finding)}
        testId="pr-fix-finding"
      >
        {pendingFinding === pullRequestFindingKey(finding) ? "Preparing..." : fixFindingLabel}
      </PrButton>
    );
  };

  const sectionHeadings: Record<SectionKey, SectionProps> = {
    description: { title: "Description", open: isOpen("description"), onToggle: () => toggleSection("description"), testId: "pr-section-description" },
    checks: { title: "Checks", open: isOpen("checks"), onToggle: () => toggleSection("checks"), testId: "pr-section-checks" },
    comments: {
      title: `Comments (${detail.commentCount})`,
      open: isOpen("comments"),
      onToggle: () => toggleSection("comments"),
      testId: "pr-section-comments",
      actions: (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <Menu
            align="end"
            trigger={({ toggle }) => (
              <SmallGhostButton icon="list-filter" onClick={toggle}>
                {filteredOutCount > 0 ? `${filteredOutCount} hidden` : "Filter"}
              </SmallGhostButton>
            )}
          >
            <MenuLabel>Show</MenuLabel>
            <MenuItem keepOpen checked={commentFilter.bots} onSelect={() => setCommentFilter({ ...commentFilter, bots: !commentFilter.bots })}>
              Bot comments
            </MenuItem>
            <MenuItem
              keepOpen
              checked={commentFilter.resolved}
              onSelect={() => setCommentFilter({ ...commentFilter, resolved: !commentFilter.resolved })}
            >
              Resolved or dismissed
            </MenuItem>
          </Menu>
          <SmallGhostButton icon="arrow-down-up" onClick={() => setCommentOrder(commentOrder === "newest" ? "oldest" : "newest")}>
            {commentOrder === "newest" ? "Newest first" : "Oldest first"}
          </SmallGhostButton>
        </div>
      ),
    },
  };
  const pinnedHeading = pinned === null ? null : sectionHeadings[pinned.key];

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
    <div
      ref={scrollerRef}
      testId="pr-summary-scroll"
      onScrollChange={(event) => {
        const top = Math.abs(event.scrollY ?? 0);
        scrollTopRef.current = top;
        updatePinned();
        onScrollTop(top);
      }}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar }}
    >
      <div
        onLayout={(event) => {
          metaHeightRef.current = Number(event.height ?? 0);
          updatePinned();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 4, flexShrink: 0 }}
      >
        <MetaRow icon="users" label="Reviewers">
          {reviewerEntries.length === 0 ? (
            <Text size="xs" color={theme.mutedForeground}>
              None
            </Text>
          ) : (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
              {reviewerEntries.map((entry, index) => {
                const login = entry.actor?.login ?? "ghost";
                const named = entry.actor?.name && entry.actor.name !== login ? `${entry.actor.name} (@${login})` : login;
                const verdict = entry.outcome
                  ? entry.stale
                    ? `${outcomeLabel(entry.outcome)} earlier changes`
                    : outcomeLabel(entry.outcome)
                  : null;
                const ring = entry.outcome
                  ? entry.stale
                    ? alpha(outcomeTone(entry.outcome, theme), 0.35)
                    : outcomeTone(entry.outcome, theme)
                  : theme.background;
                return (
                  <Tooltip key={entry.key} content={verdict ? `${named}: ${verdict}` : named}>
                    <div
                      style={{
                        display: "flex",
                        borderRadius: 10,
                        borderWidth: 2,
                        borderColor: ring,
                        marginLeft: index === 0 ? 0 : -4,
                        flexShrink: 0,
                      }}
                    >
                      <PullRequestActorAvatar actor={entry.actor} />
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          )}
          {/* Azure DevOps takes a reviewer but will not say who could be one: nothing to open. */}
          {detail.capabilities.reviewers.request && detail.capabilities.reviewers.listCandidates ? (
            <PullRequestReviewerPicker
              environmentId={environmentId}
              reference={reference}
              allowed={detail.viewerPermissions.requestReviewers}
            />
          ) : null}
        </MetaRow>
        {detail.labels.length > 0 || detail.capabilities.labels === true ? (
          <MetaRow icon="tag" label="Labels">
            {detail.labels.length === 0 ? (
              <Text size="xs" color={theme.mutedForeground}>
                None
              </Text>
            ) : (
              detail.labels.map((label) => <PullRequestLabelChip key={label.name} label={label} size="default" maxWidth={192} />)
            )}
            {detail.capabilities.labels === true ? (
              <PullRequestLabelPicker
                environmentId={environmentId}
                reference={reference}
                allowed={detail.viewerPermissions.labels !== false}
              />
            ) : null}
          </MetaRow>
        ) : null}
      </div>

      <Section heading={sectionHeadings.description} onHeight={measureSection("description")}>
        {bodyScope === detail.url ? (
          <PullRequestMarkdownEditor
            allowEmpty
            value={detail.body}
            environmentId={environmentId}
            placeholder="Describe this pull request"
            saving={bodySaving}
            onSave={(body) => void saveBody(body)}
            onCancel={() => setBodyScope(null)}
            testId="pr-description-editor"
          />
        ) : (
          <div
            onMouseEnter={() => setDescriptionHovered(true)}
            onMouseLeave={() => setDescriptionHovered(false)}
            style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 4 }}
          >
            <PrMarkdown source={detail.body.trim().length > 0 ? detail.body : "_No description provided._"} />
            {canEditPullRequestChangeRequest(detail) ? (
              <PrEditButton
                visible={descriptionHovered}
                label="Edit description"
                onClick={() => setBodyScope(detail.url)}
                testId="pr-edit-description"
              />
            ) : null}
          </div>
        )}
      </Section>

      <Section heading={sectionHeadings.checks} onHeight={measureSection("checks")}>
        {checksStale ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text size="xs" color={theme.mutedForeground}>
              Check details are out of date.
            </Text>
            <PrButton variant="ghost" onClick={onRefreshChecks} testId="pr-checks-refresh">
              Refresh
            </PrButton>
          </div>
        ) : detail.checks.length === 0 ? (
          <Text size="xs" color={theme.mutedForeground}>
            No checks reported.
          </Text>
        ) : (
          detail.checks.map((check, index) => {
            const presentation = checkStatusPresentation(check.status, theme);
            const finding = { kind: "check", check } as const;
            const failing = check.status === "failure" || check.status === "cancelled";
            return (
              <div
                key={`${index}:${check.name}:${check.url ?? ""}`}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingRight: 4,
                  borderRadius: RADIUS.md,
                  flexShrink: 0,
                  hover: { backgroundColor: alpha(theme.accent, 0.6) },
                }}
              >
                <div
                  onClick={check.url ? () => openExternalUrl(check.url!) : undefined}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 8,
                    flexGrow: 1,
                    minWidth: 0,
                    paddingLeft: 8,
                    paddingRight: 8,
                    paddingTop: 8,
                    paddingBottom: 8,
                    cursor: check.url ? "pointer" : "default",
                  }}
                >
                  <div style={{ display: "flex", marginTop: 3 }}>
                    <Icon name={presentation.icon} size={14} color={presentation.tone} />
                  </div>
                  <Text size="xs" style={{ flexGrow: 1, minWidth: 0, lineHeight: 20 }}>
                    {check.name}
                  </Text>
                  <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 20, flexShrink: 0 }}>
                    {pullRequestCheckStatusLabel(check, theme)}
                  </Text>
                </div>
                {onFixFinding && failing ? (
                  <PrButton
                    variant="ghost"
                    icon="hammer"
                    disabled={pendingFinding !== null}
                    onClick={() => onFixFinding(finding)}
                    testId="pr-fix-check"
                  >
                    {pendingFinding === pullRequestFindingKey(finding) ? "Preparing..." : fixCheckLabel}
                  </PrButton>
                ) : null}
              </div>
            );
          })
        )}
      </Section>

      <Section heading={sectionHeadings.comments} onHeight={measureSection("comments")}      >
        {activityPending ? (
          <ConversationGhost />
        ) : activityError ? (
          <PullRequestActivityUnavailableState compact error={activityError} onRetry={onRefresh} />
        ) : (
          <>
            {detail.commentsTruncated ? (
              <div
                style={{
                  marginBottom: 8,
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderRadius: RADIUS.md,
                  borderWidth: 1,
                  borderColor: alpha(theme.warning, 0.3),
                  backgroundColor: alpha(theme.warning, 0.08),
                }}
              >
                <Text size="xs">
                  {`This conversation is only partially loaded. ${commentCount} comment${commentCount === 1 ? " is" : "s are"} loaded; open it on the host to read the rest.`}
                </Text>
              </div>
            ) : null}
            {items.length === 0 ? (
              <div style={{ paddingTop: 8, paddingBottom: 8 }}>
                <Text size="xs" color={theme.mutedForeground}>
                  No comments yet.
                </Text>
              </div>
            ) : filteredItems.length === 0 ? (
              <div style={{ paddingTop: 8, paddingBottom: 8 }}>
                <Text size="xs" color={theme.mutedForeground}>
                  {filteredOutCount === 1
                    ? "The only comment is hidden by the filter."
                    : `All ${filteredOutCount} comments are hidden by the filter.`}
                </Text>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {commentOrder === "oldest" ? showOldest : null}
                {visibleItems.map((item) => (
                  <ConversationItem
                    key={`${detail.url}:${item.kind}:${item.id}`}
                    item={item}
                    editing={commentEditing}
                    reactionBarFor={reactionBarFor}
                    fixButtonFor={fixButtonFor}
                  />
                ))}
                {commentOrder === "newest" ? showOldest : null}
                {shownConversations > COMMENT_PAGE ? (
                  <div
                    onClick={() => setShown({ url: detail.url, count: COMMENT_PAGE })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 28,
                      borderRadius: RADIUS.md,
                      cursor: "pointer",
                      flexShrink: 0,
                      hover: { backgroundColor: theme.accent },
                    }}
                  >
                    <Text weight={500}>{`Show only ${COMMENT_PAGE} recent conversations`}</Text>
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </Section>
      {/* Room for the composer button that floats over the bottom-right corner. */}
      <div style={{ height: 56, flexShrink: 0 }} />
    </div>
      {pinnedHeading ? (
        // Clear of the scrollbar, which stays usable beside the pinned heading.
        <div testId="pr-summary-pinned-heading" style={{ position: "absolute", top: pinned?.top ?? 0, left: 0, right: 10, height: SECTION_HEADING_HEIGHT }}>
          <SectionHeading {...pinnedHeading} {...(pinnedHeading.testId ? { testId: `${pinnedHeading.testId}-pinned` } : {})} />
        </div>
      ) : null}
    </div>
  );
}

/** A dry run's refusal, as a toast description; other failures keep web's bare title. */
function dryRunDescription(result: { readonly cause: Cause.Cause<unknown> }): { description?: string } {
  const failure = squashAtomCommandFailure(result);
  return failure instanceof PullRequestDryRunError ? { description: failure.message } : {};
}
