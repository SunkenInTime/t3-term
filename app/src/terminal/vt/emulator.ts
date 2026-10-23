// A headless VT emulator (xterm.js core, no DOM) plus the snapshot the
// gpuix view paints: one run per same-style span per row. The web client
// renders libghostty-vt onto a canvas instead; this keeps its palette and
// cell metrics (apps/web/src/components/ThreadTerminalDrawer.tsx,
// apps/web/src/terminal/ghostty/renderer.ts).
import { Terminal, type IBufferCell } from "@xterm/headless";

/** ThreadTerminalDrawer.tsx TERMINAL_PALETTES. */
const ANSI_DARK = [
  "#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
  "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5",
];
const ANSI_LIGHT = [
  "#000000", "#cd3131", "#107c10", "#949800", "#0451a5", "#bc05bc", "#0598bc", "#555555",
  "#666666", "#cd3131", "#14ce14", "#b5ba00", "#0451a5", "#bc05bc", "#0598bc", "#a5a5a5",
];

export interface TerminalTheme {
  readonly appearance: "dark" | "light";
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function buildPalette(ansi: readonly string[]): string[] {
  const palette = [...ansi];
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) palette.push(`#${hex2(steps[r]!)}${hex2(steps[g]!)}${hex2(steps[b]!)}`);
  for (let i = 0; i < 24; i++) {
    const level = 8 + i * 10;
    palette.push(`#${hex2(level)}${hex2(level)}${hex2(level)}`);
  }
  return palette;
}

const PALETTES = { dark: buildPalette(ANSI_DARK), light: buildPalette(ANSI_LIGHT) };

// xterm.js attribute color modes (common/buffer/Constants.ts).
const CM_P16 = 0x1000000;
const CM_P256 = 0x2000000;
const CM_RGB = 0x3000000;

export interface CellRun {
  readonly col: number;
  /** Width in cells; wide glyphs count two. */
  readonly cells: number;
  readonly text: string;
  readonly fg: string;
  /** Null when the run sits on the terminal background. */
  readonly bg: string | null;
  readonly bold: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
}

export interface TerminalCursor {
  readonly col: number;
  readonly row: number;
  readonly style: "block" | "bar" | "underline";
  /** The glyph under a block cursor, repainted in the background color. */
  readonly text: string;
}

export interface TerminalFrame {
  readonly cols: number;
  readonly rows: ReadonlyArray<ReadonlyArray<CellRun>>;
  readonly cursor: TerminalCursor | null;
  /** First buffer line shown; equals `baseY` at the bottom. */
  readonly viewportY: number;
  readonly baseY: number;
  readonly alternate: boolean;
}

interface CoreInternals {
  _core?: {
    coreService?: { isCursorHidden?: boolean; decPrivateModes?: { cursorStyle?: string } };
    optionsService?: { rawOptions?: { cursorStyle?: string } };
  };
}

export class TerminalEmulator {
  readonly terminal: Terminal;
  private readonly listeners = new Set<() => void>();
  private cell: IBufferCell | undefined;

