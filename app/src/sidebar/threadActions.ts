// Thread lifecycle actions, ported from apps/web/src/hooks/useThreadActions.ts,
// hooks/showThreadUndoNotice.ts and the attempt* handlers in components/Sidebar.tsx.
// They are plain functions over the app registry instead of hooks, so the
// sidebar, the keybindings and the palette share one implementation.
import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { canSnooze, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { AuthSourceControlWriteScope, type EnvironmentId, type ScopedThreadRef, type ThreadId } from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { startNewThread } from "../palette/actions.ts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  environmentProjects,
  environmentServerConfigsAtom,
  environmentThreadShells,
  threadEnvironment,
} from "../state/environment.ts";
import { vcsEnvironment } from "../state/git.ts";
import {
  markThreadUnreadLocally,
  markThreadVisitedLocally,
  readCanOperate,
  routeRowThreadKeyAtom,
  routeThreadKeyAtom,
  sidebarClientSettingsAtom,
  sidebarThreadListAtom,
} from "../state/sidebar.ts";
import { routeAtom } from "../state/ui.ts";
import { legacySidebarEnabledAtom, legacyVisibleThreadKeysAtom } from "../state/legacySidebar.ts";
import { toast } from "../ui/toast.tsx";
import {
  getFallbackThreadIdAfterDelete,
  pinOrderKeyBetween,
  resolveAdjacentThreadId,
  shouldNavigateAfterThreadPark,
  type ThreadTraversalDirection,
} from "../web/components/Sidebar.logic.ts";
import { requestConfirmDialog as requestConfirm } from "../dialogs/confirmDialog.ts";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../web/worktreeCleanup.ts";
import { readEnvironmentScope } from "../web/state/session.ts";
import { writeClipboardText } from "./clipboard.ts";

type Result = AtomCommandResult<unknown, unknown>;

// ── Plumbing ────────────────────────────────────────────────────────────

class ThreadActionError extends Error {}

function failure(message: string): Result {
  return AsyncResult.failure(Cause.fail(new ThreadActionError(message)));
}

function run<I, A, E>(
  command: AtomCommand<{ readonly environmentId: EnvironmentId; readonly input: I }, A, E>,
  environmentId: EnvironmentId,
  input: I,
): Promise<Result> {
  if (!readCanOperate(environmentId)) {
    return Promise.resolve(failure("This connection cannot change threads or projects."));
  }
  return runAtomCommand(appAtomRegistry, command, { environmentId, input }, { reportFailure: false });
}

function capability(
  environmentId: EnvironmentId,
  name:
    | "threadSettlement"
    | "threadSnooze"
    | "threadPinning"
    | "threadPinReorder"
    | "threadActiveReorder"
    | "threadAutoSettleOptOut"
    | "threadVisitedTracking"
    | "threadTitleRegeneration",
): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities[
      name
    ] === true
  );
}

export function readThreadShell(ref: ScopedThreadRef): EnvironmentThreadShell | null {
  return appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref)) ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

/** Toast a failed command unless it was interrupted. Returns whether it succeeded. */
export function reportResult(result: Result, title: string): boolean {
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) {
    toast({ type: "error", title, description: errorMessage(squashAtomCommandFailure(result)) });
  }
  return false;
}

// ── Navigation ──────────────────────────────────────────────────────────

export function navigateToThread(ref: ScopedThreadRef): void {
  appAtomRegistry.set(routeAtom, {
    kind: "thread",
    environmentId: ref.environmentId,
    threadId: ref.threadId,
  });
}

function navigateToNewThread(environmentId: EnvironmentId, projectId: string): void {
  startNewThread(scopeProjectRef(environmentId, projectId as never));
}

// ── Undo notice (hooks/showThreadUndoNotice.ts) ─────────────────────────

export type ThreadUndoAction = "Settled" | "Snoozed" | "Unpinned" | "Archived" | "Discarded";

