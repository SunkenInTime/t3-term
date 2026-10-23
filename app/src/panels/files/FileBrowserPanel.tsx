// Port of apps/web/src/components/files/FileBrowserPanel.tsx. The web tree is
// @pierre/trees (compact density); here it is one <virtual-list> of rows built by
// fileTreeRows.ts, with pierre's extension-keeping middle truncation (TreeName), the
// right-click menu and drag-to-mention (fileTreeActions.ts). Not ported: pierre's
// sticky folder rows.
import { useAtom, useAtomValue } from "@effect/atom-react";
import type { EventPayload } from "@gpuix/native";
import { useGpuixRequired, type KeyEvent, type PublicInstance } from "@gpuix/react";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ActionMenu } from "../../chat/header/ActionMenu.tsx";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { serverEnvironment } from "../../state/environment.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { joinHostPath } from "../../web/components/files/filePath.ts";
import { areAllDirectoriesExpanded, setAllDirectoriesExpanded } from "../../web/components/files/fileTreeExpansion.ts";
import { loadFileAncestors } from "../../web/components/files/loadFileAncestors.ts";
import { useProjectPathSearch } from "../../web/components/files/projectFilesQueryState.ts";
import { useDirectoryEntries } from "../../web/components/files/useDirectoryEntries.ts";
import { FileEntryIcon } from "./FileEntryIcon.tsx";
import {
  buildFileTreeRows,
  childrenByParent,
  normalizeTreeSearchQuery,
  parentPath,
  searchVisiblePaths,
  type FileTreeRow,
} from "./fileTreeRows.ts";
import { useWorkspaceMutationRefresh } from "./workspaceMutation.ts";
import { TreeName } from "./TreeName.tsx";
import {
  composerAtPoint,
  composerMentionFromTreePath,
  fileTreeMenuItems,
  insertMentionAtEnd,
  mentionDragOverAtom,
  runFileTreeMenuAction,
  type FileTreeMenuAction,
} from "./fileTreeActions.ts";
import { buildFileTreePathUpdates } from "../../web/components/files/fileTreePathReconciliation.ts";
import type { ContextMenuItem } from "@t3tools/contracts";

const ROW_HEIGHT = 24;
const ROW_INDENT = 19;
const TREE_INSET = 16;
/** pierre's default focus ring (--trees-accent) with the T3 overrides. */
const FOCUS_RING = "#009fff";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  selectedPath: string | null;
  selectedPathRevealId: number;
  onOpenFile: (relativePath: string) => void;
  /**
   * Set when `cwd` is a host folder outside the workspace rather than the
   * workspace root. Entries then open as host paths. A host folder can be a home
   * directory, so nothing walks it whole: there is no expand-all, and search
   * filters the folders already loaded instead of indexing on the server.
   */
  hostFolder?: boolean;
  onRefreshSelectedFile?: () => void;
  workspaceMutationId: string | null;
  /** The thread composer "Add to chat" and drags write mentions into. */
  composerDraftKey?: string | null;
}

/** How far a press must travel before it is a drag (dnd-kit's PointerSensor distance). */
const DRAG_DISTANCE = 6;

/**
 * Expanded folders per workspace. The web tree survives the switch from the explorer
 * surface to a file surface because React keeps the panel mounted; keeping the set
 * outside the component gives the same continuity when the surface remounts.
 */
const expandedFoldersAtom = Atom.family((_key: string) =>
  Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive),
);

