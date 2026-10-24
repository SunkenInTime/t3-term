// The Diff surface's patch view: a port of what @pierre/diffs paints for the
// web DiffPanel (stacked or split layout, soft wrap or horizontal scroll,
// per-file headers with fold/status/copy, "N unmodified lines" separators,
// word emphasis, change bars, Shiki pierre-dark colors).
//
// One windowed <virtual-list> holds every row, so a 20k-line patch mounts only
// the rows near the viewport. Highlighting runs in a worker per file side and
// arrives later without moving anything.
import type { EventPayload } from "@gpuix/native";
import { useGpuixRequired } from "@gpuix/react";
import { createContext, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { ContextMenuItem } from "@t3tools/contracts";

import { ActionMenu } from "../../chat/header/ActionMenu.tsx";
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
  type SegmentMark,
} from "../code/codeRows.tsx";
import { DiffFindBar, type DiffFindOption } from "./DiffFindBar.tsx";
import { collectDiffMatches, findSameMatch, type DiffSearchMatch, type DiffSearchParams } from "./diffSearch.ts";
import { requestSyntaxTokens, peekSyntaxTokens, type SyntaxLines } from "../code/highlighter.ts";
import { EXPAND_BOTH, EXPAND_DOWN, EXPAND_UP, FILE_ADDED, FILE_DELETED, FILE_MODIFIED, FILE_MOVED } from "./pierreIcons.ts";
import { useListWindow } from "../code/listWindow.ts";
import {
  buildDiffRows,
  type DiffFileModel,
  type DiffLayout,
  type DiffLine,
  type DiffLineAnnotation,
  type DiffRow,
  type LineCell,
  EXPANSION_LINE_COUNT,
} from "./diffModel.ts";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation.tsx";
import { linePoint, useDiffComments, type DiffComments, type DiffCommentsConfig } from "./useDiffComments.ts";
import type { SelectedLineRange } from "../../web/reviewCommentContext.ts";

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
/** The find panel's close badge reaches this far past its top-right corner. */
const FIND_CLOSE_OVERHANG = 10;
const NO_MARKS: ReadonlyArray<SegmentMark> = [];
const isMac = process.platform === "darwin";
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
  /** Line comments sent to this thread's composer; null turns them off. */
  readonly comments?: DiffCommentsConfig | null;
  /** Scrolls a file's header to the top once per request (the file tree's reveal). */
  readonly reveal?: { readonly path: string; readonly requestId: number } | null;
  /**
   * The pull request Code tab's own annotations (review threads, pending comments, its draft),
   * keyed by file path and drawn by `renderAnnotation` under their lines.
   */
  readonly annotations?: ReadonlyMap<string, ReadonlyArray<DiffExternalAnnotation>>;
  readonly renderAnnotation?: (file: DiffFileModel, annotation: DiffExternalAnnotation) => ReactNode;
  /**
   * With `comments` off: line numbers select ranges (press, drag, Shift+press) and the finished
   * range goes to the caller, who paints it back through `selected` (the pull request Code tab).
   */
  readonly lineSelection?: DiffLineSelection | null;
  /** Extra controls at the end of a file header (the viewed checkbox). */
  readonly renderHeaderExtras?: (file: DiffFileModel) => ReactNode;
  /** Paint every row in a plain column that grows with its content, for a short excerpt inside an outer scroller. */
  readonly inline?: boolean;
  /** Inline only: no file header rows, for a diff drawn under a row that already names the file. */
  readonly hideFileHeaders?: boolean;
  /** The last rows came on screen: time to ask for the next page of a paged diff. */
  readonly onReachEnd?: () => void;
  /** Right-click on a file header's name (web DiffPanel onContextMenuCapture → fileContextMenu). */
  readonly fileMenu?: DiffFileMenu | null;
  /**
   * A press on an "N unmodified lines" separator (pierre's hunk expansion). Absent: the
   * separators are labels only (a turn diff has no full file contents to show).
   */
  readonly onExpandGap?: ((file: DiffFileModel, expandIndex: number, direction: GapDirection) => void) | null;
}

export interface DiffLineSelection {
  readonly enabled: boolean;
  readonly selected: { readonly path: string; readonly range: SelectedLineRange } | null;
  readonly onSelectionEnd: (file: DiffFileModel, range: SelectedLineRange) => void;
}

/** pierre's expand directions: "up" grows from the gap's start, "down" from its end. */
export type GapDirection = "up" | "down" | "both";

/** The filename context menu: its items for a path (empty: no menu), and what a pick does. */
export interface DiffFileMenu {
  readonly items: (path: string) => ReadonlyArray<ContextMenuItem<string>>;
  readonly onAction: (path: string, action: string) => void;
}

/** One annotation a caller draws itself (see `renderAnnotation`). */
export interface DiffExternalAnnotation {
  readonly key: string;
  readonly side: "additions" | "deletions";
  readonly lineNumber: number;
}

