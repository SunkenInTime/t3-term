// Editing commands over the composer document: caret steps, deletes, Enter and Tab in
// code blocks, fence conversion. Ports of the ProseMirror commands web's composer runs
// (apps/web/src/composer-code-block.ts, the Tiptap keymap in ComposerPromptEditorTiptap.tsx),
// rewritten for chat/composer/editor/doc.ts. An atom is one caret step everywhere.
import { isClosingFence, parseOpeningFence } from "../../../web/composer-rich-text-doc.ts";
import {
  ATOM_CHAR,
  type Block,
  type CodeBlock,
  type Doc,
  type EditResult,
  type Pos,
  type Selection,
  blockPlainText,
  caret,
  comparePos,
  deleteRange,
  docEnd,
  insertInline,
  isCollapsed,
  orderedRange,
  paragraph,
  replaceBlock,
} from "./doc.ts";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// ── Grapheme steps ───────────────────────────────────────────────────────

/** Latin text and atoms: a code unit that starts a cluster of its own and takes no marks we expect. */
function simple(code: number): boolean {
  return (code < 0x300 && code !== 0x0d) || code === 0xfffc;
}

function previousGrapheme(text: string, offset: number): number {
  if (offset <= 0) return 0;
  if (simple(text.charCodeAt(offset - 1))) return offset - 1;
  let last = 0;
  for (const segment of graphemes.segment(text.slice(0, offset))) last = segment.index;
  return last;
}

function nextGrapheme(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  if (simple(text.charCodeAt(offset)) && (offset + 1 >= text.length || simple(text.charCodeAt(offset + 1)))) return offset + 1;
  for (const segment of graphemes.segment(text.slice(offset))) {
    if (segment.index > 0) return offset + segment.index;
  }
  return text.length;
}

export function stepBackward(doc: Doc, pos: Pos): Pos {
  if (pos.offset > 0) return { block: pos.block, offset: previousGrapheme(doc.blocks[pos.block]!.text, pos.offset) };
  if (pos.block === 0) return pos;
  return { block: pos.block - 1, offset: doc.blocks[pos.block - 1]!.text.length };
}

export function stepForward(doc: Doc, pos: Pos): Pos {
  const text = doc.blocks[pos.block]!.text;
  if (pos.offset < text.length) return { block: pos.block, offset: nextGrapheme(text, pos.offset) };
  if (pos.block >= doc.blocks.length - 1) return pos;
  return { block: pos.block + 1, offset: 0 };
}

// ── Word steps (Ctrl/Alt+Arrow, Ctrl/Alt+Backspace) ──────────────────────

type CharClass = "space" | "word" | "atom" | "punct";

function classOf(char: string | undefined): CharClass {
  if (char === undefined || /\s/.test(char)) return "space";
  if (char === ATOM_CHAR) return "atom";
  if (/[\p{L}\p{N}\p{M}_]/u.test(char)) return "word";
  return "punct";
}

/** Start of the word before the caret, skipping whitespace first; a chip is a word of its own. */
export function wordBackward(doc: Doc, pos: Pos): Pos {
  if (pos.offset === 0) return stepBackward(doc, pos);
  const text = doc.blocks[pos.block]!.text;
  let index = pos.offset;
  while (index > 0 && classOf(text[index - 1]) === "space") index -= 1;
  if (index === 0) return { block: pos.block, offset: 0 };
  const kind = classOf(text[index - 1]);
  if (kind === "atom") return { block: pos.block, offset: index - 1 };
  while (index > 0 && classOf(text[index - 1]) === kind) index -= 1;
  return { block: pos.block, offset: index };
}

/**
 * Windows moves to the start of the next word (past the spaces after this one); macOS and
 * Linux stop at the end of the word, as their browsers do.
 */
export function wordForward(doc: Doc, pos: Pos): Pos {
  const text = doc.blocks[pos.block]!.text;
  if (pos.offset >= text.length) return stepForward(doc, pos);
  let index = pos.offset;
  if (process.platform === "win32") {
    const kind = classOf(text[index]);
    if (kind === "atom") index += 1;
    else if (kind !== "space") while (index < text.length && classOf(text[index]) === kind) index += 1;
    while (index < text.length && classOf(text[index]) === "space") index += 1;
    return { block: pos.block, offset: index };
  }
  while (index < text.length && classOf(text[index]) === "space") index += 1;
  if (index >= text.length) return { block: pos.block, offset: index };
  const kind = classOf(text[index]);
  if (kind === "atom") return { block: pos.block, offset: index + 1 };
  while (index < text.length && classOf(text[index]) === kind) index += 1;
  return { block: pos.block, offset: index };
}

