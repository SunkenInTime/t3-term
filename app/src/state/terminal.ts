// Terminal sessions (server) and terminal drawer layout (client) per thread.
// Server side: client-runtime's terminal atom families, wired like
// apps/web/src/state/terminal.ts. Client side: the drawer's terminal ids,
// groups and height, the port of apps/web/src/terminalUiStateStore.ts.
//
// The shared `terminalOpenAtom` (header toggle, mod+J) is the drawer's
// visibility for the routed thread. Web keeps `terminalOpen` per thread, so
// this module mirrors the two: a route change loads the thread's own flag
// into the shared atom, and a toggle writes it back to the routed thread.
// Without that, opening the drawer once would start a shell in every thread
// visited afterwards.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  combineTerminalSessionState,
  createTerminalEnvironmentAtoms,
  EMPTY_TERMINAL_BUFFER_STATE,
  type KnownTerminalSession,
} from "@t3tools/client-runtime/state/terminal";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  type AuthEnvironmentScope,
  type EnvironmentId,
  type ScopedThreadRef,
  sessionGrantsScope,
  ThreadId,
  type TerminalSummary,
} from "@t3tools/contracts";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { nextTerminalId } from "@t3tools/shared/terminalLabels";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime, appAtomRegistry } from "../runtime/runtime.ts";
import * as Ui from "../web/terminalUiStateStore.ts";
import { environmentSession, environmentThreadShells, projectIndexAtom } from "./environment.ts";
import { isRecord, persistedAtom } from "./persistedAtom.ts";
import { routeAtom, terminalOpenAtom } from "./ui.ts";

export const terminalEnvironment = createTerminalEnvironmentAtoms(connectionAtomRuntime);

export type { ThreadTerminalUiState, ThreadTerminalGroup } from "../web/terminalUiStateStore.ts";
export { MAX_TERMINALS_PER_GROUP, DEFAULT_THREAD_TERMINAL_HEIGHT } from "../web/terminalUiStateStore.ts";

// ── Scopes ──────────────────────────────────────────────────────────────

const EMPTY_SESSION_STATE_ATOM = Atom.make(AsyncResult.initial(false));

export function useEnvironmentScope(environmentId: EnvironmentId | null, scope: AuthEnvironmentScope): boolean {
  const result = useAtomValue(
    environmentId === null
      ? (EMPTY_SESSION_STATE_ATOM as never as ReturnType<typeof environmentSession.sessionStateAtom>)
      : environmentSession.sessionStateAtom(environmentId),
  );
  const session = Option.getOrNull(AsyncResult.value(result));
  return result._tag !== "Failure" && session !== null && sessionGrantsScope(session, scope);
}

export function readEnvironmentScope(environmentId: EnvironmentId, scope: AuthEnvironmentScope): boolean {
  const result = appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId));
  const session = Option.getOrNull(AsyncResult.value(result));
  return result._tag !== "Failure" && session !== null && sessionGrantsScope(session, scope);
}

// ── Drawer layout per thread ────────────────────────────────────────────

function decodeUiStates(raw: unknown): Record<string, Ui.ThreadTerminalUiState> {
  if (!isRecord(raw)) return {};
  const result: Record<string, Ui.ThreadTerminalUiState> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value) || !Array.isArray(value.terminalIds) || !Array.isArray(value.terminalGroups)) continue;
    result[key] = Ui.normalizeThreadTerminalUiState({
      terminalOpen: value.terminalOpen === true,
      terminalHeight: typeof value.terminalHeight === "number" ? value.terminalHeight : Ui.DEFAULT_THREAD_TERMINAL_HEIGHT,
      terminalIds: value.terminalIds.filter((id): id is string => typeof id === "string"),
      activeTerminalId: typeof value.activeTerminalId === "string" ? value.activeTerminalId : "",
      terminalGroups: (value.terminalGroups as unknown[]).flatMap((group) =>
        isRecord(group) && typeof group.id === "string" && Array.isArray(group.terminalIds)
          ? [
              {
                id: group.id,
                terminalIds: group.terminalIds.filter((id): id is string => typeof id === "string"),
                ...(group.splitDirection === "vertical" ? { splitDirection: "vertical" as const } : {}),
              },
            ]
          : [],
      ),
      activeTerminalGroupId: typeof value.activeTerminalGroupId === "string" ? value.activeTerminalGroupId : "",
    });
  }
  return result;
}

export const terminalUiStatesAtom = persistedAtom("terminal-state", {}, decodeUiStates);

/** Ids the user closed, kept out of reconciliation until the server forgets them. */
const suppressedTerminalIdsAtom = Atom.make<Record<string, readonly string[]>>({}).pipe(Atom.keepAlive);

export const terminalUiStateAtom = Atom.family((threadKey: string) =>
  Atom.make((get) => get(terminalUiStatesAtom)[threadKey] ?? Ui.DEFAULT_THREAD_TERMINAL_UI_STATE),
);

