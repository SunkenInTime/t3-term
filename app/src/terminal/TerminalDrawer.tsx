// The chat column's bottom terminal drawer for one thread: port of
// PersistentThreadTerminalDrawer (apps/web/src/components/PersistentThreadTerminals.tsx).
// ChatView mounts it while the drawer is open; sessions keep running on the
// server and reattach with their history when it opens again.
import { useAtomValue } from "@effect/atom-react";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { AuthTerminalOperateScope, AuthTerminalReadScope, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { rightPanelThreadStateAtom } from "../state/rightPanel.ts";
import {
  allocateTerminalId,
  closeTerminalSession,
  openTerminalSession,
  selectThreadSessions,
  terminalUiActions,
  terminalUiStateAtom,
  useEnvironmentScope,
  useTerminalMetadata,
  useThreadTerminalContext,
  type ThreadTerminalContext,
} from "../state/terminal.ts";
import { serverTerminalIdsStrictSubsetOfClient, terminalIdListsEqual } from "../web/terminalUiStateStore.ts";
import { ThreadTerminalDrawer, type TerminalLaunchLocation } from "./ThreadTerminalDrawer.tsx";

export function TerminalDrawer({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const context = useThreadTerminalContext(environmentId, threadId);
  if (!context) return null;
  return <PersistentThreadTerminalDrawer key={context.threadKey} context={context} />;
}

function PersistentThreadTerminalDrawer({ context }: { context: ThreadTerminalContext }) {
  const { threadRef, threadKey } = context;
  const environmentId = threadRef.environmentId;
  const canOperate = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const canRead = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  const ui = useAtomValue(terminalUiStateAtom(threadKey));
  const panel = useAtomValue(rightPanelThreadStateAtom(threadKey));
  const metadata = useTerminalMetadata(environmentId, canRead);
  const [focusRequestId, setFocusRequestId] = useState(1);

  // Opening the drawer on a thread without terminals starts `term-1`.
  useEffect(() => {
    if (!ui.terminalOpen) terminalUiActions.setOpen(threadKey, true);
  }, [threadKey]);

  const sessions = selectThreadSessions(metadata, environmentId, threadRef.threadId);
  const panelTerminalIds = new Set(panel.surfaces.flatMap((surface) => (surface.kind === "terminal" ? surface.terminalIds : [])));
  const drawerSessions = (sessions ?? []).filter((session) => !panelTerminalIds.has(session.target.terminalId));
  const serverOrderedIds = drawerSessions.map((session) => session.target.terminalId);
  const labels = new Map<string, string>();
  const locations = new Map<string, TerminalLaunchLocation>();
  for (const session of drawerSessions) {
    const summary = session.state.summary;
    labels.set(session.target.terminalId, resolveTerminalSessionLabel(session.target.terminalId, summary));
    if (summary) {
      locations.set(session.target.terminalId, {
        cwd: summary.cwd,
        worktreePath: summary.worktreePath,
        runtimeEnv: context.runtimeEnv,
      });
    }
  }

  const serverKey = serverOrderedIds.join("\n");
  useEffect(() => {
    if (sessions === null) return;
    if (terminalIdListsEqual(serverOrderedIds, ui.terminalIds)) return;
    if (serverTerminalIdsStrictSubsetOfClient(serverOrderedIds, ui.terminalIds)) return;
    terminalUiActions.reconcile(threadKey, serverOrderedIds);
  }, [serverKey, sessions === null, ui.terminalIds.join("\n")]);

  const usedIds = () => [
    ...(sessions ?? []).map((session) => session.target.terminalId),
    ...ui.terminalIds,
    ...panelTerminalIds,
  ];
  const launch = (place: (terminalId: string) => void) => {
    if (!canOperate) return;
    const terminalId = allocateTerminalId(usedIds(), sessions !== null);
    place(terminalId);
    setFocusRequestId((value) => value + 1);
    void openTerminalSession(context, terminalId);
  };

  return (
    <ThreadTerminalDrawer
      mode="drawer"
      environmentId={environmentId}
      threadId={threadRef.threadId}
      cwd={context.location.cwd}
      worktreePath={context.location.worktreePath}
      runtimeEnv={context.runtimeEnv}
      height={ui.terminalHeight}
      // Known-session order is MRU; the stored order keeps sidebar labels stable.
      terminalIds={canOperate ? ui.terminalIds : serverOrderedIds}
      activeTerminalId={ui.activeTerminalId}
      terminalGroups={ui.terminalGroups}
      activeTerminalGroupId={ui.activeTerminalGroupId}
      focusRequestId={focusRequestId}
      canOperate={canOperate}
      terminalLabelsById={labels}
      terminalLaunchLocationsById={locations}
      onSplitTerminal={() => launch((terminalId) => terminalUiActions.split(threadKey, terminalId))}
      onSplitTerminalVertical={() => launch((terminalId) => terminalUiActions.split(threadKey, terminalId, "vertical"))}
      onNewTerminal={() => launch((terminalId) => terminalUiActions.newTerminal(threadKey, terminalId))}
      onActiveTerminalChange={(terminalId) => {
        terminalUiActions.setActive(threadKey, terminalId);
        setFocusRequestId((value) => value + 1);
      }}
      onCloseTerminal={(terminalId) => {
        if (!canOperate) return;
        void closeTerminalSession(threadRef, terminalId);
        terminalUiActions.close(threadKey, terminalId);
        setFocusRequestId((value) => value + 1);
      }}
      onHeightChange={(height) => terminalUiActions.setHeight(threadKey, height)}
    />
  );
}
