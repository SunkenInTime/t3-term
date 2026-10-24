// State for the legacy sidebar (apps/web/src/components/LegacySidebar.tsx, shown
// when the General setting "Sidebar (legacy)" is on): the per-project tree.
// Web keeps expanded projects and the manual project order in localStorage
// (uiStateStore.ts); t3-term keeps them in $T3TERM_HOME/ui/legacy-sidebar.json.
// The derivations mirror LegacySidebar.tsx's useLegacySidebarProjects,
// useSortedLegacySidebarProjects, useProjectThreads and useLegacySidebarThreads,
// as atoms so the keybindings traverse the same rows the tree renders.
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  derivePhysicalProjectKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { sortThreads } from "@t3tools/client-runtime/state/thread-sort";
import type { ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentThreadShells } from "./environment.ts";
import { isRecord, persistedAtom } from "./persistedAtom.ts";
import {
  environmentLabelByIdAtom,
  primaryEnvironmentIdAtom,
  routeThreadKeyAtom,
  sidebarClientSettingsAtom,
  sidebarProjectsAtom,
  threadLocalLastVisitedAtAtom,
} from "./sidebar.ts";
import {
  filterSidebarV2VisibleThreads,
  orderItemsByPreferredIds,
  resolveThreadLastVisitedAt,
} from "../web/components/Sidebar.logic.ts";
import {
  resolveProjectStatusIndicator,
  resolveThreadStatusPill,
  sortProjectsForSidebar,
  type ThreadStatusPill,
} from "../web/components/LegacySidebar.logic.ts";
import {
  buildPhysicalToLogicalProjectKeyMap,
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../web/sidebarProjectGrouping.ts";
import {
  legacyProjectCwdPreferenceKey,
  parsePersistedProjectState,
  reorderProjects,
  resolveProjectExpanded,
  setProjectExpanded,
  type UiProjectState,
} from "../web/uiStateStore.ts";

// ── Persisted UI state (web: uiStateStore projectExpandedById / projectOrder) ──

export const legacySidebarUiStateAtom = persistedAtom<UiProjectState>(
  "legacy-sidebar",
  { projectExpandedById: {}, projectOrder: [] },
  (raw) => parsePersistedProjectState(isRecord(raw) ? raw : {}),
);

export function setLegacyProjectExpanded(preferenceKeys: readonly string[], expanded: boolean): void {
  const current = appAtomRegistry.get(legacySidebarUiStateAtom);
  const next = setProjectExpanded(current, preferenceKeys, expanded);
  if (next !== current) appAtomRegistry.set(legacySidebarUiStateAtom, next);
}

export function reorderLegacyProjects(
  currentProjectOrder: readonly string[],
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
): void {
  const current = appAtomRegistry.get(legacySidebarUiStateAtom);
  const next = reorderProjects(current, currentProjectOrder, draggedProjectIds, targetProjectIds);
  if (next !== current) appAtomRegistry.set(legacySidebarUiStateAtom, next);
}

/** LegacySidebar.tsx projectExpansionPreferenceKeys. */
export function projectExpansionPreferenceKeys(project: SidebarProjectSnapshot): string[] {
  return [
    project.projectKey,
    ...project.memberProjects.map((member) => member.physicalProjectKey),
    ...project.memberProjects.map((member) => legacyProjectCwdPreferenceKey(member.workspaceRoot)),
  ];
}

/** "Show more" per project. Web holds this in component state, so it resets on reload. */
export const legacyExpandedThreadListsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive,
);

export function setLegacyThreadListExpanded(projectKey: string, expanded: boolean): void {
  const current = appAtomRegistry.get(legacyExpandedThreadListsAtom);
  if (current.has(projectKey) === expanded) return;
  const next = new Set(current);
  if (expanded) next.add(projectKey);
  else next.delete(projectKey);
  appAtomRegistry.set(legacyExpandedThreadListsAtom, next);
}

/** The inline archive confirmation (confirmThreadArchive): one row at a time. */
export const legacyConfirmingArchiveThreadKeyAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);

/** The project rename / grouping dialogs, opened from the project context menu. */
export const legacyProjectDialogAtom = Atom.make<
  | { readonly kind: "rename"; readonly projectKey: string; readonly physicalProjectKey: string }
  | { readonly kind: "grouping"; readonly projectKey: string; readonly physicalProjectKey: string }
  | null
>(null).pipe(Atom.keepAlive);

/** Right-click menus of the tree. Coordinates are window pixels. */
export const legacyContextMenuAtom = Atom.make<
  | { readonly kind: "thread"; readonly threadKey: string; readonly projectKey: string; readonly x: number; readonly y: number }
  | { readonly kind: "selection"; readonly x: number; readonly y: number }
  | { readonly kind: "project"; readonly projectKey: string; readonly x: number; readonly y: number }
  | { readonly kind: "new-thread"; readonly projectKey: string; readonly x: number; readonly y: number }
  | null
