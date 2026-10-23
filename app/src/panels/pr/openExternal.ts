// Opens a URL in the OS browser. t3-term is a native process, so it can spawn the
// platform opener directly where the web app asks its desktop bridge.
export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    const command =
      process.platform === "win32"
        ? ["cmd", "/c", "start", "", url.replaceAll("&", "^&")]
        : process.platform === "darwin"
          ? ["open", url]
          : ["xdg-open", url];
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    child.unref();
  } catch (error) {
    console.warn("Could not open the link in a browser.", error);
  }
}
