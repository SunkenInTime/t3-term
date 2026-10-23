// apps/web/src/components/chat/ModelPickerContent.tsx: the model picker popover body.
// Provider rail on the left, search + model list on the right. Web drives the list
// with a Base UI Combobox; here the search input owns the keyboard (Up/Down move the
// highlight, Enter picks it) and rows highlight on hover, which is what Combobox does.
import { useAtomValue } from "@effect/atom-react";
import { useGpuix, type KeyEvent, type PublicInstance } from "@gpuix/react";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type EnvironmentId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ResolvedKeybindingsConfig,
  type ServerConfig,
} from "@t3tools/contracts";
import { formatProviderUpdateRequiredNotice } from "@t3tools/client-runtime/providerUpdateRequiredModels";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { Atom } from "effect/reactivity";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { serverEnvironment } from "../../state/environment.ts";
import { commandPaletteOpenAtom, routeAtom, terminalOpenAtom } from "../../state/ui.ts";
import { Icon } from "../../ui/Icon.tsx";
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import {
  adjacentModelPickerProvider,
  resolveModelPickerSelectedModel,
  shouldIncludeModelPickerOption,
  shouldOfferModelPickerSetup,
  type ModelPickerItem,
} from "../../web/components/chat/ModelPickerContent.logic.ts";
import {
  modelPickerLegacySectionKey,
  modelPickerModelKey,
  parseModelPickerLegacySectionKey,
  parseModelPickerModelKey,
} from "../../web/components/chat/modelPickerKeys.ts";
import { rankModelPickerSearch } from "../../web/components/chat/modelPickerSearch.ts";
import { getProviderStatusMessage } from "../../web/components/chat/ProviderStatusBanner.logic.ts";
import type { ModelEsque } from "../../web/components/chat/providerIconUtils.ts";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  type ShortcutEventLike,
} from "../../web/keybindings.ts";
import { providerModelKey, sortProviderModelItems } from "../../web/modelOrdering.ts";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  type ProviderInstanceEntry,
} from "../../web/providerInstances.ts";
import { useModelPickerFavorites } from "./ModelPickerFavorites.ts";
import { ModelPickerLegacyRow, ModelPickerListRow } from "./ModelPickerListRow.tsx";
import { ModelPickerSidebar } from "./ModelPickerSidebar.tsx";

/** `max-w-90`, `max-h-86.5`. */
export const MODEL_PICKER_WIDTH = 360;
export const MODEL_PICKER_MAX_HEIGHT = 346;
const ROW_GAP = 2;
const ROW_HEIGHT = 45;
/** Search block: pt 9 + 26px input + pb 6 + 1px rule, then the list's own 10px top padding. */
const SEARCH_BLOCK_HEIGHT = 42;
const LIST_PADDING_Y = 10;
const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

export const SHORTCUT_PLATFORM =
  process.platform === "darwin" ? "MacIntel" : process.platform === "win32" ? "Win32" : "Linux x86_64";

const GPUIX_KEY_NAMES: Readonly<Record<string, string>> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  escape: "Escape",
  enter: "Enter",
  space: " ",
  tab: "Tab",
  backspace: "Backspace",
};

/** gpuix key events name keys GPUI-style ("up", "k"); shared keybindings expect DOM names. */
export function shortcutEventFromGpuix(event: KeyEvent): ShortcutEventLike {
  const modifiers = event.modifiers;
  return {
    key: GPUIX_KEY_NAMES[event.key ?? ""] ?? event.key ?? "",
    metaKey: modifiers?.cmd === true,
    ctrlKey: modifiers?.ctrl === true,
    shiftKey: modifiers?.shift === true,
    altKey: modifiers?.alt === true,
    repeat: event.isHeld === true,
  };
}

function modelJumpLabelsByKey(
  modelKeys: ReadonlyArray<string>,
  keybindings: ResolvedKeybindingsConfig,
  terminalOpen: boolean,
): ReadonlyMap<string, string> {
  const options = {
    platform: SHORTCUT_PLATFORM,
    context: { terminalFocus: false, terminalOpen, modelPickerOpen: true },
  };
  const mapping = new Map<string, string>();
  for (const [index, modelKey] of modelKeys.entries()) {
    const command = modelPickerJumpCommandForIndex(index);
    const label = command && shortcutLabelForCommand(keybindings, command, options);
    if (label) mapping.set(modelKey, label);
  }
  return mapping;
}