// The tree diffs `treePaths` by identity in the web client; here the memo keeps the
// derived rows stable across renders that do not change the inputs.
function buildTreeEntries(
  directoryEntries: readonly ProjectEntry[],
  searchEntries: readonly ProjectEntry[],
  searchPending: boolean,
  query: string,
) {
  const result = new Map(directoryEntries.map((entry) => [entry.path, entry]));
  if (query.trim() && !searchPending) {
    for (const entry of searchEntries) {
      if (!result.has(entry.path)) result.set(entry.path, entry);
      const segments = entry.path.split("/");
      for (let index = 1; index < segments.length; index++) {
        const path = segments.slice(0, index).join("/");
        if (!result.has(path)) result.set(path, { path, kind: "directory" });
      }
    }
  }
  const entries = [...result.values()];
  const entryKinds: ReadonlyMap<string, ProjectEntry["kind"]> = new Map(
    entries.map((entry) => [entry.path, entry.kind] as const),
  );
  const directories = entries.filter((entry) => entry.kind === "directory");
  const directoryPaths = directories.map((entry) => entry.path);
  // Expanding a folder lists it, and an ignored one such as `node_modules` can hold tens of
  // thousands, so expand all skips ignored folders. They still open by hand.
  const expandableDirectoryPaths = directories.filter((entry) => !entry.ignored).map((entry) => entry.path);
  return { entries, entryKinds, directoryPaths, expandableDirectoryPaths };
}

function RefreshFilesButton(props: { isPending: boolean; onRefresh: () => void }) {
  const theme = useTheme();
  return (
    <Tooltip content={props.isPending ? "Refreshing…" : "Refresh files"}>
      <div
        testId="files-refresh"
        role="button"
        aria-label="Refresh workspace files"
        onClick={props.onRefresh}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          flexShrink: 0,
          borderRadius: RADIUS.md,
          cursor: "pointer",
          hover: { backgroundColor: theme.accent },
        }}
      >
        <Icon name="refresh-cw" size={14} color={theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}

/** InputGroup variant="ghost" (h-7) with an sm InputGroupInput. */
function FileSearchField(props: {
  ariaLabel: string;
  onClose: () => void;
  onValueChange: (value: string) => void;
  value: string;
  testId: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        flexGrow: 1,
        minWidth: 0,
        height: 28,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: focused ? theme.primary : "#00000000",
      }}
    >
      <input
        testId={props.testId}
        aria-label={props.ariaLabel}
        value={props.value}
        placeholder="Search files"
        onChange={(event) => props.onValueChange(String(event.value ?? ""))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event: KeyEvent) => {
          if (event.key !== "escape") return;
          event.stopPropagation();
          props.onClose();
        }}
        theme={{ caret: theme.foreground }}
        style={{
          flexGrow: 1,
          minWidth: 0,
          height: 26,
          paddingLeft: 9,
          paddingRight: 9,
          fontSize: 14,
          fontFamily: FONTS.sans,
          color: theme.foreground,
          backgroundColor: "#00000000",
        }}
      />
    </div>
  );
}

