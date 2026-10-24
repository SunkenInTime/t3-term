// Port of apps/web/src/components/settings/ThemeSettings.tsx (ThemeLibrary,
// ThemeLibraryCard, CustomThemeCollectionCard). The grid holds the standard card,
// the five maintainer themes, the themes the primary environment publishes, and
// saved themes, grouped into one card per imported collection.
//
// "Export theme file" has no browser download to trigger, so it writes the file
// into the Downloads folder (where a browser download lands) and says where.
// The collection card's variant fan opens without web's staggered transition.
import { useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";

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
import { useEnvironmentThemeDefinitions } from "../../web/hooks/useEnvironmentTheme.ts";
import { removeCustomThemes, singleAppearanceOf } from "../../web/themePalette.ts";
import { Icon } from "../../ui/Icon.tsx";
import { CustomThemeCollectionCard, exportThemeFile } from "./ThemeCollectionCard.tsx";
import { claimClick, consumeClaimedClick } from "../../sidebar/clickGuard.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { ThemeImportDialog } from "./ThemeImportDialog.tsx";
import { applyStandardTheme, assignHalf, ownerOf, setTheme, setThemeHalf } from "./themeActions.ts";
import {
  STANDARD_THEME_CARDS,
  ThemePreviewCircle,
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
  onDownload,
  onRemove,
  ringColor,
  collection,
}: {
  theme: ThemeCardDefinition;
  activeModes: ReadonlyArray<ThemeMode>;
  onUse: () => void;
  onUseMode: (mode: ThemeMode) => void;
  onDuplicate: () => void;
  onEdit?: () => void;
  onDownload?: () => void;
  onRemove?: () => void;
  ringColor: string;
  /** A multi-variant collection: its label and the variant fan replace the theme's own. */
  collection?: { label: string; previews: ReactNode };
}) {
  const theme = useTheme();
  const cardModes = card.previews.map((preview) => preview.mode);
  return (
    // The grid cell: the tooltip trigger does not pass flex sizing through.
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
    <Tooltip
      side="top"
      content={
        collection
          ? "Use the first variants for light and dark"
          : cardModes.length > 1
            ? "Use for both light and dark"
            : `Use for ${cardModes[0]} mode only`
      }
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
        {collection ? (
          collection.previews
        ) : (
          <ThemePreviewCircles
            cardId={card.id}
            activeModes={activeModes}
            onSelectMode={onUseMode}
            previews={card.previews}
            ringColor={ringColor}
          />
        )}
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
              {collection?.label ?? card.label}
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
            {onDownload ? (
              <Tooltip content="Export theme file" side="top">
                <IconButton icon="upload" size={24} iconSize={14} onClick={onDownload} testId={`theme-export-${card.id}`} />
              </Tooltip>
            ) : null}
            {onRemove ? (
              <Tooltip content={collection ? "Remove themes" : "Remove theme"} side="top">
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
  const environmentThemes = useEnvironmentThemeDefinitions();
  const [themeRemovalTarget, setThemeRemovalTarget] = useState<{
    theme: ThemeDefinition;
    collectionThemes: ReadonlyArray<ThemeDefinition>;
  } | null>(null);
  const [themeIdsToRemove, setThemeIdsToRemove] = useState<ReadonlyArray<string>>([]);
  const removeDialogTheme = themeRemovalTarget?.theme;
  const removeDialogCollectionThemes = themeRemovalTarget?.collectionThemes ?? [];
  const canRemoveCollection = removeDialogCollectionThemes.length > 1;
  const removeDialogCollectionLabel = removeDialogTheme?.collection?.label ?? removeDialogTheme?.label;
  const handleRemoveTheme = (customTheme: ThemeDefinition, collectionThemes: ReadonlyArray<ThemeDefinition>) => {
    setThemeRemovalTarget({ theme: customTheme, collectionThemes });
    setThemeIdsToRemove(collectionThemes.length > 1 ? [] : [customTheme.id]);
  };

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
    const removedIds = new Set(themeIdsToRemove);
    if (removedIds.size === 0) return;
    const removesBase = removedIds.has(getThemeDefinition(state.theme)?.id ?? "");
    // Captured before setTheme clears the mix.
    const storedHalves = state.halves ?? {};
    if (removesBase) setTheme(state.appearanceMode === "system" ? "system" : state.appearanceMode);
    for (const appearance of ["light", "dark"] as const) {
      const half = storedHalves[appearance];
      if (half === undefined) continue;
      const next = half && removedIds.has(half) ? null : removesBase ? half : undefined;
      if (next !== undefined) setThemeHalf(appearance, next);
    }
    try {
      removeCustomThemes([...removedIds]);
    } catch {
      toast({ type: "error", title: "Couldn’t remove theme", description: "Try again." });
      return;
    }
    setThemeRemovalTarget(null);
  };

  const duplicate = (seedThemeId: string | null, label: string) =>
    openThemeEditor({ editingThemeId: null, seedThemeId, seedName: `${label} copy`, initialAppearance });
  const edit = (definition: ThemeDefinition) =>
    openThemeEditor({ editingThemeId: definition.id, seedThemeId: null, seedName: null, initialAppearance });
  const useCustom = (definition: ThemeDefinition) => {
    const modes = getThemeModes(definition);
    if (modes.length === 1) assignHalf(state, modes[0]!, definition.id);
    else setTheme(definition.id);
  };
  // Saved themes group by collection: one card per imported extension.
  const customThemeCollections = [
    ...customThemes
      .reduce((groups, customTheme) => {
        const groupId = customTheme.collection ? `collection:${customTheme.collection.id}` : `theme:${customTheme.id}`;
        const group = groups.get(groupId);
        if (group) group.push(customTheme);
        else groups.set(groupId, [customTheme]);
        return groups;
      }, new Map<string, ThemeDefinition[]>())
      .entries(),
  ];
  const cells: Array<{ key: string; node: ReactNode }> = [
    ...STANDARD_THEME_CARDS.map((card) => ({
      key: card.id,
      node: (
        <ThemeLibraryCard
          theme={card}
          activeModes={pickedModesFor(null)}
          onUse={() => applyStandardTheme(state)}
          onUseMode={handlePairPick(null)}
          onDuplicate={() => duplicate(null, card.label)}
          ringColor={ringColor}
        />
      ),
    })),
    ...MAINTAINER_THEMES.map((definition) => ({
      key: definition.id,
      node: (
        <ThemeLibraryCard
          theme={getThemeCardDefinition(definition)}
          activeModes={pickedModesFor(definition.id)}
          onUse={() => setTheme(definition.id)}
          onUseMode={handlePairPick(definition.id)}
          onDuplicate={() => duplicate(definition.id, definition.label)}
          ringColor={ringColor}
        />
      ),
    })),
    // A saved theme with the same id wins resolution, so its card is the one that shows.
    ...environmentThemes
      .filter((environmentTheme) => !customThemes.some((candidate) => candidate.id === environmentTheme.id))
      .map((environmentTheme) => ({
        key: `environment:${environmentTheme.id}`,
        node: (
          <ThemeLibraryCard
            theme={getThemeCardDefinition(environmentTheme)}
            activeModes={pickedModesFor(environmentTheme.id)}
            onUse={() => {
              const half = singleAppearanceOf(environmentTheme);
              if (half === null) setTheme(environmentTheme.id);
              else assignHalf(state, half, environmentTheme.id);
            }}
            onUseMode={handlePairPick(environmentTheme.id)}
            onDuplicate={() => duplicate(environmentTheme.id, environmentTheme.label)}
            ringColor={ringColor}
          />
        ),
      })),
    ...customThemeCollections.map(([collectionId, themes]) => ({
      key: collectionId,
      node: (
        <CustomThemeCollectionCard
          themes={themes}
          activeModesFor={pickedModesFor}
          ringColor={ringColor}
          renderCard={(props) => <ThemeLibraryCard {...props} ringColor={ringColor} />}
          onUse={useCustom}
          onUseMode={(definition, mode) => handlePairPick(definition.id)(mode)}
          onDuplicate={(definition) => duplicate(definition.id, definition.label)}
          onEdit={edit}
          onDownload={exportThemeFile}
          onRemove={(definition) => handleRemoveTheme(definition, themes)}
        />
      ),
    })),
  ];
  // grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)) at the
  // settings width is three columns; gpuix grids are track counts, so rows
  // of three flex cells.
  const rows: Array<typeof cells> = [];
  for (let index = 0; index < cells.length; index += 3) rows.push(cells.slice(index, index + 3));

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
            {row.map(({ key, node }) => (
              <div key={key} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                {node}
              </div>
            ))}
            {/* A short last row keeps its cards a third of the width, like the web grid. */}
            {Array.from({ length: 3 - row.length }, (_, index) => (
              <div key={`spacer-${index}`} style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }} />
            ))}
          </div>
        ))}
      </div>
      <ThemeImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onImportedMany={(importedThemes, { updated }) => {
          const verb = updated ? "updated" : "added";
          toast({
            type: "success",
            title: importedThemes.length === 1 ? `${importedThemes[0]!.label} ${verb}` : `${importedThemes.length} themes ${verb}`,
            description: importedThemes.map((imported) => imported.label).join(", "),
          });
        }}
        onImported={(importedTheme) => {
          const modes = getThemeModes(importedTheme);
          if (modes.length === 1) {
            assignHalf(state, modes[0]!, importedTheme.id);
            toast({ type: "success", title: `${importedTheme.label} added`, description: `It’s now your ${modes[0]!} theme.` });
            return true;
          }
          setTheme(importedTheme.id);
          toast({ type: "success", title: `${importedTheme.label} added`, description: "It’s now active." });
          return true;
        }}
      />
      <Dialog
        open={themeRemovalTarget !== null}
        onOpenChange={(open) => {
          if (!open) setThemeRemovalTarget(null);
        }}
        title={canRemoveCollection ? `Remove themes from “${removeDialogCollectionLabel ?? ""}”?` : `Remove “${removeDialogTheme?.label ?? ""}”?`}
        description={
          canRemoveCollection
            ? "Select the variants you want to remove. You can restore them by importing the extension again."
            : "You can bring it back anytime by importing its JSON file."
        }
        testId="theme-remove-dialog"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setThemeRemovalTarget(null)} testId="theme-remove-cancel">
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={themeIdsToRemove.length === 0} onClick={handleConfirmRemoveTheme} testId="theme-remove-confirm">
              {canRemoveCollection ? `Remove selected${themeIdsToRemove.length > 0 ? ` (${themeIdsToRemove.length})` : ""}` : "Remove theme"}
            </Button>
          </>
        }
      >
        {canRemoveCollection ? <VariantRemovalGrid themes={removeDialogCollectionThemes} selected={themeIdsToRemove} onChange={setThemeIdsToRemove} /> : null}
      </Dialog>
    </div>
  );
}

