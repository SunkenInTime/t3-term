// apps/web/src/components/Sidebar.tsx (the default "new" sidebar): brand header,
// search and project filter, then the thread list: drafts, pinned, active
// cards, the Working shelf (setting), Snoozed and Settled shelves.
// Partition and ordering live in state/sidebar.ts; actions in threadActions.ts.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { canSnooze, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import { makeThreadSearchKey, threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { THREAD_JUMP_KEYBINDING_COMMANDS, type ContextMenuItem, type ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import { startNewThread } from "../palette/actions.ts";
import { useGpuixRequired } from "@gpuix/react";
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactElement, type ReactNode } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentServerConfigsAtom } from "../state/environment.ts";
import {
  EMPTY_THREAD_SEARCH_ATOM,
  canOperateEnvironmentAtom,
  commandPaletteModeRequestAtom,
  connectedEnvironmentIdsAtom,
  primaryEnvironmentIdAtom,
  projectByKeyAtom,
  projectDisplayNameByKeyAtom,
  projectSettingsRequestAtom,
  routeRowThreadKeyAtom,
  routeThreadKeyAtom,
  setSidebarProjectScopeKey,
  showMoreSettledThreads,
  sidebarClientSettingsAtom,
  sidebarClockAtom,
  sidebarContextMenuAtom,
  sidebarDraftDiscardAtom,
  sidebarDraftsAtom,
  primaryKeybindingsAtom,
  sidebarJumpHintsVisibleAtom,
  sidebarProjectGroupsAtom,
  sidebarProjectScopeAtom,
  sidebarProjectsAtom,
  sidebarProviderEntriesAtom,
  sidebarRenameAtom,
  sidebarThreadListAtom,
  SETTLED_TAIL_PAGE_COUNT,
  threadSearchResultsAtom,
  threadShellKey,
  updateSidebarPersistedState,
  clearThreadSelection,
  getThreadKeysToDeselectAfterDelete,
  removeFromThreadSelection,
  threadSelectionAtom,
  type SidebarProjectGroup,
  type SidebarProviderEntry,
  type SidebarThreadList,
} from "../state/sidebar.ts";
import { commandPaletteOpenAtom, routeAtom, sidebarSearchAtom } from "../state/ui.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast } from "../ui/toast.tsx";
import { LAYOUT, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { useInSidebarSheet, useSidebarWidth } from "../ui/viewport.tsx";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
  type DraftActionMenuId,
  type ThreadActionMenuId,
} from "../web/components/threadActionMenu.logic.ts";
import {
  buildBulkTitleRegenerationContextMenuItem,
  buildBulkUnpinContextMenuItem,
  deleteSelectedThreadEntries,
  resolveSidebarDropVerb,
  searchSidebarThreads,
  shouldCreateNewThreadInCurrentProject,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "../web/components/Sidebar.logic.ts";
import type { SidebarRect } from "../web/components/Sidebar.drag.ts";
import {
  completeSidebarRouteReveal,
  pendingSidebarRouteReveal,
  type SidebarRouteReveal,
} from "../web/components/sidebar/routeReveal.ts";
import { resolveSnoozePresets, snoozeWakeLabel } from "../web/components/Sidebar.snooze.ts";
import { ContextMenu } from "./ContextMenu.tsx";
import { requestCustomSnooze } from "../dialogs/CustomSnoozeDialog.tsx";
import { SidebarChromeFooter, SidebarChromeHeader, useStageIdentification } from "./SidebarChrome.tsx";
import { SidebarDraftBlock } from "./SidebarDraftBlock.tsx";
import { SidebarDragBoundary, SidebarSectionHeader, SidebarSectionPlaceholder } from "./SidebarListMarkers.tsx";
import { settleThreadKeys, useSidebarThreadDrag, type SidebarScrollMetrics } from "./useSidebarThreadDrag.ts";
import { requestConfirmDialog } from "../dialogs/confirmDialog.ts";
import { SidebarThreadHeader } from "./SidebarThreadHeader.tsx";
import { SidebarSearchResultRow, SidebarThreadRow, type SidebarSweepAction } from "./SidebarThreadRow.tsx";
import { StageBackdrop } from "./StageBackdrop.tsx";
import {
  attemptArchive,
  attemptDelete,
  attemptPin,
  attemptSettle,
  attemptSnooze,
  attemptUnpin,
  attemptUnsettle,
  attemptUnsnooze,
  copyToClipboard,
  deleteThread,
  markThreadUnread,
  navigateToThread,
  readThreadShell,
  regenerateThreadTitle,
  reportResult,
  setThreadAutoSettle,
} from "./threadActions.ts";
import { ThreadVisitWatermark } from "./ThreadVisitWatermark.tsx";
import { shortcutLabelForCommand } from "./shortcutLabel.ts";
import { openProjectSettings as openProjectSettingsPage } from "../settings/navigation.ts";

const THREAD_SEARCH_DEBOUNCE_MS = 200;
// Web keeps this in AppSidebarLayout so Settings and the narrow drawer, which
// unmount the sidebar without a route change, do not re-request a reveal.
const sidebarRouteReveal: SidebarRouteReveal = { observedKey: null, pendingKey: null };
const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, SidebarProviderEntry> = new Map();

let paletteRequestNonce = 0;

/** Web: openCommandPalette({ open }). The palette reads commandPaletteModeRequestAtom. */
export function openCommandPaletteMode(open: "add-project" | "new-thread-in"): void {
  appAtomRegistry.set(commandPaletteModeRequestAtom, { open, nonce: ++paletteRequestNonce });
  appAtomRegistry.set(commandPaletteOpenAtom, true);
}

/** Web: openAddProjectCommandPalette, for the header button and the empty state. */
export function requestAddProject(): void {
  openCommandPaletteMode("add-project");
}

let projectSettingsNonce = 0;

export function openProjectSettings(group: SidebarProjectGroup, projectRef?: { environmentId: string; projectId: string }): void {
  const target =
    group.memberProjects.find(
      (member) => member.environmentId === projectRef?.environmentId && member.id === projectRef?.projectId,
    ) ?? group;
  appAtomRegistry.set(projectSettingsRequestAtom, {
    projectKey: group.projectKey,
    environmentId: target.environmentId,
    projectId: target.id,
    nonce: ++projectSettingsNonce,
  });
  openProjectSettingsPage({
    ...(group.isScratch ? {} : { projectKey: group.projectKey }),
    environmentId: target.environmentId,
    projectId: target.id,
  });
}

/** Snooze wakes are second-precise; repartition at the next one, and every minute. */
function useSidebarClock(nextWakeAt: string | null) {
  const setClock = useAtomSet(sidebarClockAtom);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [setClock]);
  useEffect(() => {
    const wakeAtMs = nextWakeAt === null ? Number.NaN : Date.parse(nextWakeAt);
    if (Number.isNaN(wakeAtMs)) return;
    // setTimeout delays are signed 32-bit; larger ones fire at once.
    const delayMs = Math.min(Math.max(0, wakeAtMs - Date.now()) + 50, 2_147_483_647);
    const id = setTimeout(() => setClock(Date.now()), delayMs);
    return () => clearTimeout(id);
  }, [nextWakeAt, setClock]);
}

