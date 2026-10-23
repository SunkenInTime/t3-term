// Port of apps/web/src/components/pullRequest/{PullRequestComposer,PullRequestCommentForm,
// PullRequestReviewForm}.tsx: the round button at the panel's bottom-right that opens a popover
// to comment on the pull request (optionally closing or reopening it with the comment) or to
// submit a review with any pending line comments. Every submit goes through runPullRequestWrite.
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PullRequestRef, PullRequestReviewVerdict } from "@t3tools/contracts";
import type { EventPayload } from "@gpuix/native";
import { useState } from "react";

import {
  pullRequestEnvironment,
  pullRequestReviewKey,
  pullRequestReviewStore,
  usePendingReviewComments,
  useReviewSummary,
} from "../state/pullRequests.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Popover, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast } from "../ui/toast.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import type { PullRequestDetailView } from "./PullRequestDetailPanel.tsx";
import { PrButton, PrSegmented, PrTextarea } from "./prControls.tsx";
import { PrMenu, PrMenuItem } from "./PullRequestMenus.tsx";
import { PullRequestGlyph } from "./pullRequestPresentation.tsx";
import { PullRequestDryRunError, runPullRequestWrite } from "./pullRequestWrites.ts";
import { useInlineActionConfirm } from "./useInlineActionConfirm.tsx";

const VERDICTS: ReadonlyArray<{
  readonly value: PullRequestReviewVerdict;
  readonly label: string;
  readonly sent: string;
  readonly icon: IconName;
}> = [
  { value: "comment", label: "Comment", sent: "Review submitted", icon: "message-square" },
  { value: "approve", label: "Approve", sent: "Pull request approved", icon: "check" },
  { value: "request-changes", label: "Request changes", sent: "Changes requested", icon: "circle-x" },
];

/** Ctrl/Cmd+Enter: modified chords reach a focused <textarea>'s onKeyDown (plain Enter does not). */
function isSubmitChord(event: EventPayload): boolean {
  const modifiers = (event.modifiers ?? {}) as { ctrl?: boolean; cmd?: boolean; shift?: boolean; alt?: boolean };
  return event.key === "enter" && (modifiers.ctrl === true || modifiers.cmd === true) && !modifiers.shift && !modifiers.alt;
}

function dryRunDescription(failure: unknown): { description?: string } {
  return failure instanceof PullRequestDryRunError ? { description: failure.message } : {};
}

