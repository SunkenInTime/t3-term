// apps/web/src/components/sidebar/useUpdateEverything.ts as a browser client
// runs it: nothing to download or install locally (no desktop bridge), so the
// target version is this client's own and no server is hosted by this app.
import { useAtomValue } from "@effect/atom-react";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";

import { environmentIdsKey, environmentSessionStatesAtom, useEnvironments } from "../state/settings.ts";
import { devFakeServerConfig, devFakeTargetVersion, environmentUpdateStatesAtom, useNpmReleasePublished } from "../state/updates.ts";
import { APP_VERSION } from "../web/branding.ts";
import { getProviderUpdateRunOutcome } from "../web/components/ProviderUpdateLaunchNotification.logic.ts";
import { canUpdateServer, type ServerUpdateOutcome } from "../web/components/ServerUpdateAction.ts";
import {
  closeFinishedUpdateRun,
  collectRestartingMachines,
  collectServerUpdateTargets,
  collectUpdateEverythingResult,
  describeUpdateEverything,
  runUpdateEverything,
  type SkippedMachine,
  type UpdateRunMachine,
} from "../web/components/sidebar/updateEverything.logic.ts";
import { useProviderUpdates, useServerUpdate } from "./serverUpdates.ts";
import {
  setUpdateEverythingRun,
  settleUpdateRunMachine,
  showUpdateEverythingResult,
  waitForServerUpdateHandoff,
} from "./updateEverythingRun.ts";

export function useUpdateEverything() {
  const { environments } = useEnvironments();
  const serverConfigs = environments.map((environment) => devFakeServerConfig(environment.serverConfig));
  const targetVersion = devFakeTargetVersion(APP_VERSION, serverConfigs);
  const environmentIds = environmentIdsKey(environments.map(({ environmentId }) => environmentId));
  const sessionStates = useAtomValue(environmentSessionStatesAtom(environmentIds));
  const updateStates = useAtomValue(environmentUpdateStatesAtom(environmentIds));
  const machines = environments.map((environment, index) => ({
    environmentId: environment.environmentId,
    label: environment.label,
    serverConfig: serverConfigs[index]!,
    connected: environment.connection.phase === "connected",
    hostedByThisApp: false,
    canMaintain: canUpdateServer(sessionStates[index]!),
    updateState: updateStates[index]!,
  }));
  const { targets: behindServers, skipped: unreachable } = collectServerUpdateTargets(machines, targetVersion);
  // A desktop-managed server installs from its own app's update feed, so only
  // servers that download t3 from npm wait for npm to publish the version.
  const needsNpm = behindServers.some((server) => server.selfUpdate !== "desktop-managed");
  const published = useNpmReleasePublished(needsNpm ? targetVersion : null);
  const servers = published
    ? behindServers
    : behindServers.filter((server) => server.selfUpdate === "desktop-managed");
  const skipped: ReadonlyArray<SkippedMachine> = [
    ...unreachable,
    ...behindServers
      .filter((server) => !servers.includes(server))
      .map((server) => ({
        environmentId: server.environmentId,
        label: server.serverLabel,
        reason: `t3@${targetVersion} is not on npm yet`,
      })),
  ];
  const restarts = collectRestartingMachines(machines, servers, false);
  const providers = useProviderUpdates();
  const updateServer = useServerUpdate();

  const { summary, lines } = describeUpdateEverything({
    localVersion: null,
    servers,
    providerMachines: providers.machines.map((machine) => ({
      environmentId: machine.environmentId,
      label: machine.label,
      providers: machine.candidates.map((candidate) => PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver),
    })),
  });

  return {
    hasUpdates: servers.length > 0 || providers.machines.length > 0,
    summary,
    lines,
    restarts,
    skipped,
    run: async () => {
      const startedAt = Date.now();
      const machinesById = new Map<UpdateRunMachine["environmentId"], UpdateRunMachine>();
      for (const machine of providers.machines) {
        machinesById.set(machine.environmentId, {
          environmentId: machine.environmentId,
          label: machine.label,
          updatesProviders: true,
          server: null,
          handedOffVersion: null,
          startedAt,
          result: null,
          failure: null,
          providerFailure: null,
        });
      }
      for (const server of servers) {
        const existing = machinesById.get(server.environmentId);
        machinesById.set(server.environmentId, {
          environmentId: server.environmentId,
          label: server.serverLabel,
          updatesProviders: existing?.updatesProviders ?? false,
          server,
          handedOffVersion: null,
          startedAt,
          result: null,
          failure: null,
          providerFailure: null,
        });
      }
      setUpdateEverythingRun(() => ({
        localVersion: null,
        phase: "providers",
        restartAt: null,
        machines: Array.from(machinesById.values()),
      }));
      const providerFailures = new Map<UpdateRunMachine["environmentId"], string>();
      try {
        const outcome = await runUpdateEverything({
          updateProviders: async () => {
            const runs = await providers.updateAll({ quiet: true });
            const outcomes = runs.map((run) => {
              const runOutcome = getProviderUpdateRunOutcome(run);
              if (runOutcome.status !== "updated") {
                providerFailures.set(
                  run.environmentId,
                  runOutcome.status === "failed" ? runOutcome.line : "Provider update interrupted",
                );
              }
              return runOutcome;
            });
            for (const machine of machinesById.values()) {
              if (machine.server === null) {
                settleUpdateRunMachine(machine.environmentId, providerFailures.get(machine.environmentId) ?? null);
              }
            }
            const serversStartedAt = Date.now();
            setUpdateEverythingRun(
              (run) =>
                run && {
                  ...run,
                  phase: "servers",
                  machines: run.machines.map((machine) =>
                    machine.server === null ? machine : { ...machine, startedAt: serversStartedAt },
                  ),
                },
            );
            return outcomes;
          },
          updateServers: async () => {
            const runs = servers.map(async (server) => {
              const serverOutcome = await updateServer(server, { quiet: true });
              settleUpdateRunMachine(
                server.environmentId,
                serverOutcome.status === "failed"
                  ? serverOutcome.message
                  : (providerFailures.get(server.environmentId) ?? null),
                {
                  serverUpdated: serverOutcome.status !== "failed",
                  providerFailure: providerFailures.get(server.environmentId) ?? null,
                },
              );
              return { label: server.serverLabel, outcome: serverOutcome };
            });
            await Promise.all(
              servers.map((server, index) => waitForServerUpdateHandoff(server.environmentId, runs[index]!)),
            );
            return runs;
          },
        });
        setUpdateEverythingRun(
          (run) =>
            run &&
            closeFinishedUpdateRun({
              ...run,
              phase: "servers",
              restartAt: null,
              localVersion: null,
            }),
        );
        const finished: ReadonlyArray<{ label: string; outcome: ServerUpdateOutcome }> = await Promise.all(
          outcome.servers,
        );
        showUpdateEverythingResult(
          collectUpdateEverythingResult({
            localVersion: null,
            localFailures: [],
            servers: finished,
            providers: outcome.providers,
          }),
        );
      } catch (error) {
        setUpdateEverythingRun(() => null);
        throw error;
      }
    },
  };
}
