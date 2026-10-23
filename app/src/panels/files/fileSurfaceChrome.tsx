// Port of apps/web/src/components/files/fileSurfaceChrome.tsx. The web subheader class
// (h-10, border-b) collapses in the inline right panel to h-7 with mb-3 and no border; the
// right panel is always inline here, so only that form exists.
import type { ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";

/** FILE_SURFACE_SUBHEADER_CLASS, inline: h-7 mb-3 px-3 gap-2. */
export function FileSurfaceSubheader(props: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 28,
        flexShrink: 0,
        marginBottom: 12,
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * A ghost icon-sm button, or a ghost sm Toggle when `pressed` is set (28×28, radius 8,
 * pressed bg accent, 14px icon at 80%).
 */
export function FileSurfaceAction(props: {
  readonly label: string;
  readonly icon: IconName;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly testId?: string;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={props.label}>
      <div
        testId={props.testId}
        aria-label={props.label}
        role="button"
        onClick={props.disabled ? undefined : props.onPress}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: RADIUS.md,
          backgroundColor: props.pressed ? theme.accent : "#00000000",
          opacity: props.disabled ? 0.64 : 1,
          cursor: props.disabled ? "default" : "pointer",
          ...(props.disabled ? {} : { hover: { backgroundColor: theme.accent } }),
        }}
      >
        <Icon name={props.icon} size={14} color={alpha(theme.foreground, 0.8)} />
      </div>
    </Tooltip>
  );
}

/** border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-2xs text-warning-foreground */
export function FileSurfaceNotice(props: { readonly children: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        flexShrink: 0,
        borderBottomWidth: 1,
        borderColor: alpha(theme.warning, 0.2),
        backgroundColor: alpha(theme.warning, theme.appearance === "dark" ? 0.08 : 0.06),
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 6,
        paddingBottom: 6,
      }}
    >
      <Text size="2xs" color={theme.warningForeground}>
        {props.children}
      </Text>
    </div>
  );
}

/**
 * The web shows a spinning Spinner here. T3 forbids continuously repainting
 * animations in this port, so the loader glyph stays still.
 */
export function FileSurfaceLoading() {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center" }}>
      <Icon name="loader-circle" size={24} color={theme.mutedForeground} />
    </div>
  );
}

export function FileSurfaceFailure(props: { readonly message: string; readonly onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        paddingLeft: 24,
        paddingRight: 24,
      }}
    >
      <Text size="xs" color={theme.errorForeground} style={{ textAlign: "center", lineHeight: 19.5 }}>
        {props.message}
      </Text>
      {props.onRetry ? (
        <div
          onClick={props.onRetry}
          style={{
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 4,
            paddingBottom: 4,
            borderRadius: RADIUS.sm,
            borderWidth: 1,
            borderColor: theme.input,
            cursor: "pointer",
            hover: { backgroundColor: theme.accent },
          }}
        >
          <Text size="xs">Try again</Text>
        </div>
      ) : null}
    </div>
  );
}
