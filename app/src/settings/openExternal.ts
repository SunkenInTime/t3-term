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
