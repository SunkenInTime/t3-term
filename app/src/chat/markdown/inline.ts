// Line breaking for markdown inline content.
//
// web lays a paragraph out as one inline formatting context: styled runs,
// inline code pills that split across lines (box-decoration-break: clone),
// chips and favicons as atomic inlines, `overflow-wrap: anywhere`. gpuix has no
// inline layout, so this module does the browser's job: it breaks the atoms
// into lines with measured widths (measure.ts), and the renderer paints each
// line as a row of a few nowrap runs. Fewer, wider runs are what keep long
// threads cheap: every <text> costs per frame, a line costs one row.
import { graphemeList, textWidth, type FontFace } from "./measure.ts";

export interface PillStyle {
  /** Horizontal padding inside the border, each side. */
  readonly padX: number;
  readonly border: number;
  readonly radius: number;
  readonly background: string;
  readonly borderColor: string;
  readonly height: number;
}

export interface RunStyle {
  /** Identity for merging neighbouring runs: equal keys paint as one run. */
  readonly key: string;
  readonly face: FontFace;
  readonly size: number;
  readonly color: string;
  readonly lineHeight: number;
  readonly decoration?: "underline" | "line-through" | undefined;
  readonly pill?: PillStyle | undefined;
  /** Index into the paragraph's link table; runs of one link hover and click together. */
  readonly link?: number | undefined;
  /** Text that may break between any two characters (web's per-character <wbr>). */
  readonly breakAnywhere?: boolean | undefined;
  /** Italic is requested but gpuix host text cannot slant; kept for copy and tests. */
  readonly italic?: boolean | undefined;
}

export interface BoxAtom {
  readonly kind: "box";
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly marginLeft?: number | undefined;
  readonly marginRight?: number | undefined;
  readonly link?: number | undefined;
  readonly payload: unknown;
}

export type InlineAtom =
  | { readonly kind: "text"; readonly text: string; readonly style: RunStyle }
  | BoxAtom
  | { readonly kind: "break" };

export type LinePiece =
  | { readonly kind: "text"; readonly text: string; readonly style: RunStyle; readonly width: number; readonly atom: number }
  | { readonly kind: "box"; readonly atom: BoxAtom; readonly width: number };

export interface InlineLine {
  readonly pieces: ReadonlyArray<LinePiece>;
  readonly width: number;
  readonly height: number;
  /** Ended by a hard break (<br>), not by wrapping. */
  readonly hardBreak: boolean;
}

interface Unit {
  readonly atom: number;
  readonly text: string;
  /** Advance of the visible part, without trailing spaces. */
  readonly width: number;
  /** Trailing space: kept in the text for copies, hangs at a line end. */
  readonly space: string;
  readonly spaceWidth: number;
  readonly breakAfter: boolean;
  readonly box?: BoxAtom | undefined;
  readonly style?: RunStyle | undefined;
  readonly hardBreak?: boolean | undefined;
}

const CJK = /[⺀-鿿가-힣豈-﫿＀-￯぀-ヿ]/u;
const LETTER = /[\p{L}\p{N}]/u;

function pillExtra(style: RunStyle | undefined): number {
  return style?.pill ? 2 * (style.pill.padX + style.pill.border) : 0;
}

function appendSpace(out: Unit[], atomIndex: number, style: RunStyle, width: number) {
  const previous = out[out.length - 1];
  if (!previous || previous.hardBreak) return;
  if (previous.space.length > 0) return; // collapsible whitespace
  const sameAtom = previous.atom === atomIndex;
  const plainPrevious =
    previous.style !== undefined && !previous.style.pill && previous.style.link === undefined && previous.style.decoration === undefined;
  if (!previous.box && (sameAtom || plainPrevious)) {
    out[out.length - 1] = { ...previous, space: " ", spaceWidth: width, breakAfter: true };
    return;
  }
  // A space between a pill, link or box and what follows sits outside them.
  out.push({ atom: atomIndex, text: "", width: 0, space: " ", spaceWidth: width, breakAfter: true, style });
}

