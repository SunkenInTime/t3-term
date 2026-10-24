// Whether the user is looking at t3-term: web reads `document.hasFocus()` and
// `visibilityState`; gpuix 0.11.0 gives JS no window-focus or activation event
// (native/src has no on_active_status_change binding, and terminal focus
// reports CSI I/O only set GPUI's internal active flag). Toasts pause their
// timers and the notification coordinator picks in-app toast vs desktop
// notification from this one signal.
//
// Windows native window: the gpuix window lives in this bun process, so
// user32 GetForegroundWindow + GetWindowThreadProcessId == process.pid is the
// real answer. Elsewhere (terminal mode, macOS, Linux) recent input stands in:
// any key or pointer event in the last ten seconds.
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";

export type FocusSource = "foreground" | "input" | "focused" | "unfocused";

const PRESENCE_WINDOW_MS = 10_000;
const POLL_MS = 1000;

/** True while t3-term has the user's attention. Updated about once a second. */
export const appFocusedAtom = Atom.make(true).pipe(Atom.keepAlive);

let lastInputAt = Date.now();
let source: FocusSource | null = null;
let readForeground: (() => boolean) | null = null;

// T3TERM_FOCUS_LOG=<file> appends every transition, to check the signal against the real desktop.
const focusLog = process.env.T3TERM_FOCUS_LOG?.trim();

function set(focused: boolean): void {
  if (appAtomRegistry.get(appFocusedAtom) === focused) return;
  appAtomRegistry.set(appFocusedAtom, focused);
  if (focusLog) {
    try {
      require("node:fs").appendFileSync(focusLog, `${new Date().toISOString()} ${source} ${focused ? "focused" : "unfocused"}\n`);
    } catch {
      // Diagnostics only.
    }
  }
}

/**
 * T3TERM_FOCUS_SIGNAL=foreground|input|focused|unfocused overrides the choice
 * (focused/unfocused pin it, for screenshots of paused timers). The screenshot
 * harness runs the window hidden behind other apps (GPUIX_BACKGROUND=1), where
 * the foreground test would always say "away" and route every alert to the
 * desktop, so it falls back to input there unless asked.
 */
function chooseSource(): FocusSource {
  const forced = process.env.T3TERM_FOCUS_SIGNAL?.trim();
  if (forced === "foreground" || forced === "input" || forced === "focused" || forced === "unfocused") return forced;
  if (process.platform === "win32" && process.env.GPUIX_TERMINAL !== "1" && process.env.GPUIX_BACKGROUND !== "1") return "foreground";
  return "input";
}

function loadForegroundReader(): (() => boolean) | null {
  if (process.platform !== "win32") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
    const user32 = dlopen("user32.dll", {
      GetForegroundWindow: { args: [], returns: FFIType.ptr },
      GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
    });
    const pid = new Uint32Array(1);
    const pidPtr = ptr(pid);
    return () => {
      const hwnd = user32.symbols.GetForegroundWindow();
      if (!hwnd) return false;
      pid[0] = 0;
      user32.symbols.GetWindowThreadProcessId(hwnd, pidPtr);
      return pid[0] === process.pid;
    };
  } catch {
    return null;
  }
}

function sample(): boolean {
  switch (source) {
    case "focused":
      return true;
    case "unfocused":
      return false;
    case "foreground":
      if (readForeground) return readForeground();
      return Date.now() - lastInputAt < PRESENCE_WINDOW_MS;
    default:
      return Date.now() - lastInputAt < PRESENCE_WINDOW_MS;
  }
}

/** Starts the poll once; safe to call from every consumer. */
export function startFocusSignal(): void {
  if (source !== null) return;
  source = chooseSource();
  if (source === "foreground") {
    readForeground = loadForegroundReader();
    if (!readForeground) source = "input";
  }
  set(sample());
  const timer = setInterval(() => set(sample()), POLL_MS);
  (timer as { unref?: () => void }).unref?.();
}

/** Which signal is live, for diagnostics and the report of what was checked. */
export function focusSource(): FocusSource {
  startFocusSignal();
  return source!;
}

/** Any key or pointer event in t3-term. */
export function noteInput(): void {
  lastInputAt = Date.now();
  // Input means presence under the heuristic; the foreground test answers for itself.
  if (source === "input") set(true);
}

export function isAppFocused(): boolean {
  startFocusSignal();
  return appAtomRegistry.get(appFocusedAtom);
}

/** Calls `listener` with every change of the signal. Returns the unsubscribe. */
export function onAppFocusChange(listener: (focused: boolean) => void): () => void {
  startFocusSignal();
  return appAtomRegistry.subscribe(appFocusedAtom, listener);
}
