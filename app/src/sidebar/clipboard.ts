// gpuix has no JS clipboard API (copy works only through text selection), so
// copy actions hand the text to the platform's clipboard tool.
export async function writeClipboardText(text: string): Promise<void> {
  const command =
    process.platform === "win32"
      ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "$input | Set-Clipboard"]
      : process.platform === "darwin"
        ? ["pbcopy"]
        : process.env.WAYLAND_DISPLAY
          ? ["wl-copy"]
          : ["xclip", "-selection", "clipboard"];
  const child = Bun.spawn(command, { stdin: "pipe", stdout: "ignore", stderr: "pipe" });
  child.stdin.write(text);
  await child.stdin.end();
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(child.stderr).text();
    throw new Error(stderr.trim() || `${command[0]} exited with ${exitCode}`);
  }
}
