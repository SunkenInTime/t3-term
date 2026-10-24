// Port of apps/web/src/components/settings/ProviderAuthTerminal.tsx: the provider's
// sign-in program (a CLI login) shown as a live terminal you can type into. Web runs
// libghostty on a canvas; this feeds the server's output into the headless emulator
// the thread terminal uses (app/src/terminal/vt) and paints one <text> per styled run.
// Keys become `{ type: "terminal", data }` responses and the grid size goes back as
// `{ type: "terminal", data: "", size }`, as the web surface's onData/onResize do.
// Tab is left to focus navigation (web's beforeKey), and a plain click on an
// http(s) URL opens it, like web's onLinkActivate.
import { useGpuixRequired, type KeyEvent } from "@gpuix/react";
import type { ProviderAuthResponse } from "@t3tools/contracts";
import { memo, useEffect, useRef, useState } from "react";

import { TerminalEmulator, type CellRun, type TerminalFrame, type TerminalTheme } from "../../terminal/vt/emulator.ts";
import { encodeKey } from "../../terminal/vt/keys.ts";
import { FONTS, RADIUS, useTheme } from "../../ui/theme.ts";
import { openExternal } from "../openExternal.ts";

const PADDING = 4;
const FONT_SIZE = 13;
const CELL_HEIGHT = Math.round(FONT_SIZE * 1.35);
/** `h-64` */
const HEIGHT = 256;
const PROBE = "M".repeat(64);
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

type TerminalResponse = Extract<ProviderAuthResponse, { type: "terminal" }>;

let measuredCellWidth: number | null = null;

