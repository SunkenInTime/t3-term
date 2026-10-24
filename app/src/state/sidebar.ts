// Sidebar state: the thread partition (pinned / active / working / snoozed /
// settled) as atoms, so the keybindings and palette can traverse the same
// ordered list the sidebar renders, plus the sidebar's own UI state.
// Partition and ordering mirror apps/web/src/components/Sidebar.tsx
// (useSidebarThreads, partitionSidebarThreads).
import { clearComposerContent, composerDraftHasUserContent, composerDraftsAtom } from "./composer.ts";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentProject, EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import {
  createAssetEnvironmentAtoms,
  createProjectFaviconUrlAtomFamily,
} from "@t3tools/client-runtime/state/assets";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  buildProjectGroups,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { createInboxReturnTracker } from "@t3tools/client-runtime/state/thread-inbox";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import {
  createThreadSearchResultsAtomFamily,
  type ThreadSearchResultsState,
} from "@t3tools/client-runtime/state/thread-search";
import {
  AuthOrchestrationOperateScope,
  sessionGrantsScope,
  type EnvironmentId,
  type ProjectId,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { clientSettingsAtom } from "./clientSettings.ts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import { termHome } from "../runtime/paths.ts";
import {
  environmentCatalog,
  environmentServerConfigsAtom,
  environmentSession,
  environmentThreadShells,
  projectIndexAtom,
} from "./environment.ts";
import { routeAtom } from "./ui.ts";
import {
  applySidebarThreadDrop,
  filterSidebarV2VisibleThreads,
  firstValidTimestampMs,
  isSidebarThreadWorking,
  orderItemsByPreferredIds,
  resolveSidebarRowThreadId,
  resolveSidebarThreadSection,
  sortInboxThreadsByReturn,
  sortPinnedThreadsForSidebar,
  sortSidebarV2ProjectGroups,
  sortThreadsForSidebar,
  sortWorkingThreadsBySend,
  type SidebarSection,
} from "../web/components/Sidebar.logic.ts";

// ── Client settings ─────────────────────────────────────────────────────

/**
 * The client settings store (state/clientSettings.ts, apps/web/src/hooks/useSettings.ts);
 * the Settings pages write it and the sidebar re-renders from it.
 */
export const sidebarClientSettingsAtom = clientSettingsAtom;

// ── Persisted sidebar UI state (web: localStorage + uiStateStore) ────────

interface PersistedSidebarState {
  readonly settledExpanded: boolean;
  readonly snoozedExpanded: boolean;
  readonly workingExpanded: boolean;
  readonly projectScopeKey: string | null;
}

const PERSISTED_DEFAULTS: PersistedSidebarState = {
  settledExpanded: false,
  snoozedExpanded: false,
  workingExpanded: false,
  projectScopeKey: null,
};

function persistedStatePath(): string {
  return NodePath.join(termHome(), "sidebar-state.json");
}

function readPersistedState(): PersistedSidebarState {
  try {
    const parsed = JSON.parse(NodeFs.readFileSync(persistedStatePath(), "utf8")) as Partial<
      PersistedSidebarState
    >;
    return {
      settledExpanded: parsed.settledExpanded === true,
      snoozedExpanded: parsed.snoozedExpanded === true,
      workingExpanded: parsed.workingExpanded === true,
      projectScopeKey: typeof parsed.projectScopeKey === "string" ? parsed.projectScopeKey : null,
    };
  } catch {
    return PERSISTED_DEFAULTS;
  }
}

export const sidebarPersistedStateAtom = Atom.make<PersistedSidebarState>(readPersistedState()).pipe(
  Atom.keepAlive,
);

appAtomRegistry.subscribe(sidebarPersistedStateAtom, (state) => {
  try {
    NodeFs.mkdirSync(termHome(), { recursive: true });
    NodeFs.writeFileSync(persistedStatePath(), JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("Failed to persist sidebar state", error);
  }
});

export function updateSidebarPersistedState(patch: Partial<PersistedSidebarState>): void {
  appAtomRegistry.set(sidebarPersistedStateAtom, {
    ...appAtomRegistry.get(sidebarPersistedStateAtom),
    ...patch,
  });
}

/** Web's uiStateStore.threadLastVisitedAtById: only used when a server predates visited tracking. */
export const threadLocalLastVisitedAtAtom = Atom.make<ReadonlyMap<string, string>>(new Map<string, string>()).pipe(
  Atom.keepAlive,
);

export function markThreadVisitedLocally(threadKey: string, visitedAt: string): void {
  const current = appAtomRegistry.get(threadLocalLastVisitedAtAtom);
  const previous = current.get(threadKey);
  if (previous !== undefined && Date.parse(previous) >= Date.parse(visitedAt)) return;
  const next = new Map(current);
  next.set(threadKey, visitedAt);
  appAtomRegistry.set(threadLocalLastVisitedAtAtom, next);
}

export function markThreadUnreadLocally(threadKey: string, completedAt: string | null | undefined): void {
  const next = new Map(appAtomRegistry.get(threadLocalLastVisitedAtAtom));
  if (completedAt) {
    next.set(threadKey, new Date(Date.parse(completedAt) - 1).toISOString());
  } else {
    next.delete(threadKey);
  }
  appAtomRegistry.set(threadLocalLastVisitedAtAtom, next);
}

// ── Requests other areas implement ──────────────────────────────────────

/**
 * Web opens the command palette in a mode (`openCommandPalette({ open: "add-project" })`).
 * The palette reads this request, opens in that mode, and clears it.
 */
export type CommandPaletteModeRequest = {
  readonly open: "add-project" | "new-thread-in";
  readonly nonce: number;
};
export const commandPaletteModeRequestAtom = Atom.make<CommandPaletteModeRequest | null>(null).pipe(
  Atom.keepAlive,
);

/** Composer drafts with unsent content, published by the composer for the sidebar's draft block. */
export interface SidebarDraftEntry {
  readonly draftId: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** First line of the prompt, or "N attachments". */
  readonly preview: string;
  readonly createdAt: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
}
/** Drafts for new threads that hold unsent content, from the composer's draft store. */
export const sidebarDraftsAtom = Atom.make((get): ReadonlyArray<SidebarDraftEntry> => {
  const entries: SidebarDraftEntry[] = [];
  for (const [key, draft] of Object.entries(get(composerDraftsAtom))) {
    if (!key.startsWith("draft:") || !composerDraftHasUserContent(draft)) continue;
    const [, environmentId, projectId] = key.split(":");
    if (!environmentId || !projectId || environmentId === "-" || projectId === "-") continue;
    const firstLine = draft.prompt.trim().split(/\r?\n/)[0] ?? "";
    entries.push({
      draftId: key,
      environmentId: environmentId as EnvironmentId,
      projectId: projectId as ProjectId,
      preview:
        firstLine.length > 0
          ? firstLine
          : `${draft.attachments.length} attachment${draft.attachments.length === 1 ? "" : "s"}`,
      createdAt: draft.updatedAt ?? new Date(0).toISOString(),
      worktreePath: draft.worktreePath ?? null,
      branch: draft.branch ?? null,
    });
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // composerDraftsAtom changes on every keystroke in any composer; hand back the
  // previous array unless an entry changed, so the sidebar does not re-render.
  const previous = Option.getOrUndefined(get.self<ReadonlyArray<SidebarDraftEntry>>());
  return previous !== undefined && sameDraftEntries(previous, entries) ? previous : entries;
});
function sameDraftEntries(left: ReadonlyArray<SidebarDraftEntry>, right: ReadonlyArray<SidebarDraftEntry>): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index]!;
      return (
        entry.draftId === other.draftId &&
        entry.environmentId === other.environmentId &&
        entry.projectId === other.projectId &&
        entry.preview === other.preview &&
        entry.createdAt === other.createdAt &&
        entry.worktreePath === other.worktreePath &&
        entry.branch === other.branch
      );
    })
  );
}
/** Scoped thread keys (`env:thread`) whose composer holds an unsent draft. */
export const threadKeysWithUnsentDraftAtom = Atom.make((get): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const [key, draft] of Object.entries(get(composerDraftsAtom))) {
    if (key.startsWith("thread:") && composerDraftHasUserContent(draft)) keys.add(key.slice("thread:".length));
  }
  // Same set as before: keep its identity, so typing does not re-render every row.
  const previous = Option.getOrUndefined(get.self<ReadonlySet<string>>());
  return previous !== undefined && previous.size === keys.size && [...keys].every((key) => previous.has(key)) ? previous : keys;
});
/** The sidebar's discard buttons clear the composer draft they point at. */
export const sidebarDraftDiscardAtom = Atom.make<{
  readonly discardDraft: (draftId: string) => void;
  readonly discardThreadDraft: (threadRef: ScopedThreadRef) => void;
} | null>({
  discardDraft: (draftId) => clearComposerContent(draftId),
  discardThreadDraft: (threadRef) => clearComposerContent(`thread:${threadRef.environmentId}:${threadRef.threadId}`),
}).pipe(Atom.keepAlive);

