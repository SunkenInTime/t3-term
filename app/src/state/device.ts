// apps/web/src/state/device.ts for the Device surface: device service state and
// commands per environment, and the device hub's stream access.
//
// The atom family itself lives with the Integrations settings page, which
// ported it first; this re-exports it so both read one subscription.
import { useAtomValue } from "@effect/atom-react";
import { type DeviceHubAccess, resolveDeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import { deviceEnvironment, EMPTY_DEVICE_STATE, useDeviceState } from "../settings/integrations/state.ts";
import { environmentSession } from "./environment.ts";
import type { DeviceTabTarget } from "./rightPanel.ts";

export { deviceEnvironment, EMPTY_DEVICE_STATE, useDeviceState };
export { formatEnvironmentQueryError } from "../settings/query.ts";

const deviceHubAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(get(environmentSession.preparedConnectionValueAtom(environmentId)));
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: EMPTY_DEVICE_STATE.hubBasePath });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`device-hub-access:${environmentId}`)),
);

const EMPTY_ACCESS_ATOM = Atom.make(AsyncResult.initial<DeviceHubAccess, never>()).pipe(
  Atom.withLabel("device-hub-access:empty"),
);

export function useDeviceHubAccess(environmentId: EnvironmentId | null, hostId = "local"): DeviceHubAccess | null {
  const result = useAtomValue(environmentId === null ? EMPTY_ACCESS_ATOM : deviceHubAccessAtom(environmentId));
  const value = AsyncResult.isSuccess(result) ? result.value : null;
  // Streams restart when access changes identity; web's compiler memoizes this, here it is explicit.
  return useMemo(() => (value ? { ...value, query: { ...value.query, hostId } } : null), [value, hostId]);
}

export function refreshDeviceHubAccess(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(deviceHubAccessAtom(environmentId));
}

/** Mints a fresh hub ticket for a one-off request that failed with 401. Resolves null on failure. */
export function renewDeviceHubAccess(environmentId: EnvironmentId, hostId = "local"): Promise<DeviceHubAccess | null> {
  const atom = deviceHubAccessAtom(environmentId);
  appAtomRegistry.refresh(atom);
  return Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, atom, { suspendOnWaiting: true }).pipe(
      Effect.map((access) => ({ ...access, query: { ...access.query, hostId } })),
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}

/** ChatOverlayHosts deviceSetupDialogAtom: the thread whose "Set up devices" dialog is open. */
export const deviceSetupDialogAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);

export function openDeviceSetupDialog(threadKey: string): void {
  appAtomRegistry.set(deviceSetupDialogAtom, threadKey);
}

// ── Floating device (previewMiniPlayerStore.ts, device sources) ─────────

export interface DeviceMiniPlayerState {
  readonly source: DeviceTabTarget;
  readonly position: { readonly x: number; readonly y: number } | null;
  readonly width: number | null;
  readonly lastInteraction: "drag" | "resize";
}

const deviceMiniPlayersAtom = Atom.make<Record<string, DeviceMiniPlayerState>>({}).pipe(Atom.keepAlive);

export const deviceMiniPlayerAtom = Atom.family((threadKey: string) =>
  Atom.make((get) => get(deviceMiniPlayersAtom)[threadKey] ?? null),
);

const sameDevice = (a: DeviceTabTarget, b: DeviceTabTarget) => a.hostId === b.hostId && a.deviceId === b.deviceId;

function updateDeviceMiniPlayer(
  threadKey: string,
  update: (current: DeviceMiniPlayerState | null) => DeviceMiniPlayerState | null,
): void {
  appAtomRegistry.update(deviceMiniPlayersAtom, (all) => {
    const current = all[threadKey] ?? null;
    const next = update(current);
    if (next === current) return all;
    if (next === null) {
      const { [threadKey]: _removed, ...rest } = all;
      return rest;
    }
    return { ...all, [threadKey]: next };
  });
}

export function openDeviceMiniPlayer(threadKey: string, source: DeviceTabTarget): void {
  updateDeviceMiniPlayer(threadKey, (current) =>
    current && sameDevice(current.source, source)
      ? current
      : { source, position: current?.position ?? null, width: current?.width ?? null, lastInteraction: current?.lastInteraction ?? "drag" },
  );
}

export function closeDeviceMiniPlayer(threadKey: string): void {
  updateDeviceMiniPlayer(threadKey, () => null);
}

export function moveDeviceMiniPlayer(threadKey: string, source: DeviceTabTarget, position: { x: number; y: number }): void {
  updateDeviceMiniPlayer(threadKey, (current) =>
    !current || !sameDevice(current.source, source) ? current : { ...current, position, lastInteraction: "drag" },
  );
}

export function resizeDeviceMiniPlayer(
  threadKey: string,
  source: DeviceTabTarget,
  width: number,
  position?: { x: number; y: number },
): void {
  updateDeviceMiniPlayer(threadKey, (current) =>
    !current || !sameDevice(current.source, source)
      ? current
      : { ...current, width, position: position ?? current.position, lastInteraction: "resize" },
  );
}
