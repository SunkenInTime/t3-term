// The small controls the pull request write flows share, sized and toned after
// apps/web/src/components/ui/{button,badge,textarea,input,toggle-group}.tsx as the
// pullRequest components use them (xs buttons, control badges, segmented toggles).
import type { EventPayload } from "@gpuix/native";
import type { ReactNode } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { Text, type Style } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../ui/theme.ts";

export type PrButtonVariant =
  | "default"
  | "outline"
  | "ghost"
  | "ghost-muted"
  | "destructive-outline"
  | "warning-outline";

function variantStyle(theme: Palette, variant: PrButtonVariant) {
  const dark = theme.appearance === "dark";
  switch (variant) {
    case "default":
      return { bg: theme.primary, hover: alpha(theme.primary, 0.9), fg: theme.primaryForeground, icon: theme.primaryForeground, border: theme.primary };
    case "outline":
      return {
        bg: dark ? alpha(theme.input, 0.32) : theme.popover,
        hover: dark ? alpha(theme.input, 0.64) : alpha(theme.accent, 0.5),
        fg: theme.foreground,
        icon: theme.mutedForeground,
        border: theme.input,
      };
    case "destructive-outline":
      return {
        bg: dark ? alpha(theme.input, 0.32) : theme.popover,
        hover: alpha(theme.error, 0.04),
        fg: theme.errorForeground,
        icon: theme.errorForeground,
        border: theme.input,
        hoverBorder: alpha(theme.error, 0.32),
      };
    case "warning-outline":
      return {
        bg: alpha(theme.warning, dark ? 0.08 : 0.06),
        hover: alpha(theme.warning, dark ? 0.24 : 0.16),
        fg: theme.warningForeground,
        icon: theme.warningForeground,
        border: alpha(theme.warning, 0.32),
        hoverBorder: alpha(theme.warning, 0.4),
      };
    case "ghost":
      return { bg: "#00000000", hover: theme.accent, fg: theme.foreground, icon: theme.mutedForeground, border: "#00000000" };
    case "ghost-muted":
      return { bg: "#00000000", hover: theme.accent, fg: theme.mutedForeground, icon: theme.mutedForeground, border: "#00000000" };
  }
}

/** Button size="xs" (24 tall, 7px sides, 4px gap, 12px text, 14px icons), or "sm" (28). */
export function PrButton({
  children,
  icon,
  iconNode,
  trailingIcon,
  variant = "outline",
  size = "xs",
  disabled,
  onClick,
  onMouseDownOutside,
  testId,
  style,
  minWidth,
}: {
  children?: ReactNode;
  icon?: IconName;
  iconNode?: ReactNode;
  trailingIcon?: IconName;
  variant?: PrButtonVariant;
  size?: "xs" | "sm";
  disabled?: boolean;
  onClick?: (event: EventPayload) => void;
  onMouseDownOutside?: () => void;
  testId?: string;
  style?: Style;
  minWidth?: number;
}) {
  const theme = useTheme();
  const tone = variantStyle(theme, variant);
  const height = size === "xs" ? 24 : 28;
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      {...(onMouseDownOutside ? { onMouseDownOutside } : {})}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: size === "xs" ? 4 : 6,
        height,
        paddingLeft: size === "xs" ? 7 : 9,
        paddingRight: size === "xs" ? 7 : 9,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: tone.border,
        backgroundColor: tone.bg,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(minWidth ? { minWidth } : {}),
        ...(disabled
          ? {}
          : {
              hover: {
                backgroundColor: tone.hover,
                ...("hoverBorder" in tone && tone.hoverBorder ? { borderColor: tone.hoverBorder } : {}),
              },
            }),
        ...style,
      }}
    >
      {iconNode ?? (icon ? <Icon name={icon} size={14} color={tone.icon} /> : null)}
      {children === undefined || children === null ? null : typeof children === "string" ? (
        <Text size={size === "xs" ? "xs" : "sm"} weight={500} color={tone.fg} style={{ whiteSpace: "nowrap" }}>
          {children}
        </Text>
      ) : (
        children
      )}
      {trailingIcon ? <Icon name={trailingIcon} size={14} color={theme.mutedForeground} /> : null}
    </div>
  );
}

/** The tone a PrButton paints its label in, for callers composing their own label. */
export function prButtonForeground(theme: Palette, variant: PrButtonVariant): string {
  return variantStyle(theme, variant).fg;
}

/** Badge size="control" (24 tall): variant info or outline. */
export function PrBadge({
  children,
  icon,
  variant,
  color,
  testId,
}: {
  children: ReactNode;
  icon?: IconName;
  variant: "info" | "outline";
  color?: string;
  testId?: string;
}) {
  const theme = useTheme();
  const fg = color ?? (variant === "info" ? theme.infoForeground : theme.foreground);
  return (
    <div
      testId={testId}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 24,
        minWidth: 24,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: variant === "outline" ? theme.input : "#00000000",
        backgroundColor: variant === "info" ? alpha(theme.info, theme.appearance === "dark" ? 0.16 : 0.08) : "#00000000",
        flexShrink: 0,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={alpha(fg, 0.8)} /> : null}
      <Text size="xs" weight={500} color={fg} style={{ whiteSpace: "nowrap" }}>
        {children}
      </Text>
    </div>
  );
}

