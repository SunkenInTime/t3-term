// Ports of apps/web/src/components/device/{DeviceSetup (status helpers),
// DeviceToolVersions, DeviceHostUpdates, DeviceHostAvailability}.tsx as the
// Integrations page uses them. The setup wizard itself lives in the device
// surface, not in settings.
import type { DevicePlatform, DevicePlatformAvailability, DeviceServiceState, DeviceToolVersions as ToolVersions, EnvironmentId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { useAtomCommand } from "../../state/settings.ts";
import { InlineButton } from "../controls.tsx";
import { deviceEnvironment } from "./state.ts";

const platformName = (platform: DevicePlatform) => (platform === "ios" ? "iOS" : "Android");

export const deviceHubDescription =
  "Enable this environment to open simulators and emulators, whether they run here or on a remote device host.";
export const agentDeviceDescription =
  "Allow new agent sessions in this environment to start and control local and remote devices, with required tools set up automatically.";

export const isAndroidDiscoveryUncertain = (state: DeviceServiceState) =>
  Object.values(state.hostStatuses).some((status) => status.status === "ready" && status.androidDiscoveryIncomplete);

/**
 * `hostStatus` only tracks this machine. A machine without simulator tooling never
 * starts its own hub, so setup and the panel must also count remote device hosts.
 */
export function deviceHubReadiness(state: DeviceServiceState) {
  const statuses = Object.values(state.hostStatuses).map((host) => host.status);
  const ready = state.hostStatus === "ready" || statuses.includes("ready");
  const busy = !ready && [state.hostStatus, ...statuses].some((status) => status === "installing" || status === "starting");
  return { ready, busy };
}

function deviceHostDiagnostics(
  hosts: ReadonlyArray<Pick<DeviceServiceState["hosts"][number], "id" | "label">>,
  hostStatuses: DeviceServiceState["hostStatuses"],
) {
  return hosts.flatMap((host) => {
    const status = hostStatuses[host.id];
    return status?.status === "ready" && status.detail ? [{ hostId: host.id, label: host.label, detail: status.detail }] : [];
  });
}

export function DeviceHostDiagnostics(props: {
  readonly hosts: ReadonlyArray<Pick<DeviceServiceState["hosts"][number], "id" | "label">>;
  readonly hostStatuses: DeviceServiceState["hostStatuses"];
  readonly marginTop?: number;
}) {
  const theme = useTheme();
  const diagnostics = deviceHostDiagnostics(props.hosts, props.hostStatuses);
  if (diagnostics.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: props.marginTop ?? 0 }}>
      {diagnostics.map(({ hostId, label, detail }) => (
        <Text key={hostId} size="xs" color={theme.mutedForeground}>
          {`${label}: ${detail}`}
        </Text>
      ))}
    </div>
  );
}

export function platformSetupStatus(state: DeviceServiceState, platform: DevicePlatform) {
  const hasDevices = state.devices.some((device) => device.platform === platform);
  if (platform === "android" && !hasDevices && isAndroidDiscoveryUncertain(state)) {
    return { ready: false, message: "The Android device list may be incomplete. Check the device host and try again." };
  }
  const availabilities = state.hosts.flatMap((host) =>
    host.platforms.filter((candidate) => candidate.platform === platform).map((candidate) => ({ ...candidate, host })),
  );
  const supportingHosts = availabilities.filter((candidate) => candidate.available).map((candidate) => candidate.host);
  if (supportingHosts.length === 0) {
    return { ready: false, message: availabilities[0]?.reason ?? `${platformName(platform)} support was not detected.` };
  }
  const readyHosts = supportingHosts.filter(
    (host) => state.hostStatuses[host.id]?.status === "ready" || (host.kind === "local" && state.hostStatus === "ready"),
  );
  if (readyHosts.length > 0 && !hasDevices) {
    return {
      ready: false,
      message:
        platform === "ios"
          ? "Xcode is installed, but no iOS Simulator is available. Install a runtime in Xcode Settings → Components."
          : "The Android SDK is installed, but no virtual device exists. Create one in Android Studio → Device Manager.",
    };
  }
  const remoteHost = supportingHosts.every((host) => host.kind !== "local") ? supportingHosts[0] : undefined;
  const location = remoteHost ? ` on ${remoteHost.label}` : "";
  return {
    ready: true,
    message:
      remoteHost?.kind === "eas"
        ? `${remoteHost.label} starts iOS Simulators in the cloud with EAS Simulator.`
        : platform === "ios"
          ? `Xcode and iOS Simulator are available${location}.`
          : `The Android SDK and Emulator are available${location}.`,
  };
}

