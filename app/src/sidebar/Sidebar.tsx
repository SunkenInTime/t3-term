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
import { THREAD_JUMP_KEYBINDING_COMMANDS, type ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentServerConfigsAtom } from "../state/environment.ts";
import {
  EMPTY_THREAD_SEARCH_ATOM,
  canOperateEnvironmentAtom,
  commandPaletteModeRequestAtom,
  connectedEnvironmentIdsAtom,
  newThreadContextRequestAtom,
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
  type SidebarProjectGroup,
  type SidebarProviderEntry,
} from "../state/sidebar.ts";
import { commandPaletteOpenAtom, routeAtom, sidebarSearchAtom } from "../state/ui.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast } from "../ui/toast.tsx";
import { LAYOUT, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
  type DraftActionMenuId,
  type ThreadActionMenuId,
} from "../web/components/threadActionMenu.logic.ts";
import { searchSidebarThreads, shouldCreateNewThreadInCurrentProject } from "../web/components/Sidebar.logic.ts";
import { resolveSnoozePresets, snoozeWakeLabel } from "../web/components/Sidebar.snooze.ts";
import { ContextMenu } from "./ContextMenu.tsx";
import { requestCustomSnooze } from "../dialogs/CustomSnoozeDialog.tsx";
import { SidebarChromeFooter, SidebarChromeHeader, useStageIdentification } from "./SidebarChrome.tsx";
import { SidebarDraftBlock } from "./SidebarDraftBlock.tsx";
import { SidebarSectionHeader } from "./SidebarListMarkers.tsx";
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
  markThreadUnread,
  navigateToThread,
  regenerateThreadTitle,
  reportResult,
  setThreadAutoSettle,
} from "./threadActions.ts";
import { ThreadVisitWatermark } from "./ThreadVisitWatermark.tsx";
import { shortcutLabelForCommand } from "./shortcutLabel.ts";

