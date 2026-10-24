// One terminal session's viewport: attaches to the server session, feeds the
// headless emulator, paints its grid, and turns keys and wheel into PTY input.
// Port of TerminalViewport/TerminalSessionViewport in
// apps/web/src/components/ThreadTerminalDrawer.tsx; the web paints
// libghostty onto a canvas, this paints one <text> per styled run.
import { useGpuixRequired, type KeyEvent } from "@gpuix/react";
import {
  INITIAL_TERMINAL_OUTPUT_CURSOR,
  readTerminalOutputUpdate,
  type TerminalBufferState,
  type TerminalOutputCursor,
} from "@t3tools/client-runtime/state/terminal";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
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
import { openExternalUrl, readClipboardText, writeClipboardText } from "./clipboard.ts";
import { TerminalEmulator, type CellRun, type TerminalFrame, type TerminalTheme } from "./vt/emulator.ts";
import { locateSelectionLines } from "./selectionLines.ts";
import { addTerminalContextToThreadComposer } from "../chat/composer/terminalContextIntake.ts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import { encodeKey } from "./vt/keys.ts";

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

export type TerminalShortcutCommand = "split" | "splitVertical" | "new" | "close";

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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
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

  const scrollRemainder = useRef(0);
  const onScroll = (event: { deltaY?: number; precise?: boolean }) => {
    const delta = event.deltaY ?? 0;
    if (delta === 0) return;
    // gpuix reports pixels: a trackpad's own, or wheel lines at 20px each.
    // Positive moves toward older output.
    const lines = (event.precise ? delta / CELL_HEIGHT : delta / WHEEL_LINE_PIXELS) + scrollRemainder.current;
    const whole = Math.trunc(lines);
    scrollRemainder.current = lines - whole;
    if (whole === 0) return;
    if (emulator.alternate) {
      // Full-screen programs scroll by arrow keys, like alternate scroll mode.
      const arrow = whole > 0 ? "A" : "B";
      const prefix = emulator.applicationCursorKeys ? "\x1bO" : "\x1b[";
      write(`${prefix}${arrow}`.repeat(Math.abs(whole)));
      return;
    }
    emulator.scrollLines(-whole);
  };

  const copySelection = (): boolean => {
    const text = renderer.getSelectedText?.();
    if (!text) return false;
    void writeClipboardText(text).catch((error: unknown) =>
      emulator.writeSystemMessage(error instanceof Error ? error.message : "Unable to copy terminal selection"),
    );
    renderer.clearSelection?.();
    return true;
  };

  const addSelectionToChat = () => {
    const text = renderer.getSelectedText?.();
    if (!text) return;
    const { lineStart, lineEnd } = locateSelectionLines(emulator, text);
    addTerminalContextToThreadComposer(environmentId, threadId, {
      terminalId,
      terminalLabel: getTerminalLabel(terminalId),
      lineStart,
      lineEnd,
      text,
    });
    renderer.clearSelection?.();
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

  /** The URL under a window point, if any. */
  const urlAt = (x: number, y: number): string | null => {
    if (cellWidth === null) return null;
    const col = Math.floor((x - origin.current.x - CONTENT_PADDING) / cellWidth);
    const row = Math.floor((y - origin.current.y - CONTENT_PADDING) / CELL_HEIGHT);
    if (col < 0 || row < 0 || row >= emulator.rows) return null;
    const buffer = emulator.terminal.buffer.active;
    const text = buffer.getLine(buffer.viewportY + row)?.translateToString(false) ?? "";
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>`]+/g)) {
      const start = match.index ?? 0;
      const url = match[0].replace(/[.,;:!?)\]}]+$/, "");
      if (col >= start && col < start + url.length) return url;
    }
    return null;
  };

  /**
   * web handleLinkActivate: a plain click opens a URL in the thread's Browser
   * when the link-target preference is "app"; Ctrl/Cmd+click, or no preview
   * access, opens the system browser.
   */
  const activateLink = (url: string, forceBrowser: boolean) => {
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
  const linkPressRef = useRef<string | null>(null);

  const onKeyDown = (event: KeyEvent) => {
    const key = (event.key ?? "").toLowerCase();
    const mods = event.modifiers ?? { shift: false, ctrl: false, alt: false, cmd: false };
    const mod = isMac ? mods.cmd : mods.ctrl;
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    // Terminal commands bound with `when: terminalFocus` (packages/shared/src/keybindings.ts).
    if (mod && !mods.alt) {
      const command: TerminalShortcutCommand | null =
        key === "d" ? (mods.shift ? "splitVertical" : "split") : key === "n" && !mods.shift ? "new" : key === "w" && !mods.shift ? "close" : null;
      if (command !== null && callbacks.current.onShortcut) {
        consume();
        callbacks.current.onShortcut(command);
        return;
      }
      // App shortcuts that stay live inside the terminal go to the window handler.
      if (
        key === "j" ||
        key === "o" ||
        (mods.shift && (key === "[" || key === "]" || key === "t" || key === "j")) ||
        (!mods.shift && /^[1-9]$/.test(key))
      ) {
        return;
      }
    }
    if (mod && mods.alt && key === "b") return;

    // Copy and paste.
    const copyChord = isMac ? mods.cmd && key === "c" : mods.ctrl && mods.shift && key === "c";
    if (copyChord || (!isMac && mods.ctrl && !mods.shift && key === "c" && renderer.getSelectedText?.())) {
      consume();
      copySelection();
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
    renderer.clearSelection?.();
    write(data);
  };

  const scrollbar = frame !== null && size !== null && frame.baseY > 0 && !frame.alternate ? scrollbarGeometry(frame, size.height) : null;

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
        linkPressRef.current =
          (event.button ?? 0) === 0 && !event.modifiers?.shift && (event.clickCount ?? 1) === 1
            ? urlAt(event.x ?? 0, event.y ?? 0)
            : null;
      }}
      onClick={(event) => {
        const pressed = linkPressRef.current;
        linkPressRef.current = null;
        const url = urlAt(event.x ?? 0, event.y ?? 0);
        if (url === null || url !== pressed) return;
        const modifiers = event.modifiers;
        activateLink(url, Boolean(modifiers?.ctrl || modifiers?.cmd));
      }}
      onAuxClick={(event) => {
        if (!event.isRightClick) return;
        setContextMenu({
          x: (event.x ?? 0) - origin.current.x,
          y: (event.y ?? 0) - origin.current.y,
          hasSelection: Boolean(renderer.getSelectedText?.()),
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
        cursor: "text",
        selectionColor: palette.appearance === "dark" ? "#b4cbff40" : "#253f6333",
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
      {frame !== null && cellWidth !== null ? (
        <TerminalGrid frame={frame} cellWidth={cellWidth} theme={theme} focused={focused} />
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
          testId="terminal-context-menu"
          trigger={() => <div />}
        >
          {/* web terminalSelectionMenuItems: "Add to chat" puts the selection in this thread's composer. */}
          <MenuItem disabled={!contextMenu.hasSelection} onSelect={addSelectionToChat} testId="terminal-add-to-chat">
            Add to chat
          </MenuItem>
          <MenuItem disabled={!contextMenu.hasSelection} onSelect={() => void copySelection()}>
            Copy
          </MenuItem>
          <MenuItem disabled={!canOperate} onSelect={paste}>
            Paste
          </MenuItem>
          <MenuItem onSelect={() => emulator.scrollToBottom()}>Jump to latest</MenuItem>
        </Menu>
      ) : null}
    </div>
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