>(null).pipe(Atom.keepAlive);

// ── Projects (useLegacySidebarProjects) ─────────────────────────────────

export interface LegacySidebarProjects {
  readonly projectsLength: number;
  /** Project order keys in the persisted manual order, what a drop reorders. */
  readonly orderedProjectKeys: ReadonlyArray<string>;
  readonly physicalToLogicalKey: ReadonlyMap<string, string>;
  readonly projectPhysicalKeyByScopedRef: ReadonlyMap<string, string>;
  readonly sidebarProjects: ReadonlyArray<SidebarProjectSnapshot>;
}

export const legacySidebarProjectsAtom = Atom.make((get): LegacySidebarProjects => {
  const projects = get(sidebarProjectsAtom);
  const projectOrder = get(legacySidebarUiStateAtom).projectOrder;
  const settings = get(sidebarClientSettingsAtom);
  const projectGroupingSettings = selectProjectGroupingSettings(settings);
  const primaryEnvironmentId = get(primaryEnvironmentIdAtom);
  const environmentLabelById = get(environmentLabelByIdAtom);
  const orderedProjects = orderItemsByPreferredIds({
    items: projects,
    preferredIds: projectOrder,
    getId: getProjectOrderKey,
    getPreferenceIds: (project) => [
      getProjectOrderKey(project),
      legacyProjectCwdPreferenceKey(project.workspaceRoot),
    ],
  });
  const physicalToLogicalKey = buildPhysicalToLogicalProjectKeyMap({
    projects: orderedProjects,
    settings: projectGroupingSettings,
    primaryEnvironmentId,
  });
  const projectPhysicalKeyByScopedRef = new Map(
    orderedProjects.map((project) => [
      `${project.environmentId}:${project.id}`,
      derivePhysicalProjectKey(project),
    ]),
  );
  // t3-term has no desktop bridge, so no environment is a desktop-local or WSL backend.
  const sidebarProjects = buildSidebarProjectSnapshots({
    projects: orderedProjects,
    settings: projectGroupingSettings,
    primaryEnvironmentId,
    resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
  });
  return {
    projectsLength: projects.length,
    orderedProjectKeys: orderedProjects.map(getProjectOrderKey),
    physicalToLogicalKey,
    projectPhysicalKeyByScopedRef,
    sidebarProjects,
  };
});

// ── Threads per project (useProjectThreads) ─────────────────────────────

export interface LegacyProjectThreads {
  /** Visible threads in the thread sort order. */
  readonly visibleThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly orderedThreadKeys: ReadonlyArray<string>;
  /** Every thread of the project's members, archived and subagents included (Remove counts these). */
  readonly threadCountByPhysicalKey: ReadonlyMap<string, number>;
  readonly statusByThreadKey: ReadonlyMap<string, ThreadStatusPill | null>;
  readonly projectStatus: ThreadStatusPill | null;
}

const EMPTY_PROJECT_THREADS: LegacyProjectThreads = {
  visibleThreads: [],
  orderedThreadKeys: [],
  threadCountByPhysicalKey: new Map(),
  statusByThreadKey: new Map(),
  projectStatus: null,
};

