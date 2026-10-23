// Window-level shortcut dispatch, driven by the server's keybindings config
// (packages/shared/src/keybindings.ts DEFAULT_KEYBINDINGS merged with the
// server's `keybindings`). main.tsx passes every window keydown here, after
// focused elements had their turn.
//
// Web spreads these handlers over CommandPalette, routes/_chat.tsx,
// AppSidebarLayout, Sidebar, ChatView and the composer. Here one dispatcher
// owns the table; an area that owns a shortcut's target can claim it with
// registerShortcutHandler (the composer for composer.*, the terminal for
// terminal.*, the sidebar for thread.undo), and built-in fallbacks cover the
// commands that only change app state.
import type { KeyEvent } from "@gpuix/react";
import type { KeybindingCommand } from "@t3tools/contracts";
import { US_SHIFTED_TO_UNSHIFTED_KEYS } from "@t3tools/shared/keybindings";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { cycleAppearanceMode } from "../state/appearance.ts";
import { activeKeybindingsAtom, terminalFocusAtom } from "../state/keybindings.ts";
import { navigateBack, navigateForward } from "../state/navigation.ts";
import { dispatchCommandPalette, isCommandPaletteOpen, openCommandPalette } from "../state/palette.ts";
import {
  detailsPanelOpenAtom,
  findBarOpenAtom,
  modelPickerOpenAtom,
  rightPanelOpenAtom,
  rightPanelSurfaceAtom,
  routeAtom,
  sidebarOpenAtom,
  terminalOpenAtom,
} from "../state/ui.ts";
import { toast } from "../ui/toast.tsx";
import { handleUsageShortcutCommand } from "../usage/usageShortcuts.ts";
import {
  copyActiveThreadReference,
  jumpToThread,
  navigateAdjacentThread,
  readProjects,
  readRouteContext,
  readScratchTargetEnvironmentId,
  readServerConfig,
  startNewThreadFromContext,
  startScratchThread,
  toggleActiveThreadPinned,
  toggleActiveThreadSettled,
} from "../palette/actions.ts";
import {
  resolveShortcutCommand,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
  type ShortcutEventLike,
  type ShortcutMatchContext,
} from "../web/keybindings.ts";

// ── Event adapter ───────────────────────────────────────────────────────

const GPUI_KEY_NAMES: Readonly<Record<string, string>> = {
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  space: " ",
  esc: "escape",
};

/**
 * A GPUI keystroke as the DOM-shaped event the shared matcher expects. GPUI
 * names arrows "up"/"down", and a shifted symbol may arrive as the shifted
 * character; shortcuts are written against the unshifted key, like `code`.
 */
export function toShortcutEvent(event: KeyEvent): ShortcutEventLike {
  const raw = (event.key ?? "").toLowerCase();
  const named = GPUI_KEY_NAMES[raw] ?? raw;
  const key = US_SHIFTED_TO_UNSHIFTED_KEYS.get(named) ?? named;
  const modifiers = event.modifiers;
  return {
    type: "keydown",
    key,
    repeat: event.isHeld === true,
    metaKey: modifiers?.cmd === true,
    ctrlKey: modifiers?.ctrl === true,
    shiftKey: modifiers?.shift === true,
    altKey: modifiers?.alt === true,
  };
}

/** The `when` clause context, read from app state. */
export function readShortcutContext(overrides?: Partial<ShortcutMatchContext>): Partial<ShortcutMatchContext> {
  const route = appAtomRegistry.get(routeAtom);
  return {
    terminalFocus: appAtomRegistry.get(terminalFocusAtom),
    terminalOpen: route.kind === "thread" && appAtomRegistry.get(terminalOpenAtom),
    rightPanelOpen: route.kind === "thread" && appAtomRegistry.get(rightPanelOpenAtom),
    modelPickerOpen: appAtomRegistry.get(modelPickerOpenAtom),
    usagePageOpen: route.kind === "usage",
    draftThreadRoute: route.kind === "draft",
    ...overrides,
  };
}

export function resolveKeyEventCommand(
  event: KeyEvent,
  overrides?: Partial<ShortcutMatchContext>,
): KeybindingCommand | null {
  return resolveShortcutCommand(toShortcutEvent(event), appAtomRegistry.get(activeKeybindingsAtom), {
    context: readShortcutContext(overrides),
  });
}

// ── Handler registry ────────────────────────────────────────────────────

/** Return false to decline, letting the next handler or the built-in run. */
export type ShortcutHandler = (command: KeybindingCommand, event: KeyEvent) => boolean | void;

const handlers = new Map<KeybindingCommand, ShortcutHandler[]>();

/**
 * Claims a command while mounted. The most recent registration runs first.
 * Returns the unregister function (use it as an effect cleanup).
 */
export function registerShortcutHandler(command: KeybindingCommand, handler: ShortcutHandler): () => void {
  const stack = handlers.get(command) ?? [];
  stack.push(handler);
  handlers.set(command, stack);
  return () => {
    const current = handlers.get(command);
    if (!current) return;
    const index = current.lastIndexOf(handler);
    if (index !== -1) current.splice(index, 1);
    if (current.length === 0) handlers.delete(command);
  };
}

function runRegisteredHandler(command: KeybindingCommand, event: KeyEvent): boolean {
  const stack = handlers.get(command);
  if (!stack) return false;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]!(command, event) !== false) return true;
  }
  return false;
}

// ── Built-ins ───────────────────────────────────────────────────────────

