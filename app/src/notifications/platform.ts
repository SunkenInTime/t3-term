// How t3-term raises a notification, plays T3's alert sounds and shows the
// unread badge, without a browser. In a terminal the terminal owns the
// desktop, so we ask it through escape sequences on the tty; in a native
// window we use the OS notifier.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { isTerminal } from "@gpuix/react";

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

function terminalNotification(title: string, body: string): boolean {
  switch (terminalKind()) {
    case "kitty": {
      // https://sw.kovidgoyal.net/kitty/desktop-notifications/: title then body, d=0 until the last part.
      const id = nextKittyId++;
      return writeTty(`\x1b]99;i=${id}:d=0:p=title;${sanitize(title)}\x1b\\\x1b]99;i=${id}:d=1:p=body;${sanitize(body)}\x1b\\`);
    }
    case "ghostty":
      return writeTty(`\x1b]777;notify;${sanitize(title)};${sanitize(body)}\x07`);
    default:
      // OSC 9 is the widest-supported fallback (iTerm2, WezTerm, Windows Terminal, Ghostty).
      return writeTty(`\x1b]9;${sanitize(`${title}: ${body}`)}\x07`);
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

function nativeNotification(title: string, body: string): void {
  switch (process.platform) {
    case "darwin":
      spawnQuiet([
        "osascript",
        "-e",
        `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`,
      ]);
      return;
    case "win32":
      // A toast through the WinRT API, attributed to PowerShell's registered AppID.
      spawnQuiet([
        "powershell.exe",
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        [
          "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
          "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
          `$xml.GetElementsByTagName('text').Item(0).AppendChild($xml.CreateTextNode(${powershellString(title)})) | Out-Null`,
          `$xml.GetElementsByTagName('text').Item(1).AppendChild($xml.CreateTextNode(${powershellString(body)})) | Out-Null`,
          "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
          "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))",
        ].join("; "),
      ]);
      return;
    default:
      spawnQuiet(["notify-send", "--app-name=T3 Code", title, body]);
  }
}

/** Raises a desktop notification. Returns false when nothing could show it. */
export function showDesktopNotification(title: string, body: string): void {
  if (isTerminal() && terminalNotification(title, body)) return;
  nativeNotification(title, body);
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

let lastInputAt = Date.now();

/** Any key or pointer movement in t3-term. gpuix exposes no window-focus state, so recent input stands in for it. */
export function noteUserInput(): void {
  lastInputAt = Date.now();
}

const PRESENCE_WINDOW_MS = 10_000;

/** Whether the user is likely looking at t3-term right now. */
export function userIsPresent(): boolean {
  return Date.now() - lastInputAt < PRESENCE_WINDOW_MS;
}
