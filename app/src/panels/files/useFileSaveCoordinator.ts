// Port of apps/web/src/components/files/useFileSaveCoordinator.ts: the Files editor's
// debounced autosave. Each edit goes to the optimistic file atom at once; the
// coordinator writes the latest contents through the server's projects.writeFile
// 500 ms after typing stops, one write per file at a time.
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AuthFilesystemWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { createRef, useEffect, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { projectEnvironment } from "../../state/environment.ts";
import { FileSaveCoordinator } from "../../web/components/files/fileSaveCoordinator.ts";
import {
  confirmProjectFileQueryData,
  getUnsavedProjectFileQueryData,
} from "../../web/components/files/projectFilesQueryState.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../../web/state/session.ts";

const FILE_SAVE_DEBOUNCE_MS = 500;

interface FileSaveOptions {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

export function useFileSaveCoordinator({
  environmentId,
  cwd,
  relativePath,
  onPendingChange,
}: FileSaveOptions): Pick<FileSaveCoordinator, "change"> {
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  // A session owns the pending debounce, so it must outlive rerenders and be
  // replaced only when what it writes to changes.
  const inputs = { environmentId, cwd, relativePath, onPendingChange };
  const [current, setCurrent] = useState(() => ({ inputs, session: createFileSaveSession(inputs) }));
  if (
    current.inputs.environmentId !== environmentId ||
    current.inputs.cwd !== cwd ||
    current.inputs.relativePath !== relativePath ||
    current.inputs.onPendingChange !== onPendingChange
  ) {
    setCurrent({ inputs, session: createFileSaveSession(inputs) });
  }
  const session = current.session;

  useEffect(session.setup, [session]);
  useEffect(() => {
    if (!canWriteFiles) return;
    let cancelled = false;
    // Contents left unsaved by an earlier session (a closed preview, a lost write scope) flush now.
    queueMicrotask(() => {
      if (cancelled) return;
      const unsaved = getUnsavedProjectFileQueryData(environmentId, cwd, relativePath);
      if (unsaved) session.change(unsaved.contents);
    });
    return () => {
      cancelled = true;
    };
  }, [canWriteFiles, cwd, environmentId, relativePath, session]);
  return session;
}

function createFileSaveSession({ environmentId, cwd, relativePath, onPendingChange }: FileSaveOptions) {
  const coordinatorRef = createRef<FileSaveCoordinator>();
  return {
    change: (contents: string) => coordinatorRef.current?.change(contents),
    setup: () => {
      const coordinator = new FileSaveCoordinator({
        debounceMs: FILE_SAVE_DEBOUNCE_MS,
        canPersist: () => readEnvironmentScope(environmentId, AuthFilesystemWriteScope),
        onPendingChange: (pending) => onPendingChange(relativePath, pending),
        persist: (nextContents) =>
          runAtomCommand(appAtomRegistry, projectEnvironment.writeFile, {
            environmentId,
            input: { cwd, relativePath, contents: nextContents },
          } as never),
        onConfirmed: (confirmedContents) =>
          confirmProjectFileQueryData(environmentId, cwd, relativePath, confirmedContents),
      });
      (coordinatorRef as { current: FileSaveCoordinator | null }).current = coordinator;
      return () => {
        (coordinatorRef as { current: FileSaveCoordinator | null }).current = null;
        coordinator.dispose();
      };
    },
  };
}
