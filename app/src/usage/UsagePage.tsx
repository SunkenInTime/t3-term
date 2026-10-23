// Port of apps/web/src/routes/usage.tsx + apps/web/src/components/usage/UsagePage.tsx.
import { useAtom, useAtomValue } from "@effect/atom-react";
import { useWindowSize } from "@gpuix/react";
import { usesChatGptSharing, CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageProviderKind,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { runAtomCommand, settlePromise } from "@t3tools/client-runtime/state/runtime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Cause from "effect/Cause";
import {
  cursorKeychainAccessEnvironments,
  refreshUsageLimits,
} from "@t3tools/client-runtime/state/usage";
import {
  updatingProvidersLabel,
  usageEnvironmentProgress,
  usageLoadingState,
} from "@t3tools/client-runtime/state/usage-progress";
import {
  isCompatibleUsageContractVersion,
  isModelCostUnknown,
  type DailyTotals,
  type HourlyTotals,
  type MergedUsage,
} from "@t3tools/shared/usageMerge";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsageContractMismatch,
  formatUsd,
  makeWindow,
} from "@t3tools/shared/usageFormat";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { serverEnvironment } from "../state/environment.ts";
import { activeKeybindingsAtom } from "../state/keybindings.ts";
import { sidebarOpenAtom } from "../state/ui.ts";
import {
  environmentPresentations,
  selectUsageMetric,
  selectUsageModel,
  selectUsageWindow,
  updateUsagePagePreferences,
  usagePagePreferencesAtom,
  useUsage,
  type EnvironmentUsageStatus,
} from "../state/usage.ts";
import { shortcutLabelForCommand } from "../web/keybindings.ts";
import {
  costTypeSegments,
  modelShare,
  sortModelsByTokens,
  speedCostSegments,
  tokenTypeSegments,
} from "../web/components/usage/usageBreakdown.ts";
import {
  PROVIDER_ORDER,
  PROVIDER_PRESENTATION,
  providersWithUsage,
} from "../web/components/usage/usageProviders.ts";
import { METRIC_OPTIONS, WINDOW_OPTIONS, type UsageMetric } from "../web/components/usage/usageShortcuts.ts";
import { resolveHour12 } from "../web/components/usage/usageTimestamp.ts";
import { Icon } from "../ui/Icon.tsx";
import { Button, IconButton, Text } from "../ui/primitives.tsx";
import { Menu, Select, Tooltip } from "../ui/overlay.tsx";
import { LAYOUT, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { openExternalUrl } from "./openExternal.ts";
import { ProviderGlyph } from "./ProviderMark.tsx";
import { UsageLimitsSection } from "./UsageLimits.tsx";
import { UsageModelDialogHost } from "./UsageModelDialog.tsx";
import { UsagePriceOverrides } from "./UsagePriceOverrides.tsx";
import { UsageProviderChart, UsageScrollContext } from "./UsageProviderChart.tsx";
import { SpeedPremium, UsageShareBar } from "./UsageShareBar.tsx";
import {
  InlineButton,
  MenuCheckboxRow,
  Segmented,
  Skeleton,
  UsageMenuItem,
  UsageMenuSeparator,
  figureOpacity,
  resolveUsageColor,
} from "./usageUi.tsx";

// Tailwind breakpoints, read against the window width (web reads the viewport).
const MD = 768;
const LG = 1024;
const XL = 1280;
const XXL = 1536;

const providerLabel = (provider: UsageProviderKind) => PROVIDER_PRESENTATION[provider].label;

function usageLoading(
  showingKept: boolean,
  selectedEnvironments: Parameters<typeof usageLoadingState>[0],
  refreshingUsage: boolean,
  hiddenProviders: ReadonlySet<UsageProviderKind>,
) {
  if (showingKept) {
    return { partial: true, everyProvider: true, providers: new Set<UsageProviderKind>() };
  }
  const state = usageLoadingState(selectedEnvironments, refreshingUsage);
  const providers = new Set([...state.providers].filter((p) => !hiddenProviders.has(p)));
  return {
    partial: state.everyProvider || providers.size > 0,
    everyProvider: state.everyProvider,
    providers,
  };
}

function windowFor(days: number): UsageSummaryInput {
  return makeWindow(days, undefined, days === 1 ? "hour" : "day");
}

export function UsagePage() {
  const theme = useTheme();
  const { width: viewportWidth } = useWindowSize();
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const preferences = useAtomValue(usagePagePreferencesAtom);
  const keybindings = useAtomValue(activeKeybindingsAtom);
  const hour12 = resolveHour12("locale");
  const shortcutFor = (command: (typeof METRIC_OPTIONS)[number]["command"] | (typeof WINDOW_OPTIONS)[number]["command"]) =>
    shortcutLabelForCommand(keybindings, command, { context: { usagePageOpen: true } });

  // Preferences live in an atom so shortcuts can change them; the window is
  // computed here when the period changes, as web's selectWindow does.
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: preferences.windowDays as number,
    window: windowFor(preferences.windowDays),
  }));
  let currentSelection = windowSelection;
  if (windowSelection.days !== preferences.windowDays) {
    currentSelection = { days: preferences.windowDays, window: windowFor(preferences.windowDays) };
    setWindowSelection(currentSelection);
  }
  const metric = preferences.metric;
  const showingLimits = metric === "limits";
  // web stamps `limitsNow` when Limits is selected and after each limits refresh.
  const [limitsClock, setLimitsClock] = useState(() => ({ metric, now: Date.now() }));
  let limitsNow = limitsClock.now;
  if (limitsClock.metric !== metric) {
    limitsNow = metric === "limits" ? Date.now() : limitsClock.now;
    setLimitsClock({ metric, now: limitsNow });
  }
  const setLimitsNow = (now: number) => setLimitsClock((previous) => ({ ...previous, now }));

  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [priceDialog, setPriceDialog] = useState<{ readonly model?: string } | null>(null);
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] = useState<ReadonlySet<EnvironmentId> | null>(null);
  const hiddenKey = (preferences.hiddenProviders ?? []).join(",");
  const [hiddenProviders, setHiddenProviders] = useState(() => ({
    key: hiddenKey,
    set: new Set(preferences.hiddenProviders ?? []) as ReadonlySet<UsageProviderKind>,
  }));
  let hidden = hiddenProviders.set;
  if (hiddenProviders.key !== hiddenKey) {
    hidden = new Set(preferences.hiddenProviders ?? []);
    setHiddenProviders({ key: hiddenKey, set: hidden });
  }
  const { days: windowDays, window } = currentSelection;
  const isPast24Hours = windowDays === 1;
  const {
    merged: answeredUsage,
    environments,
    selectedEnvironments,
    shown,
    isPartial,
    refresh,
  } = useUsage(window, selectedEnvironmentIds, hidden);
  const merged = shown?.merged ?? answeredUsage;
  const shownWindow = shown?.window ?? window;
  const shownHourly = shownWindow.resolution === "hour";
  const refreshingUsage = isRefreshing && !showingLimits;
  const showingKept = shown !== null && shown.window !== window;
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const presentationsWithProviders = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const cursorAccessEnvironments = hidden.has("cursor") ? [] : cursorKeychainAccessEnvironments(selectedEnvironments);
  const scrollRef = useRef({ current: 0 }).current;

  const canReadDiagnostics = selectedEnvironments.some((environment) => environment.canReadDiagnostics);

  const refreshLimits = (automatic = false, afterPending = false) =>
    // Settled so the timestamp still advances when a refresh throws.
    settlePromise(() =>
      Promise.all(
        Array.from(presentations, ([environmentId, presentation]) => {
          if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(environmentId)) return;
          if (presentation.connection.phase === "connected" && presentation.serverConfig !== null) {
            return refreshUsageLimits(
              environmentId,
              () =>
                runAtomCommand(
                  appAtomRegistry,
                  serverEnvironment.refreshProviders,
                  { environmentId, input: {} },
                  { reportFailure: false },
                ),
              automatic,
              afterPending,
            );
          }
        }),
      ),
    ).then((result) => {
      setLimitsNow(Date.now());
      if (!AsyncResult.isSuccess(result)) throw Cause.squash(result.cause);
    });

  const refreshWindow = () => {
    if (refreshingRef.current) return;

    if (showingLimits) {
      refreshingRef.current = true;
      setIsRefreshing(true);
      void refreshLimits()
        .catch(() => {})
        .finally(() => {
          refreshingRef.current = false;
          setIsRefreshing(false);
        });
      return;
    }
    const nextWindow = windowFor(windowDays);
    if (
      nextWindow.sinceDay !== window.sinceDay ||
      nextWindow.untilDay !== window.untilDay ||
      nextWindow.sinceTime !== window.sinceTime ||
      nextWindow.untilTime !== window.untilTime
    ) {
      setWindowSelection({ days: windowDays, window: nextWindow });
    }
    refreshingRef.current = true;
    setIsRefreshing(true);
    void refresh(nextWindow).finally(() => {
      refreshingRef.current = false;
      setIsRefreshing(false);
    });
  };
  const connectedLimitsEnvironments = [...presentations]
    .filter(
      ([environmentId, presentation]) =>
        presentation.connection.phase === "connected" &&
        presentation.serverConfig !== null &&
        (selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId)),
    )
    .map(([environmentId]) => environmentId)
    .sort()
    .join(",");
  const autoRefreshLimits = useRef(refreshLimits);
  autoRefreshLimits.current = refreshLimits;
  useEffect(() => {
    if (showingLimits && connectedLimitsEnvironments) void autoRefreshLimits.current(true).catch(() => {});
  }, [showingLimits, connectedLimitsEnvironments]);

  const days = enumerateDays(shownWindow.sinceDay, shownWindow.untilDay);
  const hours =
    shownWindow.sinceTime === undefined || shownWindow.untilTime === undefined
      ? []
      : enumerateHourStarts(shownWindow.sinceTime, shownWindow.untilTime);
  const showChatGptSharing =
    !hidden.has("codex") &&
    [...presentationsWithProviders].some(
      ([id, presentation]) =>
        (selectedEnvironmentIds === null || selectedEnvironmentIds.has(id)) &&
        (presentation.serverConfig?.providers ?? []).some(usesChatGptSharing),
    );

  const windowLabel =
    shownHourly && shownWindow.sinceTime !== undefined && shownWindow.untilTime !== undefined
      ? `${formatDateTimeShort(shownWindow.sinceTime, shownWindow.timeZone, hour12)} to ${formatDateTimeShort(shownWindow.untilTime, shownWindow.timeZone, hour12)}`
      : `${formatDayShort(shownWindow.sinceDay)} to ${formatDayShort(shownWindow.untilDay)}`;

  const metricOptions = METRIC_OPTIONS.map((option) => ({
    value: option.value as UsageMetric,
    label: option.label,
    tooltip: option.label,
    shortcut: shortcutFor(option.command),
  }));
  const periodOptions = WINDOW_OPTIONS.map((option) => ({
    value: String(option.days),
    label: option.label,
    tooltip: option.label,
    shortcut: shortcutFor(option.command),
  }));
  const refreshDisabled = isRefreshing || (!showingLimits && !canReadDiagnostics);
  const refreshButton = (
    <IconButton
      icon="refresh-cw"
      iconSize={14}
      testId="usage-refresh"
      disabled={refreshDisabled}
      onClick={refreshWindow}
      style={refreshDisabled ? { opacity: 0.64 } : undefined}
    />
  );

  const separator = (
    <Text weight={500} color={theme.mutedForeground}>
      /
    </Text>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, height: "100%" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: LAYOUT.topbar,
          flexShrink: 0,
          gap: 12,
          paddingLeft: sidebarOpen ? 20 : 12,
          paddingRight: 20,
        }}
      >
        {sidebarOpen ? null : <IconButton icon="panel-left" testId="usage-open-sidebar" onClick={() => setSidebarOpen(true)} />}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0, flexShrink: 1 }}>
          <div style={{ flexShrink: 0 }}>
            <Text weight={500} color={theme.mutedForeground}>
              Usage
            </Text>
          </div>
          {separator}
          <UsageEnvironmentFilter
            environments={environments}
            selectedEnvironments={selectedEnvironments}
            selectedEnvironmentIds={selectedEnvironmentIds}
            onSelectionChange={setSelectedEnvironmentIds}
            showUsageStatus={!showingLimits}
            refreshing={refreshingUsage}
            isPartial={isPartial}
            duplicateSources={merged.duplicateSources}
            contractMismatches={merged.contractMismatches}
            onOpenModelPrices={() => setPriceDialog({})}
          />
          {separator}
          <UsageProviderFilter
            hiddenProviders={hidden}
            onChange={(next) => updateUsagePagePreferences({ hiddenProviders: next })}
          />
        </div>
        {!showingLimits && viewportWidth >= XXL ? (
          <div style={{ minWidth: 0, flexShrink: 1 }}>
            <Text size="xs" color={theme.mutedForeground} truncate>
              {windowLabel}
            </Text>
          </div>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        {viewportWidth >= XL ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <Segmented
              testIdPrefix="usage-metric"
              options={metricOptions}
              value={metric}
              onChange={selectUsageMetric}
            />
            <Segmented
              testIdPrefix="usage-period"
              options={periodOptions}
              value={String(windowDays)}
              disabled={showingLimits}
              onChange={(value) => selectUsageWindow(Number(value))}
            />
            {refreshButton}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <Select
              testId="usage-metric-select"
              minWidth={0}
              options={metricOptions}
              value={metric}
              onChange={selectUsageMetric}
            />
            {showingLimits ? null : (
              <Select
                testId="usage-period-select"
                minWidth={0}
                options={periodOptions}
                value={String(windowDays)}
                onChange={(value) => selectUsageWindow(Number(value))}
              />
            )}
            {refreshButton}
          </div>
        )}
      </div>

      <UsageScrollContext.Provider value={scrollRef}>
        <div
          testId="usage-scroll"
          onScrollChange={(event) => {
            scrollRef.current = event.scrollY ?? 0;
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flexGrow: 1,
            minHeight: 0,
            overflowY: "scroll",
            scrollbarColor: theme.scrollbar,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              width: "100%",
              maxWidth: 1024,
              paddingLeft: viewportWidth >= 640 ? 24 : 20,
              paddingRight: viewportWidth >= 640 ? 24 : 20,
              paddingTop: 24,
              paddingBottom: 48,
              flexShrink: 0,
            }}
          >
            {selectedEnvironments.length === 0 ? (
              <Text color={theme.mutedForeground}>
                {environments.length === 0
                  ? `Connect an environment to see ${showingLimits ? "limits" : "usage"}.`
                  : `Select an environment to see ${showingLimits ? "limits" : "usage"}.`}
              </Text>
            ) : showingLimits ? (
              <UsageLimitsSection
                selectedEnvironmentIds={selectedEnvironmentIds}
                hiddenProviders={hidden}
                now={limitsNow}
                cursorPrompt={
                  cursorAccessEnvironments.length > 0 ? (
                    <CursorEnableLimits
                      environments={cursorAccessEnvironments}
                      onEnabled={() => {
                        void refresh();
                        void refreshLimits(false, true).catch(() => {});
                      }}
                    />
                  ) : null
                }
              />
            ) : shown === null ? (
              <UsageSkeleton viewportWidth={viewportWidth} />
            ) : !canReadDiagnostics ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 48, paddingBottom: 48 }}>
                {selectedEnvironments.map((environment) => (
                  <Text key={environment.environmentId} color={theme.mutedForeground} style={{ textAlign: "center" }}>
                    {`${selectedEnvironments.length > 1 ? `${environment.label}: ` : ""}${environment.error ?? ""}`}
                  </Text>
                ))}
              </div>
            ) : (
              <UsageOverview
                merged={merged}
                shownWindow={shownWindow}
                hour12={hour12}
                days={days}
                hours={hours}
                showingKept={showingKept}
                metric={metric === "tokens" ? "tokens" : "cost"}
                selectedEnvironments={selectedEnvironments}
                hiddenProviders={hidden}
                refreshingUsage={refreshingUsage}
                cursorAccessEnvironments={cursorAccessEnvironments}
                showChatGptSharing={showChatGptSharing}
                viewportWidth={viewportWidth}
                onCursorEnabled={() => {
                  void refresh();
                  void refreshLimits(false, true).catch(() => {});
                }}
                onSelectModel={selectUsageModel}
              />
            )}
          </div>
        </div>
      </UsageScrollContext.Provider>
      {showingLimits ? null : (
        <UsageModelDialogHost
          models={merged.models}
          environments={selectedEnvironments}
          metric={metric === "tokens" ? "tokens" : "cost"}
          chartWindow={{
            days,
            hours,
            resolution: shownHourly ? "hour" : "day",
            timeZone: shownWindow.timeZone,
            referenceTime: shownWindow.untilTime,
            hour12,
          }}
          onSetPrice={(model) => setPriceDialog({ model })}
        />
      )}
      {priceDialog ? (
        <UsagePriceOverrides
          usage={environments}
          initialSelectedEnvironmentIds={selectedEnvironmentIds}
          initialModel={priceDialog.model}
          onOpenChange={(open) => {
            if (!open) setPriceDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text weight={500}>{children}</Text>;
}

function UsageOverview({
  merged,
  shownWindow,
  hour12,
  days,
  hours,
  showingKept,
  metric,
  selectedEnvironments,
  hiddenProviders,
  refreshingUsage,
  cursorAccessEnvironments,
  showChatGptSharing,
  viewportWidth,
  onCursorEnabled,
  onSelectModel,
}: {
  readonly merged: MergedUsage;
  readonly shownWindow: UsageSummaryInput;
  readonly hour12: boolean;
  readonly days: readonly string[];
  readonly hours: readonly string[];
  readonly showingKept: boolean;
  readonly metric: "tokens" | "cost";
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly refreshingUsage: boolean;
  readonly cursorAccessEnvironments: readonly EnvironmentUsageStatus[];
  readonly showChatGptSharing: boolean;
  readonly viewportWidth: number;
  readonly onCursorEnabled: () => void;
  readonly onSelectModel: (key: string) => void;
}) {
  const theme = useTheme();
  const [breakdown, setBreakdown] = useState<"model" | "time">("model");
  const shownHourly = shownWindow.resolution === "hour";
  const loading = usageLoading(showingKept, selectedEnvironments, refreshingUsage, hiddenProviders);
  const loadingPartial = loading.partial === true;
  const loadingProviders = new Set(
    PROVIDER_ORDER.filter((provider) => loading.everyProvider || loading.providers.has(provider)),
  );
  const providersWithData = new Set(providersWithUsage(merged.providers));
  const activeProviders = [...PROVIDER_ORDER].filter(
    (provider) => providersWithData.has(provider) || loading.providers.has(provider),
  );
  const chartLoadingKey = activeProviders.filter((provider) => loadingProviders.has(provider)).join(",");
  const [chartLoading, setChartLoading] = useState(() => ({ key: chartLoadingKey, set: new Set(activeProviders.filter((p) => loadingProviders.has(p))) }));
  let chartLoadingProviders: ReadonlySet<UsageProviderKind> = chartLoading.set;
  if (chartLoading.key !== chartLoadingKey) {
    const set = new Set(activeProviders.filter((provider) => loadingProviders.has(provider)));
    chartLoadingProviders = set;
    setChartLoading({ key: chartLoadingKey, set });
  }
  const activeKey = activeProviders.join(",");
  const [activeMemo, setActiveMemo] = useState(() => ({ key: activeKey, list: activeProviders }));
  let chartProviders: readonly UsageProviderKind[] = activeMemo.list;
  if (activeMemo.key !== activeKey) {
    chartProviders = activeProviders;
    setActiveMemo({ key: activeKey, list: activeProviders });
  }
  const sourceMessages = [
    ...new Set(
      selectedEnvironments.flatMap(
        (environment) =>
          environment.summary?.sources.flatMap((source) =>
            source.message &&
            !source.action &&
            !hiddenProviders.has(source.fingerprint.provider) &&
            (source.status === "partial" ||
              source.status === "failed" ||
              source.fingerprint.provider === "cursor")
              ? [source.message]
              : [],
          ) ?? [],
      ),
    ),
  ];
  const breakdownPeriods: readonly (DailyTotals | HourlyTotals)[] = (
    shownHourly ? merged.hourly : merged.daily
  ).toReversed();
  const breakdownModels =
    breakdown === "model" && metric === "tokens" ? sortModelsByTokens(merged.models) : merged.models;
  const breakdownPeak = breakdownModels.reduce(
    (peak, model) => Math.max(peak, metric === "tokens" ? model.totalTokens : model.costUsd),
    0,
  );
  const cursorInsertAt = Math.max(activeProviders.indexOf("codex"), activeProviders.indexOf("claude")) + 1;
  const summaryRows: ReadonlyArray<
    | { readonly kind: "usage"; readonly provider: UsageProviderKind }
    | { readonly kind: "enable"; readonly environment: EnvironmentUsageStatus }
  > = [
    ...activeProviders.slice(0, cursorInsertAt).map((provider) => ({ kind: "usage" as const, provider })),
    ...cursorAccessEnvironments.map((environment) => ({ kind: "enable" as const, environment })),
    ...activeProviders.slice(cursorInsertAt).map((provider) => ({ kind: "usage" as const, provider })),
  ];
  const twoColumns = viewportWidth >= LG;

  const summary = (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0, ...(twoColumns ? { width: 288, flexShrink: 0 } : {}) }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Text weight={600} style={{ fontSize: 36, lineHeight: 40, opacity: figureOpacity(loadingPartial) }}>
          {metric === "cost" ? formatUsd(merged.costUsd) : formatTokens(merged.totalTokens)}
        </Text>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          <div style={{ display: "flex", flexDirection: "row" }}>
            <Text size="xs" color={theme.mutedForeground} style={{ opacity: figureOpacity(loadingPartial) }}>
              {`${formatCount(merged.sessions)} sessions`}
            </Text>
            {metric === "cost" ? (
              <Text size="xs" color={theme.mutedForeground}>
                {" · API estimate"}
              </Text>
            ) : null}
          </div>
          {metric === "cost" && merged.costQuality.unpricedShare > 0 ? (
            <Tooltip side="top" content={`API estimate excludes ${formatPercent(merged.costQuality.unpricedShare)} unpriced records.`}>
              <div testId="usage-unpriced-info" style={{ display: "flex", cursor: "pointer" }}>
                <Icon name="info" size={12} color={theme.mutedForeground} />
              </div>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {showChatGptSharing ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text size="xs" color={theme.mutedForeground}>
            ChatGPT shared usage
          </Text>
          <Button variant="ghost-muted" size="xs" trailingIcon="external-link" onClick={() => openExternalUrl(CHATGPT_USAGE_URL)}>
            Manage usage
          </Button>
        </div>
      ) : null}

      {summaryRows.map((row) => {
        if (row.kind === "enable") {
          return (
            <CursorEnableRow
              key={`enable:${row.environment.environmentId}`}
              environmentId={row.environment.environmentId}
              label={row.environment.label}
              showEnvironment={selectedEnvironments.length > 1}
              onEnabled={onCursorEnabled}
            />
          );
        }
        const provider = row.provider;
        const totals = merged.providers.find((entry) => entry.provider === provider);
        const share = metric === "cost" ? (totals?.costShare ?? 0) : (totals?.tokenShare ?? 0);
        const providerSessions = totals?.sessions ?? 0;
        const sessionLabel = `${formatCount(providerSessions)} ${providerSessions === 1 ? "session" : "sessions"}`;
        const providerLoading = loadingProviders.has(provider);
        const awaitingData = providerLoading && !providersWithData.has(provider);
        const presentation = PROVIDER_PRESENTATION[provider];
        return (
          <div key={provider} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    flexShrink: 0,
                    backgroundColor: resolveUsageColor(presentation.color, theme),
                  }}
                />
                <ProviderGlyph driver={presentation.driverKind} displayName={presentation.label} size={16} />
                <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                  <Text truncate>{presentation.label}</Text>
                  <div style={{ flexShrink: 0, opacity: awaitingData ? 0 : figureOpacity(providerLoading) }}>
                    <Text size="2xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
                      {sessionLabel}
                    </Text>
                  </div>
                </div>
              </div>
              <div style={{ flexShrink: 0, opacity: figureOpacity(providerLoading) }}>
                <Text weight={500}>
                  {awaitingData
                    ? "-"
                    : metric === "cost"
                      ? formatUsd(totals?.costUsd ?? 0)
                      : formatTokens(totals?.totalTokens ?? 0)}
                </Text>
              </div>
            </div>
            <div style={{ opacity: awaitingData ? 0 : figureOpacity(providerLoading) }}>
              <Text size="xs" color={theme.mutedForeground}>
                {metric === "cost"
                  ? `${formatPercent(share)} of cost · ${formatTokens(totals?.totalTokens ?? 0)} tokens`
                  : `${formatPercent(share)} of tokens · ${formatUsd(totals?.costUsd ?? 0)}`}
              </Text>
            </div>
          </div>
        );
      })}
    </div>
  );

  const chart = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, flexGrow: 1, flexBasis: 0 }}>
      <SectionTitle>{`${shownHourly ? "Hourly" : "Daily"} ${metric === "tokens" ? "processed tokens" : "cost"}`}</SectionTitle>
      <UsageProviderChart
        testId="usage-chart"
        providers={chartProviders}
        loadingProviders={chartLoadingProviders}
        days={days}
        daily={merged.daily}
        hours={hours}
        hourly={merged.hourly}
        metric={metric}
        referenceTime={shownWindow.untilTime}
        resolution={shownHourly ? "hour" : "day"}
        timeZone={shownWindow.timeZone}
        hour12={hour12}
      />
    </div>
  );

  const metrics = [
    { label: "Processed tokens", value: formatTokens(merged.totalTokens) },
    { label: "Cached input", value: formatTokens(merged.cachedInputTokens) },
    { label: "Uncached input", value: formatTokens(merged.uncachedInputTokens) },
    { label: "Output", value: formatTokens(merged.outputTokens) },
    { label: "Cache savings", value: formatUsd(merged.costQuality.cacheSavingsUsd) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {sourceMessages.map((message) => (
        <div key={message} style={{ marginBottom: 16 }}>
          <Text color={theme.mutedForeground}>{message}</Text>
        </div>
      ))}
      <div style={{ display: "flex", flexDirection: twoColumns ? "row" : "column", gap: 24 }}>
        {summary}
        {chart}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionTitle>Totals</SectionTitle>
        <MetricGrid columns={viewportWidth >= MD ? 5 : 2}>
          {metrics.map((entry) => (
            <Metric key={entry.label} label={entry.label} value={entry.value} loading={loadingPartial} />
          ))}
        </MetricGrid>
      </div>

      {merged.totalTokens > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: twoColumns ? "row" : "column",
            columnGap: 48,
            rowGap: 32,
            opacity: figureOpacity(loadingPartial),
          }}
        >
          {metric === "tokens" ? (
            <ShareCell twoColumns={twoColumns}>
              <UsageShareBar label="Tokens by type" segments={tokenTypeSegments(merged)} format={formatTokens} />
            </ShareCell>
          ) : (
            <>
              <ShareCell twoColumns={twoColumns}>
                <UsageShareBar label="Cost by type" segments={costTypeSegments(merged.categoryCost)} format={formatUsd} />
              </ShareCell>
              {merged.speedCost.fast + merged.speedCost.ultrafast > 0 ? (
                <ShareCell twoColumns={twoColumns}>
                  <UsageShareBar
                    label="Cost by speed"
                    segments={speedCostSegments(merged.speedCost)}
                    format={formatUsd}
                    aside={<SpeedPremium premiumUsd={merged.speedCost.premium} format={formatUsd} />}
                  />
                </ShareCell>
              ) : null}
            </>
          )}
          {twoColumns && (metric === "tokens" || merged.speedCost.fast + merged.speedCost.ultrafast <= 0) ? (
            <ShareCell twoColumns />
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <SectionTitle>Breakdown</SectionTitle>
          <Segmented
            testIdPrefix="usage-breakdown"
            options={[
              { value: "model", label: "Model" },
              { value: "time", label: shownHourly ? "Hour" : "Day" },
            ]}
            value={breakdown}
            onChange={setBreakdown}
          />
        </div>

        {breakdown === "model" ? (
          <ModelTable
            models={breakdownModels}
            metric={metric}
            peak={breakdownPeak}
            loadingProviders={loadingProviders}
            showShare={viewportWidth >= 640}
            onSelectModel={onSelectModel}
          />
        ) : (
          <PeriodTable
            periods={breakdownPeriods}
            providers={activeProviders}
            hourly={shownHourly}
            timeZone={shownWindow.timeZone}
            hour12={hour12}
            loadingProviders={loadingProviders}
            loadingPartial={loadingPartial}
          />
        )}
      </div>
    </div>
  );
}

function ShareCell({ twoColumns, children }: { twoColumns: boolean; children?: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", minWidth: 0, ...(twoColumns ? { flexGrow: 1, flexBasis: 0 } : {}) }}>{children}</div>;
}

function MetricGrid({ columns, children }: { columns: number; children: ReactNode[] }) {
  const rows: ReactNode[][] = [];
  for (let index = 0; index < children.length; index += columns) rows.push(children.slice(index, index + columns));
  return (
    <div style={{ display: "flex", flexDirection: "column", rowGap: 16, paddingTop: 4, paddingBottom: 4 }}>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} style={{ display: "flex", flexDirection: "row", columnGap: 24 }}>
          {Array.from({ length: columns }, (_, index) => (
            <div key={index} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
              {row[index] ?? null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, loading }: { readonly label: string; readonly value: string; readonly loading: boolean }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {label}
      </Text>
      <div style={{ opacity: figureOpacity(loading) }}>
        <Text size="base" weight={500}>
          {value}
        </Text>
      </div>
    </div>
  );
}

// Fixed numeric columns stand in for the web table's auto layout.
const COST_COLUMN = 96;
const SHARE_COLUMN = 64;
const TOKENS_COLUMN = 62;

function NumericCell({ width, children, color, size = "sm", opacity = 1 }: { width: number; children: string; color: string; size?: "sm" | "xs"; opacity?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", width, flexShrink: 0, paddingLeft: 24, opacity }}>
      <Text size={size} color={color} style={{ whiteSpace: "nowrap" }}>
        {children}
      </Text>
    </div>
  );
}

function ModelTable({
  models,
  metric,
  peak,
  loadingProviders,
  showShare,
  onSelectModel,
}: {
  readonly models: MergedUsage["models"];
  readonly metric: "tokens" | "cost";
  readonly peak: number;
  readonly loadingProviders: ReadonlySet<UsageProviderKind>;
  readonly showShare: boolean;
  readonly onSelectModel: (key: string) => void;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          paddingTop: 8,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        <div style={{ paddingRight: 12, width: 24, flexShrink: 0 }}>
          <Text size="xs" color={theme.mutedForeground}>
            #
          </Text>
        </div>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <Text size="xs" color={theme.mutedForeground}>
            Model
          </Text>
        </div>
        <NumericCell width={COST_COLUMN} size="xs" color={theme.mutedForeground}>
          Cost
        </NumericCell>
        {showShare ? (
          <NumericCell width={SHARE_COLUMN} size="xs" color={theme.mutedForeground}>
            Share
          </NumericCell>
        ) : null}
        <NumericCell width={TOKENS_COLUMN} size="xs" color={theme.mutedForeground}>
          Tokens
        </NumericCell>
      </div>
      {models.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 24, paddingBottom: 24 }}>
          <Text color={theme.mutedForeground}>No activity in this window.</Text>
        </div>
      ) : (
        models.map((model, index) => {
          const key = `${model.provider}:${model.model}`;
          const value = metric === "tokens" ? model.totalTokens : model.costUsd;
          const hasBar = value > 0 && peak > 0;
          const share = modelShare(model, metric === "tokens" ? "tokens" : "cost");
          const rowOpacity = figureOpacity(loadingProviders.has(model.provider));
          const presentation = PROVIDER_PRESENTATION[model.provider];
          return (
            <div
              key={key}
              testId={`usage-model-${model.model}`}
              onClick={() => onSelectModel(key)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                paddingTop: 10,
                paddingBottom: 10,
                borderBottomWidth: 1,
                borderColor: alpha(theme.border, 0.5),
                cursor: "pointer",
                hover: { backgroundColor: alpha(theme.muted, 0.5) },
              }}
            >
              <div style={{ paddingRight: 12, width: 24, flexShrink: 0 }}>
                <Text size="xs" color={theme.mutedForeground}>
                  {String(index + 1)}
                </Text>
              </div>
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    ...(hasBar ? {} : { paddingTop: 4, paddingBottom: 4 }),
                  }}
                >
                  <ProviderGlyph driver={presentation.driverKind} displayName={presentation.label} size={14} />
                  <Text>{model.model}</Text>
                </div>
                {hasBar ? (
                  <div style={{ marginTop: 6, height: 2, maxWidth: 192, width: "100%", opacity: rowOpacity }}>
                    <div
                      style={{
                        height: 2,
                        borderRadius: 1,
                        minWidth: 8,
                        width: `${(value / peak) * 100}%`,
                        backgroundColor: resolveUsageColor(presentation.color, theme),
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <NumericCell
                width={COST_COLUMN}
                color={isModelCostUnknown(model) ? theme.mutedForeground : theme.foreground}
                opacity={rowOpacity}
              >
                {isModelCostUnknown(model) ? "Unpriced" : formatUsd(model.costUsd)}
              </NumericCell>
              {showShare ? (
                <NumericCell width={SHARE_COLUMN} color={theme.mutedForeground} opacity={rowOpacity}>
                  {share === null ? "" : formatPercent(share)}
                </NumericCell>
              ) : null}
              <NumericCell width={TOKENS_COLUMN} color={theme.mutedForeground} opacity={rowOpacity}>
                {formatTokens(model.totalTokens)}
              </NumericCell>
            </div>
          );
        })
      )}
    </div>
  );
}

function PeriodTable({
  periods,
  providers,
  hourly,
  timeZone,
  hour12,
  loadingProviders,
  loadingPartial,
}: {
  readonly periods: readonly (DailyTotals | HourlyTotals)[];
  readonly providers: readonly UsageProviderKind[];
  readonly hourly: boolean;
  readonly timeZone: string;
  readonly hour12: boolean;
  readonly loadingProviders: ReadonlySet<UsageProviderKind>;
  readonly loadingPartial: boolean;
}) {
  const theme = useTheme();
  const cell = (text: string, color: string, opacity = 1, size: "sm" | "xs" = "sm") => (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", flexGrow: 1, flexBasis: 0, minWidth: 0, paddingLeft: 16, opacity }}>
      <Text size={size} color={color} style={{ whiteSpace: "nowrap" }}>
        {text}
      </Text>
    </div>
  );
  return (
    <div testId="usage-period-table" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", flexDirection: "row", paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderColor: theme.border }}>
        <div style={{ width: "40%", flexShrink: 0 }}>
          <Text size="xs" color={theme.mutedForeground}>
            {hourly ? "Hour" : "Day"}
          </Text>
        </div>
        {providers.map((provider) => (
          <div key={provider} style={{ display: "flex", flexGrow: 1, flexBasis: 0 }}>
            {cell(PROVIDER_PRESENTATION[provider].label, theme.mutedForeground, 1, "xs")}
          </div>
        ))}
        {cell("Total", theme.mutedForeground, 1, "xs")}
        {cell("Tokens", theme.mutedForeground, 1, "xs")}
      </div>
      {periods.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 24, paddingBottom: 24 }}>
          <Text color={theme.mutedForeground}>No activity in this window.</Text>
        </div>
      ) : (
        periods.map((period) => (
          <div
            key={"hourStart" in period ? period.hourStart : period.day}
            style={{
              display: "flex",
              flexDirection: "row",
              paddingTop: 8,
              paddingBottom: 8,
              borderBottomWidth: 1,
              borderColor: alpha(theme.border, 0.5),
              hover: { backgroundColor: alpha(theme.muted, 0.5) },
            }}
          >
            <div style={{ width: "40%", flexShrink: 0 }}>
              <Text>
                {"hourStart" in period ? formatHourShort(period.hourStart, timeZone, hour12) : formatDayShort(period.day)}
              </Text>
            </div>
            {providers.map((provider) => (
              <div key={provider} style={{ display: "flex", flexGrow: 1, flexBasis: 0 }}>
                {cell(
                  formatUsd(period.byProvider.get(provider)?.costUsd ?? 0),
                  theme.mutedForeground,
                  figureOpacity(loadingProviders.has(provider)),
                )}
              </div>
            ))}
            {cell(formatUsd(period.costUsd), theme.foreground, figureOpacity(loadingPartial))}
            {cell(formatTokens(period.totalTokens), theme.mutedForeground, figureOpacity(loadingPartial))}
          </div>
        ))
      )}
    </div>
  );
}