/** Word units: a word plus the space after it, with web's break opportunities. */
function textUnits(atomIndex: number, text: string, style: RunStyle, out: Unit[]) {
  const measure = (value: string) => textWidth(style.face, style.size, value);
  const spaceWidth = measure(" ");
  if (style.breakAnywhere) {
    for (const char of graphemeList(text)) {
      if (char === " ") appendSpace(out, atomIndex, style, spaceWidth);
      else out.push({ atom: atomIndex, text: char, width: measure(char), space: "", spaceWidth: 0, breakAfter: true, style });
    }
    return;
  }
  for (const match of text.matchAll(/ +|[^ ]+/g)) {
    const token = match[0];
    if (token[0] === " ") {
      appendSpace(out, atomIndex, style, spaceWidth);
      continue;
    }
    // Break opportunities inside a word: after a hyphen between letters, and
    // around CJK characters (UAX #14 ideographs).
    const chars = graphemeList(token);
    let current = "";
    const parts: string[] = [];
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index]!;
      const next = chars[index + 1];
      current += char;
      const hyphenBreak = char === "-" && index > 0 && LETTER.test(chars[index - 1]!) && next !== undefined && LETTER.test(next);
      const cjkBreak = next !== undefined && (CJK.test(char) || CJK.test(next));
      if (hyphenBreak || cjkBreak) {
        parts.push(current);
        current = "";
      }
    }
    if (current) parts.push(current);
    parts.forEach((part, index) =>
      out.push({ atom: atomIndex, text: part, width: measure(part), space: "", spaceWidth: 0, breakAfter: index < parts.length - 1, style }),
    );
  }
}

function buildUnits(atoms: ReadonlyArray<InlineAtom>): Unit[] {
  const units: Unit[] = [];
  atoms.forEach((atom, index) => {
    if (atom.kind === "break") {
      units.push({ atom: index, text: "", width: 0, space: "", spaceWidth: 0, breakAfter: true, hardBreak: true });
    } else if (atom.kind === "box") {
      units.push({
        atom: index,
        text: "",
        width: atom.width + (atom.marginLeft ?? 0) + (atom.marginRight ?? 0),
        space: "",
        spaceWidth: 0,
        breakAfter: false,
        box: atom,
      });
    } else if (atom.text.length > 0) {
      textUnits(index, atom.text, atom.style, units);
    }
  });
  return units;
}

interface Placed {
  readonly unit: Unit;
  /** The unit's text, or a slice of it when overflow-wrap split the unit. */
  readonly text: string;
  readonly width: number;
  readonly whole: boolean;
}

function continuesFragment(previous: Placed | undefined, unit: Unit): boolean {
  return previous !== undefined && previous.unit.atom === unit.atom && previous.unit.style?.pill !== undefined;
}

/** Width a unit adds to a line: the previous unit's space becomes visible, a new pill fragment adds its padding. */
function cost(line: ReadonlyArray<Placed>, unit: Unit, width: number): number {
  const last = line[line.length - 1];
  const previousSpace = last && last.whole ? last.unit.spaceWidth : 0;
  return previousSpace + width + (unit.style?.pill && !continuesFragment(last, unit) ? pillExtra(unit.style) : 0);
}

function lineWidthOf(line: ReadonlyArray<Placed>): number {
  let total = 0;
  for (let index = 0; index < line.length; index += 1) total += cost(line.slice(0, index), line[index]!.unit, line[index]!.width);
  return total;
}

/**
 * Greedy line breaking, as browsers do it: words fill the line, a word that
 * does not fit moves to the next line, and a word wider than a whole line
 * breaks between characters (overflow-wrap: anywhere).
 */
