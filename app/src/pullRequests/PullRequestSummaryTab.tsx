// Port of apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx (and PullRequestMarkdown /
// PullRequestCommentBody for the bodies). Read-only: the description and comment editors, the
// reviewer and label pickers, reactions and "Fix in a thread" write to the host or start agent
// threads, so they are left out. Section headings do not stick to the top while scrolling
// (gpuix has no sticky positioning).
import type { PullRequestComment, PullRequestReviewThread } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { pullRequestStorage } from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem, MenuLabel, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
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
  pullRequestReviewOutcome,
  visibleBody,
  type PullRequestConversationItem,
  type PullRequestReviewOutcome,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import type { PullRequestDetailView } from "./PullRequestDetailPanel.tsx";
import { GhostBar } from "./PullRequestListStates.tsx";
import {
  PullRequestActorAvatar,
  PullRequestLabelChip,
  TW,
  checkStatusPresentation,
  formatRelativeTimeLabel,
  pullRequestCheckStatusLabel,
} from "./pullRequestPresentation.tsx";

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

/** Markdown as web's ChatMarkdown sets it: 14px, 1.625 line height, foreground at 80%. */
export function PrMarkdown({ source, size = 14 }: { source: string; size?: number }) {
  const theme = useTheme();
  return (
    <markdown
      source={source.replace(/<!--[\s\S]*?-->/gu, "")}
      onLinkClick={(event) => {
        if (event.value) openExternalUrl(event.value);
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

function Section({
  title,
  defaultOpen = true,
  actions,
  children,
  testId,
}: {
  title: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", paddingRight: 16, backgroundColor: theme.background }}>
        <div
          testId={testId}
          onClick={() => setOpen(!open)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            flexGrow: 1,
            minWidth: 0,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 12,
            paddingBottom: 12,
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
      {open ? <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}>{children}</div> : null}
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

function CommentCard({
  comment,
  thread,
  reply = false,
}: {
  comment: PullRequestComment;
  thread: PullRequestReviewThread | undefined;
  reply?: boolean;
}) {
  const theme = useTheme();
  const body = visibleBody(comment.body);
  const outcome = pullRequestReviewOutcome(comment.reviewState);
  return (
    <div
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
        <CommentIdentity comment={comment} />
        {outcome ? (
          <OutcomeBadge outcome={outcome} />
        ) : comment.reviewState ? (
          <Text size="xs" color={theme.mutedForeground}>
            {reviewStateLabel(comment.reviewState)}
          </Text>
        ) : null}
      </div>
      {reply ? null : (
        <div style={{ paddingLeft: 12, paddingRight: 12 }}>
          <CommentLocation comment={comment} thread={thread} />
        </div>
      )}
      {body === null ? null : (
        <div style={{ display: "flex", paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12 }}>
          <PrMarkdown source={body} />
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
}: {
  comment: PullRequestComment;
  thread: PullRequestReviewThread | undefined;
  label: string;
  replyCount: number;
  replies: ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const body = visibleBody(comment.body);
  return (
    <div
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
          {body ? <PrMarkdown source={body} /> : null}
          {replies}
        </div>
      ) : null}
    </div>
  );
}

function ConversationItem({ item }: { item: PullRequestConversationItem }) {
  const theme = useTheme();
  const comment = item.kind === "comment" ? item.comment : item.root;
  const thread = item.kind === "thread" ? item.thread : undefined;
  const replies =
    item.kind === "thread" && item.replies.length > 0 ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginLeft: 16, paddingLeft: 12, borderLeftWidth: 2, borderColor: alpha(theme.border, 0.6) }}>
        {item.replies.map((reply) => (
          <CommentCard key={reply.id} comment={reply} thread={undefined} reply />
        ))}
      </div>
    ) : null;
  const moreReplies =
    item.kind === "thread" && item.hasMoreReplies ? (
      <div
        onClick={item.url ? () => openExternalUrl(item.url!) : undefined}
        style={{ display: "flex", cursor: item.url ? "pointer" : "default", paddingLeft: 16 }}
      >
        <Text size="xs" color={theme.mutedForeground}>
          {item.moreReplies > 0
            ? `${item.moreReplies} more ${item.moreReplies === 1 ? "reply" : "replies"} on the host`
            : "More replies on the host"}
        </Text>
      </div>
    ) : null;
  if (isPullRequestCommentFinished(comment, thread)) {
    return (
      <CollapsedComment
        comment={comment}
        thread={thread}
        label={thread?.isResolved ? "Resolved" : "Review dismissed"}
        replyCount={item.kind === "thread" ? item.replies.length + item.moreReplies : 0}
        replies={replies}
      />
    );
  }
  if (item.kind === "comment") return <CommentCard comment={comment} thread={undefined} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
      <CommentCard comment={comment} thread={thread} />
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
  detail,
  activityPending,
  activityError,
  onRefresh,
  onScrollTop,
}: {
  detail: PullRequestDetailView;
  activityPending: boolean;
  activityError: string | null;
  onRefresh: () => void;
  onScrollTop: (top: number) => void;
}) {
  const theme = useTheme();
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

  return (
    <div
      testId="pr-summary-scroll"
      onScrollChange={(event) => onScrollTop(Math.abs(event.scrollY ?? 0))}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 4, flexShrink: 0 }}>
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
          {detail.capabilities.reviewers.request && detail.capabilities.reviewers.listCandidates ? (
            <Tooltip content="Requesting reviewers is not available in t3-term yet">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, opacity: 0.64 }}>
                <Icon name="user-plus" size={14} color={theme.mutedForeground} />
              </div>
            </Tooltip>
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
              <Tooltip content="Editing labels is not available in t3-term yet">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, opacity: 0.64 }}>
                  <Icon name="tag" size={14} color={theme.mutedForeground} />
                </div>
              </Tooltip>
            ) : null}
          </MetaRow>
        ) : null}
      </div>

      <Section key={`description:${detail.url}`} title="Description" testId="pr-section-description">
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start" }}>
          <PrMarkdown source={detail.body.trim().length > 0 ? detail.body : "_No description provided._"} />
        </div>
      </Section>

      <Section key={`checks:${detail.url}`} title="Checks" defaultOpen={false} testId="pr-section-checks">
        {detail.checks.length === 0 ? (
          <Text size="xs" color={theme.mutedForeground}>
            No checks reported.
          </Text>
        ) : (
          detail.checks.map((check, index) => {
            const presentation = checkStatusPresentation(check.status, theme);
            return (
              <div
                key={`${index}:${check.name}:${check.url ?? ""}`}
                onClick={check.url ? () => openExternalUrl(check.url!) : undefined}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 8,
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 8,
                  paddingBottom: 8,
                  borderRadius: RADIUS.md,
                  cursor: check.url ? "pointer" : "default",
                  flexShrink: 0,
                  hover: { backgroundColor: alpha(theme.accent, 0.6) },
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
            );
          })
        )}
      </Section>

      <Section
        title={`Comments (${detail.commentCount})`}
        testId="pr-section-comments"
        actions={
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
              <MenuItem
                keepOpen
                checked={commentFilter.bots}
                onSelect={() => setCommentFilter({ ...commentFilter, bots: !commentFilter.bots })}
              >
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
            <SmallGhostButton
              icon="arrow-down-up"
              onClick={() => setCommentOrder(commentOrder === "newest" ? "oldest" : "newest")}
            >
              {commentOrder === "newest" ? "Newest first" : "Oldest first"}
            </SmallGhostButton>
          </div>
        }
      >
        {activityPending ? (
          <ConversationGhost />
        ) : activityError ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text size="xs" color={theme.mutedForeground}>
              {activityError}
            </Text>
            <SmallGhostButton icon="arrow-down-up" onClick={onRefresh}>
              Retry
            </SmallGhostButton>
          </div>
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
                  <ConversationItem key={`${detail.url}:${item.kind}:${item.id}`} item={item} />
                ))}
                {commentOrder === "newest" ? showOldest : null}
              </div>
            )}
          </>
        )}
      </Section>
      <div style={{ height: 48, flexShrink: 0 }} />
    </div>
  );
}
