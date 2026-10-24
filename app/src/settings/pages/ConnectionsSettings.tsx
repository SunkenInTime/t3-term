// Port of apps/web/src/components/settings/ConnectionsSettings.tsx (+ AuthorizedClientsSettings,
// SavedEnvironmentRows, EnvironmentRow, EnvironmentIconPicker, SessionPermissions,
// AddEnvironmentDialog, EnvironmentRoutesList, ConnectionDiagnosisDetails,
// LoadBalancingSettings, GitHubRoutingSettings), rendered the way the hosted web app
// renders it: there is no desktop bridge, so network exposure, Tailscale, WSL and
// T3 Connect controls stay out, and Network access is web's read-only row
// (renderDisabledNetworkAccessRow). Server update actions are left out as in
// connect/ConnectionBanner.tsx: t3-term's version is not a T3 Code release.
//
// The web app's primary environment is the server that served it. In t3-term it
// is the first saved environment (app/src/state/settings.ts primaryEnvironmentIdAtom);
// every other catalog entry is listed under Environments.
import { useAtomValue } from "@effect/atom-react";
import { connectionRoutes, connectionStatusText, environmentMcpUrl, hasSavedBearerRoute } from "@t3tools/client-runtime/connection";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthDiagnosticsReadScope,
  AuthFilesystemReadScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  AuthStandardClientScopes,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  ENVIRONMENT_MACHINE_KINDS,
  resolveEnvironmentMachineKind,
  sessionGrantsScope,
  type AuthClientSession,
  type AuthEnvironmentScope,
  type AuthGrantScope,
  type AuthPairingLink,
  type EnvironmentId,
  type EnvironmentMachineKind,
} from "@t3tools/contracts";
import { AUTH_SCOPE_OPTIONS } from "@t3tools/shared/authScopeOptions";
import { getPairingTokenFromUrl } from "@t3tools/shared/remote";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { useState, type ReactNode } from "react";

import { environmentCatalog, environmentSession, serverEnvironment } from "../../state/environment.ts";
import {
  readEnvironmentScope,
  useAtomCommand,
  useEnvironmentScope,
  useEnvironmentSessionState,
  useEnvironments,
  usePrimaryEnvironment,
  type EnvironmentPresentation,
} from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Dialog, Menu, MenuItem, MenuLabel, MenuSeparator, Switch, Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { alpha, RADIUS, useTheme } from "../../ui/theme.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { formatExpiresInLabel } from "../../web/timestampFormat.ts";
import { PairingRevealDialog, PairingSharePanel, resolveShareablePairingUrl, usePairingCopy } from "../connections/PairingShare.tsx";
import { TextField } from "../controls.tsx";
import { SettingsGroup, SettingsPageContainer, SettingsRow, SettingsSection, machineIcon } from "../layout.tsx";
import { copyText } from "../openExternal.ts";
import { useRelativeTimeLabel } from "../RelativeTime.tsx";
import {
  authEnvironment,
  createPairingCredential,
  registerPairing,
  revokeClientSession,
  revokeOtherClientSessions,
  revokePairingLink,
} from "../connections/state.ts";
import { ConnectionDiagnosisPanel, ConnectionDiagnosisSummary, useConnectionDiagnosis } from "../connections/ConnectionDiagnosisDetails.tsx";
import { EnvironmentRoutesList } from "../connections/EnvironmentRoutesList.tsx";
import { EnvironmentRow, SubtitleToggle, environmentTransportLabel } from "../connections/EnvironmentRow.tsx";
import { GitHubRoutingSettings, LoadBalancingSettings } from "../connections/LoadBalancingSettings.tsx";

const MACHINE_KIND_LABELS: Record<EnvironmentMachineKind, string> = {
  server: "Server",
  cloud: "Cloud VM",
  linux: "Linux/WSL",
  desktop: "Desktop",
  laptop: "Laptop",
  "mac-mini": "Mini PC",
  "mac-studio": "Workstation",
};

const isoOf = (value: DateTime.Utc | string | null | undefined) =>
  value === null || value === undefined ? null : typeof value === "string" ? value : DateTime.formatIso(value);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function StatusDot({ color, tooltip }: { color: string; tooltip: string }) {
  return (
    <Tooltip content={tooltip} side="top">
      <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, flexShrink: 0 }} />
    </Tooltip>
  );
}

/** button.tsx variant "destructive-outline": transparent, destructive border and text. */
function DestructiveOutlineButton({ children, disabled, onClick, testId }: { children: string; disabled?: boolean; onClick: () => void; testId?: string }) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        height: 24,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: alpha(theme.error, 0.32),
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled ? {} : { hover: { backgroundColor: alpha(theme.error, 0.04) } }),
      }}
    >
      <Text size="xs" weight={500} color={theme.errorForeground}>
        {children}
      </Text>
    </div>
  );
}

// ── EnvironmentIconPicker.tsx ────────────────────────────────────────────

