// Port of apps/web/src/components/settings/ProviderInstanceCard.tsx. The "list" mode is
// ProviderInstanceListRow; the "editor" mode is useProviderEditorItems, which returns the
// editor's sections as pane items for the detail pane's virtual list.
import {
  isProviderDriverKind,
  resolveProviderInstanceEnabled,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import { readCustomModelEntries, toCustomModelSetting, type CustomModelDefinition } from "@t3tools/shared/model";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Menu, MenuItem, Switch, Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import { isProviderUpdateActive } from "../../web/components/ProviderUpdateLaunchNotification.logic.ts";
import {
  getProviderStatusKey,
  getProviderSummary,
  getProviderVersionAdvisoryPresentation,
  getProviderVersionLabel,
  type ProviderStatusKey,
} from "../../web/components/settings/providerStatus.ts";
import { Badge, DraftTextField, fieldBackground, TextArea } from "../controls.tsx";
import { SettingResetButton } from "../layout.tsx";
import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
  readProviderConfigString,
  SecretField,
  type ProviderSettingsFieldModel,
  type SettingsFormDefinition,
} from "../ProviderSettingsForm.tsx";
import { RedactedText } from "../RedactedText.tsx";
import { AccentColorPicker } from "./AccentColorPicker.tsx";
import type { PaneItem } from "./paneItems.ts";
import { DriverIcon, PaneCard, PaneSectionTitle, StackedRow, VersionAdvisoryButton, type CardPosition } from "./parts.tsx";
import type { ProviderClientDefinition, ProviderEnvironmentField } from "./providerDriverMeta.ts";
import { useProviderModelsItems } from "./ProviderModelsSection.tsx";

const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const NO_CUSTOM_MODELS: ReadonlyArray<CustomModelDefinition> = [];

/** Unlike field updates, keeps empty values: `customModels: []` means "cleared" here. */
function nextConfigBlobWithValue(config: unknown, key: string, value: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  base[key] = value;
  return base;
}

export function deriveProviderModelsForDisplay(input: {
  readonly liveModels: ReadonlyArray<ServerProviderModel> | undefined;
  readonly customModels: ReadonlyArray<CustomModelDefinition>;
}): ReadonlyArray<ServerProviderModel> {
  const liveCustomModelsBySlug = new Map((input.liveModels ?? []).filter((model) => model.isCustom).map((model) => [model.slug, model] as const));
  const serverModels = input.liveModels?.filter((model) => !model.isCustom) ?? [];
  const serverSlugs = new Set(serverModels.map((model) => model.slug));
  const customModels = input.customModels.flatMap((entry) =>
    serverSlugs.has(entry.slug)
      ? []
      : [
          {
            slug: entry.slug,
            name: entry.name,
            isCustom: true,
            capabilities: entry.capabilities ?? liveCustomModelsBySlug.get(entry.slug)?.capabilities ?? null,
          } as ServerProviderModel,
        ],
  );
  return [...serverModels, ...customModels];
}

function providerEnvironmentWithoutNames(
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined,
  names: ReadonlySet<string>,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> {
  return (environment ?? []).filter((variable) => !names.has(variable.name));
}

export function nextProviderEnvironmentWithFieldValue(
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined,
  field: ProviderEnvironmentField,
  value: string,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> {
  const trimmed = value.trim();
  const next: ProviderInstanceEnvironmentVariable[] = [];
  let found = false;
  for (const variable of environment ?? []) {
    if (variable.name !== field.name) {
      next.push(variable);
      continue;
    }
    found = true;
    if (trimmed.length > 0) next.push({ name: variable.name, value: trimmed, sensitive: field.sensitive ?? true });
  }
  if (!found && trimmed.length > 0) next.push({ name: field.name, value: trimmed, sensitive: field.sensitive ?? true });
  return next;
}

// ── Status presentation ─────────────────────────────────────────────────

function statusDotColor(theme: Palette, key: ProviderStatusKey): string {
  switch (key) {
    case "disabled":
      return alpha(theme.mutedForeground, 0.5);
    case "error":
      return theme.error;
    case "neutral":
      return theme.mutedForeground;
    case "ready":
      return theme.success;
    case "warning":
      return theme.warning;
  }
}

function StatusDot({ statusKey }: { statusKey: ProviderStatusKey }) {
  const theme = useTheme();
  return <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusDotColor(theme, statusKey), flexShrink: 0 }} />;
}

