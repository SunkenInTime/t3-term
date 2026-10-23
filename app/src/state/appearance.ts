// Appearance mode (System / Light / Dark) and the theme picked for each half,
// as the command palette and the appearance.cycle shortcut see them. The single
// source of truth is the client settings store (state/clientSettings.ts, saved
// in $T3TERM_HOME/client-settings.json), which the Appearance settings page
// also writes; this module only adapts its shape for the palette.
import type { ThemeAppearance } from "@t3tools/shared/themePalettes";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  activePaletteAtom,
  resolveActiveThemeId,
  resolveThemeAppearance,
  setAppearanceMode as setStoreAppearanceMode,
  setThemePreference,
  setThemeHalf as setStoreThemeHalf,
  setThemeState,
  systemDarkAtom,
  themeStateAtom,
} from "./clientSettings.ts";

export type AppearanceMode = "system" | "light" | "dark";

/** Theme id per half; null is the standard T3 Code palette. */
export interface ThemeHalves {
  readonly light: string | null;
  readonly dark: string | null;
}

export const appearanceModeAtom = Atom.make((get): AppearanceMode => get(themeStateAtom).appearanceMode).pipe(Atom.keepAlive);

export const themeHalvesAtom = Atom.make((get): ThemeHalves => {
  const state = get(themeStateAtom);
  return { light: resolveActiveThemeId(state, "light"), dark: resolveActiveThemeId(state, "dark") };
}).pipe(Atom.keepAlive);

export const resolvedAppearanceAtom = Atom.make((get): ThemeAppearance =>
  resolveThemeAppearance(get(themeStateAtom), get(systemDarkAtom)),
).pipe(Atom.keepAlive);

/** The palette App provides through ThemeContext. */
export const resolvedPaletteAtom = activePaletteAtom;

/** Writes are queued to disk by the store; the boolean keeps the palette's failure-toast contract. */
export function setAppearanceMode(mode: AppearanceMode): boolean {
  setStoreAppearanceMode(mode);
  return true;
}

/** setTheme: a theme id for both halves, or an appearance keyword resetting both to standard. */
export function setTheme(next: string | AppearanceMode): boolean {
  if (next === "system" || next === "light" || next === "dark") {
    setThemeState(() => ({ theme: "system", appearanceMode: next, halves: null }));
  } else {
    setThemePreference(next);
  }
  return true;
}

export function setThemeHalf(appearance: ThemeAppearance, themeId: string | null): boolean {
  setStoreThemeHalf(appearance, themeId ?? "t3-code");
  return true;
}

/** appearance.cycle: system → light → dark → system. */
export function cycleAppearanceMode(): AppearanceMode {
  const current = appAtomRegistry.get(appearanceModeAtom);
  const next: AppearanceMode = current === "system" ? "light" : current === "light" ? "dark" : "system";
  setAppearanceMode(next);
  return next;
}