/** PullRequestEditButton: icon-xs ghost-muted pencil, shown while its group is hovered. */
export function PrEditButton({
  visible,
  onClick,
  label,
  testId,
  style,
}: {
  visible: boolean;
  onClick: () => void;
  label: string;
  testId?: string;
  style?: Style;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={label} side="top">
      <div
        testId={testId}
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: RADIUS.md,
          flexShrink: 0,
          cursor: "pointer",
          opacity: visible ? 1 : 0,
          hover: { backgroundColor: theme.accent },
          ...style,
        }}
      >
        <Icon name="pencil" size={12} color={theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}

/** ToggleGroup variant="segmented": 2px padded track, 24-tall items. */
export function PrSegmented<V extends string>({
  value,
  options,
  onChange,
  disabled,
  testIdPrefix,
}: {
  value: V;
  options: ReadonlyArray<{ readonly value: V; readonly label: string }>;
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
        gap: 2,
        padding: 2,
        borderRadius: RADIUS.lg,
        backgroundColor: alpha(theme.input, 0.4),
        flexShrink: 0,
        alignSelf: "flex-start",
        opacity: disabled ? 0.64 : 1,
      }}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <div
            key={option.value}
            testId={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
            onClick={disabled ? undefined : () => onChange(option.value)}
            style={{
              display: "flex",
              alignItems: "center",
              height: 24,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: RADIUS.md,
              cursor: disabled ? "default" : "pointer",
              backgroundColor: pressed ? alpha(theme.input, 0.72) : "#00000000",
              ...(pressed || disabled ? {} : { hover: { backgroundColor: alpha(theme.input, 0.32) } }),
            }}
          >
            <Text size="xs" weight={500} color={pressed ? theme.foreground : theme.mutedForeground}>
              {option.label}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

/** Textarea (rounded-lg, input border, input/32 fill, 14px text). */
export function PrTextarea({
  value,
  onChange,
  placeholder,
  disabled,
  minRows = 3,
  maxRows = 12,
  autoFocus,
  testId,
  onKeyDown,
  size = "default",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minRows?: number;
  maxRows?: number;
  autoFocus?: boolean;
  testId?: string;
  onKeyDown?: (event: EventPayload) => void;
  size?: "default" | "sm";
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: theme.appearance === "dark" ? alpha(theme.input, 0.32) : theme.background,
        opacity: disabled ? 0.64 : 1,
        flexShrink: 0,
      }}
    >
      <textarea
        testId={testId}
        value={value}
        placeholder={placeholder}
        readOnly={disabled}
        minRows={minRows}
        maxRows={maxRows}
        autoFocus={autoFocus}
        onChange={(event) => onChange(String(event.value ?? ""))}
        {...(onKeyDown ? { onKeyDown } : {})}
        theme={{ caret: theme.foreground }}
        style={{
          flexGrow: 1,
          minWidth: 0,
          paddingLeft: size === "sm" ? 9 : 11,
          paddingRight: size === "sm" ? 9 : 11,
          paddingTop: size === "sm" ? 3 : 5,
          paddingBottom: size === "sm" ? 3 : 5,
          fontSize: 14,
          lineHeight: 20,
          fontFamily: FONTS.sans,
          color: theme.foreground,
        }}
      />
    </div>
  );
}

/** Input size="sm" (26 tall). */
let dbgInputRenders = 0;
export function PrInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  autoFocus,
  testId,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  testId?: string;
  onKeyDown?: (event: EventPayload) => void;
}) {
  const theme = useTheme();
  dbgInputRenders += 1;
  if (dbgInputRenders % 20 === 0) console.error("DBG input renders", dbgInputRenders);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 28,
        width: "100%",
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: theme.appearance === "dark" ? alpha(theme.input, 0.32) : theme.background,
        opacity: disabled ? 0.64 : 1,
        flexShrink: 0,
      }}
    >
      <input
        testId={testId}
        value={value}
        placeholder={placeholder}
        readOnly={disabled}
        autoFocus={autoFocus}
        onChange={(event) => {
          console.error("DBG input change", JSON.stringify(event.value));
          onChange(String(event.value ?? ""));
        }}
        {...(onSubmit ? { onSubmit: () => onSubmit() } : {})}
        {...(onKeyDown ? { onKeyDown } : {})}
        theme={{ caret: theme.foreground }}
        style={{
          flexGrow: 1,
          minWidth: 0,
          paddingLeft: 9,
          paddingRight: 9,
          fontSize: 14,
          lineHeight: 20,
          fontFamily: FONTS.sans,
          color: theme.foreground,
        }}
      />
    </div>
  );
}
