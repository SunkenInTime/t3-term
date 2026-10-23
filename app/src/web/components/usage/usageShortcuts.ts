// Ported from apps/web/src/components/usage/usageShortcuts.ts.
// `resolveUsageShortcut` reads DOM targets; t3-term's global dispatcher resolves
// keys and calls `handleUsageShortcutCommand` (app/src/usage/usageShortcuts.ts).
import type { KeybindingCommand } from "@t3tools/contracts";

import type { UsageChartMetric } from "./usageChart.ts";

export type UsageMetric = UsageChartMetric | "limits";
export const METRIC_OPTIONS = [
  { value: "cost", label: "Cost", command: "usage.cost" },
  { value: "tokens", label: "Tokens", command: "usage.tokens" },
  { value: "limits", label: "Limits", command: "usage.limits" },
] as const satisfies readonly { value: UsageMetric; label: string; command: KeybindingCommand }[];

export const WINDOW_OPTIONS = [
  { days: 1, label: "Past 24h", command: "usage.period.day" },
  { days: 7, label: "7 days", command: "usage.period.week" },
  { days: 30, label: "30 days", command: "usage.period.month" },
  { days: 90, label: "90 days", command: "usage.period.quarter" },
] as const;
