// Clipboard contents that are not text: copied files and pictures (a screenshot), for the
// composer's paste (web onComposerPaste → splitTransferredFiles → addComposerAttachments).
// gpuix has no clipboard read for JS and its text fields paste text only, so this asks the
// platform: PowerShell's Windows.Forms clipboard, osascript, or wl-paste / xclip.
import { spawn } from "node:child_process";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import { termHome } from "../../runtime/paths.ts";

function run(command: string, args: ReadonlyArray<string>, env?: Record<string, string>): Promise<{ code: number; stdout: Buffer }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, [...args], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: env ? { ...process.env, ...env } : process.env,
      });
    } catch {
      resolve({ code: -1, stdout: Buffer.alloc(0) });
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolve({ code: -1, stdout: Buffer.alloc(0) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout: Buffer.concat(chunks) }));
  });
}

/** A fresh folder per paste: the draft keeps the path until the message is sent. */
function pasteTarget(name: string): string {
  const dir = NodePath.join(termHome(), "pasted", globalThis.crypto.randomUUID());
  NodeFs.mkdirSync(dir, { recursive: true });
  return NodePath.join(dir, name);
}

/** Browsers name a pasted picture image.png; so does web's composer. */
const PASTED_IMAGE_NAME = "image.png";

// -STA: the Windows.Forms clipboard needs a single-threaded apartment.
const WINDOWS_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "$files = [Windows.Forms.Clipboard]::GetFileDropList()",
  "if ($files -and $files.Count -gt 0) { foreach ($file in $files) { [Console]::Out.WriteLine('F:' + $file) }; exit 0 }",
  "$image = [Windows.Forms.Clipboard]::GetImage()",
  "if ($image) { $image.Save($env:T3TERM_PASTE_OUT, [Drawing.Imaging.ImageFormat]::Png); [Console]::Out.WriteLine('I:' + $env:T3TERM_PASTE_OUT) }",
].join("; ");

async function readWindows(): Promise<string[]> {
  const out = pasteTarget(PASTED_IMAGE_NAME);
  const result = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${WINDOWS_SCRIPT}`],
    { T3TERM_PASTE_OUT: out },
  );
  const lines = result.stdout.toString("utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.some((line) => line.startsWith("I:"))) NodeFs.rmSync(NodePath.dirname(out), { recursive: true, force: true });
  return lines.map((line) => line.slice(2));
}

async function readMac(): Promise<string[]> {
  const out = pasteTarget(PASTED_IMAGE_NAME);
  const script = [
    `set target to POSIX file ${JSON.stringify(out)}`,
    "set png to (the clipboard as «class PNGf»)",
    "set handle to open for access target with write permission",
    "write png to handle",
    "close access handle",
  ];
  const result = await run("osascript", script.flatMap((line) => ["-e", line]));
  if (result.code === 0 && NodeFs.existsSync(out) && NodeFs.statSync(out).size > 0) return [out];
  NodeFs.rmSync(NodePath.dirname(out), { recursive: true, force: true });
  return [];
}

function filesFromUriList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("file://"))
    .map((line) => decodeURIComponent(new URL(line).pathname));
}

async function readLinux(): Promise<string[]> {
  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  const types = wayland
    ? await run("wl-paste", ["--list-types"])
    : await run("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"]);
  if (types.code !== 0) return [];
  const available = types.stdout.toString("utf8").split(/\r?\n/);
  if (available.includes("text/uri-list")) {
    const list = wayland
      ? await run("wl-paste", ["--type", "text/uri-list"])
      : await run("xclip", ["-selection", "clipboard", "-t", "text/uri-list", "-o"]);
    const files = filesFromUriList(list.stdout.toString("utf8"));
    if (files.length > 0) return files;
  }
  if (!available.includes("image/png")) return [];
  const image = wayland
    ? await run("wl-paste", ["--type", "image/png"])
    : await run("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
  if (image.code !== 0 || image.stdout.length === 0) return [];
  const out = pasteTarget(PASTED_IMAGE_NAME);
  NodeFs.writeFileSync(out, image.stdout);
  return [out];
}

/**
 * Paths of the files on the clipboard, or of a picture on it saved as a PNG under
 * $T3TERM_HOME/pasted. Empty when the clipboard holds neither.
 */
export async function readClipboardAttachmentPaths(options?: { readonly imagesOnly?: boolean }): Promise<string[]> {
  let paths: string[];
  try {
    switch (process.platform) {
      case "win32":
        paths = await readWindows();
        break;
      case "darwin":
        paths = await readMac();
        break;
      default:
        paths = await readLinux();
    }
  } catch {
    return [];
  }
  // web shouldHandleComposerAttachmentPaste: next to text, only a picture (or copied files
  // that include one) beats the text; other copied files leave the text paste alone.
  if (options?.imagesOnly && !paths.some((path) => IMAGE_EXTENSION.test(path))) return [];
  return paths;
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i;

/** Writes pasted text that is too long for the prompt into a file to attach (web foldPastedText). */
export function writePastedTextFile(name: string, text: string): string {
  const out = pasteTarget(name);
  NodeFs.writeFileSync(out, text, "utf8");
  return out;
}