/** What a row does on gutter input; one stable object read through a ref. */
interface RowInteraction {
  readonly current: {
    readonly comments: DiffComments;
    /**
     * The gutter and its "+" both claim the hover. Hover goes to the topmost element, so
     * moving onto the button leaves the gutter; a leave only clears its own claim.
     */
    readonly hover: (key: string, side: "old" | "new", via: "gutter" | "button") => void;
    readonly unhover: (key: string, via: "gutter" | "button") => void;
    readonly renderAnnotation: ((filePath: string, annotation: DiffExternalAnnotation) => ReactNode) | null;
    readonly renderHeaderExtras: ((file: DiffFileModel) => ReactNode) | null;
    readonly fileMenu: DiffFileMenu | null;
    readonly expandGap: ((file: DiffFileModel, expandIndex: number, direction: GapDirection) => void) | null;
  };
}

// The gutter "+" sits inside the number column, which also takes presses for line
// selection. gpuix hands a press to every handler under the pointer, so the button
// marks it and the column skips a press the button already took.
let consumedPress: { x: number; y: number; at: number } | null = null;
function consumePress(event: EventPayload) {
  consumedPress = { x: Number(event.x ?? 0), y: Number(event.y ?? 0), at: Date.now() };
}
function pressConsumed(event: EventPayload): boolean {
  const consumed = consumedPress;
  return consumed !== null && consumed.x === Number(event.x ?? 0) && consumed.y === Number(event.y ?? 0) && Date.now() - consumed.at < 500;
}

/**
 * Runs a focus change inside the diff's list and then puts the scroll back. gpuix scrolls a
 * virtual-list row to the top when something inside it takes focus, which would hide the lines a
 * comment draft was opened for (they sit just above its row).
 */
export const DiffFocusKeeperContext = createContext<((focus: () => void) => void) | null>(null);

