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
// The textarea reports no caret, so fileEditorCaret.ts models where it can be from the
// changes, key releases and presses JavaScript sees. On that model: arrows, Home/End
// and Ctrl+Home/End carry the caret across chunks, Backspace at a chunk's start and
// Delete at its end join the lines, Tab and Shift+Tab indent and outdent like pierre,
// the list follows the caret, and Escape or a press outside drops the selection and
// focus. The caret is moved into another chunk with one synthetic click, or one key
// where the spot is off screen: each simulated key costs a full window draw.
//
// Limits:
//   - A selection cannot span two chunks: each textarea owns its selection and copy.
//   - A held arrow auto-repeats with one key release, which proves only one step, so
//     it stops at a chunk edge until another press or an edit pins the caret down.
//     Shift+Tab needs the caret's line pinned down too (a click or an edit on it).
//   - Tab or Shift+Tab over several selected lines does nothing (pierre indents each).
//   - A join resets the undo history of the two chunks (their values come from props).
//   - Tab's two spaces undo in two steps: gpuix never merges whitespace into one step.
import type { EventPayload } from "@gpuix/native";
import { useGpuixRequired, type KeyEvent } from "@gpuix/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
import {
  caretAfterChange,
  caretAfterRelease,
  columnsBetween,
  exactCaret,
  fileIndentUnit,
  indentUnitFor,
  isExact,
  layoutChunk,
  lineAt,
  offsetAtColumn,
  outdentLength,
  rowAt,
  unknownCaret,
  type Caret,
  type CaretAction,
  type ChunkLayout,
} from "./fileEditorCaret.ts";

/** Lines per textarea. Small enough that the chunks on screen stay cheap to rebuild per keystroke. */
const CHUNK = 64;
const WINDOW = 24;
const PADDING_Y = 8;
const HIGHLIGHT_DEBOUNCE_MS = 150;
const IS_MAC = process.platform === "darwin";
const MOVE_KEYS = new Set(["left", "right", "up", "down", "home", "end"]);

function repeatKey(key: string, count: number): string {
  return Array.from({ length: count }, () => key).join(" ");
}

/** gpuix's automation surface, which NativeRenderer's type leaves out. */
interface HostRenderer {
  simulateKeystrokes?: (keys: string) => void;
  simulateClick?: (x: number, y: number, button?: number, modifiers?: string) => void;
}
function hostRenderer(): HostRenderer | undefined {
  return (Reflect.get(globalThis, "__gpuixRenderHost") as { renderer?: HostRenderer } | undefined)?.renderer;
}

/**
 * Sends keystrokes through the focused element's input pipeline. They are moves, deletes
 * and typed whitespace only, so the textarea records them in its undo history like typing
 * and the clipboard is never touched.
 */
