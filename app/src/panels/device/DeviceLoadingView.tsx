// Port of apps/web/src/components/device/DeviceLoadingView.tsx. Web's spinner
// is a static loader glyph here: T3 forbids continuously repainting animations.
import type { ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";

export function DeviceLoadingView(props: {
  readonly name: string;
  readonly description?: string;
  readonly stage: "opening" | "stream";
  readonly message: string;
  readonly error?: boolean;
  readonly children?: ReactNode;
  readonly testId?: string;
  /** Rounds the backdrop inside the floating player, whose clip does not round children. */
  readonly radius?: number;
}) {
  const theme = useTheme();
  return (
    <div
      testId={props.testId}
      style={{
        display: "flex",
        flexGrow: 1,
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.background,
        ...(props.radius ? { borderRadius: props.radius } : {}),
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 40,
        paddingBottom: 40,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%", maxWidth: 384 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 48,
            height: 48,
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: alpha(theme.muted, 0.3),
          }}
        >
          <Icon name="smartphone" size={24} color={theme.mutedForeground} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <Text weight={500} style={{ textAlign: "center" }}>
            {props.name}
          </Text>
          {props.description ? (
            <Text size="xs" color={theme.mutedForeground} style={{ textAlign: "center" }}>
              {props.description}
            </Text>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "100%" }}>
          {!props.error ? <Icon name="loader-circle" size={12} color={theme.mutedForeground} /> : null}
          <Text size="xs" color={theme.mutedForeground} style={{ textAlign: "center", flexShrink: 1, minWidth: 0 }}>
            {props.message}
          </Text>
        </div>
        {props.children}
        {!props.error ? (
          <div style={{ display: "flex", flexDirection: "row", width: 96, gap: 4 }}>
            <div style={{ height: 4, flexGrow: 1, flexBasis: 0, borderRadius: 2, backgroundColor: alpha(theme.foreground, 0.6) }} />
            <div
              style={{
                height: 4,
                flexGrow: 1,
                flexBasis: 0,
                borderRadius: 2,
                backgroundColor: props.stage === "stream" ? alpha(theme.foreground, 0.6) : theme.muted,
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