// ── Environment lookups ─────────────────────────────────────────────────

/** The first registered environment is the one this client connected to. */
export const primaryEnvironmentIdAtom = Atom.make((get): EnvironmentId | null => {
  for (const environmentId of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    return environmentId;
  }
  return null;
});

export const environmentLabelByIdAtom = Atom.make((get) => {
  const labels = new Map<EnvironmentId, string>();
  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    labels.set(environmentId, config.environment.label);
  }
  return labels as ReadonlyMap<EnvironmentId, string>;
});

export const canOperateEnvironmentAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const state = get(environmentSession.sessionStateValueAtom(environmentId));
    return state === null ? true : sessionGrantsScope(state, AuthOrchestrationOperateScope);
  }),
);

export function readCanOperate(environmentId: EnvironmentId): boolean {
  return appAtomRegistry.get(canOperateEnvironmentAtom(environmentId));
}

export type SidebarCapabilities = ServerConfig["environment"]["capabilities"];

export function readCapabilities(environmentId: EnvironmentId): SidebarCapabilities | null {
  return appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment
    .capabilities ?? null;
}

export const sidebarProjectsAtom = Atom.make((get): ReadonlyArray<EnvironmentProject> => {
  const projects: EnvironmentProject[] = [];
  for (const [key, project] of get(projectIndexAtom)) {
    const environmentId = key.slice(0, key.indexOf(":")) as EnvironmentId;
    projects.push({ ...project, environmentId });
  }
  return projects;
});

