// Dialog parts shared by the app-level dialogs, transcribed from
// apps/web/src/components/ui/{dialog,alert-dialog,input,toggle-group,toggle,label}.tsx.
// The ui kit's Dialog fixes header/footer layout and has no close button or
// initial-focus target, which these dialogs need, so they compose the gpuix
// primitive directly with the same surface styles.
import * as DialogPrimitive from "@gpuix/react/dialog";
import type { PublicInstance } from "@gpuix/react";
import { useState, type ReactNode, type RefObject } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { IconButton, Text, type Style } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";

/** Tailwind max-w-* values the web dialogs use. */
export const DIALOG_WIDTH = { sm: 384, lg: 512, xl: 576 } as const;

export function DialogShell({
  onOpenChange,
  width,
  testId,
  initialFocus,
  showCloseButton = true,
  children,
}: {
  onOpenChange: (open: boolean) => void;
  width: number;
  testId?: string;
  initialFocus?: RefObject<PublicInstance | null>;
  showCloseButton?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  return (
    <DialogPrimitive.Root open onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: theme.overlay,
            pointerEvents: "auto",
          }}
        />
        <DialogPrimitive.Popup
          testId={testId}
          {...(initialFocus ? { initialFocus } : {})}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            width,
            maxWidth: "92%",
            maxHeight: "96%",
            borderRadius: RADIUS["2xl"],
            borderWidth: 1,
            borderColor: dark ? alpha("#ffffff", 0.08) : alpha(theme.foreground, 0.1),
            backgroundColor: dark ? "#0f0f0f" : "#ffffff",
            boxShadow: { offsetX: 0, offsetY: 24, blurRadius: 72, spreadRadius: -20, color: "#000000e6" },
            overflow: "hidden",
          }}
        >
          {children}
          {showCloseButton ? (
            <div style={{ position: "absolute", top: 8, right: 8 }}>
              <IconButton
                icon="x"
                size={32}
                iconSize={16}
                testId={testId ? `${testId}-close` : undefined}
                onClick={() => onOpenChange(false)}
              />
            </div>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** DialogHeader: p-6, gap-2; pb-3 when a panel follows. Title is text-xl leading-none semibold. */
export function DialogHeader({
  title,
  icon,
  description,
  hasPanel,
}: {
  title: string;
  icon?: ReactNode;
  description?: string | null;
  hasPanel: boolean;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        paddingTop: 24,
        paddingLeft: 24,
        paddingRight: 24,
        paddingBottom: hasPanel ? 12 : 24,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        {icon}
        <text
          style={{
            color: theme.foreground,
            fontSize: 20,
            lineHeight: 20,
            fontWeight: 600,
            fontFamily: FONTS.sans,
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {title}
        </text>
      </div>
      {description ? <MultilineText color={theme.mutedForeground}>{description}</MultilineText> : null}
    </div>
  );
}

/** whitespace-pre-line: gpuix text has no pre, so each line is its own block. */
export function MultilineText({ children, color, size = "sm" }: { children: string; color: string; size?: "xs" | "sm" }) {
  const lines = children.split("\n");
  if (lines.length === 1) {
    return (
      <Text size={size} color={color}>
        {children}
      </Text>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {lines.map((line, index) => (
        <div key={index} style={{ minHeight: size === "sm" ? 20 : 16 }}>
          <Text size={size} color={color}>
            {line}
          </Text>
        </div>
      ))}
    </div>
  );
}

/** DialogPanel: p-6 with pt-1 under a header, space-y-4 between children. */
export function DialogPanel({ children, gap = 16 }: { children: ReactNode; gap?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap,
        paddingTop: 4,
        paddingLeft: 24,
        paddingRight: 24,
        paddingBottom: 24,
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}

/** DialogFooter: border-t, bg-muted/72, py-4 px-6, buttons end-aligned with gap-2. */
export function DialogFooter({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 8,
        paddingTop: 16,
        paddingBottom: 16,
        paddingLeft: 24,
        paddingRight: 24,
        borderTopWidth: 1,
        borderColor: theme.border,
        backgroundColor: alpha(theme.muted, 0.72),
        // sm:rounded-b-[calc(var(--radius-2xl)-1px)]: the popup's overflow clip is
        // rectangular, so the footer fill rounds its own corners.
        borderBottomLeftRadius: RADIUS["2xl"] - 1,
        borderBottomRightRadius: RADIUS["2xl"] - 1,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

/** Label: text-sm/4 medium foreground. */
export function FieldLabel({ children, style }: { children: ReactNode; style?: Style }) {
  return (
    <Text weight={500} style={{ lineHeight: 16, ...style }}>
      {children}
    </Text>
  );
}

/**
 * The border, fill and focus ring of web's input-control (border input,
 * bg input/32, focus: border ring + 3px inset ring/24). Children sit inside the
 * ring so text keeps its position when focus changes.
 */
export function FieldFrame({
  focused,
  invalid,
  children,
  height = 32,
  style,
  testId,
  onClick,
}: {
  focused: boolean;
  invalid?: boolean;
  children: ReactNode;
  height?: number;
  style?: Style;
  testId?: string;
  onClick?: () => void;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  const ringColor = invalid ? theme.error : theme.primary;
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        height,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: focused ? (invalid ? alpha(theme.error, 0.64) : theme.primary) : invalid ? alpha(theme.error, 0.36) : theme.input,
        backgroundColor: dark ? alpha(theme.input, 0.32) : theme.background,
        flexShrink: 0,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          flexGrow: 1,
          minWidth: 0,
          borderRadius: RADIUS.lg - 1,
          borderWidth: 3,
          borderColor: focused ? alpha(ringColor, invalid ? 0.24 : 0.24) : "#00000000",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** apps/web/src/components/ui/input.tsx at its desktop size: 32 tall, px 11, 14px. */
export function TextField({
  value,
  onChange,
  onSubmit,
  placeholder,
  inputRef,
  testId,
  mono,
  invalid,
  trailing,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  inputRef?: RefObject<PublicInstance | null>;
  testId?: string;
  mono?: boolean;
  invalid?: boolean;
  trailing?: ReactNode;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <FieldFrame focused={focused} invalid={invalid}>
      <input
        ref={inputRef}
        testId={testId}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        theme={{ caret: theme.foreground }}
        onChange={(event) => onChange(String(event.value ?? ""))}
        onSubmit={onSubmit ? () => onSubmit() : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flexGrow: 1,
          minWidth: 0,
          height: 24,
          paddingLeft: 8,
          paddingRight: 8,
          fontSize: 14,
          color: theme.foreground,
          fontFamily: mono ? FONTS.mono : FONTS.sans,
        }}
      />
      {trailing}
    </FieldFrame>
  );
}

export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: string;
}

/**
 * ToggleGroup variant="segmented": a rounded-lg input/40 track with 2px
 * padding; each toggle is 24 tall, rounded-md, px 10, 14px medium; the pressed
 * one fills with input/72 and turns foreground.
 */
export function SegmentedToggle<V extends string>({
  value,
  options,
  onChange,
  fill,
  testId,
}: {
  value: V | null;
  options: ReadonlyArray<SegmentedOption<V>>;
  onChange: (value: V) => void;
  fill?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignSelf: fill ? "stretch" : "flex-start",
        gap: 2,
        padding: 2,
        borderRadius: RADIUS.lg,
        backgroundColor: alpha(theme.input, 0.4),
        flexShrink: 0,
      }}
    >
      {options.map((option) => (
        <SegmentedItem
          key={option.value}
          label={option.label}
          pressed={option.value === value}
          fill={fill}
          testId={testId ? `${testId}-${option.value}` : undefined}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

function SegmentedItem({
  label,
  pressed,
  fill,
  testId,
  onClick,
}: {
  label: string;
  pressed: boolean;
  fill?: boolean;
  testId?: string;
  onClick: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 24,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.sm,
        flexGrow: fill ? 1 : 0,
        ...(fill ? { flexBasis: 0 } : {}),
        cursor: "pointer",
        backgroundColor: pressed
          ? alpha(theme.input, 0.72)
          : hovered
            ? alpha(theme.input, 0.32)
            : "#00000000",
      }}
    >
      <Text weight={500} color={pressed || hovered ? theme.foreground : theme.mutedForeground}>
        {label}
      </Text>
    </div>
  );
}

/** text-destructive text-xs, the validation line under a field. */
export function ErrorLine({ children, size = "xs", color }: { children: string; size?: "xs" | "sm"; color?: string }) {
  const theme = useTheme();
  return (
    <Text size={size} color={color ?? theme.error}>
      {children}
    </Text>
  );
}

export function TitleIcon({ name, svgSource }: { name?: IconName; svgSource?: string }) {
  const theme = useTheme();
  if (svgSource) {
    return <svg source={svgSource} style={{ width: 16, height: 16, flexShrink: 0, color: theme.foreground }} />;
  }
  return name ? <Icon name={name} size={16} color={theme.foreground} /> : null;
}
