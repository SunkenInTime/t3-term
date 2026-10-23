// App actions shared by the command palette, global keybindings, the draft view
// and empty states. Ports of the web hooks they replace:
//   useHandleNewThread / startNewThreadFromContext (lib/chatThreadActions.ts)
//   useScratchProject (hooks/useScratchProject.ts)
//   Sidebar thread traversal (components/Sidebar.tsx onWindowKeyDown)
// A web "draft" is a client-side thread-to-be; in t3-term it is the
// `{kind:"draft", environmentId, projectId}` route, and the composer launches it.
import { scopeProjectRef, scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import type { EnvironmentProject, EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import {
  getThreadSortTimestamp,
  sortActiveThreadsByOrderKey,
  sortPinnedThreadsByOrderKey,
  toSortableTimestamp,
} from "@t3tools/client-runtime/state/thread-sort";
import type {
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  ServerConfig,
  ThreadId,
} from "@t3tools/contracts";
import { resolveThreadReferenceCopyTarget } from "@t3tools/shared/threadReference";

import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  environmentCatalog,
  environmentProjects,
  environmentThreadShells,
  projectEnvironment,
  serverEnvironment,
  threadEnvironment,
} from "../state/environment.ts";
import { sidebarThreadOrderAtom } from "../state/keybindings.ts";
import { environmentPresentations } from "../state/navigation.ts";
import { routeAtom } from "../state/ui.ts";
import { toast } from "../ui/toast.tsx";
import { writeTextToClipboard } from "./clipboard.ts";

// ── Reads ───────────────────────────────────────────────────────────────

export interface RouteContext {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly projectId: ProjectId | null;
  readonly isDraft: boolean;
}

export function readThreadShell(ref: ScopedThreadRef): EnvironmentThreadShell | null {
  return appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref));
}

/** Where the user is: the route's thread (and its project) or draft project. */
export function readRouteContext(): RouteContext {
  const route = appAtomRegistry.get(routeAtom);
  if (route.kind === "thread") {
    const shell = readThreadShell(scopeThreadRef(route.environmentId, route.threadId));
    return {
      environmentId: route.environmentId,
      threadId: route.threadId,
      projectId: shell?.projectId ?? null,
      isDraft: false,
    };
  }
  if (route.kind === "draft") {
    return {
      environmentId: route.environmentId,
      threadId: null,
      projectId: route.projectId,
      isDraft: true,
    };
  }
  return { environmentId: null, threadId: null, projectId: null, isDraft: false };
}

export function readProjects(): ReadonlyArray<EnvironmentProject> {
  return appAtomRegistry.get(environmentProjects.projectsAtom);
}

export function readThreads(): ReadonlyArray<EnvironmentThreadShell> {
  return appAtomRegistry.get(environmentThreadShells.navigationThreadShellsAtom);
}

export function readServerConfig(environmentId: EnvironmentId | null): ServerConfig | null {
  return environmentId === null ? null : appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId));
}

export function readEnvironmentIds(): ReadonlyArray<EnvironmentId> {
  return [...appAtomRegistry.get(environmentCatalog.catalogValueAtom).entries.keys()] as EnvironmentId[];
}

export function readConnectionPhase(environmentId: EnvironmentId | null) {
  if (environmentId === null) return null;
  return appAtomRegistry.get(environmentPresentations.presentationAtom(environmentId))?.connection.phase ?? null;
}

/**
 * Projects by latest thread activity (web's sortProjectsByActivity with the
 * default "updated_at" order), ties by title.
 */
export function sortProjectsByActivity<P extends Pick<EnvironmentProject, "environmentId" | "id" | "title" | "createdAt"> & { readonly updatedAt?: string | null }>(
  projects: ReadonlyArray<P>,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): P[] {
  const latestByProject = new Map<string, number>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const key = `${thread.environmentId}:${thread.projectId}`;
    const timestamp = getThreadSortTimestamp(thread, "updated_at");
    latestByProject.set(key, Math.max(latestByProject.get(key) ?? Number.NEGATIVE_INFINITY, timestamp));
  }
  return projects
    .map((project) => ({
      project,
      timestamp:
        latestByProject.get(`${project.environmentId}:${project.id}`) ??
        toSortableTimestamp(project.updatedAt ?? project.createdAt) ??
        Number.NEGATIVE_INFINITY,
    }))
    .sort(
      (left, right) =>
        (right.timestamp === left.timestamp ? 0 : right.timestamp > left.timestamp ? 1 : -1) ||
        left.project.title.localeCompare(right.project.title) ||
        left.project.environmentId.localeCompare(right.project.environmentId) ||
        left.project.id.localeCompare(right.project.id),
    )
    .map(({ project }) => project);
}

