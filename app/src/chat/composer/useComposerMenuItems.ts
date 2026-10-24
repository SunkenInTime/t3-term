// Port of apps/web/src/components/chat/useComposerMenuItems.ts: builds the @, /, $ and #
// suggestion lists and runs the searches each trigger needs.
import { useAtomValue } from "@effect/atom-react";
import { matchComposerThreadItems } from "@t3tools/client-runtime/composerThreadItems";
import {
  getProviderSkillsForSlashMenu,
  getProviderSlashCommandsForSlashMenu,
} from "@t3tools/client-runtime/providerSkills";
import type {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  PullRequestListInput,
  ServerProviderSkill,
  ServerProviderSlashCommand,
  ThreadId,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import {
  composerPullRequestsFromLinks,
  filterComposerPullRequestMatches,
} from "@t3tools/shared/composerPullRequestMatches";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { environmentThreadShells } from "../../state/environment.ts";
import { useComposerPathSearch, useEnvironmentQuery } from "../../state/composerQueries.ts";
import { pullRequestEnvironment, usePullRequestList, type EnvironmentQueryTarget } from "../../state/pullRequests.ts";
import { useDebouncedValue } from "../../palette/hooks.ts";
import {
  matchesPullRequestQuery,
  rankPullRequestMatches,
} from "../../web/components/pullRequest/pullRequestList.logic.ts";
import type { ComposerTrigger } from "../../web/composer-logic.ts";
import type { ComposerCommandItem } from "../../web/components/chat/ComposerCommandMenu.ts";
import {
  searchSlashCommandItems,
  slashCommandItemsForPromptPosition,
} from "../../web/components/chat/composerSlashCommandSearch.ts";
import { basenameOfPath } from "../../web/pierre-icons.ts";
import { searchProviderSkills } from "../../web/providerSkillSearch.ts";

export interface ComposerMenuItemsInput {
  readonly composerTrigger: ComposerTrigger | null;
  readonly environmentId: EnvironmentId;
  readonly gitCwd: string | null;
  readonly activeThreadId: ThreadId | null;
  /** The project and repository # suggests pull requests from; null where PRs are not offered. */
  readonly pullRequestProjectId: ProjectId | null;
  readonly pullRequestRepository: string | null;
  readonly threadPullRequests: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly planModeUiEnabled: boolean;
  readonly compactSlashCommandAvailable: boolean;
  readonly selectedProvider: ProviderDriverKind;
  readonly selectedProviderSkills: ReadonlyArray<ServerProviderSkill>;
  readonly selectedProviderSlashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly showSkillsInSlashMenu: boolean;
}

const EMPTY_THREAD_SHELLS = Atom.make([] as const).pipe(Atom.withLabel("composer:no-thread-shells"));
const COMPOSER_PULL_REQUEST_LIST_LIMIT = 99;
const COMPOSER_PULL_REQUEST_RESULT_LIMIT = 12;
const EMPTY_PULL_REQUEST_LIST_TARGETS: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>> = [];

export function useComposerMenuItems({
  composerTrigger,
  environmentId,
  gitCwd,
  activeThreadId,
  pullRequestProjectId,
  pullRequestRepository,
  threadPullRequests,
  planModeUiEnabled,
  compactSlashCommandAvailable,
  selectedProvider,
  selectedProviderSkills,
  selectedProviderSlashCommands,
  showSkillsInSlashMenu,
}: ComposerMenuItemsInput): {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly isLoading: boolean;
  readonly emptyState: string;
} {
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
  const isPathTrigger = composerTriggerKind === "path";
  // Thread shells only matter while @ is open; reading them otherwise would
  // re-render the composer on every sidebar change.
  const environmentThreadShellList = useAtomValue(
    isPathTrigger ? environmentThreadShells.threadShellsAtom : EMPTY_THREAD_SHELLS,
  );
  const workspaceEntries = useComposerPathSearch({
    environmentId,
    cwd: isPathTrigger ? gitCwd : null,
    query: isPathTrigger ? pathTriggerQuery : null,
  });

  // # pull requests: the project's recent list (searched on the host for text), plus an
  // exact lookup for a number the list does not hold.
  const pullRequestTriggerQuery = composerTrigger?.kind === "pull-request" ? composerTrigger.query : "";
  const pullRequestTextQuery =
    composerTriggerKind === "pull-request" && pullRequestTriggerQuery.length > 0 && !/^\d+$/u.test(pullRequestTriggerQuery)
      ? pullRequestTriggerQuery
      : null;
  const debouncedPullRequestTextQuery = useDebouncedValue(pullRequestTextQuery, 180);
  const settledPullRequestTextQuery = pullRequestTextQuery === debouncedPullRequestTextQuery ? pullRequestTextQuery : null;
  const pullRequestListTargets = useMemo(
    () =>
      composerTriggerKind !== "pull-request" ||
      pullRequestProjectId === null ||
      (pullRequestTextQuery !== null && settledPullRequestTextQuery === null)
        ? EMPTY_PULL_REQUEST_LIST_TARGETS
        : [
            {
              environmentId,
              input: {
                state: "all" as const,
                projectId: pullRequestProjectId,
                limit: COMPOSER_PULL_REQUEST_LIST_LIMIT,
                ...(settledPullRequestTextQuery === null ? {} : { query: settledPullRequestTextQuery }),
              },
            },
          ],
    [composerTriggerKind, pullRequestProjectId, pullRequestTextQuery, settledPullRequestTextQuery, environmentId],
  );
  const pullRequestLookup = usePullRequestList(pullRequestListTargets);
  const pullRequestTriggerNumber = (() => {
    if (composerTrigger?.kind !== "pull-request" || composerTrigger.query.length === 0) return null;
    const number = Number(composerTrigger.query);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  })();
  const debouncedPullRequestNumber = useDebouncedValue(pullRequestTriggerNumber, 180);
  const settledPullRequestNumber = pullRequestTriggerNumber === debouncedPullRequestNumber ? pullRequestTriggerNumber : null;
  const recentHasExactPullRequest =
    settledPullRequestNumber !== null &&
    pullRequestLookup.data?.entries.some(
      (entry) =>
        entry.projectId === pullRequestProjectId &&
        entry.repository.trim().toLowerCase() === pullRequestRepository?.trim().toLowerCase() &&
        entry.number === settledPullRequestNumber,
    ) === true;
  const exactPullRequestLookup = useEnvironmentQuery(
    settledPullRequestNumber === null || pullRequestProjectId === null || pullRequestRepository === null || recentHasExactPullRequest
      ? null
      : pullRequestEnvironment.detail({
          environmentId,
          input: { projectId: pullRequestProjectId, repository: pullRequestRepository, number: settledPullRequestNumber },
        }),
  );
  const linkedPullRequests =
    pullRequestProjectId === null ? [] : composerPullRequestsFromLinks(threadPullRequests ?? [], pullRequestProjectId);

  const items = ((): ComposerCommandItem[] => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path") {
      return [
        ...matchComposerThreadItems({
          shells: environmentThreadShellList,
          environmentId,
          excludeThreadId: activeThreadId,
          query: composerTrigger.query,
        }),
        ...workspaceEntries.entries.map((entry) => ({
          id: `path:${entry.kind}:${entry.path}`,
          type: "path" as const,
          path: entry.path,
          pathKind: entry.kind,
          searchTarget: workspaceEntries.searchedTarget,
          label: basenameOfPath(entry.path),
          description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
        })),
      ];
    }
    if (composerTrigger.kind === "slash-command") {
      const builtInSlashCommandItems = [
        {
          id: "slash:model",
          type: "slash-command",
          command: "model",
          label: "/model",
          description: "Switch response model for this thread",
        },
        ...(planModeUiEnabled
          ? ([
              {
                id: "slash:plan",
                type: "slash-command",
                command: "plan",
                label: "/plan",
                description: "Switch this thread into plan mode",
              },
              {
                id: "slash:default",
                type: "slash-command",
                command: "default",
                label: "/default",
                description: "Switch this thread back to normal build mode",
              },
            ] as const)
          : []),
      ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
      const slashMenuSkills = getProviderSkillsForSlashMenu(
        selectedProviderSkills,
        showSkillsInSlashMenu,
      );
      const providerSlashCommandItems = getProviderSlashCommandsForSlashMenu(
        selectedProviderSlashCommands,
        slashMenuSkills,
      ).map((command) => ({
        id: `provider-slash-command:${selectedProvider}:${command.name}`,
        type: "provider-slash-command" as const,
        provider: selectedProvider,
        command,
        label: `/${command.name}`,
        description: command.description ?? command.input?.hint ?? "Run provider command",
      }));
      const query = composerTrigger.query.trim().toLowerCase();
      const skillItems = slashMenuSkills.map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: `/skill:${skill.name}`,
        description:
          skill.shortDescription ?? skill.description ?? (skill.scope ? `${skill.scope} skill` : ""),
      }));
      const visibleProviderSlashCommandItems = providerSlashCommandItems.filter(
        (item) => item.command.name !== "compact" || compactSlashCommandAvailable,
      );
      const slashCommandItems = slashCommandItemsForPromptPosition(
        [...builtInSlashCommandItems, ...visibleProviderSlashCommandItems, ...skillItems],
        composerTrigger.rangeStart === 0,
      );
      return searchSlashCommandItems(slashCommandItems, query);
    }
    if (composerTrigger.kind === "skill") {
      return searchProviderSkills(selectedProviderSkills, composerTrigger.query).map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: formatProviderSkillDisplayName(skill),
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
      }));
    }
    if (composerTrigger.kind === "pull-request" && pullRequestProjectId !== null && pullRequestRepository !== null) {
      const exactData = exactPullRequestLookup.data as (typeof pullRequestLookup.data extends { entries: ReadonlyArray<infer E> } | null ? E : never) | null;
      const exactPullRequest = exactData?.number === pullRequestTriggerNumber && exactData ? [exactData] : [];
      const matches = /^\d*$/u.test(composerTrigger.query)
        ? filterComposerPullRequestMatches({
            entries: [...exactPullRequest, ...(pullRequestLookup.data?.entries ?? [])],
            linked: linkedPullRequests,
            projectId: pullRequestProjectId,
            repository: pullRequestRepository,
            query: composerTrigger.query,
            limit: COMPOSER_PULL_REQUEST_RESULT_LIMIT,
          })
        : rankPullRequestMatches(
            (pullRequestLookup.data?.entries ?? []).filter((entry) => {
              if (
                entry.projectId !== pullRequestProjectId ||
                entry.repository.trim().toLowerCase() !== pullRequestRepository.trim().toLowerCase()
              ) {
                return false;
              }
              const provider = pullRequestLookup.data?.providers.find((candidate) => candidate.host === entry.host);
              return provider?.searchesOnHost === true || matchesPullRequestQuery(entry, composerTrigger.query);
            }),
            composerTrigger.query,
          ).slice(0, COMPOSER_PULL_REQUEST_RESULT_LIMIT);
      return matches.map((pullRequest) => ({
        id: `pull-request:${pullRequest.projectId}:${pullRequest.repository}:${pullRequest.number}`,
        type: "pull-request" as const,
        pullRequest: {
          number: pullRequest.number,
          title: pullRequest.title,
          url: pullRequest.url,
          headBranch: pullRequest.headBranch,
          baseBranch: pullRequest.baseBranch,
          state: pullRequest.state,
          isDraft: pullRequest.isDraft,
        },
        label: `#${pullRequest.number}`,
        description:
          pullRequest.repository.trim().toLowerCase() === pullRequestRepository.trim().toLowerCase()
            ? pullRequest.title
            : `${pullRequest.repository} · ${pullRequest.title}`,
      }));
    }
    return [];
  })();
  const isLoading =
    (composerTriggerKind === "path" && pathTriggerQuery.length > 0 && workspaceEntries.isPending) ||
    (composerTriggerKind === "pull-request" &&
      pullRequestProjectId !== null &&
      pullRequestRepository !== null &&
      (pullRequestLookup.isPending ||
        pullRequestTextQuery !== debouncedPullRequestTextQuery ||
        pullRequestTriggerNumber !== debouncedPullRequestNumber ||
        exactPullRequestLookup.isPending));
  const emptyState = (() => {
    if (composerTriggerKind === "skill") {
      return "No skills found. Try / to browse provider commands.";
    }
    if (composerTriggerKind === "pull-request") {
      if (pullRequestProjectId === null || pullRequestRepository === null) {
        return "Pull requests are not available for this project.";
      }
      if (
        pullRequestLookup.error !== null ||
        pullRequestLookup.data?.errors.some((error) => error.projectId === pullRequestProjectId)
      ) {
        return "Pull requests could not be read for this project.";
      }
      return composerTrigger?.query
        ? `No pull request matches ${composerTrigger.query}.`
        : "No pull requests found in this repository.";
    }
    return composerTriggerKind === "path" ? "No matching files or folders." : "No matching command.";
  })();

  return { items, isLoading, emptyState };
}