function simulateKeystrokes(keys: string): boolean {
  const host = hostRenderer();
  if (!host?.simulateKeystrokes) return false;
  try {
    host.simulateKeystrokes(keys);
  } catch {
    // It stops waiting after 2 s of slow frames; the keys still land.
  }
  return true;
}

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
  previous: ReadonlyArray<Chunk> = [],
): Chunk[] {
  // A chunk that keeps its lines keeps its id, so its textarea (focus, undo) survives a
  // comment opening or closing elsewhere in the file.
  const previousIds = new Map<string, number>();
  let previousStart = 0;
  for (const chunk of previous) {
    previousIds.set(`${previousStart}:${chunk.count}`, chunk.id);
    previousStart += chunk.count;
  }
  const chunks: Chunk[] = [];
  let start = 0;
  for (let line = 1; line <= lineCount; line += 1) {
    const entries = entriesByLine.get(line);
    if (entries || line - start === CHUNK || line === lineCount) {
      const count = line - start;
      chunks.push({ id: previousIds.get(`${start}:${count}`) ?? chunkSequence++, count, entries: entries ?? [] });
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
    const previousValue = current.lines.slice(chunkStart, chunkStart + chunk.count).join("\n");
    if (previousValue === value) return;
    noteChange(chunk.id, previousValue, value);
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
    commitDoc({ ...current, chunks: buildChunks(current.lines.length, byLine, current.chunks) });
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

  /** The editor's root element. */
  const rootRef = useRef<{ id: number } | null>(null);

  // ── The caret (fileEditorCaret.ts) ──
  // Refs, not state: nothing here is drawn by React, and typing must not re-render for it.
  const caretRef = useRef<Caret | null>(null);
  /** Textarea element id by chunk id, for moving focus between chunks. */
  const textareaIds = useRef(new Map<number, number>());
  /** Bumping a chunk's generation remounts its textarea: the one way to drop the selection of a textarea that no longer has focus. */
  const [generations, setGenerations] = useState<ReadonlyMap<number, number>>(() => new Map());
  // Backspace and Delete change the text unless the caret is at the very start or end, so
  // a release with no change since the press began proves the caret is at that edge. Every
  // event that starts a press (a key-down JavaScript sees, a mouse press, a move key's
  // release) resets the baseline.
  const changeSerial = useRef(0);
  const pressBaseline = useRef(0);
  /** Typed spaces a keystroke plan sent: their key-downs come back and are not the user's. */
  const simulatedKeyDowns = useRef(0);
  /** A plan in flight: its intermediate changes leave the model alone until the last one lands. */
  const planRef = useRef<{ chunkId: number; text: string; caret: Caret; changesLeft: number } | null>(null);
  const pressRef = useRef<{ chunkId: number; offset: number | null; clickCount: number; shift: boolean; resolved: boolean } | null>(null);
  const annotationHeights = useRef(new Map<string, number>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const geometry = useRef({ wrap: props.wrap, codeWidth, ch, start, scrollX: clampedScrollX, maxScrollX });
  geometry.current = { wrap: props.wrap, codeWidth, ch, start, scrollX: clampedScrollX, maxScrollX };

  const chunkIndexOf = (chunkId: number) => docRef.current.chunks.findIndex((chunk) => chunk.id === chunkId);
  const chunkStartOf = (index: number) => docRef.current.chunks.slice(0, index).reduce((sum, chunk) => sum + chunk.count, 0);
  const itemIndexOf = (chunkId: number) => itemsRef.current.findIndex((item) => item.type === "chunk" && item.chunk.id === chunkId);
  const layoutOf = (index: number): ChunkLayout => {
    const current = docRef.current;
    const begin = chunkStartOf(index);
    const { wrap, codeWidth: width, ch: charWidth } = geometry.current;
    return layoutChunk(
      current.lines.slice(begin, begin + (current.chunks[index]?.count ?? 0)),
      wrap ? (line) => gpuiWrapBoundaries(line, width, charWidth) : () => [],
    );
  };
  const simulate = (keys: string): boolean => {
    if (!keys) return true;
    const typed = keys.split(" ").filter((key) => key.startsWith("space")).length;
    simulatedKeyDowns.current += typed;
    if (simulateKeystrokes(keys)) return true;
    simulatedKeyDowns.current -= typed;
    return false;
  };

  const noteChange = (chunkId: number, previous: string, next: string) => {
    changeSerial.current += 1;
    const plan = planRef.current;
    if (plan && plan.chunkId === chunkId) {
      plan.changesLeft -= 1;
      if (next === plan.text) {
        planRef.current = null;
        caretRef.current = plan.caret;
        scheduleFollow();
        return;
      }
      if (plan.changesLeft > 0) return;
      planRef.current = null;
    }
    caretRef.current = caretAfterChange(caretRef.current, chunkId, previous, next).caret;
    scheduleFollow();
  };

  // ── Following the caret ──
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (followTimer.current) clearTimeout(followTimer.current);
  }, []);
  /** Once per burst of events: a typing burst asks for the list position once. */
  const scheduleFollow = () => {
    if (followTimer.current) return;
    followTimer.current = setTimeout(() => {
      followTimer.current = null;
      followRef.current();
    }, 0);
  };
  const itemHeight = (item: EditorItem): number => {
    if (item.type === "pad") return PADDING_Y;
    if (item.type === "annotation") return annotationHeights.current.get(item.key) ?? CODE_LINE_HEIGHT * 4;
    return layoutOf(item.index).rows.length * CODE_LINE_HEIGHT;
  };
  /** Scrolls the list the least that shows `height` px at `y` inside item `itemIndex`; true if it scrolled. */
  const ensureVisible = (itemIndex: number, y: number, height: number): boolean => {
    const list = listRef.current;
    const top = list ? renderer.getListScrollTop?.(list.id) : null;
    if (!list || !top) return false;
    const [anchorIndex = 0, anchorOffset = 0, viewport = 0] = top;
    const all = itemsRef.current;
    // Target top minus viewport top.
    let distance: number;
    if (anchorIndex >= all.length) {
      distance = y + viewport;
      for (let index = itemIndex; index < all.length; index += 1) distance -= itemHeight(all[index]!);
    } else if (itemIndex >= anchorIndex) {
      distance = y - anchorOffset;
      for (let index = anchorIndex; index < itemIndex && distance <= viewport; index += 1) distance += itemHeight(all[index]!);
    } else {
      distance = y - anchorOffset;
      for (let index = itemIndex; index < anchorIndex && distance >= -height; index += 1) distance -= itemHeight(all[index]!);
    }
    let offset: number | null = null;
    if (distance < 0) offset = y;
    else if (distance + height > viewport) offset = y + height - viewport;
    if (offset === null) return false;
    const windowStart = geometry.current.start;
    if (itemIndex < windowStart || itemIndex >= windowStart + WINDOW) reset(Math.max(0, itemIndex - 2));
    renderer.scrollToItem?.(list.id, itemIndex, offset);
    return true;
  };
  const followRef = useRef(() => {});
  followRef.current = () => {
    const caret = caretRef.current;
    if (!caret || caret.guess === null) return;
    const index = chunkIndexOf(caret.chunkId);
    const itemIndex = itemIndexOf(caret.chunkId);
    if (index < 0 || itemIndex < 0) return;
    const layout = layoutOf(index);
    const offset = Math.min(caret.guess, layout.text.length);
    const row = rowAt(layout, offset);
    ensureVisible(itemIndex, row * CODE_LINE_HEIGHT, CODE_LINE_HEIGHT);
    const { wrap, scrollX: left, codeWidth: width, ch: charWidth, maxScrollX: maxLeft } = geometry.current;
    if (wrap) return;
    const x = columnsBetween(layout.text, layout.rows[row]!.start, offset) * charWidth;
    if (x < left) setScrollX(Math.max(0, x - 4 * charWidth));
    else if (x > left + width - charWidth) setScrollX(Math.min(maxLeft, x - width + 5 * charWidth));
  };

  // ── Putting the caret somewhere ──
  // Every simulated key costs a full window draw before it is dispatched (GPUI draws a
  // dirty window ahead of each key event): ~90 ms each in the hidden automation window
  // here, and simulateKeystrokes stops waiting after 2 s. So the caret is placed with one
  // synthetic click where the spot is on screen, and with one key otherwise.
  /** The window point that puts the caret at `offset`, if that spot is on screen and nothing covers it. */
  const clickPoint = (chunkId: number, offset: number, layout: ChunkLayout): { x: number; y: number } | null => {
    const id = textareaIds.current.get(chunkId);
    const bounds = id === undefined ? null : renderer.getElementBounds?.(id);
    // The editor's root: a <virtual-list> registers no painted box of its own.
    const view = rootRef.current ? renderer.getElementBounds?.(rootRef.current.id) : null;
    if (id === undefined || !bounds || !view) return null;
    const row = rowAt(layout, offset, "after");
    const charWidth = geometry.current.ch;
    // A quarter character in: the closest caret position to that x is `offset` itself.
    const x = bounds.x + columnsBetween(layout.text, layout.rows[row]!.start, offset) * charWidth + charWidth / 4;
    const y = bounds.y + row * CODE_LINE_HEIGHT + CODE_LINE_HEIGHT / 2;
    if (y < view.y + 2 || y > view.y + view.height - 2) return null;
    const hits = hostRenderer()?.simulateClick ? renderer.getElementsAt?.(x, y) : null;
    return hits && hits[0] === id ? { x, y } : null;
  };
  const click = (point: { x: number; y: number }) => {
    try {
      hostRenderer()?.simulateClick?.(point.x, point.y, 0);
    } catch {
      // A slow frame times the call out; the click still lands.
    }
  };
  /**
   * Focuses a chunk's textarea without scrolling: focusElement scrolls the virtual list
   * to put the row's top at the viewport top (renderer.rs request_focus →
   * reveal_virtual_list_ancestor), so the list position is put back after it.
   */
  const focusChunk = (chunkId: number): boolean => {
    const id = textareaIds.current.get(chunkId);
    if (id === undefined) return false;
    if (renderer.getFocusedElementId?.() === id) return true;
    const list = listRef.current;
    const top = list ? renderer.getListScrollTop?.(list.id) : null;
    renderer.focusElement?.(id);
    if (list && top) {
      const all = itemsRef.current;
      if (top[0]! < all.length) renderer.scrollToItem?.(list.id, top[0]!, top[1]!);
      else renderer.scrollToItem?.(list.id, all.length - 1, PADDING_Y - top[2]!);
    }
    return renderer.getFocusedElementId?.() === id;
  };
  /**
   * Puts the caret of chunk `chunkId` at `offset`: scrolls it into view, then clicks
   * there. Where no click can reach it, focuses the chunk and sends `fallback` (one key),
   * which leaves the caret at `fallbackOffset`.
   */
  const placeCaret = (chunkId: number, offset: number, fallback: string, fallbackOffset: number, attempt = 0) => {
    const index = chunkIndexOf(chunkId);
    const itemIndex = itemIndexOf(chunkId);
    if (index < 0 || itemIndex < 0) return;
    const layout = layoutOf(index);
    const scrolled = ensureVisible(itemIndex, rowAt(layout, offset, "after") * CODE_LINE_HEIGHT, CODE_LINE_HEIGHT);
    if ((scrolled || !textareaIds.current.has(chunkId)) && attempt < 6) {
      // The scroll lands with the next frame; aim after it.
      setTimeout(() => placeCaretRef.current(chunkId, offset, fallback, fallbackOffset, attempt + 1), 40);
      return;
    }
    pressBaseline.current = changeSerial.current;
    const point = clickPoint(chunkId, offset, layout);
    if (point) {
      click(point);
      caretRef.current = exactCaret(chunkId, offset);
      return;
    }
    if (!focusChunk(chunkId)) return;
    caretRef.current = simulate(fallback) ? exactCaret(chunkId, fallbackOffset) : null;
    scheduleFollow();
  };
  const placeCaretRef = useRef(placeCaret);
  placeCaretRef.current = placeCaret;

  const cross = (index: number, action: CaretAction) => {
    const chunks = docRef.current.chunks;
    const upward = action.type === "crossUp" || action.type === "crossLeft";
    const targetIndex = upward ? index - 1 : index + 1;
    const target = chunks[targetIndex];
    if (!target) return;
    const layout = layoutOf(targetIndex);
    const length = layout.text.length;
    if (action.type === "crossLeft") return placeCaret(target.id, length, "cmd-down", length);
    if (action.type === "crossRight") return placeCaret(target.id, 0, "cmd-up", 0);
    // Up and Down keep the caret's column, as they do inside a chunk.
    const offset = offsetAtColumn(layout, upward ? layout.rows.length - 1 : 0, action.column);
    if (upward) placeCaret(target.id, offset, "cmd-down", length);
    else placeCaret(target.id, offset, "cmd-up", 0);
  };

  /** Ctrl+Home / Ctrl+End: the textarea binds document start and end to Cmd+Up/Down only. */
  const toDocumentEdge = (end: boolean) => {
    const chunks = docRef.current.chunks;
    const index = end ? chunks.length - 1 : 0;
    const target = chunks[index];
    if (!target || !focusChunk(target.id)) return;
    caretRef.current = simulate(end ? "cmd-down" : "cmd-up") ? exactCaret(target.id, end ? layoutOf(index).text.length : 0) : null;
    pressBaseline.current = changeSerial.current;
    scheduleFollow();
  };

  // ── Backspace at a chunk's start, Delete at its end ──
  const pendingJoin = useRef<{ doc: EditorDoc; chunkId: number; moved: string } | null>(null);
  /**
   * Joins the first line of the lower chunk onto the last line of the upper one. Both
   * textareas get new values, which resets their undo history (a value from props
   * replaces the textarea's text: input.rs set_external_text).
   */
  const join = (index: number, backward: boolean) => {
    const current = docRef.current;
    const upper = backward ? index - 1 : index;
    const lower = upper + 1;
    const upperChunk = current.chunks[upper];
    const lowerChunk = current.chunks[lower];
    if (!upperChunk || !lowerChunk) return;
    const lowerStart = chunkStartOf(lower);
    const moved = current.lines[lowerStart] ?? "";
    const lines = [...current.lines.slice(0, lowerStart - 1), (current.lines[lowerStart - 1] ?? "") + moved, ...current.lines.slice(lowerStart + 1)];
    const chunks = current.chunks.flatMap((chunk, candidate): Chunk[] => {
      if (candidate === lower) return chunk.count > 1 ? [{ ...chunk, count: chunk.count - 1 }] : [];
      // A one-line chunk joined away hands its comments to the line it joined.
      if (candidate === upper && lowerChunk.count === 1 && lowerChunk.entries.length > 0) return [{ ...chunk, entries: [...chunk.entries, ...lowerChunk.entries] }];
      return [chunk];
    });
    const text = lines.join(current.eol);
    const next: EditorDoc = { source: text, lines, eol: current.eol, chunks };
    changeSerial.current += 1;
    commitDoc(next);
    props.onEdit(text);
    resendComments(next);
    pendingJoin.current = { doc: next, chunkId: upperChunk.id, moved };
  };
  useLayoutEffect(() => {
    const pending = pendingJoin.current;
    if (!pending || pending.doc !== doc) return;
    pendingJoin.current = null;
    // This commit flushed the new values; a click or key sent after it meets the updated textarea.
    setTimeout(() => {
      const index = chunkIndexOf(pending.chunkId);
      if (index < 0) return;
      const length = layoutOf(index).text.length;
      placeCaretRef.current(pending.chunkId, length - pending.moved.length, "cmd-down", length);
    }, 0);
  }, [doc]);

  // ── Tab and Shift+Tab (pierre's indent and outdent commands) ──
  const indent = (index: number, outdent: boolean) => {
    const chunk = docRef.current.chunks[index];
    if (!chunk) return;
    const layout = layoutOf(index);
    const known = caretRef.current;
    const caret = known && known.chunkId === chunk.id ? known : unknownCaret(chunk.id, layout.text.length);
    const typeUnit = (unit: string) => simulate(unit === "\t" ? "space->\t" : repeatKey("space", unit.length));
    const singleLine = typeof caret.anchor === "number" && isExact(caret) && lineAt(layout, caret.anchor) === lineAt(layout, caret.lo);
    if (!outdent) {
      if (caret.anchor === null || singleLine) {
        // The unit depends only on the caret's line; with no line known, on the file's indent.
        // Typing it replaces a selection inside one line, as pierre does.
        const line = caret.guess === null ? null : layout.lines[lineAt(layout, caret.guess)];
        typeUnit(line == null ? fileIndentUnit(docRef.current.lines) : indentUnitFor(line));
      }
      // A selection over several lines (pierre indents each line) is left alone: it would take keys per line.
      return;
    }
    // Outdent edits the caret's line: only when that line is proven.
    if (caret.anchor !== null || !isExact(caret)) return;
    const line = lineAt(layout, caret.lo);
    const lineStart = layout.lineStarts[line]!;
    const remove = outdentLength(layout.lines[line] ?? "");
    if (remove === 0) return;
    if (rowAt(layout, caret.lo, "after") === rowAt(layout, lineStart)) {
      if (!simulate("home")) return;
    } else {
      const point = clickPoint(chunk.id, lineStart, layout);
      if (!point) return;
      click(point);
    }
    const lines = layout.lines.map((text, candidate) => (candidate === line ? text.slice(remove) : text));
    planRef.current = { chunkId: chunk.id, text: lines.join("\n"), caret: exactCaret(chunk.id, lineStart), changesLeft: remove };
    simulate(repeatKey("delete", remove));
    // pierre keeps the caret where it was in the line's text.
    const target = Math.max(lineStart, caret.lo - remove);
    if (target === lineStart) return;
    const { wrap, codeWidth: width, ch: charWidth } = geometry.current;
    const point = clickPoint(chunk.id, target, layoutChunk(lines, wrap ? (candidate) => gpuiWrapBoundaries(candidate, width, charWidth) : () => []));
    if (point) {
      click(point);
      planRef.current = { ...planRef.current, caret: exactCaret(chunk.id, target) };
    }
  };

  // ── Presses on a chunk ──
  const offsetAtPoint = (index: number, x: number, y: number): number | null => {
    const chunk = docRef.current.chunks[index];
    const id = chunk ? textareaIds.current.get(chunk.id) : undefined;
    const bounds = id === undefined ? null : renderer.getElementBounds?.(id);
    if (!bounds) return null;
    const layout = layoutOf(index);
    const row = Math.max(0, Math.min(layout.rows.length - 1, Math.floor((y - bounds.y) / CODE_LINE_HEIGHT)));
    return offsetAtColumn(layout, row, (x - bounds.x) / geometry.current.ch);
  };
  /** A press that was never released over its chunk (a drag that ended outside it) leaves the caret unknown. */
  const settlePress = () => {
    const press = pressRef.current;
    if (!press || press.resolved) return;
    pressRef.current = null;
    const index = chunkIndexOf(press.chunkId);
    if (index >= 0) caretRef.current = unknownCaret(press.chunkId, layoutOf(index).text.length);
  };
  /** Drops the selection a chunk keeps after focus moved to another chunk. */
  const collapseIn = (chunkId: number, returnTo: number) => {
    if (!focusChunk(chunkId)) return;
    simulate("left");
    focusChunk(returnTo);
  };
  const press = (index: number, phase: "down" | "up", event: EventPayload) => {
    const chunk = docRef.current.chunks[index];
    if (!chunk || (event.button ?? 0) !== 0) return;
    const offset = offsetAtPoint(index, Number(event.x ?? 0), Number(event.y ?? 0));
    const layout = layoutOf(index);
    if (phase === "down") {
      pressBaseline.current = changeSerial.current;
      const previous = caretRef.current;
      if (previous && previous.chunkId !== chunk.id && previous.anchor !== null) collapseIn(previous.chunkId, chunk.id);
      const clickCount = Number(event.clickCount ?? 1);
      const shift = event.modifiers?.shift === true;
      pressRef.current = { chunkId: chunk.id, offset, clickCount, shift, resolved: false };
      if (offset === null) caretRef.current = unknownCaret(chunk.id, layout.text.length);
      else if (clickCount >= 3) caretRef.current = { ...exactCaret(chunk.id, layout.text.length), anchor: 0 };
      else if (clickCount === 2) {
        // A double press selects the word: somewhere on the pressed line.
        const line = lineAt(layout, offset);
        const lineStart = layout.lineStarts[line]!;
        caretRef.current = { chunkId: chunk.id, lo: lineStart, hi: lineStart + layout.lines[line]!.length, guess: offset, anchor: "maybe" };
      } else if (shift) {
        const anchor = previous && previous.chunkId === chunk.id ? (previous.anchor ?? (isExact(previous) ? previous.lo : "maybe")) : "maybe";
        caretRef.current = { chunkId: chunk.id, lo: offset, hi: offset, guess: offset, anchor: anchor === offset ? null : anchor };
      } else caretRef.current = exactCaret(chunk.id, offset);
      return;
    }
    const down = pressRef.current;
    if (!down || down.chunkId !== chunk.id) return;
    down.resolved = true;
    if (down.clickCount !== 1 || offset === null || down.offset === null || offset === down.offset) return;
    // A drag: the caret is where it ended, the selection's other end where it began.
    const anchor = down.shift ? (caretRef.current?.anchor ?? down.offset) : down.offset;
    caretRef.current = { chunkId: chunk.id, lo: offset, hi: offset, guess: offset, anchor: anchor === offset ? null : anchor };
  };

  // ── Keys ──
  const keyDown = (index: number, event: KeyEvent) => {
    if (event.key === "space" && simulatedKeyDowns.current > 0) {
      simulatedKeyDowns.current -= 1;
      return;
    }
    settlePress();
    pressBaseline.current = changeSerial.current;
    const modifiers = event.modifiers;
    const shortcut = IS_MAC ? modifiers?.cmd === true : modifiers?.ctrl === true;
    // Ctrl/Cmd+Enter belongs to the composer, not to a file.
    if (event.key === "enter") event.stopPropagation();
    if (event.key === "escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current(true);
      return;
    }
    if (event.key === "tab" && !modifiers?.ctrl && !modifiers?.alt && !modifiers?.cmd) {
      // Tab indents instead of moving focus, like pierre's editor.
      event.preventDefault();
      event.stopPropagation();
      indent(index, modifiers?.shift === true);
      return;
    }
    if ((event.key === "home" || event.key === "end") && shortcut && !modifiers?.shift) {
      event.preventDefault();
      event.stopPropagation();
      toDocumentEdge(event.key === "end");
    }
  };
  const keyUp = (index: number, event: KeyEvent) => {
    const chunk = docRef.current.chunks[index];
    if (!chunk) return;
    settlePress();
    const key = event.key ?? "";
    const modifiers = event.modifiers;
    const modified = modifiers?.ctrl === true || modifiers?.alt === true || modifiers?.cmd === true;
    if ((key === "backspace" || key === "delete") && !modified && !modifiers?.shift) {
      const unchanged = changeSerial.current === pressBaseline.current;
      pressBaseline.current = changeSerial.current;
      // Nothing changed: the caret was at the chunk's first (last) character with no selection.
      if (unchanged) join(index, key === "backspace");
      return;
    }
    const layout = layoutOf(index);
    const known = caretRef.current;
    const base = known && known.chunkId === chunk.id ? known : unknownCaret(chunk.id, layout.text.length);
    const { caret, action } = caretAfterRelease(
      base,
      {
        key,
        shift: modifiers?.shift === true,
        word: IS_MAC ? modifiers?.alt === true : modifiers?.ctrl === true,
        shortcut: IS_MAC ? modifiers?.cmd === true : modifiers?.ctrl === true,
        modified,
      },
      layout,
    );
    caretRef.current = caret;
    if (MOVE_KEYS.has(key)) pressBaseline.current = changeSerial.current;
    if (action) cross(index, action);
    else if (MOVE_KEYS.has(key)) scheduleFollow();
  };

  const chunkApiRef = useRef<ChunkApi>(null as never);
  chunkApiRef.current = {
    change: editChunk,
    keyDown,
    keyUp,
    press,
    register: (chunkId, id) => {
      if (id === null) textareaIds.current.delete(chunkId);
      else textareaIds.current.set(chunkId, id);
    },
  };
  const chunkApi = useMemo<ChunkApi>(
    () => ({
      change: (index, value) => chunkApiRef.current.change(index, value),
      keyDown: (index, event) => chunkApiRef.current.keyDown(index, event),
      keyUp: (index, event) => chunkApiRef.current.keyUp(index, event),
      press: (index, phase, event) => chunkApiRef.current.press(index, phase, event),
      register: (chunkId, id) => chunkApiRef.current.register(chunkId, id),
    }),
    [],
  );

  // web installFileEditorDismissal: Escape in the editor, or a press outside it, drops the
  // line selection and the editor's own selection and focus, unless a comment form is open.
  const dismissRef = useRef<(refocus: boolean) => void>(() => {});
  dismissRef.current = (refocus) => {
    if (hasOpenCommentForm) return;
    setSelection(null);
    settlePress();
    const caret = caretRef.current;
    caretRef.current = null;
    const own = new Set(textareaIds.current.values());
    const focused = renderer.getFocusedElementId?.() ?? null;
    const caretTextarea = caret ? textareaIds.current.get(caret.chunkId) : undefined;
    // A textarea paints its selection whether or not it has focus (input.rs prepaint), so
    // a selection has to be collapsed, which takes a key sent to the focused textarea.
    if (caret && caret.anchor !== null && caretTextarea !== undefined) {
      if (focused === caretTextarea) simulate("left");
      else if (focused === null || own.has(focused)) {
        if (focusChunk(caret.chunkId)) simulate("left");
      } else {
        // Focus went to another control: keys can't reach the textarea, so remount it.
        setGenerations((current) => new Map(current).set(caret.chunkId, (current.get(caret.chunkId) ?? 0) + 1));
      }
    }
    if (refocus && rootRef.current) renderer.focusElement?.(rootRef.current.id);
    else {
      const now = renderer.getFocusedElementId?.() ?? null;
      if (now !== null && own.has(now)) renderer.blur?.();
    }
  };
  const dismiss = useCallback((refocus: boolean) => dismissRef.current(refocus), []);

  return (
    <div
      ref={rootRef as never}
      tabIndex={-1}
      {...(props.testId ? { testId: props.testId } : {})}
      onMouseDownOutside={() => dismiss(false)}
      onLayout={(event) => {
        const width = Math.floor(Number(event.width ?? 0));
        const height = Math.floor(Number(event.height ?? 0));
        if (width > 0 && (width !== size.width || height !== size.height)) setSize({ width, height });
      }}
      onMouseUp={() => {
        pointerUp();
        settlePress();
      }}
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
                  onLayout={(event) => {
                    annotationHeights.current.set(item.key, Number(event.height ?? 0));
                  }}
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
                chunkId={item.chunk.id}
                generation={generations.get(item.chunk.id) ?? 0}
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
                api={chunkApi}
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

/** What a chunk's textarea reports to the editor; one stable object, so chunks stay memoized. */
interface ChunkApi {
  change(index: number, value: string): void;
  keyDown(index: number, event: KeyEvent): void;
  keyUp(index: number, event: KeyEvent): void;
  press(index: number, phase: "down" | "up", event: EventPayload): void;
  register(chunkId: number, elementId: number | null): void;
}

const ChunkView = memo(function ChunkView(props: {
  index: number;
  chunkId: number;
  /** Bumped to remount the textarea. */
  generation: number;
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
  api: ChunkApi;
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
      <div
        // The textarea reports no caret; where presses land is part of how the editor tracks it.
        onMouseDown={(event: EventPayload) => props.api.press(props.index, "down", event)}
        onMouseUp={(event: EventPayload) => props.api.press(props.index, "up", event)}
        style={{ position: "absolute", top: 0, bottom: 0, left: textLeft, width: props.codeWidth, overflow: "hidden" }}
      >
        <textarea
          key={props.generation}
          ref={(instance: { id: number } | null) => props.api.register(props.chunkId, instance?.id ?? null)}
          testId={`file-editor-chunk-${props.index}`}
          value={value}
          // The box, not the row count, sizes it (an explicit height wins over the rows).
          minRows={1}
          maxRows={100_000}
          onChange={(event: EventPayload) => props.api.change(props.index, String(event.value ?? ""))}
          onKeyDown={(event: KeyEvent) => props.api.keyDown(props.index, event)}
          onKeyUp={(event: KeyEvent) => props.api.keyUp(props.index, event)}
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

