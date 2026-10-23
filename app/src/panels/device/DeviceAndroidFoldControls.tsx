// Port of apps/web/src/components/device/DeviceAndroidFoldControls.tsx: fold and
// unfold buttons under the controls rail, shown only for foldable emulators.
// The 3D view's hinge angle (`onFoldAngle`) has no consumer here.
import type { DeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import { useEffect, useRef, useState } from "react";

import { Tooltip } from "../../ui/overlay.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import {
  AndroidFoldError,
  readAndroidFold,
  setAndroidFold,
  type AndroidFoldPosture,
  type AndroidFoldState,
} from "../../web/components/device/deviceFold.ts";

/** DeviceDuoGlyph's "closed" and "open" poses, as monochrome SVG for gpuix. */
const GLYPHS = {
  closed:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="5.8" y="3" width="12.4" height="18" rx="2.2"/><circle cx="15.4" cy="5.7" r=".6" fill="#000" stroke="none"/><path d="M10.6 18.2h2.8"/></svg>',
  open: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M10.5 16.3h3"/></svg>',
} as const;

export function DeviceAndroidFoldControls(props: {
  readonly access: DeviceHubAccess;
  readonly deviceId: string;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly screenWidth: number | undefined;
  readonly screenHeight: number | undefined;
  readonly renewAccess: () => Promise<DeviceHubAccess | null>;
}) {
  const theme = useTheme();
  const [fold, setFold] = useState<AndroidFoldState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const { access, deviceId, visible, enabled, screenWidth, screenHeight } = props;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible || !enabled || pending || !screenWidth || !screenHeight) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      void readAndroidFold(access, deviceId, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setFold(next);
        })
        .catch((cause: unknown) => {
          // Retrying an expired ticket cannot succeed. New access re-runs this effect.
          const expired = cause instanceof AndroidFoldError && cause.status === 401;
          if (!controller.signal.aborted && !expired) retry = setTimeout(read, 3_000);
        });
    };
    read();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [access, deviceId, visible, enabled, screenWidth, screenHeight, pending]);

  if (!fold?.supported || !props.visible) return null;

  const change = (posture: AndroidFoldPosture) => {
    if (busy.current || !props.enabled) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const send = (next: DeviceHubAccess) => setAndroidFold(next, props.deviceId, posture, controller.signal);
    void send(props.access)
      .catch(async (cause: unknown) => {
        // Hub tickets expire after a few minutes, while the panel stays open much longer.
        if (!(cause instanceof AndroidFoldError && cause.status === 401)) throw cause;
        const renewed = await props.renewAccess();
        if (!renewed || controller.signal.aborted) throw cause;
        return send(renewed);
      })
      .then((next) => {
        if (mounted.current) setFold(next);
      })
      .catch((cause: unknown) => {
        if (mounted.current) {
          setError(
            controller.signal.aborted
              ? "Fold command timed out."
              : cause instanceof Error
                ? cause.message
                : "Could not change fold posture.",
          );
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        busy.current = false;
        if (mounted.current) setPending(false);
      });
  };

  const button = (posture: AndroidFoldPosture, label: string, glyph: keyof typeof GLYPHS) => {
    const pressed = fold.posture === posture;
    const disabled = pending || !props.enabled;
    return (
      <Tooltip content={label} side="left">
        <div
          testId={`device-fold-${posture}`}
          onClick={disabled ? undefined : () => change(posture)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: pressed ? theme.secondary : "#00000000",
            opacity: disabled ? 0.64 : 1,
            cursor: disabled ? "default" : "pointer",
            ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
          }}
        >
          <svg source={GLYPHS[glyph]} style={{ width: 28, height: 28, color: theme.foreground }} />
        </div>
      </Tooltip>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: 4,
          borderRadius: 9999,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.5),
          backgroundColor: alpha(theme.background, 0.8),
          pointerEvents: "auto",
        }}
      >
        {button("closed", "Fold device", "closed")}
        {button("opened", "Unfold device", "open")}
      </div>
      {error ? (
        <Tooltip content={error} side="left">
          <text style={{ color: theme.errorForeground, fontSize: 12, lineHeight: 16 }}>!</text>
        </Tooltip>
      ) : null}
    </div>
  );
}