function EnvironmentIconMenuItems({ environment }: { environment: EnvironmentPresentation }) {
  const theme = useTheme();
  const serverConfig = environment.serverConfig;
  const canWrite = useEnvironmentScope(environment.environmentId, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { label: "environment icon update" });
  const lock =
    serverConfig === null
      ? "Connect to this environment to change its icon."
      : serverConfig.environment.capabilities.environmentIcon !== true
        ? "This environment's server is too old to keep an icon. Update it to choose one."
        : !canWrite
          ? "Your session on this environment cannot change its settings."
          : null;
  const detected = serverConfig?.environment.platform.machine ?? "server";
  const resolved = resolveEnvironmentMachineKind(serverConfig);
  return (
    <>
      <MenuLabel>Icon</MenuLabel>
      {lock ? (
        <div style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 6, maxWidth: 240 }}>
          <Text size="xs" color={theme.mutedForeground}>
            {lock}
          </Text>
        </div>
      ) : null}
      {ENVIRONMENT_MACHINE_KINDS.map((kind) => (
        <MenuItem
          key={kind}
          icon={machineIcon({ environment: { platform: { machine: kind } }, settings: { environmentIcon: kind } } as never)}
          checked={kind === resolved}
          disabled={lock !== null}
          onSelect={() =>
            void updateSettings({ environmentId: environment.environmentId, input: { patch: { environmentIcon: kind === detected ? null : kind } } })
          }
        >
          {MACHINE_KIND_LABELS[kind]}
        </MenuItem>
      ))}
    </>
  );
}

// ── SessionPermissions.tsx ───────────────────────────────────────────────

function SessionPermissions({ environmentId, connected, routeContext = false }: { environmentId: EnvironmentId; connected: boolean; routeContext?: boolean }) {
  const theme = useTheme();
  const session = useEnvironmentSessionState(environmentId);
  if (!(connected && !session.hasError && !session.isPending && session.data?.authenticated)) {
    return (
      <div style={{ paddingTop: 12, paddingBottom: 12 }}>
        <Text size="xs" color={theme.mutedForeground}>
          Permissions not checked. Connect to this environment to view this session’s permissions.
        </Text>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12, paddingBottom: 12 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {routeContext
          ? "These permissions apply to your active route. Other routes may have different permissions."
          : "These permissions apply to this client’s current connection."}
      </Text>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", rowGap: 8, columnGap: 24 }}>
        {AUTH_SCOPE_OPTIONS.map(({ scope, title }) => (
          <div key={scope} style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", gap: 12, width: 380 }}>
            <Text size="xs">{title}</Text>
            <Text size="xs" color={theme.mutedForeground}>
              {sessionGrantsScope(session.data!, scope) ? "Allowed" : "Not granted"}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}

/** `<details>` disclosure: a title row with a rotating chevron. */
function Disclosure({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16 }}>
      <div
        testId={testId}
        onClick={() => setOpen(!open)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer" }}
      >
        <Text weight={500}>{title}</Text>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} color={theme.mutedForeground} />
      </div>
      {open ? children : null}
    </div>
  );
}

// ── AuthorizedClientsSettings.tsx ────────────────────────────────────────

/** ConnectionsSettings.logic.ts togglePairingScopeSelection */
function togglePairingScopeSelection(current: ReadonlyArray<AuthGrantScope>, scope: AuthGrantScope, checked: boolean): ReadonlyArray<AuthGrantScope> {
  const without = (scopes: ReadonlyArray<AuthGrantScope>) => scopes.filter((candidate) => candidate !== scope);
  if (!checked) {
    return scope === AuthTerminalReadScope ? without(current).filter((candidate) => candidate !== AuthTerminalOperateScope) : without(current);
  }
  const next = [...without(current), scope];
  return scope === AuthTerminalOperateScope && !next.includes(AuthTerminalReadScope) ? [...next, AuthTerminalReadScope] : next;
}

function scopesOf(value: { scopes?: ReadonlyArray<AuthEnvironmentScope>; permissions?: ReadonlyArray<AuthEnvironmentScope> }) {
  return value.permissions ?? value.scopes ?? [];
}

function ScopeSummary({ scopes }: { scopes: ReadonlyArray<AuthEnvironmentScope> }) {
  const theme = useTheme();
  return (
    <Tooltip content={`Granted scopes: ${scopes.join(", ")}`} side="top">
      <div style={{ display: "flex" }}>
        <Text size="xs" color={theme.mutedForeground}>
          {`${scopes.length} ${scopes.length === 1 ? "scope" : "scopes"}`}
        </Text>
      </div>
    </Tooltip>
  );
}

function AccessRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
      {children}
    </div>
  );
}

function PairingLinkRow({
  link,
  credential,
  serverUrl,
  revoking,
  canRevoke,
  onRevoke,
}: {
  link: AuthPairingLink;
  credential: string | undefined;
  /** The URL this client reached the environment at; web shares its page origin. */
  serverUrl: string | null;
  revoking: boolean;
  canRevoke: boolean;
  onRevoke: () => void;
}) {
  const theme = useTheme();
  const expiresAt = isoOf(link.expiresAt)!;
  useRelativeTimeLabel(expiresAt);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const { copy, failedCopyValue, clearFailedCopy } = usePairingCopy();
  if (Date.parse(expiresAt) <= Date.now()) return null;
  const shareableUrl = credential ? resolveShareablePairingUrl(serverUrl, credential) : null;
  const copyCode = () => {
    if (credential) copy(credential, "code");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 }}>
            <StatusDot color={theme.warning} tooltip={`Link created at ${isoOf(link.createdAt)}`} />
            <Text weight={500}>{link.label ?? "Pairing link"}</Text>
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text size="xs" color={theme.mutedForeground}>{`${formatExpiresInLabel(expiresAt)} · `}</Text>
            <ScopeSummary scopes={scopesOf(link)} />
          </div>
          {!credential ? (
            <Text size="2xs" color={alpha(theme.mutedForeground, 0.7)}>
              Create a new link to share from this client.
            </Text>
          ) : shareableUrl === null ? (
            <Text size="2xs" color={alpha(theme.mutedForeground, 0.7)}>
              Copy the token and pair from another client using this backend’s reachable host.
            </Text>
          ) : null}
        </div>
        {shareableUrl ? (
          <Button size="xs" variant="outline" icon="qr-code" testId={`pairing-link-share-${link.id}`} onClick={() => setSharePanelOpen(!sharePanelOpen)}>
            Share
          </Button>
        ) : credential ? (
          <Button size="xs" variant="outline" icon="copy" testId={`pairing-link-copy-${link.id}`} onClick={copyCode}>
            Copy code
          </Button>
        ) : null}
        <DestructiveOutlineButton disabled={!canRevoke || revoking} onClick={onRevoke}>
          {revoking ? "Revoking…" : "Revoke"}
        </DestructiveOutlineButton>
      </div>
      {sharePanelOpen && shareableUrl ? (
        <PairingSharePanel url={shareableUrl} onCopyLink={() => copy(shareableUrl, "link")} onCopyCode={copyCode} />
      ) : null}
      {credential ? <PairingRevealDialog value={failedCopyValue} credential={credential} onClose={clearFailedCopy} onCopyCode={copyCode} /> : null}
    </div>
  );
}

