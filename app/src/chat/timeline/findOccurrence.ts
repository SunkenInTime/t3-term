// A timeline row's rendered text, read from the automation tree, for find and
// citations. web works on DOM text and Ranges; gpuix paints the washes
// natively, and its painted-highlight log is a UI-thread local that reads back
// empty from JS on Windows. The automation tree carries every laid-out text run
// with its bounds, so the row's text is rebuilt from it in two forms:
//
//   - the highlight document gpuix's `ranges` index (text/search.rs
//     collect_into): groups of adjacent raw-text leaves of one parent, an
//     element's own content a group of its own, groups joined by newlines;
//   - the reading stream, like the DOM's text: groups that continue one line
//     or one wrapped paragraph join with nothing between them, other groups
//     are separated by a newline (a block boundary).
//
// A paragraph that wraps is several groups (the markdown renderer lays inline
// text out in JavaScript and paints each line as its own row of runs, ending
// continuing runs with U+2060), and a highlighted code line is one group per
// token. gpuix's `query` matching never crosses a group, so a phrase that wraps
// or spans tokens gets no wash and shifts the numbering of later matches. The
// server counts matches in the reading stream (shared threadFindText), so the
// active match is located there and painted with explicit ranges when gpuix's
// own matcher cannot see it.

import { findThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import { textWidth } from "../markdown/measure.ts";
import type { AssistantCitation } from "@t3tools/contracts";

import {
  createAssistantTextSelector,
  findAssistantCitationText,
  rawTextOffset,
  type AssistantTextSelector,
} from "../../web/lib/assistantTextSelection.ts";

interface TreeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TreeNode {
  readonly id: number;
  readonly type?: string;
  readonly text?: string;
  readonly testId?: string;
  readonly bounds?: TreeBounds;
  readonly children?: ReadonlyArray<TreeNode>;
}

/** Assistant prose: 14px regular sans (markdown/styles.ts body). */
const BODY_FACE = { family: "sans", weight: 400 } as const;
const BODY_SIZE = 14;
/** The U+2060 the markdown renderer ends continuing runs with (not painted). */
const JOINER = "⁠";

interface Group {
  readonly text: string;
  /** Offset of the group in the highlight document. */
  readonly docStart: number;
  /** Union of the group's runs, when laid out. */
  readonly bounds: TreeBounds | undefined;
  /** Element ids from the row down to the group's parent, for ancestor lookups. */
  readonly path: ReadonlyArray<number>;
  /** Inside a control (a button label): not message text, which web's streams skip. */
  readonly control: boolean;
}

/** Buttons inside rendered messages whose labels web leaves out of its text (EXCLUDED_SELECTOR). */
const CONTROL_TEST_IDS = new Set(["artifact-template-use"]);

export interface RowText {
  readonly rowId: number;
  readonly rowBounds: TreeBounds;
  readonly doc: string;
  readonly groups: ReadonlyArray<Group>;
  /** Boxes of the registered sideways scrollers inside the row. */
  readonly scrollers: ReadonlyMap<number, TreeBounds>;
}

interface Stream {
  readonly text: string;
  /** Highlight-document offset of each stream character. */
  readonly toDoc: ReadonlyArray<number>;
  /** Group index of each stream character. */
  readonly group: ReadonlyArray<number>;
}

/** A scroller that pans sideways (a code block), registered by element id. */
const horizontalScrollers = new Set<number>();
export function registerHorizontalScroller(id: number): () => void {
  horizontalScrollers.add(id);
  return () => horizontalScrollers.delete(id);
}

function parseTree(treeJson: string): TreeNode | null {
  try {
    return JSON.parse(treeJson) as TreeNode | null;
  } catch {
    return null;
  }
}

function findNode(node: TreeNode, matches: (node: TreeNode) => boolean): TreeNode | null {
  if (matches(node)) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, matches);
    if (found) return found;
  }
  return null;
}

/** text/search.rs is_text_leaf: a text node without children. */
function isTextLeaf(node: TreeNode): boolean {
  return node.type === "text" && (node.children?.length ?? 0) === 0;
}

