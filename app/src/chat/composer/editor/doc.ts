// The composer's document: what web's Tiptap schema holds (ComposerPromptEditorTiptap.tsx,
// composer-rich-text-doc.ts), as plain data. Paragraphs hold text and inline atoms (the
// mention, skill, citation and context-reference chips); fenced code is a block of its own.
// The stored prompt is the Markdown this serializes to, and parseDoc rebuilds the same
// blocks from it, the way web's buildTiptapContent does.
//
// Not ported: web's inline styling (bold, italic, inline code, strike), lists, task lists,
// headings, quotes and rules. Their Markdown stays literal text in a paragraph, so the
// stored prompt is unchanged; only the presentation differs.
import type { AssistantCitation } from "@t3tools/contracts";
import { composerMathRanges } from "@t3tools/shared/composerInlineTokens";

import { splitPromptIntoComposerSegments } from "../../../web/composer-editor-mentions.ts";
import { isClosingFence, parseOpeningFence } from "../../../web/composer-rich-text-doc.ts";

/** Stands for one atom inside a paragraph's text. Never kept from typed or pasted text. */
export const ATOM_CHAR = "￼";

export interface SkillMeta {
  readonly label: string;
  readonly description: string | null;
}

export type Atom =
  | { readonly kind: "mention"; readonly path: string; readonly source: string }
  | { readonly kind: "skill"; readonly name: string; readonly label: string; readonly description: string | null; readonly source: string }
  | { readonly kind: "citation"; readonly citation: AssistantCitation; readonly source: string; readonly key: string }
  | { readonly kind: "context"; readonly contextKind: string; readonly contextId: string; readonly label: string; readonly source: string };

export interface ParagraphBlock {
  readonly kind: "paragraph";
  /** Text with one ATOM_CHAR per atom, in order. */
  readonly text: string;
  readonly atoms: ReadonlyArray<Atom>;
}

export interface CodeBlock {
  readonly kind: "code";
  /** The info string after the fence (language, then anything else). */
  readonly info: string;
  readonly fence: string;
  /** "\n```" when closed, "" for a fence that runs to the end of the draft. */
  readonly close: string;
  readonly text: string;
}

export type Block = ParagraphBlock | CodeBlock;

export interface Doc {
  readonly blocks: ReadonlyArray<Block>;
}

/** A caret position: a block and a UTF-16 offset into its text (an atom is one unit). */
export interface Pos {
  readonly block: number;
  readonly offset: number;
}

export interface Selection {
  readonly anchor: Pos;
  readonly head: Pos;
}

export const EMPTY_PARAGRAPH: ParagraphBlock = { kind: "paragraph", text: "", atoms: [] };

export function paragraph(text: string, atoms: ReadonlyArray<Atom> = []): ParagraphBlock {
  return { kind: "paragraph", text, atoms };
}

export function comparePos(a: Pos, b: Pos): number {
  return a.block !== b.block ? a.block - b.block : a.offset - b.offset;
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.block === b.block && a.offset === b.offset;
}

export function orderedRange(selection: Selection): [Pos, Pos] {
  return comparePos(selection.anchor, selection.head) <= 0
    ? [selection.anchor, selection.head]
    : [selection.head, selection.anchor];
}

export function isCollapsed(selection: Selection): boolean {
  return samePos(selection.anchor, selection.head);
}

export function caret(pos: Pos): Selection {
  return { anchor: pos, head: pos };
}

let citeKeySeed = 0;
function nextCiteKey(): string {
  citeKeySeed += 1;
  return `cite-${citeKeySeed}`;
}

/** Drops atom placeholders from text that came from outside (typing, paste). */
export function sanitizeText(text: string): string {
  return text.includes(ATOM_CHAR) ? text.replaceAll(ATOM_CHAR, "") : text;
}

// ── Markdown → doc (web buildTiptapContent, without inline styling) ──────

export interface ParseOptions {
  readonly skillMeta: (name: string) => SkillMeta | null;
  /** Fenced code becomes code blocks (web: the rich text setting). */
  readonly codeBlocks: boolean;
  /** Everything stays text (web literalText: a pending question's custom answer). */
  readonly literal?: boolean;
  /**
   * Keeps this many leading characters as text (web literalLength): a paste that continues
   * a path query must reach file search as typed.
   */
  readonly literalLength?: number;
}

