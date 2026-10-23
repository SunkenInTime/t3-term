// Form controls the settings pages share, sized like apps/web/src/components/ui
// {select,input,textarea,slider,badge}.tsx at the `sm` breakpoint.
import type { FloatingAlign } from "@gpuix/react/floating";
import { useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { Menu, MenuItem, MenuSeparator } from "../ui/overlay.tsx";
import { Text, type Style } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../ui/theme.ts";

/**
 * True while a text field has focus, so page-level shortcuts ("/" opens
 * search, Escape leaves settings) leave typing alone.
 */
let textEntryFocused = false;
export function setTextEntryFocused(focused: boolean): void {
  textEntryFocused = focused;
}
export function isTextEntryFocused(): boolean {
  return textEntryFocused;
}

/** dark:bg-input/32 over the page, bg-background in light. */
export function fieldBackground(theme: Palette): string {
  return theme.appearance === "dark" ? alpha(theme.input, 0.32) : theme.background;
}

// ── Select ──────────────────────────────────────────────────────────────

export interface SettingsSelectOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /** Draw a separator above this option. */
  readonly separatorBefore?: boolean;
}

/**
 * `<Select><SelectTrigger size="sm" className="w-full sm:w-44">` with
 * `SelectItem hideIndicator`: 28 tall, radius 10, border input, 12px chevron at 50%.
 */
export function SettingsSelect<V extends string>({
  value,
  options,
  onChange,
  width = 160,
  label,
  icon,
  disabled,
  testId,
  align = "end",
  size = "sm",
  menuWidth,
}: {
  value: V | null;
  options: ReadonlyArray<SettingsSelectOption<V>>;
  onChange: (value: V) => void;
  width?: number | "auto";
  /** Trigger text; defaults to the selected option's label ("Mixed" when value is null). */
  label?: string;
  icon?: IconName;
  disabled?: boolean;
  testId?: string;
  align?: FloatingAlign;
  size?: "sm" | "default";
  menuWidth?: number;
}) {
  const theme = useTheme();
  const selected = options.find((option) => option.value === value);
  const text = label ?? selected?.label ?? (value === null ? "Mixed" : String(value));
  const height = size === "sm" ? 28 : 32;
  return (
    <Menu
      align={align}
      minWidth={menuWidth ?? (typeof width === "number" ? width : 160)}
      testId={testId ? `${testId}-menu` : undefined}
      trigger={({ toggle }) => (
        <div
          testId={testId}
          onClick={disabled ? undefined : toggle}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height,
            ...(width === "auto" ? {} : { width }),
            paddingLeft: 9,
            paddingRight: 8,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: fieldBackground(theme),
            opacity: disabled ? 0.64 : 1,
            cursor: disabled ? "default" : "pointer",
            flexShrink: 0,
          }}
        >
          {icon ?? selected?.icon ? (
            <Icon name={(icon ?? selected?.icon)!} size={16} color={alpha(theme.mutedForeground, 0.8)} />
          ) : null}
          <Text truncate style={{ flexGrow: 1 }}>
            {text}
          </Text>
          <Icon name="chevron-down" size={12} color={alpha(theme.foreground, 0.5)} />
        </div>
      )}
    >
      {options.map((option) => (
        <SelectRow key={option.value} option={option} selected={option.value === value} onSelect={() => onChange(option.value)} />
      ))}
    </Menu>
  );
}

function SelectRow<V extends string>({
  option,
  selected,
  onSelect,
}: {
  option: SettingsSelectOption<V>;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  return (
    <>
      {option.separatorBefore ? <MenuSeparator /> : null}
      <div style={{ borderRadius: RADIUS.sm, backgroundColor: selected ? alpha(theme.foreground, 0.08) : "#00000000" }}>
        <MenuItem icon={option.icon} description={option.description} disabled={option.disabled} onSelect={onSelect}>
          {option.label}
        </MenuItem>
      </div>
    </>
  );
}

// ── Text inputs ─────────────────────────────────────────────────────────

export function TextField({
  value,
  onChange,
  onSubmit,
  onBlur,
  placeholder,
  width,
  mono,
  size = "default",
  readOnly,
  disabled,
  testId,
  leading,
  trailing,
  style,
}: {
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  width?: number | "100%";
  mono?: boolean;
  size?: "default" | "sm";
  readOnly?: boolean;
  disabled?: boolean;
  testId?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  style?: Style;
}) {
  const theme = useTheme();
  const height = size === "sm" ? 28 : 32;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height,
        ...(width === undefined ? { flexGrow: 1, minWidth: 0 } : { width }),
        paddingLeft: size === "sm" ? 9 : 11,
        paddingRight: size === "sm" ? 9 : 11,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: fieldBackground(theme),
        opacity: disabled ? 0.64 : 1,
        flexShrink: 0,
        ...style,
      }}
    >
      {leading}
      <input
        testId={testId}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly || disabled}
        theme={{ caret: theme.foreground, textMuted: theme.mutedForeground, appearance: theme.appearance }}
        onChange={(event) => onChange?.(event.value ?? "")}
        onSubmit={(event) => onSubmit?.(event.value ?? value)}
        onFocus={() => setTextEntryFocused(true)}
        onBlur={() => {
          setTextEntryFocused(false);
          onBlur?.();
        }}
        style={{
          flexGrow: 1,
          minWidth: 0,
          height: height - 2,
          fontSize: 14,
          lineHeight: height - 2,
          color: theme.foreground,
          fontFamily: mono ? FONTS.mono : FONTS.sans,
        }}
      />
      {trailing}
    </div>
  );
}

