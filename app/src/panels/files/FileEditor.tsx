// The Files surface's editor: apps/web/src/components/files/FilePreviewPanel.tsx
// EditableFileSurface, which is a @pierre/diffs Editor over the highlighted file.
//
// gpuix has a native <textarea> but no caret or selection API, so the editor is built
// from two layers that GPUI lays out the same way:
//   - highlighted rows: one row per line, its tokens as adjacent <text> runs (gpuix
//     merges adjacent texts into one shaped line, wrapped by GPUI's line wrapper);
//   - over them, a <textarea> with transparent text holding the same lines, in the
//     same font, size, line height and width, so it wraps at the same places. It
//     draws the caret and selection and owns typing, IME, clipboard and undo.
// The file is cut into chunks of CHUNK lines, one textarea each, so a long file mounts
// only the chunks near the viewport. A comment form or comment under a line is a
// chunk boundary too, since nothing can sit inside a textarea.
//
// Limits, all from having no caret API: the caret cannot cross a chunk boundary
// (arrow keys stop at the chunk's first and last line, Backspace at a chunk's start
// does not join it to the previous line, a selection cannot span two chunks); Tab
// moves focus instead of indenting; the list does not scroll to follow the caret.
import type { EventPayload } from "@gpuix/native";
import { useGpuixRequired, type KeyEvent } from "@gpuix/react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { addComposerReviewComment, removeComposerReviewComment } from "../../state/composer.ts";
import { Icon } from "../../ui/Icon.tsx";
import { FONTS, useTheme } from "../../ui/theme.ts";
import {
  formatFileCommentRange,
  nextFileCommentId,
  type FileCommentAnnotationEntry,
} from "../../web/components/files/fileCommentAnnotations.ts";
import { buildFileReviewComment } from "../../web/reviewCommentContext.ts";
import { CODE_FONT_SIZE, CODE_LINE_HEIGHT, gpuiWrapBoundaries, segmentsFor, useMonoCharWidth, type Segment } from "../code/codeRows.tsx";
import { useSyntaxTokens, type SyntaxToken } from "../code/highlighter.ts";
import { useListWindow } from "../code/listWindow.ts";
import { diffPalette, mix, mixLab, type DiffPalette } from "../code/palette.ts";
import { DiffCommentAnnotation } from "../diff/DiffCommentAnnotation.tsx";

/** Lines per textarea. Small enough that the chunks on screen stay cheap to rebuild per keystroke. */
const CHUNK = 64;
const WINDOW = 24;
const PADDING_Y = 8;
const HIGHLIGHT_DEBOUNCE_MS = 150;

interface Chunk {
  readonly id: number;
  readonly count: number;
  /** Comment entries hanging under this chunk's last line. */
  readonly entries: ReadonlyArray<FileCommentAnnotationEntry>;
}

interface EditorDoc {
  /** The `text` prop this document was built from or last emitted. */
  readonly source: string;
  readonly lines: ReadonlyArray<string>;
  readonly eol: "\n" | "\r\n";
  readonly chunks: ReadonlyArray<Chunk>;
}

let chunkSequence = 0;

function splitDoc(text: string): { lines: string[]; eol: "\n" | "\r\n" } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r\n|\n/), eol };
}

/** Chunks of at most CHUNK lines, also cut after every line that carries comment entries. */
function buildChunks(
  lineCount: number,
  entriesByLine: ReadonlyMap<number, ReadonlyArray<FileCommentAnnotationEntry>>,
): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  for (let line = 1; line <= lineCount; line += 1) {
    const entries = entriesByLine.get(line);
    if (entries || line - start === CHUNK || line === lineCount) {
      chunks.push({ id: chunkSequence++, count: line - start, entries: entries ?? [] });
      start = line;
    }
  }
  if (chunks.length === 0) chunks.push({ id: chunkSequence++, count: Math.max(1, lineCount), entries: [] });
  return chunks;
}

function entriesByEndLine(chunks: ReadonlyArray<Chunk>): Map<number, ReadonlyArray<FileCommentAnnotationEntry>> {
  const byLine = new Map<number, ReadonlyArray<FileCommentAnnotationEntry>>();
  let end = 0;
  for (const chunk of chunks) {
    end += chunk.count;
    if (chunk.entries.length > 0) byLine.set(end, chunk.entries);
  }
  return byLine;
}

