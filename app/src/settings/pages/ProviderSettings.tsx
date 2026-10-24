// Port of apps/web/src/routes/settings.providers.tsx and
// apps/web/src/components/settings/ProviderSettingsPanel.tsx (+ ProviderUpdatesAction.tsx).
// The route is single-environment: SettingsView wraps it in a single-environment scope.
//
// Like web, the page scrolls and the provider card has its own height
// (min(44rem, 100dvh - 11rem), at least 32rem), so Usage providers and Advanced sit below
// the fold. The card's detail pane scrolls inside it.
import { useAtomValue } from "@effect/atom-react";
import { useWindowSize } from "@gpuix/react";
import {
  AuthOrchestrationReadScope,
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  resolveProjectProviderInstanceEnabled,
  resolveProviderInstanceEnabled,
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { isAtomCommandInterrupted, squashAtomCommandFailure, settlePromise } from "@t3tools/client-runtime/state/runtime";
import { getBackgroundActivityPresetSettings, resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import { useRef, useState, type ReactNode } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { selectSettingsPageTarget, settingsPageTargetAtom } from "../navigation.ts";
import {
  EMPTY_SERVER_PROVIDERS,
  readEnvironmentScope,
  useAtomCommand,
  useEnvironmentProviders,
  useEnvironments,
  useEnvironmentScope,
  useEnvironmentSessionState,
  useProjects,
  type EnvironmentPresentation,
} from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  getProviderUpdateRunToastView,
  isProviderSettingsUpdateCandidate,
  isProviderUpdateActive,
  type ProviderSettingsUpdateCandidate,
  type ProviderUpdateRun,
} from "../../web/components/ProviderUpdateLaunchNotification.logic.ts";
import {
  buildProviderInstanceOverridePatch,
  classifyProviderEnvironmentAccess,
  resolveRemoteOperateAccess,
} from "../../web/components/settings/ProviderSettingsPanel.logic.ts";
import {
  backgroundActivityOverrideSettings,
  buildProviderInstanceUpdatePatch,
  durationToSeconds,
  normalizeIntervalSeconds,
  PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
} from "../../web/components/settings/SettingsPanels.logic.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { formatRelativeTime } from "../../web/timestampFormat.ts";
import { resolveAppModelSelectionState } from "../../web/modelSelection.ts";
import { machineIcon, PolicyTooltip, usePageWheelClaim, SettingResetButton, SettingsMessage, SettingsPageContainer, SettingsRow, SettingsSection } from "../layout.tsx";
import { AddProviderDialog } from "../providers/AddProviderDialog.tsx";
import type { PaneItem } from "../providers/paneItems.ts";
import { NumberStepper, StackedRow } from "../providers/parts.tsx";
import { AcpSessionManagementSection } from "../providers/AcpSessionManagementSection.tsx";
import { CodexManagedRuntimeFields, CodexSetupSection, readCodexSetupMode } from "../providers/CodexSetupSection.tsx";
import { ProviderAuthenticationSection } from "../providers/ProviderAuthenticationSection.tsx";
import { ProviderSetupSection } from "../providers/ProviderSetupSection.tsx";
import { ProviderInstanceListRow, useProviderEditorItems, type ProviderInstanceCardProps } from "../providers/ProviderInstanceCard.tsx";
import { providerClients } from "../providers/providerDriverMeta.ts";
import {
  useEnvironmentSettings,
  usePersistProviderInstance,
  useToggleModelFavorite,
  useUpdateEnvironmentSettings,
  useUpdateModelPreferences,
} from "../providers/state.ts";
import { UsageProviderSettings } from "../providers/UsageProviderSettings.tsx";
import { useRelativeTimeLabel } from "../RelativeTime.tsx";
import { useSettingsScope } from "../scope.tsx";

/** web providerCardHeightClassName: h-[min(44rem,calc(100dvh-11rem))] min-h-[32rem]. */
const CARD_MAX_HEIGHT = 704;
const CARD_MIN_HEIGHT = 512;
const CARD_VIEWPORT_INSET = 176;
const LIST_WIDTH = 272;

const PROVIDER_SETTINGS = providerClients.definitions.map((definition) => ({
  provider: definition.driverKind,
  hasDefaultInstance: definition.hasDefaultInstance !== false,
}));

function modelListChanges(current: ReadonlyArray<string>, next: ReadonlyArray<string>) {
  const currentSet = new Set(current);
  const nextSet = new Set(next.map((model) => model.trim()).filter(Boolean));
  return [...new Set([...currentSet, ...nextSet])]
    .filter((model) => currentSet.has(model) !== nextSet.has(model))
    .map((model) => ({ model, selected: nextSet.has(model) }));
}

function failureMessage(result: { _tag: string }, fallback: string): string {
  if (result._tag !== "Failure") return fallback;
  const error = squashAtomCommandFailure(result as never);
  return error instanceof Error ? error.message : fallback;
}

export function ProviderSettings() {
  const { environment, scope } = useSettingsScope();
  const pageTarget = selectSettingsPageTarget(useAtomValue(settingsPageTargetAtom), "providers");
  if (!environment) {
    return (
      <SettingsPageContainer>
        <SettingsMessage>
          {scope.kind === "environment" ? `Reconnect ${scope.label} to set up its providers.` : "Connect an environment to set up its providers."}
        </SettingsMessage>
      </SettingsPageContainer>
    );
  }
  const projectIds =
    scope.kind === "project" || scope.kind === "checkout"
      ? scope.members.filter((member) => member.environmentId === environment.environmentId).map((member) => member.id)
      : [];
  return (
    <SettingsPageContainer>
      <AccessGatedProviderSettings
        key={`${environment.environmentId}:${pageTarget?.nonce ?? 0}`}
        environment={environment}
        projectIds={projectIds}
        targetInstanceId={pageTarget?.target.instanceId}
      />
    </SettingsPageContainer>
  );
}

function AccessGatedProviderSettings({
  environment,
  projectIds,
  targetInstanceId,
}: {
  environment: EnvironmentPresentation;
  projectIds: readonly ProjectId[];
  targetInstanceId: ProviderInstanceId | undefined;
}) {
  const sessionState = useEnvironmentSessionState(environment.environmentId);
  const operateAccess = resolveRemoteOperateAccess({ session: sessionState.data, isPending: sessionState.isPending, hasError: sessionState.hasError });
  const access = classifyProviderEnvironmentAccess({
    connectionPhase: environment.connection.phase,
    hasServerConfig: environment.serverConfig !== null,
    operateAccess,
  });
  if (access.kind !== "editable" && access.kind !== "read-only") {
    const isLoading = access.kind === "loading";
    return (
      <ProviderSettingsPlaceholder
        icon={machineIcon(environment.serverConfig)}
        title={isLoading ? "Loading provider settings" : access.kind === "error" ? "Could not connect to this device" : "Provider settings are unavailable"}
        description={
          isLoading
            ? access.reason === "permissions"
              ? "Checking what this session is allowed to change."
              : `Waiting for ${environment.label}'s configuration.`
            : (environment.connection.error ?? `${environment.label} is not connected.`)
        }
      />
    );
  }
  return (
    <EnvironmentProviderSettings
      environmentId={environment.environmentId}
      environmentLabel={environment.label}
      readOnly={access.kind === "read-only"}
      projectIds={projectIds}
      targetInstanceId={targetInstanceId}
    />
  );
}

/** Empty state in the provider card's place. No spinner: a wedged device could leave it repainting forever. */
function ProviderSettingsPlaceholder({ icon, title, description }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; description: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 320,
        padding: 24,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        backgroundColor: alpha(theme.card, 0.4),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: RADIUS.md, backgroundColor: theme.accent }}>
        <Icon name={icon} size={18} color={theme.mutedForeground} />
      </div>
      <Text size="lg" weight={500}>
        {title}
      </Text>
      <Text color={theme.mutedForeground} style={{ textAlign: "center", maxWidth: 480 }}>
        {description}
      </Text>
    </div>
  );
}

