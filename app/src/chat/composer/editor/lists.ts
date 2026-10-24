// Markdown lists in the composer document, as web's rich-text composer holds them:
// apps/web/src/composer-rich-text-doc.ts (ComposerListItemExtension, ComposerTaskItemExtension,
// parseTaskPrefix, parseListPrefix, listItemPrefix, buildTiptapContent's list stack,
// alignListItemWithSiblings, renumberFollowingItems, splitOrLiftListItem,
// convertBulletItemToTask, backspaceAcrossList) and apps/web/src/components/
// ComposerPromptEditorTiptap.tsx (listMarkerInputRule, bulletToTaskInputRule, taskInputRule).
//
// Web keeps a list as a ProseMirror tree of list and item nodes. Here an item is a paragraph
// carrying its list attributes (one item per line, which is all web's item schema
// "paragraph list*" allows), and the tree is rebuilt from the items' indents the way web's
// buildTiptapContent rebuilds it from the stored Markdown. Web aligns an item's indent and
// marker with its siblings after every move for exactly that reason ("the next rebuild nests
// it again"), so the indents always describe the tree web holds.
import { nextOrderedMarkerText } from "../../../web/composer-list-continuation.ts";
import { type Block, type Doc, type EditResult, type ParagraphBlock, type Pos, type Selection, sliceParagraph } from "./doc.ts";

export interface ListAttrs {
  readonly kind: "bullet" | "ordered" | "task";
  readonly indent: string;
  /** `-`, `*`, `+`, `3.`, `7)`; a task item's is always `-`. */
  readonly marker: string;
  /** Between the marker and the text (bullet and ordered `space`, a task's `markerSpace`). */
  readonly space: string;
  readonly checked: boolean;
  /** A task's `contentSpace`: after `[ ]`; null writes one space before text and none when empty. */
  readonly contentSpace: string | null;
}

// ── Grammar (composer-rich-text-doc.ts parseTaskPrefix / parseListPrefix) ──

function parseTaskPrefix(head: string): { list: ListAttrs; length: number } | null {
  const match = head.match(/^([ \t]*)-([ \t]+)\[([ xX])\]([ \t]*)/);
  if (!match) return null;
  const after = head.slice(match[0].length);
  if (after.length > 0 && !match[4]) return null;
  return {
    list: {
      kind: "task",
      indent: match[1] ?? "",
      marker: "-",
      checked: (match[3] ?? " ").toLowerCase() === "x",
      space: match[2]!,
      contentSpace: match[4]!,
    },
    length: match[0].length,
  };
}

/** web buildTiptapContent tests for a rule before a list; a rule line is no item. */
const RULE_LINE = /^([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/;

/** A task first (it also looks like a bullet), then an ordered marker, then a bullet. */
export function parseListPrefix(line: string): { list: ListAttrs; length: number } | null {
  if (RULE_LINE.test(line)) return null;
  const task = parseTaskPrefix(line);
  if (task) return task;
  const ordered = /^([ \t]*)(\d+[.)])((?:[ \t]+)|$)/.exec(line);
  if (ordered) {
    return {
      list: { kind: "ordered", indent: ordered[1]!, marker: ordered[2]!, space: ordered[3]!, checked: false, contentSpace: null },
      length: ordered[0].length,
    };
  }
  const bullet = /^([ \t]*)([-*+])((?:[ \t]+)|$)/.exec(line);
  if (bullet) {
    return {
      list: { kind: "bullet", indent: bullet[1]!, marker: bullet[2]!, space: bullet[3]!, checked: false, contentSpace: null },
      length: bullet[0].length,
    };
  }
  return null;
}

/** web listItemPrefix: the Markdown written before an item's text. */
export function listItemPrefix(list: ListAttrs, empty: boolean): string {
  if (list.kind === "task") {
    const contentSpace = list.contentSpace !== null ? list.contentSpace || (empty ? "" : " ") : empty ? "" : " ";
    return `${list.indent}-${list.space}[${list.checked ? "x" : " "}]${contentSpace}`;
  }
  const space = list.space || (empty ? "" : " ");
  return `${list.indent}${list.marker || "-"}${space}`;
}

function listKey(list: ListAttrs): string {
  if (list.kind === "task") return "task";
  if (list.kind === "ordered") return `ordered:${list.marker.slice(-1)}`;
  return `bullet:${list.marker}`;
}

const isOrderedMarker = (marker: string) => /^\d+[.)]$/.test(marker);

