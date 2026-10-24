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
import { cancelSidebarGesture, isSidebarGestureActive } from "../sidebar/sidebarGesture.ts";
import { noteUserInput } from "../notifications/platform.ts";
import type { KeyEvent } from "@gpuix/react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { KeybindingCommand, ScopedThreadRef } from "@t3tools/contracts";
import { US_SHIFTED_TO_UNSHIFTED_KEYS } from "@t3tools/shared/keybindings";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { cycleAppearanceMode } from "../state/appearance.ts";
import { activeKeybindingsAtom, composerFocusAtom, shiftOnlyHeldAtom, terminalFocusAtom } from "../state/keybindings.ts";
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
  sidebarVisibleAtom,
  toggleSidebar,
  terminalOpenAtom,
} from "../state/ui.ts";
import { toast } from "../ui/toast.tsx";
import { hasOpenDismissLayer } from "../ui/dismissLayers.ts";
import { handleUsageShortcutCommand } from "../usage/usageShortcuts.ts";
import {
  navigateAdjacentThread,
  navigateToThreadAtIndex,
  releaseThreadUndoShortcut,
  settleAndAdvance,
  threadUndoClaimsShortcut,
  togglePinOpenThread,
  undoLatestThreadAction,
} from "../sidebar/threadActions.ts";
import { openDiffSurface } from "../state/git.ts";
import { rightPanelActions, rightPanelAddMenuOpenAtom, rightPanelStatesAtom } from "../state/rightPanel.ts";
import { hasClosedViews, type ReopenPanelActions, reopenNextClosedView } from "../state/closedViews.ts";
import {
  addBrowserSurface,
  openMiniPlayer,
  openPreviewSession,
  readEnvironmentSupportsServerBrowser,
  releasePreviewSurface,
} from "../state/preview.ts";
import { EMPTY_THREAD_STATE, selectedSurface, type ThreadRightPanelState } from "../web/rightPanelStore.ts";
import { readThreadPreviewState } from "../web/previewStateStore.ts";
import { clearThreadSelection, readThreadSelection, sidebarJumpHintsVisibleAtom } from "../state/sidebar.ts";
import { clientSettingsAtom } from "../state/clientSettings.ts";
import { composerRequiresModifier } from "../web/composer-logic.ts";
import { noteFocusHost, readFocusFacts, type FocusFacts } from "./focusContext.ts";
import {
  isRouteTurnRunning,
  openFavoriteEditor,
  readRouteComposerPrompt,
  runProjectScriptCommand,
  stopRouteThread,
  toggleRightPanelMaximized,
} from "./chatCommands.ts";
import { toggleThemeEditor } from "../state/themeEditor.ts";
import {
  copyActiveThreadReference,
  readProjects,
  readRouteContext,
  readScratchTargetEnvironmentId,
  readServerConfig,
  startNewThreadFromContext,
  startScratchThread,
} from "../palette/actions.ts";
import {
  resolveChatShortcutCommand,
  resolveShortcutCommand,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
  shouldShowThreadJumpHintsForModifiers,
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

const COMPOSER_FOCUS: FocusFacts = { editable: true, preview: false };

/**
 * The `when` clause context, read from app state: the flags web's ChatView
 * getShortcutContext and routes/_chat.tsx pass, from the same sources.
 */
export function readShortcutContext(overrides?: Partial<ShortcutMatchContext>): Partial<ShortcutMatchContext> {
  const route = appAtomRegistry.get(routeAtom);
  const composerFocus = appAtomRegistry.get(composerFocusAtom);
  // The composer's editor is editable and outside the preview; anything else asks the renderer.
  const focus = composerFocus ? COMPOSER_FOCUS : readFocusFacts();
  const threadRef = route.kind === "thread" ? scopeThreadRef(route.environmentId, route.threadId) : null;
  const rightPanelOpen = threadRef !== null && appAtomRegistry.get(rightPanelOpenAtom);
  return {
    terminalFocus: appAtomRegistry.get(terminalFocusAtom),
    composerFocus,
    terminalOpen: threadRef !== null && appAtomRegistry.get(terminalOpenAtom),
    rightPanelOpen,
    previewFocus: focus.preview,
    // routes/_chat.tsx previewOpen: the open panel's active tab is the browser.
    previewOpen:
      threadRef !== null && rightPanelOpen && selectedSurface(readPanelState(scopedThreadKey(threadRef)))?.kind === "preview",
    editableFocus: focus.editable,
    modelPickerOpen: appAtomRegistry.get(modelPickerOpenAtom),
    usagePageOpen: route.kind === "usage",
    draftThreadRoute: route.kind === "draft",
    turnRunning: isRouteTurnRunning(),
    composerRequiresModifier: composerRequiresModifier(
      appAtomRegistry.get(clientSettingsAtom).sendShortcut,
      readRouteComposerPrompt(),
    ),
    ...overrides,
  };
}

export function resolveKeyEventCommand(
  event: KeyEvent,
  overrides?: Partial<ShortcutMatchContext>,
): KeybindingCommand | null {
  const options = { context: readShortcutContext(overrides) };
  const keybindings = appAtomRegistry.get(activeKeybindingsAtom);
  const route = appAtomRegistry.get(routeAtom);
  if (route.kind !== "thread" && route.kind !== "draft") {
    return resolveShortcutCommand(toShortcutEvent(event), keybindings, options);
  }
  // resolveChatShortcutCommand: project scripts are bound on the thread's own server,
  // everything else on the app's.
  const scriptKeybindings = readServerConfig(route.environmentId)?.keybindings ?? [];
  return resolveChatShortcutCommand(toShortcutEvent(event), keybindings, scriptKeybindings, options);
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
  if (command === "themeEditor.toggle") {
    if (event.isHeld) return true;
    toggleThemeEditor();
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

// ── Right panel (web useRightPanelActions + ReopenClosedViewShortcut) ──

function readPanelState(threadKey: string): ThreadRightPanelState {
  return appAtomRegistry.get(rightPanelStatesAtom)[threadKey] ?? EMPTY_THREAD_STATE;
}

/** web "rightPanel.close": closes the active tab (a browser tab ends its session); the last one hides the panel. */
function closeActiveRightPanelSurface(threadRef: ScopedThreadRef): void {
  const threadKey = scopedThreadKey(threadRef);
  const active = selectedSurface(readPanelState(threadKey));
  if (active === null) {
    appAtomRegistry.set(rightPanelOpenAtom, false);
    return;
  }
  releasePreviewSurface(threadRef.environmentId, threadRef.threadId, active);
  rightPanelActions.close(threadKey, active.id);
  if (readPanelState(threadKey).surfaces.length === 0) appAtomRegistry.set(rightPanelOpenAtom, false);
}

/** web togglePreviewPanel (+ closePreviewPanel, which floats the open tab in the mini player). */
function togglePreviewPanel(threadRef: ScopedThreadRef): void {
  if (!readEnvironmentSupportsServerBrowser(threadRef.environmentId)) {
    toast({ type: "info", title: "Preview is desktop-only", description: "Open T3 Code in the desktop app to use the in-app preview." });
    return;
  }
  const threadKey = scopedThreadKey(threadRef);
  const active = selectedSurface(readPanelState(threadKey));
  if (appAtomRegistry.get(rightPanelOpenAtom) && active?.kind === "preview") {
    if (active.resourceId) openMiniPlayer(threadRef, active.resourceId);
    rightPanelActions.setMaximized(threadKey, false);
    appAtomRegistry.set(rightPanelOpenAtom, false);
    return;
  }
  const activeTabId = readThreadPreviewState(threadRef).activeTabId;
  if (activeTabId) {
    rightPanelActions.openBrowser(threadKey, activeTabId);
    return;
  }
  void addBrowserSurface(threadRef).then((result) => {
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toast({ type: "error", title: "Unable to open browser", description: error instanceof Error ? error.message : undefined });
    }
  });
}

const REOPEN_PANEL_ACTIONS: ReopenPanelActions = {
  readState: (threadKey) => {
    const route = appAtomRegistry.get(routeAtom);
    const visible =
      route.kind === "thread" &&
      scopedThreadKey(scopeThreadRef(route.environmentId, route.threadId)) === threadKey &&
      appAtomRegistry.get(rightPanelOpenAtom);
    const state = readPanelState(threadKey);
    return { ...state, isOpen: visible && state.isOpen };
  },
  open: (threadKey, kind) => rightPanelActions.open(threadKey, kind),
  openFile: (threadKey, relativePath, line) => rightPanelActions.openFile(threadKey, relativePath, line),
  openPullRequest: (threadKey, target) => rightPanelActions.openPullRequest(threadKey, target),
  openDevice: (threadKey, target) => rightPanelActions.openDevice(threadKey, target),
  renameDevice: (threadKey, surfaceId, title) => rightPanelActions.renameDevice(threadKey, surfaceId, title),
  openBrowserSession: async (threadRef, snapshot) => {
    const url = snapshot.navStatus._tag === "Idle" ? undefined : snapshot.navStatus.url;
    const result = await openPreviewSession({
      threadRef,
      ...(url === undefined ? {} : { url }),
      ...(snapshot.viewport === undefined ? {} : { viewport: snapshot.viewport }),
      ...(snapshot.profileId === undefined ? {} : { profileId: snapshot.profileId }),
    });
    if (result._tag === "Failure") return false;
    rightPanelActions.openBrowser(scopedThreadKey(threadRef), result.value.tabId);
    return true;
  },
};

function onThreadRoute(): boolean {
  return appAtomRegistry.get(routeAtom).kind === "thread";
}

function runBuiltIn(command: KeybindingCommand, event: KeyEvent): boolean {
  const route = appAtomRegistry.get(routeAtom);
  switch (command) {
    case "sidebar.toggle":
      toggleSidebar();
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
      if (route.kind !== "thread" || !appAtomRegistry.get(rightPanelOpenAtom)) return false;
      if (!event.isHeld) closeActiveRightPanelSurface(scopeThreadRef(route.environmentId, route.threadId));
      return true;
    case "preview.toggle":
      if (route.kind !== "thread") return false;
      if (!event.isHeld) togglePreviewPanel(scopeThreadRef(route.environmentId, route.threadId));
      return true;
    case "view.reopenClosed":
      if (!hasClosedViews()) return false;
      if (!event.isHeld) reopenNextClosedView(REOPEN_PANEL_ACTIONS);
      return true;
    case "threadPanel.toggle":
      if (!onThreadRoute()) return false;
      toggle(detailsPanelOpenAtom);
      return true;
    case "diff.toggle": {
      if (route.kind !== "thread") return false;
      const showingDiff =
        appAtomRegistry.get(rightPanelOpenAtom) && appAtomRegistry.get(rightPanelSurfaceAtom) === "diff";
      if (showingDiff) appAtomRegistry.set(rightPanelOpenAtom, false);
      else openDiffSurface(scopeThreadRef(route.environmentId, route.threadId));
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
      return settleAndAdvance();
    case "thread.pin":
      if (route.kind !== "thread") return false;
      return togglePinOpenThread();
    case "rightPanel.new":
      if (!onThreadRoute() || !appAtomRegistry.get(rightPanelOpenAtom)) return false;
      appAtomRegistry.set(rightPanelAddMenuOpenAtom, true);
      return true;
    case "rightPanel.toggleMaximized":
      return toggleRightPanelMaximized(event.isHeld === true);
    case "thread.stop":
      return stopRouteThread(event.isHeld === true);
    case "editor.openFavorite":
      return openFavoriteEditor(event.isHeld === true);
    default:
      break;
  }
  if (runProjectScriptCommand(command, event.isHeld === true)) return true;
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
    return navigateToThreadAtIndex(jumpIndex);
  }
  return false;
}

// ── Thread jump hints (Sidebar useThreadJumpHintVisibility) ─────────────

const MODIFIER_KEYS: Readonly<Record<string, "ctrl" | "cmd" | "alt" | "shift">> = {
  control: "ctrl",
  ctrl: "ctrl",
  platform: "cmd",
  cmd: "cmd",
  meta: "cmd",
  super: "cmd",
  alt: "alt",
  option: "alt",
  shift: "shift",
};

/** The modifier state with this keystroke applied (GPUI reports the state before it). */
function modifiersAfter(event: KeyEvent, down: boolean) {
  const modifiers = { ctrl: false, cmd: false, alt: false, shift: false, ...event.modifiers };
  const changed = MODIFIER_KEYS[(event.key ?? "").toLowerCase()];
  if (changed) modifiers[changed] = down;
  return { ctrlKey: modifiers.ctrl, metaKey: modifiers.cmd, altKey: modifiers.alt, shiftKey: modifiers.shift };
}

function updateJumpHints(event: KeyEvent, down: boolean): void {
  const isModifier = MODIFIER_KEYS[(event.key ?? "").toLowerCase()] !== undefined;
  const visible =
    isModifier &&
    shouldShowThreadJumpHintsForModifiers(modifiersAfter(event, down), appAtomRegistry.get(activeKeybindingsAtom), {
      context: readShortcutContext(),
    });
  // Shift alone shows the pull request list's quick actions (web: useShortcutModifierState).
  const after = modifiersAfter(event, down);
  const shiftOnly = after.shiftKey && !after.ctrlKey && !after.metaKey && !after.altKey;
  if (appAtomRegistry.get(shiftOnlyHeldAtom) !== shiftOnly) appAtomRegistry.set(shiftOnlyHeldAtom, shiftOnly);
  if (appAtomRegistry.get(sidebarJumpHintsVisibleAtom) !== visible) {
    appAtomRegistry.set(sidebarJumpHintsVisibleAtom, visible);
  }
}

/**
 * useEscapeToGoBack (hooks/useNavigateBack.ts) on the Usage and Pull requests
 * pages: an Escape nothing else claimed goes back, or home without history.
 */
function handleEscapeToGoBack(event: KeyEvent): boolean {
  if (event.key !== "escape" || event.isHeld || event.modifiers?.ctrl || event.modifiers?.cmd || event.modifiers?.alt) {
    return false;
  }
  const kind = appAtomRegistry.get(routeAtom).kind;
  if ((kind !== "usage" && kind !== "pull-requests") || isCommandPaletteOpen()) return false;
  event.preventDefault();
  if (!navigateBack()) appAtomRegistry.set(routeAtom, { kind: "home" });
  return true;
}

/** The key whose press last undid: its repeats are swallowed so they cannot undo again. */
let heldUndoKey: string | null = null;

/**
 * ThreadUndoShortcut (AppSidebarLayout): runs ahead of the other shortcuts. While the
 * notice's claim lasts (and the sidebar shows the notice), mod+Z undoes even from a text
 * field; any other keypress ends the claim.
 */
function handleThreadUndoShortcut(event: KeyEvent): boolean {
  const key = (event.key ?? "").toLowerCase();
  if (event.isHeld) {
    if (heldUndoKey !== null && key === heldUndoKey) {
      event.preventDefault();
      return true;
    }
    return false;
  }
  const isModifier = MODIFIER_KEYS[key] !== undefined;
  if (!isModifier) heldUndoKey = null;
  const context = readShortcutContext();
  const claimed = appAtomRegistry.get(sidebarVisibleAtom) && threadUndoClaimsShortcut();
  const command = resolveShortcutCommand(toShortcutEvent(event), appAtomRegistry.get(activeKeybindingsAtom), {
    context: { ...context, editableFocus: context.editableFocus === true && !claimed },
  });
  if (command !== "thread.undo") {
    if (!isModifier) releaseThreadUndoShortcut();
    return false;
  }
  if (isCommandPaletteOpen() || appAtomRegistry.get(modelPickerOpenAtom)) return false;
  if (!undoLatestThreadAction()) return false;
  heldUndoKey = key;
  event.preventDefault();
  return true;
}

/**
 * routes/_chat.tsx: in the chat routes, an Escape nothing else took (menus and dialogs
 * had their turn) clears a sidebar multi-selection.
 */
function handleEscapeClearsSelection(event: KeyEvent): boolean {
  if (event.key !== "escape" || isCommandPaletteOpen()) return false;
  // Settings and Usage are outside web's _chat layout; Pull requests' Escape goes back first.
  const kind = appAtomRegistry.get(routeAtom).kind;
  if (kind === "settings" || kind === "usage") return false;
  if (readThreadSelection().selectedThreadKeys.size === 0) return false;
  event.preventDefault();
  clearThreadSelection();
  return true;
}

export function handleGlobalKeyUp(event: KeyEvent): void {
  updateJumpHints(event, false);
}

/**
 * web composerFocusRedirect / usePasteToFocusComposer: the mounted composer claims printable
 * keys and pastes that land on nothing editable. Registered by the composer; tried before
 * shortcuts, like web's chat shortcut handler does.
 */
type TypeToFocusHandler = (event: KeyEvent, renderer: unknown) => boolean;
let typeToFocusHandler: TypeToFocusHandler | null = null;

export function registerTypeToFocusHandler(handler: TypeToFocusHandler): () => void {
  typeToFocusHandler = handler;
  return () => {
    if (typeToFocusHandler === handler) typeToFocusHandler = null;
  };
}

export function handleGlobalKeyDown(event: KeyEvent, renderer?: unknown): void {
  noteUserInput();
  noteFocusHost(renderer);
  updateJumpHints(event, true);
  if (event.defaultPrevented) return;
  if (handleThreadUndoShortcut(event)) return;
  // An open menu, popover or dialog takes Escape first, as in web. gpuix closes
  // the top layer in its default action after this handler, so step aside.
  if (event.key === "escape" && hasOpenDismissLayer() && !isSidebarGestureActive()) return;
  // SidebarPointerSensor: Escape cancels a sidebar row drag or sweep.
  if (event.key === "escape" && isSidebarGestureActive()) {
    event.preventDefault();
    cancelSidebarGesture();
    return;
  }
  if (handleEscapeToGoBack(event)) return;
  if (handleEscapeClearsSelection(event)) return;
  if (!isCommandPaletteOpen() && typeToFocusHandler?.(event, renderer)) {
    event.preventDefault();
    return;
  }
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
