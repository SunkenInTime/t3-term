// Port of apps/web/src/components/settings/ProviderModelsSection.tsx. The models card is
// split into virtual-list items (head, one per model, foot) so a provider with hundreds of
// models only builds the visible rows; the section's state lives in the hook.
import { ProviderDriverKind, type ProviderInstanceId, type ServerProviderModel } from "@t3tools/contracts";
import { normalizeCustomModelSlug, type CustomModelDefinition } from "@t3tools/shared/model";
import { useState, type ReactNode } from "react";

import { Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { sortModelsForProviderInstance } from "../../web/modelOrdering.ts";
import { MAX_CUSTOM_MODEL_LENGTH } from "../../web/modelSelection.ts";
import { TextField } from "../controls.tsx";
import { CustomModelEditor } from "./CustomModelEditor.tsx";
import { PaneCard, SmallSwitch, StarIcon } from "./parts.tsx";
import type { PaneItem } from "./paneItems.ts";

const CUSTOM_MODEL_PLACEHOLDER_BY_KIND: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("codex")]: "gpt-6.7-codex-ultra-preview",
  [ProviderDriverKind.make("claudeAgent")]: "claude-sonnet-5",
  [ProviderDriverKind.make("cursor")]: "claude-sonnet-4-6",
  [ProviderDriverKind.make("opencode")]: "openai/gpt-5",
  [ProviderDriverKind.make("pi")]: "anthropic/claude-sonnet-5",
};

const FILTER_THRESHOLD = 8;

function describeModelCapabilities(model: ServerProviderModel): string[] {
  const descriptors = model.capabilities?.optionDescriptors ?? [];
  const labels: string[] = [];
  const hasFastMode = descriptors.some(
    (descriptor) =>
      descriptor.id === "fastMode" ||
      (descriptor.id === "serviceTier" &&
        descriptor.type === "select" &&
        descriptor.options.some((option) => option.id === "fast" || option.label === "Fast")),
  );
  if (hasFastMode) labels.push("Fast mode");
  if (descriptors.some((descriptor) => descriptor.id === "thinking")) labels.push("Thinking");
  if (
    descriptors.some(
      (descriptor) =>
        descriptor.type === "select" &&
        (descriptor.id === "reasoningEffort" || descriptor.id === "effort" || descriptor.id === "reasoning" || descriptor.id === "variant"),
    )
  ) {
    labels.push("Reasoning");
  }
  return labels;
}

function groupModelsForDisplay<T extends { readonly slug: string; readonly isCustom: boolean }>(
  models: ReadonlyArray<T>,
  options: { readonly favoriteModels: ReadonlySet<string>; readonly hiddenModels: ReadonlySet<string>; readonly modelOrder: ReadonlyArray<string> },
): T[] {
  const ordered = sortModelsForProviderInstance(models, {
    favoriteModels: options.favoriteModels,
    groupFavorites: true,
    modelOrder: options.modelOrder,
  });
  const isHidden = (model: T) => !model.isCustom && options.hiddenModels.has(model.slug);
  return [
    ...ordered.filter((model) => options.favoriteModels.has(model.slug)),
    ...ordered.filter((model) => !options.favoriteModels.has(model.slug) && !isHidden(model)),
    ...ordered.filter((model) => !options.favoriteModels.has(model.slug) && isHidden(model)),
  ];
}

function nextHiddenModelsForBulkToggle(
  models: ReadonlyArray<Pick<ServerProviderModel, "slug" | "isCustom">>,
  hiddenModels: ReadonlyArray<string>,
): string[] {
  const builtInSlugs = models.filter((model) => !model.isCustom).map((model) => model.slug);
  const builtInSlugSet = new Set(builtInSlugs);
  if (builtInSlugs.every((slug) => hiddenModels.includes(slug))) {
    return hiddenModels.filter((slug) => !builtInSlugSet.has(slug));
  }
  return [...new Set([...hiddenModels, ...builtInSlugs])];
}