// ── The tree behind the items (buildTiptapContent's stack) ──────────────

export interface ListNode {
  readonly key: string;
  readonly kind: ListAttrs["kind"];
  /** Block indexes of the list's own items, in order. */
  readonly items: number[];
  /** The item this list is nested in, or -1 at the top level. */
  readonly parentItem: number;
  readonly parentList: ListNode | null;
  /** Last block index inside the list, nested items included. */
  last: number;
}

export interface ItemPlace {
  readonly list: ListNode;
  /** Position among the list's own items. */
  readonly index: number;
  /** Lists above this item's own list. */
  readonly depth: number;
}

/** Each block's place in a list (null for blocks outside lists). */
export function listPlaces(blocks: ReadonlyArray<Block>): Array<ItemPlace | null> {
  const places: Array<ItemPlace | null> = [];
  type Frame = { indent: string; list: ListNode; container: ListNode[]; parentItem: number; parentList: ListNode | null };
  let stack: Frame[] = [];
  const childLists = new Map<number, ListNode[]>();
  const root: ListNode[] = [];
  const open = (container: ListNode[], key: string, kind: ListAttrs["kind"], parentItem: number, parentList: ListNode | null): ListNode => {
    const list: ListNode = { key, kind, items: [], parentItem, parentList, last: -1 };
    container.push(list);
    return list;
  };
  const add = (frame: Frame, index: number) => {
    frame.list.items.push(index);
    places[index] = { list: frame.list, index: frame.list.items.length - 1, depth: stack.indexOf(frame) };
    for (let list: ListNode | null = frame.list; list; list = list.parentList) list.last = index;
  };
  blocks.forEach((block, index) => {
    const list = block.kind === "paragraph" ? block.list : undefined;
    if (!list) {
      places[index] = null;
      stack = [];
      return;
    }
    const key = listKey(list);
    const indent = list.indent;
    for (;;) {
      const top = stack[stack.length - 1];
      if (!top) {
        stack.push({ indent, list: open(root, key, list.kind, -1, null), container: root, parentItem: -1, parentList: null });
        continue;
      }
      if (top.indent === indent) {
        if (top.list.key !== key) top.list = open(top.container, key, list.kind, top.parentItem, top.parentList);
        add(top, index);
        break;
      }
      if (top.indent !== "" && !indent.startsWith(top.indent)) {
        if (stack.length > 1) {
          stack.pop();
          continue;
        }
        top.indent = indent;
        if (top.list.key !== key) top.list = open(top.container, key, list.kind, top.parentItem, top.parentList);
        add(top, index);
        break;
      }
      const parent = top.list.items[top.list.items.length - 1];
      if (parent === undefined) {
        add(top, index);
        break;
      }
      let container = childLists.get(parent);
      if (!container) childLists.set(parent, (container = []));
      const frame: Frame = { indent, list: open(container, key, list.kind, parent, top.list), container, parentItem: parent, parentList: top.list };
      stack.push(frame);
      add(frame, index);
      break;
    }
  });
  return places;
}

// ── Commands ─────────────────────────────────────────────────────────────

function itemAt(doc: Doc, index: number): (ParagraphBlock & { list: ListAttrs }) | null {
  const block = doc.blocks[index];
  return block?.kind === "paragraph" && block.list ? (block as ParagraphBlock & { list: ListAttrs }) : null;
}

function withList(block: ParagraphBlock, list: ListAttrs | undefined): ParagraphBlock {
  const next: ParagraphBlock = { kind: "paragraph", text: block.text, atoms: block.atoms };
  return list ? { ...next, list } : next;
}

function replaceBlocks(doc: Doc, start: number, deleteCount: number, insert: ReadonlyArray<Block>): Block[] {
  const blocks = doc.blocks.slice();
  blocks.splice(start, deleteCount, ...insert);
  return blocks;
}

