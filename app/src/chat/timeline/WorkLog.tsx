// apps/web/src/components/chat/WorkLog.tsx: the line layout every tool row uses.
// A line is min 24px, gap 6; a 24px icon slot, a 14px label in the secondary
// label color, then trailing meta. Rows are padded 2px and rounded 8.
import { createContext, use, type ReactNode } from "react";

import type { Style } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, useTheme } from "../../ui/theme.ts";

const GroupedRows = createContext(false);

/** Groups may span virtualized rows. Each part owns its trailing space. */
export function WorkLogBlock({
  layout = "standalone",
  continues = false,
  children,
}: {
  layout?: "standalone" | "group-header" | "group-content";
  continues?: boolean | undefined;
  children: ReactNode;
}) {
  const paddingBottom = continues || layout === "group-header" ? 0 : layout === "group-content" ? 4 : 8;
  return <div style={{ display: "flex", flexDirection: "column", paddingBottom }}>{children}</div>;
}

export function WorkLogList({ children }: { children: ReactNode }) {
  return (
    <GroupedRows value>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>{children}</div>
    </GroupedRows>
  );
}

/** The 14px / 22.75 label text inside a work-log line. */
export function WorkLogText({
  children,
  color,
  weight,
  wrap = false,
  style,
}: {
  children: ReactNode;
  color?: string;
  weight?: number;
  wrap?: boolean;
  style?: Style;
}) {
  const theme = useTheme();
  return (
    <text
      style={{
        color: color ?? theme.mutedForeground,
        fontSize: 14,
        lineHeight: 23,
        fontFamily: FONTS.sans,
        ...(weight === undefined ? {} : { fontWeight: weight }),
        ...(wrap ? {} : { whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }),
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </text>
  );
}

export interface WorkLogRowProps {
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  wrapLabel?: boolean;
  children?: ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  testId?: string;
}

/** WorkLogRow / WorkLogButton: one line plus optional disclosure content. */
export function WorkLogRow({
  icon,
  label,
  trailing,
  wrapLabel = false,
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  testId,
}: WorkLogRowProps) {
  const grouped = use(GroupedRows);
  return (
    <div
      testId={testId}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minWidth: 0,
        borderRadius: RADIUS.md,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: grouped ? 0 : 2,
        paddingBottom: grouped ? 0 : 2,
      }}
    >
      {/* The click target is the line only, so selecting text in the details never toggles. */}
      <div
        onClick={onClick}
        style={{
          ...(onClick ? { cursor: "pointer" } : {}),
          display: "flex",
          flexDirection: "row",
          alignItems: wrapLabel ? "flex-start" : "center",
          gap: 6,
          minHeight: 24,
          minWidth: 0,
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: wrapLabel ? "flex-start" : "center", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          {icon ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, flexShrink: 0 }}>
              {icon}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexGrow: 1, flexBasis: 0, minWidth: 0, overflow: "hidden" }}>
            {typeof label === "string" ? <WorkLogText wrap={wrapLabel}>{label}</WorkLogText> : label}
          </div>
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}

/**
 * WorkLogDetails. Web scrolls text details inside a max-h-96 box; gpuix has
 * one vertical scroller per region, so callers cap their content instead.
 */
export function WorkLogDetails({ children, kind = "text" }: { children: ReactNode; kind?: "text" | "panel" | "media" }) {
  const style: Style =
    kind === "text"
      ? { marginLeft: 28, display: "flex", flexDirection: "column", gap: 12, paddingLeft: 2, paddingRight: 2, paddingTop: 4, paddingBottom: 4 }
      : kind === "panel"
        ? { marginTop: 2, marginBottom: 6, paddingBottom: 8, display: "flex", flexDirection: "column" }
        : { marginTop: 4, display: "flex", flexDirection: "column" };
  return <div style={{ ...style, cursor: "default", userSelect: "auto" }}>{children}</div>;
}
