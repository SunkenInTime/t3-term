// Opens a URL in the system browser (web: <a target="_blank">).
import * as NodeChildProcess from "node:child_process";

export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    NodeChildProcess.spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch (error) {
    console.error("[SETTINGS] could not open", url, error);
  }
}

/**
 * gpuix has no clipboard API for JS, so "Copy" buttons hand the text to the
 * OS clipboard tool (clip, pbcopy, wl-copy/xclip).
 */
export function copyText(text: string): boolean {
  const candidates: ReadonlyArray<readonly [string, ReadonlyArray<string>]> =
    process.platform === "win32"
      ? [["clip", []]]
      : process.platform === "darwin"
        ? [["pbcopy", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
          ];
  for (const [command, args] of candidates) {
    try {
      const result = NodeChildProcess.spawnSync(command, args, { input: text, windowsHide: true });
      if (result.status === 0) return true;
    } catch {}
  }
  return false;
}