function makeDoc(text: string, previous: EditorDoc | null): EditorDoc {
  const { lines, eol } = splitDoc(text);
  // A change from elsewhere keeps the comments on their line numbers, as pierre does.
  const kept = new Map<number, ReadonlyArray<FileCommentAnnotationEntry>>();
  if (previous) {
    for (const [line, entries] of entriesByEndLine(previous.chunks)) kept.set(Math.min(line, lines.length), entries);
  }
  return { source: text, lines, eol, chunks: buildChunks(lines.length, kept) };
}

/** Lines + the chunk layout as the virtual list's items. */
type EditorItem =
  | { readonly type: "pad"; readonly key: string }
  | { readonly type: "chunk"; readonly key: string; readonly index: number; readonly start: number; readonly chunk: Chunk }
  | { readonly type: "annotation"; readonly key: string; readonly index: number; readonly lineNumber: number; readonly chunk: Chunk };

function buildItems(doc: EditorDoc): EditorItem[] {
  const items: EditorItem[] = [{ type: "pad", key: "pad-top" }];
  let start = 0;
  doc.chunks.forEach((chunk, index) => {
    items.push({ type: "chunk", key: `c${chunk.id}`, index, start, chunk });
    start += chunk.count;
    if (chunk.entries.length > 0) items.push({ type: "annotation", key: `a${chunk.id}`, index, lineNumber: start, chunk });
  });
  items.push({ type: "pad", key: "pad-bottom" });
  return items;
}

function useDebounced<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export interface FileEditorProps {
  readonly path: string;
  /** The file as the query (or its optimistic copy) has it. */
  readonly text: string;
  readonly wrap: boolean;
  /** 1-based line to center and tint, or null. */
  readonly revealLine: number | null;
  readonly revealKey: string;
  /** Every edit, as the whole file in its own line endings. */
  readonly onEdit: (text: string) => void;
  /** composerTargetKey of the thread whose composer takes line comments. */
  readonly draftKey: string;
  readonly testId?: string;
}

