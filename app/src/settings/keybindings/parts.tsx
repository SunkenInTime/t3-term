// Small controls the keybindings page draws, sized like the web's ui/{kbd,
// button,toggle,select}.tsx variants it uses (compact, micro, icon-sm) at the
// `sm` breakpoint, where their text is 14px.
import type { FloatingAlign } from "@gpuix/react/floating";
import { useState, type ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Menu, MenuItem, Tooltip } from "../../ui/overlay.tsx";
import { Text, type Style } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import { isMacPlatform, PLATFORM } from "../../web/lib/utils.ts";
import { fieldBackground } from "../controls.tsx";

// ── Keycaps ─────────────────────────────────────────────────────────────

function keycapLabel(part: string): string {
  if (part === "mod") return isMacPlatform(PLATFORM) ? "⌘" : "Ctrl";
  if (part === "shift") return "⇧";
  if (part === "alt") return isMacPlatform(PLATFORM) ? "⌥" : "Alt";
  if (part === "ctrl") return "⌃";
  return part.length === 1 ? part.toUpperCase() : part;
}

/** Symbols the UI fonts here draw too small or not at all; lucide draws them instead. */
const KEYCAP_ICONS: Readonly<Record<string, IconName>> = {
  "⇧": "arrow-big-up",
  "⌘": "command",
  "⌥": "option",
  "⌃": "chevron-up",
};

/** ui/kbd.tsx Kbd: h-5 min-w-5 rounded bg-muted px-1, 12px medium muted. */
export function Keycap({ children }: { children: string }) {
  const theme = useTheme();
  const icon = KEYCAP_ICONS[children];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 20,
        minWidth: 20,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: 4,
        // bg-muted measures #131313 on the card row in the reference.
        backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.025) : theme.muted,
        flexShrink: 0,
        pointerEvents: "none",
      }}
    >
      {icon ? (
        <Icon name={icon} size={12} color={theme.mutedForeground} />
      ) : (
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          {children}
        </Text>
      )}
    </div>
  );
}

/** KeybindingPill: one keycap per "+"-separated part ("mod++" keeps its empty parts, like the web). */
export function KeybindingPill({ value }: { value: string }) {
  const seen = new Map<string, number>();
  const parts = value.split("+").map((part) => {
    const count = seen.get(part) ?? 0;
    seen.set(part, count + 1);
    return { part, key: count === 0 ? part : `${part}-${count}` };
  });
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, pointerEvents: "none" }}>
      {parts.map(({ part, key }) => (
        <Keycap key={key}>{keycapLabel(part)}</Keycap>
      ))}
    </div>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────

/** Button size="compact": h-7 px-[7px] gap-1 rounded-md, 14px medium, 14px icons. */
export function CompactButton({
  children,
  icon = "plus",
  variant = "outline",
  onClick,
  testId,
}: {
  children: ReactNode;
  icon?: IconName;
  variant?: "outline" | "default";
  onClick: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const primary = variant === "default";
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 28,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: primary ? theme.primary : theme.input,
        backgroundColor: primary ? theme.primary : fieldBackground(theme),
        cursor: "pointer",
        flexShrink: 0,
        hover: { backgroundColor: primary ? alpha(theme.primary, 0.9) : outlineHover(theme) },
      }}
    >
      <Icon name={icon} size={14} color={primary ? theme.primaryForeground : theme.mutedForeground} />
      <Text weight={500} color={primary ? theme.primaryForeground : theme.foreground}>
        {children}
      </Text>
    </div>
  );
}

function outlineHover(theme: Palette): string {
  return theme.appearance === "dark" ? alpha(theme.input, 0.64) : alpha(theme.accent, 0.5);
}

/** A square ghost icon button with an optional tooltip (icon-sm 28 / icon-micro 20). */
export function GhostIconButton({
  icon,
  label,
  size = 28,
  iconSize = 14,
  color,
  disabled,
  onClick,
  testId,
}: {
  icon: IconName;
  label?: string;
  size?: number;
  iconSize?: number;
  color?: string;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const button = (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size <= 20 ? RADIUS.sm : RADIUS.md,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        backgroundColor: hover && !disabled ? theme.accent : "#00000000",
      }}
    >
      <Icon name={icon} size={iconSize} color={color ?? (hover && !disabled ? theme.foreground : theme.mutedForeground)} />
    </div>
  );
  return label ? (
    <Tooltip content={label} side="top">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

/** WarningTooltipIcon: TriangleAlert 14 in a 20px warning-tinted hit area. */
export function WarningIcon({ label, size = 20, testId }: { label: string; size?: number; testId?: string }) {
  const theme = useTheme();
  return (
    <Tooltip content={label} side="top">
      <div
        testId={testId}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: RADIUS.sm,
          flexShrink: 0,
          hover: { backgroundColor: alpha(theme.warning, 0.1) },
        }}
      >
        <Icon name="triangle-alert" size={14} color={theme.warning} />
      </div>
    </Tooltip>
  );
}

