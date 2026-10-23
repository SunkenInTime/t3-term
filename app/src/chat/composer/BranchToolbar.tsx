// OWNER: composer agent (context strip sub-task). STUB: replace with the port of
// apps/web/src/components/BranchToolbar.tsx (composer context strip layout) +
// BranchToolbarEnvModeSelector / BranchToolbarEnvironmentSelector / BranchToolbarBranchSelector.
// Composer.tsx renders it under the composer surface for new-thread drafts. Workspace
// choices are stored on the draft with `setDraftWorkspace(draftKey, ...)` (state/composer.ts).
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

export interface BranchToolbarProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly draftKey: string;
  readonly onComposerFocusRequest: () => void;
}

export function BranchToolbar(_props: BranchToolbarProps) {
  return null;
}
