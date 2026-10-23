// OWNER: palette/navigation agent. Port of apps/web/src/components/AddProjectToMachineDialog.tsx.
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";

export function openAddProjectToMachine(_request: {
  readonly projectRef: ScopedProjectRef;
  readonly targetEnvironmentId: EnvironmentId | null;
}): void {}

export function AddProjectToMachineDialogHost() {
  return null;
}