/** The word under a position, for double-click. A chip selects as itself. */
export function wordRangeAt(doc: Doc, pos: Pos): [Pos, Pos] {
  const text = doc.blocks[pos.block]!.text;
  if (text.length === 0) return [pos, pos];
  const at = Math.min(pos.offset, text.length - 1);
  const kind = classOf(text[at]);
  if (kind === "atom") return [{ block: pos.block, offset: at }, { block: pos.block, offset: at + 1 }];
  let start = at;
  let end = at + 1;
  while (start > 0 && classOf(text[start - 1]) === kind) start -= 1;
  while (end < text.length && classOf(text[end]) === kind) end += 1;
  return [
    { block: pos.block, offset: start },
    { block: pos.block, offset: end },
  ];
}

// ── Deletes ──────────────────────────────────────────────────────────────

export function deleteSelection(doc: Doc, selection: Selection): EditResult {
  const [from, to] = orderedRange(selection);
  return deleteRange(doc, from, to);
}

/**
 * Backspace. At the start of a code block its lines turn back into paragraphs (web
 * unwrapCodeBlockAtStart: joining them onto the line above would drop the fence).
 */
export function deleteBackward(doc: Doc, selection: Selection, unit: "char" | "word" | "line" = "char"): EditResult | null {
  if (!isCollapsed(selection)) return deleteSelection(doc, selection);
  const pos = selection.head;
  const block = doc.blocks[pos.block]!;
  if (pos.offset === 0 && block.kind === "code") return unwrapCodeBlock(doc, pos.block);
  if (pos.offset === 0 && pos.block === 0) return null;
  const target =
    unit === "word" ? wordBackward(doc, pos) : unit === "line" && pos.offset > 0 ? lineStart(block, pos) : stepBackward(doc, pos);
  return deleteRange(doc, target, pos);
}

export function deleteForward(doc: Doc, selection: Selection, unit: "char" | "word" | "line" = "char"): EditResult | null {
  if (!isCollapsed(selection)) return deleteSelection(doc, selection);
  const pos = selection.head;
  const block = doc.blocks[pos.block]!;
  if (comparePos(pos, docEnd(doc)) === 0) return null;
  const target =
    unit === "word"
      ? wordForward(doc, pos)
      : unit === "line" && pos.offset < block.text.length
        ? lineEnd(block, pos)
        : stepForward(doc, pos);
  return deleteRange(doc, pos, target);
}

function lineStart(block: Block, pos: Pos): Pos {
  const index = block.kind === "code" ? block.text.lastIndexOf("\n", pos.offset - 1) + 1 : 0;
  return { block: pos.block, offset: index };
}

function lineEnd(block: Block, pos: Pos): Pos {
  if (block.kind !== "code") return { block: pos.block, offset: block.text.length };
  const index = block.text.indexOf("\n", pos.offset);
  return { block: pos.block, offset: index === -1 ? block.text.length : index };
}

function unwrapCodeBlock(doc: Doc, index: number): EditResult {
  const block = doc.blocks[index] as CodeBlock;
  const lines = block.text.split("\n").map((line) => paragraph(line));
  return { doc: replaceBlock(doc, index, lines), selection: caret({ block: index, offset: 0 }) };
}

// ── Code blocks (composer-code-block.ts) ─────────────────────────────────

const CODE_BLOCK_INDENT = "  ";

export function selectionInOneCodeBlock(doc: Doc, selection: Selection): boolean {
  return selection.anchor.block === selection.head.block && doc.blocks[selection.head.block]?.kind === "code";
}

/** convertCodeFenceOnEnter: Enter at the end of a line like ```ts makes it a code block. */
export function convertCodeFenceOnEnter(doc: Doc, selection: Selection): EditResult | null {
  if (!isCollapsed(selection)) return null;
  const pos = selection.head;
  const block = doc.blocks[pos.block]!;
  if (block.kind !== "paragraph" || pos.offset !== block.text.length) return null;
  const opening = parseOpeningFence(blockPlainText(block));
  if (!opening) return null;
  const code: CodeBlock = { kind: "code", info: opening.language, fence: opening.fence, close: `\n${opening.fence}`, text: "" };
  return { doc: replaceBlock(doc, pos.block, [code]), selection: caret({ block: pos.block, offset: 0 }) };
}

