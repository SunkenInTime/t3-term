// Port of apps/web/src/components/settings/{DeviceHostsSettings, DeviceHostEditor,
// useHostConnectionChecks, FoldedSettingsSection}.tsx. SSH device hosts are a
// server setting (`deviceHosts`) written to every selected environment.
import { useAtomValue } from "@effect/atom-react";
import { AuthSettingsWriteScope, type EnvironmentId, type SshDeviceHostConfig } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState, type ReactNode } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { environmentIdsKey, readEnvironmentScope, useAtomCommand, useEnvironmentScope } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Dialog, Menu, MenuItem, Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  checkDeviceHostConnections,
  deviceHostConnectionKey,
  parseDeviceHostDraft,
  type DeviceHostCheck,
  type DeviceHostCheckTarget,
} from "../../web/components/settings/deviceHostConnectionChecks.ts";
import { groupDeviceHosts, updateDeviceHosts, type DeviceHostEnvironment, type DeviceHostGroup } from "../../web/components/settings/deviceHostsSettings.logic.ts";
import { settingsScopeEnvironmentLabel, settingsScopeEnvironmentLabels } from "../../web/components/settings/settingsScopeAxis.ts";
import { BrandIcon } from "../brandIcons.tsx";
import { InlineButton, TextField } from "../controls.tsx";
import { SettingsRow } from "../layout.tsx";
import { useSettingsScope } from "../scope.tsx";
import { DeviceHostAvailability, DeviceHostDiagnostics, DeviceToolVersions } from "./DeviceParts.tsx";
import { deviceEnvironment, deviceHostStatesAtom } from "./state.ts";

function useHostConnectionChecks(targets: ReadonlyArray<DeviceHostCheckTarget>) {
  const test = useAtomCommand(deviceEnvironment.testHost, { reportFailure: false });
  const [checks, setChecks] = useState<Record<string, Record<string, DeviceHostCheck>>>({});
  const running = useRef(new Set<string>());
  const testConnection = async (host: SshDeviceHostConfig) => {
    const key = deviceHostConnectionKey(host);
    if (running.current.has(key)) return;
    running.current.add(key);
    setChecks((current) => ({ ...current, [key]: {} }));
    const results: Record<string, DeviceHostCheck> = {};
    await checkDeviceHostConnections(
      targets,
      host,
      async (environmentId, input) => {
        if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) throw new Error("This connection cannot test device hosts.");
        const result = await test({ environmentId, input });
        if (result._tag === "Failure") throw new Error(Cause.pretty(result.cause));
        return result.value;
      },
      (environmentId, result) => {
        results[environmentId] = result;
        setChecks((current) => ({ ...current, [key]: { ...current[key], [environmentId]: result } }));
      },
    ).finally(() => running.current.delete(key));
    return results;
  };
  return { checks, testConnection };
}

function summarizeLabels(labels: ReadonlyArray<string>) {
  return `${labels.slice(0, 2).join(", ")}${labels.length > 2 ? ` +${labels.length - 2}` : ""}`;
}

/** FoldedSettingsSection (header inside): a bordered group that folds its rows. */
function FoldedGroup({ title, summary, children }: { title: ReactNode; summary: string; children: ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.xl, borderWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingLeft: 16, paddingRight: 16, cursor: "pointer" }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={16} color={theme.mutedForeground} />
        {title}
        <Text size="xs" color={theme.mutedForeground} truncate>
          {summary}
        </Text>
      </div>
      {open ? <div style={{ borderTopWidth: 1, borderColor: alpha(theme.border, 0.5), paddingLeft: 16, paddingRight: 16 }}>{children}</div> : null}
    </div>
  );
}

