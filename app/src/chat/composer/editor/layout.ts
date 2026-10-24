// Line layout for the composer document. gpuix has no inline formatting context and its
// <textarea> cannot hold chips, so the editor lays text out here, with GPUI's own
// character widths (chat/markdown/measure.ts), and paints each visual line itself. The
// same layout answers where the caret is, which offset a click lands on, and where Up and
// Down go.
//
// Wrapping follows the web editor's CSS: `white-space: pre-wrap` (breaks after spaces,
// spaces at a line end hang), `overflow-wrap: break-word` in paragraphs and `anywhere` in
// code, and chips as atomic inline boxes a line may break around.
//
// List items sit in their list's gutter and lists keep their block margins, as web's
// composer CSS lays them out (apps/web/src/index.css: `.composer-tiptap ul/ol`, the
// `--list-gutter` rules, `ul[data-type="taskList"]`, `li[data-checked]`).
import { assistantCitationLabel } from "@t3tools/shared/assistantCitations";

import { advanceEm, type FontFace, graphemeList } from "../../markdown/measure.ts";
import { chipMetrics } from "../../markdown/MarkdownChips.tsx";
import { ATOM_CHAR, type Atom, type Block, type Doc, type Pos, atomIndexAt } from "./doc.ts";
import { type ItemPlace, type ListNode, listPlaces } from "./lists.ts";

export interface EditorMetrics {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly codeFontSize: number;
  readonly codeLineHeight: number;
  /** Code block card: header height, body padding, border, gap to neighbouring blocks. */
  readonly codeHeader: number;
  readonly codePadX: number;
  readonly codePadTop: number;
  readonly codePadBottom: number;
  readonly codeMarginY: number;
  /** A bullet or ordered list's block margin (web `margin: 0.65rem 0`); task lists have none. */
  readonly listMarginY: number;
}

export const SANS: FontFace = { family: "sans", weight: 400 };
export const SANS_MEDIUM: FontFace = { family: "sans", weight: 500 };
export const MONO: FontFace = { family: "mono", weight: 400 };

export interface TextPiece {
  readonly kind: "text";
  readonly start: number;
  readonly end: number;
  readonly x: number;
  readonly width: number;
}

export interface AtomPiece {
  readonly kind: "atom";
  readonly offset: number;
  readonly x: number;
  readonly width: number;
  readonly atom: Atom;
}

export type Piece = TextPiece | AtomPiece;

export interface VisualLine {
  readonly start: number;
  readonly end: number;
  /** Top, relative to the block's text area. */
  readonly y: number;
  readonly height: number;
  readonly pieces: ReadonlyArray<Piece>;
  /** Advance of the line's content including hanging spaces. */
  readonly width: number;
}

/** web's list markers: the ::marker of a bullet or ordered item, a task item's checkbox. */
export type ListMarker =
  | { readonly kind: "disc" | "circle" | "square"; readonly contentX: number }
  | { readonly kind: "text"; readonly text: string; readonly x: number }
  | { readonly kind: "checkbox"; readonly x: number; readonly checked: boolean };

export interface BlockLayout {
  readonly block: Block;
  /** A list item's marker, painted beside its first line. */
  readonly marker?: ListMarker;
  /** Top of the block in the document. */
  readonly y: number;
  readonly height: number;
  /** Where the text lines start, relative to the document. */
  readonly textX: number;
  readonly textY: number;
  readonly lines: ReadonlyArray<VisualLine>;
  readonly face: FontFace;
  readonly fontSize: number;
}

export interface DocLayout {
  readonly blocks: ReadonlyArray<BlockLayout>;
  readonly width: number;
  readonly height: number;
}

/** Chip box width for an atom set in a paragraph of `fontSize`. */
export function atomWidth(atom: Atom, fontSize: number, maxWidth: number): number {
  const metrics = chipMetrics(fontSize);
  const label = atomLabel(atom);
  let labelWidth = textAdvance(SANS_MEDIUM, metrics.fontSize, label);
  // web ContextChipLabel max-w-[16em] on citations.
  if (atom.kind === "citation") labelWidth = Math.min(labelWidth, metrics.fontSize * 16);
  // The citation's comment button: the chip's gap, then ml-[0.17em] size-[1.17em].
  const action = atom.kind === "citation" ? metrics.gap + metrics.fontSize * (0.17 + 1.17) : 0;
  const natural = 2 + 2 * metrics.padX + metrics.icon + metrics.gap + labelWidth + action;
  return Math.ceil(Math.min(natural, Math.max(40, maxWidth)));
}

