// Port of apps/web/src/components/chat/useSystemComposerBanners.tsx and
// useAutoBalanceUpdateBanner.tsx: the composer banners about the machine itself,
// offline or reconnecting, a server update, and auto-balanced machines that need one.
//
// t3-term differences:
//   - web's ConnectionDiagnosisHeadline is `connectionHeadline` below. For a host the
//     client cannot talk to (phase "unsupported") web shows no description; t3-term
//     shows the blocking reason, because this banner is the only place a client user
//     sees it.
//   - The version compared against the server's is the pinned T3 Code version
//     (web/versionSkew.ts); T3TERM_DEV_CLIENT_VERSION overrides it for development.
//   - Auto-balance: t3-term has no load-balanced drafts yet, so callers pass no
//     auto-update environments and that banner never forms. The hook is ported whole
//     so wiring load balancing later only has to feed it.
import { useAtomValue } from "@effect/atom-react";
import { connectionRoutes, hasRelayRoute, presentConnectionDiagnosis } from "@t3tools/client-runtime/connection";
import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import {
  ComposerServerUpdateIcon,
  ServerUpdateAction,
  ServerUpdateProgress,
  ServerUpdatesAction,
  serverUpdateStageLabel,
} from "../../connect/ServerUpdateAction.tsx";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { APP_VERSION } from "../../runtime/platform.ts";
import { environmentConnectionViewAtom, type EnvironmentConnectionView } from "../../state/connect.ts";
import { environmentCatalog, serverEnvironment } from "../../state/environment.ts";
import { routeAtom } from "../../state/ui.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import {
  hasEnvironmentReconnectWarningGraceElapsed,
  scheduleEnvironmentReconnectWarning,
} from "../../web/components/ChatView.logic.ts";
import { useEnvironmentDisconnectDelay } from "../../web/hooks/useEnvironmentDisconnectDelay.ts";
import {
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  serverUpdateGuidance,
  supportsDesktopAppUpdate,
  supportsServerUpdateThreadContinuation,
} from "../../web/versionSkew.ts";
import { BannerText, InlineButton } from "./ComposerBannerParts.tsx";
import type { ComposerBannerStackItem } from "./ComposerBannerStack.tsx";

/** The parts of web's `EnvironmentPresentation` these banners read. */
export interface SystemBannerEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly serverConfig: ServerConfig | null;
  readonly connection: EnvironmentConnectionView["connection"];
}

interface SystemComposerBannersInput {
  /** The machine the composer sends to: the thread's, or the draft's. */
  readonly environmentId: EnvironmentId | null;
  readonly hasMultipleRegisteredEnvironments: boolean;
  readonly automaticEnvironment: boolean;
  readonly autoUpdateEnvironments: ReadonlyArray<SystemBannerEnvironment>;
}

const NO_ENVIRONMENT_VIEW_ATOM = Atom.make<EnvironmentConnectionView | null>(null);
const NO_SERVER_CONFIG_ATOM = Atom.make<ServerConfig | null>(null);

/**
 * The composer banners about the machine itself: offline or reconnecting,
 * a server update, and auto-balanced machines that need one.
 */