const CURSOR_KEYCHAIN_COPY = "Requires access to your Cursor login in macOS Keychain.";

function useEnableCursor(environmentId: EnvironmentId, onEnabled: () => void) {
  const [pending, setPending] = useState(false);
  const enable = async () => {
    setPending(true);
    const result = await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.updateSettings,
      { environmentId, input: { patch: { cursorKeychainUsageEnabled: true } } },
      { label: "enable Cursor account usage" },
    );
    if (result._tag === "Success") onEnabled();
    setPending(false);
  };
  return { pending, enable };
}

function CursorEnableRow({
  environmentId,
  label,
  showEnvironment,
  onEnabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly showEnvironment: boolean;
  readonly onEnabled: () => void;
}) {
  const theme = useTheme();
  const { pending, enable } = useEnableCursor(environmentId, onEnabled);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            flexShrink: 0,
            backgroundColor: resolveUsageColor(PROVIDER_PRESENTATION.cursor.color, theme),
          }}
        />
        <ProviderGlyph driver="cursor" displayName="Cursor" size={16} />
        <Text truncate>{`Cursor${showEnvironment ? ` · ${label}` : ""}`}</Text>
      </div>
      <Tooltip side="top" content={CURSOR_KEYCHAIN_COPY}>
        <div>
          <InlineButton disabled={pending} onClick={() => void enable()} testId={`usage-cursor-enable-${environmentId}`}>
            Enable
          </InlineButton>
        </div>
      </Tooltip>
    </div>
  );
}

