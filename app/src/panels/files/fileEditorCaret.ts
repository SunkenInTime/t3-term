// Where the caret of the Files editor's focused chunk textarea can be, from what
// JavaScript sees of it.
//
// gpuix's <textarea> reports neither its caret nor its selection (input.rs emits only
// `change` and `submit`). What reaches JavaScript: every change (the whole new value),
// every key release (arrows, Home/End and Backspace are textarea actions, so their
// key-downs never do), and presses on the chunk. A held key auto-repeats with a single
// release, so one release proves "at least one step", not "one step". The model is
// therefore an interval of offsets the caret may be at, exact when its ends meet, plus
// a guess that assumes every release was a single press. Moves across chunks and
// Shift+Tab act only on what the interval proves; the guess only steers harmless
// choices (which row to scroll to, tab or spaces).

export interface Caret {
  /** Chunk whose textarea holds the caret (`Chunk.id`, stable across edits). */
  readonly chunkId: number;
  /** The caret is somewhere in [lo, hi] (UTF-16 offsets in the chunk's text). */
  readonly lo: number;
  readonly hi: number;
  /** Where it is if every key release was one press, or null when nothing suggests a spot. */
  readonly guess: number | null;
  /** The selection's other end: null for none, a number when known, "maybe" when there may be one. */
  readonly anchor: number | null | "maybe";
}

export function exactCaret(chunkId: number, offset: number, anchor: number | null = null): Caret {
  return { chunkId, lo: offset, hi: offset, guess: offset, anchor: anchor === offset ? null : anchor };
}

export function unknownCaret(chunkId: number, length: number): Caret {
  return { chunkId, lo: 0, hi: length, guess: null, anchor: "maybe" };
}

export function isExact(caret: Caret): boolean {
  return caret.lo === caret.hi;
}

// ── Layout ──

/** One visual row of a chunk: [start, end) in the chunk's text, without the newline. */
export interface Row {
  readonly start: number;
  readonly end: number;
  /** Line index within the chunk. */
  readonly line: number;
  /** Whether the row before it ends at a soft wrap (so `start` is also the previous row's end). */
  readonly wrapped: boolean;
}

export interface ChunkLayout {
  readonly text: string;
  readonly lines: ReadonlyArray<string>;
  /** Offset of each line's first character. */
  readonly lineStarts: ReadonlyArray<number>;
  readonly rows: ReadonlyArray<Row>;
}

/** Rows as the textarea wraps them: `wrapAt` returns a line's soft-wrap offsets (none when not wrapping). */
export function layoutChunk(lines: ReadonlyArray<string>, wrapAt: (line: string) => ReadonlyArray<number>): ChunkLayout {
  const rows: Row[] = [];
  const lineStarts: number[] = [];
  let offset = 0;
  lines.forEach((text, line) => {
    lineStarts.push(offset);
    let from = 0;
    let wrapped = false;
    for (const boundary of wrapAt(text)) {
      rows.push({ start: offset + from, end: offset + boundary, line, wrapped });
      from = boundary;
      wrapped = true;
    }
    rows.push({ start: offset + from, end: offset + text.length, line, wrapped });
    offset += text.length + 1;
  });
  return { text: lines.join("\n"), lines, lineStarts, rows };
}

/**
 * The row an offset is on. An offset at a soft wrap is the end of one row and the start
 * of the next; `bias` picks which.
 */
export function rowAt(layout: ChunkLayout, offset: number, bias: "before" | "after" = "after"): number {
  const rows = layout.rows;
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (rows[mid]!.start <= offset) low = mid;
    else high = mid - 1;
  }
  if (bias === "before" && low > 0 && rows[low]!.wrapped && rows[low]!.start === offset) return low - 1;
  return low;
}

export function lineAt(layout: ChunkLayout, offset: number): number {
  return layout.rows[rowAt(layout, offset)]!.line;
}

/**
 * Columns from `from` to `to`, as the textarea paints them: GPUI shapes a tab with no
 * advance (Zed expands tabs in its editor, not in the text system).
 */
export function columnsBetween(text: string, from: number, to: number): number {
  let columns = 0;
  for (const char of text.slice(from, to)) if (char !== "\t") columns += 1;
  return columns;
}

