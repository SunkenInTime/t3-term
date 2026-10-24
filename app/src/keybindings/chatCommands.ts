// Chat-route commands web runs from ChatView (useChatShortcuts commands and fallback,
// useOpenFavoriteEditorShortcut, useRightPanelActions), as plain functions over the
// app registry for the window dispatcher. Each returns false to let the key through,
// as web's handlers do.
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  deriveThreadStructureRuntime,
  threadRuntimeHasInterruptibleRun,
} from "@t3tools/client-runtime/state/thread-execution";
import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  EDITORS,
  type EditorId,
  type EnvironmentId,
  type KeybindingCommand,
  type ProjectScript,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { projectScriptTerminalInput, resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { interruptComposerTurn } from "../chat/composer/composerSend.ts";
import { readRemoteOpenState } from "../chat/details/WorkspaceRows.tsx";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { readComposerDraft, composerTargetKey } from "../state/composer.ts";
import { environmentProjects, environmentThreads, serverEnvironment, shellEnvironment } from "../state/environment.ts";
import { lastInvokedScriptPref, preferredEditorPref, scriptTerminalEnvironment } from "../state/git.ts";
import { rightPanelMaximizedAtom, rightPanelOpenAtom, routeAtom, terminalOpenAtom, type Route } from "../state/ui.ts";
import { toast } from "../ui/toast.tsx";
import { rightPanelSheetAtom } from "../ui/viewport.tsx";
import { derivePhase } from "../web/session-logic.ts";
import { projectScriptIdFromCommand } from "../web/projectScripts.ts";
import { readEnvironmentScope } from "../web/state/session.ts";
import { readThreadShell } from "../palette/actions.ts";

// ── Route reads ─────────────────────────────────────────────────────────

/** The route's thread, when it is one (drafts have no server thread yet). */
export function readRouteThreadRef(route: Route = appAtomRegistry.get(routeAtom)): ScopedThreadRef | null {
  return route.kind === "thread" ? scopeThreadRef(route.environmentId, route.threadId) : null;
}

/** The composer draft key of the route's thread or draft (state/composer.ts composerTargetKey). */
export function readRouteComposerKey(route: Route = appAtomRegistry.get(routeAtom)): string | null {
  if (route.kind === "thread") {
    return composerTargetKey({ kind: "thread", environmentId: route.environmentId, threadId: route.threadId });
  }
  if (route.kind === "draft") {
    return composerTargetKey({
      kind: "draft",
      environmentId: route.environmentId,
      projectId: route.projectId,
      ...(route.draftId ? { draftId: route.draftId } : {}),
    });
  }
  return null;
}

export function readRouteComposerPrompt(): string {
  const key = readRouteComposerKey();
  return key === null ? "" : readComposerDraft(key).prompt;
}

/** The route's project with its environment, and the thread when there is one. */
function readRouteWorkspace(): {
  readonly environmentId: EnvironmentId;
  readonly project: EnvironmentProject;
  readonly worktreePath: string | null;
  readonly threadRef: ScopedThreadRef | null;
} | null {
  const route = appAtomRegistry.get(routeAtom);
  if (route.kind !== "thread" && route.kind !== "draft") return null;
  if (route.environmentId === null) return null;
  const threadRef = readRouteThreadRef(route);
  const shell = threadRef ? readThreadShell(threadRef) : null;
  const projectId = route.kind === "draft" ? route.projectId : shell?.projectId;
  if (!projectId) return null;
  const project = appAtomRegistry
    .get(environmentProjects.projectsAtom)
    .find((candidate) => candidate.environmentId === route.environmentId && candidate.id === projectId);
  if (!project) return null;
  const draftKey = readRouteComposerKey(route);
  const worktreePath = shell ? shell.worktreePath : draftKey ? (readComposerDraft(draftKey).worktreePath ?? null) : null;
  return { environmentId: route.environmentId, project, worktreePath, threadRef };
}

/** web projectScriptCwd: the worktree when the thread has one, else the project root (gitCwd). */
function workspaceCwd(workspace: NonNullable<ReturnType<typeof readRouteWorkspace>>): string {
  return workspace.worktreePath ?? workspace.project.workspaceRoot;
}

type ThreadStructureRuntime = ReturnType<typeof deriveThreadStructureRuntime>;

const runtimeByProjection = new WeakMap<object, ThreadStructureRuntime>();

/** ChatView serverRuntime: the run structure of the open thread's projection. */
export function readThreadRuntime(threadRef: ScopedThreadRef): ThreadStructureRuntime | null {
  const state = appAtomRegistry.get(environmentThreads.stateAtom(threadRef.environmentId, threadRef.threadId));
  const projection = Option.getOrNull(Option.flatMap(AsyncResult.value(state), (value) => value.data));
  if (!projection) return null;
  // Deriving walks the runs; the projection object changes only when the thread does.
  let runtime = runtimeByProjection.get(projection);
  if (runtime === undefined) {
    runtime = deriveThreadStructureRuntime(projection);
    runtimeByProjection.set(projection, runtime);
  }
  return runtime;
}

/** `when: "turnRunning"`: ChatView `phase === "running"`. */
export function isRouteTurnRunning(): boolean {
  const threadRef = readRouteThreadRef();
  return threadRef !== null && derivePhase(readThreadRuntime(threadRef)) === "running";
}

// ── thread.stop ─────────────────────────────────────────────────────────

/** ChatView "thread.stop": interrupt the open thread's run while it can be interrupted. */
export function stopRouteThread(isHeld: boolean): boolean {
  const threadRef = readRouteThreadRef();
  if (!threadRef || !readThreadShell(threadRef)) return false;
  if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return false;
  const runtime = readThreadRuntime(threadRef);
  // deriveCanInterruptRunningThread
  if (derivePhase(runtime) !== "running" && !threadRuntimeHasInterruptibleRun(runtime)) return false;
  if (!isHeld) void interruptComposerTurn(threadRef.environmentId, threadRef.threadId);
  return true;
}

// ── rightPanel.toggleMaximized ──────────────────────────────────────────

/** useRightPanelActions.toggleRightPanelMaximized: only an open, inline (not sheet) panel maximizes. */
export function toggleRightPanelMaximized(isHeld: boolean): boolean {
  if (appAtomRegistry.get(routeAtom).kind !== "thread") return false;
  if (!isHeld && appAtomRegistry.get(rightPanelOpenAtom) && !appAtomRegistry.get(rightPanelSheetAtom)) {
    appAtomRegistry.set(rightPanelMaximizedAtom, !appAtomRegistry.get(rightPanelMaximizedAtom));
  }
  return true;
}

// ── editor.openFavorite ─────────────────────────────────────────────────

/** usePreferredEditor: the last editor used while the server still offers it, else the first it offers. */
function preferredEditor(available: ReadonlyArray<EditorId>): EditorId | null {
  const last = appAtomRegistry.get(preferredEditorPref.atom) as EditorId | "";
  if (last && available.includes(last)) return last;
  return EDITORS.find((editor) => available.includes(editor.id))?.id ?? null;
}

/**
 * useOpenFavoriteEditorShortcut: open the thread's workspace in the preferred editor. Only
 * where the server's machine is this one (remote-open mode "local-exec"); over a remote
 * connection the key passes through, as in web.
 */
export function openFavoriteEditor(isHeld: boolean): boolean {
  if (isHeld) return false;
  const workspace = readRouteWorkspace();
  if (!workspace) return false;
  if (readRemoteOpenState(workspace.environmentId).mode !== "local-exec") return false;
  const config = appAtomRegistry.get(serverEnvironment.configValueAtom(workspace.environmentId));
  const editor = preferredEditor(config?.availableEditors ?? []);
  if (!editor) return false;
  void runAtomCommand(
    appAtomRegistry,
    shellEnvironment.openInEditor,
    { environmentId: workspace.environmentId, input: { cwd: workspaceCwd(workspace), editor } },
    { reportFailure: false },
  ).then((result) => {
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toast({ type: "error", title: "Unable to open in editor", description: error instanceof Error ? error.message : "An error occurred." });
    }
  });
  return true;
}

