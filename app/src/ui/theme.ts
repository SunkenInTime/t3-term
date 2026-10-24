// Design tokens transcribed from apps/web/src/index.css (default theme, contrast 100).
// Alpha colors are written as #RRGGBBAA; GPUI blends them like the browser does.
import { createContext, useContext } from "react";
import {
  BUILT_IN_THEMES,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from "@t3tools/shared/themePalettes";

import { getCustomThemes, getEnvironmentThemes } from "../web/themePalette.ts";

export interface Palette {
  readonly appearance: "dark" | "light";
  readonly background: string;
  readonly foreground: string;
  readonly card: string;
  readonly popover: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly messageAction: string;
  readonly secondary: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly messageSurface: string;
  readonly border: string;
  readonly input: string;
  readonly error: string;
  readonly errorForeground: string;
  readonly toolError: string;
  readonly info: string;
  readonly infoForeground: string;
  readonly success: string;
  readonly successForeground: string;
  readonly warning: string;
  readonly warningForeground: string;
  readonly indigo: string;
  readonly codeBackground: string;
  readonly diffAdd: string;
  readonly diffDel: string;
  readonly scrollbar: string;
  readonly overlay: string;
  /** Built-in theme painting this palette (web html[data-theme-id]); null is the standard T3 Code palette. */
  readonly themeId: string | null;
  /**
   * ComposerSurface.tsx: the glass fill before --glass-opacity, the 1px outline,
   * and the dark-mode inset highlight under the top edge (null in light).
   */
  readonly composer: {
    readonly surface: string;
    readonly outline: string;
    readonly highlight: string | null;
  };
  readonly sidebar: {
    readonly background: string;
    readonly foreground: string;
    readonly mutedForeground: string;
    readonly accent: string;
    readonly rowHover: string;
    readonly rowActive: string;
    readonly rowSelected: string;
    readonly border: string;
    readonly icon: string;
    readonly input: string;
  };
}

export const DARK: Palette = {
  appearance: "dark",
  background: "#0a0a0a",
  foreground: "#f5f5f5",
  card: "#111111",
  popover: "#111111",
  primary: "#346bf1",
  primaryForeground: "#ffffff",
  messageAction: "#346bf1",
  secondary: "#111111",
  muted: "#111111",
  mutedForeground: "#818181",
  accent: "#ffffff0a",
  accentForeground: "#f5f5f5",
  messageSurface: "#141414",
  border: "#ffffff0f",
  input: "#ffffff14",
  error: "#fb414a",
  errorForeground: "#ff6467",
  toolError: "#fca5a5",
  info: "#2b7fff",
  infoForeground: "#51a2ff",
  success: "#00bc7d",
  successForeground: "#00d492",
  warning: "#fe9a00",
  warningForeground: "#ffb900",
  indigo: "#a3b3ff",
  codeBackground: "#111111",
  diffAdd: "#00d492",
  diffDel: "#ff6467",
  scrollbar: "#ffffff14",
  // web .dialog-backdrop: background at 64% plus a 4px backdrop blur. GPUI has no
  // backdrop blur, so the dim goes to 80%, which knocks text behind a dialog down
  // about as far as the blur does (brightest glyph pixels ~50 vs web ~44).
  overlay: "#0a0a0acc",
  themeId: null,
  // --surface-raised (background 97% + white), white 5% outline, white 3% highlight.
  composer: { surface: "#111111", outline: "#ffffff0d", highlight: "#ffffff08" },
  sidebar: {
    background: "#000000",
    foreground: "#f1f3f7",
    mutedForeground: "#a3a3a3",
    accent: "#191a1d",
    rowHover: "#f1f3f714",
    rowActive: "#f1f3f71c",
    rowSelected: "#f1f3f712",
    border: "#ffffff14",
    icon: "#626262",
    input: "#ffffff2e",
  },
};

export const LIGHT: Palette = {
  appearance: "light",
  background: "#fcfcfc",
  foreground: "#27272a",
  card: "#ffffff",
  popover: "#ffffff",
  primary: "#1b4ed8",
  primaryForeground: "#ffffff",
  messageAction: "#1b4ed8",
  secondary: "#fafafa",
  muted: "#fafafa",
  mutedForeground: "#71717b",
  accent: "#f4f4f5",
  accentForeground: "#18181b",
  messageSurface: "#f4f4f5",
  border: "#e4e4e7",
  input: "#d4d4d8",
  error: "#fb2c36",
  errorForeground: "#c10007",
  toolError: "#fb2c36",
  info: "#2b7fff",
  infoForeground: "#1447e6",
  success: "#00bc7d",
  successForeground: "#007a55",
  warning: "#fe9a00",
  warningForeground: "#bb4d00",
  indigo: "#4f39f6",
  codeBackground: "#fefefe",
  diffAdd: "#009966",
  diffDel: "#e7000b",
  scrollbar: "#d9d9d9",
  // web: 60% + blur; 75% here for the same reason as the dark overlay.
  overlay: "#fcfcfcbf",
  themeId: null,
  composer: { surface: "#ffffff", outline: "#00000014", highlight: null },
  sidebar: {
    background: "#fafafa",
    foreground: "#27272a",
    mutedForeground: "#71717b",
    accent: "#f4f4f5",
    rowHover: "#fcfcfc",
    rowActive: "#ffffff",
    rowSelected: "#ffffff",
    border: "#e4e4e7",
    icon: "#a8a8ae",
    input: "#d4d4d8",
  },
};

/** Tailwind type scale used by the web app: [fontSize, lineHeight]. */
export const TEXT = {
  "3xs": [10, 14],
  "2xs": [11, 16],
  xs: [12, 16],
  sm: [14, 20],
  base: [16, 24],
  lg: [18, 28],
  xl: [20, 28],
  "2xl": [24, 32],
  "3xl": [30, 36],
} as const;

export const RADIUS = { sm: 6, md: 8, lg: 10, xl: 14, "2xl": 18, "3xl": 22 } as const;

export const LAYOUT = {
  sidebarWidth: 256,
  topbar: 52,
  chatMaxWidth: 736,
  chatLanePadding: 48,
  detailsCardWidth: 280,
  rightPanelWidth: 540,
  terminalHeight: 280,
} as const;

function platformFonts() {
  switch (process.platform) {
    case "win32":
      return { sans: "Segoe UI", mono: "Consolas" };
    case "darwin":
      return { sans: ".SystemUIFont", mono: "Menlo" };
    default:
      return { sans: "DejaVu Sans", mono: "DejaVu Sans Mono" };
  }
}

export const FONTS = platformFonts();

/** Scales the opacity of `color` (#rrggbb or #rrggbbaa) by `amount` 0..1, like Tailwind's `color/NN`. */
export function alpha(color: string, amount: number): string {
  const base = color.slice(0, 7);
  const existing = color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) / 255 : 1;
  const a = Math.round(Math.max(0, Math.min(1, amount * existing)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${base}${a}`;
}

export const ThemeContext = createContext<Palette>(DARK);

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

// ── Built-in themes (packages/shared/src/themePalettes.ts) ──────────────
// Theme files are written in app color roles (index.css:1256-1321 maps them
// onto the semantic tokens). paletteFromThemeColors does the same mapping
// onto Palette; info, success and indigo stay with the standard palette, as
// they do on the web.

export type { ThemeAppearance, ThemeColors, ThemeDefinition };

export const BUILT_IN_THEME_DEFINITIONS: ReadonlyArray<ThemeDefinition> = BUILT_IN_THEMES;

const LEGACY_THEME_ID_ALIASES: Readonly<Record<string, string>> = {
  "t3-chat-dark": "t3-chat",
  "t3-grove": "grove",
  "t3-ocean": "ocean",
  "t3-ember": "ember",
  "t3-iris": "iris",
};

/** Built-in themes first, then saved themes, then themes the primary environment publishes (web/themePalette.ts). */
export function getThemeDefinition(themeId: string): ThemeDefinition | null {
  const id = LEGACY_THEME_ID_ALIASES[themeId] ?? themeId;
  return (
    BUILT_IN_THEME_DEFINITIONS.find((definition) => definition.id === id) ??
    getCustomThemes().find((definition) => definition.id === id) ??
    getEnvironmentThemes().find((definition) => definition.id === id) ??
    null
  );
}

export function getThemeColorsForMode(theme: ThemeDefinition, mode: ThemeAppearance): ThemeColors | null {
  if (mode === theme.appearance) return theme.colors;
  return theme.variants?.[mode] ?? null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

function hexByte(value: number): string {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** CSS color (oklch(), #rgb, #rrggbb, #rrggbbaa) → #rrggbb[aa]. */
export function cssColorToHex(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) {
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return trimmed.toLowerCase();
  }
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i.exec(trimmed);
  if (!match) return "#000000";
  const lightness = Number(match[1]) / (match[2] ? 100 : 1);
  const chroma = Number(match[3]);
  const hue = (Number(match[4]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const red = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  const alphaValue = match[5] === undefined ? 1 : Number(match[5]) / (match[6] ? 100 : 1);
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}${alphaValue < 1 ? hexByte(alphaValue) : ""}`;
}

/** color-mix(in srgb, a weight, b) for opaque colors. */
export function mixColors(a: string, b: string, weight: number): string {
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  const out = [0, 1, 2].map((index) => hexByte(channel(a, index) * weight + channel(b, index) * (1 - weight)));
  return `#${out.join("")}`;
}

export function paletteFromThemeColors(
  raw: ThemeColors,
  appearance: ThemeAppearance,
  themeId: string | null = null,
): Palette {
  const c = Object.fromEntries(Object.entries(raw).map(([role, value]) => [role, cssColorToHex(value)])) as Record<
    keyof ThemeColors,
    string
  >;
  const base = appearance === "dark" ? DARK : LIGHT;
  return {
    ...base,
    appearance,
    background: c.canvas,
    foreground: c.text,
    card: c.surface,
    popover: c.surfaceOverlay,
    primary: c.messageAction,
    primaryForeground: c.messageActionForeground,
    messageAction: c.messageAction,
    secondary: c.secondary,
    muted: c.muted,
    mutedForeground: c.mutedForeground,
    accent: c.accentSurface,
    accentForeground: c.accentSurfaceForeground,
    messageSurface: c.messageSurface,
    border: c.border,
    input: c.input,
    error: c.error,
    errorForeground: c.errorForeground,
    toolError: c.errorForeground,
    warning: c.warning,
    warningForeground: c.warningForeground,
    codeBackground: c.codeBackground,
    scrollbar: c.border,
    overlay: alpha(c.canvas, appearance === "dark" ? 0.64 : 0.6),
    themeId,
    composer: themedComposerColors(c, appearance, themeId),
    sidebar: {
      background: c.sidebar,
      foreground: c.sidebarForeground,
      mutedForeground: c.sidebarMutedForeground,
      accent: c.sidebarControlSurface,
      rowHover: c.sidebarRowHover,
      rowActive: c.sidebarRowActive,
      rowSelected: c.sidebarRowSelected,
      border: c.sidebarBorder,
      icon: mixColors(c.sidebarMutedForeground.slice(0, 7), c.sidebar.slice(0, 7), 0.6),
      input: c.input,
    },
  };
}

/** ComposerSurface.tsx's [html[data-theme-id]] overrides of the glass surface, outline and highlight. */
function themedComposerColors(
  c: Record<keyof ThemeColors, string>,
  appearance: ThemeAppearance,
  themeId: string | null,
): Palette["composer"] {
  if (appearance === "light") {
    return { surface: c.surfaceRaised, outline: c.toolbarBorder, highlight: null };
  }
  if (themeId === "t3-chat") {
    return { surface: c.surfaceRaised, outline: "#241e28", highlight: alpha("#432d48", 0.12) };
  }
  return {
    surface: c.surfaceRaised,
    outline: mixColors(c.input.slice(0, 7), c.canvas.slice(0, 7), 0.3),
    highlight: alpha(c.input, 0.12),
  };
}
