// Row primitives for the thread details card, after
// apps/web/src/components/chat/{threadDetailsPanelStyles.ts,ThreadDetailsControl.tsx,ThreadDetailsSection.tsx}.
// Rows are 32 tall, radius 10, 13px medium text at 80%, a white 8% hover wash.
import type { EventPayload } from "@gpuix/native";
import { useState, type ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import type { Style } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

export const DETAILS_ROW_HEIGHT = 32;

export function useDetailsTokens() {
  const theme = useTheme();
  return {
    theme,
    hover: theme.appearance === "dark" ? alpha("#ffffff", 0.08) : alpha("#000000", 0.035),
    pressed: theme.appearance === "dark" ? alpha("#ffffff", 0.055) : alpha("#000000", 0.035),
    label: alpha(theme.foreground, 0.8),
    separator: alpha(theme.border, 0.65),
  };
}

export function DetailsLabel({
  children,
  color,
  grow = true,
  weight = 500,
  size = 13,
}: {
  children: ReactNode;
  color?: string;
  grow?: boolean;
  weight?: number;
  size?: number;
}) {
  const { label } = useDetailsTokens();
  return (
    <text
      style={{
        color: color ?? label,
        fontSize: size,
        lineHeight: 18,
        fontWeight: weight,
        fontFamily: FONTS.sans,
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        overflow: "hidden",
        minWidth: 0,
        ...(grow ? { flexGrow: 1, flexShrink: 1 } : { flexShrink: 1 }),
      }}
    >
      {children}
    </text>
  );
}

export function DetailsIcon({ name, color }: { name: IconName; color?: string }) {
  const theme = useTheme();
  return <Icon name={name} size={16} color={color ?? theme.mutedForeground} />;
}

/** THREAD_DETAILS_PANEL_ROW_CLASS: a full-width row button. */
export function DetailsRow({
  children,
  onClick,
  onRightClick,
  disabled,
  testId,
  style,
  multiline,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  onRightClick?: (position: { x: number; y: number }) => void;
  disabled?: boolean;
  testId?: string;
  style?: Style;
  multiline?: boolean;
  active?: boolean;
}) {
  const { hover } = useDetailsTokens();
  const interactive = !disabled && onClick !== undefined;
  return (
    <div
      testId={testId}
      onClick={interactive ? onClick : undefined}
      onAuxClick={
        onRightClick
          ? (event: EventPayload) => {
              if (event.isRightClick) onRightClick({ x: event.x ?? 0, y: event.y ?? 0 });
            }
          : undefined
      }
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: multiline ? "flex-start" : "center",
        gap: 10,
        ...(multiline ? { minHeight: DETAILS_ROW_HEIGHT, paddingTop: 7, paddingBottom: 7 } : { height: DETAILS_ROW_HEIGHT }),
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.lg,
        width: "100%",
        minWidth: 0,
        flexShrink: 0,
        opacity: disabled ? 0.64 : 1,
        cursor: interactive ? "pointer" : "default",
        backgroundColor: active ? hover : "#00000000",
        ...(interactive ? { hover: { backgroundColor: hover } } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS: a primary action and a 32px chevron
 * that opens a menu, separated by a 16px rule. The whole group washes on hover
 * and each half adds its own wash, like the web control.
 */
export function DetailsSplit({
  primary,
  onPrimary,
  primaryDisabled,
  secondary,
  menuOpen,
  onToggleMenu,
  secondaryDisabled,
  trailing,
  testId,
  busy,
  multiline,
}: {
  primary: ReactNode;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  /** Replaces the chevron (for example the elapsed time while an action runs). */
  secondary?: ReactNode;
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  secondaryDisabled?: boolean;
  trailing?: ReactNode;
  testId?: string;
  busy?: boolean;
  multiline?: boolean;
}) {
  const { hover, pressed, separator, theme } = useDetailsTokens();
  const [groupHover, setGroupHover] = useState(false);
  const primaryInteractive = !primaryDisabled && onPrimary !== undefined;
  const secondaryInteractive = !secondaryDisabled && onToggleMenu !== undefined;
  return (
    <div
      testId={testId}
      onMouseEnter={() => setGroupHover(true)}
      onMouseLeave={() => setGroupHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: multiline ? "flex-start" : "center",
        width: "100%",
        minWidth: 0,
        flexShrink: 0,
        borderRadius: RADIUS.lg,
        backgroundColor: busy ? pressed : groupHover || menuOpen ? hover : "#00000000",
      }}
    >
      <div
        testId={testId ? `${testId}-primary` : undefined}
        onClick={primaryInteractive ? onPrimary : undefined}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          gap: 10,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          ...(multiline ? { minHeight: DETAILS_ROW_HEIGHT, paddingTop: 7, paddingBottom: 7 } : { height: DETAILS_ROW_HEIGHT }),
          paddingLeft: 10,
          paddingRight: 10,
          borderTopLeftRadius: RADIUS.lg,
          borderBottomLeftRadius: RADIUS.lg,
          opacity: primaryDisabled && !busy ? 0.64 : 1,
          cursor: primaryInteractive ? "pointer" : "default",
          ...(primaryInteractive ? { hover: { backgroundColor: hover } } : {}),
        }}
      >
        {primary}
      </div>
      {secondary !== undefined ? (
        secondary
      ) : (
        <>
          <div style={{ width: 1, height: 16, backgroundColor: separator, flexShrink: 0, alignSelf: "center" }} />
          <div
            testId={testId ? `${testId}-menu-trigger` : undefined}
            onClick={secondaryInteractive ? onToggleMenu : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: DETAILS_ROW_HEIGHT,
              flexShrink: 0,
              borderTopRightRadius: RADIUS.lg,
              borderBottomRightRadius: RADIUS.lg,
              opacity: secondaryDisabled ? 0.64 : 1,
              cursor: secondaryInteractive ? "pointer" : "default",
              backgroundColor: menuOpen ? hover : "#00000000",
              ...(secondaryInteractive ? { hover: { backgroundColor: hover } } : {}),
            }}
          >
            <Icon name="chevron-down" size={16} color={theme.mutedForeground} />
          </div>
        </>
      )}
      {trailing}
    </div>
  );
}