export function FileEditor(props: FileEditorProps) {
  const theme = useTheme();
  // The Files editor is pierre's File with its own selection colours (StyledDiffCodeView's
  // overrides are the Diff surface's only): the selection blue mixed in lab into the code
  // background, 25% on lines and 40% on the number column (dark), and no side bar.
  const basePalette = diffPalette(theme);
  const codeBg = theme.codeBackground.slice(0, 7);
  const dark = theme.appearance === "dark";
  const palette: DiffPalette = {
    ...basePalette,
    selectedLine: mixLab(codeBg, basePalette.modified, dark ? 0.25 : 0.18),
    selectedGutter: mixLab(codeBg, basePalette.modified, dark ? 0.4 : 0.25),
  };
  const renderer = useGpuixRequired();
  const { width: ch, probe } = useMonoCharWidth();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { listRef, start, onVisibleRange, reset } = useListWindow(WINDOW);
  const [scrollX, setScrollX] = useState(0);
  const [doc, setDoc] = useState<EditorDoc>(() => makeDoc(props.text, null));
  // The editor owns the draft: its own edits echo back through the file query unchanged.
  // Only contents from elsewhere (the agent, another client, a reload) replace it.
  if (props.text !== doc.source) setDoc(makeDoc(props.text, doc));
  const docRef = useRef(doc);
  docRef.current = doc;

  const currentText = useMemo(() => doc.lines.join("\n"), [doc.lines]);
  const highlightText = useDebounced(currentText, HIGHLIGHT_DEBOUNCE_MS);
  const syntax = useSyntaxTokens(highlightText, props.path, theme.appearance);
  // While the highlighter catches up, a line keeps the tokens of an identical line from
  // the last pass, so typing only greys the line being typed on.
  const tokensFor = useMemo(() => {
    if (!syntax) return () => null;
    const highlightedLines = highlightText.split("\n");
    if (highlightText === currentText) return (index: number) => syntax[index] ?? null;
    const byContent = new Map<string, ReadonlyArray<SyntaxToken>>();
    highlightedLines.forEach((line, index) => {
      if (!byContent.has(line) && syntax[index]) byContent.set(line, syntax[index]!);
    });
    return (index: number) => byContent.get(doc.lines[index] ?? "") ?? null;
  }, [syntax, highlightText, currentText, doc.lines]);

  const digits = String(doc.lines.length).length;
  const gutter = Math.ceil((digits + 3) * ch);
  const codeWidth = Math.max(1, size.width - gutter - 2 - 2 * ch);
  const longest = useMemo(() => (props.wrap ? 0 : doc.lines.reduce((max, line) => Math.max(max, line.length), 0)), [doc.lines, props.wrap]);
  const noWrapWidth = Math.max(codeWidth, Math.ceil((longest + 4) * ch));
  const maxScrollX = props.wrap ? 0 : Math.max(0, noWrapWidth - codeWidth);
  const clampedScrollX = Math.min(scrollX, maxScrollX);

  // ── Edits ──
  const commitDoc = (next: EditorDoc) => {
    setDoc(next);
    docRef.current = next;
  };
  const editChunk = (index: number, value: string) => {
    const current = docRef.current;
    const chunk = current.chunks[index];
    if (!chunk) return;
    const chunkStart = current.chunks.slice(0, index).reduce((sum, item) => sum + item.count, 0);
    const replacement = value.split("\n");
    const lines = [...current.lines.slice(0, chunkStart), ...replacement, ...current.lines.slice(chunkStart + chunk.count)];
    const chunks = current.chunks.map((item, candidate) => (candidate === index ? { ...item, count: replacement.length } : item));
    const text = lines.join(current.eol);
    commitDoc({ source: text, lines, eol: current.eol, chunks });
    props.onEdit(text);
    // web handleEditChange: comments follow their lines, and the composer gets them again
    // with the lines they now point at.
    resendComments({ ...current, lines, chunks, source: text });
  };

  // ── Comments (EditableFileSurface's lineAnnotations) ──
  const [selection, setSelectionState] = useState<{ anchor: number; focus: number } | null>(null);
  // Press, drag and release can all land before React re-renders; read the live value.
  const selectionRef = useRef(selection);
  const setSelection = (next: { anchor: number; focus: number } | null) => {
    selectionRef.current = next;
    setSelectionState(next);
  };
  const selectingRef = useRef(false);
  const [draftText, setDraftText] = useState("");
  const hasOpenCommentForm = doc.chunks.some((chunk) => chunk.entries.some((entry) => entry.kind === "draft"));

  const resendComments = (next: EditorDoc) => {
    for (const [lineNumber, entries] of entriesByEndLine(next.chunks)) {
      for (const entry of entries) {
        if (entry.kind !== "comment") continue;
        const span = entry.endLine - entry.startLine;
        addComposerReviewComment(
          props.draftKey,
          buildFileReviewComment({
            id: entry.id,
            filePath: props.path,
            startLine: Math.max(1, lineNumber - span),
            endLine: lineNumber,
            text: entry.text,
            contents: next.lines.join("\n"),
          }),
        );
      }
    }
  };

  /** Rebuilds the chunk layout with `update` applied to the entries by line. */
  const updateEntries = (
    update: (byLine: Map<number, ReadonlyArray<FileCommentAnnotationEntry>>) => void,
  ) => {
    const current = docRef.current;
    const byLine = entriesByEndLine(current.chunks);
    update(byLine);
    for (const [line, entries] of byLine) if (entries.length === 0) byLine.delete(line);
    commitDoc({ ...current, chunks: buildChunks(current.lines.length, byLine) });
  };

  const beginComment = (range: { start: number; end: number }) => {
    const startLine = Math.min(range.start, range.end);
    const endLine = Math.max(range.start, range.end);
    setDraftText("");
    updateEntries((byLine) => {
      for (const [line, entries] of byLine) byLine.set(line, entries.filter((entry) => entry.kind !== "draft"));
      byLine.set(endLine, [
        ...(byLine.get(endLine) ?? []),
        { id: nextFileCommentId(), kind: "draft", startLine, endLine, text: "" },
      ]);
    });
  };

  const removeEntry = (entryId: string) => {
    setSelection(null);
    removeComposerReviewComment(props.draftKey, entryId);
    updateEntries((byLine) => {
      for (const [line, entries] of byLine) byLine.set(line, entries.filter((entry) => entry.id !== entryId));
    });
  };

  const submitEntry = (entryId: string, text: string) => {
    setSelection(null);
    const current = docRef.current;
    for (const [lineNumber, entries] of entriesByEndLine(current.chunks)) {
      const entry = entries.find((candidate) => candidate.id === entryId);
      if (!entry) continue;
      const span = entry.endLine - entry.startLine;
      addComposerReviewComment(
        props.draftKey,
        buildFileReviewComment({
          id: entry.id,
          filePath: props.path,
          startLine: Math.max(1, lineNumber - span),
          endLine: lineNumber,
          text,
          contents: current.lines.join("\n"),
        }),
      );
    }
    updateEntries((byLine) => {
      for (const [line, entries] of byLine)
        byLine.set(
          line,
          entries.map((entry) => (entry.id === entryId ? { ...entry, kind: "comment" as const, text } : entry)),
        );
    });
  };

  const gutterInput = useRef<GutterInput>(null as never);
  gutterInput.current = {
    enabled: !hasOpenCommentForm,
    down(line, shift) {
      if (hasOpenCommentForm) return;
      selectingRef.current = true;
      const current = selectionRef.current;
      setSelection(shift && current ? { anchor: current.anchor, focus: line } : { anchor: line, focus: line });
    },
    enter(line) {
      const current = selectionRef.current;
      if (!selectingRef.current || !current || current.focus === line) return;
      setSelection({ ...current, focus: line });
    },
    utility(line) {
      if (hasOpenCommentForm) return;
      selectingRef.current = false;
      const range = selectionRef.current ?? { anchor: line, focus: line };
      setSelection(range);
      beginComment({ start: range.anchor, end: range.focus });
    },
  };
  // web handleLineSelectionEnd: releasing a line selection opens its comment form.
  const pointerUp = () => {
    if (!selectingRef.current) return;
    selectingRef.current = false;
    const current = selectionRef.current;
    if (current) beginComment({ start: current.anchor, end: current.focus });
  };
  const pointerUpRef = useRef(pointerUp);
  pointerUpRef.current = pointerUp;
  const gutterApi = useMemo<GutterApi>(
    () => ({
      up: () => pointerUpRef.current(),
      down: (line, shift) => gutterInput.current.down(line, shift),
      enter: (line) => gutterInput.current.enter(line),
      utility: (line) => gutterInput.current.utility(line),
    }),
    [],
  );
  // The gutter and its "+" both claim the hover (it goes to the topmost element), and a
  // leave only clears its own claim, so moving onto the button keeps it.
  const [hover, setHover] = useState<{ line: number; via: "gutter" | "button" } | null>(null);
  const hoverApi = useMemo<HoverApi>(
    () => ({
      enter: (line, via) => setHover((current) => (current?.line === line && current.via === via ? current : { line, via })),
      leave: (line, via) => setHover((current) => (current?.line === line && current.via === via ? null : current)),
    }),
    [],
  );
  const hoveredLine = hover?.line ?? null;

  // ── Reveal (useFileLineReveal) ──
  const items = useMemo(() => buildItems(doc), [doc]);
  const handled = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (props.revealLine === null || listRef.current === null || size.height === 0) return;
    if (handled.current === props.revealKey) return;
    handled.current = props.revealKey;
    const line = Math.min(doc.lines.length, Math.max(1, props.revealLine));
    const itemIndex = items.findIndex(
      (item) => item.type === "chunk" && line > item.start && line <= item.start + item.chunk.count,
    );
    const item = items[itemIndex];
    if (!item || item.type !== "chunk") return;
    let offset = 0;
    for (let index = item.start; index < line - 1; index += 1) {
      offset += (props.wrap ? gpuiWrapBoundaries(doc.lines[index] ?? "", codeWidth, ch).length + 1 : 1) * CODE_LINE_HEIGHT;
    }
    reset(Math.max(0, itemIndex - 2));
    renderer.scrollToItem?.(listRef.current.id, itemIndex, offset - Math.max(0, Math.floor(size.height / 2 - CODE_LINE_HEIGHT / 2)));
  }, [props.revealLine, props.revealKey, size.height, items, renderer]);

  const end = Math.min(items.length, start + WINDOW);
  const selectedRange = selection ? { from: Math.min(selection.anchor, selection.focus), to: Math.max(selection.anchor, selection.focus) } : null;
  const revealColor = mix(theme.codeBackground.slice(0, 7), theme.primary.slice(0, 7), 0.18);

  return (
    <div
      {...(props.testId ? { testId: props.testId } : {})}
      onLayout={(event) => {
        const width = Math.floor(Number(event.width ?? 0));
        const height = Math.floor(Number(event.height ?? 0));
        if (width > 0 && (width !== size.width || height !== size.height)) setSize({ width, height });
      }}
      onMouseUp={pointerUp}
      onScroll={(event: EventPayload) => {
        if (props.wrap) return;
        const deltaX = Number(event.deltaX ?? 0);
        if (deltaX !== 0) setScrollX((current) => Math.max(0, Math.min(maxScrollX, current - deltaX)));
      }}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, position: "relative", backgroundColor: theme.background }}
    >
      {probe}
      {size.width > 0 ? (
        <virtual-list
          ref={listRef}
          itemCount={items.length}
          windowStart={start}
          estimatedItemHeight={CODE_LINE_HEIGHT * 8}
          overdraw={400}
          onVisibleRange={(event) => {
            const first = Math.floor(Number(event.startIndex ?? 0));
            onVisibleRange(first, Math.ceil(Number(event.endIndex ?? first)));
          }}
          style={{ flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar }}
        >
          {items.slice(start, end).map((item) => {
            if (item.type === "pad") return <div key={item.key} style={{ height: PADDING_Y, backgroundColor: theme.codeBackground }} />;
            if (item.type === "annotation") {
              const hasDraft = item.chunk.entries.some((entry) => entry.kind === "draft");
              return (
                // pierre keeps the commented lines selected while the form is open, form included.
                <div
                  key={item.key}
                  style={{ display: "flex", flexDirection: "row", width: size.width, backgroundColor: hasDraft && selectedRange ? palette.selectedLine : theme.codeBackground }}
                >
                  <div style={{ width: gutter, flexShrink: 0, backgroundColor: hasDraft && selectedRange ? palette.selectedGutter : theme.codeBackground }} />
                  <div style={{ width: 2, flexShrink: 0 }} />
                  <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, paddingTop: 4, paddingBottom: 4 }}>
                    {item.chunk.entries.map((entry) => (
                      <div key={entry.id} style={{ display: "flex", width: "100%" }}>
                        <DiffCommentAnnotation
                          testId={`file-comment-${entry.kind}`}
                          kind={entry.kind}
                          rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine)}
                          text={entry.kind === "draft" ? draftText : entry.text}
                          onTextChange={hasDraft ? setDraftText : undefined}
                          onCancel={() => removeEntry(entry.id)}
                          onComment={(text) => submitEntry(entry.id, text)}
                          onDelete={() => removeEntry(entry.id)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <ChunkView
                key={item.key}
                index={item.index}
                start={item.start}
                lines={doc.lines.slice(item.start, item.start + item.chunk.count)}
                tokensFor={tokensFor}
                wrap={props.wrap}
                width={size.width}
                gutter={gutter}
                ch={ch}
                codeWidth={codeWidth}
                noWrapWidth={noWrapWidth}
                scrollX={clampedScrollX}
                palette={palette}
                caret={theme.foreground}
                background={theme.codeBackground}
                revealLine={props.revealLine}
                revealColor={revealColor}
                selected={selectedRange}
                hoveredLine={gutterInput.current.enabled && hoveredLine !== null && hoveredLine > item.start && hoveredLine <= item.start + item.chunk.count ? hoveredLine : null}
                hoverApi={hoverApi}
                gutterApi={gutterApi}
                onChange={editChunk}
              />
            );
          })}
        </virtual-list>
      ) : null}
    </div>
  );
}

