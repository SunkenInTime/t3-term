// The Diff surface's patch view: a port of what @pierre/diffs paints for the
// web DiffPanel (stacked or split layout, soft wrap or horizontal scroll,
// per-file headers with fold/status/copy, "N unmodified lines" separators,
// word emphasis, change bars, Shiki pierre-dark colors).
//
// One windowed <virtual-list> holds every row, so a 20k-line patch mounts only
// the rows near the viewport. Highlighting runs in a worker per file side and
// arrives later without moving anything.
import type { EventPayload } from "@gpuix/native";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { copyTextToClipboard } from "../../chat/header/osActions.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import { diffPalette, type DiffPalette } from "../code/palette.ts";
import {
  CODE_LINE_HEIGHT,
  ChangeBar,
  CodeRun,
  hatchSvg,
  segmentsFor,
  useMonoCharWidth,
  wrapLine,
} from "../code/codeRows.tsx";
import { requestSyntaxTokens, peekSyntaxTokens, type SyntaxLines } from "../code/highlighter.ts";
import { EXPAND_BOTH, EXPAND_DOWN, EXPAND_UP, FILE_ADDED, FILE_DELETED, FILE_MODIFIED, FILE_MOVED } from "./pierreIcons.ts";
import { useListWindow } from "../code/listWindow.ts";
import { buildDiffRows, type DiffFileModel, type DiffLayout, type DiffRow, type LineCell } from "./diffModel.ts";

const WINDOW = 160;

// gpuix delivers one click to every nested handler under the pointer, innermost
// first, with no stopPropagation for mouse events. A control inside the file
// header marks the click so the header's own toggle skips it.
let consumedClick: { x: number; y: number; at: number } | null = null;
function consumeClick(event: EventPayload) {
  consumedClick = { x: Number(event.x ?? 0), y: Number(event.y ?? 0), at: Date.now() };
}
function wasConsumed(event: EventPayload): boolean {
  const consumed = consumedClick;
  return consumed !== null && consumed.x === Number(event.x ?? 0) && consumed.y === Number(event.y ?? 0) && Date.now() - consumed.at < 500;
}
const HEADER_HEIGHT = 32;
const SEPARATOR_HEIGHT = 24;
const BLOCK_GAP = 8;

interface FileTokens {
  readonly old: SyntaxLines | null;
  readonly new: SyntaxLines | null;
}

/** pierre getIconForType: the header's file-status glyph. */
function fileStatusIcon(file: DiffFileModel): string {
  if (file.kind === "new") return FILE_ADDED;
  if (file.kind === "deleted") return FILE_DELETED;
  if (file.kind === "renamed") return FILE_MOVED;
  return FILE_MODIFIED;
}

function fileTone(file: DiffFileModel, palette: DiffPalette): string {
  if (file.kind === "new") return palette.addition;
  if (file.kind === "deleted") return palette.deletion;
  return palette.modified;
}

/** Characters that fit beside a gutter of `digits` in `width` pixels: [line padding 1ch][text][1ch]. */
function gutterWidth(digits: number, ch: number): number {
  // pierre: number column padding-left 2ch, padding-right 1ch, digits wide.
  return Math.ceil((digits + 3) * ch);
}

export interface DiffViewProps {
  readonly files: ReadonlyArray<DiffFileModel>;
  readonly layout: DiffLayout;
  readonly wrap: boolean;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggleFile: (path: string) => void;
  readonly onOpenFile: (path: string) => void;
  /** Changes whenever the patch content changes, so scroll and window reset. */
  readonly resetKey: string;
}

