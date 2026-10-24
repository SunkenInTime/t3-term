// apps/web/src/components/ProjectCloneToastCoordinator.tsx: one toast per
// project clone, updated in place as it runs, finishes, fails, or is cancelled.
// The project's own new-thread draft shows the same progress as a composer
// banner (chat/composer/useProjectCloneBanner.tsx), so looking at it silences
// the toast.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  projectCloneDisplayName,
  projectCloneProgressSummary,
  type EnvironmentId,
  type ProjectCloneSnapshot,
  type ProjectId,
} from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { startNewThread } from "../palette/actions.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  environmentProjectClonesAtom,
  isProjectCloneToastSilenced,
  isViewingProjectDraft,
  removeClonedProject,
  silenceProjectCloneToasts,
} from "../state/coordinators.ts";
import { sourceControlEnvironment } from "../state/git.ts";
import { useEnvironments } from "../state/settings.ts";
import { routeAtom } from "../state/ui.ts";
import { dismissToast, toast, updateToast, type ToastInput } from "../ui/toast.tsx";

export function ProjectCloneToastCoordinator() {
  const { environments } = useEnvironments();
  return environments.map((environment) => (
    <EnvironmentCloneToasts key={environment.environmentId} environmentId={environment.environmentId} />
  ));
}

interface TrackedToast {
  readonly toastId: number;
  readonly renderedKey: string;
  readonly phase: ProjectCloneSnapshot["phase"];
}

function renderKey(clone: ProjectCloneSnapshot): string {
  return `${clone.phase}:${clone.stage}:${clone.percent ?? ""}:${clone.detail ?? ""}:${clone.stalled === true}:${clone.error ?? ""}`;
}

/** Shared with the composer banner: failures toast, an interrupted command stays quiet. */
export async function runCloneAction(title: string, action: () => Promise<AtomCommandResult<unknown, unknown>>) {
  const result = await action();
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
      actionLayout: "stacked-end",
    });
  }
}

export function cancelProjectClone(environmentId: EnvironmentId, projectId: ProjectId) {
  return runCloneAction("Failed to cancel clone", () =>
    runAtomCommand(
      appAtomRegistry,
      sourceControlEnvironment.cancelProjectClone,
      { environmentId, input: { projectId } },
      { reportFailure: false },
    ),
  );
}

export function retryProjectClone(environmentId: EnvironmentId, projectId: ProjectId) {
  return runCloneAction("Failed to retry clone", () =>
    runAtomCommand(
      appAtomRegistry,
      sourceControlEnvironment.retryProjectClone,
      { environmentId, input: { projectId } },
      { reportFailure: false },
    ),
  );
}

function EnvironmentCloneToasts({ environmentId }: { environmentId: EnvironmentId }) {
  const clones = useAtomValue(environmentProjectClonesAtom(environmentId));
  // Re-run on navigation: opening the project's draft silences its toast.
  const route = useAtomValue(routeAtom);
  const toasts = useRef(new Map<ProjectId, TrackedToast>());

  useEffect(() => {
    const seen = new Set<ProjectId>();
    for (const clone of clones) {
      seen.add(clone.projectId);
      const key = renderKey(clone);
      const tracked = toasts.current.get(clone.projectId);
      const name = projectCloneDisplayName(clone);
      const closeToast = () => {
        const current = toasts.current.get(clone.projectId);
        if (!current) return;
        dismissToast(current.toastId);
        toasts.current.delete(clone.projectId);
      };
      const ref = { environmentId, projectId: clone.projectId };
      if (isViewingProjectDraft(environmentId, clone.projectId)) {
        silenceProjectCloneToasts(ref);
        closeToast();
        continue;
      }
      if (tracked?.renderedKey === key) continue;
      if (isProjectCloneToastSilenced(ref) && (clone.phase === "running" || clone.phase === "done")) {
        closeToast();
        continue;
      }

      const show = (options: ToastInput) => {
        if (tracked) {
          updateToast(tracked.toastId, options);
          toasts.current.set(clone.projectId, { ...tracked, renderedKey: key, phase: clone.phase });
        } else {
          const toastId = toast(options);
          toasts.current.set(clone.projectId, { toastId, renderedKey: key, phase: clone.phase });
        }
      };

      if (clone.phase === "running") {
        show({
          type: "loading",
          title: `Cloning ${name}`,
          description: projectCloneProgressSummary(clone),
          duration: 0,
          actionLayout: "stacked-end",
          action: {
            label: "Cancel",
            onClick: () => void cancelProjectClone(environmentId, clone.projectId),
          },
        });
        continue;
      }

      if (clone.phase === "done") {
        show({
          type: "success",
          title: `Cloned ${name}`,
          description: clone.destinationPath,
          duration: 8_000,
          actionLayout: "stacked-end",
          action: {
            label: "Open project",
            onClick: () => {
              closeToast();
              startNewThread(scopeProjectRef(environmentId, clone.projectId));
            },
          },
        });
        continue;
      }

      const cancelled = clone.phase === "cancelled";
      show({
        type: cancelled ? "info" : "error",
        title: cancelled ? `Cancelled cloning ${name}` : `Failed to clone ${name}`,
        description: cancelled ? clone.destinationPath : (clone.error ?? "The clone failed."),
        duration: 0,
        actionLayout: "stacked-end",
        action: {
          label: "Retry",
          onClick: () => void retryProjectClone(environmentId, clone.projectId),
        },
        secondaryAction: {
          label: "Remove project",
          onClick: () => void removeClonedProject({ environmentId, projectId: clone.projectId }),
        },
      });
    }

    for (const [projectId, tracked] of toasts.current) {
      if (seen.has(projectId)) continue;
      if (tracked.phase !== "done") dismissToast(tracked.toastId);
      toasts.current.delete(projectId);
    }
  }, [clones, environmentId, route]);

  useEffect(
    () => () => {
      for (const tracked of toasts.current.values()) dismissToast(tracked.toastId);
      toasts.current.clear();
    },
    [],
  );

  return null;
}
