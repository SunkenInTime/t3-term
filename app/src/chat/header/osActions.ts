// OS helpers the header and details card need and gpuix does not provide: gpuix
// has no JS clipboard API (copy only works through text selection) and no URL
// or editor-link opener. t3-term is a native process, so it shells out.
import { spawn } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

function runWithInput(command: string, args: string[], input: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
    child.stdin.end(input);
  });
}

/** Terminal mode (kitty/Ghostty, also over SSH) copies through OSC 52 on the controlling tty. */
function writeOsc52(text: string): boolean {
  if (process.platform === "win32") return false;
  try {
    const fd = openSync("/dev/tty", "w");
    try {
      writeSync(fd, `\u001b]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (process.env.GPUIX_TERMINAL === "1" && writeOsc52(text)) return;
  switch (process.platform) {
    case "win32": {
      // clip.exe keeps a UTF-16 BOM as a character and mangles non-ASCII without one,
      // so the text goes to Set-Clipboard as base64 and is decoded there.
      const encoded = Buffer.from(text, "utf8").toString("base64");
      return runWithInput(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))`],
        Buffer.alloc(0),
      );
    }
    case "darwin":
      return runWithInput("pbcopy", [], Buffer.from(text, "utf8"));
    default:
      try {
        return await runWithInput("wl-copy", [], Buffer.from(text, "utf8"));
      } catch {
        try {
          return await runWithInput("xclip", ["-selection", "clipboard"], Buffer.from(text, "utf8"));
        } catch {
          if (writeOsc52(text)) return;
          throw new Error("No clipboard tool found (install wl-clipboard or xclip).");
        }
      }
  }
}

/**
 * Opens a web URL or an editor deep link (vscode://, cursor://, zed://, jetbrains://)
 * with the OS handler. Returns false when the scheme is not one we hand to the OS.
 */
export function openWithOs(url: string): boolean {
  if (!/^(https?|mailto|vscode|vscode-insiders|vscodium|cursor|windsurf|zed|trae|kiro|antigravity|jetbrains):/i.test(url)) {
    return false;
  }
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command as string, args as string[], { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
