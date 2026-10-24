// Where the active find occurrence sits inside a timeline row, for the reveal
// in useThreadFindNavigation. Web measures the DOM Range of the match; gpuix
// paints the wash natively, and its painted-highlight log is a UI-thread local
// that reads back empty from JS on Windows. The automation tree carries every
// laid-out text run with its bounds, so the occurrence is found there: runs on
// one visual line are joined (a match never crosses a line, like gpuix's
// `highlight`) and matches are counted case-insensitively in reading order.

import { textWidth } from "../markdown/measure.ts";

interface TreeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TreeNode {
  readonly id: number;
  readonly text?: string;
  readonly bounds?: TreeBounds;
  readonly children?: ReadonlyArray<TreeNode>;
}

interface Run {
  readonly text: string;
  readonly bounds: TreeBounds;
}

/** The U+2060 joiners the markdown renderer ends continuing runs with. */
const WORD_JOINER = /\u2060/g;
/** Assistant prose: 14px regular sans (markdown/styles.ts body). */
const BODY_FACE = { family: "sans", weight: 400 } as const;
const BODY_SIZE = 14;
const JOINER = "\u2060";

function findNode(node: TreeNode, id: number): TreeNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function collectRuns(node: TreeNode, runs: Run[]) {
  if (typeof node.text === "string" && node.text.length > 0 && node.bounds && node.bounds.height > 0) {
    runs.push({ text: node.text.replace(WORD_JOINER, ""), bounds: node.bounds });
  }
  for (const child of node.children ?? []) collectRuns(child, runs);
}

function countMatches(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  if (needle.length === 0) return starts;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return starts;
    starts.push(index);
    from = index + needle.length;
  }
}

/**
 * The occurrence's line box relative to the row's top (and the row's painted
 * top in window coordinates), or null when the row is
 * not in the tree or holds fewer occurrences than asked for.
 */
export function locateFindOccurrence(
  treeJson: string,
  rowElementId: number,
  query: string,
  occurrence: number,
): { readonly rowTop: number; readonly top: number; readonly height: number } | null {
  let tree: TreeNode | null;
  try {
    tree = JSON.parse(treeJson) as TreeNode | null;
  } catch {
    return null;
  }
  const row = tree ? findNode(tree, rowElementId) : null;
  if (!row?.bounds) return null;
  const runs: Run[] = [];
  collectRuns(row, runs);
  // Runs whose vertical centres fall within one another's box share a line.
  runs.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const lines: { top: number; bottom: number; runs: Run[] }[] = [];
  for (const run of runs) {
    const centre = run.bounds.y + run.bounds.height / 2;
    const line = lines.find((candidate) => centre >= candidate.top && centre <= candidate.bottom);
    if (line) {
      line.runs.push(run);
      line.top = Math.min(line.top, run.bounds.y);
      line.bottom = Math.max(line.bottom, run.bounds.y + run.bounds.height);
    } else {
      lines.push({ top: run.bounds.y, bottom: run.bounds.y + run.bounds.height, runs: [run] });
    }
  }
  lines.sort((a, b) => a.top - b.top);
  const needle = query.toLowerCase();
  let seen = 0;
  for (const line of lines) {
    const text = line.runs
      .sort((a, b) => a.bounds.x - b.bounds.x)
      .map((run) => run.text)
      .join("")
      .toLowerCase();
    const matches = countMatches(text, needle).length;
    if (seen + matches > occurrence) return { rowTop: row.bounds.y, top: line.top - row.bounds.y, height: line.bottom - line.top };
    seen += matches;
  }
  return null;
}

// ── Explicit highlight ranges (a cited passage) ───────────────────────────

interface Group {
  readonly text: string;
  readonly bounds: TreeBounds | undefined;
}

function isTextLeaf(node: TreeNode): boolean {
  return (node as { type?: string }).type === "text" && (node.children?.length ?? 0) === 0;
}

/**
 * gpuix text/search.rs collect_into: a highlight's document is its subtree's
 * text in groups, adjacent raw-text leaves of one parent forming one group,
 * an element's own content a group of its own, groups joined by newlines.
 * `ranges` index that document.
 */
function collectGroups(node: TreeNode, out: Group[]) {
  const type = (node as { type?: string }).type;
  if (typeof node.text === "string" && node.text.length > 0 && (type === "text" || type === "div") && !isTextLeaf(node)) {
    out.push({ text: node.text, bounds: node.bounds });
  }
  let pending = "";
  let pendingBounds: TreeBounds | undefined;
  const flush = () => {
    if (pending.length > 0) out.push({ text: pending, bounds: pendingBounds });
    pending = "";
    pendingBounds = undefined;
  };
  for (const child of node.children ?? []) {
    if (!isTextLeaf(child)) {
      flush();
      collectGroups(child, out);
      continue;
    }
    if (!child.text) continue;
    pending += child.text;
    pendingBounds ??= child.bounds ?? node.bounds;
  }
  flush();
}

function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let inSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (/\s/.test(char) || char === JOINER) {
      if (char === JOINER) continue;
      if (inSpace) continue;
      inSpace = true;
      normalized += " ";
      map.push(index);
      continue;
    }
    inSpace = false;
    normalized += char;
    map.push(index);
  }
  return { normalized, map };
}

function sharedSuffixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[a.length - 1 - length] === b[b.length - 1 - length]) length += 1;
  return length;
}

/**
 * Where a cited quote sits in a row: the `[start, end)` range for the row's
 * `highlight`, and the line box of its start for scrolling. Whitespace is
 * compared collapsed, as the citation stores it; among repeated quotes the one
 * whose preceding text best matches the citation's prefix wins.
 */
export function locateQuote(
  treeJson: string,
  rowElementId: number,
  quote: { readonly text: string; readonly prefix: string },
): { readonly range: [number, number]; readonly rowTop: number; readonly top: number; readonly height: number } | null {
  let tree: TreeNode | null;
  try {
    tree = JSON.parse(treeJson) as TreeNode | null;
  } catch {
    return null;
  }
  const row = tree ? findNode(tree, rowElementId) : null;
  if (!row?.bounds) return null;
  const groups: Group[] = [];
  collectGroups(row, groups);
  let documentText = "";
  const starts: number[] = [];
  for (const group of groups) {
    if (documentText.length > 0) documentText += "\n";
    starts.push(documentText.length);
    documentText += group.text;
  }
  const { normalized, map } = normalizeWithMap(documentText);
  const needle = quote.text.replace(/\s+/g, " ").trim();
  if (needle.length === 0) return null;
  const prefix = quote.prefix.replace(/\s+/g, " ");
  let best: { start: number; score: number } | null = null;
  for (let from = 0; ; ) {
    const index = normalized.indexOf(needle, from);
    if (index < 0) break;
    const score = sharedSuffixLength(normalized.slice(0, index).trimEnd(), prefix.trimEnd());
    if (!best || score > best.score) best = { start: index, score };
    from = index + 1;
  }
  if (!best) return null;
  const start = map[best.start]!;
  const end = map[best.start + needle.length - 1]! + 1;
  let groupIndex = 0;
  for (let index = 0; index < starts.length; index += 1) if (starts[index]! <= start) groupIndex = index;
  const bounds = groups[groupIndex]?.bounds ?? row.bounds;
  return { range: [start, end], rowTop: row.bounds.y, top: bounds.y - row.bounds.y, height: bounds.height };
}

// ── Which repeated quote a selection meant ────────────────────────────────

/**
 * Among the quote's occurrences in the row's rendered lines, the index of the
 * one nearest the pointer where the selection ended (or began, for a drag
 * upwards): its line by y, its place in the line by x. web reads the DOM
 * selection range; gpuix gives only the text.
 */
export function selectionOccurrence(
  treeJson: string,
  rowElementId: number,
  quote: string,
  pointer: { readonly x: number; readonly y: number },
): number | null {
  let tree: TreeNode | null;
  try {
    tree = JSON.parse(treeJson) as TreeNode | null;
  } catch {
    return null;
  }
  const row = tree ? findNode(tree, rowElementId) : null;
  if (!row) return null;
  const runs: Run[] = [];
  collectRuns(row, runs);
  runs.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const lines: { top: number; bottom: number; runs: Run[] }[] = [];
  for (const run of runs) {
    const centre = run.bounds.y + run.bounds.height / 2;
    const line = lines.find((candidate) => centre >= candidate.top && centre <= candidate.bottom);
    if (line) {
      line.runs.push(run);
      line.top = Math.min(line.top, run.bounds.y);
      line.bottom = Math.max(line.bottom, run.bounds.y + run.bounds.height);
    } else {
      lines.push({ top: run.bounds.y, bottom: run.bounds.y + run.bounds.height, runs: [run] });
    }
  }
  lines.sort((a, b) => a.top - b.top);
  let text = "";
  let pointerIndex: number | null = null;
  for (const line of lines) {
    const lineText = line.runs
      .sort((a, b) => a.bounds.x - b.bounds.x)
      .map((run) => run.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0) text += " ";
    const start = text.length;
    text += lineText;
    if (pointer.y >= line.top && pointer.y <= line.bottom && lineText.length > 0) {
      // Character under the pointer. A run's box can be wider than its text, so
      // the text is measured with the body font's advances from the line's left.
      const left = Math.min(...line.runs.map((run) => run.bounds.x));
      const target = pointer.x - left;
      let index = 0;
      while (index < lineText.length && textWidth(BODY_FACE, BODY_SIZE, lineText.slice(0, index + 1)) <= target) index += 1;
      pointerIndex = start + index;
    }
  }
  const needle = quote.replace(/\s+/g, " ").trim();
  if (pointerIndex === null || needle.length === 0) return null;
  let best: { occurrence: number; distance: number } | null = null;
  for (let from = 0, occurrence = 0; ; occurrence += 1) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    const end = index + needle.length;
    const distance = pointerIndex < index ? index - pointerIndex : pointerIndex > end ? pointerIndex - end : 0;
    if (!best || distance < best.distance) best = { occurrence, distance };
    from = index + 1;
  }
  return best?.occurrence ?? null;
}