export function atomLabel(atom: Atom): string {
  switch (atom.kind) {
    case "mention": {
      const path = atom.path.replace(/[\\/]+$/, "");
      const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      return slash >= 0 ? path.slice(slash + 1) : path;
    }
    case "skill":
      return atom.label || atom.name;
    case "citation":
      return assistantCitationLabel(atom.citation);
    case "context":
      return atom.label;
  }
}

const TAB_SPACES = 4;

function charAdvance(face: FontFace, size: number, char: string): number {
  if (char === "\t") return advanceEm(face, " ") * size * TAB_SPACES;
  if (char === "\n") return 0;
  return advanceEm(face, char) * size;
}

export function textAdvance(face: FontFace, size: number, text: string): number {
  let width = 0;
  for (const char of graphemeList(text)) width += charAdvance(face, size, char);
  return width;
}

interface Unit {
  readonly start: number;
  readonly end: number;
  readonly width: number;
  readonly kind: "word" | "space" | "atom";
  readonly atom?: Atom;
}

function unitsOf(text: string, atoms: ReadonlyArray<Atom>, face: FontFace, size: number, maxWidth: number): Unit[] {
  const units: Unit[] = [];
  let atomIndex = 0;
  let index = 0;
  const chars = graphemeList(text);
  let offset = 0;
  while (index < chars.length) {
    const char = chars[index]!;
    if (char === ATOM_CHAR) {
      const atom = atoms[atomIndex++]!;
      units.push({ start: offset, end: offset + 1, width: atomWidth(atom, size, maxWidth), kind: "atom", atom });
      offset += 1;
      index += 1;
      continue;
    }
    const space = char === " " || char === "\t";
    const start = offset;
    let width = 0;
    while (index < chars.length) {
      const next = chars[index]!;
      if (next === ATOM_CHAR || (next === " " || next === "\t") !== space) break;
      width += charAdvance(face, size, next);
      offset += next.length;
      index += 1;
      if (space) break;
    }
    units.push({ start, end: offset, width, kind: space ? "space" : "word" });
  }
  return units;
}

/** Breaks a word too long for a line at grapheme boundaries (overflow-wrap). */
function splitWord(text: string, unit: Unit, face: FontFace, size: number, available: number, full: number): Unit[] {
  const out: Unit[] = [];
  let start = unit.start;
  let width = 0;
  let limit = available;
  let offset = unit.start;
  for (const char of graphemeList(text.slice(unit.start, unit.end))) {
    const advance = charAdvance(face, size, char);
    if (width + advance > limit && offset > start) {
      out.push({ start, end: offset, width, kind: "word" });
      start = offset;
      width = 0;
      limit = full;
    }
    width += advance;
    offset += char.length;
  }
  out.push({ start, end: offset, width, kind: "word" });
  return out;
}