export interface SidebarProjectGroup extends EnvironmentProject {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjects: ReadonlyArray<EnvironmentProject>;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

/** apps/web/src/hooks/useSidebarProjectGroups.ts over buildSidebarProjectSnapshots. */
export const sidebarProjectGroupsAtom = Atom.make((get): ReadonlyArray<SidebarProjectGroup> => {
  const settings = get(sidebarClientSettingsAtom);
  const groups = buildProjectGroups({
    projects: get(sidebarProjectsAtom),
    groupScratchProjects: true,
    settings: selectProjectGroupingSettings(settings),
    preferredEnvironmentId: get(primaryEnvironmentIdAtom),
  }).map((group): SidebarProjectGroup => {
    const members = group.members.map(({ project }) => project);
    const representative =
      members.find(
        (member) =>
          member.environmentId === group.representative.environmentId &&
          member.id === group.representative.id,
      ) ?? members[0]!;
    return {
      ...representative,
      projectKey: group.key,
      displayName: group.label,
      memberProjects: members,
      memberProjectRefs: group.memberProjectRefs,
    };
  });
  return sortSidebarV2ProjectGroups(
    groups,
    get(environmentThreadShells.quietThreadShellsAtom),
    settings.sidebarProjectSortOrder,
  );
});

export const projectDisplayNameByKeyAtom = Atom.make((get) => {
  const names = new Map<string, string>();
  for (const group of get(sidebarProjectGroupsAtom)) {
    for (const project of group.memberProjects) {
      names.set(`${project.environmentId}:${project.id}`, group.displayName);
    }
  }
  return names as ReadonlyMap<string, string>;
});

export const projectByKeyAtom = Atom.make((get) => {
  const byKey = new Map<string, EnvironmentProject>();
  for (const project of get(sidebarProjectsAtom)) {
    byKey.set(`${project.environmentId}:${project.id}`, project);
  }
  return byKey as ReadonlyMap<string, EnvironmentProject>;
});

/** The persisted project scope, dropped when its group no longer exists. */
export const sidebarProjectScopeAtom = Atom.make((get): SidebarProjectGroup | null => {
  const key = get(sidebarPersistedStateAtom).projectScopeKey;
  if (key === null) return null;
  return get(sidebarProjectGroupsAtom).find((group) => group.projectKey === key) ?? null;
});

export function setSidebarProjectScopeKey(key: string | null): void {
  // A selection made under one scope can hold threads the next scope hides.
  clearThreadSelection();
  updateSidebarPersistedState({ projectScopeKey: key });
}

// ── Provider entries (web: sidebarProviderEntriesAtom) ──────────────────

export interface SidebarProviderEntry {
  readonly instanceId: string;
  readonly driverKind: string;
  readonly displayName: string;
  readonly accentColor: string | undefined;
  readonly models: ServerProvider["models"];
}

export const sidebarProviderEntriesAtom = Atom.make((get) => {
  const byEnvironment = new Map<string, ReadonlyMap<string, SidebarProviderEntry>>();
  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    const entries = new Map<string, SidebarProviderEntry>();
    for (const provider of config.providers) {
      entries.set(provider.instanceId, {
        instanceId: provider.instanceId,
        driverKind: provider.driver,
        displayName: resolveProviderInstanceDisplayName(provider),
        accentColor: provider.accentColor ?? undefined,
        models: provider.models,
      });
    }
    byEnvironment.set(environmentId, entries);
  }
  return byEnvironment as ReadonlyMap<string, ReadonlyMap<string, SidebarProviderEntry>>;
});

// ── Clock ───────────────────────────────────────────────────────────────