type UndoOptions = {
  action: ThreadUndoAction;
  undo: () => Promise<Result>;
  failureTitle: string;
  claim: ReturnType<typeof ThreadUndo.begin>;
};

export interface ThreadUndoNotice {
  readonly action: ThreadUndoAction;
  readonly count: number;
  readonly undo: () => Promise<void>;
}

export const threadUndoNoticeAtom = Atom.make<ThreadUndoNotice | null>(null).pipe(Atom.keepAlive);

let liveUndos: UndoOptions[] = [];
let undoExpiry: ReturnType<typeof setTimeout> | undefined;

function refreshUndoNotice() {
  liveUndos = liveUndos.filter(({ claim }) => claim.isCurrent());
  const latest = liveUndos.at(-1);
  if (!latest) {
    clearTimeout(undoExpiry);
    appAtomRegistry.set(threadUndoNoticeAtom, null);
    return;
  }
  const group: UndoOptions[] = [];
  for (let index = liveUndos.length - 1; index >= 0; index--) {
    const entry = liveUndos[index]!;
    if (entry.action !== latest.action) break;
    group.push(entry);
  }
  appAtomRegistry.set(threadUndoNoticeAtom, {
    action: latest.action,
    count: group.length,
    undo: async () => {
      const current = group.filter((entry) => liveUndos.includes(entry) && entry.claim.isCurrent());
      liveUndos = liveUndos.filter((entry) => !group.includes(entry));
      // Consume every claim before awaiting, so repeated clicks or shortcuts
      // cannot restore the same group twice.
      for (const entry of current) entry.claim.finish();
      refreshUndoNotice();
      await Promise.all(
        current.map(async ({ undo, failureTitle }) => {
          try {
            reportResult(await undo(), failureTitle);
          } catch (error) {
            toast({ type: "error", title: failureTitle, description: errorMessage(error) });
          }
        }),
      );
    },
  });
}

ThreadUndo.subscribe(refreshUndoNotice);

/**
 * showThreadUndoNotice.ts shortcutClaimed: from a notice appearing until the next other
 * keypress, mod+Z undoes the thread action even in a text field.
 */
let shortcutClaimed = false;

export function threadUndoClaimsShortcut(): boolean {
  return shortcutClaimed && appAtomRegistry.get(threadUndoNoticeAtom) !== null;
}

/** Called on any other keypress; hands mod+Z back to text fields. */
export function releaseThreadUndoShortcut(): void {
  shortcutClaimed = false;
}

function showThreadUndoNotice(options: UndoOptions) {
  if (!options.claim.isCurrent()) return;
  liveUndos.push(options);
  shortcutClaimed = true;
  refreshUndoNotice();
  clearTimeout(undoExpiry);
  undoExpiry = setTimeout(() => {
    const expired = liveUndos;
    liveUndos = [];
    for (const { claim } of expired) claim.finish();
    refreshUndoNotice();
  }, 5_000);
}

/** mod+Z: undo the notice's actions. Returns false when there is nothing to undo. */
export function undoLatestThreadAction(): boolean {
  const notice = appAtomRegistry.get(threadUndoNoticeAtom);
  if (!notice) return false;
  void notice.undo();
  return true;
}

// ── Commands (hooks/useThreadActions.ts) ────────────────────────────────

function topOfPinnedRunOrderKey(): string | undefined {
  let firstKey: string | null = null;
  for (const shell of appAtomRegistry.get(environmentThreadShells.quietThreadShellsAtom)) {
    if (shell.pinnedAt == null || shell.pinOrderKey == null) continue;
    if (firstKey === null || shell.pinOrderKey < firstKey) firstKey = shell.pinOrderKey;
  }
  return pinOrderKeyBetween(null, firstKey) ?? undefined;
}

function markVisited(target: ScopedThreadRef, visitedAt: string) {
  if (capability(target.environmentId, "threadVisitedTracking")) {
    void run(threadEnvironment.visit, target.environmentId, {
      threadId: target.threadId,
      visitedAt,
    });
    return;
  }
  markThreadVisitedLocally(scopedThreadKey(target), visitedAt);
}

