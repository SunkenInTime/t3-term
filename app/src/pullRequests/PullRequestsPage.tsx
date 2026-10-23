// Port of apps/web/src/routes/_chat.pull-requests.tsx + components/pullRequest/PullRequestsPage.tsx
// and PullRequestsColumn.tsx. Search params live in `pullRequestsSearchAtom`; the right panel's
// pull request tabs live in `pullRequestPanelAtom` (state/pullRequests.ts).
import { useAtom, useAtomValue } from "@effect/atom-react";
import { applyPullRequestDraftFilterChange } from "@t3tools/client-runtime/pull-request-query";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { sortProjectsByGroupOrder } from "@t3tools/client-runtime/state/project-grouping";
import {
  pullRequestHostOf,
  type EnvironmentId,
  type ProjectId,
  type PullRequestInvolvement,
  type PullRequestListCursors,
  type PullRequestListInput,
  type PullRequestListResult,
  type PullRequestListState,
  type SourceControlProviderKind,
} from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  pullRequestEnvironment,
  pullRequestPanel,
  pullRequestPanelAtom,
  pullRequestsSearchAtom,
  updatePullRequestListScope,
  updatePullRequestsSearch,
  usePullRequestList,
  usePullRequestListStats,
  usePullRequestTurnRefreshes,
  type EnvironmentQueryTarget,
  type PullRequestSurface,
} from "../state/pullRequests.ts";
import { commandPaletteOpenAtom, sidebarOpenAtom } from "../state/ui.ts";
import { Icon } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { LAYOUT, alpha, useTheme } from "../ui/theme.ts";
import {
  collectPullRequestListFacets,
  mergePullRequestDiffStats,
  narrowPullRequestsToFilters,
  pullRequestEntryKey,
  pullRequestStatsRequestBatches,
  pullRequestStatsRefreshBatches,
  rankPullRequestMatches,
  readPullRequestListSnapshot,
  retainVisiblePullRequestStatsBatches,
  reusePullRequestEntries,
  settlePullRequestOverrides,
  largestPullRequestReadCount,
  writePullRequestListSnapshot,
  type EnvironmentPullRequestEntry,
  type MergedPullRequestList,
  type PullRequestDiffStats,
  type PullRequestListOverride,
  type PullRequestPartitionsSnapshot,
  type PullRequestStatsBatch,
  type PullRequestStatsPolicy,
  type PullRequestStatsScope,
} from "../web/components/pullRequest/pullRequestList.logic.ts";
import {
  pullRequestGroups,
  pullRequestListEntryId,
} from "../web/components/pullRequest/pullRequestListGroups.logic.ts";
import { pullRequestStorage } from "../state/pullRequests.ts";
import { PullRequestDetailPanel } from "./PullRequestDetailPanel.tsx";
import {
  PULL_REQUEST_GROUP_GAP,
  PULL_REQUEST_GROUP_HEADER_HEIGHT,
  PULL_REQUEST_ROW_GAP,
  PULL_REQUEST_ROW_HEIGHT,
  PullRequestListGroups,
  type PullRequestRowTarget,
} from "./PullRequestList.tsx";
import {
  PullRequestListEmptyState,
  PullRequestListGhost,
  PullRequestsUnavailableState,
} from "./PullRequestListStates.tsx";
import {
  OutlineButton,
  PullRequestCompactFilterMenu,
  PullRequestFiltersMenu,
  PullRequestSearchInput,
} from "./PullRequestMenus.tsx";
import {
  INVOLVEMENT_TABS,
  SORT_OPTIONS,
  STATE_TABS,
  pullRequestProjectKey,
  type PullRequestFilterOption,
} from "./pullRequestListOptions.ts";
import {
  usePullRequestDisplayGroups,
  usePullRequestQueryFilters,
  usePullRequestScope,
  type PullRequestExpectedHost,
} from "./usePullRequestListView.ts";

/**
 * One whole page from the host and no more: every provider asks for one row beyond the page as
 * its "is there more" probe, and GitHub serves a hundred per request.
 */
const PAGE_SIZE = 99;
const MAX_PAGE_SIZE = 500;
const EMPTY_VIEWERS: PullRequestListResult["viewers"] = {};
const EMPTY_PARTITIONS: PullRequestPartitionsSnapshot = { authored: [], reviewing: [] };
const NO_LIST_TARGETS: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>> = [];
const NO_OVERRIDES: ReadonlyMap<string, PullRequestListOverride> = new Map();

// Layout of the scrolling column, used to place rows without measuring them.
const CONTAINER_MAX_WIDTH = 1152;
const CONTAINER_PADDING_X = 24;
const CONTAINER_PADDING_TOP = 24;
const CONTAINER_GAP = 16;
const TOOLBAR_GAP = 8;
const SEARCH_HEIGHT = 34;
const BUTTON_HEIGHT = 32;
/** `@lg/pr-list`: the search shares its row with the buttons from this width up. */
const WIDE_TOOLBAR = 512;
/** IntersectionObserver rootMargin web uses to read stats for rows near the viewport. */
const STATS_ROOT_MARGIN = 480;

/** apps/web/src/components/pullRequest/PullRequestListFilters.tsx pullRequestHostLabel. */
function pullRequestHostLabel(
  entries: ReadonlyArray<PullRequestExpectedHost>,
  entry: PullRequestExpectedHost,
): string {
  const sharing = entries.filter((candidate) => candidate.kind === entry.kind);
  return sharing.length > 1 ? entry.host : sourceControlClients.get(entry.kind).label;
}