export function useSystemComposerBanners(input: SystemComposerBannersInput): ComposerBannerStackItem[] {
  const { environmentId, hasMultipleRegisteredEnvironments, automaticEnvironment, autoUpdateEnvironments } = input;
  const activeEnvironment = useAtomValue(
    environmentId === null ? NO_ENVIRONMENT_VIEW_ATOM : environmentConnectionViewAtom(environmentId),
  );
  const serverConfig = useAtomValue(
    environmentId === null ? NO_SERVER_CONFIG_ATOM : serverEnvironment.configValueAtom(environmentId),
  );
  const activeEnvironmentUnavailable = activeEnvironment !== null && activeEnvironment.connection.phase !== "connected";
  const activeEnvironmentUnavailableState =
    activeEnvironmentUnavailable && activeEnvironment
      ? {
          environmentId: activeEnvironment.environmentId,
          label: activeEnvironment.label,
          connection: activeEnvironment.connection,
        }
      : null;

  const activeEnvironmentConnectionPhase = activeEnvironment?.connection.phase ?? "available";
  const activeReconnectingEnvironmentId =
    activeEnvironmentConnectionPhase === "connecting" || activeEnvironmentConnectionPhase === "reconnecting"
      ? (activeEnvironment?.environmentId ?? null)
      : null;
  const [reconnectWarningGraceElapsedEnvironmentId, setReconnectWarningGraceElapsedEnvironmentId] =
    useState<EnvironmentId | null>(null);
  // Each reconnect attempt gets its own grace period, including a later one to
  // the same environment.
  const [graceReconnectingEnvironmentId, setGraceReconnectingEnvironmentId] = useState(activeReconnectingEnvironmentId);
  if (graceReconnectingEnvironmentId !== activeReconnectingEnvironmentId) {
    setGraceReconnectingEnvironmentId(activeReconnectingEnvironmentId);
    setReconnectWarningGraceElapsedEnvironmentId(null);
  }
  const reconnectWarningGraceElapsed = hasEnvironmentReconnectWarningGraceElapsed(
    activeReconnectingEnvironmentId,
    reconnectWarningGraceElapsedEnvironmentId,
  );
  useEffect(() => {
    if (activeReconnectingEnvironmentId === null) return;
    return scheduleEnvironmentReconnectWarning(() =>
      setReconnectWarningGraceElapsedEnvironmentId(activeReconnectingEnvironmentId),
    );
  }, [activeReconnectingEnvironmentId]);
  const disconnectDelayElapsed = useEnvironmentDisconnectDelay(
    activeEnvironmentUnavailable && activeEnvironment ? activeEnvironment.environmentId : null,
  );
  const canDisconnectActiveEnvironment =
    disconnectDelayElapsed &&
    activeEnvironment !== null &&
    activeEnvironment.entry.target._tag !== "PrimaryConnectionTarget";
  const [disconnectingEnvironment, setDisconnectingEnvironment] = useState(false);
  const handleDisconnectActiveEnvironment = async (target: EnvironmentId) => {
    setDisconnectingEnvironment(true);
    await disconnectEnvironment(target);
    setDisconnectingEnvironment(false);
  };

  const autoBalanceUpdateBanner = useAutoBalanceUpdateBanner(autoUpdateEnvironments);
  const versionMismatch = resolveServerConfigVersionMismatch(serverConfig);
  const versionMismatchDismissKey =
    versionMismatch && environmentId !== null ? buildVersionMismatchDismissalKey(environmentId, versionMismatch) : null;
  const [dismissedVersionMismatchKey, setDismissedVersionMismatchKey] = useState<string | null>(null);
  const versionMismatchDismissed =
    versionMismatchDismissKey === dismissedVersionMismatchKey || isVersionMismatchDismissed(versionMismatchDismissKey);
  const showVersionMismatchBanner =
    versionMismatch !== null && versionMismatchDismissKey !== null && !versionMismatchDismissed;
  const versionMismatchServerLabel =
    hasMultipleRegisteredEnvironments && environmentId !== null
      ? `${activeEnvironment?.label ?? serverConfig?.environment.label ?? environmentId} server`
      : "server";
  const serverUpdateEnvironmentId = environmentId;
  const versionMismatchSelfUpdate = resolveServerSelfUpdateCapability(serverConfig);
  const versionMismatchInstallation = serverConfig?.environment.capabilities.serverInstallation;
  const versionMismatchDesktopAppUpdate = supportsDesktopAppUpdate(serverConfig);
  const versionMismatchThreadContinuation = supportsServerUpdateThreadContinuation(serverConfig);
  const serverUpdateState = useAtomValue(serverEnvironment.updateStateAtom(serverUpdateEnvironmentId));
  const [dismissedServerUpdateState, setDismissedServerUpdateState] = useState<ServerUpdateState | null>(null);
  const serverUpdateFailureDismissed =
    serverUpdateState === dismissedServerUpdateState || isServerUpdateFailureDismissed(serverUpdateState);

  const items: ComposerBannerStackItem[] = [];
  const updateRunning = serverUpdateState.status === "running";
  const unavailableConnection = activeEnvironmentUnavailableState?.connection ?? null;
  const disconnectAction =
    canDisconnectActiveEnvironment && activeEnvironmentUnavailableState ? (
      <Tooltip content="Hide this server's threads. Switch it on again in Connections." side="top">
        <Button
          size="xs"
          variant="ghost"
          testId="connection-banner-disconnect"
          disabled={disconnectingEnvironment}
          onClick={() => void handleDisconnectActiveEnvironment(activeEnvironmentUnavailableState.environmentId)}
        >
          Disconnect server
        </Button>
      </Tooltip>
    ) : undefined;
  const environmentReconnecting =
    unavailableConnection !== null &&
    (unavailableConnection.phase === "connecting" || unavailableConnection.phase === "reconnecting");
  const suppressUnavailableBanner = environmentReconnecting && (updateRunning || !reconnectWarningGraceElapsed);
  if (activeEnvironmentUnavailableState && unavailableConnection && !suppressUnavailableBanner) {
    const headline = activeEnvironment ? connectionHeadline(activeEnvironment) : null;
    items.push({
      id: `environment-unavailable:${activeEnvironmentUnavailableState.environmentId}`,
      variant: unavailableConnection.phase === "error" ? "error" : "warning",
      icon: <BannerGlyph name="wifi-off" />,
      title: `${activeEnvironmentUnavailableState.label} is ${environmentReconnecting ? "reconnecting" : "offline"}`,
      ...(headline ? { description: headline } : {}),
      actions:
        !environmentReconnecting || disconnectAction ? (
          <>
            {!environmentReconnecting ? (
              <Button
                size="xs"
                variant="ghost"
                testId="connection-banner-reconnect"
                onClick={() => void reconnectEnvironment(activeEnvironmentUnavailableState.environmentId)}
              >
                Reconnect
              </Button>
            ) : null}
            {disconnectAction}
          </>
        ) : undefined,
    });
  }
  if (
    !automaticEnvironment &&
    serverUpdateEnvironmentId &&
    (serverUpdateState.status === "idle" ? showVersionMismatchBanner : !serverUpdateFailureDismissed)
  ) {
    const updateInProgress = serverUpdateState.status === "running";
    const updateFailed = serverUpdateState.status === "failed";
    items.push({
      id: `server-version:${serverUpdateEnvironmentId}`,
      variant: updateFailed ? "error" : "default",
      priority: updateInProgress ? "urgent" : "notice",
      icon: <ComposerServerUpdateIcon status={serverUpdateState.status} />,
      title:
        updateInProgress || updateFailed ? (
          `${updateFailed ? "Could not update" : "Updating"} ${versionMismatchServerLabel}`
        ) : versionMismatch ? (
          <Tooltip
            content={`${versionMismatchServerLabel} ${versionMismatch.serverVersion} → ${versionMismatch.clientVersion}`}
            side="top"
          >
            <div testId="server-update-title" style={{ display: "flex", minWidth: 0, flexShrink: 1 }}>
              <BannerText weight={500} truncate style={{ lineHeight: 24 }}>
                Server update available
              </BannerText>
            </div>
          </Tooltip>
        ) : (
          "Server update available"
        ),
      description:
        serverUpdateState.status === "failed"
          ? serverUpdateState.message
          : serverUpdateState.status === "running"
            ? serverUpdateStageLabel(serverUpdateState.stage)
            : versionMismatchSelfUpdate !== null &&
                (versionMismatchSelfUpdate !== "desktop-managed" || !versionMismatchDesktopAppUpdate)
              ? serverUpdateGuidance(versionMismatchSelfUpdate)
              : undefined,
      actions: updateInProgress ? (
        disconnectAction
      ) : !versionMismatch || (versionMismatchSelfUpdate === "desktop-managed" && !versionMismatchDesktopAppUpdate) ? undefined : (
        <ServerUpdateAction
          environmentId={serverUpdateEnvironmentId}
          serverLabel={versionMismatchServerLabel}
          selfUpdate={versionMismatchSelfUpdate}
          installation={versionMismatchInstallation}
          desktopAppUpdate={versionMismatchDesktopAppUpdate}
          threadContinuation={versionMismatchThreadContinuation}
          targetVersion={versionMismatch.clientVersion}
          label={updateFailed ? "Retry" : "Update"}
          variant="ghost"
          testId="server-update-action"
        />
      ),
      ...(updateInProgress || (!updateFailed && !versionMismatchDismissKey)
        ? {}
        : {
            dismissLabel: "Dismiss update notice",
            onDismiss: () => {
              if (updateFailed) {
                dismissServerUpdateFailure(serverUpdateState);
                setDismissedServerUpdateState(serverUpdateState);
              }
              dismissVersionMismatch(versionMismatchDismissKey);
              setDismissedVersionMismatchKey(versionMismatchDismissKey);
            },
          }),
    });
  }
  if (autoBalanceUpdateBanner) items.push(autoBalanceUpdateBanner);
  return items;
}

