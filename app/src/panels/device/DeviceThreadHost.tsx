// What web's ChatView does for devices of the active thread:
// - DeviceSetupDialogHost (components/chat/ChatOverlayHosts.tsx): the setup
//   wizard the Device action opens while the hub is off or not onboarded.
// - useAgentOpenedPreviews (device half): a device session an agent opens for
//   this thread opens its tab, unless the user closed that tab before. The
//   first session list is a baseline, so a restart reopens nothing.
import { useAtom, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { deviceSetupDialogAtom, useDeviceState } from "../../state/device.ts";
import { rightPanelActions, rightPanelThreadStateAtom, threadKeyOf } from "../../state/rightPanel.ts";
import { DeviceSetupDialog } from "./DeviceSetup.tsx";

export function DeviceThreadHost({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const threadKey = threadKeyOf(environmentId, threadId);
  const { state, loaded } = useDeviceState(environmentId);
  const [dialogThread, setDialogThread] = useAtom(deviceSetupDialogAtom);
  const panel = useAtomValue(rightPanelThreadStateAtom(threadKey));

  const previousSessions = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    if (!loaded) return;
    const key = (session: { hostId: string; deviceId: string }) => `${session.hostId}\u0000${session.deviceId}`;
    const deviceFor = (session: { hostId: string; deviceId: string }) =>
      state.devices.find((device) => device.hostId === session.hostId && device.id === session.deviceId);
    const sessions = state.sessions.filter((session) => session.threadId === threadId);
    const previous = previousSessions.current.get(threadKey);
    previousSessions.current.set(threadKey, new Set(sessions.filter((session) => deviceFor(session) !== undefined).map(key)));
    if (!previous) return;
    for (const session of sessions) {
      if (previous.has(key(session))) continue;
      const device = deviceFor(session);
      if (!device) continue;
      const existing = panel.surfaces.some(
        (surface) => surface.kind === "device" && surface.target?.hostId === session.hostId && surface.target.deviceId === session.deviceId,
      );
      if (existing) continue;
      rightPanelActions.openDevice(
        threadKey,
        { hostId: session.hostId, deviceId: session.deviceId, platform: device.platform, name: device.name },
        true,
      );
    }
  }, [loaded, state.sessions, state.devices, threadKey]);

  return (
    <DeviceSetupDialog
      open={dialogThread === threadKey}
      onOpenChange={(open) => {
        if (!open) setDialogThread(null);
      }}
      environmentId={environmentId}
      state={state}
      onComplete={() => {
        rightPanelActions.open(threadKey, "device");
        setDialogThread(null);
      }}
    />
  );
}