export interface ModelPickerContentProps {
  readonly environmentId: EnvironmentId | null;
  readonly activeInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly lockedContinuationGroupKey?: string | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly keybindings?: ResolvedKeybindingsConfig | undefined;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly onRequestClose?: () => void;
  readonly onOpenProviderSetup?: ((instanceId: ProviderInstanceId) => void) | undefined;
  readonly getModelDisabledReason?: ((instanceId: ProviderInstanceId, model: string) => string | null) | undefined;
  readonly onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}

export const ModelPickerContent = memo(function ModelPickerContent(props: ModelPickerContentProps) {
  const {
    modelOptionsByInstance,
    instanceEntries,
    getModelDisabledReason,
    onInstanceModelChange,
    onRequestClose,
    onOpenProviderSetup,
  } = props;
  const theme = useTheme();
  const { renderer } = useGpuix();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(true);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchInputRef = useRef<PublicInstance | null>(null);
  const rowRefs = useRef(new Map<string, PublicInstance>());
  const restingHeightRef = useRef(0);
  const [searchHeight, setSearchHeight] = useState(0);
  const { favorites, favoriteKeys: favoritesSet, toggleFavorite } = useModelPickerFavorites(props.environmentId);
  const config = useAtomValue(
    props.environmentId ? serverEnvironment.configValueAtom(props.environmentId) : NO_CONFIG_ATOM,
  );
  const keybindings = props.keybindings ?? config?.keybindings ?? EMPTY_KEYBINDINGS;
  const terminalOpen = useAtomValue(terminalOpenAtom);

  const activeEntry = instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId);
  const activeModel = resolveModelPickerSelectedModel({
    driverKind: activeEntry?.driverKind,
    model: props.model,
    options: modelOptionsByInstance.get(props.activeInstanceId) ?? [],
  });
  const activeModelSlug = activeModel?.slug ?? (props.model === ANTIGRAVITY_DEFAULT_MODEL ? "" : props.model);
  const activeModelKey = activeModelSlug ? modelPickerModelKey(props.activeInstanceId, activeModelSlug) : null;
  const activeInstanceHasSelectableUnavailableModel =
    activeEntry !== undefined &&
    (modelOptionsByInstance.get(props.activeInstanceId) ?? []).some((option) =>
      shouldIncludeModelPickerOption({
        entry: activeEntry,
        option,
        activeInstanceId: props.activeInstanceId,
        activeModel: activeModelSlug,
      }),
    ) &&
    !isProviderInstancePickerReady(activeEntry);
  const activeInstanceNeedsSetup =
    onOpenProviderSetup !== undefined &&
    activeEntry !== undefined &&
    shouldOfferModelPickerSetup(activeEntry, modelOptionsByInstance.get(props.activeInstanceId) ?? []);
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | "favorites">(() => {
    if (props.lockedProvider !== null || activeInstanceHasSelectableUnavailableModel || activeInstanceNeedsSetup) {
      return props.activeInstanceId;
    }
    return favorites.length > 0 ? "favorites" : props.activeInstanceId;
  });
  const [expandedLegacyInstances, setExpandedLegacyInstances] = useState(
    () =>
      new Set<ProviderInstanceId>(
        activeModel?.isLegacy && !favoritesSet.has(providerModelKey(props.activeInstanceId, activeModelSlug))
          ? [props.activeInstanceId]
          : [],
      ),
  );

  const focusSearchInput = useCallback(() => {
    const input = searchInputRef.current;
    if (input) renderer?.focusElement?.(input.id);
  }, [renderer]);

  const handleSelectInstance = (instanceId: ProviderInstanceId | "favorites") => {
    setSelectedInstanceId(instanceId);
    setHighlightedIndex(-1);
    focusSearchInput();
  };

  const toggleLegacySection = (instanceId: ProviderInstanceId) => {
    setExpandedLegacyInstances((expanded) => {
      const next = new Set(expanded);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  };

  const handleModelSelect = (modelSlug: string, instanceId: ProviderInstanceId) => {
    if (getModelDisabledReason?.(instanceId, modelSlug)) return;
    const options = modelOptionsByInstance.get(instanceId);
    if (!options) return;
    const entry = instanceEntries.find((candidate) => candidate.instanceId === instanceId);
    if (!entry) return;
    const resolvedModel = resolveSelectableModel(entry.driverKind, modelSlug, options);
    if (resolvedModel) onInstanceModelChange(instanceId, resolvedModel);
  };

  const lockedProvider = props.lockedProvider;
  const lockedContinuationGroupKey = props.lockedContinuationGroupKey;
  const canOpenProviderSetup = onOpenProviderSetup !== undefined;
  const entryByInstanceId = new Map(instanceEntries.map((entry) => [entry.instanceId, entry]));
  const matchesLockedProvider = (entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">) => {
    if (lockedProvider === null) return true;
    if (entry.driverKind !== lockedProvider) return false;
    if (!lockedContinuationGroupKey) return true;
    return entry.continuationGroupKey === lockedContinuationGroupKey;
  };

  const selectableUnavailableInstanceIds = (() => {
    const instanceIds = new Set<ProviderInstanceId>();
    if (activeInstanceHasSelectableUnavailableModel) instanceIds.add(props.activeInstanceId);
    if (canOpenProviderSetup) {
      for (const entry of instanceEntries) {
        if (shouldOfferModelPickerSetup(entry, modelOptionsByInstance.get(entry.instanceId) ?? [])) {
          instanceIds.add(entry.instanceId);
        }
      }
    }
    return instanceIds.size > 0 ? instanceIds : undefined;
  })();

  const flatModels: ModelPickerItem[] = [];
  for (const [instanceId, models] of modelOptionsByInstance) {
    const entry = entryByInstanceId.get(instanceId);
    if (!entry) continue;
    for (const model of models) {
      if (
        !shouldIncludeModelPickerOption({
          entry,
          option: model,
          activeInstanceId: props.activeInstanceId,
          activeModel: activeModelSlug,
        })
      ) {
        continue;
      }
      flatModels.push({
        slug: model.slug,
        name: model.name,
        ...(model.shortName ? { shortName: model.shortName } : {}),
        ...(model.subProvider ? { subProvider: model.subProvider } : {}),
        ...(model.badge ? { badge: model.badge } : {}),
        ...(model.isLegacy ? { isLegacy: true } : {}),
        ...(model.isUnavailable ? { isUnavailable: true } : {}),
        instanceId,
        driverKind: entry.driverKind,
        instanceDisplayName: entry.displayName,
        ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
        ...(entry.continuationGroupKey ? { continuationGroupKey: entry.continuationGroupKey } : {}),
      });
    }
  }

  const isLocked = lockedProvider !== null;
  const isSearching = searchQuery.trim().length > 0;
  const lockedDisabledInstanceIds = (() => {
    if (!isLocked) return undefined;
    const disabled = new Set<ProviderInstanceId>();
    for (const entry of instanceEntries) {
      if (!matchesLockedProvider(entry)) disabled.add(entry.instanceId);
    }
    return disabled;
  })();
  const sidebarInstanceEntries = (() => {
    const enabledEntries = instanceEntries.filter(isProviderInstancePickerVisible);
    if (!isLocked) return enabledEntries;
    const available: ProviderInstanceEntry[] = [];
    const disabled: ProviderInstanceEntry[] = [];
    for (const entry of enabledEntries) {
      (matchesLockedProvider(entry) ? available : disabled).push(entry);
    }
    return [...available, ...disabled];
  })();
  const showSidebar = !isSearching && sidebarInstanceEntries.length > 0;
  const instanceOrder = instanceEntries.map((entry) => entry.instanceId);

  const filteredModels = (() => {
    let result = flatModels;
    if (isSearching) {
      const candidates = lockedProvider !== null ? result.filter((m) => matchesLockedProvider(m)) : result;
      return rankModelPickerSearch(candidates, searchQuery, (model) => ({
        name: model.name,
        ...(model.shortName ? { shortName: model.shortName } : {}),
        ...(model.subProvider ? { subProvider: model.subProvider } : {}),
        driverKind: model.driverKind,
        providerDisplayName: model.instanceDisplayName,
        isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
      }));
    }
    if (lockedProvider !== null) result = result.filter((m) => matchesLockedProvider(m));
    result =
      selectedInstanceId === "favorites"
        ? result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)))
        : result.filter((m) => m.instanceId === selectedInstanceId);
    return sortProviderModelItems(result, {
      favoriteModelKeys: favoritesSet,
      groupFavorites: selectedInstanceId !== "favorites",
      instanceOrder: selectedInstanceId === "favorites" ? instanceOrder : [],
    });
  })();

  const legacySection = (() => {
    if (isSearching || selectedInstanceId === "favorites") return null;
    const currentModels: ModelPickerItem[] = [];
    const legacyModels: ModelPickerItem[] = [];
    for (const model of filteredModels) {
      const isLegacy = model.isLegacy && !favoritesSet.has(providerModelKey(model.instanceId, model.slug));
      (isLegacy ? legacyModels : currentModels).push(model);
    }
    if (legacyModels.length === 0) return null;
    return {
      key: modelPickerLegacySectionKey(selectedInstanceId),
      currentModels,
      legacyModels,
      isExpanded: expandedLegacyInstances.has(selectedInstanceId),
    };
  })();

  const visibleModels = legacySection
    ? [...legacySection.currentModels, ...(legacySection.isExpanded ? legacySection.legacyModels : [])]
    : filteredModels;

  const selectedEntry = selectedInstanceId === "favorites" ? undefined : entryByInstanceId.get(selectedInstanceId);
  const providerSetupEntries =
    !isSearching && canOpenProviderSetup
      ? instanceEntries.filter(
          (entry) =>
            matchesLockedProvider(entry) &&
            shouldOfferModelPickerSetup(entry, modelOptionsByInstance.get(entry.instanceId) ?? []) &&
            (selectedEntry ? entry.instanceId === selectedEntry.instanceId : filteredModels.length === 0),
        )
      : [];
  const updateRequiredNotices = instanceEntries.flatMap((entry) => {
    const shown = isSearching ? matchesLockedProvider(entry) : entry.instanceId === selectedEntry?.instanceId;
    const notice = shown ? formatProviderUpdateRequiredNotice(entry.snapshot, searchQuery) : null;
    return notice ? [{ instanceId: entry.instanceId, notice }] : [];
  });

  // The first selectable models get the numbered jump shortcuts, in list order.
  const modelJumpModelKeys = visibleModels
    .filter((model) => !getModelDisabledReason?.(model.instanceId, model.slug))
    .slice(0, MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.length)
    .map((model) => modelPickerModelKey(model.instanceId, model.slug));
  const itemKeys = visibleModels.map((model) => modelPickerModelKey(model.instanceId, model.slug));
  if (legacySection) itemKeys.splice(legacySection.currentModels.length, 0, legacySection.key);
  const modelByKey = new Map(
    visibleModels.map((model) => [modelPickerModelKey(model.instanceId, model.slug), model] as const),
  );
  const modelJumpLabelByKey = modelJumpLabelsByKey(modelJumpModelKeys, keybindings, terminalOpen);

  // Combobox autoHighlight: typing highlights the best match; switching lists clears it.
  const itemListKey = itemKeys.join("\n");
  const [highlightResetFor, setHighlightResetFor] = useState(itemListKey);
  if (highlightResetFor !== itemListKey) {
    setHighlightResetFor(itemListKey);
    setHighlightedIndex(isSearching && itemKeys.length > 0 ? 0 : -1);
  }

  const activateKey = (key: string | undefined) => {
    if (!key) return;
    const legacyInstanceId = parseModelPickerLegacySectionKey(key);
    if (legacyInstanceId) {
      toggleLegacySection(legacyInstanceId);
      return;
    }
    const model = parseModelPickerModelKey(key);
    if (model) handleModelSelect(model.slug, model.instanceId);
  };

  const moveHighlight = (direction: 1 | -1) => {
    if (itemKeys.length === 0) return;
    const next =
      highlightedIndex < 0
        ? direction === 1
          ? 0
          : itemKeys.length - 1
        : Math.min(itemKeys.length - 1, Math.max(0, highlightedIndex + direction));
    setHighlightedIndex(next);
    rowRefs.current.get(itemKeys[next]!)?.scrollIntoView?.();
  };

  const onSearchKeyDown = (event: KeyEvent) => {
    if (event.key === "escape") {
      event.preventDefault();
      event.stopPropagation();
      onRequestClose?.();
      return;
    }
    const shortcutEvent = shortcutEventFromGpuix(event);
    if (!shortcutEvent.repeat && !appAtomRegistry.get(commandPaletteOpenAtom)) {
      const command = resolveShortcutCommand(shortcutEvent, keybindings, {
        platform: SHORTCUT_PLATFORM,
        context: { terminalFocus: false, terminalOpen, modelPickerOpen: true },
      });
      if (command === "modelPicker.previousProvider" || command === "modelPicker.nextProvider") {
        event.preventDefault();
        event.stopPropagation();
        const next = adjacentModelPickerProvider({
          entries: sidebarInstanceEntries,
          selectedInstanceId,
          direction: command === "modelPicker.nextProvider" ? 1 : -1,
          disabledInstanceIds: lockedDisabledInstanceIds,
          selectableUnavailableInstanceIds,
        });
        setSearchQuery("");
        handleSelectInstance(next);
        return;
      }
      const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
      if (jumpIndex !== null) {
        event.preventDefault();
        event.stopPropagation();
        const target = modelJumpModelKeys[jumpIndex];
        const model = target ? parseModelPickerModelKey(target) : null;
        if (model) handleModelSelect(model.slug, model.instanceId);
        return;
      }
    }
    if (event.key === "down" || event.key === "up") {
      event.preventDefault();
      event.stopPropagation();
      moveHighlight(event.key === "down" ? 1 : -1);
    }
  };

  const onRowHighlight = useCallback((index: number) => setHighlightedIndex(index), []);
  // Rows are memoized, so they get a stable handler that reaches this render's props.
  const activateKeyRef = useRef(activateKey);
  activateKeyRef.current = activateKey;
  const onRowSelect = useCallback(
    (instanceId: ProviderInstanceId, slug: string) => activateKeyRef.current(modelPickerModelKey(instanceId, slug)),
    [],
  );

  // Focus lands in the search box when the picker opens, as web's layout effect does.
  useEffect(() => {
    focusSearchInput();
  }, [focusSearchInput]);

  const listHasItems = itemKeys.length > 0;
  // Web's list only shows a scrollbar when it overflows; GPUI paints one for any scroll box.
  const listContentHeight = itemKeys.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP + LIST_PADDING_Y * 2;
  const listViewportHeight =
    (isSearching && searchHeight > 0 ? searchHeight : MODEL_PICKER_MAX_HEIGHT) - SEARCH_BLOCK_HEIGHT;
  const listScrolls = listContentHeight > listViewportHeight;
  const mutedSurface = theme.muted;

  return (
    <div
      testId="model-picker-content"
      onLayout={(event) => {
        if (!isSearching && event.height) restingHeightRef.current = event.height;
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        width: MODEL_PICKER_WIDTH,
        maxHeight: MODEL_PICKER_MAX_HEIGHT,
        overflow: "hidden",
        ...(isSearching && searchHeight > 0 ? { height: searchHeight } : {}),
      }}
    >
      {showSidebar ? (
        <ModelPickerSidebar
          selectedInstanceId={selectedInstanceId}
          onSelectInstance={handleSelectInstance}
          instanceEntries={sidebarInstanceEntries}
          showFavorites
          selectableUnavailableInstanceIds={selectableUnavailableInstanceIds}
          {...(lockedDisabledInstanceIds
            ? {
                disabledInstanceIds: lockedDisabledInstanceIds,
                getDisabledInstanceTooltip: (entry: ProviderInstanceEntry) =>
                  `${entry.displayName} is unavailable in this thread. Start a new thread to switch providers.`,
              }
            : {})}
        />
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          backgroundColor: alpha(mutedSurface, 0.4),
          ...(showSidebar ? { borderLeftWidth: 1, borderColor: alpha(theme.border, 0.7) } : {}),
        }}
      >
        {/* pt-2.5 with the rule's -translate-y-px folded in. */}
        <div style={{ flexShrink: 0, paddingTop: 9, paddingLeft: 12, paddingRight: 12 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingBottom: 6,
              borderBottomWidth: 1,
              borderColor: searchFocused ? theme.primary : alpha(theme.border, 0.7),
            }}
          >
            <Icon name="search" size={16} color={alpha(theme.mutedForeground, 0.55)} />
            <input
              ref={searchInputRef}
              testId="model-picker-search"
              autoFocus
              value={searchQuery}
              placeholder="Search models..."
              theme={{ caret: theme.foreground }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onChange={(event) => {
                const next = event.value ?? "";
                if (!isSearching && next.trim().length > 0) setSearchHeight(restingHeightRef.current);
                setSearchQuery(next);
              }}
              onSubmit={() => activateKey(highlightedIndex >= 0 ? itemKeys[highlightedIndex] : undefined)}
              onKeyDown={onSearchKeyDown}
              style={{
                flexGrow: 1,
                minWidth: 0,
                height: 26,
                fontSize: 14,
                lineHeight: 26,
                color: theme.foreground,
                fontFamily: FONTS.sans,
              }}
            />
          </div>
        </div>
        {listHasItems ? (
          <div
            testId="model-picker-list"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: ROW_GAP,
              flexShrink: 1,
              minHeight: 0,
              // Web's list starts 1px lower than the translated rule; keep the 45/47px rhythm.
              paddingTop: LIST_PADDING_Y + 1,
              paddingBottom: LIST_PADDING_Y,
              paddingLeft: 12,
              paddingRight: 12,
              ...(listScrolls
                ? { overflowY: "scroll", scrollbarWidth: 6, scrollbarColor: theme.scrollbar }
                : { overflowY: "hidden" }),
            }}
          >
            {itemKeys.map((key, index) => {
              const isHighlighted = index === highlightedIndex;
              const setRef = (instance: PublicInstance | null) => {
                if (instance) rowRefs.current.set(key, instance);
                else rowRefs.current.delete(key);
              };
              if (legacySection?.key === key) {
                return (
                  <div key={key} ref={setRef} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                    <ModelPickerLegacyRow
                      index={index}
                      count={legacySection.legacyModels.length}
                      expanded={legacySection.isExpanded}
                      isHighlighted={isHighlighted}
                      onToggle={() => toggleLegacySection(selectedInstanceId as ProviderInstanceId)}
                      onHighlight={onRowHighlight}
                    />
                  </div>
                );
              }
              const model = modelByKey.get(key);
              if (!model) return null;
              return (
                <div key={key} ref={setRef} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                  <ModelPickerListRow
                    index={index}
                    slug={model.slug}
                    name={model.name}
                    shortName={model.shortName}
                    subProvider={model.subProvider}
                    instanceId={model.instanceId}
                    driverKind={model.driverKind}
                    providerDisplayName={model.instanceDisplayName}
                    providerAccentColor={model.instanceAccentColor}
                    isFavorite={favoritesSet.has(providerModelKey(model.instanceId, model.slug))}
                    isSelected={key === activeModelKey}
                    isHighlighted={isHighlighted}
                    showProvider
                    preferShortName={!isLocked}
                    useTriggerLabel={false}
                    showNewBadge={model.badge === "new"}
                    unavailable={model.isUnavailable === true}
                    jumpLabel={modelJumpLabelByKey.get(key) ?? null}
                    disabledReason={getModelDisabledReason?.(model.instanceId, model.slug) ?? null}
                    onSelect={onRowSelect}
                    onHighlight={onRowHighlight}
                    onToggleFavorite={toggleFavorite}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
        <ModelPickerProviderNotices
          setupEntries={providerSetupEntries}
          updateRequiredNotices={updateRequiredNotices}
          showEmpty={!listHasItems}
          onRequestClose={onRequestClose}
          onOpenProviderSetup={onOpenProviderSetup}
        />
      </div>
    </div>
  );
});

const NO_CONFIG_ATOM = Atom.make<ServerConfig | null>(null);

function ModelPickerProviderNotices(props: {
  setupEntries: ReadonlyArray<ProviderInstanceEntry>;
  updateRequiredNotices: ReadonlyArray<{ instanceId: ProviderInstanceId; notice: string }>;
  showEmpty: boolean;
  onRequestClose: (() => void) | undefined;
  onOpenProviderSetup: ((instanceId: ProviderInstanceId) => void) | undefined;
}) {
  const theme = useTheme();
  const borderColor = alpha(theme.border, 0.7);
  return (
    <>
      {props.setupEntries.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            maxHeight: 176,
            overflowY: "scroll",
            borderTopWidth: 1,
            borderColor,
            padding: 8,
          }}
        >
          {props.setupEntries.map((entry) => (
            <div key={entry.instanceId} style={{ display: "flex", flexDirection: "column", paddingLeft: 4, paddingRight: 4, paddingTop: 6, paddingBottom: 6 }}>
              <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16.5, fontFamily: FONTS.sans, lineClamp: 3 }}>
                {getProviderStatusMessage(entry.snapshot)}
              </text>
              <InlineButton
                testId={`model-picker-setup-${entry.instanceId}`}
                onClick={() => {
                  props.onRequestClose?.();
                  props.onOpenProviderSetup?.(entry.instanceId);
                }}
              >
                {props.setupEntries.length > 1 ? `Set up ${entry.displayName}` : "Open provider setup"}
              </InlineButton>
            </div>
          ))}
        </div>
      ) : props.showEmpty ? (
        <div style={{ display: "flex", justifyContent: "center", flexShrink: 0, padding: 8 }}>
          <text style={{ color: theme.mutedForeground, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans }}>
            No models found
          </text>
        </div>
      ) : null}
      {props.updateRequiredNotices.map(({ instanceId, notice }) => (
        <UpdateRequiredNotice
          key={instanceId}
          notice={notice}
          onOpenSettings={() => {
            props.onRequestClose?.();
            appAtomRegistry.set(routeAtom, { kind: "settings", page: "providers" });
          }}
        />
      ))}
    </>
  );
}

