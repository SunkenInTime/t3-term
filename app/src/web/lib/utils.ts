// Pure helpers from apps/web/src/lib/utils.ts (no Tailwind/cn).
import { isMacPlatform } from "@t3tools/shared/keybindings";

export { isMacPlatform };

export function isWindowsPlatform(platform: string): boolean {
  return /^win(dows)?/i.test(platform);
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** `navigator.platform` equivalent for Bun. */
export const PLATFORM =
  process.platform === "darwin" ? "MacIntel" : process.platform === "win32" ? "Win32" : "Linux x86_64";
