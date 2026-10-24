// Windows native window: a toast that can bring t3-term back to its thread.
//
// Web gets a Notification object with a click event and close(). The WinRT
// toast API gives the same to the process that showed the toast, as long as it
// stays alive, so each outstanding notification keeps one hidden PowerShell
// "waiter" running: it shows the toast with a Tag/Group, listens for the
// toast's Activated event, and prints `activated` when the user clicks it.
// t3-term closes it by writing `close` to its stdin; the waiter then removes
// its toast from Action Center and exits.
//
// Bun (libuv) puts children in a kill-on-close job, so the waiters die the
// moment t3-term does, before they can clean up, and Bun drops the pipes of a
// detached child. So t3-term removes its outstanding toasts itself on a normal
// exit, and every new waiter first removes t3-term toasts whose owning process
// (the pid in the tag) is gone, which covers a crash or a kill.
//
// Windows raises Activated only for a click on the banner. A click on the same
// toast in the notification center does nothing for an app with no COM
// activator (checked on Windows 11 with Do Not Disturb on, where banners never
// show), so with banners off a notification cannot bring t3-term back; coming
// back to t3-term still closes it.
import type { Subprocess } from "bun";

/** PowerShell's registered AppUserModelID, which every unpackaged script toast borrows. */
const POWERSHELL_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
/** Toasts the user ignores stay in Action Center; a waiter gives up and removes its toast after this. */
export const WAITER_LIFETIME_MINUTES = 30;
const GROUP = "t3-term";

function xmlText(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * ToastGeneric with silent audio: web shows its Notification with
 * `silent: true` and plays T3's own sound when the user wants one.
 * T3TERM_DEV_TOAST_SCENARIO=alarm (dev only) shows it as an alarm, the one kind
 * Do Not Disturb still shows as a banner, so the click path can be tested on a
 * machine with banners off; an alarm needs a button.
 */
function toastXml(title: string, body: string): string {
  const alarm = process.env.T3TERM_DEV_TOAST_SCENARIO?.trim() === "alarm";
  return [
    alarm ? '<toast scenario="alarm">' : "<toast>",
    `<visual><binding template="ToastGeneric"><text>${xmlText(title)}</text><text>${xmlText(body)}</text></binding></visual>`,
    alarm ? '<actions><action content="Open" arguments="open" activationType="foreground"/></actions>' : "",
    '<audio silent="true"/>',
    "</toast>",
  ].join("");
}

function psString(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** Action Center keys toasts by tag + group; tags are limited to 64 characters. The pid marks the owner. */
function toastTag(tag: string): string {
  let hash = 0;
  for (const char of tag) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return `t3-${(hash >>> 0).toString(36)}-${process.pid}`;
}

/** Removes t3-term toasts left behind by a t3-term that is no longer running. */
const SWEEP_STALE = [
  "foreach ($old in @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($app))) {",
  "  if ($old.Group -ne $group -or $old.Tag -notmatch '-([0-9]+)$') { continue }",
  "  if (-not (Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue)) { try { [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($old.Tag, $group, $app) } catch {} }",
  "}",
];

// Windows PowerShell cannot subscribe to WinRT events (Register-ObjectEvent
// refuses them), Add-Type cannot reference the WinRT metadata, and a script
// block handler would run on a thread with no runspace. The handlers are built
// as expression trees instead: compiled delegates that only signal a wait
// handle, which the script polls. A toast that times out moves to Action
// Center, so only the user closing it (UserCanceled) counts as dismissed.
const HANDLERS = [
  "$E = [System.Linq.Expressions.Expression]",
  "$activated = New-Object System.Threading.ManualResetEvent $false",
  "$dismissed = New-Object System.Threading.ManualResetEvent $false",
  "$set = [System.Threading.EventWaitHandle].GetMethod('Set')",
  "$sender = $E::Parameter([Windows.UI.Notifications.ToastNotification], 'sender')",
  "$any = $E::Parameter([object], 'args')",
  "$onActivated = $E::Lambda([Windows.Foundation.TypedEventHandler[Windows.UI.Notifications.ToastNotification, object]], $E::Call($E::Constant($activated), $set), [System.Linq.Expressions.ParameterExpression[]]@($sender, $any)).Compile()",
  "$reason = $E::Parameter([Windows.UI.Notifications.ToastDismissedEventArgs], 'args')",
  "$userCanceled = $E::Equal($E::Property($reason, 'Reason'), $E::Constant([Windows.UI.Notifications.ToastDismissalReason]::UserCanceled))",
  "$onDismissed = $E::Lambda([Windows.Foundation.TypedEventHandler[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications.ToastDismissedEventArgs]], $E::IfThen($userCanceled, $E::Call($E::Constant($dismissed), $set)), [System.Linq.Expressions.ParameterExpression[]]@($sender, $reason)).Compile()",
  "$toast.add_Activated($onActivated) | Out-Null",
  "$toast.add_Dismissed($onDismissed) | Out-Null",
];

export function waiterScript(input: { title: string; body: string; tag: string; lifetimeMinutes?: number }): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    `$app = ${psString(POWERSHELL_APP_ID)}`,
    `$tag = ${psString(input.tag)}`,
    `$group = ${psString(GROUP)}`,
    ...SWEEP_STALE,
    "$xml = [Windows.Data.Xml.Dom.XmlDocument]::new()",
    `$xml.LoadXml(${psString(toastXml(input.title, input.body))})`,
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    "$toast.Tag = $tag",
    "$toast.Group = $group",
    ...HANDLERS,
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)",
    "[Console]::Out.WriteLine('shown'); [Console]::Out.Flush()",
    // Console.In.ReadLineAsync is synchronous on .NET Framework; a raw stream read is not.
    "$stdin = [Console]::OpenStandardInput()",
    "$buffer = New-Object byte[] 256",
    "$read = $stdin.ReadAsync($buffer, 0, 256)",
    `$deadline = (Get-Date).AddMinutes(${input.lifetimeMinutes ?? WAITER_LIFETIME_MINUTES})`,
    "try {",
    "  while ((Get-Date) -lt $deadline) {",
    "    $signalled = [System.Threading.WaitHandle]::WaitAny([System.Threading.WaitHandle[]]@($activated, $dismissed), 250)",
    "    if ($signalled -eq 0) { [Console]::Out.WriteLine('activated'); [Console]::Out.Flush(); break }",
    "    if ($signalled -eq 1) { [Console]::Out.WriteLine('dismissed'); [Console]::Out.Flush(); break }",
    "    if ($read.IsCompleted) {",
    "      if ($read.IsFaulted -or $read.Result -le 0) { break }",
    "      if ([Text.Encoding]::UTF8.GetString($buffer, 0, $read.Result) -match 'close') { break }",
    "      $read = $stdin.ReadAsync($buffer, 0, 256)",
    "    }",
    "  }",
    "} finally {",
    "  try { [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($tag, $group, $app) } catch {}",
    "}",
  ].join("\n");
}

