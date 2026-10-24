// One terminal session's viewport: attaches to the server session, feeds the
// headless emulator, paints its grid, and turns keys, pointer and wheel into
// PTY input. Port of TerminalViewport/TerminalSessionViewport in
// apps/web/src/components/ThreadTerminalDrawer.tsx and the pointer handling of
// apps/web/src/terminal/ghostty/surface.ts; the web paints libghostty onto a
// canvas, this paints one <text> per styled run.
import { useGpuixRequired, useWindowSize, type KeyEvent } from "@gpuix/react";
import {
  INITIAL_TERMINAL_OUTPUT_CURSOR,
  readTerminalOutputUpdate,
  type TerminalBufferState,
  type TerminalOutputCursor,
} from "@t3tools/client-runtime/state/terminal";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { memo, useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { previewEnvironment } from "../state/preview.ts";
import {
  readEnvironmentScope,
  resizeTerminal,
  terminalEnvironment,
  terminalFocusAtom,
  useEnvironmentScope,
  writeTerminal,
} from "../state/terminal.ts";
import { FONTS, useTheme } from "../ui/theme.ts";
import { Menu, MenuItem } from "../ui/overlay.tsx";
import { toast } from "../ui/toast.tsx";
import {
  type OpenPreviewMutation,
  openTerminalLinkInPreview,
} from "../web/components/preview/openTerminalLinkInPreview.ts";
import { isTerminalUrl } from "../web/terminal-links.ts";
import { resolveSelectionActionPosition, SELECTION_MULTI_CLICK_INTERVAL_MS } from "../web/lib/selectionActions.ts";
import { useOpenInPreferredEditor } from "../settings/keybindings/openInEditor.ts";
import { openExternalUrl, readClipboardText, writeClipboardText } from "./clipboard.ts";
import {
  MOUSE_ACTION,
  MOUSE_BUTTON,
  TerminalEmulator,
  WHEEL_ACTION,
  type CellRun,
  type MouseTrackingMode,
  type TerminalFrame,
  type TerminalTheme,
} from "./vt/emulator.ts";
import { findTerminalLinkAt, isSameTerminalLink, type TerminalCellPoint, type TerminalLinkWithRange } from "./links.ts";
import { locateSelectionLines } from "./selectionLines.ts";
import { addTerminalContextToThreadComposer } from "../chat/composer/terminalContextIntake.ts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { encodeKey } from "./vt/keys.ts";
import { resolveKeyEventCommand } from "../keybindings/useGlobalKeybindings.ts";
import { TERMINAL_SHORTCUT_COMMANDS, type TerminalShortcutCommand } from "./drawerShortcuts.ts";

/** apps/web/src/terminal/ghostty/surface.ts */
const CONTENT_PADDING = 4;
const FONT_SIZE = 13;
/** measureGhosttyCell: round(fontSize * 1.35). */
const CELL_HEIGHT = Math.round(FONT_SIZE * 1.35);
const MIN_SCROLLBAR_THUMB_HEIGHT = 18;
/** gpuix converts a wheel line delta to pixels at this height. */
const WHEEL_LINE_PIXELS = 20;
/** Frames are coalesced to at most one per display frame, and only after output. */
const FRAME_INTERVAL_MS = 16;
const PROBE = "M".repeat(64);

const isMac = process.platform === "darwin";
/** web contextMenuFallback.ts: every menu level is min-w-32. */
const MENU_MIN_WIDTH = 128;

type Modifiers = { shift: boolean; ctrl: boolean; alt: boolean; cmd: boolean };
const NO_MODIFIERS: Modifiers = { shift: false, ctrl: false, alt: false, cmd: false };

/** surface.ts shouldReportTerminalMouse: Shift, Ctrl and Cmd keep the pointer for selection and links. */
function shouldReportTerminalMouse(tracking: MouseTrackingMode, modifiers: Modifiers): boolean {
  return tracking !== "none" && !modifiers.shift && !modifiers.ctrl && !modifiers.cmd;
}

/** What Copy and Add to chat act on, read when the menu opens (web readSelectionAction). */
interface CapturedSelection {
  readonly clipboardText: string;
  readonly text: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

/** "Select all": gpuix has no API to set its window selection, so the terminal keeps this one itself. */
interface SelectAllState {
  readonly first: number;
  readonly last: number;
  readonly text: string;
}

export type { TerminalShortcutCommand };

export interface TerminalViewProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly cwd: string;
  readonly worktreePath?: string | null;
  readonly runtimeEnv?: Record<string, string>;
  readonly autoFocus: boolean;
  /** Each new value refocuses the viewport when `autoFocus` is set. */
  readonly focusRequestId: number;
  readonly onSessionExited: () => void;
  readonly onShortcut?: (command: TerminalShortcutCommand) => void;
  readonly onFocused?: () => void;
  readonly testId?: string;
}

/** A different launch is a different session, so it gets a fresh emulator. */
export function TerminalView(props: TerminalViewProps) {
  const sessionKey = JSON.stringify([
    props.environmentId,
    props.threadId,
    props.terminalId,
    props.cwd,
    props.worktreePath ?? null,
    props.runtimeEnv ?? null,
  ]);
  return <TerminalSessionView key={sessionKey} {...props} />;
}

let measuredCellWidth: number | null = null;

function shouldHandleTerminalExit(
  current: TerminalBufferState["status"],
  synchronized: TerminalBufferState["status"],
  alreadyHandled: boolean,
  version: number,
): boolean {
  return version > 0 && (current === "closed" || current === "exited") && current !== synchronized && !alreadyHandled;
}

function errorMessage(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "Terminal connection failed";
}

function TerminalSessionView({
  environmentId,
  threadId,
  terminalId,
  cwd,
  worktreePath,
  runtimeEnv,
  autoFocus,
  focusRequestId,
  onSessionExited,
  onShortcut,
  onFocused,
  testId,
}: TerminalViewProps) {
  const palette = useTheme();
  const renderer = useGpuixRequired();
  const canOperate = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const canOpenHostEditor = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const openInPreferredEditor = useOpenInPreferredEditor(environmentId);
  const windowSize = useWindowSize();
  const theme: TerminalTheme = {
    appearance: palette.appearance,
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.appearance === "dark" ? "#b4cbff" : "#26384e",
  };
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const containerRef = useRef<{ id: number } | null>(null);
  const [cellWidth, setCellWidth] = useState<number | null>(measuredCellWidth);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: CapturedSelection | null } | null>(
    null,
  );
  // web showSelectionAction: Copy / Add to chat near where a mouse selection ended.
  const [selectionAction, setSelectionAction] = useState<{ x: number; y: number; selection: CapturedSelection } | null>(
    null,
  );
  const [selectAll, setSelectAll] = useState<SelectAllState | null>(null);
  const [hoveredLink, setHoveredLink] = useState<TerminalLinkWithRange | null>(null);
  // Motion just went to the program, so the pointer is its arrow rather than a text beam.
  const [reportingCursor, setReportingCursor] = useState(false);
  // Shift/Ctrl/Cmd held at the last pointer move: selection stays live under mouse tracking.
  const [bypassTracking, setBypassTracking] = useState(false);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const [frame, setFrame] = useState<TerminalFrame | null>(null);
  const [session, setSession] = useState<{ status: TerminalBufferState["status"]; version: number; generation: number }>({
    status: "closed",
    version: 0,
    generation: 0,
  });

  const callbacks = useRef({ onSessionExited, onShortcut, onFocused });
  callbacks.current = { onSessionExited, onShortcut, onFocused };

  const write = (data: string) => {
    if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) return;
    void writeTerminal(environmentId, threadId, terminalId, data).then((result) => {
      if (result._tag === "Failure") emulatorRef.current?.writeSystemMessage(errorMessage(result.cause));
    });
  };
  const writeRef = useRef(write);
  writeRef.current = write;

  const emulatorRef = useRef<TerminalEmulator | null>(null);
  if (emulatorRef.current === null) {
    emulatorRef.current = new TerminalEmulator(80, 24, (reply) => writeRef.current(reply));
  }
  const emulator = emulatorRef.current;

  // Paint after output, at most once per frame. There is no loop: nothing
  // repaints while the session is quiet.
  const paint = useRef({ timer: null as ReturnType<typeof setTimeout> | null, last: 0 });
  const schedulePaint = () => {
    const state = paint.current;
    if (state.timer !== null) return;
    const wait = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - state.last));
    state.timer = setTimeout(() => {
      state.timer = null;
      state.last = Date.now();
      setFrame(emulator.frame(themeRef.current, focusedRef.current));
    }, wait);
  };
  const schedulePaintRef = useRef(schedulePaint);
  schedulePaintRef.current = schedulePaint;

  useEffect(() => {
    const stop = emulator.onChange(() => schedulePaintRef.current());
    return () => {
      stop();
      if (paint.current.timer !== null) clearTimeout(paint.current.timer);
      emulator.dispose();
    };
  }, [emulator]);

  // Attach (or observe, without operate scope) and stream output into the emulator.
  useEffect(() => {
    const atom = canOperate
      ? terminalEnvironment.attach({
          environmentId,
          input: {
            threadId,
            terminalId,
            cwd,
            ...(worktreePath !== undefined ? { worktreePath } : {}),
            ...(runtimeEnv ? { env: runtimeEnv } : {}),
          },
        })
      : terminalEnvironment.observe({ environmentId, input: { threadId, terminalId } });
    let cursor: TerminalOutputCursor = INITIAL_TERMINAL_OUTPUT_CURSOR;
    let synchronizedStatus: TerminalBufferState["status"] = "closed";
    let handledExit = false;
    let lastError: string | null = null;
    const onResult = (result: AsyncResult.AsyncResult<TerminalBufferState, unknown>) => {
      if (result._tag === "Failure") {
        const message = errorMessage(result.cause);
        if (message !== lastError) {
          lastError = message;
          emulator.writeSystemMessage(message);
        }
        setSession((current) => (current.status === "error" ? current : { ...current, status: "error" }));
        return;
      }
      const state = Option.getOrNull(AsyncResult.value(result));
      if (state === null || state.version === 0) return;
      lastError = null;
      const update = readTerminalOutputUpdate(state.output, cursor);
      if (update.type === "reset") emulator.resetAndWrite(update.data);
      else if (update.type === "append") emulator.write(update.data);
      cursor = update.cursor;
      if (state.error !== null) emulator.writeSystemMessage(state.error);
      if (state.status === "running") handledExit = false;
      else if (shouldHandleTerminalExit(state.status, synchronizedStatus, handledExit, state.version)) {
        handledExit = true;
        emulator.writeSystemMessage(state.status === "closed" ? "Terminal closed" : "Process exited");
        setTimeout(() => {
          if (handledExit && readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
            callbacks.current.onSessionExited();
          }
        }, 0);
      }
      synchronizedStatus = state.status;
      setSession((current) =>
        current.status === state.status && current.generation === state.output.generation && current.version > 0
          ? current
          : { status: state.status, version: state.version, generation: state.output.generation },
      );
    };
    return appAtomRegistry.subscribe(atom, onResult, { immediate: true });
  }, [canOperate, cwd, emulator, environmentId, runtimeEnv, terminalId, threadId, worktreePath]);

  // Grid from the measured cell and the viewport's own size.
  // A collapsed viewport (the chat column while the panel is maximized) keeps
  // its last grid, like the web surface skipping fit() at zero size; a 1-column
  // resize would make the shell rewrap its whole screen.
  const grid =
    size !== null &&
    cellWidth !== null &&
    size.width >= CONTENT_PADDING * 2 + cellWidth &&
    size.height >= CONTENT_PADDING * 2 + CELL_HEIGHT
      ? {
          cols: Math.max(1, Math.floor((size.width - CONTENT_PADDING * 2) / cellWidth)),
          rows: Math.max(1, Math.floor((size.height - CONTENT_PADDING * 2) / CELL_HEIGHT)),
        }
      : null;

  useEffect(() => {
    if (grid === null) return;
    const wasAtBottom = emulator.isAtBottom();
    emulator.resize(grid.cols, grid.rows);
    if (wasAtBottom) emulator.scrollToBottom();
    schedulePaint();
  }, [grid?.cols, grid?.rows]);

  // The PTY learns the grid once the session runs, and again after a reconnect.
  const lastSentSize = useRef<string | null>(null);
  const canResize = canOperate && session.version > 0 && session.status === "running";
  useEffect(() => {
    if (!canResize || grid === null) return;
    const key = `${session.generation}:${grid.cols}x${grid.rows}`;
    if (lastSentSize.current === key) return;
    lastSentSize.current = key;
    void resizeTerminal(environmentId, threadId, terminalId, grid.cols, grid.rows);
  }, [canResize, grid?.cols, grid?.rows, session.generation]);

  useEffect(() => {
    focusedRef.current = focused;
    schedulePaint();
  }, [focused]);

  const focusRequest = autoFocus && canOperate ? focusRequestId : null;
  useEffect(() => {
    if (focusRequest === null || !containerRef.current) return;
    renderer.focusElement?.(containerRef.current.id);
  }, [focusRequest]);

  useEffect(
    () => () => {
      if (focusedRef.current) appAtomRegistry.set(terminalFocusAtom, false);
    },
    [],
  );

  // ── Pointer geometry ────────────────────────────────────────────────

  /** The viewport cell under a window point; null outside the grid unless clamped (mouse reports clamp, like web's encoder). */
  const cellAt = (x: number, y: number, clamp: boolean): (TerminalCellPoint & { px: number; py: number }) | null => {
    if (cellWidth === null) return null;
    const px = x - origin.current.x - CONTENT_PADDING;
    const py = y - origin.current.y - CONTENT_PADDING;
    let col = Math.floor(px / cellWidth);
    let row = Math.floor(py / CELL_HEIGHT);
    if (clamp) {
      col = Math.max(0, Math.min(emulator.cols - 1, col));
      row = Math.max(0, Math.min(emulator.rows - 1, row));
    } else if (col < 0 || row < 0 || col >= emulator.cols || row >= emulator.rows) {
      return null;
    }
    return { x: col, y: row, px: Math.max(0, px), py: Math.max(0, py) };
  };

  /** ThreadTerminalDrawer canActivateTerminalLink: URLs always, paths only with the host-editor grant. */
  const canActivateLink = (text: string) =>
    isTerminalUrl(text) || readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);

  /** surface.ts linkAt. */
  const linkAt = (x: number, y: number): TerminalLinkWithRange | null => {
    const cell = cellAt(x, y, false);
    if (cell === null) return null;
    const link = findTerminalLinkAt(emulator, cell);
    return link && canActivateLink(link.text) ? link : null;
  };

  const setHovered = (link: TerminalLinkWithRange | null) =>
    setHoveredLink((current) => (current === link || (link !== null && isSameTerminalLink(link, current)) ? current : link));

  // Output and scrolling move text under a still pointer; re-resolve the hovered link
  // like web's render pass does. The grant can change too.
  const hoverPointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const pointer = hoverPointer.current;
    setHovered(pointer ? linkAt(pointer.x, pointer.y) : null);
  }, [frame, canOpenHostEditor]);

  // ── Mouse reporting (surface.ts sendMouse) ──────────────────────────

  const reportingButton = useRef<number | null>(null);
  const reportMouse = (event: { x?: number; y?: number }, button: number, action: number, modifiers: Modifiers) => {
    const cell = cellAt(event.x ?? 0, event.y ?? 0, true);
    if (cell === null) return;
    emulator.sendMouse({
      col: cell.x,
      row: cell.y,
      x: cell.px,
      y: cell.py,
      button,
      action,
      ctrl: modifiers.ctrl,
      alt: modifiers.alt,
      shift: modifiers.shift,
    });
  };

  // ── Selection ───────────────────────────────────────────────────────

  // gpuix owns the text selection and reports only its text. The rows it spans
  // come from the gesture that made it: the press and release cells (a double or
  // triple click stays on the pressed row). `text` is what that gesture selected,
  // so a selection changed some other way falls back to searching the screen.
  const selectionRows = useRef<{ anchor: number; end: number; text: string | null } | null>(null);
  const noteSelectionPress = (event: { x?: number; y?: number }) => {
    const cell = cellAt(event.x ?? 0, event.y ?? 0, true);
    selectionRows.current = cell === null ? null : { anchor: cell.y, end: cell.y, text: null };
  };
  const noteSelectionRelease = (event: { x?: number; y?: number }) => {
    const rows = selectionRows.current;
    if (rows === null || rows.text !== null) return;
    const cell = cellAt(event.x ?? 0, event.y ?? 0, true);
    if (cell !== null) rows.end = cell.y;
    // The selection settles after the release is dispatched.
    setTimeout(() => {
      if (selectionRows.current === rows) rows.text = renderer.getSelectedText?.() ?? "";
    }, 0);
  };

  const readSelection = (): CapturedSelection | null => {
    if (selectAll !== null) {
      return { clipboardText: selectAll.text, text: selectAll.text, lineStart: selectAll.first + 1, lineEnd: selectAll.last + 1 };
    }
    const raw = renderer.getSelectedText?.();
    if (!raw) return null;
    const text = raw.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
    if (text.length === 0) return null;
    const rows = selectionRows.current;
    if (rows !== null && rows.text === raw) {
      // web terminalSelectionLineRange: the 1-based buffer lines of the selection's start and end.
      const top = emulator.terminal.buffer.active.viewportY;
      return {
        clipboardText: raw,
        text,
        lineStart: top + Math.min(rows.anchor, rows.end) + 1,
        lineEnd: top + Math.max(rows.anchor, rows.end) + 1,
      };
    }
    const { lineStart, lineEnd } = locateSelectionLines(emulator, text);
    return { clipboardText: raw, text, lineStart, lineEnd };
  };

  const clearSelection = () => {
    setSelectAll(null);
    renderer.clearSelection?.();
  };

  const focusTerminal = () => {
    if (containerRef.current && readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
      renderer.focusElement?.(containerRef.current.id);
    }
  };

  const copySelection = (selection: CapturedSelection) => {
    void writeClipboardText(selection.clipboardText).catch((error: unknown) =>
      emulator.writeSystemMessage(error instanceof Error ? error.message : "Unable to copy terminal selection"),
    );
    focusTerminal();
  };

  const addSelectionToChat = (selection: CapturedSelection) => {
    addTerminalContextToThreadComposer(environmentId, threadId, {
      terminalId,
      terminalLabel: getTerminalLabel(terminalId),
      lineStart: selection.lineStart,
      lineEnd: selection.lineEnd,
      text: selection.text,
    });
    clearSelection();
    focusTerminal();
  };

  /** surface.ts selectAll: everything from the first to the last line with text, scrollback included. */
  const selectAllText = () => {
    const range = emulator.contentLineRange();
    renderer.clearSelection?.();
    setSelectAll(range === null ? null : { ...range, text: emulator.text(range.first, range.last + 1) });
    focusTerminal();
  };

  const paste = () => {
    void readClipboardText()
      .then((text) => {
        if (text.length === 0) return;
        const normalized = text.replace(/\r?\n/g, "\r");
        write(emulator.bracketedPaste ? `\x1b[200~${normalized}\x1b[201~` : normalized);
      })
      .catch((error: unknown) =>
        emulator.writeSystemMessage(error instanceof Error ? error.message : "Unable to read the clipboard"),
      );
  };

  // observeSelectionActions: a primary-button gesture that ends with a selection
  // shows the popup at the release point; anything else in the terminal dismisses it.
  const selectionGesture = useRef(false);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissSelectionAction = () => {
    if (selectionTimer.current !== null) clearTimeout(selectionTimer.current);
    selectionTimer.current = null;
    setSelectionAction(null);
  };
  useEffect(() => () => {
    if (selectionTimer.current !== null) clearTimeout(selectionTimer.current);
  }, []);
  const showSelectionAction = (pointer: { x: number; y: number }) => {
    const selection = readSelection();
    if (selection === null || size === null) {
      setSelectionAction(null);
      return;
    }
    const position = resolveSelectionActionPosition({
      bounds: { left: origin.current.x, top: origin.current.y, width: size.width, height: size.height },
      selectionRect: null,
      pointer,
      viewport: windowSize,
    });
    setSelectionAction({ x: position.x - origin.current.x, y: position.y - origin.current.y, selection });
  };
  const showSelectionActionRef = useRef(showSelectionAction);
  showSelectionActionRef.current = showSelectionAction;

  // ── Wheel ───────────────────────────────────────────────────────────

  const scrollRemainder = useRef(0);
  const onScroll = (event: { x?: number; y?: number; deltaY?: number; precise?: boolean; modifiers?: Modifiers }) => {
    const delta = event.deltaY ?? 0;
    if (delta === 0) return;
    dismissSelectionAction();
    // gpuix reports pixels: a trackpad's own, or wheel lines at 20px each.
    // Positive moves toward older output.
    const lines = (event.precise ? delta / CELL_HEIGHT : delta / WHEEL_LINE_PIXELS) + scrollRemainder.current;
    const whole = Math.trunc(lines);
    scrollRemainder.current = lines - whole;
    if (whole === 0) return;
    const modifiers = event.modifiers ?? NO_MODIFIERS;
    if (shouldReportTerminalMouse(emulator.mouseTracking, modifiers)) {
      // surface.ts scrollRows: one wheel-button press per row.
      for (let index = 0; index < Math.abs(whole); index++) {
        reportMouse(event, MOUSE_BUTTON.wheel, whole > 0 ? WHEEL_ACTION.up : WHEEL_ACTION.down, modifiers);
      }
      return;
    }
    if (emulator.alternate) {
      // Full-screen programs scroll by arrow keys, like alternate scroll mode.
      const arrow = whole > 0 ? "A" : "B";
      const prefix = emulator.applicationCursorKeys ? "\x1bO" : "\x1b[";
      write(`${prefix}${arrow}`.repeat(Math.abs(whole)));
      return;
    }
    emulator.scrollLines(-whole);
  };

  // ── Links ───────────────────────────────────────────────────────────

  /**
   * web handleLinkActivate: a URL opens in the thread's Browser when the
   * link-target preference is "app" (Ctrl/Cmd+click, or no preview access, opens
   * the system browser); a path opens in the preferred editor on the server's machine.
   */
  const activateLink = (text: string, forceBrowser: boolean) => {
    if (!canActivateLink(text)) return;
    if (!isTerminalUrl(text)) {
      const target = resolvePathLinkTarget(text, cwd);
      void (async () => {
        const opened = await openInPreferredEditor(target);
        if (!opened.ok) {
          emulator.writeSystemMessage(opened.message);
          return;
        }
        if (opened.result._tag === "Success" || isAtomCommandInterrupted(opened.result)) return;
        const error = squashAtomCommandFailure(opened.result);
        emulator.writeSystemMessage(error instanceof Error ? error.message : "Unable to open path");
      })();
      return;
    }
    const url = text;
    const fallbackToBrowser = () => {
      void openExternalUrl(url).catch((error: unknown) =>
        emulator.writeSystemMessage(error instanceof Error ? error.message : "Unable to open link"),
      );
    };
    if (!readEnvironmentScope(environmentId, AuthPreviewOperateScope)) {
      fallbackToBrowser();
      return;
    }
    const openPreview: OpenPreviewMutation = (input) =>
      runAtomCommand(appAtomRegistry, previewEnvironment.open, input as never) as ReturnType<OpenPreviewMutation>;
    void openTerminalLinkInPreview({
      url,
      threadRef: scopeThreadRef(environmentId, threadId),
      openPreview,
      fallbackToBrowser,
      forceBrowser,
    }).catch((error: unknown) =>
      toast({
        type: "error",
        title: "Unable to open link",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };
  // web activates a link only when the press and the release land on the same link.
  const linkPressRef = useRef<TerminalLinkWithRange | null>(null);

  // ── Keys ────────────────────────────────────────────────────────────

  const onKeyDown = (event: KeyEvent) => {
    const key = (event.key ?? "").toLowerCase();
    const mods = event.modifiers ?? NO_MODIFIERS;
    const mod = isMac ? mods.cmd : mods.ctrl;
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    dismissSelectionAction();
    // An open menu takes Escape, as web's native menus do, instead of the shell.
    if (key === "escape" && contextMenu !== null) {
      consume();
      setContextMenu(null);
      return;
    }

    // The user's keybindings decide, read with terminal focus like web's
    // handleBeforeKey and chat shortcuts: terminal.* acts on this terminal, and
    // any other command that applies with terminal focus goes to the window
    // dispatcher instead of the shell. Removing or remapping a binding changes both.
    const command = resolveKeyEventCommand(event, { terminalFocus: true, composerFocus: false });
    const terminalCommand = command === null ? undefined : TERMINAL_SHORTCUT_COMMANDS[command];
    if (terminalCommand !== undefined) {
      consume();
      // web preventRepeatedTerminalCloseShortcut: a held close chord closes once.
      if (!(terminalCommand === "close" && event.isHeld)) callbacks.current.onShortcut?.(terminalCommand);
      return;
    }
    if (command !== null) return;

    // surface.ts selectAllShortcut: Cmd+A on macOS, Ctrl+Shift+A elsewhere.
    if (key === "a" && mod && !mods.alt && (isMac ? !mods.shift && !mods.ctrl : mods.shift && !mods.cmd)) {
      consume();
      selectAllText();
      return;
    }

    // Copy and paste.
    const copyChord = isMac ? mods.cmd && key === "c" : mods.ctrl && mods.shift && key === "c";
    const selection = copyChord || (!isMac && mods.ctrl && !mods.shift && key === "c") ? readSelection() : null;
    if (copyChord || selection !== null) {
      consume();
      if (selection !== null) {
        copySelection(selection);
        clearSelection();
      }
      return;
    }
    const pasteChord = isMac ? mods.cmd && key === "v" : mods.ctrl && key === "v";
    if (pasteChord) {
      consume();
      paste();
      return;
    }

    // Scrollback paging stays local.
    if (mods.shift && !mods.ctrl && !mods.alt && (key === "pageup" || key === "pagedown") && !emulator.alternate) {
      consume();
      emulator.scrollLines((key === "pageup" ? -1 : 1) * Math.max(1, emulator.rows - 1));
      return;
    }

    const data = encodeKey(event, { applicationCursorKeys: emulator.applicationCursorKeys });
    if (data === null) return;
    consume();
    if (!emulator.isAtBottom()) emulator.scrollToBottom();
    clearSelection();
    write(data);
  };

  const scrollbar = frame !== null && size !== null && frame.baseY > 0 && !frame.alternate ? scrollbarGeometry(frame, size.height) : null;
  const tracking = frame?.mouseTracking ?? "none";
  // gpuix starts a text selection from any press in a selectable region, and JS
  // cannot cancel it, so the viewport stops being selectable while the program
  // owns the pointer. Shift/Ctrl/Cmd (seen on the last move) hand it back, like web.
  const pointerOwnedByProgram = tracking !== "none" && !bypassTracking;
  const selectionColor = palette.appearance === "dark" ? "#b4cbff40" : "#253f6333";

  return (
    <div
      ref={containerRef as never}
      testId={testId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => {
        setFocused(true);
        appAtomRegistry.set(terminalFocusAtom, true);
        callbacks.current.onFocused?.();
      }}
      onBlur={() => {
        setFocused(false);
        appAtomRegistry.set(terminalFocusAtom, false);
      }}
      onMouseDown={(event) => {
        dismissSelectionAction();
        const modifiers = event.modifiers ?? NO_MODIFIERS;
        const button = event.button ?? 0;
        linkPressRef.current = null;
        selectionGesture.current = false;
        if (shouldReportTerminalMouse(emulator.mouseTracking, modifiers)) {
          if (button > MOUSE_BUTTON.right) return;
          hoverPointer.current = null;
          setHovered(null);
          setReportingCursor(true);
          reportingButton.current = button;
          reportMouse(event, button, MOUSE_ACTION.down, modifiers);
          return;
        }
        if (button !== 0) return;
        setSelectAll(null);
        noteSelectionPress(event);
        const link = !modifiers.shift && (event.clickCount ?? 1) === 1 ? linkAt(event.x ?? 0, event.y ?? 0) : null;
        linkPressRef.current = link;
        selectionGesture.current = link === null;
      }}
      onMouseMove={(event) => {
        const modifiers = event.modifiers ?? NO_MODIFIERS;
        const bypass = modifiers.shift || modifiers.ctrl || modifiers.cmd;
        if (bypass !== bypassTracking) setBypassTracking(bypass);
        // Hover motion is only reportable in any-event tracking (DEC 1003); the
        // other modes report motion only during a press the program took.
        if (reportingButton.current !== null || (emulator.mouseTracking === "any" && !bypass)) {
          hoverPointer.current = null;
          setHovered(null);
          setReportingCursor(true);
          const pressed = event.pressedButton ?? null;
          reportMouse(
            event,
            pressed !== null && pressed <= MOUSE_BUTTON.right ? pressed : (reportingButton.current ?? MOUSE_BUTTON.none),
            MOUSE_ACTION.move,
            modifiers,
          );
          return;
        }
        setReportingCursor(false);
        if (event.pressedButton !== undefined && event.pressedButton !== null) {
          // A selection drag, not a hover.
          hoverPointer.current = null;
          setHovered(null);
          return;
        }
        hoverPointer.current = { x: event.x ?? 0, y: event.y ?? 0 };
        setHovered(linkAt(hoverPointer.current.x, hoverPointer.current.y));
      }}
      onMouseLeave={() => {
        hoverPointer.current = null;
        setHovered(null);
      }}
      onMouseUp={(event) => {
        const button = event.button ?? 0;
        const reporting = reportingButton.current;
        if (reporting !== null) {
          if (button !== reporting) return;
          reportingButton.current = null;
          reportMouse(event, button, MOUSE_ACTION.up, event.modifiers ?? NO_MODIFIERS);
          return;
        }
        if (button === 0) noteSelectionRelease(event);
        if (button !== 0 || !selectionGesture.current) return;
        selectionGesture.current = false;
        const pointer = { x: event.x ?? 0, y: event.y ?? 0 };
        if (selectionTimer.current !== null) clearTimeout(selectionTimer.current);
        // A double click's word selection waits out a possible third click.
        selectionTimer.current = setTimeout(
          () => {
            selectionTimer.current = null;
            showSelectionActionRef.current(pointer);
          },
          (event.clickCount ?? 1) >= 2 ? SELECTION_MULTI_CLICK_INTERVAL_MS : 0,
        );
      }}
      onClick={(event) => {
        const pressed = linkPressRef.current;
        linkPressRef.current = null;
        if (pressed === null) return;
        // A press that became a drag selected text instead.
        if (renderer.getSelectedText?.()) return;
        const link = linkAt(event.x ?? 0, event.y ?? 0);
        if (!isSameTerminalLink(pressed, link)) return;
        const modifiers = event.modifiers;
        activateLink(pressed.text, Boolean(modifiers?.ctrl || modifiers?.cmd));
      }}
      onAuxClick={(event) => {
        if (!event.isRightClick) return;
        // The program took the press; web suppresses its menu too.
        if (shouldReportTerminalMouse(emulator.mouseTracking, event.modifiers ?? NO_MODIFIERS)) return;
        dismissSelectionAction();
        setContextMenu({
          x: (event.x ?? 0) - origin.current.x,
          y: (event.y ?? 0) - origin.current.y,
          selection: readSelection(),
        });
      }}
      onLayout={(event) => {
        origin.current = { x: event.x ?? 0, y: event.y ?? 0 };
        const width = event.width ?? 0;
        const height = event.height ?? 0;
        setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
      }}
      onScroll={onScroll}
      style={{
        position: "relative",
        flexGrow: 1,
        flexBasis: 0,
        minHeight: 0,
        minWidth: 0,
        height: "100%",
        overflow: "hidden",
        backgroundColor: theme.background,
        cursor: hoveredLink !== null ? "pointer" : reportingCursor && tracking !== "none" ? "default" : "text",
        selectionColor,
        ...(pointerOwnedByProgram ? { userSelect: "none" as const } : {}),
      }}
    >
      {cellWidth === null ? (
        <text
          onLayout={(event) => {
            const width = event.width ?? 0;
            if (width <= 0) return;
            measuredCellWidth = width / PROBE.length;
            setCellWidth(measuredCellWidth);
          }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            opacity: 0,
            whiteSpace: "nowrap",
            fontFamily: FONTS.mono,
            fontSize: FONT_SIZE,
            lineHeight: CELL_HEIGHT,
            color: theme.foreground,
            userSelect: "none",
          }}
        >
          {PROBE}
        </text>
      ) : null}
      {selectAll !== null && frame !== null && cellWidth !== null ? (
        <SelectAllWash frame={frame} range={selectAll} cellWidth={cellWidth} color={selectionColor} />
      ) : null}
      {frame !== null && cellWidth !== null ? (
        <TerminalGrid frame={frame} cellWidth={cellWidth} theme={theme} focused={focused} />
      ) : null}
      {hoveredLink !== null && frame !== null && cellWidth !== null ? (
        <LinkUnderline frame={frame} link={hoveredLink} cellWidth={cellWidth} fallback={theme.foreground} />
      ) : null}
      {scrollbar ? (
        <div
          style={{
            position: "absolute",
            top: CONTENT_PADDING + scrollbar.top,
            right: 2,
            width: 4,
            height: scrollbar.height,
            borderRadius: 3,
            backgroundColor: palette.scrollbar,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {contextMenu ? (
        <Menu
          open
          onOpenChange={(open) => {
            if (!open) setContextMenu(null);
          }}
          rootStyle={{ position: "absolute", left: contextMenu.x, top: contextMenu.y, width: 0, height: 0 }}
          sideOffset={0}
          minWidth={MENU_MIN_WIDTH}
          testId="terminal-context-menu"
          trigger={() => <div />}
        >
          {/* web terminalContextMenuItems: "Add to chat" puts the selection in this thread's composer. */}
          <MenuItem
            disabled={contextMenu.selection === null}
            onSelect={() => contextMenu.selection && addSelectionToChat(contextMenu.selection)}
            testId="terminal-add-to-chat"
          >
            Add to chat
          </MenuItem>
          <MenuItem
            disabled={contextMenu.selection === null}
            onSelect={() => contextMenu.selection && copySelection(contextMenu.selection)}
            testId="terminal-copy"
          >
            Copy
          </MenuItem>
          <MenuItem disabled={!canOperate} onSelect={paste} testId="terminal-paste">
            Paste
          </MenuItem>
          <MenuItem onSelect={selectAllText} testId="terminal-select-all">
            Select all
          </MenuItem>
          <MenuItem
            onSelect={() => {
              emulator.scrollToBottom();
              focusTerminal();
            }}
            testId="terminal-jump-to-latest"
          >
            Jump to latest
          </MenuItem>
        </Menu>
      ) : null}
      {selectionAction ? (
        <Menu
          open
          onOpenChange={(open) => {
            if (!open) setSelectionAction(null);
          }}
          rootStyle={{ position: "absolute", left: selectionAction.x, top: selectionAction.y, width: 0, height: 0 }}
          sideOffset={0}
          minWidth={MENU_MIN_WIDTH}
          testId="terminal-selection-action"
          trigger={() => <div />}
        >
          {/* web terminalSelectionMenuItems. */}
          <MenuItem onSelect={() => addSelectionToChat(selectionAction.selection)} testId="terminal-selection-add-to-chat">
            Add to chat
          </MenuItem>
          <MenuItem onSelect={() => copySelection(selectionAction.selection)} testId="terminal-selection-copy">
            Copy
          </MenuItem>
        </Menu>
      ) : null}
    </div>
  );
}

/** ghostty's selection wash for "Select all": whole rows from the first to the last line with text. */
function SelectAllWash({
  frame,
  range,
  cellWidth,
  color,
}: {
  frame: TerminalFrame;
  range: SelectAllState;
  cellWidth: number;
  color: string;
}) {
  const top = Math.max(range.first - frame.viewportY, 0);
  const bottom = Math.min(range.last - frame.viewportY, frame.rows.length - 1);
  if (bottom < top) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: CONTENT_PADDING,
        top: CONTENT_PADDING + top * CELL_HEIGHT,
        width: frame.cols * cellWidth,
        height: (bottom - top + 1) * CELL_HEIGHT,
        backgroundColor: color,
        pointerEvents: "none",
      }}
    />
  );
}

/** renderer.ts hoveredLinkRange: a 1px rule two pixels above each covered cell's bottom, in the cell's colour. */
function LinkUnderline({
  frame,
  link,
  cellWidth,
  fallback,
}: {
  frame: TerminalFrame;
  link: TerminalLinkWithRange;
  cellWidth: number;
  fallback: string;
}) {
  const { start, end } = link.range;
  const segments: { row: number; from: number; to: number; color: string }[] = [];
  for (let row = start.y; row <= end.y && row < frame.rows.length; row++) {
    const from = row === start.y ? start.x : 0;
    const to = row === end.y ? end.x : frame.cols - 1;
    const run = frame.rows[row]?.find((candidate) => from >= candidate.col && from < candidate.col + candidate.cells);
    segments.push({ row, from, to, color: run?.fg ?? fallback });
  }
  return (
    <>
      {segments.map((segment) => (
        <div
          key={segment.row}
          style={{
            position: "absolute",
            left: CONTENT_PADDING + segment.from * cellWidth,
            top: CONTENT_PADDING + segment.row * CELL_HEIGHT + CELL_HEIGHT - 2,
            width: (segment.to - segment.from + 1) * cellWidth,
            height: 1,
            backgroundColor: segment.color,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

function scrollbarGeometry(frame: TerminalFrame, height: number): { top: number; height: number } | null {
  const trackHeight = height - CONTENT_PADDING * 2;
  const len = frame.rows.length;
  const total = frame.baseY + len;
  const maxOffset = frame.baseY;
  if (trackHeight <= 0 || maxOffset === 0) return null;
  const thumbHeight = Math.min(trackHeight, Math.max(MIN_SCROLLBAR_THUMB_HEIGHT, (trackHeight * len) / total));
  const travel = Math.max(0, trackHeight - thumbHeight);
  return { top: (travel * Math.min(frame.viewportY, maxOffset)) / maxOffset, height: thumbHeight };
}

const TerminalGrid = memo(function TerminalGrid({
  frame,
  cellWidth,
  theme,
  focused,
}: {
  frame: TerminalFrame;
  cellWidth: number;
  theme: TerminalTheme;
  focused: boolean;
}) {
  const cursor = frame.cursor;
  // gpuix lets an absolute box end the hit test, so the grid, its rows and runs
  // pass the pointer through to the viewport's handlers (focus, link clicks,
  // context menu). Text selection is window-level and does not need hits.
  return (
    <div style={{ position: "absolute", top: CONTENT_PADDING, left: CONTENT_PADDING, right: 0, bottom: 0, pointerEvents: "none" }}>
      {frame.rows.map((runs, row) => (
        <TerminalRow key={row} runs={runs} row={row} cellWidth={cellWidth} />
      ))}
      {cursor ? (
        <div
          style={{
            position: "absolute",
            left: cursor.col * cellWidth,
            top: cursor.row * CELL_HEIGHT + (focused && cursor.style === "underline" ? CELL_HEIGHT - 2 : 0),
            width: focused && cursor.style === "bar" ? 2 : cellWidth,
            height: focused && cursor.style === "underline" ? 2 : CELL_HEIGHT,
            ...(focused
              ? { backgroundColor: theme.cursor }
              : { borderWidth: 1, borderColor: theme.cursor }),
            pointerEvents: "none",
          }}
        >
          {focused && cursor.style === "block" && cursor.text.trim().length > 0 ? (
            <text
              style={{
                color: theme.background,
                fontFamily: FONTS.mono,
                fontSize: FONT_SIZE,
                lineHeight: CELL_HEIGHT,
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              {cursor.text}
            </text>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const TerminalRow = memo(
  function TerminalRow({ runs, row, cellWidth }: { runs: ReadonlyArray<CellRun>; row: number; cellWidth: number }) {
    if (runs.length === 0) return null;
    return (
      <div style={{ position: "absolute", top: row * CELL_HEIGHT, left: 0, right: 0, height: CELL_HEIGHT, pointerEvents: "none" }}>
        {runs.map((run) => (
          <text
            key={run.col}
            style={{
              position: "absolute",
              left: run.col * cellWidth,
              top: 0,
              width: run.cells * cellWidth,
              height: CELL_HEIGHT,
              lineHeight: CELL_HEIGHT,
              fontSize: FONT_SIZE,
              fontFamily: FONTS.mono,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              color: run.fg,
              ...(run.bg !== null ? { backgroundColor: run.bg } : {}),
              ...(run.bold ? { fontWeight: 700 } : {}),
              ...(run.underline ? { textDecoration: "underline" } : run.strike ? { textDecoration: "line-through" } : {}),
            }}
          >
            {run.text}
          </text>
        ))}
      </div>
    );
  },
  (previous, next) =>
    previous.row === next.row && previous.cellWidth === next.cellWidth && runsEqual(previous.runs, next.runs),
);

function runsEqual(left: ReadonlyArray<CellRun>, right: ReadonlyArray<CellRun>): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index]!;
    const b = right[index]!;
    if (
      a.col !== b.col ||
      a.cells !== b.cells ||
      a.text !== b.text ||
      a.fg !== b.fg ||
      a.bg !== b.bg ||
      a.bold !== b.bold ||
      a.underline !== b.underline ||
      a.strike !== b.strike
    ) {
      return false;
    }
  }
  return true;
}
