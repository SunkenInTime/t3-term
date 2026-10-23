// Environment presentation, session scopes and server-settings commands, wired
// the way apps/web/src/state/{presentation,environments,session,server}.ts and
// hooks/useSettings.ts wire them. Settings pages build on these; other areas
// may read them too.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  connectionCatalogDisplayUrl,
  hasRelayRoute,
  type EnvironmentPresentation as BaseEnvironmentPresentation,
} from "@t3tools/client-runtime/connection";
import {
  createEnvironmentPresentationAtoms,
  createEnvironmentSummaryAtoms,
} from "@t3tools/client-runtime/state/presentation";
import {
  type AtomCommand,
  type AtomCommandOptions,
  type AtomCommandResult,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  sessionGrantsScope,
  type AuthEnvironmentScope,
  type AuthSessionState,
  type EnvironmentId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import type { ClientSettings, UnifiedSettings } from "@t3tools/contracts/settings";
import { resolveModelPreferences } from "@t3tools/shared/serverSettings";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import type { EnvironmentPresentation } from "../web/state/environments.ts";
import { environmentCatalog, environmentProjects, environmentSession, serverEnvironment } from "./environment.ts";

export type { EnvironmentPresentation };

export const environmentPresentations = createEnvironmentPresentationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  stateAtom: environmentCatalog.stateAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

export const environmentSummaries = createEnvironmentSummaryAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  presentationAtom: environmentPresentations.presentationAtom,
});

/**
 * The web app's primary environment is the server that served it. t3-term has
 * no such server, so the first saved environment (normally the one named on
 * the command line) plays that role, as the desktop app's local server does.
 */
export const primaryEnvironmentIdAtom = Atom.make((get) => {
  const entries = get(environmentCatalog.catalogValueAtom).entries;
  for (const [environmentId, entry] of entries) {
    if (entry.target._tag === "PrimaryConnectionTarget") return environmentId;
  }
  for (const environmentId of entries.keys()) return environmentId;
  return null;
}).pipe(Atom.withLabel("t3term-primary-environment-id"));

function projectEnvironmentPresentation(
  environmentId: EnvironmentId,
  presentation: BaseEnvironmentPresentation,
): EnvironmentPresentation {
  return {
    ...presentation,
    environmentId,
    label: presentation.entry.target.label,
    displayUrl: connectionCatalogDisplayUrl(presentation.entry),
    relayManaged: hasRelayRoute(presentation.entry),
  };
}

export function useEnvironments() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const presentationById = useAtomValue(environmentPresentations.presentationsAtom);
  const environments = [...presentationById.entries()].map(([environmentId, presentation]) =>
    projectEnvironmentPresentation(environmentId, presentation),
  );
  return { isReady: catalog.isReady, environments, presentationById };
}

export function usePrimaryEnvironmentId(): EnvironmentId | null {
  return useAtomValue(primaryEnvironmentIdAtom);
}

const EMPTY_PRESENTATION_ATOM = Atom.make<BaseEnvironmentPresentation | null>(null);

export function useEnvironment(environmentId: EnvironmentId | null): EnvironmentPresentation | null {
  const presentation = useAtomValue(
    environmentId === null ? EMPTY_PRESENTATION_ATOM : environmentPresentations.presentationAtom(environmentId),
  );
  return environmentId === null || presentation === null
    ? null
    : projectEnvironmentPresentation(environmentId, presentation);
}

export function usePrimaryEnvironment(): EnvironmentPresentation | null {
  return useEnvironment(usePrimaryEnvironmentId());
}

/** Provider statuses change on every push, so they live apart from the presentations. */
export function useEnvironmentProviders(): ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>> {
  return useAtomValue(environmentPresentations.providersByEnvironmentAtom);
}

export const EMPTY_SERVER_PROVIDERS: ReadonlyArray<ServerProvider> = [];

export function useProjects() {
  return useAtomValue(environmentProjects.projectsAtom);
}

// ── Session scopes (apps/web/src/state/session.ts) ──────────────────────