// ── "Update all" and "Checked N ago" ────────────────────────────────────

function useProviderUpdates() {
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, { reportFailure: false });
  const machines = environments.flatMap((environment) => {
    const providers = providersByEnvironment.get(environment.environmentId) ?? [];
    if (environment.connection.phase !== "connected") return [];
    const candidates = collectProviderUpdateCandidates(providers).filter((candidate) => canOneClickUpdateProviderCandidate(candidate, providers));
    return candidates.length > 0 ? [{ environmentId: environment.environmentId, label: environment.label, candidates }] : [];
  });
  const updateAll = async () => {
    const runs = await Promise.all(
      machines.flatMap(({ environmentId, label, candidates }) =>
        candidates.map(
          async (candidate): Promise<ProviderUpdateRun> => ({
            environmentId,
            machineLabel: label,
            driver: candidate.driver,
            instanceId: candidate.instanceId,
            result: await updateProvider({ environmentId, input: { provider: candidate.driver, instanceId: candidate.instanceId } }),
          }),
        ),
      ),
    );
    const view = getProviderUpdateRunToastView(runs);
    if (view) toast({ type: view.type, title: view.title, description: view.description });
    return runs;
  };
  return { machines, updateAll };
}

function ProviderUpdatesAction() {
  const { machines, updateAll } = useProviderUpdates();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  if (machines.length === 0 && !isPending) return null;
  const tooltip = machines
    .map((machine) => `${machine.label}: ${machine.candidates.map((candidate) => PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver).join(", ")}`)
    .join("\n");
  return (
    <Tooltip content={tooltip} side="top">
      <Button
        testId="providers-update-all"
        size="xs"
        variant="ghost-muted"
        disabled={isPending}
        onClick={() => {
          if (pending.current) return;
          pending.current = true;
          setIsPending(true);
          void settlePromise(() => updateAll()).then(() => {
            pending.current = false;
            setIsPending(false);
          });
        }}
      >
        {isPending ? "Updating…" : "Update all"}
      </Button>
    </Tooltip>
  );
}

