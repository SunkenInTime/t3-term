// Readiness for prompt links: apps/web/src/state/shell.ts allReachableShellsLiveAtom. A link
// decides "you don't have this repository" from the project list, so it waits until every
// enabled environment has a live snapshot or has settled offline.
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog, environmentShell } from "./environment.ts";

export const allReachableShellsLiveAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  // t3-term has no primary environment to wait for (web's requiresPrimaryEnvironment is false
  // for the hosted app too), so a ready, non-empty catalog is complete.
  if (!catalog.isReady || catalog.entries.size === 0) return false;
  for (const environmentId of enabledEnvironmentIds(catalog)) {
    const shell = get(environmentShell.stateValueAtom(environmentId));
    if (shell.status === "live" && Option.isSome(shell.snapshot)) continue;
    const state = AsyncResult.value(get(environmentCatalog.stateAtom(environmentId)));
    if (Option.isNone(state)) return false;
    const connection = state.value;
    const settledOffline =
      connection.phase === "offline" ||
      connection.phase === "blocked" ||
      (connection.phase === "backoff" && connection.attempt > 2);
    if (!settledOffline) return false;
  }
  return true;
}).pipe(Atom.withLabel("t3term-all-reachable-shells-live"));