/** web renumberFollowingItems: the list's later items count on from `marker`. */
function renumberFollowing(blocks: Block[], index: number, marker: string): void {
  const place = listPlaces(blocks)[index];
  if (!place) return;
  let previous = marker;
  for (const item of place.list.items.slice(place.index + 1)) {
    previous = nextOrderedMarkerText(previous);
    const block = blocks[item] as ParagraphBlock;
    if (block.list && block.list.marker !== previous) blocks[item] = withList(block, { ...block.list, marker: previous });
  }
}

/**
 * web alignListItemWithSiblings: an item that moved takes the indent (and marker, counted on
 * for an ordered list) of the sibling before it, or after it when it is first.
 */
function alignWithSiblings(blocks: Block[], index: number): void {
  const place = listPlaces(blocks)[index];
  const block = blocks[index] as ParagraphBlock;
  if (!place || !block.list) return;
  const siblingIndex = place.index > 0 ? place.list.items[place.index - 1] : place.list.items[place.index + 1];
  const sibling = siblingIndex === undefined ? undefined : (blocks[siblingIndex] as ParagraphBlock).list;
  if (!sibling) return;
  const next: ListAttrs =
    block.list.kind === "task"
      ? { ...block.list, indent: sibling.indent, space: sibling.space }
      : {
          ...block.list,
          indent: sibling.indent,
          marker: place.index > 0 && isOrderedMarker(sibling.marker) ? nextOrderedMarkerText(sibling.marker) : sibling.marker,
        };
  blocks[index] = withList(block, next);
  if (isOrderedMarker(next.marker)) renumberFollowing(blocks, index, next.marker);
}

/** Item types web keeps apart: a task item only lives in a task list. */
const itemType = (list: ListAttrs) => (list.kind === "task" ? "taskItem" : "listItem");

/**
 * Tiptap liftListItem: a nested item moves out to its parent's list, right after the parent
 * (the siblings after it stay nested, now under it); a top-level item becomes a paragraph.
 * Null when there is no list of its type to lift into (a task under a bullet).
 */
function liftItem(doc: Doc, index: number): Block[] | null {
  const block = itemAt(doc, index);
  if (!block) return null;
  const place = listPlaces(doc.blocks)[index];
  if (!place) return null;
  const blocks = doc.blocks.slice();
  if (place.list.parentItem < 0) {
    blocks[index] = withList(block, undefined);
    return blocks;
  }
  const parent = itemAt(doc, place.list.parentItem)!;
  if (itemType(parent.list) !== itemType(block.list)) return null;
  // The parent's list type and indent; alignWithSiblings settles the marker.
  blocks[index] = withList(block, { ...block.list, kind: parent.list.kind, indent: parent.list.indent, marker: parent.list.marker });
  alignWithSiblings(blocks, index);
  return blocks;
}

/**
 * web splitOrLiftListItem (Enter in an item): the item splits at the caret, the new item
 * aligned with the one before it and the list renumbered after it; an empty item moves one
 * level out instead, which at the top ends the list.
 */
export function splitOrLiftListItem(doc: Doc, pos: Pos): EditResult | null {
  const block = itemAt(doc, pos.block);
  if (!block) return null;
  if (block.text.length === 0) {
    // Tiptap's splitListItem moves an empty last nested item out to the parent's list and
    // leaves every other empty item to liftListItem: both come to the same move here.
    const blocks = liftItem(doc, pos.block);
    if (!blocks) return null;
    return { doc: { blocks }, selection: caretAt(pos) };
  }
  const head = sliceItem(block, 0, pos.offset);
  // Tiptap keeps an item's attributes on split, with the composer's overrides.
  const tailList: ListAttrs = block.list.kind === "task" ? { ...block.list, checked: false } : { ...block.list, space: " " };
  const tail = withList(sliceItem(block, pos.offset, block.text.length), tailList);
  const blocks = replaceBlocks(doc, pos.block, 1, [head, tail]);
  alignWithSiblings(blocks, pos.block + 1);
  return { doc: { blocks }, selection: caretAt({ block: pos.block + 1, offset: 0 }) };
}