function threadKeyOf(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

export const legacyProjectThreadsAtom = Atom.make((get): ReadonlyMap<string, LegacyProjectThreads> => {
  const { sidebarProjects } = get(legacySidebarProjectsAtom);
  const threads = get(environmentThreadShells.quietThreadShellsAtom);
  const localLastVisitedAt = get(threadLocalLastVisitedAtAtom);
  const threadSortOrder = get(sidebarClientSettingsAtom).sidebarThreadSortOrder;
  const projectByMemberKey = new Map<string, SidebarProjectSnapshot>();
  for (const project of sidebarProjects) {
    for (const member of project.memberProjects) {
      projectByMemberKey.set(`${member.environmentId}:${member.id}`, project);
    }
  }
  const threadsByProjectKey = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of threads) {
    const project = projectByMemberKey.get(`${thread.environmentId}:${thread.projectId}`);
    if (!project) continue;
    const list = threadsByProjectKey.get(project.projectKey);
    if (list) list.push(thread);
    else threadsByProjectKey.set(project.projectKey, [thread]);
  }
  const result = new Map<string, LegacyProjectThreads>();
  for (const project of sidebarProjects) {
    const projectThreads = threadsByProjectKey.get(project.projectKey) ?? [];
    const threadCountByPhysicalKey = new Map<string, number>(
      project.memberProjects.map((member) => [member.physicalProjectKey, 0] as const),
    );
    for (const thread of projectThreads) {
      const member = project.memberProjects.find(
        (candidate) => candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
      );
      if (!member) continue;
      threadCountByPhysicalKey.set(
        member.physicalProjectKey,
        (threadCountByPhysicalKey.get(member.physicalProjectKey) ?? 0) + 1,
      );
    }
    const visibleThreads = sortThreads(filterSidebarV2VisibleThreads(projectThreads, null), threadSortOrder);
    const statusByThreadKey = new Map<string, ThreadStatusPill | null>();
    for (const thread of visibleThreads) {
      const key = threadKeyOf(thread);
      const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt.get(key));
      statusByThreadKey.set(
        key,
        resolveThreadStatusPill({
          thread: {
            ...thread,
            ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
          },
        }),
      );
    }
    result.set(project.projectKey, {
      visibleThreads,
      orderedThreadKeys: visibleThreads.map(threadKeyOf),
      threadCountByPhysicalKey,
      statusByThreadKey,
      projectStatus: resolveProjectStatusIndicator([...statusByThreadKey.values()]),
    });
  }
  // Streaming ticks and unrelated shell changes rebuild this map; keep each
  // project's entry when nothing it renders changed, so its row stays memoized.
  const previous = Option.getOrUndefined(get.self<ReadonlyMap<string, LegacyProjectThreads>>());
  if (previous !== undefined) {
    for (const [key, entry] of result) {
      const old = previous.get(key);
      if (old !== undefined && sameProjectThreads(old, entry)) result.set(key, old);
    }
  }
  return result;
});

function sameProjectThreads(left: LegacyProjectThreads, right: LegacyProjectThreads): boolean {
  if (left.visibleThreads.length !== right.visibleThreads.length) return false;
  if (left.projectStatus?.label !== right.projectStatus?.label) return false;
  for (let index = 0; index < left.visibleThreads.length; index++) {
    if (left.visibleThreads[index] !== right.visibleThreads[index]) return false;
  }
  for (const [key, status] of left.threadCountByPhysicalKey) {
    if (right.threadCountByPhysicalKey.get(key) !== status) return false;
  }
  for (const [key, status] of left.statusByThreadKey) {
    if (right.statusByThreadKey.get(key)?.label !== status?.label) return false;
  }
  return true;
}

export function readLegacyProjectThreads(projectKey: string): LegacyProjectThreads {
  return appAtomRegistry.get(legacyProjectThreadsAtom).get(projectKey) ?? EMPTY_PROJECT_THREADS;
}

// ── Sorted projects (useSortedLegacySidebarProjects) ────────────────────

export const legacySortedProjectsAtom = Atom.make((get): ReadonlyArray<SidebarProjectSnapshot> => {
  const { sidebarProjects, physicalToLogicalKey, projectPhysicalKeyByScopedRef } = get(legacySidebarProjectsAtom);
  const sortOrder = get(sidebarClientSettingsAtom).sidebarProjectSortOrder;
  const threads = get(environmentThreadShells.quietThreadShellsAtom);
  const sidebarProjectByKey = new Map(sidebarProjects.map((project) => [project.projectKey, project] as const));
  const sortableProjects = sidebarProjects.map((project) => ({ ...project, id: project.projectKey }));
  const sortableThreads = filterSidebarV2VisibleThreads(threads, null).map((thread) => {
    const scopedKey = `${thread.environmentId}:${thread.projectId}`;
    const physicalKey = projectPhysicalKeyByScopedRef.get(scopedKey) ?? scopedKey;
    return {
      ...thread,
      projectId: (physicalToLogicalKey.get(physicalKey) ?? physicalKey) as ProjectId,
    };
  });
  const sorted = sortProjectsForSidebar(sortableProjects, sortableThreads, sortOrder).flatMap((project) => {
    const resolved = sidebarProjectByKey.get(project.id);
    return resolved ? [resolved] : [];
  });
  // Activity order changes far less often than the shells do: keep the array.
  const previous = Option.getOrUndefined(get.self<ReadonlyArray<SidebarProjectSnapshot>>());
  return previous !== undefined &&
    previous.length === sorted.length &&
    previous.every((project, index) => project === sorted[index])
    ? previous
    : sorted;
});

// ── Expansion and the rendered rows (useProjectThreadPanel, useLegacySidebarThreads) ──

export function resolveLegacyProjectExpanded(
  projectExpandedById: Readonly<Record<string, boolean>>,
  project: SidebarProjectSnapshot,
): boolean {
  return resolveProjectExpanded(projectExpandedById, projectExpansionPreferenceKeys(project));
}

export interface LegacyProjectThreadPanel {
  readonly hasOverflowingThreads: boolean;
  readonly hiddenThreadStatus: ThreadStatusPill | null;
  readonly renderedThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly showEmptyThreadState: boolean;
  readonly shouldShowThreadPanel: boolean;
}

