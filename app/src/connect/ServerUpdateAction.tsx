// Port of apps/web/src/components/ServerUpdateAction.tsx: the Update / Retry /
// "Copy update command" button the server-update banners carry, and the
// per-machine progress line in the auto-balance popover.
//
// Self-updates run through client-runtime's serverEnvironment.updateServer, as on
// web, so the operation survives this button unmounting while the host restarts.
// Not ported: OutdatedServerUpdateAction (web's connection settings row for a host
// too old to deliver a server config); nothing in t3-term shows that row yet.
import { useAtomValue } from "@effect/atom-react";
import {
  AuthEnvironmentMaintainScope,
  type AuthSessionState,
  type EnvironmentId,
  type ServerInstallation,
  type ServerSelfUpdateCapability,
  sessionGrantsScope,
} from "@t3tools/contracts";
import type { ServerUpdateStage, ServerUpdateState } from "@t3tools/client-runtime/state/server";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";

import { requestConfirmDialog } from "../dialogs/confirmDialog.ts";
import { copyToClipboard } from "../lib/clipboard.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentSession, serverEnvironment } from "../state/environment.ts";
import { Icon } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { Button, IconButton, Text, type ButtonSize, type ButtonVariant } from "../ui/primitives.tsx";
import { useTheme } from "../ui/theme.ts";
import { toast } from "../ui/toast.tsx";
import { manualServerUpdateCommand } from "../web/versionSkew.ts";

const UPDATE_STAGE_LABELS: Record<ServerUpdateStage, string> = {
  downloading: "Downloading…",
  installing: "Downloading…",
  resuming: "Restarting…",
};
const pendingUpdateEnvironmentIds = new Set<EnvironmentId>();

export function serverUpdateStageLabel(stage: ServerUpdateStage): string {
  return UPDATE_STAGE_LABELS[stage];
}

function updateFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Server update failed.";
}

export interface ServerUpdateTarget {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly installation?: ServerInstallation | undefined;
  readonly desktopAppUpdate?: boolean;
  readonly threadContinuation?: boolean;
  readonly targetVersion: string;
  readonly continueThreadsAfterServerUpdate?: boolean;
}

interface UpdateButtonProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly label?: string;
  readonly appearance?: "button" | "icon";
  readonly testId?: string;
}

export type ServerUpdateOutcome =
  | { readonly status: "updated" | "skipped" }
  | { readonly status: "failed"; readonly message: string };

export function canUpdateServer(result: AsyncResult.AsyncResult<AuthSessionState, unknown>): boolean {
  if (result._tag !== "Success" || !result.value.authenticated) return false;
  return sessionGrantsScope(result.value, AuthEnvironmentMaintainScope);
}

/** Toasts its success or failure unless `quiet`; never rejects. */
export async function updateServer(
  target: ServerUpdateTarget,
  { quiet = false }: { readonly quiet?: boolean } = {},
): Promise<ServerUpdateOutcome> {
  const { environmentId, serverLabel, selfUpdate, targetVersion } = target;
  if (
    !canUpdateServer(appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId))) ||
    pendingUpdateEnvironmentIds.has(environmentId)
  )
    return { status: "skipped" };
  pendingUpdateEnvironmentIds.add(environmentId);
  const result = await runAtomCommand(appAtomRegistry, serverEnvironment.updateServer, {
    environmentId,
    input: {
      targetVersion,
      ...(target.threadContinuation && target.continueThreadsAfterServerUpdate ? { continueRunningThreads: true } : {}),
    },
  });
  pendingUpdateEnvironmentIds.delete(environmentId);
  if (result._tag === "Failure") {
    if (isAtomCommandInterrupted(result)) return { status: "skipped" };
    const message = updateFailureMessage(squashAtomCommandFailure(result));
    if (!quiet) toast({ type: "error", title: `${serverLabel} update failed`, description: message });
    return { status: "failed", message };
  }
  if (!quiet) {
    toast({
      type: "success",
      title: `${serverLabel} updated`,
      description:
        selfUpdate === "desktop-managed"
          ? `Desktop app relaunched on ${result.value.targetVersion}.`
          : `Reconnected on t3@${result.value.targetVersion}.`,
    });
  }
  return { status: "updated" };
}

export function ServerUpdatesAction({
  targets,
  label = "Update all",
  variant = "outline",
  size = "xs",
  testId,
}: UpdateButtonProps & {
  readonly targets: ReadonlyArray<ServerUpdateTarget>;
}) {
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const eligible = targets.filter(
    (target) => target.selfUpdate !== null && (target.selfUpdate !== "desktop-managed" || target.desktopAppUpdate),
  );
  const handleUpdate = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    await settlePromise(async () => {
      const available = eligible.filter((target) => !pendingUpdateEnvironmentIds.has(target.environmentId));
      const desktopTargets = available.filter((target) => target.selfUpdate === "desktop-managed");
      if (desktopTargets.length > 0) {
        const confirmed = await requestConfirmDialog(
          `Update the T3 Code desktop apps on ${desktopTargets.map((target) => target.serverLabel).join(", ")}? They will close and relaunch on those machines.`,
        );
        if (!confirmed) return;
      }
      await Promise.all(available.map((target) => updateServer(target)));
    });
    pending.current = false;
    setIsPending(false);
  };
  return (
    <Button
      size={size}
      variant={variant}
      testId={testId}
      disabled={isPending || eligible.length === 0}
      onClick={() => void handleUpdate()}
    >
      {label}
    </Button>
  );
}

