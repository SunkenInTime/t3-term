// apps/web/src/components/chat/ComposerControl.tsx: the footer control button, its
// icon/chevron sizing and the 1×16 separator between control blocks.
//   sm: h 28, px 10, gap 6, 14px medium muted label, 16px icons, chevron 14 @2.25
//   xs: h 24, px 7, gap 4, 12px normal muted/70 label, 14px icons (resting strip)
import type { Props } from "@gpuix/react";
import { createContext, type ReactNode, useContext, useEffect, useId } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import type { Style } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

export type ComposerControlSize = "sm" | "xs";

/** Extra props (mouse/focus handlers, tabIndex) pass through so Tooltip/Menu triggers can wrap it. */
export function ComposerControl({
  children,
  size = "sm",
  pressed,
  disabled,
  onClick,
  testId,
  style,
  ...rest
}: {
  children: ReactNode;
  size?: ComposerControlSize;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: Props["onClick"];
  testId?: string;
  style?: Style;
} & Omit<Props, "style" | "onClick" | "children">) {
  const theme = useTheme();
  return (
    <div
      {...rest}
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        height: size === "xs" ? 24 : 28,
        gap: size === "xs" ? 4 : 6,
        paddingLeft: size === "xs" ? 7 : 10,
        paddingRight: size === "xs" ? 7 : 10,
        // web `border border-transparent`: 2px of every control's width, which the footer's
        // collapse breakpoints count.
        borderWidth: 1,
        borderColor: "#00000000",
        borderRadius: RADIUS.md,
        backgroundColor: pressed ? theme.accent : "#00000000",
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: pressed ? alpha(theme.accent, 0.8) : theme.accent } }),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * A collapsible control block of the footer (web `data-resting-block`). Labels inside report
 * their width so the footer can tell how wide the block is with and without them, and drop
 * out of flow while the block is icon-only.
 */
export interface ComposerControlBlockState {
  readonly iconOnly: boolean;
  /** `width: null` when the label unmounts. */
  readonly reportLabel: (key: string, width: number | null, gap: number) => void;
}
export const ComposerControlBlockContext = createContext<ComposerControlBlockState | null>(null);

/**
 * Out of flow and unseen, still measured (web `invisible absolute pointer-events-none`). Opacity,
 * not `visibility: hidden`: gpuix skips hidden elements in prepaint, so they never report `onLayout`.
 */
export const COMPOSER_CONTROL_HIDDEN_STYLE: Style = {
  position: "absolute",
  opacity: 0,
  pointerEvents: "none",
};

export function composerControlLabelStyle(
  theme: ReturnType<typeof useTheme>,
  size: ComposerControlSize,
  pressed?: boolean,
  color?: string,
): Style {
  return {
    color:
      color ??
      (pressed ? theme.accentForeground : size === "xs" ? alpha(theme.mutedForeground, 0.7) : theme.mutedForeground),
    fontSize: size === "xs" ? 12 : 14,
    lineHeight: size === "xs" ? 16 : 20,
    fontWeight: size === "xs" ? 400 : 500,
    fontFamily: FONTS.sans,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  };
}

/** web `data-composer-control-label`. */
export function ComposerControlLabel({
  children,
  size = "sm",
  pressed,
  color,
  truncate,
}: {
  children: ReactNode;
  size?: ComposerControlSize;
  pressed?: boolean;
  color?: string;
  /** web `min-w-0 truncate` (the codex-style traits trigger). */
  truncate?: boolean;
}) {
  const theme = useTheme();
  const block = useContext(ComposerControlBlockContext);
  const key = useId();
  const reportLabel = block?.reportLabel;
  useEffect(() => (reportLabel ? () => reportLabel(key, null, 0) : undefined), [reportLabel, key]);
  const iconOnly = block?.iconOnly ?? false;
  return (
    <text
      onLayout={
        reportLabel
          ? (event) => {
              const width = (event as { width?: number }).width;
              if (typeof width === "number") reportLabel(key, width, size === "xs" ? 4 : 6);
            }
          : undefined
      }
      style={{
        ...composerControlLabelStyle(theme, size, pressed, color),
        ...(truncate && !iconOnly ? { textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 } : {}),
        ...(iconOnly ? COMPOSER_CONTROL_HIDDEN_STYLE : {}),
      }}
    >
      {children}
    </text>
  );
}

export function ComposerControlIcon({
  name,
  size = "sm",
  large,
  color,
}: {
  name: IconName;
  size?: ComposerControlSize;
  /** opticalSize="large": the Bot glyph reads small at 16, so web draws it at 18. */
  large?: boolean;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <Icon
      name={name}
      size={size === "xs" ? 12 : large ? 18 : 16}
      color={color ?? (size === "xs" ? alpha(theme.mutedForeground, 0.7) : theme.mutedForeground)}
    />
  );
}

/**
 * web gives control svgs `-mx-0.5`, so the 14px sm chevron takes a 10px slot and overhangs it by
 * 2px a side; xs overrides that with `ms-0 -me-1`: a 12px glyph in an 8px slot, overhanging on
 * the right. gpuix mislays flex items with negative margins, so the glyph overhangs a narrower
 * box instead.
 */
export function ComposerControlChevron({ size = "sm", color }: { size?: ComposerControlSize; color?: string }) {
  const theme = useTheme();
  const glyph = size === "xs" ? 12 : 14;
  return (
    <div style={{ position: "relative", width: glyph - 4, height: glyph, flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 0, left: size === "xs" ? 0 : -2, width: glyph, height: glyph }}>
        <Icon
          name="chevron-down"
          size={glyph}
          strokeWidth={2.25}
          color={color ?? (size === "xs" ? alpha(theme.mutedForeground, 0.35) : theme.mutedForeground)}
        />
      </div>
    </div>
  );
}

export function ComposerControlSeparator({ size = "sm" }: { size?: ComposerControlSize }) {
  const theme = useTheme();
  return (
    <div
      style={{
        width: 1,
        height: size === "xs" ? 14 : 16,
        marginLeft: 2,
        marginRight: 2,
        flexShrink: 0,
        backgroundColor: theme.border,
      }}
    />
  );
}
