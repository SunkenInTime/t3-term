// Port of apps/web/src/keybindings.ts. Kept close to the original so submodule
// bumps diff cleanly. Differences: the platform comes from Node instead of
// `navigator.platform`, t3-term counts as the desktop app (`isDesktop`), and
// the project-script id helper is inlined from apps/web/src/projectScripts.ts.
import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ResolvedKeybindingsConfig,
  SCRIPT_RUN_COMMAND_PATTERN,
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type ModelPickerJumpKeybindingCommand,
  type ThreadJumpKeybindingCommand,
} from "@t3tools/contracts";
import {
  isMacPlatform,
  matchesKeybindingShortcut,
  matchesKeybindingShortcutModifiers,
  type ShortcutEventLike,
  type ShortcutModifierStateLike,
} from "@t3tools/shared/keybindings";
import * as Schema from "effect/Schema";

export type { ShortcutEventLike, ShortcutModifierStateLike } from "@t3tools/shared/keybindings";
export { shortcutKeyFromEvent } from "@t3tools/shared/keybindings";

/** `navigator.platform` equivalent for the machine t3-term runs on. */
export const HOST_PLATFORM =
  process.platform === "darwin" ? "MacIntel" : process.platform === "win32" ? "Win32" : "Linux x86_64";

const isElectron = true;

const isScriptRunCommand = Schema.is(SCRIPT_RUN_COMMAND_PATTERN);

function projectScriptIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!isScriptRunCommand(trimmed)) {
    return null;
  }
  const [prefix, , suffix] = SCRIPT_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export interface ShortcutMatchContext {
  terminalFocus: boolean;
  terminalOpen: boolean;
  previewFocus: boolean;
  previewOpen: boolean;
  isWeb: boolean;
  isDesktop: boolean;
  editableFocus?: boolean;
  [key: string]: boolean | undefined;
}

interface ShortcutMatchOptions {
  platform?: string;
  context?: Partial<ShortcutMatchContext>;
}

interface ResolvedShortcutLabelOptions extends ShortcutMatchOptions {
  platform?: string;
}

function resolvePlatform(options: ShortcutMatchOptions | undefined): string {
  return options?.platform ?? HOST_PLATFORM;
}

function resolveContext(options: ShortcutMatchOptions | undefined): ShortcutMatchContext {
  return {
    terminalFocus: false,
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
    editableFocus: false,
    ...options?.context,
  };
}

function evaluateWhenNode(node: KeybindingWhenNode, context: ShortcutMatchContext): boolean {
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return Boolean(context[node.name]);
    case "not":
      return !evaluateWhenNode(node.node, context);
    case "and":
      return evaluateWhenNode(node.left, context) && evaluateWhenNode(node.right, context);
    case "or":
      return evaluateWhenNode(node.left, context) || evaluateWhenNode(node.right, context);
  }
}

function matchesWhenClause(
  whenAst: KeybindingWhenNode | undefined,
  context: ShortcutMatchContext,
): boolean {
  if (!whenAst) return true;
  return evaluateWhenNode(whenAst, context);
}

export function shortcutConflictKey(shortcut: KeybindingShortcut, platform = HOST_PLATFORM): string {
  const useMetaForMod = isMacPlatform(platform);
  const metaKey = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const ctrlKey = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  return [
    shortcut.key,
    metaKey ? "meta" : "",
    ctrlKey ? "ctrl" : "",
    shortcut.shiftKey ? "shift" : "",
    shortcut.altKey ? "alt" : "",
  ].join("|");
}

function shortcutForContext(binding: ResolvedKeybindingRule, context: ShortcutMatchContext) {
  const shortcut = binding.shortcut;
  // Existing installs persist Mod+Enter. Resolve its alternate chord against
  // the send preference without rewriting saved or remapped shortcuts.
  if (
    context.composerRequiresModifier &&
    binding.command === "composer.sendAlternate" &&
    shortcut.key === "enter" &&
    shortcut.modKey &&
    !shortcut.metaKey &&
    !shortcut.ctrlKey &&
    !shortcut.altKey &&
    !shortcut.shiftKey
  ) {
    return { ...shortcut, shiftKey: true };
  }
  return shortcut;
}