export function acknowledgeThreadWoke(target: ScopedThreadRef, wokeAt: string): void {
  markVisited(target, wokeAt);
}

export function markThreadUnread(target: ScopedThreadRef): void {
  if (capability(target.environmentId, "threadVisitedTracking")) {
    void run(threadEnvironment.markUnread, target.environmentId, { threadId: target.threadId });
    return;
  }
  markThreadUnreadLocally(scopedThreadKey(target), readThreadShell(target)?.latestRun?.completedAt);
}

export async function unsettleThread(target: ScopedThreadRef): Promise<Result> {
  if (!capability(target.environmentId, "threadSettlement")) {
    return failure("This environment's server does not support settling yet. Update the server to use Settle.");
  }
  ThreadUndo.invalidate("settle", scopedThreadKey(target));
  // reason "user" pins the thread active: auto-settle (PR merged /
  // inactivity) stays suppressed until real activity clears the pin.
  return run(threadEnvironment.unsettle, target.environmentId, {
    threadId: target.threadId,
    reason: "user",
  });
}

export async function unsnoozeThread(target: ScopedThreadRef): Promise<Result> {
  if (!capability(target.environmentId, "threadSnooze")) {
    return failure("This environment's server does not support snoozing yet. Update the server to use Snooze.");
  }
  ThreadUndo.invalidate("snooze", scopedThreadKey(target));
  return run(threadEnvironment.unsnooze, target.environmentId, {
    threadId: target.threadId,
    reason: "user",
  });
}

export async function pinThread(
  target: ScopedThreadRef,
  opts: { readonly orderKey?: string } = {},
): Promise<Result> {
  if (!capability(target.environmentId, "threadPinning")) {
    return failure("This environment's server does not support pinning yet. Update the server to use Pin.");
  }
  // orderKey rides only to servers that decode it; pre-reorder servers get the bare pin.
  const orderKey = capability(target.environmentId, "threadPinReorder")
    ? (opts.orderKey ?? topOfPinnedRunOrderKey())
    : undefined;
  ThreadUndo.invalidate("pin", scopedThreadKey(target));
  // Pinning clears snooze, so older Settled or Snoozed undos would fight this pin.
  ThreadUndo.invalidate("settle", scopedThreadKey(target));
  ThreadUndo.invalidate("snooze", scopedThreadKey(target));
  return run(threadEnvironment.pin, target.environmentId, {
    threadId: target.threadId,
    ...(orderKey !== undefined ? { orderKey } : {}),
  });
}

export async function reorderPinnedThread(target: ScopedThreadRef, orderKey: string): Promise<Result> {
  if (!capability(target.environmentId, "threadPinReorder")) {
    return failure("This environment's server does not support reordering pins yet. Update the server to reorder.");
  }
  ThreadUndo.invalidate("pin", scopedThreadKey(target));
  return run(threadEnvironment.reorderPin, target.environmentId, { threadId: target.threadId, orderKey });
}

export async function reorderActiveThread(target: ScopedThreadRef, orderKey: string): Promise<Result> {
  if (!capability(target.environmentId, "threadActiveReorder")) {
    return failure("This environment's server does not support reordering threads yet. Update the server to reorder.");
  }
  return run(threadEnvironment.reorderActive, target.environmentId, { threadId: target.threadId, orderKey });
}

export async function unpinThread(target: ScopedThreadRef): Promise<Result> {
  if (!capability(target.environmentId, "threadPinning")) {
    return failure("This environment's server does not support pinning yet. Update the server to use Pin.");
  }
  const undoPlan = ThreadUndo.planThreadUndo("unpin", readThreadShell(target));
  const action = ThreadUndo.begin("pin", scopedThreadKey(target));
  const result = await run(threadEnvironment.unpin, target.environmentId, {
    threadId: target.threadId,
  });
  if (result._tag === "Success" && action.isCurrent()) {
    showThreadUndoNotice({
      action: "Unpinned",
      claim: action,
      undo: () => runUndoPlan(target, undoPlan),
      failureTitle: "Failed to undo unpin",
    });
  } else {
    action.finish();
  }
  return result;
}

