// The legacy tree's right-click menus and project dialogs (LegacySidebar.tsx
// handleThreadContextMenu, handleMultiSelectContextMenu,
// handleProjectButtonContextMenu, handleCreateThreadClick's environment picker,
// and the "Rename project" / "Project grouping" dialogs). Thread commands go
// through threadActions.ts.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import { deriveProjectGroupingOverrideKey, selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ContextMenuItem, EnvironmentId, SidebarProjectGroupingMode } from "@t3tools/contracts";
import { useState } from "react";

import { requestConfirmDialog as requestConfirm } from "../../dialogs/confirmDialog.ts";
import { DIALOG_WIDTH, DialogFooter, DialogHeader, DialogPanel, DialogShell, FieldLabel, TextField } from "../../dialogs/dialogKit.tsx";
import { startNewThread } from "../../palette/actions.ts";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { clearComposerContent } from "../../state/composer.ts";
import { updateClientSettings } from "../../state/clientSettings.ts";
import { projectEnvironment } from "../../state/environment.ts";
import {
  legacyContextMenuAtom,
  legacyProjectDialogAtom,
  legacySortedProjectsAtom,
  readLegacyProjectThreads,
} from "../../state/legacySidebar.ts";
import {
  canOperateEnvironmentAtom,
  clearThreadSelection,
  getThreadKeysToDeselectAfterDelete,
  newThreadContextRequestAtom,
  readCanOperate,
  readThreadSelection,
  removeFromThreadSelection,
  sidebarClientSettingsAtom,
  sidebarRenameAtom,
} from "../../state/sidebar.ts";
import { routeAtom } from "../../state/ui.ts";
import { Select } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import { archiveSelectedThreadEntries, buildMultiSelectThreadContextMenuItems } from "../../web/components/LegacySidebar.logic.ts";
import { deleteSelectedThreadEntries } from "../../web/components/Sidebar.logic.ts";
import type { SidebarProjectGroupMember, SidebarProjectSnapshot } from "../../web/sidebarProjectGrouping.ts";
import { ContextMenu } from "../ContextMenu.tsx";
import { openProjectSettings } from "../Sidebar.tsx";
import {
  archiveThread,
  attemptDelete,
  copyToClipboard,
  deleteThread,
  markThreadUnread,
  readThreadShell,
  reportResult,
} from "../threadActions.ts";

const ORCHESTRATION_OPERATE_DENIED_MESSAGE = "This connection cannot change threads or projects.";

const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};

function projectGroupingModeDescription(mode: SidebarProjectGroupingMode): string {
  switch (mode) {
    case "repository":
      return "Projects from the same repository share one sidebar row.";
    case "repository_path":
      return "Projects group only when both the repository and repo-relative path match.";
    case "separate":
      return "Every project path gets its own sidebar row.";
  }
}

/** checkTaskPermission. */
function checkTaskPermission(environmentId: EnvironmentId): boolean {
  if (readCanOperate(environmentId)) return true;
  toast({ type: "error", title: "Action unavailable", description: ORCHESTRATION_OPERATE_DENIED_MESSAGE });
  return false;
}

