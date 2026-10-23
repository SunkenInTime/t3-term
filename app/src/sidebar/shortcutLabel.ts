// shortcutLabelForCommand from apps/web/src/keybindings.ts, reduced: the last
// binding for a command wins unless a later binding claimed the same keys.
// `when` clauses are not evaluated (the labels the sidebar shows are for
// bindings that apply outside the terminal).
import type { KeybindingCommand, KeybindingShortcut, ResolvedKeybindingsConfig } from "@t3tools/contracts";

const IS_MAC = process.platform === "darwin";

function formatShortcutKeyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key === "escape") return "Esc";
  if (key === "arrowup") return "Up";
  if (key === "arrowdown") return "Down";
  if (key === "arrowleft") return "Left";
  if (key === "arrowright") return "Right";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function formatShortcutLabel(shortcut: KeybindingShortcut): string {
  const keyLabel = formatShortcutKeyLabel(shortcut.key);
  const showMeta = shortcut.metaKey || (shortcut.modKey && IS_MAC);
  const showCtrl = shortcut.ctrlKey || (shortcut.modKey && !IS_MAC);
  if (IS_MAC) {
    return `${showCtrl ? "⌃" : ""}${shortcut.altKey ? "⌥" : ""}${shortcut.shiftKey ? "⇧" : ""}${showMeta ? "⌘" : ""}${keyLabel}`;
  }
  const parts: string[] = [];
  if (showCtrl) parts.push("Ctrl");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");
  if (showMeta) parts.push("Meta");
  parts.push(keyLabel);
  return parts.join("+");
}

function conflictKey(shortcut: KeybindingShortcut): string {
  const meta = shortcut.metaKey || (shortcut.modKey && IS_MAC);
  const ctrl = shortcut.ctrlKey || (shortcut.modKey && !IS_MAC);
  return [shortcut.key, meta, ctrl, shortcut.altKey, shortcut.shiftKey].join(":");
}

export function shortcutLabelForCommand(
  keybindings: ResolvedKeybindingsConfig | undefined,
  command: KeybindingCommand,
): string | null {
  if (!keybindings) return null;
  const claimed = new Set<string>();
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding) continue;
    const key = conflictKey(binding.shortcut);
    if (claimed.has(key)) continue;
    claimed.add(key);
    if (binding.command === command) return formatShortcutLabel(binding.shortcut);
  }
  return null;
}
