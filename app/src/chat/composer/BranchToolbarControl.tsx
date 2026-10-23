// The context strip's xs control (apps/web/src/components/chat/ComposerControl.tsx size
// "xs" with ComposerContextLabel) and the menu rows its popups share
// (apps/web/src/components/ui/menu.tsx at the sizes BranchToolbar uses them).
import { useState, type ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import type { Style } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

/** h 24, px 7, gap 4, 12px muted/70; hover: accent bg, foreground/80 text; open: accent bg. */
export interface BranchToolbarControlIcon {
  readonly name: IconName;
  readonly opacity?: number;
}

export function BranchToolbarControl({
  icons,
  label,
  chevron = true,
  pressed,
  disabled,
  onClick,
  testId,
  style,
}: {
  icons: ReadonlyArray<BranchToolbarControlIcon>;
  label: string;
  chevron?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
  style?: Style;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const color = hovered && !disabled ? alpha(theme.foreground, 0.8) : alpha(theme.mutedForeground, 0.7);
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 24,
        flexShrink: 0,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        backgroundColor: pressed ? theme.accent : "#00000000",
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
        ...style,
      }}
    >
      {icons.length === 1 ? (
        <BranchToolbarIcon name={icons[0]!.name} color={color} opacity={icons[0]!.opacity} />
      ) : (
        // The environment + workspace pair: mx-0! on both, gap-0.5 between.
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
          {icons.map((icon) => (
            <BranchToolbarIcon key={icon.name} name={icon.name} color={color} opacity={icon.opacity} bleed={false} />
          ))}
        </div>
      )}
      <BranchToolbarLabel color={color}>{capLabel(label)}</BranchToolbarLabel>
      {chevron ? <BranchToolbarIcon name="chevron-down" color={color} opacity={0.5} /> : null}
    </div>
  );
}

/**
 * ComposerContextLabel. Web truncates it past 240px; here the caller caps the text instead
 * (`capLabel`): a GPUI text with overflow hidden lays out narrower than it paints.
 */
export function BranchToolbarLabel({ children, color }: { children: string; color: string }) {
  return (
    <text
      style={{
        color,
        fontSize: 12,
        lineHeight: 16,
        fontFamily: FONTS.sans,
        whiteSpace: "nowrap",
        flexShrink: 0,
        pointerEvents: "none",
      }}
    >
      {children}
    </text>
  );
}

/**
 * A 12px icon. ComposerControl gives every svg -mx-0.5, so an icon takes 8px of the
 * row and the 4px gaps around it read as 2px.
 */
export function BranchToolbarIcon({
  name,
  color,
  opacity,
  bleed = true,
}: {
  name: IconName;
  color: string;
  opacity?: number;
  bleed?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexShrink: 0, marginLeft: bleed ? -2 : 0, marginRight: bleed ? -2 : 0, pointerEvents: "none" }}>
      <Icon name={name} size={12} color={color} {...(opacity === undefined ? {} : { opacity })} />
    </div>
  );
}

/** MenuGroupLabel: padding 6/8, 12px medium muted. */
export function BranchToolbarMenuLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <div style={{ paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8, flexShrink: 0 }}>
      <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>
        {children}
      </text>
    </div>
  );
}

/** MenuRadioItem / ComboboxItem: min-h 28, padding 4/8, radius 6, highlight foreground at `highlightAlpha`. */
export function BranchToolbarMenuRow({
  children,
  highlighted,
  highlightAlpha = 0.08,
  disabled,
  onSelect,
  onHover,
  testId,
}: {
  children: ReactNode;
  highlighted?: boolean;
  highlightAlpha?: number;
  disabled?: boolean;
  onSelect?: () => void;
  onHover?: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const highlight = alpha(theme.foreground, highlightAlpha);
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onSelect}
      onMouseEnter={onHover}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 28,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(highlighted ? { backgroundColor: highlight } : {}),
        ...(disabled || highlighted ? {} : { hover: { backgroundColor: highlight } }),
      }}
    >
      {children}
    </div>
  );
}

export function BranchToolbarMenuText({
  children,
  color,
  size = 14,
  grow,
}: {
  children: string;
  color?: string;
  size?: 10 | 12 | 14;
  grow?: boolean;
}) {
  const theme = useTheme();
  return (
    <text
      style={{
        color: color ?? theme.foreground,
        fontSize: size,
        lineHeight: size === 14 ? 20 : size === 12 ? 16 : 14,
        fontFamily: FONTS.sans,
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        overflow: "hidden",
        minWidth: 0,
        pointerEvents: "none",
        ...(grow ? { flexGrow: 1, flexBasis: 0 } : { flexShrink: 1 }),
      }}
    >
      {children}
    </text>
  );
}

/** ~240px of 12px text: keeps the head and tail of long branch names (web MiddleTruncate). */
const LABEL_MAX_CHARS = 40;

export function capLabel(label: string): string {
  if (label.length <= LABEL_MAX_CHARS) return label;
  const keep = LABEL_MAX_CHARS - 1;
  const head = Math.ceil(keep / 2);
  return `${label.slice(0, head)}…${label.slice(label.length - (keep - head))}`;
}