export interface ProviderModelsSectionProps {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind | null;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly customModels: ReadonlyArray<CustomModelDefinition>;
  readonly canManageCustomModels: boolean;
  readonly canWritePreferences: boolean;
  readonly hiddenModels: ReadonlyArray<string>;
  readonly favoriteModels: ReadonlyArray<string>;
  readonly modelOrder: ReadonlyArray<string>;
  readonly onChange: (next: ReadonlyArray<CustomModelDefinition>) => void;
  readonly onHiddenModelsChange: (next: ReadonlyArray<string>, affectedModels?: ReadonlyArray<string>) => void;
  readonly onFavoriteModelsChange: (next: ReadonlyArray<string>) => void;
  readonly onToggleFavorite: (model: string) => void;
  readonly onModelOrderChange: (next: ReadonlyArray<string>) => void;
}

/** The Models card as pane items: description + toolbar, the model rows, and the add/error foot. */
export function useProviderModelsItems(props: ProviderModelsSectionProps | null): PaneItem[] {
  const [input, setInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  if (props === null) return [];
  const {
    instanceId,
    driverKind,
    models,
    customModels,
    canManageCustomModels,
    canWritePreferences,
    hiddenModels,
    favoriteModels,
    modelOrder,
    onChange,
    onHiddenModelsChange,
    onFavoriteModelsChange,
    onToggleFavorite,
    onModelOrderChange,
  } = props;
  const hiddenModelSet = new Set(hiddenModels);
  const favoriteModelSet = new Set(favoriteModels);
  const displayModels = groupModelsForDisplay(models, { favoriteModels: favoriteModelSet, hiddenModels: hiddenModelSet, modelOrder });
  const favoriteCount = displayModels.filter((model) => favoriteModelSet.has(model.slug)).length;
  const hiddenCount = displayModels.filter((model) => !model.isCustom && hiddenModelSet.has(model.slug)).length;
  const showFilter = models.length > FILTER_THRESHOLD;
  const normalizedFilter = filter.trim().toLowerCase();
  const isFiltering = showFilter && normalizedFilter.length > 0;
  const visibleModels = isFiltering
    ? displayModels.filter((model) => model.name.toLowerCase().includes(normalizedFilter) || model.slug.toLowerCase().includes(normalizedFilter))
    : displayModels;
  const builtInModels = models.filter((model) => !model.isCustom);
  const allBuiltInModelsHidden = builtInModels.length > 0 && builtInModels.every((model) => hiddenModels.includes(model.slug));
  const canAddCustom = driverKind !== "antigravity";

  const handleAdd = () => {
    if (!canManageCustomModels || !canAddCustom) return;
    const normalized = normalizeCustomModelSlug(input);
    if (!normalized) return setError("Enter a model slug.");
    if (models.some((model) => !model.isCustom && model.slug === normalized)) return setError("That model is already built in.");
    if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) return setError(`Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`);
    if (customModels.some((entry) => entry.slug === normalized)) return setError("That custom model is already saved.");
    setFilter("");
    onChange([...customModels, { slug: normalized, name: normalized, capabilities: null }]);
    setInput("");
    setError(null);
    setIsAdding(false);
  };
  const cancelAdd = () => {
    setInput("");
    setError(null);
    setIsAdding(false);
  };
  const handleRemove = (slug: string) => {
    if (!canManageCustomModels) return;
    if (editingSlug === slug) setEditingSlug(null);
    onChange(customModels.filter((entry) => entry.slug !== slug));
    onModelOrderChange(modelOrder.filter((model) => model !== slug));
    onFavoriteModelsChange(favoriteModels.filter((model) => model !== slug));
    setError(null);
  };
  const handleSaveEdit = (next: CustomModelDefinition) => {
    if (!canManageCustomModels) return;
    onChange(customModels.map((entry) => (entry.slug === next.slug ? next : entry)));
    setEditingSlug(null);
  };
  const setHidden = (slug: string, hidden: boolean) => {
    if (!canWritePreferences || hidden === hiddenModelSet.has(slug)) return;
    onHiddenModelsChange(hidden ? [...hiddenModels, slug] : hiddenModels.filter((model) => model !== slug), [slug]);
  };
  const groupOf = (model: ServerProviderModel) =>
    favoriteModelSet.has(model.slug) ? "favorite" : !model.isCustom && hiddenModelSet.has(model.slug) ? "hidden" : "visible";
  const handleMove = (slug: string, direction: -1 | 1) => {
    if (!canWritePreferences) return;
    const index = displayModels.findIndex((model) => model.slug === slug);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= displayModels.length) return;
    if (groupOf(displayModels[index]!) !== groupOf(displayModels[nextIndex]!)) return;
    const next = displayModels.map((model) => model.slug);
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    onModelOrderChange(next);
  };

  const countLabel =
    `${models.length} model${models.length === 1 ? "" : "s"}` +
    (favoriteCount > 0 ? ` · ${favoriteCount} favorite${favoriteCount === 1 ? "" : "s"}` : "") +
    (hiddenCount > 0 ? ` · ${hiddenCount} hidden` : "");

  const items: PaneItem[] = [
    {
      key: "models-head",
      gapBefore: 10,
      node: (
        <PaneCard position="first">
          <ModelsHead
            showFilter={showFilter}
            filter={filter}
            onFilter={setFilter}
            showBulk={builtInModels.length > 0}
            allHidden={allBuiltInModelsHidden}
            onBulk={() => onHiddenModelsChange(nextHiddenModelsForBulkToggle(models, hiddenModels), builtInModels.map((model) => model.slug))}
            countLabel={countLabel}
            showAdd={canAddCustom && !isAdding}
            onAdd={() => setIsAdding(true)}
          />
        </PaneCard>
      ),
    },
  ];

  if (visibleModels.length === 0) {
    items.push({
      key: "models-empty",
      node: (
        <PaneCard position="middle" divided={false}>
          <EmptyModels text={isFiltering ? "No models match." : "No models reported for this provider yet."} />
        </PaneCard>
      ),
    });
  }

  visibleModels.forEach((model, index) => {
    const group = groupOf(model);
    const previous = visibleModels[index - 1];
    const startsGroup = previous === undefined || groupOf(previous) !== group;
    const label =
      startsGroup && favoriteCount > 0 && group === "favorite"
        ? "Favorites"
        : startsGroup && favoriteCount > 0 && group === "visible"
          ? "All"
          : startsGroup && group === "hidden"
            ? "Hidden from picker"
            : null;
    const displayIndex = displayModels.indexOf(model);
    const before = displayModels[displayIndex - 1];
    const after = displayModels[displayIndex + 1];
    const editingEntry =
      canManageCustomModels && model.isCustom && editingSlug === model.slug ? customModels.find((entry) => entry.slug === model.slug) : undefined;
    items.push({
      key: `model:${instanceId}:${model.slug}`,
      node: (
        <PaneCard position="middle" divided={false}>
          <div style={{ display: "flex", flexDirection: "column", paddingLeft: 8, paddingRight: 8 }}>
            {label ? <GroupLabel label={label} first={index === 0} /> : null}
            <ProviderModelRow
              model={model}
              isHidden={!model.isCustom && hiddenModelSet.has(model.slug)}
              isFavorite={group === "favorite"}
              canMoveUp={!isFiltering && before !== undefined && groupOf(before) === group}
              canMoveDown={!isFiltering && after !== undefined && groupOf(after) === group}
              isFiltering={isFiltering}
              canWritePreferences={canWritePreferences}
              canManageCustomModels={canManageCustomModels}
              onToggleFavorite={(slug) => canWritePreferences && onToggleFavorite(slug)}
              onMove={handleMove}
              onSetHidden={setHidden}
              onToggleEdit={(slug) => canManageCustomModels && setEditingSlug((current) => (current === slug ? null : slug))}
              onRemove={handleRemove}
            />
            {editingEntry ? (
              <CustomModelEditor
                key={`${instanceId}:${model.slug}:editor`}
                driverKind={driverKind}
                entry={editingEntry}
                builtInModels={builtInModels}
                onSave={handleSaveEdit}
                onCancel={() => setEditingSlug(null)}
              />
            ) : null}
          </div>
        </PaneCard>
      ),
    });
  });

  items.push({
    key: "models-foot",
    node: (
      <PaneCard position="last" divided={false}>
        <ModelsFoot
          isAdding={canAddCustom && canManageCustomModels && isAdding}
          input={input}
          placeholder={driverKind ? (CUSTOM_MODEL_PLACEHOLDER_BY_KIND[driverKind] ?? "model-slug") : "model-slug"}
          onInput={(next) => {
            setInput(next);
            if (error) setError(null);
          }}
          onAdd={handleAdd}
          onCancel={cancelAdd}
          error={canAddCustom ? error : null}
        />
      </PaneCard>
    ),
  });
  return items;
}

