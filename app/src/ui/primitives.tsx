import type { ReactNode } from "react";
import type { Props, StyleDesc } from "@gpuix/react";

import { Icon, type IconName } from "./Icon.tsx";
import { FONTS, RADIUS, TEXT, alpha, useTheme } from "./theme.ts";
import { useSmallViewport } from "./viewport.tsx";

export type Style = StyleDesc;

type TextSize = keyof typeof TEXT;

export function Text({
  children,
  size = "sm",
  color,
  weight,
  mono,
  truncate,
  lineClamp,
  style,
  testId,
}: {
  children: ReactNode;
  size?: TextSize;
  color?: string;
  weight?: number;
  mono?: boolean;
  truncate?: boolean;
  lineClamp?: number;
  style?: Style;
  testId?: string;
}) {
  const theme = useTheme();
  const [fontSize, lineHeight] = TEXT[size];
  return (
    <text
      testId={testId}
      style={{
        color: color ?? theme.foreground,
        fontSize,
        lineHeight,
        fontFamily: mono ? FONTS.mono : FONTS.sans,
        ...(weight === undefined ? {} : { fontWeight: weight }),
        ...(truncate ? { whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 } : {}),
        ...(lineClamp === undefined ? {} : { lineClamp }),
        ...style,
      }}
    >
      {children}
    </text>
  );
}

export function Row({ children, style, ...rest }: { children?: ReactNode; style?: Style } & Omit<Props, "style">) {
  return (
    <div {...rest} style={{ display: "flex", flexDirection: "row", alignItems: "center", ...style }}>
      {children}
    </div>
  );
}

export function Col({ children, style, ...rest }: { children?: ReactNode; style?: Style } & Omit<Props, "style">) {
  return (
    <div {...rest} style={{ display: "flex", flexDirection: "column", ...style }}>
      {children}
    </div>
  );
}

export function Spacer() {
  return <div style={{ flexGrow: 1, minWidth: 0 }} />;
}

export type ButtonVariant = "default" | "ghost" | "ghost-muted" | "outline" | "destructive" | "destructive-outline";
export type ButtonSize = "default" | "sm" | "xs";

const BUTTON_SIZES = {
  default: { height: 32, paddingX: 11, text: "sm", icon: 16 },
  sm: { height: 28, paddingX: 9, text: "sm", icon: 16 },
  xs: { height: 24, paddingX: 7, text: "xs", icon: 14 },
} as const;

/**
 * button.tsx is mobile-first: below `sm` every size is 4px taller with text and icons a
 * step up (`h-9 sm:h-8`, `text-base sm:text-sm`, `size-4.5 sm:size-4`).
 */
const BUTTON_SIZES_SMALL_VIEWPORT = {
  default: { height: 36, paddingX: 11, text: "base", icon: 18 },
  sm: { height: 32, paddingX: 9, text: "base", icon: 18 },
  xs: { height: 28, paddingX: 7, text: "sm", icon: 16 },
} as const;

/** apps/web/src/components/ui/button.tsx */
export function Button({
  children,
  icon,
  leading,
  trailingIcon,
  variant = "default",
  size = "default",
  disabled,
  onClick,
  style,
  testId,
}: {
  children?: ReactNode;
  icon?: IconName;
  /** A non-lucide leading glyph (a brand mark), in place of `icon`. */
  leading?: ReactNode;
  trailingIcon?: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  onClick?: () => void;
  style?: Style;
  testId?: string;
}) {
  const theme = useTheme();
  const dims = (useSmallViewport() ? BUTTON_SIZES_SMALL_VIEWPORT : BUTTON_SIZES)[size];
  const palette = buttonPalette(theme, variant);
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: dims.height,
        paddingLeft: dims.paddingX,
        paddingRight: dims.paddingX,
        borderRadius: RADIUS.md,
        borderWidth: variant === "outline" || variant === "destructive-outline" ? 1 : 0,
        borderColor: theme.input,
        backgroundColor: palette.bg,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled
          ? {}
          : {
              hover: {
                backgroundColor: palette.hover,
                ...(variant === "destructive-outline" ? { borderColor: alpha(theme.error, 0.32) } : {}),
              },
            }),
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={dims.icon} color={palette.icon} /> : leading}
      {children === undefined ? null : (
        <Text size={dims.text} weight={500} color={palette.fg}>
          {children}
        </Text>
      )}
      {trailingIcon ? <Icon name={trailingIcon} size={dims.icon} color={palette.icon} /> : null}
    </div>
  );
}