const TreeRow = memo(function TreeRow(props: {
  row: FileTreeRow;
  selected: boolean;
  focused: boolean;
  /** Indent levels that draw a guide line in this row. */
  guideLevel: number | null;
  onPress: (row: FileTreeRow) => void;
  menuItems: ReadonlyArray<ContextMenuItem<FileTreeMenuAction>>;
  onMenuAction: (row: FileTreeRow, action: FileTreeMenuAction) => void;
  onDragEnd: (row: FileTreeRow, x: number, y: number) => void;
}) {
  const theme = useTheme();
  const { row } = props;
  const [menu, setMenu] = useState<{ x: number } | null>(null);
  const [rowX, setRowX] = useState(0);
  // A press that travelled past DRAG_DISTANCE is a mention drag, not a click.
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const fg = row.ignored ? theme.mutedForeground : theme.foreground;
  const guideColor = theme.border;
  // The list's direct child is the row slot; it carries pierre's inline padding so the
  // row inside spans the full width between them.
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", paddingLeft: TREE_INSET, paddingRight: TREE_INSET }}>
    <ActionMenu<FileTreeMenuAction>
      open={menu !== null}
      onOpenChange={(open) => {
        if (!open) setMenu(null);
      }}
      items={props.menuItems}
      onSelect={(action) => {
        setMenu(null);
        props.onMenuAction(row, action);
      }}
      // Web opens the menu at the pointer; here it hangs under the row at the pointer's x.
      alignOffset={menu?.x ?? 0}
      testId={`files-row-menu:${row.path}`}
      rootStyle={{ width: "100%" }}
      trigger={
    <div
      testId={`files-row:${row.path}`}
      role="treeitem"
      aria-label={row.segments.join(" / ")}
      aria-expanded={row.kind === "directory" ? row.expanded : undefined}
      aria-selected={props.selected}
      onLayout={(event) => {
        const x = Number(event.x ?? 0);
        if (x !== rowX) setRowX(x);
      }}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        props.onPress(row);
      }}
      onAuxClick={(event: EventPayload) => {
        if (event.isRightClick) setMenu({ x: Math.max(0, Number(event.x ?? 0) - rowX) });
      }}
      onMouseDown={(event: EventPayload) => {
        if ((event.button ?? 0) === 0) press.current = { x: Number(event.x ?? 0), y: Number(event.y ?? 0), dragging: false };
      }}
      onMouseMove={(event: EventPayload) => {
        const state = press.current;
        if (!state || event.pressedButton !== 0) return;
        const x = Number(event.x ?? 0);
        const y = Number(event.y ?? 0);
        if (!state.dragging && Math.hypot(x - state.x, y - state.y) < DRAG_DISTANCE) return;
        state.dragging = true;
        const over = composerAtPoint(x, y);
        if (appAtomRegistry.get(mentionDragOverAtom) !== over) appAtomRegistry.set(mentionDragOverAtom, over);
      }}
      onMouseUp={(event: EventPayload) => {
        const state = press.current;
        press.current = null;
        if (!state?.dragging) return;
        suppressClick.current = true;
        appAtomRegistry.set(mentionDragOverAtom, null);
        props.onDragEnd(row, Number(event.x ?? 0), Number(event.y ?? 0));
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        position: "relative",
        height: ROW_HEIGHT,
        // pierre's 8px item padding less this row's 1px focus border, and its 1px icon nudge.
        paddingLeft: 6,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: props.focused ? FOCUS_RING : "#00000000",
        backgroundColor: props.selected ? alpha(theme.foreground, 0.12) : "#00000000",
        cursor: "pointer",
        ...(props.selected ? {} : { hover: { backgroundColor: alpha(theme.foreground, 0.07) } }),
      }}
    >
      {props.guideLevel !== null ? (
        <div
          style={{
            position: "absolute",
            top: -1,
            bottom: -1,
            left: 5 + props.guideLevel * ROW_INDENT + 5,
            width: 1,
            backgroundColor: guideColor,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {row.depth > 0 ? <div style={{ width: row.depth * ROW_INDENT, flexShrink: 0 }} /> : null}
      <div style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {row.kind === "directory" ? (
          <Icon name={row.expanded ? "chevron-down" : "chevron-right"} size={16} color={fg} strokeWidth={1.5} />
        ) : (
          <FileEntryIcon pathValue={row.path} kind="file" />
        )}
      </div>
      {row.kind === "file" ? (
        <div style={{ display: "flex", marginLeft: 4, minWidth: 0, flexShrink: 1, pointerEvents: "none" }}>
          <TreeName name={row.segments[0] ?? row.path} color={fg} />
        </div>
      ) : (
        <text
          style={{
            marginLeft: 4,
            color: fg,
            fontSize: 12,
            lineHeight: 16,
            fontFamily: FONTS.sans,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
            minWidth: 0,
            flexShrink: 1,
            pointerEvents: "none",
          }}
        >
          {row.segments.join(" / ")}
        </text>
      )}
    </div>
      }
    />
    </div>
  );
});

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  selectedPath,
  selectedPathRevealId,
  onOpenFile,
  onRefreshSelectedFile,
  workspaceMutationId,
  hostFolder = false,
  composerDraftKey = null,
}: FileBrowserPanelProps) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const panelPath = (relativePath: string) => (hostFolder ? joinHostPath(cwd, relativePath) : relativePath);
  const directory = useDirectoryEntries(environmentId, cwd);
  const { entries: directoryEntries, load, refresh, ready, error, isPending } = directory;
  const [query, setQuery] = useState("");
  const [expandAll, setExpandAll] = useState(false);
  const [expanded, setExpanded] = useAtom(expandedFoldersAtom(`${environmentId}\u0000${cwd}`));
  const pathSearch = useProjectPathSearch(
    { environmentId, cwd: hostFolder ? null : cwd, query: query.slice(0, 256) },
    200,
  );
  const directoryKey = directoryEntries.map((entry) => entry.path).join("\n");
  const { entries, entryKinds, directoryPaths, expandableDirectoryPaths } = useMemo(
    () => buildTreeEntries(directoryEntries, pathSearch.entries, pathSearch.isPending, query),
    // directoryEntries is rebuilt every render; its paths decide the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [directoryKey, directory.directories, pathSearch.entries, pathSearch.isPending, query],
  );
  const searchQuery = normalizeTreeSearchQuery(query);
  const children = useMemo(() => childrenByParent(entries), [entries]);
  const searchVisible = useMemo(() => searchVisiblePaths(entries, searchQuery), [entries, searchQuery]);
  // Pierre restores the unfiltered tree when a search has no matches.
  const hasNoSearchMatches = searchQuery.length > 0 && searchVisible === null;
  const rows = useMemo(
    () => buildFileTreeRows({ children, expanded, searchVisible }),
    [children, expanded, searchVisible],
  );
  const allDirectoriesExpanded = areAllDirectoriesExpanded(expanded, expandableDirectoryPaths);

  // web fileTreePathReconciliation: when a refresh drops paths, folders that are gone
  // leave the expansion set, as pierre's batch "remove" drops them from its model.
  const previousTreePathsRef = useRef<readonly string[] | null>(null);
  useEffect(() => {
    const nextPaths = entries.map((entry) => (entry.kind === "directory" ? `${entry.path}/` : entry.path));
    const previous = previousTreePathsRef.current;
    previousTreePathsRef.current = nextPaths;
    if (previous === null || query.trim()) return;
    const removed = buildFileTreePathUpdates(previous, nextPaths)
      .filter((update) => update.type === "remove")
      .map((update) => update.path.replace(/\/$/, ""));
    if (removed.length === 0) return;
    setExpanded((current) => {
      const next = new Set([...current].filter((path) => !removed.some((gone) => path === gone || path.startsWith(`${gone}/`))));
      return next.size === current.size ? current : next;
    });
  }, [entries, query, setExpanded]);

  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const menuItems = useMemo(() => fileTreeMenuItems(serverConfig), [serverConfig]);
  const menuActionRef = useRef<(row: FileTreeRow, action: FileTreeMenuAction) => void>(() => {});
  menuActionRef.current = (row, action) =>
    void runFileTreeMenuAction({ action, environmentId, cwd, path: panelPath(row.path), draftKey: composerDraftKey });
  const onMenuAction = useCallback((row: FileTreeRow, action: FileTreeMenuAction) => menuActionRef.current(row, action), []);
  const dragEndRef = useRef<(row: FileTreeRow, x: number, y: number) => void>(() => {});
  dragEndRef.current = (row, x, y) => {
    const target = composerAtPoint(x, y);
    const mention = composerMentionFromTreePath(panelPath(row.path));
    if (target !== null && mention !== null) insertMentionAtEnd(target, `${mention} `);
  };
  const onDragEnd = useCallback((row: FileTreeRow, x: number, y: number) => dragEndRef.current(row, x, y), []);

  const [selected, setSelected] = useState<string | null>(selectedPath);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [treeFocused, setTreeFocused] = useState(false);
  const treeRef = useRef<PublicInstance | null>(null);
  const listRef = useRef<PublicInstance | null>(null);
  const viewportHeightRef = useRef(0);
  const pendingScrollRef = useRef<string | null>(null);
  const treeSelectionPathRef = useRef<string | null>(null);
  const handledRevealRef = useRef<{ path: string; revealId: number } | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const toggleAllDirectories = () => {
    const next = !(expandAll || allDirectoriesExpanded);
    setExpandAll(next);
    setExpanded((current) =>
      setAllDirectoriesExpanded(current, next ? expandableDirectoryPaths : directoryPaths, next),
    );
  };

  // Expanding a folder lists it. A search shows its own expansion and loads nothing.
  useEffect(() => {
    if (searchQuery.length > 0) return;
    for (const path of expanded) {
      if (entryKinds.get(path) === "directory") void loadRef.current(path);
    }
  }, [expanded, entryKinds, searchQuery]);

  // A folder that turns out to hold a single folder shares its row with it; open the
  // rest of that chain too, so the row expands as one, like pierre's flattened rows.
  useEffect(() => {
    if (searchVisible !== null) return;
    const missing = rows.flatMap((row) =>
      row.kind === "directory" && row.expanded ? row.chain.filter((path) => !expanded.has(path)) : [],
    );
    if (missing.length === 0) return;
    setExpanded((current) => new Set([...current, ...missing]));
  }, [rows, expanded, searchVisible, setExpanded]);

  useEffect(() => {
    if (expandAll && !query.trim()) {
      setExpanded((current) => setAllDirectoriesExpanded(current, expandableDirectoryPaths, true));
    }
  }, [expandableDirectoryPaths, expandAll, query, setExpanded]);

  useEffect(() => {
    if (!selectedPath) return;
    const controller = new AbortController();
    void loadFileAncestors(selectedPath, (path) => loadRef.current(path), { signal: controller.signal });
    return () => {
      controller.abort();
    };
  }, [selectedPath]);

  const handleSearchValueChange = (value: string) => {
    setQuery(value);
  };
  const closeSearch = () => {
    setQuery("");
  };
  const handleRefresh = () => {
    refresh();
    if (query.trim()) pathSearch.refresh();
    onRefreshSelectedFile?.();
  };
  useWorkspaceMutationRefresh({
    mutationId: workspaceMutationId,
    refresh: () => {
      refresh();
      if (query.trim()) pathSearch.refresh();
    },
    resourceKey: `files:${environmentId}:${cwd}`,
  });

  // External opens (file picker, chat links, breadcrumbs) reveal their file here.
  useEffect(() => {
    if (!selectedPath) {
      handledRevealRef.current = null;
      setSelected(null);
      return;
    }
    const selectedKind = entryKinds.get(selectedPath);
    if (selectedKind === undefined) {
      handledRevealRef.current = null;
      return;
    }
    const revealRequest = { path: selectedPath, revealId: selectedPathRevealId };
    const handledReveal = handledRevealRef.current;
    // Entry refreshes rebuild the entries while the same preview stays open.
    // Replaying a handled reveal would close an active search and steal focus.
    if (handledReveal?.path === revealRequest.path && handledReveal.revealId === revealRequest.revealId) {
      return;
    }
    handledRevealRef.current = revealRequest;
    // A selection that came from a row click is already visible; re-revealing it
    // would close the search the user is in.
    if (treeSelectionPathRef.current === selectedPath) {
      treeSelectionPathRef.current = null;
      return;
    }
    treeSelectionPathRef.current = null;
    setQuery("");
    const ancestors: string[] = [];
    let ancestor = parentPath(selectedPath);
    while (ancestor !== "") {
      ancestors.push(ancestor);
      ancestor = parentPath(ancestor);
    }
    if (selectedKind === "directory") ancestors.push(selectedPath);
    setExpanded((current) => (ancestors.every((path) => current.has(path)) ? current : new Set([...current, ...ancestors])));
    setSelected(selectedPath);
    setFocusedPath(selectedPath);
    setTreeFocused(true);
    pendingScrollRef.current = selectedPath;
  }, [entryKinds, selectedPath, selectedPathRevealId, setExpanded]);

  // Scroll a revealed row to the middle once the rows that hold it exist.
  useLayoutEffect(() => {
    const target = pendingScrollRef.current;
    if (target === null || listRef.current === null) return;
    const index = rows.findIndex((row) => row.chain.includes(target) || row.path === target);
    if (index < 0) return;
    pendingScrollRef.current = null;
    const offset = -Math.max(0, Math.floor(viewportHeightRef.current / 2 - ROW_HEIGHT / 2));
    renderer.scrollToItem?.(listRef.current.id, index, offset);
  }, [rows, renderer]);

  const focusTree = () => {
    if (treeRef.current) renderer.focusElement?.(treeRef.current.id);
    setTreeFocused(true);
  };

  const toggleDirectory = (row: FileTreeRow) => {
    const willExpand = !row.expanded;
    if (!willExpand) setExpandAll(false);
    if (searchVisible !== null) {
      // A search shows every match expanded; collapsing leaves the search.
      setQuery("");
    }
    setExpanded((current) => {
      const next = new Set(current);
      for (const path of row.chain) {
        if (willExpand) next.add(path);
        else next.delete(path);
      }
      return next;
    });
  };

  const pressRow = (row: FileTreeRow) => {
    setFocusedPath(row.path);
    focusTree();
    if (row.kind === "directory") {
      toggleDirectory(row);
      return;
    }
    setSelected(row.path);
    treeSelectionPathRef.current = row.path;
    onOpenFile(panelPath(row.path));
  };

  // Rows are memoized; route presses through a ref so their props stay stable.
  const pressRowRef = useRef(pressRow);
  pressRowRef.current = pressRow;
  const onPressRow = useCallback((row: FileTreeRow) => pressRowRef.current(row), []);

  const moveFocus = (delta: number) => {
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row.path === (focusedPath ?? selected));
    const nextIndex = current < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, current + delta));
    const next = rows[nextIndex]!;
    setFocusedPath(next.path);
    if (listRef.current) renderer.scrollToItem?.(listRef.current.id, nextIndex);
  };

  const handleTreeKeyDown = (event: KeyEvent) => {
    const focusedRow = rows.find((row) => row.path === focusedPath) ?? null;
    switch (event.key) {
      case "down":
        event.preventDefault();
        moveFocus(1);
        return;
      case "up":
        event.preventDefault();
        moveFocus(-1);
        return;
      case "right":
        if (focusedRow?.kind === "directory" && !focusedRow.expanded) toggleDirectory(focusedRow);
        else if (focusedRow?.kind === "directory") moveFocus(1);
        return;
      case "left": {
        if (focusedRow?.kind === "directory" && focusedRow.expanded) {
          toggleDirectory(focusedRow);
          return;
        }
        const parent = focusedRow ? parentPath(focusedRow.chain[0]!) : "";
        const parentRow = rows.find((row) => row.path === parent);
        if (parentRow) setFocusedPath(parentRow.path);
        return;
      }
      case "enter":
      case "space":
        if (focusedRow) pressRow(focusedRow);
        return;
    }
  };

  // pierre draws one indent guide: down the children of the focused folder (or of the
  // focused file's folder) while the tree has focus.
  const guideParent = (() => {
    if (!treeFocused || focusedPath === null) return null;
    const focusedRow = rows.find((row) => row.path === focusedPath);
    if (!focusedRow) return null;
    if (focusedRow.kind === "directory" && focusedRow.expanded) return { path: focusedRow.path, depth: focusedRow.depth };
    if (focusedRow.depth === 0) return null;
    return { path: parentPath(focusedRow.chain[0]!), depth: focusedRow.depth - 1 };
  })();

  const showLoading = !ready || pathSearch.isPending;
  const loadingVisible = showLoading && (entries.length === 0 || hasNoSearchMatches);
  const hasDirectories = directoryPaths.length > 0 && !hostFolder;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.background }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 36,
          flexShrink: 0,
          marginBottom: 4,
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        <RefreshFilesButton isPending={isPending} onRefresh={handleRefresh} />
        <FileSearchField
          testId="files-search"
          ariaLabel={`Search ${projectName} files`}
          value={query}
          onValueChange={handleSearchValueChange}
          onClose={closeSearch}
        />
        {hasDirectories ? (
          <Tooltip content={expandAll || allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}>
            <div
              testId="files-expand-all"
              role="button"
              aria-label={expandAll || allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
              onClick={toggleAllDirectories}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                flexShrink: 0,
                borderRadius: RADIUS.md,
                cursor: "pointer",
                hover: { backgroundColor: theme.accent },
              }}
            >
              <Icon
                name={allDirectoriesExpanded ? "chevrons-down-up" : "chevrons-up-down"}
                size={14}
                color={theme.mutedForeground}
              />
            </div>
          </Tooltip>
        ) : null}
      </div>
      {error || pathSearch.error ? (
        <div testId="files-error" onClick={handleRefresh} style={{ padding: 16, cursor: "pointer" }}>
          <Text size="xs" color={theme.errorForeground} style={{ lineHeight: 19.5 }}>
            {`${error ?? pathSearch.error} Click to retry.`}
          </Text>
        </div>
      ) : null}
      {query.trim() && pathSearch.truncated && !pathSearch.isPending ? (
        <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4, flexShrink: 0 }}>
          <Text size="xs" color={theme.mutedForeground}>
            More matches available. Refine your search.
          </Text>
        </div>
      ) : null}
      {loadingVisible ? (
        <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4, flexShrink: 0 }}>
          <Text size="xs" color={theme.mutedForeground}>
            Loading files…
          </Text>
        </div>
      ) : null}
      {hasNoSearchMatches ? (
        ready && !isPending && !pathSearch.isPending && !error && !pathSearch.error ? (
          <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 16, paddingBottom: 16, flexShrink: 0 }}>
            <Text size="xs" color={theme.mutedForeground}>
              No matching files.
            </Text>
          </div>
        ) : null
      ) : (
        <div
          ref={treeRef}
          testId="files-tree"
          role="tree"
          aria-label={`${projectName} files`}
          tabIndex={0}
          onKeyDown={handleTreeKeyDown}
          onFocus={() => setTreeFocused(true)}
          onBlur={() => setTreeFocused(false)}
          onMouseDownOutside={() => setTreeFocused(false)}
          onLayout={(event) => {
            viewportHeightRef.current = Number(event.height ?? 0);
          }}
          style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, keyboardFocusDim: false }}
        >
          <virtual-list
            ref={listRef}
            estimatedItemHeight={ROW_HEIGHT}
            style={{ flexGrow: 1, minHeight: 0 }}
          >
            {rows.map((row) => (
              <TreeRow
                key={row.chain[0]}
                row={row}
                selected={selected !== null && row.path === selected}
                focused={treeFocused && focusedPath === row.path}
                guideLevel={
                  guideParent !== null &&
                  row.depth > guideParent.depth &&
                  (row.chain[0]!.startsWith(`${guideParent.path}/`))
                    ? guideParent.depth
                    : null
                }
                onPress={onPressRow}
                menuItems={menuItems}
                onMenuAction={onMenuAction}
                onDragEnd={onDragEnd}
              />
            ))}
          </virtual-list>
        </div>
      )}
    </div>
  );
}