const EMPTY_UPDATE_STATES_ATOM = Atom.make<ReadonlyArray<ServerUpdateState>>([]);

/** web `environmentUpdateStatesAtom`: every listed environment's update state, keyed by the joined ids. */
const environmentUpdateStatesAtom = Atom.family((idsKey: string) =>
  Atom.make((get) =>
    idsKey.split("\n").map((environmentId) => get(serverEnvironment.updateStateAtom(environmentId as EnvironmentId))),
  ),
);

export function useAutoBalanceUpdateBanner(
  environments: ReadonlyArray<SystemBannerEnvironment>,
): ComposerBannerStackItem | null {
  const updateStates = useAtomValue(
    environments.length === 0
      ? EMPTY_UPDATE_STATES_ATOM
      : environmentUpdateStatesAtom(environments.map(({ environmentId }) => environmentId).join("\n")),
  );
  const states = environments.flatMap((environment, index) => {
    const state = updateStates[index];
    return state ? [{ environment, state }] : [];
  });
  const [dismissedNotices, setDismissedNotices] = useState<ReadonlySet<string | ServerUpdateState>>(() => new Set());
  const machines = states.flatMap(({ environment, state }) => {
    const mismatch = resolveServerConfigVersionMismatch(environment.serverConfig);
    const dismissKey = mismatch ? buildVersionMismatchDismissalKey(environment.environmentId, mismatch) : null;
    if (
      state.status === "idle"
        ? !mismatch || (dismissKey !== null && dismissedNotices.has(dismissKey)) || isVersionMismatchDismissed(dismissKey)
        : dismissedNotices.has(state) || isServerUpdateFailureDismissed(state)
    )
      return [];
    const selfUpdate = resolveServerSelfUpdateCapability(environment.serverConfig);
    const desktopAppUpdate = supportsDesktopAppUpdate(environment.serverConfig);
    return [
      {
        environmentId: environment.environmentId,
        serverLabel: environment.label,
        selfUpdate,
        installation: environment.serverConfig?.environment.capabilities.serverInstallation,
        desktopAppUpdate,
        threadContinuation: supportsServerUpdateThreadContinuation(environment.serverConfig),
        continueThreadsAfterServerUpdate: environment.serverConfig?.settings.continueThreadsAfterServerUpdate ?? false,
        targetVersion: state.status === "idle" ? mismatch!.clientVersion : state.targetVersion,
        connected: environment.connection.phase === "connected",
        remoteUpdate: selfUpdate !== null && (selfUpdate !== "desktop-managed" || desktopAppUpdate),
        state,
        dismissKey,
      },
    ];
  });
  if (machines.length === 0) return null;

  const running = machines.filter((machine) => machine.state.status === "running").length;
  const failed = machines.filter((machine) => machine.state.status === "failed").length;
  const manual = machines.filter((machine) => !machine.remoteUpdate).length;
  const targets = machines.filter(
    (machine) => machine.connected && machine.remoteUpdate && machine.state.status !== "running",
  );
  const count = running || failed || machines.length;
  const status = running ? "running" : failed ? "failed" : "idle";
  const prefix = running ? "Updating" : failed ? "Could not update" : "Update available for";
  const title = `${prefix} ${count} ${count === 1 ? "machine" : "machines"}`;
  return {
    id: `auto-balance-server-updates-${dismissedNotices.size}`,
    variant: failed ? "error" : "default",
    priority: running ? "urgent" : "notice",
    icon: <ComposerServerUpdateIcon status={status} />,
    title: <AutoBalanceMachinesPopover title={title} machines={machines} />,
    description: manual > 0 ? `${manual} ${manual === 1 ? "needs" : "need"} a manual update` : undefined,
    actions:
      running === 0 && targets.length > 0 ? (
        <ServerUpdatesAction
          targets={targets}
          variant="ghost"
          testId="auto-balance-update-action"
          label={
            failed > 0
              ? "Retry"
              : targets.length === machines.length
                ? "Update all"
                : `Update ${targets.length} ${targets.length === 1 ? "machine" : "machines"}`
          }
        />
      ) : undefined,
    dismissLabel: "Dismiss update notice",
    ...(running
      ? {}
      : {
          onDismiss: () => {
            const next = new Set(dismissedNotices);
            for (const { state, dismissKey } of machines) {
              dismissServerUpdateFailure(state);
              dismissVersionMismatch(dismissKey);
              if (dismissKey) next.add(dismissKey);
              if (state.status === "failed") next.add(state);
            }
            setDismissedNotices(next);
          },
        }),
  };
}