export async function settleThread(target: ScopedThreadRef): Promise<Result> {
  if (!capability(target.environmentId, "threadSettlement")) {
    return failure("This environment's server does not support settling yet. Update the server to use Settle.");
  }
  const thread = readThreadShell(target);
  const wokeAt = thread ? threadWokeAt(thread, { now: new Date().toISOString() }) : null;
  const undoPlan = ThreadUndo.planThreadUndo("settle", thread);
  // An older unpin/snooze Undo would re-pin or re-snooze, and the server
  // treats either as a promotion that un-settles; settling supersedes them.
  ThreadUndo.invalidate("pin", scopedThreadKey(target));
  ThreadUndo.invalidate("snooze", scopedThreadKey(target));
  const action = ThreadUndo.begin("settle", scopedThreadKey(target));
  const result = await run(threadEnvironment.settle, target.environmentId, {
    threadId: target.threadId,
  });
  if (result._tag !== "Success") {
    action.finish();
    return result;
  }
  if (wokeAt !== null) markThreadVisitedLocally(scopedThreadKey(target), wokeAt);
  showThreadUndoNotice({
    action: "Settled",
    claim: action,
    undo: () => runUndoPlan(target, undoPlan),
    failureTitle: "Failed to undo settle",
  });
  return result;
}

export async function snoozeThread(target: ScopedThreadRef, snoozedUntil: string): Promise<Result> {
  if (!capability(target.environmentId, "threadSnooze")) {
    return failure("This environment's server does not support snoozing yet. Update the server to use Snooze.");
  }
  const thread = readThreadShell(target);
  if (thread && !canSnooze(thread, { now: new Date().toISOString() })) {
    return failure("This thread is waiting on you. Respond to the pending request before snoozing it.");
  }
  const action = ThreadUndo.begin("snooze", scopedThreadKey(target));
  const result = await run(threadEnvironment.snooze, target.environmentId, {
    threadId: target.threadId,
    snoozedUntil,
  });
  if (result._tag !== "Success") {
    action.finish();
    return result;
  }
  showThreadUndoNotice({
    action: "Snoozed",
    claim: action,
    undo: () => runUndoPlan(target, ThreadUndo.planThreadUndo("snooze")),
    failureTitle: "Failed to wake thread",
  });
  return result;
}

export async function setThreadAutoSettle(target: ScopedThreadRef, enabled: boolean): Promise<Result> {
  if (!capability(target.environmentId, "threadAutoSettleOptOut")) {
    return failure(
      "This environment's server does not support turning auto-settle off per thread yet. Update the server to use it.",
    );
  }
  return run(threadEnvironment.setAutoSettle, target.environmentId, {
    threadId: target.threadId,
    enabled,
  });
}

function runUndoPlan(target: ScopedThreadRef, plan: ThreadUndo.ThreadUndoPlan): Promise<Result> {
  return ThreadUndo.executeThreadUndo(
    plan,
    async (step): Promise<Result> => {
      switch (step.action) {
        case "unsettle":
          return unsettleThread(target);
        case "unsnooze":
          return unsnoozeThread(target);
        case "pin":
          return pinThread(target, step.orderKey === undefined ? {} : { orderKey: step.orderKey });
        case "snooze":
          return run(threadEnvironment.snooze, target.environmentId, {
            threadId: target.threadId,
            snoozedUntil: step.snoozedUntil,
          });
      }
    },
    (result) => result._tag === "Success",
  );
}

export async function confirmAndUnpinThread(target: ScopedThreadRef): Promise<Result> {
  if (appAtomRegistry.get(sidebarClientSettingsAtom).confirmThreadUnpin) {
    const title = readThreadShell(target)?.title ?? "this thread";
    const confirmed = await requestConfirm(
      [`Unpin thread "${title}"?`, "This will move the thread out of your pinned section."].join("\n"),
    );
    if (!confirmed) return AsyncResult.success(undefined);
  }
  return unpinThread(target);
}