/** A text field that keeps a local draft and commits on Enter or blur. */
export function DraftTextField({
  value,
  onCommit,
  ...rest
}: Omit<Parameters<typeof TextField>[0], "value" | "onChange" | "onSubmit" | "onBlur"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(value);
  if (source !== value) {
    setSource(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return <TextField {...rest} value={draft} onChange={setDraft} onSubmit={commit} onBlur={commit} />;
}

/** apps/web/src/components/ui/textarea.tsx: radius 10, border input, padding 12/8. */
export function TextArea({
  value,
  onChange,
  onBlur,
  placeholder,
  minRows = 3,
  maxRows = 10,
  width,
  mono,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  width?: number | "100%";
  mono?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        ...(width === undefined ? { width: "100%" } : { width }),
        paddingTop: 7,
        paddingBottom: 7,
        paddingLeft: 11,
        paddingRight: 11,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: fieldBackground(theme),
      }}
    >
      <textarea
        testId={testId}
        value={value}
        placeholder={placeholder}
        minRows={minRows}
        maxRows={maxRows}
        theme={{ caret: theme.foreground, textMuted: theme.mutedForeground, appearance: theme.appearance }}
        onChange={(event) => onChange(event.value ?? "")}
        onFocus={() => setTextEntryFocused(true)}
        onBlur={() => {
          setTextEntryFocused(false);
          onBlur?.();
        }}
        style={{
          width: "100%",
          fontSize: 14,
          lineHeight: 20,
          color: theme.foreground,
          fontFamily: mono ? FONTS.mono : FONTS.sans,
        }}
      />
    </div>
  );
}