export function DeviceHostsSettings(props: { environmentId: EnvironmentId | null }) {
  const theme = useTheme();
  const { scope, environments, connectedEnvironments } = useSettingsScope();
  const canConfigure = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const projectScope = scope.kind === "project" || scope.kind === "checkout";
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [editing, setEditing] = useState<SshDeviceHostConfig | null>(null);
  const [originalHost, setOriginalHost] = useState<SshDeviceHostConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = environments.map((environment) => ({
    environmentId: environment.environmentId,
    label: settingsScopeEnvironmentLabel(environment, environments),
    connected: environment.connection.phase === "connected",
  }));
  const { checks, testConnection } = useHostConnectionChecks(targets);
  const hostEnvironments = connectedEnvironments.map((environment) => ({
    environmentId: environment.environmentId,
    label: environment.label,
    labels: settingsScopeEnvironmentLabels(environment, connectedEnvironments),
    hosts: environment.serverConfig?.settings.deviceHosts ?? [],
  }));
  const groupedHosts = groupDeviceHosts(hostEnvironments);
  const save = async (host: SshDeviceHostConfig, remove = false, original = host) => {
    if (!props.environmentId || projectScope) return;
    setBusy(true);
    const results = await Promise.allSettled(
      environments.map(async (environment) => {
        if (environment.connection.phase !== "connected" || !environment.serverConfig) throw new Error("Environment disconnected");
        if (!readEnvironmentScope(environment.environmentId, AuthSettingsWriteScope)) throw new Error("This connection cannot change device settings.");
        return update({
          environmentId: environment.environmentId,
          input: { patch: { deviceHosts: updateDeviceHosts(environment.serverConfig.settings.deviceHosts, host, remove, original) } },
        });
      }),
    );
    setBusy(false);
    const failed = environments.filter((_, index) => {
      const result = results[index];
      return result?.status !== "fulfilled" || result.value._tag === "Failure";
    });
    if (failed.length === 0) {
      setEditing(null);
    } else {
      toast({
        type: "error",
        title: "Device hosts not saved on all environments",
        description: `Could not update ${failed.map((environment) => environment.label).join(", ")}.`,
      });
    }
  };
  const listActions = {
    busy: !canConfigure || projectScope || busy,
    checks,
    testConnection: async (host: SshDeviceHostConfig) => {
      const results = await testConnection(host);
      if (!results) return;
      const failed = targets.filter((target) => results[target.environmentId]?.status === "failed");
      toast({
        type: failed.length ? "error" : "success",
        title: failed.length ? `${host.label}: ${failed.length} of ${targets.length} environments failed` : `${host.label}: connection checks passed`,
        description: failed.length
          ? `Could not connect from ${failed.map((target) => target.label).join(", ")}.`
          : "Connected or already available locally on each selected environment.",
      });
      return results;
    },
    onEdit: (host: SshDeviceHostConfig) => {
      setOriginalHost(host);
      setEditing(host);
    },
    onRemove: (host: SshDeviceHostConfig) => void save(host, true),
  };
  return (
    <SettingsRow
      id="device-hosts"
      title="Device hosts"
      serverScoped
      settingKeys={["deviceHosts"]}
      description="Add remote machines with simulator or emulator runtimes installed, and the selected environments will connect over SSH and set up device tools automatically."
      control={
        <Button
          size="sm"
          variant="outline"
          icon="plus"
          testId="device-hosts-add"
          disabled={!canConfigure || projectScope || busy || !props.environmentId || editing !== null}
          onClick={() => {
            setOriginalHost(null);
            setEditing({ kind: "ssh", id: crypto.randomUUID(), label: "", target: "" });
          }}
        >
          Add host
        </Button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", paddingTop: 12, paddingBottom: 8 }}>
        {!props.environmentId ? (
          <Text color={theme.mutedForeground}>Connect a selected environment to manage device hosts.</Text>
        ) : (
          <>
            {hostEnvironments.length > 1 && groupedHosts === null ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {hostEnvironments.map((environment) => (
                  <FoldedGroup
                    key={environment.environmentId}
                    title={
                      <div style={{ display: "flex", flexDirection: "column", maxWidth: 256 }}>
                        <Text weight={500} truncate>
                          {environment.labels.primary}
                        </Text>
                        {environment.labels.secondary ? (
                          <Text size="xs" color={theme.mutedForeground} truncate>
                            {environment.labels.secondary}
                          </Text>
                        ) : null}
                      </div>
                    }
                    summary={summarizeLabels(environment.hosts.map((host) => host.label)) || "No device hosts"}
                  >
                    <DeviceHostList environments={[environment]} {...listActions} />
                  </FoldedGroup>
                ))}
              </div>
            ) : (
              <DeviceHostList environments={hostEnvironments} groups={groupedHosts ?? undefined} compact={hostEnvironments.length > 1} {...listActions} />
            )}
            {editing ? (
              <DeviceHostEditor
                key={editing.id}
                host={editing}
                isNew={originalHost === null}
                targets={targets}
                busy={busy}
                onSave={(host) => void save(host, false, originalHost ?? host)}
                onClose={() => setEditing(null)}
              />
            ) : null}
          </>
        )}
      </div>
    </SettingsRow>
  );
}