/** Subscribes on its own: a status push restamps checkedAt on every provider. */
function ProviderLastChecked({ environmentId }: { environmentId: EnvironmentId }) {
  const theme = useTheme();
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const lastCheckedAt =
    providers.length > 0 ? providers.reduce((latest, provider) => (provider.checkedAt > latest ? provider.checkedAt : latest), providers[0]!.checkedAt) : null;
  // Re-renders when the label's text would change.
  useRelativeTimeLabel(lastCheckedAt);
  if (lastCheckedAt === null) return null;
  const relative = formatRelativeTime(lastCheckedAt);
  if (!relative) return <Text size="xs" weight={500} color={theme.mutedForeground}>Checked unavailable</Text>;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Text size="xs" weight={500} color={theme.mutedForeground}>
        Checked
      </Text>
      <Text size="xs" mono color={theme.mutedForeground}>
        {relative.value}
      </Text>
      {relative.suffix ? (
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          {relative.suffix}
        </Text>
      ) : null}
    </div>
  );
}

// ── The environment's provider settings ────────────────────────────────

interface InstanceRow {
  readonly instanceId: ProviderInstanceId;
  /** Undefined for a default slot the user never configured. */
  readonly explicitInstance: ProviderInstanceConfig | undefined;
  readonly driver: ProviderDriverKind;
  readonly isDefault: boolean;
  readonly isDirty?: boolean;
}

function buildInstanceRows(settings: UnifiedSettings, serverProviders: ReadonlyArray<ServerProvider>, targetInstanceId: ProviderInstanceId | undefined) {
  const visibleProviderSettings = PROVIDER_SETTINGS.filter(
    (providerSettings) =>
      providerSettings.provider !== "cursor" ||
      serverProviders.some((provider) => provider.instanceId === defaultInstanceIdForDriver(ProviderDriverKind.make("cursor"))),
  );
  const instancesByDriver = new Map<ProviderDriverKind, Array<[ProviderInstanceId, ProviderInstanceConfig]>>();
  for (const [rawId, instance] of Object.entries(settings.providerInstances ?? {})) {
    const list = instancesByDriver.get(instance.driver) ?? [];
    list.push([rawId as ProviderInstanceId, instance]);
    instancesByDriver.set(instance.driver, list);
  }
  const defaultSlotIds = new Set<string>(visibleProviderSettings.map((entry) => String(defaultInstanceIdForDriver(entry.provider))));
  const visibleDriverKinds = new Set<ProviderDriverKind>(visibleProviderSettings.map((entry) => entry.provider));
  const rows: InstanceRow[] = [];
  for (const providerSettings of visibleProviderSettings) {
    const driver = providerSettings.provider;
    const defaultInstanceId = defaultInstanceIdForDriver(driver);
    const explicitInstance = settings.providerInstances?.[defaultInstanceId];
    const isDirty = explicitInstance !== undefined;
    const hasDefaultSlot = providerSettings.hasDefaultInstance || explicitInstance !== undefined;
    if (
      hasDefaultSlot &&
      (driver === "codex" ||
        driver === "claudeAgent" ||
        isDirty ||
        resolveProviderInstanceEnabled(explicitInstance ?? { driver }) ||
        defaultInstanceId === targetInstanceId)
    ) {
      rows.push({ instanceId: defaultInstanceId, explicitInstance, driver, isDefault: true, isDirty });
    }
    for (const [id, instance] of instancesByDriver.get(driver) ?? []) {
      if (id === defaultInstanceId) continue;
      rows.push({ instanceId: id, explicitInstance: instance, driver: instance.driver, isDefault: false });
    }
  }
  for (const [driver, list] of instancesByDriver) {
    if (visibleDriverKinds.has(driver)) continue;
    for (const [id, instance] of list) {
      rows.push({ instanceId: id, explicitInstance: instance, driver: instance.driver, isDefault: defaultSlotIds.has(String(id)) });
    }
  }
  return rows;
}

