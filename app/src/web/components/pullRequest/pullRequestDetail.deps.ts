// The three helpers apps/web/src/components/pullRequest/pullRequestDetail.logic.ts imports from
// apps/web/src/{reviewCommentContext.ts,lib/composerContextRecords.ts,lib/composerContextReferences.ts},
// copied here so the logic port does not pull in the diff renderer and composer stores they live beside.
import type { ComposerContextId, PullRequestContextMetadata } from "@t3tools/contracts";
import {
  collectComposerContextReferences,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";

interface ReviewCommentSelection {
  readonly start: number;
  readonly side: "additions" | "deletions";
  readonly end: number;
  readonly endSide: "additions" | "deletions";
}

/** apps/web/src/reviewCommentContext.ts */
export interface ReviewCommentContext {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly filePath: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly rangeLabel: string;
  readonly text: string;
  readonly diff: string;
  readonly fenceLanguage?: string | undefined;
  readonly selection?: ReviewCommentSelection | undefined;
  readonly pullRequest?: PullRequestContextMetadata | undefined;
}

/** apps/web/src/reviewCommentContext.ts */
export function inferReviewCommentFenceLanguage(filePath: string): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const fileName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1).toLowerCase();
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex > 0 && extensionIndex < fileName.length - 1) {
    return fileName.slice(extensionIndex + 1);
  }
  if (fileName.startsWith(".") && fileName.length > 1) {
    return fileName.slice(1);
  }
  return "text";
}

/** apps/web/src/lib/composerContextRecords.ts */
export function reviewCommentContextId(commentId: string): ComposerContextId {
  return toKindScopedComposerContextId("review-comment", commentId);
}

/** apps/web/src/lib/composerContextReferences.ts */
export function removeInlineContextReference(
  prompt: string,
  contextId: string,
): { prompt: string; cursor: number } {
  const occurrences = collectComposerContextReferences(prompt).filter(
    (candidate) => candidate.contextId === contextId,
  );
  if (occurrences.length === 0) return { prompt, cursor: prompt.length };
  let result = prompt;
  let cursor = prompt.length;
  for (const occurrence of occurrences.reverse()) {
    let { start, end } = occurrence;
    if (result[end] === " ") end += 1;
    else if (result[start - 1] === " ") start -= 1;
    result = `${result.slice(0, start)}${result.slice(end)}`;
    cursor = start;
  }
  if (cursor >= result.length) {
    result = result.trimEnd();
    cursor = result.length;
  }
  return { prompt: result, cursor };
}