/**
 * THREAD_DETAILS_PANEL_SELECT_ROW_CLASS: a label half and a chevron half that
 * both open the same menu, with a 16px rule between them.
 */
export function DetailsSelectRow({
  children,
  open,
  onToggle,
  disabled,
  testId,
  onRightClick,
}: {
  children: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  testId?: string;
  onRightClick?: (position: { x: number; y: number }) => void;
}) {
  const { hover, separator, theme } = useDetailsTokens();
  const [rowHover, setRowHover] = useState(false);
  const interactive = !disabled && onToggle !== undefined;
  return (
    <div
      testId={testId}
      onClick={interactive ? onToggle : undefined}
      onAuxClick={
        onRightClick
          ? (event: EventPayload) => {
              if (event.isRightClick) onRightClick({ x: event.x ?? 0, y: event.y ?? 0 });
            }
          : undefined
      }
      onMouseEnter={() => setRowHover(true)}
      onMouseLeave={() => setRowHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: DETAILS_ROW_HEIGHT,
        width: "100%",
        minWidth: 0,
        flexShrink: 0,
        borderRadius: RADIUS.lg,
        opacity: disabled ? 0.64 : 1,
        cursor: interactive ? "pointer" : "default",
        backgroundColor: (rowHover && interactive) || open ? hover : "#00000000",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          height: "100%",
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          paddingLeft: 10,
          paddingRight: 10,
          borderTopLeftRadius: RADIUS.lg,
          borderBottomLeftRadius: RADIUS.lg,
          ...(interactive ? { hover: { backgroundColor: hover } } : {}),
        }}
      >
        {children}
      </div>
      <div style={{ width: 1, height: 16, backgroundColor: separator, flexShrink: 0 }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: "100%",
          flexShrink: 0,
          borderTopRightRadius: RADIUS.lg,
          borderBottomRightRadius: RADIUS.lg,
          ...(interactive ? { hover: { backgroundColor: hover } } : {}),
        }}
      >
        <Icon name="chevron-down" size={16} color={theme.mutedForeground} />
      </div>
    </div>
  );
}

/** ThreadDetailsSection: px 8, pt 8, pb 10, an optional top rule at border/65. */
export function DetailsSection({
  children,
  separated = true,
  title,
  actions,
  testId,
}: {
  children: ReactNode;
  separated?: boolean;
  /** Shown as an 11px muted heading row (min-h 32, px 6). */
  title?: string;
  actions?: ReactNode;
  testId?: string;
}) {
  const { separator, theme } = useDetailsTokens();
  return (
    <div
      testId={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 8,
        paddingBottom: 10,
        flexShrink: 0,
        ...(separated ? { borderTopWidth: 1, borderColor: separator } : {}),
      }}
    >
      {title ? (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            minHeight: 32,
            marginBottom: 4,
            paddingLeft: 6,
            paddingRight: 6,
          }}
        >
          <text
            style={{
              color: theme.mutedForeground,
              fontSize: 11,
              lineHeight: 16,
              fontWeight: 500,
              fontFamily: FONTS.sans,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {title}
          </text>
          {actions ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** THREAD_DETAILS_PANEL_ICON_ACTION_CLASS: a 24px ghost square. */
export function DetailsIconAction({
  icon,
  onClick,
  disabled,
  testId,
  color,
}: {
  icon: IconName;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  color?: string;
}) {
  const { hover, theme } = useDetailsTokens();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: hover } }),
      }}
    >
      <Icon name={icon} size={14} color={color ?? theme.mutedForeground} />
    </div>
  );
}

/** THREAD_DETAILS_PANEL_META_ACTION_CLASS: a 24px pill with 12px muted text. */
export function DetailsMetaAction({
  children,
  icon,
  onClick,
  testId,
}: {
  children: ReactNode;
  icon?: IconName;
  onClick?: () => void;
  testId?: string;
}) {
  const { hover, theme } = useDetailsTokens();
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 24,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        cursor: onClick ? "pointer" : "default",
        ...(onClick ? { hover: { backgroundColor: hover } } : {}),
      }}
    >
      {icon ? <Icon name={icon} size={14} color={theme.mutedForeground} /> : null}
      <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>
        {children}
      </text>
    </div>
  );
}
