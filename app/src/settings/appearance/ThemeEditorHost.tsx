// Port of apps/web/src/components/settings/ThemeEditorHost.tsx: mounts the
// theme editor for the open session and applies what it saves.
import { useAtomValue } from "@effect/atom-react";

import { customThemesRevisionAtom, useThemeState } from "../../state/clientSettings.ts";
import { closeThemeEditor, themeEditorSessionAtom } from "../../state/themeEditor.ts";
import { toast } from "../../ui/toast.tsx";
import { getThemeDefinition, type ThemeAppearance, type ThemeDefinition } from "../../ui/theme.ts";
import { setTheme } from "./themeActions.ts";
import { ThemeEditorPanel } from "./ThemeEditorPanel.tsx";

function useThemeDefinition(id: string | null | undefined): ThemeDefinition | null {
  // Re-read when the saved library changes, like useSyncExternalStore over subscribeToCustomThemes.
  useAtomValue(customThemesRevisionAtom);
  return id ? (getThemeDefinition(id) ?? null) : null;
}

export function ThemeEditorHost() {
  const session = useAtomValue(themeEditorSessionAtom);
  const state = useThemeState();
  const editingTheme = useThemeDefinition(session?.editingThemeId);
  const seedTheme = useThemeDefinition(session?.seedThemeId);

  const handleSaved = (
    savedTheme: ThemeDefinition,
    { created, mergedAppearance }: { created: boolean; mergedAppearance?: ThemeAppearance },
  ) => {
    if (mergedAppearance) {
      setTheme(savedTheme.id);
      toast({
        type: "success",
        title: `${savedTheme.label} updated`,
        description: `Its ${mergedAppearance} palette was added.`,
      });
      return true;
    }
    if (!created) {
      // The edited theme may be showing through the base preference or either
      // half of the mix; the preference itself is untouched (a setTheme here
      // would clear the mix). The palette atom repaints on the library change.
      const wasActive =
        getThemeDefinition(state.theme)?.id === savedTheme.id ||
        state.halves?.light === savedTheme.id ||
        state.halves?.dark === savedTheme.id;
      toast({
        type: "success",
        title: `${savedTheme.label} saved`,
        description: wasActive ? "Your changes are now active." : "Your changes are saved.",
      });
      return true;
    }

    setTheme(savedTheme.id);
    toast({ type: "success", title: `${savedTheme.label} created`, description: "It’s now active." });
    return true;
  };

  if (!session) return null;

  return (
    <ThemeEditorPanel
      key={session.id}
      editingTheme={editingTheme}
      initialAppearance={session.initialAppearance}
      onClose={closeThemeEditor}
      onSaved={handleSaved}
      seedName={session.seedName ?? undefined}
      seedTheme={seedTheme}
    />
  );
}
