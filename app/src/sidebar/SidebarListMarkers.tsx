// apps/web/src/components/sidebar/SidebarListMarkers.tsx (SidebarSectionHeader)
// over ui/collapsible-section-header.tsx. Drag boundaries and drop
// placeholders are not ported: t3-term has no drag reordering yet.
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";

export function SidebarSectionHeader({
  shelf,
  label,
  expanded,
  onToggle,
}: {
  shelf: "working" | "snoozed" | "settled";
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  // tones.info: text-blue-400, line blue-400/15; tones.muted: sidebar-muted/60, border/60.
  const labelColor =
    shelf === "snoozed" ? theme.infoForeground : alpha(theme.sidebar.mutedForeground, 0.6);
  const lineColor =
    shelf === "snoozed" ? alpha(theme.infoForeground, 0.15) : alpha(theme.sidebar.border, 0.6);
  return (
    <div style={{ height: 32, marginLeft: 2, marginRight: 2, flexShrink: 0 }}>
      <div
        testId={`sidebar-${shelf}-shelf-toggle`}
        onClick={onToggle}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 32,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: RADIUS.md,
          cursor: "pointer",
        }}
      >
        <Text size="xs" weight={500} color={labelColor} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          {label}
        </Text>
        <div style={{ height: 1, minWidth: 8, flexGrow: 1, backgroundColor: lineColor }} />
        <Icon name={expanded ? "chevron-down" : "chevron-up"} size={12} color={labelColor} />
      </div>
    </div>
  );
}
