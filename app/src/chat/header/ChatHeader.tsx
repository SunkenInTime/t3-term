// Port of apps/web/src/components/chat/ChatHeader.tsx (breadcrumb, title menu,
// inline rename) with the panel toggles of PanelLayoutControls.tsx.
import { useAtom, useAtomValue } from "@effect/atom-react";
import type { EventPayload } from "@gpuix/native";
import type { KeyEvent } from "@gpuix/react";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type OrchestrationProjectShell,
  type ThreadId,
} from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  environmentThreadShells,
  projectIndexAtom,
  serverEnvironment,
  threadEnvironment,
} from "../../state/environment.ts";
import { rightPanelOpenAtom, routeAtom, sidebarOpenAtom } from "../../state/ui.ts";
import { ProjectGlyph } from "../../sidebar/ProjectGlyph.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Dialog, Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, LAYOUT, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import type { ThreadActionMenuId } from "../../web/components/threadActionMenu.logic.ts";
import { shortcutLabelForCommand } from "../../web/keybindings.ts";
import { useEnvironmentScope } from "../../web/state/session.ts";
import { ThreadDetailsContent } from "../details/ThreadDetailsCard.tsx";
import { ActionMenu } from "./ActionMenu.tsx";
import { PanelLayoutControls, WorkspaceTitlebarControls, type PanelShortcutLabels } from "./PanelLayoutControls.tsx";
import { buildTitleMenu, runThreadAction, type ThreadActionContext } from "./threadActions.ts";

function resolveRenameCommit(input: { readonly title: string; readonly originalTitle: string }):
  | { action: "commit"; title: string }
  | { action: "reject-empty" }
  | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

export function usePanelShortcutLabels(environmentId: EnvironmentId | null): PanelShortcutLabels {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const keybindings = config?.keybindings ?? [];
  return {
    details: shortcutLabelForCommand(keybindings, "threadPanel.toggle"),
    terminal: shortcutLabelForCommand(keybindings, "terminal.toggle"),
    rightPanel: shortcutLabelForCommand(keybindings, "rightPanel.toggle"),
  };
}

export function ChatHeader({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const theme = useTheme();
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const rightPanelOpen = useAtomValue(rightPanelOpenAtom);
  const projects = useAtomValue(projectIndexAtom);
  const thread = useAtomValue(environmentThreadShells.threadShellAtom({ environmentId, threadId } as never)) as
    | EnvironmentThreadShell
    | null
    | undefined;
  const parentThreadId =
    thread?.lineage.relationshipToParent === "subagent" ? (thread.lineage.parentThreadId ?? null) : null;
  const parentThread = useAtomValue(
    environmentThreadShells.threadShellAtom({ environmentId, threadId: parentThreadId ?? threadId } as never),
  ) as EnvironmentThreadShell | null | undefined;
  const project = thread ? projects.get(`${environmentId}:${thread.projectId}`) : undefined;
  const shortcuts = usePanelShortcutLabels(environmentId);
  const available = project !== undefined;

  return (
    <div
      testId="chat-header"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: LAYOUT.topbar,
        flexShrink: 0,
        paddingLeft: sidebarOpen ? 20 : 12,
        paddingRight: 12,
        gap: 12,
        position: "relative",
        backgroundColor: theme.background,
      }}
    >
      {sidebarOpen ? null : (
        <Tooltip content="Toggle sidebar">
          <IconButton icon="panel-left" color={alpha(theme.foreground, 0.8)} onClick={() => setSidebarOpen(true)} testId="sidebar-open" />
        </Tooltip>
      )}
      {thread ? (
        <ThreadBreadcrumb
          thread={thread}
          project={project}
          parent={parentThreadId ? { threadId: parentThreadId, title: parentThread?.title ?? "Parent thread" } : null}
          rightPanelOpen={rightPanelOpen}
        />
      ) : (
        <div style={{ flexGrow: 1 }} />
      )}
      {rightPanelOpen ? (
        <>
          <PanelLayoutControls
            available={available}
            shortcuts={shortcuts}
            showTerminal={false}
            showRightPanel={false}
            detailsPopover={<ThreadDetailsContent environmentId={environmentId} threadId={threadId} density="full" />}
          />
          <WorkspaceTitlebarControls available={available} shortcuts={shortcuts} />
        </>
      ) : (
        <PanelLayoutControls
          available={available}
          shortcuts={shortcuts}
          detailsPopover={<ThreadDetailsContent environmentId={environmentId} threadId={threadId} density="full" />}
        />
      )}
    </div>
  );
}