/** The project new threads go to when the route names none: the most recently active one. */
export function readDefaultProjectRef(): ScopedProjectRef | null {
  const project = sortProjectsByActivity(
    readProjects().filter((candidate) => candidate.isScratch !== true),
    readThreads(),
  )[0];
  return project ? scopeProjectRef(project.environmentId, project.id) : null;
}

/** resolveThreadActionProjectRef: the route's project, else the default. */
export function readContextualProjectRef(): ScopedProjectRef | null {
  const context = readRouteContext();
  if (context.environmentId !== null && context.projectId !== null) {
    return scopeProjectRef(context.environmentId, context.projectId);
  }
  return readDefaultProjectRef();
}

// ── Navigation ──────────────────────────────────────────────────────────

export function openThread(ref: Pick<ScopedThreadRef, "environmentId" | "threadId">): void {
  appAtomRegistry.set(routeAtom, { kind: "thread", environmentId: ref.environmentId, threadId: ref.threadId });
}

/** handleNewThread: open the draft for a project. */
export function startNewThread(projectRef: ScopedProjectRef): void {
  appAtomRegistry.set(routeAtom, {
    kind: "draft",
    environmentId: projectRef.environmentId,
    projectId: projectRef.projectId,
  });
}

/** startNewThreadFromContext. Returns false when there is no project to start in. */
export function startNewThreadFromContext(): boolean {
  const projectRef = readContextualProjectRef();
  if (!projectRef) return false;
  startNewThread(projectRef);
  return true;
}

export function reportError(title: string, error: unknown): void {
  toast({
    type: "error",
    title,
    description: error instanceof Error && error.message.trim() ? error.message : "An error occurred.",
  });
}

// ── Scratch ("without a project") ───────────────────────────────────────

export function scratchWorkspaceRootFor(environmentId: EnvironmentId | null): string | null {
  if (environmentId === null) return null;
  return availableScratchWorkspaceRoot(readConnectionPhase(environmentId), readServerConfig(environmentId));
}

/** useScratchProject.scratchEnvironmentId */
export function scratchEnvironmentId(current: EnvironmentId | null): EnvironmentId | null {
  if (current !== null) return scratchWorkspaceRootFor(current) !== null ? current : null;
  const offering = readEnvironmentIds().filter((id) => scratchWorkspaceRootFor(id) !== null);
  return offering.length === 1 ? (offering[0] ?? null) : null;
}

export async function openScratchProject(
  environmentId: EnvironmentId,
  failureTitle = "Could not start without a project",
): Promise<EnvironmentProject | null> {
  const result = await runAtomCommand(appAtomRegistry, projectEnvironment.openScratch, {
    environmentId,
    input: {},
  });
  if (result._tag === "Success") return result.value;
  if (!isAtomCommandInterrupted(result)) reportError(failureTitle, squashAtomCommandFailure(result));
  return null;
}

export async function startScratchThread(environmentId: EnvironmentId): Promise<void> {
  const project = await openScratchProject(environmentId);
  if (project) startNewThread(scopeProjectRef(project.environmentId, project.id));
}

/** chat.newWithoutProject target: the route's environment, else the only one offering scratch. */
export function readScratchTargetEnvironmentId(): EnvironmentId | null {
  return scratchEnvironmentId(readRouteContext().environmentId);
}

// ── Thread traversal (thread.previous/next, Mod+1..9) ───────────────────

function threadKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/**
 * The sidebar's visible order. The sidebar publishes it to sidebarThreadOrderAtom;
 * without that, pinned then active threads in the sidebar's sort.
 */
