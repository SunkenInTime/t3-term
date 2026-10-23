// Partial port of apps/web/src/lib/openPullRequestLink.ts: the pure project
// lookup the pull request link dialog needs. The navigation hooks in that file
// depend on the web router and stay there.
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ChangeRequestLink } from "@t3tools/shared/changeRequestUrl";

export {
  parseChangeRequestUrl,
  type ChangeRequestLink,
  matchesLinkedPullRequestUrl,
} from "@t3tools/shared/changeRequestUrl";

export function findProjectForChangeRequest(
  projects: ReadonlyArray<EnvironmentProject>,
  link: ChangeRequestLink,
): EnvironmentProject | undefined {
  return projects.find((project) => {
    const identity = project.repositoryIdentity;
    return (
      identity?.provider !== undefined &&
      sourceControlClients.get(identity.provider).isChangeRequestInRepository(identity, link)
    );
  });
}
