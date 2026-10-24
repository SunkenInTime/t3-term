// macOS: a notification whose click reaches t3-term.
//
// osascript's `display notification` has no click callback, no handle and
// belongs to Script Editor, so a click opens Script Editor. terminal-notifier
// (Homebrew) posts as its own app and, on a click, runs the shell command
// given with -execute and activates the app given with -activate. t3-term gives
// it a command that touches a file named for the notification in a private
// directory, and watches for that file while notifications are outstanding.
// Each notification gets its own -group, so close() can take exactly that one
// back with -remove (the coordinator closes the old one before showing its
// replacement). terminal-notifier returns once the notification is posted, so
// a dismissal is never reported.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export interface MacNotifierInput {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  /** In terminal mode, the terminal app to bring forward on a click (its bundle id). */
  readonly activateBundleId?: string | undefined;
  readonly onActivate: () => void;
}

export interface MacNotifierHandle {
  close(): void;
}

/** POSIX sh single quoting. */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** terminal-notifier groups are global to the user; the pid keeps two t3-terms apart. */
export function terminalNotifierGroup(tag: string, id: number, pid = process.pid): string {
  return `t3-term:${pid}:${id}:${tag}`;
}

/** The command line that posts one notification. */
export function terminalNotifierArgs(input: {
  readonly binary: string;
  readonly title: string;
  readonly body: string;
  readonly group: string;
  readonly clickFile: string;
  readonly activateBundleId?: string | undefined;
}): string[] {
  return [
    input.binary,
    "-title",
    input.title,
    // An empty -message makes terminal-notifier wait for the message on stdin.
    "-message",
    input.body.length > 0 ? input.body : input.title,
    "-group",
    input.group,
    "-execute",
    `/usr/bin/touch ${shellQuote(input.clickFile)}`,
    ...(input.activateBundleId ? ["-activate", input.activateBundleId] : []),
  ];
}

let clickDirectory: string | null = null;
let nextId = 1;
const outstanding = new Map<string, { file: string; onActivate: () => void }>();
let poll: ReturnType<typeof setInterval> | null = null;

function ensureClickDirectory(): string {
  if (clickDirectory !== null) return clickDirectory;
  clickDirectory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3term-notify-"));
  const directory = clickDirectory;
  process.once("exit", () => {
    // Like the Windows toasts: nothing is left behind that could no longer reopen a thread.
    const binary = Bun.which("terminal-notifier");
    for (const group of outstanding.keys()) {
      if (binary === null) break;
      try {
        Bun.spawnSync([binary, "-remove", group], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      } catch {
        // The notification stays; clicking it only touches a file that is gone.
      }
    }
    try {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    } catch {
      // A leftover temp directory only costs a few bytes.
    }
  });
  return directory;
}

/** Runs only while a notification is outstanding; a click shows up within half a second. */
function checkClicks(): void {
  for (const [group, entry] of outstanding) {
    if (!NodeFS.existsSync(entry.file)) continue;
    outstanding.delete(group);
    try {
      NodeFS.rmSync(entry.file, { force: true });
    } catch {
      // Gone already.
    }
    entry.onActivate();
  }
  if (outstanding.size === 0 && poll !== null) {
    clearInterval(poll);
    poll = null;
  }
}

function spawnDetached(argv: string[]): boolean {
  try {
    Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Null when terminal-notifier is not installed or could not start. */
export function showMacNotification(input: MacNotifierInput): MacNotifierHandle | null {
  const binary = Bun.which("terminal-notifier");
  if (binary === null) return null;
  let directory: string;
  try {
    directory = ensureClickDirectory();
  } catch {
    return null;
  }
  const id = nextId++;
  const group = terminalNotifierGroup(input.tag, id);
  const file = NodePath.join(directory, `click-${id}`);
  const argv = terminalNotifierArgs({
    binary,
    title: input.title,
    body: input.body,
    group,
    clickFile: file,
    activateBundleId: input.activateBundleId,
  });
  if (!spawnDetached(argv)) return null;
  outstanding.set(group, { file, onActivate: input.onActivate });
  poll ??= setInterval(checkClicks, 500);
  return {
    close() {
      if (outstanding.get(group)?.file !== file) return;
      outstanding.delete(group);
      spawnDetached([binary, "-remove", group]);
      checkClicks();
    },
  };
}
