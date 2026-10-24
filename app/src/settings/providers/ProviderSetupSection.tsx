// Port of apps/web/src/components/settings/ProviderSetupSection.tsx: Antigravity's Setup
// rows (the environment that runs it, the runtime T3 Code downloads and manages, and the
// account). Install, cancel and remove go through dryRun.ts.
import { isAtomCommandInterrupted, squashAtomCommandFailure, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  ANTIGRAVITY_AUTH_METHODS,
  type AntigravityAuthMethod,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { requestConfirmDialog } from "../../dialogs/confirmDialog.ts";
import { serverEnvironment } from "../../state/environment.ts";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import { useEnvironmentQuery } from "../query.ts";
import { useProviderActionCommand } from "./dryRun.ts";
import { StackedRow } from "./parts.tsx";
import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection.tsx";

export function readAntigravityAuthMethod(config: unknown): AntigravityAuthMethod {
  const value = config !== null && typeof config === "object" && "authMethod" in config ? config.authMethod : undefined;
  return ANTIGRAVITY_AUTH_METHODS.find((method) => method.value === value)?.value ?? "oauth-personal";
}

/** `divide-y divide-border/50` */
export function DividedRows({ children }: { children: ReadonlyArray<ReactNode> }) {
  const theme = useTheme();
  const rows = children.filter((child) => child !== null && child !== undefined && child !== false);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {rows.map((row, index) => (
        <div key={index} style={{ display: "flex", flexDirection: "column", width: "100%", ...(index > 0 ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) } : {}) }}>
          {row}
        </div>
      ))}
    </div>
  );
}

export function ProviderSetupSection(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly binaryPath?: string | undefined;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly onEnable: () => void;
}) {
  const theme = useTheme();
  return (
    <DividedRows>
      {[
        <StackedRow
          key="environment"
          title="Environment"
          description="Device that runs this provider."
          control={
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <Text size="xs" color={theme.mutedForeground}>
                {props.environmentLabel}
              </Text>
              {!props.enabled && !props.readOnly ? (
                <div style={{ display: "flex", flexDirection: "row" }}>
                  <Button size="sm" variant="outline" onClick={props.onEnable} testId="antigravity-enable">
                    Enable Antigravity
                  </Button>
                </div>
              ) : null}
            </div>
          }
        />,
        props.readOnly ? (
          <StackedRow key="unavailable" title="Setup unavailable" description="Provider setup is read-only." />
        ) : props.provider?.setup === undefined ? (
          <StackedRow key="update" testId="provider-setup-update-required" title="Update required" description="Update this environment to manage Antigravity." />
        ) : (
          <ProviderSetupActions
            key={`${props.environmentId}:${props.instanceId}`}
            environmentId={props.environmentId}
            environmentLabel={props.environmentLabel}
            instanceId={props.instanceId}
            provider={props.provider}
            binaryPath={props.binaryPath}
            enabled={props.enabled}
          />
        ),
      ]}
    </DividedRows>
  );
}

