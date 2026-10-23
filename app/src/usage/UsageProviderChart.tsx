// Port of apps/web/src/components/usage/UsageProviderChart.tsx.
// gpuix has no chart primitive: the grid, areas and lines are one generated SVG
// rasterized by <img> at the plot's pixel size (gpuix's <svg> is single-color,
// <img> keeps per-path color and opacity). The hover rule and tooltip are divs.
import type { UsageProviderKind } from "@t3tools/contracts";
import { createContext, useContext, useMemo, useRef, useState } from "react";

import type { DailyTotals, HourlyTotals } from "@t3tools/shared/usageMerge";
import {
  formatDayShort,
  formatHourShort,
  formatRelativeHourShort,
  formatTokens,
  formatUsd,
} from "@t3tools/shared/usageFormat";
import {
  buildChart,
  plotTop,
  valueToY,
  type ChartSize,
  type DayColumn,
  type UsageChartMetric,
} from "../web/components/usage/usageChart.ts";
import { PROVIDER_PRESENTATION } from "../web/components/usage/usageProviders.ts";
import { Text } from "../ui/primitives.tsx";
import { alpha, useTheme } from "../ui/theme.ts";
import { ProviderGlyph } from "./ProviderMark.tsx";
import { resolveUsageColor } from "./usageUi.tsx";

const PLOT_HEIGHT = 224;
const NONE_LOADING: ReadonlySet<UsageProviderKind> = new Set();

/**
 * The page scroller's current offset. onLayout reports a window position only
 * when the size changes, so the chart corrects it by how far the page scrolled since.
 */
export const UsageScrollContext = createContext<{ current: number }>({ current: 0 });

interface UsageProviderChartProps {
  readonly providers: readonly UsageProviderKind[];
  readonly loadingProviders?: ReadonlySet<UsageProviderKind>;
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly hours: readonly string[];
  readonly hourly: readonly HourlyTotals[];
  readonly metric: UsageChartMetric;
  readonly referenceTime: string | undefined;
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
  readonly hour12: boolean;
  readonly testId?: string;
}

function svgPaint(color: string): { readonly hex: string; readonly opacity: number } {
  const opacity = color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) / 255 : 1;
  return { hex: color.slice(0, 7), opacity };
}

