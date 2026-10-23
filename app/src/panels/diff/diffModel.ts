// Parses a unified git patch into the shape the Diff surface paints, the way
// @pierre/diffs (the web renderer) lays a patch out: per-file headers, hunks
// whose gaps become "N unmodified lines" separators (no raw "@@" rows), word
// emphasis between paired deletions and additions, and stacked or split rows.
import { expandTabs } from "../code/codeRows.tsx";
import { splitPatch, type PatchFile } from "./patchFiles.ts";

export type DiffLineKind = "context" | "addition" | "deletion";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
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
}

export interface DiffFileModel extends PatchFile {
  readonly hunks: ReadonlyArray<DiffHunk>;
  /** Old-side source lines (context + deletions in order), joined with "\n". */
  readonly oldSource: string;
  readonly newSource: string;
  /** Widest line number, in digits. */
  readonly numberDigits: number;
  readonly binary: boolean;
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
      hunks.push({ collapsedBefore: Math.max(0, anchor - previousEnd), lines: current });
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
    const text = expandTabs(raw.slice(1).replace(/\r$/, ""));
    if (marker === "+") {
      current.push({ kind: "addition", text, oldLine: null, newLine: newNo, oldIndex: null, newIndex: newLines.length, noNewline: false });
      newLines.push(text);
      maxLine = Math.max(maxLine, newNo);
      newNo += 1;
      newLeft -= 1;
    } else if (marker === "-") {
      current.push({ kind: "deletion", text, oldLine: oldNo, newLine: null, oldIndex: oldLines.length, newIndex: null, noNewline: false });
      oldLines.push(text);
      maxLine = Math.max(maxLine, oldNo);
      oldNo += 1;
      oldLeft -= 1;
    } else if (marker === " ") {
      current.push({ kind: "context", text, oldLine: oldNo, newLine: newNo, oldIndex: oldLines.length, newIndex: newLines.length, noNewline: false });
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
  };
}

export function parseDiffFiles(patch: string | null | undefined): ReadonlyArray<DiffFileModel> {
  return splitPatch(patch).map(parseFile);
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
    }
  | { readonly type: "line"; readonly key: string; readonly file: DiffFileModel; readonly cell: LineCell }
  | { readonly type: "split"; readonly key: string; readonly file: DiffFileModel; readonly left: LineCell | null; readonly right: LineCell | null }
  | { readonly type: "binary"; readonly key: string; readonly file: DiffFileModel }
  | { readonly type: "end"; readonly key: string; readonly file: DiffFileModel }
  | {
      readonly type: "annotation";
      readonly key: string;
      readonly file: DiffFileModel;
      readonly annotation: DiffLineAnnotation;
    };

/**
 * Content drawn under one line (pierre's line annotations): review threads, pending comments,
 * a comment draft. `additions` anchors to a new-side line number, `deletions` to an old-side one.
 */
export interface DiffLineAnnotation {
  readonly key: string;
  readonly side: "additions" | "deletions";
  readonly lineNumber: number;
}

function annotationMatches(annotation: DiffLineAnnotation, line: DiffLine): boolean {
  return annotation.side === "additions"
    ? line.kind !== "deletion" && line.newLine === annotation.lineNumber
    : line.kind !== "addition" && line.oldLine === annotation.lineNumber;
}

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
  annotations?: ReadonlyMap<string, ReadonlyArray<DiffLineAnnotation>>,
): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const file of files) {
    const fileAnnotations = annotations?.get(file.path) ?? [];
    // A context line carries both line numbers; each annotation is drawn once, under the first
    // line that matches it.
    const placed = new Set<string>();
    const annotate = (lines: ReadonlyArray<DiffLine | null | undefined>) => {
      if (fileAnnotations.length === 0) return;
      for (const annotation of fileAnnotations) {
        if (placed.has(annotation.key)) continue;
        if (!lines.some((line) => line && annotationMatches(annotation, line))) continue;
        placed.add(annotation.key);
        rows.push({ type: "annotation", key: `a:${file.path}:${annotation.key}`, file, annotation });
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
        });
      }
      const paired = pairHunk(hunk.lines);
      paired.forEach((pair, lineIndex) => {
        const key = `l:${file.path}:${hunkIndex}:${lineIndex}`;
        if (layout === "split") {
          rows.push({ type: "split", key, file, left: pair.left, right: pair.right });
          annotate([pair.left?.line, pair.right?.line]);
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
          annotate([line]);
        });
      }
    });
    if (trailing) {
      rows.push({
        type: "separator",
        key: `s:${file.path}:end`,
        file,
        text: "More unchanged context may be available",
        direction: "down",
        first: false,
        last: true,
        split: layout === "split",
      });
    }
    rows.push({ type: "end", key: `e:${file.path}`, file });
  }
  return rows;
}
