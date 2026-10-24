// Client-runtime atom families, wired exactly as apps/mobile/src/state wires them.
import { createEnvironmentCatalogAtoms } from "@t3tools/client-runtime/state/connections";
import { createEnvironmentSessionAtoms } from "@t3tools/client-runtime/state/session";
import { createServerEnvironmentAtoms } from "@t3tools/client-runtime/state/server";
import {
  createEnvironmentServerConfigsAtom,
  createEnvironmentShellAtoms,
  createEnvironmentShellSummaryAtom,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
} from "@t3tools/client-runtime/state/shell";
import {
  createEnvironmentProjectAtoms,
  createProjectEnvironmentAtoms,
} from "@t3tools/client-runtime/state/projects";

import { connectionAtomRuntime } from "../runtime/runtime.ts";

export const environmentCatalog = createEnvironmentCatalogAtoms(connectionAtomRuntime);
export const environmentSession = createEnvironmentSessionAtoms(connectionAtomRuntime);
export const serverEnvironment = createServerEnvironmentAtoms(connectionAtomRuntime, {
  initialConfigValueAtom: environmentSession.initialConfigValueAtom,
  // Themes the environment publishes (Appearance > Themes), as web subscribes.
  environmentThemes: true,
  usageLimitSources: true,
  usageLimitsCommand: true,
});
export const environmentServerConfigsAtom = createEnvironmentServerConfigsAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);
export const environmentShellSummaryAtom = createEnvironmentShellSummaryAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

export const environmentProjects = createEnvironmentProjectAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});
export const projectEnvironment = createProjectEnvironmentAtoms(connectionAtomRuntime, {
  projectAtom: environmentProjects.projectAtom,
});

import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  createThreadEnvironmentAtoms,
} from "@t3tools/client-runtime/state/threads";

export const threadEnvironment = createThreadEnvironmentAtoms(
  connectionAtomRuntime,
  environmentSnapshotAtom,
);
export const environmentThreads = createEnvironmentThreadStateAtoms(connectionAtomRuntime);
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: threadEnvironment.snapshotAtom,
});

import type { OrchestrationProjectShell } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

/** Every connected environment's projects, keyed `${environmentId}:${projectId}`. */
export const projectIndexAtom = Atom.make((get) => {
  const index = new Map<string, OrchestrationProjectShell>();
  for (const environmentId of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    for (const project of get(environmentSnapshotAtom(environmentId))?.projects ?? []) {
      index.set(`${environmentId}:${project.id}`, project);
    }
  }
  return index as ReadonlyMap<string, OrchestrationProjectShell>;
});