export function effectiveShortcutsForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): KeybindingShortcut[] {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);
  const claimedShortcuts = new Set<string>();
  const effective: KeybindingShortcut[] = [];

  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding) continue;
    if (!matchesWhenClause(binding.whenAst, context)) continue;

    const shortcut = shortcutForContext(binding, context);
    const conflictKey = shortcutConflictKey(shortcut, platform);
    if (claimedShortcuts.has(conflictKey)) {
      continue;
    }

    claimedShortcuts.add(conflictKey);
    if (binding.command === command) {
      effective.push(shortcut);
    }
  }

  return effective;
}

function findEffectiveShortcutForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): KeybindingShortcut | null {
  return effectiveShortcutsForCommand(keybindings, command, options)[0] ?? null;
}

export function resolveShortcutCommand(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeybindingCommand | null {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);

  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding) continue;
    if (!matchesWhenClause(binding.whenAst, context)) continue;
    if (!matchesKeybindingShortcut(event, shortcutForContext(binding, context), platform)) continue;
    return binding.command;
  }
  return null;
}

export function resolveChatShortcutCommand(
  event: ShortcutEventLike,
  primaryKeybindings: ResolvedKeybindingsConfig,
  activeKeybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeybindingCommand | null {
  const primaryCommand = resolveShortcutCommand(event, primaryKeybindings, options);
  if (primaryCommand !== null && projectScriptIdFromCommand(primaryCommand) === null) {
    return primaryCommand;
  }

  const activeCommand = resolveShortcutCommand(event, activeKeybindings, options);
  return activeCommand !== null && projectScriptIdFromCommand(activeCommand) !== null
    ? activeCommand
    : null;
}

export function formatShortcutKeyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key === "escape") return "Esc";
  if (key === "arrowup") return "Up";
  if (key === "arrowdown") return "Down";
  if (key === "arrowleft") return "Left";
  if (key === "arrowright") return "Right";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function formatShortcutLabel(shortcut: KeybindingShortcut, platform = HOST_PLATFORM): string {
  const keyLabel = formatShortcutKeyLabel(shortcut.key);
  const useMetaForMod = isMacPlatform(platform);
  const showMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const showCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  const showAlt = shortcut.altKey;
  const showShift = shortcut.shiftKey;

  if (useMetaForMod) {
    return `${showCtrl ? "⌃" : ""}${showAlt ? "⌥" : ""}${showShift ? "⇧" : ""}${showMeta ? "⌘" : ""}${keyLabel}`;
  }

  const parts: string[] = [];
  if (showCtrl) parts.push("Ctrl");
  if (showAlt) parts.push("Alt");
  if (showShift) parts.push("Shift");
  if (showMeta) parts.push("Meta");
  parts.push(keyLabel);
  return parts.join("+");
}

export function shortcutLabelForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand | null,
  options?: string | ResolvedShortcutLabelOptions,
): string | null {
  if (command === null) return null;
  const resolvedOptions =
    typeof options === "string"
      ? ({ platform: options } satisfies ResolvedShortcutLabelOptions)
      : options;
  const platform = resolvePlatform(resolvedOptions);
  const shortcut = findEffectiveShortcutForCommand(keybindings, command, resolvedOptions);
  return shortcut ? formatShortcutLabel(shortcut, platform) : null;
}

export function threadJumpCommandForIndex(index: number): ThreadJumpKeybindingCommand | null {
  return THREAD_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function threadJumpIndexFromCommand(command: string): number | null {
  const index = THREAD_JUMP_KEYBINDING_COMMANDS.indexOf(command as ThreadJumpKeybindingCommand);
  return index === -1 ? null : index;
}

export function threadTraversalDirectionFromCommand(
  command: string | null,
): "previous" | "next" | null {
  if (command === "thread.previous") return "previous";
  if (command === "thread.next") return "next";
  return null;
}

export function shouldShowThreadJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  // The embedded terminal owns keystrokes while it has focus.
  if (resolveContext(options).terminalFocus) {
    return false;
  }

  const platform = resolvePlatform(options);

  for (const command of THREAD_JUMP_KEYBINDING_COMMANDS) {
    const shortcut = findEffectiveShortcutForCommand(keybindings, command, options);
    if (!shortcut) continue;
    if (matchesKeybindingShortcutModifiers(modifiers, shortcut, platform)) {
      return true;
    }
  }

  return false;
}

export function modelPickerJumpCommandForIndex(
  index: number,
): ModelPickerJumpKeybindingCommand | null {
  return MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function modelPickerJumpIndexFromCommand(command: string): number | null {
  const index = MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.indexOf(
    command as ModelPickerJumpKeybindingCommand,
  );
  return index === -1 ? null : index;
}