export async function unarchiveThread(
  target: ScopedThreadRef,
  opts: { readonly navigate?: boolean } = {},
): Promise<Result> {
  ThreadUndo.invalidate("archive", scopedThreadKey(target));
  const result = await run(threadEnvironment.unarchive, target.environmentId, {
    threadId: target.threadId,
  });
  if (result._tag === "Success" && opts.navigate) navigateToThread(target);
  return result;
}

export async function archiveThread(target: ScopedThreadRef): Promise<Result> {
  const thread = readThreadShell(target);
  if (!thread) return AsyncResult.success(undefined);
  if (!threadRuntimeCanArchive(thread.runtime)) {
    return failure("Cannot archive while the provider is active.");
  }
  const shouldNavigateToDraft = appAtomRegistry.get(routeThreadKeyAtom) === scopedThreadKey(target);
  const action = ThreadUndo.begin("archive", scopedThreadKey(target));
  const result = await run(threadEnvironment.archive, target.environmentId, {
    threadId: target.threadId,
  });
  if (result._tag === "Failure") {
    action.finish();
    return result;
  }
  const wokeAt = threadWokeAt(thread, { now: new Date().toISOString() });
  if (wokeAt !== null) markThreadVisitedLocally(scopedThreadKey(target), wokeAt);
  showThreadUndoNotice({
    action: "Archived",
    claim: action,
    undo: () => unarchiveThread(target, { navigate: shouldNavigateToDraft }),
    failureTitle: "Failed to undo archive",
  });
  if (shouldNavigateToDraft) navigateToNewThread(thread.environmentId, thread.projectId);
  return result;
}

/**
 * useThreadActions.deleteThread. When the thread is the last one using its worktree,
 * the worktree goes too: automatically under the `worktreeOnDelete` setting, otherwise
 * after asking. A bulk delete passes the keys already deleted, so a worktree shared
 * only among the selected threads counts as orphaned by the last of them.
 */