const THREAD_SEARCH_DEBOUNCE_MS = 200;
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
  appAtomRegistry.set(routeAtom, { kind: "settings", page: "general" });
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
      setRoute({
        kind: "draft",
        environmentId: newThreadContextProject?.environmentId ?? null,
        projectId: newThreadContextProject?.projectId ?? null,
      });
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
  const renderThreadRow = (thread: EnvironmentThreadShell, section: "pinned" | "active" | "working" | "snoozed" | "settled", index: number) => {
    const key = threadShellKey(thread);
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    const variantAction: SidebarSweepAction = section === "snoozed" ? "unsnooze" : section === "settled" ? "unsettle" : "settle";
    const projectKey = `${thread.environmentId}:${thread.projectId}`;
    return (
      <SidebarThreadRow
        key={key}
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
        jumpLabel={jumpHintsVisible ? (jumpHintLabels[index] ?? null) : null}
        isRemote={primaryEnvironmentId !== null && thread.environmentId !== primaryEnvironmentId}
        project={projectByKey.get(projectKey) ?? null}
        projectDisplayName={projectDisplayNameByKey.get(projectKey) ?? null}
        providerEntryByInstanceId={providerEntriesByEnvironment.get(thread.environmentId) ?? EMPTY_PROVIDER_ENTRIES}
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

  const listItems: ReactNode[] = [];
  if (!isSearchingThreads) {
    listItems.push(<SidebarDraftBlock key="draft-sessions" scopedProjectKeys={scopedProjectKeys} />);
    let rowIndex = 0;
    const pushRows = (threads: ReadonlyArray<EnvironmentThreadShell>, section: Parameters<typeof renderThreadRow>[1]) => {
      for (const thread of threads) listItems.push(renderThreadRow(thread, section, rowIndex++));
    };
    if (totalThreads > 0) {
      pushRows(list.pinnedThreads, "pinned");
      pushRows(list.activeThreads, "active");
      // The first shelf header takes `mt-auto`: shelves sit at the bottom of the list.
      listItems.push(<div key="shelf-spacer" style={{ flexGrow: 1, minHeight: 0 }} />);
      if (list.workingThreads.length > 0) {
        listItems.push(
          <SidebarSectionHeader
            key="working-shelf-header"
            shelf="working"
            label={list.workingExpanded ? "Working" : `Working (${list.workingThreads.length})`}
            expanded={list.workingExpanded}
            onToggle={() => updateSidebarPersistedState({ workingExpanded: !list.workingExpanded })}
          />,
        );
        pushRows(list.visibleWorkingThreads, "working");
      }
      if (list.snoozedThreads.length > 0) {
        listItems.push(
          <SidebarSectionHeader
            key="snoozed-shelf-header"
            shelf="snoozed"
            label={list.snoozedExpanded ? "Snoozed" : `Snoozed (${list.snoozedThreads.length})`}
            expanded={list.snoozedExpanded}
            onToggle={() => updateSidebarPersistedState({ snoozedExpanded: !list.snoozedExpanded })}
          />,
        );
        pushRows(list.visibleSnoozedThreads, "snoozed");
      }
      listItems.push(
        <SidebarSectionHeader
          key="settled-shelf-header"
          shelf="settled"
          label={list.settledExpanded ? "Settled" : `Settled (${list.settledThreads.length})`}
          expanded={list.settledExpanded}
          onToggle={() => updateSidebarPersistedState({ settledExpanded: !list.settledExpanded })}
        />,
      );
      pushRows(list.renderedSettledThreads, "settled");
      if (list.settledExpanded && list.hiddenSettledCount > 0) {
        listItems.push(<ShowMoreSettled key="show-more" count={Math.min(list.hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} />);
      }
    }
  }

  return (
    <div
      testId="sidebar"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: LAYOUT.sidebarWidth,
        height: "100%",
        flexShrink: 0,
        backgroundColor: theme.sidebar.background,
        borderRightWidth: 1,
        borderColor: theme.sidebar.border,
      }}
    >
      {backdropVariant ? <StageBackdrop variant={backdropVariant} width={LAYOUT.sidebarWidth - 1} /> : null}
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
      <ScrollFadeRegion>
        {isSearchingThreads ? (
          threadSearchResults.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 1, ...(totalThreads > 0 ? { flexGrow: 1 } : {}) }}>
            {listItems}
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

/**
 * SidebarContent's ScrollArea with `scrollFade`: the list scrolls under a
 * 12px fade at whichever edge has more content. Web masks the viewport; over
 * the black sidebar a gradient overlay looks the same.
 */
function ScrollFadeRegion({ children }: { children: ReactNode }) {
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
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div
        testId="sidebar-thread-list"
        onLayout={(event) => setViewportHeight(event.height ?? 0)}
        onScrollChange={(event) => setScrollY(event.scrollY ?? 0)}
        style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}
      >
        <div
          onLayout={(event) => setContentHeight(event.height ?? 0)}
          style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 0, paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}
        >
          {children}
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
      <Text size="sm" color={color}>
        Show {count} more
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

let newThreadContextNonce = 0;

function SidebarContextMenuHost() {
  const menu = useAtomValue(sidebarContextMenuAtom);
  const setMenu = useAtomSet(sidebarContextMenuAtom);
  if (menu === null) return null;
  const close = () => setMenu(null);
  return menu.kind === "thread" ? (
    <ThreadContextMenu threadKey={menu.threadKey} x={menu.x} y={menu.y} onClose={close} />
  ) : (
    <DraftContextMenu draftId={menu.draftId} x={menu.x} y={menu.y} onClose={close} />
  );
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
      appAtomRegistry.set(newThreadContextRequestAtom, {
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        envMode: thread.worktreePath ? "worktree" : "local",
        nonce: ++newThreadContextNonce,
      });
      appAtomRegistry.set(routeAtom, { kind: "draft", environmentId: thread.environmentId, projectId: thread.projectId });
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