/** Web shows a spinner while work runs; gpuix keeps it a static loader glyph (no repainting animation). */
export function StatusLine({ pending, children }: { pending: boolean; children: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon name={pending ? "loader-circle" : "check"} size={12} color={pending ? theme.mutedForeground : theme.success} />
      <Text size="xs" color={theme.mutedForeground}>
        {children}
      </Text>
    </div>
  );
}

export function DeviceHubSetupStatus({ state, pending, compact = false }: { readonly state: DeviceServiceState; readonly pending: boolean; readonly compact?: boolean }) {
  if (!pending && !deviceHubReadiness(state).ready) return null;
  return (
    <StatusLine pending={pending}>
      {pending
        ? state.hostStatus === "installing"
          ? compact
            ? "Installing…"
            : "Installing device hub…"
          : state.hostStatus === "starting"
            ? compact
              ? "Starting…"
              : "Starting device hub…"
            : compact
              ? "Updating…"
              : "Updating device hub…"
        : "Device hub is ready."}
    </StatusLine>
  );
}

export function AgentDeviceSetupStatus(props: { readonly state: DeviceServiceState; readonly pending: boolean; readonly compact?: boolean }) {
  if (props.pending) {
    const label =
      props.state.hostStatus === "installing"
        ? props.compact
          ? "Installing…"
          : "Installing agent tools…"
        : props.state.hostStatus === "starting"
          ? props.compact
            ? "Starting…"
            : "Starting agent tools…"
          : props.compact
            ? "Updating…"
            : "Updating agent access…";
    return <StatusLine pending>{label}</StatusLine>;
  }
  if (props.state.agentAccessEnabled && deviceHubReadiness(props.state).ready && props.state.hosts.some((host) => host.agentDeviceInstalled)) {
    return <StatusLine pending={false}>Agent tools are ready.</StatusLine>;
  }
  return null;
}

export function PlatformStatus(props: { readonly platform: string; readonly status: { readonly ready: boolean; readonly message: string }; readonly compact?: boolean }) {
  const theme = useTheme();
  const inline = props.compact && props.status.ready;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 8,
        ...(props.compact ? {} : { borderRadius: RADIUS.md, borderWidth: 1, borderColor: alpha(theme.border, 0.6), paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }),
      }}
    >
      <div style={{ marginTop: 2 }}>
        <Icon name={props.status.ready ? "check" : "circle-alert"} size={16} color={props.status.ready ? theme.success : theme.mutedForeground} />
      </div>
      <div style={{ display: "flex", flexDirection: inline ? "row" : "column", alignItems: inline ? "center" : "flex-start", gap: inline ? 8 : 0 }}>
        <Text weight={500}>{props.platform}</Text>
        <Text size="xs" color={theme.mutedForeground}>
          {inline ? "Ready" : props.status.message}
        </Text>
      </div>
    </div>
  );
}

