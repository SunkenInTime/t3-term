// The theme writes apps/web/src/hooks/useTheme.ts exposes (setTheme,
// setThemeHalf with a null "back to default" half) and ThemeSettings.tsx's
// assignHalf, expressed over t3-term's theme state. state/clientSettings.ts
// owns storage; its own setThemeHalf always resets the base theme, which the
// Themes grid must not do (a half picked over a themed base keeps that base
// for the other appearance), so these go through setThemeState directly.
import { setThemeState, type ThemeHalves, type ThemeState } from "../../state/clientSettings.ts";
import { getThemeDefinition, type ThemeAppearance } from "../../ui/theme.ts";

/** The standard palette's id when a half names it explicitly. */
export const STANDARD_THEME_ID = "t3-code";

function normalizeHalves(halves: { light?: string; dark?: string }): ThemeHalves | null {
  return halves.light === undefined && halves.dark === undefined ? null : halves;
}

/** useTheme().setTheme: a whole-theme pick clears the per-appearance mix. */
export function setTheme(next: string): void {
  setThemeState((current) => ({ ...current, theme: next, halves: null }));
}

/** useTheme().setThemeHalf: null drops the half so the base theme owns it again. */
export function setThemeHalf(appearance: ThemeAppearance, themeId: string | null): void {
  setThemeState((current) => {
    const next: { light?: string; dark?: string } = { ...current.halves };
    if (themeId === null) delete next[appearance];
    else next[appearance] = themeId;
    return { ...current, halves: normalizeHalves(next) };
  });
}

/** The card id that owns the base theme (null = standard T3 Code palette). */
export function baseCardIdOf(state: ThemeState): string | null {
  return getThemeDefinition(state.theme)?.id ?? null;
}

/** ThemeSettings.tsx lightOwner/darkOwner: the card painting `appearance`. */
export function ownerOf(state: ThemeState, appearance: ThemeAppearance): string | null {
  const half = state.halves?.[appearance];
  if (half === undefined) return baseCardIdOf(state);
  if (half === STANDARD_THEME_ID) return null;
  return getThemeDefinition(half)?.id ?? baseCardIdOf(state);
}

/** The base theme a "use the standard palette" pick writes. */
function standardPreference(state: ThemeState): string {
  return state.appearanceMode === "system" ? "system" : state.appearanceMode;
}

/** ThemeSettings.tsx assignHalf: give one appearance to a card (null = T3 Code). */
export function assignHalf(state: ThemeState, appearance: ThemeAppearance, cardId: string | null): void {
  const baseCardId = baseCardIdOf(state);
  const otherAppearance: ThemeAppearance = appearance === "light" ? "dark" : "light";
  // Picking the default over a themed base cannot be stored as a half: the
  // base would still own that appearance. Convert the base into an explicit
  // half on the other side so this side falls back to default.
  if (cardId === null && baseCardId !== null) {
    const otherOwner = state.halves?.[otherAppearance] ?? baseCardId;
    setTheme(standardPreference(state));
    setThemeHalf(otherAppearance, otherOwner);
    return;
  }
  setThemeHalf(appearance, cardId);
}

/** The T3 Code card's body click: the standard palette for both appearances. */
export function applyStandardTheme(state: ThemeState): void {
  setTheme(standardPreference(state));
}
