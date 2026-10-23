// Client-only settings (theme, fonts, timestamp format, send shortcut, diff
// prefs, confirmations, ...). The web app keeps these in the desktop bridge or
// IndexedDB (apps/web/src/hooks/useSettings.ts) and the theme in localStorage
// (hooks/useTheme.ts); t3-term keeps both in $T3TERM_HOME/client-settings.json.
//
// Other areas read settings with `useClientSettings(selector)` or the atoms
// below, and write with `updateClientSettings(patch)`.
import { useAtomValue } from "@effect/atom-react";
import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type ClientSettingsPatch,
} from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { createElement, type ReactNode } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { termHome } from "../runtime/paths.ts";
import {
  BUILT_IN_THEME_DEFINITIONS,
  DARK,
  LIGHT,
  getThemeColorsForMode,
  getThemeDefinition,
  paletteFromThemeColors,
  ThemeContext,
  type Palette,
  type ThemeAppearance,
} from "../ui/theme.ts";

// ── Theme preference (apps/web/src/hooks/useTheme.ts) ───────────────────

/** "system" | "light" | "dark" | a theme id. */
export type ThemePreference = string;
export type ThemePreferenceMode = ThemeAppearance | "system";
export interface ThemeHalves {
  readonly light?: string;
  readonly dark?: string;
}

export interface ThemeState {
  readonly theme: ThemePreference;
  /** The Color scheme tiles: follow the OS or pin light/dark. */
  readonly appearanceMode: ThemePreferenceMode;
  /** Per-appearance theme picks from the Themes grid. */
  readonly halves: ThemeHalves | null;
}

export const DEFAULT_THEME_STATE: ThemeState = { theme: "system", appearanceMode: "system", halves: null };

interface ClientSettingsDocument {
  readonly settings: ClientSettings;
  readonly theme: ThemeState;
}

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

function settingsFile(): string {
  return NodePath.join(termHome(), "client-settings.json");
}

function sanitizeTheme(raw: unknown): ThemeState {
  if (!raw || typeof raw !== "object") return DEFAULT_THEME_STATE;
  const value = raw as Record<string, unknown>;
  const theme = typeof value.theme === "string" && value.theme.length > 0 ? value.theme : "system";
  const mode = value.appearanceMode;
  const appearanceMode: ThemePreferenceMode =
    mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
  let halves: { light?: string; dark?: string } | null = null;
  if (value.halves && typeof value.halves === "object") {
    const next: { light?: string; dark?: string } = {};
    for (const appearance of ["light", "dark"] as const) {
      const id = (value.halves as Record<string, unknown>)[appearance];
      if (typeof id !== "string") continue;
      const definition = getThemeDefinition(id);
      if (id === "t3-code" || (definition && getThemeColorsForMode(definition, appearance))) next[appearance] = id;
    }
    halves = next.light !== undefined || next.dark !== undefined ? next : null;
  }
  return { theme, appearanceMode, halves };
}

function readDocument(): ClientSettingsDocument {
  try {
    const raw: unknown = JSON.parse(NodeFS.readFileSync(settingsFile(), "utf8"));
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    let settings = DEFAULT_CLIENT_SETTINGS;
    try {
      settings = decodeClientSettings(record.settings ?? {});
    } catch (error) {
      // One bad key must not reset every preference: decode key by key.
      const partial: Record<string, unknown> = {};
      const stored = (record.settings ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(stored)) {
        try {
          decodeClientSettings({ [key]: value });
          partial[key] = value;
        } catch {}
      }
      settings = decodeClientSettings(partial);
      console.error("[CLIENT_SETTINGS] dropped invalid keys", error);
    }
    return { settings, theme: sanitizeTheme(record.theme) };
  } catch {
    return { settings: DEFAULT_CLIENT_SETTINGS, theme: DEFAULT_THEME_STATE };
  }
}

const initial = readDocument();

