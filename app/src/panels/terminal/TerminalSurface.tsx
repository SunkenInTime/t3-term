// Right panel terminal surface: port of PersistentThreadTerminalPanel
// (apps/web/src/components/PersistentThreadTerminals.tsx). One tab holds one
// split group; its terminals are separate from the drawer's.
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { AuthTerminalOperateScope, AuthTerminalReadScope, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { rightPanelActions, type RightPanelSurface } from "../../state/rightPanel.ts";
import {
  allocateTerminalId,
  closeTerminalSession,
  openTerminalSession,
  selectThreadSessions,
  terminalUiStateAtom,
  useEnvironmentScope,
  useTerminalMetadata,
  useThreadTerminalContext,
  type ThreadTerminalContext,
} from "../../state/terminal.ts";
import { ThreadTerminalDrawer, type TerminalLaunchLocation } from "../../terminal/ThreadTerminalDrawer.tsx";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { rightPanelThreadStateAtom } from "../../state/rightPanel.ts";

type TerminalPanelSurface = Extract<RightPanelSurface, { kind: "terminal" }>;

/** Every terminal id the thread uses anywhere, so a new id never attaches to an existing PTY. */
function usedTerminalIds(context: ThreadTerminalContext, serverIds: readonly string[]): string[] {
  const drawer = appAtomRegistry.get(terminalUiStateAtom(context.threadKey)).terminalIds;
  const panel = appAtomRegistry
    .get(rightPanelThreadStateAtom(context.threadKey))
    .surfaces.flatMap((surface) => (surface.kind === "terminal" ? surface.terminalIds : []));
  return [...serverIds, ...drawer, ...panel];
}

/** "Terminal" in the launcher and the add menu: a new tab with a new session. */
export function addTerminalSurface(context: ThreadTerminalContext, serverIds: readonly string[] | null): void {
  const terminalId = allocateTerminalId(usedTerminalIds(context, serverIds ?? []), serverIds !== null);
  rightPanelActions.openTerminal(context.threadKey, terminalId);
  void openTerminalSession(context, terminalId);
}

export function TerminalSurface({
  environmentId,
  threadId,
  surface,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  surface: TerminalPanelSurface;
}) {
  const context = useThreadTerminalContext(environmentId, threadId);
  const canOperate = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const canRead = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  const metadata = useTerminalMetadata(environmentId, canRead);
  const [focusRequestId, setFocusRequestId] = useState(1);
  if (!context) return null;

  const sessions = selectThreadSessions(metadata, environmentId, threadId);
  const serverIds = sessions?.map((session) => session.target.terminalId) ?? null;
  const labels = new Map<string, string>();
  const locations = new Map<string, TerminalLaunchLocation>();
  for (const terminalId of surface.terminalIds) {
    const summary = sessions?.find((session) => session.target.terminalId === terminalId)?.state.summary ?? null;
    labels.set(terminalId, resolveTerminalSessionLabel(terminalId, summary));
    if (summary) {
      locations.set(terminalId, { cwd: summary.cwd, worktreePath: summary.worktreePath, runtimeEnv: context.runtimeEnv });
    }
  }

  const split = (direction: "horizontal" | "vertical") => {
    if (!canOperate) return;
    const terminalId = allocateTerminalId(usedTerminalIds(context, serverIds ?? []), serverIds !== null);
    rightPanelActions.splitTerminal(context.threadKey, surface.id, terminalId, direction);
    setFocusRequestId((value) => value + 1);
    void openTerminalSession(context, terminalId);
  };

  return (
    <ThreadTerminalDrawer
      mode="panel"
      environmentId={environmentId}
      threadId={threadId}
      cwd={context.location.cwd}
      worktreePath={context.location.worktreePath}
      runtimeEnv={context.runtimeEnv}
      height={0}
      terminalIds={surface.terminalIds}
      activeTerminalId={surface.activeTerminalId}
      terminalGroups={[
        {
          id: surface.id,
          terminalIds: surface.terminalIds,
          ...(surface.splitDirection === "vertical" ? { splitDirection: "vertical" as const } : {}),
        },
      ]}
      activeTerminalGroupId={surface.id}
      focusRequestId={focusRequestId}
      canOperate={canOperate}
      terminalLabelsById={labels}
      terminalLaunchLocationsById={locations}
      onSplitTerminal={() => split("horizontal")}
      onSplitTerminalVertical={() => split("vertical")}
      onNewTerminal={() => {
        if (!canOperate) return;
        addTerminalSurface(context, serverIds);
      }}
      onActiveTerminalChange={(terminalId) => {
        rightPanelActions.activateTerminal(context.threadKey, surface.id, terminalId);
        setFocusRequestId((value) => value + 1);
      }}
      onCloseTerminal={(terminalId) => {
        if (!canOperate) return;
        void closeTerminalSession(context.threadRef, terminalId);
        rightPanelActions.closeTerminal(context.threadKey, surface.id, terminalId);
      }}
      onHeightChange={() => undefined}
      testIdPrefix={`panel-terminal-${surface.resourceId}`}
    />
  );
}