function EnvironmentProviderSettings({
  environmentId,
  environmentLabel,
  readOnly,
  projectIds,
  targetInstanceId,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  readOnly: boolean;
  projectIds: readonly ProjectId[];
  targetInstanceId: ProviderInstanceId | undefined;
}) {
  const theme = useTheme();
  const windowHeight = useWindowSize().height;
  const claimPageWheel = usePageWheelClaim();
  const settings = useEnvironmentSettings(environmentId);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const canRefreshProviders = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const updateModelPreferences = useUpdateModelPreferences(environmentId);
  const toggleModelFavorite = useToggleModelFavorite(environmentId);
  const persistProviderInstance = usePersistProviderInstance(environmentId);
  const serverProviders = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const supportsProjectProviderOverrides = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
    .projectProviderInstanceOverrides === true;
  const refreshServerProviders = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, { reportFailure: false });
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | null>(targetInstanceId ?? null);
  const [updatingIds, setUpdatingIds] = useState<ReadonlySet<ProviderInstanceId>>(() => new Set());
  const refreshingRef = useRef(false);
  const updatingRef = useRef<Set<ProviderInstanceId>>(new Set());

  const resolvedBackgroundActivity = resolveServerBackgroundActivitySettings(settings);
  const intervalSeconds = durationToSeconds(resolvedBackgroundActivity.providerHealthRefreshInterval);
  const defaultIntervalSeconds = durationToSeconds(getBackgroundActivityPresetSettings(resolvedBackgroundActivity.profile).providerHealthRefreshInterval);

  const refreshProviders = () => {
    if (refreshingRef.current || !readEnvironmentScope(environmentId, AuthOrchestrationReadScope)) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void refreshServerProviders({ environmentId, input: { refreshModels: true } }).then((result) => {
      refreshingRef.current = false;
      setIsRefreshingProviders(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) console.warn("Failed to refresh providers", { environmentId });
    });
  };

  const runProviderUpdate = async (candidate: Pick<ProviderSettingsUpdateCandidate, "driver" | "instanceId">, targetVersion?: string) => {
    if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    if (updatingRef.current.has(candidate.instanceId)) return;
    updatingRef.current.add(candidate.instanceId);
    setUpdatingIds((previous) => new Set(previous).add(candidate.instanceId));
    const result = await updateProvider({
      environmentId,
      input: { provider: candidate.driver, instanceId: candidate.instanceId, ...(targetVersion ? { targetVersion } : {}) },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toast({
        type: "error",
        title: `Could not update ${PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver}`,
        description: failureMessage(result, "The provider update command could not be started."),
      });
    }
    updatingRef.current.delete(candidate.instanceId);
    setUpdatingIds((previous) => {
      if (!previous.has(candidate.instanceId)) return previous;
      const next = new Set(previous);
      next.delete(candidate.instanceId);
      return next;
    });
  };

  const rows = buildInstanceRows(settings, serverProviders, targetInstanceId);
  // web: a link to an instance this device no longer has selects nothing and says so.
  const targetInstanceMissing =
    targetInstanceId !== undefined && selectedInstanceId === targetInstanceId && !rows.some((row) => row.instanceId === targetInstanceId);
  const selectedRow = rows.find((row) => row.instanceId === selectedInstanceId) ?? (targetInstanceMissing ? null : (rows[0] ?? null));

  const persistInstance = async (
    instanceId: ProviderInstanceId,
    next: ProviderInstanceConfig,
    textGenerationModelSelection?: UnifiedSettings["textGenerationModelSelection"],
  ) => {
    const { providerInstances: _omit, ...patch } = buildProviderInstanceUpdatePatch({ settings, instanceId, instance: next, textGenerationModelSelection });
    const result = await persistProviderInstance({ operation: "upsert", instanceId, instance: next }, patch);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toast({ type: "error", title: "Could not update provider instance", description: failureMessage(result, "The settings update failed.") });
    }
  };
  const updateInstance = (instanceId: ProviderInstanceId, previous: ProviderInstanceConfig, next: ProviderInstanceConfig) => {
    const isDisabling = next.enabled === false && resolveProviderInstanceEnabled(previous);
    const shouldClearTextGen =
      isDisabling &&
      resolveAppModelSelectionState(settings, serverProviders).instanceId === instanceId &&
      readEnvironmentScope(environmentId, AuthSettingsWriteScope);
    void persistInstance(instanceId, next, shouldClearTextGen ? DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection : undefined);
  };
  const deleteInstance = async (instanceId: ProviderInstanceId) => {
    const result = await persistProviderInstance({ operation: "remove", instanceId });
    if (result._tag === "Failure") {
      toast({ type: "error", title: "Could not delete provider instance", description: failureMessage(result, "The settings update failed.") });
    }
  };
  const resetDefaultInstance = async (driver: ProviderDriverKind) => {
    const result = await persistProviderInstance({ operation: "remove", instanceId: defaultInstanceIdForDriver(driver) });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toast({ type: "error", title: "Could not reset provider instance", description: failureMessage(result, "The settings update failed.") });
    }
  };
  const writeProjectOverride = (instanceId: ProviderInstanceId, next: boolean | undefined) =>
    updateSettings({ projectSettingsOverrides: buildProviderInstanceOverridePatch(settings, projectIds, instanceId, next) });

  const representativeProjectId = projectIds[0];
  const cardProps = (row: InstanceRow): ProviderInstanceCardProps => {
    const instance = row.explicitInstance ?? { driver: row.driver };
    const liveProvider = serverProviders.find((candidate) => candidate.instanceId === row.instanceId);
    const updateCandidate = liveProvider !== undefined && isProviderSettingsUpdateCandidate(liveProvider) ? liveProvider : undefined;
    const isUpdating = updatingIds.has(row.instanceId) || (liveProvider !== undefined && isProviderUpdateActive(liveProvider));
    const recommendedVersion = liveProvider?.compatibilityAdvisory?.recommendedVersion;
    const canInstallRecommended =
      !readOnly &&
      liveProvider !== undefined &&
      Boolean(liveProvider.compatibilityAdvisory?.message) &&
      Boolean(recommendedVersion) &&
      liveProvider.versionAdvisory?.canInstallVersion === true;
    const showProjectOverride = representativeProjectId !== undefined && supportsProjectProviderOverrides;
    return {
      instanceId: row.instanceId,
      instance,
      driverOption: providerClients.get(row.driver),
      liveProvider,
      readOnly,
      canWriteSettings,
      isUpdating,
      projectOverride: showProjectOverride
        ? {
            value: settings.projectSettingsOverrides[representativeProjectId]?.providerInstances?.[row.instanceId]?.enabled,
            effectiveEnabled: resolveProjectProviderInstanceEnabled(settings, representativeProjectId, row.instanceId),
            onChange: (next) => writeProjectOverride(row.instanceId, next),
            onReset: () => writeProjectOverride(row.instanceId, undefined),
          }
        : undefined,
      onUpdate: (next) => updateInstance(row.instanceId, instance, next),
      onRunUpdate: !readOnly && updateCandidate ? () => !isUpdating && void runProviderUpdate(updateCandidate) : undefined,
      onInstallRecommended: canInstallRecommended ? () => void runProviderUpdate(liveProvider!, recommendedVersion ?? undefined) : undefined,
    };
  };

  const cardHeight = Math.max(CARD_MIN_HEIGHT, Math.min(CARD_MAX_HEIGHT, windowHeight - CARD_VIEWPORT_INSET));
  const healthCheck = searchableSetting("provider-health-check-interval");
  const providersSection = searchableSetting("providers");
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: 32 }}>
      <div testId={`settings-section-${providersSection.id}`} style={{ display: "flex", flexDirection: "column", width: "100%", gap: 10, flexShrink: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 28, paddingLeft: 16, paddingRight: 16 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text color={alpha(theme.foreground, 0.7)}>{providersSection.title}</Text>
            {!readOnly ? (
              <Tooltip content="Add provider" side="top">
                <IconButton testId="providers-add" icon="plus" size={24} iconSize={14} onClick={() => setIsAddOpen(true)} />
              </Tooltip>
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ProviderUpdatesAction />
            <Tooltip content="Refresh provider status" side="top">
              <div
                testId="providers-refresh"
                onClick={isRefreshingProviders || !canRefreshProviders ? undefined : refreshProviders}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  height: 24,
                  paddingLeft: 7,
                  paddingRight: 7,
                  borderRadius: RADIUS.md,
                  cursor: isRefreshingProviders || !canRefreshProviders ? "default" : "pointer",
                  opacity: !canRefreshProviders ? 0.64 : 1,
                  hover: { backgroundColor: theme.accent },
                }}
              >
                <Icon name="refresh-cw" size={12} color={theme.mutedForeground} />
                {isRefreshingProviders ? (
                  <Text size="xs" weight={500} color={theme.mutedForeground}>
                    Refreshing providers
                  </Text>
                ) : (
                  <ProviderLastChecked environmentId={environmentId} />
                )}
              </div>
            </Tooltip>
          </div>
        </div>
        {readOnly ? (
          <div style={{ borderRadius: RADIUS.xl, borderWidth: 1, borderColor: alpha(theme.border, 0.6), backgroundColor: alpha(theme.card, 0.4) }}>
            <SettingsRow title="Limited permissions" description={`This session can view ${environmentLabel}'s providers but can't change their settings.`} />
          </div>
        ) : null}
        <div
          testId="provider-card"
          // The card's own lists take a wheel over it; the page stays put (web chainVerticalScroll).
          onScroll={claimPageWheel}
          style={{
            display: "flex",
            flexDirection: "row",
            width: "100%",
            height: cardHeight,
            flexShrink: 0,
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.6),
            backgroundColor: alpha(theme.card, 0.4),
            overflow: "hidden",
          }}
        >
          <div
            testId="provider-instance-list"
            style={{
              display: "flex",
              flexDirection: "column",
              width: LIST_WIDTH,
              flexShrink: 0,
              borderRightWidth: 1,
              borderColor: alpha(theme.border, 0.6),
              backgroundColor: alpha(theme.muted, 0.1),
              overflowY: "scroll",
              scrollbarColor: theme.scrollbar,
              scrollbarWidth: 6,
            }}
          >
            {rows.map((row, index) => (
              <div key={row.instanceId} style={{ display: "flex", flexDirection: "column", ...(index > 0 ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) } : {}) }}>
                <ProviderInstanceListRow
                  {...cardProps(row)}
                  selected={selectedRow?.instanceId === row.instanceId}
                  onSelect={() => setSelectedInstanceId(row.instanceId)}
                />
              </div>
            ))}
            {!readOnly ? <AddProviderRow divided={rows.length > 0} onClick={() => setIsAddOpen(true)} /> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0 }}>
            {selectedRow ? (
              <ProviderEditorPane
                key={selectedRow.instanceId}
                {...cardProps(selectedRow)}
                environmentId={environmentId}
                environmentLabel={environmentLabel}
                isDefault={selectedRow.isDefault}
                isDirty={selectedRow.isDirty === true}
                settings={settings}
                onDelete={!selectedRow.isDefault ? () => void deleteInstance(selectedRow.instanceId) : undefined}
                onResetDefault={() => void resetDefaultInstance(selectedRow.driver)}
                updateModelPreferences={updateModelPreferences}
                toggleModelFavorite={toggleModelFavorite}
              />
            ) : (
              <div style={{ padding: 24 }}>
                <Text color={theme.mutedForeground}>
                  {targetInstanceMissing ? "This provider instance is no longer available on this device." : "No providers configured."}
                </Text>
              </div>
            )}
          </div>
        </div>
      </div>

      <UsageProviderSettingsSection
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        settings={settings}
        readOnly={readOnly}
      />

      <SettingsSection title="Advanced">
        <SettingsRow
          id={healthCheck.id}
          title={
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text weight={500}>{healthCheck.title}</Text>
              <PolicyTooltip>
                This interval is configured here, then the shared Background activity policy decides whether provider probes may run when the timer fires. Custom intervals appear as Advanced in General settings.
              </PolicyTooltip>
            </div>
          }
          description="Refresh provider status, versions, and models in the background. Set to 0 to disable."
          resetAction={
            intervalSeconds !== defaultIntervalSeconds && canWriteSettings ? (
              <SettingResetButton
                label="provider health check interval"
                onClick={() =>
                  updateSettings(
                    backgroundActivityOverrideSettings(settings.backgroundActivity, resolvedBackgroundActivity, { providerHealthRefreshInterval: undefined }),
                  )
                }
              />
            ) : null
          }
          control={
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
              <NumberStepper
                testId="provider-health-interval"
                value={intervalSeconds}
                min={0}
                step={PROVIDER_HEALTH_INTERVAL_STEP_SECONDS}
                disabled={!canWriteSettings}
                onCommit={(value) =>
                  updateSettings(
                    backgroundActivityOverrideSettings(settings.backgroundActivity, resolvedBackgroundActivity, {
                      providerHealthRefreshInterval: Duration.seconds(normalizeIntervalSeconds(value)),
                    }),
                  )
                }
              />
              <Text size="xs" color={theme.mutedForeground}>
                seconds
              </Text>
            </div>
          }
        />
      </SettingsSection>

      {isAddOpen && !readOnly ? (
        <AddProviderDialog
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          onClose={() => setIsAddOpen(false)}
          onCreated={setSelectedInstanceId}
        />
      ) : null}
    </div>
  );
}

