// The font families on this machine, for the Typography family pickers.
//
// Web asks the browser (window.queryLocalFonts, apps/web/src/appearanceFonts.ts
// queryInstalledFontFamilies). gpuix has no font list API (only
// renderer.registerFont, which t3-term doesn't call), and GPUI draws any family
// the OS has installed, so t3-term asks the OS once per run:
//   Windows: PowerShell, WPF's Fonts.SystemFontFamilies: typographic families
//            ("Cascadia Code", not GDI's per-weight "Cascadia Code Light"), the
//            names DirectWrite resolves and Chrome's queryLocalFonts reports.
//   macOS:   JavaScript for Automation, NSFontManager.availableFontFamilies.
//   Linux:   fontconfig, `fc-list : family`.
// The list is cached; a failure or an empty list leaves the plain text input, as
// web does when the browser denies enumeration.
import { execFile } from "node:child_process";
import { useEffect, useSyncExternalStore } from "react";

export type FontEnumerationState =
  | { readonly status: "unknown" }
  | { readonly status: "granted"; readonly families: readonly string[] }
  | { readonly status: "unavailable" };

let state: FontEnumerationState = { status: "unknown" };
let loading = false;
const listeners = new Set<() => void>();

function command(): readonly [string, readonly string[]] | null {
  switch (process.platform) {
    case "win32":
      return [
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Add-Type -AssemblyName PresentationCore; [Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source }",
        ],
      ];
    case "darwin":
      return [
        "osascript",
        ["-l", "JavaScript", "-e", 'ObjC.import("AppKit"); ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies).join("\\n")'],
      ];
    default:
      return ["fc-list", [": family"]];
  }
}

/** One family per line; fontconfig lists aliases comma-separated on one line. */
export function parseFamilies(output: string): string[] {
  const families = output
    .split(/\r?\n/)
    .flatMap((line) => line.split(","))
    .map((family) => family.trim())
    // Dot-prefixed families are macOS-internal UI faces (web filters them too).
    .filter((family) => family.length > 0 && !family.startsWith("."));
  return [...new Set(families)].sort((left, right) => left.localeCompare(right));
}

export function discoverInstalledFonts(): void {
  if (state.status !== "unknown" || loading) return;
  const invocation = command();
  if (invocation === null) {
    state = { status: "unavailable" };
    return;
  }
  loading = true;
  execFile(invocation[0], [...invocation[1]], { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
    loading = false;
    const families = error ? [] : parseFamilies(String(stdout));
    // No machine has zero fonts, so an empty list means enumeration failed.
    state = families.length > 0 ? { status: "granted", families } : { status: "unavailable" };
    for (const listener of listeners) listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starts enumeration on first use; nothing to grant, unlike the browser. */
export function useFontEnumeration(): FontEnumerationState {
  useEffect(discoverInstalledFonts, []);
  return useSyncExternalStore(subscribe, () => state);
}