export function ProviderAuthTerminal({
  output,
  outputOffset,
  onResponse,
  testId,
}: {
  readonly output: string;
  readonly outputOffset?: number | undefined;
  readonly onResponse: (response: TerminalResponse) => void;
  readonly testId?: string;
}) {
  const palette = useTheme();
  const renderer = useGpuixRequired();
  const containerRef = useRef<{ id: number } | null>(null);
  const theme: TerminalTheme = {
    appearance: palette.appearance,
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.appearance === "dark" ? "#b4cbff" : "#26384e",
  };
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const latest = useRef({ onResponse });
  latest.current = { onResponse };

  const emulatorRef = useRef<TerminalEmulator | null>(null);
  if (emulatorRef.current === null) {
    emulatorRef.current = new TerminalEmulator(80, 14, (reply) => latest.current.onResponse({ type: "terminal", data: reply }));
  }
  const emulator = emulatorRef.current;
  const [frame, setFrame] = useState<TerminalFrame | null>(null);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const [cellWidth, setCellWidth] = useState<number | null>(measuredCellWidth);
  const [width, setWidth] = useState<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  // Repaint after output only; nothing repaints while the program is quiet.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePaint = () => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setFrame(emulator.frame(themeRef.current, focusedRef.current));
    }, 16);
  };
  const schedulePaintRef = useRef(schedulePaint);
  schedulePaintRef.current = schedulePaint;
  useEffect(() => {
    const stop = emulator.onChange(() => schedulePaintRef.current());
    return () => {
      stop();
      if (timer.current !== null) clearTimeout(timer.current);
      emulator.dispose();
    };
  }, [emulator]);

  // `output` is the server's retained tail and `outputOffset` the total written so far:
  // append the new part, or start over when the tail no longer covers it.
  const written = useRef<number | null>(null);
  useEffect(() => {
    const offset = outputOffset ?? output.length;
    if (written.current === null) emulator.resetAndWrite(output);
    else {
      const delta = offset - written.current;
      if (delta > 0 && delta <= output.length) emulator.write(output.slice(-delta));
      else if (delta !== 0) emulator.resetAndWrite(output);
    }
    written.current = offset;
  }, [output, outputOffset, emulator]);

  const grid =
    width !== null && cellWidth !== null
      ? { cols: Math.max(20, Math.floor((width - PADDING * 2) / cellWidth)), rows: Math.max(1, Math.floor((HEIGHT - 2 - PADDING * 2) / CELL_HEIGHT)) }
      : null;
  useEffect(() => {
    if (grid === null) return;
    emulator.resize(grid.cols, grid.rows);
    emulator.scrollToBottom();
    latest.current.onResponse({ type: "terminal", data: "", size: { cols: grid.cols, rows: grid.rows } });
    schedulePaint();
  }, [grid?.cols, grid?.rows]);

  useEffect(() => {
    focusedRef.current = focused;
    schedulePaint();
  }, [focused]);

  const urlAt = (x: number, y: number): string | null => {
    if (cellWidth === null || frame === null) return null;
    const col = Math.floor((x - origin.current.x - PADDING) / cellWidth);
    const row = Math.floor((y - origin.current.y - PADDING) / CELL_HEIGHT);
    const runs = frame.rows[row];
    if (!runs) return null;
    let line = "";
    for (const run of runs) line = line.padEnd(run.col, " ") + run.text;
    for (const match of line.matchAll(URL_PATTERN)) {
      const start = match.index ?? 0;
      const url = match[0].replace(/[.,;:!?)\]}]+$/, "");
      if (col >= start && col < start + url.length) return url;
    }
    return null;
  };

  const onKeyDown = (event: KeyEvent) => {
    const key = (event.key ?? "").toLowerCase();
    // Tab moves focus, as web's beforeKey returns false for it.
    if (key === "tab") return;
    const data = encodeKey(event, { applicationCursorKeys: emulator.applicationCursorKeys });
    if (data === null) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (!emulator.isAtBottom()) emulator.scrollToBottom();
    latest.current.onResponse({ type: "terminal", data });
  };

  return (
      <div
        ref={containerRef as never}
        testId={testId}
        tabIndex={0}
        onMouseDown={() => {
          // A click focuses the terminal, as on web, so keys go to the sign-in program.
          if (containerRef.current) renderer.focusElement?.(containerRef.current.id);
          setFocused(true);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(event) => {
          const url = urlAt(event.x ?? 0, event.y ?? 0);
          if (url === null || event.modifiers?.shift) return;
          openExternal(url);
        }}
        onLayout={(event) => {
          origin.current = { x: event.x ?? 0, y: event.y ?? 0 };
          const next = event.width ?? 0;
          setWidth((current) => (current === next ? current : next));
        }}
        onScroll={(event: { deltaY?: number }) => {
          const lines = Math.trunc((event.deltaY ?? 0) / 20);
          if (lines !== 0 && !emulator.alternate) emulator.scrollLines(-lines);
        }}
        style={{
          position: "relative",
          width: "100%",
          height: HEIGHT,
          overflow: "hidden",
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: theme.background,
          cursor: "text",
          selectionColor: palette.appearance === "dark" ? "#b4cbff40" : "#253f6333",
        }}
      >
        {cellWidth === null ? (
          <text
            onLayout={(event) => {
              const probeWidth = event.width ?? 0;
              if (probeWidth <= 0) return;
              measuredCellWidth = probeWidth / PROBE.length;
              setCellWidth(measuredCellWidth);
            }}
            style={{ position: "absolute", top: 0, left: 0, opacity: 0, pointerEvents: "none", whiteSpace: "nowrap", fontFamily: FONTS.mono, fontSize: FONT_SIZE, color: theme.foreground }}
          >
            {PROBE}
          </text>
        ) : null}
        {frame !== null && cellWidth !== null ? <Grid frame={frame} cellWidth={cellWidth} theme={theme} focused={focused} /> : null}
      </div>
  );
}

const Grid = memo(function Grid({ frame, cellWidth, theme, focused }: { frame: TerminalFrame; cellWidth: number; theme: TerminalTheme; focused: boolean }) {
  const cursor = frame.cursor;
  return (
    // gpuix ends the hit test at any absolutely positioned box, so the grid lets
    // clicks through to the terminal (focus, link clicks).
    <div style={{ position: "absolute", top: PADDING, left: PADDING, right: 0, bottom: 0, pointerEvents: "none" }}>
      {frame.rows.map((runs, row) => (runs.length === 0 ? null : <Row key={row} runs={runs} row={row} cellWidth={cellWidth} />))}
      {cursor ? (
        <div
          style={{
            position: "absolute",
            left: cursor.col * cellWidth,
            top: cursor.row * CELL_HEIGHT,
            width: cellWidth,
            height: CELL_HEIGHT,
            ...(focused ? { backgroundColor: theme.cursor } : { borderWidth: 1, borderColor: theme.cursor }),
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
});

function Row({ runs, row, cellWidth }: { runs: ReadonlyArray<CellRun>; row: number; cellWidth: number }) {
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
}