  constructor(cols: number, rows: number, onReply: (data: string) => void) {
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback: 5000,
      allowProposedApi: true,
      convertEol: false,
    });
    // DSR/DA replies (ConPTY asks for the cursor position on start) go back to the PTY.
    this.terminal.onData(onReply);
    this.terminal.onWriteParsed(() => this.emit());
    this.terminal.onScroll(() => this.emit());
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  write(data: string) {
    if (data.length > 0) this.terminal.write(data);
  }

  resetAndWrite(data: string) {
    this.terminal.reset();
    this.write(data);
    this.emit();
  }

  /** `[terminal] message` lines, as the web drawer writes them. */
  writeSystemMessage(message: string) {
    this.write(`\r\n[terminal] ${message}\r\n`);
  }

  resize(cols: number, rows: number) {
    if (cols === this.terminal.cols && rows === this.terminal.rows) return;
    this.terminal.resize(cols, rows);
    this.emit();
  }

  get cols() {
    return this.terminal.cols;
  }

  get rows() {
    return this.terminal.rows;
  }

  get applicationCursorKeys() {
    return this.terminal.modes.applicationCursorKeysMode;
  }

  get bracketedPaste() {
    return this.terminal.modes.bracketedPasteMode;
  }

  get alternate() {
    return this.terminal.buffer.active.type === "alternate";
  }

  isAtBottom() {
    const buffer = this.terminal.buffer.active;
    return buffer.viewportY >= buffer.baseY;
  }

  scrollLines(amount: number) {
    if (amount !== 0) this.terminal.scrollLines(amount);
  }

  scrollToLine(line: number) {
    this.terminal.scrollToLine(line);
  }

  scrollToBottom() {
    this.terminal.scrollToBottom();
  }

  dispose() {
    this.listeners.clear();
    this.terminal.dispose();
  }

  /** Visible text of buffer lines [start, end), for copy. */
  text(start: number, end: number): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let y = start; y < end; y++) {
      const line = buffer.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    return lines.join("\n");
  }

  frame(theme: TerminalTheme, focused: boolean): TerminalFrame {
    const terminal = this.terminal;
    const buffer = terminal.buffer.active;
    const palette = PALETTES[theme.appearance];
    const rows: CellRun[][] = [];
    const cell = (this.cell ??= buffer.getNullCell());
    for (let y = 0; y < terminal.rows; y++) {
      const line = buffer.getLine(buffer.viewportY + y);
      const runs: CellRun[] = [];
      if (line) {
        let run: {
          col: number;
          cells: number;
          text: string;
          fg: string;
          bg: string | null;
          bold: boolean;
          underline: boolean;
          strike: boolean;
        } | null = null;
        for (let x = 0; x < terminal.cols; x++) {
          if (!line.getCell(x, cell)) break;
          const width = cell.getWidth();
          if (width === 0) continue;
          const chars = cell.getChars() || " ";
          let fg = colorOf(cell.getFgColorMode(), cell.getFgColor(), palette, theme.foreground);
          let bg = cell.isBgDefault() ? null : colorOf(cell.getBgColorMode(), cell.getBgColor(), palette, theme.background);
          if (cell.isInverse()) {
            const swappedFg = bg ?? theme.background;
            bg = fg;
            fg = swappedFg;
          }
          if (cell.isDim()) fg = `${fg.slice(0, 7)}80`;
          if (cell.isInvisible()) fg = bg ?? theme.background;
          const bold = cell.isBold() !== 0;
          const underline = cell.isUnderline() !== 0;
          const strike = cell.isStrikethrough() !== 0;
          if (
            run &&
            run.fg === fg &&
            run.bg === bg &&
            run.bold === bold &&
            run.underline === underline &&
            run.strike === strike &&
            run.col + run.cells === x
          ) {
            run.text += chars;
            run.cells += width;
          } else {
            if (run) runs.push(run);
            run = { col: x, cells: width, text: chars, fg, bg, bold, underline, strike };
          }
        }
        if (run) runs.push(run);
      }
      rows.push(trimTrailingBlank(runs));
    }

    const internals = (terminal as unknown as CoreInternals)._core;
    const hidden = internals?.coreService?.isCursorHidden === true;
    const cursorRow = buffer.baseY + buffer.cursorY - buffer.viewportY;
    let cursor: TerminalCursor | null = null;
    if (!hidden && cursorRow >= 0 && cursorRow < terminal.rows) {
      const styleName =
        internals?.coreService?.decPrivateModes?.cursorStyle ?? internals?.optionsService?.rawOptions?.cursorStyle;
      const style = styleName === "bar" || styleName === "underline" ? styleName : "block";
      let text = "";
      if (focused && style === "block") {
        const line = buffer.getLine(buffer.baseY + buffer.cursorY);
        if (line?.getCell(buffer.cursorX, cell)) text = cell.getChars();
      }
      cursor = { col: Math.min(buffer.cursorX, terminal.cols - 1), row: cursorRow, style, text };
    }

    return {
      cols: terminal.cols,
      rows,
      cursor,
      viewportY: buffer.viewportY,
      baseY: buffer.baseY,
      alternate: buffer.type === "alternate",
    };
  }
}

function colorOf(mode: number, value: number, palette: readonly string[], fallback: string): string {
  switch (mode) {
    case CM_P16:
    case CM_P256:
      return palette[value] ?? fallback;
    case CM_RGB:
      return `#${value.toString(16).padStart(6, "0")}`;
    default:
      return fallback;
  }
}

/** Drops trailing default-background spaces: they paint nothing. */
function trimTrailingBlank(runs: CellRun[]): CellRun[] {
  while (runs.length > 0) {
    const last = runs[runs.length - 1]!;
    if (last.bg !== null || last.underline || last.strike) break;
    const trimmed = last.text.replace(/ +$/, "");
    if (trimmed.length === last.text.length) break;
    if (trimmed.length === 0) {
      runs.pop();
      continue;
    }
    runs[runs.length - 1] = { ...last, text: trimmed, cells: last.cells - (last.text.length - trimmed.length) };
    break;
  }
  return runs;
}