function CursorEnableLimits({
  environments,
  onEnabled,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly onEnabled: () => void;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20 }}>
          <ProviderGlyph driver="cursor" displayName="Cursor" size={16} opacity={0.8} />
        </div>
        <Text weight={500}>Cursor</Text>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 12,
          padding: 16,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.6),
        }}
      >
        <Text size="xs" color={theme.mutedForeground}>
          {CURSOR_KEYCHAIN_COPY}
        </Text>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {environments.map((environment) => (
            <CursorEnableButton
              key={environment.environmentId}
              environmentId={environment.environmentId}
              buttonText={environments.length > 1 ? `Enable on ${environment.label}` : "Enable"}
              onEnabled={onEnabled}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CursorEnableButton({
  environmentId,
  buttonText,
  onEnabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly buttonText: string;
  readonly onEnabled: () => void;
}) {
  const { pending, enable } = useEnableCursor(environmentId, onEnabled);
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => void enable()}>
      {buttonText}
    </Button>
  );
}

function UsageCoverageNotice({
  environments,
  duplicateSources,
  contractMismatches,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly duplicateSources: readonly string[];
  readonly contractMismatches: MergedUsage["contractMismatches"];
}) {
  const theme = useTheme();
  const failed = environments.filter((environment) => environment.error !== null);
  const mismatchByEnvironment = new Map(contractMismatches.map((mismatch) => [mismatch.environmentId, mismatch]));
  const incompatible = environments.flatMap((environment) => {
    const mismatch = mismatchByEnvironment.get(environment.environmentId);
    return mismatch === undefined ? [] : [{ environment, mismatch }];
  });
  if (failed.length === 0 && incompatible.length === 0 && duplicateSources.length === 0) {
    return null;
  }
  const lines = [
    ...failed.map((environment) => `${environment.label}: ${environment.error}`),
    ...incompatible.map(({ environment, mismatch }) => formatUsageContractMismatch(environment.label, mismatch)),
    ...(duplicateSources.length > 0
      ? [`Counted once across environments sharing a transcript directory: ${duplicateSources.join(", ")}`]
      : []),
  ];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 8,
        paddingBottom: 8,
        borderTopWidth: 1,
        borderColor: theme.border,
        maxWidth: 320,
      }}
    >
      {lines.map((line) => (
        <Text key={line} size="xs" color={theme.mutedForeground}>
          {line}
        </Text>
      ))}
    </div>
  );
}

