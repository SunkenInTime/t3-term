// Port of apps/web/src/hooks/usePullRequestLinking.ts. Commands run through
// runAtomCommand on the app registry instead of web's useAtomCommand.
import { useAtomValue } from "@effect/atom-react";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";
import type {
  EnvironmentId,
  ScopedThreadRef,
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  planThreadPullRequestMutation,
  type threadPullRequestLinkMode,
} from "@t3tools/client-runtime/thread-pull-request-compatibility";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { pullRequestLinkModeAtom } from "../state/dialogs.ts";
import {
  environmentProjects,
  environmentServerConfigsAtom,
  threadEnvironment,
} from "../state/environment.ts";
import {
  findProjectForChangeRequest,
  matchesLinkedPullRequestUrl,
  parseChangeRequestUrl,
  type ChangeRequestLink,
} from "../web/lib/openPullRequestLink.ts";

export function canLinkChangeRequest(
  mode: ReturnType<typeof threadPullRequestLinkMode>,
  projects: ReadonlyArray<EnvironmentProject>,
  parsed: ChangeRequestLink,
): boolean {
  if (mode === "unsupported") return false;
  if (mode === "multiple") return true;
  return findProjectForChangeRequest(projects, parsed) !== undefined;
}

export function usePullRequestLinking(environmentId: EnvironmentId | null | undefined) {
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const mode = useAtomValue(pullRequestLinkModeAtom(environmentId ?? null));
  const environmentProjectList = projects.filter((project) => project.environmentId === environmentId);
  const canLink = (url: string) => {
    const parsed = parseChangeRequestUrl(url);
    return parsed !== null && canLinkChangeRequest(mode, environmentProjectList, parsed);
  };
  const isLinked = (
    thread: {
      readonly pullRequests?: readonly ThreadPullRequestLink[];
      readonly linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
    } | null,
    url: string,
  ) => {
    if (thread === null || mode === "unsupported") return false;
    if (mode !== "multiple")
      return (
        thread.linkedPullRequest != null &&
        matchesLinkedPullRequestUrl(thread.linkedPullRequest, url)
      );
    const parsed = parseChangeRequestUrl(url);
    return (
      parsed !== null &&
      visibleThreadPullRequests(thread.pullRequests ?? []).some((entry) =>
        threadPullRequestKeysEqual(entry, parsed),
      )
    );
  };
  const changeLink = async (threadRef: ScopedThreadRef, url: string, linked: boolean) => {
    const parsed = parseChangeRequestUrl(url);
    if (parsed === null || threadRef.environmentId !== environmentId || (linked && !canLink(url)))
      throw new Error("The pull request is not available in this environment.");
    const legacyProject = findProjectForChangeRequest(environmentProjectList, parsed);
    const mutation = planThreadPullRequestMutation({
      capabilities: appAtomRegistry.get(environmentServerConfigsAtom).get(threadRef.environmentId)
        ?.environment.capabilities,
      threadId: threadRef.threadId,
      reference: { ...parsed, url },
      legacyProjectId: legacyProject?.id ?? null,
      legacyRepository:
        sourceControlRepositorySelector(legacyProject?.repositoryIdentity) ?? undefined,
      linked,
    });
    if (mutation === null)
      throw new Error("This environment does not support linking this pull request.");
    const options = { reportFailure: false } as const;
    const result = await (mutation.type === "thread.meta.update"
      ? runAtomCommand(
          appAtomRegistry,
          threadEnvironment.updateMetadata,
          { environmentId: threadRef.environmentId, input: mutation.input },
          options,
        )
      : mutation.type === "thread.pull-request.link"
        ? runAtomCommand(
            appAtomRegistry,
            threadEnvironment.linkPullRequest,
            { environmentId: threadRef.environmentId, input: mutation.input },
            options,
          )
        : runAtomCommand(
            appAtomRegistry,
            threadEnvironment.unlinkPullRequest,
            { environmentId: threadRef.environmentId, input: mutation.input },
            options,
          ));
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) throw new Error("Link update interrupted.");
      throw squashAtomCommandFailure(result);
    }
  };
  return { mode, canLink, isLinked, changeLink };
}
