// apps/web/src/components/LegacySidebar.tsx: the per-project thread tree shown
// instead of the flat sidebar when Settings > General > "Sidebar (legacy)" is on.
// Brand header, a Search row that opens the command palette, the "Projects"
// label with the sidebar options menu and Add project, then one block per
// project (LegacyProjectItem), and the shared footer. With "Sort projects:
// Manual" a project row drags to reorder (web: dnd-kit SortableContext).
//
// Not ported: the desktop-only alerts (Intel build on Apple Silicon, local
// secondary backends), thread detail prewarming, file drops onto rows, the
// list's auto-animate, and auto-scroll while dragging a project.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { THREAD_JUMP_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  legacyExpandedThreadListsAtom,
  legacyProjectThreadsAtom,
  legacySidebarProjectsAtom,
  legacySidebarUiStateAtom,
  legacySortedProjectsAtom,
  legacyVisibleThreadKeysAtom,
  reorderLegacyProjects,
  readLegacyProjectThreads,
  resolveLegacyProjectExpanded,
} from "../../state/legacySidebar.ts";
import {
  primaryEnvironmentIdAtom,
  primaryKeybindingsAtom,
  routeThreadKeyAtom,
  sidebarClientSettingsAtom,
  sidebarJumpHintsVisibleAtom,
} from "../../state/sidebar.ts";
import { commandPaletteOpenAtom, routeAtom } from "../../state/ui.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Kbd, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { useInSidebarSheet, useSidebarWidth } from "../../ui/viewport.tsx";
import { requestAddProject } from "../Sidebar.tsx";
import { SidebarChromeFooter, SidebarChromeHeader, useStageIdentification } from "../SidebarChrome.tsx";
import { StageBackdrop } from "../StageBackdrop.tsx";
import { ThreadVisitWatermark } from "../ThreadVisitWatermark.tsx";
import { shortcutLabelForCommand } from "../shortcutLabel.ts";
import { LegacyContextMenuHost, LegacyProjectDialogs } from "./LegacyMenus.tsx";
import { LegacyProjectItem } from "./LegacyProjectItem.tsx";
import { HeaderIconButton, LegacySortMenu } from "./LegacySortMenu.tsx";
import {
  setLegacyProjectGestureHost,
  type LegacyGesturePoint,
  type LegacyProjectGestureHost,
} from "./legacyProjectGesture.ts";

const EMPTY_JUMP_LABELS: ReadonlyMap<string, string> = new Map();
/** SidebarMenu `gap-1` between project blocks. */
const PROJECT_GAP = 4;
/** The "Projects" label row (24) and its `mb-1`, above the first project. */
const PROJECTS_TOP = 28;
const FADE_SIZE = 12;

export function LegacySidebar() {
  const theme = useTheme();
  const sidebarWidth = useSidebarWidth();
  const inSheet = useInSidebarSheet();
  const { backdropVariant } = useStageIdentification();
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
        backgroundColor: inSheet ? theme.popover : theme.sidebar.background,
        borderRightWidth: 1,
        borderColor: theme.sidebar.border,
      }}
    >
      {backdropVariant ? <StageBackdrop variant={backdropVariant} width={sidebarWidth - 1} /> : null}
      <SidebarChromeHeader />
      <div style={{ padding: 8, flexShrink: 0 }}>
        <SearchRow />
      </div>
      <LegacyProjectList />
      <SidebarChromeFooter />
      <LegacyContextMenuHost />
      <LegacyProjectDialogs />
      <RouteVisitWatermark />
    </div>
  );
}

/** The fixed header's SidebarMenuButton: opens the command palette. */
function SearchRow() {
  const theme = useTheme();
  const keybindings = useAtomValue(primaryKeybindingsAtom);
  const [hovered, setHovered] = useState(false);
  const shortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  const color = hovered ? theme.sidebar.foreground : alpha(theme.sidebar.mutedForeground, 0.8);
  return (
    <div
      testId="command-palette-trigger"
      onClick={() => appAtomRegistry.set(commandPaletteOpenAtom, true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 32,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        cursor: "pointer",
        backgroundColor: hovered ? theme.sidebar.rowHover : "#00000000",
      }}
    >
      <Icon name="search" size={16} color={hovered ? theme.sidebar.foreground : theme.sidebar.icon} />
      <text style={{ flexGrow: 1, fontSize: 14, lineHeight: 20, fontWeight: 500, fontFamily: FONTS.sans, color }}>Search</text>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </div>
  );
}

interface DragState {
  readonly activeKey: string;
  readonly originY: number;
  readonly pointerY: number;
  readonly overKey: string | null;
}

