// Ported from the pure geometry in apps/web/src/components/usage/UsageProviderChart.tsx.
// Web draws into a fixed 960x260 viewBox stretched with preserveAspectRatio="none"
// and non-scaling strokes. t3-term rasterizes the SVG at the plot's pixel size, so
// the geometry takes that size (`ChartSize`) and keeps the web proportions.
import type { UsageProviderKind } from "@t3tools/contracts";

import type { DailyTotals, HourlyTotals } from "@t3tools/shared/usageMerge";
import { PROVIDER_ORDER } from "./usageProviders.ts";

export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = 260;
export const TICK_COUNT = 4;
const PLOT_TOP = 8;

export type UsageChartMetric = "tokens" | "cost";

export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

const VIEW_SIZE: ChartSize = { width: VIEW_WIDTH, height: VIEW_HEIGHT };

export interface DayColumn {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number;
  }[];
  readonly total: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function valueFor(
  totals: DailyTotals | HourlyTotals | undefined,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number {
  const entry = totals?.byProvider.get(provider);
  if (entry === undefined) return 0;
  return metric === "tokens" ? entry.totalTokens : entry.costUsd;
}

export function buildPeriodColumns(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return periods.map((period) => {
    const entry = byPeriod.get(period);
    const bands = PROVIDER_ORDER.map((provider) => ({
      provider,
      value: valueFor(entry, provider, metric),
    }));
    return { bands, total: bands.reduce((sum, band) => sum + band.value, 0) };
  });
}

function monotoneTangents(points: readonly Point[]): readonly number[] {
  const count = points.length;
  if (count < 2) return [0];

  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const dx = (points[index + 1]?.x ?? 0) - (points[index]?.x ?? 0);
    const dy = (points[index + 1]?.y ?? 0) - (points[index]?.y ?? 0);
    slopes.push(dx === 0 ? 0 : dy / dx);
  }

  const tangents: number[] = Array.from({ length: count }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[count - 1] = slopes[count - 2] ?? 0;
  for (let index = 1; index < count - 1; index += 1) {
    const previous = slopes[index - 1] ?? 0;
    const next = slopes[index] ?? 0;
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }

  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = (tangents[index] ?? 0) / slope;
    const b = (tangents[index + 1] ?? 0) / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }

  return tangents;
}

interface CurveSegment {
  readonly from: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
}

function smoothCurve(points: readonly Point[]): readonly CurveSegment[] {
  if (points.length < 2) return [];
  const tangents = monotoneTangents(points);
  const segments: CurveSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    segments.push({
      from,
      c1: { x: from.x + dx / 3, y: from.y + ((tangents[index] ?? 0) * dx) / 3 },
      c2: { x: to.x - dx / 3, y: to.y - ((tangents[index + 1] ?? 0) * dx) / 3 },
      to,
    });
  }
  return segments;
}

function curvePath(segments: readonly CurveSegment[]): string {
  const first = segments[0];
  if (first === undefined) return "";
  let path = `M${first.from.x.toFixed(2)},${first.from.y.toFixed(2)}`;
  for (const segment of segments) {
    path += ` C${segment.c1.x.toFixed(2)},${segment.c1.y.toFixed(2)} ${segment.c2.x.toFixed(2)},${segment.c2.y.toFixed(2)} ${segment.to.x.toFixed(2)},${segment.to.y.toFixed(2)}`;
  }
  return path;
}

function areaPath(line: string, size: ChartSize) {
  return line === "" ? "" : `${line} L${size.width},${size.height} L0,${size.height} Z`;
}

function niceScale(peak: number, count: number): { max: number; ticks: readonly number[] } {
  if (peak <= 0) return { max: 0, ticks: [0] };

  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { max, ticks };
}

const PLACEHOLDER_TICKS = Array.from({ length: TICK_COUNT + 1 }, (_, index) => index);

function chartScale(
  columns: readonly DayColumn[],
  loadingProviders: ReadonlySet<UsageProviderKind>,
) {
  // Not the sum: layered series each measure from zero, so a combined peak
  // would leave the plot permanently half empty.
  const peak = columns.reduce(
    (max, column) => column.bands.reduce((inner, band) => Math.max(inner, band.value), max),
    0,
  );
  return peak === 0 && loadingProviders.size > 0
    ? { max: TICK_COUNT, ticks: PLACEHOLDER_TICKS, labeled: false }
    : { ...niceScale(peak, TICK_COUNT), labeled: true };
}

// Leave room above the top gridline so the constant-width stroke is not
// clipped when a series reaches the peak.
export function valueToY(value: number, max: number, size: ChartSize = VIEW_SIZE) {
  const plotTop = (PLOT_TOP * size.height) / VIEW_HEIGHT;
  return max === 0 ? size.height : size.height - (value / max) * (size.height - plotTop);
}

export function plotTop(size: ChartSize = VIEW_SIZE) {
  return (PLOT_TOP * size.height) / VIEW_HEIGHT;
}

export function buildChart(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
  providers: readonly UsageProviderKind[],
  loadingProviders: ReadonlySet<UsageProviderKind>,
  size: ChartSize = VIEW_SIZE,
) {
  const columns = buildPeriodColumns(periods, byPeriod, metric);
  const scale = chartScale(columns, loadingProviders);
  const stepX = periods.length < 2 ? 0 : size.width / (periods.length - 1);
  const paths = providers.map((provider) => {
    const slot = PROVIDER_ORDER.indexOf(provider);
    const line = curvePath(
      smoothCurve(
        columns.map((column, periodIndex) => ({
          x: periodIndex * stepX,
          y: valueToY(column.bands[slot]?.value ?? 0, scale.max, size),
        })),
      ),
    );
    return {
      provider,
      loading: loadingProviders.has(provider),
      total: columns.reduce((sum, column) => sum + (column.bands[slot]?.value ?? 0), 0),
      line,
      area: areaPath(line, size),
    };
  });

  return { columns, scale, stepX, paths: paths.toSorted((a, b) => b.total - a.total) };
}
