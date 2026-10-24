// Where a native text selection sits in the terminal buffer. gpuix gives the selected text
// but not its position, while web reads xterm's selection range (terminalSelectionLineRange:
// 1-based buffer lines). The selection is on screen when the user right-clicks it, so the
// visible rows are searched for the selected lines, top to bottom.
import type { TerminalEmulator } from "./vt/emulator.ts";

export function locateSelectionLines(
  emulator: TerminalEmulator,
  selectedText: string,
): { readonly lineStart: number; readonly lineEnd: number } {
  const lines = selectedText.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "").split("\n");
  const buffer = emulator.terminal.buffer.active;
  const top = buffer.viewportY;
  const bottom = Math.min(buffer.length, top + emulator.rows);
  const rowText = (y: number) => buffer.getLine(y)?.translateToString(true) ?? "";
  const matchesAt = (y: number) =>
    lines.every((line, offset) => {
      const needle = line.trim();
      return needle.length === 0 || rowText(y + offset).includes(needle);
    });
  for (let y = top; y < bottom; y++) {
    if (matchesAt(y)) return { lineStart: y + 1, lineEnd: y + lines.length };
  }
  return { lineStart: top + 1, lineEnd: top + lines.length };
}
