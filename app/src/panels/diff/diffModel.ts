// Parses a unified git patch into the shape the Diff surface paints, the way
// @pierre/diffs (the web renderer) lays a patch out: per-file headers, hunks
// whose gaps become "N unmodified lines" separators (no raw "@@" rows), word
// emphasis between paired deletions and additions, and stacked or split rows.
import { expandTabs } from "../code/codeRows.tsx";
import { splitPatch, type PatchFile } from "./patchFiles.ts";
import type { DiffReviewLine } from "../../web/reviewCommentContext.ts";

export type DiffLineKind = "context" | "addition" | "deletion";

export interface DiffLine {
  readonly kind: DiffLineKind;
  /** Tabs expanded, for painting and column math. */
  readonly text: string;
  /** The line as the patch has it, for comments sent to the agent. */
  readonly raw: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  /** Index into the file's old-side source (context + deletions), for highlighting. */
  readonly oldIndex: number | null;
  /** Index into the file's new-side source (context + additions). */
  readonly newIndex: number | null;
  /** `\ No newline at end of file` followed this line. */
  readonly noNewline: boolean;
}

export interface DiffHunk {
  /** Unchanged lines hidden above this hunk (0 when unknown or adjacent). */
  readonly collapsedBefore: number;
  readonly lines: ReadonlyArray<DiffLine>;
  /** First old/new line number the hunk covers (the line after an empty side's anchor). */
  readonly oldStart: number;
  readonly newStart: number;
  /** Old/new lines the hunk covers, per its header. */
  readonly oldCount: number;
  readonly newCount: number;
  /** The patch hunk this one starts with, which keys the expansion of the gap above it. */
  readonly expandIndex: number;
}

export interface DiffFileModel extends PatchFile {
  readonly hunks: ReadonlyArray<DiffHunk>;
  /** Old-side source lines (context + deletions in order), joined with "\n". */
  readonly oldSource: string;
  readonly newSource: string;
  /** Widest line number, in digits. */
  readonly numberDigits: number;
  readonly binary: boolean;
  /**
   * Unchanged lines after the last hunk once the full file is known, or null when only
   * the patch is ("More unchanged context may be available").
   */
  readonly collapsedAfter: number | null;
  /** Gaps can be expanded: the full file contents are loaded (expandDiffFile). */
  readonly contentsLoaded: boolean;
  /** Hunks in the patch; the region key of the gap after the last one. */
  readonly patchHunkCount: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseFile(file: PatchFile): DiffFileModel {
  const hunks: DiffHunk[] = [];
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let current: DiffLine[] | null = null;
  let oldNo = 0;
  let newNo = 0;
  let previousEnd = 1;
  let maxLine = 1;
  let binary = false;
  // Lines still owed to the open hunk per its header; past them the hunk is over,
  // so trailing text (or a truncated patch's tail) is never read as code.
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of file.patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      const oldStart = Number(header[1]);
      const newStart = Number(header[3]);
      oldNo = oldStart;
      newNo = newStart;
      current = [];
      // A new file's first hunk starts at 0/1 with nothing hidden above it.
      const anchor = Math.max(oldStart, 1);
      const oldCount = Number(header[2] ?? 1);
      const newCount = Number(header[4] ?? 1);
      hunks.push({
        collapsedBefore: Math.max(0, anchor - previousEnd),
        lines: current,
        // An empty side's start is the line before the hunk (`@@ -5,0 +6,2 @@`).
        oldStart: oldCount === 0 ? oldStart + 1 : oldStart,
        newStart: newCount === 0 ? newStart + 1 : newStart,
        oldCount,
        newCount,
        expandIndex: hunks.length,
      });
      previousEnd = anchor + Number(header[2] ?? 1);
      oldLeft = Number(header[2] ?? 1);
      newLeft = Number(header[4] ?? 1);
      continue;
    }
    if (current === null) {
      if (raw.startsWith("Binary files ") || raw.startsWith("GIT binary patch")) binary = true;
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0 && !raw.startsWith("\\")) {
      current = null;
      continue;
    }
    if (raw.startsWith("\\")) {
      const last = current.at(-1);
      if (last) current[current.length - 1] = { ...last, noNewline: true };
      continue;
    }
    const marker = raw[0];
    // Tabs become spaces up front so highlighting, wrapping and emphasis share columns.
    const rawText = raw.slice(1).replace(/\r$/, "");
    const text = expandTabs(rawText);
    if (marker === "+") {
      current.push({ kind: "addition", text, raw: rawText, oldLine: null, newLine: newNo, oldIndex: null, newIndex: newLines.length, noNewline: false });
      newLines.push(text);
      maxLine = Math.max(maxLine, newNo);
      newNo += 1;
      newLeft -= 1;
    } else if (marker === "-") {
      current.push({ kind: "deletion", text, raw: rawText, oldLine: oldNo, newLine: null, oldIndex: oldLines.length, newIndex: null, noNewline: false });
      oldLines.push(text);
      maxLine = Math.max(maxLine, oldNo);
      oldNo += 1;
      oldLeft -= 1;
    } else if (marker === " ") {
      current.push({ kind: "context", text, raw: rawText, oldLine: oldNo, newLine: newNo, oldIndex: oldLines.length, newIndex: newLines.length, noNewline: false });
      oldLines.push(text);
      newLines.push(text);
      maxLine = Math.max(maxLine, oldNo, newNo);
      oldNo += 1;
      newNo += 1;
      oldLeft -= 1;
      newLeft -= 1;
    }
  }
  return {
    ...file,
    hunks,
    oldSource: oldLines.join("\n"),
    newSource: newLines.join("\n"),
    numberDigits: String(maxLine).length,
    binary,
    collapsedAfter: null,
    contentsLoaded: false,
    patchHunkCount: hunks.length,
  };
}

