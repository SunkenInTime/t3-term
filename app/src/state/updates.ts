// Update state for the sidebar's "update everything" control, wired the way
// apps/web/src/state/{server,npmRelease}.ts and
// apps/web/src/components/sidebar/{updateEverythingRun.tsx,UpdateEverythingDialog.tsx}
// wire it, plus the dev hooks that let the control be checked without
// updating anything.
//
// Dev hooks (all off by default):
//   T3TERM_UPDATE_DRY_RUN=1   server and provider updates log what they would do
//                             and play back a simulated run; no RPC is sent.
//   T3TERM_FAKE_UPDATES=server,providers
//                             pretend connected servers are one patch behind this
//                             client (and can self-update), and/or that their
//                             enabled providers have a one-click update. Forces
//                             dry run.
//   T3TERM_FAKE_UPDATE_RUN=progress|slow|failed
//                             start with a run already in progress (the sidebar
//                             capsule). Forces dry run.
import { useAtomValue } from "@effect/atom-react";
import { serverUpdateStateAtom, type ServerUpdateState } from "@t3tools/client-runtime/state/server";
import { EnvironmentId, type ServerConfig, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import type { UpdateEverythingRun } from "../web/components/sidebar/updateEverything.logic.ts";
import { environmentThreadShells, serverEnvironment } from "./environment.ts";
import { environmentAtomList } from "./settings.ts";

// ── Server update states (apps/web/src/state/server.ts) ─────────────────

export const environmentUpdateStatesAtom = environmentAtomList(
  "t3term-environment-update-states",
  serverEnvironment.updateStateAtom,
);

// ── npm release check (apps/web/src/state/npmRelease.ts) ────────────────

export const npmReleasePublishedAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(`https://registry.npmjs.org/t3/${encodeURIComponent(version)}`);
      if (response.status === 404) return false;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(Effect.flatMap((ok) => ok.json));
      return typeof body === "object" && body !== null && "version" in body ? body.version === version : false;
    }).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(Atom.withRefresh("5 minutes"), Atom.keepAlive, Atom.withLabel(`npm-release-published:${version}`)),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success(false)).pipe(Atom.withLabel("npm-release-published:none"));

export function useNpmReleasePublished(version: string | null): boolean {
  const result = useAtomValue(
    version && !DEV_FAKE_UPDATES.server ? npmReleasePublishedAtom(version) : NO_VERSION_ATOM,
  );
  // A faked server update targets a version npm has never seen.
  if (version && DEV_FAKE_UPDATES.server) return true;
  return AsyncResult.getOrElse(result, () => false);
}

// ── The running update (apps/web/src/components/sidebar/updateEverythingRun.tsx) ──

export const updateEverythingRunAtom = Atom.make<UpdateEverythingRun | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("update-everything-run"),
);

// ── Running threads on restarting servers (UpdateEverythingDialog.tsx) ──

const isRunning = (status: string) => status === "preparing" || status === "starting" || status === "running";

export const runningThreadCountAtom = Atom.family((environmentIds: string) =>
  Atom.make((get) =>
    environmentIds
      .split("\n")
      .filter((id) => id !== "")
      .reduce(
        (count, id) =>
          count +
          get(environmentThreadShells.environmentThreadsAtom(EnvironmentId.make(id))).filter((thread) =>
            isRunning(thread.status),
          ).length,
        0,
      ),
  ).pipe(Atom.withLabel(`update-everything-running-threads:${environmentIds}`)),
);

// ── Dev hooks ───────────────────────────────────────────────────────────

const fakeUpdateTokens = new Set(
  (process.env.T3TERM_FAKE_UPDATES ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean),
);

export const DEV_FAKE_UPDATES = {
  server: fakeUpdateTokens.has("server"),
  providers: fakeUpdateTokens.has("providers"),
} as const;

export const DEV_FAKE_UPDATE_RUN = ((value) =>
  value === "progress" || value === "slow" || value === "failed" ? value : null)(
  process.env.T3TERM_FAKE_UPDATE_RUN?.trim().toLowerCase(),
);

/**
 * True when updates must not reach any server. Faked updates always run dry:
 * their targets and provider candidates are made up, and a real request for
 * one could still update a real CLI.
 */