export async function deleteThread(
  target: ScopedThreadRef,
  opts: { readonly deletedThreadKeys?: ReadonlySet<string> } = {},
): Promise<Result> {
  const thread = readThreadShell(target);
  if (!thread) {
    return run(threadEnvironment.delete, target.environmentId, { threadId: target.threadId });
  }
  const threads = appAtomRegistry
    .get(environmentThreadShells.quietThreadShellsAtom)
    .filter((candidate) => candidate.environmentId === target.environmentId);
  const threadProject =
    appAtomRegistry
      .get(environmentProjects.projectsAtom)
      .find((project) => project.environmentId === target.environmentId && project.id === thread.projectId) ?? null;
  const deletedIds =
    opts.deletedThreadKeys && opts.deletedThreadKeys.size > 0
      ? new Set<ThreadId>(
          [...opts.deletedThreadKeys].flatMap((threadKey) => {
            const ref = parseScopedThreadKey(threadKey);
            return ref && ref.environmentId === target.environmentId ? [ref.threadId] : [];
          }),
        )
      : undefined;
  const survivingThreads =
    deletedIds && deletedIds.size > 0
      ? threads.filter((entry) => entry.id === target.threadId || !deletedIds.has(entry.id))
      : threads;
  const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, target.threadId);
  const displayWorktreePath = orphanedWorktreePath ? formatWorktreePathForDisplay(orphanedWorktreePath) : null;
  const environmentConfig = appAtomRegistry.get(environmentServerConfigsAtom).get(target.environmentId);
  const canDeleteWorktree =
    orphanedWorktreePath !== null &&
    threadProject !== null &&
    !isScratchProject(threadProject, environmentConfig?.scratchWorkspaceRoot) &&
    readEnvironmentScope(target.environmentId, AuthSourceControlWriteScope);
  const automaticWorktreeCleanup = environmentConfig?.settings
    ? resolveWorktreeCleanup(environmentConfig.settings, thread.projectId).worktreeOnDelete
    : false;
  let shouldDeleteWorktree = canDeleteWorktree && automaticWorktreeCleanup;
  if (canDeleteWorktree && !automaticWorktreeCleanup) {
    shouldDeleteWorktree = await requestConfirm(
      [
        "This thread is the only one linked to this worktree:",
        displayWorktreePath ?? orphanedWorktreePath,
        "",
        "Delete the worktree too?",
      ].join("\n"),
      { variant: "destructive" },
    );
  }

  if (thread.runtime !== null) {
    await run(threadEnvironment.stopSession, target.environmentId, { threadId: target.threadId });
  }
  const shouldNavigateToFallback =
    appAtomRegistry.get(routeThreadKeyAtom) === scopedThreadKey(target);
  const fallbackThreadId = getFallbackThreadIdAfterDelete({
    threads,
    deletedThreadId: target.threadId,
    ...(deletedIds ? { deletedThreadIds: deletedIds } : {}),
    sortOrder: appAtomRegistry.get(sidebarClientSettingsAtom).sidebarThreadSortOrder,
  });
  const result = await run(threadEnvironment.delete, target.environmentId, {
    threadId: target.threadId,
  });
  if (result._tag === "Failure") return result;
  if (shouldNavigateToFallback) {
    appAtomRegistry.set(
      routeAtom,
      fallbackThreadId
        ? { kind: "thread", environmentId: target.environmentId, threadId: fallbackThreadId }
        : { kind: "home" },
    );
  }
  if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) return result;

  const removeResult: Result = readEnvironmentScope(target.environmentId, AuthSourceControlWriteScope)
    ? await runAtomCommand(
        appAtomRegistry,
        vcsEnvironment.removeWorktree,
        {
          environmentId: target.environmentId,
          input: { cwd: threadProject.workspaceRoot, path: orphanedWorktreePath, force: true },
        },
        { reportFailure: false },
      )
    : failure("This connection can no longer remove worktrees.");
  const refreshResult: Result | null =
    removeResult._tag === "Success"
      ? await runAtomCommand(
          appAtomRegistry,
          vcsEnvironment.refreshStatus,
          { environmentId: target.environmentId, input: { cwd: threadProject.workspaceRoot } },
          { reportFailure: false },
        )
      : null;
  const cleanupFailure =
    removeResult._tag === "Failure" ? removeResult : refreshResult?._tag === "Failure" ? refreshResult : null;
  if (cleanupFailure) {
    const removalFailed = removeResult._tag === "Failure";
    const message = errorMessage(squashAtomCommandFailure(cleanupFailure));
    console.error("Worktree cleanup failed after thread deletion", {
      threadId: target.threadId,
      projectCwd: threadProject.workspaceRoot,
      worktreePath: orphanedWorktreePath,
    });
    toast({
      type: "error",
      title: removalFailed ? "Failed to delete worktree" : "Worktree deleted, but Git status refresh failed",
      description: removalFailed
        ? `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`
        : message,
    });
    // The thread was deleted; the cleanup failure has its own toast.
  }
  return result;
}

export async function renameThread(
  target: ScopedThreadRef,
  title: string,
  originalTitle: string,
): Promise<void> {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    toast({ type: "warning", title: "Thread title cannot be empty" });
    return;
  }
  if (trimmed === originalTitle) return;
  reportResult(
    await run(threadEnvironment.updateMetadata, target.environmentId, {
      threadId: target.threadId,
      title: trimmed,
    }),
    "Failed to rename thread",
  );
}

export async function regenerateThreadTitle(target: ScopedThreadRef): Promise<void> {
  reportResult(
    await run(threadEnvironment.updateMetadata, target.environmentId, {
      threadId: target.threadId,
      regenerateTitle: true,
    }),
    "Failed to regenerate thread title",
  );
}