// ── script.<id>.run ─────────────────────────────────────────────────────

function scriptFailure(
  script: ProjectScript,
  result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
): void {
  if (isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toast({ type: "error", title: `Failed to run script "${script.name}"`, description: error instanceof Error ? error.message : "" });
}

/**
 * Runs a project script the way the thread details' script menu does: a new script
 * terminal in the thread's workspace, then the drawer opens on it.
 */
async function runProjectScript(
  workspace: NonNullable<ReturnType<typeof readRouteWorkspace>>,
  script: ProjectScript,
): Promise<void> {
  const { environmentId, project, threadRef } = workspace;
  if (!threadRef) {
    toast({ type: "info", title: `Send a message first to run "${script.name}"`, description: "Scripts run in the thread's terminal." });
    return;
  }
  lastInvokedScriptPref.set({ ...(appAtomRegistry.get(lastInvokedScriptPref.atom) as Record<string, string>), [project.id]: script.id });
  const terminalId = `script-${script.id}-${Date.now().toString(36)}`;
  const opened = (await runAtomCommand(
    appAtomRegistry,
    scriptTerminalEnvironment.open,
    {
      environmentId,
      input: {
        threadId: threadRef.threadId,
        terminalId,
        cwd: workspaceCwd(workspace),
        worktreePath: workspace.worktreePath,
        cols: 120,
        rows: 30,
      },
    } as never,
    { reportFailure: false },
  )) as AtomCommandResult<unknown, unknown>;
  if (opened._tag === "Failure") {
    scriptFailure(script, opened);
    return;
  }
  const written = (await runAtomCommand(
    appAtomRegistry,
    scriptTerminalEnvironment.write,
    { environmentId, input: { threadId: threadRef.threadId, terminalId, data: projectScriptTerminalInput(script.command) } } as never,
    { reportFailure: false },
  )) as AtomCommandResult<unknown, unknown>;
  if (written._tag === "Failure") {
    scriptFailure(script, written);
    return;
  }
  appAtomRegistry.set(terminalOpenAtom, true);
}

/** ChatView's useChatShortcuts fallback: a `script.<id>.run` command runs that project script. */
export function runProjectScriptCommand(command: KeybindingCommand, isHeld: boolean): boolean {
  const scriptId = projectScriptIdFromCommand(command);
  if (!scriptId) return false;
  const workspace = readRouteWorkspace();
  if (!workspace || !readEnvironmentScope(workspace.environmentId, AuthTerminalOperateScope)) return false;
  const settings = appAtomRegistry.get(serverEnvironment.configValueAtom(workspace.environmentId))?.settings;
  const scripts = settings ? resolveProjectScripts(settings, workspace.project) : workspace.project.scripts;
  const script = scripts.find((entry) => entry.id === scriptId);
  if (!script) return false;
  if (!isHeld) void runProjectScript(workspace, script);
  return true;
}

