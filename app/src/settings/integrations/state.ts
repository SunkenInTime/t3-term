// apps/web/src/state/device.ts for the Integrations page: device service state
// and commands per environment. Settings-local until the app has a shared
// device state module.
import { createDeviceEnvironmentAtoms } from "@t3tools/client-runtime/state/device";
import type { DeviceServiceState, EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../runtime/runtime.ts";
import { environmentAtomList } from "../../state/settings.ts";
import { useEnvironmentQuery } from "../query.ts";

export const deviceEnvironment = createDeviceEnvironmentAtoms(connectionAtomRuntime);

export const EMPTY_DEVICE_STATE: DeviceServiceState = {
  hosts: [],
  hostStatus: "disabled",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: false,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 0,
};

export function useDeviceState(environmentId: EnvironmentId | null): {
  readonly state: DeviceServiceState;
  readonly loaded: boolean;
} {
  const query = useEnvironmentQuery(environmentId === null ? null : deviceEnvironment.state({ environmentId, input: {} }));
  return { state: query.data ?? EMPTY_DEVICE_STATE, loaded: query.data !== null };
}

/** DeviceHostsSettings.tsx deviceHostStatesAtom: one device state per listed environment. */
export const deviceHostStatesAtom = environmentAtomList("t3term-device-host-states", (environmentId) =>
  deviceEnvironment.state({ environmentId, input: {} }),
);