interface GutterInput {
  readonly enabled: boolean;
  down(line: number, shift: boolean): void;
  enter(line: number): void;
  utility(line: number): void;
}
type GutterApi = Omit<GutterInput, "enabled"> & { up(): void };
interface HoverApi {
  enter(line: number, via: "gutter" | "button"): void;
  leave(line: number, via: "gutter" | "button"): void;
}

const ChunkView = memo(function ChunkView(props: {
  index: number;
  start: number;
  lines: ReadonlyArray<string>;
  tokensFor: (index: number) => ReadonlyArray<SyntaxToken> | null;
  wrap: boolean;
  width: number;
  gutter: number;
  ch: number;
  codeWidth: number;
  noWrapWidth: number;
  scrollX: number;
  palette: DiffPalette;
  caret: string;
  background: string;
  revealLine: number | null;
  revealColor: string;
  selected: { from: number; to: number } | null;
  hoveredLine: number | null;
  hoverApi: HoverApi;
  gutterApi: GutterApi;
  onChange: (index: number, value: string) => void;
}) {
  const { palette } = props;
  const value = props.lines.join("\n");
  const textLeft = props.gutter + 2 + props.ch;
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: props.width, overflow: "hidden" }}>
      {props.lines.map((text, offset) => {
        const lineNumber = props.start + offset + 1;
        const selected = props.selected !== null && lineNumber >= props.selected.from && lineNumber <= props.selected.to;
        return (
          <EditorLine
            key={offset}
            lineNumber={lineNumber}
            text={text}
            tokens={props.tokensFor(props.start + offset)}
            wrap={props.wrap}
            gutter={props.gutter}
            ch={props.ch}
            codeWidth={props.codeWidth}
            noWrapWidth={props.noWrapWidth}
            scrollX={props.scrollX}
            palette={palette}
            background={selected ? palette.selectedLine : lineNumber === props.revealLine ? props.revealColor : props.background}
            gutterBackground={selected ? palette.selectedGutter : lineNumber === props.revealLine ? props.revealColor : props.background}
            selected={selected}
            utility={props.hoveredLine === lineNumber}
            hoverApi={props.hoverApi}
            gutterApi={props.gutterApi}
          />
        );
      })}
      {/* The editing layer: the same lines, same metrics, transparent text. */}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: textLeft, width: props.codeWidth, overflow: "hidden" }}>
        <textarea
          testId={`file-editor-chunk-${props.index}`}
          value={value}
          // The box, not the row count, sizes it (an explicit height wins over the rows).
          minRows={1}
          maxRows={100_000}
          onChange={(event: EventPayload) => props.onChange(props.index, String(event.value ?? ""))}
          onKeyDown={(event: KeyEvent) => {
            // Ctrl/Cmd+Enter belongs to the composer, not to a file.
            if (event.key === "enter") event.stopPropagation();
          }}
          theme={{ caret: props.caret }}
          style={{
            position: "absolute",
            top: 0,
            height: "100%",
            left: props.wrap ? 0 : -props.scrollX,
            width: props.wrap ? props.codeWidth : props.noWrapWidth,
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: 0,
            paddingRight: 0,
            borderWidth: 0,
            color: process.env.T3TERM_EDITOR_DEBUG ? "#ff3030a0" : "#00000000",
            backgroundColor: "#00000000",
            fontFamily: FONTS.mono,
            fontSize: CODE_FONT_SIZE,
            lineHeight: CODE_LINE_HEIGHT,
          }}
        />
      </div>
    </div>
  );
});