export function DiffView(props: DiffViewProps) {
  const theme = useTheme();
  const palette = diffPalette(theme);
  const { width: ch, probe } = useMonoCharWidth();
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const { listRef, start, onVisibleRange, reset, topIndex } = useListWindow(WINDOW);
  const [visible, setVisible] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [scrollX, setScrollX] = useState(0);
  const [tokens, setTokens] = useState<ReadonlyMap<DiffFileModel, FileTokens>>(new Map());
  const requested = useRef(new WeakSet<DiffFileModel>());

  const renderer = useGpuixRequired();
  const rootRef = useRef<{ id: number } | null>(null);

  // Find in diff (CodeViewSearch): Ctrl/Cmd+F in the diff opens the panel.
  const findEnabled = !props.inline;
  const [findOpen, setFindOpen] = useState(false);
  const [findParams, setFindParams] = useState<DiffSearchParams>({ text: "", caseSensitive: false, wholeWord: false, regex: false });
  const [findCurrent, setFindCurrent] = useState<number | null>(null);
  const [findReveal, setFindReveal] = useState<{ index: number; id: number } | null>(null);
  const [findFocusId, setFindFocusId] = useState(0);
  const findMatches = useMemo(
    () => (findOpen ? collectDiffMatches(props.files, findParams) : []),
    [findOpen, props.files, findParams],
  );
  const lineSelection = props.lineSelection ?? null;
  const comments = useDiffComments(
    props.files,
    props.comments ?? null,
    lineSelection === null
      ? null
      : {
          enabled: lineSelection.enabled,
          selected: lineSelection.selected,
          onSelectionEnd: (path, range) => {
            const file = props.files.find((candidate) => candidate.path === path);
            if (file) lineSelection.onSelectionEnd(file, range);
          },
        },
  );
  const [hovered, setHovered] = useState<{ key: string; side: "old" | "new"; via: "gutter" | "button" } | null>(null);
  const hover = (key: string, side: "old" | "new", via: "gutter" | "button") =>
    setHovered((current) =>
      current?.key === key && current.side === side && current.via === via ? current : { key, side, via },
    );
  const unhover = (key: string, via: "gutter" | "button") =>
    setHovered((current) => (current?.key === key && current.via === via ? null : current));
  const renderAnnotation = props.renderAnnotation
    ? (filePath: string, annotation: DiffExternalAnnotation) => {
        const file = props.files.find((candidate) => candidate.path === filePath);
        return file ? props.renderAnnotation?.(file, annotation) : null;
      }
    : null;
  const renderHeaderExtras = props.renderHeaderExtras ?? null;
  const fileMenu = props.fileMenu ?? null;
  const expandGap = props.onExpandGap ?? null;
  const interactionRef = useRef<RowInteraction["current"]>({
    comments,
    hover,
    unhover,
    renderAnnotation,
    renderHeaderExtras,
    fileMenu,
    expandGap,
  });
  interactionRef.current = { comments, hover, unhover, renderAnnotation, renderHeaderExtras, fileMenu, expandGap };
  const interaction = useMemo<RowInteraction>(
    () => ({
      get current() {
        return interactionRef.current;
      },
    }),
    [],
  );
  // The caller's annotations ride the same rows as composer comments, as entries of their own kind.
  const annotations = useMemo(() => {
    if (!props.annotations || props.annotations.size === 0) return comments.annotations;
    const merged = new Map<string, DiffLineAnnotation[]>();
    for (const [path, list] of comments.annotations ?? new Map<string, ReadonlyArray<DiffLineAnnotation>>()) merged.set(path, [...list]);
    for (const [path, list] of props.annotations) {
      const target = merged.get(path) ?? [];
      for (const annotation of list) {
        target.push({
          side: annotation.side,
          lineNumber: annotation.lineNumber,
          entries: [{ id: annotation.key, kind: "external", rangeLabel: "", text: "" }],
        });
      }
      merged.set(path, target);
    }
    return merged;
  }, [comments.annotations, props.annotations]);
  const rows = useMemo(
    () => buildDiffRows(props.files, props.layout, props.collapsed, annotations),
    [props.files, props.layout, props.collapsed, annotations],
  );

  // A programmatic scroll reports no visible range, so the sticky header would keep the old
  // top row; read the list's anchor once the scroll has landed.
  const refreshVisibleSoon = () => {
    setTimeout(() => {
      const first = topIndex(-1);
      if (first < 0) return;
      setVisible((current) => (current.start === first ? current : { start: first, end: first + (current.end - current.start) }));
    }, 50);
  };

  const rowIndexByLine = useMemo(() => {
    const byLine = new Map<DiffLine, number>();
    rows.forEach((row, index) => {
      if (row.type === "line") byLine.set(row.cell.line, index);
      else if (row.type === "split") {
        if (row.left && !byLine.has(row.left.line)) byLine.set(row.left.line, index);
        if (row.right && !byLine.has(row.right.line)) byLine.set(row.right.line, index);
      }
    });
    return byLine;
  }, [rows]);

  // ::highlight(diffs-search-match) #ff963266 / (diffs-search-focus) the modified blue at 45%.
  const matchColor = theme.appearance === "dark" ? "#ff963266" : "#ff963288";
  const focusColor = alpha(palette.modified, 0.45);
  const marksByLine = useMemo(() => {
    const byLine = new Map<DiffLine, SegmentMark[]>();
    findMatches.forEach((match, index) => {
      const list = byLine.get(match.line) ?? [];
      list.push({ start: match.start, end: match.end, color: index === findCurrent ? focusColor : matchColor });
      byLine.set(match.line, list);
    });
    return byLine;
  }, [findMatches, findCurrent, focusColor, matchColor]);
  const marksFor = (line: DiffLine | null | undefined) => (line ? (marksByLine.get(line) ?? NO_MARKS) : NO_MARKS);

  // A query or option change keeps the current match when it survives, else starts at the
  // first match at or below the top of the viewport (getFirstVisibleSearchMatchIndex).
  const previousMatch = useRef<DiffSearchMatch | null>(null);
  useEffect(() => {
    if (!findOpen) return;
    if (findMatches.length === 0) {
      setFindCurrent(null);
      return;
    }
    const kept = previousMatch.current ? findSameMatch(findMatches, previousMatch.current) : -1;
    if (kept >= 0) {
      setFindCurrent(kept);
      return;
    }
    let first = findMatches.findIndex((match) => (rowIndexByLine.get(match.line) ?? -1) >= visible.start);
    if (first < 0) first = 0;
    setFindCurrent(first);
    setFindReveal((current) => ({ index: first, id: (current?.id ?? 0) + 1 }));
  }, [findMatches]);
  useEffect(() => {
    previousMatch.current = findCurrent === null ? null : (findMatches[findCurrent] ?? null);
  }, [findCurrent, findMatches]);

  const navigateFind = (previous: boolean) => {
    if (findMatches.length === 0) return;
    const base = findCurrent ?? (previous ? 0 : -1);
    const next = (base + (previous ? -1 : 1) + findMatches.length) % findMatches.length;
    setFindCurrent(next);
    setFindReveal((current) => ({ index: next, id: (current?.id ?? 0) + 1 }));
  };
  const closeFind = () => {
    setFindOpen(false);
    setFindCurrent(null);
    setFindReveal(null);
    if (rootRef.current) renderer.focusElement?.(rootRef.current.id);
  };
  const openFind = () => {
    if (!findEnabled) return;
    setFindOpen(true);
    // Reopening refocuses the input (pierre's open() on a live panel).
    setFindFocusId((id) => id + 1);
  };

  // revealSearchMatch: unfold the match's file, then bring its line on screen (centred below
  // the sticky header and the panel) unless it is already fully visible; with wrapping off,
  // pan the code so the match is in view.
  const handledFindReveal = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!findReveal || handledFindReveal.current === findReveal.id || listRef.current === null) return;
    const match = findMatches[findReveal.index];
    if (!match) return;
    if (props.collapsed.has(match.file.path)) {
      props.onToggleFile(match.file.path);
      return;
    }
    const index = rowIndexByLine.get(match.line);
    if (index === undefined) return;
    handledFindReveal.current = findReveal.id;
    const inView = index >= visible.start + 3 && index <= visible.end - 2;
    if (!inView) {
      reset(Math.max(0, index - Math.floor(WINDOW / 4)));
      renderer.scrollToItem?.(listRef.current.id, index, -Math.max(0, Math.round(height / 2 - CODE_LINE_HEIGHT / 2)));
      refreshVisibleSoon();
    }
    if (!props.wrap && ch > 0) {
      const codeWidth = contentWidth - gutterWidth(match.file.numberDigits, ch) - 2 - 2 * ch;
      const left = match.start * ch;
      const right = match.end * ch;
      const padding = 24;
      setScrollX((current) => {
        if (left < current + padding) return Math.max(0, left - padding);
        if (right > current + codeWidth - padding) return Math.min(maxScrollX, right - codeWidth + padding);
        return current;
      });
    }
  }, [findReveal, rows, findMatches]);

  // The file tree's reveal: put the file's header at the top of the list.
  const handledReveal = useRef<number | null>(null);
  useLayoutEffect(() => {
    const reveal = props.reveal;
    if (!reveal || handledReveal.current === reveal.requestId || listRef.current === null) return;
    const index = rows.findIndex((row) => row.type === "header" && row.file.path === reveal.path);
    if (index < 0) return;
    handledReveal.current = reveal.requestId;
    reset(Math.max(0, index - Math.floor(WINDOW / 4)));
    renderer.scrollToItem?.(listRef.current.id, index, 0);
    refreshVisibleSoon();
  }, [props.reveal?.requestId, props.reveal?.path, rows, renderer]);

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
    for (let index = props.inline ? 0 : from; index < (props.inline ? rows.length : to); index += 1) {
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

  const keepScrollAcrossFocus = (focus: () => void) => {
    const id = listRef.current?.id;
    const top = id == null ? null : renderer.getListScrollTop?.(id);
    focus();
    if (id == null || !top) return;
    // The list applies the focus scroll on its next layout; restore after it, twice in case a
    // slow frame lands between.
    const restore = () => renderer.scrollToItem?.(id, top[0]!, top[1]!);
    setTimeout(restore, 16);
    setTimeout(restore, 120);
  };

  return (
    <DiffFocusKeeperContext.Provider value={props.inline ? null : keepScrollAcrossFocus}>
    <div
      ref={rootRef as never}
      testId="diff-view"
      {...(findEnabled ? { tabIndex: 0 } : {})}
      onKeyDown={(event) => {
        if (!findEnabled) return;
        const key = (event.key ?? "").toLowerCase();
        const mods = event.modifiers ?? { shift: false, ctrl: false, alt: false, cmd: false };
        const primary = isMac ? mods.cmd : mods.ctrl;
        // Before the window's chat.find: in the diff, Ctrl/Cmd+F searches the diff.
        if (primary && !mods.alt && !mods.shift && key === "f") {
          event.preventDefault();
          event.stopPropagation();
          openFind();
          return;
        }
        if (!findOpen) return;
        const findAgain = key === "f3" || (isMac && mods.cmd && key === "g");
        if (findAgain) {
          event.preventDefault();
          event.stopPropagation();
          navigateFind(mods.shift);
        } else if (key === "escape") {
          event.preventDefault();
          event.stopPropagation();
          closeFind();
        }
      }}
      onLayout={(event) => {
        const next = Math.floor(Number(event.width ?? 0));
        if (next > 0 && next !== width) setWidth(next);
        const nextHeight = Math.floor(Number(event.height ?? 0));
        if (nextHeight !== height) setHeight(nextHeight);
      }}
      onMouseUp={() => comments.pointerUp()}
      onScroll={(event: EventPayload) => {
        if (props.wrap) return;
        const deltaX = Number(event.deltaX ?? 0);
        if (deltaX === 0) return;
        setScrollX((current) => Math.max(0, Math.min(maxScrollX, current - deltaX)));
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        ...(props.inline ? { flexShrink: 0 } : { flexGrow: 1, minHeight: 0 }),
        minWidth: 0,
        position: "relative",
        backgroundColor: palette.bg,
      }}
    >
      {findOpen ? (
        // [data-search-panel]: a zero-height host across the top of the diff viewport. Its
        // widget sits under the sticky file header (getStickyHeaderOffset 32 + top 8px) with
        // its right edge 16px inside the 16px scrollbar gutter. A deferred <anchored> layer
        // paints it over the virtual list and the sticky header.
        <div style={{ width: "100%", height: 0, flexShrink: 0 }}>
          <anchored
            side="bottom"
            align="end"
            // The layer pads FIND_CLOSE_OVERHANG on top and right for the corner badge.
            gap={HEADER_HEIGHT + 8 - FIND_CLOSE_OVERHANG}
            offset={{ x: -(32 - FIND_CLOSE_OVERHANG), y: 0 }}
            deferred
            priority={1}
            occlude
            // A raw <anchored> paints #1A1A1A behind its content; the panel paints itself.
            style={{ backgroundColor: "transparent", pointerEvents: "auto" }}
          >
            <div style={{ display: "flex", paddingTop: FIND_CLOSE_OVERHANG, paddingRight: FIND_CLOSE_OVERHANG }}>
              <DiffFindBar
                key={findFocusId}
                params={findParams}
                matchCount={findMatches.length}
                current={findCurrent}
                onQueryChange={(text) => setFindParams((current) => ({ ...current, text }))}
                onToggle={(option: DiffFindOption) => setFindParams((current) => ({ ...current, [option]: !current[option] }))}
                onNavigate={navigateFind}
                onClose={closeFind}
              />
            </div>
          </anchored>
        </div>
      ) : null}
      {probe}
      {width > 0 && props.inline ? (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          {(props.hideFileHeaders ? rows.filter((row) => row.type !== "header") : rows).map((row) => (
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
              hoveredSide={comments.enabled && hovered?.key === row.key ? hovered.side : null}
              selected={comments.selectedLines}
              interaction={interaction}
              draftText={row.type === "annotation" && row.annotation.entries.some((entry) => entry.kind === "draft") ? comments.draftText : ""}
              marks={row.type === "line" ? marksFor(row.cell.line) : NO_MARKS}
              leftMarks={row.type === "split" ? marksFor(row.left?.line) : NO_MARKS}
              rightMarks={row.type === "split" ? marksFor(row.right?.line) : NO_MARKS}
            />
          ))}
        </div>
      ) : width > 0 ? (
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
            if (props.onReachEnd && last >= rows.length - 4) props.onReachEnd();
          }}
          style={{ width: "100%", flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar }}
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
              hoveredSide={comments.enabled && hovered?.key === row.key ? hovered.side : null}
              selected={comments.selectedLines}
              interaction={interaction}
              draftText={row.type === "annotation" && row.annotation.entries.some((entry) => entry.kind === "draft") ? comments.draftText : ""}
              marks={row.type === "line" ? marksFor(row.cell.line) : NO_MARKS}
              leftMarks={row.type === "split" ? marksFor(row.left?.line) : NO_MARKS}
              rightMarks={row.type === "split" ? marksFor(row.right?.line) : NO_MARKS}
            />
          ))}
        </virtual-list>
      ) : null}
      {stickyFile && !props.inline ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: HEADER_HEIGHT, backgroundColor: palette.bg }}>
          <FileHeader
            file={stickyFile}
            collapsed={false}
            palette={palette}
            interaction={interaction}
            onToggleFile={props.onToggleFile}
            onOpenFile={props.onOpenFile}
            {...(props.renderHeaderExtras ? { extras: props.renderHeaderExtras(stickyFile) } : {})}
          />
        </div>
      ) : null}
    </div>
    </DiffFocusKeeperContext.Provider>
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
  hoveredSide: "old" | "new" | null;
  selected: ReadonlySet<DiffLine>;
  interaction: RowInteraction;
  draftText: string;
  /** Find matches on this row's line (stacked) or on each side (split). */
  marks: ReadonlyArray<SegmentMark>;
  leftMarks: ReadonlyArray<SegmentMark>;
  rightMarks: ReadonlyArray<SegmentMark>;
}) {
  const { row, palette } = props;
  const gutterProps = (side: "old" | "new", cellSide: "old" | "new" | "any", line: DiffLine) => ({
    rowKey: row.key,
    filePath: row.file.path,
    cellSide,
    utility: props.hoveredSide === side,
    selected: props.selected.has(line),
    interaction: props.interaction,
  });
  switch (row.type) {
    case "annotation":
      if (row.annotation.entries.every((entry) => entry.kind === "external")) {
        const render = props.interaction.current.renderAnnotation;
        return (
          <div style={{ display: "flex", flexDirection: "column", width: props.width }}>
            {render
              ? row.annotation.entries.map((entry) => (
                  <div key={entry.id} style={{ display: "flex", flexDirection: "column" }}>
                    {render(row.file.path, { key: entry.id, side: row.annotation.side, lineNumber: row.annotation.lineNumber })}
                  </div>
                ))
              : null}
          </div>
        );
      }
      return (
        <AnnotationRowView
          row={row}
          width={props.width}
          gutter={gutterWidth(row.file.numberDigits, props.ch)}
          palette={palette}
          interaction={props.interaction}
          draftText={props.draftText}
          selected={props.selected.size > 0}
        />
      );
    case "header": {
      const extras = props.interaction.current.renderHeaderExtras;
      return (
        <FileHeader
          file={row.file}
          collapsed={row.collapsed}
          palette={palette}
          interaction={props.interaction}
          onToggleFile={props.onToggleFile}
          onOpenFile={props.onOpenFile}
          {...(extras ? { extras: extras(row.file) } : {})}
        />
      );
    }
    case "separator": {
      const expandGap = props.interaction.current.expandGap;
      return (
        <SeparatorRow
          text={row.text}
          direction={row.direction}
          first={row.first}
          last={row.last}
          split={row.split}
          hidden={row.hidden}
          palette={palette}
          width={props.width}
          testId={`diff-gap-${row.file.path}-${row.expandIndex}`}
          onExpand={expandGap ? (direction) => expandGap(row.file, row.expandIndex, direction) : null}
        />
      );
    }
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
            marks={props.marks}
            interaction={gutterProps(row.cell.line.kind === "deletion" ? "old" : "new", "any", row.cell.line)}
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
            marks={which === "old" ? props.leftMarks : props.rightMarks}
            interaction={gutterProps(which, which, cell.line)}
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
  marks: ReadonlyArray<SegmentMark>;
  interaction: GutterInteraction;
}) {
  const { cell, palette } = props;
  const line = cell.line;
  const kind = line.kind;
  const selected = props.interaction.selected;
  // StyledDiffCodeView: a selected line, change or not, is the code background with a
  // 6% wash of the modified blue, and its number column gets the blue 4px bar.
  const lineBg = selected ? palette.selectedLine : kind === "addition" ? palette.additionLine : kind === "deletion" ? palette.deletionLine : palette.bg;
  const gutterBg = selected ? palette.selectedGutter : kind === "addition" ? palette.additionGutter : kind === "deletion" ? palette.deletionGutter : palette.bg;
  const point = linePoint(line, props.interaction.cellSide);
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
    <div
      // The diff root never hears a release inside the list's rows, so each line ends a gutter drag itself.
      onMouseUp={() => props.interaction.interaction.current.comments.pointerUp()}
      style={{ position: "relative", display: "flex", flexDirection: "row", width: props.width, height, flexShrink: 0, backgroundColor: lineBg }}
    >
      <GutterCell
        interaction={props.interaction}
        line={line}
        width={props.gutter}
        height={height}
        ch={props.ch}
        background={gutterBg}
        palette={palette}
      >
        {selected ? (
          <div style={{ position: "absolute", left: 0, top: 0, width: 4, height, backgroundColor: palette.modified, pointerEvents: "none" }} />
        ) : kind === "context" ? null : (
          <ChangeBar kind={kind} height={height} color={kind === "addition" ? palette.addition : palette.deletion} stripeBase={palette.deletionStripeBase} />
        )}
        <text style={{ color: selected ? palette.selectedNumber : numberColor, fontFamily: FONTS.mono, fontSize: 13, lineHeight: CODE_LINE_HEIGHT, whiteSpace: "nowrap", pointerEvents: "none" }}>
          {number === null ? "" : String(number)}
        </text>
      </GutterCell>
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
                segments={segmentsFor(line.text, tokens, range[0], range[1], cell.emphasis, palette.fg, props.marks)}
                {...(emphasisColor ? { emphasisColor } : {})}
              />
            ),
          )}
        </div>
      </div>
      {/* Last in the row so it paints over the spacer and code it overhangs. */}
      {props.interaction.utility && point ? (
        <GutterUtilityButton
          left={props.gutter - Math.round(props.ch)}
          palette={palette}
          onHover={(hovered) => {
            const current = props.interaction.interaction.current;
            if (hovered) current.hover(props.interaction.rowKey, props.side, "button");
            else current.unhover(props.interaction.rowKey, "button");
          }}
          onPress={() => {
            props.interaction.interaction.current.comments.utility(props.interaction.filePath, point);
          }}
        />
      ) : null}
    </div>
  );
}