/** One machine's update line in the auto-balance popover: a dot and the stage, or the failure. */
export function ServerUpdateProgress({ state }: { readonly state: Exclude<ServerUpdateState, { status: "idle" }> }) {
  const theme = useTheme();
  const failed = state.status === "failed";
  const color = failed ? theme.errorForeground : theme.foreground;
  const row = (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, minWidth: 0 }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: failed ? theme.error : theme.foreground }} />
      <Text size="xs" weight={failed ? undefined : 500} color={color} truncate>
        {failed ? state.message : serverUpdateStageLabel(state.stage)}
      </Text>
    </div>
  );
  return failed ? (
    <Tooltip content={state.message} side="top">
      {row}
    </Tooltip>
  ) : (
    row
  );
}

/**
 * Self-updates delegate their full lifecycle to client-runtime so this component can unmount
 * during reconnect without losing operation state.
 */
export function ServerUpdateAction({
  environmentId,
  serverLabel,
  selfUpdate,
  installation,
  desktopAppUpdate = false,
  threadContinuation = false,
  targetVersion,
  label = "Update",
  variant = "outline",
  size = "xs",
  appearance = "button",
  testId,
}: Omit<ServerUpdateTarget, "continueThreadsAfterServerUpdate"> & UpdateButtonProps) {
  const theme = useTheme();
  const isDesktopAppUpdate = selfUpdate === "desktop-managed";
  const sessionStateAtom = environmentSession.sessionStateAtom(environmentId);
  const canUpdate = canUpdateServer(useAtomValue(sessionStateAtom));
  const continueThreadsAfterServerUpdate =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.settings.continueThreadsAfterServerUpdate ?? false;

  const copyCommand = async (command: string) => {
    const npmGlobal = installation?.kind === "npm-global";
    if (!(await copyToClipboard(command))) {
      toast({ type: "error", title: "Could not copy update command", description: "The clipboard is unavailable." });
      return;
    }
    toast({
      type: "success",
      title: npmGlobal ? "Update command copied" : "Relaunch command copied",
      description: npmGlobal
        ? `Run \`${command}\` on ${serverLabel}, then restart t3 with your usual options.`
        : `Stop t3 on ${serverLabel}, then relaunch with \`${command}\` using the same subcommand and options. This does not update an installed t3 command.`,
    });
  };

  const handleUpdate = async () => {
    if (!canUpdateServer(appAtomRegistry.get(sessionStateAtom)) || pendingUpdateEnvironmentIds.has(environmentId)) {
      return;
    }
    if (isDesktopAppUpdate) {
      const confirmed = await requestConfirmDialog(
        `Update the T3 Code desktop app that runs the ${serverLabel}? It will close and relaunch on that machine.`,
      );
      if (!confirmed) return;
    }
    if (!canUpdateServer(appAtomRegistry.get(sessionStateAtom))) return;
    await updateServer({
      environmentId,
      serverLabel,
      selfUpdate,
      desktopAppUpdate,
      threadContinuation,
      targetVersion,
      continueThreadsAfterServerUpdate,
    });
  };

  if (selfUpdate === "desktop-managed" && !desktopAppUpdate) {
    return (
      <Text size="xs" color={theme.mutedForeground}>
        Update the desktop app on that machine to update this server.
      </Text>
    );
  }

  const manualCommand = selfUpdate === null ? manualServerUpdateCommand(targetVersion, installation) : null;
  const actionLabel =
    manualCommand !== null
      ? installation?.kind === "npm-global"
        ? "Copy update command"
        : "Copy relaunch command"
      : label;
  const onClick = manualCommand !== null ? () => void copyCommand(manualCommand) : () => void handleUpdate();
  const disabled = manualCommand === null && !canUpdate;

  if (appearance === "icon") {
    return (
      <Tooltip content={actionLabel} side="top">
        <IconButton icon="circle-arrow-up" size={24} iconSize={14} disabled={disabled} onClick={onClick} testId={testId} />
      </Tooltip>
    );
  }

  return (
    <Button size={size} variant={variant} disabled={disabled} onClick={onClick} testId={testId}>
      {actionLabel}
    </Button>
  );
}

/** web ComposerServerUpdateStatus.tsx. A static loader stands in for the spinner (no repainting animations). */
export function ComposerServerUpdateIcon({ status }: { readonly status: ServerUpdateState["status"] }) {
  const theme = useTheme();
  if (status === "running") return <Icon name="loader-circle" size={12} color={theme.mutedForeground} />;
  if (status === "failed") return <Icon name="circle-alert" size={12} color={theme.errorForeground} />;
  return <Icon name="download" size={12} color={theme.mutedForeground} />;
}
