// Turns a gpuix KeyEvent into the DOM-shaped event that
// KeybindingsSettings.logic.ts keybindingFromKeyboardEvent records from.
import type { KeyEvent } from "@gpuix/react";
import { EVENT_CODE_SHORTCUT_KEYS, US_SHIFTED_TO_UNSHIFTED_KEYS } from "@t3tools/shared/keybindings";

import { keybindingFromKeyboardEvent } from "../../web/components/settings/KeybindingsSettings.logic.ts";
import { PLATFORM } from "../../web/lib/utils.ts";

/** GPUI key names that differ from `KeyboardEvent.key`. */
const GPUI_TO_DOM_KEY: Readonly<Record<string, string>> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  space: " ",
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  // Modifier presses on their own record nothing, as in the browser.
  shift: "Shift",
  control: "Control",
  ctrl: "Control",
  alt: "Alt",
  cmd: "Meta",
  platform: "Meta",
  super: "Meta",
  fn: "Fn",
  capslock: "CapsLock",
};

const DOM_CODE_BY_KEY = new Map(Object.entries(EVENT_CODE_SHORTCUT_KEYS).map(([code, key]) => [key, code]));

export interface DomKeyLike {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * GPUI reports a key by name ("up", "space") and, on some platforms, a shifted
 * symbol as the symbol itself. The browser's `code` names the physical key, so
 * it is rebuilt from the unshifted character the way a US layout produces it.
 */
export function domKeyFromGpuixEvent(event: KeyEvent): DomKeyLike {
  const raw = event.key ?? "";
  const lower = raw.toLowerCase();
  const key = GPUI_TO_DOM_KEY[lower] ?? raw;
  const modifiers = event.modifiers;
  const shiftKey = modifiers?.shift === true;
  const physical = lower.length === 1 ? (US_SHIFTED_TO_UNSHIFTED_KEYS.get(lower) ?? lower) : lower;
  const code = /^[a-z]$/.test(physical)
    ? `Key${physical.toUpperCase()}`
    : (DOM_CODE_BY_KEY.get(physical) ?? "");
  return {
    key,
    code,
    metaKey: modifiers?.cmd === true,
    ctrlKey: modifiers?.ctrl === true,
    altKey: modifiers?.alt === true,
    shiftKey,
  };
}

/** The keybinding string ("mod+shift+k") a key press records, or null for a bare modifier. */
export function keybindingFromGpuixEvent(event: KeyEvent): string | null {
  return keybindingFromKeyboardEvent(domKeyFromGpuixEvent(event), PLATFORM, { layoutCharacter: true });
}