function UsageEnvironmentFilter({
  environments,
  selectedEnvironments,
  selectedEnvironmentIds,
  onSelectionChange,
  showUsageStatus,
  refreshing,
  isPartial,
  duplicateSources,
  contractMismatches,
  onOpenModelPrices,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId> | null) => void;
  readonly showUsageStatus: boolean;
  readonly refreshing: boolean;
  readonly isPartial: boolean;
  readonly duplicateSources: readonly string[];
  readonly contractMismatches: MergedUsage["contractMismatches"];
  readonly onOpenModelPrices: () => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const allSelected = selectedEnvironmentIds === null;
  const label = allSelected
    ? "All environments"
    : selectedEnvironments.length === 1
      ? selectedEnvironments[0]!.label
      : `${selectedEnvironments.length} environments`;
  const hasIssue =
    selectedEnvironments.some((environment) => environment.error !== null) || contractMismatches.length > 0;

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="start"
      testId="usage-environment-menu"
      rootStyle={{ minWidth: 40, flexShrink: 1 }}
      trigger={({ toggle }) => (
        <InlineButton
          testId="usage-environment-filter"
          onClick={toggle}
          trailing={(hovered) => (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, flexShrink: 0 }}>
              {showUsageStatus && hasIssue ? (
                <Icon name="circle-alert" size={14} color={theme.warningForeground} />
              ) : (
                <Icon name="chevron-down" size={14} color={theme.mutedForeground} opacity={hovered || open ? 1 : 0} />
              )}
            </div>
          )}
        >
          {label}
        </InlineButton>
      )}
    >
      <MenuCheckboxRow checked={allSelected} onCheckedChange={(checked) => onSelectionChange(checked ? null : new Set())}>
        All environments
      </MenuCheckboxRow>
      <UsageMenuSeparator />
      {environments.map((environment) => {
        const checked = selectedEnvironmentIds === null || selectedEnvironmentIds.has(environment.environmentId);
        const progress = usageEnvironmentProgress(environment, refreshing);
        const status =
          environment.error !== null
            ? "Unavailable"
            : environment.summary !== null &&
                !isCompatibleUsageContractVersion(environment.summary.contractVersion, USAGE_CONTRACT_VERSION)
              ? "Update required"
              : !environment.isConnected
                ? "Connecting…"
                : progress.phase === "loading"
                  ? "Scanning…"
                  : progress.phase === "stale"
                    ? "Refreshing…"
                    : progress.phase === "partway"
                      ? updatingProvidersLabel(progress.providers, providerLabel)
                      : "Ready";
        return (
          <MenuCheckboxRow
            key={environment.environmentId}
            testId={`usage-environment-${environment.environmentId}`}
            checked={checked}
            onCheckedChange={(nextChecked) => {
              const next = new Set(selectedEnvironments.map((entry) => entry.environmentId));
              if (nextChecked) next.add(environment.environmentId);
              else next.delete(environment.environmentId);
              onSelectionChange(next.size === environments.length ? null : next);
            }}
          >
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0, flexGrow: 1 }}>
              <div style={{ flexGrow: 1, minWidth: 0 }}>
                <Text truncate>{environment.label}</Text>
              </div>
              {showUsageStatus ? (
                <Text size="xs" color={environment.error !== null ? theme.errorForeground : theme.mutedForeground}>
                  {status}
                </Text>
              ) : null}
            </div>
          </MenuCheckboxRow>
        );
      })}
      {environments.length === 0 ? (
        <div style={{ padding: 8 }}>
          <Text size="xs" color={theme.mutedForeground}>
            No environments connected.
          </Text>
        </div>
      ) : null}
      {showUsageStatus && isPartial ? (
        <div style={{ padding: 8 }}>
          <Text size="xs" color={theme.mutedForeground}>
            Totals are partial while selected environments scan.
          </Text>
        </div>
      ) : null}
      {showUsageStatus ? (
        <UsageCoverageNotice
          environments={selectedEnvironments}
          duplicateSources={duplicateSources}
          contractMismatches={contractMismatches}
        />
      ) : null}
      <UsageMenuSeparator />
      <UsageMenuItem
        icon="sliders-horizontal"
        testId="usage-model-prices"
        onSelect={() => {
          setOpen(false);
          onOpenModelPrices();
        }}
      >
        Model prices
      </UsageMenuItem>
    </Menu>
  );
}

