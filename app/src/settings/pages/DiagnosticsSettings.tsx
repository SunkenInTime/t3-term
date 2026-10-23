// Port of apps/web/src/components/settings/DiagnosticsSettings.tsx: resource
// telemetry (diagnostics/ResourceTelemetry.tsx), live processes, process
// resource history, trace diagnostics and its tables, and the OpenTelemetry
// export form. The page is ~8500px tall, so it is a SettingsVirtualPage: every
// section is an item and the long trace tables put each row in its own item.
import { resolveUsageAccess } from "@t3tools/client-runtime/state/usage-access";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthEnvironmentMaintainScope, AuthOrchestrationOperateScope } from "@t3tools/contracts";
import type { EnvironmentId, ServerProcessDiagnosticsEntry, ServerProcessResourceHistorySummary, ServerProcessSignal } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { requestConfirmDialog } from "../../dialogs/confirmDialog.ts";
import { environmentSession, serverEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironmentScope } from "../../state/settings.ts";
import { Tooltip } from "../../ui/overlay.tsx";
import { IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { Segmented } from "../../usage/usageUi.tsx";
import {
  CardSlice,
  CommandCell,
  DiagnosticsLastChecked,
  EmptyRows,
  ErrorLines,
  ExpandableText,
  MonoCell,
  ProcessNameCell,
  ProcessSignalActions,
  RefreshButton,
  RelativeTimeText,
  SectionHeading,
  StatBlock,
  StatsGrid,
  TableHeader,
  TableRow,
  TraceIdCell,
  clip,
  mutedSurface,
  type DiagnosticsColumn,
} from "../diagnostics/parts.tsx";
import { useResourceTelemetryItems } from "../diagnostics/ResourceTelemetry.tsx";
import { TelemetryExportSettings } from "../diagnostics/TelemetryExport.tsx";
import { useOpenInPreferredEditor } from "../keybindings/openInEditor.ts";
import { SettingsMessage, SettingsPageContainer, SettingsSection, settingsSearchTargetAtom, type SettingsVirtualItem } from "../layout.tsx";
import { TargetedVirtualPage } from "../diagnostics/VirtualPage.tsx";
import { useEnvironmentQuery } from "../query.ts";
import { useSettingsScope } from "../scope.tsx";

/** WorkspacePageContainer width="expanded" (max-w-6xl). */
const EXPANDED_WIDTH = 1152;
/** `gap-10` between the page's sections. */
const SECTION_GAP = 40;
/** `space-y-2.5` between a section title and its card. */
const TITLE_GAP = 10;

const NUMBER_FORMAT = new Intl.NumberFormat();

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"] as const;
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function isStaleProcessSignalMessage(message: string | undefined): boolean {
  return message?.includes("not a live descendant") ?? false;
}

function formatProcessName(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0];
  if (!firstToken) return command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function formatProcessType(process: ServerProcessDiagnosticsEntry): string {
  if (process.depth > 0) return "Subprocess";
  if (/\b(codex|claude|opencode|cursor)\b/i.test(process.command)) return "Agent";
  return "Process";
}

function visibleProcessTree(processes: ReadonlyArray<ServerProcessDiagnosticsEntry>, collapsedPids: ReadonlySet<number>) {
  const visible: ServerProcessDiagnosticsEntry[] = [];
  let hiddenChildDepth: number | null = null;
  for (const process of processes) {
    if (hiddenChildDepth !== null) {
      if (process.depth > hiddenChildDepth) continue;
      hiddenChildDepth = null;
    }
    visible.push(process);
    if (collapsedPids.has(process.pid)) hiddenChildDepth = process.depth;
  }
  return visible;
}

const RESOURCE_HISTORY_WINDOWS = [
  { label: "5m", windowMs: 5 * 60_000, bucketMs: 30_000 },
  { label: "15m", windowMs: 15 * 60_000, bucketMs: 60_000 },
  { label: "30m", windowMs: 30 * 60_000, bucketMs: 2 * 60_000 },
  { label: "1h", windowMs: 60 * 60_000, bucketMs: 5 * 60_000 },
] as const;

function formatCpuTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}

function formatShortProcessName(command: string): string {
  const name = formatProcessName(command);
  return name.length > 42 ? `${name.slice(0, 39)}...` : name;
}

