// "Run in terminal" on a chat shell block: web useChatTerminalActions
// runShellCommand, which runs the block as a one-off project script. The
// command goes to an idle drawer terminal of the thread (the active one
// first), or a new one, at the thread's worktree or project root, and is
// typed with a carriage return so it lands in the shell's history.
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthTerminalOperateScope, AuthTerminalReadScope, type ScopedThreadRef, type TerminalSummary } from "@t3tools/contracts";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentThreadShells, projectIndexAtom } from "../../state/environment.ts";
import {
  allocateTerminalId,
  openTerminalSession,
  readEnvironmentScope,
  terminalEnvironment,
  terminalUiActions,
  terminalUiStateAtom,
  writeTerminal,
} from "../../state/terminal.ts";
import { toast } from "../../ui/toast.tsx";
import { waitForAtomValue } from "../../web/state/waitForAtomValue.ts";

/** web lib/projectScriptTerminal.ts findReusableProjectScriptTerminal. */
function findReusableProjectScriptTerminal(input: {
  readonly drawerTerminalIds: ReadonlyArray<string>;
  readonly activeTerminalId: string;
  readonly runningTerminalIds: ReadonlyArray<string>;
}): string | null {
  const idle = input.drawerTerminalIds.filter((terminalId) => !input.runningTerminalIds.includes(terminalId));
  if (idle.includes(input.activeTerminalId)) return input.activeTerminalId;
  return idle[0] ?? null;
}

/**
 * web terminalUiStateStore ensureTerminal({ open: true, active: true }): put the
 * terminal in the thread's drawer if it is not there yet, make it active, and
 * open the drawer.
 */
export function ensureDrawerTerminal(threadKey: string, terminalId: string) {
  if (!appAtomRegistry.get(terminalUiStateAtom(threadKey)).terminalIds.includes(terminalId)) {
    terminalUiActions.newTerminal(threadKey, terminalId);
  }
  terminalUiActions.setActive(threadKey, terminalId);
  terminalUiActions.setOpen(threadKey, true);
}

/** The environment's terminal summaries, waiting briefly for the stream's first snapshot. */
async function readTerminalSummaries(threadRef: ScopedThreadRef): Promise<ReadonlyArray<TerminalSummary> | null> {
  if (!readEnvironmentScope(threadRef.environmentId, AuthTerminalReadScope)) return null;
  const atom = terminalEnvironment.metadata({ environmentId: threadRef.environmentId, input: null });
  const ready = await waitForAtomValue({
    registry: appAtomRegistry,
    atom,
    predicate: (result) => result._tag === "Success",
    timeoutMs: 1500,
  });
  if (!ready) return null;
  return Option.getOrNull(AsyncResult.value(appAtomRegistry.get(atom))) as ReadonlyArray<TerminalSummary> | null;
}

function failed(error: unknown) {
  toast({
    type: "error",
    title: "Could not run the command",
    description: error instanceof Error ? error.message : "An unexpected error occurred.",
  });
}

export async function runShellCommandInTerminal(threadRef: ScopedThreadRef, command: string): Promise<void> {
  if (!readEnvironmentScope(threadRef.environmentId, AuthTerminalOperateScope)) {
    toast({ type: "error", title: "Cannot run commands", description: "Pair this client again with permission to run terminal commands." });
    return;
  }
  const shell = appAtomRegistry.get(environmentThreadShells.threadShellAtom(threadRef));
  const project = shell ? appAtomRegistry.get(projectIndexAtom).get(`${threadRef.environmentId}:${shell.projectId}`) : undefined;
  if (!shell || !project) return;
  const threadKey = scopedThreadKey(threadRef);
  const worktreePath = shell.worktreePath ?? null;
  const location = { cwd: projectScriptCwd({ project: { cwd: project.workspaceRoot }, worktreePath }), worktreePath };
  const summaries = await readTerminalSummaries(threadRef);
  const serverIds = (summaries ?? []).filter((summary) => summary.threadId === threadRef.threadId).map((summary) => summary.terminalId);
  const ui = appAtomRegistry.get(terminalUiStateAtom(threadKey));
  const reusable =
    summaries === null
      ? null
      : findReusableProjectScriptTerminal({
          drawerTerminalIds: [...new Set([...ui.terminalIds, ...serverIds])],
          activeTerminalId: ui.activeTerminalId,
          runningTerminalIds: summaries.filter((summary) => summary.hasRunningSubprocess).map((summary) => summary.terminalId),
        });
  const terminalId = reusable ?? allocateTerminalId([...ui.terminalIds, ...serverIds], summaries !== null);
  ensureDrawerTerminal(threadKey, terminalId);
  const opened = await openTerminalSession(
    {
      threadRef,
      threadKey,
      projectRoot: project.workspaceRoot,
      projectTitle: project.title,
      location,
      runtimeEnv: projectScriptRuntimeEnv({ project: { cwd: project.workspaceRoot }, worktreePath }),
    },
    terminalId,
    location,
  );
  if (opened._tag === "Failure") {
    if (!isAtomCommandInterrupted(opened)) failed(squashAtomCommandFailure(opened));
    return;
  }
  const written = await writeTerminal(threadRef.environmentId, threadRef.threadId, terminalId, `${command}\r`);
  if (written._tag === "Failure" && !isAtomCommandInterrupted(written)) failed(squashAtomCommandFailure(written));
}
