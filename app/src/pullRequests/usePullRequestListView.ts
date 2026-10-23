// Port of apps/web/src/components/pullRequest/usePullRequestListView.ts. The hooks read the
// t3-term atoms in place of web's useEnvironments/useProjects; the logic is unchanged.
import { useAtomValue } from "@effect/atom-react";
import { parsePullRequestQuery } from "@t3tools/client-runtime/pull-request-query";
import {
  pullRequestHostOf,
  type EnvironmentId,
  type ProjectId,
  type PullRequestInvolvement,
  type PullRequestListFilters,
  type PullRequestListResult,
  type PullRequestListState,
  type SourceControlProviderKind,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { environmentProjects } from "../state/environment.ts";
import {
  pullRequestEnvironmentsAtom,
  pullRequestProjectsKnownAtom,
  type PullRequestsSearch,
} from "../state/pullRequests.ts";
import {
  applyPullRequestOverrides,
  findProjectForRepository,
  findScopedProject,
  matchesPullRequestFilters,
  pullRequestDiffStatKey,
  pullRequestEntryKey,
  pullRequestEntryViewer,
  pullRequestEnvironmentSetKey,
  pullRequestHostActions,
  resolveProjectScope,
  resolveQueryEnvironmentIds,
  resolveSelectedEnvironmentId,
  sortPullRequestGroups,
  withDiffStat,
  type EnvironmentPullRequestEntry,
  type MergedPullRequestList,
  type PullRequestDiffStats,
  type PullRequestGroup,
  type PullRequestListOverride,
} from "../web/components/pullRequest/pullRequestList.logic.ts";
import type { PullRequestListSort } from "../web/components/pullRequest/pullRequestListPreferences.ts";
import { assignProjectsToEnvironments } from "../web/components/pullRequest/pullRequestProjectAssignment.logic.ts";
import { pullRequestFilterProjects } from "../web/components/pullRequest/pullRequestProjectFilter.logic.ts";
import { pullRequestListEntryId } from "../web/components/pullRequest/pullRequestListGroups.logic.ts";

export interface PullRequestExpectedHost {
  readonly host: string;
  readonly kind: SourceControlProviderKind;
}

const SEARCH_DEBOUNCE_MS = 250;

export function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

/** Which servers and projects the page reads, from the search state and what this client knows. */
export function usePullRequestScope(search: PullRequestsSearch) {
  const environments = useAtomValue(pullRequestEnvironmentsAtom);
  const allProjects = useAtomValue(environmentProjects.projectsAtom);
  const projectsKnown = useAtomValue(pullRequestProjectsKnownAtom);
  const capableEnvironments = environments
    .filter(
      (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
    )
    .toSorted((left, right) => left.environmentId.localeCompare(right.environmentId));
  const scopedEnvironmentId =
    capableEnvironments.find((environment) => environment.environmentId === search.environmentId)
      ?.environmentId ?? null;
  const knownEnvironmentIds = new Set(environments.map((environment) => environment.environmentId));
  const environmentIds = capableEnvironments
    .filter(
      (environment) =>
        scopedEnvironmentId === null || environment.environmentId === scopedEnvironmentId,
    )
    .map((environment) => environment.environmentId);
  const environmentKey = pullRequestEnvironmentSetKey(environmentIds);
  const capabilityKnown = environments.some((environment) => environment.serverConfig !== null);
  const pullRequestsSupported = environmentIds.length > 0;
  const projects = allProjects.filter(
    (project) => !project.isScratch && environmentIds.includes(project.environmentId),
  );
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const scopedProjectId = resolveProjectScope(search.projectId, projects, projectsKnown);
  const scopedProject = findScopedProject(projects, scopedEnvironmentId, scopedProjectId);
  const scopedProjects = pullRequestFilterProjects(projects, environmentLabels, scopedProject);

  const selectedHost = search.selectedHost ?? search.host;
  const selectedEnvironmentId = resolveSelectedEnvironmentId(
    search.selectedEnvironmentId,
    knownEnvironmentIds,
    scopedEnvironmentId,
  );
  const projectForRepository =
    search.repository === undefined
      ? undefined
      : findProjectForRepository(projects, {
          repository: search.repository,
          host: selectedHost,
          selectedEnvironmentId,
          scopedProjectId,
          scopedEnvironmentId,
        });
  const linkedProjectId = resolveProjectScope(search.selectedProjectId, projects, projectsKnown);
  const selectedProject =
    linkedProjectId === undefined && search.repository !== undefined
      ? projectForRepository
      : findScopedProject(projects, selectedEnvironmentId, linkedProjectId ?? scopedProjectId);
  const queryEnvironmentIds = resolveQueryEnvironmentIds(
    environmentIds,
    projects,
    scopedProject,
    scopedProjectId,
    projectsKnown,
  );
  const environmentQueries = ((): ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectIds?: ReadonlyArray<ProjectId>;
  }> => {
    const plain = queryEnvironmentIds.map((environmentId) => ({ environmentId }));
    if (!projectsKnown || scopedProjectId !== undefined) return plain;
    const assignment = assignProjectsToEnvironments(
      projects,
      queryEnvironmentIds,
      queryEnvironmentIds[0],
    );
    const totals = new Map<EnvironmentId, number>();
    for (const project of projects) {
      totals.set(project.environmentId, (totals.get(project.environmentId) ?? 0) + 1);
    }
    return queryEnvironmentIds.flatMap((environmentId) => {
      const projectIds = assignment.get(environmentId);
      if (projectIds === undefined) return [];
      if (projectIds.length === (totals.get(environmentId) ?? 0)) return [{ environmentId }];
      return [{ environmentId, projectIds }];
    });
  })();
  const assignmentKey = environmentQueries
    .map(({ environmentId, projectIds }) => `${environmentId}#${projectIds?.join("+") ?? "*"}`)
    .join("|");
  const linkedSelection =
    search.repository && search.number && selectedProject
      ? {
          environmentId: selectedProject.environmentId,
          repository: search.repository,
          number: search.number,
          projectId: selectedProject.id,
          ...(selectedHost ? { host: selectedHost } : {}),
        }
      : null;
  const expectedHosts = (() => {
    const byHost = new Map<string, PullRequestExpectedHost>();
    for (const project of projects) {
      const kind = project.repositoryIdentity?.provider as SourceControlProviderKind | undefined;
      if (kind === undefined) continue;
      const host = pullRequestHostOf(project.repositoryIdentity, kind);
      if (!byHost.has(host)) byHost.set(host, { host, kind });
    }
    return [...byHost.values()];
  })();

  return {
    capableEnvironments,
    scopedEnvironmentId,
    environmentKey,
    capabilityKnown,
    pullRequestsSupported,
    projects,
    environmentLabels,
    scopedProjectId,
    scopedProject,
    scopedProjects,
    selectedProject,
    queryEnvironmentIds,
    environmentQueries,
    assignmentKey,
    linkedSelection,
    expectedHosts,
    projectsKnown,
  };
}

export function usePullRequestQueryFilters(search: PullRequestsSearch, typedQuery: string) {
  const sentQuery = useDebouncedValue(typedQuery, SEARCH_DEBOUNCE_MS);
  const typedParsed = parsePullRequestQuery(typedQuery);
  const sentParsed = parsePullRequestQuery(sentQuery);

  const menuFilters = {
    ...(search.draft ? { draft: search.draft } : {}),
    ...(search.review ? { review: search.review } : {}),
    ...(search.checks ? { checks: search.checks } : {}),
    ...(search.author ? { author: search.author } : {}),
    ...(search.labels ? { labels: search.labels.map((label) => [label]) } : {}),
  };
  const menuFiltered = Object.keys(menuFilters).length > 0;
  const filters = { ...menuFilters, ...sentParsed.filters };
  const hasFilters = Object.keys(filters).length > 0;
  const localFilters = { ...menuFilters, ...typedParsed.filters };
  const hasLocalFilters = Object.keys(localFilters).length > 0;
  return {
    sentQuery,
    querySettled: typedQuery === sentQuery,
    typedParsed,
    sentParsed,
    menuFilters,
    menuFiltered,
    filters,
    hasFilters,
    localFilters,
    hasLocalFilters,
  };
}

/**
 * The hosts the list has answered for (kept while a host filter narrows the answer), and the
 * groups as shown with measured sizes, optimistic actions, and the reader's sort.
 */
export function usePullRequestDisplayGroups({
  answered,
  host,
  groups,
  statsByRow,
  overrides,
  state,
  localFilters,
  hasLocalFilters,
  viewers,
  sort,
  text,
  involvement,
}: {
  answered: MergedPullRequestList | null;
  host: string | undefined;
  groups: ReadonlyArray<PullRequestGroup<EnvironmentPullRequestEntry>>;
  statsByRow: PullRequestDiffStats;
  overrides: ReadonlyMap<string, PullRequestListOverride>;
  state: PullRequestListState;
  localFilters: PullRequestListFilters;
  hasLocalFilters: boolean;
  viewers: PullRequestListResult["viewers"];
  sort: PullRequestListSort;
  text: string;
  involvement: PullRequestInvolvement;
}) {
  const [hostsState, setHostsState] = useState<{
    readonly source: MergedPullRequestList | null;
    readonly host: string | undefined;
    readonly hosts: PullRequestListResult["providers"];
  }>({ source: null, host: undefined, hosts: [] });
  if (answered !== null && (hostsState.source !== answered || hostsState.host !== host)) {
    setHostsState({
      source: answered,
      host,
      hosts:
        host === undefined || hostsState.hosts.length === 0 ? answered.providers : hostsState.hosts,
    });
  }
  const hosts = hostsState.hosts;
  const displayGroups = (() => {
    const enriched = groups.map((group) => {
      const overridden = applyPullRequestOverrides(
        group.entries.map((entry) => withDiffStat(entry, statsByRow)),
        overrides,
        pullRequestEntryKey,
        state,
      );
      return {
        ...group,
        entries:
          hasLocalFilters && overrides.size > 0
            ? overridden.filter(
                (entry) =>
                  !overrides.has(pullRequestEntryKey(entry)) ||
                  matchesPullRequestFilters(
                    entry,
                    localFilters,
                    pullRequestEntryViewer(entry, viewers),
                  ),
              )
            : overridden,
      };
    });
    return sortPullRequestGroups(
      enriched,
      sort,
      text,
      (entry) =>
        entry.additions + entry.deletions > 0 || statsByRow.has(pullRequestDiffStatKey(entry)),
      involvement,
    );
  })();
  const shownCount = displayGroups.reduce((count, group) => count + group.entries.length, 0);
  const hostActionsOf = pullRequestHostActions(hosts);
  const listedPullRequestsBySurface = new Map(
    displayGroups.flatMap((group) =>
      group.entries.map((entry) => [pullRequestListEntryId(entry), entry] as const),
    ),
  );

  return {
    hosts,
    displayGroups,
    shownCount,
    hostActionsOf,
    listedPullRequestsBySurface,
  };
}