function UsageProviderFilter({
  hiddenProviders,
  onChange,
}: {
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly onChange: (hiddenProviders: readonly UsageProviderKind[]) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const visible = PROVIDER_ORDER.filter((provider) => !hiddenProviders.has(provider));
  const label =
    visible.length === PROVIDER_ORDER.length
      ? "All providers"
      : visible.length === 0
        ? "No providers"
        : visible.length === 1
          ? PROVIDER_PRESENTATION[visible[0]!].label
          : `${visible.length} providers`;

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="start"
      testId="usage-provider-menu"
      rootStyle={{ minWidth: 40, flexShrink: 1 }}
      trigger={({ toggle }) => (
        <InlineButton
          testId="usage-provider-filter"
          onClick={toggle}
          trailing={(hovered) => (
            <Icon name="chevron-down" size={14} color={theme.mutedForeground} opacity={hovered || open ? 1 : 0} />
          )}
        >
          {label}
        </InlineButton>
      )}
    >
      <MenuCheckboxRow checked={hiddenProviders.size === 0} onCheckedChange={(checked) => onChange(checked ? [] : PROVIDER_ORDER)}>
        All providers
      </MenuCheckboxRow>
      <UsageMenuSeparator />
      {PROVIDER_ORDER.map((provider) => (
        <MenuCheckboxRow
          key={provider}
          testId={`usage-provider-${provider}`}
          checked={!hiddenProviders.has(provider)}
          onCheckedChange={(checked) =>
            onChange(PROVIDER_ORDER.filter((entry) => (entry === provider ? !checked : hiddenProviders.has(entry))))
          }
        >
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
            <ProviderGlyph
              driver={PROVIDER_PRESENTATION[provider].driverKind}
              displayName={PROVIDER_PRESENTATION[provider].label}
              size={14}
            />
            <Text truncate>{PROVIDER_PRESENTATION[provider].label}</Text>
          </div>
        </MenuCheckboxRow>
      ))}
    </Menu>
  );
}