/** Toggle variant="outline" size="compact": the "Not" switch of a condition. */
export function NotToggle({ pressed, onChange, testId }: { pressed: boolean; onChange: (pressed: boolean) => void; testId?: string }) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={() => onChange(!pressed)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 28,
        minWidth: 40,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: pressed ? theme.input : fieldBackground(theme),
        cursor: "pointer",
        flexShrink: 0,
        hover: { backgroundColor: pressed ? theme.input : outlineHover(theme) },
      }}
    >
      <Text weight={500} color={pressed ? theme.accentForeground : theme.foreground}>
        Not
      </Text>
    </div>
  );
}

// ── Select ──────────────────────────────────────────────────────────────

export interface PickerOption<V extends string> {
  readonly value: V;
  readonly label: string;
}

/**
 * `<Select>` with a `SelectTrigger` of size "sm" (28 tall, radius 10, 9px
 * padding) or "compact" (28 tall, radius 8, 7px padding), showing a muted
 * placeholder until a value is picked.
 */
export function PickerSelect<V extends string>({
  value,
  options,
  onChange,
  placeholder,
  size = "sm",
  width,
  grow = false,
  maxHeight,
  menuMinWidth,
  align = "start",
  trailing,
  testId,
}: {
  value: V | "";
  options: ReadonlyArray<PickerOption<V>>;
  onChange: (value: V) => void;
  placeholder?: string;
  size?: "sm" | "compact";
  width?: number;
  grow?: boolean;
  maxHeight?: number;
  menuMinWidth?: number;
  align?: FloatingAlign;
  trailing?: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  const selected = options.find((option) => option.value === value);
  const text = selected?.label ?? (value === "" ? (placeholder ?? "") : value);
  const sizing: Style =
    size === "sm"
      ? { paddingLeft: 9, paddingRight: 8, gap: 6, borderRadius: RADIUS.lg }
      : { paddingLeft: 7, paddingRight: 7, gap: 4, borderRadius: RADIUS.md };
  return (
    <Menu
      align={align}
      minWidth={menuMinWidth ?? width ?? 96}
      maxHeight={maxHeight}
      testId={testId ? `${testId}-menu` : undefined}
      rootStyle={grow ? { flexGrow: 1, flexShrink: 1, minWidth: 0 } : undefined}
      trigger={({ toggle }) => (
        <div
          testId={testId}
          onClick={toggle}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            height: 28,
            ...sizing,
            ...(width === undefined ? {} : { width }),
            ...(grow ? { flexGrow: 1, flexShrink: 1, minWidth: 0 } : {}),
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: fieldBackground(theme),
            cursor: "pointer",
            flexShrink: grow ? 1 : 0,
          }}
        >
          <Text truncate color={selected || value !== "" ? theme.foreground : alpha(theme.mutedForeground, 0.72)} style={{ flexGrow: 1 }}>
            {text}
          </Text>
          {trailing}
          <Icon name="chevron-down" size={size === "sm" ? 14 : 14} color={alpha(theme.mutedForeground, 0.8)} />
        </div>
      )}
    >
      {options.map((option) => (
        <MenuItem key={option.value} checked={option.value === value} onSelect={() => onChange(option.value)}>
          {option.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** Button variant ghost / ghost-muted, size micro: the "When" clause trigger. */
export function MicroTrigger({
  label,
  muted,
  onClick,
  open,
  testId,
}: {
  label: string;
  muted: boolean;
  onClick: () => void;
  open: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const active = hover || open;
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 20,
        paddingLeft: 5,
        paddingRight: 5,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        cursor: "pointer",
        backgroundColor: active ? theme.accent : "#00000000",
      }}
    >
      <text
        style={{
          color: muted && !active ? theme.mutedForeground : theme.foreground,
          fontSize: 11,
          lineHeight: 16,
          fontFamily: FONTS.mono,
          whiteSpace: "nowrap",
        }}
      >
        {label.length > 72 ? `${label.slice(0, 71)}…` : label}
      </text>
      <Icon name="chevron-down" size={14} color={muted && !active ? theme.mutedForeground : theme.foreground} opacity={0.6} />
    </div>
  );
}