function setSuppressed(threadKey: string, terminalId: string, suppressed: boolean) {
  appAtomRegistry.update(suppressedTerminalIdsAtom, (current) => {
    const ids = current[threadKey] ?? [];
    if (ids.includes(terminalId) === suppressed) return current;
    const next = suppressed ? [...ids, terminalId] : ids.filter((id) => id !== terminalId);
    if (next.length > 0) return { ...current, [threadKey]: next };
    const { [threadKey]: _removed, ...rest } = current;
    return rest;
  });
}

function updateTerminalUi(
  threadKey: string,
  updater: (state: Ui.ThreadTerminalUiState) => Ui.ThreadTerminalUiState,
): Ui.ThreadTerminalUiState {
  let next: Ui.ThreadTerminalUiState = Ui.DEFAULT_THREAD_TERMINAL_UI_STATE;
  appAtomRegistry.update(terminalUiStatesAtom, (states) => {
    const current = states[threadKey] ?? Ui.DEFAULT_THREAD_TERMINAL_UI_STATE;
    next = updater(current);
    if (next === current) return states;
    if (Ui.isDefaultThreadTerminalUiState(next)) {
      if (!(threadKey in states)) return states;
      const { [threadKey]: _removed, ...rest } = states;
      return rest;
    }
    return { ...states, [threadKey]: next };
  });
  return next;
}

function routedThreadKey(): string | null {
  const route = appAtomRegistry.get(routeAtom);
  return route.kind === "thread" ? scopedThreadKey({ environmentId: route.environmentId, threadId: route.threadId }) : null;
}

/** Keeps the shared toggle equal to the routed thread's own drawer flag. */
function syncSharedOpen(threadKey: string, state: Ui.ThreadTerminalUiState) {
  if (routedThreadKey() === threadKey && appAtomRegistry.get(terminalOpenAtom) !== state.terminalOpen) {
    appAtomRegistry.set(terminalOpenAtom, state.terminalOpen);
  }
}

export const terminalUiActions = {
  setOpen(threadKey: string, open: boolean) {
    const before = appAtomRegistry.get(terminalUiStateAtom(threadKey));
    if (open && before.terminalIds.length === 0) setSuppressed(threadKey, Ui.DEFAULT_THREAD_TERMINAL_ID, false);
    syncSharedOpen(threadKey, updateTerminalUi(threadKey, (state) => Ui.setThreadTerminalOpen(state, open)));
  },
  setHeight(threadKey: string, height: number) {
    updateTerminalUi(threadKey, (state) => Ui.setThreadTerminalHeight(state, height));
  },
  split(threadKey: string, terminalId: string, direction: "horizontal" | "vertical" = "horizontal") {
    setSuppressed(threadKey, terminalId, false);
    updateTerminalUi(threadKey, (state) => Ui.splitThreadTerminal(state, terminalId, direction));
  },
  newTerminal(threadKey: string, terminalId: string) {
    setSuppressed(threadKey, terminalId, false);
    updateTerminalUi(threadKey, (state) => Ui.newThreadTerminal(state, terminalId));
  },
  setActive(threadKey: string, terminalId: string) {
    updateTerminalUi(threadKey, (state) => Ui.setThreadActiveTerminal(state, terminalId));
  },
  close(threadKey: string, terminalId: string) {
    setSuppressed(threadKey, terminalId, true);
    syncSharedOpen(threadKey, updateTerminalUi(threadKey, (state) => Ui.closeThreadTerminal(state, terminalId)));
  },
  reconcile(threadKey: string, serverIds: string[]) {
    const suppressed = new Set(appAtomRegistry.get(suppressedTerminalIdsAtom)[threadKey] ?? []);
    const nextIds = suppressed.size === 0 ? serverIds : serverIds.filter((id) => !suppressed.has(id));
    syncSharedOpen(threadKey, updateTerminalUi(threadKey, (state) => Ui.reconcileThreadTerminalSessionIds(state, nextIds)));
  },
};

// Route change: show the routed thread's own drawer state.
appAtomRegistry.subscribe(routeAtom, () => {
  const threadKey = routedThreadKey();
  if (threadKey === null) return;
  const open = appAtomRegistry.get(terminalUiStateAtom(threadKey)).terminalOpen;
  if (appAtomRegistry.get(terminalOpenAtom) !== open) appAtomRegistry.set(terminalOpenAtom, open);
});

// Toggle (header button, keybinding): record it on the routed thread.
appAtomRegistry.subscribe(terminalOpenAtom, (open) => {
  const threadKey = routedThreadKey();
  if (threadKey === null) return;
  if (appAtomRegistry.get(terminalUiStateAtom(threadKey)).terminalOpen === open) return;
  terminalUiActions.setOpen(threadKey, open);
});

// ── Focus context for global shortcuts ──────────────────────────────────

/** True while a terminal viewport has keyboard focus (keybinding context `terminalFocus`). */
export const terminalFocusAtom = Atom.make(false).pipe(Atom.keepAlive);

// ── Known sessions (apps/web/src/state/terminalSessions.ts) ─────────────

