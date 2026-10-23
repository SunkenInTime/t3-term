// apps/web/src/lib/archivedThreadsState.ts + state/orchestration.ts wiring.
import { useAtomValue } from "@effect/atom-react";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import {
  type ArchivedSnapshotEntry,
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
} from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId } from "@t3tools/contracts";

import { appAtomRegistry, connectionAtomRuntime } from "../../runtime/runtime.ts";

export const orchestrationEnvironment = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);

function archivedSnapshotAtom(environmentId: EnvironmentId) {
  return orchestrationEnvironment.archivedShellSnapshot({ environmentId, input: {} });
}

const archivedSnapshotsAtom = createArchivedThreadSnapshotsAtomFamily({
  getSnapshotAtom: archivedSnapshotAtom,
  labelPrefix: "t3term:archived-thread-snapshots",
});

export function refreshArchivedThreadsForEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(archivedSnapshotAtom(environmentId));
}

export function useArchivedThreadSnapshots(environmentIds: ReadonlyArray<EnvironmentId>): {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly refresh: () => void;
} {
  const result = useAtomValue(archivedSnapshotsAtom(makeArchivedThreadsEnvironmentKey(environmentIds)));
  const refresh = () => {
    for (const environmentId of environmentIds) appAtomRegistry.refresh(archivedSnapshotAtom(environmentId));
  };
  return { ...result, refresh };
}
