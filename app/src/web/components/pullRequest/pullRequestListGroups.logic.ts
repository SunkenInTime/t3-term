// Ported from apps/web/src/components/pullRequest/pullRequestListGroups.logic.ts
import type {
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListResult,
} from "@t3tools/contracts";

import {
  filterPullRequestsByInvolvement,
  groupPullRequestsByInvolvement,
  matchesPullRequestFilters,
  matchesPullRequestQuery,
  partitionPullRequestsWithPriority,
  pullRequestEntryKey,
  pullRequestEntryViewer,
  type EnvironmentPullRequestEntry,
  type PullRequestPartitionsSnapshot,
} from "./pullRequestList.logic";

// From apps/web/src/components/RightPanelTabs.tsx and apps/web/src/rightPanelStore.ts, which
// t3-term has no port of; only these two pieces are needed here.
export interface PullRequestTabStatusSeed {
  readonly state: EnvironmentPullRequestEntry["state"];
  readonly isDraft: boolean;
}

export function pullRequestSurfaceId(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
}): `pull-request:${string}` {
  const scope =
    target.environmentId === undefined ? "" : `${encodeURIComponent(target.environmentId)}:`;
  const host = target.host === undefined ? "" : `${encodeURIComponent(target.host.toLowerCase())}:`;
  return `pull-request:${scope}${encodeURIComponent(target.projectId)}:${host}${encodeURIComponent(target.repository)}:${target.number}`;
}

export const pullRequestListEntryId = (target: Parameters<typeof pullRequestSurfaceId>[0]) =>
  pullRequestSurfaceId({ ...target, repository: target.repository.toLowerCase() });

/** The held rows narrowed to what the reader asked for, in the groups the list shows. */
export function pullRequestGroups({
  known,
  providers,
  viewers,
  involvement,
  localFilters,
  hasLocalFilters,
  text,
  answeredLocally,
  baselineEmpty,
  held,
  authored,
  reviewing,
  partitionsWanted,
}: {
  known: ReadonlyArray<EnvironmentPullRequestEntry>;
  providers: PullRequestListResult["providers"];
  viewers: PullRequestListResult["viewers"];
  involvement: PullRequestInvolvement;
  localFilters: PullRequestListFilters;
  hasLocalFilters: boolean;
  text: string;
  answeredLocally: boolean;
  baselineEmpty: boolean;
  held: PullRequestPartitionsSnapshot | undefined;
  authored: ReadonlyArray<EnvironmentPullRequestEntry> | undefined;
  reviewing: ReadonlyArray<EnvironmentPullRequestEntry> | undefined;
  partitionsWanted: boolean;
}) {
  const searchingHosts = new Set(
    providers.flatMap((provider) => (provider.searchesOnHost ? [provider.host] : [])),
  );

  const entries = (() => {
    const involvementEntries = filterPullRequestsByInvolvement(known, viewers, involvement);
    // The hosts search more than the row shows — a body, a review, a commit message — so once
    // their answer is in, narrowing it again here would throw away matches the reader asked for.
    // The local pass stands in for the answer that has not arrived yet, and for the hosts that
    // answered without searching at all: Azure DevOps has no text filter, so its rows arrive
    // whole and would otherwise sit under a search that never touched them.
    const narrowedEntries = hasLocalFilters
      ? involvementEntries.filter((entry) =>
          matchesPullRequestFilters(entry, localFilters, pullRequestEntryViewer(entry, viewers)),
        )
      : involvementEntries;
    if (text.length === 0) {
      return narrowedEntries.toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    }
    return narrowedEntries.filter(
      (entry) =>
        (answeredLocally && searchingHosts.has(entry.host)) || matchesPullRequestQuery(entry, text),
    );
  })();

  const listedPullRequestTabStatuses: Record<string, PullRequestTabStatusSeed> = Object.fromEntries(
    entries.map((entry) => [
      pullRequestSurfaceId(entry),
      {
        state: entry.state,
        isDraft: entry.isDraft,
      },
    ]),
  );

  const groups = (() => {
    if (involvement !== "all") return [{ key: "others" as const, label: "", entries }];
    if (baselineEmpty) {
      return groupPullRequestsByInvolvement(entries, viewers);
    }
    const narrow = (rows: ReadonlyArray<EnvironmentPullRequestEntry> | undefined) =>
      rows === undefined || !hasLocalFilters
        ? rows
        : rows.filter((entry) =>
            matchesPullRequestFilters(entry, localFilters, pullRequestEntryViewer(entry, viewers)),
          );
    const narrowedAuthored = narrow(partitionsWanted ? (authored ?? held?.authored) : undefined);
    const narrowedReviewing = narrow(partitionsWanted ? (reviewing ?? held?.reviewing) : undefined);
    if (narrowedAuthored === undefined || narrowedReviewing === undefined) {
      return groupPullRequestsByInvolvement(entries, viewers);
    }
    return partitionPullRequestsWithPriority(entries, narrowedAuthored, narrowedReviewing);
  })();

  const entriesByStatsKey: ReadonlyMap<string, EnvironmentPullRequestEntry> = new Map(
    groups.flatMap((group) =>
      group.entries.map((entry) => [pullRequestEntryKey(entry), entry] as const),
    ),
  );
  const heldPullRequestsBySurface = new Map(
    groups.flatMap((group) =>
      group.entries.map((entry) => [pullRequestListEntryId(entry), entry] as const),
    ),
  );
  return {
    entries,
    listedPullRequestTabStatuses,
    groups,
    entriesByStatsKey,
    heldPullRequestsBySurface,
  };
}