export function layoutInline(atoms: ReadonlyArray<InlineAtom>, maxWidth: number, lineHeight: number): InlineLine[] {
  const units = buildUnits(atoms);
  const available = Math.max(1, maxWidth) + 0.01;
  const lines: Placed[][] = [];
  const hardBreaks = new Set<number>();
  let line: Placed[] = [];
  let width = 0;

  const newLine = () => {
    lines.push(line);
    line = [];
    width = 0;
  };
  const place = (placed: Placed) => {
    width += cost(line, placed.unit, placed.width);
    line.push(placed);
  };
  const lastBreak = () => {
    for (let index = line.length - 1; index >= 0; index -= 1) {
      const placed = line[index]!;
      if (placed.whole && placed.unit.breakAfter) return index;
    }
    return -1;
  };
  // overflow-wrap: anywhere — a unit wider than the room left fills lines character by character.
  const placeSplit = (unit: Unit) => {
    const style = unit.style;
    const chars = graphemeList(unit.text);
    let chunk = "";
    let chunkWidth = 0;
    for (const char of chars) {
      const charWidth = style ? textWidth(style.face, style.size, char) : 0;
      if (width + cost(line, unit, chunkWidth + charWidth) > available && (chunk.length > 0 || line.length > 0)) {
        if (chunk.length > 0) place({ unit, text: chunk, width: chunkWidth, whole: false });
        newLine();
        chunk = "";
        chunkWidth = 0;
      }
      chunk += char;
      chunkWidth += charWidth;
    }
    if (chunk.length > 0) place({ unit, text: chunk, width: chunkWidth, whole: chunk === unit.text });
  };

  for (const unit of units) {
    if (unit.hardBreak) {
      hardBreaks.add(lines.length);
      newLine();
      continue;
    }
    const whole: Placed = { unit, text: unit.text, width: unit.width, whole: true };
    if (width + cost(line, unit, unit.width) <= available) {
      place(whole);
      continue;
    }
    // Overflow: move everything after the last break opportunity to a new line.
    const breakAt = lastBreak();
    if (breakAt >= 0) {
      const carried = line.slice(breakAt + 1);
      line = line.slice(0, breakAt + 1);
      newLine();
      line = carried;
      width = lineWidthOf(line);
    } else if (line.length > 0 && !unit.box && unit.width + pillExtra(unit.style) <= available) {
      // No opportunity on this line and the word fits a line of its own: overflow-wrap
      // breaks right before it.
      newLine();
    }
    if (width + cost(line, unit, unit.width) <= available || unit.box) {
      if (unit.box && line.length > 0 && width + cost(line, unit, unit.width) > available) newLine();
      place(whole);
    } else {
      placeSplit(unit);
    }
  }
  if (line.length > 0 || lines.length === 0) lines.push(line);
  return lines.map((placed, index) => ({ ...assembleLine(placed, lineHeight), hardBreak: hardBreaks.has(index) }));
}

function assembleLine(placed: ReadonlyArray<Placed>, lineHeight: number): Omit<InlineLine, "hardBreak"> {
  const pieces: LinePiece[] = [];
  let width = 0;
  let height = lineHeight;
  placed.forEach((item, index) => {
    const isLast = index === placed.length - 1;
    const unit = item.unit;
    if (unit.box) {
      pieces.push({ kind: "box", atom: unit.box, width: item.width });
      width += item.width;
      height = Math.max(height, unit.box.height);
      return;
    }
    const style = unit.style!;
    const spaceText = item.whole && !(isLast && style.pill) ? unit.space : "";
    const spaceWidth = item.whole && !isLast ? unit.spaceWidth : 0;
    const text = item.text + spaceText;
    const previous = pieces[pieces.length - 1];
    const merge =
      previous !== undefined &&
      previous.kind === "text" &&
      previous.style.key === style.key &&
      previous.style.link === style.link &&
      (!style.pill || previous.atom === unit.atom);
    if (merge) {
      pieces[pieces.length - 1] = { ...previous, text: previous.text + text, width: previous.width + item.width + spaceWidth };
      width += item.width + spaceWidth;
    } else {
      const pieceWidth = item.width + spaceWidth + pillExtra(style);
      pieces.push({ kind: "text", text, style, width: pieceWidth, atom: unit.atom });
      width += pieceWidth;
    }
  });
  return { pieces, width, height };
}
