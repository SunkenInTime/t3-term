// Port of apps/web/src/components/settings/ResourceTelemetryDiagnostics.tsx:
// the Resource monitor, Host & collection, Resource timeline, Live process tree
// and Instrumented application I/O sections at the top of Diagnostics.
// useResourceTelemetryItems returns them as virtual-page items; each section is
// one item (its tables are short), and the page owns the state so a section
// scrolled out of the list keeps its collapsed rows and history window.
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthEnvironmentMaintainScope } from "@t3tools/contracts";
import type {
  BackgroundBooleanState,
  EnvironmentId,
  ResourceAttributionEntry,
  ResourceTelemetryAggregate,
  ResourceTelemetryHistoryBucket,
  ResourceTelemetryIoSemantics,
  ResourceTelemetryProcess,
  ResourceTelemetryProcessCategory,
  ResourceTelemetryProcessSummary,
  ResourceTelemetrySourceHealth,
  ResourceTelemetrySourceStatus,
  ServerProcessSignal,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { requestConfirmDialog } from "../../dialogs/confirmDialog.ts";
import { serverEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironmentScope } from "../../state/settings.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import { Segmented } from "../../usage/usageUi.tsx";
import { formatBytes } from "../../web/lib/formatBytes.ts";
import {
  resourceHistoryBarHeight,
  resourceHistoryCpuScaleMax,
  shouldShowResourceMonitorRetry,
  visibleResourceTelemetryProcesses,
} from "../../web/components/settings/ResourceTelemetryDiagnostics.logic.ts";
import { SettingsSection, type SettingsVirtualItem } from "../layout.tsx";
import {
  AlertLine,
  CommandCell,
  ProcessNameCell,
  ProcessSignalActions,
  RefreshButton,
  TableHeader,
  TableRow,
  clip,
  mutedSurface,
  toneColor,
  tracked,
  type DiagnosticsColumn,
} from "./parts.tsx";
import { useRelativeTimeState } from "./useRelativeTimeState.ts";
import { useResourceTelemetry, useResourceTelemetryHistory } from "./state.ts";

const HISTORY_WINDOWS = [
  { label: "5m", windowMs: 5 * 60_000, bucketMs: 15_000 },
  { label: "15m", windowMs: 15 * 60_000, bucketMs: 30_000 },
  { label: "30m", windowMs: 30 * 60_000, bucketMs: 60_000 },
  { label: "1h", windowMs: 60 * 60_000, bucketMs: 2 * 60_000 },
] as const;

/** Tailwind violet-500, the server process dot. */
const VIOLET_500 = "#8e51ff";

function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}

function formatCpuTime(valueMs: number): string {
  const seconds = valueMs / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}