function DeviceHostList({
  environments,
  groups,
  compact = false,
  busy,
  onEdit,
  onRemove,
  checks,
  testConnection,
}: {
  environments: ReadonlyArray<DeviceHostEnvironment>;
  groups?: ReadonlyArray<DeviceHostGroup> | undefined;
  compact?: boolean;
  busy: boolean;
  onEdit: (host: SshDeviceHostConfig) => void;
  onRemove: (host: SshDeviceHostConfig) => void;
  checks: ReturnType<typeof useHostConnectionChecks>["checks"];
  testConnection: (host: SshDeviceHostConfig) => Promise<unknown>;
}) {
  const theme = useTheme();
  const { environments: scopeEnvironments } = useSettingsScope();
  const environmentLabels = new Map(
    scopeEnvironments.map((environment) => [environment.environmentId, settingsScopeEnvironmentLabels(environment, scopeEnvironments)]),
  );
  const environmentIds = environments.map(({ environmentId }) => environmentId);
  const stateResults = useAtomValue(deviceHostStatesAtom(environmentIdsKey(environmentIds)));
  const states = new Map(environmentIds.map((environmentId, index) => [environmentId, Option.getOrUndefined(AsyncResult.value(stateResults[index]!))] as const));
  const retry = useAtomCommand(deviceEnvironment.list);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [openDetails, setOpenDetails] = useState<ReadonlySet<string>>(new Set());
  const retryHost = (environmentId: EnvironmentId, hostId: string, key = hostId) => {
    setRetrying(key);
    void retry({ environmentId, input: { retryHostId: hostId } }).finally(() => setRetrying(null));
  };
  const rows =
    groups ??
    environments.flatMap((environment) =>
      environment.hosts.map((host) => ({ host, members: [{ environmentId: environment.environmentId, label: environment.label, host }] })),
    );
  if (rows.length === 0) {
    return (
      <div style={{ paddingTop: 8, paddingBottom: 8 }}>
        <Text color={theme.mutedForeground}>No device hosts.</Text>
      </div>
    );
  }
  return (
    <>
      {rows.map(({ host, members }) => {
        const hostChecks = checks[deviceHostConnectionKey(host)];
        const checkedMembers = scopeEnvironments.flatMap((environment) =>
          hostChecks?.[environment.environmentId] && !members.some((member) => member.environmentId === environment.environmentId)
            ? [{ environmentId: environment.environmentId, label: environment.label, host }]
            : [],
        );
        const results = [...members, ...checkedMembers].map((member) => {
          const state = states.get(member.environmentId);
          const status = state?.hostStatuses[member.host.id];
          const check = hostChecks?.[member.environmentId];
          const summary = state?.hosts.find((value) => value.id === member.host.id);
          const label = environmentLabels.get(member.environmentId)?.primary ?? member.label;
          const address = environmentLabels.get(member.environmentId)?.secondary;
          const error =
            check?.status === "failed" ? check.error : check?.status === "local" ? undefined : status?.status === "failed" ? status.detail : undefined;
          return {
            ...member,
            label,
            address,
            name: [label, address].filter(Boolean).join(" · "),
            state,
            status,
            check,
            summary,
            error,
            versions: <DeviceToolVersions owner={label} error={summary?.toolInspectionError} tools={summary?.tools ?? (check?.status === "connected" ? check.tools : undefined)} />,
          };
        });
        const first = results[0];
        if (!first) return null;
        const { environmentId, status, check, summary, error } = first;
        const platforms = (check?.status === "connected" ? check.platforms : undefined) ?? summary?.platforms ?? [];
        const progress =
          check?.status === "pending"
            ? "Checking connection…"
            : status?.status === "installing"
              ? "Installing device support…"
              : status?.status === "starting"
                ? "Connecting…"
                : null;
        const failed = results.filter((result) => result.check?.status === "failed" || (result.check?.status !== "local" && result.status?.status === "failed"));
        const pending = results.some(
          (result) => result.check?.status === "pending" || result.status?.status === "installing" || result.status?.status === "starting",
        );
        const ready = results.every(
          (result) => result.check?.status === "connected" || result.check?.status === "local" || result.status?.status === "ready",
        );
        const retryable = results.filter((result) => result.status?.status === "failed" && result.state?.supportsHostRetry && result.state.hostStatus !== "disabled");
        const canRetry = !compact && retryable.includes(first);
        const indicators: ReadonlyArray<{ key: string; label: string; warning: boolean; icon: ReactNode; detail: string }> = compact
          ? [
              {
                key: "connection",
                label: failed.length ? "Connection failed" : pending ? "Checking connections" : ready ? "Connected" : "Connection not checked",
                warning: failed.length > 0,
                icon: (
                  <Icon
                    name={failed.length ? "triangle-alert" : pending ? "loader-circle" : ready ? "check" : "circle"}
                    size={14}
                    color={failed.length ? theme.warning : theme.mutedForeground}
                  />
                ),
                detail: failed.length
                  ? failed.map((result) => `${result.name}: ${result.error || "Connection failed"}`).join("\n")
                  : pending
                    ? "Checking connections…"
                    : ready
                      ? "Connected or available locally on each listed machine"
                      : "Test the connection to check access from each machine",
              },
            ]
          : platforms
              .filter((platform) => platform.available)
              .map((platform) => {
                const label = platform.platform === "ios" ? "iOS available" : "Android available";
                return {
                  key: platform.platform,
                  label,
                  warning: false,
                  icon: <BrandIcon name={platform.platform === "ios" ? "apple" : "android"} size={14} color={theme.mutedForeground} />,
                  detail: label,
                };
              });
        const detailsOpen = openDetails.has(host.id);
        return (
          <div key={host.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderColor: alpha(theme.border, 0.5), paddingTop: 10, paddingBottom: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
                <Text weight={500} truncate>
                  {host.label}
                </Text>
                {indicators.map((indicator) => (
                  <Tooltip key={indicator.key} content={indicator.detail} side="top">
                    <div style={{ display: "flex", flexShrink: 0 }}>{indicator.icon}</div>
                  </Tooltip>
                ))}
              </div>
              <Text size="xs" color={theme.mutedForeground} truncate>
                {host.target}
              </Text>
              {results
                .filter((result) => result.status?.status === "ready" && result.status.androidDiscoveryIncomplete)
                .map((result) => (
                  <Text key={result.environmentId} size="xs" color={theme.warningForeground} style={{ marginTop: 4 }}>
                    {`${compact ? `${result.label}: ` : ""}${result.status?.detail ?? "The Android device list may be incomplete. Refresh devices to try again."}`}
                  </Text>
                ))}
              {compact ? (
                <>
                  <InlineButton
                    tone="muted"
                    size="xs"
                    trailingIcon="chevron-down"
                    onClick={() =>
                      setOpenDetails((current) => {
                        const next = new Set(current);
                        if (next.has(host.id)) next.delete(host.id);
                        else next.add(host.id);
                        return next;
                      })
                    }
                  >
                    {summarizeLabels(results.map((result) => result.name))}
                  </InlineButton>
                  {detailsOpen ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      {results.map((result) => (
                        <div key={result.environmentId} style={{ display: "flex", flexDirection: "column" }}>
                          <Text size="xs" color={theme.mutedForeground}>
                            {result.label}
                          </Text>
                          {result.address ? (
                            <Text size="xs" color={theme.mutedForeground} truncate>
                              {result.address}
                            </Text>
                          ) : null}
                          {result.error ? (
                            <Text size="xs" color={theme.errorForeground}>
                              {result.error}
                            </Text>
                          ) : null}
                          {result.state ? <DeviceHostDiagnostics hosts={[result.host]} hostStatuses={result.state.hostStatuses} /> : null}
                          {result.versions}
                          {result.check?.status === "local" ? (
                            <Text size="xs" color={theme.mutedForeground}>
                              Already available locally
                            </Text>
                          ) : (
                            <DeviceHostAvailability platforms={(result.check?.status === "connected" ? result.check.platforms : result.summary?.platforms) ?? []} />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                first.versions
              )}
              {!compact && check?.status === "local" ? (
                <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 4 }}>
                  Already available locally
                </Text>
              ) : null}
              {!compact && error ? <ConnectionFailedDetails error={error} /> : null}
              {!compact
                ? results.map((result) =>
                    result.state ? <DeviceHostDiagnostics key={result.environmentId} marginTop={4} hosts={[result.host]} hostStatuses={result.state.hostStatuses} /> : null,
                  )
                : null}
            </div>
            {!compact && progress ? (
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="loader-circle" size={12} color={theme.mutedForeground} />
                <Text size="xs" color={theme.mutedForeground}>
                  {progress}
                </Text>
              </div>
            ) : null}
            <Menu align="end" trigger={({ toggle }) => <IconButton icon="ellipsis-vertical" size={28} iconSize={16} color={theme.mutedForeground} disabled={busy} onClick={toggle} />}>
              <MenuItem onSelect={() => onEdit(host)}>Edit</MenuItem>
              <MenuItem destructive onSelect={() => onRemove(host)}>
                Remove
              </MenuItem>
              {compact
                ? retryable.map((result) => (
                    <MenuItem key={result.environmentId} disabled={retrying !== null} onSelect={() => retryHost(result.environmentId, result.host.id, result.environmentId)}>
                      {`${retrying === result.environmentId ? "Retrying" : "Retry"} from ${result.label}${result.address ? ` (${result.address})` : ""}`}
                    </MenuItem>
                  ))
                : null}
            </Menu>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || (canRetry ? retrying !== null : compact ? pending : progress !== null)}
              onClick={() => {
                if (canRetry) retryHost(environmentId, host.id);
                else void testConnection(host);
              }}
            >
              {canRetry ? (retrying === host.id ? "Retrying…" : "Retry") : "Test connection"}
            </Button>
          </div>
        );
      })}
    </>
  );
}

function ConnectionFailedDetails({ error }: { error: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, cursor: "pointer" }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} color={theme.errorForeground} />
        <Text size="xs" color={theme.errorForeground}>
          Connection failed
        </Text>
      </div>
      {open ? (
        <Text size="xs" color={theme.errorForeground} style={{ marginTop: 4 }}>
          {error}
        </Text>
      ) : null}
    </div>
  );
}

function DeviceHostEditor({
  host,
  isNew,
  targets,
  busy,
  onSave,
  onClose,
}: {
  host: SshDeviceHostConfig;
  isNew: boolean;
  targets: ReadonlyArray<DeviceHostCheckTarget>;
  busy: boolean;
  onSave: (host: SshDeviceHostConfig) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(host);
  const [optionsOpen, setOptionsOpen] = useState(host.port !== undefined || host.identityFile !== undefined);
  const [expandedChecks, setExpandedChecks] = useState<{ key: string; open: boolean } | null>(null);
  const { checks, testConnection } = useHostConnectionChecks(targets);
  const connectionKey = deviceHostConnectionKey(draft);
  const results = checks[connectionKey];
  const checking = Object.values(results ?? {}).some((check) => check.status === "pending");
  const input = parseDeviceHostDraft({ ...draft, label: draft.label.trim() || draft.target });
  const valid = Option.isSome(input);
  const failed = Object.values(results ?? {}).filter((check) => check.status === "failed").length;
  const checksOpen = targets.length === 1 || (expandedChecks?.key === connectionKey ? expandedChecks.open : failed > 0);
  const checkSummary = checking ? "Checking environments…" : results ? (failed ? `${failed} of ${targets.length} failed` : "Connection checks passed") : "Check access before saving";
  const submit = () => {
    if (Option.isSome(input) && draft.label.trim() && !busy && !checking) onSave(input.value);
  };
  const field = (label: string, node: ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Text>{label}</Text>
      {node}
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      showCloseButton={!busy}
      testId="device-host-editor"
      title={isNew ? "Add device host" : "Edit device host"}
      description={`${targets.length === 1 ? `Connect from ${targets[0]?.label}.` : `Connect from ${targets.length} selected environments.`} Hosts on the same machine are skipped.`}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || checking || !valid || !draft.label.trim()} onClick={submit}>
            Save host
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {field(
          "Name",
          <TextField width="100%" value={draft.label} placeholder="Mac mini" readOnly={busy} onChange={(label) => setDraft((current) => ({ ...current, label }))} onSubmit={submit} />,
        )}
        {field(
          "SSH target",
          <TextField
            width="100%"
            value={draft.target}
            placeholder="user@host or SSH alias"
            readOnly={busy}
            onChange={(target) => setDraft((current) => ({ ...current, target }))}
            onSubmit={submit}
          />,
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div onClick={() => setOptionsOpen(!optionsOpen)} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <Icon name={optionsOpen ? "chevron-down" : "chevron-right"} size={12} color={theme.mutedForeground} />
            <Text color={theme.mutedForeground}>SSH options</Text>
          </div>
          {optionsOpen ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
              <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, minWidth: 0 }}>
                  <Text>Identity file</Text>
                  <TextField
                    width="100%"
                    value={draft.identityFile ?? ""}
                    placeholder="SSH config default"
                    readOnly={busy}
                    onChange={(identityFile) =>
                      setDraft((current) => {
                        const { identityFile: _, ...rest } = current;
                        return identityFile ? { ...rest, identityFile } : rest;
                      })
                    }
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 112, flexShrink: 0 }}>
                  <Text>Port</Text>
                  <TextField
                    width="100%"
                    value={draft.port === undefined ? "" : String(draft.port)}
                    placeholder="Default"
                    readOnly={busy}
                    onChange={(port) =>
                      setDraft((current) => {
                        const { port: _, ...rest } = current;
                        const value = Number(port.replace(/[^0-9]/g, ""));
                        return port.trim() && Number.isFinite(value) && value > 0 ? { ...rest, port: Math.min(65535, value) } : rest;
                      })
                    }
                  />
                </div>
              </div>
              <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 8 }}>
                Optional. Resolved separately on each environment.
              </Text>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.lg, borderWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}>
            {targets.length === 1 || !results ? (
              <Text size="xs" color={theme.mutedForeground}>
                {checkSummary}
              </Text>
            ) : (
              <InlineButton tone="muted" size="xs" trailingIcon="chevron-down" onClick={() => setExpandedChecks({ key: connectionKey, open: !checksOpen })}>
                {checkSummary}
              </InlineButton>
            )}
            <Button size="sm" variant="outline" disabled={busy || checking || !valid} testId="device-host-test" onClick={() => {
              if (Option.isSome(input)) void testConnection(input.value);
            }}>
              Test connection
            </Button>
          </div>
          {results && checksOpen ? (
            <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
              {targets.map((target, index) => {
                const result = results[target.environmentId];
                if (!result) return null;
                const statusColor = result.status === "failed" ? theme.errorForeground : theme.mutedForeground;
                return (
                  <div
                    key={target.environmentId}
                    style={{ display: "flex", flexDirection: "column", paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, ...(index > 0 ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.4) } : {}) }}
                  >
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <Text size="xs" weight={500} truncate>
                        {target.label}
                      </Text>
                      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <Icon
                          name={result.status === "pending" ? "loader-circle" : result.status === "local" ? "monitor" : result.status === "failed" ? "x" : "check"}
                          size={12}
                          color={statusColor}
                        />
                        <Text size="xs" color={statusColor}>
                          {result.status === "pending" ? "Checking…" : result.status === "local" ? "Already available locally" : result.status === "failed" ? "Failed" : "Connected"}
                        </Text>
                      </div>
                    </div>
                    {result.status === "connected" ? (
                      <div style={{ marginTop: 6 }}>
                        <DeviceHostAvailability platforms={result.platforms} />
                      </div>
                    ) : null}
                    {result.status === "failed" ? <ConnectionFailedDetails error={result.error} /> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
