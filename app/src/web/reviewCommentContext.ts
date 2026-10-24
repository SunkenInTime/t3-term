// Ported from apps/web/src/reviewCommentContext.ts.
//
// The web client builds diff comments from @pierre/diffs' FileDiffMetadata. t3-term's
// diff view parses patches itself (panels/diff/diffModel.ts) and only ever holds the
// patch's hunks, never the whole file, so every file is what pierre calls `isPartial`:
// row indexes count hunk lines only, with no expanded context between hunks. The
// builders below take that row list directly; the comment they produce (range label,
// `@@` header, marked lines, selection) is the one web builds for a partial file.
import type { PullRequestContextMetadata } from "@t3tools/contracts";

export type SelectionSide = "additions" | "deletions";

export interface SelectedLineRange {
  readonly start: number;
  readonly side?: SelectionSide | undefined;
  readonly end: number;
  readonly endSide?: SelectionSide | undefined;
}

interface ReviewCommentSelection {
  readonly start: number;
  readonly side: SelectionSide;
  readonly end: number;
  readonly endSide: SelectionSide;
}

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

/** One row of a file's patch, in patch order (web DiffReviewLine). */
export interface DiffReviewLine {
  readonly change: "context" | "add" | "delete";
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
  readonly content: string;
}

export function formatReviewCommentFence(language: string, contents: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(contents.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return [`${fence}${language}`, contents.trimEnd(), fence].join("\n");
}

export function buildFileReviewComment(input: {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  contents: string;
}): ReviewCommentContext {
  const startLine = Math.max(1, Math.min(input.startLine, input.endLine));
  const endLine = Math.max(startLine, Math.max(input.startLine, input.endLine));
  const selectedLines = input.contents.split("\n").slice(startLine - 1, endLine);
  return {
    id: input.id,
    sectionId: `file:${input.filePath}`,
    sectionTitle: "File comment",
    filePath: input.filePath,
    startIndex: startLine - 1,
    endIndex: endLine - 1,
    rangeLabel: startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`,
    text: input.text.trim(),
    diff: selectedLines.join("\n"),
    fenceLanguage: inferReviewCommentFenceLanguage(input.filePath),
  };
}

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

/** web getDiffReviewSelectionPoint. */
function getDiffReviewSelectionPoint(
  line: DiffReviewLine,
): { lineNumber: number; side: SelectionSide } | null {
  if (line.change === "delete" && line.oldLineNumber !== null) {
    return { lineNumber: line.oldLineNumber, side: "deletions" };
  }
  if (line.newLineNumber !== null) {
    return { lineNumber: line.newLineNumber, side: "additions" };
  }
  if (line.oldLineNumber !== null) {
    return { lineNumber: line.oldLineNumber, side: "deletions" };
  }
  return null;
}

/** web restoreDiffReviewCommentRange for a partial file. */
export function restoreDiffReviewCommentRange(
  lines: ReadonlyArray<DiffReviewLine>,
  comment: ReviewCommentContext,
): SelectedLineRange | null {
  if (comment.selection) return comment.selection;
  const startLine = lines[comment.startIndex];
  const endLine = lines[comment.endIndex];
  if (!startLine || !endLine) return null;
  const start = getDiffReviewSelectionPoint(startLine);
  const end = getDiffReviewSelectionPoint(endLine);
  if (!start || !end) return null;
  return { start: start.lineNumber, side: start.side, end: end.lineNumber, endSide: end.side };
}

/**
 * web findDiffReviewLineIndex without expanded context: the row holding `lineNumber`
 * on `side`, falling back to the other side.
 */
export function findDiffReviewLineIndex(
  lines: ReadonlyArray<DiffReviewLine>,
  lineNumber: number,
  side: SelectionSide | undefined,
): number {
  const findOnSide = (selectedSide: "left" | "right") =>
    lines.findIndex((line) => {
      if (line.change === "context") {
        return (selectedSide === "left" ? line.oldLineNumber : line.newLineNumber) === lineNumber;
      }
      if (selectedSide === "left") return line.change === "delete" && line.oldLineNumber === lineNumber;
      return line.change === "add" && line.newLineNumber === lineNumber;
    });
  const selectedSide = side === "deletions" ? "left" : "right";
  const preferredIndex = findOnSide(selectedSide);
  return preferredIndex >= 0 ? preferredIndex : findOnSide(selectedSide === "left" ? "right" : "left");
}

function getDiffRange(
  lines: ReadonlyArray<DiffReviewLine>,
  key: "oldLineNumber" | "newLineNumber",
): { start: number; count: number } {
  const numberedLines = lines.filter((line) => line[key] !== null);
  return {
    start: numberedLines[0]?.[key] ?? 0,
    count: numberedLines.length,
  };
}

function getDiffChangeMarker(change: DiffReviewLine["change"]): string {
  if (change === "add") return "+";
  if (change === "delete") return "-";
  return " ";
}

function formatDiffReviewRangeLabel(lines: ReadonlyArray<DiffReviewLine>): string {
  const firstLine = lines[0];
  const lastLine = lines.at(-1);
  if (!firstLine || !lastLine) return "line";
  const firstNumber = firstLine.newLineNumber ?? firstLine.oldLineNumber;
  const lastNumber = lastLine.newLineNumber ?? lastLine.oldLineNumber;
  if (firstNumber === null || lastNumber === null) {
    return lines.length === 1 ? "line" : `${lines.length} lines`;
  }

  const firstMarker = getDiffChangeMarker(firstLine.change).trim();
  const marker =
    firstMarker.length > 0 && lines.every((line) => line.change === firstLine.change)
      ? firstMarker
      : "";
  return firstNumber === lastNumber
    ? `${marker}${firstNumber}`
    : `${marker}${firstNumber} to ${marker}${lastNumber}`;
}

export function buildDiffReviewComment(input: {
  id: string;
  sectionId: string;
  sectionTitle: string;
  filePath: string;
  lines: ReadonlyArray<DiffReviewLine>;
  range: SelectedLineRange;
  text: string;
}): ReviewCommentContext | null {
  const startIndex = findDiffReviewLineIndex(input.lines, input.range.start, input.range.side);
  const endIndex = findDiffReviewLineIndex(
    input.lines,
    input.range.end,
    input.range.endSide ?? input.range.side,
  );
  if (startIndex < 0 || endIndex < 0) return null;

  const normalizedStartIndex = Math.min(startIndex, endIndex);
  const normalizedEndIndex = Math.max(startIndex, endIndex);
  const selectedLines = input.lines.slice(normalizedStartIndex, normalizedEndIndex + 1);
  const oldRange = getDiffRange(selectedLines, "oldLineNumber");
  const newRange = getDiffRange(selectedLines, "newLineNumber");

  return {
    id: input.id,
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    filePath: input.filePath,
    startIndex: normalizedStartIndex,
    endIndex: normalizedEndIndex,
    rangeLabel: formatDiffReviewRangeLabel(selectedLines),
    text: input.text.trim(),
    diff: [
      `@@ -${oldRange.start},${oldRange.count} +${newRange.start},${newRange.count} @@`,
      ...selectedLines.map((line) => `${getDiffChangeMarker(line.change)}${line.content}`),
    ].join("\n"),
    fenceLanguage: "diff",
    selection: {
      start: input.range.start,
      side: input.range.side ?? "additions",
      end: input.range.end,
      endSide: input.range.endSide ?? input.range.side ?? "additions",
    },
  };
}