const PROVIDER_SETTINGS_LINK = "t3term:provider-settings";

/**
 * The notice and its "Provider settings" button flow as one wrapped paragraph on web.
 * gpuix text runs cannot be hit-tested separately, so this is a markdown paragraph
 * whose link opens provider settings.
 */
function UpdateRequiredNotice(props: { notice: string; onOpenSettings: () => void }) {
  const theme = useTheme();
  const escaped = props.notice.replace(/([\\`*_[\]<>#])/g, "\\$1");
  return (
    <div
      style={{
        flexShrink: 0,
        borderTopWidth: 1,
        borderColor: alpha(theme.border, 0.7),
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      <markdown
        testId="model-picker-update-notice"
        source={`${escaped} [**Provider settings**](${PROVIDER_SETTINGS_LINK})`}
        onLinkClick={(event) => {
          if (event.value === PROVIDER_SETTINGS_LINK) props.onOpenSettings();
        }}
        theme={{
          appearance: theme.appearance,
          text: theme.mutedForeground,
          bg: theme.background,
          accent: theme.foreground,
          fontSans: FONTS.sans,
          fontMono: FONTS.mono,
          metrics: { mdTextSize: 12, mdLineHeight: 16.5, mdBlockGap: 0, mdHeadingSizes: [12, 12, 12, 12] },
        }}
      />
    </div>
  );
}

/** InlineButton (tone default): 12px medium foreground, underline on hover. */
function InlineButton(props: { children: string; onClick: () => void; testId?: string }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={props.testId}
      onClick={props.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", alignSelf: "flex-start", marginTop: 4, cursor: "pointer" }}
    >
      <text
        style={{
          color: theme.foreground,
          fontSize: 12,
          lineHeight: 16.5,
          fontWeight: 500,
          fontFamily: FONTS.sans,
          ...(hovered ? { textDecoration: "underline" } : {}),
        }}
      >
        {props.children}
      </text>
    </div>
  );
}
