// Translates gpuix input into the server browser's page input. Web gets DOM
// KeyboardEvent/WheelEvent fields for free (ServerBrowserSurface.tsx handleKey);
// gpuix reports GPUI keystrokes ("enter", "a" + keyChar "A"), so the DOM `key`,
// `code` and Windows `keyCode` that Puppeteer's key table needs are rebuilt here.
import type { PreviewStreamInput } from "@t3tools/client-runtime/preview/server-browser-stream";

type KeyInput = Extract<PreviewStreamInput, { type: "key" }>;

interface DomKey {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
}

const NAMED_KEYS: Readonly<Record<string, DomKey>> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  space: { key: " ", code: "Space", keyCode: 32 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  end: { key: "End", code: "End", keyCode: 35 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  control: { key: "Control", code: "ControlLeft", keyCode: 17 },
  alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  capslock: { key: "CapsLock", code: "CapsLock", keyCode: 20 },
};

const PUNCTUATION: Readonly<Record<string, { code: string; keyCode: number }>> = {
  "-": { code: "Minus", keyCode: 189 },
  "=": { code: "Equal", keyCode: 187 },
  "[": { code: "BracketLeft", keyCode: 219 },
  "]": { code: "BracketRight", keyCode: 221 },
  "\\": { code: "Backslash", keyCode: 220 },
  ";": { code: "Semicolon", keyCode: 186 },
  "'": { code: "Quote", keyCode: 222 },
  ",": { code: "Comma", keyCode: 188 },
  ".": { code: "Period", keyCode: 190 },
  "/": { code: "Slash", keyCode: 191 },
  "`": { code: "Backquote", keyCode: 192 },
};

export interface GpuixKey {
  readonly key?: string | undefined;
  readonly keyChar?: string | undefined;
  readonly modifiers?: { readonly shift: boolean; readonly ctrl: boolean; readonly alt: boolean; readonly cmd: boolean } | undefined;
}

/** previewStreamModifiers: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function pageModifiers(modifiers: GpuixKey["modifiers"]): number {
  if (!modifiers) return 0;
  return (modifiers.alt ? 1 : 0) | (modifiers.ctrl ? 2 : 0) | (modifiers.cmd ? 4 : 0) | (modifiers.shift ? 8 : 0);
}

function domKeyOf(event: GpuixKey): DomKey | null {
  const name = (event.key ?? "").toLowerCase();
  const named = NAMED_KEYS[name];
  if (named) return named;
  const fn = /^f([1-9]|1[0-2])$/.exec(name);
  if (fn) return { key: `F${fn[1]}`, code: `F${fn[1]}`, keyCode: 111 + Number(fn[1]) };
  const shift = event.modifiers?.shift ?? false;
  const char = event.keyChar && [...event.keyChar].length === 1 ? event.keyChar : null;
  if (/^[a-z]$/.test(name)) {
    const upper = name.toUpperCase();
    return { key: char ?? (shift ? upper : name), code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(name)) return { key: char ?? name, code: `Digit${name}`, keyCode: name.charCodeAt(0) };
  const punctuation = PUNCTUATION[name];
  if (punctuation) return { key: char ?? name, ...punctuation };
  // Anything else that types one character (a layout's own keys): no code, but the text still arrives.
  if (char) return { key: char, code: "", keyCode: 0 };
  return null;
}

/**
 * web handleKey: printable keys without Ctrl or Meta carry their text, Enter
 * carries "\r" like Puppeteer's key table so forms submit.
 */
export function pageKeyInput(action: "down" | "up", event: GpuixKey): KeyInput | null {
  const dom = domKeyOf(event);
  if (!dom) return null;
  const modifiers = event.modifiers;
  const shortcut = Boolean(modifiers?.ctrl || modifiers?.cmd);
  const text = shortcut ? undefined : [...dom.key].length === 1 ? dom.key : dom.key === "Enter" ? "\r" : undefined;
  return {
    type: "key",
    action,
    key: dom.key,
    code: dom.code,
    ...(dom.keyCode > 0 ? { keyCode: dom.keyCode } : {}),
    ...(action === "down" && text !== undefined ? { text } : {}),
    modifiers: pageModifiers(modifiers),
  };
}

/** Width and height from a baseline or progressive JPEG's SOF segment; null if it has none. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + ((bytes[offset + 2]! << 8) | bytes[offset + 3]!);
  }
  return null;
}

/** object-fit: contain of a `frame` inside `box`, as web's pagePoint computes from the canvas. */
export function containedRect(
  box: { readonly width: number; readonly height: number },
  frame: { readonly width: number; readonly height: number },
): { x: number; y: number; width: number; height: number } {
  const fit = Math.min(box.width / frame.width, box.height / frame.height);
  const width = frame.width * fit;
  const height = frame.height * fit;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}
