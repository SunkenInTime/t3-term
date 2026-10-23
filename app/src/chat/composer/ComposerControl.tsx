// apps/web/src/components/chat/ComposerControl.tsx: the footer control button, its
// icon/chevron sizing and the 1×16 separator between control blocks.
//   sm: h 28, px 10, gap 6, 14px medium muted label, 16px icons, chevron 14 @2.25
//   xs: h 24, px 7, gap 4, 12px normal muted/70 label, 14px icons (resting strip)
import type { Props } from "@gpuix/react";
import type { ReactNode } from "react";

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

export function ComposerControlLabel({
  children,
  size = "sm",
  pressed,
  color,
}: {
  children: ReactNode;
  size?: ComposerControlSize;
  pressed?: boolean;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <text
      style={{
        color:
          color ??
          (pressed
            ? theme.accentForeground
            : size === "xs"
              ? alpha(theme.mutedForeground, 0.7)
              : theme.mutedForeground),
        fontSize: size === "xs" ? 12 : 14,
        lineHeight: size === "xs" ? 16 : 20,
        fontWeight: size === "xs" ? 400 : 500,
        fontFamily: FONTS.sans,
        whiteSpace: "nowrap",
        pointerEvents: "none",
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
 * web gives control svgs `-mx-0.5`; measured against Chrome the chevron sits 2px closer to its label. gpuix
 * mislays flex items with negative margins, so the glyph overhangs a narrower box instead.
 */
export function ComposerControlChevron({ size = "sm", color }: { size?: ComposerControlSize; color?: string }) {
  const theme = useTheme();
  const glyph = size === "xs" ? 12 : 14;
  return (
    <div style={{ position: "relative", width: glyph - 2, height: glyph, flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 0, left: -2, width: glyph, height: glyph }}>
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