function BreadcrumbSeparator() {
  const theme = useTheme();
  return (
    <text style={{ color: alpha(theme.mutedForeground, 0.7), fontSize: 14, lineHeight: 20, fontWeight: 500, fontFamily: FONTS.sans, flexShrink: 0 }}>
      /
    </text>
  );
}

function BreadcrumbText({ children, color, maxWidth }: { children: ReactNode; color: string; maxWidth?: number }) {
  return (
    <text
      style={{
        color,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: 500,
        fontFamily: FONTS.sans,
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        overflow: "hidden",
        minWidth: 0,
        flexShrink: 1,
        ...(maxWidth ? { maxWidth } : {}),
      }}
    >
      {children}
    </text>
  );
}

/** A muted crumb that brightens on hover (text-muted-foreground hover:text-foreground). */
function CrumbButton({
  children,
  tooltip,
  onClick,
  testId,
  shrink = 1,
}: {
  children: (hovered: boolean) => ReactNode;
  tooltip: string;
  onClick: () => void;
  testId: string;
  shrink?: number;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Tooltip content={tooltip}>
      <div
        testId={testId}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
          flexShrink: shrink,
          cursor: "pointer",
          borderRadius: RADIUS.sm,
        }}
      >
        {children(hovered)}
      </div>
    </Tooltip>
  );
}

interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
}

