// The sidebar's PR badge, from apps/web/src/components/ThreadStatusIndicators.tsx
// (resolveThreadPullRequestBadgePresentation, linkedPullRequestSnapshotStatus)
// and pullRequest/pullRequestIcons.tsx. Status comes from the link snapshots the
// thread shell carries; references without a snapshot show the number muted.
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  resolveThreadCurrentPullRequestLink,
  resolveThreadPullRequestBadge,
} from "@t3tools/shared/threadPullRequests";

import type { IconName } from "../ui/Icon.tsx";

type PullRequestStateKey = "open" | "draft" | "closed" | "merged";

/** PULL_REQUEST_STATE_PRESENTATION, dark tones (Tailwind v4 `-300/90`, zinc `-400/80`). */
export const PULL_REQUEST_STATE_PRESENTATION: Record<
  PullRequestStateKey,
  { readonly label: string; readonly color: string; readonly icon: IconName }
> = {
  open: { label: "Open", color: "#5ee9b5e6", icon: "git-pull-request-arrow" },
  draft: { label: "Draft", color: "#9f9fa9cc", icon: "git-pull-request-draft" },
  closed: { label: "Closed", color: "#ffa2a2e6", icon: "git-pull-request-closed" },
  merged: { label: "Merged", color: "#c4b4ffe6", icon: "git-merge" },
};

export interface PullRequestBadgePresentation {
  readonly icon: IconName;
  readonly color: string | null;
  readonly label: string;
  readonly text: string;
  readonly url: string | null;
  /** Stacks and multi-PR threads open the linked-PR list instead of one PR. */
  readonly opensList: boolean;
}

export function resolvePullRequestBadge(
  thread: Pick<EnvironmentThreadShell, "pullRequests" | "linkedPullRequest" | "branchPullRequest">,
  supportsMultiplePullRequests: boolean,
): PullRequestBadgePresentation | null {
  const badge = supportsMultiplePullRequests
    ? resolveThreadPullRequestBadge(thread.pullRequests)
    : null;
  if (badge?.kind === "stack") {
    const aggregate = PULL_REQUEST_STATE_PRESENTATION[badge.state];
    return {
      icon: "layers",
      color: aggregate.color,
      label: `Stack of ${badge.layers} pull requests, ${aggregate.label.toLowerCase()}`,
      text: String(badge.layers),
      url: null,
      opensList: true,
    };
  }
  const current = supportsMultiplePullRequests
    ? resolveThreadCurrentPullRequestLink(thread.pullRequests)
    : null;
  const snapshot = current?.snapshot ?? null;
  const stored = current ?? thread.linkedPullRequest ?? thread.branchPullRequest ?? null;
  if (stored === null) return null;
  const stateKey: PullRequestStateKey | null =
    snapshot === null
      ? null
      : snapshot.state === "open" && snapshot.isDraft
        ? "draft"
        : snapshot.state;
  const state = stateKey === null ? null : PULL_REQUEST_STATE_PRESENTATION[stateKey];
  const tooltip =
    state && snapshot
      ? `PR #${stored.number} - ${state.label}: ${snapshot.title}`
      : `PR #${stored.number}, status pending`;
  if (badge?.kind === "pull-request" && badge.others > 0) {
    const aggregate = PULL_REQUEST_STATE_PRESENTATION[badge.state];
    return {
      icon: aggregate.icon,
      color: aggregate.color,
      label: `${tooltip}, and ${badge.others} more linked; overall ${aggregate.label.toLowerCase()}`,
      text: `+${badge.others + 1}`,
      url: stored.url,
      opensList: true,
    };
  }
  return {
    icon: state?.icon ?? "git-pull-request-arrow",
    color: state?.color ?? null,
    label: tooltip,
    text: String(stored.number),
    url: stored.url,
    opensList: false,
  };
}