const EditorLine = memo(function EditorLine(props: {
  lineNumber: number;
  text: string;
  tokens: ReadonlyArray<SyntaxToken> | null;
  wrap: boolean;
  gutter: number;
  ch: number;
  codeWidth: number;
  noWrapWidth: number;
  scrollX: number;
  palette: DiffPalette;
  background: string;
  gutterBackground: string;
  selected: boolean;
  utility: boolean;
  hoverApi: HoverApi;
  gutterApi: GutterApi;
}) {
  const { palette } = props;
  // Rows break where the textarea above them breaks (GPUI's wrap rule), so glyphs and caret line up.
  const starts = props.wrap ? [0, ...gpuiWrapBoundaries(props.text, props.codeWidth, props.ch)] : [0];
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "row", width: "100%", minHeight: CODE_LINE_HEIGHT, backgroundColor: props.background }}>
      <div
        onMouseEnter={() => {
          props.hoverApi.enter(props.lineNumber, "gutter");
          props.gutterApi.enter(props.lineNumber);
        }}
        onMouseLeave={() => props.hoverApi.leave(props.lineNumber, "gutter")}
        // The release usually lands on a number; the editor root catches the rest.
        onMouseUp={() => props.gutterApi.up()}
        onMouseDown={(event: EventPayload) => {
          if (pressTaken(event) || (event.button ?? 0) !== 0) return;
          props.gutterApi.down(props.lineNumber, event.modifiers?.shift === true);
        }}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "row",
          justifyContent: "flex-end",
          alignItems: "flex-start",
          width: props.gutter,
          flexShrink: 0,
          paddingRight: Math.round(props.ch),
          backgroundColor: props.gutterBackground,
          userSelect: "none",
          cursor: "pointer",
        }}
      >
        <text
          style={{
            color: props.selected ? palette.selectedNumber : palette.number,
            fontFamily: FONTS.mono,
            fontSize: CODE_FONT_SIZE,
            lineHeight: CODE_LINE_HEIGHT,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {String(props.lineNumber)}
        </text>
      </div>
      <div style={{ width: 2, flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, overflow: "hidden", paddingLeft: props.ch, paddingRight: props.ch }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            ...(props.wrap ? { width: "100%" } : { width: props.noWrapWidth, marginLeft: -props.scrollX, flexShrink: 0 }),
          }}
        >
          {starts.map((from, index) => (
            <PlacedRun
              key={index}
              ch={props.ch}
              segments={segmentsFor(props.text, props.tokens, from, starts[index + 1] ?? props.text.length, [], palette.fg)}
            />
          ))}
        </div>
      </div>
      {props.utility ? <UtilityButton left={props.gutter - Math.round(props.ch)} palette={palette} onPress={() => props.gutterApi.utility(props.lineNumber)} onHover={(hovered) => (hovered ? props.hoverApi.enter(props.lineNumber, "button") : props.hoverApi.leave(props.lineNumber, "button"))} /> : null}
    </div>
  );
});

