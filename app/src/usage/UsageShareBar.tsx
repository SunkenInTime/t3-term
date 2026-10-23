// Port of apps/web/src/components/usage/UsageShareBar.tsx.
import { formatPercent } from "@t3tools/shared/usageFormat";
import { useState, type ReactNode } from "react";

import type { ShareSegment } from "../web/components/usage/usageBreakdown.ts";
import { Text } from "../ui/primitives.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { useTheme } from "../ui/theme.ts";
import { resolveUsageColor } from "./usageUi.tsx";

const MIN_SEGMENT = 4;

/** CSS `flex: value 1 0; min-width: 4px`: grow by value, freezing segments at the minimum. */
function flexWidths(values: readonly number[], available: number): readonly number[] {
  const widths = values.map(() => 0);
  const frozen = new Set<number>();
  for (;;) {
    const free = available - frozen.size * MIN_SEGMENT;
    const growing = values.reduce((sum, value, index) => (frozen.has(index) ? sum : sum + value), 0);
    let changed = false;
    values.forEach((value, index) => {
      if (frozen.has(index)) return;
      const next = growing > 0 ? (value / growing) * free : 0;
      if (next < MIN_SEGMENT) {
        frozen.add(index);
        changed = true;
      }
      widths[index] = next;
    });
    if (!changed) break;
  }
  for (const index of frozen) widths[index] = MIN_SEGMENT;
  return widths;
}

export function UsageShareBar({
  label,
  segments,
  format,
  aside,
}: {
  readonly label: string;
  readonly segments: readonly ShareSegment[];
  readonly format: (value: number) => string;
  readonly aside?: ReactNode;
}) {
  const theme = useTheme();
  const visible = segments.filter((segment) => segment.value > 0);
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);
  const [width, setWidth] = useState(0);
  if (total <= 0) return null;
  const segmentWidths = flexWidths(
    visible.map((segment) => segment.value),
    Math.max(0, width - 2 * (visible.length - 1)),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <Text weight={500}>{label}</Text>
        {aside}
      </div>
      {/* Segment widths are computed from the measured bar: a Tooltip trigger
          wrapper does not pass `flex: value 1 0` through as web's does. */}
      <div onLayout={(event) => setWidth(event.width ?? 0)} style={{ display: "flex", flexDirection: "row", height: 8, gap: 2 }}>
        {visible.map((segment, index) => {
          const first = index === 0;
          const last = index === visible.length - 1;
          const width = segmentWidths[index] ?? 4;
          return (
            <Tooltip
              key={segment.label}
              side="top"
              content={`${segment.label} · ${format(segment.value)} · ${formatPercent(segment.value / total)}`}
            >
              <div
                style={{
                  width,
                  flexShrink: 0,
                  height: "100%",
                  backgroundColor: resolveUsageColor(segment.color, theme),
                  borderTopLeftRadius: first ? 4 : 2,
                  borderBottomLeftRadius: first ? 4 : 2,
                  borderTopRightRadius: last ? 4 : 2,
                  borderBottomRightRadius: last ? 4 : 2,
                }}
              />
            </Tooltip>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}>
        {visible.map((segment) => (
          <div key={segment.label} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: resolveUsageColor(segment.color, theme),
                flexShrink: 0,
              }}
            />
            <Text size="xs" color={theme.mutedForeground}>
              {segment.label}
            </Text>
            {/* Wrapped so it does not merge into the label's line and lose the gap. */}
            <div>
              <Text size="xs">{format(segment.value)}</Text>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SpeedPremium({ premiumUsd, format }: { readonly premiumUsd: number; readonly format: (value: number) => string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row" }}>
      {/* Adjacent texts paint as one line, like web's inline spans. */}
      <Text size="xs" color={theme.mutedForeground}>
        {"Premium "}
      </Text>
      <Text size="xs">{format(premiumUsd)}</Text>
    </div>
  );
}
