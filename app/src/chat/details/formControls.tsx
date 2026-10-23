// Small form pieces the details card dialogs need (web: ui/checkbox, ui/input, ui/textarea, ui/label).
import type { EventPayload } from "@gpuix/native";
import type { ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Text, type Style } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

/** ui/checkbox.tsx: 16px, radius 4, primary fill when checked, a dash when indeterminate. */
export function Checkbox({
  checked,
  indeterminate,
  onChange,
  testId,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const filled = checked || indeterminate;
  return (
    <div
      testId={testId}
      onClick={onChange}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: 4,
        flexShrink: 0,
        borderWidth: filled ? 0 : 1,
        borderColor: theme.input,
        backgroundColor: filled ? theme.primary : alpha(theme.input, 0.32),
        cursor: "pointer",
      }}
    >
      {indeterminate ? (
        <div style={{ width: 8, height: 2, borderRadius: 1, backgroundColor: theme.primaryForeground, pointerEvents: "none" }} />
      ) : checked ? (
        <Icon name="check" size={12} strokeWidth={3} color={theme.primaryForeground} />
      ) : null}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" weight={500}>
      {children}
    </Text>
  );
}

/** ui/input.tsx: 32 tall (sm), radius 8, border input, dark fill input/32. */
export function TextField({
  value,
  onChange,
  placeholder,
  onSubmit,
  mono,
  testId,
  autoFocus,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  mono?: boolean;
  testId?: string;
  autoFocus?: boolean;
  style?: Style;
}) {
  const theme = useTheme();
  return (
    <input
      testId={testId}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(event: EventPayload) => onChange(String(event.value ?? ""))}
      {...(onSubmit ? { onSubmit } : {})}
      theme={{ caret: theme.foreground }}
      style={{
        height: 32,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: theme.appearance === "dark" ? alpha(theme.input, 0.32) : theme.background,
        color: theme.foreground,
        fontSize: 14,
        fontFamily: mono ? FONTS.mono : FONTS.sans,
        ...style,
      }}
    />
  );
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  testId,
  minRows = 3,
  maxRows = 8,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
  minRows?: number;
  maxRows?: number;
}) {
  const theme = useTheme();
  return (
    <textarea
      testId={testId}
      value={value}
      placeholder={placeholder}
      minRows={minRows}
      maxRows={maxRows}
      onChange={(event: EventPayload) => onChange(String(event.value ?? ""))}
      theme={{ caret: theme.foreground }}
      style={{
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: theme.appearance === "dark" ? alpha(theme.input, 0.32) : theme.background,
        color: theme.foreground,
        fontSize: 14,
        lineHeight: 20,
        fontFamily: FONTS.sans,
      }}
    />
  );
}
