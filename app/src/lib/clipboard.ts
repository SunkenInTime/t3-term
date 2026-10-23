// gpuix has no clipboard API. In terminal mode the terminal owns the system
// clipboard, so we ask it with OSC 52 (kitty and Ghostty honor it, also over
// SSH). In a native window we hand the text to the OS clipboard tool.
import * as NodeFS from "node:fs";

import { isTerminal } from "@gpuix/react";

function writeOsc52(text: string): boolean {
  if (process.platform === "win32") return false;
  try {
    // gpuix redirects fd 1 and 2 while it runs, so write to the tty itself.
    const fd = NodeFS.openSync("/dev/tty", "w");
    try {
      NodeFS.writeSync(fd, `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
    } finally {
      NodeFS.closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

function clipboardCommands(): ReadonlyArray<ReadonlyArray<string>> {
  switch (process.platform) {
    case "win32":
      // clip.exe reads the console code page; PowerShell keeps Unicode intact.
      return [
        [
          "powershell.exe",
          "-NoProfile",
          "-Command",
          "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ],
        ["clip.exe"],
      ];
    case "darwin":
      return [["pbcopy"]];
    default:
      return [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
  }
}

async function writeWithTool(text: string): Promise<boolean> {
  for (const command of clipboardCommands()) {
    if (Bun.which(command[0]!) === null) continue;
    try {
      const proc = Bun.spawn([...command], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      proc.stdin.write(text);
      await proc.stdin.end();
      if ((await proc.exited) === 0) return true;
    } catch {
      // Try the next tool.
    }
  }
  return false;
}

/** Copies `text` to the system clipboard. Resolves false when nothing could take it. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (isTerminal() && writeOsc52(text)) return true;
  return writeWithTool(text);
}
