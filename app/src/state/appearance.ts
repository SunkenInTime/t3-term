// Appearance mode (System / Light / Dark) and the theme picked for each half,
// after apps/web/src/hooks/useTheme.ts. Web keeps these in localStorage; t3-term
// keeps them in $T3TERM_HOME/appearance.json. The palette's Change theme /
// Change appearance actions and appearance.cycle write here; App reads
// resolvedPaletteAtom.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILT_IN_THEMES,
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeColors,
} from "@t3tools/shared/themePalettes";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { termHome } from "../runtime/paths.ts";
import { DARK, LIGHT, type Palette } from "../ui/theme.ts";

export type AppearanceMode = "system" | "light" | "dark";

/** Theme id per half; null is the standard T3 Code palette. */
export interface ThemeHalves {
  readonly light: string | null;
  readonly dark: string | null;
}

interface StoredAppearance {
  readonly mode: AppearanceMode;
  readonly halves: ThemeHalves;
}

const DEFAULT_APPEARANCE: StoredAppearance = { mode: "system", halves: { light: null, dark: null } };

function storePath(): string {
  return join(termHome(), "appearance.json");
}

function load(): StoredAppearance {
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf8")) as Partial<StoredAppearance>;
    const mode = raw.mode === "light" || raw.mode === "dark" || raw.mode === "system" ? raw.mode : "system";
    return {
      mode,
      halves: {
        light: typeof raw.halves?.light === "string" ? raw.halves.light : null,
        dark: typeof raw.halves?.dark === "string" ? raw.halves.dark : null,
      },
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function save(value: StoredAppearance): boolean {
  try {
    mkdirSync(termHome(), { recursive: true });
    writeFileSync(storePath(), JSON.stringify(value, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** The OS appearance, read once. GPUI does not report it, so ask the OS. */
function detectSystemAppearance(): ThemeAppearance {
  try {
    if (process.platform === "win32") {
      const out = Bun.spawnSync([
        "reg",
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        "/v",
        "AppsUseLightTheme",
      ]).stdout.toString();
      return /AppsUseLightTheme\s+REG_DWORD\s+0x1\b/.test(out) ? "light" : "dark";
    }
    if (process.platform === "darwin") {
      const out = Bun.spawnSync(["defaults", "read", "-g", "AppleInterfaceStyle"]).stdout.toString();
      return out.trim() === "Dark" ? "dark" : "light";
    }
  } catch {}
  return "dark";
}

const initial = load();
const systemAppearance = detectSystemAppearance();

export const appearanceModeAtom = Atom.make<AppearanceMode>(initial.mode).pipe(Atom.keepAlive);
export const themeHalvesAtom = Atom.make<ThemeHalves>(initial.halves).pipe(Atom.keepAlive);

export const resolvedAppearanceAtom = Atom.make((get): ThemeAppearance => {
  const mode = get(appearanceModeAtom);
  return mode === "system" ? systemAppearance : mode;
}).pipe(Atom.keepAlive);

function persist(): boolean {
  return save({ mode: appAtomRegistry.get(appearanceModeAtom), halves: appAtomRegistry.get(themeHalvesAtom) });
}

export function setAppearanceMode(mode: AppearanceMode): boolean {
  appAtomRegistry.set(appearanceModeAtom, mode);
  return persist();
}

/** setTheme: a theme id for both halves, or an appearance keyword resetting both to standard. */
export function setTheme(next: string | AppearanceMode): boolean {
  if (next === "system" || next === "light" || next === "dark") {
    appAtomRegistry.set(themeHalvesAtom, { light: null, dark: null });
    appAtomRegistry.set(appearanceModeAtom, next);
  } else {
    appAtomRegistry.set(themeHalvesAtom, { light: next, dark: next });
  }
  return persist();
}

export function setThemeHalf(appearance: ThemeAppearance, themeId: string | null): boolean {
  appAtomRegistry.set(themeHalvesAtom, { ...appAtomRegistry.get(themeHalvesAtom), [appearance]: themeId });
  return persist();
}

/** appearance.cycle: system → light → dark → system. */
export function cycleAppearanceMode(): AppearanceMode {
  const current = appAtomRegistry.get(appearanceModeAtom);
  const next: AppearanceMode = current === "system" ? "light" : current === "light" ? "dark" : "system";
  setAppearanceMode(next);
  return next;
}

/** Maps a shared theme definition's color roles onto the app palette. */
function paletteFromThemeColors(base: Palette, colors: ThemeColors): Palette {
  return {
    ...base,
    background: colors.canvas,
    foreground: colors.text,
    card: colors.surface,
    popover: colors.surfaceOverlay,
    primary: colors.accent,
    primaryForeground: colors.accentForeground,
    messageAction: colors.messageAction,
    secondary: colors.secondary,
    muted: colors.muted,
    mutedForeground: colors.mutedForeground,
    accent: colors.accentSurface,
    accentForeground: colors.accentSurfaceForeground,
    messageSurface: colors.messageSurface,
    border: colors.border,
    input: colors.input,
    error: colors.error,
    errorForeground: colors.errorForeground,
    warning: colors.warning,
    warningForeground: colors.warningForeground,
    codeBackground: colors.codeBackground,
    sidebar: {
      ...base.sidebar,
      background: colors.sidebar,
      foreground: colors.sidebarForeground,
      mutedForeground: colors.sidebarMutedForeground,
      accent: colors.sidebarControlSurface,
      rowHover: colors.sidebarRowHover,
      rowActive: colors.sidebarRowActive,
      rowSelected: colors.sidebarRowSelected,
      border: colors.sidebarBorder,
    },
  };
}

export const resolvedPaletteAtom = Atom.make((get): Palette => {
  const appearance = get(resolvedAppearanceAtom);
  const base = appearance === "light" ? LIGHT : DARK;
  const themeId = get(themeHalvesAtom)[appearance];
  const theme = themeId === null ? undefined : BUILT_IN_THEMES.find((candidate) => candidate.id === themeId);
  const colors = theme ? getThemeColorsForAppearance(theme, appearance) : null;
  return colors ? paletteFromThemeColors(base, colors) : base;
}).pipe(Atom.keepAlive);
