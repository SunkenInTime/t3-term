// Settings routing: maps the web app's /settings/<page> paths onto routeAtom,
// remembers where Back returns to, and carries search-result targets.
import type { EnvironmentId, ProjectId, ProviderInstanceId, ScheduledTaskId } from "@t3tools/contracts";
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

/**
 * Web's validated route search for /settings/providers (environmentId,
 * instanceId) and /settings/scheduled-tasks (environmentId, taskId). The nonce
 * remounts the page content, as web keys it on the search, so following the
 * same link twice reopens its target.
 */
export type SettingsPageTarget =
  | {
      readonly page: "providers";
      readonly environmentId?: EnvironmentId;
      readonly instanceId?: ProviderInstanceId;
    }
  | {
      readonly page: "scheduled-tasks";
      readonly environmentId?: EnvironmentId;
      readonly taskId?: ScheduledTaskId;
    };

export const settingsPageTargetAtom = Atom.make<{ readonly target: SettingsPageTarget; readonly nonce: number } | null>(
  null,
).pipe(Atom.keepAlive);

/** The last non-settings route, so Back and Escape return where you came from. */
let returnRoute: Route = { kind: "home" };
appAtomRegistry.subscribe(
  routeAtom,
  (route) => {
    if (route.kind !== "settings") returnRoute = route;
    // Leaving the target's page ends the link, so returning later through a plain route opens nothing.
    const pageTarget = appAtomRegistry.get(settingsPageTargetAtom);
    if (pageTarget && (route.kind !== "settings" || route.page !== pageTarget.target.page)) {
      appAtomRegistry.set(settingsPageTargetAtom, null);
    }
  },
  { immediate: true },
);

export function leaveSettings(): void {
  appAtomRegistry.set(routeAtom, returnRoute);
}

export function openSettingsPage(page: SettingsPage, targetId?: string, pageTarget?: SettingsPageTarget): void {
  const previousTarget = appAtomRegistry.get(settingsPageTargetAtom);
  // A plain navigation drops the last link's target, like a route without search.
  appAtomRegistry.set(
    settingsPageTargetAtom,
    pageTarget && pageTarget.page === page ? { target: pageTarget, nonce: (previousTarget?.nonce ?? 0) + 1 } : null,
  );
  appAtomRegistry.set(routeAtom, { kind: "settings", page });
  if (targetId) {
    const previous = appAtomRegistry.get(settingsSearchTargetAtom);
    appAtomRegistry.set(settingsSearchTargetAtom, { id: targetId, nonce: (previous?.nonce ?? 0) + 1 });
  }
}

/** web navigate({ to: "/settings/providers", search: { environmentId, instanceId } }) */
export function openProviderSettings(target: { readonly environmentId?: EnvironmentId; readonly instanceId?: ProviderInstanceId }): void {
  openSettingsPage("providers", undefined, { page: "providers", ...target });
}

/** web navigate({ to: "/settings/scheduled-tasks", search: { environmentId, taskId } }) */
export function openScheduledTaskSettings(target: { readonly environmentId?: EnvironmentId; readonly taskId?: ScheduledTaskId }): void {
  openSettingsPage("scheduled-tasks", undefined, { page: "scheduled-tasks", ...target });
}

/** The page target when it belongs to `page`, with the nonce that keys its content. */
export function selectSettingsPageTarget<P extends SettingsPageTarget["page"]>(
  value: { readonly target: SettingsPageTarget; readonly nonce: number } | null,
  page: P,
): { readonly target: Extract<SettingsPageTarget, { page: P }>; readonly nonce: number } | null {
  return value && value.target.page === page
    ? (value as { readonly target: Extract<SettingsPageTarget, { page: P }>; readonly nonce: number })
    : null;
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
