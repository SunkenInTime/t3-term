// App-level navigation state: per-environment presentation (connection phase,
// label, config) as web's state/presentation.ts builds it, and a route history
// for navigation.back / navigation.forward (web uses window.history).
import { createEnvironmentPresentationAtoms } from "@t3tools/client-runtime/state/presentation";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentCatalog, serverEnvironment } from "./environment.ts";
import { routeAtom, type Route } from "./ui.ts";

export const environmentPresentations = createEnvironmentPresentationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  stateAtom: environmentCatalog.stateAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

const HISTORY_LIMIT = 100;

interface RouteHistory {
  readonly entries: ReadonlyArray<Route>;
  readonly index: number;
}

let history: RouteHistory = { entries: [appAtomRegistry.get(routeAtom)], index: 0 };
let traversing = false;

function sameRoute(left: Route, right: Route): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Every area sets routeAtom directly; record each change so back/forward work
// no matter who navigated.
appAtomRegistry.subscribe(routeAtom, (route) => {
  if (traversing) return;
  const current = history.entries[history.index];
  if (current && sameRoute(current, route)) return;
  const entries = [...history.entries.slice(0, history.index + 1), route].slice(-HISTORY_LIMIT);
  history = { entries, index: entries.length - 1 };
});

function traverse(delta: number): boolean {
  const index = history.index + delta;
  const target = history.entries[index];
  if (!target) return false;
  history = { ...history, index };
  traversing = true;
  try {
    appAtomRegistry.set(routeAtom, target);
  } finally {
    traversing = false;
  }
  return true;
}

export const navigateBack = (): boolean => traverse(-1);
export const navigateForward = (): boolean => traverse(1);