function union(a: TreeBounds | undefined, b: TreeBounds | undefined): TreeBounds | undefined {
  if (!a || a.height <= 0) return b && b.height > 0 ? b : a;
  if (!b || b.height <= 0) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** text/search.rs collect_into, keeping each group's bounds and ancestry. */
function collectGroups(node: TreeNode, path: number[], out: Array<Omit<Group, "docStart">>, inControl = false) {
  const here = [...path, node.id];
  const control = inControl || (node.testId !== undefined && CONTROL_TEST_IDS.has(node.testId));
  if (typeof node.text === "string" && node.text.length > 0 && (node.type === "text" || node.type === "div") && !isTextLeaf(node)) {
    out.push({ text: node.text, bounds: node.bounds, path: here, control });
  }
  let pending = "";
  let pendingBounds: TreeBounds | undefined;
  const flush = () => {
    if (pending.length > 0) out.push({ text: pending, bounds: pendingBounds, path: here, control });
    pending = "";
    pendingBounds = undefined;
  };
  for (const child of node.children ?? []) {
    if (!isTextLeaf(child)) {
      flush();
      collectGroups(child, here, out, control);
      continue;
    }
    if (!child.text) continue;
    pending += child.text;
    pendingBounds = union(pendingBounds, child.bounds);
  }
  flush();
}

function rowTextOf(row: TreeNode): RowText | null {
  if (!row.bounds) return null;
  const raw: Array<Omit<Group, "docStart">> = [];
  collectGroups(row, [], raw);
  let doc = "";
  const groups: Group[] = [];
  for (const group of raw) {
    if (doc.length > 0) doc += "\n";
    groups.push({ ...group, docStart: doc.length });
    doc += group.text;
  }
  const scrollers = new Map<number, TreeBounds>();
  if (horizontalScrollers.size > 0) {
    const visit = (node: TreeNode) => {
      if (node.bounds && horizontalScrollers.has(node.id)) scrollers.set(node.id, node.bounds);
      for (const child of node.children ?? []) visit(child);
    };
    visit(row);
  }
  return { rowId: row.id, rowBounds: row.bounds, doc, groups, scrollers };
}

/** The row's text, from `renderer.getAutomationTree()`. */
export function readRowText(treeJson: string, rowElementId: number): RowText | null {
  const tree = parseTree(treeJson);
  const row = tree ? findNode(tree, (node) => node.id === rowElementId) : null;
  return row ? rowTextOf(row) : null;
}

/**
 * Whether two adjacent groups read as one run of text: the first ends with the
 * renderer's continuation mark, or the second starts where the first ends on
 * the same line (code tokens, which carry no mark).
 */
function continues(previous: Group, next: Group): boolean {
  if (previous.text.endsWith(JOINER)) return true;
  const a = previous.bounds;
  const b = next.bounds;
  if (!a || !b || a.height <= 0 || b.height <= 0) return false;
  const sameLine = Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) < Math.min(a.height, b.height) / 2;
  const gap = b.x - (a.x + a.width);
  return sameLine && gap >= -1 && gap <= 2;
}

function buildStream(row: RowText, include: (group: Group) => boolean = () => true): Stream {
  let text = "";
  const toDoc: number[] = [];
  const groupOf: number[] = [];
  let previous: Group | null = null;
  row.groups.forEach((group, index) => {
    if (!include(group)) return;
    if (previous && !continues(previous, group)) {
      text += "\n";
      toDoc.push(group.docStart - 1);
      groupOf.push(index);
    }
    for (let offset = 0; offset < group.text.length; offset += 1) {
      const char = group.text[offset]!;
      if (char === JOINER) continue;
      text += char;
      toDoc.push(group.docStart + offset);
      groupOf.push(index);
    }
    previous = group;
  });
  return { text, toDoc, group: groupOf };
}

function docRange(stream: Stream, start: number, end: number): [number, number] {
  return [stream.toDoc[start]!, stream.toDoc[end - 1]! + 1];
}

/** The line box (relative to the row) of the group holding a stream offset. */
function lineBox(row: RowText, stream: Stream, offset: number): { top: number; height: number } {
  const bounds = row.groups[stream.group[offset] ?? -1]?.bounds;
  return bounds && bounds.height > 0
    ? { top: bounds.y - row.rowBounds.y, height: bounds.height }
    : { top: 0, height: row.rowBounds.height };
}

// ── Find ──────────────────────────────────────────────────────────────────

export interface FindMatchLocation {
  /** The active match's line box, relative to the row's painted top. */
  readonly rowTop: number;
  readonly top: number;
  readonly height: number;
  /** The active match's ordinal among the matches gpuix's `query` matcher sees, or null when it cannot see it. */
  readonly queryOrdinal: number | null;
  /** The active match as a highlight-document range, when gpuix's matcher cannot see it. */
  readonly activeRange: [number, number] | null;
  /** Other matches gpuix's matcher misses (they wrap or span runs), to wash with ranges. */
  readonly extraRanges: ReadonlyArray<[number, number]>;
  /** A code block to pan so the match shows: its element id and the scroll x to set. */
  readonly pan: { readonly scrollerId: number; readonly deltaX: number } | null;
}

