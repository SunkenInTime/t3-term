// useServerUpdate from apps/web/src/components/ServerUpdateAction.tsx and
// useProviderUpdates from apps/web/src/components/ProviderUpdatesAction.tsx:
// the two update runners "update everything" drives. Under
// T3TERM_UPDATE_DRY_RUN (state/updates.ts) neither sends its command.
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentSession, serverEnvironment } from "../state/environment.ts";
import { useAtomCommand, useEnvironmentProviders, useEnvironments } from "../state/settings.ts";
import {
  UPDATE_DRY_RUN,
  devFakeProviders,
  dryRunProviderUpdate,
  dryRunServerUpdate,
} from "../state/updates.ts";
import { toast } from "../ui/toast.tsx";
import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  getProviderUpdateRunToastView,
  type ProviderUpdateRun,
} from "../web/components/ProviderUpdateLaunchNotification.logic.ts";
import {
  canUpdateServer,
  updateFailureMessage,
  type ServerUpdateOutcome,
  type ServerUpdateTarget,
} from "../web/components/ServerUpdateAction.ts";

const pendingUpdateEnvironmentIds = new Set<EnvironmentId>();

/** Toasts its success or failure unless `quiet`; never rejects. */
export function useServerUpdate() {
  const updateServer = useAtomCommand(serverEnvironment.updateServer, { reportFailure: false });
  return async (
    target: ServerUpdateTarget,
    { quiet = false }: { readonly quiet?: boolean } = {},
  ): Promise<ServerUpdateOutcome> => {
    const { environmentId, serverLabel, selfUpdate, targetVersion } = target;
    if (
      !canUpdateServer(appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId))) ||
      pendingUpdateEnvironmentIds.has(environmentId)
    )
      return { status: "skipped" };
    pendingUpdateEnvironmentIds.add(environmentId);
    const result = UPDATE_DRY_RUN
      ? AsyncResult.success(await dryRunServerUpdate(environmentId, serverLabel, targetVersion))
      : await updateServer({
          environmentId,
          input: {
            targetVersion,
            ...(target.threadContinuation && target.continueThreadsAfterServerUpdate
              ? { continueRunningThreads: true }
              : {}),
          },
        });
    pendingUpdateEnvironmentIds.delete(environmentId);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return { status: "skipped" };
      const message = updateFailureMessage(squashAtomCommandFailure(result));
      if (!quiet) {
        toast({ type: "error", title: `${serverLabel} update failed`, description: message });
      }
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
  };
}

export function useProviderUpdates() {
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    reportFailure: false,
  });
  const machines = environments.flatMap((environment) => {
    const providers = devFakeProviders(providersByEnvironment.get(environment.environmentId) ?? []);
    if (environment.connection.phase !== "connected") {
      return [];
    }
    const candidates = collectProviderUpdateCandidates(providers).filter((candidate) =>
      canOneClickUpdateProviderCandidate(candidate, providers),
    );
    return candidates.length > 0
      ? [{ environmentId: environment.environmentId, label: environment.label, candidates }]
      : [];
  });

  const updateAll = async ({ quiet = false }: { readonly quiet?: boolean } = {}) => {
    const runs = await Promise.all(
      machines.flatMap(({ environmentId, label, candidates }) =>
        candidates.map(
          async (candidate): Promise<ProviderUpdateRun> => ({
            environmentId,
            machineLabel: label,
            driver: candidate.driver,
            instanceId: candidate.instanceId,
            result: UPDATE_DRY_RUN
              ? AsyncResult.success(await dryRunProviderUpdate(environmentId, label, candidate))
              : await updateProvider({
                  environmentId,
                  input: { provider: candidate.driver, instanceId: candidate.instanceId },
                }),
          }),
        ),
      ),
    );
    const view = quiet ? null : getProviderUpdateRunToastView(runs);
    if (view) toast(view);
    return runs;
  };

  return { machines, updateAll };
}
