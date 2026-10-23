// Port of apps/web/src/components/device/DevicePanel.tsx: the Device surface.
// Lists the environment's simulators and emulators, opens one for this thread,
// and shows it in DeviceWorkspace; while the device hub is off or onboarding
// is unfinished it shows the setup wizard instead.
import type { DevicePlatform, DeviceServiceState, DeviceSummary, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useState, type ReactNode } from "react";

import { deviceEnvironment, formatEnvironmentQueryError, useDeviceState } from "../../state/device.ts";
import { rightPanelActions, threadKeyOf, type RightPanelSurface } from "../../state/rightPanel.ts";
import { useAtomCommand } from "../../state/settings.ts";
import { deviceHubReadiness, DeviceHostUpdates, isAndroidDiscoveryUncertain } from "../../settings/integrations/DeviceParts.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { alpha, RADIUS, useTheme } from "../../ui/theme.ts";
import { DeviceLoadingView } from "./DeviceLoadingView.tsx";
import { DeviceSetupDialog } from "./DeviceSetup.tsx";
import { DeviceWorkspace } from "./DeviceWorkspace.tsx";

const platformLabel = (platform: DevicePlatform) => (platform === "ios" ? "iOS Simulators" : "Android Emulators");

const deviceKey = (device: Pick<DeviceSummary, "hostId" | "id">) => `${device.hostId}\u0000${device.id}`;

