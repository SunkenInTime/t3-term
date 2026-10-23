// Settings routing: maps the web app's /settings/<page> paths onto routeAtom,
// remembers where Back returns to, and carries search-result targets.
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { clientSettingsAtom } from "../state/clientSettings.ts";
import { environmentProjects } from "../state/environment.ts";
import { routeAtom, type Route, type SettingsPage } from "../state/ui.ts";
import type { SettingsPath } from "../web/components/settings/settingsSearch.ts";
import { deriveLogicalProjectKeyFromSettings, selectProjectGroupingSettings } from "../web/logicalProject.ts";
import { settingsSearchTargetAtom } from "./layout.tsx";
import { settingsScopeSearchAtom } from "./scope.tsx";

export const SETTINGS_PATH_BY_PAGE: Readonly<Record<SettingsPage, SettingsPath | null>> = {
  general: "/settings/general",
  appearance: "/settings/appearance",
  projects: "/settings/projects",
  keybindings: "/settings/keybindings",
  "snap-shot": "/settings/snap-shot",
  providers: "/settings/providers",
  integrations: "/settings/integrations",
  "scheduled-tasks": "/settings/scheduled-tasks",
  "source-control": "/settings/source-control",
  storage: "/settings/storage",
  connections: "/settings/connections",
  archive: "/settings/archived",
  diagnostics: "/settings/diagnostics",
  "open-source-licenses": null,
};

export function pageForSettingsPath(path: SettingsPath): SettingsPage {
  const entry = Object.entries(SETTINGS_PATH_BY_PAGE).find(([, candidate]) => candidate === path);
  return (entry?.[0] as SettingsPage | undefined) ?? "general";
}

/** The last non-settings route, so Back and Escape return where you came from. */
let returnRoute: Route = { kind: "home" };
appAtomRegistry.subscribe(
  routeAtom,
  (route) => {
    if (route.kind !== "settings") returnRoute = route;
  },
  { immediate: true },
);

export function leaveSettings(): void {
  appAtomRegistry.set(routeAtom, returnRoute);
}

export function openSettingsPage(page: SettingsPage, targetId?: string): void {
  appAtomRegistry.set(routeAtom, { kind: "settings", page });
  if (targetId) {
    const previous = appAtomRegistry.get(settingsSearchTargetAtom);
    appAtomRegistry.set(settingsSearchTargetAtom, { id: targetId, nonce: (previous?.nonce ?? 0) + 1 });
  }
}

/** The sidebar search query and a request to focus its input ("/" or Ctrl+F). */
export const settingsSearchQueryAtom = Atom.make("").pipe(Atom.keepAlive);
export const settingsSearchFocusRequestAtom = Atom.make(0).pipe(Atom.keepAlive);

export function requestSettingsSearchFocus(): void {
  appAtomRegistry.set(settingsSearchFocusRequestAtom, appAtomRegistry.get(settingsSearchFocusRequestAtom) + 1);
}

/**
 * Web's /projects/$projectKey: the Projects page scoped to one logical project.
 * Callers that only know a project ref get the key the way ChatView derives it.
 */
export function openProjectSettings(input: {
  readonly projectKey?: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}): void {
  let projectKey = input.projectKey;
  if (projectKey === undefined) {
    const project = appAtomRegistry
      .get(environmentProjects.projectsAtom)
      .find((candidate) => candidate.environmentId === input.environmentId && candidate.id === input.projectId);
    if (project) {
      projectKey = deriveLogicalProjectKeyFromSettings(project, selectProjectGroupingSettings(appAtomRegistry.get(clientSettingsAtom)));
    }
  }
  appAtomRegistry.set(settingsScopeSearchAtom, projectKey ? { project: projectKey } : {});
  openSettingsPage("projects");
}
