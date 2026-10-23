// apps/web/src/components/ui/standalone-page.tsx and the small controls the
// pairing surfaces put inside it (ui/alert.tsx, ui/input.tsx, CommandBlock.tsx).
import type { ReactNode } from "react";

import { Text, type Style } from "../ui/primitives.tsx";
import { FONTS, RADIUS, TEXT, alpha, useTheme } from "../ui/theme.ts";

/**
 * tone "pairing". The web backdrop's emerald and sky radial washes are left out:
 * gpuix paints only two-stop linear gradients, and at 80% opacity they are
 * barely visible on the dark theme anyway. The 145deg darkening is kept.
 */
export function StandalonePage({ children }: { readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: theme.background,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity: 0.8,
          pointerEvents: "none",
          background: {
            type: "linear-gradient",
            angle: 145,
            stops: [
              { color: mixWithBlack(theme.background, 0.1), position: 0 },
              { color: theme.background, position: 0.55 },
            ],
          },
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: 40,
          paddingBottom: 40,
          paddingLeft: 24,
          paddingRight: 24,
          overflowY: "scroll",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            maxWidth: 576,
            flexShrink: 0,
            padding: 32,
            borderRadius: RADIUS["2xl"],
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.8),
            backgroundColor: alpha(theme.card, 0.9),
            boxShadow: { offsetX: 0, offsetY: 25, blurRadius: 50, spreadRadius: -12, color: "#00000033" },
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function StandalonePageHeader({
  eyebrow,
  title,
  description,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
}) {
  const theme = useTheme();
  return (
    <>
      <Text color={theme.mutedForeground} weight={600} style={{ fontSize: 11, lineHeight: 16 }}>
        {tracked(eyebrow.toUpperCase())}
      </Text>
      <Text size="3xl" weight={600} style={{ marginTop: 12 }}>
        {title}
      </Text>
      <Text color={theme.mutedForeground} style={{ marginTop: 8, lineHeight: 23 }}>
        {description}
      </Text>
    </>
  );
}

/** `<Alert variant="error"><AlertDescription>`: rounded-xl, error/32 border, error-surface fill. */
export function ErrorAlert({ children, style }: { readonly children: string; readonly style?: Style }) {
  const theme = useTheme();
  return (
    <div
      style={{
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: alpha(theme.error, 0.32),
        backgroundColor: alpha(theme.error, theme.appearance === "dark" ? 0.16 : 0.08),
        ...style,
      }}
    >
      <Text color={alpha(theme.errorForeground, 0.8)}>{children}</Text>
    </div>
  );
}

/** A labelled `<Input>`: rounded-lg, border-input, input/32 fill, 30px tall field. */
export function TextField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onSubmit,
  testId,
  autoFocus,
  style,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: () => void;
  readonly testId: string;
  readonly style?: Style;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, ...style }}>
      <Text size="xs" weight={500} style={{ marginBottom: 6 }}>
        {label}
      </Text>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: 32,
          paddingLeft: 11,
          paddingRight: 11,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: theme.input,
          backgroundColor: alpha(theme.input, 0.32),
          opacity: disabled ? 0.64 : 1,
        }}
      >
        <input
          testId={testId}
          value={value}
          placeholder={placeholder}
          readOnly={disabled}
          autoFocus={autoFocus}
          theme={{ caret: theme.foreground, textMuted: alpha(theme.mutedForeground, 0.72) }}
          style={{
            width: "100%",
            fontSize: TEXT.sm[0],
            lineHeight: 30,
            fontFamily: FONTS.sans,
            color: theme.foreground,
          }}
          onChange={(event: { value?: string }) => onChange(event.value ?? "")}
          {...(onSubmit ? { onSubmit: () => onSubmit() } : {})}
        />
      </div>
    </div>
  );
}

/**
 * CommandBlock without its copy button: gpuix has no clipboard API, so the
 * command is selectable text instead.
 */
export function CommandLine({ command, style }: { readonly command: string; readonly style?: Style }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: alpha(theme.muted, 0.5),
        ...style,
      }}
    >
      <Text mono color={theme.mutedForeground} style={{ marginRight: 8 }}>
        $
      </Text>
      <Text mono truncate style={{ userSelect: "text" }}>
        {command}
      </Text>
    </div>
  );
}

// Web sets tracking-[0.18em] on the eyebrow; gpuix has no letter-spacing, so a
// thin space between letters stands in for it.
function tracked(text: string): string {
  return [...text].join(" ");
}

function mixWithBlack(color: string, amount: number): string {
  const channel = (offset: number) =>
    Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}