export function PullRequestComposer({
  environmentId,
  reference,
  detail,
  actionPending,
  onCommentAction,
  onCommented,
  onReviewSubmitted,
  openReviewRequest,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  actionPending: boolean;
  onCommentAction: (body: string, action: "close" | "reopen") => Promise<{ readonly commentPosted: boolean }>;
  onCommented: () => void;
  onReviewSubmitted: () => void;
  openReviewRequest?: number | undefined;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [requestedMode, setRequestedMode] = useState<"comment" | "review">("comment");
  // The comment draft and the in-flight guards live here, outside the popover, so closing and
  // reopening it keeps them (web keeps both forms mounted for the same reason).
  const [commentBody, setCommentBody] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState<"comment" | "close" | "reopen" | null>(null);
  const pendingComments = usePendingReviewComments(reference);
  const reviewKey = pullRequestReviewKey(reference);
  const summaryStarted = useReviewSummary(reference).trim().length > 0;
  const reviewStarted = pendingComments.length > 0 || summaryStarted;
  const [answeredOpenRequest, setAnsweredOpenRequest] = useState(openReviewRequest);
  if (openReviewRequest !== answeredOpenRequest) {
    setAnsweredOpenRequest(openReviewRequest);
    setRequestedMode("review");
    setOpen(true);
  }

  const canComment = detail.capabilities.comment && detail.viewerPermissions.comment;
  const verdicts = detail.capabilities.review.verdicts.filter((verdict) =>
    detail.viewerPermissions.verdicts.includes(verdict),
  );
  if (!canComment && verdicts.length === 0) return null;
  const mode = canComment ? (verdicts.length === 0 ? "comment" : requestedMode) : "review";
  const triggerLabel =
    pendingComments.length > 0
      ? `Review pull request, ${pendingComments.length} ${pendingComments.length === 1 ? "comment" : "comments"} pending`
      : reviewStarted || !canComment
        ? "Review pull request"
        : "Comment on pull request";

  return (
    <div style={{ position: "absolute", right: 16, bottom: 12, display: "flex" }}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setRequestedMode(reviewStarted ? "review" : "comment");
          setOpen(next);
        }}
        side="top"
        align="end"
        sideOffset={8}
        testId="pr-composer-popup"
        style={{ width: 384, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16 }}
        trigger={
          <Tooltip content={triggerLabel} side="top">
            <div
              testId="pr-composer"
              onClick={() => {
                if (!open) setRequestedMode(reviewStarted ? "review" : "comment");
                setOpen(!open);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                width: 32,
                height: 32,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: alpha(theme.border, 0.6),
                backgroundColor: alpha(theme.background, 0.9),
                cursor: "pointer",
                boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "#0000000d" },
                hover: { borderColor: theme.border },
              }}
            >
              <Icon name="message-square" size={16} color={theme.mutedForeground} />
              {pendingComments.length > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 14,
                    minWidth: 14,
                    paddingLeft: 4,
                    paddingRight: 4,
                    borderRadius: 7,
                    backgroundColor: theme.info,
                    pointerEvents: "none",
                  }}
                >
                  <text style={{ color: "#ffffff", fontSize: 9, lineHeight: 12, fontWeight: 600 }}>
                    {String(pendingComments.length)}
                  </text>
                </div>
              ) : null}
            </div>
          </Tooltip>
        }
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
          {canComment && verdicts.length > 0 ? (
            <PrSegmented
              value={mode}
              testIdPrefix="pr-composer-mode"
              options={[
                { value: "comment", label: "Comment" },
                { value: "review", label: pendingComments.length > 0 ? `Review (${pendingComments.length})` : "Review" },
              ]}
              onChange={setRequestedMode}
            />
          ) : (
            <Text weight={600}>{mode === "review" ? "Review pull request" : "Comment on pull request"}</Text>
          )}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
            {mode === "review" && pendingComments.length > 0 ? (
              <Tooltip content="Discard pending line comments">
                <div style={{ display: "flex" }}>
                  <ComposerIconButton
                    icon="trash-2"
                    disabled={reviewPending}
                    onClick={() => pullRequestReviewStore.clear(reviewKey)}
                    testId="pr-composer-discard"
                  />
                </div>
              </Tooltip>
            ) : null}
            <ComposerIconButton icon="x" onClick={() => setOpen(false)} testId="pr-composer-close" />
          </div>
        </div>
        {mode === "review" && verdicts.length > 0 ? (
          <PullRequestReviewForm
            environmentId={environmentId}
            reference={reference}
            verdicts={verdicts}
            requestChangesSummaryRequired={sourceControlClients
              .get(detail.provider)
              .reviewSummaryRequired("request-changes")}
            pending={reviewPending}
            onPendingChange={setReviewPending}
            onSubmitted={() => {
              setOpen(false);
              onReviewSubmitted();
            }}
          />
        ) : canComment ? (
          <PullRequestCommentForm
            environmentId={environmentId}
            reference={reference}
            detail={detail}
            actionPending={actionPending}
            body={commentBody}
            onBodyChange={setCommentBody}
            submitting={commentSubmitting}
            onSubmittingChange={setCommentSubmitting}
            onCommentAction={onCommentAction}
            onCommented={onCommented}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </Popover>
    </div>
  );
}

function ComposerIconButton({
  icon,
  onClick,
  disabled,
  testId,
}: {
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: RADIUS.md,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      <Icon name={icon} size={14} color={theme.mutedForeground} />
    </div>
  );
}

