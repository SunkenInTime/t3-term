// Which pull request a thread shows, derived the way web's BranchToolbarBranchSelector,
// useLinkedThreadPullRequest (ThreadStatusIndicators.tsx) and ThreadDetailsPrRow resolve it:
// the thread's current linked PR, else a legacy linked PR, else the branch PR git reports.
import { useAtomValue } from "@effect/atom-react";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { pullRequestDetailToVcsStatus } from "@t3tools/client-runtime/state/pull-requests";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  PullRequestRef,
  ThreadId,
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
  VcsStatusResult,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/shared/threadPullRequests";

import { environmentThreadShells, projectIndexAtom, serverEnvironment } from "../../state/environment.ts";
import { vcsEnvironment } from "../../state/git.ts";
import { linkedPullRequestDetailAtom } from "../../state/gitPullRequests.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";

export type ThreadPr = VcsStatusResult["pr"];

export interface LinkedThreadPullRequestStatus {
  readonly pr: NonNullable<ThreadPr>;
  readonly sourceControlProvider: NonNullable<VcsStatusResult["sourceControlProvider"]>;
}

export function linkedPullRequestSnapshotStatus(
  link: ThreadPullRequestLink,
): LinkedThreadPullRequestStatus | null {
  const snapshot = link.snapshot;
  if (snapshot === null) return null;
  const kind = (
    sourceControlClients.findByChangeRequestUrl(link.url) ?? sourceControlClients.get(undefined)
  ).kind;
  return {
    pr: {
      number: link.number,
      url: link.url,
      title: snapshot.title,
      state: snapshot.state,
      isDraft: snapshot.isDraft,
      headRef: snapshot.headBranch,
      baseRef: snapshot.baseBranch,
      ...(snapshot.updatedAt === null ? {} : { updatedAt: snapshot.updatedAt }),
    },
    sourceControlProvider: { kind, name: kind, baseUrl: "" },
  };
}

function linkedPullRequestReference(fallback: ThreadLinkedPullRequest) {
  const host = parseChangeRequestUrl(fallback.url)?.host;
  return { ...fallback, ...(host === undefined ? {} : { host }) };
}

export function useThreadShell(environmentId: EnvironmentId, threadId: ThreadId): EnvironmentThreadShell | null {
  return (
    useAtomValue(environmentThreadShells.threadShellAtom({ environmentId, threadId } as never)) ?? null
  ) as EnvironmentThreadShell | null;
}

export function useServerCapabilities(environmentId: EnvironmentId) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const capabilities = config?.environment.capabilities;
  return {
    known: config !== null && config !== undefined,
    pullRequests: capabilities?.pullRequests === true,
    pullRequestChecks: capabilities?.pullRequestChecks === true,
    threadPullRequests: capabilities?.threadPullRequests === true,
  };
}

/** A thread link (or the branch PR) as a PullRequestRef for the detail reads. */
export function pullRequestReferenceFor(
  project: OrchestrationProjectShell | null,
  number: number,
  link: Pick<PullRequestRef, "host" | "repository" | "number"> | null,
): PullRequestRef | null {
  if (project === null) return null;
  if (link) {
    return {
      projectId: project.id,
      repository: link.repository,
      number: link.number,
      ...(link.host ? { host: link.host } : {}),
    };
  }
  const repository = sourceControlRepositorySelector(project.repositoryIdentity);
  return repository === null ? null : { projectId: project.id, repository, number };
}

export function useThreadPullRequest(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly gitCwd: string | null;
}) {
  const { environmentId, threadId, gitCwd } = input;
  const shell = useThreadShell(environmentId, threadId);
  const projects = useAtomValue(projectIndexAtom);
  const project = shell ? (projects.get(`${environmentId}:${shell.projectId}`) ?? null) : null;
  const capabilities = useServerCapabilities(environmentId);
  const statusQuery = useEnvironmentQuery(
    gitCwd === null ? null : vcsEnvironment.status({ environmentId, input: { cwd: gitCwd } }),
  );
  const status = statusQuery.data;

  const links = shell?.pullRequests ?? [];
  const supportsLinks = capabilities.threadPullRequests;
  const currentLink = supportsLinks ? resolveThreadCurrentPullRequestLink(links) : null;
  const currentStatus = currentLink === null ? null : linkedPullRequestSnapshotStatus(currentLink);
  const fallback =
    currentLink === null
      ? ((!supportsLinks ? shell?.linkedPullRequest : null) ?? shell?.branchPullRequest ?? null)
      : null;
  const linkedQuery = useEnvironmentQuery(
    fallback === null
      ? null
      : linkedPullRequestDetailAtom({ environmentId, input: linkedPullRequestReference(fallback) }),
  );
  const linkedStatus: LinkedThreadPullRequestStatus | null =
    currentLink !== null
      ? currentStatus
      : linkedQuery.data === null
        ? null
        : {
            pr: pullRequestDetailToVcsStatus(linkedQuery.data),
            sourceControlProvider: {
              kind: linkedQuery.data.provider,
              name: linkedQuery.data.provider,
              baseUrl: "",
            },
          };

  // resolveBranchToolbarValue / resolveBranchToolbarPrBranch for a server thread.
  const threadBranch = shell?.branch ?? null;
  const resolvedActiveBranch = status?.refName ?? threadBranch;
  const branchPrBranch = threadBranch === resolvedActiveBranch ? threadBranch : null;
  const branchPr: ThreadPr =
    branchPrBranch !== null && status?.refName === branchPrBranch ? (status.pr ?? null) : null;

  const displayedPr: ThreadPr = linkedStatus?.pr ?? (currentLink === null ? branchPr : null);
  const provider = linkedStatus?.sourceControlProvider ?? status?.sourceControlProvider ?? null;
  const number = currentLink?.number ?? displayedPr?.number;
  const url = currentLink?.url ?? displayedPr?.url;
  const reference =
    number === undefined || !capabilities.pullRequests
      ? null
      : pullRequestReferenceFor(project, number, currentLink);

  return {
    shell,
    project,
    capabilities,
    links,
    currentLink,
    displayedPr,
    provider,
    number,
    url,
    reference,
    refreshStatus: statusQuery.refresh,
  };
}