function ModelsHead({
  showFilter,
  filter,
  onFilter,
  showBulk,
  allHidden,
  onBulk,
  countLabel,
  showAdd,
  onAdd,
}: {
  showFilter: boolean;
  filter: string;
  onFilter: (value: string) => void;
  showBulk: boolean;
  allHidden: boolean;
  onBulk: () => void;
  countLabel: string;
  showAdd: boolean;
  onAdd: () => void;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 8 }}>
      <Text size="xs" color={theme.mutedForeground} style={{ marginBottom: 12 }}>
        Model preferences and custom models are saved on the selected environment and shared across connected devices.
      </Text>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 }}>
        {showFilter ? <TextField testId="provider-models-filter" size="sm" width={224} value={filter} onChange={onFilter} placeholder="Filter models" /> : null}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          {showBulk ? (
            <Button size="xs" variant="ghost-muted" onClick={onBulk} testId="provider-models-bulk">
              {allHidden ? "Enable all" : "Disable all"}
            </Button>
          ) : null}
          <Text size="xs" color={theme.mutedForeground}>
            {countLabel}
          </Text>
        </div>
        <div style={{ flexGrow: 1 }} />
        {showAdd ? (
          <Button size="xs" variant="ghost-muted" icon="plus" onClick={onAdd} testId="provider-models-add-custom" style={{ gap: 4 }}>
            Add custom model
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ModelsFoot({
  isAdding,
  input,
  placeholder,
  onInput,
  onAdd,
  onCancel,
  error,
}: {
  isAdding: boolean;
  input: string;
  placeholder: string;
  onInput: (value: string) => void;
  onAdd: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingBottom: 12 }}>
      {isAdding ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
          <TextField testId="provider-models-custom-input" size="sm" value={input} onChange={onInput} onSubmit={onAdd} placeholder={placeholder} />
          <Button size="sm" variant="outline" onClick={onAdd} testId="provider-models-custom-confirm">
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} testId="provider-models-custom-cancel">
            Cancel
          </Button>
        </div>
      ) : null}
      {error ? (
        <Text size="xs" color={theme.errorForeground} style={{ marginTop: 8 }}>
          {error}
        </Text>
      ) : null}
    </div>
  );
}