/** A number input that commits only valid integers in range. */
export function NumberField({
  value,
  min,
  max,
  onCommit,
  width = 96,
  testId,
  size = "default",
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  width?: number;
  testId?: string;
  size?: "default" | "sm";
}) {
  const [draft, setDraft] = useState(String(value));
  const [source, setSource] = useState(value);
  if (source !== value) {
    setSource(value);
    setDraft(String(value));
  }
  return (
    <TextField
      testId={testId}
      size={size}
      width={width}
      value={draft}
      onChange={(next) => {
        setDraft(next);
        const parsed = Number(next);
        if (next.trim() !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max) onCommit(parsed);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}

// ── Slider ──────────────────────────────────────────────────────────────

/** apps/web/src/components/ui/slider.tsx: 4px track, 16px thumb, primary fill. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  width = 148,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  width?: number;
  testId?: string;
}) {
  const theme = useTheme();
  const trackX = useRef(0);
  const drag = useRef<{ startX: number; startValue: number } | null>(null);
  const fraction = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const snap = (raw: number) => {
    const stepped = Math.round((raw - min) / step) * step + min;
    return Math.max(min, Math.min(max, Number(stepped.toFixed(4))));
  };
  const thumb = 16;
  return (
    <div
      testId={testId}
      onLayout={(event) => {
        trackX.current = event.x ?? 0;
      }}
      onMouseDown={(event) => {
        const x = event.x ?? 0;
        const local = x - trackX.current;
        const thumbLeft = fraction * (width - thumb);
        // Grabbing the thumb drags from where it is; clicking the track jumps.
        const onThumb = local >= thumbLeft - 2 && local <= thumbLeft + thumb + 2;
        const startValue = onThumb ? value : snap(min + ((local - thumb / 2) / (width - thumb)) * (max - min));
        if (!onThumb && startValue !== value) onChange(startValue);
        drag.current = { startX: x, startValue };
      }}
      onMouseMove={(event) => {
        if (!drag.current || event.pressedButton === undefined || event.pressedButton === null) return;
        const delta = ((event.x ?? 0) - drag.current.startX) / (width - thumb);
        const next = snap(drag.current.startValue + delta * (max - min));
        if (next !== value) onChange(next);
      }}
      onMouseUp={() => {
        drag.current = null;
      }}
      style={{ position: "relative", width, height: 20, flexShrink: 0, cursor: "pointer" }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 8,
          height: 4,
          borderRadius: 2,
          backgroundColor: theme.input,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 8,
          width: thumb / 2 + fraction * (width - thumb),
          height: 4,
          borderRadius: 2,
          backgroundColor: theme.primary,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: fraction * (width - thumb),
          top: 2,
          width: thumb,
          height: thumb,
          borderRadius: thumb / 2,
          borderWidth: 2,
          borderColor: theme.primary,
          backgroundColor: theme.appearance === "dark" ? theme.background : "#ffffff",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────

/** apps/web/src/components/ui/badge.tsx (outline/secondary, 18 tall, 12px, radius 6). */
export function Badge({
  children,
  tone = "outline",
  icon,
  size = "default",
}: {
  children: ReactNode;
  tone?: "outline" | "secondary" | "success" | "warning" | "error" | "info";
  icon?: IconName;
  /** sm: 16 tall, 10px text, radius 4 (badge.tsx size="sm"). */
  size?: "default" | "sm";
}) {
  const theme = useTheme();
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    outline: { bg: "#00000000", fg: theme.mutedForeground, border: theme.border },
    secondary: { bg: alpha(theme.foreground, 0.06), fg: theme.mutedForeground, border: "#00000000" },
    success: { bg: alpha(theme.success, 0.12), fg: theme.successForeground, border: "#00000000" },
    warning: { bg: alpha(theme.warning, 0.12), fg: theme.warningForeground, border: "#00000000" },
    error: { bg: alpha(theme.error, 0.12), fg: theme.errorForeground, border: "#00000000" },
    info: { bg: alpha(theme.info, 0.12), fg: theme.infoForeground, border: "#00000000" },
  };
  const color = colors[tone]!;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: size === "sm" ? 16 : 18,
        paddingLeft: size === "sm" ? 3 : 6,
        paddingRight: size === "sm" ? 3 : 6,
        borderRadius: size === "sm" ? 4 : RADIUS.sm,
        borderWidth: tone === "outline" ? 1 : 0,
        borderColor: color.border,
        backgroundColor: color.bg,
        flexShrink: 0,
      }}
    >
      {icon ? <Icon name={icon} size={12} color={color.fg} /> : null}
      <Text size="xs" weight={500} color={color.fg} style={size === "sm" ? { fontSize: 10, lineHeight: 14 } : undefined}>
        {children}
      </Text>
    </div>
  );
}

/** `<InlineButton>`: text-only button; `picker` tone underlines the value. */
export function InlineButton({
  children,
  onClick,
  tone = "default",
  size = "sm",
  trailingIcon,
  leading,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "muted" | "picker";
  size?: "sm" | "xs" | "base";
  trailingIcon?: IconName;
  leading?: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const color = tone === "muted" ? theme.mutedForeground : theme.foreground;
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, cursor: "pointer", minWidth: 0, flexShrink: 1 }}
    >
      {leading}
      <Text
        size={size}
        weight={tone === "picker" ? 600 : 500}
        color={color}
        truncate
        style={{
          ...(tone === "picker" || hover ? { textDecoration: "underline" } : {}),
        }}
      >
        {children}
      </Text>
      {trailingIcon ? <Icon name={trailingIcon} size={14} color={theme.mutedForeground} /> : null}
    </div>
  );
}

/** Two or more mutually exclusive choices drawn as a pill group. */
export function SegmentedControl<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: ReadonlyArray<{ value: V; label: string; icon?: IconName }>;
  onChange: (value: V) => void;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 2,
        padding: 2,
        borderRadius: RADIUS.lg,
        backgroundColor: alpha(theme.foreground, 0.05),
        flexShrink: 0,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <div
            key={option.value}
            onClick={() => onChange(option.value)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              height: 24,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: RADIUS.md,
              backgroundColor: active ? (theme.appearance === "dark" ? alpha("#ffffff", 0.1) : "#ffffff") : "#00000000",
              cursor: "pointer",
            }}
          >
            {option.icon ? <Icon name={option.icon} size={14} color={active ? theme.foreground : theme.mutedForeground} /> : null}
            <Text size="xs" weight={500} color={active ? theme.foreground : theme.mutedForeground}>
              {option.label}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

/** A clickable header that folds its panel, like `<Collapsible>` with a rotating chevron. */
export function CollapsibleHeader({
  open,
  onToggle,
  children,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <div
      testId={testId}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 32,
        paddingLeft: 16,
        paddingRight: 16,
        cursor: "pointer",
      }}
    >
      <Text color={hover ? theme.foreground : alpha(theme.foreground, 0.7)}>{children}</Text>
      <Icon name={open ? "chevron-down" : "chevron-right"} size={16} color={theme.mutedForeground} />
    </div>
  );
}
