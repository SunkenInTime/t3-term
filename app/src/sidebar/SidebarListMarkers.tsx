// apps/web/src/components/sidebar/SidebarListMarkers.tsx over
// ui/collapsible-section-header.tsx: the shelf headers, plus the zero-height
// drag markers. While a row is dragged the Pinned/Active boundary labels and
// the empty-section drop placeholders appear in the room the drag projection
// makes for them (Sidebar.drag.ts); otherwise they take no space.
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";

/** collapsible-section-header.tsx `tones`. */
function headerTone(
  theme: ReturnType<typeof useTheme>,
  tone: "muted" | "info" | "emphasized" | "accent",
): { label: string; line: string } {
  switch (tone) {
    case "info":
      return { label: theme.infoForeground, line: alpha(theme.infoForeground, 0.15) };
    case "emphasized":
      return { label: alpha(theme.sidebar.foreground, 0.8), line: alpha(theme.sidebar.foreground, 0.25) };
    case "accent":
      return { label: theme.primary, line: alpha(theme.primary, 0.5) };
    default:
      return { label: alpha(theme.sidebar.mutedForeground, 0.6), line: alpha(theme.sidebar.border, 0.6) };
  }
}

export function SidebarSectionHeader({
  shelf,
  label,
  expanded,
  onToggle,
  dragging = false,
  isDropTarget = false,
}: {
  shelf: "working" | "snoozed" | "settled";
  label: string;
  expanded: boolean;
  onToggle: () => void;
  dragging?: boolean;
  isDropTarget?: boolean;
}) {
  const theme = useTheme();
  const tone = headerTone(
    theme,
    isDropTarget ? "accent" : dragging ? "emphasized" : shelf === "snoozed" ? "info" : "muted",
  );
  return (
    <div testId={`sidebar-${shelf}-header`} style={{ height: 32, marginLeft: 2, marginRight: 2, flexShrink: 0 }}>
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
        <Text size="xs" weight={500} color={tone.label} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          {label}
        </Text>
        <div style={{ height: 1, minWidth: 8, flexGrow: 1, backgroundColor: tone.line }} />
        <Icon name={expanded ? "chevron-down" : "chevron-up"} size={12} color={tone.label} />
      </div>
    </div>
  );
}

/** "Pinned" above the pins and "Active" under them, shown only during a drag. */
export function SidebarDragBoundary({
  marker,
  label,
  visible,
  isDropTarget,
}: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  isDropTarget: boolean;
}) {
  const theme = useTheme();
  return (
    <div testId={`sidebar-${marker}`} style={{ position: "relative", height: 0, marginLeft: 2, marginRight: 2, pointerEvents: "none" }}>
      {visible ? (
        // .sidebar-drag-boundary-label: absolute inset-x-2 top-1 h-4.
        <div
          style={{
            position: "absolute",
            left: 8,
            right: 8,
            top: 4,
            height: 16,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            pointerEvents: "none",
          }}
        >
          <Text
            size="xs"
            weight={500}
            color={isDropTarget ? theme.primary : alpha(theme.sidebar.foreground, 0.8)}
            style={{ flexShrink: 0, whiteSpace: "nowrap" }}
          >
            {label}
          </Text>
          <div
            style={{
              height: 1,
              flexGrow: 1,
              backgroundColor: isDropTarget ? alpha(theme.primary, 0.5) : alpha(theme.sidebar.foreground, 0.25),
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** A dashed slot naming an empty destination section while a row is dragged. */
export function SidebarSectionPlaceholder({
  marker,
  label,
  showHint,
  isDropTarget,
}: {
  marker: "active-placeholder" | "settled-placeholder";
  label: string;
  showHint: boolean;
  isDropTarget: boolean;
}) {
  const theme = useTheme();
  return (
    <div testId={`sidebar-${marker}`} style={{ position: "relative", height: 0, marginLeft: 2, marginRight: 2, pointerEvents: "none" }}>
      {showHint ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: isDropTarget ? alpha(theme.primary, 0.4) : alpha(theme.sidebar.foreground, 0.25),
            backgroundColor: isDropTarget ? alpha(theme.primary, 0.05) : "#00000000",
            pointerEvents: "none",
          }}
        >
          <Text size="xs" color={isDropTarget ? theme.primary : alpha(theme.sidebar.foreground, 0.8)}>
            {label}
          </Text>
        </div>
      ) : null}
    </div>
  );
}
