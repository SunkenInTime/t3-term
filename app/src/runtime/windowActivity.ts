// What web reads from `document.visibilityState`, `document.hasFocus()` and its
// window input listeners, for the background activity reporter
// (web/lib/backgroundActivityReporter.ts).
//
// gpuix 0.11 does not expose GPUI's window activation to JS. On Windows (always a
// native window there) the foreground window answers it directly. Elsewhere, and
// in kitty mode where the terminal owns focus, a key press is the only evidence
// of focus: keys reach only the focused window, so focus counts as held for the
// lease window after the last one. The window is reported visible unless Windows
// says it is minimized; nothing else can tell.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { termHome } from "./paths.ts";

export interface WindowActivity {
  readonly visible: boolean;
  readonly focused: boolean;
}

export type InputKind = "key" | "pointer";

const inputListeners = new Set<(kind: InputKind) => void>();
const changeListeners = new Set<() => void>();
let lastKeyAtMs = Number.NEGATIVE_INFINITY;

/** Called for every user key, pointer and wheel event (main.tsx). */
export function noteWindowInput(kind: InputKind): void {
  if (kind === "key") lastKeyAtMs = Date.now();
  for (const listener of inputListeners) listener(kind);
}

export function onWindowInput(listener: (kind: InputKind) => void): () => void {
  inputListeners.add(listener);
  return () => inputListeners.delete(listener);
}

/** Fires when focus or visibility changes, where the platform can tell (web's focus/blur/visibilitychange). */
export function onWindowActivityChange(listener: () => void): () => void {
  changeListeners.add(listener);
  startForegroundPoll();
  return () => {
    changeListeners.delete(listener);
    if (changeListeners.size === 0) stopForegroundPoll();
  };
}

interface Win32 {
  readonly foregroundIsOurs: () => boolean;
  readonly ourWindowMinimized: () => boolean;
}

let win32: Win32 | null | undefined;

function loadWin32(): Win32 | null {
  if (win32 !== undefined) return win32;
  win32 = null;
  if (process.platform !== "win32") return null;
  try {
    // Required lazily: bun:ffi only exists under Bun, and only Windows needs it.
    const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
    const user32 = dlopen("user32.dll", {
      GetForegroundWindow: { args: [], returns: FFIType.ptr },
      GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
      IsIconic: { args: [FFIType.ptr], returns: FFIType.i32 },
    });
    const pidOut = new Uint32Array(1);
    // The GPUI window lives in this process; remember it once it has been in front,
    // so minimizing can be told apart from switching to another app.
    let ourWindow: ReturnType<typeof user32.symbols.GetForegroundWindow> = null;
    win32 = {
      foregroundIsOurs: () => {
        const hwnd = user32.symbols.GetForegroundWindow();
        if (hwnd === null) return false;
        pidOut[0] = 0;
        user32.symbols.GetWindowThreadProcessId(hwnd, ptr(pidOut));
        if (pidOut[0] !== process.pid) return false;
        ourWindow = hwnd;
        return true;
      },
      ourWindowMinimized: () => ourWindow !== null && user32.symbols.IsIconic(ourWindow) !== 0,
    };
  } catch {
    win32 = null;
  }
  return win32;
}

const RECENT_KEY_FOCUS_MS = 45_000;

export function readWindowActivity(): WindowActivity {
  const platform = loadWin32();
  if (platform !== null) {
    return { visible: !platform.ourWindowMinimized(), focused: platform.foregroundIsOurs() };
  }
  return { visible: true, focused: Date.now() - lastKeyAtMs <= RECENT_KEY_FOCUS_MS };
}

const FOREGROUND_POLL_MS = 1_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPolled = "";

function startForegroundPoll(): void {
  if (pollTimer !== null || loadWin32() === null) return;
  lastPolled = JSON.stringify(readWindowActivity());
  // Two cheap user32 calls a second; no repaint, nothing else wakes.
  pollTimer = setInterval(() => {
    const next = JSON.stringify(readWindowActivity());
    if (next === lastPolled) return;
    lastPolled = next;
    for (const listener of changeListeners) listener();
  }, FOREGROUND_POLL_MS);
  pollTimer.unref?.();
}

function stopForegroundPoll(): void {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

let clientId: string | null = null;

/** Web keeps this in localStorage (`t3.backgroundActivity.clientId`); here it is a file in $T3TERM_HOME. */
export function backgroundActivityClientId(): string {
  if (clientId !== null) return clientId;
  const file = NodePath.join(termHome(), "background-activity-client-id");
  try {
    const existing = NodeFS.readFileSync(file, "utf8").trim();
    if (existing) return (clientId = existing);
  } catch {}
  const next = globalThis.crypto.randomUUID();
  try {
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, next);
  } catch {
    // An unsaved id only costs the server one stale lease after a restart.
  }
  return (clientId = next);
}
