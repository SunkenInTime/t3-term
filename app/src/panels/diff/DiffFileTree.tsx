// Port of apps/web/src/components/diffs/DiffFileTree.tsx: the Diff surface's file tree.
// The web tree is @pierre/trees in compact density with flattened single-folder chains,
// every folder open at first, the diff's own file order, and the git status lane (an
// A/M/D/R letter per file, a faded dot on folders holding changes). Selecting a file
// reveals it in the diff.
import { memo, useCallback, useMemo, useRef, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  buildDiffTreeRows,
  collectDirectoryPaths,
  diffFileTreeEntries,
  type DiffGitStatus,
  type DiffTreeRow,
} from "../../web/components/diffs/diffFileTree.logic.ts";
import { FileEntryIcon } from "../files/FileEntryIcon.tsx";
import { TreeName } from "../files/TreeName.tsx";
import type { PatchFile } from "./patchFiles.ts";

const ROW_HEIGHT = 24;
const ROW_INDENT = 19;
const TREE_INSET = 16;
/** --trees-git-lane-width. */
const GIT_LANE = 12;

/** @pierre/trees --trees-{added,modified,deleted,renamed}-{light,dark}. */
function gitStatusColor(status: DiffGitStatus, dark: boolean): string {
  switch (status) {
    case "added":
      return dark ? "#00cab1" : "#16a994";
    case "modified":
      return dark ? "#08c0ef" : "#1ca1c7";
    case "deleted":
      return dark ? "#ff6762" : "#ff2e3f";
    case "renamed":
      return dark ? "#ffd452" : "#d5a910";
  }
}

const STATUS_LETTER: Record<DiffGitStatus, string> = { added: "A", modified: "M", deleted: "D", renamed: "R" };

const DiffTreeRowView = memo(function DiffTreeRowView(props: {
  row: DiffTreeRow;
  selected: boolean;
  onPress: (row: DiffTreeRow) => void;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  const { row } = props;
  const statusColor = row.status ? gitStatusColor(row.status, dark) : null;
  const fg = statusColor ?? theme.foreground;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", paddingLeft: TREE_INSET, paddingRight: TREE_INSET }}>
    <div
      testId={`diff-tree-row:${row.path}`}
      role="treeitem"
      aria-label={row.segments.join(" / ")}
      onClick={() => props.onPress(row)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: ROW_HEIGHT,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        backgroundColor: props.selected ? alpha(theme.foreground, 0.12) : "#00000000",
        cursor: "pointer",
        ...(props.selected ? {} : { hover: { backgroundColor: alpha(theme.foreground, 0.07) } }),
      }}
    >
      {row.depth > 0 ? <div style={{ width: row.depth * ROW_INDENT, flexShrink: 0 }} /> : null}
      <div style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", flexShrink: 0, pointerEvents: "none" }}>
        {row.kind === "directory" ? (
          <Icon name={row.expanded ? "chevron-down" : "chevron-right"} size={16} color={theme.foreground} strokeWidth={1.5} />
        ) : (
          <FileEntryIcon pathValue={row.path} kind="file" />
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", marginLeft: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        {row.kind === "directory" ? (
          <text
            style={{
              color: fg,
              fontSize: 12,
              lineHeight: 16,
              fontFamily: FONTS.sans,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
              minWidth: 0,
              pointerEvents: "none",
            }}
          >
            {row.segments.join(" / ")}
          </text>
        ) : (
          <TreeName name={row.segments[0] ?? row.path} color={fg} />
        )}
      </div>
      <div style={{ display: "flex", width: GIT_LANE, flexShrink: 0, alignItems: "center", justifyContent: "center", marginLeft: 4, pointerEvents: "none" }}>
        {row.kind === "file" && row.status ? (
          <text style={{ color: statusColor!, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, fontWeight: 600 }}>
            {STATUS_LETTER[row.status]}
          </text>
        ) : row.kind === "directory" ? (
          // data-item-contains-git-change: the modified colour at half opacity.
          <div style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: alpha(gitStatusColor("modified", dark), 0.5) }} />
        ) : null}
      </div>
    </div>
    </div>
  );
});

export function DiffFileTree(props: {
  readonly files: ReadonlyArray<PatchFile>;
  readonly selectedPath: string | null;
  readonly onSelectFile: (path: string) => void;
}) {
  const theme = useTheme();
  const entries = useMemo(() => diffFileTreeEntries(props.files), [props.files]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(entries.map((entry) => entry.path)), [entries]);
  // initialExpansion "open": the tree remembers what was closed, not what was opened.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => buildDiffTreeRows(entries, collapsed), [entries, collapsed]);
  const allExpanded = directoryPaths.length > 0 && directoryPaths.every((path) => !collapsed.has(path));

  const pressRef = useRef<(row: DiffTreeRow) => void>(() => {});
  pressRef.current = (row: DiffTreeRow) => {
    if (row.kind === "directory") {
      setCollapsed((current) => {
        const next = new Set(current);
        for (const path of row.chain) {
          if (row.expanded) next.add(path);
          else next.delete(path);
        }
        return next;
      });
      return;
    }
    props.onSelectFile(row.path);
  };
  const onPress = useCallback((row: DiffTreeRow) => pressRef.current(row), []);

  return (
    <div
      testId="diff-file-tree"
      role="tree"
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.background }}
    >
      {/* In the right panel the header is h-7 with mb-3 and a transparent border. */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 28,
          marginBottom: 12,
          flexShrink: 0,
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        <div style={{ paddingLeft: 4, paddingRight: 4 }}>
          <Text size="xs" weight={500}>
            Files
          </Text>
        </div>
        <div style={{ flexGrow: 1 }} />
        <Text size="xs" color={theme.mutedForeground}>
          {String(entries.length)}
        </Text>
        {directoryPaths.length > 0 ? (
          <Tooltip content={allExpanded ? "Collapse all folders" : "Expand all folders"}>
            <div
              testId="diff-tree-expand-all"
              role="button"
              aria-label={allExpanded ? "Collapse all folders" : "Expand all folders"}
              onClick={() => setCollapsed(allExpanded ? new Set(directoryPaths) : new Set())}
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
              <Icon name={allExpanded ? "chevrons-down-up" : "chevrons-up-down"} size={14} color={alpha(theme.foreground, 0.8)} />
            </div>
          </Tooltip>
        ) : null}
      </div>
      <virtual-list estimatedItemHeight={ROW_HEIGHT} style={{ flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar }}>
        {rows.map((row) => (
          <DiffTreeRowView
            key={row.chain[0]}
            row={row}
            selected={row.kind === "file" && row.path === props.selectedPath}
            onPress={onPress}
          />
        ))}
      </virtual-list>
    </div>
  );
}
