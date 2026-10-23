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

function utf16leWithBom(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[2 + index * 2] = code & 0xff;
    bytes[3 + index * 2] = code >> 8;
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
      // clip.exe reads UTF-16 when the input starts with a byte order mark.
      return pipeTo(["clip.exe"], utf16leWithBom(text));
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
