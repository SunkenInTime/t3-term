// Port of apps/web/src/components/settings/ThemeSettings.tsx (ThemeLibrary,
// ThemeLibraryCard). The grid holds the standard card, the five maintainer
// themes and the themes saved by the theme editor. Not ported: environment-
// published themes, collection cards (only theme import makes collections),
// and "Export theme file" (there is no browser download; the library is
// $T3TERM_HOME/themes.json).
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import {
  resolveActiveThemeId,
  resolveThemeAppearance,
  setAppearanceMode,
  systemDarkAtom,
  useCustomThemes,
  useThemeState,
} from "../../state/clientSettings.ts";
import { openThemeEditor } from "../../state/themeEditor.ts";
import { toast } from "../../ui/toast.tsx";
import { Dialog, Tooltip } from "../../ui/overlay.tsx";
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
  type ThemeDefinition,
} from "../../ui/theme.ts";
import { removeCustomThemes } from "../../web/themePalette.ts";
import { claimClick, consumeClaimedClick } from "../../sidebar/clickGuard.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { CustomThemeDialog } from "./CustomThemeDialog.tsx";
import { applyStandardTheme, assignHalf, ownerOf, setTheme, setThemeHalf } from "./themeActions.ts";
import {
  STANDARD_THEME_CARDS,
  ThemePreviewCircles,
  getThemeCardDefinition,
  getThemeModes,
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
  onEdit,
  onRemove,
  ringColor,
}: {
  theme: ThemeCardDefinition;
  activeModes: ReadonlyArray<ThemeMode>;
  onUse: () => void;
  onUseMode: (mode: ThemeMode) => void;
  onDuplicate: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
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
        onClick={() => {
          // web stops propagation on the card's buttons; gpuix clicks every hitbox under the pointer.
          if (consumeClaimedClick()) return;
          onUse();
        }}
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
          <div onMouseDown={claimClick} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <Tooltip content="Duplicate theme" side="top">
              <IconButton icon="copy" size={24} iconSize={14} onClick={onDuplicate} testId={`theme-duplicate-${card.id}`} />
            </Tooltip>
            {onEdit ? (
              <Tooltip content="Edit theme" side="top">
                <IconButton icon="pen-line" size={24} iconSize={14} onClick={onEdit} testId={`theme-edit-${card.id}`} />
              </Tooltip>
            ) : null}
            {onRemove ? (
              <Tooltip content="Remove theme" side="top">
                <IconButton
                  icon="trash-2"
                  size={24}
                  iconSize={14}
                  color={theme.errorForeground}
                  hoverBg={alpha(theme.error, 0.1)}
                  onClick={onRemove}
                  testId={`theme-remove-${card.id}`}
                />
              </Tooltip>
            ) : null}
          </div>
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
  const customThemes = useCustomThemes();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [themeRemovalTarget, setThemeRemovalTarget] = useState<ThemeDefinition | null>(null);

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

  const handleConfirmRemoveTheme = () => {
    if (!themeRemovalTarget) return;
    const removedId = themeRemovalTarget.id;
    const removesBase = getThemeDefinition(state.theme)?.id === removedId;
    // Captured before setTheme clears the mix.
    const storedHalves = state.halves ?? {};
    if (removesBase) setTheme(state.appearanceMode === "system" ? "system" : state.appearanceMode);
    for (const appearance of ["light", "dark"] as const) {
      const half = storedHalves[appearance];
      if (half === undefined) continue;
      const next = half === removedId ? null : removesBase ? half : undefined;
      if (next !== undefined) setThemeHalf(appearance, next);
    }
    try {
      removeCustomThemes([removedId]);
    } catch {
      toast({ type: "error", title: "Couldn’t remove theme", description: "Try again." });
      return;
    }
    setThemeRemovalTarget(null);
  };

  const cards: Array<{
    card: ThemeCardDefinition;
    ownerId: string | null;
    onUse: () => void;
    seedThemeId: string | null;
    custom?: ThemeDefinition;
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
    ...customThemes.map((definition) => ({
      card: getThemeCardDefinition(definition),
      ownerId: definition.id,
      onUse: () => {
        const modes = getThemeModes(definition);
        if (modes.length === 1) assignHalf(state, modes[0]!, definition.id);
        else setTheme(definition.id);
      },
      seedThemeId: definition.id,
      custom: definition,
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
              openThemeEditor({
                editingThemeId: null,
                seedThemeId: activeThemeForAppearance?.id ?? null,
                seedName: null,
                initialAppearance,
              })
            }
          >
            Create theme
          </Button>
          <Button size="xs" variant="outline" icon="plus" testId="theme-add" onClick={() => setIsImportOpen(true)}>
            Add theme
          </Button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} style={{ display: "flex", flexDirection: "row", gap: 8, width: "100%" }}>
            {row.map(({ card, ownerId, onUse, seedThemeId, custom }) => (
              <ThemeLibraryCard
                key={card.id}
                theme={card}
                activeModes={pickedModesFor(ownerId)}
                onUse={onUse}
                onUseMode={handlePairPick(ownerId)}
                onDuplicate={() =>
                  openThemeEditor({ editingThemeId: null, seedThemeId, seedName: `${card.label} copy`, initialAppearance })
                }
                {...(custom
                  ? {
                      onEdit: () =>
                        openThemeEditor({ editingThemeId: custom.id, seedThemeId: null, seedName: null, initialAppearance }),
                      onRemove: () => setThemeRemovalTarget(custom),
                    }
                  : {})}
                ringColor={ringColor}
              />
            ))}
            {/* A short last row keeps its cards a third of the width, like the web grid. */}
            {Array.from({ length: 3 - row.length }, (_, index) => (
              <div key={`spacer-${index}`} style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }} />
            ))}
          </div>
        ))}
      </div>
      <CustomThemeDialog open={isImportOpen} onClose={() => setIsImportOpen(false)} />
      <Dialog
        open={themeRemovalTarget !== null}
        onOpenChange={(open) => {
          if (!open) setThemeRemovalTarget(null);
        }}
        title={`Remove “${themeRemovalTarget?.label ?? ""}”?`}
        description="It is deleted from this device. t3-term cannot import theme files yet, so it can’t be brought back."
        testId="theme-remove-dialog"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setThemeRemovalTarget(null)} testId="theme-remove-cancel">
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleConfirmRemoveTheme} testId="theme-remove-confirm">
              Remove theme
            </Button>
          </>
        }
      />
    </div>
  );
}
