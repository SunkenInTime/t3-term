// How t3-term raises a notification, plays T3's alert sounds and shows the
// unread badge, without a browser. In a terminal the terminal owns the
// desktop, so we ask it through escape sequences on the tty; in a native
// window we use the OS notifier.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { isTerminal } from "@gpuix/react";
import type { Subprocess } from "bun";

import { isAppFocused, noteInput } from "./focus.ts";
import { showMacNotification } from "./macNotifier.ts";
import { showWindowsToast } from "./windowsToast.ts";
import completionSound from "./assets/notification-completion.mp3" with { type: "file" };
import inputSound from "./assets/notification-input.mp3" with { type: "file" };

/** gpuix redirects fd 1 and 2 while it runs, so escape sequences go to the tty itself. */
function writeTty(sequence: string): boolean {
  if (process.platform === "win32") return false;
  try {
    const fd = NodeFS.openSync("/dev/tty", "w");
    try {
      NodeFS.writeSync(fd, sequence);
    } finally {
      NodeFS.closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/** Escape sequences may not contain control characters or the separators they use. */
function sanitize(text: string): string {
  return text.replace(/[\x00-\x1f\x7f;]/g, " ").slice(0, 240);
}

function terminalKind(): "kitty" | "ghostty" | "other" {
  if (process.env.KITTY_WINDOW_ID || process.env.TERM === "xterm-kitty") return "kitty";
  if (process.env.TERM_PROGRAM === "ghostty" || process.env.TERM === "xterm-ghostty") return "ghostty";
  return "other";
}

let nextKittyId = 1;

/** A raised notification t3-term can take back (web Notification.close()). */
export interface DesktopNotificationHandle {
  close(): void;
}

export interface DesktopNotificationOptions {
  /** web Notification `tag`: one notification per thread. */
  readonly tag: string;
  /** The user clicked it (web notification "click"). */
  readonly onActivate: () => void;
  /** It is gone for good: clicked, closed by the user, expired, or the notifier failed. */
  readonly onGone: () => void;
}

const UNTRACKED: DesktopNotificationHandle = { close() {} };

function terminalNotification(title: string, body: string): DesktopNotificationHandle | null {
  switch (terminalKind()) {
    case "kitty": {
      // https://sw.kovidgoyal.net/kitty/desktop-notifications/: title then body, d=0 until the last part.
      // BEL-terminated: kitty 0.32 drops a two-part notification whose parts end in ESC \.
      // Clicking it focuses the kitty window (kitty's default a=focus). Telling t3-term which
      // thread to open would need `a=report`, but kitty answers on stdin with an OSC 99 reply
      // and gpuix 0.11.0 consumes every OSC reply without handing it to JS
      // (packages/gpui-terminal/src/tty.rs:604-619), so the click cannot navigate. That is why
      // a local session prefers a notifier on this machine (localTerminalNotification).
      const id = nextKittyId++;
      if (!writeTty(`\x1b]99;i=${id}:d=0:p=title;${sanitize(title)}\x07\x1b]99;i=${id}:d=1:p=body;${sanitize(body)}\x07`)) return null;
      // kitty 0.36+ closes it on request; older kitty ignores the unknown payload type.
      return { close: () => void writeTty(`\x1b]99;i=${id}:p=close;\x07`) };
    }
    case "ghostty":
      return writeTty(`\x1b]777;notify;${sanitize(title)};${sanitize(body)}\x07`) ? UNTRACKED : null;
    default:
      // OSC 9 is the widest-supported fallback (iTerm2, WezTerm, Windows Terminal, Ghostty).
      return writeTty(`\x1b]9;${sanitize(`${title}: ${body}`)}\x07`) ? UNTRACKED : null;
  }
}

function spawnQuiet(command: ReadonlyArray<string>): void {
  if (Bun.which(command[0]!) === null) return;
  try {
    Bun.spawn([...command], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  } catch {
    // A missing notifier only loses the alert.
  }
}

function powershellString(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

let notifySendWaits: boolean | null = null;

/** libnotify 0.7.9 added --wait and --action; an older notify-send rejects them and shows nothing. */
function notifySendSupportsActions(): boolean {
  if (notifySendWaits !== null) return notifySendWaits;
  notifySendWaits = false;
  try {
    const help = Bun.spawnSync(["notify-send", "--help"], { stdout: "pipe", stderr: "pipe" });
    const text = `${help.stdout?.toString() ?? ""}${help.stderr?.toString() ?? ""}`;
    notifySendWaits = text.includes("--action") && text.includes("--wait");
  } catch {
    // No notify-send at all.
  }
  return notifySendWaits;
}

/**
 * notify-send --wait stays alive until the notification closes and prints the
 * key of the action the user picked; "default" is a click on the body.
 * SIGINT makes it close the notification before it exits.
 */
function linuxNotification(title: string, body: string, options: DesktopNotificationOptions): DesktopNotificationHandle | null {
  if (Bun.which("notify-send") === null) return null;
  if (!notifySendSupportsActions()) {
    spawnQuiet(["notify-send", "--app-name=T3 Code", title, body]);
    return UNTRACKED;
  }
  let child: Subprocess<"ignore", "pipe", "ignore">;
  try {
    child = Bun.spawn(["notify-send", "--app-name=T3 Code", "--wait", "--action=default=Open", title, body], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
  } catch {
    return null;
  }
  let closed = false;
  void (async () => {
    const output = await new Response(child.stdout).text().catch(() => "");
    await child.exited.catch(() => undefined);
    if (!closed && output.split(/\r?\n/).some((line) => line.trim() === "default")) options.onActivate();
    closed = true;
    options.onGone();
  })();
  return {
    close() {
      if (closed) return;
      closed = true;
      try {
        child.kill("SIGINT");
      } catch {
        // Already gone.
      }
    },
  };
}

/** Over SSH a notifier here would show on the remote machine, so only the terminal can reach the user. */
function isRemoteSession(): boolean {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}

/**
 * The terminal app's window, brought forward after a click on a notification
 * that came from a notifier rather than the terminal. kitty's remote control
 * socket, when one is configured (never the tty, which gpuix reads), or
 * xdotool with the X11 window id kitty and xterm-likes export.
 */
function focusTerminalWindow(): void {
  const kittySocket = process.env.KITTY_LISTEN_ON;
  const kittyWindow = process.env.KITTY_WINDOW_ID;
  if (kittySocket && kittyWindow && Bun.which("kitten") !== null) {
    spawnQuiet(["kitten", "@", "--to", kittySocket, "focus-window", "--match", `id:${kittyWindow}`]);
    return;
  }
  const x11Window = process.env.WINDOWID;
  if (x11Window && process.env.DISPLAY) spawnQuiet(["xdotool", "windowactivate", x11Window]);
}

/**
 * Terminal mode on this machine: a desktop notifier reports the click, which
 * the terminal's own notification cannot (see terminalNotification), so the
 * click can open the thread. macOS uses terminal-notifier, which also brings
 * the terminal app forward (__CFBundleIdentifier names the app that launched
 * this process); Linux uses notify-send --wait. Null when neither applies, and
 * the terminal shows the notification instead.
 */
function localTerminalNotification(title: string, body: string, options: DesktopNotificationOptions): DesktopNotificationHandle | null {
  if (isRemoteSession()) return null;
  if (process.platform === "darwin") {
    return showMacNotification({
      title,
      body,
      tag: options.tag,
      activateBundleId: process.env.__CFBundleIdentifier?.trim() || undefined,
      onActivate: options.onActivate,
    });
  }
  if (process.platform === "linux" && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) {
    if (Bun.which("notify-send") === null || !notifySendSupportsActions()) return null;
    return linuxNotification(title, body, {
      ...options,
      onActivate: () => {
        focusTerminalWindow();
        options.onActivate();
      },
    });
  }
  return null;
}

function nativeNotification(title: string, body: string, options: DesktopNotificationOptions): DesktopNotificationHandle | null {
  switch (process.platform) {
    case "darwin": {
      const handle = showMacNotification({ title, body, tag: options.tag, onActivate: options.onActivate });
      if (handle) return handle;
      // Without terminal-notifier: osascript's `display notification` has no click callback and no handle to close it.
      spawnQuiet([
        "osascript",
        "-e",
        `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`,
      ]);
      return UNTRACKED;
    }
    case "win32":
      return showWindowsToast({ title, body, tag: options.tag, onActivate: options.onActivate, onGone: options.onGone });
    default:
      return linuxNotification(title, body, options);
  }
}

/**
 * Raises a desktop notification for a thread. The handle closes it again where
 * the platform allows (Windows, kitty, Linux with a current notify-send);
 * elsewhere close() does nothing. Null when nothing could show it.
 */
export function showDesktopNotification(title: string, body: string, options: DesktopNotificationOptions): DesktopNotificationHandle | null {
  if (isTerminal()) {
    const handle = localTerminalNotification(title, body, options) ?? terminalNotification(title, body);
    if (handle) return handle;
  }
  return nativeNotification(title, body, options);
}

/** Bun embeds the sounds in a compiled binary; players need a real file path. */
function soundPath(kind: "completion" | "input"): string {
  const embedded = kind === "completion" ? completionSound : inputSound;
  if (NodeFS.existsSync(embedded) && !/~BUN|\$bunfs/i.test(embedded)) return embedded;
  const out = NodePath.join(NodeOS.tmpdir(), `t3term-notification-${kind}.mp3`);
  if (!NodeFS.existsSync(out)) NodeFS.writeFileSync(out, NodeFS.readFileSync(embedded));
  return out;
}

const playingUntil = new Map<string, number>();
// Both sounds are under a second long.
const SOUND_DURATION_MS = 900;

/** Plays T3's completion or input alert. A burst of threads finishing together plays it once. */
export function playNotificationSound(kind: "completion" | "input"): void {
  const now = Date.now();
  if (now < (playingUntil.get(kind) ?? 0)) return;
  playingUntil.set(kind, now + SOUND_DURATION_MS);
  // Over SSH the sound must play where the user is, so a terminal gets the bell.
  if (isTerminal() && process.env.SSH_CONNECTION && writeTty("\x07")) return;
  let file: string;
  try {
    file = soundPath(kind);
  } catch {
    writeTty("\x07");
    return;
  }
  switch (process.platform) {
    case "darwin":
      spawnQuiet(["afplay", file]);
      return;
    case "win32":
      spawnQuiet([
        "powershell.exe",
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]${powershellString(file)}); $p.Play(); Start-Sleep -Milliseconds 1500`,
      ]);
      return;
    default:
      if (Bun.which("ffplay")) spawnQuiet(["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", file]);
      else if (Bun.which("mpv")) spawnQuiet(["mpv", "--no-video", "--really-quiet", file]);
      else writeTty("\x07");
  }
}

/** Any key or pointer event in t3-term (the input fallback of notifications/focus.ts). */
export function noteUserInput(): void {
  noteInput();
}

/** Whether the user is looking at t3-term right now (web: visible and focused). */
export function userIsPresent(): boolean {
  return isAppFocused();
}