/** The collection removal dialog's checkbox cards (`grid sm:grid-cols-2 max-h-72`). */
function VariantRemovalGrid({
  themes,
  selected,
  onChange,
}: {
  themes: ReadonlyArray<ThemeDefinition>;
  selected: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}) {
  const theme = useTheme();
  const rows: Array<ReadonlyArray<ThemeDefinition>> = [];
  for (let index = 0; index < themes.length; index += 2) rows.push(themes.slice(index, index + 2));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 288, overflowY: "scroll" }}>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          {row.map((variant) => {
            const checked = selected.includes(variant.id);
            const card = getThemeCardDefinition(variant);
            return (
              <div
                key={variant.id}
                testId={`theme-remove-variant-${variant.id}`}
                onClick={() => onChange(checked ? selected.filter((id) => id !== variant.id) : [...selected, variant.id])}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  flexGrow: 1,
                  flexBasis: 0,
                  minWidth: 0,
                  minHeight: 112,
                  padding: 12,
                  borderRadius: RADIUS.lg,
                  borderWidth: 1,
                  borderColor: checked ? theme.primary : alpha(theme.border, 0.7),
                  backgroundColor: checked ? alpha(theme.accent, 0.2) : alpha(theme.muted, 0.25),
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    right: 8,
                    top: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    borderWidth: checked ? 0 : 1,
                    borderColor: theme.input,
                    backgroundColor: checked ? theme.primary : theme.background,
                    pointerEvents: "none",
                  }}
                >
                  {checked ? <Icon name="check" size={12} color={theme.primaryForeground} /> : null}
                </div>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48, pointerEvents: "none" }}>
                  {card.previews.map((preview) => (
                    <ThemePreviewCircle key={preview.mode} colors={preview.colors} mode={preview.mode} size={42} />
                  ))}
                </div>
                <Text weight={500} truncate style={{ pointerEvents: "none" }}>
                  {variant.label}
                </Text>
              </div>
            );
          })}
          {row.length === 1 ? <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }} /> : null}
        </div>
      ))}
    </div>
  );
}
