// Atoms the app-level dialogs read: git/vcs/source-control families (wired as
// apps/web/src/state/{git,vcs,sourceControl}.ts wire them), project clones
// (apps/web/src/state/projectClones.ts), auth scope checks
// (apps/web/src/state/session.ts) and the pull request link mode
// (apps/web/src/hooks/usePullRequestLinking.ts).
import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import { createGitEnvironmentAtoms } from "@t3tools/client-runtime/state/git";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime/state/source-control";
import { createVcsEnvironmentAtoms } from "@t3tools/client-runtime/state/vcs";
import { threadPullRequestLinkMode } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import {
  type AuthEnvironmentScope,
  type AuthSessionState,
  type EnvironmentId,
  type ProjectCloneSnapshot,
  type ScopedProjectRef,
  sessionGrantsScope,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import { environmentServerConfigsAtom, environmentSession } from "./environment.ts";

export const gitEnvironment = createGitEnvironmentAtoms(connectionAtomRuntime);
export const vcsEnvironment = createVcsEnvironmentAtoms(connectionAtomRuntime);
export const sourceControlEnvironment = createSourceControlEnvironmentAtoms(connectionAtomRuntime);

// ── Auth scopes (apps/web/src/state/session.ts) ─────────────────────────

const EMPTY_SESSION_STATE_ATOM = Atom.make(AsyncResult.initial<AuthSessionState>());

function sessionHasScope(
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
  scope: AuthEnvironmentScope,
): boolean {
  const session = Option.getOrNull(AsyncResult.value(result));
  return result._tag !== "Failure" && session !== null && sessionGrantsScope(session, scope);
}

export function useEnvironmentScope(
  environmentId: EnvironmentId | null,
  scope: AuthEnvironmentScope,
): boolean {
  const result = useAtomValue(
    environmentId === null
      ? EMPTY_SESSION_STATE_ATOM
      : environmentSession.sessionStateAtom(environmentId),
  );
  return sessionHasScope(result, scope);
}

// Keyed by scope and ids so callers get one Set per session change, not one per render.
const environmentsWithScopeAtom = Atom.family((key: string) => {
  const [scope, idsKey = ""] = key.split(/\n(.*)/s) as [AuthEnvironmentScope, string?];
  const ids = idsKey === "" ? [] : (idsKey.split("\n") as EnvironmentId[]);
  return Atom.make(
    (get) =>
      new Set(
        ids.filter((environmentId) =>
          sessionHasScope(get(environmentSession.sessionStateAtom(environmentId)), scope),
        ),
      ) as ReadonlySet<EnvironmentId>,
  ).pipe(Atom.withLabel(`t3term-environments-with-scope:${key}`));
});

export function useEnvironmentsWithScope(
  environmentIds: ReadonlyArray<EnvironmentId>,
  scope: AuthEnvironmentScope,
): ReadonlySet<EnvironmentId> {
  return useAtomValue(environmentsWithScopeAtom(`${scope}\n${[...environmentIds].sort().join("\n")}`));
}

export function readEnvironmentScope(
  environmentId: EnvironmentId,
  scope: AuthEnvironmentScope,
): boolean {
  return sessionHasScope(
    appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId)),
    scope,
  );
}

// ── Pull request link mode (apps/web/src/hooks/usePullRequestLinking.ts) ──

// A string, so provider status pushes and snapshots that keep the mode don't
// re-render every link renderer.
export const pullRequestLinkModeAtom = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make((get) =>
    threadPullRequestLinkMode(
      environmentId === null
        ? undefined
        : get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities,
    ),
  ).pipe(Atom.withLabel("pull-request-link-mode")),
);

// ── Project clones (apps/web/src/state/projectClones.ts) ────────────────

const EMPTY_CLONES: ReadonlyArray<ProjectCloneSnapshot> = [];

export const environmentProjectClonesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<ProjectCloneSnapshot> => {
    const supported =
      get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
        .projectCloneTracking === true;
    if (!supported) return EMPTY_CLONES;
    const result = get(sourceControlEnvironment.projectClones({ environmentId, input: {} }));
    return Option.getOrElse(AsyncResult.value(result), () => EMPTY_CLONES);
  }).pipe(Atom.withLabel(`t3term-project-clones:${environmentId}`)),
);

const silencedCloneToasts = new Set<string>();

/**
 * Keeps a clone's progress out of toasts once the user is looking at its
 * project, whose composer shows the same progress.
 */
export function silenceProjectCloneToasts(ref: ScopedProjectRef) {
  silencedCloneToasts.add(scopedProjectKey(ref));
}

export function isProjectCloneToastSilenced(ref: ScopedProjectRef): boolean {
  return silencedCloneToasts.has(scopedProjectKey(ref));
}
