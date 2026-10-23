// Web opens links through the desktop bridge (localApi.shell.openExternal);
// t3-term hands the URL to the OS opener.
export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//.test(url)) return;
  const command =
    process.platform === "win32"
      ? ["rundll32", "url.dll,FileProtocolHandler", url]
      : process.platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  } catch (error) {
    console.error("Could not open link.", error);
  }
}