// ── Expanding unchanged context ──────────────────────────────────────────

/** Both sides of a file, as the review diffFileContents command returns them. */
export interface DiffFileContents {
  readonly oldContents: string;
  readonly newContents: string;
}

/** pierre's expanded region of one gap: lines shown from its start and from its end. */
export interface ExpandedRegion {
  readonly fromStart: number;
  readonly fromEnd: number;
}

/** pierre's expansionLineCount: lines one expand click reveals on a side. */
export const EXPANSION_LINE_COUNT = 100;

function sourceLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** review diffFileContents changeType for a file (pierre's FileDiffMetadata.type). */
export function diffFileChangeType(file: DiffFileModel): "change" | "rename-pure" | "rename-changed" | "new" | "deleted" {
  if (file.kind === "new") return "new";
  if (file.kind === "deleted") return "deleted";
  if (file.kind === "renamed") return file.hunks.length === 0 ? "rename-pure" : "rename-changed";
  return "change";
}

/**
 * The file with its full contents known: every line indexes the whole old/new file (so
 * highlighting covers revealed context), and each gap shows the lines its region reveals,
 * pierre-style: `fromStart` lines under the hunk above, `fromEnd` lines over the hunk below.
 * A gap revealed completely joins its two hunks. Regions are keyed by the patch hunk the
 * gap sits above; the gap after the last hunk is keyed by the hunk count.
 */
export function expandDiffFile(
  file: DiffFileModel,
  contents: DiffFileContents,
  regions: ReadonlyMap<number, ExpandedRegion>,
): DiffFileModel {
  if (file.binary || file.hunks.length === 0 || file.kind === "new" || file.kind === "deleted") return file;
  const oldRaw = sourceLines(contents.oldContents);
  const newRaw = sourceLines(contents.newContents);
  const oldText = oldRaw.map(expandTabs);
  const newText = newRaw.map(expandTabs);
  const reindex = (line: DiffLine): DiffLine => ({
    ...line,
    oldIndex: line.kind !== "addition" && line.oldLine !== null ? line.oldLine - 1 : null,
    newIndex: line.kind !== "deletion" && line.newLine !== null ? line.newLine - 1 : null,
  });
  const context = (oldNo: number, newNo: number): DiffLine => ({
    kind: "context",
    text: newText[newNo - 1] ?? oldText[oldNo - 1] ?? "",
    raw: newRaw[newNo - 1] ?? oldRaw[oldNo - 1] ?? "",
    oldLine: oldNo,
    newLine: newNo,
    oldIndex: oldNo - 1,
    newIndex: newNo - 1,
    noNewline: false,
  });
  const out: Array<{ hunk: DiffHunk; lines: DiffLine[] }> = [];
  let nextOld = 1;
  let nextNew = 1;
  file.hunks.forEach((hunk, index) => {
    const gap = Math.max(0, hunk.oldStart - nextOld);
    const region = regions.get(index) ?? { fromStart: 0, fromEnd: 0 };
    const previous = out.at(-1);
    // Above the first hunk there is nothing to grow from, so every revealed line sits over it.
    const top = previous ? Math.min(gap, region.fromStart) : 0;
    const bottom = Math.min(gap - top, previous ? region.fromEnd : region.fromStart + region.fromEnd);
    const remaining = gap - top - bottom;
    for (let offset = 0; offset < top; offset += 1) previous!.lines.push(context(nextOld + offset, nextNew + offset));
    const revealed: DiffLine[] = [];
    for (let offset = gap - bottom; offset < gap; offset += 1) revealed.push(context(nextOld + offset, nextNew + offset));
    const lines = [...revealed, ...hunk.lines.map(reindex)];
    if (previous && remaining === 0) previous.lines.push(...lines);
    else out.push({ hunk: { ...hunk, collapsedBefore: remaining }, lines });
    nextOld = hunk.oldStart + hunk.oldCount;
    nextNew = hunk.newStart + hunk.newCount;
  });
  const trailingGap = Math.max(0, oldText.length - nextOld + 1);
  const trailingRegion = regions.get(file.hunks.length) ?? { fromStart: 0, fromEnd: 0 };
  const trailingShown = Math.min(trailingGap, trailingRegion.fromStart + trailingRegion.fromEnd);
  const last = out.at(-1)!;
  for (let offset = 0; offset < trailingShown; offset += 1) last.lines.push(context(nextOld + offset, nextNew + offset));
  return {
    ...file,
    hunks: out.map(({ hunk, lines }) => ({ ...hunk, lines })),
    oldSource: oldText.join("\n"),
    newSource: newText.join("\n"),
    numberDigits: Math.max(file.numberDigits, String(Math.max(oldText.length, newText.length)).length),
    collapsedAfter: trailingGap - trailingShown,
    contentsLoaded: true,
  };
}

export function parseDiffFiles(patch: string | null | undefined): ReadonlyArray<DiffFileModel> {
  return splitPatch(patch).map(parseFile);
}

/** A file's rows in patch order, the way reviewCommentContext.ts indexes them. */
const reviewLinesCache = new WeakMap<DiffFileModel, ReadonlyArray<DiffReviewLine>>();
export function diffReviewLines(file: DiffFileModel): ReadonlyArray<DiffReviewLine> {
  const cached = reviewLinesCache.get(file);
  if (cached) return cached;
  const lines: DiffReviewLine[] = diffFileLines(file).map((line) => ({
    change: line.kind === "addition" ? "add" : line.kind === "deletion" ? "delete" : "context",
    oldLineNumber: line.kind === "addition" ? null : line.oldLine,
    newLineNumber: line.kind === "deletion" ? null : line.newLine,
    content: line.raw,
  }));
  reviewLinesCache.set(file, lines);
  return lines;
}

/** The DiffLine objects of `file` in patch order (the same order as diffReviewLines). */
export function diffFileLines(file: DiffFileModel): ReadonlyArray<DiffLine> {
  return file.hunks.flatMap((hunk) => hunk.lines);
}

// ── Word emphasis ─────────────────────────────────────────────────────────

export type Range = readonly [start: number, end: number];

const WORD = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
const MAX_WORD_DIFF_TOKENS = 400;

/**
 * Character ranges that changed between a deleted line and the addition it
 * pairs with, at word granularity (pierre's word diff). Null when the lines
 * share nothing worth marking.
 */
export function wordEmphasis(before: string, after: string): { before: Range[]; after: Range[] } | null {
  const left = before.match(WORD) ?? [];
  const right = after.match(WORD) ?? [];
  if (left.length === 0 || right.length === 0 || left.length * right.length > MAX_WORD_DIFF_TOKENS * MAX_WORD_DIFF_TOKENS) return null;
  // LCS table over tokens.
  const width = right.length + 1;
  const table = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        left[i] === right[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const keptLeft = new Array<boolean>(left.length).fill(false);
  const keptRight = new Array<boolean>(right.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      keptLeft[i] = true;
      keptRight[j] = true;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i += 1;
    else j += 1;
  }
  const common = keptLeft.filter(Boolean).length;
  // Nothing in common (a rewritten line): the whole-line tint already says it.
  if (common === 0) return null;
  const ranges = (tokens: string[], kept: boolean[]): Range[] => {
    const out: Array<[number, number]> = [];
    let offset = 0;
    tokens.forEach((token, index) => {
      const end = offset + token.length;
      // Whitespace-only changes stay unmarked unless they sit between changed words.
      if (!kept[index] && !/^\s+$/.test(token)) {
        const previous = out.at(-1);
        if (previous && /^\s*$/.test(tokens.slice(0, index).join("").slice(previous[1]))) previous[1] = end;
        else out.push([offset, end]);
      }
      offset = end;
    });
    return out;
  };
  return { before: ranges(left, keptLeft), after: ranges(right, keptRight) };
}

// ── Row model ─────────────────────────────────────────────────────────────

export type DiffLayout = "stacked" | "split";

/** One comment (or the open comment form) under a line, after AnnotatableCodeView's entries. */
export interface DiffCommentEntry {
  readonly id: string;
  /** "external": drawn by the caller (DiffView `renderAnnotation`), e.g. a pull request review thread. */
  readonly kind: "draft" | "comment" | "external";
  readonly rangeLabel: string;
  readonly text: string;
}

/** pierre's DiffLineAnnotation: the entries that hang under (side, lineNumber). */
export interface DiffLineAnnotation {
  readonly side: "additions" | "deletions";
  readonly lineNumber: number;
  readonly entries: ReadonlyArray<DiffCommentEntry>;
}

function annotationMatches(annotation: DiffLineAnnotation, line: DiffLine, side: "old" | "new" | "any"): boolean {
  if (annotation.side === "additions") {
    return side !== "old" && line.kind !== "deletion" && line.newLine === annotation.lineNumber;
  }
  return side !== "new" && line.kind !== "addition" && line.oldLine === annotation.lineNumber;
}

/** One side of a painted line. */
export interface LineCell {
  readonly line: DiffLine;
  readonly emphasis: ReadonlyArray<Range>;
}

export type DiffRow =
  | { readonly type: "header"; readonly key: string; readonly file: DiffFileModel; readonly collapsed: boolean }
  | {
      readonly type: "separator";
      readonly key: string;
      readonly file: DiffFileModel;
      readonly text: string;
      readonly direction: "up" | "down" | "both";
      readonly first: boolean;
      readonly last: boolean;
      readonly split: boolean;
      /** The gap's region key (expandDiffFile). */
      readonly expandIndex: number;
      /** Hidden line count, or null when unknown (the trailing gap of a patch-only file). */
      readonly hidden: number | null;
    }
  | { readonly type: "line"; readonly key: string; readonly file: DiffFileModel; readonly cell: LineCell }
  | { readonly type: "split"; readonly key: string; readonly file: DiffFileModel; readonly left: LineCell | null; readonly right: LineCell | null }
  | { readonly type: "binary"; readonly key: string; readonly file: DiffFileModel }
  | {
      readonly type: "annotation";
      readonly key: string;
      readonly file: DiffFileModel;
      readonly annotation: DiffLineAnnotation;
      /** Split rows put the annotation under its own side. */
      readonly half: "full" | "left" | "right";
    }
  | { readonly type: "end"; readonly key: string; readonly file: DiffFileModel };

function unmodifiedLabel(count: number): string {
  return `${count} unmodified line${count === 1 ? "" : "s"}`;
}

/** Pairs each run of deletions with the additions that follow it, like pierre's change blocks. */
function pairHunk(lines: ReadonlyArray<DiffLine>): Array<{ left: LineCell | null; right: LineCell | null }> {
  const out: Array<{ left: LineCell | null; right: LineCell | null }> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind === "context") {
      out.push({ left: { line, emphasis: [] }, right: { line, emphasis: [] } });
      index += 1;
      continue;
    }
    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (index < lines.length && lines[index]!.kind === "deletion") deletions.push(lines[index++]!);
    while (index < lines.length && lines[index]!.kind === "addition") additions.push(lines[index++]!);
    const count = Math.max(deletions.length, additions.length);
    for (let pair = 0; pair < count; pair += 1) {
      const before = deletions[pair];
      const after = additions[pair];
      const emphasis = before && after ? wordEmphasis(before.text, after.text) : null;
      out.push({
        left: before ? { line: before, emphasis: emphasis?.before ?? [] } : null,
        right: after ? { line: after, emphasis: emphasis?.after ?? [] } : null,
      });
    }
  }
  return out;
}