function formatProjectMemberActionLabel(member: SidebarProjectGroupMember, groupedProjectCount: number): string {
  if (groupedProjectCount <= 1) {
    return member.title;
  }
  return member.environmentLabel ? `${member.environmentLabel}: ${member.workspaceRoot}` : member.workspaceRoot;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function findProject(projectKey: string): SidebarProjectSnapshot | null {
  return appAtomRegistry.get(legacySortedProjectsAtom).find((project) => project.projectKey === projectKey) ?? null;
}

// ── Host ────────────────────────────────────────────────────────────────

export function LegacyContextMenuHost() {
  const menu = useAtomValue(legacyContextMenuAtom);
  const setMenu = useAtomSet(legacyContextMenuAtom);
  if (menu === null) return null;
  const close = () => setMenu(null);
  switch (menu.kind) {
    case "thread":
      return <ThreadContextMenu threadKey={menu.threadKey} projectKey={menu.projectKey} x={menu.x} y={menu.y} onClose={close} />;
    case "selection":
      return <SelectionContextMenu x={menu.x} y={menu.y} onClose={close} />;
    case "project":
      return <ProjectContextMenu projectKey={menu.projectKey} x={menu.x} y={menu.y} onClose={close} />;
    case "new-thread":
      return <NewThreadEnvironmentMenu projectKey={menu.projectKey} x={menu.x} y={menu.y} onClose={close} />;
  }
}

// ── Thread menu ─────────────────────────────────────────────────────────

type ThreadMenuId =
  | "new-thread-on-branch"
  | "rename"
  | "mark-unread"
  | "copy-path"
  | "copy-thread-id"
  | "project-settings"
  | "delete";

let newThreadContextNonce = 0;

function ThreadContextMenu({
  threadKey,
  projectKey,
  x,
  y,
  onClose,
}: {
  threadKey: string;
  projectKey: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const setRename = useAtomSet(sidebarRenameAtom);
  const threadRef = parseScopedThreadKey(threadKey);
  const thread = threadRef ? readThreadShell(threadRef) : null;
  const canOperate = useAtomValue(canOperateEnvironmentAtom((threadRef?.environmentId ?? "") as EnvironmentId));
  if (!threadRef || !thread) return null;
  const project = findProject(projectKey);
  const member = project?.memberProjects.find(
    (candidate) => candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
  );
  const workspacePath = thread.worktreePath ?? member?.workspaceRoot ?? project?.workspaceRoot ?? null;
  const items: ContextMenuItem<ThreadMenuId>[] = [
    ...(thread.branch ? [{ id: "new-thread-on-branch" as const, label: `New thread on ${thread.branch}` }] : []),
    { id: "rename", label: "Rename thread", disabled: !canOperate },
    { id: "mark-unread", label: "Mark unread" },
    { id: "copy-path", label: "Copy Path" },
    { id: "copy-thread-id", label: "Copy Thread ID" },
    { id: "project-settings", label: "Project settings" },
    { id: "delete", label: "Delete", destructive: true, icon: "trash", disabled: !canOperate },
  ];
  const onSelect = (id: ThreadMenuId) => {
    switch (id) {
      case "project-settings":
        if (project) openProjectSettings(project, { environmentId: thread.environmentId, projectId: thread.projectId });
        return;
      case "new-thread-on-branch":
        appAtomRegistry.set(newThreadContextRequestAtom, {
          environmentId: thread.environmentId,
          projectId: thread.projectId,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          envMode: thread.worktreePath ? "worktree" : "local",
          nonce: ++newThreadContextNonce,
        });
        appAtomRegistry.set(routeAtom, { kind: "draft", environmentId: thread.environmentId, projectId: thread.projectId });
        return;
      case "rename":
        if (checkTaskPermission(thread.environmentId)) setRename({ threadKey, title: thread.title });
        return;
      case "mark-unread":
        markThreadUnread(threadRef);
        return;
      case "copy-path":
        if (!workspacePath) {
          toast({ type: "error", title: "Path unavailable", description: "This thread does not have a workspace path to copy." });
          return;
        }
        void copyToClipboard(workspacePath, { title: "Path copied", failureTitle: "Failed to copy path" });
        return;
      case "copy-thread-id":
        void copyToClipboard(thread.id, { title: "Thread ID copied", failureTitle: "Failed to copy thread ID" });
        return;
      case "delete":
        if (checkTaskPermission(thread.environmentId)) void attemptDelete(threadRef);
        return;
    }
  };
  return <ContextMenu items={items} x={x} y={y} onSelect={onSelect} onClose={onClose} testId="legacy-thread-context-menu" />;
}

// ── Multi-select menu ───────────────────────────────────────────────────

function SelectionContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const threadKeys = [...readThreadSelection().selectedThreadKeys];
  if (threadKeys.length === 0) return null;
  const entries = threadKeys.flatMap((threadKey) => {
    const threadRef = parseScopedThreadKey(threadKey);
    const thread = threadRef ? readThreadShell(threadRef) : null;
    return threadRef && thread ? [{ threadKey, threadRef, thread }] : [];
  });
  const hasRunningThread = entries.some(({ thread }) => !threadRuntimeCanArchive(thread.runtime));
  const canOperateSelection = entries.every(({ threadRef }) => readCanOperate(threadRef.environmentId));
  const items = buildMultiSelectThreadContextMenuItems({ count: threadKeys.length, hasRunningThread }).map((item) =>
    item.id === "archive" || item.id === "delete" ? { ...item, disabled: item.disabled || !canOperateSelection } : item,
  );
  const onSelect = (id: "mark-unread" | "archive" | "delete") => {
    void handleSelectionAction(id, threadKeys, entries);
  };
  return <ContextMenu items={items} x={x} y={y} onSelect={onSelect} onClose={onClose} testId="legacy-selection-context-menu" />;
}

async function handleSelectionAction(
  id: "mark-unread" | "archive" | "delete",
  threadKeys: ReadonlyArray<string>,
  entries: ReadonlyArray<{ threadKey: string; threadRef: ReturnType<typeof scopeThreadRef> }>,
): Promise<void> {
  const count = threadKeys.length;
  const settings = appAtomRegistry.get(sidebarClientSettingsAtom);
  if (id === "mark-unread") {
    for (const { threadRef } of entries) markThreadUnread(threadRef);
    clearThreadSelection();
    return;
  }
  if (!entries.every(({ threadRef }) => checkTaskPermission(threadRef.environmentId))) return;
  if (id === "archive") {
    if (settings.confirmThreadArchive) {
      const confirmed = await requestConfirm(`Archive ${count} thread${count === 1 ? "" : "s"}?`);
      if (!confirmed) return;
    }
    const outcome = await archiveSelectedThreadEntries({
      entries,
      archive: async ({ threadRef }, onArchived) => {
        const result = await archiveThread(threadRef);
        if (result._tag === "Success") onArchived();
        return result;
      },
    });
    if (outcome.mutationFailure) {
      removeFromThreadSelection(outcome.archivedThreadKeys);
      reportResult(outcome.mutationFailure, "Failed to archive threads");
      return;
    }
    removeFromThreadSelection(threadKeys);
    return;
  }
  if (settings.confirmThreadDelete) {
    const confirmed = await requestConfirm(
      [`Delete ${count} thread${count === 1 ? "" : "s"}?`, "This permanently clears conversation history for these threads."].join("\n"),
      { variant: "destructive" },
    );
    if (!confirmed) return;
  }
  const { deletedThreadKeys, firstFailure } = await deleteSelectedThreadEntries({
    entries,
    delete: ({ threadRef }) => deleteThread(threadRef),
  });
  if (firstFailure !== null) reportResult(firstFailure, "Failed to delete threads");
  removeFromThreadSelection(
    getThreadKeysToDeselectAfterDelete([...threadKeys], deletedThreadKeys, (threadKey) => {
      const threadRef = parseScopedThreadKey(threadKey);
      return threadRef !== null && readThreadShell(threadRef) !== null;
    }),
  );
}

// ── Project menu ────────────────────────────────────────────────────────

type ProjectAction = "rename" | "grouping" | "copy-path" | "delete";

function ProjectContextMenu({ projectKey, x, y, onClose }: { projectKey: string; x: number; y: number; onClose: () => void }) {
  const setDialog = useAtomSet(legacyProjectDialogAtom);
  const project = useAtomValue(legacySortedProjectsAtom).find((candidate) => candidate.projectKey === projectKey);
  if (!project) return null;
  const handlers = new Map<string, () => void>();
  const makeLeaf = (
    action: ProjectAction,
    member: SidebarProjectGroupMember,
    options?: { destructive?: boolean; disabled?: boolean },
  ): ContextMenuItem<string> => {
    const id = `${action}:${member.physicalProjectKey}`;
    handlers.set(id, () => {
      switch (action) {
        case "rename":
          if (checkTaskPermission(member.environmentId)) {
            setDialog({ kind: "rename", projectKey, physicalProjectKey: member.physicalProjectKey });
          }
          return;
        case "grouping":
          setDialog({ kind: "grouping", projectKey, physicalProjectKey: member.physicalProjectKey });
          return;
        case "copy-path":
          void copyToClipboard(member.workspaceRoot, { title: "Path copied", failureTitle: "Failed to copy path" });
          return;
        case "delete":
          void handleRemoveProject(project, member);
          return;
      }
    });
    return {
      id,
      label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
      ...(options?.destructive ? { destructive: true } : {}),
      ...(options?.disabled ? { disabled: true } : {}),
    };
  };
  const buildTargetedItem = (
    action: ProjectAction,
    label: string,
    options?: { destructive?: boolean; isDisabled?: (member: SidebarProjectGroupMember) => boolean },
  ): ContextMenuItem<string> => {
    if (project.memberProjects.length === 1) {
      const singleMember = project.memberProjects[0]!;
      return {
        ...makeLeaf(action, singleMember, {
          ...(options?.destructive ? { destructive: true } : {}),
          ...(options?.isDisabled?.(singleMember) ? { disabled: true } : {}),
        }),
        label,
        ...(action === "delete" ? { icon: "trash" } : {}),
      };
    }
    return {
      id: `${action}:submenu`,
      label,
      ...(action === "delete" ? { icon: "trash" } : {}),
      children: project.memberProjects.map((member) =>
        makeLeaf(action, member, {
          ...(options?.destructive ? { destructive: true } : {}),
          ...(options?.isDisabled?.(member) ? { disabled: true } : {}),
        }),
      ),
    };
  };
  handlers.set("project-settings", () => openProjectSettings(project));
  const cannotOperate = (member: SidebarProjectGroupMember) => !readCanOperate(member.environmentId);
  const items: ContextMenuItem<string>[] = [
    buildTargetedItem("rename", "Rename", { isDisabled: cannotOperate }),
    buildTargetedItem("grouping", "Group into..."),
    buildTargetedItem("copy-path", "Copy Path"),
    { id: "project-settings", label: "Project settings", icon: "settings" },
    buildTargetedItem("delete", "Remove", { destructive: true, isDisabled: cannotOperate }),
  ];
  return (
    <ContextMenu
      items={items}
      x={x}
      y={y}
      onSelect={(id) => handlers.get(id)?.()}
      onClose={onClose}
      testId="legacy-project-context-menu"
    />
  );
}

async function removeProject(member: SidebarProjectGroupMember) {
  const result = await runAtomCommand(
    appAtomRegistry,
    projectEnvironment.delete,
    { environmentId: member.environmentId, input: { projectId: member.id, force: true } },
    { reportFailure: false },
  );
  if (result._tag === "Success") {
    // Web clears the project's draft thread with it.
    clearComposerContent(`draft:${member.environmentId}:${member.id}`);
  }
  return result;
}

function reportRemoveFailure(member: SidebarProjectGroupMember, result: Awaited<ReturnType<typeof removeProject>>) {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
  toast({
    type: "error",
    title: `Failed to remove "${member.title}"`,
    description: errorMessage(squashAtomCommandFailure(result), "Unknown error removing project."),
  });
}

/** handleRemoveProject: a non-empty project first asks through a warning toast. */
async function handleRemoveProject(project: SidebarProjectSnapshot, member: SidebarProjectGroupMember): Promise<void> {
  if (!checkTaskPermission(member.environmentId)) return;
  const environmentLine = member.environmentLabel ? [`Environment: ${member.environmentLabel}`] : [];
  const memberThreadCount = readLegacyProjectThreads(project.projectKey).threadCountByPhysicalKey.get(member.physicalProjectKey) ?? 0;
  if (memberThreadCount > 0) {
    toast({
      type: "warning",
      title: "Project is not empty",
      description: "Delete all threads in this project before removing it.",
      action: {
        label: "Delete anyway",
        onClick: () => {
          void (async () => {
            if (!checkTaskPermission(member.environmentId)) return;
            const latest =
              readLegacyProjectThreads(project.projectKey).threadCountByPhysicalKey.get(member.physicalProjectKey) ?? 0;
            const confirmed = await requestConfirm(
              latest > 0
                ? [
                    `Remove project "${member.title}" and delete its ${latest} thread${latest === 1 ? "" : "s"}?`,
                    `Path: ${member.workspaceRoot}`,
                    ...environmentLine,
                    "This permanently clears conversation history for those threads and any archived threads.",
                    "This removes only this project entry.",
                    "This action cannot be undone.",
                  ].join("\n")
                : [
                    `Remove project "${member.title}"?`,
                    `Path: ${member.workspaceRoot}`,
                    ...environmentLine,
                    "This permanently clears any archived conversation history.",
                    "This removes only this project entry.",
                  ].join("\n"),
              { variant: "destructive" },
            );
            if (!confirmed) return;
            reportRemoveFailure(member, await removeProject(member));
          })();
        },
      },
    });
    return;
  }
  const confirmed = await requestConfirm(
    [
      `Remove project "${member.title}"?`,
      `Path: ${member.workspaceRoot}`,
      ...environmentLine,
      "This permanently clears any archived conversation history.",
      "This removes only this project entry.",
    ].join("\n"),
    { variant: "destructive" },
  );
  if (!confirmed) return;
  reportRemoveFailure(member, await removeProject(member));
}

// ── New thread: which member (handleCreateThreadClick) ──────────────────

function NewThreadEnvironmentMenu({ projectKey, x, y, onClose }: { projectKey: string; x: number; y: number; onClose: () => void }) {
  const project = useAtomValue(legacySortedProjectsAtom).find((candidate) => candidate.projectKey === projectKey);
  if (!project) return null;
  const items = project.memberProjects.map((member) => ({
    id: member.physicalProjectKey,
    label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
  }));
  const onSelect = (id: string) => {
    const member = project.memberProjects.find((candidate) => candidate.physicalProjectKey === id);
    if (member) startNewThread(scopeProjectRef(member.environmentId, member.id));
  };
  return <ContextMenu items={items} x={x} y={y} onSelect={onSelect} onClose={onClose} testId="legacy-new-thread-menu" />;
}

// ── Dialogs ─────────────────────────────────────────────────────────────

export function LegacyProjectDialogs() {
  const dialog = useAtomValue(legacyProjectDialogAtom);
  const setDialog = useAtomSet(legacyProjectDialogAtom);
  const projects = useAtomValue(legacySortedProjectsAtom);
  if (dialog === null) return null;
  const member = projects
    .find((project) => project.projectKey === dialog.projectKey)
    ?.memberProjects.find((candidate) => candidate.physicalProjectKey === dialog.physicalProjectKey);
  if (!member) return null;
  const close = () => setDialog(null);
  return dialog.kind === "rename" ? (
    <RenameProjectDialog key={member.physicalProjectKey} member={member} onClose={close} />
  ) : (
    <ProjectGroupingDialog key={member.physicalProjectKey} member={member} onClose={close} />
  );
}

function RenameProjectDialog({ member, onClose }: { member: SidebarProjectGroupMember; onClose: () => void }) {
  const theme = useTheme();
  const [title, setTitle] = useState(member.title);
  const canRename = useAtomValue(canOperateEnvironmentAtom(member.environmentId));
  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      toast({ type: "warning", title: "Project title cannot be empty" });
      return;
    }
    if (trimmed === member.title) {
      onClose();
      return;
    }
    const result = await runAtomCommand(
      appAtomRegistry,
      projectEnvironment.update,
      { environmentId: member.environmentId, input: { projectId: member.id, title: trimmed } },
      { reportFailure: false },
    );
    if (result._tag === "Success") onClose();
    else reportResult(result, "Failed to rename project");
  };
  return (
    <DialogShell onOpenChange={(open) => !open && onClose()} width={DIALOG_WIDTH.lg} testId="legacy-rename-project-dialog">
      <DialogHeader title="Rename project" description={`Update the title for ${member.workspaceRoot}.`} hasPanel />
      <DialogPanel gap={16}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Text size="xs" weight={500} color={theme.foreground}>
            Project title
          </Text>
          <TextField value={title} onChange={setTitle} onSubmit={() => void submit()} testId="legacy-rename-project-input" autoFocus />
        </div>
        {member.environmentLabel ? (
          <Text size="xs" color={theme.mutedForeground}>
            {`Environment: ${member.environmentLabel}`}
          </Text>
        ) : null}
        {!canRename ? (
          <Text size="xs" color={theme.mutedForeground}>
            This connection cannot change projects.
          </Text>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} testId="legacy-rename-project-cancel">
          Cancel
        </Button>
        <Button disabled={!canRename} onClick={() => void submit()} testId="legacy-rename-project-save">
          Save
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}

function ProjectGroupingDialog({ member, onClose }: { member: SidebarProjectGroupMember; onClose: () => void }) {
  const theme = useTheme();
  const settings = selectProjectGroupingSettings(useAtomValue(sidebarClientSettingsAtom));
  const overrideKey = deriveProjectGroupingOverrideKey(member);
  const [selection, setSelection] = useState<SidebarProjectGroupingMode | "inherit">(
    settings.sidebarProjectGroupingOverrides?.[overrideKey] ?? "inherit",
  );
  const save = () => {
    const nextOverrides = { ...settings.sidebarProjectGroupingOverrides };
    if (selection === "inherit") delete nextOverrides[overrideKey];
    else nextOverrides[overrideKey] = selection;
    updateClientSettings({ sidebarProjectGroupingOverrides: nextOverrides });
    onClose();
  };
  const globalLabel = PROJECT_GROUPING_MODE_LABELS[settings.sidebarProjectGroupingMode];
  return (
    <DialogShell onOpenChange={(open) => !open && onClose()} width={DIALOG_WIDTH.lg} testId="legacy-project-grouping-dialog">
      <DialogHeader
        title="Project grouping"
        description={`Choose how ${member.workspaceRoot} should be grouped in the sidebar.`}
        hasPanel
      />
      <DialogPanel gap={16}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldLabel style={{ fontSize: 12 }}>Grouping rule</FieldLabel>
          <Select
            value={selection}
            minWidth={462}
            align="end"
            testId="legacy-project-grouping-select"
            onChange={setSelection}
            options={[
              { value: "inherit", label: selection === "inherit" ? `Use global default (${globalLabel})` : "Use global default" },
              { value: "repository", label: PROJECT_GROUPING_MODE_LABELS.repository },
              { value: "repository_path", label: PROJECT_GROUPING_MODE_LABELS.repository_path },
              { value: "separate", label: PROJECT_GROUPING_MODE_LABELS.separate },
            ]}
          />
        </div>
        <Text size="xs" color={theme.mutedForeground}>
          {projectGroupingModeDescription(selection === "inherit" ? settings.sidebarProjectGroupingMode : selection)}
        </Text>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} testId="legacy-project-grouping-cancel">
          Cancel
        </Button>
        <Button onClick={save} testId="legacy-project-grouping-save">
          Save
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
