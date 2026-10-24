// apps/web/src/lib/openPullRequestLink.ts `useOpenChangeRequestLink` / `useOpenPrLink`, as plain
// functions read at click time: a pull request link opens inside t3-term when "Open pull requests
// in T3 Code" is on and a project on a connected environment can read it. Beside a thread it opens
// as a "#N" tab in that thread's right panel; anywhere else on the Pull requests page. Ctrl/Cmd
// (web: meta/ctrl/middle click) always goes to the host.
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, PullRequestRef, ScopedThreadRef } from "@t3tools/contracts";
import { parseChangeRequestUrl, type ChangeRequestLink } from "@t3tools/shared/changeRequestUrl";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { getClientSettings } from "../state/clientSettings.ts";
import { environmentProjects } from "../state/environment.ts";
import { openPullRequestSurface } from "../state/gitPullRequests.ts";
import { openPullRequestsPage, pullRequestEnvironmentsAtom } from "../state/pullRequests.ts";
import { primaryEnvironmentIdAtom } from "../state/sidebar.ts";
import { openExternalUrl } from "../usage/openExternal.ts";
import { findProjectForChangeRequest } from "../web/lib/openPullRequestLink.ts";

export function findProjectOnChangeRequestHost(
  projects: ReadonlyArray<EnvironmentProject>,
  link: ChangeRequestLink,
): EnvironmentProject | undefined {
  const own = findProjectForChangeRequest(projects, link);
  if (own !== undefined) return own;
  return projects.find((project) => {
    const identity = project.repositoryIdentity;
    return (
      identity?.provider !== undefined &&
      sourceControlClients.get(identity.provider).canReadChangeRequestOnHost(identity, link)
    );
  });
}

export interface PullRequestLinkTarget {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
}

/**
 * The project and reference a pull request URL resolves to on the connected environments, or
 * null when none can read it. `threadRef` narrows the search to that thread's environment (its
 * panel reads there), as web does.
 */
export function resolvePullRequestLinkTarget(
  url: string,
  options: { readonly threadRef?: ScopedThreadRef | null; readonly environmentId?: EnvironmentId | null } = {},
): PullRequestLinkTarget | null {
  const parsed = parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const environments = appAtomRegistry.get(pullRequestEnvironmentsAtom);
  const capabilitiesOf = (environmentId: string) =>
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig?.environment.capabilities;
  const reads = (environmentId: string) => capabilitiesOf(environmentId)?.pullRequests === true;
  const primaryEnvironmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
  const allProjects = appAtomRegistry.get(environmentProjects.projectsAtom) as ReadonlyArray<EnvironmentProject>;
  const scopeEnvironmentId = options.threadRef?.environmentId ?? options.environmentId ?? null;
  const projects =
    scopeEnvironmentId !== null
      ? allProjects.filter((project) => project.environmentId === scopeEnvironmentId)
      : allProjects
          .filter((project) => reads(project.environmentId))
          .toSorted(
            (left, right) =>
              Number(right.environmentId === primaryEnvironmentId) - Number(left.environmentId === primaryEnvironmentId),
          );
  const project =
    findProjectForChangeRequest(projects, parsed) ??
    (options.threadRef
      ? findProjectOnChangeRequestHost(
          projects.filter((candidate) => capabilitiesOf(candidate.environmentId)?.threadPullRequests === true),
          parsed,
        )
      : undefined);
  if (project === undefined || !reads(project.environmentId)) return null;
  const threadPullRequests = capabilitiesOf(project.environmentId)?.threadPullRequests === true;
  const repository = threadPullRequests
    ? parsed.repository
    : (sourceControlRepositorySelector(project.repositoryIdentity) ?? parsed.repository);
  return {
    environmentId: project.environmentId,
    reference: {
      projectId: project.id as PullRequestRef["projectId"],
      ...(threadPullRequests ? { host: parsed.authority ?? parsed.host } : {}),
      repository,
      number: parsed.number,
    },
  };
}

/** web useOpenChangeRequestLink. True when the link opened inside t3-term. */
export function openChangeRequestLinkInApp(
  url: string,
  options: {
    readonly threadRef?: ScopedThreadRef | null;
    readonly environmentId?: EnvironmentId | null;
    readonly external?: boolean;
  } = {},
): boolean {
  if (options.external === true || !getClientSettings().pullRequestLinksOpenInApp) return false;
  const target = resolvePullRequestLinkTarget(url, options);
  if (target === null) return false;
  if (options.threadRef && options.threadRef.environmentId === target.environmentId) {
    openPullRequestSurface(options.threadRef, target.reference);
    return true;
  }
  openPullRequestsPage({
    involvement: "all",
    state: "all",
    repository: target.reference.repository,
    number: target.reference.number,
    ...(target.reference.host ? { selectedHost: target.reference.host } : {}),
    selectedProjectId: target.reference.projectId,
    selectedEnvironmentId: target.environmentId,
  });
  return true;
}

/** web useOpenPrLink: inside t3-term when it can, otherwise on the host. */
export function openPullRequestLink(
  url: string,
  options: {
    readonly threadRef?: ScopedThreadRef | null;
    readonly environmentId?: EnvironmentId | null;
    readonly modifiers?: { readonly ctrl?: boolean; readonly cmd?: boolean } | undefined;
  } = {},
): void {
  const external = options.modifiers?.ctrl === true || options.modifiers?.cmd === true;
  if (openChangeRequestLinkInApp(url, { ...options, external })) return;
  openExternalUrl(url);
}
