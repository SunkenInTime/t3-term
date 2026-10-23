// gpuix has no JS clipboard API, so copying goes through the OS. Over SSH in
// terminal mode the local clipboard is the remote one; OSC 52 asks the user's
// terminal to set its clipboard instead.
import { isTerminal } from "@gpuix/react";

async function pipeTo(command: string[], input: Uint8Array): Promise<boolean> {
  try {
    const proc = Bun.spawn(command, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    proc.stdin.write(input);
    await proc.stdin.end();
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

function utf16le(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  return bytes;
}

export async function writeTextToClipboard(text: string): Promise<boolean> {
  if (isTerminal() && process.env.SSH_CONNECTION) {
    process.stdout.write(`\u001b]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`);
    return true;
  }
  const utf8 = new TextEncoder().encode(text);
  switch (process.platform) {
    case "win32":
      // clip.exe takes UTF-16LE as is; a byte order mark would be copied too.
      return pipeTo(["clip.exe"], utf16le(text));
    case "darwin":
      return pipeTo(["pbcopy"], utf8);
    default:
      return (
        (await pipeTo(["wl-copy"], utf8)) ||
        (await pipeTo(["xclip", "-selection", "clipboard"], utf8)) ||
        pipeTo(["xsel", "--clipboard", "--input"], utf8)
      );
  }
}