function ClientSessionRow({ session, revoking, canRevoke, onRevoke }: { session: AuthClientSession; revoking: boolean; canRevoke: boolean; onRevoke: () => void }) {
  const theme = useTheme();
  const live = session.current || session.connected;
  const lastConnectedAt = isoOf(session.lastConnectedAt);
  const since = useRelativeTimeLabel(lastConnectedAt);
  const statusTooltip = live ? (lastConnectedAt ? `Connected for ${since}` : "Connected") : lastConnectedAt ? `Last connected ${since}` : "Not connected yet.";
  const deviceInfo = [
    session.client.deviceType !== "unknown" ? session.client.deviceType[0]?.toUpperCase() + session.client.deviceType.slice(1) : null,
    session.client.os ?? null,
    session.client.browser ?? null,
    session.client.ipAddress ?? null,
  ].filter((value): value is string => value !== null);
  const label = session.client.label ?? ([session.client.os, session.client.browser].filter(Boolean).join(" · ") || session.subject);
  return (
    <AccessRow>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 }}>
          <StatusDot color={live ? theme.success : alpha(theme.mutedForeground, 0.3)} tooltip={statusTooltip} />
          <Text weight={500}>{label}</Text>
          {session.current ? (
            <div style={{ display: "flex", paddingLeft: 4, paddingRight: 4, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: alpha(theme.border, 0.5), backgroundColor: alpha(theme.muted, 0.5) }}>
              <Text size="3xs" color={alpha(theme.mutedForeground, 0.8)}>
                This device
              </Text>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          {deviceInfo.length > 0 ? <Text size="xs" color={theme.mutedForeground}>{`${deviceInfo.join(" · ")} · `}</Text> : null}
          <ScopeSummary scopes={scopesOf(session)} />
        </div>
      </div>
      {!session.current ? (
        <DestructiveOutlineButton disabled={!canRevoke || revoking} onClick={onRevoke}>
          {revoking ? "Revoking…" : "Revoke"}
        </DestructiveOutlineButton>
      ) : null}
    </AccessRow>
  );
}

