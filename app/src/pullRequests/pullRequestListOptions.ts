// Port of apps/web/src/components/pullRequest/pullRequestListOptions.ts and the option lists in
// PullRequestListFilters.tsx, with lucide components swapped for t3-term icon names.
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListState,
} from "@t3tools/contracts";

import type { IconName } from "../ui/Icon.tsx";
import type { PullRequestListSort } from "../web/components/pullRequest/pullRequestListPreferences.ts";
import { PullRequestGlyph } from "./pullRequestPresentation.tsx";

export interface PullRequestFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly icon: IconName;
  /** Source control kind, drawn with its own mark instead of `icon`. */
  readonly sourceControlKind?: string;
  readonly project?: OrchestrationProjectShell & { readonly environmentId: EnvironmentId };
  readonly unavailable?: string | undefined;
}

export const INVOLVEMENT_TABS = [
  { value: "all", label: "All", icon: "layers" },
  { value: "reviewing", label: "Reviewing", icon: "eye" },
  { value: "authored", label: "Authored", icon: "pen-line" },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;

export const STATE_TABS = [
  { value: "all", label: "All", icon: "layers" },
  { value: "open", label: "Open", icon: PullRequestGlyph.pullRequest },
  { value: "closed", label: "Closed", icon: PullRequestGlyph.closed },
  { value: "merged", label: "Merged", icon: PullRequestGlyph.merged },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;

export const SORT_OPTIONS = [
  { value: "ready", label: "Merge readiness", icon: "list-checks" },
  { value: "blocked", label: "Blocked on me", icon: "user-lock" },
  { value: "updated", label: "Recently updated", icon: "clock" },
  { value: "newest", label: "Newest shown", icon: "calendar-arrow-down" },
  { value: "oldest", label: "Oldest shown", icon: "calendar-arrow-up" },
  { value: "largest", label: "Largest shown", icon: "maximize-2" },
  { value: "smallest", label: "Smallest shown", icon: "minimize-2" },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestListSort>>;

export const UNFILTERED_VALUE = "all";
export const ALL_PROJECTS_VALUE = "all";
/** A radio group wants a string, so "every host" wears the one value no host can be. */
export const ALL_HOSTS_VALUE = "";
export const ALL_SERVERS_VALUE = "";

export const DRAFT_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", icon: "layers" },
  { value: "only", label: "Drafts only", icon: PullRequestGlyph.draft },
  { value: "hide", label: "Hide drafts", icon: "eye-off" },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

export const REVIEW_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", icon: "layers" },
  { value: "approved", label: "Approved", icon: "circle-check" },
  { value: "changes-requested", label: "Changes requested", icon: "circle-x" },
  { value: "review-required", label: "Review required", icon: "circle-dashed" },
  { value: "none", label: "No reviews", icon: "circle-slash" },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

export const CHECKS_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", icon: "layers" },
  { value: "passing", label: "Passing", icon: "circle-check" },
  { value: "failing", label: "Failing", icon: "circle-x" },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

/**
 * A project's own radio value, carrying the server along with the id: the id alone is only
 * unique within its own server.
 */
export const pullRequestProjectKey = (project: {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
}) => JSON.stringify([project.environmentId, project.id]);
