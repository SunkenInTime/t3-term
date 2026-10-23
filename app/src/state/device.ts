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
