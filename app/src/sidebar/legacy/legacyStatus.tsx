// ThreadStatusIndicators.tsx ThreadStatusLabel for the legacy tree: a dot and a
// 10px label, or (compact) a 9px dot in a 14px box. Colours are the Tailwind v4
// shades the pill's colorClass / dotClass name (dark: `-300` at the given
// alpha; light: `-600` text, `-500` dot).
import { Tooltip } from "../../ui/overlay.tsx";
import { FONTS, type Palette, useTheme } from "../../ui/theme.ts";
import type { ThreadStatusPill } from "../../web/components/LegacySidebar.logic.ts";

/** Sidebar text tokens web reads through `text-secondary-label` and `text-icon-muted`. */
export function legacyTones(theme: Palette) {
  return {
    secondaryLabel: theme.mutedForeground,
    iconMuted: theme.mutedForeground,
  };
}

const DARK_TONES: Record<Exclude<ThreadStatusPill["label"], "Waiting">, string> = {
  "Pending Approval": "#ffd230e6",
  "Awaiting Input": "#a3b3ffe6",
  Working: "#74d4ffcc",
  Connecting: "#74d4ffcc",
  Failed: "#ffa2a2e6",
  "Plan Ready": "#c4b4ffe6",
  Completed: "#5ee9b5e6",
};

const LIGHT_TONES: Record<Exclude<ThreadStatusPill["label"], "Waiting">, { text: string; dot: string }> = {
  "Pending Approval": { text: "#e17100", dot: "#fe9a00" },
  "Awaiting Input": { text: "#4f39f6", dot: "#615fff" },
  Working: { text: "#0084d1", dot: "#00a6f4" },
  Connecting: { text: "#0084d1", dot: "#00a6f4" },
  Failed: { text: "#e7000b", dot: "#fb2c36" },
  "Plan Ready": { text: "#7f22fe", dot: "#8e51ff" },
  Completed: { text: "#009966", dot: "#00bc7d" },
};

export function statusColors(status: ThreadStatusPill, theme: Palette): { text: string; dot: string } {
  if (status.label === "Waiting") {
    return { text: theme.sidebar.mutedForeground, dot: theme.sidebar.mutedForeground };
  }
  if (theme.appearance === "dark") {
    const tone = DARK_TONES[status.label];
    return { text: tone, dot: tone };
  }
  return LIGHT_TONES[status.label];
}

export function StatusDot({ status, size }: { status: ThreadStatusPill; size: number }) {
  const theme = useTheme();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        flexShrink: 0,
        backgroundColor: statusColors(status, theme).dot,
        pointerEvents: "none",
      }}
    />
  );
}

export function ThreadStatusLabel({ status, compact = false }: { status: ThreadStatusPill; compact?: boolean }) {
  const theme = useTheme();
  const colors = statusColors(status, theme);
  if (compact) {
    return (
      <Tooltip content={status.label} side="top" rootStyle={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, flexShrink: 0 }}>
          <StatusDot status={status} size={9} />
        </div>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={status.label} side="top" rootStyle={{ flexShrink: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <StatusDot status={status} size={6} />
        <text style={{ color: colors.text, fontSize: 10, lineHeight: 14, fontFamily: FONTS.sans, whiteSpace: "nowrap" }}>
          {status.label}
        </text>
      </div>
    </Tooltip>
  );
}