function atomForSegment(
  segment: Exclude<ReturnType<typeof splitPromptIntoComposerSegments>[number], { type: "text" }>,
  skillMeta: (name: string) => SkillMeta | null,
): Atom | null {
  if (segment.type === "mention") return { kind: "mention", path: segment.path, source: segment.source };
  if (segment.type === "skill") {
    const meta = skillMeta(segment.name);
    if (!meta) return null;
    return { kind: "skill", name: segment.name, label: meta.label, description: meta.description, source: segment.source };
  }
  if (segment.type === "citation") {
    return { kind: "citation", citation: segment.citation, source: segment.source, key: nextCiteKey() };
  }
  return {
    kind: "context",
    contextKind: segment.kind,
    contextId: segment.contextId,
    label: segment.label,
    source: segment.source,
  };
}

/** Inline content of `text`: plain text plus atoms for each token, math shielded like web. */
export function parseInline(text: string, options: ParseOptions): { text: string; atoms: Atom[] } {
  if (options.literal) return { text: sanitizeText(text), atoms: [] };
  const atoms: Atom[] = [];
  let out = "";
  let offset = 0;
  const pushTokens = (chunk: string) => {
    for (const segment of splitPromptIntoComposerSegments(chunk)) {
      if (segment.type === "text") {
        out += sanitizeText(segment.text);
        continue;
      }
      const atom = atomForSegment(segment, options.skillMeta);
      if (!atom) {
        out += sanitizeText(segment.source);
        continue;
      }
      atoms.push(atom);
      out += ATOM_CHAR;
    }
  };
  for (const formula of composerMathRanges(text)) {
    pushTokens(text.slice(offset, formula.start));
    out += sanitizeText(formula.source);
    offset = formula.end;
  }
  pushTokens(text.slice(offset));
  return { text: out, atoms };
}

/**
 * Splits into lines first and then finds tokens per paragraph line. Web finds tokens over
 * the whole prompt before splitting; a token never spans a newline, and web's mention rule
 * needs whitespace after it, which a line end gives in both, so the results agree.
 */
export function parseDoc(value: string, options: ParseOptions): Doc {
  const lines = value.split("\n");
  const blocks: Block[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const opening = options.codeBlocks && !options.literal ? parseOpeningFence(line) : null;
    if (!opening) {
      const literal = index === 0 ? sanitizeText(line.slice(0, options.literalLength ?? 0)) : "";
      const rest = line.slice(literal.length);
      // The newline after the line lets a token at the line end match (web's `(?=\s)`).
      const inline = parseInline(index < lines.length - 1 ? `${rest}\n` : rest, options);
      const text = index < lines.length - 1 ? inline.text.slice(0, -1) : inline.text;
      blocks.push(paragraph(literal + text, inline.atoms));
      continue;
    }
    const body: string[] = [];
    let cursor = index + 1;
    let close = "";
    while (cursor < lines.length) {
      const candidate = lines[cursor]!;
      if (isClosingFence(candidate, opening.fence)) {
        close = `\n${candidate}`;
        break;
      }
      body.push(candidate);
      cursor += 1;
    }
    blocks.push({ kind: "code", info: opening.language, fence: opening.fence, close, text: sanitizeText(body.join("\n")) });
    index = cursor < lines.length ? cursor : lines.length;
  }
  if (blocks.length === 0) blocks.push(EMPTY_PARAGRAPH);
  return { blocks };
}

// ── Doc → Markdown (web serializeEditorDoc) ──────────────────────────────