export function DevicePanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly surface: Extract<RightPanelSurface, { kind: "device" }>;
  readonly visible: boolean;
  readonly onDismissSetup: () => void;
}) {
  const theme = useTheme();
  const { environmentId, threadId } = props;
  const threadKey = threadKeyOf(environmentId, threadId);
  const { state, loaded } = useDeviceState(environmentId);
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const open = useAtomCommand(deviceEnvironment.open);
  const close = useAtomCommand(deviceEnvironment.close);
  // The panel stays mounted across thread switches, so an in-flight open or
  // power-off is tagged with the thread it belongs to and only shown there.
  const scope = `${environmentId}\u0000${threadId}`;
  const [operation, setOperation] = useState<{
    readonly scope: string;
    readonly pending: DeviceSummary | null;
    readonly error: string | null;
  } | null>(null);
  const pendingDevice = operation?.scope === scope ? operation.pending : null;
  const operationError = operation?.scope === scope ? operation.error : null;
  const pendingDeviceKey = pendingDevice ? deviceKey(pendingDevice) : null;

  const hostDisabled = state.hostStatus === "disabled";

  // Opening setup never grants permission to install or start helpers.
  useEffect(() => {
    if (!props.visible || !loaded || hostDisabled) return;
    void list({ environmentId, input: {} });
  }, [environmentId, loaded, props.visible, hostDisabled]);

  const sessions = state.sessions.filter((session) => session.threadId === threadId);
  const target = props.surface.target;
  const activeSession = target
    ? sessions.find((session) => session.deviceId === target.deviceId && session.hostId === target.hostId)
    : undefined;
  const activeDevice = activeSession
    ? state.devices.find((device) => device.hostId === activeSession.hostId && device.id === activeSession.deviceId)
    : undefined;

  const grouped = groupDevices(state);

  const startOperation = (pending: DeviceSummary | null) => {
    const started = { scope, pending, error: null };
    setOperation(started);
    // Returning to the same thread can start a newer operation before this one settles.
    return (error: string | null) =>
      setOperation((current) => (current === started ? { ...started, pending: null, error } : current));
  };

  const selectDevice = async (device: DeviceSummary) => {
    const settleOperation = startOperation(device);
    const result = await open({
      environmentId,
      input: { threadId, hostId: device.hostId, deviceId: device.id, platform: device.platform },
    });
    if (result._tag === "Failure") settleOperation(formatEnvironmentQueryError(result.cause));
    else {
      // The server opened the device for the starting thread, so its tab opens there.
      rightPanelActions.openDevice(threadKey, {
        hostId: result.value.hostId,
        deviceId: result.value.deviceId,
        platform: device.platform,
        name: device.name,
      });
      settleOperation(null);
    }
  };

  const closeActive = (powerOff: boolean) => {
    if (!powerOff) {
      rightPanelActions.close(threadKey, props.surface.id);
      return;
    }
    if (!activeSession) return;
    const settleOperation = startOperation(null);
    void close({
      environmentId,
      input: { threadId, hostId: activeSession.hostId, deviceId: activeSession.deviceId, shutdown: powerOff },
    }).then((result) => {
      if (result._tag === "Failure") settleOperation(formatEnvironmentQueryError(result.cause));
      else rightPanelActions.close(threadKey, props.surface.id);
    });
  };

  const bootingDevices = state.bootingDevices?.filter((device) => device.threadId === threadId) ?? [];
  const { ready: hostReady, busy: hostBusy } = deviceHubReadiness(state);
  const loading = !activeDevice && (pendingDevice !== null || hostBusy || !loaded);
  const diagnostics = state.hosts.flatMap((host) => {
    const status = state.hostStatuses[host.id];
    const detail = status?.detail ?? (host.kind === "local" ? state.hostStatusDetail : undefined);
    return detail && (status?.status ?? state.hostStatus) === "ready" ? [{ hostId: host.id, label: host.label, detail }] : [];
  });
  const unavailablePlatforms = state.hosts.flatMap((host) =>
    host.platforms
      .filter((platform) => !platform.available)
      .map((platform) => ({ ...platform, hostId: host.id, hostLabel: host.label })),
  );

  if (loaded && (!state.onboardingCompleted || hostDisabled)) {
    return (
      <DeviceSetupDialog
        open={props.visible}
        onOpenChange={(isOpen) => {
          if (!isOpen) props.onDismissSetup();
        }}
        environmentId={environmentId}
        state={state}
      />
    );
  }

  const notices = (
    <>
      {activeDevice
        ? null
        : diagnostics.map((diagnostic) => (
            <DeviceDiscoveryWarning
              key={`${environmentId}\u0000${diagnostic.hostId}\u0000${diagnostic.detail}`}
              label={diagnostic.label}
              detail={diagnostic.detail}
            />
          ))}
      <DeviceHostUpdates state={state} environmentId={environmentId} />
      {bootingDevices.length > 0 ? (
        <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderColor: theme.border }}>
          <Text size="xs" color={theme.mutedForeground}>
            {`Starting ${bootingDevices.map((device) => device.name).join(", ")}… This can take a minute.`}
          </Text>
        </div>
      ) : null}
      {operationError ? (
        <DeviceNotice tone="error" onDismiss={() => setOperation(null)}>
          <Text size="xs" color={theme.errorForeground}>
            {operationError}
          </Text>
        </DeviceNotice>
      ) : null}
    </>
  );

  return (
    <div testId="device-panel" style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      {loading ? null : <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, backgroundColor: theme.background }}>{notices}</div>}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
        {activeDevice && activeSession ? (
          <DeviceWorkspace
            key={`${environmentId}\u0000${deviceKey(activeDevice)}`}
            environmentId={environmentId}
            device={activeDevice}
            hostLabel={state.hosts.find((host) => host.id === activeDevice.hostId)?.label ?? "Device host"}
            hostDiagnostics={diagnostics.find(({ hostId }) => hostId === activeDevice.hostId)?.detail}
            visible={props.visible}
            onClose={() => closeActive(false)}
            onPowerOff={() => closeActive(true)}
          />
        ) : loading ? (
          <DeviceLoadingView
            testId="device-loading"
            name={pendingDevice?.name ?? "Devices"}
            description={
              pendingDevice
                ? `${state.hosts.find((host) => host.id === pendingDevice.hostId)?.label ?? "Device host"} · ${pendingDevice.version}`
                : ""
            }
            stage="opening"
            message={
              pendingDevice
                ? pendingDevice.booted
                  ? "Opening device…"
                  : "Starting device…"
                : state.hostStatus === "installing"
                  ? (state.hostStatusDetail ?? "Installing device support…")
                  : "Finding devices…"
            }
          />
        ) : (
          <div
            testId="device-list"
            style={{
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              minHeight: 0,
              overflowY: "scroll",
              scrollbarColor: theme.scrollbar,
              paddingLeft: 20,
              paddingRight: 20,
              paddingTop: 32,
              paddingBottom: 32,
              ...(grouped.length === 0 ? { justifyContent: "center" } : {}),
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 24,
                width: "100%",
                maxWidth: 576,
                alignSelf: "center",
                ...(grouped.length === 0 ? { alignItems: "center" } : {}),
              }}
            >
              {grouped.length === 0 ? (
                <>
                  <Icon name="smartphone" size={24} color={alpha(theme.mutedForeground, 0.6)} />
                  <Text color={theme.mutedForeground} style={{ textAlign: "center", maxWidth: 384 }}>
                    {state.hostStatus === "failed"
                      ? (state.hostStatusDetail ?? "The device hub failed to start.")
                      : "No simulators or emulators were found on this environment."}
                  </Text>
                </>
              ) : null}
              {hostReady && grouped.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 24, width: "100%" }}>
                  {grouped.map((group) => (
                    <div key={group.platform} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Icon name="smartphone" size={16} color={theme.mutedForeground} />
                        <Text weight={500} color={theme.mutedForeground}>
                          {platformLabel(group.platform)}
                        </Text>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden",
                          borderRadius: RADIUS.xl,
                          borderWidth: 1,
                          borderColor: alpha(theme.border, 0.7),
                          backgroundColor: theme.background,
                        }}
                      >
                        {group.devices.map((device, index) => (
                          <DeviceRow
                            key={deviceKey(device)}
                            device={device}
                            hostLabel={state.hosts.find((host) => host.id === device.hostId)?.label}
                            first={index === 0}
                            pending={pendingDeviceKey === deviceKey(device)}
                            disabled={pendingDeviceKey !== null}
                            onOpen={() => void selectDevice(device)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {hostReady &&
              !isAndroidDiscoveryUncertain(state) &&
              !state.devices.some((device) => device.platform === "android") &&
              !unavailablePlatforms.some((platform) => platform.platform === "android") ? (
                <Text size="xs" color={theme.mutedForeground} style={{ maxWidth: 384 }}>
                  No Android virtual devices found. Create one in Android Studio's Device Manager, then refresh.
                </Text>
              ) : null}
              {loaded && !hostBusy ? (
                <div style={{ display: "flex", flexDirection: "row", alignSelf: grouped.length > 0 ? "flex-start" : "center" }}>
                  <Button testId="device-refresh" variant="outline" size="sm" onClick={() => void list({ environmentId, input: {} })}>
                    Refresh devices
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        )}
        {loading ? (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", flexDirection: "column", backgroundColor: theme.background }}>
            {notices}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeviceRow(props: {
  device: DeviceSummary;
  hostLabel: string | undefined;
  first: boolean;
  pending: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const { device } = props;
  return (
    <div
      testId={`device-row-${device.id}`}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 12,
        paddingBottom: 12,
        ...(props.first ? {} : { borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.6),
        }}
      >
        <Icon name="smartphone" size={16} color={theme.mutedForeground} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <Text weight={500} truncate>
          {device.name}
        </Text>
        <Text size="xs" color={theme.mutedForeground} truncate>
          {`${props.hostLabel} · ${device.version} · ${device.booted ? "Running" : "Stopped"}`}
        </Text>
      </div>
      <Button
        testId={`device-open-${device.id}`}
        variant="outline"
        size="sm"
        disabled={props.disabled}
        icon={props.pending ? "loader-circle" : device.booted ? "arrow-up-right" : "play"}
        onClick={props.onOpen}
      >
        {device.booted ? "Open" : "Start"}
      </Button>
    </div>
  );
}

function DeviceNotice(props: { readonly tone: "warning" | "error"; readonly onDismiss: () => void; readonly children: ReactNode }) {
  const theme = useTheme();
  const warning = props.tone === "warning";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderColor: theme.border,
        backgroundColor: warning ? alpha(theme.warning, 0.08) : alpha(theme.error, 0.05),
      }}
    >
      <div style={{ marginTop: 2 }}>
        <Icon name="circle-alert" size={14} color={warning ? theme.warningForeground : theme.errorForeground} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>{props.children}</div>
      <IconButton icon="x" size={24} iconSize={14} onClick={props.onDismiss} />
    </div>
  );
}

function DeviceDiscoveryWarning(props: { readonly label: string; readonly detail: string }) {
  const theme = useTheme();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <DeviceNotice tone="warning" onDismiss={() => setDismissed(true)}>
      <Text size="xs" weight={500} color={theme.warningForeground}>
        {`Device discovery warning · ${props.label}`}
      </Text>
      <Text size="xs" color={theme.warningForeground}>
        {props.detail}
      </Text>
    </DeviceNotice>
  );
}

function groupDevices(state: DeviceServiceState) {
  const groups: Array<{ platform: DevicePlatform; devices: DeviceSummary[] }> = [];
  for (const platform of ["ios", "android"] as const) {
    const devices = state.devices
      .filter((device) => device.platform === platform)
      .toSorted((a, b) => Number(b.booted) - Number(a.booted) || a.name.localeCompare(b.name));
    if (devices.length > 0) groups.push({ platform, devices });
  }
  return groups;
}
