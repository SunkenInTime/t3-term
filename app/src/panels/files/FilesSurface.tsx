// The right panel's Files surfaces: the explorer (`files`) and a file preview with the
// explorer docked beside it (`file:<path>`). The web client renders both through
// FilePreviewPanel from RightPanelSurfaceContent.tsx; this is that "files"/"file" case.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { environmentThreadShells, projectIndexAtom } from "../../state/environment.ts";
import { rightPanelActions, rightPanelThreadStateAtom, threadKeyOf } from "../../state/rightPanel.ts";
import FilePreviewPanel from "./FilePreviewPanel.tsx";
import { useWorkspaceMutationId } from "./workspaceMutation.ts";

/** Where a thread's files live: its worktree, else the project root. */
export function useThreadWorkspace(environmentId: EnvironmentId, threadId: ThreadId) {
  const shell = useAtomValue(
    environmentThreadShells.threadShellAtom({ environmentId, threadId } as ScopedThreadRef),
  );
  const projects = useAtomValue(projectIndexAtom);
  if (!shell) return null;
  const project = projects.get(`${environmentId}:${scopeProjectRef(environmentId, shell.projectId).projectId}`);
  if (!project) return null;
  return { cwd: shell.worktreePath ?? project.workspaceRoot, projectName: project.title };
}

export function FilesSurface(props: { environmentId: EnvironmentId; threadId: ThreadId; surfaceId?: string }) {
  const { environmentId, threadId } = props;
  const threadKey = threadKeyOf(environmentId, threadId);
  const panelState = useAtomValue(rightPanelThreadStateAtom(threadKey));
  const surfaceId = props.surfaceId ?? "files";
  const surface = panelState.surfaces.find((entry) => entry.id === surfaceId);
  const workspace = useThreadWorkspace(environmentId, threadId);
  const workspaceMutationId = useWorkspaceMutationId(environmentId, threadId);
  if (!workspace) return null;
  const fileSurface = surface?.kind === "file" ? surface : null;
  const folderTrail = surface?.kind === "file" || surface?.kind === "files" ? surface.folderTrail : undefined;

  return (
    <div testId="files-surface" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
      <FilePreviewPanel
        key={`${environmentId}:${workspace.cwd}`}
        environmentId={environmentId}
        threadId={threadId}
        cwd={workspace.cwd}
        projectName={workspace.projectName}
        relativePath={fileSurface?.relativePath ?? null}
        revealLine={fileSurface?.revealLine ?? null}
        revealRequestId={fileSurface?.revealRequestId ?? 0}
        onOpenFile={(relativePath) => rightPanelActions.openFile(threadKey, relativePath)}
        onNavigateFolder={(relativePath, trail, keepSource) =>
          rightPanelActions.navigateFolder(threadKey, surfaceId, relativePath, trail, keepSource)
        }
        folderTrail={folderTrail}
        workspaceMutationId={workspaceMutationId}
      />
    </div>
  );
}