export function DiffView(props: DiffViewProps) {
  const theme = useTheme();
  const palette = diffPalette(theme);
  const { width: ch, probe } = useMonoCharWidth();
  const [width, setWidth] = useState(0);
  const { listRef, start, onVisibleRange, reset, topIndex } = useListWindow(WINDOW);
  const [visible, setVisible] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [scrollX, setScrollX] = useState(0);
  const [tokens, setTokens] = useState<ReadonlyMap<DiffFileModel, FileTokens>>(new Map());
  const requested = useRef(new WeakSet<DiffFileModel>());

  const rows = useMemo(() => buildDiffRows(props.files, props.layout, props.collapsed), [props.files, props.layout, props.collapsed]);

  useEffect(() => {
    reset(0);
    setScrollX(0);
  }, [props.resetKey]);

  // Highlight the files whose rows are on screen (and the window around them).
  const appearance = theme.appearance;
  useEffect(() => {
    const from = Math.max(0, Math.min(visible.start, start));
    const to = Math.min(rows.length, Math.max(visible.end, start + WINDOW));
    const files = new Set<DiffFileModel>();
    for (let index = from; index < to; index += 1) {
      const row = rows[index];
      if (row && row.type !== "header" && row.type !== "end") files.add(row.file);
    }
    for (const file of files) {
      if (requested.current.has(file)) continue;
      requested.current.add(file);
      const oldCached = peekSyntaxTokens(file.oldSource, file.previousPath ?? file.path, appearance);
      const newCached = peekSyntaxTokens(file.newSource, file.path, appearance);
      if (oldCached !== undefined && newCached !== undefined) {
        setTokens((current) => new Map(current).set(file, { old: oldCached, new: newCached }));
        continue;
      }
      void Promise.all([
        file.oldSource.length > 0 ? requestSyntaxTokens(file.oldSource, file.previousPath ?? file.path, appearance) : Promise.resolve(null),
        file.newSource.length > 0 ? requestSyntaxTokens(file.newSource, file.path, appearance) : Promise.resolve(null),
      ]).then(([oldLines, newLines]) => {
        setTokens((current) => new Map(current).set(file, { old: oldLines, new: newLines }));
      });
    }
  }, [rows, visible.start, visible.end, start, appearance]);

  useEffect(() => {
    requested.current = new WeakSet();
    setTokens(new Map());
  }, [appearance]);

  // Wrap off: one horizontal offset for every row, so gutters stay put while code pans.
  const contentWidth = props.layout === "split" ? Math.floor(width / 2) : width;
  const longest = useMemo(() => {
    if (props.wrap) return 0;
    let max = 0;
    for (const file of props.files) {
      for (const hunk of file.hunks) for (const line of hunk.lines) max = Math.max(max, line.text.length);
    }
    return max;
  }, [props.files, props.wrap]);
  const maxDigits = props.files.reduce((max, file) => Math.max(max, file.numberDigits), 1);
  const maxScrollX = props.wrap ? 0 : Math.max(0, Math.ceil((longest + 2) * ch) - (contentWidth - gutterWidth(maxDigits, ch) - 2));
  const clampedScrollX = Math.min(scrollX, maxScrollX);

  const end = Math.min(rows.length, start + WINDOW);
  const stickyFile = (() => {
    const first = rows[visible.start];
    if (!first || first.type === "header") return null;
    return first.file;
  })();

  return (
    <div
      testId="diff-view"
      onLayout={(event) => {
        const next = Math.floor(Number(event.width ?? 0));
        if (next > 0 && next !== width) setWidth(next);
      }}
      onScroll={(event: EventPayload) => {
        if (props.wrap) return;
        const deltaX = Number(event.deltaX ?? 0);
        if (deltaX === 0) return;
        setScrollX((current) => Math.max(0, Math.min(maxScrollX, current - deltaX)));
      }}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, position: "relative", backgroundColor: palette.bg }}
    >
      {probe}
      {width > 0 ? (
        <virtual-list
          ref={listRef}
          itemCount={rows.length}
          windowStart={start}
          estimatedItemHeight={CODE_LINE_HEIGHT}
          overdraw={600}
          onVisibleRange={(event) => {
            const reportedFirst = Math.floor(Number(event.startIndex ?? 0));
            const reportedLast = Math.ceil(Number(event.endIndex ?? reportedFirst));
            const first = topIndex(reportedFirst);
            const last = first + (reportedLast - reportedFirst);
            setVisible((current) => (current.start === first && current.end === last ? current : { start: first, end: last }));
            onVisibleRange(reportedFirst, reportedLast);
          }}
          style={{ flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar }}
        >
          {rows.slice(start, end).map((row) => (
            <DiffRowView
              key={row.key}
              row={row}
              layout={props.layout}
              wrap={props.wrap}
              width={width}
              ch={ch}
              scrollX={clampedScrollX}
              tokens={tokens.get(row.file) ?? null}
              palette={palette}
              onToggleFile={props.onToggleFile}
              onOpenFile={props.onOpenFile}
            />
          ))}
        </virtual-list>
      ) : null}
      {stickyFile ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: HEADER_HEIGHT, backgroundColor: palette.bg }}>
          <FileHeader file={stickyFile} collapsed={false} palette={palette} onToggleFile={props.onToggleFile} onOpenFile={props.onOpenFile} />
        </div>
      ) : null}
    </div>
  );
}