export function readThreadNavigationOrder(): ReadonlyArray<string> {
  const published = appAtomRegistry.get(sidebarThreadOrderAtom);
  if (published) return published;
  const now = new Date().toISOString();
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  for (const thread of readThreads()) {
    const capabilities = readServerConfig(thread.environmentId)?.environment.capabilities;
    if (capabilities?.threadSnooze === true && effectiveSnoozed(thread, { now })) continue;
    if (capabilities?.threadSettlement === true && thread.settledOverride === "settled") continue;
    (thread.pinnedAt != null ? pinned : active).push(thread);
  }
  return [...sortPinnedThreadsByOrderKey(pinned), ...sortActiveThreadsByOrderKey(active)].map(threadKey);
}

function openThreadKey(key: string | undefined): boolean {
  if (!key) return false;
  const thread = readThreads().find((candidate) => threadKey(candidate) === key);
  if (!thread) return false;
  openThread({ environmentId: thread.environmentId, threadId: thread.id });
  return true;
}

export function navigateAdjacentThread(direction: "previous" | "next"): boolean {
  const order = readThreadNavigationOrder();
  if (order.length === 0) return false;
  const context = readRouteContext();
  const currentKey =
    context.environmentId !== null && context.threadId !== null
      ? scopedThreadKey(scopeThreadRef(context.environmentId, context.threadId))
      : null;
  const index = currentKey === null ? -1 : order.indexOf(currentKey);
  // resolveAdjacentThreadId: from no current thread, previous starts at the end.
  const nextIndex =
    index === -1
      ? direction === "next"
        ? 0
        : order.length - 1
      : direction === "next"
        ? (index + 1) % order.length
        : (index - 1 + order.length) % order.length;
  return openThreadKey(order[nextIndex]);
}

export function jumpToThread(index: number): boolean {
  return openThreadKey(readThreadNavigationOrder()[index]);
}

// ── Active-thread actions ───────────────────────────────────────────────

export function readActiveThread(): EnvironmentThreadShell | null {
  const context = readRouteContext();
  if (context.environmentId === null || context.threadId === null) return null;
  return readThreadShell(scopeThreadRef(context.environmentId, context.threadId));
}

/** thread.copyReference: the thread's current PR link, else its id. */
export function readActiveThreadReferenceCopyTarget() {
  const thread = readActiveThread();
  if (!thread) return null;
  return resolveThreadReferenceCopyTarget({
    threadId: thread.id,
    pullRequests: thread.pullRequests,
    linkedPullRequestUrl: thread.linkedPullRequest?.url ?? thread.branchPullRequest?.url ?? null,
  });
}

export async function copyActiveThreadReference(): Promise<void> {
  const target = readActiveThreadReferenceCopyTarget();
  if (target === null) return;
  const copied = await writeTextToClipboard(target.value);
  if (copied) {
    toast({ type: "success", title: target.successTitle, description: target.value });
  } else {
    toast({ type: "error", title: target.failureTitle, description: "The system clipboard is unavailable." });
  }
}

export async function toggleActiveThreadSettled(): Promise<void> {
  const thread = readActiveThread();
  if (!thread) return;
  if (readServerConfig(thread.environmentId)?.environment.capabilities.threadSettlement !== true) return;
  const settled = thread.settledOverride === "settled";
  const result = settled
    ? await runAtomCommand(appAtomRegistry, threadEnvironment.unsettle, {
        environmentId: thread.environmentId,
        input: { threadId: thread.id, reason: "user" },
      })
    : await runAtomCommand(appAtomRegistry, threadEnvironment.settle, {
        environmentId: thread.environmentId,
        input: { threadId: thread.id },
      });
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    reportError(settled ? "Failed to unsettle thread" : "Failed to settle thread", squashAtomCommandFailure(result));
  }
}

export async function toggleActiveThreadPinned(): Promise<void> {
  const thread = readActiveThread();
  if (!thread) return;
  if (readServerConfig(thread.environmentId)?.environment.capabilities.threadPinning !== true) return;
  const pinned = thread.pinnedAt != null;
  const result = pinned
    ? await runAtomCommand(appAtomRegistry, threadEnvironment.unpin, {
        environmentId: thread.environmentId,
        input: { threadId: thread.id },
      })
    : await runAtomCommand(appAtomRegistry, threadEnvironment.pin, {
        environmentId: thread.environmentId,
        input: { threadId: thread.id },
      });
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    reportError(pinned ? "Failed to unpin thread" : "Failed to pin thread", squashAtomCommandFailure(result));
  }
}