function PullRequestCommentForm({
  environmentId,
  reference,
  detail,
  actionPending,
  body,
  onBodyChange,
  submitting,
  onSubmittingChange,
  onCommentAction,
  onCommented,
  onClose,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  actionPending: boolean;
  body: string;
  onBodyChange: (body: string) => void;
  submitting: "comment" | "close" | "reopen" | null;
  onSubmittingChange: (submitting: "comment" | "close" | "reopen" | null) => void;
  onCommentAction: (body: string, action: "close" | "reopen") => Promise<{ readonly commentPosted: boolean }>;
  onCommented: () => void;
  onClose: () => void;
}) {
  const inlineConfirm = useInlineActionConfirm(pullRequestReviewKey(reference));
  const followUpAction =
    detail.state === "open" &&
    detail.capabilities.actions.includes("close") &&
    detail.viewerPermissions.actions.includes("close")
      ? ("close" as const)
      : detail.state === "closed" &&
          detail.capabilities.actions.includes("reopen") &&
          detail.viewerPermissions.actions.includes("reopen")
        ? ("reopen" as const)
        : null;

  const submit = async (action: "comment" | "close" | "reopen") => {
    const trimmed = body.trim();
    if (trimmed.length === 0 || submitting !== null || actionPending) return;
    onSubmittingChange(action);
    if (action !== "comment") {
      const result = await onCommentAction(trimmed, action);
      if (result.commentPosted) {
        onBodyChange("");
        onClose();
      }
      onSubmittingChange(null);
      return;
    }
    const result = await runPullRequestWrite(pullRequestEnvironment.comment, {
      environmentId,
      input: { ...reference, body: trimmed },
    });
    if (result._tag === "Failure") {
      onSubmittingChange(null);
      toast({ type: "error", title: "Could not post the comment", ...dryRunDescription(squashAtomCommandFailure(result)) });
      return;
    }
    onBodyChange("");
    onSubmittingChange(null);
    onClose();
    onCommented();
  };
  const empty = body.trim().length === 0;
  const busy = submitting !== null || actionPending;
  const closeArmed = inlineConfirm.isArmed("close");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {inlineConfirm.escapeLayer}
      <PrTextarea
        autoFocus
        // Locked while posting: the body is cleared on success, which would throw away a new draft
        // typed while the request was still in flight.
        disabled={busy}
        value={body}
        minRows={3}
        placeholder="Leave a comment"
        testId="pr-comment-input"
        onChange={onBodyChange}
        onKeyDown={(event) => {
          if (isSubmitChord(event)) void submit("comment");
        }}
      />
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
        {followUpAction === null ? null : followUpAction === "close" ? (
          <PrButton
            variant="destructive-outline"
            icon={PullRequestGlyph.closed}
            disabled={empty || busy}
            testId="pr-comment-close"
            {...inlineConfirm.props("close", () => void submit("close"))}
          >
            {submitting === "close" ? "Closing..." : closeArmed ? "Confirm close?" : "Close with comment"}
          </PrButton>
        ) : (
          <PrButton
            icon={PullRequestGlyph.reopen}
            disabled={empty || busy}
            onClick={() => void submit("reopen")}
            testId="pr-comment-reopen"
          >
            {submitting === "reopen" ? "Reopening..." : "Reopen with comment"}
          </PrButton>
        )}
        <PrButton icon="send" disabled={empty || busy} onClick={() => void submit("comment")} testId="pr-comment-submit">
          {submitting === "comment" ? "Posting..." : "Comment"}
        </PrButton>
      </div>
    </div>
  );
}

