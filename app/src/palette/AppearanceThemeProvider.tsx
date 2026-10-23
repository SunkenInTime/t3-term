// Feeds the palette resolved from the appearance mode and theme selection
// (state/appearance.ts) into ThemeContext.
import { useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";

import { resolvedPaletteAtom } from "../state/appearance.ts";
import { ThemeContext } from "../ui/theme.ts";

export function AppearanceThemeProvider({ children }: { children: ReactNode }) {
  const palette = useAtomValue(resolvedPaletteAtom);
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>;
}