interface GutterInteraction {
  readonly rowKey: string;
  readonly filePath: string;
  readonly cellSide: "old" | "new" | "any";
  /** Show pierre's gutter utility ("+") on this cell. */
  readonly utility: boolean;
  readonly selected: boolean;
  readonly interaction: RowInteraction;
}

/**
 * pierre's [data-utility-button]: a 1lh square in the modified blue whose right margin
 * is `-1lh + 1ch`, so it starts one character inside the number column and overhangs
 * into the code.
 */
function GutterUtilityButton({
  left,
  palette,
  onPress,
  onHover,
}: {
  left: number;
  palette: DiffPalette;
  onPress: (event: EventPayload) => void;
  onHover: (hovered: boolean) => void;
}) {
  return (
    <div
      testId="diff-gutter-utility"
      onMouseDown={(event: EventPayload) => {
        consumePress(event);
        onPress(event);
      }}
      // Hover belongs to the topmost element: keep the button while the pointer is on it.
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        position: "absolute",
        top: 0,
        left,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: CODE_LINE_HEIGHT,
        height: CODE_LINE_HEIGHT,
        borderRadius: 4,
        backgroundColor: palette.modified,
        cursor: "pointer",
      }}
    >
      <Icon name="plus" size={14} color={palette.bg} strokeWidth={2.5} />
    </div>
  );
}