function PullRequestReviewForm({
  environmentId,
  reference,
  verdicts,
  requestChangesSummaryRequired,
  pending,
  onPendingChange,
  onSubmitted,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  verdicts: ReadonlyArray<PullRequestReviewVerdict>;
  requestChangesSummaryRequired: boolean;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onSubmitted: () => void;
}) {
  const theme = useTheme();
  const [requestedVerdict, setRequestedVerdict] = useState<PullRequestReviewVerdict>("comment");
  const comments = usePendingReviewComments(reference);
  const reviewKey = pullRequestReviewKey(reference);
  // Summaries sit beside the keyed line-comment drafts, so switching pull requests shows the
  // right body on the first render.
  const body = useReviewSummary(reference);
  const offered = VERDICTS.filter((verdict) => verdicts.includes(verdict.value));
  const selectedVerdict = offered.find((verdict) => verdict.value === requestedVerdict) ?? offered[0];

  const submit = async (verdict: (typeof VERDICTS)[number]) => {
    if (pending) return;
    const submittedBody = body;
    const submittedComments = comments;
    onPendingChange(true);
    const result = await runPullRequestWrite(pullRequestEnvironment.submitReview, {
      environmentId,
      input: {
        ...reference,
        verdict: verdict.value,
        body: submittedBody,
        comments: submittedComments,
      },
    });
    onPendingChange(false);
    if (result._tag === "Failure") {
      toast({
        type: "error",
        title: "The review could not be submitted",
        ...dryRunDescription(squashAtomCommandFailure(result)),
      });
      return;
    }
    // More remarks may have been added while the host was accepting this snapshot; leave those,
    // and any summary revised in the meantime, for the next review.
    pullRequestReviewStore.removeComments(
      reviewKey,
      submittedComments.map((comment) => comment.id),
    );
    pullRequestReviewStore.clearSummary(reviewKey, submittedBody);
    toast({ type: "success", title: verdict.sent });
    onSubmitted();
  };

  // Forgejo requires a summary when requesting changes, even with inline comments.
  const canSubmit = (verdict: PullRequestReviewVerdict, summary: string) =>
    verdict === "request-changes" && requestChangesSummaryRequired
      ? summary.trim().length > 0
      : verdict === "approve" || summary.trim().length > 0 || comments.length > 0;
  const placeholder =
    selectedVerdict === undefined || canSubmit(selectedVerdict.value, "")
      ? "Summarize your review (optional)"
      : selectedVerdict.value === "request-changes" && requestChangesSummaryRequired
        ? "Summarize your review (required to request changes)"
        : "Summarize your review or add line comments";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <PrTextarea
        autoFocus
        value={body}
        minRows={3}
        placeholder={placeholder}
        testId="pr-review-input"
        onChange={(next) => pullRequestReviewStore.setSummary(reviewKey, next)}
      />
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        {offered.length > 1 && selectedVerdict ? (
          <div style={{ display: "flex", flexGrow: 1 }}>
            <PrMenu
              minWidth={160}
              testId="pr-review-verdicts"
              trigger={({ toggle }) => (
                <PrButton
                  disabled={pending}
                  onClick={toggle}
                  testId="pr-review-verdict"
                  iconNode={<Icon name={selectedVerdict.icon} size={12} color={theme.foreground} />}
                  trailingIcon="chevron-down"
                >
                  {selectedVerdict.label}
                </PrButton>
              )}
            >
              {offered.map((verdict) => (
                <PrMenuItem
                  key={verdict.value}
                  icon={verdict.icon}
                  checked={verdict.value === selectedVerdict.value}
                  onSelect={() => setRequestedVerdict(verdict.value)}
                  testId={`pr-review-verdict-${verdict.value}`}
                >
                  {verdict.label}
                </PrMenuItem>
              ))}
            </PrMenu>
          </div>
        ) : null}
        <PrButton
          variant="default"
          disabled={pending || selectedVerdict === undefined || !canSubmit(selectedVerdict.value, body)}
          onClick={() => {
            if (selectedVerdict !== undefined) void submit(selectedVerdict);
          }}
          testId="pr-review-submit"
        >
          {pending ? "Submitting..." : "Submit review"}
        </PrButton>
      </div>
    </div>
  );
}