export function PullRequestsPage() {
  const search = useAtomValue(pullRequestsSearchAtom);
  const panel = useAtomValue(pullRequestPanelAtom);
  const sort = search.sort ?? "ready";
  const statsPolicy: PullRequestStatsPolicy =
    sort === "ready" || sort === "largest" || sort === "smallest" ? "eager" : "visible";
  const {
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
  } = usePullRequestScope(search);

  const selectedSurface =
    panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId) ?? null;
  const activeSurface = panel.isOpen ? selectedSurface : null;
  const panelEnvironmentId =
    (activeSurface?.environmentId as EnvironmentId | undefined) ??
    selectedProject?.environmentId ??
    null;

  const clearedSelection = {
    repository: undefined,
    number: undefined,
    selectedProjectId: undefined,
    selectedEnvironmentId: undefined,
    selectedHost: undefined,
  };
  const updateSearch = updatePullRequestsSearch;
  const updateListScope = updatePullRequestListScope;

  const typedQuery = (search.q ?? "").trim();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const {
    sentQuery,
    querySettled,
    typedParsed,
    sentParsed,
    menuFilters,
    menuFiltered,
    filters,
    hasFilters,
    localFilters,
    hasLocalFilters,
  } = usePullRequestQueryFilters(search, typedQuery);
  const turnRefreshes = usePullRequestTurnRefreshes(
    environmentQueries.map(({ environmentId }) => environmentId),
  );
  const turnRefreshToken = turnRefreshes
    .map(([environmentId, revision]) => `${environmentId}:${revision}`)
    .join("|");
  const scopeKey = `${environmentKey}:${assignmentKey}:${search.state}:${search.involvement}:${scopedProjectId ?? ""}:${search.host ?? ""}:${search.draft ?? ""}:${search.review ?? ""}:${search.checks ?? ""}:${search.author ?? ""}:${search.labels?.join("\u0000") ?? ""}`;
  const filterKey = `${scopeKey}:${sentQuery}`;
  const statsScope: PullRequestStatsScope = { key: filterKey, policy: statsPolicy };
  const [page, setPage] = useState<{
    key: string;
    size: number;
    cursors: Readonly<Record<string, PullRequestListCursors>> | null;
    regrown: ReadonlyArray<string>;
  }>({ key: filterKey, size: PAGE_SIZE, cursors: null, regrown: [] });
  const pageSize = page.key === filterKey ? page.size : PAGE_SIZE;
  const sentCursors = page.key === filterKey ? page.cursors : null;
  const sentRegrown = page.key === filterKey ? page.regrown : [];
  if (page.key !== filterKey) {
    setPage({ key: filterKey, size: PAGE_SIZE, cursors: null, regrown: [] });
  }

  const listTargets = environmentQueries.flatMap(({ environmentId, projectIds }) => {
    const cursors = sentCursors?.[environmentId];
    if (sentCursors !== null && cursors === undefined && !sentRegrown.includes(environmentId)) {
      return [];
    }
    return [
      {
        environmentId,
        input: {
          state: search.state,
          involvement: search.involvement,
          limit: pageSize,
          ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          ...(projectIds ? { projectIds } : {}),
          ...(search.host ? { host: search.host } : {}),
          ...(hasFilters ? { filters } : {}),
          ...(sentParsed.text ? { query: sentParsed.text } : {}),
          ...(cursors === undefined ? {} : { cursors }),
        } satisfies PullRequestListInput,
      },
    ];
  });
  const listQuery = usePullRequestList(listTargets);

  // Its own read: an answer cannot say which question it belongs to, and mid-switch a search's
  // answer would otherwise file itself under the workspace.
  const baselineTargets = environmentQueries.map(({ environmentId, projectIds }) => ({
    environmentId,
    input: {
      state: search.state,
      involvement: search.involvement,
      limit: PAGE_SIZE,
      ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
      ...(projectIds ? { projectIds } : {}),
      ...(search.host ? { host: search.host } : {}),
      ...(menuFiltered ? { filters: menuFilters } : {}),
    } satisfies PullRequestListInput,
  }));
  const baselineQuery = usePullRequestList(baselineTargets);
  const baselineEmpty =
    baselineQuery.data?.entries.length === 0 &&
    baselineQuery.data.errors.length === 0 &&
    !baselineQuery.isPending &&
    baselineQuery.error === null;
  const facetTargets = !filtersOpen
    ? NO_LIST_TARGETS
    : environmentQueries.map(({ environmentId, projectIds }) => ({
        environmentId,
        input: {
          state: "all",
          involvement: search.involvement,
          limit: PAGE_SIZE,
          ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          ...(projectIds ? { projectIds } : {}),
          ...(search.host ? { host: search.host } : {}),
        } satisfies PullRequestListInput,
      }));
  const facetQuery = usePullRequestList(facetTargets);
  const partitionsWanted = search.involvement === "all" && typedQuery.length === 0;
  const partitionTargets = (() => {
    // The main list goes first: it puts rows on screen sooner and proves which repositories the
    // host search indexes, so an empty partition does not trigger the per-repository fallback.
    if (!partitionsWanted || baselineQuery.data === null || baselineQuery.data.entries.length === 0) {
      return { authored: NO_LIST_TARGETS, reviewing: NO_LIST_TARGETS };
    }
    const targetsFor = (involvement: PullRequestInvolvement) =>
      environmentQueries.map(({ environmentId, projectIds }) => ({
        environmentId,
        input: {
          state: search.state,
          involvement,
          limit: PAGE_SIZE,
          ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          ...(projectIds ? { projectIds } : {}),
          ...(search.host ? { host: search.host } : {}),
          ...(menuFiltered ? { filters: menuFilters } : {}),
        } satisfies PullRequestListInput,
      }));
    return { authored: targetsFor("authored"), reviewing: targetsFor("reviewing") };
  })();
  const authoredQuery = usePullRequestList(partitionTargets.authored);
  const reviewingQuery = usePullRequestList(partitionTargets.reviewing);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const [invalidating, setInvalidating] = useState(false);
  const refreshing = invalidating || listQuery.isPending;

  const [loaded, setLoaded] = useState<{
    environmentKey: string;
    scope: string;
    query: string;
    source: MergedPullRequestList | null;
    data: MergedPullRequestList;
    partitions?: PullRequestPartitionsSnapshot;
  } | null>(null);
  const [ordered, setOrdered] = useState<{
    key: string;
    source: MergedPullRequestList;
    entries: ReadonlyArray<EnvironmentPullRequestEntry>;
  } | null>(null);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, PullRequestListOverride>>(
    () => NO_OVERRIDES,
  );
  const [snapshotEnvironmentKey, setSnapshotEnvironmentKey] = useState("");
  if (environmentKey.length > 0 && snapshotEnvironmentKey !== environmentKey) {
    setSnapshotEnvironmentKey(environmentKey);
    if (loaded?.environmentKey !== environmentKey) {
      const snapshot = readPullRequestListSnapshot(pullRequestStorage, environmentKey);
      setLoaded(
        snapshot === null
          ? null
          : {
              environmentKey,
              scope: snapshot.scope,
              query: "",
              source: null,
              data: snapshot.data,
              ...(snapshot.partitions === undefined ? {} : { partitions: snapshot.partitions }),
            },
      );
    }
  }
  const settledList = listQuery.data !== null && !listQuery.isPending ? listQuery.data : null;
  const answeredPartitions =
    partitionsWanted && baselineEmpty
      ? EMPTY_PARTITIONS
      : partitionsWanted && authoredQuery.data !== null && reviewingQuery.data !== null
        ? { authored: authoredQuery.data.entries, reviewing: reviewingQuery.data.entries }
        : null;
  const heldPartitions =
    loaded !== null && loaded.environmentKey === environmentKey && loaded.scope === scopeKey
      ? loaded.partitions
      : undefined;
  const nextPartitions = answeredPartitions ?? heldPartitions;
  const loadedEntries =
    settledList === null ? null : ordered?.key === filterKey ? ordered.entries : settledList.entries;
  if (
    settledList !== null &&
    loadedEntries !== null &&
    (loaded === null ||
      loaded.source !== settledList ||
      loaded.environmentKey !== environmentKey ||
      loaded.scope !== scopeKey ||
      loaded.query !== sentQuery ||
      loaded.data.entries !== loadedEntries ||
      loaded.partitions?.authored !== nextPartitions?.authored ||
      loaded.partitions?.reviewing !== nextPartitions?.reviewing)
  ) {
    setLoaded({
      environmentKey,
      scope: scopeKey,
      query: sentQuery,
      source: settledList,
      data: { ...settledList, entries: loadedEntries },
      ...(nextPartitions === undefined ? {} : { partitions: nextPartitions }),
    });
  }
  const snapshotToWrite =
    loaded !== null && loaded.source !== null && loaded.environmentKey.length > 0 && loaded.query.length === 0
      ? loaded
      : null;
  const snapshotViewers = baselineQuery.data?.viewers;
  const snapshotProviders = baselineQuery.data?.providers;
  useEffect(() => {
    if (snapshotToWrite === null) return;
    writePullRequestListSnapshot(pullRequestStorage, snapshotToWrite.environmentKey, {
      scope: snapshotToWrite.scope,
      data: {
        ...snapshotToWrite.data,
        viewers: snapshotViewers ?? snapshotToWrite.data.viewers,
        providers: snapshotProviders ?? snapshotToWrite.data.providers,
      },
      ...(snapshotToWrite.partitions === undefined ? {} : { partitions: snapshotToWrite.partitions }),
    });
  }, [snapshotToWrite, snapshotViewers, snapshotProviders]);
  const narrowed = (() => {
    if (loaded === null || loaded.environmentKey !== environmentKey || loaded.scope === scopeKey) {
      return null;
    }
    const entries = narrowPullRequestsToFilters(loaded.data.entries, {
      state: search.state,
      projectId: scopedProjectId,
      host: search.host,
    });
    return entries.length === 0 ? null : { ...loaded.data, entries };
  })();
  const answered =
    (sentQuery.length === 0 && sentCursors === null && pageSize === PAGE_SIZE
      ? baselineQuery.data
      : listQuery.data) ??
    (loaded?.scope === scopeKey && loaded.query === sentQuery ? loaded.data : null);
  const carried =
    (sentQuery.length === 0 ? baselineQuery.data : undefined) ??
    (loaded?.scope === scopeKey ? loaded.data : null) ??
    narrowed;
  const listData = answered ?? carried;
  const showingCarried = answered === null && carried !== null;
  const loadingMore = listQuery.isPending && listData !== null;
  const firstLoad = listQuery.isPending && listData === null;

  if (
    answered !== null &&
    !listQuery.isPending &&
    !(listQuery.error && listQuery.data === null) &&
    (ordered === null || ordered.key !== filterKey || ordered.source !== answered)
  ) {
    if (ordered === null || ordered.key !== filterKey) {
      setOrdered({
        key: filterKey,
        source: answered,
        entries: rankPullRequestMatches(answered.entries, sentParsed.text),
      });
    } else if (sentCursors !== null) {
      const held = new Set(ordered.entries.map(pullRequestEntryKey));
      const arrived = answered.entries.filter((entry) => !held.has(pullRequestEntryKey(entry)));
      const appended = rankPullRequestMatches(
        arrived.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        sentParsed.text,
      );
      setOrdered({ key: filterKey, source: answered, entries: [...ordered.entries, ...appended] });
    } else {
      setOrdered({
        key: filterKey,
        source: answered,
        entries: reusePullRequestEntries(
          ordered.entries,
          rankPullRequestMatches(answered.entries, sentParsed.text),
          pullRequestEntryKey,
        ),
      });
    }
    const answeredEntries = answered.entries;
    if (overrides.size > 0) {
      setOverrides((current) =>
        settlePullRequestOverrides(current, answeredEntries, pullRequestEntryKey, Date.now()),
      );
    }
  }

  // From this question's own answer, never from the rows held while it travels.
  const nextCursors = answered?.nextCursors ?? {};
  const regrown = (answered?.truncatedEnvironments ?? []).filter(
    (environmentId) => nextCursors[environmentId] === undefined,
  );
  const canContinue = !showingCarried && Object.keys(nextCursors).length > 0;
  const loadMore = () => {
    if (canContinue) {
      setPage({
        key: filterKey,
        size: regrown.length === 0 ? pageSize : Math.min(pageSize + PAGE_SIZE, MAX_PAGE_SIZE),
        cursors: nextCursors,
        regrown,
      });
      return;
    }
    setPage({ key: filterKey, size: Math.min(pageSize + PAGE_SIZE, MAX_PAGE_SIZE), cursors: null, regrown: [] });
  };

  const refreshList = (includeRelated = false) => {
    const related = includeRelated
      ? [...baselineTargets, ...facetTargets, ...partitionTargets.authored, ...partitionTargets.reviewing]
      : [];
    if (sentCursors === null) {
      listQuery.refresh([...listTargets, ...related]);
      return;
    }
    if (related.length > 0) listQuery.refresh(related);
    const loadedCount = ordered?.key === filterKey ? largestPullRequestReadCount(ordered.entries) : pageSize;
    setPage({
      key: filterKey,
      regrown: [],
      size: Math.min(Math.max(pageSize, Math.ceil(loadedCount / PAGE_SIZE) * PAGE_SIZE), MAX_PAGE_SIZE),
      cursors: null,
    });
  };

  const appliedTurnRefreshToken = useRef("");
  const refreshListRef = useRef(refreshList);
  refreshListRef.current = refreshList;
  useEffect(() => {
    if (turnRefreshToken.length === 0 || appliedTurnRefreshToken.current === turnRefreshToken) return;
    appliedTurnRefreshToken.current = turnRefreshToken;
    if (sentCursors !== null) refreshListRef.current();
    // oxlint-disable-next-line react/exhaustive-deps -- only a new turn refresh should re-run this
  }, [turnRefreshToken]);

  const viewers = baselineQuery.data?.viewers ?? listData?.viewers ?? EMPTY_VIEWERS;
  const listErrors = baselineQuery.data?.errors ?? listData?.errors ?? [];
  const facets = collectPullRequestListFacets(
    [...(facetQuery.data?.entries ?? []), ...(baselineQuery.data?.entries ?? listData?.entries ?? [])],
    search.state,
  );

  const { entries, groups, entriesByStatsKey } = pullRequestGroups({
    known: ordered?.key === filterKey ? ordered.entries : (listData?.entries ?? []),
    providers: baselineQuery.data?.providers ?? listData?.providers ?? [],
    viewers,
    involvement: search.involvement,
    localFilters,
    hasLocalFilters,
    text: typedParsed.text,
    answeredLocally: querySettled && !showingCarried,
    baselineEmpty,
    held:
      loaded !== null && loaded.environmentKey === environmentKey && loaded.scope === scopeKey
        ? loaded.partitions
        : undefined,
    authored: partitionsWanted ? authoredQuery.data?.entries : undefined,
    reviewing: partitionsWanted ? reviewingQuery.data?.entries : undefined,
    partitionsWanted,
  });

  // ── Diff stats ──────────────────────────────────────────────────────
  const [statsByRow, setStatsByRow] = useState<PullRequestDiffStats>(() => new Map());
  const [statsTargetState, setStatsTargetState] = useState<{
    readonly key: string;
    readonly batches: ReadonlyArray<PullRequestStatsBatch>;
  }>({ key: filterKey, batches: [] });
  const statsBatches = statsTargetState.key === filterKey ? statsTargetState.batches : [];
  const statsQuery = usePullRequestListStats(
    statsBatches.map(({ environmentId, input }) => ({ environmentId, input })),
  );
  const [mergedStats, setMergedStats] = useState<typeof statsQuery.stats>(null);
  if (statsQuery.stats !== null && statsQuery.stats !== mergedStats) {
    const stats = statsQuery.stats;
    setMergedStats(stats);
    setStatsByRow((previous) => mergePullRequestDiffStats(previous, stats));
  }

  const { hosts, displayGroups, shownCount, listedPullRequestsBySurface } = usePullRequestDisplayGroups({
    answered,
    host: search.host,
    groups,
    statsByRow,
    overrides,
    state: search.state,
    localFilters,
    hasLocalFilters,
    viewers,
    sort,
    text: typedParsed.text,
    involvement: search.involvement,
  });

  // Web watches rows with an IntersectionObserver. Rows here have fixed heights, so the rows
  // within the same margin of the viewport are found from the scroll offset instead.
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(900);
  const [containerWidth, setContainerWidth] = useState(0);
  const innerWidth = Math.max(0, containerWidth - CONTAINER_PADDING_X * 2);
  const wideToolbar = innerWidth >= WIDE_TOOLBAR || containerWidth === 0;
  const toolbarHeight = wideToolbar ? SEARCH_HEIGHT : SEARCH_HEIGHT + TOOLBAR_GAP + BUTTON_HEIGHT;
  const markerY = CONTAINER_PADDING_TOP + toolbarHeight;
  const listTop = markerY + 1 + CONTAINER_GAP;
  const visibleKeys = (() => {
    const top = scrollY - STATS_ROOT_MARGIN;
    const bottom = scrollY + viewportHeight + STATS_ROOT_MARGIN;
    const keys = new Set<string>();
    let y = listTop;
    displayGroups.forEach((group, groupIndex) => {
      if (groupIndex > 0) y += PULL_REQUEST_GROUP_GAP;
      if (group.label) y += PULL_REQUEST_GROUP_HEADER_HEIGHT + PULL_REQUEST_ROW_GAP;
      for (const entry of group.entries) {
        if (y + PULL_REQUEST_ROW_HEIGHT >= top && y <= bottom) keys.add(pullRequestEntryKey(entry));
        y += PULL_REQUEST_ROW_HEIGHT + PULL_REQUEST_ROW_GAP;
      }
    });
    return keys;
  })();
  const visibleKeysToken = [...visibleKeys].join("|");
  useEffect(() => {
    setStatsTargetState((current) => {
      const batches = current.key === filterKey ? current.batches : [];
      const retained =
        statsPolicy === "visible" && !statsQuery.isPending
          ? retainVisiblePullRequestStatsBatches(batches, visibleKeys)
          : batches;
      const added = pullRequestStatsRequestBatches({
        entriesByKey: entriesByStatsKey,
        candidateKeys: visibleKeys,
        policy: statsPolicy,
        activeBatches: batches,
        statsByRow,
      });
      if (added.length === 0 && retained.length === batches.length && current.key === filterKey) {
        return current;
      }
      return { key: filterKey, batches: [...retained, ...added] };
    });
    // oxlint-disable-next-line react/exhaustive-deps -- arriving stats must not re-ask for them
  }, [filterKey, statsPolicy, entriesByStatsKey.size, visibleKeysToken, statsQuery.isPending]);

  const refreshListAndStats = (requestedStatsScope: PullRequestStatsScope = statsScope) => {
    refreshList(true);
    const batches = pullRequestStatsRefreshBatches({
      requestedScope: requestedStatsScope,
      currentScope: statsScope,
      entriesByKey: entriesByStatsKey,
      candidateKeys: visibleKeys,
      statsByRow,
    });
    if (batches !== null) {
      setStatsTargetState({ key: requestedStatsScope.key, batches });
      statsQuery.refresh(batches.map(({ environmentId, input }) => ({ environmentId, input })));
    }
  };
  const refreshFromHost = async () => {
    const requestedStatsScope = statsScope;
    setInvalidating(true);
    // `invalidate` drops the server's cached host reads; it does not write to the host.
    await Promise.all(
      queryEnvironmentIds.map((environmentId) =>
        runAtomCommand(appAtomRegistry, pullRequestEnvironment.invalidate, { environmentId, input: {} }),
      ),
    );
    setInvalidating(false);
    refreshListAndStats(requestedStatsScope);
    setDetailRefreshToken((token) => token + 1);
  };

  const showProvider = hosts.length > 1;

  useEffect(() => {
    if (!pullRequestsSupported || linkedSelection === null) return;
    const already = appAtomRegistry
      .get(pullRequestPanelAtom)
      .surfaces.some(
        (surface) =>
          surface.repository === linkedSelection.repository &&
          surface.number === linkedSelection.number &&
          surface.environmentId === linkedSelection.environmentId,
      );
    if (!already) pullRequestPanel.open(linkedSelection);
  }, [
    linkedSelection?.environmentId,
    linkedSelection?.repository,
    linkedSelection?.number,
    linkedSelection?.projectId,
    pullRequestsSupported,
  ]);

  const selected =
    activeSurface !== null
      ? {
          environmentId: activeSurface.environmentId,
          repository: activeSurface.repository,
          number: activeSurface.number,
          projectId: activeSurface.projectId as ProjectId,
          host:
            activeSurface.host ??
            (selectedProject?.repositoryIdentity
              ? pullRequestHostOf(
                  selectedProject.repositoryIdentity,
                  selectedProject.repositoryIdentity.provider as SourceControlProviderKind,
                )
              : undefined),
        }
      : null;

  const selectSurfaceInSearch = (surface: PullRequestSurface | null) =>
    updateSearch(
      surface === null
        ? clearedSelection
        : {
            repository: surface.repository,
            number: surface.number,
            selectedProjectId: surface.projectId as ProjectId,
            selectedHost: surface.host,
            ...(surface.environmentId === undefined
              ? {}
              : { selectedEnvironmentId: surface.environmentId as EnvironmentId }),
          },
    );

  const rightPanelAvailable = selectedSurface !== null;
  const toggleRightPanel = () => {
    if (panel.isOpen) {
      pullRequestPanel.close();
      updateSearch(clearedSelection);
      return;
    }
    if (selectedSurface === null) return;
    pullRequestPanel.show();
    selectSurfaceInSearch(selectedSurface);
  };
  const [maximized, setMaximized] = useState(false);
  const rightPanelMaximized = panel.isOpen && maximized;
  if (!panel.isOpen && maximized) setMaximized(false);

  const unavailableProjects = new Map(
    listErrors.map(
      (error) =>
        [pullRequestProjectKey({ id: error.projectId, environmentId: error.environmentId }), error.message] as const,
    ),
  );

  const selectEntry = (entry: PullRequestRowTarget) => {
    pullRequestPanel.open(entry);
    updateSearch({
      repository: entry.repository,
      number: entry.number,
      selectedProjectId: entry.projectId,
      selectedEnvironmentId: entry.environmentId,
      selectedHost: entry.host,
    });
  };

  const searchInput = (
    <PullRequestSearchInput
      value={search.q ?? ""}
      busy={typedQuery.length > 0 && (!querySettled || showingCarried)}
      onChange={(query) => updateListScope({ q: query || undefined })}
    />
  );
  const carriedToNothing =
    shownCount === 0 && typedQuery.length === 0 && (!querySettled || (showingCarried && listQuery.isPending));
  const metaWidth = Math.max(0, innerWidth - 24 - 16 - 8);
  const listBody = (
    <>
      {!capabilityKnown ? (
        <PullRequestListGhost rows={7} />
      ) : !pullRequestsSupported ? (
        <PullRequestsUnavailableState
          title="Pull requests unavailable"
          error="Update your T3 Code servers to browse pull requests."
        />
      ) : firstLoad ? (
        <PullRequestListGhost rows={7} />
      ) : listQuery.error && shownCount === 0 ? (
        <PullRequestsUnavailableState
          error={listQuery.error}
          refreshing={listQuery.isPending}
          onRetry={() => listQuery.refresh()}
        />
      ) : carriedToNothing ? (
        <PullRequestListGhost rows={7} />
      ) : shownCount === 0 ? (
        <PullRequestListEmptyState
          hasProjects={!projectsKnown || projects.length > 0}
          refreshing={refreshing}
          onRefresh={() => void refreshFromHost()}
          query={typedQuery}
          filtered={
            menuFiltered ||
            search.state !== "open" ||
            search.involvement !== "all" ||
            scopedProjectId !== undefined ||
            search.host !== undefined
          }
          searching={typedQuery.length > 0 && (!querySettled || showingCarried)}
          canLoadMore={listData?.truncated === true && (canContinue || pageSize < MAX_PAGE_SIZE)}
          loadingMore={loadingMore}
          onClearQuery={() => updateListScope({ q: undefined })}
          onLoadMore={loadMore}
          onAddProject={() => appAtomRegistry.set(commandPaletteOpenAtom, true)}
        />
      ) : (
        <PullRequestListGroups
          groups={displayGroups}
          environmentLabels={capableEnvironments.length > 1 ? environmentLabels : null}
          query={typedParsed.text}
          selected={selected}
          showProvider={showProvider}
          metaWidth={metaWidth}
          onSelect={selectEntry}
        />
      )}
      {listQuery.error && shownCount > 0 ? <ListErrorBanner error={listQuery.error} onRetry={() => listQuery.refresh()} /> : null}
      {listData?.truncated && entries.length > 0 ? (
        <LoadMoreFooter
          loadingMore={loadingMore}
          updating={sentCursors === null}
          canLoadMore={canContinue || pageSize < MAX_PAGE_SIZE}
          disabled={listQuery.isPending || showingCarried}
          onLoadMore={loadMore}
        />
      ) : null}
    </>
  );

  const hostEntries: ReadonlyArray<PullRequestExpectedHost> =
    hosts.length > 0 ? hosts.map((host) => ({ host: host.host, kind: host.kind })) : expectedHosts;
  const hostMenuOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: "", label: "All", icon: "plug-2" },
    ...hostEntries.map((entry) => {
      const summary = hosts.find((host) => host.host === entry.host);
      return {
        value: entry.host,
        label: pullRequestHostLabel(hostEntries, entry),
        icon: "git-pull-request-arrow" as const,
        sourceControlKind: entry.kind,
        ...(summary === undefined || summary.configured
          ? {}
          : { unavailable: summary.detail ?? "This host could not be read." }),
      };
    }),
  ];
  const serverMenuOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: "", label: "All servers", icon: "layers" },
    ...capableEnvironments.map((environment) => ({
      value: environment.environmentId,
      label: environment.label,
      icon: "server" as const,
    })),
  ];
  const sortMenu = (
    <PullRequestCompactFilterMenu
      label="Sort pull requests"
      triggerIcon="arrow-down-up"
      triggerLabel="Sort"
      outlined
      value={sort}
      options={SORT_OPTIONS}
      onChange={(next) => updateListScope({ sort: next })}
      testId="pr-sort"
    />
  );
  const filtersMenu = (
    <PullRequestFiltersMenu
      onOpenChange={setFiltersOpen}
      state={search.state}
      stateOptions={STATE_TABS}
      onState={(state) => updateListScope({ state })}
      involvement={search.involvement}
      involvementOptions={INVOLVEMENT_TABS}
      onInvolvement={(involvement) => updateListScope({ involvement })}
      filters={typedParsed.filters.draft ? { ...menuFilters, draft: typedParsed.filters.draft } : menuFilters}
      onFilters={(value) => {
        const { query, filters: next } = applyPullRequestDraftFilterChange(typedQuery, menuFilters, value);
        updateListScope({
          ...(query === typedQuery ? {} : { q: query || undefined }),
          draft: next.draft,
          review: next.review,
          checks: next.checks,
          author: next.author,
          labels: next.labels?.flatMap((group) => group),
        });
      }}
      authorOptions={facets.authors}
      labelOptions={facets.labels}
      host={search.host}
      hostOptions={hostMenuOptions}
      onHost={(host) => updateListScope({ host })}
      server={scopedEnvironmentId ?? undefined}
      serverOptions={serverMenuOptions}
      onServer={(server) => updateListScope({ environmentId: server, projectId: undefined })}
      projects={sortProjectsByGroupOrder(scopedProjects, [])}
      projectId={scopedProjectId}
      projectEnvironmentId={scopedProject?.environmentId}
      unavailable={unavailableProjects}
      onProject={(projectId, environmentId) =>
        updateListScope(environmentId === undefined ? { projectId } : { projectId, environmentId })
      }
    />
  );

  const condensed = scrollY > markerY;
  const column = (
    <PullRequestsColumn
      condensed={condensed}
      refreshing={refreshing}
      onRefresh={() => void refreshFromHost()}
      searchValue={search.q ?? ""}
      involvement={search.involvement}
      state={search.state}
      host={search.host}
      hostMenuOptions={hostMenuOptions}
      onInvolvement={(involvement) => updateListScope({ involvement })}
      onState={(state) => updateListScope({ state })}
      onHost={(host) => updateListScope({ host })}
      searchInput={searchInput}
      sortMenu={sortMenu}
      filtersMenu={filtersMenu}
      wideToolbar={wideToolbar}
      panelControls={
        pullRequestsSupported && !panel.isOpen ? (
          <RightPanelToggle available={rightPanelAvailable} open={false} onToggle={toggleRightPanel} />
        ) : null
      }
      maximizedAway={rightPanelMaximized}
      listBody={listBody}
      onScrollY={setScrollY}
      onViewportHeight={setViewportHeight}
      onContainerWidth={setContainerWidth}
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, minWidth: 0, height: "100%" }}>
      {column}
      {panel.isOpen && activeSurface && panelEnvironmentId !== null ? (
        <PullRequestDetailPanel
          key={activeSurface.id}
          surfaces={panel.surfaces}
          activeSurface={activeSurface}
          environmentId={panelEnvironmentId}
          maximized={rightPanelMaximized}
          onToggleMaximized={() => setMaximized((value) => !value)}
          onTogglePanel={toggleRightPanel}
          onActivateSurface={(surface) => {
            pullRequestPanel.activate(surface.id);
            selectSurfaceInSearch(surface);
          }}
          onCloseSurface={(surface) => {
            pullRequestPanel.closeSurface(surface.id);
            const next = appAtomRegistry.get(pullRequestPanelAtom);
            selectSurfaceInSearch(next.surfaces.find((entry) => entry.id === next.activeSurfaceId) ?? null);
          }}
          listEntry={listedPullRequestsBySurface.get(pullRequestListEntryId(activeSurface)) ?? null}
          refreshToken={detailRefreshToken}
          onSelectPullRequest={(reference) => {
            pullRequestPanel.open({ ...reference, environmentId: panelEnvironmentId });
            updateSearch({
              repository: reference.repository,
              number: reference.number,
              selectedHost: reference.host,
              selectedProjectId: reference.projectId as ProjectId,
              selectedEnvironmentId: panelEnvironmentId,
            });
          }}
        />
      ) : null}
    </div>
  );
}

function ListErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: alpha(theme.warning, 0.3),
        backgroundColor: alpha(theme.warning, 0.08),
      }}
    >
      <Text size="xs">{`${error} Showing the last pull requests loaded.`}</Text>
      <OutlineButton height={24} onClick={onRetry}>
        <Text size="xs" weight={500}>
          Retry
        </Text>
      </OutlineButton>
    </div>
  );
}

function LoadMoreFooter({
  loadingMore,
  updating,
  canLoadMore,
  disabled,
  onLoadMore,
}: {
  loadingMore: boolean;
  updating: boolean;
  canLoadMore: boolean;
  disabled: boolean;
  onLoadMore: () => void;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", paddingTop: 12, paddingBottom: 12 }}>
      {loadingMore ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="loader-circle" size={14} color={theme.mutedForeground} />
          <Text size="xs" color={theme.mutedForeground}>
            {updating ? "Updating pull requests" : "Loading more"}
          </Text>
        </div>
      ) : canLoadMore ? (
        <OutlineButton height={28} disabled={disabled} onClick={onLoadMore} testId="pr-load-more">
          <Text weight={500}>Load more pull requests</Text>
        </OutlineButton>
      ) : (
        <Text size="xs" color={theme.mutedForeground}>
          Narrow your search to find more pull requests.
        </Text>
      )}
    </div>
  );
}