/** exitCodeBlockOnClosingFence: Enter after a closing fence line ends the block there. */
export function exitCodeBlockOnClosingFence(doc: Doc, selection: Selection): EditResult | null {
  if (!isCollapsed(selection)) return null;
  const pos = selection.head;
  const block = doc.blocks[pos.block]!;
  if (block.kind !== "code") return null;
  const caretOffset = pos.offset;
  const start = block.text.lastIndexOf("\n", caretOffset - 1) + 1;
  const newlineAfter = block.text.indexOf("\n", caretOffset);
  const end = newlineAfter === -1 ? block.text.length : newlineAfter;
  const line = block.text.slice(start, end);
  if (caretOffset !== end || !isClosingFence(line, block.fence)) return null;
  const code = block.text.slice(0, Math.max(0, start - 1));
  const rest = newlineAfter === -1 ? [] : block.text.slice(newlineAfter + 1).split("\n");
  const closed: CodeBlock = { ...block, close: `\n${line}`, text: code };
  return {
    doc: replaceBlock(doc, pos.block, [closed, paragraph(""), ...rest.map((text) => paragraph(text))]),
    selection: caret({ block: pos.block + 1, offset: 0 }),
  };
}

/** exitCodeBlockOnTrailingBlankLines: two blank lines at the end of the code leave the block. */
export function exitCodeBlockOnTrailingBlankLines(doc: Doc, selection: Selection): EditResult | null {
  if (!isCollapsed(selection)) return null;
  const pos = selection.head;
  const block = doc.blocks[pos.block]!;
  if (block.kind !== "code" || pos.offset !== block.text.length) return null;
  const trailing = /\n[ \t]*\n[ \t]*$/.exec(block.text);
  if (!trailing) return null;
  // An unclosed fence runs to the end of the draft; leaving it writes the closing fence.
  const closed: CodeBlock = {
    ...block,
    text: block.text.slice(0, block.text.length - trailing[0].length),
    close: block.close || `\n${block.fence}`,
  };
  // ProseMirror's exitCode: a new paragraph after the block takes the caret.
  return { doc: replaceBlock(doc, pos.block, [closed, paragraph("")]), selection: caret({ block: pos.block + 1, offset: 0 }) };
}

/** indentedNewlineInCodeBlock, falling back to newlineInCode. */
export function newlineInCodeBlock(doc: Doc, selection: Selection): EditResult {
  const removed = isCollapsed(selection) ? { doc, selection } : deleteSelection(doc, selection);
  const pos = removed.selection.head;
  const block = removed.doc.blocks[pos.block]!;
  const before = block.text.slice(0, pos.offset);
  const currentLine = before.slice(before.lastIndexOf("\n") + 1);
  const indent = /^[ \t]*/.exec(currentLine)?.[0] ?? "";
  return insertInline(removed.doc, pos, `\n${indent}`);
}

function outdentLine(line: string): string {
  if (line.startsWith(CODE_BLOCK_INDENT)) return line.slice(CODE_BLOCK_INDENT.length);
  if (line.startsWith("\t")) return line.slice(1);
  if (line.startsWith(" ")) return line.slice(1);
  return line;
}

/** indentCodeBlock: Tab indents (a collapsed caret inserts two spaces), Shift+Tab outdents. */
export function indentCodeBlock(doc: Doc, selection: Selection, direction: "in" | "out"): EditResult {
  const [from, to] = orderedRange(selection);
  const block = doc.blocks[from.block] as CodeBlock;
  if (isCollapsed(selection) && direction === "in") return insertInline(doc, from, CODE_BLOCK_INDENT);
  const start = block.text.lastIndexOf("\n", Math.max(0, from.offset - 1)) + 1;
  const newlineAfter = block.text.indexOf("\n", Math.max(from.offset, to.offset - 1));
  const end = newlineAfter === -1 ? block.text.length : newlineAfter;
  const original = block.text.slice(start, end).split("\n");
  const next = original.map((line) => (direction === "in" ? (line.length === 0 ? line : `${CODE_BLOCK_INDENT}${line}`) : outdentLine(line)));
  const joined = next.join("\n");
  if (joined === original.join("\n")) return { doc, selection };
  const nextBlock: CodeBlock = { ...block, text: block.text.slice(0, start) + joined + block.text.slice(end) };
  const firstDelta = (next[0]?.length ?? 0) - (original[0]?.length ?? 0);
  const totalDelta = joined.length - original.join("\n").length;
  const nextFrom = Math.max(start, from.offset + firstDelta);
  const nextTo = Math.max(nextFrom, to.offset + totalDelta);
  const forward = comparePos(selection.anchor, selection.head) <= 0;
  const anchor = { block: from.block, offset: forward ? nextFrom : nextTo };
  const head = { block: from.block, offset: forward ? nextTo : nextFrom };
  return { doc: replaceBlock(doc, from.block, [nextBlock]), selection: { anchor, head } };
}