/**
 * Snooze wakes and the queued-turn grace depend on the clock. The sidebar bumps
 * this each minute and at the next snooze wake, so the partition recomputes.
 */
export const sidebarClockAtom = Atom.make(Date.now()).pipe(Atom.keepAlive);

// ── Partition ───────────────────────────────────────────────────────────

export function threadShellKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

const inboxReturns = createInboxReturnTracker();
/** The active shelf's return order, for the drag preview of a time-ordered drop. */
export const sidebarInboxReturns = inboxReturns;

/**
 * Web Sidebar's SidebarOptimisticDrop: a dropped row held at its destination
 * while the server applies the lifecycle command and order-key writes. The
 * partition releases it once the server state catches up.
 */
export type SidebarOptimisticDrop = {
  readonly key: string;
  readonly sourceSection: SidebarSection;
  readonly section: "pinned" | "active" | "settled";
  readonly occurredAt: string;
  readonly clearsSnooze: boolean;
  readonly order: readonly string[] | null;
  readonly keysAtDrop: ReadonlyMap<string, string | null>;
  readonly assignedKeys: ReadonlyMap<string, string>;
};

export const sidebarOptimisticDropAtom = Atom.make<SidebarOptimisticDrop | null>(null).pipe(Atom.keepAlive);

export interface SidebarPartition {
  readonly pinnedThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly activeThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly workingThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly snoozedThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly settledThreads: ReadonlyArray<EnvironmentThreadShell>;
  /** Rows on servers that can reorder pins (threadPinning + threadPinReorder): the draggable rows. */
  readonly draggableThreadKeys: ReadonlySet<string>;
  /** Rows on servers with threadActiveReorder: their active order keys are writable. */
  readonly activeReorderableThreadKeys: ReadonlySet<string>;
  readonly snoozeNow: string;
  readonly workingShelfEnabled: boolean;
}

/** Web Sidebar.tsx partitionSidebarThreads. */
function partitionSidebarThreads(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly optimisticDrop: SidebarOptimisticDrop | null;
  readonly workingShelfEnabled: boolean;
}): SidebarPartition {
  const { threads, scopedProjectKeys, serverConfigs, optimisticDrop, workingShelfEnabled } = input;
  const preciseNow = new Date().toISOString();
  const visible = filterSidebarV2VisibleThreads(threads, scopedProjectKeys);
  inboxReturns.observe(workingShelfEnabled ? threads : null);
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  const snoozed: EnvironmentThreadShell[] = [];
  const settled: EnvironmentThreadShell[] = [];
  const draggable = new Set<string>();
  const activeReorderable = new Set<string>();
  const inbox = (thread: EnvironmentThreadShell) =>
    workingShelfEnabled && isSidebarThreadWorking(thread) ? working : active;
  for (const thread of visible) {
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    const threadKey = threadShellKey(thread);
    if (capabilities?.threadActiveReorder === true) activeReorderable.add(threadKey);
    if (capabilities?.threadPinning === true && capabilities.threadPinReorder === true) draggable.add(threadKey);
    if (optimisticDrop?.key === threadKey) {
      const projected = applySidebarThreadDrop(
        thread,
        optimisticDrop.section,
        optimisticDrop.occurredAt,
        optimisticDrop.assignedKeys.get(threadKey),
      );
      (optimisticDrop.section === "pinned"
        ? pinned
        : optimisticDrop.section === "settled"
          ? settled
          : inbox(projected)
      ).push(
        optimisticDrop.clearsSnooze
          ? projected
          : { ...projected, snoozedAt: thread.snoozedAt, snoozedUntil: thread.snoozedUntil },
      );
      continue;
    }
    const section = resolveSidebarThreadSection({
      snoozed: capabilities?.threadSnooze === true && effectiveSnoozed(thread, { now: preciseNow }),
      settled: capabilities?.threadSettlement === true && thread.settledOverride === "settled",
      pinned: thread.pinnedAt != null,
    });
    (section === "snoozed"
      ? snoozed
      : section === "settled"
        ? settled
        : section === "pinned"
          ? pinned
          : inbox(thread)
    ).push(thread);
  }
  // Server capability only gates dragging; it must not influence the sort.
  const sortedPinned = sortPinnedThreadsForSidebar(pinned);
  const sortedActive = workingShelfEnabled
    ? sortInboxThreadsByReturn(active, inboxReturns.returnedAt)
    : sortThreadsForSidebar(active);
  return {
    pinnedThreads:
      optimisticDrop?.section !== "pinned" || optimisticDrop.order === null
        ? sortedPinned
        : orderItemsByPreferredIds({ items: sortedPinned, preferredIds: optimisticDrop.order, getId: threadShellKey }),
    activeThreads:
      optimisticDrop?.section !== "active" || optimisticDrop.order === null
        ? sortedActive
        : orderItemsByPreferredIds({ items: sortedActive, preferredIds: optimisticDrop.order, getId: threadShellKey }),
    workingThreads: sortWorkingThreadsBySend(working),
    snoozedThreads: snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil ?? null) -
        firstValidTimestampMs(right.snoozedUntil ?? null),
    ),
    settledThreads: sortSettledThreads(settled),
    draggableThreadKeys: draggable,
    activeReorderableThreadKeys: activeReorderable,
    snoozeNow: preciseNow,
    workingShelfEnabled,
  };
}