/** What the list row and the editor header both read from an instance and its live snapshot. */
function deriveInstanceView(
  instance: ProviderInstanceConfig,
  driverOption: ProviderClientDefinition | undefined,
  liveProvider: ServerProvider | undefined,
  enabled: boolean,
  isUpdating: boolean,
) {
  const effectiveProvider = liveProvider && { ...liveProvider, enabled };
  const compatibility = enabled ? liveProvider?.compatibilityAdvisory : undefined;
  const statusKey: ProviderStatusKey = enabled ? getProviderStatusKey(effectiveProvider) : "disabled";
  const summary = enabled ? getProviderSummary(effectiveProvider) : { headline: "Disabled", detail: null };
  const versionAdvisory = getProviderVersionAdvisoryPresentation(liveProvider?.versionAdvisory, liveProvider?.compatibilityAdvisory, enabled);
  const updateState = liveProvider?.updateState;
  const updateProgress = isUpdating
    ? ((updateState?.status === "queued" || updateState?.status === "running" ? updateState.message : null) ?? "Starting update")
    : null;
  const updateProblem =
    !isUpdating && (updateState?.status === "failed" || updateState?.status === "unchanged") ? (updateState.message ?? null) : null;
  const hasCompatibilityWarning =
    compatibility !== undefined && compatibility.status !== "supported" && compatibility.status !== "unknown";
  const needsAttention = statusKey === "warning" || statusKey === "error";
  const inlineStatusDetail = hasCompatibilityWarning
    ? compatibility?.status === "broken"
      ? "Incompatible"
      : compatibility?.status === "unsupported"
        ? "Unsupported"
        : "Limited support"
    : summary.detail;
  return {
    statusKey,
    summary,
    versionAdvisory,
    updateProgress,
    updateProblem,
    hasCompatibilityWarning,
    needsAttention,
    statusDiagnostic: hasCompatibilityWarning && needsAttention ? summary.detail : null,
    inlineStatusDetail,
    versionLabel: getProviderVersionLabel(liveProvider?.version),
    authEmail: liveProvider?.auth.email?.trim(),
    isAuthenticated: enabled && liveProvider?.auth.status === "authenticated",
    authLabel: enabled && liveProvider?.auth.status === "authenticated" ? (liveProvider.auth.label ?? liveProvider.auth.type ?? null) : null,
    displayName: instance.displayName?.trim() || driverOption?.label || String(instance.driver),
    accentColor: normalizeProviderAccentColor(instance.accentColor),
  };
}

function instanceIcon(instance: ProviderInstanceConfig, displayName: string, accentColor: string | undefined, theme: Palette) {
  return (
    <DriverIcon
      driver={isProviderDriverKind(instance.driver) ? instance.driver : String(instance.driver)}
      displayName={displayName}
      accentColor={accentColor}
      showBadge={Boolean(accentColor)}
      size={16}
      boxSize={20}
      color={alpha(theme.foreground, 0.8)}
    />
  );
}

// ── Shared props ────────────────────────────────────────────────────────

export interface ProjectOverrideControl {
  readonly value: boolean | undefined;
  readonly effectiveEnabled: boolean;
  readonly onChange: (next: boolean) => void;
  readonly onReset: () => void;
}

export interface ProviderInstanceCardProps {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driverOption: ProviderClientDefinition | undefined;
  readonly liveProvider: ServerProvider | undefined;
  readonly readOnly: boolean;
  readonly canWriteSettings: boolean;
  readonly isUpdating: boolean;
  readonly projectOverride?: ProjectOverrideControl | undefined;
  readonly onUpdate: (next: ProviderInstanceConfig) => void;
  readonly onRunUpdate?: (() => void) | undefined;
  readonly onInstallRecommended?: (() => void) | undefined;
}

function renderVersionAdvisory(
  props: ProviderInstanceCardProps,
  view: ReturnType<typeof deriveInstanceView>,
  compact: boolean,
): ReactNode {
  const { versionAdvisory } = view;
  if (!versionAdvisory) return null;
  const onRunAction = props.readOnly ? undefined : versionAdvisory.targetVersion ? props.onInstallRecommended : props.onRunUpdate;
  return (
    <VersionAdvisoryButton
      testId={`provider-advisory-${compact ? "list" : "editor"}-${props.instanceId}`}
      advisory={versionAdvisory}
      compact={compact}
      warning={view.hasCompatibilityWarning}
      displayName={view.displayName}
      updateProgress={view.updateProgress}
      updateProblem={view.updateProblem}
      isUpdating={props.isUpdating}
      onRunAction={onRunAction}
    />
  );
}