function CreatePairingLinkDialog({
  open,
  onOpenChange,
  environmentId,
  delegatableScopes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId;
  delegatableScopes: ReadonlyArray<AuthEnvironmentScope>;
  onCreated: (id: string, credential: string) => void;
}) {
  const theme = useTheme();
  const standard = () => AuthStandardClientScopes.filter((scope) => delegatableScopes.includes(scope));
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<ReadonlyArray<AuthGrantScope>>(standard);
  const [creating, setCreating] = useState(false);
  const selected = scopes.filter((scope) => delegatableScopes.includes(scope));
  const reset = () => {
    setLabel("");
    setScopes(standard());
  };
  const create = async () => {
    if (selected.length === 0 || !readEnvironmentScope(environmentId, AuthAccessWriteScope)) return;
    setCreating(true);
    try {
      const created = await createPairingCredential(environmentId, { label, scopes: selected });
      onCreated(created.id, created.credential);
      reset();
      onOpenChange(false);
    } catch (error) {
      toast({ type: "error", title: "Could not create pairing URL", description: errorMessage(error, "Failed to create pairing URL.") });
    }
    setCreating(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      width={448}
      testId="create-pairing-link-dialog"
      title="Create pairing link"
      description="Generate a one-time link that another device can use to pair with this backend as an authorized client."
      footer={
        <>
          <Button variant="outline" size="sm" disabled={creating} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={creating || selected.length === 0} onClick={() => void create()} testId="create-pairing-link-confirm">
            {creating ? "Creating…" : "Create link"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Text size="xs" weight={500}>
            Client label (optional)
          </Text>
          <TextField width="100%" value={label} placeholder="e.g. Living room iPad" onChange={setLabel} testId="pairing-link-label" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <Text size="xs" weight={500}>
                Permissions
              </Text>
              <Text size="xs" color={theme.mutedForeground}>
                Limit what the paired client can do.
              </Text>
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  setScopes(
                    [AuthOrchestrationReadScope, AuthFilesystemReadScope, AuthDiagnosticsReadScope, AuthTerminalReadScope].filter((scope) =>
                      delegatableScopes.includes(scope),
                    ),
                  )
                }
              >
                Read only
              </Button>
              <Button size="xs" variant="outline" onClick={() => setScopes(standard())}>
                Standard
              </Button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.input, backgroundColor: alpha(theme.muted, 0.25), maxHeight: 520, overflowY: "scroll" }}>
            {AUTH_SCOPE_OPTIONS.filter(({ scope }) => delegatableScopes.includes(scope)).map(({ scope, title, description }, index) => {
              const checked = scopes.includes(scope);
              return (
                <div
                  key={scope}
                  onClick={() => setScopes((current) => togglePairingScopeSelection(current, scope, !checked))}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 12,
                    paddingLeft: 12,
                    paddingRight: 12,
                    paddingTop: 10,
                    paddingBottom: 10,
                    cursor: "pointer",
                    ...(index > 0 ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) } : {}),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 16,
                      height: 16,
                      marginTop: 2,
                      borderRadius: 4,
                      borderWidth: checked ? 0 : 1,
                      borderColor: theme.input,
                      backgroundColor: checked ? theme.primary : "#00000000",
                      flexShrink: 0,
                    }}
                  >
                    {checked ? <Icon name="check" size={12} color={theme.primaryForeground} /> : null}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <Text size="xs" weight={500}>
                      {title}
                    </Text>
                    <Text size="xs" color={theme.mutedForeground}>
                      {description}
                    </Text>
                  </div>
                </div>
              );
            })}
          </div>
          {selected.length === 0 ? (
            <Text size="xs" color={theme.errorForeground}>
              Select at least one permission.
            </Text>
          ) : selected.includes(AuthAccessWriteScope) ? (
            <Text size="xs" color={theme.warningForeground}>
              This client can create or revoke access for other devices.
            </Text>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function AuthorizedClientsSection({ environmentId, serverUrl }: { environmentId: EnvironmentId; serverUrl: string | null }) {
  const theme = useTheme();
  const canReadAccess = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const canWriteAccess = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const session = useEnvironmentSessionState(environmentId);
  const delegatableScopes = session.data?.authenticated ? (session.data.permissions ?? session.data.scopes ?? []) : [];
  const access = useAtomValue(authEnvironment.accessChanges({ environmentId, input: null }));
  const snapshot = access._tag === "Success" && access.value.type === "snapshot" ? access.value.payload : null;
  const pairingLinks = [...(snapshot?.pairingLinks ?? [])].sort((left, right) => (isoOf(right.createdAt) ?? "").localeCompare(isoOf(left.createdAt) ?? ""));
  const clientSessions = [...(snapshot?.clientSessions ?? [])].sort((left, right) =>
    left.current !== right.current
      ? left.current
        ? -1
        : 1
      : left.connected !== right.connected
        ? left.connected
          ? -1
          : 1
        : (isoOf(right.issuedAt) ?? "").localeCompare(isoOf(left.issuedAt) ?? ""),
  );
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [created, setCreated] = useState<ReadonlyMap<string, string>>(new Map());
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const summary = [
    `${clientSessions.length} ${clientSessions.length === 1 ? "client" : "clients"}`,
    pairingLinks.length > 0 ? `${pairingLinks.length} ${pairingLinks.length === 1 ? "pairing link" : "pairing links"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const guarded = async (key: string, title: string, action: () => Promise<unknown>) => {
    if (!readEnvironmentScope(environmentId, AuthAccessWriteScope)) return;
    setRevoking(key);
    try {
      await action();
    } catch (error) {
      toast({ type: "error", title, description: errorMessage(error, "The request failed.") });
    }
    setRevoking(null);
  };
  if (!canReadAccess && !canWriteAccess) return null;
  const canRevokeOthers = snapshot === null || clientSessions.some((entry) => !entry.current);
  return (
    <SettingsGroup divided={false}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16, paddingLeft: 16, paddingRight: 16 }}>
        <div
          testId="authorized-clients-toggle"
          onClick={() => setOpen(!open)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, flexGrow: 1, minWidth: 0, cursor: "pointer" }}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={16} color={theme.mutedForeground} />
          <Text weight={500}>Authorized clients</Text>
          <Text size="xs" color={theme.mutedForeground}>
            {summary}
          </Text>
        </div>
        {canWriteAccess ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <DestructiveOutlineButton
              testId="authorized-clients-revoke-others"
              disabled={revokingOthers || !canRevokeOthers}
              onClick={async () => {
                if (!readEnvironmentScope(environmentId, AuthAccessWriteScope)) return;
                setRevokingOthers(true);
                try {
                  const count = await revokeOtherClientSessions(environmentId);
                  toast({
                    type: "success",
                    title: count === 1 ? "Revoked 1 other client" : `Revoked ${count} clients`,
                    description: "Other paired clients will need a new pairing link before reconnecting.",
                  });
                } catch (error) {
                  toast({ type: "error", title: "Could not revoke other clients", description: errorMessage(error, "Failed to revoke other clients.") });
                }
                setRevokingOthers(false);
              }}
            >
              {revokingOthers ? "Revoking…" : "Revoke others"}
            </DestructiveOutlineButton>
            <Button size="xs" icon="plus" testId="authorized-clients-create-link" onClick={() => setDialogOpen(true)}>
              Create link
            </Button>
          </div>
        ) : null}
      </div>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.5), maxHeight: 360, overflowY: "scroll" }}>
          {!canReadAccess ? (
            <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
              <Text size="xs" color={theme.mutedForeground}>
                This connection can create access links but cannot view authorized clients.
              </Text>
            </div>
          ) : (
            <>
              {access._tag === "Failure" ? (
                <AccessRow>
                  <Text size="xs" color={theme.errorForeground}>
                    Could not load authorized clients.
                  </Text>
                </AccessRow>
              ) : null}
              {pairingLinks.map((link) => (
                <PairingLinkRow
                  key={link.id}
                  link={link}
                  credential={created.get(link.id)}
                  serverUrl={serverUrl}
                  revoking={revoking === link.id}
                  canRevoke={canWriteAccess}
                  onRevoke={() => void guarded(link.id, "Could not revoke pairing link", () => revokePairingLink(environmentId, link.id))}
                />
              ))}
              {clientSessions.map((clientSession) => (
                <ClientSessionRow
                  key={clientSession.sessionId}
                  session={clientSession}
                  revoking={revoking === clientSession.sessionId}
                  canRevoke={canWriteAccess}
                  onRevoke={() =>
                    void guarded(clientSession.sessionId, "Could not revoke client access", () => revokeClientSession(environmentId, clientSession.sessionId))
                  }
                />
              ))}
              {snapshot && pairingLinks.length === 0 && clientSessions.length === 0 ? (
                <AccessRow>
                  <Text size="xs" color={alpha(theme.mutedForeground, 0.6)}>
                    No pairing links or client sessions.
                  </Text>
                </AccessRow>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      <CreatePairingLinkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        environmentId={environmentId}
        delegatableScopes={delegatableScopes}
        onCreated={(id, credential) => {
          setCreated((current) => new Map(current).set(id, credential));
          setOpen(true);
        }}
      />
    </SettingsGroup>
  );
}

// ── Saved environments (SavedEnvironmentRows.tsx) ────────────────────────

function savedStatus(environment: EnvironmentPresentation): { text: string; tone: "muted" | "error" } {
  if (!environment.entry.enabled && environment.connection.phase !== "unsupported") return { text: "Off", tone: "muted" };
  const { connection } = environment;
  switch (connection.phase) {
    case "connected":
      return { text: "Connected", tone: "muted" };
    case "connecting":
      return { text: "Connecting", tone: "muted" };
    case "reconnecting":
      return { text: connection.error ? `Reconnecting: ${connection.error}` : "Reconnecting", tone: "error" };
    case "unsupported":
      return { text: "Client not supported", tone: "muted" };
    case "error":
      return { text: connection.error ? `Connection failed: ${connection.error}` : "Connection failed", tone: "error" };
    case "offline":
      return { text: "Offline", tone: "muted" };
    case "available":
      return { text: "Not connected", tone: "muted" };
  }
}

function SavedEnvironmentRow({
  environment,
  onRemove,
  onAddRoute,
}: {
  environment: EnvironmentPresentation;
  onRemove: (environment: EnvironmentPresentation) => void;
  onAddRoute: (environment: EnvironmentPresentation) => void;
}) {
  const theme = useTheme();
  const setEnabled = useAtomCommand(environmentCatalog.setEnabled, { reportFailure: false });
  const retryNow = useAtomCommand(environmentCatalog.retryNow);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const environmentId = environment.environmentId;
  const unsupported = environment.connection.phase === "unsupported";
  const blocked = unsupported && !hasSavedBearerRoute(environment.entry);
  const enabled = environment.entry.enabled && !unsupported;
  const connected = environment.connection.phase === "connected";
  const errorTraceId = environment.connection.traceId;
  const status = savedStatus(environment);
  const { diagnosis, state: connectionState, relayOnly } = useConnectionDiagnosis(environment);
  const prepared = useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId));
  const connectedTarget = connected && Option.isSome(prepared) ? prepared.value.target : null;
  const mcpUrl = environmentMcpUrl({ entry: environment.entry, connectedTarget });
  const routeCount = connectionRoutes(environment.entry).length;
  // The diagnosis headline below names the failure in full.
  const subtitleText = [environmentTransportLabel(environment, connectedTarget), diagnosis ? null : status.text]
    .filter((value): value is string => value !== null)
    .join(" · ");
  const statusTooltip = unsupported
    ? (environment.connection.error ?? connectionStatusText(environment.connection))
    : enabled
      ? connectionStatusText(environment.connection)
      : "Switched off";
  const dot = (
    <Text size="xs" color={theme.mutedForeground}>
      ·
    </Text>
  );
  return (
    <EnvironmentRow
      testId={`saved-environment-${environmentId}`}
      kind={resolveEnvironmentMachineKind(environment.serverConfig)}
      label={environment.label}
      dimmed={!enabled}
      subtitle={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
          <Tooltip content={statusTooltip} side="top">
            <div style={{ display: "flex", minWidth: 0, flexShrink: 1 }}>
              <Text size="xs" truncate color={enabled && status.tone === "error" && !diagnosis ? theme.errorForeground : theme.mutedForeground}>
                {subtitleText}
              </Text>
            </div>
          </Tooltip>
          {dot}
          <SubtitleToggle label={routeCount === 1 ? "Routes" : `${routeCount} routes`} open={routesOpen} onToggle={() => setRoutesOpen(!routesOpen)} testId={`environment-routes-${environmentId}`} />
          {dot}
          <SubtitleToggle label="Permissions" open={permissionsOpen} onToggle={() => setPermissionsOpen(!permissionsOpen)} testId={`environment-permissions-${environmentId}`} />
        </div>
      }
      below={
        diagnosis ? (
          <ConnectionDiagnosisSummary
            testId={`environment-diagnosis-${environmentId}`}
            diagnosis={diagnosis}
            retryAt={connectionState.phase === "backoff" ? connectionState.retryAt : null}
            attempt={connectionState.attempt}
            expanded={diagnosisOpen}
            onToggle={() => setDiagnosisOpen(!diagnosisOpen)}
          />
        ) : null
      }
      detail={
        diagnosis && diagnosisOpen || routesOpen || permissionsOpen ? (
          <>
            {diagnosis && diagnosisOpen ? (
              <ConnectionDiagnosisPanel
                hostLabel={environment.label}
                diagnosis={diagnosis}
                onRetry={() => void retryNow(environmentId)}
                onAddRoute={relayOnly ? () => onAddRoute(environment) : null}
              />
            ) : null}
            {routesOpen ? <EnvironmentRoutesList environment={environment} onAddRoute={() => onAddRoute(environment)} /> : null}
            {permissionsOpen ? (
              <div style={{ marginTop: 8, borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) }}>
                <SessionPermissions environmentId={environmentId} connected={connected} routeContext />
              </div>
            ) : null}
          </>
        ) : null
      }
    >
      <Tooltip content={blocked ? "Client not supported" : enabled ? "Switch off" : "Switch on"} side="top">
        <div style={{ display: "flex" }}>
          <Switch
            size="sm"
            testId={`environment-enabled-${environmentId}`}
            checked={enabled}
            disabled={blocked}
            onChange={async (checked) => {
              const result = await setEnabled({ environmentId, enabled: checked });
              if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                toast({ type: "error", title: `Could not switch backend ${checked ? "on" : "off"}`, description: errorMessage(squashAtomCommandFailure(result), "") });
              }
            }}
          />
        </div>
      </Tooltip>
      <Menu
        align="end"
        minWidth={220}
        trigger={({ toggle }) => <IconButton icon="ellipsis" size={24} iconSize={14} onClick={toggle} testId={`environment-menu-${environmentId}`} />}
      >
        <EnvironmentIconMenuItems environment={environment} />
        <MenuItem icon="route" onSelect={() => setRoutesOpen(!routesOpen)}>
          {routesOpen ? "Hide routes" : "Routes"}
        </MenuItem>
        {mcpUrl ? (
          <MenuItem
            onSelect={() =>
              copyText(mcpUrl)
                ? toast({ type: "success", title: "MCP URL copied", description: `Add it to an agent, e.g. claude mcp add --transport http t3 ${mcpUrl}` })
                : toast({ type: "error", title: "Could not copy MCP URL" })
            }
          >
            Copy MCP URL
          </MenuItem>
        ) : null}
        {errorTraceId ? (
          <MenuItem
            onSelect={() =>
              copyText(errorTraceId)
                ? toast({ type: "success", title: "Trace ID copied", description: errorTraceId })
                : toast({ type: "error", title: "Could not copy trace ID" })
            }
          >
            Copy trace ID
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem destructive onSelect={() => onRemove(environment)}>
          Remove from this device…
        </MenuItem>
      </Menu>
    </EnvironmentRow>
  );
}

// ── AddEnvironmentDialog.tsx (Remote link only; SSH needs the desktop bridge) ──

/** ConnectionsSettings.logic.ts parsePairingUrlFields (hostedPairing.readHostedPairingRequest inlined). */
function parsePairingUrlFields(input: string): { readonly host: string; readonly pairingCode: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const urlLikeInput = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//u.test(trimmed) || trimmed.startsWith("//") ? trimmed : `https://${trimmed}`;
    const url = new URL(urlLikeInput, "https://localhost");
    const hostedHost = url.searchParams.get("host")?.trim() ?? "";
    const token = getPairingTokenFromUrl(url)?.trim() ?? "";
    if (hostedHost && token) return { host: hostedHost, pairingCode: token };
    if (!token) return null;
    return { host: url.origin, pairingCode: token };
  } catch {
    return null;
  }
}

/** ConnectionsSettings.logic.ts parseRemotePairingFields */
function parseRemotePairingFields(input: { readonly host: string; readonly pairingCode: string }) {
  const parsed = parsePairingUrlFields(input.host);
  if (parsed) return parsed;
  const host = input.host.trim();
  const pairingCode = input.pairingCode.trim();
  if (!host) throw new Error("Enter a backend host.");
  if (!pairingCode) throw new Error("Enter a pairing code.");
  return { host, pairingCode };
}

function AddEnvironmentDialog({
  open,
  onOpenChange,
  routeTarget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Adding a route to this environment instead of a new one. */
  routeTarget: EnvironmentPresentation | null;
}) {
  const theme = useTheme();
  const pair = useAtomCommand(registerPairing, { reportFailure: false });
  const [host, setHost] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // gpuix inputs keep their own text while focused; remount the host field when
  // a pasted pairing URL is split so it shows the parsed host like web does.
  const [hostFieldKey, setHostFieldKey] = useState(0);
  const changeHost = (value: string) => {
    const parsed = parsePairingUrlFields(value);
    if (parsed) {
      setHost(parsed.host);
      setCode(parsed.pairingCode);
      setHostFieldKey((key) => key + 1);
      return;
    }
    setHost(value);
  };
  const fail = (message: string) => {
    setError(message);
    toast({ type: "error", title: "Could not add backend", description: message });
  };
  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    let input: { host: string; pairingCode: string };
    try {
      input = parseRemotePairingFields({ host, pairingCode: code });
    } catch (cause) {
      fail(errorMessage(cause, "Failed to add backend."));
      setPending(false);
      return;
    }
    const result = await pair({ ...input, ...(routeTarget ? { expectedEnvironmentId: routeTarget.environmentId } : {}) });
    setPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) fail(errorMessage(squashAtomCommandFailure(result), "Failed to add backend."));
      return;
    }
    setHost("");
    setCode("");
    onOpenChange(false);
    toast(
      routeTarget
        ? { type: "success", title: "Route added", description: `${routeTarget.label} now has another way to connect.` }
        : { type: "success", title: "Backend added", description: "The environment is saved and will reconnect on app startup." },
    );
  };
  const field = (label: string, input: ReactNode, width?: number) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...(width ? { width, flexShrink: 0 } : { flexGrow: 1, minWidth: 0 }) }}>
      <Text size="xs" weight={500}>
        {label}
      </Text>
      {input}
    </div>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      width={768}
      testId="add-environment-dialog"
      title={routeTarget ? `Add a route to ${routeTarget.label}` : "Add Environment"}
      description={
        routeTarget
          ? "Pair this machine again over another address, such as its Tailscale name. It joins the existing routes instead of adding a second machine."
          : "Pair another environment to this client."
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 12,
              width: 352,
              minHeight: 96,
              padding: 16,
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              borderColor: alpha(theme.primary, 0.5),
              backgroundColor: alpha(theme.primary, 0.05),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                marginTop: 2,
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: alpha(theme.primary, 0.3),
                backgroundColor: alpha(theme.primary, 0.1),
                flexShrink: 0,
              }}
            >
              <Icon name="code" size={16} color={theme.primary} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <Text weight={500}>Remote link</Text>
              <Text size="xs" color={theme.mutedForeground}>
                Enter a backend host and pairing code.
              </Text>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
            {field("Host", <TextField key={hostFieldKey} width="100%" value={host} placeholder="backend.example.com" onChange={changeHost} onSubmit={() => void submit()} testId="add-environment-host" />)}
            {field("Pairing code", <TextField width="100%" value={code} placeholder="PAIRCODE" onChange={setCode} onSubmit={() => void submit()} testId="add-environment-code" />, 160)}
          </div>
          <Text size="2xs" color={theme.mutedForeground} style={{ marginTop: 4 }}>
            Paste a full pairing URL here to fill both fields automatically.
          </Text>
        </div>
        {error ? (
          <Text size="xs" color={theme.errorForeground}>
            {error}
          </Text>
        ) : null}
        <Button variant="outline" icon="plus" disabled={pending} onClick={() => void submit()} testId="add-environment-submit" style={{ width: "100%" }}>
          {pending ? "Adding…" : routeTarget ? "Add route" : "Add environment"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export function ConnectionsSettings() {
  const theme = useTheme();
  const { environments } = useEnvironments();
  const primaryEnvironment = usePrimaryEnvironment();
  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  const removeEnvironment = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const [addOpen, setAddOpen] = useState(false);
  const [routeTarget, setRouteTarget] = useState<EnvironmentPresentation | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<EnvironmentPresentation | null>(null);
  const [removing, setRemoving] = useState(false);
  const primarySession = useEnvironmentSessionState(primaryEnvironmentId ?? ("" as EnvironmentId));
  const authPolicy = primarySession.data?.auth.policy ?? null;
  const savedEnvironments = environments.filter((environment) => environment.environmentId !== primaryEnvironmentId);
  const loadBalancingEnvironments = [
    ...(primaryEnvironment ? [primaryEnvironment] : []),
    ...savedEnvironments.filter((environment) => environment.entry.enabled),
  ].filter((environment) => environment.connection.phase !== "unsupported");
  const primaryServerConfig = primaryEnvironment?.serverConfig ?? null;
  const versionDescription =
    [primaryServerConfig?.environment.serverVersion ?? null, primaryEnvironment?.displayUrl ?? null].filter((value): value is string => value !== null).join(" · ") ||
    "Loading…";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <SettingsPageContainer showScope={false}>
      {primaryEnvironment ? (
        <>
          <SettingsSection
            {...searchableSetting("connections-environment")}
            title={primaryEnvironment.label}
            icon={<Icon name={machineIcon(primaryServerConfig)} size={16} color={alpha(theme.foreground, 0.7)} />}
            headerAction={
              <Menu
                open={menuOpen}
                onOpenChange={setMenuOpen}
                align="end"
                minWidth={220}
                trigger={({ toggle }) => <IconButton icon="ellipsis" size={24} iconSize={14} onClick={toggle} testId="connections-primary-menu" />}
              >
                <EnvironmentIconMenuItems environment={primaryEnvironment} />
              </Menu>
            }
          >
            <SettingsRow
              title="Version"
              description={versionDescription}
              control={
                primaryServerConfig ? (
                  <Text size="xs" color={theme.mutedForeground}>
                    Up to date
                  </Text>
                ) : undefined
              }
            />
            <SettingsRow
              title={searchableSetting("network-access").title}
              description={
                authPolicy === "remote-reachable"
                  ? "Remote access is already configured. Change network exposure where the server starts."
                  : authPolicy === "loopback-browser"
                    ? "Only this machine can connect. Restart with a non-loopback host for remote pairing."
                    : "Network exposure information is unavailable."
              }
              control={
                authPolicy === "remote-reachable" || authPolicy === "loopback-browser" ? (
                  <Tooltip content="Network exposure changes restart the backend and must be controlled where the server process is launched." side="top">
                    <div style={{ display: "flex" }}>
                      <Switch checked={authPolicy === "remote-reachable"} disabled onChange={() => {}} />
                    </div>
                  </Tooltip>
                ) : undefined
              }
            />
            <Disclosure title="Permissions" testId="connections-permissions">
              <SessionPermissions environmentId={primaryEnvironment.environmentId} connected={primaryEnvironment.connection.phase === "connected"} />
            </Disclosure>
          </SettingsSection>
          <AuthorizedClientsSection environmentId={primaryEnvironment.environmentId} serverUrl={primaryEnvironment.displayUrl} />
        </>
      ) : null}
      <SettingsSection
        id="connections-environments"
        title="Environments"
        headerAction={
          <Button size="xs" variant="ghost-muted" icon="plus" testId="connections-add-environment"
            onClick={() => {
              setRouteTarget(null);
              setAddOpen(true);
            }}
          >
            Add environment
          </Button>
        }
      >
        {savedEnvironments.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 48, paddingBottom: 48 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 36,
                marginBottom: 32,
                borderRadius: RADIUS.lg,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.card,
              }}
            >
              <Icon name="code" size={16} color={theme.foreground} />
            </div>
            <Text size="xl" weight={600}>
              No saved remote environments
            </Text>
            <Text color={theme.mutedForeground}>Click “Add environment” to pair another environment.</Text>
          </div>
        ) : (
          savedEnvironments.map((environment) => (
            <SavedEnvironmentRow
              key={environment.environmentId}
              environment={environment}
              onRemove={setPendingRemoval}
              onAddRoute={(target) => {
                setRouteTarget(target);
                setAddOpen(true);
              }}
            />
          ))
        )}
      </SettingsSection>
      <LoadBalancingSettings environments={loadBalancingEnvironments} />
      <GitHubRoutingSettings environments={loadBalancingEnvironments} />
      <AddEnvironmentDialog open={addOpen} onOpenChange={setAddOpen} routeTarget={routeTarget} />
      <Dialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
        title={`Remove ${pendingRemoval?.label ?? "environment"} from this device?`}
        description="This forgets its pairing, credentials, and cached threads here. Switch it off instead to keep it saved."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setPendingRemoval(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={removing}
              onClick={async () => {
                const environment = pendingRemoval;
                if (!environment) return;
                setRemoving(true);
                const result = await removeEnvironment(environment.environmentId);
                setRemoving(false);
                setPendingRemoval(null);
                if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                  toast({ type: "error", title: "Could not remove backend", description: errorMessage(squashAtomCommandFailure(result), "Failed to remove backend.") });
                }
              }}
            >
              {removing ? "Removing…" : "Remove"}
            </Button>
          </>
        }
      />
    </SettingsPageContainer>
  );
}
