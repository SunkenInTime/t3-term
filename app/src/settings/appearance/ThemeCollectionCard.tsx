// ThemeSettings.tsx's collection pieces: collectionVariantLabels, the variant fan of
// ThemeLibraryCard (variantNavigation), CustomThemeCollectionCard, and the export
// web does as a browser download.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { useState, type ReactNode } from "react";

import { claimClick } from "../../sidebar/clickGuard.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { alpha, useTheme, type ThemeAppearance, type ThemeDefinition } from "../../ui/theme.ts";
import { serializeThemeFile } from "../../web/themePalette.ts";
import { ThemePreviewCircle, getThemeCardDefinition, getThemeModes, type ThemeCardDefinition, type ThemeMode } from "./ThemePreviewCircles.tsx";

export function collectionVariantLabels(themes: ReadonlyArray<ThemeDefinition>): ReadonlyArray<string> {
  if (themes.length === 0) return [];
  const words = themes.map((candidate) => candidate.label.trim().split(/\s+/));
  const firstWords = words[0]!;
  const sharedWordCount = firstWords.findIndex((word, index) =>
    words.some((labelWords) => labelWords[index]?.toLocaleLowerCase() !== word.toLocaleLowerCase()),
  );
  const prefixLength = sharedWordCount === -1 ? firstWords.length - 1 : sharedWordCount;
  return themes.map((candidate, index) => {
    const shortLabel = words[index]?.slice(Math.max(0, prefixLength)).join(" ").trim();
    return shortLabel || candidate.label;
  });
}

/** web downloadThemeFile: the Downloads folder stands in for the browser's download. */
export function exportThemeFile(definition: ThemeDefinition): void {
  const downloads = NodePath.join(NodeOS.homedir(), "Downloads");
  const directory = NodeFS.existsSync(downloads) ? downloads : NodeOS.homedir();
  let target = NodePath.join(directory, `${definition.id}.json`);
  for (let copy = 1; NodeFS.existsSync(target) && copy < 100; copy += 1) {
    target = NodePath.join(directory, `${definition.id} (${copy}).json`);
  }
  try {
    NodeFS.writeFileSync(target, serializeThemeFile(definition));
    toast({ type: "success", title: `${definition.label} exported`, description: target });
  } catch (error) {
    toast({ type: "error", title: "Couldn’t export theme", description: error instanceof Error ? error.message : "Try again." });
  }
}

type VariantOption = {
  readonly themeIndex: number;
  readonly label: string;
  readonly activeModes: ReadonlyArray<ThemeMode>;
  readonly preview: ThemeCardDefinition["previews"][number];
};

/**
 * One disc per appearance showing that appearance's selected variant; hovering a
 * disc fans out the collection's other variants for it (web staggers them in with
 * a transition; here they appear at once).
 */
function CollectionVariantFan({
  cardId,
  options,
  ringColor,
  onSelectAndUse,
}: {
  cardId: string;
  options: ReadonlyArray<VariantOption>;
  ringColor: string;
  onSelectAndUse: (themeIndex: number, mode: ThemeAppearance) => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [openMode, setOpenMode] = useState<ThemeAppearance | null>(null);
  const center = width / 2;
  const groups = (["light", "dark"] as const).map((mode) => {
    const modeOptions = options.filter((option) => option.preview.mode === mode);
    return { mode, options: modeOptions, selected: modeOptions.find((option) => option.activeModes.includes(mode)) ?? modeOptions[0] };
  });
  return (
    <div onLayout={(event) => setWidth(event.width ?? 0)} onMouseLeave={() => setOpenMode(null)} style={{ position: "relative", width: "100%", height: 80, marginTop: 4 }}>
      {width > 0
        ? groups.flatMap(({ mode, options: modeOptions, selected }) => {
            if (!selected) return [];
            const rootOffsetX = mode === "light" ? -52 : 52;
            const isActive = selected.activeModes.includes(mode);
            const modeLabel = mode === "light" ? "Light" : "Dark";
            const nodes: ReactNode[] = [
              <div
                key={`${mode}-label`}
                style={{
                  position: "absolute",
                  left: center + rootOffsetX - 48,
                  width: 96,
                  bottom: 0,
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 4,
                  pointerEvents: "none",
                }}
              >
                <Text size="2xs" weight={500} truncate>
                  {selected.label}
                </Text>
                {modeOptions.length > 1 ? (
                  <div style={{ display: "flex", paddingLeft: 4, paddingRight: 4, borderRadius: 999, backgroundColor: theme.muted, flexShrink: 0 }}>
                    <Text size="3xs" color={theme.mutedForeground}>{`+${modeOptions.length - 1}`}</Text>
                  </div>
                ) : null}
              </div>,
              <div key={`${mode}-root`} style={{ position: "absolute", left: center + rootOffsetX - 28, top: 8, width: 56, height: 56 }}>
                <Tooltip content={`${modeLabel}: ${selected.label}`} side="top">
                  <div
                    testId={`theme-${cardId}-${mode}`}
                    onMouseDown={claimClick}
                    onMouseEnter={() => setOpenMode(mode)}
                    onClick={() => onSelectAndUse(selected.themeIndex, mode)}
                    style={{ position: "relative", width: 56, height: 56, borderRadius: 28, cursor: "pointer" }}
                  >
                    <ThemePreviewCircle colors={selected.preview.colors} mode={mode} />
                    {isActive ? (
                      <div style={{ position: "absolute", left: 0, top: 0, width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: ringColor, pointerEvents: "none" }} />
                    ) : null}
                    {isActive ? (
                      <div
                        style={{
                          position: "absolute",
                          right: -2,
                          bottom: -2,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 16,
                          height: 16,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: alpha(theme.border, 0.7),
                          backgroundColor: theme.background,
                          pointerEvents: "none",
                        }}
                      >
                        <Icon name={mode === "light" ? "sun" : "moon"} size={10} color={theme.foreground} />
                      </div>
                    ) : null}
                  </div>
                </Tooltip>
              </div>,
            ];
            if (openMode === mode && modeOptions.length > 1) {
              modeOptions.forEach((option, optionIndex) => {
                const progress = optionIndex / (modeOptions.length - 1) - 0.5;
                const childOffsetX = rootOffsetX + progress * 68;
                const childOffsetY = Math.abs(progress) * 10;
                const optionIsActive = option.activeModes.includes(mode);
                nodes.push(
                  <div key={`${mode}-${option.themeIndex}`} style={{ position: "absolute", left: center + childOffsetX - 14, top: 4 + childOffsetY, width: 28, height: 28 }}>
                    <Tooltip content={`Use ${option.label} for ${mode} mode`} side="top">
                      <div
                        testId={`theme-${cardId}-${mode}-variant-${optionIndex}`}
                        onMouseDown={claimClick}
                        onMouseEnter={() => setOpenMode(mode)}
                        onClick={() => onSelectAndUse(option.themeIndex, mode)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: theme.background,
                          borderWidth: optionIsActive ? 2 : 1,
                          borderColor: optionIsActive ? ringColor : alpha(theme.border, 0.7),
                          boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "#0000001a" },
                          cursor: "pointer",
                        }}
                      >
                        <ThemePreviewCircle colors={option.preview.colors} mode={mode} size={22} />
                      </div>
                    </Tooltip>
                  </div>,
                );
              });
            }
            return nodes;
          })
        : null}
    </div>
  );
}