/** PanelLayoutControls' right panel toggle, as the pull requests page configures it. */
export function RightPanelToggle({
  available,
  open,
  onToggle,
}: {
  available: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const button = (
    <div style={{ display: "flex" }}>
      <IconButton
        icon="panel-right"
        pressed={false}
        disabled={!available}
        onClick={onToggle}
        testId="pr-toggle-right-panel"
      />
    </div>
  );
  return (
    <Tooltip content={!available ? "Select a pull request first" : open ? "Close right panel" : "Open right panel"}>
      {button}
    </Tooltip>
  );
}

function RefreshControl({
  compact = false,
  refreshing,
  onRefresh,
}: {
  compact?: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  if (compact) {
    return <IconButton icon="refresh-cw" disabled={refreshing} onClick={onRefresh} testId="pr-refresh-compact" />;
  }
  // Web spins this icon while refreshing; t3-term draws no repainting animations.
  return (
    <OutlineButton square disabled={refreshing} onClick={onRefresh} testId="pr-refresh">
      <Icon name="refresh-cw" size={16} color={theme.mutedForeground} />
    </OutlineButton>
  );
}

function PullRequestsColumn({
  condensed,
  refreshing,
  onRefresh,
  searchValue,
  involvement,
  state,
  host,
  hostMenuOptions,
  onInvolvement,
  onState,
  onHost,
  searchInput,
  sortMenu,
  filtersMenu,
  wideToolbar,
  panelControls,
  maximizedAway,
  listBody,
  onScrollY,
  onViewportHeight,
  onContainerWidth,
}: {
  condensed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  searchValue: string;
  involvement: PullRequestInvolvement;
  state: PullRequestListState;
  host: string | undefined;
  hostMenuOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onInvolvement: (involvement: PullRequestInvolvement) => void;
  onState: (state: PullRequestListState) => void;
  onHost: (host: string | undefined) => void;
  searchInput: ReactNode;
  sortMenu: ReactNode;
  filtersMenu: ReactNode;
  wideToolbar: boolean;
  panelControls: ReactNode;
  maximizedAway: boolean;
  listBody: ReactNode;
  onScrollY: (y: number) => void;
  onViewportHeight: (height: number) => void;
  onContainerWidth: (width: number) => void;
}) {
  const theme = useTheme();
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchExpanded = searchOpen || searchValue.length > 0;
  if (!condensed && searchOpen) setSearchOpen(false);
  const providerMenu = (
    <PullRequestCompactFilterMenu
      label="Filter by provider"
      outlined
      iconOnly={host !== undefined}
      triggerIcon="plug-2"
      triggerLabel="All"
      value={host ?? ""}
      options={hostMenuOptions}
      onChange={(next) => onHost(next === "" ? undefined : next)}
      testId="pr-provider"
    />
  );
  const buttons = (
    <>
      {sortMenu}
      {filtersMenu}
      {providerMenu}
      {condensed ? null : <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    </>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
        backgroundColor: theme.background,
        ...(maximizedAway ? { width: 0, flexGrow: 0, flexShrink: 0 } : { flexGrow: 1, flexBasis: 0 }),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          height: LAYOUT.topbar,
          flexShrink: 0,
          paddingLeft: sidebarOpen ? 20 : 12,
          paddingRight: 12,
        }}
      >
        {sidebarOpen ? null : (
          <IconButton icon="panel-left" onClick={() => setSidebarOpen(true)} testId="pr-open-sidebar" />
        )}
        {condensed ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0, overflow: "hidden" }}>
            {searchExpanded ? null : (
              <>
                <Text weight={500} truncate>
                  Pull Requests
                </Text>
                <Text weight={500} color={alpha(theme.mutedForeground, 0.7)}>
                  /
                </Text>
              </>
            )}
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
              <PullRequestCompactFilterMenu label="Filter by state" value={state} options={STATE_TABS} onChange={onState} testId="pr-condensed-state" />
              <PullRequestCompactFilterMenu
                label="Filter by involvement"
                value={involvement}
                options={INVOLVEMENT_TABS}
                onChange={onInvolvement}
                testId="pr-condensed-involvement"
              />
              {hostMenuOptions.length > 2 ? (
                <PullRequestCompactFilterMenu
                  label="Filter by host"
                  value={host ?? ""}
                  options={hostMenuOptions}
                  onChange={(next) => onHost(next === "" ? undefined : next)}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <Text weight={500} truncate testId="pr-page-title">
            Pull Requests
          </Text>
        )}
        <div style={{ flexGrow: 1, minWidth: 0 }} />
        {condensed ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
            {searchExpanded ? (
              <div style={{ display: "flex", width: 224, minWidth: 96, flexShrink: 1 }}>{searchInput}</div>
            ) : (
              <IconButton icon="search" onClick={() => setSearchOpen(true)} testId="pr-condensed-search" />
            )}
            <RefreshControl compact refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        ) : null}
        {panelControls}
      </div>
      <div
        testId="pr-scroll"
        onScrollChange={(event) => onScrollY(Math.abs(event.scrollY ?? 0))}
        onLayout={(event) => {
          if (event.height) onViewportHeight(event.height);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexGrow: 1,
          minHeight: 0,
          // scrollbar-gutter: stable both-edges reserves the scrollbar's width on each side.
          paddingLeft: 6,
          paddingRight: 6,
          overflowY: "scroll",
          scrollbarColor: theme.scrollbar,
        }}
      >
        <div
          onLayout={(event) => {
            if (event.width) onContainerWidth(event.width);
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            maxWidth: CONTAINER_MAX_WIDTH,
            flexGrow: 1,
            flexShrink: 0,
            gap: CONTAINER_GAP,
            paddingLeft: CONTAINER_PADDING_X,
            paddingRight: CONTAINER_PADDING_X,
            paddingTop: CONTAINER_PADDING_TOP,
            paddingBottom: 48,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: TOOLBAR_GAP, flexShrink: 0, marginBottom: 1 }}>
            {wideToolbar ? (
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: TOOLBAR_GAP }}>
                <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                  {searchInput}
                </div>
                {buttons}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", minWidth: 0 }}>{searchInput}</div>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: TOOLBAR_GAP }}>
                  {buttons}
                </div>
              </>
            )}
          </div>
          {listBody}
        </div>
      </div>
    </div>
  );
}