/** Web Sidebar.tsx isOptimisticDropReleased. */
function isOptimisticDropReleased(input: {
  readonly optimisticDrop: SidebarOptimisticDrop;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly pinnedKeys: ReadonlyArray<string>;
  readonly activeKeys: ReadonlyArray<string>;
  readonly now: string;
}): boolean {
  const { optimisticDrop, threads, pinnedKeys, activeKeys, now } = input;
  const canonicalByKey = new Map(threads.map((thread) => [threadShellKey(thread), thread]));
  const thread = canonicalByKey.get(optimisticDrop.key);
  if (thread === undefined || thread.archivedAt !== null) {
    return true;
  }
  const canonicalSection = effectiveSnoozed(thread, { now })
    ? "snoozed"
    : thread.settledOverride === "settled"
      ? "settled"
      : thread.pinnedAt != null
        ? "pinned"
        : "active";
  if (canonicalSection !== optimisticDrop.sourceSection && canonicalSection !== optimisticDrop.section) {
    return true;
  }
  if (optimisticDrop.order === null) {
    // Settle also emits unpin/unsnooze events. Wait for the entire move
    // before releasing the projected fields and sort timestamps.
    return (
      canonicalSection === optimisticDrop.section &&
      thread.pinnedAt == null &&
      (!optimisticDrop.clearsSnooze || thread.snoozedUntil == null)
    );
  }
  if (canonicalSection !== optimisticDrop.section) return false;
  if (optimisticDrop.clearsSnooze && thread.snoozedUntil != null) return false;
  const destinationKeys = optimisticDrop.section === "pinned" ? pinnedKeys : activeKeys;
  const canonicalDestination = destinationKeys.flatMap((key) => {
    const canonical = canonicalByKey.get(key);
    return canonical === undefined ? [] : [canonical];
  });
  const keyByThread = new Map(
    canonicalDestination.map((candidate) => [
      threadShellKey(candidate),
      (optimisticDrop.section === "pinned" ? candidate.pinOrderKey : candidate.activeOrderKey) ?? null,
    ]),
  );
  const heldOrder = optimisticDrop.order;
  const heldKeys = new Set(heldOrder);
  const membershipChanged =
    destinationKeys.length !== heldOrder.length || destinationKeys.some((key) => !heldKeys.has(key));
  const foreignKeyLanded = destinationKeys.some((threadKey) => {
    const currentKey = keyByThread.get(threadKey) ?? null;
    if (currentKey === (optimisticDrop.keysAtDrop.get(threadKey) ?? null)) return false;
    return currentKey !== optimisticDrop.assignedKeys.get(threadKey);
  });
  const allAssignmentsLanded = [...optimisticDrop.assignedKeys].every(
    ([threadKey, orderKey]) => keyByThread.get(threadKey) === orderKey,
  );
  return membershipChanged || foreignKeyLanded || allAssignmentsLanded;
}