export function buildDiffRows(
  files: ReadonlyArray<DiffFileModel>,
  preferredLayout: DiffLayout,
  collapsed: ReadonlySet<string>,
  annotationsByPath?: ReadonlyMap<string, ReadonlyArray<DiffLineAnnotation>>,
): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const file of files) {
    const annotations = annotationsByPath?.get(file.path) ?? [];
    // Each annotation shows once, under the first line it matches.
    const placed = new Set<DiffLineAnnotation>();
    const pushAnnotations = (line: DiffLine | null | undefined, side: "old" | "new" | "any", half: "full" | "left" | "right") => {
      if (!line || annotations.length === 0) return;
      for (const annotation of annotations) {
        if (placed.has(annotation) || !annotationMatches(annotation, line, side)) continue;
        placed.add(annotation);
        rows.push({
          type: "annotation",
          key: `a:${file.path}:${annotation.side}:${annotation.lineNumber}`,
          file,
          annotation,
          half,
        });
      }
    };
    // pierre paints an added or deleted file as one column even in split view.
    const layout: DiffLayout = file.kind === "new" || file.kind === "deleted" ? "stacked" : preferredLayout;
    const isCollapsed = collapsed.has(file.path);
    rows.push({ type: "header", key: `h:${file.path}`, file, collapsed: isCollapsed });
    if (isCollapsed) continue;
    if (file.hunks.length === 0) {
      rows.push({ type: "binary", key: `b:${file.path}`, file });
      rows.push({ type: "end", key: `e:${file.path}`, file });
      continue;
    }
    const trailing = file.kind !== "new" && file.kind !== "deleted";
    file.hunks.forEach((hunk, hunkIndex) => {
      if (hunk.collapsedBefore > 0) {
        rows.push({
          type: "separator",
          key: `s:${file.path}:${hunkIndex}`,
          file,
          text: unmodifiedLabel(hunk.collapsedBefore),
          direction: hunkIndex === 0 ? "up" : "both",
          first: hunkIndex === 0,
          last: false,
          split: layout === "split",
          expandIndex: hunk.expandIndex,
          hidden: hunk.collapsedBefore,
        });
      }
      const paired = pairHunk(hunk.lines);
      paired.forEach((pair, lineIndex) => {
        const key = `l:${file.path}:${hunkIndex}:${lineIndex}`;
        if (layout === "split") {
          rows.push({ type: "split", key, file, left: pair.left, right: pair.right });
          pushAnnotations(pair.left?.line, "old", "left");
          pushAnnotations(pair.right?.line, "new", "right");
        }
      });
      if (layout === "stacked") {
        // Stacked keeps the patch order (deletions above their additions) with
        // the same emphasis the split pairing computed.
        const emphasisByLine = new Map<DiffLine, ReadonlyArray<Range>>();
        for (const pair of paired) {
          if (pair.left && pair.left.line.kind !== "context") emphasisByLine.set(pair.left.line, pair.left.emphasis);
          if (pair.right && pair.right.line.kind !== "context") emphasisByLine.set(pair.right.line, pair.right.emphasis);
        }
        hunk.lines.forEach((line, lineIndex) => {
          rows.push({ type: "line", key: `l:${file.path}:${hunkIndex}:${lineIndex}`, file, cell: { line, emphasis: emphasisByLine.get(line) ?? [] } });
          pushAnnotations(line, "any", "full");
        });
      }
    });
    if (trailing && file.collapsedAfter !== 0) {
      rows.push({
        type: "separator",
        key: `s:${file.path}:end`,
        file,
        text: file.collapsedAfter === null ? "More unchanged context may be available" : unmodifiedLabel(file.collapsedAfter),
        direction: "down",
        first: false,
        last: true,
        split: layout === "split",
        // The gap after the last patch hunk.
        expandIndex: file.patchHunkCount,
        hidden: file.collapsedAfter,
      });
    }
    rows.push({ type: "end", key: `e:${file.path}`, file });
  }
  return rows;
}
