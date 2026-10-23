// Port of apps/web/src/components/settings/ThemeSettings.tsx (ThemeLibrary,
// ThemeLibraryCard). Custom, collection and environment-published themes are
// not resolvable in t3-term yet (see CustomThemeDialog.tsx), so the grid holds
// the standard card and the five maintainer themes.
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import {
  resolveActiveThemeId,
  resolveThemeAppearance,
  setAppearanceMode,
  systemDarkAtom,
  useThemeState,
} from "../../state/clientSettings.ts";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import {
  BUILT_IN_THEME_DEFINITIONS,
  RADIUS,
  alpha,
  cssColorToHex,
  getThemeColorsForMode,
  getThemeDefinition,
  useTheme,
  type ThemeAppearance,
} from "../../ui/theme.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { CustomThemeDialog, type CustomThemeDialogRequest } from "./CustomThemeDialog.tsx";
import { applyStandardTheme, assignHalf, ownerOf, setTheme } from "./themeActions.ts";
import {
  STANDARD_THEME_CARDS,
  ThemePreviewCircles,
  getThemeCardDefinition,
  previewColorsOf,
  type ThemeCardDefinition,
  type ThemeMode,
} from "./ThemePreviewCircles.tsx";
import { ThemeWireframe } from "./ThemeWireframe.tsx";

/** MAINTAINER_THEMES: T3 Chat, Grove, Ocean, Ember, Iris. */
const MAINTAINER_THEMES = (["t3-chat", "grove", "ocean", "ember", "iris"] as const).flatMap((id) => {
  const definition = BUILT_IN_THEME_DEFINITIONS.find((candidate) => candidate.id === id);
  return definition ? [definition] : [];
});

/**
 * `--ring`: the primary color, or the active theme's focus role
 * (index.css maps --ring to --app-theme-focus under a theme).
 */
export function useRingColor(): string {
  const theme = useTheme();
  const state = useThemeState();
  const systemDark = useAtomValue(systemDarkAtom);
  const appearance = resolveThemeAppearance(state, systemDark);
  const themeId = resolveActiveThemeId(state, appearance);
  const definition = themeId ? getThemeDefinition(themeId) : null;
  const colors = definition ? getThemeColorsForMode(definition, appearance) : null;
  return colors ? cssColorToHex(colors.focus) : theme.primary;
}

/** The appearance the app is painted in right now. */
export function useResolvedAppearance(): ThemeAppearance {
  const state = useThemeState();
  const systemDark = useAtomValue(systemDarkAtom);
  return resolveThemeAppearance(state, systemDark);
}

function ThemeLibraryCard({
  theme: card,
  activeModes,
  onUse,
  onUseMode,
  onDuplicate,
  ringColor,
}: {
  theme: ThemeCardDefinition;
  activeModes: ReadonlyArray<ThemeMode>;
  onUse: () => void;
  onUseMode: (mode: ThemeMode) => void;
  onDuplicate: () => void;
  ringColor: string;
}) {
  const theme = useTheme();
  const cardModes = card.previews.map((preview) => preview.mode);
  return (
    // The grid cell: the tooltip trigger does not pass flex sizing through.
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
    <Tooltip
      side="top"
      content={cardModes.length > 1 ? "Use for both light and dark" : `Use for ${cardModes[0]} mode only`}
    >
      <div
        testId={`theme-card-${card.id}`}
        onClick={onUse}
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.7),
          backgroundColor: alpha(theme.card, 0.6),
          cursor: "pointer",
          hover: { backgroundColor: alpha(theme.accent, 0.1) },
        }}
      >
        <ThemePreviewCircles
          cardId={card.id}
          activeModes={activeModes}
          onSelectMode={onUseMode}
          previews={card.previews}
          ringColor={ringColor}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 12,
          }}
        >
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <Text weight={500} truncate>
              {card.label}
            </Text>
          </div>
          <Tooltip content="Duplicate theme" side="top">
            <IconButton icon="copy" size={24} iconSize={14} onClick={onDuplicate} testId={`theme-duplicate-${card.id}`} />
          </Tooltip>
        </div>
      </div>
    </Tooltip>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  const theme = useTheme();
  return <Text color={alpha(theme.foreground, 0.7)}>{children}</Text>;
}