// ── List row ────────────────────────────────────────────────────────────

/** A row of the instance list: icon, name, version + advisory, status line, enable switch. */
export function ProviderInstanceListRow(props: ProviderInstanceCardProps & { readonly selected: boolean; readonly onSelect: () => void }) {
  const theme = useTheme();
  const { instance, instanceId, liveProvider, selected, onSelect, readOnly, canWriteSettings, projectOverride } = props;
  const [hover, setHover] = useState(false);
  const enabled = projectOverride?.effectiveEnabled ?? resolveProviderInstanceEnabled(instance);
  const isUpdating = props.isUpdating || (liveProvider !== undefined && isProviderUpdateActive(liveProvider));
  const view = deriveInstanceView(instance, props.driverOption, liveProvider, enabled, isUpdating);
  const advisory = renderVersionAdvisory({ ...props, isUpdating }, view, true);
  const statusText = view.updateProgress
    ? `Updating · ${view.updateProgress}`
    : `${view.summary.headline}${view.needsAttention && view.inlineStatusDetail ? ` · ${view.inlineStatusDetail}` : ""}`;
  const statusLine = (
    <Text size="xs" lineClamp={2} color={alpha(theme.mutedForeground, 0.8)} style={{ lineHeight: 18 }}>
      {statusText}
    </Text>
  );
  return (
    <div
      testId={`provider-instance-${instanceId}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 72,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: 12,
        backgroundColor: selected ? alpha(theme.muted, 0.45) : hover ? alpha(theme.muted, 0.25) : "#00000000",
      }}
    >
      <div
        testId={`provider-instance-${instanceId}-select`}
        onClick={onSelect}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          cursor: "pointer",
          opacity: !enabled && !selected && !hover ? 0.6 : 1,
        }}
      >
        {instanceIcon(instance, view.displayName, view.accentColor, theme)}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, minHeight: 20 }}>
            <Text weight={500} truncate style={{ flexShrink: 1 }}>
              {view.displayName}
            </Text>
            {view.versionLabel ? (
              <Text size="xs" mono color={theme.mutedForeground} style={{ flexShrink: 0 }}>
                {view.versionLabel.length > 12 ? `${view.versionLabel.slice(0, 11)}…` : view.versionLabel}
              </Text>
            ) : null}
            {advisory}
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
            {view.needsAttention && !view.updateProgress ? (
              <div style={{ display: "flex", height: 18, alignItems: "center" }}>
                <StatusDot statusKey={view.statusKey} />
              </div>
            ) : null}
            {view.statusDiagnostic ? (
              <Tooltip content={view.statusDiagnostic} side="top">
                {statusLine}
              </Tooltip>
            ) : (
              statusLine
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 20, flexShrink: 0 }}>
        {projectOverride?.value !== undefined ? (
          <SettingResetButton
            label={`${view.displayName} enablement`}
            tooltip="Reset to the device setting"
            disabled={readOnly || !canWriteSettings}
            onClick={projectOverride.onReset}
          />
        ) : null}
        <Switch
          testId={`provider-instance-${instanceId}-enabled`}
          checked={enabled}
          disabled={readOnly || (projectOverride !== undefined && !canWriteSettings)}
          onChange={(checked) => (projectOverride ? projectOverride.onChange(checked) : props.onUpdate({ ...instance, enabled: checked }))}
        />
      </div>
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────

export interface ProviderEditorProps extends ProviderInstanceCardProps {
  readonly isDefault: boolean;
  readonly isDirty: boolean;
  readonly setup: ReactNode;
  /** A managed Codex instance's runtime rows (CodexManagedRuntimeFields), folded under Runtime as on web. */
  readonly managedRuntime?: ReactNode;
  /** AcpSessionManagementSection, after Environment. */
  readonly acpSessions?: ReactNode;
  readonly onDelete?: (() => void) | undefined;
  readonly onResetDefault?: (() => void) | undefined;
  readonly hiddenModels: ReadonlyArray<string>;
  readonly favoriteModels: ReadonlyArray<string>;
  readonly modelOrder: ReadonlyArray<string>;
  readonly onHiddenModelsChange: (next: ReadonlyArray<string>, affectedModels?: ReadonlyArray<string>) => void;
  readonly onFavoriteModelsChange: (next: ReadonlyArray<string>) => void;
  readonly onToggleFavorite: (model: string) => void;
  readonly onModelOrderChange: (next: ReadonlyArray<string>) => void;
}

function single(key: string, node: ReactNode, gapBefore = 10): PaneItem {
  return { key, gapBefore, node: <PaneCard position="single">{node}</PaneCard> };
}

function positionOf(index: number, count: number): CardPosition {
  if (count === 1) return "single";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

/** The editor's sections as pane items: header, Display name, Setup, Runtime, Environment, Models. */
export function useProviderEditorItems(props: ProviderEditorProps): PaneItem[] {
  const theme = useTheme();
  const { instance, instanceId, driverOption, liveProvider, readOnly, canWriteSettings, onUpdate } = props;
  const enabled = props.projectOverride?.effectiveEnabled ?? resolveProviderInstanceEnabled(instance);
  const isUpdating = props.isUpdating || (liveProvider !== undefined && isProviderUpdateActive(liveProvider));
  const view = deriveInstanceView(instance, driverOption, liveProvider, enabled, isUpdating);
  const advisory = renderVersionAdvisory({ ...props, isUpdating }, view, false);
  const driverKind: ProviderDriverKind | null = isProviderDriverKind(instance.driver) ? instance.driver : null;
  const storedCustomModels =
    instance.config !== null && typeof instance.config === "object" ? (instance.config as Record<string, unknown>).customModels : undefined;
  const customModels = instance.driver === "antigravity" ? NO_CUSTOM_MODELS : readCustomModelEntries(storedCustomModels);
  const modelItems = useProviderModelsItems(
    driverOption
      ? {
          instanceId,
          driverKind,
          models: deriveProviderModelsForDisplay({ liveModels: liveProvider?.models, customModels }),
          customModels,
          canManageCustomModels: !readOnly,
          canWritePreferences: canWriteSettings,
          hiddenModels: props.hiddenModels,
          favoriteModels: props.favoriteModels,
          modelOrder: props.modelOrder,
          onChange: (next) => {
            const { config: _omit, ...rest } = instance;
            onUpdate({ ...rest, config: nextConfigBlobWithValue(instance.config, "customModels", next.map(toCustomModelSetting)) } as ProviderInstanceConfig);
          },
          onHiddenModelsChange: props.onHiddenModelsChange,
          onFavoriteModelsChange: props.onFavoriteModelsChange,
          onToggleFavorite: props.onToggleFavorite,
          onModelOrderChange: props.onModelOrderChange,
        }
      : null,
  );

  const updateDisplayName = (value: string) => {
    const trimmed = value.trim();
    const { displayName: _omit, ...rest } = instance;
    onUpdate(trimmed.length > 0 ? ({ ...rest, displayName: trimmed } as ProviderInstanceConfig) : (rest as ProviderInstanceConfig));
  };
  const updateAccentColor = (value: string) => {
    const normalized = normalizeProviderAccentColor(value);
    const { accentColor: _omit, ...rest } = instance;
    onUpdate(normalized ? ({ ...rest, accentColor: normalized } as ProviderInstanceConfig) : (rest as ProviderInstanceConfig));
  };
  const updateConfig = (nextConfig: Record<string, unknown> | undefined) => {
    const { config: _omit, ...rest } = instance;
    onUpdate(nextConfig !== undefined ? ({ ...rest, config: nextConfig } as ProviderInstanceConfig) : (rest as ProviderInstanceConfig));
  };
  const updateEnvironment = (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) => {
    const cleaned = environment.filter((variable) => variable.name.trim().length > 0);
    const { environment: _omit, ...rest } = instance;
    onUpdate(cleaned.length > 0 ? ({ ...rest, environment: cleaned } as ProviderInstanceConfig) : (rest as ProviderInstanceConfig));
  };
  const environmentFields = driverOption?.environmentFields ?? [];
  const environmentFieldNames = new Set(environmentFields.map((field) => field.name));
  const genericEnvironment = providerEnvironmentWithoutNames(instance.environment, environmentFieldNames);

  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const items: PaneItem[] = [];

  // Header: SettingsSection title={displayName} icon headerAction.
  items.push({
    key: "header",
    gapBefore: 0,
    node: (
      <PaneSectionTitle
        title={view.displayName}
        icon={instanceIcon(instance, view.displayName, view.accentColor, theme)}
        right={
          <>
            {driverOption?.badgeLabel ? (
              <Badge tone="warning" size="sm">
                {driverOption.badgeLabel}
              </Badge>
            ) : null}
            {view.versionLabel ? (
              <Text size="xs" mono color={theme.mutedForeground}>
                {view.versionLabel}
              </Text>
            ) : null}
            {advisory}
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, opacity: readOnly ? 0.5 : 1 }}>
              {props.isDefault && props.isDirty && props.onResetDefault ? (
                <SettingResetButton label={`${driverOption?.label ?? String(instance.driver)} provider settings`} onClick={props.onResetDefault} />
              ) : null}
              {props.onDelete ? (
                <Tooltip content="Delete instance" side="top">
                  <IconButton testId={`provider-instance-${instanceId}-delete`} icon="trash-2" size={24} iconSize={14} color={theme.errorForeground} disabled={readOnly} onClick={props.onDelete} />
                </Tooltip>
              ) : null}
            </div>
          </>
        }
      />
    ),
  });

  const urlAuthAction = liveProvider?.auth.action;
  items.push(
    single(
      "display-name",
      <StackedRow
        testId="provider-display-name-row"
        title="Display name"
        status={<EditorStatus view={view} />}
        control={
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: "100%", opacity: readOnly ? 0.5 : 1, ...(readOnly ? { pointerEvents: "none" } : {}) }}>
            <AccentColorPicker testId="provider-accent" value={view.accentColor} onCommit={updateAccentColor} commitDelayMs={120} />
            <DraftTextField
              testId="provider-display-name"
              size="sm"
              value={instance.displayName ?? ""}
              placeholder={driverOption?.label ?? "Instance label"}
              onCommit={updateDisplayName}
            />
          </div>
        }
      >
        {urlAuthAction ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8 }}>
            <Text size="xs">{urlAuthAction.message}</Text>
            <Text size="2xs" mono color={theme.mutedForeground}>
              {urlAuthAction.url}
            </Text>
          </div>
        ) : null}
      </StackedRow>,
    ),
  );

  if (props.setup || environmentFields.length > 0) {
    items.push({ key: "setup-title", gapBefore: 24, node: <PaneSectionTitle title="Setup" /> });
    const setupRows: Array<{ key: string; node: ReactNode }> = [];
    if (props.setup) setupRows.push({ key: "setup", node: props.setup });
    for (const field of environmentFields) {
      setupRows.push({
        key: `env-field:${field.name}`,
        node: (
          <EnvironmentFieldRow
            field={field}
            variable={instance.environment?.find((variable) => variable.name === field.name)}
            readOnly={readOnly}
            onCommit={(value) => updateEnvironment(nextProviderEnvironmentWithFieldValue(instance.environment, field, value))}
            onRemove={() => updateEnvironment(providerEnvironmentWithoutNames(instance.environment, new Set([field.name])))}
          />
        ),
      });
    }
    setupRows.forEach((row, index) =>
      items.push({ key: row.key, gapBefore: index === 0 ? 10 : 0, node: <PaneCard position={positionOf(index, setupRows.length)}>{row.node}</PaneCard> }),
    );
  }

  const fields = driverOption ? deriveProviderSettingsFields(driverOption as unknown as SettingsFormDefinition, instance.config) : [];
  if (props.managedRuntime) {
    // FoldedSettingsSection headerPlacement="outside": the title folds the rows.
    items.push({
      key: "runtime-title",
      gapBefore: 24,
      node: (
        <div testId="provider-managed-runtime-toggle" onClick={() => setRuntimeOpen(!runtimeOpen)} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28, paddingLeft: 16, paddingRight: 16, cursor: "pointer" }}>
          <Text color={alpha(theme.foreground, 0.7)}>Runtime</Text>
          <Icon name={runtimeOpen ? "chevron-down" : "chevron-right"} size={16} color={alpha(theme.foreground, 0.7)} />
        </div>
      ),
    });
    if (runtimeOpen) items.push(single("managed-runtime", props.managedRuntime));
  } else if (!driverOption || fields.length > 0) {
    items.push({ key: "runtime-title", gapBefore: 24, node: <PaneSectionTitle title="Runtime" /> });
    if (!driverOption) {
      items.push(
        single(
          "runtime-unknown",
          <StackedRow
            title="Driver"
            description={`This instance uses ${String(instance.driver)}, which is not available in this build. Its configuration is preserved.`}
          />,
        ),
      );
    } else {
      fields.forEach((field, index) =>
        items.push({
          key: `runtime:${field.key}`,
          gapBefore: index === 0 ? 10 : 0,
          node: (
            <PaneCard position={positionOf(index, fields.length)}>
              <RuntimeFieldRow field={field} value={instance.config} idPrefix={`provider-instance-${instanceId}`} readOnly={readOnly} onChange={updateConfig} />
            </PaneCard>
          ),
        }),
      );
    }
  }

  items.push({ key: "environment-title", gapBefore: 24, node: <PaneSectionTitle title="Environment" /> });
  items.push(
    single(
      "environment",
      <ProviderEnvironmentSection
        environment={genericEnvironment}
        readOnly={readOnly}
        onChange={(environment) => {
          const dedicated = (instance.environment ?? []).filter((variable) => environmentFieldNames.has(variable.name));
          updateEnvironment([...dedicated, ...environment]);
        }}
      />,
    ),
  );

  if (props.acpSessions) items.push({ key: "acp-sessions", gapBefore: 24, node: <PaneCard position="single">{props.acpSessions}</PaneCard> });

  if (driverOption !== undefined) {
    items.push({ key: "models-title", gapBefore: 24, node: <PaneSectionTitle title="Models" /> });
    items.push(...modelItems);
  }
  return items;
}

function EditorStatus({ view }: { view: ReturnType<typeof deriveInstanceView> }) {
  const theme = useTheme();
  const color = theme.mutedForeground;
  const parts: ReactNode[] = [];
  if (view.isAuthenticated && view.authEmail) {
    if (view.needsAttention) parts.push(<StatusDot key="dot" statusKey={view.statusKey} />);
    parts.push(
      <Text key="as" size="xs" color={color}>
        Authenticated as
      </Text>,
    );
    parts.push(
      <div key="email" style={{ display: "flex", maxWidth: 220 }}>
        <RedactedText value={view.authEmail} revealTooltip="Click to reveal email" hideTooltip="Click to hide email" />
      </div>,
    );
    if (view.authLabel)
      parts.push(
        <Text key="label" size="xs" color={color}>
          {`· ${view.authLabel}`}
        </Text>,
      );
  } else {
    if (view.needsAttention) parts.push(<StatusDot key="dot" statusKey={view.statusKey} />);
    parts.push(
      <Text key="headline" size="xs" color={color}>
        {view.summary.headline}
      </Text>,
    );
  }
  if (view.inlineStatusDetail)
    parts.push(
      <Text key="detail" size="xs" color={color}>
        {`· ${view.inlineStatusDetail}`}
      </Text>,
    );
  const row = (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 2 }}>{parts}</div>
  );
  return view.statusDiagnostic ? (
    <Tooltip content={view.statusDiagnostic} side="top">
      {row}
    </Tooltip>
  ) : (
    row
  );
}

/** ProviderSettingsForm variant="settings" field, stacked: the control fills the row. */
function RuntimeFieldRow({
  field,
  value,
  idPrefix,
  readOnly,
  onChange,
}: {
  field: ProviderSettingsFieldModel;
  value: unknown;
  idPrefix: string;
  readOnly: boolean;
  onChange: (next: Record<string, unknown> | undefined) => void;
}) {
  const theme = useTheme();
  const testId = `${idPrefix}-${field.key}`;
  const secretConfigured = field.secret === true && readProviderConfigString(value, field.key).length > 0;
  let control: ReactNode;
  if (field.control === "switch") {
    const raw = value !== null && typeof value === "object" ? (value as Record<string, unknown>)[field.key] : undefined;
    control = (
      <Switch
        testId={testId}
        checked={typeof raw === "boolean" ? raw : (field.defaultBooleanValue ?? false)}
        disabled={readOnly}
        onChange={(checked) => onChange(nextProviderConfigWithFieldValue(value, field, checked))}
      />
    );
  } else if (field.control === "select") {
    const options = field.options ?? [];
    const fallback = options[0]?.value ?? "";
    const current = readProviderConfigString(value, field.key) || fallback;
    control = (
      <FullWidthSelect
        testId={testId}
        value={current}
        disabled={readOnly}
        options={options.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(next) => onChange(nextProviderConfigWithFieldValue(value, field, next === fallback ? "" : next))}
      />
    );
  } else if (field.control === "textarea") {
    control = <TextAreaFieldControl field={field} value={value} testId={testId} onChange={onChange} />;
  } else if (field.secret) {
    control = (
      <>
        <SecretField testId={testId} configured={secretConfigured} width="100%" onCommit={(next) => onChange(nextProviderConfigWithFieldValue(value, field, next))} />
        {secretConfigured ? (
          <IconButton icon="x" size={28} iconSize={14} color={theme.errorForeground} onClick={() => onChange(nextProviderConfigWithFieldValue(value, field, ""))} />
        ) : null}
      </>
    );
  } else {
    control = (
      <DraftTextField
        testId={testId}
        size="sm"
        value={readProviderConfigString(value, field.key)}
        placeholder={field.placeholder}
        readOnly={readOnly}
        onCommit={(next) => onChange(nextProviderConfigWithFieldValue(value, field, next))}
      />
    );
  }
  return <StackedRow title={field.label} description={field.description} control={control} />;
}

/** A select trigger that fills its row (SelectTrigger size="sm" w-full). */
function FullWidthSelect({
  value,
  options,
  onChange,
  disabled,
  testId,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled: boolean;
  testId: string;
}) {
  const theme = useTheme();
  const selected = options.find((option) => option.value === value);
  return (
    <Menu
      align="start"
      minWidth={240}
      testId={`${testId}-menu`}
      rootStyle={{ flexGrow: 1, minWidth: 0 }}
      trigger={({ toggle }) => (
        <div
          testId={testId}
          onClick={disabled ? undefined : toggle}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 28,
            flexGrow: 1,
            minWidth: 0,
            paddingLeft: 9,
            paddingRight: 8,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: fieldBackground(theme),
            opacity: disabled ? 0.64 : 1,
            cursor: disabled ? "default" : "pointer",
          }}
        >
          <Text truncate style={{ flexGrow: 1 }}>
            {selected?.label ?? value}
          </Text>
          <Icon name="chevron-down" size={12} color={alpha(theme.foreground, 0.5)} />
        </div>
      )}
    >
      {options.map((option) => (
        <MenuItem key={option.value} checked={option.value === value} onSelect={() => onChange(option.value)}>
          {option.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

function TextAreaFieldControl({
  field,
  value,
  testId,
  onChange,
}: {
  field: ProviderSettingsFieldModel;
  value: unknown;
  testId: string;
  onChange: (next: Record<string, unknown> | undefined) => void;
}) {
  const saved = readProviderConfigString(value, field.key);
  const [draft, setDraft] = useState(saved);
  const [source, setSource] = useState(saved);
  if (source !== saved) {
    setSource(saved);
    setDraft(saved);
  }
  return (
    <TextArea
      testId={testId}
      value={draft}
      minRows={3}
      mono
      placeholder={field.placeholder}
      onChange={setDraft}
      onBlur={() => {
        if (draft !== saved) onChange(nextProviderConfigWithFieldValue(value, field, draft));
      }}
    />
  );
}

function EnvironmentFieldRow({
  field,
  variable,
  readOnly,
  onCommit,
  onRemove,
}: {
  field: ProviderEnvironmentField;
  variable: ProviderInstanceEnvironmentVariable | undefined;
  readOnly: boolean;
  onCommit: (value: string) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const value = variable?.valueRedacted ? "" : (variable?.value ?? "");
  return (
    <StackedRow
      title={field.label}
      description={field.description}
      control={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: "100%", opacity: readOnly ? 0.5 : 1 }}>
          {field.sensitive === false ? (
            <DraftTextField size="sm" value={value} placeholder={field.placeholder} readOnly={readOnly} onCommit={onCommit} />
          ) : (
            <SecretField configured={variable?.valueRedacted === true || value.length > 0} placeholder={field.placeholder} width="100%" onCommit={onCommit} />
          )}
          {variable ? <IconButton icon="x" size={28} iconSize={14} color={theme.errorForeground} onClick={onRemove} /> : null}
        </div>
      }
    />
  );
}

// ── Environment variables (ProviderEnvironmentSection) ──────────────────

let environmentVariableDraftId = 0;
const nextEnvironmentVariableDraftId = () => `provider-env-${environmentVariableDraftId++}`;

type EnvironmentDraftRow = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
  readonly valueRedacted?: boolean;
};

function makeEnvironmentDraftRow(variable: ProviderInstanceEnvironmentVariable, index: number): EnvironmentDraftRow {
  return {
    id: `${index}:${variable.name}`,
    name: variable.name,
    value: variable.value,
    sensitive: variable.sensitive,
    ...(variable.valueRedacted !== undefined ? { valueRedacted: variable.valueRedacted } : {}),
  };
}

function providerEnvironmentsEqual(
  left: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
  right: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
): boolean {
  return (
    left.length === right.length &&
    left.every((variable, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        variable.name === other.name &&
        variable.value === other.value &&
        variable.sensitive === other.sensitive &&
        variable.valueRedacted === other.valueRedacted
      );
    })
  );
}

export function ProviderEnvironmentSection({
  environment,
  readOnly = false,
  onChange,
}: {
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
  readOnly?: boolean;
  onChange: (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) => void;
}) {
  const theme = useTheme();
  const [rows, setRows] = useState<ReadonlyArray<EnvironmentDraftRow>>(() => environment.map(makeEnvironmentDraftRow));
  const previousEnvironmentRef = useRef(environment);
  const lastPublishedRef = useRef<ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined>(undefined);

  useEffect(() => {
    const previous = previousEnvironmentRef.current;
    const lastPublished = lastPublishedRef.current;
    previousEnvironmentRef.current = environment;
    lastPublishedRef.current = undefined;
    if (
      previous === environment ||
      providerEnvironmentsEqual(previous, environment) ||
      (lastPublished !== undefined && providerEnvironmentsEqual(lastPublished, environment))
    ) {
      return;
    }
    setRows(environment.map(makeEnvironmentDraftRow));
  }, [environment]);

  const publishRows = (nextRows: ReadonlyArray<EnvironmentDraftRow>) => {
    const published: ProviderInstanceEnvironmentVariable[] = [];
    for (const row of nextRows) {
      const name = row.name.trim();
      if (!ENVIRONMENT_VARIABLE_NAME_PATTERN.test(name)) {
        if (name.length > 0 || row.value.length > 0 || row.sensitive !== true || row.valueRedacted !== undefined) return;
        continue;
      }
      const { id: _id, ...rest } = row;
      published.push({ ...rest, name });
    }
    lastPublishedRef.current = published;
    onChange(published);
  };
  const updateVariable = (id: string, patch: Partial<Omit<EnvironmentDraftRow, "id">>) => {
    const nextRows = rows.map((row) => (row.id === id ? { ...row, ...patch, ...(patch.value !== undefined ? { valueRedacted: false } : {}) } : row));
    setRows(nextRows);
    publishRows(nextRows);
  };
  const removeVariable = (id: string) => {
    const nextRows = rows.filter((row) => row.id !== id);
    setRows(nextRows);
    publishRows(nextRows);
  };
  const addVariable = () => setRows([...rows, { id: nextEnvironmentVariableDraftId(), name: "", value: "", sensitive: true }]);

  return (
    <StackedRow
      title="Variables"
      description="API keys, base URLs, and other per-instance CLI settings."
      control={
        <Button size="sm" variant="outline" icon="plus" disabled={readOnly} onClick={addVariable} testId="provider-env-add" style={{ gap: 4 }}>
          Add variable
        </Button>
      }
    >
      {rows.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, paddingBottom: 8 }}>
          {rows.map((variable, index) => (
            <div key={variable.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
              <DraftTextField
                testId={`provider-env-name-${index}`}
                size="sm"
                mono
                width={176}
                value={variable.name}
                placeholder="VARIABLE_NAME"
                onCommit={(name) => updateVariable(variable.id, { name: name.trim() })}
              />
              <Text size="xs" color={theme.mutedForeground}>
                =
              </Text>
              {variable.sensitive ? (
                <SecretField
                  testId={`provider-env-value-${index}`}
                  configured={variable.valueRedacted === true}
                  placeholder="value"
                  width="100%"
                  onCommit={(value) => updateVariable(variable.id, { value })}
                />
              ) : (
                <DraftTextField
                  testId={`provider-env-value-${index}`}
                  size="sm"
                  mono
                  value={variable.valueRedacted ? "" : variable.value}
                  placeholder="value"
                  onCommit={(value) => updateVariable(variable.id, { value })}
                />
              )}
              <Tooltip content={variable.sensitive ? "Sensitive, stored separately" : "Plain text"} side="top">
                <IconButton
                  icon={variable.sensitive ? "lock" : "lock-open"}
                  size={20}
                  iconSize={12}
                  onClick={() => {
                    const sensitive = !variable.sensitive;
                    updateVariable(variable.id, {
                      sensitive,
                      ...(sensitive && variable.valueRedacted === undefined ? {} : { valueRedacted: sensitive ? variable.valueRedacted : false }),
                    });
                  }}
                />
              </Tooltip>
              <IconButton icon="x" size={20} iconSize={12} color={theme.errorForeground} onClick={() => removeVariable(variable.id)} />
            </div>
          ))}
          <Text size="xs" color={theme.mutedForeground}>
            Sensitive values are stored separately and never returned to the app.
          </Text>
        </div>
      ) : null}
    </StackedRow>
  );
}