/**
 * One visual row with every run placed at its column (column × ch). A flex row of
 * runs drifts: each run's box is rounded to whole pixels, and the error adds up
 * along the line, while the textarea above places glyphs at their exact advances.
 */
function PlacedRun({ segments, ch }: { segments: ReadonlyArray<Segment>; ch: number }) {
  let column = 0;
  return (
    <div style={{ position: "relative", height: CODE_LINE_HEIGHT, flexShrink: 0 }}>
      {segments.map((segment, index) => {
        const left = column * ch;
        column += Array.from(segment.text).length;
        return (
          <text
            key={index}
            style={{
              position: "absolute",
              top: 0,
              left,
              color: segment.color,
              fontFamily: FONTS.mono,
              fontSize: CODE_FONT_SIZE,
              lineHeight: CODE_LINE_HEIGHT,
              whiteSpace: "nowrap",
            }}
          >
            {segment.text}
          </text>
        );
      })}
    </div>
  );
}

let takenPress: { x: number; y: number; at: number } | null = null;
function takePress(event: EventPayload) {
  takenPress = { x: Number(event.x ?? 0), y: Number(event.y ?? 0), at: Date.now() };
}
function pressTaken(event: EventPayload): boolean {
  const taken = takenPress;
  return taken !== null && taken.x === Number(event.x ?? 0) && taken.y === Number(event.y ?? 0) && Date.now() - taken.at < 500;
}

/** pierre's gutter utility, as on the Diff surface. */
function UtilityButton(props: { left: number; palette: DiffPalette; onPress: () => void; onHover: (hovered: boolean) => void }): ReactNode {
  return (
    <div
      testId="file-gutter-utility"
      onMouseDown={(event: EventPayload) => {
        takePress(event);
        props.onPress();
      }}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
      style={{
        position: "absolute",
        top: 0,
        left: props.left,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: CODE_LINE_HEIGHT,
        height: CODE_LINE_HEIGHT,
        borderRadius: 4,
        backgroundColor: props.palette.modified,
        cursor: "pointer",
      }}
    >
      <Icon name="plus" size={14} color={props.palette.bg} strokeWidth={2.5} />
    </div>
  );
}

