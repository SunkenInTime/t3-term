// OS helpers the timeline needs and gpuix does not provide: copying goes
// through the shared lib/clipboard.ts, and links open in the system browser.
import { spawn } from "node:child_process";

import { copyToClipboard } from "../../lib/clipboard.ts";

/** Rejects when no clipboard path took the text, so callers can surface an error. */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (!(await copyToClipboard(text))) throw new Error("The clipboard is unavailable.");
}

export function openExternalUrl(url: string): void {
  if (!/^(https?|mailto):/i.test(url)) return;
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command as string, args as string[], { stdio: "ignore", detached: true, windowsHide: true });
  child.on("error", () => {});
  child.unref();
}