function ThreadBreadcrumb({
  thread,
  project,
  parent,
  rightPanelOpen,
}: {
  thread: EnvironmentThreadShell;
  project: OrchestrationProjectShell | undefined;
  parent: { threadId: ThreadId; title: string } | null;
  rightPanelOpen: boolean;
}) {
  const theme = useTheme();
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const [renaming, setRenaming] = useState<{ threadKey: string; title: string } | null>(null);
  const threadKey = `${thread.environmentId}:${thread.id}`;
  const renamingTitle = canOperate && renaming?.threadKey === threadKey ? renaming.title : null;
  const committedRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const menu = menuOpen ? buildTitleMenu(thread) : null;

  // A pending menu belongs to the thread that was clicked; switching threads drops it.
  useEffect(() => {
    setMenuOpen(false);
    setRenaming(null);
  }, [threadKey]);

  const startRename = () => {
    if (!canOperate) return;
    committedRef.current = false;
    setMenuOpen(false);
    setRenaming({ threadKey, title: thread.title });
  };

  const commitRename = (title: string) => {
    setRenaming(null);
    const resolution = resolveRenameCommit({ title, originalTitle: thread.title });
    if (resolution.action === "reject-empty") {
      toast({ type: "warning", title: "Thread title cannot be empty" });
      return;
    }
    if (resolution.action === "noop") return;
    void runAtomCommand(appAtomRegistry, threadEnvironment.updateMetadata, {
      environmentId: thread.environmentId,
      input: { threadId: thread.id, title: resolution.title },
    } as never).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toast({ type: "error", title: "Failed to rename thread", description: error instanceof Error ? error.message : "An error occurred." });
      }
    });
  };

  const actionContext: ThreadActionContext = {
    thread,
    projectCwd: project?.workspaceRoot ?? null,
    presets: menu?.presets ?? [],
    onStartRename: startRename,
    confirm: (input) => new Promise<boolean>((resolve) => setConfirm({ ...input, resolve })),
  };

  const onTitleClick = (event: EventPayload) => {
    // The second click of a double click renames instead of toggling the menu.
    if ((event.clickCount ?? 1) > 1) {
      if (canOperate) startRename();
      return;
    }
    setMenuOpen(!menuOpen);
  };

  const projectName = project ? project.title : null;

  return (
    <div
      onAuxClick={(event: EventPayload) => {
        if (event.isRightClick && renamingTitle === null) setMenuOpen(true);
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        paddingRight: rightPanelOpen ? 40 : 0,
        overflow: "hidden",
      }}
    >
      {project ? (
        <>
          <CrumbButton
            testId="header-project"
            tooltip={`New thread in ${projectName}`}
            onClick={() =>
              appAtomRegistry.set(routeAtom, { kind: "draft", environmentId: thread.environmentId, projectId: thread.projectId })
            }
          >
            {(hovered) => (
              <>
                <ProjectGlyph project={project} size={14} environmentId={thread.environmentId} />
                <BreadcrumbText color={hovered ? theme.foreground : theme.mutedForeground} maxWidth={160}>
                  {projectName}
                </BreadcrumbText>
              </>
            )}
          </CrumbButton>
          <BreadcrumbSeparator />
        </>
      ) : null}
      {parent ? (
        <>
          <CrumbButton
            testId="header-parent-thread"
            tooltip={parent.title}
            onClick={() =>
              appAtomRegistry.set(routeAtom, { kind: "thread", environmentId: thread.environmentId, threadId: parent.threadId })
            }
          >
            {(hovered) => <BreadcrumbText color={hovered ? theme.foreground : theme.mutedForeground}>{parent.title}</BreadcrumbText>}
          </CrumbButton>
          <BreadcrumbSeparator />
        </>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexGrow: 1, flexShrink: 1, minWidth: 40 }}>
        {renamingTitle !== null ? (
          <input
            testId="thread-title-input"
            autoFocus
            value={renamingTitle}
            onChange={(event: EventPayload) => setRenaming({ threadKey, title: String(event.value ?? "") })}
            onSubmit={() => {
              committedRef.current = true;
              commitRename(renamingTitle);
            }}
            onKeyDown={(event: KeyEvent) => {
              if (event.key === "escape") {
                committedRef.current = true;
                setRenaming(null);
                event.stopPropagation();
              }
            }}
            onBlur={() => {
              if (!committedRef.current) commitRename(renamingTitle);
            }}
            theme={{ caret: theme.foreground }}
            style={{
              flexGrow: 1,
              minWidth: 0,
              height: 22,
              paddingLeft: 2,
              paddingRight: 2,
              borderRadius: RADIUS.sm,
              borderWidth: 1,
              borderColor: alpha(theme.foreground, 0.35),
              color: theme.foreground,
              fontSize: 14,
              fontWeight: 500,
              fontFamily: FONTS.sans,
              backgroundColor: "#00000000",
            }}
          />
        ) : (
          <ActionMenu<ThreadActionMenuId>
            open={menuOpen}
            onOpenChange={setMenuOpen}
            items={menu?.items ?? []}
            onSelect={(id) => void runThreadAction(id, actionContext)}
            testId="thread-title-menu"
            minWidth={198}
            rootStyle={{ minWidth: 0, flexShrink: 1 }}
            trigger={
              <Tooltip content={thread.title}>
                <div
                  testId="thread-title"
                  onClick={onTitleClick}
                  onMouseEnter={() => setTitleHovered(true)}
                  onMouseLeave={() => setTitleHovered(false)}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    minWidth: 0,
                    flexShrink: 1,
                    cursor: "pointer",
                    borderRadius: RADIUS.sm,
                  }}
                >
                  <BreadcrumbText color={theme.foreground}>{thread.title}</BreadcrumbText>
                  <Icon name="chevron-down" size={14} color={theme.mutedForeground} opacity={titleHovered || menuOpen ? 1 : 0} />
                </div>
              </Tooltip>
            }
          />
        )}
      </div>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && confirm) {
            confirm.resolve(false);
            setConfirm(null);
          }
        }}
        title={confirm?.title ?? ""}
        {...(confirm?.description ? { description: confirm.description } : {})}
        width={448}
        testId="thread-action-confirm"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                confirm?.resolve(false);
                setConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={confirm?.destructive ? "destructive" : "default"}
              size="sm"
              testId="thread-action-confirm-ok"
              onClick={() => {
                confirm?.resolve(true);
                setConfirm(null);
              }}
            >
              {confirm?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      />
    </div>
  );
}