function ModeTile({
  mode,
  active,
  ringColor,
  onSelect,
  wireframeColors,
}: {
  mode: ThemeMode;
  active: boolean;
  ringColor: string;
  onSelect: () => void;
  wireframeColors: (appearance: ThemeAppearance) => ThemeCardDefinition["previews"][number]["colors"];
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const label = mode === "system" ? "System" : mode === "light" ? "Light" : "Dark";
  return (
    <div
      testId={`appearance-mode-${mode}`}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 6,
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        padding: 8,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: active ? ringColor : alpha(theme.border, 0.7),
        backgroundColor: active ? alpha(theme.accent, 0.3) : hover ? alpha(theme.accent, 0.1) : alpha(theme.card, 0.6),
        cursor: "pointer",
      }}
    >
      <ThemeWireframe
        panes={
          mode === "system"
            ? [
                { clip: "left", colors: wireframeColors("light") },
                { clip: "right", colors: wireframeColors("dark") },
              ]
            : [{ colors: wireframeColors(mode) }]
        }
      />
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", pointerEvents: "none" }}>
        <Text size="xs" weight={500} color={active ? theme.foreground : theme.mutedForeground}>
          {label}
        </Text>
      </div>
    </div>
  );
}

export function ThemeLibrary() {
  const state = useThemeState();
  const ringColor = useRingColor();
  const initialAppearance = useResolvedAppearance();
  const [dialog, setDialog] = useState<CustomThemeDialogRequest | null>(null);

  const lightOwner = ownerOf(state, "light");
  const darkOwner = ownerOf(state, "dark");
  const activeThemeForAppearance = getThemeDefinition((initialAppearance === "light" ? lightOwner : darkOwner) ?? "");

  const cardDefById = (id: string | null): ThemeCardDefinition => {
    if (id === null) return STANDARD_THEME_CARDS[0]!;
    const definition = getThemeDefinition(id);
    return definition ? getThemeCardDefinition(definition) : STANDARD_THEME_CARDS[0]!;
  };
  const pickColors = (id: string | null, appearance: ThemeAppearance) => {
    const card = cardDefById(id);
    return previewColorsOf(card, appearance) ?? card.previews[0]!.colors;
  };
  const wireframeColors = (appearance: ThemeAppearance) =>
    pickColors(appearance === "light" ? lightOwner : darkOwner, appearance);

  const pickedModesFor = (cardId: string | null): ThemeMode[] => {
    const rings: ThemeMode[] = [];
    if (lightOwner === cardId) rings.push("light");
    if (darkOwner === cardId) rings.push("dark");
    return rings;
  };
  const handlePairPick = (cardId: string | null) => (mode: ThemeMode) => {
    if (mode === "system") return;
    assignHalf(state, mode, cardId);
  };

  const cards: Array<{
    card: ThemeCardDefinition;
    ownerId: string | null;
    onUse: () => void;
    seedThemeId: string | null;
  }> = [
    ...STANDARD_THEME_CARDS.map((card) => ({
      card,
      ownerId: null,
      onUse: () => applyStandardTheme(state),
      seedThemeId: null,
    })),
    ...MAINTAINER_THEMES.map((definition) => ({
      card: getThemeCardDefinition(definition),
      ownerId: definition.id,
      onUse: () => setTheme(definition.id),
      seedThemeId: definition.id,
    })),
  ];
  // grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)) at the
  // settings width is three columns; gpuix grids are track counts, so rows
  // of three flex cells.
  const rows: Array<typeof cards> = [];
  for (let index = 0; index < cards.length; index += 3) rows.push(cards.slice(index, index + 3));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ paddingLeft: 16, paddingRight: 16 }}>
        <SectionHeading>{searchableSetting("color-scheme").title}</SectionHeading>
      </div>
      <div style={{ display: "flex", flexDirection: "row", gap: 12, width: "100%" }}>
        {(["system", "light", "dark"] as const).map((mode) => (
          <ModeTile
            key={mode}
            mode={mode}
            active={state.appearanceMode === mode}
            ringColor={ringColor}
            onSelect={() => setAppearanceMode(mode)}
            wireframeColors={wireframeColors}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          minHeight: 32,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 8,
        }}
      >
        <SectionHeading>{searchableSetting("theme").title}</SectionHeading>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            size="xs"
            variant="outline"
            icon="paintbrush"
            testId="theme-create"
            onClick={() =>
              setDialog({ kind: "create", seedThemeId: activeThemeForAppearance?.id ?? null, seedName: null })
            }
          >
            Create theme
          </Button>
          <Button size="xs" variant="outline" icon="plus" testId="theme-add" onClick={() => setDialog({ kind: "add" })}>
            Add theme
          </Button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} style={{ display: "flex", flexDirection: "row", gap: 8, width: "100%" }}>
            {row.map(({ card, ownerId, onUse, seedThemeId }) => (
              <ThemeLibraryCard
                key={card.id}
                theme={card}
                activeModes={pickedModesFor(ownerId)}
                onUse={onUse}
                onUseMode={handlePairPick(ownerId)}
                onDuplicate={() => setDialog({ kind: "create", seedThemeId, seedName: `${card.label} copy` })}
                ringColor={ringColor}
              />
            ))}
          </div>
        ))}
      </div>
      <CustomThemeDialog request={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