/** Visual lines of one line of text (no newlines inside). */
function wrapText(
  text: string,
  atoms: ReadonlyArray<Atom>,
  from: number,
  face: FontFace,
  size: number,
  width: number,
  lineHeight: number,
  y0: number,
): VisualLine[] {
  const lines: VisualLine[] = [];
  const units = unitsOf(text, atoms, face, size, width).map((unit) => ({ ...unit, start: unit.start + from, end: unit.end + from }));
  let pieces: Piece[] = [];
  let lineStart = from;
  let x = 0;
  let contentWidth = 0;
  let textStart = -1;
  let textX = 0;
  const flushText = (end: number) => {
    if (textStart >= 0 && end > textStart) pieces.push({ kind: "text", start: textStart, end, x: textX, width: x - textX });
    textStart = -1;
  };
  const endLine = (end: number) => {
    flushText(end);
    lines.push({ start: lineStart, end, y: y0 + lines.length * lineHeight, height: lineHeight, pieces, width: x });
    pieces = [];
    lineStart = end;
    x = 0;
    contentWidth = 0;
  };
  const queue = [...units];
  while (queue.length > 0) {
    const unit = queue.shift()!;
    if (unit.kind === "space") {
      if (textStart < 0) {
        textStart = unit.start;
        textX = x;
      }
      x += unit.width;
      continue;
    }
    const fits = contentWidth === 0 || x + unit.width <= width + 0.01;
    if (!fits) {
      endLine(unit.start);
    }
    if (unit.kind === "word" && unit.width > width - x + 0.01 && x === 0) {
      const parts = splitWord(text, { ...unit, start: unit.start - from, end: unit.end - from }, face, size, width, width).map(
        (part) => ({ ...part, start: part.start + from, end: part.end + from }),
      );
      if (parts.length > 1) {
        queue.unshift(...parts.slice(1));
        const first = parts[0]!;
        if (textStart < 0) {
          textStart = first.start;
          textX = x;
        }
        x += first.width;
        contentWidth = x;
        endLine(first.end);
        continue;
      }
    }
    if (unit.kind === "atom") {
      flushText(unit.start);
      pieces.push({ kind: "atom", offset: unit.start, x, width: unit.width, atom: unit.atom! });
      x += unit.width;
      contentWidth = x;
      continue;
    }
    if (textStart < 0) {
      textStart = unit.start;
      textX = x;
    }
    x += unit.width;
    contentWidth = x;
  }
  endLine(from + text.length);
  return lines;
}

const blockCache = new WeakMap<Block, { key: string; layout: Omit<BlockLayout, "y"> }>();

function layoutBlock(block: Block, width: number, metrics: EditorMetrics, epoch: number, contentX: number): Omit<BlockLayout, "y"> {
  const key = `${width}|${epoch}|${metrics.fontSize}|${metrics.lineHeight}|${metrics.codeFontSize}|${contentX}`;
  const cached = blockCache.get(block);
  if (cached && cached.key === key) return cached.layout;
  let layout: Omit<BlockLayout, "y">;
  if (block.kind === "paragraph") {
    const lines = wrapText(block.text, block.atoms, 0, SANS, metrics.fontSize, Math.max(1, width - contentX), metrics.lineHeight, 0);
    layout = { block, height: lines.length * metrics.lineHeight, textX: contentX, textY: 0, lines, face: SANS, fontSize: metrics.fontSize };
  } else {
    const inner = Math.max(20, width - 2 - 2 * metrics.codePadX);
    const lines: VisualLine[] = [];
    let offset = 0;
    for (const line of block.text.split("\n")) {
      const wrapped = wrapText(line, [], offset, MONO, metrics.codeFontSize, inner, metrics.codeLineHeight, lines.length * metrics.codeLineHeight);
      lines.push(...wrapped);
      offset += line.length + 1;
    }
    const bodyHeight = lines.length * metrics.codeLineHeight;
    layout = {
      block,
      height: metrics.codeMarginY * 2 + 2 + metrics.codeHeader + metrics.codePadTop + bodyHeight + metrics.codePadBottom,
      textX: 1 + metrics.codePadX,
      textY: metrics.codeMarginY + 1 + metrics.codeHeader + metrics.codePadTop,
      lines,
      face: MONO,
      fontSize: metrics.codeFontSize,
    };
  }
  blockCache.set(block, { key, layout });
  return layout;
}

const placedCache = new WeakMap<Omit<BlockLayout, "y">, BlockLayout>();

function sameMarker(a: ListMarker | undefined, b: ListMarker | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "text") return b.kind === "text" && a.text === b.text && a.x === b.x;
  if (a.kind === "checkbox") return b.kind === "checkbox" && a.checked === b.checked && a.x === b.x;
  return b.kind !== "text" && b.kind !== "checkbox" && a.contentX === b.contentX;
}

// web index.css, in px at the 16px root: ul `padding-inline-start: max(1.25rem, 2ch)`; ol
// `--list-gutter: max(1.25rem, 3ch)`, one more ch per marker character past two; a task item
// is a 0.95rem checkbox and a 0.5rem gap; a task list nested in a task list `1.375rem`.
const LIST_MIN_GUTTER = 20;
const TASK_BOX = 15.2;
const TASK_GAP = 8;
const NESTED_TASK_LIST_INSET = 22;