/** LegacySidebar.tsx useProjectThreadPanel. */
export function resolveLegacyProjectThreadPanel(input: {
  readonly projectThreads: LegacyProjectThreads;
  readonly activeRouteThreadKey: string | null;
  readonly projectExpanded: boolean;
  readonly isThreadListExpanded: boolean;
  readonly sidebarThreadPreviewCount: number;
}): LegacyProjectThreadPanel {
  const { projectThreads, activeRouteThreadKey, projectExpanded, isThreadListExpanded, sidebarThreadPreviewCount } =
    input;
  const visibleProjectThreads = projectThreads.visibleThreads;
  const activeThreadKey = activeRouteThreadKey ?? undefined;
  const activeThread = activeThreadKey
    ? (visibleProjectThreads.find((thread) => threadKeyOf(thread) === activeThreadKey) ?? null)
    : null;
  const pinnedCollapsedThread = projectExpanded ? null : activeThread;
  // The open thread stays listed past the preview cut, as it does in a
  // collapsed project, so it alone does not overflow the preview.
  const hasOverflowingThreads = visibleProjectThreads.some(
    (thread, index) => index >= sidebarThreadPreviewCount && threadKeyOf(thread) !== activeThreadKey,
  );
  const previewThreads =
    isThreadListExpanded || !hasOverflowingThreads
      ? visibleProjectThreads
      : visibleProjectThreads.slice(0, sidebarThreadPreviewCount);
  const visibleThreadKeys = new Set(
    [...previewThreads, ...(activeThread ? [activeThread] : [])].map(threadKeyOf),
  );
  const renderedThreads = pinnedCollapsedThread
    ? [pinnedCollapsedThread]
    : visibleProjectThreads.filter((thread) => visibleThreadKeys.has(threadKeyOf(thread)));
  const hiddenThreads = visibleProjectThreads.filter((thread) => !visibleThreadKeys.has(threadKeyOf(thread)));
  return {
    hasOverflowingThreads,
    hiddenThreadStatus: resolveProjectStatusIndicator(
      hiddenThreads.map((thread) => projectThreads.statusByThreadKey.get(threadKeyOf(thread)) ?? null),
    ),
    renderedThreads,
    showEmptyThreadState: projectExpanded && visibleProjectThreads.length === 0,
    shouldShowThreadPanel: projectExpanded || pinnedCollapsedThread !== null,
  };
}

/**
 * The rows the tree renders, top to bottom (useLegacySidebarThreads
 * visibleSidebarThreadKeys): what thread.previous / thread.next and the
 * mod+1..9 jumps walk while the legacy sidebar is on.
 */
export const legacyVisibleThreadKeysAtom = Atom.make((get): ReadonlyArray<string> => {
  const sortedProjects = get(legacySortedProjectsAtom);
  const projectThreads = get(legacyProjectThreadsAtom);
  const { projectExpandedById } = get(legacySidebarUiStateAtom);
  const expandedThreadLists = get(legacyExpandedThreadListsAtom);
  const previewCount = get(sidebarClientSettingsAtom).sidebarThreadPreviewCount;
  const routeThreadKey = get(routeThreadKeyAtom);
  const keys = sortedProjects.flatMap((project) => {
    const threads = projectThreads.get(project.projectKey) ?? EMPTY_PROJECT_THREADS;
    const projectExpanded = resolveLegacyProjectExpanded(projectExpandedById, project);
    const activeThreadKey = routeThreadKey ?? undefined;
    const pinnedCollapsedThread =
      !projectExpanded && activeThreadKey
        ? (threads.visibleThreads.find((thread) => threadKeyOf(thread) === activeThreadKey) ?? null)
        : null;
    if (!projectExpanded && pinnedCollapsedThread === null) return [];
    if (pinnedCollapsedThread) return [threadKeyOf(pinnedCollapsedThread)];
    const isThreadListExpanded = expandedThreadLists.has(project.projectKey);
    const hasOverflowingThreads = threads.visibleThreads.length > previewCount;
    const previewLength =
      isThreadListExpanded || !hasOverflowingThreads ? threads.visibleThreads.length : previewCount;
    return threads.orderedThreadKeys.filter(
      (threadKey, index) => index < previewLength || threadKey === activeThreadKey,
    );
  });
  const previous = Option.getOrUndefined(get.self<ReadonlyArray<string>>());
  return previous !== undefined && previous.length === keys.length && previous.every((key, index) => key === keys[index])
    ? previous
    : keys;
});

/** Whether the General setting "Sidebar (legacy)" is on. */
export const legacySidebarEnabledAtom = Atom.make((get) => get(sidebarClientSettingsAtom).legacySidebarEnabled);
