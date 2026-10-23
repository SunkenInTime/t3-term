// Small pieces shared by timeline rows: TimelineRowParts.tsx, TimelineSystemDivider.tsx,
// DiffStatLabel.tsx and MessageCopyButton.tsx from apps/web/src/components/chat.
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../web/timestampFormat.ts";
import { nowSecondAtom } from "../../sidebar/clock.ts";
import { copyTextToClipboard } from "./system.ts";

/**
 * Hover-reveal state: gpuix has no group-hover, so rows track the pointer
 * themselves. A child that paints a fill takes the hover from its parent, so
 * spread the handlers on such children too; the count keeps the row hovered
 * while the pointer moves between them.
 */
export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hovered, setHovered] = useState(false);
  const handlers = useRef<{ count: number; onMouseEnter: () => void; onMouseLeave: () => void } | null>(null);
  if (handlers.current === null) {
    const state = {
      count: 0,
      onMouseEnter: () => {
        state.count += 1;
        setHovered(true);
      },
      onMouseLeave: () => {
        state.count = Math.max(0, state.count - 1);
        if (state.count === 0) setHovered(false);
      },
    };
    handlers.current = state;
  }
  const { onMouseEnter, onMouseLeave } = handlers.current;
  return [hovered, { onMouseEnter, onMouseLeave }];
}

/** TimelineRowTimestamp: 12px muted, shown while the row is hovered (or always). */
export function TimelineRowTimestamp({
  createdAt,
  timestampFormat,
  visible = true,
}: {
  createdAt: string;
  timestampFormat: TimestampFormat;
  visible?: boolean;
}) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <Tooltip content={formatChatTimestampTooltip(createdAt, timestampFormat)} side="top">
      <div style={{ display: "flex", flexShrink: 0, marginRight: 4 }}>
        <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
          {formatDayAwareTimestamp(createdAt, timestampFormat)}
        </Text>
      </div>
    </Tooltip>
  );
}

/** TimelineSystemDivider: hairlines either side of an 11px label pill. */
export function TimelineSystemDivider({
  label,
  detail,
  tone = "neutral",
  icon,
  showDetailSeparator = true,
  actionLabel,
  onAction,
}: {
  label: string;
  detail?: ReactNode;
  tone?: "neutral" | "danger";
  icon?: IconName;
  showDetailSeparator?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  const color = tone === "danger" ? theme.errorForeground : theme.mutedForeground;
  const line = <div style={{ height: 1, flexGrow: 1, flexBasis: 0, backgroundColor: alpha(theme.border, 0.7) }} />;
  const content = (
    <>
      {icon ? <Icon name={icon} size={12} color={color} /> : null}
      <Text size="2xs" weight={500} color={color} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      {detail ? (
        typeof detail === "string" ? (
          <Text size="2xs" color={alpha(color, 0.7)} truncate style={{ maxWidth: 320 }}>
            {showDetailSeparator ? `· ${detail}` : detail}
          </Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minWidth: 0, opacity: 0.7 }}>
            {showDetailSeparator ? <Text size="2xs" color={color}>{"· "}</Text> : null}
            {detail}
          </div>
        )
      ) : null}
    </>
  );
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, paddingTop: 8, paddingBottom: 8 }}>
      {line}
      {onAction ? (
        <Tooltip content={actionLabel ?? label} side="top">
          <div
            onClick={onAction}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 4,
              paddingBottom: 4,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: alpha(theme.border, 0.7),
              backgroundColor: theme.background,
              cursor: "pointer",
              hover: { backgroundColor: theme.accent },
            }}
          >
            {content}
          </div>
        </Tooltip>
      ) : (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}>
          {content}
        </div>
      )}
      {line}
    </div>
  );
}

export function hasNonZeroStat(stat: { additions: number; deletions: number }): boolean {
  return stat.additions > 0 || stat.deletions > 0;
}

function formatCompactDiffCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  const m = value / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}m`;
}

/** DiffStatLabel: mono "+N" / "-N" in the diff colors. `aligned` gives each a 4ch column. */
export function DiffStatLabel({
  additions,
  deletions,
  fontSize = 10,
  layout = "aligned",
}: {
  additions: number;
  deletions: number;
  fontSize?: number;
  layout?: "aligned" | "inline";
}) {
  const theme = useTheme();
  const lineHeight = Math.round(fontSize * 1.4);
  const cell = (text: string, color: string) => (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: layout === "aligned" ? "flex-end" : "flex-start", width: layout === "aligned" ? Math.ceil(fontSize * 0.62 * 4) : undefined, flexShrink: 0 }}>
      <text style={{ color, fontSize, lineHeight, fontFamily: FONTS.mono, whiteSpace: "nowrap" }}>{text}</text>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: layout === "aligned" ? 8 : 4, flexShrink: 0 }}>
      {cell(`+${formatCompactDiffCount(additions)}`, theme.diffAdd)}
      {cell(`-${formatCompactDiffCount(deletions)}`, theme.diffDel)}
    </div>
  );
}

/** A 24px-tall ghost button holding only a 12px icon, like web's Button size="xs". */
export function MicroIconButton({
  icon,
  label,
  onClick,
  disabled,
  color,
  testId,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color?: string;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={label} side="top">
      <div
        testId={testId}
        onClick={disabled ? undefined : onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 24,
          paddingLeft: 7,
          paddingRight: 7,
          borderRadius: RADIUS.md,
          opacity: disabled ? 0.64 : 1,
          cursor: disabled ? "default" : "pointer",
          flexShrink: 0,
          ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
        }}
      >
        <Icon name={icon} size={12} color={color ?? theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}

/** MessageCopyButton: copies through the OS clipboard; the icon turns into a check for 2s. */
export const MessageCopyButton = memo(function MessageCopyButton({
  text,
  label = "Copy message",
  icon = "copy",
  testId,
}: {
  text: string;
  label?: string;
  icon?: IconName;
  testId?: string;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <MicroIconButton
      icon={copied ? "check" : icon}
      label={copied ? "Copied" : label}
      color={copied ? theme.primary : undefined}
      disabled={copied}
      testId={testId}
      onClick={() => {
        copyTextToClipboard(text).then(
          () => setCopied(true),
          (error: unknown) =>
            toast({
              type: "error",
              title: "Could not copy",
              description: error instanceof Error ? error.message : "The clipboard is unavailable.",
            }),
        );
      }}
    />
  );
});

/**
 * Ticks once a second while active; elapsed-time labels read the returned clock.
 * Every label shares the sidebar's second tick, aligned to the wall clock, so a
 * working thread repaints once a second instead of once per label timer.
 */
export function useNowEverySecond(active = true): number {
  const [mountedAt] = useState(() => Date.now());
  const now = useAtomValue(active ? nowSecondAtom : IDLE_CLOCK_ATOM);
  return active ? now : mountedAt;
}

const IDLE_CLOCK_ATOM = Atom.make(0);