const outstandingTags = new Set<string>();
let exitHookInstalled = false;

/** On a normal exit the waiters are killed with t3-term, so their toasts are removed here. */
function removeOnExit(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    if (outstandingTags.size === 0) return;
    const removals = [...outstandingTags].map(
      (tag) => `try { [Windows.UI.Notifications.ToastNotificationManager]::History.Remove(${psString(tag)}, ${psString(GROUP)}, ${psString(POWERSHELL_APP_ID)}) } catch {}`,
    );
    try {
      Bun.spawnSync(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          ["[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null", ...removals].join("; "),
        ],
        { stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true },
      );
    } catch {
      // The next waiter sweeps them.
    }
  });
}

export interface WindowsToastHandle {
  close(): void;
}

/**
 * Shows a toast and keeps a waiter for it. `onActivate` runs when the user
 * clicks it; `onGone` when the waiter exits for any reason (clicked, closed,
 * dismissed, timed out, failed).
 */
export function showWindowsToast(input: {
  title: string;
  body: string;
  tag: string;
  onActivate: () => void;
  onGone: () => void;
}): WindowsToastHandle | null {
  const tag = toastTag(input.tag);
  const script = waiterScript({ title: input.title, body: input.body, tag });
  let child: Subprocess<"pipe", "pipe", "ignore">;
  try {
    child = Bun.spawn(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { stdin: "pipe", stdout: "pipe", stderr: "ignore", windowsHide: true },
    );
  } catch {
    return null;
  }
  outstandingTags.add(tag);
  removeOnExit();
  let closed = false;
  void (async () => {
    const decoder = new TextDecoder();
    let pending = "";
    try {
      for await (const chunk of child.stdout) {
        pending += decoder.decode(chunk, { stream: true });
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (line === "activated" && !closed) input.onActivate();
          newline = pending.indexOf("\n");
        }
      }
    } catch {
      // The waiter went away; onGone below still runs.
    }
    await child.exited.catch(() => undefined);
    outstandingTags.delete(tag);
    closed = true;
    input.onGone();
  })();
  return {
    close() {
      if (closed) return;
      closed = true;
      try {
        child.stdin.write("close\n");
        child.stdin.end();
      } catch {
        // Already exiting.
      }
    },
  };
}