// ── Columns (the web's <col> widths; auto-layout tables use the widths they get at 1440px) ──

const first = { paddingLeft: 20 } as const;
const cell = { paddingLeft: 12, paddingRight: 12 } as const;

const LIVE_PROCESS_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Name", width: 24, ...first },
  { label: "CPU", width: 8, align: "right", ...cell },
  { label: "Memory", width: 10, align: "right", ...cell },
  { label: "Command", width: 33, ...cell },
  { label: "PID", width: 8, align: "right", ...cell },
  { label: "Type", width: 11, ...cell },
  { label: "Kill", width: 6, align: "right", paddingLeft: 8, paddingRight: 16, overflowVisible: true },
];

const RESOURCE_HISTORY_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Process", width: 24, ...first },
  { label: "CPU Time", width: 10, align: "right", ...cell },
  { label: "Current", width: 10, align: "right", ...cell },
  { label: "Average", width: 10, align: "right", ...cell },
  { label: "Peak", width: 10, align: "right", ...cell },
  { label: "Max Mem", width: 10, align: "right", ...cell },
  { label: "Command", width: 16, ...cell },
  { label: "PID", width: 10, align: "right", paddingLeft: 12, paddingRight: 20 },
];

const LATEST_FAILURE_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Span", width: 363, ...first },
  { label: "Cause", width: 514 },
  { label: "Duration", width: 137 },
  { label: "Ended", width: 89, paddingRight: 20 },
];

const COMMON_FAILURE_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Span", width: 370, ...first },
  { label: "Count", width: 109 },
  { label: "Cause", width: 524 },
  { label: "Last Seen", width: 100, paddingRight: 20 },
];

const SLOWEST_SPAN_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Span", width: 44, ...first },
  { label: "Duration", width: 14 },
  { label: "Ended", width: 12 },
  { label: "Trace", width: 30, paddingRight: 20 },
];

const SPAN_LOG_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Time", width: 11, ...first },
  { label: "Level", width: 9 },
  { label: "Span", width: 24 },
  { label: "Message", width: 26 },
  { label: "Trace", width: 30, paddingRight: 20 },
];

const TOP_SPAN_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Span", width: 48, ...first },
  { label: "Count", width: 13 },
  { label: "Failures", width: 13 },
  { label: "Average", width: 13 },
  { label: "Max", width: 13, paddingRight: 20 },
];

// ── Process tables ──────────────────────────────────────────────────────

function ProcessTableShell({
  columns,
  emptyLabel,
  rows,
}: {
  columns: ReadonlyArray<DiagnosticsColumn>;
  emptyLabel: string | null;
  rows: ReadonlyArray<ReactNode>;
}) {
  const theme = useTheme();
  const divider = alpha(theme.border, 0.5);
  return (
    <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
      <TableHeader columns={columns} paddingY={8} />
      {emptyLabel !== null ? (
        <div style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 16 }}>
          <Text size="xs" color={theme.mutedForeground}>
            {emptyLabel}
          </Text>
        </div>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} style={{ display: "flex", flexDirection: "column", ...(index > 0 ? { borderTopWidth: 1, borderColor: divider } : {}) }}>
          {row}
        </div>
      ))}
    </div>
  );
}

