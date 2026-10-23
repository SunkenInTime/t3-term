// Small view helpers shared by the Usage page: color resolution, the segmented
// toggle group, inline (link-style) buttons, menu checkbox rows and skeletons.
import { useState, type ReactNode } from "react";

import type { UsageColor } from "../web/components/usage/usageProviders.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Text, type Style } from "../ui/primitives.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { RADIUS, alpha, useTheme, type Palette } from "../ui/theme.ts";

function parseHex(color: string) {
  const hex = color.replace("#", "");
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function toHex(value: number) {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, "0");
}

/** `color-mix(in srgb, a percent%, b)`. Web mixes in oklab; srgb is close for greys. */
export function mixColors(a: string, b: string, percent: number): string {
  const left = parseHex(a);
  const right = parseHex(b);
  const t = percent / 100;
  return `#${toHex(left.r * t + right.r * (1 - t))}${toHex(left.g * t + right.g * (1 - t))}${toHex(left.b * t + right.b * (1 - t))}`;
}

export function resolveUsageColor(color: UsageColor, theme: Palette): string {
  return typeof color === "string" ? color : mixColors(theme.foreground, theme.background, color.ink);
}

/** web `figureClass`: figures fade to 40% while their provider is still scanning. */
export function figureOpacity(loading: boolean): number {
  return loading ? 0.4 : 1;
}

// ── Segmented toggle group (ui/toggle-group.tsx variant="segmented") ──

export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly tooltip?: string;
  readonly shortcut?: string | null;
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  disabled,
  testIdPrefix,
}: {
  options: ReadonlyArray<SegmentedOption<V>>;
  value: V;
  onChange: (value: V) => void;
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        padding: 2,
        borderRadius: RADIUS.lg,
        backgroundColor: alpha(theme.input, 0.4),
        opacity: disabled ? 0.64 : 1,
        flexShrink: 0,
      }}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        const item = (
          <div
            key={option.value}
            testId={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
            onClick={disabled ? undefined : () => onChange(option.value)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 24,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: RADIUS.md,
              backgroundColor: pressed ? alpha(theme.input, 0.72) : "#00000000",
              cursor: disabled ? "default" : "pointer",
              ...(disabled || pressed ? {} : { hover: { backgroundColor: alpha(theme.input, 0.32) } }),
            }}
          >
            <Text weight={500} color={pressed ? theme.foreground : theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
              {option.label}
            </Text>
          </div>
        );
        return option.tooltip && !disabled ? (
          <Tooltip key={option.value} content={option.tooltip} shortcut={option.shortcut ?? undefined}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </div>
  );
}

// ── InlineButton (ui/button.tsx InlineButton): text that underlines on hover ──

export function InlineButton({
  children,
  onClick,
  trailing,
  color,
  size = "sm",
  weight = 500,
  testId,
  style,
  disabled,
}: {
  children: string;
  onClick?: () => void;
  trailing?: (hovered: boolean) => ReactNode;
  color?: string;
  size?: "sm" | "xs";
  weight?: number;
  testId?: string;
  style?: Style;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
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
        gap: 2,
        minWidth: 0,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.64 : 1,
        ...style,
      }}
    >
      <Text
        size={size}
        weight={weight}
        color={color ?? theme.foreground}
        truncate
        style={hovered && !disabled ? { textDecoration: "underline" } : undefined}
      >
        {children}
      </Text>
      {trailing?.(hovered)}
    </div>
  );
}

// ── Menu rows (ui/menu.tsx MenuCheckboxItem / MenuSeparator) ──

const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.252 12.7 10.2 18.63 18.748 5.37"/></svg>';

export function MenuCheckboxRow({
  checked,
  onCheckedChange,
  children,
  testId,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={() => onCheckedChange(!checked)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 28,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 16,
        borderRadius: RADIUS.sm,
        cursor: "pointer",
        flexShrink: 0,
        hover: { backgroundColor: theme.accent },
      }}
    >
      <div style={{ width: 16, height: 16, flexShrink: 0 }}>
        {checked ? <svg source={CHECK_SVG} style={{ width: 16, height: 16, color: theme.foreground }} /> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexGrow: 1, minWidth: 0 }}>
        {typeof children === "string" ? <Text truncate>{children}</Text> : children}
      </div>
    </div>
  );
}

export function UsageMenuSeparator() {
  const theme = useTheme();
  return (
    <div
      style={{
        height: 1,
        marginTop: 4,
        marginBottom: 4,
        marginLeft: 8,
        marginRight: 8,
        backgroundColor: theme.border,
        flexShrink: 0,
      }}
    />
  );
}

export function UsageMenuItem({
  icon,
  children,
  onSelect,
  testId,
}: {
  icon: IconName;
  children: string;
  onSelect: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 28,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        cursor: "pointer",
        flexShrink: 0,
        hover: { backgroundColor: theme.accent },
      }}
    >
      <Icon name={icon} size={16} color={theme.mutedForeground} opacity={0.8} />
      <Text truncate>{children}</Text>
    </div>
  );
}

// ── Skeleton (ui/skeleton.tsx): a static muted block, no shimmer ──

export function Skeleton({
  width,
  height,
  radius = 4,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: Style;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        width: width ?? "100%",
        height,
        borderRadius: radius,
        backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.04) : alpha("#000000", 0.04),
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