export const UPDATE_DRY_RUN =
  process.env.T3TERM_UPDATE_DRY_RUN === "1" ||
  DEV_FAKE_UPDATES.server ||
  DEV_FAKE_UPDATES.providers ||
  DEV_FAKE_UPDATE_RUN !== null;

if (UPDATE_DRY_RUN) {
  console.warn(
    `[T3TERM_UPDATE_DRY_RUN] active: server and provider updates are simulated (fake updates: ${
      [...fakeUpdateTokens].join(",") || "none"
    }, fake run: ${DEV_FAKE_UPDATE_RUN ?? "none"})`,
  );
}

function bumpPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : `${version}-dev-fake`;
}

/** With T3TERM_FAKE_UPDATES=server, the version every connected server is behind. */
export function devFakeTargetVersion(
  appVersion: string,
  configs: ReadonlyArray<Pick<ServerConfig, "environment"> | null>,
): string {
  if (!DEV_FAKE_UPDATES.server) return appVersion;
  const versions = configs.flatMap((config) => (config ? [config.environment.serverVersion] : []));
  return bumpPatch(versions[0] ?? appVersion);
}

/** With T3TERM_FAKE_UPDATES=server, a server that can update itself in place. */
export function devFakeServerConfig<C extends Pick<ServerConfig, "environment">>(config: C | null): C | null {
  if (!DEV_FAKE_UPDATES.server || config === null) return config;
  const capabilities = config.environment.capabilities;
  return {
    ...config,
    environment: {
      ...config.environment,
      capabilities: { ...capabilities, serverSelfUpdate: capabilities.serverSelfUpdate ?? "respawn" },
    },
  };
}

/** With T3TERM_FAKE_UPDATES=providers, every enabled provider is behind with a one-click update. */
export function devFakeProviders(providers: ReadonlyArray<ServerProvider>): ReadonlyArray<ServerProvider> {
  if (!DEV_FAKE_UPDATES.providers) return providers;
  return providers.map((provider) =>
    provider.enabled
      ? {
          ...provider,
          versionAdvisory: {
            status: "behind_latest",
            currentVersion: provider.versionAdvisory?.currentVersion ?? provider.version ?? null,
            latestVersion: "99.0.0",
            updateCommand: "t3term-dry-run",
            canUpdate: true,
            checkedAt: null,
            message: null,
          },
          updateState: undefined,
        }
      : provider,
  ) as ReadonlyArray<ServerProvider>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Plays a server update without sending it: the client-runtime update state
 * walks downloading → restarting → idle, as the real command drives it.
 */
export async function dryRunServerUpdate(environmentId: EnvironmentId, label: string, targetVersion: string) {
  console.warn(`[T3TERM_UPDATE_DRY_RUN] would update server ${label} (${environmentId}) to t3@${targetVersion}`);
  const stateAtom = serverUpdateStateAtom(environmentId);
  const fromVersion =
    appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.environment.serverVersion ?? targetVersion;
  const running = (stage: "downloading" | "resuming"): ServerUpdateState => ({
    status: "running",
    stage,
    fromVersion,
    targetVersion,
  });
  appAtomRegistry.set(stateAtom, running("downloading"));
  await sleep(4_000);
  appAtomRegistry.set(stateAtom, running("resuming"));
  await sleep(3_000);
  appAtomRegistry.set(stateAtom, { status: "idle" });
  return { targetVersion };
}

/** Plays a provider update without sending it; resolves like `server.updateProvider`. */
export async function dryRunProviderUpdate(
  environmentId: EnvironmentId,
  label: string,
  provider: ServerProvider,
): Promise<{ readonly providers: ReadonlyArray<ServerProvider> }> {
  console.warn(
    `[T3TERM_UPDATE_DRY_RUN] would update provider ${provider.driver} (${provider.instanceId}) on ${label} (${environmentId})`,
  );
  await sleep(3_000);
  const now = new Date().toISOString();
  return {
    providers: [
      {
        ...provider,
        updateState: { status: "succeeded", startedAt: now, finishedAt: now, message: null, output: null },
      } as ServerProvider,
    ],
  };
}