export const environmentIdsKey = (environmentIds: ReadonlyArray<EnvironmentId>) => environmentIds.join("\n");

export function environmentAtomList<A>(label: string, atom: (environmentId: EnvironmentId) => Atom.Atom<A>) {
  return Atom.family((key: string) =>
    Atom.make((get) => (key === "" ? [] : (key.split("\n") as EnvironmentId[]).map((id) => get(atom(id))))).pipe(
      Atom.withLabel(`${label}:${key}`),
    ),
  );
}

export const environmentSessionStatesAtom = environmentAtomList(
  "t3term-environment-session-states",
  environmentSession.sessionStateAtom,
);

const EMPTY_SESSION_STATE_ATOM = Atom.make(AsyncResult.initial<AuthSessionState>());

function sessionHasScope(result: AsyncResult.AsyncResult<AuthSessionState, unknown>, scope: AuthEnvironmentScope) {
  const session = Option.getOrNull(AsyncResult.value(result));
  return result._tag !== "Failure" && session !== null && sessionGrantsScope(session, scope);
}

export function useEnvironmentScope(environmentId: EnvironmentId | null, scope: AuthEnvironmentScope): boolean {
  const result = useAtomValue(
    environmentId === null ? EMPTY_SESSION_STATE_ATOM : environmentSession.sessionStateAtom(environmentId),
  );
  return sessionHasScope(result, scope);
}

const environmentsWithScopeAtom = Atom.family((key: string) => {
  const [scope, idsKey = ""] = key.split(/\n(.*)/s) as [AuthEnvironmentScope, string?];
  const ids = idsKey === "" ? [] : (idsKey.split("\n") as EnvironmentId[]);
  const statesAtom = environmentSessionStatesAtom(idsKey);
  return Atom.make((get) => {
    const states = get(statesAtom);
    return new Set(ids.filter((_, index) => sessionHasScope(states[index]!, scope)));
  });
});

export function useEnvironmentsWithScope(
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
  scope: AuthEnvironmentScope,
): ReadonlySet<EnvironmentId> {
  return useAtomValue(
    environmentsWithScopeAtom(`${scope}\n${environmentIdsKey(environments.map(({ environmentId }) => environmentId))}`),
  );
}

export function readEnvironmentScope(environmentId: EnvironmentId, scope: AuthEnvironmentScope): boolean {
  return sessionHasScope(appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId)), scope);
}

export function useEnvironmentSessionState(environmentId: EnvironmentId) {
  const result = useAtomValue(environmentSession.sessionStateAtom(environmentId));
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    hasError: result._tag === "Failure",
    isPending: result.waiting,
  };
}

// ── Commands ────────────────────────────────────────────────────────────

/** apps/web/src/state/use-atom-command.ts */
export function useAtomCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E>> {
  const registry = useContext(RegistryContext);
  const label = typeof options === "string" ? options : (options?.label ?? command.label);
  const reportFailure = typeof options === "string" ? true : (options?.reportFailure ?? true);
  const reportDefect = typeof options === "string" ? true : (options?.reportDefect ?? true);
  return (value: W) => runAtomCommand(registry, command, value, { label, reportFailure, reportDefect });
}

/** hooks/useSettings.ts mergeEnvironmentSettings: server-owned values win. */
export function mergeEnvironmentSettings(serverSettings: ServerSettings, clientSettings: ClientSettings): UnifiedSettings {
  return {
    ...clientSettings,
    ...serverSettings,
    ...resolveModelPreferences(serverSettings, clientSettings),
  } as UnifiedSettings;
}

export function usePrimaryServerSettings(): ServerSettings {
  const environmentId = usePrimaryEnvironmentId();
  const config = useAtomValue(
    environmentId === null ? EMPTY_CONFIG_ATOM : serverEnvironment.configValueAtom(environmentId),
  );
  return config?.settings ?? DEFAULT_SERVER_SETTINGS;
}

const EMPTY_CONFIG_ATOM = Atom.make(null);