function chartImage(
  size: ChartSize,
  gridYs: readonly number[],
  gridColor: string,
  series: ReadonlyArray<{ readonly color: string; readonly loading: boolean; readonly line: string; readonly area: string }>,
): string {
  const grid = svgPaint(gridColor);
  const parts: string[] = [];
  for (const y of gridYs) {
    const snapped = Math.min(size.height - 0.5, Math.round(y) + 0.5);
    parts.push(
      `<line x1="0" x2="${size.width}" y1="${snapped}" y2="${snapped}" stroke="${grid.hex}" stroke-opacity="${grid.opacity.toFixed(3)}" stroke-width="1"/>`,
    );
  }
  for (const entry of series) {
    if (entry.area === "") continue;
    parts.push(
      `<path d="${entry.area}" fill="${entry.color}" fill-opacity="${(0.12 * (entry.loading ? 0.4 : 1)).toFixed(3)}"/>`,
    );
  }
  for (const entry of series) {
    if (entry.line === "") continue;
    parts.push(
      `<path d="${entry.line}" fill="none" stroke="${entry.color}" stroke-opacity="${entry.loading ? 0.4 : 1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" overflow="visible">${parts.join("")}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function UsageChartTooltip({
  label,
  column,
  providers,
  loadingProviders,
  format,
  left,
  top,
  onSize,
}: {
  readonly label: string;
  readonly column: DayColumn | undefined;
  readonly providers: readonly UsageProviderKind[];
  readonly loadingProviders: ReadonlySet<UsageProviderKind>;
  readonly format: (value: number) => string;
  readonly left: number;
  readonly top: number;
  readonly onSize: (size: ChartSize) => void;
}) {
  const theme = useTheme();
  const partial = providers.some((provider) => loadingProviders.has(provider));
  return (
    <div
      onLayout={(event) => onSize({ width: event.width ?? 0, height: event.height ?? 0 })}
      style={{
        position: "absolute",
        left,
        top,
        display: "flex",
        flexDirection: "column",
        minWidth: 144,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.5),
        backgroundColor: theme.appearance === "dark" ? "#141414f5" : "#fffffff5",
        boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 15, spreadRadius: -3, color: "#00000040" },
        pointerEvents: "none",
      }}
    >
      <div style={{ marginBottom: 4 }}>
        <Text size="xs" color={theme.mutedForeground}>
          {label}
        </Text>
      </div>
      {providers.map((provider) => {
        const { label: providerLabel, driverKind } = PROVIDER_PRESENTATION[provider];
        return (
          <div
            key={provider}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}
          >
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
              <ProviderGlyph driver={driverKind} displayName={providerLabel} size={12} />
              <Text size="xs" color={theme.mutedForeground}>
                {providerLabel}
              </Text>
            </div>
            <Text size="xs" color={loadingProviders.has(provider) ? theme.mutedForeground : theme.foreground}>
              {format(column?.bands.find((band) => band.provider === provider)?.value ?? 0)}
            </Text>
          </div>
        );
      })}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 4,
          paddingTop: 4,
          borderTopWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Text size="xs" color={theme.mutedForeground}>
          Total
        </Text>
        <div>
          <Text size="xs" color={partial ? theme.mutedForeground : theme.foreground}>
            {format(column?.total ?? 0)}
          </Text>
        </div>
      </div>
    </div>
  );
}

export function UsageProviderChart({
  providers,
  loadingProviders = NONE_LOADING,
  days,
  daily,
  hours,
  hourly,
  metric,
  referenceTime,
  resolution,
  timeZone,
  hour12,
  testId,
}: UsageProviderChartProps) {
  const theme = useTheme();
  const scroll = useContext(UsageScrollContext);
  const [plot, setPlot] = useState<{ width: number; x: number; y: number; scroll: number } | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [tooltipSize, setTooltipSize] = useState<ChartSize>({ width: 160, height: 80 });
  const plotRef = useRef(plot);
  plotRef.current = plot;

  const periods = resolution === "hour" ? hours : days;
  const totals: readonly (DailyTotals | HourlyTotals)[] = resolution === "hour" ? hourly : daily;
  const size: ChartSize = { width: Math.max(1, Math.round(plot?.width ?? 0)), height: PLOT_HEIGHT };
  const { columns, scale, paths, stepX } = useMemo(() => {
    const byPeriod = new Map(
      totals.map((entry) => ["hourStart" in entry ? entry.hourStart : entry.day, entry] as const),
    );
    return buildChart(periods, byPeriod, metric, providers, loadingProviders, size);
  }, [periods, totals, metric, providers, loadingProviders, size.width]);

  const toY = (value: number) => valueToY(value, scale.max, size);
  const format = metric === "tokens" ? formatTokens : formatUsd;
  const formatPeriod = (period: string) =>
    resolution === "hour" ? formatHourShort(period, timeZone, hour12) : formatDayShort(period);
  const formatTooltipPeriod = (period: string) =>
    resolution === "hour" && referenceTime !== undefined
      ? formatRelativeHourShort(period, referenceTime, timeZone, hour12)
      : formatPeriod(period);

  const image = useMemo(
    () =>
      plot === null
        ? null
        : chartImage(
            size,
            scale.ticks.map((tick) => toY(tick)),
            theme.border,
            paths.map((path) => ({
              color: resolveUsageColor(PROVIDER_PRESENTATION[path.provider].color, theme),
              loading: path.loading,
              line: path.line,
              area: path.area,
            })),
          ),
    [paths, scale, size.width, theme],
  );

  const handleMove = (event: { x?: number; y?: number }) => {
    const current = plotRef.current;
    if (current === null || periods.length === 0 || current.width === 0) return;
    const originY = current.y + (scroll.current - current.scroll);
    const localX = Math.min(current.width, Math.max(0, (event.x ?? 0) - current.x));
    const localY = Math.min(PLOT_HEIGHT, Math.max(0, (event.y ?? 0) - originY));
    const index = Math.round((localX / current.width) * (periods.length - 1));
    setHover({ index: Math.min(periods.length - 1, Math.max(0, index)), x: localX, y: localY });
  };

  const hoveredPeriod = hover === null ? undefined : periods[hover.index];
  const plotWidth = plot?.width ?? 0;
  const gap = 12;
  const tooltipLeft =
    hover === null
      ? 0
      : Math.min(
          Math.max(0, hover.x + gap + tooltipSize.width <= plotWidth ? hover.x + gap : hover.x - gap - tooltipSize.width),
          Math.max(0, plotWidth - tooltipSize.width),
        );
  const tooltipTop =
    hover === null
      ? 0
      : Math.min(
          Math.max(0, hover.y + gap + tooltipSize.height <= PLOT_HEIGHT ? hover.y + gap : hover.y - gap - tooltipSize.height),
          Math.max(0, PLOT_HEIGHT - tooltipSize.height),
        );
  const ruleX = hover === null ? 0 : Math.round(hover.index * stepX);

  const middle = periods[Math.floor(periods.length / 2)];
  const last = periods[periods.length - 1];
  return (
    <div testId={testId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
        <div style={{ position: "relative", width: 56, height: PLOT_HEIGHT, flexShrink: 0 }}>
          {scale.labeled
            ? scale.ticks.map((tick) => (
                <div
                  key={tick}
                  style={{ position: "absolute", right: 0, top: toY(tick) - 7, display: "flex", flexDirection: "row" }}
                >
                  <Text size="3xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
                    {tick === 0 ? "0" : format(tick)}
                  </Text>
                </div>
              ))
            : null}
        </div>
        <div
          onLayout={(event) =>
            setPlot({ width: event.width ?? 0, x: event.x ?? 0, y: event.y ?? 0, scroll: scroll.current })
          }
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          style={{ position: "relative", flexGrow: 1, minWidth: 0, height: PLOT_HEIGHT }}
        >
          {image === null ? null : (
            <img src={image} style={{ position: "absolute", left: 0, top: 0, width: size.width, height: PLOT_HEIGHT }} />
          )}
          {hover === null ? null : (
            <div
              style={{
                position: "absolute",
                left: ruleX,
                top: plotTop(size),
                width: 1,
                height: PLOT_HEIGHT - plotTop(size),
                backgroundColor: theme.mutedForeground,
                pointerEvents: "none",
              }}
            />
          )}
          {hover === null || hoveredPeriod === undefined ? null : (
            <UsageChartTooltip
              label={formatTooltipPeriod(hoveredPeriod)}
              column={columns[hover.index]}
              providers={providers}
              loadingProviders={loadingProviders}
              format={format}
              left={tooltipLeft}
              top={tooltipTop}
              onSize={setTooltipSize}
            />
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", paddingLeft: 64 }}>
        {[periods[0], middle, last].map((period, index) => (
          <div key={index}>
            <Text size="3xs" color={theme.mutedForeground}>
              {period === undefined ? "" : formatPeriod(period).toUpperCase()}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}