function AddProviderRow({ divided, onClick }: { divided: boolean; onClick: () => void }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <div
      testId="providers-add-row"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: 12,
        cursor: "pointer",
        backgroundColor: hover ? alpha(theme.muted, 0.25) : "#00000000",
        ...(divided ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) } : {}),
      }}
    >
      <Icon name="plus" size={16} color={hover ? theme.foreground : theme.mutedForeground} />
      <Text color={hover ? theme.foreground : theme.mutedForeground}>Add provider</Text>
    </div>
  );
}

function UsageProviderSettingsSection({
  environmentId,
  environmentLabel,
  settings,
  readOnly,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  settings: UnifiedSettings;
  readOnly: boolean;
}) {
  return (
    <UsageProviderSettings
      key={environmentId}
      environmentId={environmentId}
      environmentLabel={environmentLabel}
      sources={settings.usageLimitSources}
      cursorKeychainUsageEnabled={settings.cursorKeychainUsageEnabled}
      readOnly={readOnly}
    />
  );
}

// ── Detail pane ─────────────────────────────────────────────────────────

function configuredBinaryPath(config: unknown): string {
  if (config === null || typeof config !== "object" || !("binaryPath" in config)) return "";
  return typeof config.binaryPath === "string" ? config.binaryPath.trim() : "";
}

