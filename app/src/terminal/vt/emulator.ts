// A headless VT emulator (xterm.js core, no DOM) plus the snapshot the
// gpuix view paints: one run per same-style span per row. The web client
// renders libghostty-vt onto a canvas instead; this keeps its palette and
// cell metrics (apps/web/src/components/ThreadTerminalDrawer.tsx,
// apps/web/src/terminal/ghostty/renderer.ts).
import { Terminal, type IBufferCell } from "@xterm/headless";

import type { TerminalLinkRow } from "../links.ts";

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
  /** DEC mouse tracking the program asked for; anything but "none" takes the pointer. */
  readonly mouseTracking: MouseTrackingMode;
}

export type MouseTrackingMode = "none" | "x10" | "vt200" | "drag" | "any";

/** xterm CoreMouseButton / CoreMouseAction (common/Types.ts). */
export const MOUSE_BUTTON = { left: 0, middle: 1, right: 2, none: 3, wheel: 4 } as const;
export const MOUSE_ACTION = { up: 0, down: 1, move: 32 } as const;
/** With MOUSE_BUTTON.wheel, `up`/`down` mean the wheel direction. */
export const WHEEL_ACTION = { up: 0, down: 1 } as const;

export interface TerminalMouseEvent {
  /** 0-based viewport cell. */
  readonly col: number;
  readonly row: number;
  /** Pixels from the grid origin, for SGR-pixels mode. */
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly action: number;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

interface CoreInternals {
  _core?: {
    coreService?: { isCursorHidden?: boolean; decPrivateModes?: { cursorStyle?: string } };
    optionsService?: { rawOptions?: { cursorStyle?: string } };
    // xterm encodes reports for the active protocol and encoding and emits them through onData.
    coreMouseService?: { triggerMouseEvent(event: TerminalMouseEvent): boolean };
    _oscLinkService?: { getLinkData(id: number): { uri: string } | undefined };
  };
}

/** The CellData behind IBufferCell carries OSC 8 link ids in its extended attributes. */
interface CellInternals {
  hasExtendedAttrs?: () => number;
  extended?: { urlId?: number };
}

export class TerminalEmulator {
  readonly terminal: Terminal;
  private readonly listeners = new Set<() => void>();
  private cell: IBufferCell | undefined;
  private probeCell: IBufferCell | undefined;
  private revision = 0;
  private linkRowsCache: { revision: number; rows: TerminalLinkRow[] } | null = null;

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
    this.revision += 1;
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

  get mouseTracking(): MouseTrackingMode {
    return this.terminal.modes.mouseTrackingMode;
  }

  /** Reports a pointer event to the program. False when its mode does not take this event. */
  sendMouse(event: TerminalMouseEvent): boolean {
    const service = (this.terminal as unknown as CoreInternals)._core?.coreMouseService;
    return service?.triggerMouseEvent({ ...event }) ?? false;
  }

  /** The OSC 8 URI of a viewport cell, or null. */
  hyperlinkAt(col: number, row: number): string | null {
    const buffer = this.terminal.buffer.active;
    const line = buffer.getLine(buffer.viewportY + row);
    const cell = (this.probeCell ??= buffer.getNullCell());
    if (!line?.getCell(col, cell)) return null;
    const internals = cell as unknown as CellInternals;
    // `extended` is left over from an earlier cell unless this one has extended attributes.
    if (!internals.hasExtendedAttrs?.()) return null;
    const id = internals.extended?.urlId ?? 0;
    if (id === 0) return null;
    return (this.terminal as unknown as CoreInternals)._core?._oscLinkService?.getLinkData(id)?.uri ?? null;
  }

  /** Viewport rows as the web link logic reads them; rebuilt only after output, scroll or resize. */
  linkRows(): ReadonlyArray<TerminalLinkRow> {
    if (this.linkRowsCache?.revision === this.revision) return this.linkRowsCache.rows;
    const buffer = this.terminal.buffer.active;
    const cell = (this.probeCell ??= buffer.getNullCell());
    const rows: TerminalLinkRow[] = [];
    for (let y = 0; y < this.terminal.rows; y++) {
      const line = buffer.getLine(buffer.viewportY + y);
      const cells: { text: string }[] = [];
      if (line) {
        for (let x = 0; x < this.terminal.cols; x++) {
          cells.push({ text: line.getCell(x, cell) ? cell.getChars() : "" });
        }
      }
      rows.push({
        cells,
        isWrapContinuation: line?.isWrapped === true,
        wrapsToNext: buffer.getLine(buffer.viewportY + y + 1)?.isWrapped === true,
      });
    }
    this.linkRowsCache = { revision: this.revision, rows };
    return rows;
  }

  /**
   * Buffer lines from the first to the last with text, scrollback included, like
   * ghostty_terminal_select_all. Null when the buffer is blank.
   */
  contentLineRange(): { first: number; last: number } | null {
    const buffer = this.terminal.buffer.active;
    let first = -1;
    let last = -1;
    for (let y = 0; y < buffer.length; y++) {
      if ((buffer.getLine(y)?.translateToString(true) ?? "").length === 0) continue;
      if (first < 0) first = y;
      last = y;
    }
    return first < 0 ? null : { first, last };
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
          const underline = isUnderlined(cell);
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
      mouseTracking: terminal.modes.mouseTrackingMode,
    };
  }
}

/**
 * xterm reports every OSC 8 cell as dashed-underlined (ExtendedAttrs.underlineStyle).
 * libghostty, which web renders, underlines a hyperlink only on hover, so a link
 * cell counts only an explicit SGR 4 (the FgFlags.UNDERLINE bit).
 */
function isUnderlined(cell: IBufferCell): boolean {
  const internals = cell as unknown as CellInternals & { fg?: number };
  if (internals.hasExtendedAttrs?.() && (internals.extended?.urlId ?? 0) !== 0) {
    return ((internals.fg ?? 0) & 0x10000000) !== 0;
  }
  return cell.isUnderline() !== 0;
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
