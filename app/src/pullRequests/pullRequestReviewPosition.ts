// Where a line comment lands, worked out on t3-term's own diff model (panels/diff/diffModel.ts)
// rather than pierre's FileDiffMetadata: the parts of apps/web/src/reviewCommentContext.ts
// (`resolveDiffReviewPosition`, `buildDiffReviewComment`) and
// apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx (`getReviewPositionAnchor`,
// `toViewerSide`) that the Code tab and the guide's excerpts need.
import type { PullRequestDiffSide, PullRequestReviewPosition } from "@t3tools/contracts";

import type { DiffFileModel, DiffLine } from "../panels/diff/diffModel.ts";
import type { ReviewCommentContext } from "../web/components/pullRequest/pullRequestDetail.deps.ts";

export function toViewerSide(side: PullRequestDiffSide) {
  return side === "left" ? ("deletions" as const) : ("additions" as const);
}

export function getReviewPositionAnchor(position: PullRequestReviewPosition): {
  line: number;
  side: PullRequestDiffSide;
} {
  switch (position.kind) {
    case "added":
      return { line: position.newLine, side: "right" };
    case "deleted":
      return { line: position.oldLine, side: "left" };
    case "context":
      return { line: position.side === "left" ? position.oldLine : position.newLine, side: position.side };
  }
}

/** The diff line a gutter press named, and its index among the file's diff lines. */
export function findDiffLine(
  file: DiffFileModel,
  side: "additions" | "deletions",
  lineNumber: number,
): { readonly line: DiffLine; readonly index: number } | null {
  let index = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const matches =
        side === "additions"
          ? line.kind !== "deletion" && line.newLine === lineNumber
          : line.kind !== "addition" && line.oldLine === lineNumber;
      if (matches) return { line, index };
      index += 1;
    }
  }
  return null;
}

/** An explicit side never resolves to a same-numbered line on the other side. */
export function reviewPositionForLine(line: DiffLine, side: "additions" | "deletions"): PullRequestReviewPosition | null {
  switch (line.kind) {
    case "addition":
      return line.newLine === null ? null : { kind: "added", newLine: line.newLine };
    case "deletion":
      return line.oldLine === null ? null : { kind: "deleted", oldLine: line.oldLine };
    case "context":
      return line.oldLine === null || line.newLine === null
        ? null
        : { kind: "context", oldLine: line.oldLine, newLine: line.newLine, side: side === "deletions" ? "left" : "right" };
  }
}

function marker(kind: DiffLine["kind"]): string {
  return kind === "addition" ? "+" : kind === "deletion" ? "-" : " ";
}

/** One selected line as agent context (web: `buildDiffReviewComment` for a single-line range). */
export function buildLineReviewComment(input: {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly filePath: string;
  readonly line: DiffLine;
  readonly index: number;
  readonly side: "additions" | "deletions";
  readonly text: string;
}): ReviewCommentContext {
  const { line } = input;
  const number = line.newLine ?? line.oldLine;
  const sign = marker(line.kind).trim();
  return {
    id: input.id,
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    filePath: input.filePath,
    startIndex: input.index,
    endIndex: input.index,
    rangeLabel: number === null ? "line" : `${sign}${number}`,
    text: input.text.trim(),
    diff: [
      `@@ -${line.oldLine ?? 0},${line.oldLine === null ? 0 : 1} +${line.newLine ?? 0},${line.newLine === null ? 0 : 1} @@`,
      `${marker(line.kind)}${line.text}`,
    ].join("\n"),
    fenceLanguage: "diff",
    selection: { start: number ?? 0, side: input.side, end: number ?? 0, endSide: input.side },
  };
}