function ProcessResourceHistoryChart({
  buckets,
}: {
  buckets: ReadonlyArray<{ readonly startedAt: DateTime.Utc; readonly avgCpuPercent: number; readonly maxCpuPercent: number }>;
}) {
  const theme = useTheme();
  const maxCpuPercent = Math.max(1, ...buckets.map((bucket) => bucket.maxCpuPercent));
  // h-28 minus p-2.
  const plotHeight = 112 - 16;
  return (
    <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.6), paddingLeft: 20, paddingRight: 20, paddingTop: 12, paddingBottom: 12 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 4,
          height: 112,
          overflow: "hidden",
          borderRadius: RADIUS.sm,
          backgroundColor: alpha(mutedSurface(theme), 0.1),
          padding: 8,
        }}
      >
        {buckets.map((bucket) => {
          const peakHeight = Math.max(2, (bucket.maxCpuPercent / maxCpuPercent) * 100);
          const averageHeight = Math.max(2, (bucket.avgCpuPercent / maxCpuPercent) * 100);
          return (
            <Tooltip
              key={DateTime.formatIso(bucket.startedAt)}
              side="top"
              content={`Avg ${bucket.avgCpuPercent.toFixed(1)}%, peak ${bucket.maxCpuPercent.toFixed(1)}%`}
              rootStyle={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 4, height: "100%" }}
            >
              <div style={{ position: "relative", flexGrow: 1, height: "100%" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: (peakHeight / 100) * plotHeight,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: alpha(theme.foreground, 0.15),
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: (averageHeight / 100) * plotHeight,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: alpha(theme.foreground, 0.6),
                  }}
                />
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export function DiagnosticsSettings() {
  const theme = useTheme();
  const { environment } = useSettingsScope();
  const environmentId: EnvironmentId | null = environment?.environmentId ?? null;
  const canMaintainEnvironment = useEnvironmentScope(environmentId, AuthEnvironmentMaintainScope);
  const observability = environment?.serverConfig?.observability;
  const canOpenHostEditor = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const session = useEnvironmentQuery(environmentId === null ? null : environmentSession.sessionStateAtom(environmentId));
  const diagnosticsAccess = resolveUsageAccess({
    connectionPhase: environment?.connection.phase ?? "available",
    session: session.data,
    hasSessionError: session.error !== null,
  });
  const canReadDiagnostics = diagnosticsAccess.canReadDiagnostics;
  const signalServerProcess = useAtomCommand(serverEnvironment.signalProcess, { reportFailure: false });
  const openInEditor = useOpenInPreferredEditor(environmentId);
  const [resourceWindowMs, setResourceWindowMs] = useState(15 * 60_000);
  const selectedResourceWindow =
    RESOURCE_HISTORY_WINDOWS.find((option) => option.windowMs === resourceWindowMs) ?? RESOURCE_HISTORY_WINDOWS[1];
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    environmentId === null || !canReadDiagnostics ? null : serverEnvironment.traceDiagnostics({ environmentId, input: {} }),
  );
  const {
    data: processData,
    error: processError,
    isPending: isProcessPending,
    refresh: refreshProcesses,
  } = useEnvironmentQuery(
    environmentId === null || !canReadDiagnostics ? null : serverEnvironment.processDiagnostics({ environmentId, input: {} }),
  );
  const {
    data: resourceData,
    error: resourceError,
    isPending: isResourcePending,
    refresh: refreshResources,
  } = useEnvironmentQuery(
    environmentId === null || !canReadDiagnostics
      ? null
      : serverEnvironment.processResourceHistory({
          environmentId,
          input: { windowMs: selectedResourceWindow.windowMs, bucketMs: selectedResourceWindow.bucketMs },
        }),
  );
  const telemetryItems = useResourceTelemetryItems(environmentId);
  const searchTarget = useAtomValue(settingsSearchTargetAtom);
  const [isOpeningLogsDirectory, setIsOpeningLogsDirectory] = useState(false);
  const [openLogsDirectoryError, setOpenLogsDirectoryError] = useState<string | null>(null);
  const [signalingPid, setSignalingPid] = useState<number | null>(null);
  const [collapsedPids, setCollapsedPids] = useState<ReadonlySet<number>>(() => new Set());
  const signalingPidRef = useRef<number | null>(null);
  const environmentIdRef = useRef<EnvironmentId | null>(environmentId);
  const processDataRef = useRef(processData);
  useEffect(() => {
    processDataRef.current = processData;
  }, [processData]);
  useEffect(() => {
    environmentIdRef.current = environmentId;
    return () => {
      environmentIdRef.current = null;
    };
  }, [environmentId]);

  const openLogsDirectory = () => {
    const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
    if (!logsDirectoryPath) return;
    if (environmentId === null || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    setIsOpeningLogsDirectory(true);
    setOpenLogsDirectoryError(null);
    void (async () => {
      const opened = await openInEditor(logsDirectoryPath);
      setIsOpeningLogsDirectory(false);
      if (!opened.ok) {
        setOpenLogsDirectoryError(opened.message);
        return;
      }
      if (opened.result._tag === "Failure" && !isAtomCommandInterrupted(opened.result)) {
        const failure = squashAtomCommandFailure(opened.result);
        setOpenLogsDirectoryError(failure instanceof Error ? failure.message : "Unable to open logs folder.");
      }
    })();
  };

  const isInitialLoading = isPending && data === null;
  const isProcessInitialLoading = isProcessPending && processData === null;
  const isResourceInitialLoading = isResourcePending && resourceData === null;
  // The export form waits for each environment's first tables so a search target below them
  // stays in view. Later loads, such as a new resource window, must not remount it and drop drafts.
  const [exportFormEnvironmentId, setExportFormEnvironmentId] = useState<EnvironmentId | null>(null);
  if (
    exportFormEnvironmentId !== environmentId &&
    canReadDiagnostics &&
    !isInitialLoading &&
    !isProcessInitialLoading &&
    !isResourceInitialLoading
  ) {
    setExportFormEnvironmentId(environmentId);
  }

  const signalProcess = async (pid: number, signal: ServerProcessSignal) => {
    const targetEnvironmentId = environmentIdRef.current;
    const process = processDataRef.current?.processes.find((entry) => entry.pid === pid);
    if (targetEnvironmentId === null || process === undefined || !readEnvironmentScope(targetEnvironmentId, AuthEnvironmentMaintainScope)) return;
    if (signalingPidRef.current !== null) return;
    signalingPidRef.current = pid;
    setSignalingPid(pid);
    const clearSignaling = () => {
      signalingPidRef.current = null;
      setSignalingPid(null);
    };
    if (signal === "SIGKILL") {
      const confirmed = await requestConfirmDialog(`Send SIGKILL to process ${pid}? This cannot be handled by the process.`, {
        variant: "destructive",
      });
      if (!confirmed) {
        clearSignaling();
        return;
      }
    }
    const currentEnvironmentId = environmentIdRef.current;
    if (
      currentEnvironmentId === null ||
      currentEnvironmentId !== targetEnvironmentId ||
      !readEnvironmentScope(currentEnvironmentId, AuthEnvironmentMaintainScope)
    ) {
      clearSignaling();
      return;
    }
    if (processDataRef.current?.processes.find((entry) => entry.pid === pid)?.startTimeMs !== process.startTimeMs) {
      clearSignaling();
      return;
    }
    const result = await signalServerProcess({
      environmentId: targetEnvironmentId,
      input: { pid, startTimeMs: process.startTimeMs, signal },
    });
    clearSignaling();
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toast({
          type: "error",
          title: `Could not send ${signal}`,
          description: failure instanceof Error ? failure.message : `Failed to send ${signal}.`,
        });
      }
      return;
    }
    if (!result.value.signaled) {
      const message = Option.getOrUndefined(result.value.message);
      refreshProcesses();
      if (isStaleProcessSignalMessage(message)) {
        toast({
          type: "info",
          title: "Process already exited",
          description: "The process is not a child of the T3 Server. It might already have exited.",
        });
        return;
      }
      toast({ type: "error", title: `Could not send ${signal}`, description: message ?? `Failed to send ${signal}.` });
      return;
    }
    refreshProcesses();
  };

  const processDiagnosticsError = processData ? Option.getOrNull(processData.error) : null;
  const processResourceError = resourceData ? Option.getOrNull(resourceData.error) : null;
  const traceDiagnosticsError = data ? Option.getOrNull(data.error) : null;
  const traceDiagnosticsPartialFailure = data ? Option.getOrElse(data.partialFailure, () => false) : false;

  if (!canReadDiagnostics) {
    return (
      <SettingsPageContainer>
        <SettingsMessage>
          {environmentId === null
            ? "Connect an environment to see diagnostics."
            : diagnosticsAccess.isPending
              ? "Checking diagnostics access…"
              : (diagnosticsAccess.error ?? "")}
        </SettingsMessage>
      </SettingsPageContainer>
    );
  }

  const headerActions = (children: ReactNode) => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>{children}</div>
  );

  // Live Processes
  const visibleProcesses = visibleProcessTree(processData?.processes ?? [], collapsedPids);
  const toggleProcess = (pid: number) => {
    setCollapsedPids((previous) => {
      const next = new Set(previous);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };
  const liveProcesses = (
    <SettingsSection
      title="Live Processes"
      headerAction={headerActions(
        <>
          <DiagnosticsLastChecked checkedAt={processData?.readAt ?? null} />
          <RefreshButton isPending={isProcessPending} label="Refresh process diagnostics" onClick={refreshProcesses} testId="diagnostics-processes-refresh" />
        </>,
      )}
    >
      <StatsGrid>
        <StatBlock label="Child Processes" value={processData ? formatCount(processData.processCount) : "..."} />
        <StatBlock
          label="CPU"
          value={processData ? `${processData.totalCpuPercent.toFixed(1)}%` : "..."}
          tooltip="Total CPU across live child processes of the current server process. The desktop shell and other parent processes are not included."
        />
        <StatBlock
          label="Memory"
          value={processData ? formatBytes(processData.totalRssBytes) : "..."}
          tooltip="Total resident memory across live child processes of the current server process. The desktop shell and other parent processes are not included."
        />
        <StatBlock label="Server PID" value={processData ? String(processData.serverPid) : "..."} />
      </StatsGrid>
      <ErrorLines
        lines={[
          ...(processDiagnosticsError ? [{ text: processDiagnosticsError.message }] : []),
          ...(processError ? [{ text: processError }] : []),
        ]}
      />
      <ProcessTableShell
        columns={LIVE_PROCESS_COLUMNS}
        emptyLabel={
          visibleProcesses.length === 0 ? (isProcessInitialLoading ? "Loading live processes..." : "No live descendant processes found.") : null
        }
        rows={visibleProcesses.map((process) => {
          const name = formatProcessName(process.command);
          return (
            <TableRow key={process.pid} columns={LIVE_PROCESS_COLUMNS} paddingY={8} hoverColor={alpha(mutedSurface(theme), 0.2)}>
              {[
                <ProcessNameCell
                  key="name"
                  name={clip(name, 40)}
                  tooltip={clip(process.command, 600)}
                  depth={Math.min(process.depth, 6)}
                  dotColor={alpha(theme.success, 0.8)}
                  toggle={
                    process.childPids.length > 0
                      ? { expanded: !collapsedPids.has(process.pid), onToggle: () => toggleProcess(process.pid), testId: `diagnostics-process-toggle-${process.pid}` }
                      : undefined
                  }
                />,
                <MonoCell key="cpu">{`${process.cpuPercent.toFixed(1)}%`}</MonoCell>,
                <MonoCell key="memory">{formatBytes(process.rssBytes)}</MonoCell>,
                <CommandCell key="command" command={process.command} max={56} />,
                <MonoCell key="pid" color={theme.mutedForeground}>
                  {String(process.pid)}
                </MonoCell>,
                <Text key="type" size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
                  {formatProcessType(process)}
                </Text>,
                <ProcessSignalActions
                  key="kill"
                  testId={`diagnostics-process-signal-${process.pid}`}
                  disabled={!canMaintainEnvironment || signalingPid === process.pid}
                  onSignal={(signal) => void signalProcess(process.pid, signal)}
                />,
              ]}
            </TableRow>
          );
        })}
      />
    </SettingsSection>
  );

  // Resource History
  const historyProcesses: ReadonlyArray<ServerProcessResourceHistorySummary> = resourceData?.topProcesses ?? [];
  const shallowestChildDepth = historyProcesses.reduce<number | null>((minDepth, process) => {
    if (process.isServerRoot) return minDepth;
    return minDepth === null ? process.depth : Math.min(minDepth, process.depth);
  }, null);
  const resourceHistory = (
    <SettingsSection
      title="Resource History"
      headerAction={headerActions(
        <>
          <Segmented
            options={RESOURCE_HISTORY_WINDOWS.map((option) => ({ value: String(option.windowMs), label: option.label }))}
            value={String(resourceWindowMs)}
            onChange={(next) => {
              const selected = RESOURCE_HISTORY_WINDOWS.find((option) => String(option.windowMs) === next);
              if (selected) setResourceWindowMs(selected.windowMs);
            }}
            testIdPrefix="diagnostics-history-window"
          />
          <DiagnosticsLastChecked checkedAt={resourceData?.readAt ?? null} />
          <RefreshButton isPending={isResourcePending} label="Refresh resource history" onClick={refreshResources} testId="diagnostics-history-refresh" />
        </>,
      )}
    >
      <StatsGrid>
        <StatBlock
          label="CPU Time"
          value={resourceData ? formatCpuTime(resourceData.totalCpuSecondsApprox) : "..."}
          tooltip="Approximate active CPU time for the T3 server root process and its descendants during the selected window. It grows only while sampled processes use CPU and older samples leave as the window moves."
        />
        <StatBlock
          label="Samples"
          value={resourceData ? formatCount(resourceData.retainedSampleCount) : "..."}
          tooltip="In-memory process samples retained by the server. The server samples only while diagnostics is open, and this resets when the server restarts."
        />
        <StatBlock
          label="Interval"
          value={
            resourceData ? (resourceData.sampleIntervalMs === 0 ? "On demand" : formatDuration(resourceData.sampleIntervalMs)) : "..."
          }
        />
        <StatBlock label="Processes" value={resourceData ? formatCount(resourceData.topProcesses.length) : "..."} />
      </StatsGrid>
      <ErrorLines
        lines={[
          ...(processResourceError ? [{ text: processResourceError.message }] : []),
          ...(resourceError ? [{ text: resourceError }] : []),
        ]}
      />
      <ProcessResourceHistoryChart buckets={resourceData?.buckets ?? []} />
      <ProcessTableShell
        columns={RESOURCE_HISTORY_COLUMNS}
        emptyLabel={
          historyProcesses.length === 0
            ? isResourceInitialLoading
              ? "Collecting process resource samples..."
              : "No process resource samples found for this window."
            : null
        }
        rows={historyProcesses.map((process) => {
          const name = formatShortProcessName(process.command);
          const visualDepth = process.isServerRoot || shallowestChildDepth === null ? 0 : Math.max(1, process.depth - shallowestChildDepth + 1);
          return (
            <TableRow key={process.processKey} columns={RESOURCE_HISTORY_COLUMNS} paddingY={8} hoverColor={alpha(mutedSurface(theme), 0.2)}>
              {[
                <ProcessNameCell
                  key="name"
                  name={name}
                  tooltip={clip(process.command, 600)}
                  depth={Math.min(visualDepth, 6)}
                  dotColor={process.isServerRoot ? alpha(theme.warning, 0.9) : alpha(theme.success, 0.8)}
                />,
                <MonoCell key="cpu-time">{formatCpuTime(process.cpuSecondsApprox)}</MonoCell>,
                <MonoCell key="current">{`${process.currentCpuPercent.toFixed(1)}%`}</MonoCell>,
                <MonoCell key="average">{`${process.avgCpuPercent.toFixed(1)}%`}</MonoCell>,
                <MonoCell key="peak">{`${process.maxCpuPercent.toFixed(1)}%`}</MonoCell>,
                <MonoCell key="max-mem">{formatBytes(process.maxRssBytes)}</MonoCell>,
                <CommandCell key="command" command={process.command} max={24} />,
                <MonoCell key="pid" color={theme.mutedForeground}>
                  {String(process.pid)}
                </MonoCell>,
              ]}
            </TableRow>
          );
        })}
      />
    </SettingsSection>
  );

  // Trace Diagnostics
  const traceDiagnostics = (
    <SettingsSection
      title="Trace Diagnostics"
      headerAction={headerActions(
        <>
          <DiagnosticsLastChecked checkedAt={data?.readAt ?? null} />
          <Tooltip content="Open logs folder" side="top">
            <IconButton
              icon="folder-open"
              size={24}
              iconSize={14}
              disabled={!canOpenHostEditor || !observability?.logsDirectoryPath || isOpeningLogsDirectory}
              onClick={openLogsDirectory}
              testId="diagnostics-open-logs"
            />
          </Tooltip>
          <RefreshButton isPending={isPending} label="Refresh trace diagnostics" onClick={refresh} testId="diagnostics-trace-refresh" />
        </>,
      )}
    >
      <StatsGrid>
        <StatBlock label="Spans" value={data ? formatCount(data.recordCount) : "..."} />
        <StatBlock label="Failures" value={data ? formatCount(data.failureCount) : "..."} tone={data && data.failureCount > 0 ? "danger" : "default"} />
        <StatBlock
          label="Slow Spans"
          value={data ? formatCount(data.slowSpanCount) : "..."}
          tooltip={
            data
              ? `Spans with a duration of ${formatDuration(data.slowSpanThresholdMs)} or longer.`
              : "Spans at or above the configured slow-span threshold."
          }
          tone={data && data.slowSpanCount > 0 ? "warning" : "default"}
        />
        <StatBlock
          label="Parse Errors"
          value={data ? formatCount(data.parseErrorCount) : "..."}
          tone={data && data.parseErrorCount > 0 ? "warning" : "default"}
        />
      </StatsGrid>
      <ErrorLines
        lines={[
          ...(openLogsDirectoryError ? [{ text: openLogsDirectoryError }] : []),
          ...(traceDiagnosticsError
            ? [
                {
                  text: traceDiagnosticsPartialFailure
                    ? `Some trace files could not be read, so diagnostics may be incomplete. ${traceDiagnosticsError.message}`
                    : traceDiagnosticsError.message,
                  tone: traceDiagnosticsPartialFailure ? ("warning" as const) : ("danger" as const),
                },
              ]
            : []),
          ...(error ? [{ text: error }] : []),
        ]}
      />
    </SettingsSection>
  );

  const items: SettingsVirtualItem[] = [
    ...telemetryItems.map((item) => ({ ...item, gapBefore: SECTION_GAP })),
    { key: "live-processes", node: liveProcesses, gapBefore: SECTION_GAP },
    { key: "resource-history", node: resourceHistory, gapBefore: SECTION_GAP },
    { key: "trace-diagnostics", node: traceDiagnostics, gapBefore: SECTION_GAP },
  ];

  /** A section whose table rows are separate list items, so only rows on screen are built. */
  const pushTableSection = <Row,>(input: {
    key: string;
    title: string;
    columns: ReadonlyArray<DiagnosticsColumn>;
    rows: ReadonlyArray<Row> | null;
    rowKey: (row: Row) => string;
    renderRow: (row: Row, index: number) => ReactNode;
    emptyLabel: string;
  }) => {
    items.push({ key: `${input.key}:title`, node: <SectionHeading title={input.title} />, gapBefore: SECTION_GAP });
    const rows = input.rows ?? [];
    if (rows.length === 0) {
      items.push({
        key: `${input.key}:empty`,
        gapBefore: TITLE_GAP,
        node: (
          <CardSlice position="single">
            <EmptyRows label={input.emptyLabel} />
          </CardSlice>
        ),
      });
      return;
    }
    items.push({
      key: `${input.key}:header`,
      gapBefore: TITLE_GAP,
      node: (
        <CardSlice position="first">
          <TableHeader columns={input.columns} />
        </CardSlice>
      ),
    });
    const divider = alpha(theme.border, 0.6);
    rows.forEach((row, index) => {
      items.push({
        key: `${input.key}:${input.rowKey(row)}:${index}`,
        gapBefore: 0,
        node: (
          <CardSlice position={index === rows.length - 1 ? "last" : "middle"} divider={index === 0 ? undefined : divider}>
            {input.renderRow(row, index)}
          </CardSlice>
        ),
      });
    });
  };

  const spanName = (name: string) => (
    <Text size="xs" weight={500} style={{ flexShrink: 1, minWidth: 0 }}>
      {name}
    </Text>
  );

  pushTableSection({
    key: "latest-failures",
    title: "Latest Failures",
    columns: LATEST_FAILURE_COLUMNS,
    rows: data?.latestFailures ?? null,
    rowKey: (failure) => `${failure.traceId}:${failure.spanId}`,
    emptyLabel: isInitialLoading ? "Loading failures..." : "No failed spans found.",
    renderRow: (failure, index) => (
      <TableRow columns={LATEST_FAILURE_COLUMNS} paddingY={12} alignItems="flex-start">
        {[
          spanName(failure.name),
          <ExpandableText key="cause" text={failure.cause} charsPerLine={80} testId={`diagnostics-latest-failure-expand-${index}`} />,
          <MonoCell key="duration">{formatDuration(failure.durationMs)}</MonoCell>,
          <RelativeTimeText key="ended" value={failure.endedAt} color={theme.mutedForeground} />,
        ]}
      </TableRow>
    ),
  });

  pushTableSection({
    key: "common-failures",
    title: "Most Common Failures",
    columns: COMMON_FAILURE_COLUMNS,
    rows: data?.commonFailures ?? null,
    rowKey: (failure) => `${failure.name}:${failure.cause}`,
    emptyLabel: isInitialLoading ? "Loading failure groups..." : "No repeated failures found.",
    renderRow: (failure, index) => (
      <TableRow columns={COMMON_FAILURE_COLUMNS} paddingY={12} alignItems="flex-start">
        {[
          spanName(failure.name),
          <MonoCell key="count">{formatCount(failure.count)}</MonoCell>,
          <ExpandableText key="cause" text={failure.cause} charsPerLine={82} testId={`diagnostics-common-failure-expand-${index}`} />,
          <RelativeTimeText key="last-seen" value={failure.lastSeenAt} color={theme.mutedForeground} />,
        ]}
      </TableRow>
    ),
  });

  pushTableSection({
    key: "slowest-spans",
    title: "Slowest Spans",
    columns: SLOWEST_SPAN_COLUMNS,
    rows: data?.slowestSpans ?? null,
    rowKey: (span) => `${span.traceId}:${span.spanId}`,
    emptyLabel: isInitialLoading ? "Loading slow spans..." : "No spans found.",
    renderRow: (span, index) => (
      <TableRow columns={SLOWEST_SPAN_COLUMNS} paddingY={12} alignItems="flex-start">
        {[
          spanName(span.name),
          <MonoCell key="duration">{formatDuration(span.durationMs)}</MonoCell>,
          <RelativeTimeText key="ended" value={span.endedAt} color={theme.mutedForeground} />,
          <TraceIdCell key="trace" traceId={span.traceId} testId={`diagnostics-slow-span-copy-${index}`} />,
        ]}
      </TableRow>
    ),
  });

  pushTableSection({
    key: "span-logs",
    title: "Span Logs",
    columns: SPAN_LOG_COLUMNS,
    rows: data?.latestWarningAndErrorLogs ?? null,
    rowKey: (event) => `${event.traceId}:${event.spanId}:${DateTime.formatIso(event.seenAt)}:${event.message.slice(0, 80)}`,
    emptyLabel: isInitialLoading ? "Loading recent logs..." : "No warnings or errors found.",
    renderRow: (event, index) => (
      <TableRow columns={SPAN_LOG_COLUMNS} paddingY={12} alignItems="flex-start" hoverColor={alpha(mutedSurface(theme), 0.15)}>
        {[
          <RelativeTimeText key="time" value={event.seenAt} color={theme.mutedForeground} />,
          <div
            key="level"
            style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 4, backgroundColor: mutedSurface(theme), flexShrink: 0 }}
          >
            <Text size="2xs" mono weight={500} color={alpha(theme.foreground, 0.8)} style={{ whiteSpace: "nowrap" }}>
              {event.level.toUpperCase()}
            </Text>
          </div>,
          <Text key="span" size="xs" weight={500} style={{ whiteSpace: "nowrap" }}>
            {clip(event.spanName, 42)}
          </Text>,
          <ExpandableText key="message" text={event.message} lines={2} charsPerLine={40} expandLabel="Show full message" testId={`diagnostics-span-log-expand-${index}`} />,
          <TraceIdCell key="trace" traceId={event.traceId} testId={`diagnostics-span-log-copy-${index}`} />,
        ]}
      </TableRow>
    ),
  });

  pushTableSection({
    key: "top-spans",
    title: "Top Span Names",
    columns: TOP_SPAN_COLUMNS,
    rows: data?.topSpansByCount ?? null,
    rowKey: (span) => span.name,
    emptyLabel: isInitialLoading ? "Loading span names..." : "No spans found.",
    renderRow: (span) => (
      <TableRow columns={TOP_SPAN_COLUMNS} paddingY={12} alignItems="flex-start">
        {[
          spanName(span.name),
          <MonoCell key="count">{formatCount(span.count)}</MonoCell>,
          <MonoCell key="failures">{formatCount(span.failureCount)}</MonoCell>,
          <MonoCell key="average">{formatDuration(span.averageDurationMs)}</MonoCell>,
          <MonoCell key="max">{formatDuration(span.maxDurationMs)}</MonoCell>,
        ]}
      </TableRow>
    ),
  });

  if (exportFormEnvironmentId === environmentId) {
    items.push({ key: "telemetry-export", node: <TelemetryExportSettings />, gapBefore: SECTION_GAP });
  }

  return (
    <TargetedVirtualPage
      items={items}
      maxWidth={EXPANDED_WIDTH}
      targetKey={searchTarget?.id === "telemetry-export" ? "telemetry-export" : null}
    />
  );
}
