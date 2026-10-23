// Mount point for app-level dialogs. Each dialog module exports an opener
// (openX / requestX) that other areas call:
//   requestConfirmDialog(message, { variant })      ./confirmDialog.ts
//   requestCustomSnooze()                           ./CustomSnoozeDialog.tsx
//   openLinkPullRequestDialog(threadRef)            ./LinkPullRequestDialog.tsx
//   openPullRequestThreadDialog({ environmentId, threadId, cwd, initialReference, onPrepared? })
//                                                   ./PullRequestThreadDialog.tsx
//   openAddProjectToMachine({ projectRef, targetEnvironmentId })
//                                                   ./AddProjectToMachineDialog.tsx
//
// Dev hook (screenshots and manual checks): T3TERM_OPEN_DIALOG opens one dialog
// once, as soon as the live data it needs has loaded:
//   confirm | confirm-destructive | link-pr | checkout-pr | custom-snooze | add-to-machine
// T3TERM_DIALOG_MATCH (optional) picks the first thread or project whose title,
// project title or workspace path contains it (case-insensitive) instead of the
// first one. T3TERM_DIALOG_REFERENCE (optional) prefills the checkout-pr input.
// The hook only opens dialogs; results are logged, never acted on.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useEffect, useRef } from "react";

import { environmentProjects, environmentThreadShells } from "../state/environment.ts";
import { AddProjectToMachineDialogHost, openAddProjectToMachine } from "./AddProjectToMachineDialog.tsx";
import { requestConfirmDialog } from "./confirmDialog.ts";
import { ConfirmDialogHost } from "./ConfirmDialogHost.tsx";
import { CustomSnoozeDialogHost, requestCustomSnooze } from "./CustomSnoozeDialog.tsx";
import { LinkPullRequestDialogHost, openLinkPullRequestDialog } from "./LinkPullRequestDialog.tsx";
import { PullRequestThreadDialogHost, openPullRequestThreadDialog } from "./PullRequestThreadDialog.tsx";

export function DialogHost() {
  return (
    <>
      <ConfirmDialogHost />
      <CustomSnoozeDialogHost />
      <LinkPullRequestDialogHost />
      <PullRequestThreadDialogHost />
      <AddProjectToMachineDialogHost />
      {process.env.T3TERM_OPEN_DIALOG ? <DevDialogTrigger which={process.env.T3TERM_OPEN_DIALOG} /> : null}
    </>
  );
}

function DevDialogTrigger({ which }: { which: string }) {
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    const match = process.env.T3TERM_DIALOG_MATCH?.toLowerCase() ?? null;
    const projectMatches = (project: EnvironmentProject | undefined) =>
      project !== undefined &&
      (project.title.toLowerCase().includes(match ?? "") ||
        project.workspaceRoot.toLowerCase().includes(match ?? ""));
    const projectOf = (environmentId: string, projectId: string) =>
      projects.find((project) => project.environmentId === environmentId && project.id === projectId);
    const thread =
      threads.find(
        (candidate) =>
          match === null ||
          candidate.title.toLowerCase().includes(match) ||
          projectMatches(projectOf(candidate.environmentId, candidate.projectId)),
      ) ?? null;
    const project =
      projects.find(
        (candidate) =>
          !candidate.isScratch &&
          (match === null || projectMatches(candidate)) &&
          (which !== "add-to-machine" || candidate.repositoryIdentity?.locator.remoteUrl),
      ) ?? null;
    const log = (result: unknown) => console.log(`[T3TERM_OPEN_DIALOG] ${which} ->`, JSON.stringify(result));

    switch (which) {
      case "confirm":
      case "confirm-destructive": {
        if (thread === null) return;
        opened.current = true;
        const message =
          which === "confirm"
            ? `Archive thread "${thread.title}"?`
            : [
                `Delete thread "${thread.title}"?`,
                "This permanently clears conversation history for this thread.",
              ].join("\n");
        void requestConfirmDialog(message, which === "confirm" ? undefined : { variant: "destructive" }).then(log);
        return;
      }
      case "custom-snooze":
        opened.current = true;
        void requestCustomSnooze().then(log);
        return;
      case "link-pr":
        if (thread === null) return;
        opened.current = true;
        openLinkPullRequestDialog({ environmentId: thread.environmentId, threadId: thread.id });
        return;
      case "checkout-pr": {
        if (thread === null) return;
        const threadProject = projectOf(thread.environmentId, thread.projectId);
        if (threadProject === undefined) return;
        opened.current = true;
        openPullRequestThreadDialog({
          environmentId: thread.environmentId,
          threadId: thread.id,
          cwd: threadProject.workspaceRoot,
          initialReference: process.env.T3TERM_DIALOG_REFERENCE ?? null,
        });
        return;
      }
      case "add-to-machine":
        if (project === null) return;
        opened.current = true;
        openAddProjectToMachine({
          projectRef: { environmentId: project.environmentId, projectId: project.id },
          targetEnvironmentId: null,
        });
        return;
      default:
        opened.current = true;
        console.warn(`[T3TERM_OPEN_DIALOG] unknown dialog "${which}"`);
    }
  }, [which, threads, projects]);

  return null;
}
