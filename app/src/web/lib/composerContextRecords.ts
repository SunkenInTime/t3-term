// The review-comment pieces of apps/web/src/lib/composerContextRecords.ts: the label,
// context id, inline reference and wire record a review comment becomes in a message.
import {
  COMPOSER_CONTEXT_REVIEW_DIFF_MAX_CHARS,
  COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS,
  type ComposerContextId,
  type OrchestrationMessageContext,
  type ReviewCommentContextRecord,
  type TerminalContextRecord,
} from "@t3tools/contracts";
import {
  sanitizeComposerContextLabel,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";

import type { ComposerContextReference } from "./composerContextReferences.ts";
import type { ReviewCommentContext } from "../reviewCommentContext.ts";
import {
  formatTerminalContextLabel,
  normalizeTerminalContextText,
  type TerminalContextDraft,
} from "./terminalContext.ts";

/**
 * A review selection can be arbitrarily large, but the wire schema bounds `text` and `diff`.
 * Clamp at the same boundary so an oversized selection still sends, marked where it was cut,
 * rather than failing to encode at send time.
 */
const TRUNCATION_MARKER = "\n… truncated …";

function clampContextText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}

type ReviewCommentPresentation = ReviewCommentContext | ReviewCommentContextRecord;

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

export function reviewCommentContextLabel(comment: ReviewCommentPresentation): string {
  const pullRequestNumber = pullRequestContextNumber(comment);
  if (isPullRequestSummaryContext(comment) && pullRequestNumber !== null) {
    return `#${pullRequestNumber}`;
  }
  const diffRange = /^([+-])(\d+)(?: to \1(\d+))?$/u.exec(comment.rangeLabel);
  const rangeLabel = diffRange
    ? `L${diffRange[2]}${diffRange[3] ? ` to L${diffRange[3]}` : ""}${diffRange[1] === "-" ? " (before)" : ""}`
    : comment.rangeLabel;
  return `${basename(comment.filePath)} ${rangeLabel}`;
}

export function isPullRequestSummaryContext(comment: ReviewCommentPresentation): boolean {
  if (comment.pullRequest !== undefined) return true;
  return (
    comment.sectionId.startsWith("pull-request:") &&
    comment.diff.trim().length === 0 &&
    /^PR #\d+$/u.test(comment.filePath)
  );
}

function pullRequestContextNumber(comment: ReviewCommentPresentation): number | null {
  if (comment.pullRequest !== undefined) return comment.pullRequest.number;
  const legacyNumber = /^PR #(\d+)$/u.exec(comment.filePath)?.[1];
  return legacyNumber === undefined ? null : Number(legacyNumber);
}

export function reviewCommentContextId(commentId: string): ComposerContextId {
  return toKindScopedComposerContextId("review-comment", commentId);
}

export function reviewCommentContextReference(
  comment: ReviewCommentContext,
): ComposerContextReference {
  return {
    kind: "review-comment",
    contextId: reviewCommentContextId(comment.id),
    label: reviewCommentContextLabel(comment),
  };
}

export function reviewCommentContextRecord(
  comment: ReviewCommentContext,
): ReviewCommentContextRecord {
  return {
    version: 1,
    contextId: reviewCommentContextId(comment.id),
    kind: "review-comment",
    label: sanitizeComposerContextLabel(reviewCommentContextLabel(comment), "review-comment"),
    sectionId: comment.sectionId,
    sectionTitle: comment.sectionTitle,
    filePath: comment.filePath,
    startIndex: comment.startIndex,
    endIndex: comment.endIndex,
    rangeLabel: comment.rangeLabel,
    text: clampContextText(comment.text, COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS),
    diff: clampContextText(comment.diff, COMPOSER_CONTEXT_REVIEW_DIFF_MAX_CHARS),
    ...(comment.fenceLanguage !== undefined ? { fenceLanguage: comment.fenceLanguage } : {}),
    ...(comment.pullRequest !== undefined ? { pullRequest: comment.pullRequest } : {}),
  } as ReviewCommentContextRecord;
}

/** web buildMessageContext, review comments only (the composer sends no other records yet). */
export function buildReviewCommentMessageContext(
  reviewComments: ReadonlyArray<ReviewCommentContext>,
): OrchestrationMessageContext | undefined {
  if (reviewComments.length === 0) return undefined;
  return { version: 1, records: reviewComments.map(reviewCommentContextRecord) } as OrchestrationMessageContext;
}

// ── Terminal contexts (web composerContextRecords.ts terminalContextReference / Record) ──

export function terminalContextReference(context: TerminalContextDraft): ComposerContextReference {
  return {
    kind: "terminal",
    contextId: toKindScopedComposerContextId("terminal", context.id),
    label: formatTerminalContextLabel(context),
  };
}

export function terminalContextRecord(context: TerminalContextDraft): TerminalContextRecord {
  return {
    version: 1,
    contextId: toKindScopedComposerContextId("terminal", context.id),
    kind: "terminal",
    label: sanitizeComposerContextLabel(formatTerminalContextLabel(context), "terminal"),
    terminalId: context.terminalId,
    terminalLabel: context.terminalLabel,
    lineStart: context.lineStart,
    lineEnd: context.lineEnd,
    text: normalizeTerminalContextText(context.text),
  } as TerminalContextRecord;
}

/** web buildMessageContext for the records this composer sends: terminal excerpts, then review comments. */
export function buildComposerMessageContext(input: {
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>;
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
}): OrchestrationMessageContext | undefined {
  const records = [
    ...input.terminalContexts.map(terminalContextRecord),
    ...input.reviewComments.map(reviewCommentContextRecord),
  ];
  return records.length === 0 ? undefined : ({ version: 1, records } as OrchestrationMessageContext);
}