function formatDurationMicros(value: number): string {
  if (value < 1_000) return `${Math.round(value)} µs`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(2)} ms`;
  return `${(value / 1_000_000).toFixed(2)} s`;
}

function formatSampleInterval(valueMs: number): string {
  if (valueMs < 1_000) return `${Math.max(0, Math.round(valueMs))} ms`;
  const seconds = valueMs / 1_000;
  return `${seconds.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${seconds === 1 ? "second" : "seconds"}`;
}

function processIdentityKey(process: ResourceTelemetryProcess): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

function processSummaryIdentityKey(process: ResourceTelemetryProcessSummary): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

function formatProcessName(process: Pick<ResourceTelemetryProcess, "command" | "name">): string {
  if (process.name.trim()) return process.name;
  const firstToken = process.command.trim().split(/\s+/)[0] ?? process.command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  return normalized.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? normalized;
}

function categoryLabel(category: ResourceTelemetryProcessCategory): string {
  switch (category) {
    case "server":
      return "Server";
    case "server-child":
      return "Backend child";
    case "provider-root":
      return "Provider";
    case "terminal-root":
      return "Terminal";
    case "electron-main":
      return "Electron main";
    case "electron-renderer":
      return "Renderer";
    case "electron-gpu":
      return "GPU";
    case "electron-utility":
      return "Electron utility";
    case "resource-monitor":
      return "Monitor";
    case "unknown-t3":
      return "T3 process";
  }
}

function categoryDotColor(theme: Palette, category: ResourceTelemetryProcessCategory): string {
  if (category === "resource-monitor") return theme.warning;
  if (category.startsWith("electron-")) return theme.info;
  if (category === "server") return VIOLET_500;
  return theme.success;
}

function ioSemanticsLabel(semantics: ResourceTelemetryIoSemantics): string {
  switch (semantics) {
    case "storage":
      return "Storage bytes";
    case "logical":
      return "Logical bytes";
    case "all-io":
      return "All I/O bytes";
    case "unavailable":
      return "Unavailable";
  }
}

function booleanStateLabel(value: BackgroundBooleanState, labels: { readonly true: string; readonly false: string }): string {
  if (value === "true") return labels.true;
  if (value === "false") return labels.false;
  return "Unknown";
}

function sourceStatusTone(status: ResourceTelemetrySourceStatus): "default" | "warning" | "danger" {
  if (status === "healthy") return "default";
  if (status === "starting" || status === "degraded") return "warning";
  return "danger";
}

function canSignalProcess(process: ResourceTelemetryProcess): boolean {
  return process.category === "server-child" || process.category === "provider-root" || process.category === "terminal-root";
}

// ── Small pieces ────────────────────────────────────────────────────────

function SourceStatusBadge({
  label,
  status,
  presentation,
}: {
  label: string;
  status: ResourceTelemetrySourceStatus;
  presentation?: { readonly label: string; readonly tone: "neutral" } | undefined;
}) {
  const theme = useTheme();
  const tone = presentation?.tone ?? sourceStatusTone(status);
  const colors =
    tone === "neutral"
      ? { border: alpha(theme.border, 0.7), bg: alpha(mutedSurface(theme), 0.45), fg: theme.mutedForeground, dot: alpha(theme.mutedForeground, 0.55) }
      : tone === "default"
        ? { border: alpha(theme.success, 0.25), bg: alpha(theme.success, 0.1), fg: theme.successForeground, dot: theme.success }
        : tone === "warning"
          ? { border: alpha(theme.warning, 0.3), bg: alpha(theme.warning, 0.1), fg: theme.warningForeground, dot: theme.warning }
          : { border: alpha(theme.error, 0.3), bg: alpha(theme.error, 0.1), fg: theme.error, dot: theme.error };
  const text = `${label} ${presentation?.label ?? status}`.trim();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 4,
        paddingBottom: 4,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bg,
        flexShrink: 0,
      }}
    >
      <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dot, flexShrink: 0 }} />
      <Text size="3xs" weight={600} color={colors.fg} style={{ whiteSpace: "nowrap" }}>
        {tracked(text)}
      </Text>
    </div>
  );
}

function LastSampleLabel({ sampledAt }: { sampledAt: DateTime.Utc | null }) {
  const theme = useTheme();
  const relative = useRelativeTimeState(sampledAt ? DateTime.formatIso(sampledAt) : null);
  if (relative.status !== "relative") {
    return (
      <Text size="2xs" color={alpha(theme.mutedForeground, 0.55)} style={{ whiteSpace: "nowrap" }}>
        Waiting for sample
      </Text>
    );
  }
  const color = alpha(theme.mutedForeground, 0.6);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", flexShrink: 0 }}>
      <Text size="2xs" color={color}>
        {"Updated "}
      </Text>
      <Text size="2xs" mono color={color}>
        {relative.value}
      </Text>
      {relative.suffix ? (
        <Text size="2xs" color={color}>
          {` ${relative.suffix}`}
        </Text>
      ) : null}
    </div>
  );
}

/** The rounded-2xl inner card every telemetry section draws inside its group. */
function TelemetryCard({ children, style }: { children: ReactNode; style?: Record<string, unknown> }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: RADIUS["2xl"],
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.7),
        backgroundColor: theme.card,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function UppercaseLabel({ children, color, size = "3xs" }: { children: string; color: string; size?: "3xs" | "2xs" }) {
  return (
    <Text size={size} weight={600} color={color} style={{ whiteSpace: "nowrap" }}>
      {tracked(children)}
    </Text>
  );
}

interface IconStatProps {
  readonly icon: IconName;
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
  readonly tone?: "default" | "warning" | "danger";
}

function IconStat({
  icon,
  label,
  value,
  detail,
  tone = "default",
  borderRight,
  borderBottom,
}: IconStatProps & { borderRight: boolean; borderBottom: boolean }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 16,
        paddingBottom: 16,
        borderRightWidth: borderRight ? 1 : 0,
        borderBottomWidth: borderBottom ? 1 : 0,
        borderColor: alpha(theme.border, 0.55),
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name={icon} size={14} color={hover ? alpha(theme.foreground, 0.65) : alpha(theme.mutedForeground, 0.55)} />
        <UppercaseLabel color={alpha(theme.mutedForeground, 0.7)}>{label}</UppercaseLabel>
      </div>
      <Text mono weight={600} color={toneColor(theme, tone)} style={{ marginTop: 10, fontSize: 24, lineHeight: 32, whiteSpace: "nowrap" }}>
        {value}
      </Text>
      {detail ? (
        <Text size="3xs" color={alpha(theme.mutedForeground, 0.6)} style={{ marginTop: 6, whiteSpace: "nowrap" }}>
          {detail}
        </Text>
      ) : null}
    </div>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
      <UppercaseLabel color={alpha(theme.mutedForeground, 0.45)}>{label}</UppercaseLabel>
      <Text size="xs" mono weight={500} color={alpha(theme.foreground, 0.9)} style={{ whiteSpace: "nowrap" }}>
        {value}
      </Text>
    </div>
  );
}

function AggregateCard({
  label,
  accent,
  aggregate,
  first,
}: {
  label: string;
  accent: string;
  aggregate: ResourceTelemetryAggregate;
  first: boolean;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        paddingLeft: 20,
        paddingRight: 20,
        paddingBottom: 16,
        ...(first ? {} : { borderLeftWidth: 1, borderColor: alpha(theme.border, 0.6) }),
      }}
    >
      {/* absolute inset-x-5 top-0 h-0.5 accent bar, drawn in flow */}
      <div style={{ height: 2, borderRadius: 1, backgroundColor: alpha(accent, 0.75), flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14 }}>
        <UppercaseLabel color={alpha(theme.mutedForeground, 0.75)}>{label}</UppercaseLabel>
        <div style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: RADIUS.sm, backgroundColor: alpha(mutedSurface(theme), 0.55) }}>
          <Text size="3xs" mono color={alpha(theme.mutedForeground, 0.7)} style={{ whiteSpace: "nowrap" }}>
            {`${aggregate.processCount} ${aggregate.processCount === 1 ? "process" : "processes"}`}
          </Text>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        <div style={{ display: "flex", flexDirection: "row", gap: 16 }}>
          <MetricPair label="CPU" value={`${aggregate.currentCpuPercent.toFixed(1)}%`} />
          <MetricPair label="Memory" value={formatBytes(aggregate.currentRssBytes)} />
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: 16 }}>
          <MetricPair label="Read" value={formatRate(aggregate.ioReadBytesPerSecond)} />
          <MetricPair label="Write" value={formatRate(aggregate.ioWriteBytesPerSecond)} />
        </div>
      </div>
    </div>
  );
}

function HealthSource({ label, health, first }: { label: string; health: ResourceTelemetrySourceHealth; first: boolean }) {
  const theme = useTheme();
  const expectedInBrowser =
    health.status === "unavailable" && Option.exists(health.lastError, (error) => error.includes("'web' mode"));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        paddingTop: 12,
        paddingBottom: 12,
        ...(first ? {} : { borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) }),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 1, minWidth: 0 }}>
        <Text weight={500}>{label}</Text>
        <Text size="2xs" color={alpha(theme.mutedForeground, 0.65)} style={{ marginTop: 4, lineHeight: 17.875 }}>
          {expectedInBrowser
            ? "Available when this page runs inside the desktop app."
            : Option.match(health.lastError, { onNone: () => "No reported errors", onSome: (error) => error })}
        </Text>
      </div>
      <SourceStatusBadge
        label=""
        status={health.status}
        presentation={expectedInBrowser ? { label: "Desktop only", tone: "neutral" } : undefined}
      />
    </div>
  );
}

function DetailRow({ label, value, valueColor, first }: { label: string; value: string; valueColor?: string | undefined; first?: boolean }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        paddingTop: 10,
        paddingBottom: 10,
        ...(first ? {} : { borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) }),
      }}
    >
      <Text size="2xs" color={alpha(theme.mutedForeground, 0.75)} style={{ whiteSpace: "nowrap" }}>
        {label}
      </Text>
      <Text size="2xs" mono color={valueColor ?? alpha(theme.foreground, 0.85)} style={{ whiteSpace: "nowrap" }}>
        {value}
      </Text>
    </div>
  );
}

function PanelHeading({ icon, children }: { icon: IconName; children: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: RADIUS.md,
          backgroundColor: alpha(mutedSurface(theme), 0.6),
        }}
      >
        <Icon name={icon} size={14} color={alpha(theme.mutedForeground, 0.7)} />
      </div>
      <UppercaseLabel color={alpha(theme.mutedForeground, 0.7)}>{children}</UppercaseLabel>
    </div>
  );
}

function ErrorStrip({ message, position }: { message: string; position: "top" | "bottom" }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 12,
        paddingBottom: 12,
        backgroundColor: alpha(theme.error, 0.05),
        borderColor: alpha(theme.error, 0.2),
        ...(position === "top" ? { borderTopWidth: 1 } : { borderBottomWidth: 1 }),
      }}
    >
      <AlertLine text={message} color={theme.error} />
    </div>
  );
}

// ── Chart ───────────────────────────────────────────────────────────────

const CHART_PLOT_HEIGHT = 128 - 2 - 12 - 8;

function ResourceHistoryChart({ buckets }: { buckets: ReadonlyArray<ResourceTelemetryHistoryBucket> }) {
  const theme = useTheme();
  const maxCpu = resourceHistoryCpuScaleMax(buckets);
  const maxIo = Math.max(1, ...buckets.map((bucket) => bucket.ioReadBytes + bucket.ioWriteBytes));
  const legend = (color: string, label: string) => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
      <div style={{ width: 12, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text size="3xs" color={alpha(theme.mutedForeground, 0.65)}>
        {label}
      </Text>
    </div>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 16,
        paddingBottom: 16,
        borderTopWidth: 1,
        borderColor: alpha(theme.border, 0.6),
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 4, marginBottom: 12 }}>
        {legend(alpha(theme.foreground, 0.7), "CPU average")}
        {legend(alpha(theme.info, 0.7), "I/O reads")}
        {legend(alpha(theme.warning, 0.8), "I/O writes")}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 4,
          height: 128,
          overflow: "hidden",
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.4),
          backgroundColor: alpha(mutedSurface(theme), 0.08),
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 12,
          paddingBottom: 8,
        }}
      >
        {buckets.map((bucket) => {
          const bars = [
            { color: alpha(theme.foreground, 0.65), height: resourceHistoryBarHeight({ value: bucket.avgCpuPercent, max: maxCpu, minimumVisiblePercent: 2 }) },
            { color: alpha(theme.info, 0.7), height: resourceHistoryBarHeight({ value: bucket.ioReadBytes, max: maxIo, minimumVisiblePercent: 1 }) },
            { color: alpha(theme.warning, 0.8), height: resourceHistoryBarHeight({ value: bucket.ioWriteBytes, max: maxIo, minimumVisiblePercent: 1 }) },
          ];
          return (
            <Tooltip
              key={DateTime.formatIso(bucket.startedAt)}
              side="top"
              content={`CPU avg ${bucket.avgCpuPercent.toFixed(1)}%\nCPU peak ${bucket.maxCpuPercent.toFixed(1)}%\nRead ${formatBytes(bucket.ioReadBytes)}\nWrite ${formatBytes(bucket.ioWriteBytes)}`}
              rootStyle={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 4, height: "100%" }}
            >
              <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 1, flexGrow: 1, height: "100%" }}>
                {bars.map((bar, index) => (
                  <div
                    key={index}
                    style={{
                      flexGrow: 1,
                      flexBasis: 0,
                      height: (bar.height / 100) * CHART_PLOT_HEIGHT,
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                      backgroundColor: bar.color,
                    }}
                  />
                ))}
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ── Tables ──────────────────────────────────────────────────────────────

const HISTORY_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Process", width: 24, paddingLeft: 20 },
  { label: "Category", width: 11, paddingLeft: 12, paddingRight: 12 },
  { label: "CPU Time", width: 10, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Peak CPU", width: 10, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Peak Mem", width: 11, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Read", width: 11, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Write", width: 11, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Samples", width: 7, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "PID", width: 5, align: "right", paddingLeft: 12, paddingRight: 20 },
];

const TREE_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Process", width: 20, paddingLeft: 20 },
  { label: "Category", width: 10, paddingLeft: 12, paddingRight: 12 },
  { label: "CPU", width: 7, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "CPU Time", width: 8, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Memory", width: 9, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Read/s", width: 9, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Write/s", width: 9, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Read Total", width: 10, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Write Total", width: 8, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "PID", width: 6, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Kill", width: 4, align: "right", paddingLeft: 8, paddingRight: 16, overflowVisible: true },
];

const ATTRIBUTION_COLUMNS: ReadonlyArray<DiagnosticsColumn> = [
  { label: "Component", width: 22, paddingLeft: 20 },
  { label: "Operation", width: 28, paddingLeft: 12, paddingRight: 12 },
  { label: "Logical Read", width: 14, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Logical Write", width: 14, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Count", width: 10, align: "right", paddingLeft: 12, paddingRight: 12 },
  { label: "Time", width: 12, align: "right", paddingLeft: 12, paddingRight: 20 },
];

function useTableColors() {
  const theme = useTheme();
  return {
    header: alpha(theme.mutedForeground, 0.65),
    divider: alpha(theme.border, 0.5),
    hover: alpha(mutedSurface(theme), 0.2),
  };
}

function TableEmpty({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 20, paddingBottom: 20 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {label}
      </Text>
    </div>
  );
}

function Rows({ children, divider }: { children: ReadonlyArray<ReactNode>; divider: string }) {
  return (
    <>
      {children.map((child, index) => (
        <div key={index} style={{ display: "flex", flexDirection: "column", ...(index > 0 ? { borderTopWidth: 1, borderColor: divider } : {}) }}>
          {child}
        </div>
      ))}
    </>
  );
}

function Mono({ children, color }: { children: string; color?: string }) {
  const theme = useTheme();
  return (
    <Text size="xs" mono color={color ?? theme.foreground} style={{ whiteSpace: "nowrap" }}>
      {children}
    </Text>
  );
}

function Muted({ children, size = "2xs" }: { children: string; size?: "2xs" | "xs" }) {
  const theme = useTheme();
  return (
    <Text size={size} color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
      {children}
    </Text>
  );
}

function HistoryProcessTable({ processes }: { processes: ReadonlyArray<ResourceTelemetryProcessSummary> }) {
  const theme = useTheme();
  const colors = useTableColors();
  return (
    <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
      <TableHeader columns={HISTORY_COLUMNS} size="3xs" paddingY={8} color={colors.header} />
      {processes.length === 0 ? <TableEmpty label="No retained process samples in this window." /> : null}
      <Rows divider={colors.divider}>
        {processes.map((process) => (
          <TableRow key={processSummaryIdentityKey(process)} columns={HISTORY_COLUMNS} paddingY={8} hoverColor={colors.hover}>
            {[
              <Tooltip key="name" content={clip(process.command || process.name, 600)} side="top">
                <div style={{ display: "flex", minWidth: 0 }}>
                  <Text size="xs" weight={500} style={{ whiteSpace: "nowrap" }}>
                    {clip(process.name || process.command, 40)}
                  </Text>
                </div>
              </Tooltip>,
              <Muted key="category">{categoryLabel(process.category)}</Muted>,
              <Mono key="cpu-time">{formatCpuTime(process.cpuTimeMs)}</Mono>,
              <Mono key="peak-cpu">{`${process.maxCpuPercent.toFixed(1)}%`}</Mono>,
              <Mono key="peak-mem">{formatBytes(process.peakRssBytes)}</Mono>,
              <Mono key="read" color={theme.infoForeground}>
                {formatBytes(process.ioReadBytes)}
              </Mono>,
              <Mono key="write" color={theme.warningForeground}>
                {formatBytes(process.ioWriteBytes)}
              </Mono>,
              <Mono key="samples" color={theme.mutedForeground}>
                {String(process.sampleCount)}
              </Mono>,
              <Mono key="pid" color={theme.mutedForeground}>
                {String(process.identity.pid)}
              </Mono>,
            ]}
          </TableRow>
        ))}
      </Rows>
    </div>
  );
}

/** Wider than the page column, so it scrolls sideways like the web's ScrollArea. */
const TREE_MIN_WIDTH = 1320;

function ProcessTable({
  processes,
  collapsed,
  onToggle,
  canMaintainEnvironment,
  signalingKeys,
  onSignal,
}: {
  processes: ReadonlyArray<ResourceTelemetryProcess>;
  collapsed: ReadonlySet<string>;
  onToggle: (process: ResourceTelemetryProcess) => void;
  canMaintainEnvironment: boolean;
  signalingKeys: ReadonlySet<string>;
  onSignal: (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => void;
}) {
  const theme = useTheme();
  const colors = useTableColors();
  const visible = visibleResourceTelemetryProcesses(processes, collapsed);
  return (
    <div testId="diagnostics-process-tree-scroll" style={{ display: "flex", flexDirection: "row", overflowX: "scroll", scrollbarWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: TREE_MIN_WIDTH }}>
        <TableHeader columns={TREE_COLUMNS} size="3xs" paddingY={8} color={colors.header} />
        {visible.length === 0 ? <TableEmpty label="Waiting for the native process monitor." /> : null}
        <Rows divider={colors.divider}>
          {visible.map((process) => {
            const key = processIdentityKey(process);
            const name = formatProcessName(process);
            return (
              <TableRow key={key} columns={TREE_COLUMNS} paddingY={8} hoverColor={colors.hover}>
                {[
                  <ProcessNameCell
                    key="name"
                    name={clip(name, 40)}
                    tooltip={clip(process.command || process.name, 600)}
                    depth={Math.min(process.depth, 7)}
                    dotColor={categoryDotColor(theme, process.category)}
                    toggle={
                      process.childPids.length > 0
                        ? {
                            expanded: !collapsed.has(key),
                            onToggle: () => onToggle(process),
                            testId: `diagnostics-tree-toggle-${process.identity.pid}`,
                          }
                        : undefined
                    }
                  />,
                  <Muted key="category">{categoryLabel(process.category)}</Muted>,
                  <Mono key="cpu">{`${process.cpuPercent.toFixed(1)}%`}</Mono>,
                  <Mono key="cpu-time">{formatCpuTime(process.cpuTimeMs)}</Mono>,
                  <Mono key="memory">{formatBytes(process.residentBytes)}</Mono>,
                  <Mono key="read-rate" color={theme.infoForeground}>
                    {formatRate(process.ioReadBytesPerSecond)}
                  </Mono>,
                  <Mono key="write-rate" color={theme.warningForeground}>
                    {formatRate(process.ioWriteBytesPerSecond)}
                  </Mono>,
                  <Mono key="read-total" color={theme.mutedForeground}>
                    {formatBytes(process.ioReadBytes)}
                  </Mono>,
                  <Tooltip key="write-total" content={ioSemanticsLabel(process.ioSemantics)} side="top">
                    <div style={{ display: "flex" }}>
                      <Mono color={theme.mutedForeground}>{formatBytes(process.ioWriteBytes)}</Mono>
                    </div>
                  </Tooltip>,
                  <Mono key="pid" color={theme.mutedForeground}>
                    {String(process.identity.pid)}
                  </Mono>,
                  canSignalProcess(process) ? (
                    <ProcessSignalActions
                      key="kill"
                      testId={`diagnostics-tree-signal-${process.identity.pid}`}
                      disabled={!canMaintainEnvironment || signalingKeys.has(key)}
                      onSignal={(signal) => onSignal(process, signal)}
                    />
                  ) : (
                    <Text key="kill" size="3xs" color={alpha(theme.mutedForeground, 0.35)}>
                      -
                    </Text>
                  ),
                ]}
              </TableRow>
            );
          })}
        </Rows>
      </div>
    </div>
  );
}

function AttributionTable({ entries }: { entries: ReadonlyArray<ResourceAttributionEntry> }) {
  const theme = useTheme();
  const colors = useTableColors();
  return (
    <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
      <TableHeader columns={ATTRIBUTION_COLUMNS} size="3xs" paddingY={8} color={colors.header} />
      {entries.length === 0 ? <TableEmpty label="No instrumented application I/O has been recorded yet." /> : null}
      <Rows divider={colors.divider}>
        {entries.map((entry) => (
          <TableRow key={`${entry.component}:${entry.operation}`} columns={ATTRIBUTION_COLUMNS} paddingY={8} hoverColor={colors.hover}>
            {[
              <Text key="component" size="xs" weight={500} style={{ whiteSpace: "nowrap" }}>
                {clip(entry.component, 36)}
              </Text>,
              <Muted key="operation" size="xs">
                {clip(entry.operation, 44)}
              </Muted>,
              <Mono key="read" color={theme.infoForeground}>
                {formatBytes(entry.logicalReadBytes)}
              </Mono>,
              <Mono key="write" color={theme.warningForeground}>
                {formatBytes(entry.logicalWriteBytes)}
              </Mono>,
              <Mono key="count">{String(entry.count)}</Mono>,
              <Mono key="time" color={theme.mutedForeground}>
                {`${(entry.durationMs / 1_000).toFixed(2)}s`}
              </Mono>,
            ]}
          </TableRow>
        ))}
      </Rows>
    </div>
  );
}

// ── Sections ────────────────────────────────────────────────────────────

export function useResourceTelemetryItems(environmentId: EnvironmentId | null): SettingsVirtualItem[] {
  const theme = useTheme();
  const [windowMs, setWindowMs] = useState(15 * 60_000);
  const selectedWindow = HISTORY_WINDOWS.find((option) => option.windowMs === windowMs) ?? HISTORY_WINDOWS[1];
  const canMaintainEnvironment = useEnvironmentScope(environmentId, AuthEnvironmentMaintainScope);
  const telemetry = useResourceTelemetry(environmentId);
  const retryTelemetry = telemetry.retry;
  const history = useResourceTelemetryHistory({ windowMs: selectedWindow.windowMs, bucketMs: selectedWindow.bucketMs }, environmentId);
  const signalServerProcess = useAtomCommand(serverEnvironment.signalProcess, { reportFailure: false });
  const [signalingKeys, setSignalingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const signalingKeysRef = useRef<ReadonlySet<string>>(new Set());
  const environmentIdRef = useRef(environmentId);
  useEffect(() => {
    environmentIdRef.current = environmentId;
    return () => {
      environmentIdRef.current = null;
    };
  }, [environmentId]);
  const [isRetrying, setIsRetrying] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const snapshot = telemetry.data;
  const allT3 = snapshot?.groups.allT3;

  const toggleProcess = (process: ResourceTelemetryProcess) => {
    const identityKey = processIdentityKey(process);
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(identityKey)) next.delete(identityKey);
      else next.add(identityKey);
      return next;
    });
  };

  const signalProcess = async (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => {
    const targetEnvironmentId = environmentIdRef.current;
    if (targetEnvironmentId === null || !readEnvironmentScope(targetEnvironmentId, AuthEnvironmentMaintainScope)) return;
    const identityKey = processIdentityKey(process);
    if (signalingKeysRef.current.has(identityKey)) return;
    const nextSignalingKeys = new Set(signalingKeysRef.current).add(identityKey);
    signalingKeysRef.current = nextSignalingKeys;
    setSignalingKeys(nextSignalingKeys);
    const clearSignaling = () => {
      const next = new Set(signalingKeysRef.current);
      next.delete(identityKey);
      signalingKeysRef.current = next;
      setSignalingKeys(next);
    };
    if (signal === "SIGKILL") {
      const confirmed = await requestConfirmDialog(
        `Send SIGKILL to process ${process.identity.pid}? This cannot be handled by the process.`,
        { variant: "destructive" },
      );
      if (!confirmed) {
        clearSignaling();
        return;
      }
    }
    if (environmentIdRef.current !== targetEnvironmentId || !readEnvironmentScope(targetEnvironmentId, AuthEnvironmentMaintainScope)) {
      clearSignaling();
      return;
    }
    void signalServerProcess({
      environmentId: targetEnvironmentId,
      input: { pid: process.identity.pid, startTimeMs: process.identity.startTimeMs, signal },
    })
      .then((result) => {
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          throw squashAtomCommandFailure(result);
        }
        if (result.value.signaled) return;
        toast({
          type: "error",
          title: `Could not send ${signal}`,
          description: Option.getOrElse(result.value.message, () => `Failed to send ${signal} to process ${process.identity.pid}.`),
        });
      })
      .catch((error: unknown) => {
        toast({
          type: "error",
          title: `Could not send ${signal}`,
          description: error instanceof Error ? error.message : `Failed to send ${signal}.`,
        });
      })
      .finally(() => {
        clearSignaling();
      });
  };

  const retryCollector = () => {
    const currentEnvironmentId = environmentIdRef.current;
    if (currentEnvironmentId === null || !readEnvironmentScope(currentEnvironmentId, AuthEnvironmentMaintainScope)) return;
    setIsRetrying(true);
    void retryTelemetry()
      .catch((error: unknown) => {
        toast({
          type: "error",
          title: "Could not restart resource monitor",
          description: error instanceof Error ? error.message : "The resource monitor retry failed.",
        });
      })
      .finally(() => {
        setIsRetrying(false);
      });
  };

  const speedLimit = snapshot ? Option.getOrNull(snapshot.speedLimitPercent) : null;
  const collectorNeedsRetry = shouldShowResourceMonitorRetry({
    nativeStatus: snapshot?.health.native.status ?? null,
    error: telemetry.error,
  });
  const hasHostPowerSignal =
    snapshot !== null &&
    (snapshot.power.onBattery !== "unknown" ||
      snapshot.power.lowPowerMode !== "unknown" ||
      snapshot.power.idle !== "unknown" ||
      snapshot.power.locked !== "unknown" ||
      snapshot.power.thermalState !== "unknown");
  const sectionIcon = (name: IconName) => <Icon name={name} size={16} color={theme.mutedForeground} />;
  const writeTone =
    allT3 && allT3.ioWriteBytesPerSecond >= 10 * 1_024 * 1_024
      ? "danger"
      : allT3 && allT3.ioWriteBytesPerSecond >= 1_024 * 1_024
        ? "warning"
        : "default";
  const stats: ReadonlyArray<IconStatProps> = [
    {
      icon: "cpu",
      label: "Current CPU",
      value: allT3 ? `${allT3.currentCpuPercent.toFixed(1)}%` : "...",
      detail: allT3 ? `${formatCpuTime(allT3.cpuTimeMs)} observed CPU time` : undefined,
    },
    {
      icon: "memory-stick",
      label: "Resident memory",
      value: allT3 ? formatBytes(allT3.currentRssBytes) : "...",
      detail: allT3 ? `${formatBytes(allT3.peakRssBytes)} combined process peaks` : undefined,
    },
    {
      icon: "activity",
      label: "Process count",
      value: allT3 ? String(allT3.processCount) : "...",
      detail: allT3 ? `${allT3.processStarts} starts · ${allT3.processExits} exits` : undefined,
    },
    {
      icon: "hard-drive",
      label: "Read throughput",
      value: allT3 ? formatRate(allT3.ioReadBytesPerSecond) : "...",
      detail: allT3 ? `${formatBytes(allT3.ioReadBytes)} observed` : undefined,
    },
    {
      icon: "database",
      label: "Write throughput",
      value: allT3 ? formatRate(allT3.ioWriteBytesPerSecond) : "...",
      detail: allT3 ? `${formatBytes(allT3.ioWriteBytes)} observed` : undefined,
      tone: writeTone,
    },
    {
      icon: "gauge",
      label: "CPU speed limit",
      value: snapshot ? (speedLimit === null ? "Unknown" : `${speedLimit.toFixed(0)}%`) : "...",
      detail: snapshot ? `${snapshot.power.thermalState} thermal state` : undefined,
      tone: speedLimit !== null && speedLimit < 80 ? "warning" : "default",
    },
  ];

  const resourceMonitor = (
    <SettingsSection
      title="Resource monitor"
      icon={sectionIcon("activity")}
      headerAction={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          {snapshot ? <SourceStatusBadge label="Native" status={snapshot.health.native.status} /> : null}
          <LastSampleLabel sampledAt={snapshot?.readAt ?? null} />
          <RefreshButton
            size="micro"
            isPending={telemetry.isPending}
            label="Refresh telemetry snapshot"
            onClick={telemetry.refresh}
            testId="diagnostics-telemetry-refresh"
          />
        </div>
      }
    >
      <TelemetryCard>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            paddingLeft: 20,
            paddingRight: 20,
            paddingTop: 16,
            paddingBottom: 16,
            borderBottomWidth: 1,
            borderColor: alpha(theme.border, 0.6),
            background: {
              type: "linear-gradient",
              angle: 90,
              stops: [
                { color: alpha(mutedSurface(theme), 0.45), position: 0 },
                { color: alpha(mutedSurface(theme), 0), position: 1 },
              ],
            },
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 1, minWidth: 0 }}>
            <UppercaseLabel color={alpha(theme.mutedForeground, 0.7)}>T3 system footprint</UppercaseLabel>
            <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 4, maxWidth: 576, lineHeight: 19.5 }}>
              Live native counters for the server, providers, terminals, desktop processes, and the monitor itself.
            </Text>
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.success }} />
            <Text size="3xs" color={alpha(theme.mutedForeground, 0.65)} style={{ whiteSpace: "nowrap" }}>
              {`Sampling every ${snapshot ? formatSampleInterval(snapshot.sampleIntervalMs) : "..."}`}
            </Text>
          </div>
        </div>
        {[stats.slice(0, 3), stats.slice(3)].map((row, rowIndex) => (
          <div key={rowIndex} style={{ display: "flex", flexDirection: "row" }}>
            {row.map((stat, columnIndex) => {
              const index = rowIndex * 3 + columnIndex;
              // divide-x divide-y: every cell but the last draws its right and bottom rule.
              return <IconStat key={stat.label} {...stat} borderRight={index < 5} borderBottom={index < 5} />;
            })}
          </div>
        ))}
        {telemetry.error ? <ErrorStrip message={telemetry.error} position="top" /> : null}
        {snapshot ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              borderTopWidth: 1,
              borderColor: alpha(theme.border, 0.6),
              backgroundColor: alpha(mutedSurface(theme), 0.1),
            }}
          >
            <AggregateCard label="Backend + agents" accent={alpha(theme.success, 0.8)} aggregate={snapshot.groups.backend} first />
            <AggregateCard label="Desktop" accent={alpha(theme.info, 0.8)} aggregate={snapshot.groups.electron} first={false} />
            <AggregateCard label="Monitor overhead" accent={alpha(theme.warning, 0.8)} aggregate={snapshot.groups.monitor} first={false} />
          </div>
        ) : null}
      </TelemetryCard>
    </SettingsSection>
  );

  const hostAndCollection = (
    <SettingsSection
      title="Host & collection"
      icon={sectionIcon("gauge")}
      headerAction={
        collectorNeedsRetry ? (
          <Button size="xs" variant="outline" icon="refresh-cw" disabled={isRetrying} onClick={retryCollector} testId="diagnostics-retry-monitor">
            Retry monitor
          </Button>
        ) : null
      }
    >
      <TelemetryCard style={{ flexDirection: "row" }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0, paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 16 }}>
          <PanelHeading icon="battery">Host state</PanelHeading>
          {hasHostPowerSignal && snapshot ? (
            <>
              <DetailRow
                first
                label="Power source"
                value={booleanStateLabel(snapshot.power.onBattery, { true: "Battery", false: "External power" })}
              />
              <DetailRow label="Low power mode" value={booleanStateLabel(snapshot.power.lowPowerMode, { true: "Enabled", false: "Disabled" })} />
              <DetailRow
                label="Idle"
                value={`${booleanStateLabel(snapshot.power.idle, { true: "Idle", false: "Active" })}${
                  snapshot.power.idleSeconds === null ? "" : ` · ${Math.round(snapshot.power.idleSeconds)}s`
                }`}
              />
              <DetailRow
                label="Session"
                value={
                  snapshot.power.suspended ? "Suspended" : booleanStateLabel(snapshot.power.locked, { true: "Locked", false: "Unlocked" })
                }
              />
              <DetailRow
                label="Thermal"
                value={snapshot.power.thermalState}
                valueColor={snapshot.power.thermalState === "serious" || snapshot.power.thermalState === "critical" ? theme.error : undefined}
              />
            </>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                paddingLeft: 16,
                paddingRight: 16,
                paddingTop: 20,
                paddingBottom: 20,
                borderRadius: RADIUS.xl,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: alpha(theme.border, 0.7),
                backgroundColor: alpha(mutedSurface(theme), 0.2),
              }}
            >
              <Text weight={500}>Desktop host signals not connected</Text>
              <Text size="2xs" color={alpha(theme.mutedForeground, 0.7)} style={{ marginTop: 6, maxWidth: 384, lineHeight: 17.875 }}>
                Power, idle, lock, and thermal state are supplied by the desktop host. Process telemetry remains fully active in this browser session.
              </Text>
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
            paddingLeft: 20,
            paddingRight: 20,
            paddingTop: 16,
            paddingBottom: 16,
            borderLeftWidth: 1,
            borderColor: alpha(theme.border, 0.6),
          }}
        >
          <PanelHeading icon="gauge">Collection health</PanelHeading>
          {snapshot ? (
            <>
              <HealthSource first={false} label="Native process monitor" health={snapshot.health.native} />
              <HealthSource first={false} label="Electron main process" health={snapshot.health.desktop} />
              <DetailRow label="Collection time" value={formatDurationMicros(snapshot.health.collectionDurationMicros)} />
              <DetailRow label="Process scan" value={`${snapshot.health.retainedProcessCount}/${snapshot.health.scannedProcessCount} retained`} />
              <DetailRow
                label="Inaccessible"
                value={String(snapshot.health.inaccessibleProcessCount)}
                valueColor={snapshot.health.inaccessibleProcessCount > 0 ? theme.warningForeground : undefined}
              />
              <DetailRow
                label="Sidecar"
                value={Option.match(snapshot.health.sidecarVersion, {
                  onNone: () => "Unavailable",
                  onSome: (version) =>
                    `${version}${Option.match(snapshot.health.sidecarPid, { onNone: () => "", onSome: (pid) => ` · PID ${pid}` })}`,
                })}
              />
              <DetailRow label="Restarts" value={String(snapshot.health.restartCount)} />
            </>
          ) : (
            <div style={{ paddingTop: 16, paddingBottom: 16 }}>
              <Text size="xs" color={theme.mutedForeground}>
                Waiting for collector health.
              </Text>
            </div>
          )}
        </div>
      </TelemetryCard>
    </SettingsSection>
  );

  const resourceTimeline = (
    <SettingsSection
      title="Resource timeline"
      icon={sectionIcon("hard-drive")}
      headerAction={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Segmented
            options={HISTORY_WINDOWS.map((option) => ({ value: String(option.windowMs), label: option.label }))}
            value={String(windowMs)}
            onChange={(next) => {
              const selected = HISTORY_WINDOWS.find((option) => String(option.windowMs) === next);
              if (selected) setWindowMs(selected.windowMs);
            }}
            testIdPrefix="diagnostics-timeline-window"
          />
          <RefreshButton
            size="micro"
            isPending={history.isPending}
            label="Refresh resource history"
            onClick={history.refresh}
            testId="diagnostics-timeline-refresh"
          />
        </div>
      }
    >
      <TelemetryCard>
        {history.error ? <ErrorStrip message={history.error} position="bottom" /> : null}
        <ResourceHistoryChart buckets={history.data?.buckets ?? []} />
        <HistoryProcessTable processes={history.data?.topProcesses ?? []} />
      </TelemetryCard>
    </SettingsSection>
  );

  const liveProcessTree = (
    <SettingsSection
      title="Live process tree"
      icon={sectionIcon("cpu")}
      headerAction={
        snapshot ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline" }}>
            <Text size="3xs" color={alpha(theme.mutedForeground, 0.55)}>
              {"Identity: "}
            </Text>
            <Text size="3xs" mono color={alpha(theme.mutedForeground, 0.55)}>
              PID + start time
            </Text>
          </div>
        ) : null
      }
    >
      <TelemetryCard>
        <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
          <ProcessTable
            processes={snapshot?.processes ?? []}
            collapsed={collapsed}
            onToggle={toggleProcess}
            canMaintainEnvironment={canMaintainEnvironment}
            signalingKeys={signalingKeys}
            onSignal={(process, signal) => void signalProcess(process, signal)}
          />
        </div>
      </TelemetryCard>
    </SettingsSection>
  );

  const instrumentedIo = (
    <SettingsSection
      title="Instrumented application I/O"
      icon={sectionIcon("database")}
      headerAction={
        <Text size="3xs" color={alpha(theme.mutedForeground, 0.55)}>
          Logical bytes by operation
        </Text>
      }
    >
      <TelemetryCard>
        <div style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: alpha(mutedSurface(theme), 0.15) }}>
          <Text size="2xs" color={theme.mutedForeground} style={{ lineHeight: 17.875 }}>
            Native counters identify which process is reading or writing. These application-level counters identify known T3 operations so process
            spikes can be correlated with specific persistence and logging paths.
          </Text>
        </div>
        <AttributionTable entries={snapshot?.attribution.entries ?? []} />
      </TelemetryCard>
    </SettingsSection>
  );

  return [
    { key: "telemetry:monitor", node: resourceMonitor },
    { key: "telemetry:host", node: hostAndCollection },
    { key: "telemetry:timeline", node: resourceTimeline },
    { key: "telemetry:tree", node: liveProcessTree },
    { key: "telemetry:io", node: instrumentedIo },
  ];
}