export function DeviceToolVersions({
  tools,
  action,
  kind,
  owner,
  error,
}: {
  tools: ToolVersions | undefined;
  action?: ReactNode;
  kind?: keyof ToolVersions;
  owner?: string | undefined;
  error?: string | undefined;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = kind ? tools?.[kind] : undefined;
  const version =
    selected?.runningVersion ??
    (selected?.installedVersions.includes(selected.requiredVersion)
      ? selected.requiredVersion
      : [...(selected?.installedVersions ?? [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1));
  const label = kind === "hub" ? "Device hub" : "Agent device";
  const triggerText = kind ? (version ? `v${version}` : selected ? "Not installed" : "Version unknown") : error ? "Versions unavailable" : "Versions";
  const rows = tools
    ? (
        [
          ["Device hub", tools.hub],
          ["Agent device", tools.agent],
        ] as const
      ).filter(([name]) => !kind || name === label)
    : [];
  const detail = (term: string, value: string) => (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", gap: 24 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {term}
      </Text>
      <Text size="xs" style={{ fontFamily: FONTS.mono }}>
        {value}
      </Text>
    </div>
  );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <InlineButton tone="muted" size="base" onClick={() => setOpen(!open)}>
          {triggerText}
        </InlineButton>
      }
      style={{ width: 320, padding: 16 }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Text weight={600}>{kind ? label : "Device tools"}</Text>
        {tools ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
            {rows.map(([name, tool], index) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  paddingTop: index === 0 ? 0 : 12,
                  paddingBottom: index === rows.length - 1 ? 0 : 12,
                  ...(index > 0 ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) } : {}),
                }}
              >
                {!kind ? (
                  <Text size="xs" weight={500}>
                    {name}
                  </Text>
                ) : null}
                {detail("Running", tool.runningVersion ?? "Not running")}
                {detail("Required", tool.requiredVersion)}
                {detail("Installed", tool.installedVersions.join(", ") || "None")}
              </div>
            ))}
          </div>
        ) : (
          <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 12 }}>
            Versions have not been checked.
          </Text>
        )}
        <div style={{ marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) }}>
          <Text size="xs" color={theme.mutedForeground}>
            {`${owner ? `Managed by ${owner}. ` : ""}Tools update automatically on this host when needed.`}
          </Text>
        </div>
        {error ? (
          <Text size="xs" color={theme.errorForeground} style={{ marginTop: 8 }}>
            {error}
          </Text>
        ) : null}
        {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
      </div>
    </Popover>
  );
}

export function DeviceHostUpdates({ state, environmentId }: { state: DeviceServiceState; environmentId: EnvironmentId }) {
  const theme = useTheme();
  const retry = useAtomCommand(deviceEnvironment.list);
  const [pending, setPending] = useState<string | null>(null);
  if (state.hostStatus === "disabled") return null;
  const rows = state.hosts.flatMap((host) => {
    const status = state.hostStatuses[host.id];
    if (!status || !["installing", "starting", "failed"].includes(status.status)) return [];
    return [{ host, status }];
  });
  if (rows.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 16, paddingRight: 16, paddingBottom: 12 }}>
      {rows.map(({ host, status }) => {
        const failed = status.status === "failed";
        return (
          <div
            key={host.id}
            style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: alpha(theme.border, 0.6), paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}
          >
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
              <Text size="xs" weight={500}>
                {host.label}
              </Text>
              <Text size="xs" color={theme.mutedForeground}>
                {status.detail ?? (failed ? "Device support could not start." : status.status === "installing" ? "Installing device tools…" : "Starting device tools…")}
              </Text>
              {failed ? (
                <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 4 }}>
                  Check the host connection and network access, then retry. Your device settings are saved.
                </Text>
              ) : null}
            </div>
            {failed && state.supportsHostRetry ? (
              <Button
                size="xs"
                variant="outline"
                disabled={pending !== null}
                onClick={() => {
                  setPending(host.id);
                  void retry({ environmentId, input: { retryHostId: host.id } }).finally(() => setPending(null));
                }}
              >
                {pending === host.id ? "Retrying…" : "Retry"}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function DeviceHostAvailability({ platforms }: { platforms: ReadonlyArray<DevicePlatformAvailability> }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}>
      {platforms.map((platform) => (
        <Tooltip key={platform.platform} content={platform.reason ?? (platform.platform === "ios" ? "iOS available" : "Android available")} side="top">
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={platform.available ? "check" : "minus"} size={12} color={theme.mutedForeground} />
            <Text size="xs" color={theme.mutedForeground}>
              {`${platform.platform === "ios" ? "iOS" : "Android"} ${platform.available ? "available" : "unavailable"}`}
            </Text>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}