function toggle(atom: typeof sidebarOpenAtom): void {
  appAtomRegistry.set(atom, !appAtomRegistry.get(atom));
}

const OVERLAY_MODES = {
  "commandPalette.toggle": "command",
  "filePicker.toggle": "files",
  "projectSearch.toggle": "content",
} as const;

function overlayMode(command: KeybindingCommand) {
  return command in OVERLAY_MODES ? OVERLAY_MODES[command as keyof typeof OVERLAY_MODES] : null;
}

/** Commands the palette's own window listener handles in web, open or not. */
function runPaletteCommand(command: KeybindingCommand, event: KeyEvent): boolean {
  const mode = overlayMode(command);
  if (mode !== null) {
    dispatchCommandPalette({ _tag: "ToggleMode", mode });
    return true;
  }
  if (command === "usage.open") {
    dispatchCommandPalette({ _tag: "SetOpen", open: false });
    appAtomRegistry.set(routeAtom, { kind: "usage" });
    return true;
  }
  if (command === "theme.select") {
    if (event.isHeld) return true;
    dispatchCommandPalette({ _tag: "OpenChangeTheme" });
    return true;
  }
  if (command === "appearance.cycle") {
    if (event.isHeld) return true;
    const next = cycleAppearanceMode();
    toast({ title: `Appearance: ${next === "system" ? "System" : next === "light" ? "Light" : "Dark"}`, duration: 1500 });
    return true;
  }
  return false;
}

function onThreadRoute(): boolean {
  return appAtomRegistry.get(routeAtom).kind === "thread";
}

function runBuiltIn(command: KeybindingCommand, event: KeyEvent): boolean {
  const route = appAtomRegistry.get(routeAtom);
  switch (command) {
    case "sidebar.toggle":
      toggle(sidebarOpenAtom);
      return true;
    case "navigation.back":
      navigateBack();
      return true;
    case "navigation.forward":
      navigateForward();
      return true;
    case "terminal.toggle":
      if (!onThreadRoute()) return false;
      toggle(terminalOpenAtom);
      return true;
    case "rightPanel.toggle":
      if (!onThreadRoute()) return false;
      toggle(rightPanelOpenAtom);
      return true;
    case "rightPanel.close":
      if (!onThreadRoute() || !appAtomRegistry.get(rightPanelOpenAtom)) return false;
      appAtomRegistry.set(rightPanelOpenAtom, false);
      return true;
    case "threadPanel.toggle":
      if (!onThreadRoute()) return false;
      toggle(detailsPanelOpenAtom);
      return true;
    case "diff.toggle": {
      if (!onThreadRoute()) return false;
      const showingDiff =
        appAtomRegistry.get(rightPanelOpenAtom) && appAtomRegistry.get(rightPanelSurfaceAtom) === "diff";
      appAtomRegistry.set(rightPanelSurfaceAtom, "diff");
      appAtomRegistry.set(rightPanelOpenAtom, !showingDiff);
      return true;
    }
    case "chat.new": {
      // routes/_chat.tsx: with more than one project, ask which one.
      const projectCount = readProjects().filter((project) => project.isScratch !== true).length;
      if (projectCount > 1) {
        openCommandPalette({ open: "new-thread-in" });
        return true;
      }
      return startNewThreadFromContext();
    }
    case "chat.newLocal":
      return startNewThreadFromContext();
    case "chat.newWithoutProject": {
      const environmentId = readScratchTargetEnvironmentId();
      if (environmentId === null) return false;
      void startScratchThread(environmentId);
      return true;
    }
    case "chat.find": {
      if (route.kind !== "thread") return false;
      if (readServerConfig(route.environmentId)?.threadFind !== true) return false;
      appAtomRegistry.set(findBarOpenAtom, true);
      return true;
    }
    case "modelPicker.toggle":
      if (route.kind !== "thread" && route.kind !== "draft") return false;
      toggle(modelPickerOpenAtom);
      return true;
    case "thread.copyReference":
      if (readRouteContext().threadId === null) return false;
      void copyActiveThreadReference();
      return true;
    case "thread.settle":
      if (route.kind !== "thread") return false;
      void toggleActiveThreadSettled();
      return true;
    case "thread.pin":
      if (route.kind !== "thread") return false;
      void toggleActiveThreadPinned();
      return true;
    default:
      break;
  }
  if (command.startsWith("usage.") && route.kind === "usage") {
    if (event.isHeld) return true;
    return handleUsageShortcutCommand(command);
  }
  const direction = threadTraversalDirectionFromCommand(command);
  if (direction !== null) {
    if (event.isHeld) return true;
    return navigateAdjacentThread(direction);
  }
  const jumpIndex = threadJumpIndexFromCommand(command);
  if (jumpIndex !== null) {
    if (event.isHeld) return true;
    return jumpToThread(jumpIndex);
  }
  return false;
}

export function handleGlobalKeyDown(event: KeyEvent): void {
  if (event.defaultPrevented) return;
  const command = resolveKeyEventCommand(event);
  if (command === null) return;

  if (runPaletteCommand(command, event)) {
    event.preventDefault();
    return;
  }
  // While the palette is open its input handles the rest (web's chat shortcuts
  // bail out on isCommandPaletteOpen()).
  if (isCommandPaletteOpen()) return;

  if (runRegisteredHandler(command, event) || runBuiltIn(command, event)) {
    event.preventDefault();
  }
}
