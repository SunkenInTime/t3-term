// apps/web/src/components/chat/useProjectCloneBanner.tsx. A project still
// being cloned or copied into place: the composer banner with its cancel,
// retry, and remove actions, and the reason sending waits until it is done.
import { useAtomValue } from "@effect/atom-react";
import { projectCloneDisplayName, projectCloneProgressSummary, type ScopedProjectRef } from "@t3tools/contracts";

import { cancelProjectClone, retryProjectClone } from "../../coordinators/ProjectCloneToastCoordinator.tsx";
import { projectCloneAtomFor, removeClonedProject } from "../../state/coordinators.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { dismissProjectFileCopy, useProjectFileCopy } from "../../web/lib/addProjectToMachine.ts";
import type { ComposerBannerStackItem } from "./ComposerBannerStack.tsx";

export interface ProjectCloneBanner {
  readonly projectCloneBannerItem: ComposerBannerStackItem | null;
  /** Why the composer cannot send yet ("Cloning repository", ...), or null. */
  readonly projectCloneSendBlockReason: string | null;
}

export function useProjectCloneBanner(activeProjectRef: ScopedProjectRef | null): ProjectCloneBanner {
  const theme = useTheme();
  const activeProjectClone = useAtomValue(projectCloneAtomFor(activeProjectRef));
  const activeProjectFileCopy = useProjectFileCopy(activeProjectRef);
  const projectCloneSendBlockReason =
    activeProjectClone?.phase === "running"
      ? "Cloning repository"
      : activeProjectClone !== null && activeProjectClone.phase !== "done"
        ? "Repository not cloned"
        : activeProjectFileCopy?.phase === "copying"
          ? "Copying files"
          : null;
  // web ComposerBanner.Icon: a 12px muted icon.
  const icon = <Icon name="download" size={12} color={theme.mutedForeground} />;
  const projectCloneBannerItem = ((): ComposerBannerStackItem | null => {
    if (activeProjectFileCopy?.phase === "failed" && activeProjectRef) {
      return {
        id: `project-file-copy:${activeProjectRef.projectId}`,
        variant: "error",
        icon,
        title: activeProjectFileCopy.title,
        description: activeProjectFileCopy.failures.join("\n"),
        onDismiss: () => dismissProjectFileCopy(activeProjectRef),
      };
    }
    if (!activeProjectClone || !activeProjectRef || activeProjectClone.phase === "done") {
      return null;
    }
    const name = projectCloneDisplayName(activeProjectClone);
    const { environmentId, projectId } = activeProjectRef;
    if (activeProjectClone.phase === "running") {
      return {
        id: `project-clone:${projectId}`,
        variant: "info",
        priority: "activity",
        icon,
        title: `Cloning ${name}`,
        description: projectCloneProgressSummary(activeProjectClone),
        actions: (
          <Button
            size="xs"
            variant="ghost"
            testId="project-clone-cancel"
            onClick={() => void cancelProjectClone(environmentId, projectId)}
          >
            Cancel
          </Button>
        ),
      };
    }
    const cancelled = activeProjectClone.phase === "cancelled";
    return {
      id: `project-clone:${projectId}`,
      variant: cancelled ? "warning" : "error",
      icon,
      title: cancelled ? `Cancelled cloning ${name}` : `Failed to clone ${name}`,
      description: cancelled ? "Retry to bring in the repository." : (activeProjectClone.error ?? undefined),
      actions: (
        <>
          <Button
            size="xs"
            variant="ghost"
            testId="project-clone-remove"
            onClick={() => void removeClonedProject({ environmentId, projectId })}
          >
            Remove project
          </Button>
          <Button
            size="xs"
            variant="ghost"
            testId="project-clone-retry"
            onClick={() => void retryProjectClone(environmentId, projectId)}
          >
            Retry
          </Button>
        </>
      ),
    };
  })();
  return {
    projectCloneBannerItem,
    projectCloneSendBlockReason,
  };
}