export type ThemeCardRenderer = (props: {
  theme: ThemeCardDefinition;
  activeModes: ReadonlyArray<ThemeMode>;
  onUse: () => void;
  onUseMode: (mode: ThemeMode) => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onRemove: () => void;
  collection?: { label: string; previews: ReactNode };
}) => ReactNode;

/** ThemeSettings.tsx CustomThemeCollectionCard: one card for a saved theme or a whole collection. */
export function CustomThemeCollectionCard({
  themes,
  activeModesFor,
  ringColor,
  renderCard,
  onUse,
  onUseMode,
  onDuplicate,
  onEdit,
  onDownload,
  onRemove,
}: {
  themes: ReadonlyArray<ThemeDefinition>;
  activeModesFor: (themeId: string) => ReadonlyArray<ThemeMode>;
  ringColor: string;
  renderCard: ThemeCardRenderer;
  onUse: (theme: ThemeDefinition) => void;
  onUseMode: (theme: ThemeDefinition, mode: ThemeMode) => void;
  onDuplicate: (theme: ThemeDefinition) => void;
  onEdit: (theme: ThemeDefinition) => void;
  onDownload: (theme: ThemeDefinition) => void;
  onRemove: (theme: ThemeDefinition) => void;
}) {
  const [variantIndex, setVariantIndex] = useState(() => {
    const activeIndex = themes.findIndex((candidate) => activeModesFor(candidate.id).length > 0);
    return activeIndex < 0 ? 0 : activeIndex;
  });
  const safeIndex = Math.min(variantIndex, themes.length - 1);
  const current = themes[safeIndex];
  if (variantIndex !== safeIndex) setVariantIndex(safeIndex);
  if (!current) return null;
  const card = getThemeCardDefinition(current);
  const variantLabels = collectionVariantLabels(themes);
  const defaultLightTheme = themes.find((candidate) => getThemeModes(candidate).includes("light"));
  const defaultDarkTheme = themes.find((candidate) => getThemeModes(candidate).includes("dark"));
  const selectCollectionDefaults = () => {
    if (themes.length === 1) {
      onUse(current);
      return;
    }
    if (defaultLightTheme) onUseMode(defaultLightTheme, "light");
    if (defaultDarkTheme) onUseMode(defaultDarkTheme, "dark");
    setVariantIndex(0);
  };
  return renderCard({
    theme: card,
    activeModes: activeModesFor(current.id),
    onUse: selectCollectionDefaults,
    onUseMode: (mode) => onUseMode(current, mode),
    onDuplicate: () => onDuplicate(current),
    onEdit: () => onEdit(current),
    onDownload: () => onDownload(current),
    onRemove: () => onRemove(current),
    ...(themes.length > 1
      ? {
          collection: {
            label: current.collection?.label ?? current.label,
            previews: (
              <CollectionVariantFan
                cardId={card.id}
                ringColor={ringColor}
                options={themes.flatMap((variant, themeIndex) =>
                  getThemeCardDefinition(variant).previews.map((preview) => ({
                    themeIndex,
                    label: variantLabels[themeIndex] ?? variant.label,
                    activeModes: activeModesFor(variant.id),
                    preview,
                  })),
                )}
                onSelectAndUse={(themeIndex, mode) => {
                  const selected = themes[themeIndex];
                  if (!selected) return;
                  setVariantIndex(themeIndex);
                  onUseMode(selected, mode);
                }}
              />
            ),
          },
        }
      : {}),
  });
}