/**
 * web backspaceAcrossList: Backspace at the start of an item lifts it one level (out of
 * the list at the top). Null when the item has no list to lift into; the caller then joins
 * it onto the line above, as joinBackward does.
 */
export function backspaceAtItemStart(doc: Doc, selection: Selection): EditResult | null {
  const pos = selection.head;
  if (pos.offset !== 0 || !itemAt(doc, pos.block)) return null;
  const blocks = liftItem(doc, pos.block);
  if (!blocks) return null;
  return { doc: { blocks }, selection: caretAt(pos) };
}

/** Clicking a task's checkbox (Tiptap TaskItem): the caret stays where it was. */
export function toggleTask(doc: Doc, index: number): Doc | null {
  const block = itemAt(doc, index);
  if (!block || block.list.kind !== "task") return null;
  return { blocks: replaceBlocks(doc, index, 1, [withList(block, { ...block.list, checked: !block.list.checked })]) };
}

/**
 * The composer's list input rules, run as a character is typed at a collapsed caret
 * (ProseMirror input rules match the paragraph's text before the caret plus that character):
 * `* ` and `+ ` start a bullet item, `-`, spaces and the next character start one carrying
 * that character (so `- [ ] ` can still reach the task rule), `1. ` and `1) ` an ordered
 * item, `- [ ] ` or `- [x] ` a task. Only in a top-level paragraph. Inside a bullet item,
 * `[ ] ` or `[x] ` at its start turns the item into a task.
 */
export function listInputRule(doc: Doc, pos: Pos, typed: string): EditResult | null {
  const block = doc.blocks[pos.block];
  if (block?.kind !== "paragraph" || typed.length !== 1) return null;
  const before = block.text.slice(0, pos.offset) + typed;
  const rest = (from: number) => sliceItem(block, from, block.text.length);
  if (!block.list) {
    const make = (list: ListAttrs, carried = ""): EditResult => {
      const tail = rest(pos.offset);
      const item = withList({ ...tail, text: carried + tail.text }, list);
      return { doc: { blocks: replaceBlocks(doc, pos.block, 1, [item]) }, selection: caretAt({ block: pos.block, offset: carried.length }) };
    };
    const base = { indent: "", checked: false, contentSpace: null } as const;
    let match = /^(?<marker>[*+])(?<space>\s)$/.exec(before);
    if (match) return make({ ...base, kind: "bullet", marker: match.groups!.marker!, space: match.groups!.space! });
    match = /^(?<marker>-)(?<space>[ \t]+)(?<carried>[^\s[])$/.exec(before);
    if (match) return make({ ...base, kind: "bullet", marker: "-", space: match.groups!.space! }, match.groups!.carried!);
    match = /^(?<marker>\d+[.)])(?<space>\s)$/.exec(before);
    if (match) return make({ ...base, kind: "ordered", marker: match.groups!.marker!, space: match.groups!.space! });
    match = /^- \[([ xX])\] $/.exec(before);
    // wrappingInputRule: the new item has Tiptap's default attributes.
    if (match) return make({ ...base, kind: "task", marker: "-", space: " ", checked: match[1]!.toLowerCase() === "x" });
    return null;
  }
  if (block.list.kind !== "bullet" || !["-", "*", "+"].includes(block.list.marker)) return null;
  const task = /^\[([ xX])\] $/.exec(before);
  if (!task) return null;
  // convertBulletItemToTask: the item leaves its list for a task list of its own.
  const list: ListAttrs = {
    kind: "task",
    indent: block.list.indent,
    marker: "-",
    space: block.list.space || " ",
    checked: task[1]!.toLowerCase() === "x",
    contentSpace: null,
  };
  const item = withList(rest(pos.offset), list);
  return { doc: { blocks: replaceBlocks(doc, pos.block, 1, [item]) }, selection: caretAt({ block: pos.block, offset: 0 }) };
}

function caretAt(pos: Pos): Selection {
  return { anchor: pos, head: pos };
}

/** A slice of an item's text and atoms, keeping its list attributes. */
const sliceItem = (block: ParagraphBlock, from: number, to: number) => sliceParagraph(block, from, to);
