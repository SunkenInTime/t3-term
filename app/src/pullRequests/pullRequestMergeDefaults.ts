// web usePullRequestActions.ts `usePullRequestDefaultMergeMethodResolver`, read on demand: the
// project's configured merge method from the environment's settings. Small surfaces (a thread's
// PR row, a list row's quick merge) resolve it on the click, not for every visible row.
//
// Not ported: web's fallback to the legacy client-side `pullRequestMergeMethodOverrides`, which
// only web clients migrated from older builds carry; t3-term's settings never had them.
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import type { EnvironmentId, PullRequestMergeMethod } from "@t3tools/contracts";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { lastPullRequestMergeMethodAtom, pullRequestEnvironmentsAtom } from "../state/pullRequests.ts";
import { resolvePullRequestMergeMethod } from "../web/components/pullRequest/pullRequestDetail.logic.ts";

export function resolveProjectDefaultMergeMethod(
  environmentId: EnvironmentId,
  projectId: Parameters<typeof resolveProjectSettings>[1],
): PullRequestMergeMethod | undefined {
  const serverConfig =
    appAtomRegistry.get(pullRequestEnvironmentsAtom).find((environment) => environment.environmentId === environmentId)
      ?.serverConfig ?? null;
  if (serverConfig === null) return undefined;
  return resolveProjectSettings(serverConfig.settings, projectId).settings.pullRequestMergeMethod ?? undefined;
}

/** The method a merge without an explicit choice uses: project default, then the last one picked. */
export function resolveDefaultPullRequestMergeMethodFor(
  environmentId: EnvironmentId,
  projectId: Parameters<typeof resolveProjectSettings>[1],
  allowed: ReadonlyArray<PullRequestMergeMethod>,
): PullRequestMergeMethod {
  return resolvePullRequestMergeMethod(
    allowed,
    null,
    resolveProjectDefaultMergeMethod(environmentId, projectId),
    appAtomRegistry.get(lastPullRequestMergeMethodAtom) ?? "merge",
  );
}