/** The projects' scroll region: label row, project blocks, the empty state. */
function LegacyProjectList() {
  const theme = useTheme();
  const settings = useAtomValue(sidebarClientSettingsAtom);
  const { projectsLength, orderedProjectKeys, sidebarProjects } = useAtomValue(legacySidebarProjectsAtom);
  const sortedProjects = useAtomValue(legacySortedProjectsAtom);
  const projectThreads = useAtomValue(legacyProjectThreadsAtom);
  const { projectExpandedById } = useAtomValue(legacySidebarUiStateAtom);
  const expandedThreadLists = useAtomValue(legacyExpandedThreadListsAtom);
  const routeThreadKey = useAtomValue(routeThreadKeyAtom);
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const keybindings = useAtomValue(primaryKeybindingsAtom);
  const jumpHintsVisible = useAtomValue(sidebarJumpHintsVisibleAtom);
  const visibleThreadKeys = useAtomValue(legacyVisibleThreadKeysAtom);
  const isManualProjectSorting = settings.sidebarProjectSortOrder === "manual";

  const threadJumpLabelByKey = useMemo(() => {
    if (!jumpHintsVisible) return EMPTY_JUMP_LABELS;
    const labels = new Map<string, string>();
    visibleThreadKeys.slice(0, THREAD_JUMP_KEYBINDING_COMMANDS.length).forEach((threadKey, index) => {
      const label = shortcutLabelForCommand(keybindings, THREAD_JUMP_KEYBINDING_COMMANDS[index]!);
      if (label) labels.set(threadKey, label);
    });
    return labels;
  }, [jumpHintsVisible, visibleThreadKeys, keybindings]);
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal") ?? shortcutLabelForCommand(keybindings, "chat.new");

  // The route thread's project: only that block gets the active thread key, as web does.
  const activeRouteProjectKey = useMemo(() => {
    if (routeThreadKey === null) return null;
    for (const project of sortedProjects) {
      if (projectThreads.get(project.projectKey)?.orderedThreadKeys.includes(routeThreadKey)) return project.projectKey;
    }
    return null;
  }, [routeThreadKey, sortedProjects, projectThreads]);

  // ── Scroll window, heights, culling ──
  const heights = useRef(new Map<string, number>());
  const [, remeasured] = useReducer((count: number) => count + 1, 0);
  const [viewport, setViewport] = useState({ y: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  // ── Manual reorder (handleProjectDragStart / End) ──
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef({ sortedProjects, sidebarProjects, orderedProjectKeys, viewport, scrollTop, isManualProjectSorting });
  latest.current = { sortedProjects, sidebarProjects, orderedProjectKeys, viewport, scrollTop, isManualProjectSorting };
  const dragRef = useRef<DragState | null>(null);
  const rectsAtDragStart = useRef<ReadonlyArray<{ key: string; top: number; bottom: number }>>([]);

  useEffect(() => {
    const rectsNow = () => {
      let top = PROJECTS_TOP;
      return latest.current.sortedProjects.map((project) => {
        const height = heights.current.get(project.projectKey) ?? 32;
        const rect = { key: project.projectKey, top, bottom: top + height };
        top += height + PROJECT_GAP;
        return rect;
      });
    };
    const toContentY = (point: LegacyGesturePoint) => point.y - latest.current.viewport.y + latest.current.scrollTop;
    // pointerWithin, then closestCorners: the project under the pointer, else the nearest.
    const overAt = (contentY: number): string | null => {
      const rects = rectsAtDragStart.current;
      const hit = rects.find((rect) => contentY >= rect.top && contentY <= rect.bottom);
      if (hit) return hit.key;
      let best: { key: string; distance: number } | null = null;
      for (const rect of rects) {
        const distance = Math.min(Math.abs(contentY - rect.top), Math.abs(contentY - rect.bottom));
        if (best === null || distance < best.distance) best = { key: rect.key, distance };
      }
      return best?.key ?? null;
    };
    const update = (next: DragState | null) => {
      dragRef.current = next;
      setDrag(next);
    };
    const host: LegacyProjectGestureHost = {
      startDrag(projectKey, origin, point) {
        if (!latest.current.isManualProjectSorting) return false;
        rectsAtDragStart.current = rectsNow();
        update({ activeKey: projectKey, originY: origin.y, pointerY: point.y, overKey: overAt(toContentY(point)) });
        return true;
      },
      moveDrag(point) {
        const current = dragRef.current;
        if (current === null) return;
        update({ ...current, pointerY: point.y, overKey: overAt(toContentY(point)) });
      },
      endDrag(point) {
        const current = dragRef.current;
        update(null);
        if (current === null || point === null || !latest.current.isManualProjectSorting) return;
        const overKey = overAt(toContentY(point));
        if (overKey === null || overKey === current.activeKey) return;
        const activeProject = latest.current.sidebarProjects.find((project) => project.projectKey === current.activeKey);
        const overProject = latest.current.sidebarProjects.find((project) => project.projectKey === overKey);
        if (!activeProject || !overProject) return;
        reorderLegacyProjects(
          latest.current.orderedProjectKeys,
          activeProject.memberProjects.map((member) => member.physicalProjectKey),
          overProject.memberProjects.map((member) => member.physicalProjectKey),
        );
      },
    };
    setLegacyProjectGestureHost(host);
    return () => setLegacyProjectGestureHost(null);
  }, []);

  // verticalListSortingStrategy: projects between the dragged one and the drop
  // target shift by its height; the dragged one follows the pointer, clamped to
  // the scroll region (restrictToFirstScrollableAncestor).
  const offsets = new Map<string, number>();
  if (drag !== null) {
    const rects = rectsAtDragStart.current;
    const activeIndex = rects.findIndex((rect) => rect.key === drag.activeKey);
    const overIndex = drag.overKey === null ? activeIndex : rects.findIndex((rect) => rect.key === drag.overKey);
    const active = rects[activeIndex];
    if (active) {
      const shift = active.bottom - active.top + PROJECT_GAP;
      rects.forEach((rect, index) => {
        if (index > activeIndex && index <= overIndex) offsets.set(rect.key, -shift);
        else if (index < activeIndex && index >= overIndex) offsets.set(rect.key, shift);
      });
      const minDelta = scrollTop - active.top;
      const maxDelta = scrollTop + viewport.height - active.bottom;
      offsets.set(drag.activeKey, Math.max(minDelta, Math.min(maxDelta, drag.pointerY - drag.originY)));
    }
  }

  let blockTop = PROJECTS_TOP;
  const blocks = sortedProjects.map((project) => {
    const key = project.projectKey;
    const height = heights.current.get(key);
    const top = blockTop;
    blockTop += (height ?? 32) + PROJECT_GAP;
    const culled =
      drag === null &&
      height !== undefined &&
      viewport.height > 0 &&
      (top + height < scrollTop - viewport.height || top > scrollTop + 2 * viewport.height);
    const offset = offsets.get(key) ?? 0;
    const isDragging = drag?.activeKey === key;
    return (
      <div
        key={key}
        onLayout={(event) => {
          if (culled) return;
          const next = Math.round(event.height ?? 0);
          if (heights.current.get(key) === next) return;
          heights.current.set(key, next);
          remeasured();
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          flexShrink: 0,
          ...(culled ? { height } : {}),
          ...(offset !== 0 ? { position: "relative" as const, top: offset } : {}),
          ...(isDragging ? { opacity: 0.8 } : {}),
        }}
      >
        {culled ? null : (
          <LegacyProjectItem
            project={project}
            projectThreads={projectThreads.get(key) ?? readLegacyProjectThreads(key)}
            projectExpanded={resolveLegacyProjectExpanded(projectExpandedById, project)}
            isThreadListExpanded={expandedThreadLists.has(key)}
            activeRouteThreadKey={activeRouteProjectKey === key ? routeThreadKey : null}
            threadJumpLabelByKey={threadJumpLabelByKey}
            newThreadShortcutLabel={newThreadShortcutLabel}
            primaryEnvironmentId={primaryEnvironmentId}
            isManualProjectSorting={isManualProjectSorting}
            isDropTarget={drag !== null && drag.overKey === key && drag.activeKey !== key}
          />
        )}
      </div>
    );
  });

  const hiddenBelow = contentHeight - viewport.height - scrollTop;
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
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <div
        testId="legacy-project-list"
        onLayout={(event) => setViewport({ y: event.y ?? 0, height: event.height ?? 0 })}
        onScrollChange={(event) => setScrollTop(-(event.scrollY ?? 0))}
        style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}
      >
        <div
          onLayout={(event) => setContentHeight(event.height ?? 0)}
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            flexShrink: 0,
            paddingLeft: 8,
            paddingRight: 8,
            paddingBottom: 8,
            userSelect: "none",
          }}
        >
          <ProjectsLabelRow />
          <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: PROJECT_GAP }}>{blocks}</div>
          {projectsLength === 0 ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 16, paddingLeft: 8, paddingRight: 8 }}>
              <Text size="xs" color={theme.mutedForeground}>
                No projects yet
              </Text>
            </div>
          ) : null}
        </div>
      </div>
      {scrollTop > 0.5 ? fade("top") : null}
      {hiddenBelow > 0.5 ? fade("bottom") : null}
    </div>
  );
}

function ProjectsLabelRow() {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        height: 24,
        marginBottom: 4,
        paddingLeft: 8,
        paddingRight: 6,
        flexShrink: 0,
      }}
    >
      <Text size="xs" weight={500} color={alpha(theme.sidebar.mutedForeground, 0.8)}>
        Projects
      </Text>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
        <LegacySortMenu />
        <Tooltip content="Add project" side="right">
          <HeaderIconButton icon="folder-plus" testId="sidebar-add-project-trigger" onClick={requestAddProject} />
        </Tooltip>
      </div>
    </div>
  );
}

function RouteVisitWatermark() {
  const route = useAtomValue(routeAtom);
  if (route.kind !== "thread") return null;
  return <ThreadVisitWatermark threadRef={scopeThreadRef(route.environmentId, route.threadId)} />;
}
