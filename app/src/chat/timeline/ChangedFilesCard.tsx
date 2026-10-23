// apps/web/src/components/chat/ChangedFilesTree.tsx: the "N changed files" card
// under an assistant reply, with a collapsible folder tree and "Open diff".
import type { RunId } from "@t3tools/contracts";
import { memo, useState } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { buildTurnDiffTree, summarizeTurnDiffStats, type TurnDiffTreeNode } from "../../web/lib/turnDiffTree.ts";
import type { TurnDiffFileChange } from "../../web/types.ts";
import { DiffStatLabel, hasNonZeroStat } from "./parts.tsx";

/** Rows rendered before "Show all": the card lives in one timeline row, so it stays bounded. */
const ROW_CAP = 250;
/** Monospace advance at 12px, used to middle-truncate names to the row's width. */
const MONO_CHAR_WIDTH = 6.6;

interface ChangedFileRow {
  node: TurnDiffTreeNode;
  depth: number;
}

function collectExpandedRows(
  nodes: ReadonlyArray<TurnDiffTreeNode>,
  overrides: Readonly<Record<string, boolean>>,
  allDirectoriesExpanded: boolean,
  depth = 0,
  rows: ChangedFileRow[] = [],
): ChangedFileRow[] {
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "directory" && (overrides[node.path] ?? allDirectoriesExpanded)) {
      collectExpandedRows(node.children, overrides, allDirectoriesExpanded, depth + 1, rows);
    }
  }
  return rows;
}

