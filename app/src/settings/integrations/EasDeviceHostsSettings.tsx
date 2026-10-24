// Port of apps/web/src/components/settings/EasDeviceHostsSettings.tsx. EAS hosts
// belong to one environment: its server holds the Expo credential and runs the
// sessions. gpuix has no password input, so the token field is a plain field
// that never shows the saved value.
import { AuthSettingsWriteScope, type DeviceEasAccount, type EasDeviceHostConfig, type EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironmentScope } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Dialog } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { easSessionLimits, newEasDeviceHost, parseEasDeviceHostDraft, updateEasDeviceHosts } from "../../web/components/settings/easDeviceHostsSettings.logic.ts";
import { SettingsSelect, TextField } from "../controls.tsx";
import { SettingsRow } from "../layout.tsx";
import { useSettingsScope } from "../scope.tsx";
import { deviceEnvironment } from "./state.ts";

const FROM_THREAD_PROJECT = "thread-project";

const CREDENTIAL_SOURCES: Record<DeviceEasAccount["credentialSource"], string> = {
  settings: "the access token saved here",
  env: "EXPO_TOKEN on the server",
  "eas-login": "the server's eas login",
};

const failureMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};

export function EasDeviceHostsSettings(props: { environmentId: EnvironmentId | null }) {
  const theme = useTheme();
  const { scope, connectedEnvironments } = useSettingsScope();
  const canConfigure = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const projectScope = scope.kind === "project" || scope.kind === "checkout";
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const environment = connectedEnvironments.find((candidate) => candidate.environmentId === props.environmentId);
  const hosts = environment?.serverConfig?.settings.easDeviceHosts ?? [];
  const [editing, setEditing] = useState<{ host: EasDeviceHostConfig; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !canConfigure || projectScope || busy || !props.environmentId;

  const save = async (host: EasDeviceHostConfig, remove: boolean) => {
    if (!props.environmentId || !readEnvironmentScope(props.environmentId, AuthSettingsWriteScope)) return;
    setBusy(true);
    const result = await update({ environmentId: props.environmentId, input: { patch: { easDeviceHosts: updateEasDeviceHosts(hosts, host, remove) } } });
    setBusy(false);
    if (result._tag === "Success") setEditing(null);
    else toast({ type: "error", title: remove ? "EAS host not removed" : "EAS host not saved", description: failureMessage(result.cause) });
  };

  return (
    <SettingsRow
      id="eas-device-hosts"
      title="EAS Simulator"
      serverScoped
      settingKeys={["easDeviceHosts"]}
      description="Run iOS Simulators in Expo's cloud from this environment. Sessions bill the Expo account until they stop, so each host limits how many run and for how long. Editing or removing a host stops its running sessions."
      control={
        <Button
          size="sm"
          variant="outline"
          icon="plus"
          testId="eas-hosts-add"
          disabled={disabled || editing !== null}
          onClick={() => setEditing({ host: newEasDeviceHost(crypto.randomUUID()), isNew: true })}
        >
          Add EAS host
        </Button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", paddingTop: 12, paddingBottom: 8 }}>
        {hosts.length === 0 ? (
          <Text color={theme.mutedForeground}>No EAS hosts.</Text>
        ) : (
          hosts.map((host, index) => (
            <div
              key={host.id}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingTop: 10,
                paddingBottom: 10,
                ...(index > 0 ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.4) } : {}),
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon name="cloud" size={14} color={theme.foreground} />
                  <Text weight={500} truncate>
                    {host.label}
                  </Text>
                </div>
                <Text size="xs" color={theme.mutedForeground} truncate>
                  {easSessionLimits(host)}
                </Text>
              </div>
              <div style={{ display: "flex", flexDirection: "row", gap: 4, flexShrink: 0 }}>
                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setEditing({ host, isNew: false })}>
                  Edit
                </Button>
                <GhostDestructiveButton disabled={disabled} onClick={() => void save(host, true)}>
                  Remove
                </GhostDestructiveButton>
              </div>
            </div>
          ))
        )}
        {editing && props.environmentId ? (
          <EasDeviceHostEditor
            key={editing.host.id}
            environmentId={props.environmentId}
            host={editing.host}
            isNew={editing.isNew}
            busy={busy}
            onSave={(host) => void save(host, false)}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </div>
    </SettingsRow>
  );
}

/** button.tsx variant "ghost-destructive". */
function GhostDestructiveButton({ children, disabled, onClick }: { children: string; disabled?: boolean; onClick: () => void }) {
  const theme = useTheme();
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        height: 28,
        paddingLeft: 9,
        paddingRight: 9,
        borderRadius: RADIUS.md,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: alpha(theme.error, 0.1) } }),
      }}
    >
      <Text weight={500} color={theme.errorForeground}>
        {children}
      </Text>
    </div>
  );
}

