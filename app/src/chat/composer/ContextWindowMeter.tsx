// apps/web/src/components/chat/ContextWindowMeter.tsx: a 20px usage ring in a 28px ghost
// button; hovering opens the usage card (tokens, cost, auto-compaction note, Compact).
import { useState } from "react";

import { Popover } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import {
  formatContextWindowCompactionMessage,
  formatContextWindowCost,
} from "../../web/components/chat/ContextWindowMeter.logic.ts";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "../../web/lib/contextWindow.ts";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < 10) return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(value)}%`;
}

const RADIUS_RING = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS_RING;

function ringSource(dashOffset: number | null): string {
  // Rotated -90° so the arc starts at 12 o'clock, like the web's `-rotate-90` svg.
  const arc =
    dashOffset === null
      ? `<circle cx="12" cy="12" r="${RADIUS_RING}" fill="none" stroke="currentColor" stroke-width="3"/>`
      : `<circle cx="12" cy="12" r="${RADIUS_RING}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="${CIRCUMFERENCE}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 12 12)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${arc}</svg>`;
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  modelDisplayName?: string | null;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { usage, modelDisplayName, onCompact, compactDisabled, compactDisabledReason } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalized = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const dashOffset = CIRCUMFERENCE * (1 - normalized / 100);
  const usageColor = normalized > 90 ? theme.error : alpha(theme.mutedForeground, 0.72);
  const totalProcessed = usage.totalProcessedTokens ?? null;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="end"
      sideOffset={6}
      testId="composer-context-window-card"
      style={{ width: 240, padding: 12, gap: 8 }}
      trigger={
        <div
          testId="composer-context-window-meter"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => {
            if (!onCompact) setOpen(false);
          }}
          onClick={() => setOpen(!open)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            flexShrink: 0,
            cursor: "pointer",
            hover: { backgroundColor: theme.accent },
          }}
        >
          <div style={{ position: "relative", width: 20, height: 20, pointerEvents: "none" }}>
            <svg
              source={ringSource(null)}
              style={{ position: "absolute", top: 0, left: 0, width: 20, height: 20, color: alpha(theme.mutedForeground, 0.24) }}
            />
            <svg
              source={ringSource(dashOffset)}
              style={{ position: "absolute", top: 0, left: 0, width: 20, height: 20, color: usageColor }}
            />
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          Context Window
        </Text>
        <Text size="2xs" color={theme.mutedForeground}>
          {usage.maxTokens !== null && usedPercentage
            ? `${usedPercentage} · ${formatContextWindowTokens(usage.usedTokens)}/${formatContextWindowTokens(usage.maxTokens ?? null)}`
            : formatContextWindowTokens(usage.usedTokens)}
        </Text>
      </div>
      {usage.maxTokens !== null ? (
        <div style={{ height: 6, borderRadius: 3, backgroundColor: alpha(theme.muted, 0.6), overflow: "hidden" }}>
          <div style={{ height: 6, width: Math.round((216 * normalized) / 100), borderRadius: 3, backgroundColor: usageColor }} />
        </div>
      ) : null}
      {totalProcessed !== null && totalProcessed > 0 ? (
        <Row label="Total processed" value={formatContextWindowTokens(totalProcessed)} />
      ) : null}
      {usage.cost != null ? <Row label="Cost" value={formatContextWindowCost(usage.cost)} /> : null}
      {usage.compactsAutomatically ? (
        <Text size="2xs" weight={500} color={theme.mutedForeground}>
          {formatContextWindowCompactionMessage(modelDisplayName, usage.autoCompactThreshold)}
        </Text>
      ) : null}
      {onCompact ? (
        <>
          <Button
            size="xs"
            variant="outline"
            icon="minimize-2"
            disabled={compactDisabled}
            onClick={() => {
              setOpen(false);
              onCompact();
            }}
            style={{ marginTop: 4, width: "100%" }}
            testId="composer-compact-context"
          >
            Compact context
          </Button>
          {compactDisabled && compactDisabledReason ? (
            <Text size="2xs" color={theme.mutedForeground}>
              {compactDisabledReason}
            </Text>
          ) : null}
        </>
      ) : null}
    </Popover>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text size="2xs" color={theme.mutedForeground}>
        {label}
      </Text>
      <Text size="2xs" weight={500} color={theme.mutedForeground}>
        {value}
      </Text>
    </div>
  );
}

export function ContextWindowMeterPlaceholder() {
  return <div style={{ width: 28, height: 28, flexShrink: 0 }} />;
}