interface ListGeometry {
  readonly contentX: number;
  readonly marker: ListMarker;
  /** Margin of a list that starts at this item, and of the lists that end with it. */
  readonly marginTop: number;
  readonly marginBottom: number;
  /**
   * The part of marginBottom from nested lists. At the end of the draft web zeroes only the
   * top-level list's margin (`> :last-child`); a nested list's still collapses out below it.
   */
  readonly nestedMarginBottom: number;
}

function listGeometry(doc: Doc, places: ReadonlyArray<ItemPlace | null>, metrics: EditorMetrics): Array<ListGeometry | null> {
  const ch = textAdvance(SANS, metrics.fontSize, "0");
  const contentXs: number[] = [];
  const gutters = new Map<ListNode, { listX: number; gutter: number }>();
  const margin = (list: ListNode) => (list.kind === "task" ? 0 : metrics.listMarginY);
  return places.map((place, index) => {
    const block = doc.blocks[index]!;
    if (!place || block.kind !== "paragraph" || !block.list) return null;
    const list = place.list;
    let geometry = gutters.get(list);
    if (!geometry) {
      let listX = list.parentItem >= 0 ? (contentXs[list.parentItem] ?? 0) : 0;
      let inTask = false;
      for (let parent = list.parentList; parent; parent = parent.parentList) if (parent.kind === "task") inTask = true;
      if (list.kind === "task" && inTask) listX += NESTED_TASK_LIST_INSET;
      let gutter: number;
      if (list.kind === "task") gutter = TASK_BOX + TASK_GAP;
      else if (list.kind === "bullet") gutter = Math.max(LIST_MIN_GUTTER, 2 * ch);
      else {
        // `data-marker-width` caps at ten; one- and two-character markers share the 3ch default.
        const widest = Math.max(2, ...list.items.map((item) => Math.min(10, (doc.blocks[item] as { list?: { marker: string } }).list?.marker.length ?? 1)));
        gutter = Math.max(LIST_MIN_GUTTER, (widest + 1) * ch);
      }
      geometry = { listX, gutter };
      gutters.set(list, geometry);
    }
    const contentX = geometry.listX + geometry.gutter;
    contentXs[index] = contentX;
    let marker: ListMarker;
    if (block.list.kind === "task") marker = { kind: "checkbox", x: geometry.listX, checked: block.list.checked };
    else if (block.list.kind === "ordered") {
      // `content: attr(data-marker) " "`, painted outside, ending where the text starts.
      marker = { kind: "text", text: block.list.marker, x: contentX - textAdvance(SANS, metrics.fontSize, `${block.list.marker} `) };
    } else {
      // `ul ul` is a circle and `ul ul ul` a square; a task list is a `ul` too.
      let outer = 0;
      for (let parent = list.parentList; parent; parent = parent.parentList) if (parent.kind !== "ordered") outer += 1;
      marker = { kind: outer === 0 ? "disc" : outer === 1 ? "circle" : "square", contentX };
    }
    let marginBottom = 0;
    let nestedMarginBottom = 0;
    for (let ending: ListNode | null = list; ending && ending.last === index; ending = ending.parentList) {
      marginBottom = Math.max(marginBottom, margin(ending));
      if (ending.parentList) nestedMarginBottom = Math.max(nestedMarginBottom, margin(ending));
    }
    return { contentX, marker, marginTop: place.index === 0 ? margin(list) : 0, marginBottom, nestedMarginBottom };
  });
}