export async function copyToClipboard(
  text: string,
  copied: { readonly title: string; readonly failureTitle: string },
): Promise<void> {
  try {
    await writeClipboardText(text);
    toast({ type: "success", title: copied.title, description: text });
  } catch (error) {
    toast({ type: "error", title: copied.failureTitle, description: errorMessage(error) });
  }
}

// ── Sidebar flows: park and advance (components/Sidebar.tsx) ────────────

const settlingThreadKeys = new Set<string>();
const snoozingThreadKeys = new Set<string>();

/** A settle in flight (button, drop, or sweep): a second one for the same row is dropped. */
export function isThreadSettling(threadKey: string): boolean {
  return settlingThreadKeys.has(threadKey);
}

export function markThreadSettling(threadKey: string, settling: boolean): void {
  if (settling) settlingThreadKeys.add(threadKey);
  else settlingThreadKeys.delete(threadKey);
}

/**
 * Callers snapshot the plan BEFORE the command mutates the partition;
 * background parks never navigate (null plan).
 */
export function planForwardNavigation(
  threadKey: string,
  coParkingKeys?: ReadonlySet<string>,
): (() => void) | null {
  if (appAtomRegistry.get(routeThreadKeyAtom) !== threadKey) return null;
  const list = appAtomRegistry.get(sidebarThreadListAtom);
  const shell = list.threadByKey.get(threadKey);
  const orderedKeys = list.orderedThreadKeys;
  const currentIndex = orderedKeys.indexOf(threadKey);
  const parked = (key: string) => {
    const section = list.sectionByThreadKey.get(key);
    return section === "settled" || section === "snoozed";
  };
  const nextCardKey =
    currentIndex === -1
      ? null
      : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
          (key) => !parked(key) && !coParkingKeys?.has(key),
        ) ?? null);
  const nextThread = nextCardKey ? list.threadByKey.get(nextCardKey) : null;
  return nextThread
    ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
    : shell
      ? () => navigateToNewThread(shell.environmentId, shell.projectId)
      : () => appAtomRegistry.set(routeAtom, { kind: "home" });
}

export function attemptSettle(
  threadRef: ScopedThreadRef,
  opts: { readonly coSettlingKeys?: ReadonlySet<string> } = {},
): void {
  void (async () => {
    const threadKey = scopedThreadKey(threadRef);
    if (settlingThreadKeys.has(threadKey)) return;
    settlingThreadKeys.add(threadKey);
    const navigateAfterSettle = planForwardNavigation(threadKey, opts.coSettlingKeys);
    const result = await settleThread(threadRef);
    settlingThreadKeys.delete(threadKey);
    if (!reportResult(result, "Failed to settle thread")) return;
    if (
      shouldNavigateAfterThreadPark({
        threadKey,
        currentThreadKey: appAtomRegistry.get(routeThreadKeyAtom),
        action: "settle",
        now: new Date().toISOString(),
        thread: readThreadShell(threadRef),
      })
    ) {
      navigateAfterSettle?.();
    }
  })();
}

export function attemptUnsettle(threadRef: ScopedThreadRef): void {
  void unsettleThread(threadRef).then((result) => reportResult(result, "Failed to un-settle thread"));
}

export function attemptUnsnooze(threadRef: ScopedThreadRef): void {
  void unsnoozeThread(threadRef).then((result) => reportResult(result, "Failed to wake thread"));
}

export function attemptPin(threadRef: ScopedThreadRef): void {
  void pinThread(threadRef).then((result) => reportResult(result, "Failed to pin thread"));
}

export function attemptUnpin(threadRef: ScopedThreadRef): void {
  void confirmAndUnpinThread(threadRef).then((result) =>
    reportResult(result, "Failed to unpin thread"),
  );
}