function ProviderSetupActions({
  environmentId,
  environmentLabel,
  instanceId,
  provider,
  enabled,
  binaryPath,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider;
  readonly binaryPath?: string | undefined;
  readonly enabled: boolean;
}) {
  const theme = useTheme();
  const target = useMemo(() => ({ environmentId, input: { instanceId } }), [environmentId, instanceId]);
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const installQuery = useEnvironmentQuery(serverEnvironment.providerInstallState(target));
  const auth = authQuery.data;
  const installation = installQuery.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startInstall = useProviderActionCommand(serverEnvironment.startProviderInstall, "Install provider runtime", commandOptions);
  const cancelInstall = useProviderActionCommand(serverEnvironment.cancelProviderInstall, "Cancel provider install", commandOptions);
  const removeInstall = useProviderActionCommand(serverEnvironment.removeProviderInstallation, "Remove provider runtime", commandOptions);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const authActive = auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const installActive = installation?.phase === "downloading" || installation?.phase === "extracting" || installation?.phase === "verifying";
  const usesCustomBinary = Boolean(binaryPath?.trim());
  const installed = provider.installed || (!usesCustomBinary && installation?.installedVersion != null);
  const queryError = authQuery.error ?? installQuery.error;
  const actionsDisabled = pendingLabel !== null || queryError !== null;
  const installationStatusMessage =
    installation?.phase === "downloading"
      ? `Downloading ${(installation.downloadedBytes / 1_000_000).toFixed(1)} MB${installation.totalBytes === null ? "" : ` of ${(installation.totalBytes / 1_000_000).toFixed(1)} MB`}.`
      : installation?.phase === "extracting"
        ? "Extracting Antigravity."
        : installation?.phase === "verifying"
          ? "Checking the downloaded runtime."
          : installed
            ? "Installed."
            : usesCustomBinary
              ? enabled
                ? "The configured Antigravity runtime is unavailable."
                : "The configured Antigravity runtime has not been checked."
              : installation?.totalBytes
                ? `${Math.ceil(installation.totalBytes / 1_000_000)} MB download.`
                : "Not installed.";

  async function runCommand<A, E>(label: string, request: () => Promise<AtomCommandResult<A, E>>): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingLabel(label);
    setError(null);
    let result: AtomCommandResult<A, E> | null = null;
    try {
      result = await request();
    } catch {
      setError("Provider setup failed. Try again.");
    }
    pendingRef.current = false;
    setPendingLabel(null);
    if (result === null) return false;
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Provider setup failed.");
      }
      return false;
    }
    return true;
  }

  async function removeRuntime() {
    const confirmed = await requestConfirmDialog(
      `Remove the downloaded Antigravity runtime from ${environmentLabel}? Google sign-in and thread history are kept.`,
    );
    if (confirmed) await runCommand("Removing runtime", () => removeInstall(target));
  }

  const installLabel = installation?.installedVersion
    ? installation.version && installation.version !== installation.installedVersion
      ? "Update Antigravity"
      : "Reinstall Antigravity"
    : installation?.phase === "failed" || installation?.phase === "cancelled"
      ? "Retry installation"
      : installed
        ? "Install managed runtime"
        : "Install Antigravity";
  const progress =
    installation?.phase === "downloading" && installation.totalBytes !== null && installation.totalBytes > 0
      ? Math.min(1, installation.downloadedBytes / installation.totalBytes)
      : null;

  return (
    <DividedRows>
      {[
        <StackedRow
          key="runtime"
          testId="provider-setup-runtime"
          title="Runtime"
          description="Install and manage Antigravity."
          status={
            usesCustomBinary || (!installed && !provider.setup?.canInstall) ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {usesCustomBinary ? (
                  <Text size="xs" color={theme.mutedForeground}>
                    Uses the custom binary path below. Installation keeps that path.
                  </Text>
                ) : null}
                {!installed && !provider.setup?.canInstall ? (
                  <Text size="xs" color={theme.mutedForeground}>
                    Automatic installation unavailable. Set a binary path or use another environment.
                  </Text>
                ) : null}
              </div>
            ) : undefined
          }
          control={
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", minWidth: 0 }}>
              <Text size="xs" color={theme.mutedForeground} style={{ minHeight: 16 }}>
                {installationStatusMessage}
              </Text>
              {/* The progress track keeps its 4px slot so the buttons below don't move. */}
              <div style={{ display: "flex", width: "100%", height: 4, borderRadius: 2, ...(progress !== null ? { backgroundColor: theme.muted } : {}) }}>
                {progress !== null ? <div style={{ width: `${Math.round(progress * 100)}%` as never, height: 4, borderRadius: 2, backgroundColor: theme.primary }} /> : null}
              </div>
              {!installActive && installation?.message && installation.message !== installationStatusMessage ? (
                <Text size="xs" color={theme.mutedForeground}>
                  {installation.message}
                </Text>
              ) : null}
              {/* grid-cols-[1.75rem_minmax(0,1fr)]: the remove button, then the main action. */}
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 }}>
                <div style={{ display: "flex", width: 28, flexShrink: 0 }}>
                  {installation?.canRemove && !installActive ? (
                    <Tooltip content="Remove downloaded runtime" side="top">
                      <IconButton
                        icon="trash-2"
                        size={28}
                        iconSize={14}
                        disabled={actionsDisabled || authActive}
                        onClick={() => void removeRuntime()}
                        testId="provider-setup-remove"
                      />
                    </Tooltip>
                  ) : null}
                </div>
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                  {installActive && installation.operationId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionsDisabled}
                      testId="provider-setup-cancel"
                      style={{ width: "100%" }}
                      onClick={() => {
                        const operationId = installation.operationId;
                        if (!operationId) return;
                        void runCommand("Cancelling installation", () => cancelInstall({ environmentId, input: { instanceId, operationId } }));
                      }}
                    >
                      Cancel installation
                    </Button>
                  ) : !installActive && provider.setup?.canInstall ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionsDisabled || installation === null || authActive}
                      testId="provider-setup-install"
                      style={{ width: "100%" }}
                      onClick={() => void runCommand("Starting installation", () => startInstall(target))}
                    >
                      {installLabel}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          }
        />,
        <ProviderAuthenticationSection
          key="account"
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          instanceId={instanceId}
          provider={provider}
          readOnly={false}
        />,
        error || queryError ? (
          <div key="error" style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
            <Text size="xs" color={theme.errorForeground}>
              {error ?? queryError ?? ""}
            </Text>
            {queryError ? (
              <div style={{ display: "flex", flexDirection: "row" }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    authQuery.refresh();
                    installQuery.refresh();
                  }}
                >
                  Retry setup status
                </Button>
              </div>
            ) : null}
          </div>
        ) : null,
      ]}
    </DividedRows>
  );
}
