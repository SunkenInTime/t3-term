// Ported from apps/web/src/components/Sidebar.snooze.ts. formatShortTimestamp and
// parseTimestampDate come from apps/web/src/timestampFormat.ts; only the two
// functions this file needs are inlined, since that module reads the Electron
// desktop bridge at load.
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  resolveSnoozePresets as resolveSharedSnoozePresets,
  snoozeWakeLabel,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";

export { snoozeWakeLabel, type SnoozePreset };

function parseTimestampDate(isoDate: string): Date | null {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

const formatterCache = new Map<TimestampFormat, Intl.DateTimeFormat>();

function formatShortTimestamp(isoDate: string, timestampFormat: TimestampFormat): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  let formatter = formatterCache.get(timestampFormat);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(timestampFormat === "locale" ? {} : { hour12: timestampFormat === "12-hour" }),
    });
    formatterCache.set(timestampFormat, formatter);
  }
  return formatter.format(date);
}

function timeOfDayLabel(date: Date, timestampFormat: TimestampFormat): string {
  return formatShortTimestamp(date.toISOString(), timestampFormat);
}

export function resolveSnoozePresets(
  now: Date,
  timestampFormat: TimestampFormat,
): ReadonlyArray<SnoozePreset> {
  return resolveSharedSnoozePresets(now).map((preset) => {
    const wake = parseTimestampDate(preset.snoozedUntil);
    if (wake === null) return preset;
    const time = timeOfDayLabel(wake, timestampFormat);
    return {
      ...preset,
      whenLabel:
        preset.id === "next-week"
          ? `${wake.toLocaleDateString(undefined, { weekday: "short" })} ${time}`
          : time,
    };
  });
}