export function attemptSnooze(threadRef: ScopedThreadRef, snoozedUntil: string): void {
  void (async () => {
    const threadKey = scopedThreadKey(threadRef);
    if (snoozingThreadKeys.has(threadKey)) return;
    snoozingThreadKeys.add(threadKey);
    const navigateAfterSnooze = planForwardNavigation(threadKey);
    const result = await snoozeThread(threadRef, snoozedUntil);
    snoozingThreadKeys.delete(threadKey);
    if (!reportResult(result, "Failed to snooze thread")) return;
    if (
      shouldNavigateAfterThreadPark({
        threadKey,
        currentThreadKey: appAtomRegistry.get(routeThreadKeyAtom),
        action: "snooze",
        now: new Date().toISOString(),
        thread: readThreadShell(threadRef),
      })
    ) {
      navigateAfterSnooze?.();
    }
  })();
}

export async function attemptArchive(threadRef: ScopedThreadRef): Promise<void> {
  const thread = readThreadShell(threadRef);
  if (!thread) return;
  if (appAtomRegistry.get(sidebarClientSettingsAtom).confirmThreadArchive) {
    if (!(await requestConfirm(`Archive thread "${thread.title}"?`))) return;
  }
  reportResult(await archiveThread(threadRef), "Failed to archive thread");
}

export async function attemptDelete(threadRef: ScopedThreadRef): Promise<void> {
  const thread = readThreadShell(threadRef);
  if (!thread) return;
  if (appAtomRegistry.get(sidebarClientSettingsAtom).confirmThreadDelete) {
    const confirmed = await requestConfirm(
      [
        `Delete thread "${thread.title}"?`,
        "This permanently clears conversation history for this thread.",
      ].join("\n"),
      { variant: "destructive" },
    );
    if (!confirmed) return;
  }
  reportResult(await deleteThread(threadRef), "Failed to delete thread");
}

// ── Keyboard helpers (for src/keybindings) ──────────────────────────────

/** The rendered sidebar rows in order: the legacy tree's when that setting is on. */
function traversalThreadKeys(): ReadonlyArray<string> {
  return appAtomRegistry.get(legacySidebarEnabledAtom)
    ? appAtomRegistry.get(legacyVisibleThreadKeysAtom)
    : appAtomRegistry.get(sidebarThreadListAtom).orderedThreadKeys;
}

/** thread.previous / thread.next (mod+shift+[ / ]): walk the rendered sidebar order. */
export function navigateAdjacentThread(direction: ThreadTraversalDirection): boolean {
  const targetKey = resolveAdjacentThreadId({
    threadIds: traversalThreadKeys(),
    currentThreadId: appAtomRegistry.get(routeRowThreadKeyAtom),
    direction,
  });
  const ref = targetKey ? parseScopedThreadKey(targetKey) : null;
  if (!ref) return false;
  navigateToThread(ref);
  return true;
}

/** thread.jump.N (mod+1..9): `index` is zero-based. */
export function navigateToThreadAtIndex(index: number): boolean {
  const key = traversalThreadKeys()[index];
  const ref = key ? parseScopedThreadKey(key) : null;
  if (!ref) return false;
  navigateToThread(ref);
  return true;
}

function routeThreadRef(): ScopedThreadRef | null {
  const route = appAtomRegistry.get(routeAtom);
  return route.kind === "thread" ? scopeThreadRef(route.environmentId, route.threadId) : null;
}

/** thread.settle (mod+shift+S): settle the open thread and move to the next card. */
export function settleAndAdvance(): boolean {
  const ref = routeThreadRef();
  if (!ref) return false;
  const thread = readThreadShell(ref);
  if (!thread) return false;
  if (thread.settledOverride === "settled") attemptUnsettle(ref);
  else attemptSettle(ref);
  return true;
}

/** thread.pin (mod+shift+P): pin or unpin the open thread. */
export function togglePinOpenThread(): boolean {
  const ref = routeThreadRef();
  if (!ref) return false;
  const thread = readThreadShell(ref);
  if (!thread) return false;
  if (thread.pinnedAt != null) attemptUnpin(ref);
  else attemptPin(ref);
  return true;
}