function GroupLabel({ label, first }: { label: string; first: boolean }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 6, paddingTop: first ? 4 : 20 }}>
      <Text size="2xs" color={theme.mutedForeground}>
        {label}
      </Text>
    </div>
  );
}

function EmptyModels({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {text}
      </Text>
    </div>
  );
}

function truncateMiddle(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

interface ProviderModelRowProps {
  readonly model: ServerProviderModel;
  readonly isHidden: boolean;
  readonly isFavorite: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly isFiltering: boolean;
  readonly canWritePreferences: boolean;
  readonly canManageCustomModels: boolean;
  readonly onToggleFavorite: (slug: string) => void;
  readonly onMove: (slug: string, direction: -1 | 1) => void;
  readonly onSetHidden: (slug: string, hidden: boolean) => void;
  readonly onToggleEdit: (slug: string) => void;
  readonly onRemove: (slug: string) => void;
}

function RowAction({ icon, tooltip, disabled, onClick, testId }: { icon: Parameters<typeof IconButton>[0]["icon"]; tooltip: string; disabled: boolean; onClick: () => void; testId?: string }) {
  return (
    <Tooltip content={tooltip} side="top">
      <IconButton testId={testId} icon={icon} size={20} iconSize={12} disabled={disabled} onClick={onClick} />
    </Tooltip>
  );
}

function ProviderModelRow({
  model,
  isHidden,
  isFavorite,
  canMoveUp,
  canMoveDown,
  isFiltering,
  canWritePreferences,
  canManageCustomModels,
  onToggleFavorite,
  onMove,
  onSetHidden,
  onToggleEdit,
  onRemove,
}: ProviderModelRowProps) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const capLabels = describeModelCapabilities(model);
  const pickerTooltip = model.isCustom ? "Custom models are always shown in the picker" : isHidden ? "Hidden from picker" : "Shown in picker";
  const id = `provider-model-${model.slug}`;
  const nameNode: ReactNode = (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexGrow: 1, flexShrink: 1, overflow: "hidden" }}>
      <Text size="xs" weight={500} color={isHidden ? theme.mutedForeground : alpha(theme.foreground, 0.9)} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
        {truncateMiddle(model.name, 40)}
      </Text>
      {model.name !== model.slug ? (
        <Text size="2xs" mono color={alpha(theme.mutedForeground, 0.7)} style={{ whiteSpace: "nowrap" }}>
          {truncateMiddle(model.slug, 36)}
        </Text>
      ) : null}
      {model.isCustom ? (
        <Text size="2xs" color={alpha(theme.mutedForeground, 0.7)} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
          custom
        </Text>
      ) : null}
    </div>
  );
  return (
    <div
      testId={id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 28,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        backgroundColor: hover ? alpha(theme.muted, 0.3) : "#00000000",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", width: 24, justifyContent: "center", flexShrink: 0 }}>
        <Tooltip content={isFavorite ? "Remove from favorites" : "Add to favorites"} side="top">
          <div
            testId={`${id}-favorite`}
            onClick={canWritePreferences ? () => onToggleFavorite(model.slug) : undefined}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: RADIUS.sm, cursor: "pointer", hover: { backgroundColor: theme.accent } }}
          >
            <StarIcon filled={isFavorite} color={isFavorite ? theme.warning : theme.mutedForeground} />
          </div>
        </Tooltip>
      </div>
      {nameNode}
      {capLabels.length > 0 ? (
        <Text size="2xs" color={alpha(theme.mutedForeground, 0.7)} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
          {capLabels.join(" · ")}
        </Text>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, minWidth: 88, flexShrink: 0 }}>
        {!isHidden && !isFiltering ? (
          <>
            <RowAction testId={`${id}-up`} icon="arrow-up" tooltip="Move up" disabled={!canWritePreferences || !canMoveUp} onClick={() => onMove(model.slug, -1)} />
            <RowAction testId={`${id}-down`} icon="arrow-down" tooltip="Move down" disabled={!canWritePreferences || !canMoveDown} onClick={() => onMove(model.slug, 1)} />
          </>
        ) : null}
        {model.isCustom ? (
          <>
            <RowAction testId={`${id}-edit`} icon="pencil" tooltip="Edit name and options" disabled={!canManageCustomModels} onClick={() => onToggleEdit(model.slug)} />
            <RowAction testId={`${id}-remove`} icon="x" tooltip="Remove custom model" disabled={!canManageCustomModels} onClick={() => onRemove(model.slug)} />
          </>
        ) : null}
      </div>
      <Tooltip content={pickerTooltip} side="top">
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <SmallSwitch
            testId={`${id}-visible`}
            checked={!isHidden}
            disabled={!canWritePreferences || model.isCustom}
            onChange={(checked) => onSetHidden(model.slug, !checked)}
          />
        </div>
      </Tooltip>
    </div>
  );
}
