// GPUI key events to the bytes an xterm-compatible PTY expects. The web
// client gets these from libghostty's key encoder; the word and line moves on
// Ctrl/Alt+arrows follow apps/web/src/keybindings.ts
// (terminalNavigationShortcutData), which overrides the encoder there too.
import type { KeyEvent } from "@gpuix/react";

const ESC = "\x1b";

const isMac = process.platform === "darwin";

const TERMINAL_WORD_BACKWARD = `${ESC}b`;
const TERMINAL_WORD_FORWARD = `${ESC}f`;
const TERMINAL_LINE_START = "\x01";
const TERMINAL_LINE_END = "\x05";
const TERMINAL_DELETE_TO_LINE_START = "\x15";

interface Mods {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly cmd: boolean;
}

function modifierParam(mods: Mods): number {
  return 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
}

const CURSOR_FINAL: Record<string, string> = { up: "A", down: "B", right: "C", left: "D", home: "H", end: "F" };
const TILDE_CODE: Record<string, number> = {
  insert: 2,
  delete: 3,
  pageup: 5,
  pagedown: 6,
  f5: 15,
  f6: 17,
  f7: 18,
  f8: 19,
  f9: 20,
  f10: 21,
  f11: 23,
  f12: 24,
};
const SS3_FUNCTION: Record<string, string> = { f1: "P", f2: "Q", f3: "R", f4: "S" };

/** Ctrl+<char> control codes beyond the letters. */
const CTRL_SYMBOLS: Record<string, string> = {
  "@": "\x00",
  "2": "\x00",
  space: "\x00",
  " ": "\x00",
  "[": ESC,
  "3": ESC,
  "\\": "\x1c",
  "4": "\x1c",
  "]": "\x1d",
  "5": "\x1d",
  "^": "\x1e",
  "6": "\x1e",
  "_": "\x1f",
  "-": "\x1f",
  "7": "\x1f",
  "/": "\x1f",
  "8": "\x7f",
  "?": "\x7f",
};

/** US layout, for keystrokes that arrive without the shifted character. */
const SHIFTED_US: Record<string, string> = {
  "`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
  "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": '"', ",": "<", ".": ">", "/": "?",
};

function typedChar(key: string, keyChar: string | undefined, shift: boolean): string {
  if (key === "space") return " ";
  // A shifted keystroke whose character did not change falls back to the US pairs.
  if (keyChar && !(shift && keyChar === key)) return keyChar;
  if (key.length !== 1) return keyChar ?? "";
  if (!shift) return key;
  return SHIFTED_US[key] ?? key.toUpperCase();
}

export interface EncodeOptions {
  readonly applicationCursorKeys: boolean;
}

/** Bytes for one keystroke, or null when the terminal should not consume it. */
export function encodeKey(event: Pick<KeyEvent, "key" | "keyChar" | "modifiers">, options: EncodeOptions): string | null {
  const key = (event.key ?? "").toLowerCase();
  const mods: Mods = event.modifiers ?? { shift: false, ctrl: false, alt: false, cmd: false };
  if (key.length === 0) return null;

  // Word and line navigation, as web's terminalNavigationShortcutData.
  if ((key === "left" || key === "right") && !mods.shift) {
    const moveWord = key === "left" ? TERMINAL_WORD_BACKWARD : TERMINAL_WORD_FORWARD;
    const moveLine = key === "left" ? TERMINAL_LINE_START : TERMINAL_LINE_END;
    if (isMac) {
      if (mods.alt && !mods.cmd && !mods.ctrl) return moveWord;
      if (mods.cmd && !mods.alt && !mods.ctrl) return moveLine;
    } else if ((mods.ctrl || mods.alt) && !mods.cmd && !(mods.ctrl && mods.alt)) {
      return moveWord;
    }
  }
  if (isMac && key === "backspace" && mods.cmd && !mods.ctrl && !mods.alt && !mods.shift) {
    return TERMINAL_DELETE_TO_LINE_START;
  }
  // Remaining Cmd chords belong to the app (copy, paste, shortcuts).
  if (mods.cmd) return null;

  const param = modifierParam(mods);

  const cursorFinal = CURSOR_FINAL[key];
  if (cursorFinal !== undefined) {
    if (param > 1) return `${ESC}[1;${param}${cursorFinal}`;
    return options.applicationCursorKeys ? `${ESC}O${cursorFinal}` : `${ESC}[${cursorFinal}`;
  }
  const tilde = TILDE_CODE[key];
  if (tilde !== undefined) return param > 1 ? `${ESC}[${tilde};${param}~` : `${ESC}[${tilde}~`;
  const ss3 = SS3_FUNCTION[key];
  if (ss3 !== undefined) return param > 1 ? `${ESC}[1;${param}${ss3}` : `${ESC}O${ss3}`;

  const altPrefix = mods.alt ? ESC : "";
  switch (key) {
    case "enter":
      return `${altPrefix}\r`;
    case "backspace":
      return mods.ctrl ? `${altPrefix}\x08` : `${altPrefix}\x7f`;
    case "tab":
      return mods.shift ? `${ESC}[Z` : `${altPrefix}\t`;
    case "escape":
      return `${altPrefix}${ESC}`;
    default:
      break;
  }

  if (mods.ctrl) {
    if (/^[a-z]$/.test(key)) return `${altPrefix}${String.fromCharCode(key.charCodeAt(0) - 96)}`;
    const symbol = CTRL_SYMBOLS[key] ?? (event.keyChar ? CTRL_SYMBOLS[event.keyChar] : undefined);
    if (symbol !== undefined) return `${altPrefix}${symbol}`;
    return null;
  }

  const char = typedChar(key, event.keyChar, mods.shift);
  if (char.length === 0) return null;
  // Alt as Meta, except where Option composes a character on macOS.
  if (mods.alt && !(isMac && event.keyChar && event.keyChar !== key)) return `${ESC}${key === "space" ? " " : (event.keyChar ?? key)}`;
  return char;
}