const DiffRowView = memo(function DiffRowView(props: {
  row: DiffRow;
  layout: DiffLayout;
  wrap: boolean;
  width: number;
  ch: number;
  scrollX: number;
  tokens: FileTokens | null;
  palette: DiffPalette;
  onToggleFile: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const { row, palette } = props;
  switch (row.type) {
    case "header":
      return <FileHeader file={row.file} collapsed={row.collapsed} palette={palette} onToggleFile={props.onToggleFile} onOpenFile={props.onOpenFile} />;
    case "separator":
      return <SeparatorRow text={row.text} direction={row.direction} first={row.first} last={row.last} split={row.split} palette={palette} width={props.width} />;
    case "end":
      return <div style={{ height: BLOCK_GAP }} />;
    case "binary":
      return (
        <div style={{ display: "flex", alignItems: "center", height: HEADER_HEIGHT, paddingLeft: 16 }}>
          <text style={{ color: palette.separatorText, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>Binary file not shown</text>
        </div>
      );
    case "line": {
      const gutter = gutterWidth(row.file.numberDigits, props.ch);
      return (
        <div style={{ display: "flex", flexDirection: "row" }}>
          <LineCellView
            cell={row.cell}
            side={row.cell.line.kind === "deletion" ? "old" : "new"}
            gutter={gutter}
            width={props.width}
            wrap={props.wrap}
            ch={props.ch}
            scrollX={props.scrollX}
            tokens={props.tokens}
            palette={palette}
            rows={null}
          />
        </div>
      );
    }
    case "split": {
      const gutter = gutterWidth(row.file.numberDigits, props.ch);
      const half = Math.floor(props.width / 2);
      const leftRows = row.left ? visualRows(row.left, half, gutter, props.wrap, props.ch).length : 1;
      const rightRows = row.right ? visualRows(row.right, props.width - half, gutter, props.wrap, props.ch).length : 1;
      const rowCount = Math.max(leftRows, rightRows);
      const side = (cell: LineCell | null, sideWidth: number, which: "old" | "new") =>
        cell ? (
          <LineCellView
            cell={cell}
            side={which}
            gutter={gutter}
            width={sideWidth}
            wrap={props.wrap}
            ch={props.ch}
            scrollX={props.scrollX}
            tokens={props.tokens}
            palette={palette}
            rows={rowCount}
          />
        ) : (
          <EmptySide width={sideWidth} gutter={gutter} height={rowCount * CODE_LINE_HEIGHT} palette={palette} />
        );
      return (
        <div style={{ display: "flex", flexDirection: "row" }}>
          {side(row.left, half, "old")}
          {side(row.right, props.width - half, "new")}
        </div>
      );
    }
  }
});

function visualRows(cell: LineCell, width: number, gutter: number, wrap: boolean, ch: number) {
  const extra = cell.line.noNewline ? 1 : 0;
  if (!wrap) return extra ? [[0, cell.line.text.length] as const, null] : [[0, cell.line.text.length] as const];
  const columns = Math.max(1, Math.floor((width - gutter - 2 - 2 * ch) / ch));
  const rows: Array<readonly [number, number] | null> = [...wrapLine(cell.line.text, columns)];
  if (extra) rows.push(null);
  return rows;
}

function LineCellView(props: {
  cell: LineCell;
  side: "old" | "new";
  gutter: number;
  width: number;
  wrap: boolean;
  ch: number;
  scrollX: number;
  tokens: FileTokens | null;
  palette: DiffPalette;
  /** Split rows pass the taller side's row count so both halves match. */
  rows: number | null;
}) {
  const { cell, palette } = props;
  const line = cell.line;
  const kind = line.kind;
  const lineBg = kind === "addition" ? palette.additionLine : kind === "deletion" ? palette.deletionLine : palette.bg;
  const gutterBg = kind === "addition" ? palette.additionGutter : kind === "deletion" ? palette.deletionGutter : palette.bg;
  const numberColor = kind === "addition" ? palette.addition : kind === "deletion" ? palette.deletion : palette.number;
  const emphasisColor = kind === "addition" ? palette.additionEmphasis : kind === "deletion" ? palette.deletionEmphasis : undefined;
  const number = props.side === "old" ? (line.oldLine ?? line.newLine) : (line.newLine ?? line.oldLine);
  const sourceIndex = props.side === "old" ? (line.oldIndex ?? line.newIndex) : (line.newIndex ?? line.oldIndex);
  const sideTokens = props.side === "old" ? props.tokens?.old : props.tokens?.new;
  const tokens = sourceIndex === null ? null : (sideTokens?.[sourceIndex] ?? null);
  const visual = visualRows(cell, props.width, props.gutter, props.wrap, props.ch);
  const rowCount = Math.max(props.rows ?? 0, visual.length);
  const height = rowCount * CODE_LINE_HEIGHT;
  return (
    <div style={{ display: "flex", flexDirection: "row", width: props.width, height, flexShrink: 0, backgroundColor: lineBg }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "row",
          justifyContent: "flex-end",
          width: props.gutter,
          height,
          flexShrink: 0,
          paddingRight: Math.round(props.ch),
          backgroundColor: gutterBg,
          userSelect: "none",
        }}
      >
        {kind === "context" ? null : (
          <ChangeBar kind={kind} height={height} color={kind === "addition" ? palette.addition : palette.deletion} stripeBase={palette.deletionStripeBase} />
        )}
        <text style={{ color: numberColor, fontFamily: FONTS.mono, fontSize: 13, lineHeight: CODE_LINE_HEIGHT, whiteSpace: "nowrap" }}>
          {number === null ? "" : String(number)}
        </text>
      </div>
      <div style={{ width: 2, height, flexShrink: 0, backgroundColor: palette.bg }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minWidth: 0,
          height,
          overflow: "hidden",
          paddingLeft: props.ch,
          paddingRight: props.ch,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, marginLeft: props.wrap ? 0 : -props.scrollX }}>
          {visual.map((range, index) =>
            range === null ? (
              <NoNewlineRow key="eof" palette={palette} />
            ) : (
              <CodeRun
                key={index}
                segments={segmentsFor(line.text, tokens, range[0], range[1], cell.emphasis, palette.fg)}
                {...(emphasisColor ? { emphasisColor } : {})}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function NoNewlineRow({ palette }: { palette: DiffPalette }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", height: CODE_LINE_HEIGHT, alignItems: "center", flexShrink: 0 }}>
      <text style={{ color: palette.number, fontFamily: FONTS.mono, fontSize: 13, lineHeight: CODE_LINE_HEIGHT, whiteSpace: "nowrap", userSelect: "none" }}>
        No newline at end of file
      </text>
    </div>
  );
}

function EmptySide({ width, gutter, height, palette }: { width: number; gutter: number; height: number; palette: DiffPalette }) {
  const fill = width - gutter - 2;
  return (
    <div style={{ display: "flex", flexDirection: "row", width, height, flexShrink: 0, backgroundColor: palette.bg }}>
      <div style={{ width: gutter, height, flexShrink: 0, backgroundColor: palette.bg }} />
      <div style={{ width: 2, height, flexShrink: 0 }} />
      <div style={{ width: fill, height, flexShrink: 0, overflow: "hidden" }}>
        <svg source={hatchSvg(fill, height)} style={{ width: fill, height, color: palette.hatch }} />
      </div>
    </div>
  );
}

function SeparatorRow(props: {
  text: string;
  direction: "up" | "down" | "both";
  first: boolean;
  last: boolean;
  split: boolean;
  width: number;
  palette: DiffPalette;
}) {
  const { palette } = props;
  const icon = props.direction === "up" ? EXPAND_UP : props.direction === "down" ? EXPAND_DOWN : EXPAND_BOTH;
  const half = Math.floor(props.width / 2);
  const labelled = (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: SEPARATOR_HEIGHT,
          flexShrink: 0,
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
          backgroundColor: palette.separator,
        }}
      >
        <svg source={icon} style={{ width: props.direction === "both" ? 10 : 16, height: 16, color: palette.separatorText, pointerEvents: "none" }} />
      </div>
      <div style={{ width: 2, flexShrink: 0 }} />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          flexGrow: 1,
          minWidth: 0,
          height: SEPARATOR_HEIGHT,
          paddingLeft: 7,
          overflow: "hidden",
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
          backgroundColor: palette.separator,
        }}
      >
        <text style={{ color: palette.separatorText, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans, whiteSpace: "nowrap" }}>
          {props.text}
        </text>
      </div>
    </>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: props.width,
        // pierre: line-info separators take margin-block 8, except at the top and
        // bottom of a file's code where they sit flush.
        paddingTop: props.first || props.last ? 0 : BLOCK_GAP,
        paddingBottom: props.first || props.last ? 0 : BLOCK_GAP,
        userSelect: "none",
      }}
    >
      {props.split ? (
        <>
          {/* Split: the label sits on the old side; the new side gets a plain pill. */}
          <div style={{ display: "flex", flexDirection: "row", width: half, flexShrink: 0, paddingLeft: 8, paddingRight: 2 }}>{labelled}</div>
          <div style={{ display: "flex", flexDirection: "row", width: props.width - half, flexShrink: 0, paddingLeft: 2, paddingRight: 10 }}>
            <div style={{ flexGrow: 1, height: SEPARATOR_HEIGHT, borderRadius: 6, backgroundColor: palette.separator }} />
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, paddingLeft: 8, paddingRight: 10 }}>{labelled}</div>
      )}
    </div>
  );
}

