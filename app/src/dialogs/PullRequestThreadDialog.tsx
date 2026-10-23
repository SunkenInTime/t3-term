// OWNER: palette/navigation agent. Port of apps/web/src/components/PullRequestThreadDialog.tsx.
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

export interface PullRequestThreadDialogRequest {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string | null;
  readonly initialReference?: string | null;
}

export function openPullRequestThreadDialog(_request: PullRequestThreadDialogRequest): void {}

export function PullRequestThreadDialogHost() {
  return null;
}