export function layoutDoc(doc: Doc, width: number, metrics: EditorMetrics, epoch: number): DocLayout {
  let y = 0;
  const blocks: BlockLayout[] = [];
  const hasLists = doc.blocks.some((block) => block.kind === "paragraph" && block.list !== undefined);
  const lists = hasLists ? listGeometry(doc, listPlaces(doc.blocks), metrics) : null;
  doc.blocks.forEach((block, index) => {
    const list = lists?.[index] ?? null;
    if (index > 0 && lists) {
      // Block margins collapse: the larger of the two meeting here, less what a code block's
      // layout already holds. The draft's first block has no top margin (web `> :first-child`).
      const previous = doc.blocks[index - 1]!;
      const before = lists[index - 1]?.marginBottom ?? 0;
      const baked = (previous.kind === "code" ? metrics.codeMarginY : 0) + (block.kind === "code" ? metrics.codeMarginY : 0);
      const wanted = Math.max(before, list?.marginTop ?? 0, previous.kind === "code" || block.kind === "code" ? metrics.codeMarginY : 0);
      y += Math.max(0, wanted - baked);
    }
    const layout = layoutBlock(block, Math.max(1, width), metrics, epoch, list?.contentX ?? 0);
    const marker = list?.marker;
    // The same object for an unchanged block at the same place, so its memoized view skips.
    let placed = placedCache.get(layout);
    if (!placed || placed.y !== y || !sameMarker(placed.marker, marker)) {
      placed = marker ? { ...layout, y, marker } : { ...layout, y };
      placedCache.set(layout, placed);
    }
    blocks.push(placed);
    y += layout.height;
  });
  const trailing = lists?.[doc.blocks.length - 1]?.nestedMarginBottom ?? 0;
  return { blocks, width, height: y + trailing };
}

// ── Geometry queries ─────────────────────────────────────────────────────

/** The line a position shows on. At a wrap the caret goes to the start of the next line. */
export function lineIndexFor(layout: BlockLayout, offset: number): number {
  const lines = layout.lines;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (offset < line.end || index === lines.length - 1) return index;
    if (offset === line.end) {
      const next = lines[index + 1];
      // A hard newline (code) ends this line; a soft wrap moves on to the next.
      if (!next || next.start > line.end) return index;
    }
  }
  return Math.max(0, lines.length - 1);
}

/** x of an offset within its visual line (relative to the text area). */
export function xForOffset(layout: BlockLayout, line: VisualLine, offset: number): number {
  for (const piece of line.pieces) {
    if (piece.kind === "atom") {
      if (offset === piece.offset) return piece.x;
      if (offset === piece.offset + 1) return piece.x + piece.width;
      continue;
    }
    if (offset >= piece.start && offset <= piece.end) {
      return piece.x + textAdvance(layout.face, layout.fontSize, layout.block.text.slice(piece.start, offset));
    }
  }
  if (line.pieces.length === 0) return 0;
  const last = line.pieces[line.pieces.length - 1]!;
  return offset <= line.start ? 0 : last.x + last.width;
}

export interface CaretRect {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly lineTop: number;
  readonly lineHeight: number;
}

export function caretRect(layout: DocLayout, pos: Pos): CaretRect | null {
  const block = layout.blocks[pos.block];
  if (!block) return null;
  const lineIndex = lineIndexFor(block, pos.offset);
  const line = block.lines[lineIndex];
  if (!line) return null;
  const x = block.textX + xForOffset(block, line, pos.offset);
  const top = block.y + block.textY + line.y;
  // A browser caret spans the font's glyph box (19px for 14px Segoe UI), not the leading.
  const height = glyphBoxHeight(block.fontSize, line.height);
  return { x, y: top + (line.height - height) / 2, height, lineTop: top, lineHeight: line.height };
}

/** Chrome's caret and selection height: the font's ascent plus descent, capped by the line. */
export function glyphBoxHeight(fontSize: number, lineHeight: number): number {
  return Math.min(lineHeight, Math.round(fontSize * 1.36));
}

/** The offset in a line nearest to x (relative to the text area). */
function offsetInLine(layout: BlockLayout, line: VisualLine, x: number): number {
  let best = line.start;
  let bestDistance = Math.abs(x);
  for (const piece of line.pieces) {
    if (piece.kind === "atom") {
      for (const [offset, at] of [
        [piece.offset, piece.x],
        [piece.offset + 1, piece.x + piece.width],
      ] as const) {
        const distance = Math.abs(x - at);
        if (distance < bestDistance) {
          best = offset;
          bestDistance = distance;
        }
      }
      continue;
    }
    let at = piece.x;
    let offset = piece.start;
    const text = layout.block.text.slice(piece.start, piece.end);
    for (const char of graphemeList(text)) {
      const distance = Math.abs(x - at);
      if (distance < bestDistance) {
        best = offset;
        bestDistance = distance;
      }
      at += charAdvance(layout.face, layout.fontSize, char);
      offset += char.length;
    }
    const distance = Math.abs(x - at);
    if (distance < bestDistance) {
      best = offset;
      bestDistance = distance;
    }
  }
  // A soft-wrapped line's last offset shows on the next line; stay before its hanging space.
  const lineIndex = layout.lines.indexOf(line);
  const next = layout.lines[lineIndex + 1];
  if (next && next.start === line.end && best === line.end && best > line.start && /\s/.test(layout.block.text[best - 1] ?? "")) {
    best -= 1;
  }
  return best;
}

