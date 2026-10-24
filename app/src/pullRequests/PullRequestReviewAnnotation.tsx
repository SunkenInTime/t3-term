// Port of apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx and the draft form of
// apps/web/src/components/diffs/DiffCommentAnnotation.tsx: what the Code tab (and the guide's
// excerpts) draw under a diff line. A review conversation with reply, resolve, edit, reactions and
// "load more"; a pending line comment that waits for the review; the draft a gutter press opens.
import type {
  EnvironmentId,
  PullRequestRef,
  PullRequestReviewThread,
  PullRequestThreadComment,
  PullRequestThreadCommentsResult,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

import type { PendingReviewComment } from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import {
  editPullRequestThreadComment,
  mergePullRequestThreadComments,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { PrButton, PrEditButton, PrTextarea } from "./prControls.tsx";
import { isCommentSubmitChord, PullRequestMarkdownEditor } from "./PullRequestMarkdownEditor.tsx";
import { PullRequestReactionBar } from "./PullRequestReactions.tsx";
import { PrMarkdown } from "./PullRequestSummaryTab.tsx";
import { PullRequestActorAvatar, formatRelativeTimeLabel } from "./pullRequestPresentation.tsx";

/** mx-3 my-2 rounded-xl border border-border/70 bg-background p-3 shadow-sm */
function useCardStyle(dashed = false) {
  const theme = useTheme();
  return {
    display: "flex" as const,
    flexDirection: "column" as const,
    marginLeft: 12,
    marginRight: 12,
    marginTop: 8,
    marginBottom: 8,
    padding: 12,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: alpha(theme.border, 0.7),
    ...(dashed ? { borderStyle: "dashed" as const } : {}),
    backgroundColor: theme.background,
    boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#0000000d" },
  };
}

export function PendingReviewCommentCard({
  comment,
  onRemove,
}: {
  comment: PendingReviewComment;
  onRemove: () => void;
}) {
  const theme = useTheme();
  return (
    <div testId="pr-pending-comment" style={useCardStyle(true)}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="message-square" size={14} color={theme.mutedForeground} />
        <Text size="xs" color={theme.mutedForeground} style={{ flexGrow: 1 }}>
          Pending. Sent when you submit the review
        </Text>
        <div
          testId="pr-pending-comment-remove"
          onClick={onRemove}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: RADIUS.md,
            cursor: "pointer",
            hover: { backgroundColor: theme.accent },
          }}
        >
          <Icon name="trash-2" size={14} color={theme.mutedForeground} />
        </div>
      </div>
      <Text style={{ marginTop: 8, lineHeight: 22 }}>{comment.body}</Text>
    </div>
  );
}

