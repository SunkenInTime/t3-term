// Which link sits under a terminal cell, and the cells it covers. Port of
// terminalLinkAtPositionWithRange and GhosttyTerminalSurface.findLinkAt in
// apps/web/src/terminal/ghostty/surface.ts: OSC 8 hyperlinks win, then URLs and
// file paths detected in the text, joined across soft-wrapped rows. Like web,
// only viewport rows are read.
import { collectWrappedTerminalLinkLine, extractTerminalLinks } from "../web/terminal-links.ts";
import type { TerminalEmulator } from "./vt/emulator.ts";

export interface TerminalCellPoint {
  readonly x: number;
  readonly y: number;
}

/** Inclusive viewport cell range, as web's GhosttyCellRange. */
export interface TerminalCellRange {
  readonly start: TerminalCellPoint;
  readonly end: TerminalCellPoint;
}

export interface TerminalLinkWithRange {
  readonly text: string;
  readonly range: TerminalCellRange;
}

/** The slice of a ghostty snapshot row the link logic reads. */
export interface TerminalLinkRow {
  readonly cells: ReadonlyArray<{ readonly text: string }>;
  readonly isWrapContinuation: boolean;
  readonly wrapsToNext: boolean;
}

export function isSameTerminalLink(left: TerminalLinkWithRange, right: TerminalLinkWithRange | null): boolean {
  return (
    right?.text === left.text &&
    right.range.start.x === left.range.start.x &&
    right.range.start.y === left.range.start.y &&
    right.range.end.x === left.range.end.x &&
    right.range.end.y === left.range.end.y
  );
}

function terminalRowText(row: TerminalLinkRow, trimRight: boolean): string {
  const text = row.cells.map((cell) => cell.text || " ").join("");
  return trimRight ? text.trimEnd() : text;
}

function terminalColumnOffset(row: TerminalLinkRow, column: number): number {
  let offset = 0;
  for (let cellIndex = 0; cellIndex < column; cellIndex += 1) {
    offset += row.cells[cellIndex]?.text.length || 1;
  }
  return offset;
}

function terminalColumnAtOffset(row: TerminalLinkRow, offset: number): number {
  for (let column = 0; column < row.cells.length; column += 1) {
    const nextOffset = terminalColumnOffset(row, column + 1);
    if (offset < nextOffset) return column;
  }
  return Math.max(0, row.cells.length - 1);
}

export function terminalLinkAtPositionWithRange(
  rows: ReadonlyArray<TerminalLinkRow>,
  rowIndex: number,
  column: number,
): TerminalLinkWithRange | null {
  const wrappedLine = collectWrappedTerminalLinkLine(rowIndex + 1, (index) => {
    const row = rows[index];
    if (!row) return null;
    return {
      isWrapped: row.isWrapContinuation,
      translateToString: (trimRight = false) => terminalRowText(row, trimRight),
    };
  });
  if (!wrappedLine) return null;
  // Only viewport rows are available: a wrapped line whose head scrolled above
  // the viewport would resolve a truncated match into a wrong link.
  const firstSegment = wrappedLine.segments[0];
  if (firstSegment && rows[firstSegment.bufferLineNumber - 1]?.isWrapContinuation) {
    return null;
  }
  const segment = wrappedLine.segments.find((value) => value.bufferLineNumber === rowIndex + 1);
  const row = rows[rowIndex];
  if (!segment || !row) return null;
  const lastSegment = wrappedLine.segments.at(-1);
  const lastRow = lastSegment ? rows[lastSegment.bufferLineNumber - 1] : undefined;
  const continuesBelowViewport = lastRow !== undefined && lastRow.wrapsToNext;
  const offset = segment.startIndex + terminalColumnOffset(row, column);
  for (const match of extractTerminalLinks(wrappedLine.text)) {
    if (offset >= match.start && offset < match.end) {
      if (match.end === wrappedLine.text.length && continuesBelowViewport) return null;
      const startSegment = wrappedLine.segments.find(
        (value) => match.start >= value.startIndex && match.start < value.endIndex,
      );
      const endSegment = wrappedLine.segments.find(
        (value) => match.end - 1 >= value.startIndex && match.end - 1 < value.endIndex,
      );
      const startRow = startSegment ? rows[startSegment.bufferLineNumber - 1] : undefined;
      const endRow = endSegment ? rows[endSegment.bufferLineNumber - 1] : undefined;
      if (!startSegment || !endSegment || !startRow || !endRow) return null;
      return {
        text: match.text,
        range: {
          start: {
            x: terminalColumnAtOffset(startRow, match.start - startSegment.startIndex),
            y: startSegment.bufferLineNumber - 1,
          },
          end: {
            x: terminalColumnAtOffset(endRow, match.end - 1 - endSegment.startIndex),
            y: endSegment.bufferLineNumber - 1,
          },
        },
      };
    }
  }
  return null;
}

/** findLinkAt: the OSC 8 hyperlink under the cell, extended over neighbours with the same URI, else a detected link. */
export function findTerminalLinkAt(emulator: TerminalEmulator, cell: TerminalCellPoint): TerminalLinkWithRange | null {
  const rows = emulator.linkRows();
  const cols = emulator.cols;
  const explicitHyperlink = emulator.hyperlinkAt(cell.x, cell.y);
  if (explicitHyperlink) {
    const start = { ...cell };
    const end = { ...cell };
    while (true) {
      const previous =
        start.x > 0
          ? { x: start.x - 1, y: start.y }
          : start.y > 0 && rows[start.y]?.isWrapContinuation
            ? { x: cols - 1, y: start.y - 1 }
            : null;
      if (!previous || emulator.hyperlinkAt(previous.x, previous.y) !== explicitHyperlink) break;
      start.x = previous.x;
      start.y = previous.y;
    }
    while (true) {
      const next =
        end.x + 1 < cols
          ? { x: end.x + 1, y: end.y }
          : end.y + 1 < rows.length && rows[end.y]?.wrapsToNext
            ? { x: 0, y: end.y + 1 }
            : null;
      if (!next || emulator.hyperlinkAt(next.x, next.y) !== explicitHyperlink) break;
      end.x = next.x;
      end.y = next.y;
    }
    return { text: explicitHyperlink, range: { start, end } };
  }
  return terminalLinkAtPositionWithRange(rows, cell.y, cell.x);
}