/** The offset on `row` closest to `column`, like GPUI's closest_index_for_position. */
export function offsetAtColumn(layout: ChunkLayout, rowIndex: number, column: number): number {
  const row = layout.rows[rowIndex]!;
  let offset = row.start;
  let columns = 0;
  for (const char of layout.text.slice(row.start, row.end)) {
    const width = char === "\t" ? 0 : 1;
    if (columns + width / 2 > column) break;
    columns += width;
    offset += char.length;
  }
  return offset;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// ── Changes ──

export interface ChangeRegion {
  /** Earliest and latest offset the edit can have started at (equal unless it sits in a run of one character). */
  readonly startLo: number;
  readonly startHi: number;
  /** Characters inserted and removed. */
  readonly inserted: number;
  readonly removed: number;
}

/**
 * Where `next` differs from `prev`. Typing a space into a run of spaces could have
 * happened anywhere in the run; the region keeps that whole range.
 */
export function diffRegion(prev: string, next: string): ChangeRegion {
  const shorter = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < shorter && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (suffix < shorter && prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) suffix += 1;
  if (prefix + suffix >= shorter) {
    // A pure insertion or deletion: it starts anywhere both the prefix and suffix allow.
    const startLo = Math.max(0, shorter - suffix);
    const startHi = Math.min(prefix, shorter);
    return {
      startLo: Math.min(startLo, startHi),
      startHi,
      inserted: Math.max(0, next.length - prev.length),
      removed: Math.max(0, prev.length - next.length),
    };
  }
  return { startLo: prefix, startHi: prefix, inserted: next.length - suffix - prefix, removed: prev.length - suffix - prefix };
}

/**
 * The caret after a change. Typing and deleting happen at the caret, so when the model
 * held no selection the region is narrowed to starts the old caret allows: typing at a
 * known spot in a run of spaces stays exact.
 */
export function caretAfterChange(caret: Caret | null, chunkId: number, prev: string, next: string): { caret: Caret; region: ChangeRegion } {
  const region = diffRegion(prev, next);
  let startLo = region.startLo;
  let startHi = region.startHi;
  let guess: number | null = null;
  if (caret && caret.chunkId === chunkId && caret.anchor === null && (region.inserted === 0 || region.removed === 0)) {
    // An insertion starts at the caret; a deletion ends at it (Backspace) or starts at it (Delete).
    const fromLo = region.removed > 0 ? caret.lo - region.removed : caret.lo;
    const narrowedLo = Math.max(startLo, fromLo);
    const narrowedHi = Math.min(startHi, caret.hi);
    if (narrowedLo <= narrowedHi) {
      startLo = narrowedLo;
      startHi = narrowedHi;
    }
    if (caret.guess !== null) {
      const candidate = region.removed > 0 && caret.guess - region.removed >= startLo ? caret.guess - region.removed : caret.guess;
      if (candidate >= startLo && candidate <= startHi) guess = candidate + region.inserted;
    }
  }
  const lo = startLo + region.inserted;
  const hi = startHi + region.inserted;
  return { caret: { chunkId, lo, hi, guess: guess ?? hi, anchor: null }, region };
}

// ── Key releases ──

export type CaretAction =
  | { readonly type: "crossUp"; readonly column: number }
  | { readonly type: "crossDown"; readonly column: number }
  | { readonly type: "crossLeft" }
  | { readonly type: "crossRight" };

export interface KeyRelease {
  readonly key: string;
  readonly shift: boolean;
  /** The word-move modifier was held: Alt on macOS, Ctrl elsewhere. */
  readonly word: boolean;
  /** The shortcut modifier was held: Cmd on macOS, Ctrl elsewhere. */
  readonly shortcut: boolean;
  /** Any modifier besides Shift. */
  readonly modified: boolean;
}

/**
 * The model after a key release, and what the press proved about a chunk edge. `layout`
 * is the chunk the caret is in. A cross is returned only when the interval held before
 * the press proves the press could not move inside the chunk.
 */
export function caretAfterRelease(caret: Caret, release: KeyRelease, layout: ChunkLayout): { caret: Caret; action: CaretAction | null } {
  const length = layout.text.length;
  const lastRow = layout.rows.length - 1;
  const { key, shift } = release;
  const at = (lo: number, hi: number, guess: number | null, anchor: Caret["anchor"]): Caret => ({
    chunkId: caret.chunkId,
    lo,
    hi,
    guess,
    anchor: anchor === lo && lo === hi ? null : anchor,
  });

  if (release.shortcut && !shift && key === "a") return { caret: at(length, length, length, 0), action: null };
  if (release.shortcut && (key === "z" || key === "y")) {
    // Undo and redo put back a remembered selection; the change already moved lo/hi near it.
    return { caret: { ...caret, anchor: "maybe" }, action: null };
  }
  const vertical = key === "up" || key === "down";
  if (!vertical && key !== "left" && key !== "right" && key !== "home" && key !== "end") return { caret, action: null };
  if (release.modified && !release.word) return { caret: unknownCaret(caret.chunkId, length), action: null };

  // Shift extends from the old caret; anything else collapses the selection.
  const anchor: Caret["anchor"] = shift ? (caret.anchor ?? (isExact(caret) ? caret.lo : "maybe")) : null;
  const plain = !shift && caret.anchor === null && !release.modified;
  const guess = caret.guess;

  if (release.word) {
    if (vertical || key === "home" || key === "end") return { caret: unknownCaret(caret.chunkId, length), action: null };
    // Word moves skip whitespace, newlines included: only the direction is known.
    return key === "left"
      ? { caret: at(0, Math.max(0, caret.hi - 1), null, anchor), action: null }
      : { caret: at(Math.min(length, caret.lo + 1), length, null, anchor), action: null };
  }

  if (key === "left" || key === "right") {
    if (!shift && caret.anchor !== null) {
      // Left/Right with a selection collapse it to its start or end.
      if (typeof caret.anchor === "number" && isExact(caret)) {
        const end = key === "left" ? Math.min(caret.anchor, caret.lo) : Math.max(caret.anchor, caret.lo);
        return { caret: exactCaret(caret.chunkId, end), action: null };
      }
      return { caret: key === "left" ? at(0, caret.hi, null, null) : at(caret.lo, length, null, null), action: null };
    }
    if (key === "left") {
      if (caret.hi === 0) return { caret: at(0, 0, 0, anchor), action: plain ? { type: "crossLeft" } : null };
      const step = guess === null || guess === 0 ? null : guess - graphemeLengthBefore(layout.text, guess);
      return { caret: at(0, caret.hi - graphemeLengthBefore(layout.text, caret.hi), step, anchor), action: null };
    }
    if (caret.lo === length) return { caret: at(length, length, length, anchor), action: plain ? { type: "crossRight" } : null };
    const step = guess === null || guess === length ? null : guess + graphemeLengthAfter(layout.text, guess);
    return { caret: at(caret.lo + graphemeLengthAfter(layout.text, caret.lo), length, step, anchor), action: null };
  }

  // An offset at a soft wrap could be on either row; every test below takes the reading
  // that proves less.
  const guessRow = guess === null ? null : rowAt(layout, guess, key === "up" ? "after" : "before");
  const column = guessRow === null || guess === null ? 0 : columnsBetween(layout.text, layout.rows[guessRow]!.start, guess);

  if (key === "up") {
    const topRow = rowAt(layout, caret.hi, "after");
    // On the first row, Up goes to the chunk's start (input.rs vertical_target).
    if (topRow === 0) return { caret: at(0, 0, 0, anchor), action: plain ? { type: "crossUp", column } : null };
    const step = guessRow === null || guessRow === 0 ? null : offsetAtColumn(layout, guessRow - 1, column);
    return { caret: at(0, layout.rows[topRow - 1]!.end, step, anchor), action: null };
  }
  if (key === "down") {
    const bottomRow = rowAt(layout, caret.lo, "before");
    // On the last row, Down goes to the chunk's end.
    if (bottomRow === lastRow) return { caret: at(length, length, length, anchor), action: plain ? { type: "crossDown", column } : null };
    const step = guessRow === null || guessRow === lastRow ? null : offsetAtColumn(layout, guessRow + 1, column);
    return { caret: at(layout.rows[bottomRow + 1]!.start, length, step, anchor), action: null };
  }

  // Home/End go to the edge of the caret's visual row: exact when the row is known.
  const edge = (row: number) => (key === "home" ? layout.rows[row]!.start : layout.rows[row]!.end);
  const lo = edge(rowAt(layout, caret.lo, "before"));
  const hi = edge(rowAt(layout, caret.hi, "after"));
  return { caret: at(lo, hi, guessRow === null ? null : edge(guessRow), anchor), action: null };
}

function graphemeLengthBefore(text: string, offset: number): number {
  let last = 0;
  for (const segment of graphemes.segment(text.slice(Math.max(0, offset - 16), offset))) last = segment.segment.length;
  return last || 1;
}

function graphemeLengthAfter(text: string, offset: number): number {
  for (const segment of graphemes.segment(text.slice(offset, offset + 16))) return segment.segment.length;
  return 1;
}

// ── Indentation (pierre's indent/outdent commands, editor.js and resolveIndentEdits) ──

/** pierre's tab size (`--diffs-tab-size`, 2 by default). */
export const TAB_SIZE = 2;

/** What Tab inserts on a line: a tab when the line starts with one, else TAB_SIZE spaces. */
export function indentUnitFor(line: string): string {
  return line.startsWith("\t") ? "\t" : " ".repeat(TAB_SIZE);
}

/** How many leading characters Shift+Tab removes from a line. */
export function outdentLength(line: string): number {
  if (line.startsWith("\t")) return 1;
  const spaces = line.length - line.trimStart().length;
  let leadingSpaces = 0;
  while (leadingSpaces < spaces && line[leadingSpaces] === " ") leadingSpaces += 1;
  return Math.min(TAB_SIZE, leadingSpaces);
}

/**
 * The file's own indent when the caret's line is not known: a tab if most indented
 * lines start with one.
 */
export function fileIndentUnit(lines: ReadonlyArray<string>): string {
  let tabs = 0;
  let spaces = 0;
  for (const line of lines) {
    if (line.startsWith("\t")) tabs += 1;
    else if (line.startsWith(" ")) spaces += 1;
  }
  return tabs > spaces ? "\t" : " ".repeat(TAB_SIZE);
}