/**
 * The `occurrence`-th match of `query` in the row's reading stream, counted
 * like the server (shared threadSearch). Null when the row holds fewer.
 */
export function locateFindMatch(row: RowText, query: string, occurrence: number): FindMatchLocation | null {
  const stream = buildStream(row, (group) => !group.control);
  const needle = query.trim();
  if (needle.length === 0) return null;
  const starts = findThreadSearchOccurrences(stream.text, needle);
  if (occurrence >= starts.length) return null;
  let active: { range: [number, number]; visible: boolean; start: number; end: number } | null = null;
  const extraRanges: Array<[number, number]> = [];
  starts.forEach((start, index) => {
    const end = start + needle.length;
    const range = docRange(stream, start, end);
    // gpuix matches inside one group only, and the joiner breaks a match too.
    const slice = row.doc.slice(range[0], range[1]);
    const visible = !slice.includes("\n") && !slice.includes(JOINER);
    if (index === occurrence) active = { range, visible, start, end };
    else if (!visible) extraRanges.push(range);
  });
  const found = active as { range: [number, number]; visible: boolean; start: number; end: number } | null;
  if (!found) return null;
  const box = lineBox(row, stream, found.start);
  return {
    rowTop: row.rowBounds.y,
    ...box,
    queryOrdinal: found.visible ? gpuixMatchesBefore(row, needle, found.range[0]) : null,
    activeRange: found.visible ? null : found.range,
    extraRanges,
    pan: panFor(row, stream, found.start, found.end),
  };
}

/**
 * How many matches gpuix's own `query` matcher numbers before a document
 * offset: it scans every group of the row (buttons and timestamps included),
 * lowercased, non-overlapping, never across a group.
 */
function gpuixMatchesBefore(row: RowText, needle: string, docOffset: number): number {
  const lowered = needle.toLowerCase();
  let count = 0;
  for (const group of row.groups) {
    if (group.docStart >= docOffset) break;
    const text = group.text.toLowerCase();
    for (let index = text.indexOf(lowered); index !== -1 && group.docStart + index < docOffset; index = text.indexOf(lowered, index + lowered.length)) {
      count += 1;
    }
  }
  return count;
}

/** web reveal's `pre` scroll: bring a match inside a sideways-scrolling code block into view, 16px in. */
function panFor(row: RowText, stream: Stream, start: number, end: number): FindMatchLocation["pan"] {
  const group = row.groups[stream.group[start] ?? -1];
  if (!group?.bounds || group.text.length === 0) return null;
  const scrollerId = [...group.path].reverse().find((id) => horizontalScrollers.has(id));
  if (scrollerId === undefined) return null;
  const scroller = row.scrollers.get(scrollerId);
  if (!scroller) return null;
  // Code is monospaced: a character's x is proportional within its run.
  const local = (offset: number) => stream.toDoc[offset]! - group.docStart;
  const perChar = group.bounds.width / group.text.replaceAll(JOINER, "").length;
  const left = group.bounds.x + local(start) * perChar;
  const right = group.bounds.x + (Math.min(local(end - 1), group.text.length - 1) + 1) * perChar;
  if (left < scroller.x) return { scrollerId, deltaX: left - scroller.x - 16 };
  if (right > scroller.x + scroller.width) return { scrollerId, deltaX: right - (scroller.x + scroller.width) + 16 };
  return null;
}

// ── Citations ────────────────────────────────────────────────────────────

/** The testId on an assistant reply's citation source, so its subtree can be found in the row. */
export function citationSourceTestId(messageId: string): string {
  return `citation-source:${messageId}`;
}

function sourceGroups(row: RowText, treeJson: string, messageId: string): ((group: Group) => boolean) | null {
  const tree = parseTree(treeJson);
  const testId = citationSourceTestId(messageId);
  const source = tree ? findNode(tree, (node) => node.testId === testId) : null;
  if (!source) return null;
  return (group) => !group.control && group.path.includes(source.id);
}

/**
 * web resolveAssistantCitationRange: the cited passage in the reply, by its
 * saved offsets and context (findAssistantCitationText, which gives up on a
 * tie), as a range in the row's highlight document plus the line box of its
 * start. Null when the passage cannot be found unambiguously.
 */
