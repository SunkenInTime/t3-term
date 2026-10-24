// First-run onboarding state: web's agent session atoms (apps/web/src/state/agentSessions.ts),
// the evidence atoms FirstRunGate reads (components/onboarding/FirstRunGate.tsx,
// state/shell.ts allEnvironmentShellsBootstrappedAtom), and what stands in for
// web's /welcome route.
import { AVAILABLE_CONNECTION_STATE, connectionProjectionPhase } from "@t3tools/client-runtime/connection";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId, type ServerLifecycleWelcomePayload } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import { primaryServerConfigAtom } from "./coordinators.ts";
import {
  environmentCatalog,
  environmentProjects,
  environmentShell,
  environmentThreadShells,
  serverEnvironment,
} from "./environment.ts";
import { primaryEnvironmentIdAtom } from "./settings.ts";

export const agentSessionScan = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:scan",
  tag: WS_METHODS.agentSessionsScan,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});

export const agentSessionImport = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:import",
  tag: WS_METHODS.agentSessionsImport,
});

/** web state/server.ts primaryServerWelcomeAtom */
export const primaryServerWelcomeAtom = Atom.make((get): ServerLifecycleWelcomePayload | null => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return null;
  return Option.getOrNull(AsyncResult.value(get(serverEnvironment.welcome({ environmentId, input: {} }))));
}).pipe(Atom.withLabel("t3term-primary-server-welcome"));

/** web state/shell.ts allEnvironmentShellsBootstrappedAtom */
export const allEnvironmentShellsBootstrappedAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));
  if (Option.isNone(catalog)) return false;
  for (const environmentId of enabledEnvironmentIds(catalog.value)) {
    if (Option.isSome(get(environmentShell.stateValueAtom(environmentId)).snapshot)) continue;
    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    if (connectionProjectionPhase(connection) !== "disconnected") return false;
    if (connection.phase === "backoff" && connection.desired && connection.attempt <= 2) return false;
  }
  return true;
}).pipe(Atom.withLabel("t3term-all-environment-shells-bootstrapped"));

export const primaryShellLiveAtom = Atom.make((get) => {
  const serverConfig = get(primaryServerConfigAtom);
  return (
    serverConfig !== null &&
    get(environmentShell.stateValueAtom(serverConfig.environment.environmentId)).status === "live"
  );
}).pipe(Atom.withLabel("t3term-onboarding-primary-shell-live"));

export const workspaceEvidenceLiveAtom = Atom.make((get) => {
  const environmentIds = new Set([
    ...get(environmentProjects.projectsAtom).map((project) => project.environmentId),
    ...get(environmentThreadShells.threadShellsAtom).map((thread) => thread.environmentId),
  ]);
  for (const environmentId of environmentIds) {
    if (get(environmentShell.stateValueAtom(environmentId)).status !== "live") return false;
  }
  return true;
}).pipe(Atom.withLabel("t3term-onboarding-workspace-evidence-live"));

// The gate only needs how many threads exist and, while there is at most one,
// that thread; a shell update of any thread in a populated workspace must not
// re-render the app root.
export const threadCountAtom = Atom.make((get) => get(environmentThreadShells.threadShellsAtom).length).pipe(
  Atom.withLabel("t3term-onboarding-thread-count"),
);

export const soleThreadAtom = Atom.make((get) => {
  const threads = get(environmentThreadShells.threadShellsAtom);
  return threads.length === 1 ? threads[0]! : null;
}).pipe(Atom.withLabel("t3term-onboarding-sole-thread"));

/**
 * Web's /welcome route. Null when setup is closed; `resumeEnvironmentId` is the
 * `#agents:<environmentId>` hash, which reopens setup at the agent step.
 */
export interface WelcomeRoute {
  readonly resumeEnvironmentId?: EnvironmentId | undefined;
}

// T3TERM_ROUTE=welcome (or welcome#agents:<environmentId>) opens setup at launch,
// as a /welcome URL would, so the agent-step resume can be reached directly.
function initialWelcomeRoute(): WelcomeRoute | null {
  const route = process.env.T3TERM_ROUTE?.trim();
  if (route === undefined || !route.startsWith("welcome")) return null;
  const hash = route.slice("welcome".length).replace(/^#/, "");
  return hash.startsWith("agents:") && hash.length > "agents:".length
    ? { resumeEnvironmentId: hash.slice("agents:".length) as EnvironmentId }
    : {};
}

export const welcomeRouteAtom = Atom.make<WelcomeRoute | null>(initialWelcomeRoute()).pipe(
  Atom.keepAlive,
  Atom.withLabel("t3term-welcome-route"),
);

/**
 * Once true, stays true (web __root.tsx `returningFromWelcome`): a visit to setup
 * means the bootstrap already chose a route, so the welcome's bootstrap thread
 * must not be opened over it (coordinators/BootstrapThreadCoordinator.tsx).
 */
export const returningFromWelcomeAtom = Atom.make(initialWelcomeRoute() !== null).pipe(
  Atom.keepAlive,
  Atom.withLabel("t3term-returning-from-welcome"),
);

/** Navigates to web's /welcome (with `#agents:<id>` when resuming). */
export function openWelcome(route: WelcomeRoute = {}): void {
  appAtomRegistry.set(returningFromWelcomeAtom, true);
  appAtomRegistry.set(welcomeRouteAtom, route);
}

export function closeWelcome(): void {
  appAtomRegistry.set(welcomeRouteAtom, null);
}