function buttonPalette(theme: ReturnType<typeof useTheme>, variant: ButtonVariant) {
  switch (variant) {
    case "default":
      return { bg: theme.primary, hover: alpha(theme.primary, 0.9), fg: theme.primaryForeground, icon: theme.primaryForeground };
    case "destructive":
      return { bg: theme.error, hover: alpha(theme.error, 0.9), fg: "#ffffff", icon: "#ffffff" };
    case "outline":
      return {
        bg: theme.appearance === "dark" ? alpha("#ffffff", 0.026) : theme.popover,
        hover: theme.appearance === "dark" ? alpha("#ffffff", 0.05) : theme.accent,
        fg: theme.foreground,
        icon: theme.mutedForeground,
      };
    case "destructive-outline":
      // Outline surface with destructive-foreground text and icon; hover tints destructive/4.
      return {
        bg: theme.appearance === "dark" ? alpha("#ffffff", 0.026) : theme.popover,
        hover: alpha(theme.error, 0.04),
        fg: theme.errorForeground,
        icon: theme.errorForeground,
      };
    case "ghost-muted":
      return { bg: "#00000000", hover: theme.accent, fg: theme.mutedForeground, icon: theme.mutedForeground };
    case "ghost":
      return { bg: "#00000000", hover: theme.accent, fg: theme.foreground, icon: theme.mutedForeground };
  }
}

/**
 * Square icon-only button: icon (32), icon-sm (28), icon-xs (24), icon-micro (20).
 * `responsive` follows button.tsx below `sm`: icon 36, icon-sm 32, icon-xs 28
 * (icon-micro keeps 20). Off by default because many call sites pin web's
 * explicit `size-*` overrides.
 */
export function IconButton({
  icon,
  size: baseSize = 28,
  iconSize = 16,
  responsive,
  color,
  pressed,
  disabled,
  onClick,
  testId,
  style,
  hoverBg,
}: {
  icon: IconName;
  size?: number;
  iconSize?: number;
  color?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
  style?: Style;
  hoverBg?: string;
  responsive?: boolean;
}) {
  const theme = useTheme();
  const small = useSmallViewport();
  const size = responsive && small && baseSize > 20 ? baseSize + 4 : baseSize;
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size <= 20 ? RADIUS.sm : RADIUS.md,
        backgroundColor: pressed ? theme.accent : "#00000000",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled ? {} : { hover: { backgroundColor: hoverBg ?? theme.accent } }),
        ...style,
      }}
    >
      <Icon name={icon} size={iconSize} color={color ?? theme.mutedForeground} />
    </div>
  );
}

export function VSeparator({ height = 16, color }: { height?: number; color?: string }) {
  const theme = useTheme();
  return <div style={{ width: 1, height, marginLeft: 2, marginRight: 2, backgroundColor: color ?? theme.border, flexShrink: 0 }} />;
}

export function HSeparator({ color, style }: { color?: string; style?: Style }) {
  const theme = useTheme();
  return <div style={{ height: 1, flexShrink: 0, backgroundColor: color ?? theme.border, ...style }} />;
}

export function Kbd({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 20,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: 4,
        backgroundColor: theme.accent,
        flexShrink: 0,
      }}
    >
      <Text size="xs" weight={500} color={theme.mutedForeground}>
        {children}
      </Text>
    </div>
  );
}