/** web codeBlockSource: a longer fence when the code holds a closing fence, closed when followed. */
export function codeBlockSource(block: CodeBlock, followed: boolean): { open: string; content: string; close: string } {
  let fence = block.fence || "```";
  let close = block.close;
  const longest = Math.max(
    0,
    ...block.text
      .split("\n")
      .filter((line) => isClosingFence(line, fence))
      .map((line) => /^[`~]+/.exec(line)![0].length),
  );
  if (longest > 0) {
    fence = fence[0]!.repeat(longest + 1);
    if (close) close = `\n${fence}`;
  }
  if (!close && followed) close = `\n${fence}`;
  return { open: `${fence}${block.info}${block.text ? "\n" : ""}`, content: block.text, close };
}

export function paragraphSource(block: ParagraphBlock, from = 0, to = block.text.length): string {
  if (block.atoms.length === 0) return block.text.slice(from, to);
  let out = "";
  let atomIndex = atomIndexAt(block, from);
  for (let index = from; index < to; index += 1) {
    const char = block.text[index]!;
    if (char === ATOM_CHAR) {
      out += block.atoms[atomIndex]?.source ?? "";
      atomIndex += 1;
    } else {
      out += char;
    }
  }
  return out;
}

export function blockSource(block: Block, followed: boolean): string {
  if (block.kind === "paragraph") return paragraphSource(block);
  const { open, content, close } = codeBlockSource(block, followed);
  return open + content + close;
}

export function serializeDoc(doc: Doc): string {
  return doc.blocks.map((block, index) => blockSource(block, index < doc.blocks.length - 1)).join("\n");
}

/** Context ids referenced by the doc's chips, in order (web map.contextIds). */
export function docContextIds(doc: Doc): string[] {
  const ids: string[] = [];
  for (const block of doc.blocks) {
    if (block.kind !== "paragraph") continue;
    for (const atom of block.atoms) if (atom.kind === "context" && !ids.includes(atom.contextId)) ids.push(atom.contextId);
  }
  return ids;
}

// ── Positions ↔ Markdown offsets (web pmToFlat / flatToMarkdown / markdownToFlat) ──

/** Number of atoms before `offset` in a paragraph. */
export function atomIndexAt(block: ParagraphBlock, offset: number): number {
  if (block.atoms.length === 0) return 0;
  let count = 0;
  for (let index = 0; index < offset && index < block.text.length; index += 1) if (block.text[index] === ATOM_CHAR) count += 1;
  return count;
}

export function atomAt(block: Block, offset: number): Atom | null {
  if (block.kind !== "paragraph" || block.text[offset] !== ATOM_CHAR) return null;
  return block.atoms[atomIndexAt(block, offset)] ?? null;
}

interface BlockSpan {
  /** Markdown offset where the block starts. */
  readonly start: number;
  /** Markdown offset where its text (offset 0) starts. */
  readonly contentStart: number;
  readonly end: number;
}

export function blockSpans(doc: Doc): BlockSpan[] {
  const spans: BlockSpan[] = [];
  let md = 0;
  doc.blocks.forEach((block, index) => {
    const followed = index < doc.blocks.length - 1;
    if (block.kind === "paragraph") {
      const length = paragraphSource(block).length;
      spans.push({ start: md, contentStart: md, end: md + length });
      md += length + 1;
    } else {
      const { open, content, close } = codeBlockSource(block, followed);
      spans.push({ start: md, contentStart: md + open.length, end: md + open.length + content.length + close.length });
      md += open.length + content.length + close.length + 1;
    }
  });
  return spans;
}

export function posToMarkdown(doc: Doc, pos: Pos, spans = blockSpans(doc)): number {
  const block = doc.blocks[pos.block];
  const span = spans[pos.block];
  if (!block || !span) return 0;
  if (block.kind === "code") return span.contentStart + Math.min(pos.offset, block.text.length);
  return span.contentStart + paragraphSource(block, 0, pos.offset).length;
}

export function markdownToPos(doc: Doc, md: number, spans = blockSpans(doc)): Pos {
  const target = Math.max(0, md);
  for (let index = 0; index < doc.blocks.length; index += 1) {
    const span = spans[index]!;
    const block = doc.blocks[index]!;
    if (target > span.end && index < doc.blocks.length - 1) continue;
    if (block.kind === "code") {
      return { block: index, offset: Math.max(0, Math.min(block.text.length, target - span.contentStart)) };
    }
    let mdOffset = span.contentStart;
    let atomIndex = 0;
    for (let offset = 0; offset < block.text.length; offset += 1) {
      if (mdOffset >= target) return { block: index, offset };
      const char = block.text[offset]!;
      const length = char === ATOM_CHAR ? (block.atoms[atomIndex++]?.source.length ?? 1) : 1;
      // Inside an atom's source: the nearer side of the chip.
      if (target < mdOffset + length) return { block: index, offset: target - mdOffset < mdOffset + length - target ? offset : offset + 1 };
      mdOffset += length;
    }
    return { block: index, offset: block.text.length };
  }
  const last = doc.blocks.length - 1;
  return { block: last, offset: doc.blocks[last]!.text.length };
}

export function docStart(): Pos {
  return { block: 0, offset: 0 };
}

export function docEnd(doc: Doc): Pos {
  const last = doc.blocks.length - 1;
  return { block: last, offset: doc.blocks[last]!.text.length };
}

export function clampPos(doc: Doc, pos: Pos): Pos {
  const block = Math.max(0, Math.min(doc.blocks.length - 1, pos.block));
  return { block, offset: Math.max(0, Math.min(doc.blocks[block]!.text.length, pos.offset)) };
}

// ── Editing ──────────────────────────────────────────────────────────────

function sliceParagraph(block: ParagraphBlock, from: number, to: number): ParagraphBlock {
  if (block.atoms.length === 0) return paragraph(block.text.slice(from, to));
  const first = atomIndexAt(block, from);
  const last = atomIndexAt(block, to);
  return paragraph(block.text.slice(from, to), block.atoms.slice(first, last));
}

function concatParagraphs(a: ParagraphBlock, b: ParagraphBlock): ParagraphBlock {
  return paragraph(a.text + b.text, a.atoms.length || b.atoms.length ? [...a.atoms, ...b.atoms] : []);
}

/** A block's content as plain text, chips written as their source (what a code block can hold). */
export function blockPlainText(block: Block, from = 0, to = block.text.length): string {
  return block.kind === "paragraph" ? paragraphSource(block, from, to) : block.text.slice(from, to);
}

function sliceBlock(block: Block, from: number, to: number): Block {
  return block.kind === "paragraph" ? sliceParagraph(block, from, to) : { ...block, text: block.text.slice(from, to) };
}

/**
 * Joins the end of one block with the start of another, like ProseMirror's join after a
 * delete across blocks: the first block's type wins. A code tail joined onto a paragraph
 * keeps its lines, as paragraphs.
 */
function joinBlocks(head: Block, tail: Block): Block[] {
  if (head.kind === "paragraph" && tail.kind === "paragraph") return [concatParagraphs(head, tail)];
  if (head.kind === "code") return [{ ...head, text: head.text + blockPlainText(tail) }];
  const lines = tail.text.split("\n");
  return [concatParagraphs(head as ParagraphBlock, paragraph(sanitizeText(lines[0] ?? ""))), ...lines.slice(1).map((line) => paragraph(line))];
}

export interface EditResult {
  readonly doc: Doc;
  readonly selection: Selection;
}

function withBlocks(doc: Doc, start: number, deleteCount: number, insert: ReadonlyArray<Block>): Doc {
  const blocks = doc.blocks.slice();
  blocks.splice(start, deleteCount, ...insert);
  if (blocks.length === 0) blocks.push(EMPTY_PARAGRAPH);
  return { blocks };
}

export function deleteRange(doc: Doc, from: Pos, to: Pos): EditResult {
  const [start, end] = comparePos(from, to) <= 0 ? [from, to] : [to, from];
  if (samePos(start, end)) return { doc, selection: caret(start) };
  // Everything selected (ProseMirror's AllSelection): what is left is one empty paragraph.
  if (start.block === 0 && start.offset === 0 && samePos(end, docEnd(doc))) {
    return { doc: { blocks: [EMPTY_PARAGRAPH] }, selection: caret({ block: 0, offset: 0 }) };
  }
  const startBlock = doc.blocks[start.block]!;
  const endBlock = doc.blocks[end.block]!;
  const head = sliceBlock(startBlock, 0, start.offset);
  const tail = sliceBlock(endBlock, end.offset, endBlock.text.length);
  const joined = start.block === end.block ? [joinSame(head, tail)] : joinBlocks(head, tail);
  return { doc: withBlocks(doc, start.block, end.block - start.block + 1, joined), selection: caret(start) };
}

function joinSame(head: Block, tail: Block): Block {
  if (head.kind === "paragraph" && tail.kind === "paragraph") return concatParagraphs(head, tail);
  return { ...(head as CodeBlock), text: head.text + tail.text };
}

/** Inserts text (and atoms, in a paragraph) at a position. Newlines in a paragraph split it. */
export function insertInline(doc: Doc, pos: Pos, text: string, atoms: ReadonlyArray<Atom> = []): EditResult {
  const block = doc.blocks[pos.block]!;
  if (block.kind === "code") {
    const plain = atoms.length > 0 ? paragraphSource(paragraph(text, atoms)) : sanitizeText(text);
    const next: CodeBlock = { ...block, text: block.text.slice(0, pos.offset) + plain + block.text.slice(pos.offset) };
    return { doc: withBlocks(doc, pos.block, 1, [next]), selection: caret({ block: pos.block, offset: pos.offset + plain.length }) };
  }
  if (text.includes("\n")) {
    const lines = text.split("\n");
    let atomCursor = 0;
    const fragment: ParagraphBlock[] = lines.map((line) => {
      const count = [...line].filter((char) => char === ATOM_CHAR).length;
      const piece = paragraph(line, atoms.slice(atomCursor, atomCursor + count));
      atomCursor += count;
      return piece;
    });
    return insertBlocks(doc, pos, fragment);
  }
  const before = atomIndexAt(block, pos.offset);
  const nextAtoms = atoms.length > 0 ? [...block.atoms.slice(0, before), ...atoms, ...block.atoms.slice(before)] : block.atoms;
  const next = paragraph(block.text.slice(0, pos.offset) + text + block.text.slice(pos.offset), nextAtoms);
  return { doc: withBlocks(doc, pos.block, 1, [next]), selection: caret({ block: pos.block, offset: pos.offset + text.length }) };
}

/**
 * Inserts whole blocks at a position, the way ProseMirror's insertContent does: the first
 * and last pieces join the text around the caret when both are paragraphs; an emptied
 * paragraph the insert lands in is replaced. The caret ends after the inserted content.
 */
export function insertBlocks(doc: Doc, pos: Pos, fragment: ReadonlyArray<Block>): EditResult {
  if (fragment.length === 0) return { doc, selection: caret(pos) };
  const block = doc.blocks[pos.block]!;
  if (block.kind === "code") {
    const text = fragment.map((piece) => blockPlainText(piece)).join("\n");
    return insertInline(doc, pos, text);
  }
  if (fragment.length === 1 && fragment[0]!.kind === "paragraph") {
    return insertInline(doc, pos, fragment[0]!.text, fragment[0]!.atoms);
  }
  const head = sliceParagraph(block, 0, pos.offset);
  const tail = sliceParagraph(block, pos.offset, block.text.length);
  const out: Block[] = [];
  const first = fragment[0]!;
  if (first.kind === "paragraph") out.push(concatParagraphs(head, first));
  else {
    if (head.text.length > 0) out.push(head);
    out.push(first);
  }
  for (const piece of fragment.slice(1, -1)) out.push(piece);
  const last = fragment.length > 1 ? fragment[fragment.length - 1]! : null;
  let caretPos: Pos;
  if (last === null) {
    // One code block: the text after the caret goes on in a paragraph after it.
    caretPos = { block: pos.block + out.length - 1, offset: out[out.length - 1]!.text.length };
    out.push(tail);
  } else if (last.kind === "paragraph") {
    out.push(concatParagraphs(last, tail));
    caretPos = { block: pos.block + out.length - 1, offset: last.text.length };
  } else {
    out.push(last);
    caretPos = { block: pos.block + out.length - 1, offset: last.text.length };
    out.push(tail);
  }
  return { doc: withBlocks(doc, pos.block, 1, out), selection: caret(caretPos) };
}

/** Enter in a paragraph (web splitBlockKeepMarks): the paragraph splits at the caret. */
export function splitParagraph(doc: Doc, pos: Pos): EditResult {
  const block = doc.blocks[pos.block]!;
  if (block.kind === "code") return insertInline(doc, pos, "\n");
  const head = sliceParagraph(block, 0, pos.offset);
  const tail = sliceParagraph(block, pos.offset, block.text.length);
  return { doc: withBlocks(doc, pos.block, 1, [head, tail]), selection: caret({ block: pos.block + 1, offset: 0 }) };
}

export function replaceBlock(doc: Doc, index: number, blocks: ReadonlyArray<Block>): Doc {
  return withBlocks(doc, index, 1, blocks);
}

/** The Markdown of a range, for copy (web serializeSelection). */
export function serializeRange(doc: Doc, from: Pos, to: Pos): string {
  const [start, end] = comparePos(from, to) <= 0 ? [from, to] : [to, from];
  if (start.block === end.block) {
    const block = doc.blocks[start.block]!;
    return blockPlainText(block, start.offset, end.offset);
  }
  const pieces: Block[] = [];
  for (let index = start.block; index <= end.block; index += 1) {
    const block = doc.blocks[index]!;
    const from = index === start.block ? start.offset : 0;
    const to = index === end.block ? end.offset : block.text.length;
    pieces.push(sliceBlock(block, from, to));
  }
  // Partial code at either end still copies as code, fenced.
  return serializeDoc({ blocks: pieces });
}