function GutterCell(props: {
  interaction: GutterInteraction;
  line: DiffLine;
  width: number;
  height: number;
  ch: number;
  background: string;
  palette: DiffPalette;
  children: ReactNode;
}) {
  const { interaction, line } = props;
  const point = linePoint(line, interaction.cellSide);
  const hoverSide: "old" | "new" = interaction.cellSide === "any" ? (line.kind === "deletion" ? "old" : "new") : interaction.cellSide;
  return (
    <div
      onMouseEnter={() => {
        const current = interaction.interaction.current;
        current.hover(interaction.rowKey, hoverSide, "gutter");
        if (point) current.comments.numberEnter(interaction.filePath, point);
      }}
      onMouseLeave={() => interaction.interaction.current.unhover(interaction.rowKey, "gutter")}
      // A row's filled cells hide it from its ancestors' release listeners (gpuix occludes any
      // hitbox under a filled box), so the number column hears its own release.
      onMouseUp={() => interaction.interaction.current.comments.pointerUp()}
      onMouseDown={(event: EventPayload) => {
        if (pressConsumed(event) || !point || (event.button ?? 0) !== 0) return;
        interaction.interaction.current.comments.numberDown(interaction.filePath, point, event.modifiers?.shift === true);
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
        width: props.width,
        height: props.height,
        flexShrink: 0,
        paddingRight: Math.round(props.ch),
        backgroundColor: props.background,
        userSelect: "none",
        cursor: "pointer",
      }}
    >
      {props.children}
    </div>
  );
}