function UsageSkeleton({ viewportWidth }: { viewportWidth: number }) {
  const twoColumns = viewportWidth >= LG;
  return (
    <>
      <div style={{ display: "flex", flexDirection: twoColumns ? "row" : "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, ...(twoColumns ? { width: 288, flexShrink: 0 } : {}) }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Skeleton width={144} height={40} />
            <Skeleton width={128} height={16} />
          </div>
          {PROVIDER_ORDER.map((provider) => (
            <div key={provider} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 20 }}>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Skeleton width={8} height={8} radius={4} />
                  <Skeleton width={16} height={16} radius={8} />
                  <Skeleton width={80} height={14} />
                </div>
                <Skeleton width={56} height={14} />
              </div>
              <Skeleton width={144} height={16} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          <Skeleton width={96} height={20} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Skeleton height={224} style={{ marginLeft: 64, width: undefined }} />
            <Skeleton height={16} style={{ marginLeft: 64, width: undefined }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionTitle>Totals</SectionTitle>
        <MetricSkeletons
          columns={viewportWidth >= MD ? 5 : 2}
          labels={["Processed tokens", "Cached input", "Uncached input", "Output", "Cache savings"]}
        />
      </div>

      <div style={{ display: "flex", flexDirection: twoColumns ? "row" : "column", columnGap: 48, rowGap: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flexGrow: 1, flexBasis: 0 }}>
          <Skeleton width={112} height={20} />
          <Skeleton height={8} />
          <Skeleton width={288} height={16} />
        </div>
        {twoColumns ? <div style={{ flexGrow: 1, flexBasis: 0 }} /> : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <SectionTitle>Breakdown</SectionTitle>
          <Skeleton width={112} height={28} radius={RADIUS.lg} />
        </div>
        <Skeleton height={176} />
      </div>
    </>
  );
}

function MetricSkeletons({ labels, columns }: { readonly labels: readonly string[]; readonly columns: number }) {
  const theme = useTheme();
  return (
    <MetricGrid columns={columns}>
      {labels.map((label) => (
        <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Text size="xs" color={theme.mutedForeground}>
            {label}
          </Text>
          <Skeleton width={64} height={24} />
        </div>
      ))}
    </MetricGrid>
  );
}
