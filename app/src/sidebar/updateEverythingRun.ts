// apps/web/src/components/sidebar/updateEverythingRun.tsx, the parts a client
// that is not the desktop app uses. Left out: the restart countdown, the
// result saved across the app's own relaunch, and DesktopUpdateLaunchNotice;
// all three exist only because the Electron app installs itself last.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { serverEnvironment } from "../state/environment.ts";
import { updateEverythingRunAtom } from "../state/updates.ts";
import { toast } from "../ui/toast.tsx";
import { APP_VERSION } from "../web/branding.ts";
import type { ServerUpdateOutcome, ServerUpdateTarget } from "../web/components/ServerUpdateAction.ts";
import {
  closeFinishedUpdateRun,
  getUpdateEverythingToastView,
  isServerUpdateHandedOff,
  type UpdateEverythingResult,
  type UpdateEverythingRun,
  type UpdateRunMachine,
} from "../web/components/sidebar/updateEverything.logic.ts";

export function useUpdateEverythingRun(): UpdateEverythingRun | null {
  return useAtomValue(updateEverythingRunAtom);
}

export function setUpdateEverythingRun(
  update: (run: UpdateEverythingRun | null) => UpdateEverythingRun | null,
): void {
  appAtomRegistry.update(updateEverythingRunAtom, update);
}

function updateRunMachines(update: (machine: UpdateRunMachine) => UpdateRunMachine): void {
  setUpdateEverythingRun((run) => run && closeFinishedUpdateRun({ ...run, machines: run.machines.map(update) }));
}

export function settleUpdateRunMachine(
  environmentId: EnvironmentId,
  failure: string | null,
  {
    serverUpdated = false,
    providerFailure,
  }: { readonly serverUpdated?: boolean; readonly providerFailure?: string | null } = {},
): void {
  updateRunMachines((machine) =>
    machine.environmentId === environmentId
      ? {
          ...machine,
          result: failure === null ? "done" : "failed",
          failure,
          ...(serverUpdated ? { server: null } : {}),
          ...(providerFailure === undefined ? {} : { providerFailure }),
        }
      : machine,
  );
}

export function retryFailedUpdateRunServers(
  update: (target: ServerUpdateTarget, options: { readonly quiet: boolean }) => Promise<ServerUpdateOutcome>,
): void {
  const failed = (appAtomRegistry.get(updateEverythingRunAtom)?.machines ?? []).flatMap((machine) =>
    machine.result === "failed" && machine.server !== null
      ? [{ target: machine.server, providerFailure: machine.providerFailure }]
      : [],
  );
  const targets = failed.map(({ target }) => target);
  const retried = new Set(targets.map((target) => target.environmentId));
  const startedAt = Date.now();
  updateRunMachines((machine) =>
    retried.has(machine.environmentId) ? { ...machine, result: null, failure: null, startedAt } : machine,
  );
  for (const { target, providerFailure } of failed) {
    void update(target, { quiet: true }).then((outcome) =>
      settleUpdateRunMachine(
        target.environmentId,
        outcome.status === "updated"
          ? providerFailure
          : outcome.status === "failed"
            ? outcome.message
            : "Could not start the update",
        { serverUpdated: outcome.status === "updated" },
      ),
    );
  }
}

export function dismissSettledUpdateRunMachines(): void {
  setUpdateEverythingRun(
    (run) =>
      run &&
      closeFinishedUpdateRun({
        ...run,
        machines: run.machines.filter((machine) => machine.result === null),
      }),
  );
}

export function waitForServerUpdateHandoff(environmentId: EnvironmentId, finished: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      queueMicrotask(() => unsubscribe());
      resolve();
    };
    const unsubscribe = appAtomRegistry.subscribe(
      serverEnvironment.updateStateAtom(environmentId),
      (state) => {
        if (isServerUpdateHandedOff(state)) finish();
      },
      { immediate: true },
    );
    void finished.then(finish, finish);
  });
}

export function showUpdateEverythingResult(result: UpdateEverythingResult): void {
  const view = getUpdateEverythingToastView(result, APP_VERSION);
  if (!view) return;
  toast({
    type: view.type,
    title: view.title,
    ...(view.description ? { description: view.description } : {}),
  });
}

/**
 * T3TERM_FAKE_UPDATE_RUN (state/updates.ts): start with a run already going so
 * the capsule can be looked at without updating anything. `progress` and
 * `slow` are updating providers (slow: past the 3-minute mark); `failed` is a
 * server update that failed and can be retried (dry run).
 */
export function seedDevUpdateRun(
  kind: "progress" | "slow" | "failed",
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }>,
): void {
  if (environments.length === 0) return;
  const now = Date.now();
  setUpdateEverythingRun(() => ({
    localVersion: null,
    phase: kind === "failed" ? "servers" : "providers",
    restartAt: null,
    machines: environments.map(({ environmentId, label }) => ({
      environmentId,
      label,
      updatesProviders: kind !== "failed",
      server:
        kind === "failed"
          ? { environmentId, serverLabel: label, selfUpdate: "respawn", targetVersion: APP_VERSION }
          : null,
      handedOffVersion: null,
      startedAt: now - (kind === "slow" ? 4 * 60_000 : 60_000),
      result: kind === "failed" ? "failed" : null,
      failure: kind === "failed" ? `npm install exited with code 1 while installing t3@${APP_VERSION}.` : null,
      providerFailure: null,
    })),
  }));
}