/** MiddleTruncate: keep both ends of a long name, eliding the middle. */
function middleTruncate(value: string, maxChars: number): string {
  if (maxChars <= 3 || value.length <= maxChars) return value;
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - (keep - head))}`;
}

/**
 * Web draws Pierre file-type icons; lucide has a few file glyphs, so the
 * extension picks the closest one.
 */
function fileIconFor(path: string): IconName {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "go", "py", "rb", "java", "kt", "swift", "c", "cc", "cpp", "h", "cs", "css", "scss", "html", "vue", "svelte"].includes(extension)) {
    return "file-code";
  }
  if (["json", "jsonc"].includes(extension)) return "file-json";
  if (["md", "mdx", "txt", "rst"].includes(extension)) return "file-text";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(extension)) return "file-image";
  if (["toml", "yaml", "yml", "ini", "env", "lock"].includes(extension)) return "file-cog";
  if (["sh", "bash", "zsh", "ps1"].includes(extension)) return "file-terminal";
  return "file";
}

/** Button size="xs" variant="ghost-muted" with optional label. */
function HeaderButton({ icon, label, tooltip, onClick, testId }: { icon: IconName; label?: string; tooltip: string; onClick: () => void; testId?: string }) {
  const theme = useTheme();
  return (
    <Tooltip content={tooltip} side="top">
      <div
        testId={testId}
        onClick={onClick}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          height: 24,
          ...(label ? { paddingLeft: 7, paddingRight: 7 } : { width: 24 }),
          borderRadius: RADIUS.md,
          cursor: "pointer",
          flexShrink: 0,
          hover: { backgroundColor: theme.accent },
        }}
      >
        <Icon name={icon} size={12} color={theme.mutedForeground} />
        {label ? (
          <Text size="xs" weight={500} color={theme.mutedForeground}>
            {label}
          </Text>
        ) : null}
      </div>
    </Tooltip>
  );
}

export const ChangedFilesCard = memo(function ChangedFilesCard({
  runId,
  files,
  allDirectoriesExpanded,
  onToggleAllDirectories,
  onOpenTurnDiff,
}: {
  runId: RunId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  onToggleAllDirectories: () => void;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}) {
  const theme = useTheme();
  const summaryStat = summarizeTurnDiffStats(files);
  const hasDirectories = files.some((file) => /[/\\]/.test(file.path));
  const [width, setWidth] = useState(736);
  const dark = theme.appearance === "dark";
  return (
    <div
      onLayout={(event) => {
        const next = Math.round(event.width ?? 0);
        if (next > 0 && next !== width) setWidth(next);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 16,
        borderRadius: RADIUS.lg,
        // dark:bg-input/20 (input is white 8%).
        backgroundColor: dark ? alpha("#ffffff", 0.016) : theme.secondary,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 8,
          paddingBottom: 8,
          borderTopLeftRadius: RADIUS.lg,
          borderTopRightRadius: RADIUS.lg,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 4, minWidth: 0 }}>
          <Text size="xs" weight={500}>
            {`${files.length} changed file${files.length === 1 ? "" : "s"}`}
          </Text>
          {hasNonZeroStat(summaryStat) ? (
            <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} fontSize={12} layout="inline" />
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {hasDirectories ? (
            <HeaderButton
              testId={`changed-files-toggle-${runId}`}
              icon={allDirectoriesExpanded ? "chevrons-down-up" : "chevrons-up-down"}
              tooltip={allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
              onClick={onToggleAllDirectories}
            />
          ) : null}
          <HeaderButton
            testId={`changed-files-open-diff-${runId}`}
            icon="file-diff"
            // Web shows the label once the card is at least 24rem wide.
            {...(width >= 384 ? { label: "Open diff" } : {})}
            tooltip="Open the full diff"
            onClick={() => onOpenTurnDiff(runId, files[0]?.path)}
          />
        </div>
      </div>
      <ChangedFilesTree
        key={`${runId}:${allDirectoriesExpanded}`}
        runId={runId}
        files={files}
        allDirectoriesExpanded={allDirectoriesExpanded}
        width={width}
        onOpenTurnDiff={onOpenTurnDiff}
      />
    </div>
  );
});

const ChangedFilesTree = memo(function ChangedFilesTree({
  runId,
  files,
  allDirectoriesExpanded,
  width,
  onOpenTurnDiff,
}: {
  runId: RunId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  width: number;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}) {
  const theme = useTheme();
  // Remounted (keyed) when "expand all" flips, so per-folder overrides reset like web.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const treeNodes = buildTurnDiffTree(files);
  const hasDirectoryNodes = treeNodes.some((node) => node.kind === "directory");
  const rows = collectExpandedRows(treeNodes, overrides, allDirectoriesExpanded);
  const shownRows = showAll ? rows : rows.slice(0, ROW_CAP);
  const toggleDirectory = (path: string) =>
    setOverrides((current) => ({ ...current, [path]: !(current[path] ?? allDirectoriesExpanded) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", padding: 8 }}>
      {shownRows.map(({ node, depth }) => {
        const leftPadding = 8 + depth * 14;
        // Row width less padding, chevron/icon slots, gaps and the stat columns.
        const nameChars = Math.floor((width - 16 - leftPadding - 8 - 14 - 14 - 24 - (node.stat ? 72 : 0)) / MONO_CHAR_WIDTH);
        if (node.kind === "directory") {
          const isExpanded = overrides[node.path] ?? allDirectoriesExpanded;
          return (
            <ChangedFileRowButton
              key={`dir:${node.path}`}
              leftPadding={leftPadding}
              onClick={() => toggleDirectory(node.path)}
              render={(hovered) => (
                <>
                  <Icon name={isExpanded ? "chevron-down" : "chevron-right"} size={14} color={hovered ? alpha(theme.foreground, 0.8) : alpha(theme.mutedForeground, 0.7)} />
                  <Icon name={isExpanded ? "folder" : "folder-closed"} size={14} color={alpha(theme.mutedForeground, 0.75)} />
                  <text
                    style={{
                      color: hovered ? alpha(theme.foreground, 0.9) : alpha(theme.mutedForeground, 0.9),
                      fontSize: 11,
                      lineHeight: 16,
                      fontFamily: FONTS.mono,
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {middleTruncate(node.name, nameChars)}
                  </text>
                  <div style={{ flexGrow: 1 }} />
                  {hasNonZeroStat(node.stat) ? <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} /> : null}
                </>
              )}
            />
          );
        }
        return (
          <ChangedFileRowButton
            key={`file:${node.path}`}
            testId={`changed-file-${node.path}`}
            leftPadding={leftPadding}
            onClick={() => onOpenTurnDiff(runId, node.path)}
            render={(hovered) => (
              <>
                {hasDirectoryNodes || depth > 0 ? <div style={{ width: 14, height: 14, flexShrink: 0 }} /> : null}
                <Icon name={fileIconFor(node.path)} size={14} color={alpha(theme.mutedForeground, 0.7)} />
                <text
                  style={{
                    color: hovered ? theme.foreground : alpha(theme.foreground, 0.85),
                    fontSize: 12,
                    lineHeight: 16,
                    fontFamily: FONTS.mono,
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {middleTruncate(node.name, nameChars)}
                </text>
                <div style={{ flexGrow: 1 }} />
                {node.stat ? <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} /> : null}
              </>
            )}
          />
        );
      })}
      {rows.length > ROW_CAP ? (
        <div
          onClick={() => setShowAll((value) => !value)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 28, paddingLeft: 8, borderRadius: RADIUS.md, cursor: "pointer", hover: { backgroundColor: alpha(theme.accent, 0.6) } }}
        >
          <Text size="xs" color={theme.mutedForeground}>
            {showAll ? "Show fewer" : `Show all ${rows.length} rows`}
          </Text>
        </div>
      ) : null}
    </div>
  );
});

/** A 28px row, radius 8, accent/60 on hover; children read the hover state for their colors. */
function ChangedFileRowButton({
  leftPadding,
  onClick,
  render,
  testId,
}: {
  leftPadding: number;
  onClick: () => void;
  render: (hovered: boolean) => React.ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 28,
        paddingLeft: leftPadding,
        paddingRight: 8,
        borderRadius: RADIUS.md,
        cursor: "pointer",
        minWidth: 0,
        backgroundColor: hovered ? alpha(theme.accent, 0.6) : "#00000000",
      }}
    >
      {render(hovered)}
    </div>
  );
}