/** AnnotatableCodeView's renderAnnotation: comment entries under a line. */
function AnnotationRowView(props: {
  row: Extract<DiffRow, { type: "annotation" }>;
  width: number;
  gutter: number;
  palette: DiffPalette;
  interaction: RowInteraction;
  draftText: string;
  selected: boolean;
}) {
  const theme = useTheme();
  const { row, palette } = props;
  const hasDraft = row.annotation.entries.some((entry) => entry.kind === "draft");
  // pierre keeps the commented range selected while its form is open, annotation included.
  const selected = hasDraft && props.selected;
  const half = Math.floor(props.width / 2);
  const columnWidth = row.half === "full" ? props.width : row.half === "left" ? half : props.width - half;
  const content = (
    <div style={{ display: "flex", flexDirection: "row", width: columnWidth, flexShrink: 0, backgroundColor: selected ? palette.selectedLine : palette.bg }}>
      <div style={{ position: "relative", width: props.gutter, flexShrink: 0, backgroundColor: selected ? palette.selectedGutter : palette.bg }}>
        {selected ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: palette.modified }} /> : null}
      </div>
      <div style={{ width: 2, flexShrink: 0, backgroundColor: palette.bg }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minWidth: 0,
          ...(hasDraft
            ? { paddingTop: 4, paddingBottom: 4 }
            : { borderTopWidth: 1, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.3) }),
        }}
      >
        {row.annotation.entries.map((entry, index) => (
          <div
            key={entry.id}
            style={{
              display: "flex",
              width: "100%",
              ...(index > 0 && !hasDraft ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.3) } : {}),
            }}
          >
            <DiffCommentAnnotation
              testId={`diff-comment-${entry.kind}`}
              kind={entry.kind === "draft" ? "draft" : "comment"}
              rangeLabel={entry.rangeLabel}
              text={entry.kind === "draft" ? props.draftText : entry.text}
              onTextChange={(text) => props.interaction.current.comments.setDraftText(text)}
              onCancel={() => props.interaction.current.comments.remove(entry.id)}
              onComment={(text) => props.interaction.current.comments.submit(entry.id, text)}
              onDelete={() => props.interaction.current.comments.remove(entry.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
  if (row.half === "full") return content;
  const blank = <div style={{ width: row.half === "left" ? props.width - half : half, flexShrink: 0, backgroundColor: palette.bg }} />;
  return (
    <div style={{ display: "flex", flexDirection: "row", width: props.width }}>
      {row.half === "left" ? content : blank}
      {row.half === "left" ? blank : content}
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
  /** Hidden lines, or null when unknown. */
  hidden: number | null;
  width: number;
  palette: DiffPalette;
  testId: string;
  onExpand: ((direction: GapDirection) => void) | null;
}) {
  const { palette } = props;
  const half = Math.floor(props.width / 2);
  const expandable = props.onExpand !== null;
  // createSeparator: a gap between hunks wider than one expansion gets an up and a down
  // button stacked in the icon cell; the first gap only grows down, the last only up.
  const chunked = expandable && !props.first && !props.last && props.hidden !== null && props.hidden > EXPANSION_LINE_COUNT;
  // data-expand-down paints the expand icon flipped (an up chevron), data-expand-up unflipped.
  const single: { direction: GapDirection; icon: string } = props.first
    ? { direction: "down", icon: EXPAND_UP }
    : props.last
      ? { direction: "up", icon: EXPAND_DOWN }
      : { direction: "both", icon: EXPAND_BOTH };
  const hoverBg = alpha(palette.separatorText, 0.12);
  const button = (direction: GapDirection, icon: string, height: number, corners: { top: boolean; bottom: boolean }, key: string) => (
    <div
      key={key}
      testId={`${props.testId}-${direction}`}
      onClick={expandable ? () => props.onExpand?.(direction) : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height,
        flexShrink: 0,
        overflow: "hidden",
        ...(corners.top ? { borderTopLeftRadius: 6 } : {}),
        ...(corners.bottom ? { borderBottomLeftRadius: 6 } : {}),
        backgroundColor: palette.separator,
        ...(expandable ? { cursor: "pointer", hover: { backgroundColor: hoverBg } } : {}),
      }}
    >
      <svg
        source={icon}
        style={{ width: icon === EXPAND_BOTH ? 10 : 16, height: 16, flexShrink: 0, color: palette.separatorText, pointerEvents: "none" }}
      />
    </div>
  );
  const labelled = (
    <>
      {chunked ? (
        <div style={{ display: "flex", flexDirection: "column", width: 32, height: SEPARATOR_HEIGHT, flexShrink: 0, gap: 1 }}>
          {button("up", EXPAND_DOWN, (SEPARATOR_HEIGHT - 1) / 2, { top: true, bottom: false }, "up")}
          {button("down", EXPAND_UP, (SEPARATOR_HEIGHT - 1) / 2, { top: false, bottom: true }, "down")}
        </div>
      ) : (
        button(single.direction, single.icon, SEPARATOR_HEIGHT, { top: true, bottom: true }, "single")
      )}
      <div style={{ width: 2, flexShrink: 0 }} />
      <div
        testId={`${props.testId}-label`}
        // InteractionManager: a press on the "N unmodified lines" text expands both ways.
        onClick={expandable ? () => props.onExpand?.("both") : undefined}
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
          ...(expandable ? { cursor: "pointer" } : {}),
        }}
      >
        <text style={{ color: palette.separatorText, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans, whiteSpace: "nowrap", pointerEvents: "none" }}>
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
        // StyledDiffCodeView sets the separators' margin-block to 0 (the virtualizer
        // places rows from hunkSeparatorHeight), so they sit flush between hunks.
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
  interaction: RowInteraction;
  onToggleFile: (path: string) => void;
  onOpenFile: (path: string) => void;
  extras?: ReactNode;
}) {
  const theme = useTheme();
  const { file, palette } = props;
  const tone = fileTone(file, palette);
  const [copied, setCopied] = useState(false);
  // Web opens the menu at the pointer; it hangs under the name at the pointer's x.
  const [menu, setMenu] = useState<{ x: number; items: ReadonlyArray<ContextMenuItem<string>> } | null>(null);
  const titleX = useRef(0);
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
      <ActionMenu<string>
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) setMenu(null);
        }}
        items={menu?.items ?? []}
        onSelect={(action) => {
          setMenu(null);
          props.interaction.current.fileMenu?.onAction(file.path, action);
        }}
        alignOffset={menu?.x ?? 0}
        // Below the 32px header row: a press on a menu row inside the header's bounds
        // would also reach the header's fold toggle (gpuix hands it to both).
        sideOffset={10}
        minWidth={180}
        testId={`diff-file-menu-${file.path}`}
        rootStyle={{ minWidth: 0, flexShrink: 1 }}
        trigger={
          <div
            testId={`diff-file-title-${file.path}`}
            onLayout={(event: EventPayload) => {
              titleX.current = Number(event.x ?? 0);
            }}
            onClick={(event: EventPayload) => {
              consumeClick(event);
              props.onOpenFile(file.path);
            }}
            onAuxClick={(event: EventPayload) => {
              if (!event.isRightClick) return;
              const items = props.interaction.current.fileMenu?.items(file.path) ?? [];
              if (items.length > 0) setMenu({ x: Math.max(0, Number(event.x ?? 0) - titleX.current), items });
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
        }
      />
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
      {props.extras ? (
        <div
          onClick={(event: EventPayload) => consumeClick(event)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}
        >
          {props.extras}
        </div>
      ) : null}
    </div>
  );
});
