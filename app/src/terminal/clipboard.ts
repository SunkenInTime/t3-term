// System clipboard through the platform's own tools. gpuix exposes no JS
// clipboard API (native text selection copies on its own), and a terminal
// needs to paste into a PTY, which no native input does for it.
import { spawn } from "node:child_process";

function run(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} exited with ${code}`))));
    child.stdin.end(input ?? "");
  });
}

const POWERSHELL = ["-NoProfile", "-NonInteractive", "-Command"];

export async function readClipboardText(): Promise<string> {
  switch (process.platform) {
    case "win32":
      return (await run("powershell.exe", [...POWERSHELL, "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw"])).replace(
        /\r?\n$/,
        "",
      );
    case "darwin":
      return run("pbpaste", []);
    default:
      return run("wl-paste", ["--no-newline"]).catch(() => run("xclip", ["-selection", "clipboard", "-o"]));
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  switch (process.platform) {
    case "win32":
      await run(
        "powershell.exe",
        [...POWERSHELL, "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
        text,
      );
      return;
    case "darwin":
      await run("pbcopy", [], text);
      return;
    default:
      await run("wl-copy", [], text).catch(() => run("xclip", ["-selection", "clipboard"], text));
  }
}

/** Opens a URL in the system browser (the web client offers its preview browser first). */
export async function openExternalUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) links open from the terminal.");
  switch (process.platform) {
    case "win32":
      await run("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
      return;
    case "darwin":
      await run("open", [url]);
      return;
    default:
      await run("xdg-open", [url]);
  }
}