/** AcpSessionManagementSection renders nothing without one of these. */
function hasAcpSessionManagement(provider: ServerProvider): boolean {
  return provider.nativeSessions?.canList === true || (provider.auth.canLogout === true && !provider.setup?.canAuthenticate) || provider.configurableProviders === true;
}

const NO_MODELS: ReadonlyArray<string> = [];

function ProviderEditorPane(
  props: ProviderInstanceCardProps & {
    environmentId: EnvironmentId;
    environmentLabel: string;
    isDefault: boolean;
    isDirty: boolean;
    settings: UnifiedSettings;
    onDelete: (() => void) | undefined;
    onResetDefault: () => void;
    updateModelPreferences: ReturnType<typeof useUpdateModelPreferences>;
    toggleModelFavorite: ReturnType<typeof useToggleModelFavorite>;
  },
) {
  const { instanceId, instance, liveProvider, readOnly, settings, environmentId, environmentLabel, updateModelPreferences } = props;
  const preferences = settings.providerModelPreferences?.[instanceId];
  const hiddenModels = preferences?.hiddenModels ?? NO_MODELS;
  const modelOrder = preferences?.modelOrder ?? NO_MODELS;
  const favoriteModels = settings.favorites.filter((favorite) => favorite.provider === instanceId).map((favorite) => favorite.model);
  const codexSetupMode = instance.driver === "codex" ? readCodexSetupMode(instance.config) : null;
  const allProjects = useProjects();
  const acpProjects = liveProvider?.driver === "acpRegistry" ? allProjects.filter((project) => project.environmentId === environmentId) : [];
  const setup: ReactNode =
    instance.driver === "antigravity" ? (
      <ProviderSetupSection
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        instanceId={instanceId}
        provider={liveProvider}
        binaryPath={configuredBinaryPath(instance.config)}
        enabled={resolveProviderInstanceEnabled(instance)}
        readOnly={readOnly}
        onEnable={() => props.onUpdate({ ...instance, enabled: true })}
      />
    ) : codexSetupMode === "managed" ? (
      <CodexSetupSection
        environmentId={environmentId}
        instanceId={instanceId}
        provider={liveProvider}
        enabled={resolveProviderInstanceEnabled(instance)}
        readOnly={readOnly}
      />
    ) : !readOnly && liveProvider && (liveProvider.setup?.canAuthenticate || (liveProvider.driver === "acpRegistry" && liveProvider.installed)) ? (
      <ProviderAuthenticationSection
        key={`${environmentId}:${instanceId}`}
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        instanceId={instanceId}
        provider={liveProvider}
        readOnly={readOnly}
      />
    ) : !readOnly && instance.driver === "cursor" && liveProvider?.setup?.canAuthenticate === false ? (
      <StackedRow title="Cursor account" description="Using CURSOR_API_KEY. Remove it from this provider's environment to use browser sign-in." />
    ) : null;
  const items = useProviderEditorItems({
    ...props,
    setup,
    ...(codexSetupMode === "managed"
      ? { managedRuntime: <CodexManagedRuntimeFields environmentId={environmentId} instanceId={instanceId} provider={liveProvider} /> }
      : {}),
    ...(liveProvider?.driver === "acpRegistry" && hasAcpSessionManagement(liveProvider)
      ? {
          acpSessions: (
            <AcpSessionManagementSection
              environmentId={environmentId}
              instanceId={instanceId}
              provider={liveProvider}
              projects={acpProjects.map((project) => ({ id: project.id, title: project.title, workspaceRoot: project.workspaceRoot }))}
              readOnly={readOnly}
            />
          ),
        }
      : {}),
    hiddenModels,
    favoriteModels,
    modelOrder,
    onHiddenModelsChange: (next, affectedModels) => {
      const hidden = new Set(next);
      const models = affectedModels ?? modelListChanges(hiddenModels, next).map((change) => change.model);
      void updateModelPreferences({ setModelsHidden: models.map((model) => ({ provider: instanceId, model, hidden: hidden.has(model) })) });
    },
    onToggleFavorite: (model) => void props.toggleModelFavorite(instanceId, model),
    onFavoriteModelsChange: (next) =>
      void updateModelPreferences({
        setModelFavorites: modelListChanges(favoriteModels, next).map(({ model, selected }) => ({ provider: instanceId, model, favorite: selected })),
      }),
    onModelOrderChange: (nextOrder) => void updateModelPreferences({ setProviderModelOrder: { provider: instanceId, modelOrder: nextOrder } }),
  });
  return <PaneList items={items} />;
}

/** The detail pane's one scroller: a virtual list, so long model lists build only what is visible. */
function PaneList({ items }: { items: ReadonlyArray<PaneItem> }) {
  return (
    <div testId="provider-detail-scroll" style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <virtual-list overdraw={600} style={{ width: "100%", flexGrow: 1, minHeight: 0 }}>
        {items.map((item, index) => (
          <div
            key={item.key}
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: index === 0 ? 16 : (item.gapBefore ?? 0),
              paddingBottom: index === items.length - 1 ? 16 : 0,
            }}
          >
            {item.node}
          </div>
        ))}
      </virtual-list>
    </div>
  );
}
