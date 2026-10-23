// Port of apps/web/src/components/settings/ThemePreviewCircles.tsx.
//
// The disc's blurred radial gradients are rasterized by discImage.ts.
import { STANDARD_THEME_PREVIEW_COLORS as SHARED_STANDARD_THEME_PREVIEW_COLORS } from "@t3tools/shared/themePreview";

import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { themePreviewDiscSource } from "./discImage.ts";
import {
  alpha,
  getThemeColorsForMode,
  useTheme,
  type ThemeAppearance,
  type ThemeDefinition,
} from "../../ui/theme.ts";

const THEME_PREVIEW_ROLES = [
  "sidebar",
  "canvas",
  "surface",
  "accentSurface",
  "accent",
  "messageSurface",
  "messageAction",
] as const;
type ThemePreviewRole = (typeof THEME_PREVIEW_ROLES)[number];
type ThemeCardPreview = {
  mode: ThemeAppearance;
  colors: Readonly<Record<ThemePreviewRole, string>>;
};
export type ThemeCardDefinition = {
  id: string;
  label: string;
  previews: ReadonlyArray<ThemeCardPreview>;
};
export type ThemeMode = ThemeAppearance | "system";
export type ThemeCardPreviewColors = ThemeCardPreview["colors"];

const STANDARD_THEME_PREVIEW_COLORS: Record<ThemeAppearance, Readonly<Record<ThemePreviewRole, string>>> = {
  light: {
    sidebar: "#fafafa",
    surface: "#ffffff",
    accentSurface: "#f4f4f5",
    messageSurface: "#e4e4e7",
    ...SHARED_STANDARD_THEME_PREVIEW_COLORS.light,
  },
  dark: {
    sidebar: "#0f0f10",
    surface: "#121212",
    accentSurface: "#27272a",
    messageSurface: "#27272a",
    ...SHARED_STANDARD_THEME_PREVIEW_COLORS.dark,
  },
};

export const STANDARD_THEME_CARDS: ReadonlyArray<ThemeCardDefinition> = [
  {
    id: "default",
    label: "T3 Code",
    previews: (["light", "dark"] as const).map((mode) => ({
      mode,
      colors: STANDARD_THEME_PREVIEW_COLORS[mode],
    })),
  },
];

export function getThemeModes(theme: ThemeDefinition): ReadonlyArray<ThemeAppearance> {
  return (["light", "dark"] as const).filter((mode) => getThemeColorsForMode(theme, mode) !== null);
}

export function previewColorsOf(card: ThemeCardDefinition, mode: ThemeAppearance): ThemeCardPreviewColors | null {
  return card.previews.find((preview) => preview.mode === mode)?.colors ?? null;
}

export function getThemeCardDefinition(theme: ThemeDefinition): ThemeCardDefinition {
  return {
    id: theme.id,
    label: theme.label,
    previews: getThemeModes(theme).map((mode) => {
      const colors = getThemeColorsForMode(theme, mode) ?? theme.colors;
      return {
        mode,
        colors: {
          sidebar: colors.sidebar,
          canvas: colors.canvas,
          surface: colors.surface,
          accentSurface: colors.accentSurface,
          accent: colors.accent,
          messageSurface: colors.messageSurface,
          messageAction: colors.messageAction,
        },
      };
    }),
  };
}

// ── The disc ────────────────────────────────────────────────────────────

/** `size-14 rounded-full border-2 border-background` with the blurred gradient inside. */
export function ThemePreviewCircle({
  colors,
  mode,
  size = 56,
}: {
  colors: ThemeCardPreviewColors;
  mode: ThemeAppearance;
  size?: number;
}) {
  const theme = useTheme();
  const border = Math.max(1, Math.round((size / 56) * 2));
  const inner = size - border * 2;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: border,
        borderColor: theme.background,
        flexShrink: 0,
        pointerEvents: "none",
        // themePreviewEdgeShadow's drop shadow; its inset ring sits under the
        // gradient span on the web, so it never shows.
        boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: mode === "dark" ? "#0000002e" : "#00000014" },
      }}
    >
      <img src={themePreviewDiscSource(colors, mode)} objectFit="fill" style={{ width: inner, height: inner, borderRadius: inner / 2, pointerEvents: "none" }} />
    </div>
  );
}

/** The 68px button: ring and sun/moon badge when picked. */
export function ThemePreviewButton({
  colors,
  mode,
  picked,
  ringColor,
  onClick,
  testId,
}: {
  colors: ThemeCardPreviewColors;
  mode: ThemeAppearance;
  picked: boolean;
  ringColor: string;
  onClick: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={mode === "light" ? "Use for light mode only" : "Use for dark mode only"} side="top">
      <div
        testId={testId}
        onClick={onClick}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 68,
          height: 68,
          borderRadius: 34,
          flexShrink: 0,
          cursor: "pointer",
        }}
      >
        <ThemePreviewCircle colors={colors} mode={mode} />
        {picked ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 68,
              height: 68,
              borderRadius: 34,
              borderWidth: 2,
              borderColor: ringColor,
              pointerEvents: "none",
            }}
          />
        ) : null}
        {picked ? (
          <div
            style={{
              position: "absolute",
              right: 2,
              bottom: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: alpha(theme.border, 0.7),
              backgroundColor: theme.background,
              pointerEvents: "none",
            }}
          >
            <Icon name={mode === "light" ? "sun" : "moon"} size={12} color={theme.foreground} />
          </div>
        ) : null}
      </div>
    </Tooltip>
  );
}

export function ThemePreviewCircles({
  cardId,
  activeModes,
  onSelectMode,
  previews,
  ringColor,
}: {
  cardId: string;
  activeModes: ReadonlyArray<ThemeMode>;
  onSelectMode: (mode: ThemeMode) => void;
  previews: ThemeCardDefinition["previews"];
  ringColor: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        minHeight: 64,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 12,
      }}
    >
      {previews.map((preview) => (
        <ThemePreviewButton
          key={preview.mode}
          testId={`theme-${cardId}-${preview.mode}`}
          colors={preview.colors}
          mode={preview.mode}
          picked={activeModes.includes(preview.mode)}
          ringColor={ringColor}
          onClick={() => onSelectMode(preview.mode)}
        />
      ))}
    </div>
  );
}
