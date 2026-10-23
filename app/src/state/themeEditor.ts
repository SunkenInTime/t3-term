// Port of apps/web/src/components/settings/themeEditorStore.ts: the open theme
// editor session, as an atom instead of a zustand store.
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { getThemeDefinition, type ThemeAppearance } from "../ui/theme.ts";
import { resolveActiveThemeId, resolveThemeAppearance, systemDarkAtom, themeStateAtom } from "./clientSettings.ts";

export type ThemeEditorSessionInput = {
  editingThemeId: string | null;
  seedThemeId: string | null;
  seedName: string | null;
  initialAppearance: ThemeAppearance;
};

export type ThemeEditorSession = ThemeEditorSessionInput & {
  id: number;
};

export const themeEditorSessionAtom = Atom.make<ThemeEditorSession | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("t3term-theme-editor-session"),
);

let nextSessionId = 0;

export function openThemeEditor(session: ThemeEditorSessionInput): void {
  appAtomRegistry.set(themeEditorSessionAtom, { ...session, id: ++nextSessionId });
}

export function closeThemeEditor(): void {
  appAtomRegistry.set(themeEditorSessionAtom, null);
}

/**
 * toggleThemeEditorForTheme: closes an open editor, or opens one seeded from
 * the theme painting the current appearance.
 */
export function toggleThemeEditor(): void {
  if (appAtomRegistry.get(themeEditorSessionAtom)) {
    closeThemeEditor();
    return;
  }
  const state = appAtomRegistry.get(themeStateAtom);
  const initialAppearance = resolveThemeAppearance(state, appAtomRegistry.get(systemDarkAtom));
  // web: themeHalves[initialAppearance] ?? the base theme's id. A half naming
  // the standard palette ("t3-code") seeds from the standard colors.
  const activeThemeId = resolveActiveThemeId(state, initialAppearance);
  const seedThemeId = activeThemeId ? (getThemeDefinition(activeThemeId)?.id ?? null) : null;
  openThemeEditor({
    editingThemeId: null,
    seedThemeId,
    seedName: null,
    initialAppearance,
  });
}