/** DiffCommentAnnotation kind="draft": the box a gutter press opens under its line. */
export function DiffCommentDraft({
  rangeLabel: _rangeLabel,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  secondaryAction,
  onCancel,
  onComment,
}: {
  rangeLabel: string;
  placeholder?: string;
  submitLabel?: string;
  secondaryAction?: { readonly label: string; readonly onAction: (text: string) => void };
  onCancel: () => void;
  onComment: (text: string) => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const trimmed = text.trim();
  return (
    <div testId="pr-line-comment-draft" style={{ display: "flex", flexDirection: "column", paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
      <PrTextarea
        autoFocus
        size="sm"
        value={text}
        minRows={2}
        placeholder={placeholder}
        testId="pr-line-comment-input"
        onChange={setText}
        onKeyDown={(event) => {
          if (event.key === "escape") onCancel();
          else if (isCommentSubmitChord(event) && trimmed.length > 0) onComment(trimmed);
        }}
      />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
        <Text size="2xs" color={alpha(theme.mutedForeground, 0.7)} truncate style={{ flexGrow: 1, flexShrink: 1 }}>
          ⌘/Ctrl Enter to send
        </Text>
        <PrButton variant="ghost-muted" onClick={onCancel} testId="pr-line-comment-cancel">
          Cancel
        </PrButton>
        {secondaryAction ? (
          <PrButton
            disabled={trimmed.length === 0}
            onClick={() => secondaryAction.onAction(trimmed)}
            testId="pr-line-comment-secondary"
          >
            {secondaryAction.label}
          </PrButton>
        ) : null}
        <PrButton
          variant="default"
          disabled={trimmed.length === 0}
          onClick={() => onComment(trimmed)}
          testId="pr-line-comment-submit"
        >
          {submitLabel}
        </PrButton>
      </div>
    </div>
  );
}

function ThreadComment({
  comment,
  environmentId,
  reference,
  canReact,
  canEdit,
  editing,
  savingEdit,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onReacted,
}: {
  comment: PullRequestThreadComment;
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  canReact: boolean;
  canEdit: boolean;
  editing: boolean;
  savingEdit: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => void;
  onReacted: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
    >
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <PullRequestActorAvatar actor={comment.author} />
          <Text size="xs" weight={500}>
            {comment.author?.login ?? "ghost"}
          </Text>
        </div>
        <Text size="xs" color={theme.mutedForeground}>
          {formatRelativeTimeLabel(comment.createdAt)}
        </Text>
        <PullRequestReactionBar
          reactions={comment.reactions ?? []}
          canReact={canReact}
          subjectId={comment.id}
          environmentId={environmentId}
          reference={reference}
          onRefresh={onReacted}
          justifyEnd
        />
      </div>
      {editing ? (
        <div style={{ display: "flex", marginTop: 4 }}>
          <PullRequestMarkdownEditor
            value={comment.body}
            environmentId={environmentId}
            saving={savingEdit}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
            testId="pr-thread-comment-editor"
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 4 }}>
          <PrMarkdown source={comment.body} />
          {canEdit ? <PrEditButton visible={hovered} label="Edit comment" onClick={onEdit} testId="pr-thread-comment-edit" /> : null}
        </div>
      )}
    </div>
  );
}

export function ReviewThreadCard({
  thread,
  canReply,
  canResolve,
  canReact,
  environmentId,
  reference,
  pending,
  fixPending,
  fixLabel = "Fix in a thread",
  onFix,
  onReply,
  onLoadMore,
  canEditComment,
  onEditComment,
  onToggleResolved,
  onReacted,
}: {
  thread: PullRequestReviewThread;
  canReply: boolean;
  canResolve: boolean;
  canReact: boolean;
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  pending: boolean;
  fixPending?: boolean;
  fixLabel?: string;
  onFix?: () => void;
  onReply: (body: string) => Promise<boolean>;
  onLoadMore: (cursor: string) => Promise<PullRequestThreadCommentsResult | null>;
  canEditComment: (comment: PullRequestThreadComment) => boolean;
  onEditComment: (commentId: string, body: string) => Promise<boolean>;
  onToggleResolved: () => void;
  onReacted: () => void;
}) {
  const theme = useTheme();
  const card = useCardStyle();
  const [expanded, setExpanded] = useState(!thread.isResolved);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const sendingRef = useRef(false);
  const [loadedPage, setLoadedPage] = useState<(PullRequestThreadCommentsResult & { readonly threadId: string }) | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const currentPage = loadedPage?.threadId === thread.id ? loadedPage : null;
  const comments = mergePullRequestThreadComments(thread.comments, currentPage?.comments ?? []);
  const nextCommentsCursor = currentPage === null ? (thread.nextCommentsCursor ?? null) : currentPage.nextCursor;
  const commentCount = thread.commentCount ?? comments.length;

  const saveEdit = async (commentId: string, body: string) => {
    if (savingEdit) return;
    setSavingEdit(true);
    const saved = await onEditComment(commentId, body);
    setSavingEdit(false);
    if (!saved) return;
    setLoadedPage((previous) =>
      previous?.threadId === thread.id
        ? { ...previous, comments: editPullRequestThreadComment(previous.comments, commentId, body) }
        : previous,
    );
    setEditingId(null);
  };
  const send = async () => {
    const trimmed = reply.trim();
    if (trimmed.length === 0 || pending || sendingRef.current) return;
    sendingRef.current = true;
    const sent = await onReply(trimmed);
    sendingRef.current = false;
    if (!sent) return;
    // The write returns no comment: keep what was loaded and reopen its cursor so the new reply
    // stays reachable without spending requests until the reader asks for it.
    setLoadedPage((previous) =>
      previous?.threadId === thread.id
        ? { ...previous, nextCursor: previous.nextCursor ?? thread.nextCommentsCursor ?? null }
        : previous,
    );
    setReply("");
    setReplying(false);
  };
  const loadMore = async () => {
    if (nextCommentsCursor === null || loadingMore) return;
    setLoadingMore(true);
    const page = await onLoadMore(nextCommentsCursor);
    setLoadingMore(false);
    if (page === null) return;
    setLoadedPage((previous) => ({
      threadId: thread.id,
      comments: mergePullRequestThreadComments(previous?.threadId === thread.id ? previous.comments : [], page.comments),
      nextCursor: page.nextCursor,
    }));
  };

  return (
    <div testId={`pr-review-thread-${thread.id}`} style={card}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon
          name={thread.isResolved ? "circle-check" : "circle"}
          size={14}
          color={thread.isResolved ? theme.successForeground : theme.mutedForeground}
        />
        <div
          testId="pr-review-thread-toggle"
          onClick={() => setExpanded(!expanded)}
          style={{ display: "flex", cursor: "pointer" }}
        >
          <Text size="xs" color={theme.mutedForeground}>
            {`${thread.isResolved ? "Resolved" : "Open"} · ${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
          </Text>
        </div>
        {thread.isOutdated ? (
          <Text size="xs" color={theme.mutedForeground}>
            outdated
          </Text>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        {onFix ? (
          <PrButton variant="ghost" icon="hammer" disabled={pending || fixPending} onClick={onFix} testId="pr-review-thread-fix">
            {fixPending ? "Preparing..." : fixLabel}
          </PrButton>
        ) : null}
        {canResolve ? (
          <PrButton variant="ghost" disabled={pending} onClick={onToggleResolved} testId="pr-review-thread-resolve">
            {thread.isResolved ? "Unresolve" : "Resolve"}
          </PrButton>
        ) : null}
      </div>
      {expanded ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            {comments.map((comment) => (
              <ThreadComment
                key={comment.id}
                comment={comment}
                environmentId={environmentId}
                reference={reference}
                canReact={canReact}
                canEdit={canEditComment(comment)}
                editing={editingId === comment.id}
                savingEdit={savingEdit}
                onEdit={() => setEditingId(comment.id)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={(body) => void saveEdit(comment.id, body)}
                onReacted={onReacted}
              />
            ))}
          </div>
          {nextCommentsCursor !== null ? (
            <div style={{ display: "flex", marginTop: 8 }}>
              <PrButton variant="ghost" disabled={loadingMore} onClick={() => void loadMore()} testId="pr-review-thread-more">
                {loadingMore ? "Loading..." : "Load more comments"}
              </PrButton>
            </div>
          ) : null}
          {canReply ? (
            replying ? (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                <PrTextarea
                  autoFocus
                  size="sm"
                  value={reply}
                  minRows={2}
                  placeholder="Reply"
                  testId="pr-review-thread-reply-input"
                  onChange={setReply}
                  onKeyDown={(event) => {
                    if (event.key === "escape") setReplying(false);
                    else if (isCommentSubmitChord(event)) void send();
                  }}
                />
                <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                  <PrButton variant="ghost" onClick={() => setReplying(false)} testId="pr-review-thread-reply-cancel">
                    Cancel
                  </PrButton>
                  <PrButton
                    variant="default"
                    disabled={pending || reply.trim().length === 0}
                    onClick={() => void send()}
                    testId="pr-review-thread-reply-send"
                  >
                    Reply
                  </PrButton>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", marginTop: 8 }}>
                <PrButton variant="ghost" onClick={() => setReplying(true)} testId="pr-review-thread-reply">
                  Reply
                </PrButton>
              </div>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}