export const sidebarPartitionAtom = Atom.make((get): SidebarPartition => {
  get(sidebarClockAtom);
  const threads = get(environmentThreadShells.quietThreadShellsAtom);
  const scope = get(sidebarProjectScopeAtom);
  const scopedProjectKeys =
    scope === null
      ? null
      : new Set(scope.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`));
  const input = {
    threads,
    scopedProjectKeys,
    serverConfigs: get(environmentServerConfigsAtom),
    workingShelfEnabled: get(sidebarClientSettingsAtom).sidebarWorkingShelfEnabled,
  };
  const optimisticDrop = get(sidebarOptimisticDropAtom);
  const partition = partitionSidebarThreads({ ...input, optimisticDrop });
  if (
    optimisticDrop !== null &&
    isOptimisticDropReleased({
      optimisticDrop,
      threads,
      pinnedKeys: partition.pinnedThreads.map(threadShellKey),
      activeKeys: partition.activeThreads.map(threadShellKey),
      now: partition.snoozeNow,
    })
  ) {
    // Web releases the hold during render, so the canonical order shows in the
    // same pass; here the partition drops it now and the atom clears after.
    queueMicrotask(() => {
      if (appAtomRegistry.get(sidebarOptimisticDropAtom) === optimisticDrop) {
        appAtomRegistry.set(sidebarOptimisticDropAtom, null);
      }
    });
    return partitionSidebarThreads({ ...input, optimisticDrop: null });
  }
  return partition;
});

/** The open thread's row key: a subagent is represented by its nearest top-level ancestor. */
export const routeThreadKeyAtom = Atom.make((get): string | null => {
  const route = get(routeAtom);
  return route.kind === "thread" ? scopedThreadKey(scopeThreadRef(route.environmentId, route.threadId)) : null;
});

export const routeRowThreadKeyAtom = Atom.make((get): string | null => {
  const route = get(routeAtom);
  if (route.kind !== "thread") return null;
  const threads = get(environmentThreadShells.quietThreadShellsAtom);
  return scopedThreadKey(
    scopeThreadRef(
      route.environmentId,
      resolveSidebarRowThreadId(route.threadId, route.environmentId, threads),
    ),
  );
});

export const SETTLED_TAIL_INITIAL_COUNT = 10;
export const SETTLED_TAIL_PAGE_COUNT = 25;

/** The settled tail restarts whenever the project scope changes (web: settledTail state). */
export const settledTailAtom = Atom.make<{ readonly scopeKey: string | null; readonly count: number }>({
  scopeKey: null,
  count: SETTLED_TAIL_INITIAL_COUNT,
}).pipe(Atom.keepAlive);

export function showMoreSettledThreads(): void {
  const current = appAtomRegistry.get(settledTailAtom);
  const scopeKey = appAtomRegistry.get(sidebarPersistedStateAtom).projectScopeKey;
  appAtomRegistry.set(settledTailAtom, {
    scopeKey,
    count:
      (current.scopeKey === scopeKey ? current.count : SETTLED_TAIL_INITIAL_COUNT) +
      SETTLED_TAIL_PAGE_COUNT,
  });
}

function routeThreadOnly(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  routeThreadKey: string | null,
): ReadonlyArray<EnvironmentThreadShell> {
  if (routeThreadKey === null) return [];
  const routeThread = threads.find((thread) => threadShellKey(thread) === routeThreadKey);
  return routeThread === undefined ? [] : [routeThread];
}

export interface SidebarThreadList extends SidebarPartition {
  readonly renderedSettledThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly visibleSnoozedThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly visibleWorkingThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly hiddenSettledCount: number;
  readonly settledExpanded: boolean;
  readonly snoozedExpanded: boolean;
  readonly workingExpanded: boolean;
  /** Every rendered row in order: what prev/next and jump-to-N traverse. */
  readonly orderedThreadKeys: ReadonlyArray<string>;
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly sectionByThreadKey: ReadonlyMap<string, SidebarSection>;
  readonly searchableThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly settledVisibleCount: number;
  readonly pinnedKeys: ReadonlyArray<string>;
  readonly activeKeys: ReadonlyArray<string>;
  /** Every shell's pin / active order key, for planSidebarThreadDrop. */
  readonly pinnedKeysById: ReadonlyMap<string, string | null>;
  readonly activeKeysById: ReadonlyMap<string, string | null>;
}

export const sidebarThreadListAtom = Atom.make((get): SidebarThreadList => {
  const partition = get(sidebarPartitionAtom);
  const allThreads = get(environmentThreadShells.quietThreadShellsAtom);
  const persisted = get(sidebarPersistedStateAtom);
  const tail = get(settledTailAtom);
  const routeRowThreadKey = get(routeRowThreadKeyAtom);
  const settledVisibleCount =
    tail.scopeKey === persisted.projectScopeKey ? tail.count : SETTLED_TAIL_INITIAL_COUNT;
  const { pinnedThreads, activeThreads, workingThreads, snoozedThreads, settledThreads } = partition;
  const visibleSettledThreads = (() => {
    if (settledThreads.length <= settledVisibleCount) return settledThreads;
    const visible = settledThreads.slice(0, settledVisibleCount);
    if (routeRowThreadKey !== null) {
      const routeThread = settledThreads
        .slice(settledVisibleCount)
        .find((thread) => threadShellKey(thread) === routeRowThreadKey);
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible;
  })();
  const renderedSettledThreads = persisted.settledExpanded
    ? visibleSettledThreads
    : routeThreadOnly(visibleSettledThreads, routeRowThreadKey);
  const visibleSnoozedThreads = persisted.snoozedExpanded
    ? snoozedThreads
    : routeThreadOnly(snoozedThreads, routeRowThreadKey);
  const visibleWorkingThreads = persisted.workingExpanded
    ? workingThreads
    : routeThreadOnly(workingThreads, routeRowThreadKey);
  const orderedThreads = [
    ...pinnedThreads,
    ...activeThreads,
    ...visibleWorkingThreads,
    ...visibleSnoozedThreads,
    ...renderedSettledThreads,
  ];
  const sectionByThreadKey = new Map<string, SidebarSection>();
  for (const [list, section] of [
    [pinnedThreads, "pinned"],
    [activeThreads, "active"],
    [workingThreads, "working"],
    [snoozedThreads, "snoozed"],
    [settledThreads, "settled"],
  ] as const) {
    for (const thread of list) sectionByThreadKey.set(threadShellKey(thread), section);
  }
  return {
    ...partition,
    renderedSettledThreads,
    visibleSnoozedThreads,
    visibleWorkingThreads,
    hiddenSettledCount: settledThreads.length - visibleSettledThreads.length,
    settledVisibleCount,
    settledExpanded: persisted.settledExpanded,
    snoozedExpanded: persisted.snoozedExpanded,
    workingExpanded: persisted.workingExpanded,
    orderedThreadKeys: orderedThreads.map(threadShellKey),
    threadByKey: new Map(orderedThreads.map((thread) => [threadShellKey(thread), thread] as const)),
    sectionByThreadKey,
    searchableThreads: [
      ...pinnedThreads,
      ...activeThreads,
      ...workingThreads,
      ...snoozedThreads,
      ...settledThreads,
    ],
    pinnedKeys: pinnedThreads.map(threadShellKey),
    activeKeys: activeThreads.map(threadShellKey),
    pinnedKeysById: new Map(allThreads.map((thread) => [threadShellKey(thread), thread.pinOrderKey ?? null] as const)),
    activeKeysById: new Map(allThreads.map((thread) => [threadShellKey(thread), thread.activeOrderKey ?? null] as const)),
  };
});

/** Rendered row order, for the keybindings: mod+shift+[ / ] and mod+1..9. */
export const sidebarOrderedThreadKeysAtom = Atom.make(
  (get) => get(sidebarThreadListAtom).orderedThreadKeys,
);

export function readSidebarThreadRef(threadKey: string): ScopedThreadRef | null {
  return parseScopedThreadKey(threadKey);
}

// ── Thread search (web: state/queries.ts useThreadSearch) ───────────────

export const sidebarOrchestration = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);

export const EMPTY_THREAD_SEARCH_ATOM = Atom.make<ThreadSearchResultsState>({
  matches: [],
  isLoading: false,
});

export const threadSearchResultsAtom = createThreadSearchResultsAtomFamily({
  getSearchAtom: (environmentId, query) =>
    sidebarOrchestration.threadSearch({ environmentId, input: { query } }),
  labelPrefix: "t3term:thread-search",
});

/** Environments with a connected shell: the ones a content search can reach. */
export const connectedEnvironmentIdsAtom = Atom.make((get): ReadonlyArray<EnvironmentId> => [
  ...get(environmentServerConfigsAtom).keys(),
]);

// ── Project favicons (web: state/assets.ts) ─────────────────────────────

const assetEnvironment = createAssetEnvironmentAtoms(connectionAtomRuntime);

/**
 * Resolves to a signed http URL for the project's favicon, or null when the
 * server reports none. No image cache: gpuix's <img> loads and caches the URL.
 */
export const projectFaviconUrlAtom = createProjectFaviconUrlAtomFamily({
  createUrl: assetEnvironment.createUrl,
  preparedConnection: environmentSession.preparedConnectionValueAtom,
});

// ── Row UI state ────────────────────────────────────────────────────────

/** The thread being renamed inline (double-click or "Rename thread"). */
export const sidebarRenameAtom = Atom.make<{ readonly threadKey: string; readonly title: string } | null>(
  null,
).pipe(Atom.keepAlive);

/** Right-click menu: which row, and where (window coordinates). */
export const sidebarContextMenuAtom = Atom.make<
  | { readonly kind: "thread"; readonly threadKey: string; readonly x: number; readonly y: number }
  | { readonly kind: "draft"; readonly draftId: string; readonly x: number; readonly y: number }
  /** Right-click on a selected row while several are selected: the bulk menu. */
  | { readonly kind: "selection"; readonly x: number; readonly y: number }
  | null
>(null).pipe(Atom.keepAlive);

// ── Multi-select (apps/web/src/threadSelectionStore.ts) ─────────────────

export interface ThreadSelectionState {
  readonly selectedThreadKeys: ReadonlySet<string>;
  readonly anchorThreadKey: string | null;
}

const EMPTY_SELECTION: ThreadSelectionState = { selectedThreadKeys: new Set<string>(), anchorThreadKey: null };

export const threadSelectionAtom = Atom.make<ThreadSelectionState>(EMPTY_SELECTION).pipe(Atom.keepAlive);

function updateSelection(next: (state: ThreadSelectionState) => ThreadSelectionState): void {
  const current = appAtomRegistry.get(threadSelectionAtom);
  const updated = next(current);
  if (updated !== current) appAtomRegistry.set(threadSelectionAtom, updated);
}

export function readThreadSelection(): ThreadSelectionState {
  return appAtomRegistry.get(threadSelectionAtom);
}

export function toggleThreadSelection(threadKey: string): void {
  updateSelection((state) => {
    const next = new Set(state.selectedThreadKeys);
    if (next.has(threadKey)) next.delete(threadKey);
    else next.add(threadKey);
    return {
      selectedThreadKeys: next,
      anchorThreadKey: next.has(threadKey) ? threadKey : state.anchorThreadKey,
    };
  });
}

/** Selects every row between the anchor and `threadKey` in the rendered order. */
export function rangeSelectThreadsTo(threadKey: string, orderedThreadKeys: ReadonlyArray<string>): void {
  updateSelection((state) => {
    const anchor = state.anchorThreadKey;
    const anchorIndex = anchor === null ? -1 : orderedThreadKeys.indexOf(anchor);
    const targetIndex = orderedThreadKeys.indexOf(threadKey);
    if (anchor === null || anchorIndex === -1 || targetIndex === -1) {
      const next = new Set(state.selectedThreadKeys);
      next.add(threadKey);
      return { selectedThreadKeys: next, anchorThreadKey: threadKey };
    }
    const next = new Set(state.selectedThreadKeys);
    for (let index = Math.min(anchorIndex, targetIndex); index <= Math.max(anchorIndex, targetIndex); index++) {
      const key = orderedThreadKeys[index];
      if (key !== undefined) next.add(key);
    }
    return { selectedThreadKeys: next, anchorThreadKey: anchor };
  });
}

export function clearThreadSelection(): void {
  updateSelection((state) =>
    state.selectedThreadKeys.size === 0 && state.anchorThreadKey === null ? state : EMPTY_SELECTION,
  );
}

export function setThreadSelectionAnchor(threadKey: string): void {
  updateSelection((state) => (state.anchorThreadKey === threadKey ? state : { ...state, anchorThreadKey: threadKey }));
}

export function removeFromThreadSelection(threadKeys: ReadonlyArray<string>): void {
  updateSelection((state) => {
    const toRemove = new Set(threadKeys);
    const next = new Set([...state.selectedThreadKeys].filter((key) => !toRemove.has(key)));
    if (next.size === state.selectedThreadKeys.size) return state;
    return {
      selectedThreadKeys: next,
      anchorThreadKey:
        state.anchorThreadKey !== null && toRemove.has(state.anchorThreadKey) ? null : state.anchorThreadKey,
    };
  });
}

/** threadSelectionStore.ts getThreadKeysToDeselectAfterDelete */
export function getThreadKeysToDeselectAfterDelete(
  selectedThreadKeys: ReadonlyArray<string>,
  deletedThreadKeys: ReadonlySet<string>,
  hasThread: (threadKey: string) => boolean,
): string[] {
  return selectedThreadKeys.filter((key) => deletedThreadKeys.has(key) || !hasThread(key));
}

/** One row's membership, so a selection change re-renders only the rows it touches. */
export const threadSelectedAtom = Atom.family((threadKey: string) =>
  Atom.make((get) => get(threadSelectionAtom).selectedThreadKeys.has(threadKey)),
);

/**
 * Web shows "Ctrl+N" badges on the first nine rows while the jump modifier is
 * held (useThreadJumpHintVisibility). The keybindings layer sets this; the
 * sidebar labels the rows from the server keybindings.
 */
export const sidebarJumpHintsVisibleAtom = Atom.make(false).pipe(Atom.keepAlive);

// ── Requests for other surfaces ─────────────────────────────────────────

/**
 * "New thread on <branch>" (thread context menu): the draft should start on the
 * thread's branch / worktree. The sidebar routes to the project's draft and
 * leaves this for the composer to apply and clear.
 */
export const newThreadContextRequestAtom = Atom.make<{
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly envMode: "local" | "worktree";
  readonly nonce: number;
} | null>(null).pipe(Atom.keepAlive);

/**
 * "Project settings" (project filter gear, context menus). Web routes to
 * /projects/$projectKey; t3-term opens settings and leaves the project here
 * for the settings page to show.
 */
export const projectSettingsRequestAtom = Atom.make<{
  readonly projectKey: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly nonce: number;
} | null>(null).pipe(Atom.keepAlive);

/** The primary server's resolved keybindings (web: primaryServerKeybindingsAtom). */
export const primaryKeybindingsAtom = Atom.make((get) => {
  const primary = get(primaryEnvironmentIdAtom);
  return primary === null ? undefined : get(environmentServerConfigsAtom).get(primary)?.keybindings;
});