export const clientSettingsAtom = Atom.make<ClientSettings>(initial.settings).pipe(
  Atom.keepAlive,
  Atom.withLabel("t3term-client-settings"),
);
export const themeStateAtom = Atom.make<ThemeState>(initial.theme).pipe(
  Atom.keepAlive,
  Atom.withLabel("t3term-theme-state"),
);

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  // Coalesce bursts (a slider drag) into one write.
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const document: ClientSettingsDocument = {
      settings: appAtomRegistry.get(clientSettingsAtom),
      theme: appAtomRegistry.get(themeStateAtom),
    };
    try {
      NodeFS.mkdirSync(termHome(), { recursive: true });
      const target = settingsFile();
      const temp = `${target}.${process.pid}.tmp`;
      NodeFS.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`);
      NodeFS.renameSync(temp, target);
    } catch (error) {
      console.error("[CLIENT_SETTINGS] persist failed", error);
    }
  }, 50);
}

/** Flush a pending write (used before the process exits). */
export function flushClientSettings(): void {
  if (!writeTimer) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  const document: ClientSettingsDocument = {
    settings: appAtomRegistry.get(clientSettingsAtom),
    theme: appAtomRegistry.get(themeStateAtom),
  };
  NodeFS.mkdirSync(termHome(), { recursive: true });
  NodeFS.writeFileSync(settingsFile(), `${JSON.stringify(document, null, 2)}\n`);
}
process.on("exit", flushClientSettings);

export function getClientSettings(): ClientSettings {
  return appAtomRegistry.get(clientSettingsAtom);
}

export function updateClientSettings(patch: ClientSettingsPatch): void {
  const current = appAtomRegistry.get(clientSettingsAtom);
  const next = { ...current, ...patch } as ClientSettings;
  appAtomRegistry.set(clientSettingsAtom, next);
  persist();
}

/** Same contract as web's persistClientSettingsPatch: resolves once queued. */
export function persistClientSettingsPatch(patch: ClientSettingsPatch): Promise<void> {
  updateClientSettings(patch);
  return Promise.resolve();
}

/** Reads client settings; re-renders on any client settings write. */
export function useClientSettings<T = ClientSettings>(selector?: (settings: ClientSettings) => T): T {
  const whole = useAtomValue(clientSettingsAtom);
  return selector ? selector(whole) : (whole as T);
}

/** A derived atom for one key, for non-React readers and cheap subscriptions. */
export const clientSettingAtom = Atom.family(<K extends keyof ClientSettings>(key: K) =>
  Atom.make((get) => get(clientSettingsAtom)[key]),
) as <K extends keyof ClientSettings>(key: K) => Atom.Atom<ClientSettings[K]>;

// ── Theme resolution ────────────────────────────────────────────────────

function detectSystemDark(): boolean {
  const forced = process.env.T3TERM_SYSTEM_APPEARANCE?.trim().toLowerCase();
  if (forced === "dark") return true;
  if (forced === "light") return false;
  try {
    if (process.platform === "win32") {
      const out = NodeChildProcess.execFileSync(
        "reg",
        ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
      );
      return /0x0\b/.test(out);
    }
    if (process.platform === "darwin") {
      const out = NodeChildProcess.execFileSync("defaults", ["read", "-g", "AppleInterfaceStyle"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return /dark/i.test(out);
    }
    const out = NodeChildProcess.execFileSync("gsettings", ["get", "org.gnome.desktop.interface", "color-scheme"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /dark/i.test(out);
  } catch {
    // Unknown: the web app's media query defaults to light, but every T3
    // surface (and kitty/Ghostty) defaults dark.
    return process.platform !== "darwin";
  }
}

export const systemDarkAtom = Atom.make(detectSystemDark()).pipe(Atom.keepAlive, Atom.withLabel("t3term-system-dark"));

// The OS has no change event we can hear from Bun; re-read it now and then.
// Setting an equal value does not notify, so this never repaints by itself.
const systemPoll = setInterval(() => {
  const next = detectSystemDark();
  if (appAtomRegistry.get(systemDarkAtom) !== next) appAtomRegistry.set(systemDarkAtom, next);
}, 30_000);
systemPoll.unref?.();

/** apps/web/src/themePalette.ts resolveThemeAppearance. */
export function resolveThemeAppearance(state: ThemeState, systemDark: boolean): ThemeAppearance {
  const systemAppearance: ThemeAppearance = systemDark ? "dark" : "light";
  const mode = state.appearanceMode;
  const definition = getThemeDefinition(state.theme);
  if (mode === "system") {
    if (state.halves?.[systemAppearance]) return systemAppearance;
    return definition && getThemeColorsForMode(definition, systemAppearance) === null
      ? definition.appearance
      : systemAppearance;
  }
  if (state.halves?.[mode]) return mode;
  return definition && getThemeColorsForMode(definition, mode) === null ? definition.appearance : mode;
}

/** The theme id painting `appearance`, or null for the standard T3 Code palette. */
export function resolveActiveThemeId(state: ThemeState, appearance: ThemeAppearance): string | null {
  const preference = state.halves?.[appearance] ?? state.theme;
  if (preference === "system" || preference === "light" || preference === "dark" || preference === "t3-code") {
    return null;
  }
  return getThemeDefinition(preference)?.id ?? null;
}

const paletteCache = new Map<string, Palette>();

export function resolvePalette(state: ThemeState, systemDark: boolean): Palette {
  const appearance = resolveThemeAppearance(state, systemDark);
  const themeId = resolveActiveThemeId(state, appearance);
  if (themeId === null) return appearance === "dark" ? DARK : LIGHT;
  const key = `${themeId}:${appearance}`;
  let palette = paletteCache.get(key);
  if (!palette) {
    const definition = BUILT_IN_THEME_DEFINITIONS.find((candidate) => candidate.id === themeId);
    const colors = definition ? getThemeColorsForMode(definition, appearance) : null;
    palette = colors ? paletteFromThemeColors(colors, appearance) : appearance === "dark" ? DARK : LIGHT;
    paletteCache.set(key, palette);
  }
  return palette;
}

/** The palette App provides through ThemeContext. */
export const activePaletteAtom = Atom.make((get) => resolvePalette(get(themeStateAtom), get(systemDarkAtom))).pipe(
  Atom.keepAlive,
  Atom.withLabel("t3term-active-palette"),
);

export function setThemeState(update: (current: ThemeState) => ThemeState): void {
  appAtomRegistry.set(themeStateAtom, update(appAtomRegistry.get(themeStateAtom)));
  persist();
}

/** Color scheme tiles: System / Light / Dark. */
export function setAppearanceMode(mode: ThemePreferenceMode): void {
  setThemeState((current) => ({ ...current, appearanceMode: mode }));
}

/** A theme circle: pick `themeId` for one appearance. "t3-code" is the standard palette. */
export function setThemeHalf(appearance: ThemeAppearance, themeId: string): void {
  setThemeState((current) => {
    const halves = { ...current.halves, [appearance]: themeId };
    const isDefault = (id: string | undefined) => id === undefined || id === "t3-code";
    return {
      ...current,
      theme: "system",
      halves: isDefault(halves.light) && isDefault(halves.dark) ? null : halves,
    };
  });
}

/** Restore device defaults: system appearance, standard palette. */
export function resetThemeState(): void {
  setThemeState(() => DEFAULT_THEME_STATE);
}

export function useThemeState(): ThemeState {
  return useAtomValue(themeStateAtom);
}

// ── Public theme API (App, command palette "Change theme") ──────────────

/** Color scheme tiles / palette command: follow the OS or pin light or dark. */
export function setColorScheme(mode: ThemePreferenceMode): void {
  setAppearanceMode(mode);
}

/**
 * Picks a theme the way the Themes grid does: "system" | "light" | "dark"
 * pin the color scheme; "t3-code" restores the standard palette; any other id
 * applies that theme to every appearance it has (a single-appearance theme
 * also pins the color scheme to that appearance).
 */
export function setThemePreference(id: string): void {
  if (id === "system" || id === "light" || id === "dark") {
    setAppearanceMode(id);
    return;
  }
  if (id === "t3-code") {
    setThemeState((current) => ({ ...current, theme: "system", halves: null }));
    return;
  }
  const definition = getThemeDefinition(id);
  if (!definition) return;
  const modes = (["light", "dark"] as const).filter((mode) => getThemeColorsForMode(definition, mode) !== null);
  setThemeState((current) => {
    const halves: { light?: string; dark?: string } = { ...current.halves };
    for (const mode of modes) halves[mode] = definition.id;
    return {
      theme: "system",
      appearanceMode: modes.length === 1 ? modes[0]! : current.appearanceMode,
      halves,
    };
  });
}

/** Provides the active palette to everything below; App wraps its single root with it. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const palette = useAtomValue(activePaletteAtom);
  return createElement(ThemeContext.Provider, { value: palette }, children);
}