function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

export function Sidebar() {
  const theme = useTheme();
  const sidebarWidth = useSidebarWidth();
  const inSheet = useInSidebarSheet();
  const list = useAtomValue(sidebarThreadListAtom);
  const groups = useAtomValue(sidebarProjectGroupsAtom);
  const projects = useAtomValue(sidebarProjectsAtom);
  const scope = useAtomValue(sidebarProjectScopeAtom);
  const projectByKey = useAtomValue(projectByKeyAtom);
  const projectDisplayNameByKey = useAtomValue(projectDisplayNameByKeyAtom);
  const providerEntriesByEnvironment = useAtomValue(sidebarProviderEntriesAtom);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const routeRowThreadKey = useAtomValue(routeRowThreadKeyAtom);
  const routeThreadKey = useAtomValue(routeThreadKeyAtom);
  const route = useAtomValue(routeAtom);
  const setRoute = useAtomSet(routeAtom);
  const drafts = useAtomValue(sidebarDraftsAtom);
  const jumpHintsVisible = useAtomValue(sidebarJumpHintsVisibleAtom);
  const keybindings = useAtomValue(primaryKeybindingsAtom);
  const jumpHintLabels = useMemo(
    () => THREAD_JUMP_KEYBINDING_COMMANDS.map((command) => shortcutLabelForCommand(keybindings, command)),
    [keybindings],
  );
  const { backdropVariant } = useStageIdentification();

  useSidebarClock(list.snoozedThreads[0]?.snoozedUntil ?? null);

  // ── Search ──
  const [threadSearchQuery, setThreadSearchQuery] = useAtomStateCompat();
  const [searchHighlight, setSearchHighlight] = useState({ orderKey: "", index: 0 });
  const environmentIds = useAtomValue(connectedEnvironmentIdsAtom);
  const normalizedQuery = threadSearchQuery.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, THREAD_SEARCH_DEBOUNCE_MS);
  const canSearch = environmentIds.length > 0 && normalizedQuery.length >= 2;
  const settledQuery = canSearch && normalizedQuery === debouncedQuery ? debouncedQuery : null;
  const threadSearch = useAtomValue(
    settledQuery === null ? EMPTY_THREAD_SEARCH_ATOM : threadSearchResultsAtom(makeThreadSearchKey(environmentIds, settledQuery)),
  );
  const isDebouncing = canSearch && normalizedQuery !== debouncedQuery;
  const searchMatches = isDebouncing ? [] : threadSearch.matches;
  const searchPending = canSearch && (isDebouncing || threadSearch.isLoading);
  const isSearchingThreads = normalizedQuery.length > 0;
  const threadSearchMatchByKey = useMemo(
    () => new Map(searchMatches.map((match) => [threadSearchMatchKey(match), match] as const)),
    [searchMatches],
  );
  const threadSearchResults = useMemo(
    () => searchSidebarThreads(list.searchableThreads, threadSearchQuery, new Set(threadSearchMatchByKey.keys())),
    [list.searchableThreads, threadSearchQuery, threadSearchMatchByKey],
  );
  const resultOrderKey = threadSearchResults.map(threadShellKey).join("\0");
  const activeSearchResultIndex = searchHighlight.orderKey === resultOrderKey ? searchHighlight.index : 0;
  const setActiveSearchResultIndex = (index: number) =>
    setSearchHighlight({ orderKey: resultOrderKey, index });
  const clearThreadSearch = () => {
    setThreadSearchQuery("");
    setSearchHighlight({ orderKey: "", index: 0 });
  };
  const selectThreadSearchResult = (thread: EnvironmentThreadShell) => {
    clearThreadSearch();
    navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
  };

  // ── New thread / add project ──
  const newThreadContextProject = (() => {
    if (route.kind === "thread") {
      const shell = list.threadByKey.get(scopedThreadKey(scopeThreadRef(route.environmentId, route.threadId)));
      if (shell) return { environmentId: shell.environmentId, projectId: shell.projectId };
    }
    if (route.kind === "draft" && route.environmentId && route.projectId) {
      return { environmentId: route.environmentId, projectId: route.projectId };
    }
    const fallback = scope ?? groups[0] ?? null;
    return fallback ? { environmentId: fallback.environmentId, projectId: fallback.id } : null;
  })();
  const handleNewThread = (shiftKey: boolean) => {
    if (shouldCreateNewThreadInCurrentProject(shiftKey, groups.length) || newThreadContextProject === null) {
      if (newThreadContextProject) {
        startNewThread(scopeProjectRef(newThreadContextProject.environmentId, newThreadContextProject.projectId as ProjectId));
        return;
      }
      setRoute({ kind: "draft", environmentId: null, projectId: null });
      return;
    }
    // Web opens the palette's "New thread in…" picker here.
    openCommandPaletteMode("new-thread-in");
  };

  // web: newThreadShortcutLabel / newThreadInProjectShortcutLabel / showNewThreadInProjectHint
  const newThreadShortcut =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    (groups.length <= 1 ? shortcutLabelForCommand(keybindings, "chat.newLocal") : null);
  const newThreadInProjectShortcut = shortcutLabelForCommand(keybindings, "chat.newLocal");
  const newThreadLabel = newThreadShortcut ? `New thread (${newThreadShortcut})` : "New thread";
  const newThreadTooltip =
    groups.length > 1
      ? `${newThreadLabel}
New thread in current project: Shift+click${newThreadInProjectShortcut ? ` (${newThreadInProjectShortcut})` : ""}`
      : newThreadLabel;

  const scopedProjectKeys = scope === null
    ? null
    : new Set(scope.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`));

  // ── Rows ──
  const renameState = useAtomValue(sidebarRenameAtom);
  const listHeights = useRef(new Map<string, number>());
  const scrollMetrics = useRef<SidebarScrollMetrics>({
    x: 0,
    y: 0,
    width: sidebarWidth,
    height: 0,
    scrollTop: 0,
    contentHeight: 0,
    elementId: null,
  });
  const renderer = useGpuixRequired();
  // Web's sidebarListItems: the sortable rows and the zero-height drag markers, in render order.
  const sidebarListItems = useSidebarListItems(list);
  const { dragView, sweep } = useSidebarThreadDrag({
    list,
    items: sidebarListItems,
    measure: () => measureListItems(sidebarListItems, listHeights.current, scrollMetrics.current.width),
    metrics: scrollMetrics,
    renamingThreadKey: renameState?.threadKey ?? null,
    routeRowThreadKey,
    // GPUI scroll offsets grow negative as content moves up.
    scrollTo: (elementId, top) => renderer.scrollTo?.(elementId, 0, -top),
  });
  const dragFrom = dragView?.activeSection ?? null;
  const dragTargetSection = dragView?.targetSection ?? null;

  // web Sidebar revealRouteRow: the palette, history and links can open a thread
  // the list has scrolled away from. A route change, and each mount, scrolls the
  // open row into view once (`scrollIntoView({ block: "nearest" })`). Row boxes
  // come from the measured heights the drag uses; layout lands a frame after a
  // route or list change, so wait until the row and the scroller are measured.
  const mountRevealOwed = useRef(true);
  useEffect(() => {
    const pendingKey = pendingSidebarRouteReveal(sidebarRouteReveal, routeRowThreadKey);
    // Search results replace the thread list; reveal once the list returns.
    if (isSearchingThreads) return;
    const revealKey = pendingKey ?? (mountRevealOwed.current ? routeRowThreadKey : null);
    if (revealKey === null) return;
    const index = sidebarListItems.findIndex((item) => item.kind === "thread" && item.key === revealKey);
    if (index < 0) return;
    const itemId = sidebarListItemId(sidebarListItems[index]!);
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      const metrics = scrollMetrics.current;
      if (metrics.elementId === null || metrics.height <= 0 || !listHeights.current.has(itemId)) {
        if (++attempts < 30) timer = setTimeout(reveal, 16);
        return;
      }
      completeSidebarRouteReveal(sidebarRouteReveal);
      mountRevealOwed.current = false;
      const rect = measureListItems(sidebarListItems, listHeights.current, metrics.width)[index];
      if (!rect) return;
      const top = metrics.scrollTop;
      const next =
        rect.top < top ? rect.top : rect.bottom > top + metrics.height ? rect.bottom - metrics.height : top;
      // GPUI scroll offsets grow negative as content moves up.
      if (next !== top) renderer.scrollTo?.(metrics.elementId, 0, -next);
    };
    reveal();
    return () => clearTimeout(timer);
  }, [routeRowThreadKey, sidebarListItems, isSearchingThreads, renderer]);

  const jumpIndexByKey = new Map(list.orderedThreadKeys.map((key, index) => [key, index] as const));

  const renderThreadRow = (
    thread: EnvironmentThreadShell,
    section: SidebarSection,
    drag?: { readonly ghost: true },
  ) => {
    const key = threadShellKey(thread);
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    const variantAction: SidebarSweepAction = section === "snoozed" ? "unsnooze" : section === "settled" ? "unsettle" : "settle";
    const projectKey = `${thread.environmentId}:${thread.projectId}`;
    const jumpIndex = jumpIndexByKey.get(key);
    return (
      <SidebarThreadRow
        key={drag ? "drag-ghost" : key}
        thread={thread}
        variant={section === "active" || section === "pinned" || section === "working" ? "card" : "slim"}
        variantAction={variantAction}
        settlementSupported={capabilities?.threadSettlement === true}
        snoozeSupported={capabilities?.threadSnooze === true}
        pinningSupported={capabilities?.threadPinning === true}
        snoozeWakeLabelText={
          section === "snoozed" && thread.snoozedUntil != null
            ? snoozeWakeLabel(thread.snoozedUntil, { now: new Date().toISOString() })
            : null
        }
        wokeAt={threadWokeAt(thread, { now: list.snoozeNow })}
        isActive={routeRowThreadKey === key}
        isRouteThread={routeThreadKey === key}
        jumpLabel={jumpHintsVisible && jumpIndex !== undefined ? (jumpHintLabels[jumpIndex] ?? null) : null}
        isRemote={primaryEnvironmentId !== null && thread.environmentId !== primaryEnvironmentId}
        project={projectByKey.get(projectKey) ?? null}
        projectDisplayName={projectDisplayNameByKey.get(projectKey) ?? null}
        providerEntryByInstanceId={providerEntriesByEnvironment.get(thread.environmentId) ?? EMPTY_PROVIDER_ENTRIES}
        sweepAction={sweep?.keys.has(key) ? sweep.action : null}
        {...(drag
          ? {
              dragGhost: true,
              dropVerb: dragView ? resolveSidebarDropVerb(dragView.activeSection, dragTargetSection) : null,
              dragOverPinned: dragTargetSection === "pinned",
            }
          : {})}
      />
    );
  };

  const totalThreads =
    list.pinnedThreads.length +
    list.activeThreads.length +
    list.workingThreads.length +
    list.snoozedThreads.length +
    list.settledThreads.length;
  const visibleDraftCount = drafts.filter(
    (draft) => scopedProjectKeys === null || scopedProjectKeys.has(`${draft.environmentId}:${draft.projectId}`),
  ).length;

  const listEntries: ListEntry[] = [];
  if (!isSearchingThreads) {
    listEntries.push({ key: "draft-sessions", kind: "other", element: <SidebarDraftBlock scopedProjectKeys={scopedProjectKeys} /> });
    let shelfSpacerPlaced = false;
    for (const item of sidebarListItems) {
      const key = sidebarListItemId(item);
      if (item.kind === "thread") {
        const thread = list.threadByKey.get(item.key);
        if (thread) listEntries.push({ key, kind: "row", element: renderThreadRow(thread, item.section) });
        continue;
      }
      // The first shelf header takes `mt-auto`: shelves sit at the bottom of the list.
      if (!shelfSpacerPlaced && SHELF_MARKERS.has(item.marker)) {
        shelfSpacerPlaced = true;
        listEntries.push({ key: SHELF_SPACER_KEY, kind: "spacer", element: null });
      }
      listEntries.push({
        key,
        kind: SHELF_MARKERS.has(item.marker) ? "other" : "marker",
        element: renderListMarker(item.marker, {
          list,
          dragFrom,
          dragTargetSection,
        }),
      });
    }
    if (list.settledExpanded && list.hiddenSettledCount > 0) {
      listEntries.push({
        key: "show-more",
        kind: "other",
        element: <ShowMoreSettled count={Math.min(list.hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} />,
      });
    }
    if (dragView !== null && dragView.overflow > 0) {
      listEntries.push({
        key: "drag-overflow",
        kind: "other",
        element: <div style={{ height: dragView.overflow, flexShrink: 0 }} />,
      });
    }
  }
  const draggedThread = dragView ? list.threadByKey.get(dragView.activeKey) : undefined;
  const dragGhost =
    dragView && draggedThread ? (
      <div
        key="drag-ghost"
        style={{ position: "absolute", left: 0, right: 0, top: dragView.ghostTop, pointerEvents: "none" }}
      >
        {renderThreadRow(draggedThread, dragView.activeSection, { ghost: true })}
      </div>
    ) : null;

  return (
    <div
      testId="sidebar"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: sidebarWidth,
        height: "100%",
        flexShrink: 0,
        // The mobile sheet paints SheetPopup's bg-popover behind the sidebar.
        backgroundColor: inSheet ? theme.popover : theme.sidebar.background,
        borderRightWidth: 1,
        borderColor: theme.sidebar.border,
      }}
    >
      {backdropVariant ? <StageBackdrop variant={backdropVariant} width={sidebarWidth - 1} /> : null}
      <SidebarChromeHeader />
      <div style={{ padding: 8, flexShrink: 0 }}>
        <SidebarThreadHeader
          hasProjects={groups.length > 0}
          onNewProject={requestAddProject}
          onNewThread={handleNewThread}
          newThreadDisabled={projects.length === 0}
          newThreadLabel={newThreadTooltip}
          searchQuery={threadSearchQuery}
          onSearchQueryChange={(value) => {
            setThreadSearchQuery(value);
            setSearchHighlight({ orderKey: "", index: 0 });
          }}
          onSearchKeyDown={(key, preventDefault) => {
            if (key === "escape" && isSearchingThreads) {
              preventDefault();
              clearThreadSearch();
              return;
            }
            if (threadSearchResults.length === 0) return;
            if (key === "down") {
              preventDefault();
              setActiveSearchResultIndex((activeSearchResultIndex + 1) % threadSearchResults.length);
            } else if (key === "up") {
              preventDefault();
              setActiveSearchResultIndex(
                (activeSearchResultIndex - 1 + threadSearchResults.length) % threadSearchResults.length,
              );
            }
          }}
          onSearchSubmit={() => {
            const result = threadSearchResults[activeSearchResultIndex];
            if (result) selectThreadSearchResult(result);
          }}
          isSearching={isSearchingThreads}
          onClearSearch={clearThreadSearch}
          onOpenProjectSettings={(project) => openProjectSettings(project)}
        />
      </div>
      <ScrollFadeRegion metrics={scrollMetrics}>
        {isSearchingThreads ? (
          threadSearchResults.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: 1 }}>
              {threadSearchResults.map((thread, index) => {
                const key = threadShellKey(thread);
                const projectKey = `${thread.environmentId}:${thread.projectId}`;
                return (
                  <SidebarSearchResultRow
                    key={key}
                    index={index}
                    isSettled={list.sectionByThreadKey.get(key) === "settled"}
                    thread={thread}
                    project={projectByKey.get(projectKey) ?? null}
                    projectDisplayName={projectDisplayNameByKey.get(projectKey) ?? null}
                    providerEntryByInstanceId={providerEntriesByEnvironment.get(thread.environmentId) ?? EMPTY_PROVIDER_ENTRIES}
                    isHighlighted={activeSearchResultIndex === index}
                    isRouteActive={routeRowThreadKey === key}
                    searchMatch={threadSearchMatchByKey.get(threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id })) ?? null}
                    searchQuery={threadSearchQuery}
                    onHighlight={setActiveSearchResultIndex}
                    onSelect={selectThreadSearchResult}
                  />
                );
              })}
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 24, paddingBottom: 24, paddingLeft: 8, paddingRight: 8 }}>
              <Text size="xs" color={theme.sidebar.mutedForeground}>
                {searchPending ? "Searching thread messages…" : "No threads found"}
              </Text>
            </div>
          )
        ) : (
          <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", gap: LIST_GAP, userSelect: "none", ...(totalThreads > 0 ? { flexGrow: 1 } : {}) }}>
            <CulledListItems
              entries={listEntries}
              heights={listHeights.current}
              offsets={dragView?.offsets ?? null}
              liftedKey={dragView?.activeKey ?? null}
              overlay={dragGhost}
            />
          </div>
        )}
        {!isSearchingThreads && visibleDraftCount === 0 && totalThreads === 0 ? (
          <SidebarEmptyState noProjects={projects.length === 0} scopedName={scope?.displayName ?? null} />
        ) : null}
      </ScrollFadeRegion>
      <SidebarChromeFooter />
      <SidebarContextMenuHost />
      <RouteVisitWatermark />
    </div>
  );
}

const FADE_SIZE = 12;
const SHELF_SPACER_KEY = "shelf-spacer";
/** The list's `gap-px`. */
const LIST_GAP = 1;
const SHELF_MARKERS: ReadonlySet<SidebarListMarker> = new Set(["working-header", "snoozed-header", "settled-header"]);

/**
 * One child of the thread list. Markers are zero-height `-mb-px` items: they
 * take no room until a drag projects space for them. The spacer is the first
 * shelf header's `mt-auto`.
 */
interface ListEntry {
  readonly key: string;
  readonly kind: "row" | "marker" | "spacer" | "other";
  readonly element: ReactElement | null;
}

/** Heights before an item is measured: card rows, slim rows, shelf headers. */
function estimatedHeight(item: SidebarListItem): number {
  if (item.kind === "marker") return SHELF_MARKERS.has(item.marker) ? 32 : 0;
  return item.section === "pinned" || item.section === "active" || item.section === "working" ? 82 : 36;
}

/**
 * Each sortable item's box in list-content pixels, walked from the measured
 * heights exactly as the flex column lays them out (what dnd-kit measures from
 * the DOM). The list starts at the content's top; the content has 8px sides.
 */
function measureListItems(
  items: ReadonlyArray<SidebarListItem>,
  heights: ReadonlyMap<string, number>,
  width: number,
): SidebarRect[] {
  const rects: SidebarRect[] = [];
  let top = (heights.get("draft-sessions") ?? 0) + LIST_GAP;
  let spacerPlaced = false;
  for (const item of items) {
    if (!spacerPlaced && item.kind === "marker" && SHELF_MARKERS.has(item.marker)) {
      spacerPlaced = true;
      top += heights.get(SHELF_SPACER_KEY) ?? 0;
    }
    const key = sidebarListItemId(item);
    const height = heights.get(key) ?? estimatedHeight(item);
    rects.push({ top, bottom: top + height, left: 8, right: width - 8, width: width - 16, height });
    top += height + (item.kind === "marker" && !SHELF_MARKERS.has(item.marker) ? 0 : LIST_GAP);
  }
  return rects;
}

/** Sidebar.tsx sidebarListItemsFresh, kept by identity until the order or a section changes. */
function useSidebarListItems(list: SidebarThreadList): ReadonlyArray<SidebarListItem> {
  const fresh = ((): SidebarListItem[] => {
    const rowsOf = (threads: ReadonlyArray<EnvironmentThreadShell>, section: SidebarSection): SidebarListItem[] =>
      threads.map((thread) => ({ kind: "thread", key: threadShellKey(thread), section }));
    if (
      list.pinnedThreads.length +
        list.activeThreads.length +
        list.workingThreads.length +
        list.snoozedThreads.length +
        list.settledThreads.length ===
      0
    ) {
      return [];
    }
    const items: SidebarListItem[] = [{ kind: "marker", marker: "pinned-header" }];
    items.push(...rowsOf(list.pinnedThreads, "pinned"));
    items.push({ kind: "marker", marker: "pinned-divider" });
    items.push({ kind: "marker", marker: "active-placeholder" });
    items.push(...rowsOf(list.activeThreads, "active"));
    if (list.workingThreads.length > 0) {
      items.push({ kind: "marker", marker: "working-header" });
      items.push(...rowsOf(list.visibleWorkingThreads, "working"));
    }
    if (list.snoozedThreads.length > 0) {
      items.push({ kind: "marker", marker: "snoozed-header" });
      items.push(...rowsOf(list.visibleSnoozedThreads, "snoozed"));
    }
    items.push({ kind: "marker", marker: "settled-header" });
    items.push({ kind: "marker", marker: "settled-placeholder" });
    items.push(...rowsOf(list.renderedSettledThreads, "settled"));
    return items;
  })();
  const key = fresh.map((item) => (item.kind === "thread" ? `${item.section}:${item.key}` : item.marker)).join(" ");
  const kept = useRef({ key, items: fresh as ReadonlyArray<SidebarListItem> });
  if (kept.current.key !== key) kept.current = { key, items: fresh };
  return kept.current.items;
}

function renderListMarker(
  marker: SidebarListMarker,
  context: {
    readonly list: SidebarThreadList;
    readonly dragFrom: SidebarSection | null;
    readonly dragTargetSection: SidebarSection | null;
  },
): ReactElement {
  const { list, dragFrom: from, dragTargetSection } = context;
  switch (marker) {
    case "pinned-header":
      return <SidebarDragBoundary marker="pinned-header" label="Pinned" visible={from !== null} isDropTarget={dragTargetSection === "pinned"} />;
    case "pinned-divider":
      return <SidebarDragBoundary marker="pinned-divider" label="Active" visible={from !== null} isDropTarget={dragTargetSection === "active"} />;
    case "active-placeholder":
      return (
        <SidebarSectionPlaceholder
          marker="active-placeholder"
          label="Active"
          showHint={
            from !== null &&
            (list.activeThreads.length === 0 ||
              (from === "active" &&
                list.activeThreads.length === 1 &&
                dragTargetSection !== null &&
                dragTargetSection !== "active"))
          }
          isDropTarget={dragTargetSection === "active"}
        />
      );
    case "settled-placeholder":
      return (
        <SidebarSectionPlaceholder
          marker="settled-placeholder"
          label="Settled"
          showHint={
            from !== null &&
            (list.renderedSettledThreads.length === 0 ||
              (from === "settled" &&
                list.renderedSettledThreads.length === 1 &&
                dragTargetSection !== null &&
                dragTargetSection !== "settled"))
          }
          isDropTarget={dragTargetSection === "settled"}
        />
      );
    case "working-header":
      return (
        <SidebarSectionHeader
          shelf="working"
          label={list.workingExpanded ? "Working" : `Working (${list.workingThreads.length})`}
          expanded={list.workingExpanded}
          onToggle={() => updateSidebarPersistedState({ workingExpanded: !list.workingExpanded })}
        />
      );
    case "snoozed-header":
      return (
        <SidebarSectionHeader
          shelf="snoozed"
          label={list.snoozedExpanded ? "Snoozed" : `Snoozed (${list.snoozedThreads.length})`}
          expanded={list.snoozedExpanded}
          onToggle={() => updateSidebarPersistedState({ snoozedExpanded: !list.snoozedExpanded })}
        />
      );
    case "settled-header":
      return (
        <SidebarSectionHeader
          shelf="settled"
          label={list.settledExpanded ? "Settled" : `Settled (${list.settledThreads.length})`}
          expanded={list.settledExpanded}
          onToggle={() => updateSidebarPersistedState({ settledExpanded: !list.settledExpanded })}
          dragging={from !== null}
          isDropTarget={dragTargetSection === "settled"}
        />
      );
  }
}

/** The thread list's visible window in content pixels, from ScrollFadeRegion. */
const ListViewportContext = createContext<{ top: number; height: number } | null>(null);

// Rows kept mounted beyond each edge of the viewport, in viewport heights.
// GPUI rebuilds every mounted row on every frame, so each one is paid for on
// every keystroke anywhere in the window: a full viewport each side cost about
// 1 ms more per frame than half of one. Half a viewport still covers what GPUI
// scrolls in one frame before React catches up.
const CULL_MARGIN = 0.5;

/**
 * The list's items, with those more than CULL_MARGIN viewports above or below the visible
 * window replaced by an empty box of their last measured height. GPUI builds
 * every child of a plain scroller each frame (about 0.25 ms per thread row), so
 * without this every frame of the window grew with the thread count: 100 rows
 * put typing in the composer at ~30 ms per frame. Items are measured with
 * onLayout, which fires only when a size changes; an item is culled only once
 * its height is known.
 *
 * During a drag every item shifts to its projected slot (`position: relative`
 * offsets, which leave layout alone, like dnd-kit's transforms). The dragged
 * row stays mounted in place but invisible, because it holds the pointer
 * capture; `overlay` paints its lifted copy last, so above every other row.
 */
function CulledListItems({
  entries,
  heights,
  offsets,
  liftedKey,
  overlay,
}: {
  entries: ReadonlyArray<ListEntry>;
  heights: Map<string, number>;
  offsets: ReadonlyMap<string, number | null> | null;
  liftedKey: string | null;
  overlay: ReactElement | null;
}) {
  const viewport = useContext(ListViewportContext);
  const [, remeasured] = useReducer((count: number) => count + 1, 0);
  let offset = 0;
  const children = entries.map((entry) => {
    const key = entry.key;
    const measure = (event: { height?: number }) => {
      const next = Math.round(event.height ?? 0);
      if (heights.get(key) === next) return;
      heights.set(key, next);
      remeasured();
    };
    if (entry.kind === "spacer") {
      offset += heights.get(key) ?? 0;
      return <div key={key} onLayout={measure} style={{ flexGrow: 1, minHeight: 0, marginBottom: -LIST_GAP }} />;
    }
    const height = heights.get(key);
    const top = offset;
    offset += (height ?? 0) + (entry.kind === "marker" ? 0 : LIST_GAP);
    const culled =
      key !== liftedKey &&
      height !== undefined &&
      viewport !== null &&
      viewport.height > 0 &&
      (top + height < viewport.top - CULL_MARGIN * viewport.height || top > viewport.top + (1 + CULL_MARGIN) * viewport.height);
    const shift = offsets?.get(key);
    return (
      <div
        key={key}
        onLayout={(event) => {
          if (!culled) measure(event);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          flexShrink: 0,
          ...(entry.kind === "marker" ? { height: 0, marginBottom: -LIST_GAP } : {}),
          ...(culled ? { height } : {}),
          ...(shift !== undefined && shift !== null && shift !== 0 ? { position: "relative" as const, top: shift } : {}),
          // scaleY 0: a projected-away item keeps its box but does not paint.
          ...(shift === null || key === liftedKey ? { opacity: 0 } : {}),
        }}
      >
        {culled ? null : entry.element}
      </div>
    );
  });
  return (
    <>
      {children}
      {overlay}
    </>
  );
}

/**
 * SidebarContent's ScrollArea with `scrollFade`: the list scrolls under a
 * 12px fade at whichever edge has more content. Web masks the viewport; over
 * the black sidebar a gradient overlay looks the same. `metrics` follows the
 * scroller's window position and offset for the drag.
 */
function ScrollFadeRegion({
  children,
  metrics,
}: {
  children: ReactNode;
  metrics: { current: SidebarScrollMetrics };
}) {
  const theme = useTheme();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const hiddenBelow = contentHeight - viewportHeight + scrollY;
  const fade = (edge: "top" | "bottom") => (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        ...(edge === "top" ? { top: 0 } : { bottom: 0 }),
        height: FADE_SIZE,
        pointerEvents: "none",
        background: {
          type: "linear-gradient",
          angle: edge === "top" ? 180 : 0,
          stops: [
            { color: theme.sidebar.background, position: 0 },
            { color: alpha(theme.sidebar.background, 0), position: 1 },
          ],
        },
      }}
    />
  );
  const listWindow = useMemo(() => ({ top: -scrollY, height: viewportHeight }), [scrollY, viewportHeight]);
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <div
        testId="sidebar-thread-list"
        ref={(instance: { id: number } | null) => {
          metrics.current.elementId = instance?.id ?? null;
        }}
        onLayout={(event) => {
          metrics.current.x = event.x ?? metrics.current.x;
          metrics.current.y = event.y ?? metrics.current.y;
          metrics.current.width = event.width ?? metrics.current.width;
          metrics.current.height = event.height ?? 0;
          setViewportHeight(event.height ?? 0);
        }}
        onScrollChange={(event) => {
          metrics.current.scrollTop = -(event.scrollY ?? 0);
          setScrollY(event.scrollY ?? 0);
        }}
        style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}
      >
        <div
          onLayout={(event) => {
            metrics.current.contentHeight = event.height ?? 0;
            setContentHeight(event.height ?? 0);
          }}
          style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, flexShrink: 0, paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}
        >
          <ListViewportContext.Provider value={listWindow}>{children}</ListViewportContext.Provider>
        </div>
      </div>
      {scrollY < -0.5 ? fade("top") : null}
      {hiddenBelow > 0.5 ? fade("bottom") : null}
    </div>
  );
}

/** The sidebar search query lives in the shared ui atom so the palette can prefill it. */
function useAtomStateCompat(): [string, (value: string) => void] {
  const value = useAtomValue(sidebarSearchAtom);
  const set = useAtomSet(sidebarSearchAtom);
  return [value, set];
}

function RouteVisitWatermark() {
  const route = useAtomValue(routeAtom);
  if (route.kind !== "thread") return null;
  return <ThreadVisitWatermark threadRef={scopeThreadRef(route.environmentId, route.threadId)} />;
}

function ShowMoreSettled({ count }: { count: number }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const color = hovered ? theme.sidebar.foreground : alpha(theme.sidebar.mutedForeground, 0.55);
  return (
    <div
      testId="sidebar-show-more-settled"
      onClick={showMoreSettledThreads}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: 36,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        flexShrink: 0,
        cursor: "pointer",
        backgroundColor: hovered ? theme.sidebar.rowHover : "#00000000",
      }}
    >
      <Icon name="plus" size={16} color={color} />
      {/* One string: separate JSX children become separate gpuix text runs that wrap apart. */}
      <Text size="sm" color={color} style={{ whiteSpace: "nowrap" }}>
        {`Show ${count} more`}
      </Text>
    </div>
  );
}

function SidebarEmptyState({ noProjects, scopedName }: { noProjects: boolean; scopedName: string | null }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const color = alpha(theme.mutedForeground, 0.6);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 24, paddingBottom: 24, paddingLeft: 8, paddingRight: 8 }}>
      {noProjects ? (
        <>
          <Text size="xs" color={color}>
            No projects yet
          </Text>
          <div
            testId="sidebar-empty-add-project"
            onClick={requestAddProject}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingTop: 4,
              paddingBottom: 4,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: RADIUS.sm,
              borderWidth: 1,
              borderColor: theme.sidebar.border,
              cursor: "pointer",
              backgroundColor: hovered ? theme.sidebar.rowHover : "#00000000",
            }}
          >
            <Icon name="plus" size={12} color={hovered ? theme.sidebar.foreground : theme.sidebar.mutedForeground} />
            <Text size="2xs" weight={500} color={hovered ? theme.sidebar.foreground : theme.sidebar.mutedForeground}>
              Add project
            </Text>
          </div>
        </>
      ) : (
        <Text size="xs" color={color}>
          {scopedName ? `No threads in ${scopedName} yet` : "No threads yet"}
        </Text>
      )}
    </div>
  );
}

// ── Context menus (web: handleThreadContextMenu / handleDraftContextMenu) ──

function SidebarContextMenuHost() {
  const menu = useAtomValue(sidebarContextMenuAtom);
  const setMenu = useAtomSet(sidebarContextMenuAtom);
  if (menu === null) return null;
  const close = () => setMenu(null);
  return menu.kind === "thread" ? (
    <ThreadContextMenu threadKey={menu.threadKey} x={menu.x} y={menu.y} onClose={close} />
  ) : menu.kind === "selection" ? (
    <SelectionContextMenu x={menu.x} y={menu.y} onClose={close} />
  ) : (
    <DraftContextMenu draftId={menu.draftId} x={menu.x} y={menu.y} onClose={close} />
  );
}

/** Sidebar.tsx canOperateThreads / checkThreadOperations. */
function canOperateThreads(threads: ReadonlyArray<Pick<EnvironmentThreadShell, "environmentId">>): boolean {
  return threads.every((thread) => appAtomRegistry.get(canOperateEnvironmentAtom(thread.environmentId)));
}

function checkThreadOperations(threads: ReadonlyArray<Pick<EnvironmentThreadShell, "environmentId">>): boolean {
  if (canOperateThreads(threads)) return true;
  toast({
    type: "error",
    title: "Thread action unavailable",
    description: "This connection cannot change one or more selected threads.",
  });
  return false;
}

type SelectionMenuId = "unpin" | "settle" | "snooze" | `snooze:${string}` | "regenerate-title" | "mark-unread" | "delete";

/** Sidebar.tsx handleMultiSelectContextMenu: bulk actions over the selected rows. */
function SelectionContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const list = useAtomValue(sidebarThreadListAtom);
  const selection = useAtomValue(threadSelectionAtom);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const settings = useAtomValue(sidebarClientSettingsAtom);
  const threadKeys = [...selection.selectedThreadKeys].filter((threadKey) => list.threadByKey.has(threadKey));
  if (threadKeys.length === 0) return null;
  const count = threadKeys.length;
  const selectionNow = new Date();
  const selectedThreads = threadKeys.flatMap((threadKey) => {
    const thread = list.threadByKey.get(threadKey);
    return thread ? [thread] : [];
  });
  const capabilitiesOf = (thread: EnvironmentThreadShell) => serverConfigs.get(thread.environmentId)?.environment.capabilities;
  const settlingThreads = selectedThreads.filter((thread) => thread.settledOverride !== "settled");
  const canSnoozeSelection = selectedThreads.every(
    (thread) => capabilitiesOf(thread)?.threadSnooze === true && canSnooze(thread, { now: selectionNow.toISOString() }),
  );
  const titleRegenerationThreads = selectedThreads.filter((thread) => capabilitiesOf(thread)?.threadTitleRegeneration === true);
  const regeneratableTitleThreads = titleRegenerationThreads.filter((thread) => thread.titleRegeneration == null);
  const titleRegenerationMenuItem = buildBulkTitleRegenerationContextMenuItem({
    supportedCount: titleRegenerationThreads.length,
    actionableCount: regeneratableTitleThreads.length,
  });
  const pinnedSelectedThreads = selectedThreads.filter(
    (thread) => capabilitiesOf(thread)?.threadPinning === true && thread.pinnedAt != null,
  );
  const unpinMenuItem = buildBulkUnpinContextMenuItem({ pinnedCount: pinnedSelectedThreads.length });
  const snoozePresets = resolveSnoozePresets(new Date(), settings.timestampFormat);
  const items: ContextMenuItem<SelectionMenuId>[] = [
    ...(unpinMenuItem ? [{ ...unpinMenuItem, disabled: !canOperateThreads(pinnedSelectedThreads) }] : []),
    {
      id: "settle",
      label: `Settle (${count})`,
      disabled: settlingThreads.length === 0 || !canOperateThreads(settlingThreads),
    },
    ...(canSnoozeSelection
      ? [
          {
            id: "snooze" as const,
            label: `Snooze (${count})`,
            disabled: !canOperateThreads(selectedThreads),
            children: [
              ...snoozePresets.map((preset) => ({
                id: `snooze:${preset.id}` as const,
                label: `${preset.label} (${preset.whenLabel})`,
                disabled: !canOperateThreads(selectedThreads),
              })),
              {
                id: "snooze:custom" as const,
                label: "Custom…",
                separatorBefore: true,
                disabled: !canOperateThreads(selectedThreads),
              },
            ],
          },
        ]
      : []),
    ...(titleRegenerationMenuItem
      ? [
          {
            ...titleRegenerationMenuItem,
            disabled: titleRegenerationMenuItem.disabled || !canOperateThreads(regeneratableTitleThreads),
          },
        ]
      : []),
    { id: "mark-unread", label: `Mark unread (${count})` },
    { id: "delete", label: `Delete (${count})`, destructive: true, disabled: !canOperateThreads(selectedThreads) },
  ];
  const onSelect = (id: SelectionMenuId) => {
    void (async () => {
      const current = appAtomRegistry.get(sidebarThreadListAtom);
      const actionTargets =
        id === "unpin"
          ? pinnedSelectedThreads
          : id === "regenerate-title"
            ? regeneratableTitleThreads
            : id === "settle"
              ? settlingThreads.flatMap((thread) => {
                  const live = current.threadByKey.get(threadShellKey(thread));
                  return live && live.settledOverride !== "settled" ? [live] : [];
                })
              : selectedThreads;
      if (id === "settle" && actionTargets.length === 0) return;
      if (id !== "mark-unread" && !checkThreadOperations(actionTargets)) return;
      if (id.startsWith("snooze:")) {
        const preset =
          id === "snooze:custom"
            ? await requestCustomSnooze()
            : snoozePresets.find((candidate) => `snooze:${candidate.id}` === id);
        if (preset) {
          clearThreadSelection();
          for (const thread of selectedThreads) {
            attemptSnooze(scopeThreadRef(thread.environmentId, thread.id), preset.snoozedUntil);
          }
        }
        return;
      }
      switch (id) {
        case "unpin":
          for (const thread of pinnedSelectedThreads) attemptUnpin(scopeThreadRef(thread.environmentId, thread.id));
          clearThreadSelection();
          return;
        case "regenerate-title":
          for (const thread of regeneratableTitleThreads) {
            await regenerateThreadTitle(scopeThreadRef(thread.environmentId, thread.id));
          }
          clearThreadSelection();
          return;
        case "settle":
          settleThreadKeys(current, actionTargets.map(threadShellKey));
          clearThreadSelection();
          return;
        case "mark-unread":
          for (const threadKey of threadKeys) {
            const thread = current.threadByKey.get(threadKey);
            if (thread) markThreadUnread(scopeThreadRef(thread.environmentId, thread.id));
          }
          clearThreadSelection();
          return;
        case "delete": {
          if (appAtomRegistry.get(sidebarClientSettingsAtom).confirmThreadDelete) {
            const confirmed = await requestConfirmDialog(
              [
                `Delete ${count} thread${count === 1 ? "" : "s"}?`,
                "This permanently clears conversation history for these threads.",
              ].join("\n"),
              { variant: "destructive" },
            );
            if (!confirmed) return;
          }
          if (!checkThreadOperations(selectedThreads)) return;
          const { deletedThreadKeys, firstFailure } = await deleteSelectedThreadEntries({
            entries: threadKeys.map((threadKey) => ({ threadKey })),
            delete: async ({ threadKey }, deletedThreadKeys) => {
              const thread = appAtomRegistry.get(sidebarThreadListAtom).threadByKey.get(threadKey);
              if (!thread) return null;
              return deleteThread(scopeThreadRef(thread.environmentId, thread.id), { deletedThreadKeys });
            },
          });
          if (firstFailure !== null) reportResult(firstFailure, "Failed to delete threads");
          removeFromThreadSelection(
            getThreadKeysToDeselectAfterDelete(threadKeys, deletedThreadKeys, (threadKey) => {
              const ref = parseScopedThreadKey(threadKey);
              return ref !== null && readThreadShell(ref) !== null;
            }),
          );
          return;
        }
        default:
          return;
      }
    })();
  };
  return <ContextMenu items={items} x={x} y={y} onSelect={onSelect} onClose={onClose} testId="sidebar-selection-context-menu" />;
}


function ThreadContextMenu({ threadKey, x, y, onClose }: { threadKey: string; x: number; y: number; onClose: () => void }) {
  const list = useAtomValue(sidebarThreadListAtom);
  const groups = useAtomValue(sidebarProjectGroupsAtom);
  const scope = useAtomValue(sidebarProjectScopeAtom);
  const projectByKey = useAtomValue(projectByKeyAtom);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const settings = useAtomValue(sidebarClientSettingsAtom);
  const setRename = useAtomSet(sidebarRenameAtom);
  const threadRef = parseScopedThreadKey(threadKey);
  const thread = list.threadByKey.get(threadKey) ?? list.searchableThreads.find((candidate) => threadShellKey(candidate) === threadKey);
  if (!threadRef || !thread) return null;
  const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
  const section = list.sectionByThreadKey.get(threadKey);
  const projectGroup =
    groups.find((group) =>
      group.memberProjectRefs.some(
        (ref) => ref.environmentId === thread.environmentId && ref.projectId === thread.projectId,
      ),
    ) ?? null;
  const snoozePresets = resolveSnoozePresets(new Date(), settings.timestampFormat);
  const items = buildThreadActionMenuItems({
    canOperate: appAtomRegistry.get(canOperateEnvironmentAtom(thread.environmentId)),
    branch: thread.branch ?? null,
    projectFilter: projectGroup
      ? { label: projectGroup.displayName, isActive: scope?.projectKey === projectGroup.projectKey }
      : null,
    isPinned: thread.pinnedAt != null,
    isSettled: section === "settled",
    autoSettleEnabled: thread.autoSettleDisabledAt == null,
    isSnoozed: section === "snoozed",
    canSnoozeNow: canSnooze(thread, { now: new Date().toISOString() }),
    isRegeneratingTitle: thread.titleRegeneration != null,
    isRunning: !threadRuntimeCanArchive(thread.runtime),
    supports: {
      settlement: capabilities?.threadSettlement === true,
      autoSettleOptOut: capabilities?.threadAutoSettleOptOut === true,
      snooze: capabilities?.threadSnooze === true,
      pinning: capabilities?.threadPinning === true,
      titleRegeneration: capabilities?.threadTitleRegeneration === true,
    },
    snoozePresets,
  });
  const workspacePath =
    thread.worktreePath ?? projectByKey.get(`${thread.environmentId}:${thread.projectId}`)?.workspaceRoot ?? null;
  const onSelect = (id: ThreadActionMenuId) => {
    void handleThreadAction(id, threadRef, thread, {
      snoozePresets,
      projectGroup,
      scopeKey: scope?.projectKey ?? null,
      workspacePath,
      startRename: () => setRename({ threadKey, title: thread.title }),
    });
  };
  return <ContextMenu items={items} x={x} y={y} onSelect={onSelect} onClose={onClose} testId="sidebar-thread-context-menu" />;
}

async function handleThreadAction(
  id: ThreadActionMenuId,
  threadRef: ScopedThreadRef,
  thread: EnvironmentThreadShell,
  context: {
    readonly snoozePresets: ReturnType<typeof resolveSnoozePresets>;
    readonly projectGroup: SidebarProjectGroup | null;
    readonly scopeKey: string | null;
    readonly workspacePath: string | null;
    readonly startRename: () => void;
  },
): Promise<void> {
  if (id.startsWith("snooze:")) {
    const preset =
      id === "snooze:custom"
        ? await requestCustomSnooze()
        : context.snoozePresets.find((candidate) => `snooze:${candidate.id}` === id);
    if (preset) attemptSnooze(threadRef, preset.snoozedUntil);
    return;
  }
  switch (id) {
    case "filter-by-project":
      if (context.projectGroup) {
        setSidebarProjectScopeKey(
          context.scopeKey === context.projectGroup.projectKey ? null : context.projectGroup.projectKey,
        );
      }
      return;
    case "project-settings":
      if (context.projectGroup) {
        openProjectSettings(context.projectGroup, { environmentId: thread.environmentId, projectId: thread.projectId });
      }
      return;
    case "new-thread-on-branch":
      startNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        envMode: thread.worktreePath ? "worktree" : "local",
        startFromOrigin: false,
      });
      return;
    case "settle":
      attemptSettle(threadRef);
      return;
    case "unsettle":
      attemptUnsettle(threadRef);
      return;
    case "unsnooze":
      attemptUnsnooze(threadRef);
      return;
    case "pin":
      attemptPin(threadRef);
      return;
    case "unpin":
      attemptUnpin(threadRef);
      return;
    case "auto-settle:enabled":
    case "auto-settle:disabled":
      reportResult(
        await setThreadAutoSettle(threadRef, id === "auto-settle:enabled"),
        "Failed to update auto-settle",
      );
      return;
    case "rename":
      context.startRename();
      return;
    case "regenerate-title":
      if (thread.titleRegeneration == null) await regenerateThreadTitle(threadRef);
      return;
    case "mark-unread":
      markThreadUnread(threadRef);
      return;
    case "copy-path":
      if (!context.workspacePath) {
        toast({
          type: "error",
          title: "Path unavailable",
          description: "This thread does not have a workspace path to copy.",
        });
        return;
      }
      await copyToClipboard(context.workspacePath, { title: "Path copied", failureTitle: "Failed to copy path" });
      return;
    case "copy-branch":
      if (thread.branch) {
        await copyToClipboard(thread.branch, { title: "Branch copied", failureTitle: "Failed to copy branch" });
      }
      return;
    case "copy-thread-id":
      await copyToClipboard(thread.id, { title: "Thread ID copied", failureTitle: "Failed to copy thread ID" });
      return;
    case "archive":
      await attemptArchive(threadRef);
      return;
    case "delete":
      await attemptDelete(threadRef);
      return;
    default:
      return;
  }
}

function DraftContextMenu({ draftId, x, y, onClose }: { draftId: string; x: number; y: number; onClose: () => void }) {
  const drafts = useAtomValue(sidebarDraftsAtom);
  const groups = useAtomValue(sidebarProjectGroupsAtom);
  const projectByKey = useAtomValue(projectByKeyAtom);
  const discard = useAtomValue(sidebarDraftDiscardAtom);
  const draft = drafts.find((candidate) => candidate.draftId === draftId);
  if (!draft) return null;
  const projectGroup =
    groups.find((group) =>
      group.memberProjectRefs.some(
        (ref) => ref.environmentId === draft.environmentId && ref.projectId === draft.projectId,
      ),
    ) ?? null;
  const workspacePath =
    draft.worktreePath ?? projectByKey.get(`${draft.environmentId}:${draft.projectId}`)?.workspaceRoot ?? null;
  const items = buildDraftActionMenuItems({
    hasPath: Boolean(workspacePath),
    hasBranch: Boolean(draft.branch),
    hasProject: projectGroup != null,
  });
  const onSelect = (id: DraftActionMenuId) => {
    switch (id) {
      case "project-settings":
        if (projectGroup) openProjectSettings(projectGroup, { environmentId: draft.environmentId, projectId: draft.projectId });
        return;
      case "copy-path":
        if (workspacePath) void copyToClipboard(workspacePath, { title: "Path copied", failureTitle: "Failed to copy path" });
        return;
      case "copy-branch":
        if (draft.branch) void copyToClipboard(draft.branch, { title: "Branch copied", failureTitle: "Failed to copy branch" });
        return;
      case "discard":
        discard?.discardDraft(draftId);
        return;
    }
  };
  return <ContextMenu items={items} x={x} y={y} onSelect={onSelect} onClose={onClose} testId="sidebar-draft-context-menu" />;
}