export function selectThreadSessions(
  metadata: ReadonlyArray<TerminalSummary> | null,
  environmentId: EnvironmentId,
  threadId: string,
): ReadonlyArray<KnownTerminalSession> | null {
  if (metadata === null) return null;
  const compare = new Intl.Collator(undefined, { numeric: true }).compare;
  return metadata
    .filter((summary) => summary.threadId === threadId)
    .toSorted((left, right) => compare(left.terminalId, right.terminalId))
    .map((summary) => ({
      target: { environmentId, threadId: ThreadId.make(summary.threadId), terminalId: summary.terminalId },
      state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
    }));
}

const EMPTY_METADATA_ATOM = Atom.make(AsyncResult.initial<ReadonlyArray<TerminalSummary>, never>(false));

/** Server-side terminal summaries for every thread in an environment; null until known. */
export function useTerminalMetadata(environmentId: EnvironmentId | null, canRead: boolean) {
  const result = useAtomValue(
    environmentId === null || !canRead
      ? (EMPTY_METADATA_ATOM as never as ReturnType<typeof terminalEnvironment.metadata>)
      : terminalEnvironment.metadata({ environmentId, input: null }),
  );
  return result._tag === "Failure" ? null : Option.getOrNull(AsyncResult.value(result));
}

// ── Launch context (apps/web/src/components/terminal/useThreadTerminalActions.ts) ──

export interface TerminalLaunchLocation {
  readonly cwd: string;
  readonly worktreePath: string | null;
}

export interface ThreadTerminalContext {
  readonly threadRef: ScopedThreadRef;
  readonly threadKey: string;
  readonly projectRoot: string;
  readonly projectTitle: string;
  readonly location: TerminalLaunchLocation;
  readonly runtimeEnv: Record<string, string>;
}

/** Where this thread's terminals start: its worktree, else the project root. */
export function useThreadTerminalContext(environmentId: EnvironmentId, threadId: ThreadId): ThreadTerminalContext | null {
  const threadRef = { environmentId, threadId } as ScopedThreadRef;
  const shell = useAtomValue(environmentThreadShells.threadShellAtom(threadRef));
  const projects = useAtomValue(projectIndexAtom);
  if (!shell) return null;
  const project = projects.get(`${environmentId}:${scopeProjectRef(environmentId, shell.projectId).projectId}`);
  if (!project) return null;
  const worktreePath = shell.worktreePath ?? null;
  return {
    threadRef,
    threadKey: scopedThreadKey(threadRef),
    projectRoot: project.workspaceRoot,
    projectTitle: project.title,
    location: {
      cwd: projectScriptCwd({ project: { cwd: project.workspaceRoot }, worktreePath }),
      worktreePath,
    },
    runtimeEnv: projectScriptRuntimeEnv({ project: { cwd: project.workspaceRoot }, worktreePath }),
  };
}

/** Allocates a terminal id unused by the server, the drawer and the panel. */
export function allocateTerminalId(usedIds: Iterable<string>, serverKnown: boolean): string {
  return nextTerminalId([...usedIds], serverKnown ? undefined : crypto.randomUUID());
}

/** Starts a session on the server. The caller records the id in its surface first, so the viewport mounts while it starts. */
export function openTerminalSession(context: ThreadTerminalContext, terminalId: string, location?: TerminalLaunchLocation) {
  const launch = location ?? context.location;
  return runAtomCommand(appAtomRegistry, terminalEnvironment.open, {
    environmentId: context.threadRef.environmentId,
    input: {
      threadId: context.threadRef.threadId,
      terminalId,
      cwd: launch.cwd,
      ...(launch.worktreePath !== null ? { worktreePath: launch.worktreePath } : {}),
      env: projectScriptRuntimeEnv({ project: { cwd: context.projectRoot }, worktreePath: launch.worktreePath }),
    },
  });
}

/** Ends a session and deletes its history. A failed close falls back to typing `exit`. */
export async function closeTerminalSession(threadRef: ScopedThreadRef, terminalId: string): Promise<void> {
  const input = { threadId: threadRef.threadId, terminalId };
  const result = await runAtomCommand(appAtomRegistry, terminalEnvironment.close, {
    environmentId: threadRef.environmentId,
    input: { ...input, deleteHistory: true },
  });
  if (result._tag === "Failure") {
    await runAtomCommand(appAtomRegistry, terminalEnvironment.write, {
      environmentId: threadRef.environmentId,
      input: { ...input, data: "exit\n" },
    });
  }
}

export function writeTerminal(environmentId: EnvironmentId, threadId: ThreadId, terminalId: string, data: string) {
  return runAtomCommand(appAtomRegistry, terminalEnvironment.write, {
    environmentId,
    input: { threadId, terminalId, data },
  });
}

export function resizeTerminal(environmentId: EnvironmentId, threadId: ThreadId, terminalId: string, cols: number, rows: number) {
  return runAtomCommand(appAtomRegistry, terminalEnvironment.resize, {
    environmentId,
    input: { threadId, terminalId, cols, rows },
  });
}