type AutoBalanceMachine = Parameters<typeof ServerUpdateAction>[0] & {
  readonly state: ServerUpdateState;
  readonly connected: boolean;
  readonly remoteUpdate: boolean;
};

/** The banner title as an inline button opening the per-machine list (web PopoverPopup width md). */
function AutoBalanceMachinesPopover({
  title,
  machines,
}: {
  readonly title: string;
  readonly machines: ReadonlyArray<AutoBalanceMachine>;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      rootStyle={{ minWidth: 0, flexShrink: 1 }}
      style={{ width: 320, paddingTop: 12, paddingBottom: 12, paddingLeft: 12, paddingRight: 12, gap: 12 }}
      trigger={
        <InlineButton testId="auto-balance-machines" truncate onClick={() => setOpen(!open)}>
          {title}
        </InlineButton>
      }
    >
      {machines.map((machine) => (
        <div key={machine.environmentId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size="xs" weight={500}>
            {machine.serverLabel}
          </Text>
          {machine.state.status !== "idle" ? (
            <ServerUpdateProgress state={machine.state} />
          ) : !machine.remoteUpdate ? (
            <>
              <Text size="xs" color={theme.mutedForeground}>
                Manual update required
              </Text>
              <ServerUpdateAction {...machine} />
            </>
          ) : (
            <Text size="xs" color={theme.mutedForeground}>
              {machine.connected ? `Ready to update to ${machine.targetVersion}` : "Reconnect this machine to update"}
            </Text>
          )}
        </div>
      ))}
    </Popover>
  );
}

/** A 12px muted banner icon, the size ComposerBanner.Icon gives lucide icons. */
export function BannerGlyph({ name, color }: { readonly name: Parameters<typeof Icon>[0]["name"]; readonly color?: string }) {
  const theme = useTheme();
  return <Icon name={name} size={12} color={color ?? theme.mutedForeground} />;
}

/** web ConnectionDiagnosisHeadline (see the header for the unsupported case). */
function connectionHeadline(environment: EnvironmentConnectionView): string | null {
  const phase = environment.connection.phase;
  if (phase === "unsupported") return environment.connection.error;
  if (!environment.entry.enabled || phase === "connected") return null;
  const relayOnly = connectionRoutes(environment.entry).length === 1 && hasRelayRoute(environment.entry);
  return (
    presentConnectionDiagnosis({
      hostLabel: environment.label,
      state: environment.state,
      via: relayOnly ? "relay" : "direct",
      relayStatus: null,
      clientVersion: APP_VERSION,
      serverVersion: environment.serverVersion,
    })?.headline ?? null
  );
}

async function reconnectEnvironment(environmentId: EnvironmentId) {
  const result = await runAtomCommand(appAtomRegistry, environmentCatalog.retryNow, environmentId);
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toast({
      type: "error",
      title: "Could not reconnect environment",
      description: error instanceof Error ? error.message : "Failed to reconnect.",
    });
  }
}

async function disconnectEnvironment(environmentId: EnvironmentId) {
  const result = await runAtomCommand(appAtomRegistry, environmentCatalog.setEnabled, {
    environmentId,
    enabled: false,
  });
  if (result._tag === "Failure") {
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toast({
        type: "error",
        title: "Could not disconnect server",
        description: error instanceof Error ? error.message : "Failed to disconnect.",
      });
    }
    return;
  }
  appAtomRegistry.set(routeAtom, { kind: "home" });
}