/** Position under a point in document coordinates (clamped into the nearest line). */
export function posAtPoint(layout: DocLayout, x: number, y: number): Pos {
  const blocks = layout.blocks;
  if (blocks.length === 0) return { block: 0, offset: 0 };
  let index = blocks.findIndex((block) => y < block.y + block.height);
  if (index < 0) index = blocks.length - 1;
  const block = blocks[index]!;
  const localY = y - block.y - block.textY;
  let line = block.lines[0]!;
  for (const candidate of block.lines) {
    line = candidate;
    if (localY < candidate.y + candidate.height) break;
  }
  return { block: index, offset: offsetInLine(block, line, x - block.textX) };
}

/** Up/Down: the position on the visual line above or below, nearest the goal x. */
export function verticalTarget(layout: DocLayout, pos: Pos, goalX: number, direction: -1 | 1): Pos | null {
  const block = layout.blocks[pos.block];
  if (!block) return null;
  const lineIndex = lineIndexFor(block, pos.offset);
  let targetBlock = pos.block;
  let targetLine = lineIndex + direction;
  if (targetLine < 0) {
    targetBlock -= 1;
    if (targetBlock < 0) return null;
    targetLine = layout.blocks[targetBlock]!.lines.length - 1;
  } else if (targetLine >= block.lines.length) {
    targetBlock += 1;
    if (targetBlock >= layout.blocks.length) return null;
    targetLine = 0;
  }
  const target = layout.blocks[targetBlock]!;
  const line = target.lines[targetLine]!;
  return { block: targetBlock, offset: offsetInLine(target, line, goalX - target.textX) };
}

/** Home/End: the start or end of the visual line. */
export function lineBoundary(layout: DocLayout, pos: Pos, end: boolean): Pos {
  const block = layout.blocks[pos.block];
  if (!block) return pos;
  const index = lineIndexFor(block, pos.offset);
  const line = block.lines[index]!;
  if (!end) return { block: pos.block, offset: line.start };
  const next = block.lines[index + 1];
  const softWrapped = next !== undefined && next.start === line.end;
  const hanging = line.end > line.start && /\s/.test(block.block.text[line.end - 1] ?? "");
  return { block: pos.block, offset: softWrapped && hanging ? line.end - 1 : line.end };
}

/** Rectangles covering a selection, in document coordinates. */
export function selectionRects(layout: DocLayout, from: Pos, to: Pos): Array<{ x: number; y: number; width: number; height: number }> {
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let index = from.block; index <= to.block; index += 1) {
    const block = layout.blocks[index];
    if (!block) continue;
    const start = index === from.block ? from.offset : 0;
    const end = index === to.block ? to.offset : block.block.text.length;
    block.lines.forEach((line, lineIndex) => {
      const lineStart = Math.max(start, line.start);
      const lineEnd = Math.min(end, line.end);
      const continues = index < to.block || end > line.end || (lineIndex < block.lines.length - 1 && end === line.end && block.lines[lineIndex + 1]!.start > line.end);
      if (lineStart > lineEnd || (lineStart === lineEnd && !continues)) return;
      const x1 = xForOffset(block, line, lineStart);
      let x2 = xForOffset(block, line, lineEnd);
      // A selected line break shows as a sliver past the line's end, as in a browser.
      if (continues && lineEnd === line.end) x2 += Math.round(block.fontSize * 0.3);
      if (x2 <= x1) return;
      const height = glyphBoxHeight(block.fontSize, line.height);
      rects.push({ x: block.textX + x1, y: block.y + block.textY + line.y + (line.height - height) / 2, width: x2 - x1, height });
    });
  }
  return rects;
}

export { atomIndexAt };