function MicroButton({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={label}>
      <div
        {...(testId ? { testId } : {})}
        onClick={(event: EventPayload) => {
          consumeClick(event);
          onClick();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: 6,
          cursor: "pointer",
          hover: { backgroundColor: theme.accent },
        }}
      >
        {children}
      </div>
    </Tooltip>
  );
}

const FileHeader = memo(function FileHeader(props: {
  file: DiffFileModel;
  collapsed: boolean;
  palette: DiffPalette;
  onToggleFile: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const theme = useTheme();
  const { file, palette } = props;
  const tone = fileTone(file, palette);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div
      testId={`diff-file-header-${file.path}`}
      onClick={(event: EventPayload) => {
        if (!wasConsumed(event)) props.onToggleFile(file.path);
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: HEADER_HEIGHT,
        paddingLeft: 8,
        paddingRight: 12,
        backgroundColor: palette.bg,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <div style={{ marginLeft: -2, display: "flex" }}>
        <MicroButton label={props.collapsed ? "Expand diff" : "Collapse diff"} onClick={() => props.onToggleFile(file.path)} testId={`diff-file-fold-${file.path}`}>
          <Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size={16} color={tone} />
        </MicroButton>
      </div>
      <svg source={fileStatusIcon(file)} style={{ width: 16, height: 16, flexShrink: 0, color: tone, pointerEvents: "none" }} />
      <div
        testId={`diff-file-title-${file.path}`}
        onClick={(event: EventPayload) => {
          consumeClick(event);
          props.onOpenFile(file.path);
        }}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}
      >
        {file.previousPath ? (
          <text style={{ color: alpha(palette.fg, 0.6), fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, whiteSpace: "nowrap", textOverflow: "ellipsis-start", overflow: "hidden", minWidth: 0 }}>
            {file.previousPath}
          </text>
        ) : null}
        {file.previousPath ? <Icon name="arrow-right" size={14} color={alpha(palette.fg, 0.6)} /> : null}
        <text style={{ color: palette.fg, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, whiteSpace: "nowrap", textOverflow: "ellipsis-start", overflow: "hidden", minWidth: 0 }}>
          {file.path}
        </text>
      </div>
      <MicroButton
        label={copied ? "Copied" : "Copy path"}
        onClick={() =>
          void copyTextToClipboard(file.path).then(
            () => setCopied(true),
            () => toast({ type: "error", title: "Failed to copy path" }),
          )
        }
      >
        <Icon name={copied ? "check" : "copy"} size={12} color={copied ? theme.successForeground : theme.mutedForeground} />
      </MicroButton>
      <div style={{ flexGrow: 1 }} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 0 }}>
        {file.deletions > 0 ? (
          <text style={{ color: palette.deletion, fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono }}>{`-${file.deletions}`}</text>
        ) : null}
        {file.additions > 0 ? (
          <text style={{ color: palette.addition, fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono }}>{`+${file.additions}`}</text>
        ) : null}
      </div>
    </div>
  );
});