function EasDeviceHostEditor(props: {
  environmentId: EnvironmentId;
  host: EasDeviceHostConfig;
  isNew: boolean;
  busy: boolean;
  onSave: (host: EasDeviceHostConfig) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const check = useAtomCommand(deviceEnvironment.easAccount, { reportFailure: false });
  const [draft, setDraft] = useState(props.host);
  // A saved token arrives redacted; only a replacement or a clear changes it.
  const [token, setToken] = useState<{ kind: "saved" } | { kind: "new"; value: string } | { kind: "cleared" }>(
    props.host.accessToken ? { kind: "saved" } : { kind: "cleared" },
  );
  const [tokenFieldKey, setTokenFieldKey] = useState(0);
  const [account, setAccount] = useState<
    { status: "idle" } | { status: "checking" } | { status: "signed-in"; account: DeviceEasAccount } | { status: "failed"; error: string }
  >({ status: "checking" });
  const next: EasDeviceHostConfig = {
    ...draft,
    label: draft.label.trim(),
    accessToken: token.kind === "saved" ? props.host.accessToken : token.kind === "new" ? token.value : "",
  };
  const valid = Option.isSome(parseEasDeviceHostDraft(next));
  const problem = valid
    ? null
    : draft.maxSessionMinutes > 0 && draft.idleMinutes >= draft.maxSessionMinutes
      ? "Idle minutes must be smaller than session minutes."
      : "Give the host a label and limits within the ranges shown.";
  const apps = account.status === "signed-in" ? account.account.apps : [];

  // A check answers for the credential it was asked about: a later check or a
  // token edit makes an earlier answer stale.
  const latestCheck = useRef(0);
  const resetAccount = () => {
    latestCheck.current++;
    setAccount({ status: "idle" });
  };
  const requestCheck = async () => {
    const run = ++latestCheck.current;
    const result = await check({
      environmentId: props.environmentId,
      input: {
        ...(token.kind === "saved" && !props.isNew ? { hostId: props.host.id } : {}),
        ...(token.kind === "new" ? { accessToken: token.value } : token.kind === "cleared" ? { accessToken: "" } : {}),
      },
    });
    if (run !== latestCheck.current) return;
    setAccount(result._tag === "Success" ? { status: "signed-in", account: result.value } : { status: "failed", error: failureMessage(result.cause) });
  };
  const checkAccount = () => {
    setAccount({ status: "checking" });
    void requestCheck();
  };
  // Checking on open names the saved project and shows a rejected credential before anything changes.
  const checkOnOpen = useRef(requestCheck);
  useEffect(() => {
    void checkOnOpen.current();
  }, []);

  const submit = () => {
    if (valid && !props.busy) props.onSave(next);
  };
  const limit = (field: "maxSessionMinutes" | "idleMinutes" | "maxConcurrentSessions", label: string, max: number) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
      <Text>{label}</Text>
      <TextField
        width="100%"
        value={String(draft[field])}
        readOnly={props.busy}
        onChange={(text) => {
          const value = Number(text.replace(/[^0-9]/g, "") || "0");
          setDraft((current) => ({ ...current, [field]: Math.min(max, value) }));
        }}
      />
    </div>
  );
  const labeled = (label: string, node: ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Text>{label}</Text>
      {node}
    </div>
  );
  const appOptions = [
    { value: FROM_THREAD_PROJECT, label: "From the thread's project" },
    ...(draft.appId && !apps.some((app) => app.id === draft.appId) ? [{ value: draft.appId, label: draft.appId }] : []),
    ...apps.map((app) => ({ value: app.id, label: app.fullName })),
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
      showCloseButton={!props.busy}
      testId="eas-host-editor"
      title={props.isNew ? "Add EAS host" : "Edit EAS host"}
      description="The environment's server signs in to Expo and starts the sessions. Without a token here it uses EXPO_TOKEN, then its eas login."
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={props.busy || !valid} onClick={submit}>
            Save host
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {labeled("Name", <TextField width="100%" value={draft.label} readOnly={props.busy} onChange={(label) => setDraft((current) => ({ ...current, label }))} onSubmit={submit} />)}
        {labeled(
          "Expo access token",
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextField
              key={tokenFieldKey}
              secret
              value={token.kind === "new" ? token.value : ""}
              placeholder={token.kind === "saved" ? "Saved. Enter a new token to replace it" : "Optional"}
              readOnly={props.busy}
              onChange={(value) => {
                // Emptying the field is not clearing the saved token; the Clear button is.
                setToken(value ? { kind: "new", value } : props.host.accessToken ? { kind: "saved" } : { kind: "cleared" });
                resetAccount();
              }}
            />
            {token.kind !== "cleared" ? (
              <IconButton
                icon="x"
                size={28}
                iconSize={14}
                color={theme.errorForeground}
                onClick={() => {
                  setToken({ kind: "cleared" });
                  setTokenFieldKey((key) => key + 1);
                  resetAccount();
                }}
              />
            ) : null}
          </div>,
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.6),
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 10,
            paddingBottom: 10,
          }}
        >
          <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 1, minWidth: 0 }}>
            {account.status === "signed-in"
              ? `Signed in as ${account.account.signedInAs} with ${CREDENTIAL_SOURCES[account.account.credentialSource]}.`
              : account.status === "failed"
                ? account.error
                : account.status === "checking"
                  ? "Checking the Expo account…"
                  : "Check the Expo account before choosing a project."}
          </Text>
          <Button size="sm" variant="outline" disabled={props.busy || account.status === "checking"} onClick={checkAccount}>
            Check account
          </Button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Text>EAS project</Text>
          <SettingsSelect
            width={462}
            align="start"
            value={draft.appId ?? FROM_THREAD_PROJECT}
            disabled={props.busy}
            options={appOptions}
            onChange={(value) =>
              setDraft((current) => {
                const { appId: _, ...rest } = current;
                return value === FROM_THREAD_PROJECT ? rest : { ...rest, appId: value };
              })
            }
          />
          <Text size="xs" color={theme.mutedForeground}>
            Sessions bill the project's Expo account. "From the thread's project" reads extra.eas.projectId from the project's app config.
          </Text>
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
          {limit("maxConcurrentSessions", "Sessions at once", 20)}
          {limit("maxSessionMinutes", "Session minutes", 115)}
          {limit("idleMinutes", "Idle minutes", 60)}
        </div>
        <Text size="xs" color={theme.mutedForeground}>
          {`Expo allows sessions of up to 40 minutes on free accounts and 115 on paid ones, and ends one after the idle minutes without activity, so idle minutes must be smaller than session minutes.${props.isNew ? "" : " Saving restarts this host, which stops its running sessions."}`}
        </Text>
        {problem === null ? null : (
          <Text size="xs" color={theme.errorForeground}>
            {problem}
          </Text>
        )}
      </div>
    </Dialog>
  );
}