export function locateQuote(
  treeJson: string,
  rowElementId: number,
  citation: AssistantCitation,
): { readonly range: [number, number]; readonly rowTop: number; readonly top: number; readonly height: number } | null {
  const row = readRowText(treeJson, rowElementId);
  if (!row) return null;
  const include = sourceGroups(row, treeJson, citation.messageId) ?? ((group: Group) => !group.control);
  const stream = buildStream(row, include);
  const match = findAssistantCitationText(stream.text, citation);
  if (!match) return null;
  const start = rawTextOffset(stream.text, match.start);
  const end = rawTextOffset(stream.text, match.end);
  if (end <= start) return null;
  const box = lineBox(row, stream, start);
  return { range: docRange(stream, start, end), rowTop: row.rowBounds.y, ...box };
}

/**
 * web captureAssistantTextSelection, from what gpuix gives: the selected text
 * and where the drag began and ended. The selection is found in the reply's
 * reading stream; when the quote repeats, the occurrence whose ends lie
 * nearest the drag's ends wins. Returns the selector web would build from the
 * DOM range (offsets and context in the normalized stream).
 */
export function selectionSelector(
  treeJson: string,
  sourceElementId: number,
  selected: string,
  drag: { readonly from: { x: number; y: number } | null; readonly to: { x: number; y: number } },
): AssistantTextSelector | null {
  const row = readRowText(treeJson, sourceElementId);
  if (!row) return null;
  const stream = buildStream(row, (group) => !group.control);
  const normalize = (text: string) => text.replace(/\s+/g, " ");
  const normalized = normalize(stream.text);
  const quote = normalize(selected).trim();
  if (quote.length === 0) return null;
  const occurrences: number[] = [];
  for (let index = normalized.indexOf(quote); index !== -1; index = normalized.indexOf(quote, index + 1)) occurrences.push(index);
  if (occurrences.length === 0) return null;
  let chosen = occurrences[0]!;
  if (occurrences.length > 1) {
    const toNormalized = (raw: number) => normalize(stream.text.slice(0, raw)).length;
    const at = (point: { x: number; y: number }) => {
      const raw = streamOffsetAt(row, stream, point);
      return raw === null ? null : toNormalized(raw);
    };
    const end = at(drag.to);
    const begin = drag.from ? at(drag.from) : null;
    const a = begin === null ? end : end === null ? begin : Math.min(begin, end);
    const b = begin === null ? end : end === null ? begin : Math.max(begin, end);
    if (a !== null && b !== null) {
      let best = Number.POSITIVE_INFINITY;
      for (const start of occurrences) {
        const distance = Math.abs(start - a) + Math.abs(start + quote.length - b);
        if (distance < best) {
          best = distance;
          chosen = start;
        }
      }
    }
  }
  return createAssistantTextSelector(stream.text, rawTextOffset(stream.text, chosen), rawTextOffset(stream.text, chosen + quote.length));
}

/**
 * The character index under x in a run. A run whose box hugs its text (code,
 * a pill) is split evenly; a prose run's box can stretch past its text, so its
 * text is measured with the body font's advances.
 */
function characterAt(text: string, bounds: TreeBounds, x: number): number {
  const target = x - bounds.x;
  if (target <= 0 || text.length === 0) return 0;
  const measured = textWidth(BODY_FACE, BODY_SIZE, text);
  if (measured <= 0 || bounds.width <= measured * 1.05) {
    return Math.round(Math.min(1, target / Math.max(1, bounds.width)) * text.length);
  }
  let index = 0;
  while (index < text.length && textWidth(BODY_FACE, BODY_SIZE, text.slice(0, index + 1)) <= target) index += 1;
  return index;
}

/** The stream offset under a window point: the nearest laid-out group, then the character by x. */
function streamOffsetAt(row: RowText, stream: Stream, point: { x: number; y: number }): number | null {
  let bestGroup = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  row.groups.forEach((group, index) => {
    const bounds = group.bounds;
    if (!bounds || bounds.height <= 0) return;
    const dy = point.y < bounds.y ? bounds.y - point.y : point.y > bounds.y + bounds.height ? point.y - (bounds.y + bounds.height) : 0;
    const dx = point.x < bounds.x ? bounds.x - point.x : point.x > bounds.x + bounds.width ? point.x - (bounds.x + bounds.width) : 0;
    // A line's distance dominates: a point between two lines belongs to the nearer one.
    const distance = dy * 10_000 + dx;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestGroup = index;
    }
  });
  if (bestGroup < 0) return null;
  const group = row.groups[bestGroup]!;
  const bounds = group.bounds!;
  const visible = group.text.replaceAll(JOINER, "");
  const local = characterAt(visible, bounds, point.x);
  let first = -1;
  for (let index = 0; index < stream.group.length; index += 1) {
    if (stream.group[index] === bestGroup && stream.toDoc[index]! >= group.docStart) {
      first = index;
      break;
    }
  }
  return first < 0 ? null : Math.min(stream.text.length, first + local);
}
