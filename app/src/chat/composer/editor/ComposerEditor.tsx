// The composer's prompt editor: web's ComposerPromptEditorTiptap (apps/web/src/components/
// ComposerPromptEditorTiptap.tsx) rebuilt for gpuix.
//
// Why not a <textarea>: gpuix's textarea holds plain text only, and its caret and selection
// are not readable or settable from JavaScript; its own actions take Enter, arrows, Backspace
// and the clipboard keys before onKeyDown. A chip has to be one caret step, deleted whole,
// selected whole, painted as a box, and the caret has to land after a chip the menu inserts;
// none of that can be built on top of it. So this editor owns everything: the document
// (editor/doc.ts), the caret and selection, the line layout (editor/layout.ts, GPUI's own
// glyph widths), painting, keys, mouse, undo and the clipboard. It is a focusable <div>,
// which receives every key.
//
// What gpuix still lacks for full parity: an input method (IME) for non-textarea elements,
// so composition input (Chinese, Japanese, Korean) does not reach this editor; and a JS
// clipboard API: paste goes through a hidden textarea's native paste (pasteSink), copy
// through the OS clipboard tool (lib/clipboard.ts).
import { isTerminal, useGpuixRequired, type EventPayload, type KeyEvent } from "@gpuix/react";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { isProviderSkillUserInvocable } from "@t3tools/client-runtime/providerSkills";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { copyToClipboard } from "../../../lib/clipboard.ts";
import { readClipboardText } from "../../../terminal/clipboard.ts";
import { useTextMetricsEpoch } from "../../markdown/measure.ts";
import { TextMeasureHost } from "../../markdown/TextMeasureHost.tsx";
import { FONTS, alpha, useTheme } from "../../../ui/theme.ts";
import {
  collectComposerPromptInlineTokens,
  selectionTouchesMentionBoundary,
} from "../../../web/composer-editor-mentions.ts";
import { pastedPathQueryLength } from "../../../web/composer-logic.ts";
import {
  convertCodeFenceOnEnter,
  deleteBackward,
  deleteForward,
  deleteSelection,
  exitCodeBlockOnClosingFence,
  exitCodeBlockOnTrailingBlankLines,
  indentCodeBlock,
  newlineInCodeBlock,
  selectionInOneCodeBlock,
  stepBackward,
  stepForward,
  wordBackward,
  wordForward,
  wordRangeAt,
} from "./commands.ts";
import {
  ATOM_CHAR,
  type Atom,
  type Block,
  type CodeBlock,
  type Doc,
  type EditResult,
  type Pos,
  type Selection,
  type SkillMeta,
  atomAt,
  blockPlainText,
  blockSpans,
  caret,
  clampPos,
  comparePos,
  docEnd,
  insertBlocks,
  insertInline,
  isCollapsed,
  markdownToPos,
  orderedRange,
  paragraphSource,
  parseDoc,
  parseInline,
  posToMarkdown,
  replaceBlock,
  sanitizeText,
  serializeDoc,
  serializeRange,
  splitParagraph,
} from "./doc.ts";
import { type ChangeKind, EditorHistory } from "./history.ts";
import {
  type BlockLayout,
  type DocLayout,
  type EditorMetrics,
  type VisualLine,
  caretRect,
  layoutDoc,
  lineBoundary,
  posAtPoint,
  selectionRects,
  textAdvance,
  verticalTarget,
} from "./layout.ts";
import {
  ComposerChipActionsContext,
  type ComposerChipActions,
  type ComposerChipEnvironment,
  ComposerChipEnvironmentContext,
  ComposerInlineChip,
  NATIVE_SELECTION,
} from "./ComposerInlineChip.tsx";
import {
  type ComposerCodeBlockActions,
  ComposerCodeBlockActionsContext,
  ComposerCodeBlockFrame,
  type ColorRun,
  useCodeBlockColors,
} from "./ComposerCodeBlock.tsx";
import { withInfoStringLanguage } from "../../../web/composer-code-languages.ts";

const IS_MAC = process.platform === "darwin";

/** web SURROUND_CLOSE: typing one of these over a text selection wraps it. */
const SURROUND_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "'": "'",
  '"': '"',
  "“": "”",
  "`": "`",
  "<": ">",
  "«": "»",
  "*": "*",
  _: "_",
};

export interface ComposerEditorSnapshot {
  readonly value: string;
  /** Markdown offset of the selection start (web expandedCursor). */
  readonly cursor: number;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

export interface ComposerEditorHandle {
  focus(): void;
  focusAt(cursor: number): void;
  focusAtEnd(): void;
  readSnapshot(): ComposerEditorSnapshot;
  /**
   * Inserts Markdown at the caret (or the end), turning its tokens into chips, with a space
   * before it when it would otherwise run into the text (web insertComposerText).
   */
  insertText(text: string, where: "caret" | "end", options?: { readonly ensureLeadingBoundary?: boolean }): void;
  /**
   * Type-to-focus: text typed with nothing focused goes on the end as typing (no chip
   * parsing), applied to the editor's own state at once so the keys that follow, which may
   * reach the editor before React re-renders it, land after it in order.
   */
  appendTyped(text: string): void;
  /** True when GPUI delivered this keystroke to the editor itself. */
  receivedKeystroke(keystrokeId: number): boolean;
  /**
   * Handles a key as if the editor had received it: a key dispatched while focus was still
   * on its way here (a burst after type-to-focus) arrives only at the window.
   */
  handleKey(event: KeyEvent): void;
  /**
   * web isCaretOnVisualEdge: the caret is collapsed on the first (start) or last (end)
   * visual line, with no newline between it and that edge. Prompt history only takes
   * ArrowUp/ArrowDown there, so the arrows still move between lines of a long prompt.
   */
  isCaretOnVisualEdge(edge: "start" | "end"): boolean;
  /** Element id of the focusable editor, for renderer.focusElement. */
  readonly id: number | null;
}

export interface ComposerEditorKeyContext {
  readonly inCodeBlock: boolean;
  readonly snapshot: () => ComposerEditorSnapshot;
}

export interface ComposerEditorProps {
  readonly value: string;
  /** Where the caret goes when `value` arrives from outside (a Markdown offset). */
  readonly cursor: number;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  /** web composerRichTextEnabled: fenced code becomes a code block. */
  readonly codeBlocks: boolean;
  /** web literalText: a pending question's custom answer keeps every character as text. */
  readonly literal: boolean;
  readonly readOnly: boolean;
  readonly placeholder: string;
  /** The resting composer: one line, no wrapping. */
  readonly resting: boolean;
  readonly minRows: number;
  readonly maxRows: number;
  readonly testId?: string;
  /** web onChange(value, cursor, expandedCursor, cursorAdjacentToMention). */
  readonly onChange: (value: string, cursor: number, suppressTrigger: boolean) => void;
  /** Composer-level keys (menus, send, mode); true when it handled the key. */
  readonly onKeyCommand: (event: KeyEvent, context: ComposerEditorKeyContext) => boolean;
  /** web isPathQueryActive: a paste continuing an @path query stays text. */
  readonly isPathQueryActive?: () => boolean;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  readonly chipEnvironment: ComposerChipEnvironment;
  /** "Cite" just inserted this citation source: its chip opens the comment editor. */
  readonly citationCommentRequest?: { readonly source: string; readonly nonce: number } | null;
}

const METRICS: EditorMetrics = {
  fontSize: 14,
  lineHeight: 23,
  codeFontSize: 13,
  codeLineHeight: 17.875,
  codeHeader: 30,
  codePadX: 12,
  codePadTop: 4,
  codePadBottom: 8,
  codeMarginY: 10.4,
};

const RESTING_LINE_HEIGHT = 32;

interface EditorState {
  readonly doc: Doc;
  readonly selection: Selection;
}

function skillMetaFor(skills: ReadonlyArray<ServerProviderSkill>): (name: string) => SkillMeta | null {
  return (name) => {
    const skill = skills.find((candidate) => candidate.name === name && isProviderSkillUserInvocable(candidate));
    if (!skill) return null;
    const shortDescription = skill.shortDescription?.trim();
    return { label: formatProviderSkillDisplayName(skill), description: shortDescription || skill.description?.trim() || null };
  };
}

function renderer(): { simulateKeystrokes?: (keys: string) => void } | null {
  const slot = Reflect.get(globalThis, "__gpuixRenderHost") as { renderer?: { simulateKeystrokes?: (keys: string) => void } } | undefined;
  return slot?.renderer ?? null;
}

/**
 * The text a key event types, or null. It can be more than one code point: in terminal
 * mode kitty sends an IME's committed text (a CJK word) or an emoji with modifiers as one
 * key's associated text, and gpuix reports it as keyChar.
 */
export function typedText(keyChar: string | undefined): string | null {
  if (!keyChar || /\p{Cc}/u.test(keyChar)) return null;
  return keyChar;
}

/** The last copy, pasted from memory while the OS clipboard tool is still taking it. */
let lastCopy: { text: string; at: number } | null = null;
/** The editor's last measured width, for the first frame of the next mount. */
let lastKnownWidth = 0;

export const ComposerEditor = memo(
  forwardRef<ComposerEditorHandle, ComposerEditorProps>(function ComposerEditor(props, ref) {
    const theme = useTheme();
    const gpuix = useGpuixRequired();
    const epoch = useTextMetricsEpoch();
    const skillMeta = useMemo(() => skillMetaFor(props.skills), [props.skills]);
    const skillMetaRef = useRef(skillMeta);
    skillMetaRef.current = skillMeta;
    const propsRef = useRef(props);
    propsRef.current = props;
    // isTerminal() is read during render (gpuix); handlers read it from here.
    const terminalRef = useRef(false);
    terminalRef.current = isTerminal();

    const parseOptions = () => ({
      skillMeta: skillMetaRef.current,
      codeBlocks: propsRef.current.codeBlocks,
      literal: propsRef.current.literal,
    });

    // ── State: the document lives in a ref so keys handled before a re-render see it ──
    const stateRef = useRef<EditorState | null>(null);
    const historyRef = useRef(new EditorHistory());
    const pendingValuesRef = useRef<string[]>([]);
    const lastEmittedRef = useRef<{ value: string; cursor: number } | null>(null);
    const modeKeyRef = useRef("");
    const skillsKeyRef = useRef<ReadonlyArray<ServerProviderSkill> | null>(null);
    const lastCursorPropRef = useRef(props.cursor);
    const goalXRef = useRef<number | null>(null);
    const [, setVersion] = useState(0);
    const bump = () => setVersion((value) => value + 1);
    const [focused, setFocused] = useState(false);
    const [blinkEpoch, setBlinkEpoch] = useState(0);

    const modeKey = `${props.codeBlocks ? "code" : "plain"}:${props.literal ? "literal" : "rich"}`;
    // Sync from props during render: a value from outside (menu insert, send clearing it,
    // a restored draft) rebuilds the document, the way web's controlled update calls setContent.
    {
      const current = stateRef.current;
      const pending = pendingValuesRef.current;
      const pendingIndex = pending.lastIndexOf(props.value);
      if (current === null || modeKeyRef.current !== modeKey) {
        const doc = parseDoc(props.value, parseOptions());
        stateRef.current = { doc, selection: caret(markdownToPos(doc, props.cursor)) };
        lastEmittedRef.current = { value: props.value, cursor: props.cursor };
        modeKeyRef.current = modeKey;
        skillsKeyRef.current = props.skills;
        pending.length = 0;
      } else if (pendingIndex >= 0) {
        pending.splice(0, pendingIndex + 1);
      } else if (props.value !== serializeDocCached(current.doc)) {
        const doc = parseDoc(props.value, parseOptions());
        historyRef.current.record(current, "other", { block: 0, offset: 0 });
        historyRef.current.breakGroup();
        stateRef.current = { doc, selection: caret(markdownToPos(doc, props.cursor)) };
        lastEmittedRef.current = { value: props.value, cursor: props.cursor };
        pending.length = 0;
      } else if (props.cursor !== lastCursorPropRef.current && props.cursor !== lastEmittedRef.current?.cursor) {
        stateRef.current = { doc: current.doc, selection: caret(markdownToPos(current.doc, props.cursor)) };
        lastEmittedRef.current = { value: props.value, cursor: props.cursor };
      }
      if (skillsKeyRef.current !== props.skills && stateRef.current) {
        skillsKeyRef.current = props.skills;
        const reconciled = reconcileSkills(stateRef.current.doc, skillMeta);
        if (reconciled !== stateRef.current.doc) stateRef.current = { ...stateRef.current, doc: reconciled };
      }
      lastCursorPropRef.current = props.cursor;
    }
    const state = stateRef.current!;

    // ── Layout ──
    const [width, setWidth] = useState(lastKnownWidth);
    // Before the first layout report, no wrapping beats wrapping at one pixel.
    const layoutWidth = props.resting || width <= 0 ? 100000 : width;
    const layout = useMemo(() => layoutDoc(state.doc, layoutWidth, METRICS, epoch), [state.doc, layoutWidth, epoch]);
    const layoutRef = useRef(layout);
    layoutRef.current = layout;
    const lineHeight = props.resting ? RESTING_LINE_HEIGHT : METRICS.lineHeight;
    const viewportHeight = props.resting
      ? RESTING_LINE_HEIGHT
      : Math.min(Math.max(layout.height, props.minRows * METRICS.lineHeight), props.maxRows * METRICS.lineHeight);
    const [scrollTop, setScrollTop] = useState(0);
    const scrollTopRef = useRef(0);
    scrollTopRef.current = scrollTop;
    const maxScroll = Math.max(0, layout.height - viewportHeight);

    const editorIdRef = useRef<{ id: number } | null>(null);
    const viewportIdRef = useRef<{ id: number } | null>(null);
    const sinkIdRef = useRef<{ id: number } | null>(null);
    const [sinkKey, setSinkKey] = useState(0);

    // ── Emitting ──
    const emit = (next: EditorState) => {
      const value = serializeDocCached(next.doc);
      const [from] = orderedRange(next.selection);
      const spans = blockSpans(next.doc);
      const cursor = posToMarkdown(next.doc, from, spans);
      const previous = lastEmittedRef.current;
      if (previous && previous.value === value && previous.cursor === cursor) return;
      lastEmittedRef.current = { value, cursor };
      if (!previous || previous.value !== value) {
        pendingValuesRef.current.push(value);
        if (pendingValuesRef.current.length > 32) pendingValuesRef.current.shift();
      }
      const block = next.doc.blocks[from.block]!;
      const suppressTrigger =
        propsRef.current.literal ||
        block.kind === "code" ||
        (block.kind === "paragraph" && (block.text[from.offset - 1] === ATOM_CHAR || block.text[from.offset] === ATOM_CHAR));
      propsRef.current.onChange(value, cursor, suppressTrigger);
    };

    const followCaret = (next: EditorState) => {
      if (propsRef.current.resting) return;
      const rect = caretRect(layoutDoc(next.doc, layoutWidth, METRICS, epoch), next.selection.head);
      if (!rect) return;
      const top = scrollTopRef.current;
      const height = viewportHeight;
      let nextTop = top;
      if (rect.lineTop < top) nextTop = rect.lineTop;
      else if (rect.lineTop + rect.lineHeight > top + height) nextTop = rect.lineTop + rect.lineHeight - height;
      if (nextTop !== top) {
        scrollTopRef.current = nextTop;
        setScrollTop(nextTop);
      }
    };

    const apply = (result: EditResult, kind: ChangeKind | null, options?: { keepGoal?: boolean }) => {
      const current = stateRef.current!;
      const next: EditorState = { doc: result.doc, selection: { anchor: clampPos(result.doc, result.selection.anchor), head: clampPos(result.doc, result.selection.head) } };
      if (kind !== null && result.doc !== current.doc) historyRef.current.record(current, kind, next.selection.head);
      else if (kind === null) historyRef.current.breakGroup();
      stateRef.current = next;
      if (!options?.keepGoal) goalXRef.current = null;
      setBlinkEpoch((value) => value + 1);
      followCaret(next);
      emit(next);
      bump();
    };

    const select = (selection: Selection, options?: { keepGoal?: boolean }) => apply({ doc: stateRef.current!.doc, selection }, null, options);

    const snapshot = (): ComposerEditorSnapshot => {
      const current = stateRef.current!;
      const spans = blockSpans(current.doc);
      const [from, to] = orderedRange(current.selection);
      const start = posToMarkdown(current.doc, from, spans);
      return { value: serializeDocCached(current.doc), cursor: start, selectionStart: start, selectionEnd: posToMarkdown(current.doc, to, spans) };
    };

    // renderer.focusElement moves focus without an onFocus, so focus is tracked here too.
    const focusedRef = useRef(false);
    const markFocused = (next: boolean) => {
      if (focusedRef.current === next) return;
      focusedRef.current = next;
      setFocused(next);
      if (next) propsRef.current.onFocus?.();
      else propsRef.current.onBlur?.();
    };
    const focusEditor = () => {
      if (editorIdRef.current) gpuix.focusElement?.(editorIdRef.current.id);
      markFocused(true);
    };
    /** The paste round trip through the sink textarea blurs the editor for a moment. */
    const pastingRef = useRef(false);

    // ── Inserting Markdown (paste, external inserts) ──
    const insertMarkdown = (text: string, options: { literalLength?: number; kind: ChangeKind; at?: Selection }) => {
      const current = stateRef.current!;
      const removed = deleteSelection(current.doc, options.at ?? current.selection);
      const fragment = parseDoc(text, { ...parseOptions(), literalLength: options.literalLength ?? 0 });
      apply(insertBlocks(removed.doc, removed.selection.head, fragment.blocks), options.kind);
    };

    /** web handlePaste. */
    const pasteText = (raw: string) => {
      const current = stateRef.current!;
      const pasted = raw.replace(/\r\n?/g, "\n");
      if (pasted.length === 0) return;
      const headBlock = current.doc.blocks[current.selection.head.block]!;
      if (selectionInOneCodeBlock(current.doc, current.selection) || headBlock.kind === "code") {
        const removed = deleteSelection(current.doc, current.selection);
        apply(insertInline(removed.doc, removed.selection.head, sanitizeText(pasted)), "other");
        return;
      }
      let text = pasted;
      if (!propsRef.current.literal) {
        const tokens = collectComposerPromptInlineTokens(`${text}\n`);
        const isChip = (token: (typeof tokens)[number] | undefined) =>
          token?.type === "mention" || (token?.type === "skill" && skillMetaRef.current(token.value) !== null);
        const lastToken = tokens.at(-1);
        if (isChip(lastToken) && lastToken?.end === text.length) text += " ";
        if (isChip(tokens[0]) && tokens[0]?.start === 0) {
          const [from] = orderedRange(current.selection);
          const offsetMd = posToMarkdown(current.doc, from);
          const value = serializeDocCached(current.doc);
          if (offsetMd > 0 && !/\s/.test(value[offsetMd - 1]!)) text = ` ${text}`;
        }
      }
      const [from] = orderedRange(current.selection);
      const block = current.doc.blocks[from.block]!;
      const lineBefore = block.kind === "paragraph" ? paragraphSourceUpTo(block, from.offset) : "";
      const literalLength = propsRef.current.literal ? 0 : pastedPathQueryLength(lineBefore, text, propsRef.current.isPathQueryActive?.());
      if (propsRef.current.literal) {
        const removed = deleteSelection(current.doc, current.selection);
        apply(insertInline(removed.doc, removed.selection.head, sanitizeText(text)), "other");
        return;
      }
      insertMarkdown(text, { literalLength, kind: "other" });
    };

    // ── Clipboard ──
    const pendingPasteRef = useRef(false);
    const paste = () => {
      if (propsRef.current.readOnly) return;
      // A copy still on its way to the OS clipboard (the tool takes a moment) pastes from memory.
      if (lastCopy && Date.now() - lastCopy.at < 1500) {
        pasteText(lastCopy.text);
        return;
      }
      // In a terminal GPUI's clipboard is the terminal's, and it only holds what this app
      // copied: the sink textarea would paste nothing, and the focus hop leaves the
      // editor deaf to the keys that follow. Read the system clipboard with the OS tool.
      if (terminalRef.current) {
        void readClipboardText().then(
          (text) => {
            if (text.length > 0) pasteText(text);
          },
          () => {},
        );
        return;
      }
      const host = renderer();
      if (!sinkIdRef.current || !host?.simulateKeystrokes) return;
      pendingPasteRef.current = true;
      pastingRef.current = true;
      gpuix.focusElement?.(sinkIdRef.current.id);
      host.simulateKeystrokes(IS_MAC ? "cmd-v" : "ctrl-v");
      focusEditor();
      // The blur from the hop arrives as an event after this returns.
      setTimeout(() => {
        pastingRef.current = false;
      }, 100);
    };

    const copySelection = (cut: boolean): boolean => {
      const current = stateRef.current!;
      if (isCollapsed(current.selection)) return false;
      const [from, to] = orderedRange(current.selection);
      const text = serializeRange(current.doc, from, to);
      lastCopy = { text, at: Date.now() };
      void copyToClipboard(text);
      if (cut && !propsRef.current.readOnly) apply(deleteSelection(current.doc, current.selection), "other");
      return true;
    };

    // ── Typing ──
    const typeText = (char: string) => {
      const current = stateRef.current!;
      const { selection, doc } = current;
      const closer = SURROUND_CLOSE[char];
      if (closer && !propsRef.current.literal && !isCollapsed(selection) && selection.anchor.block === selection.head.block) {
        const [from, to] = orderedRange(selection);
        const block = doc.blocks[from.block]!;
        const slice = block.text.slice(from.offset, to.offset);
        const spans = blockSpans(doc);
        const startMd = posToMarkdown(doc, from, spans);
        const endMd = posToMarkdown(doc, to, spans);
        if (block.kind === "paragraph" && !slice.includes(ATOM_CHAR) && !selectionTouchesMentionBoundary(serializeDocCached(doc), startMd, endMd)) {
          const withClose = insertInline(doc, to, closer);
          const withOpen = insertInline(withClose.doc, from, char);
          apply(
            {
              doc: withOpen.doc,
              selection: { anchor: { block: from.block, offset: from.offset + 1 }, head: { block: from.block, offset: to.offset + 1 } },
            },
            "other",
          );
          return;
        }
      }
      const removed = isCollapsed(selection) ? current : deleteSelection(doc, selection);
      apply(insertInline(removed.doc, removed.selection.head, sanitizeText(char)), isCollapsed(selection) ? "insert" : "other");
    };

    // ── Keys ──
    // Chip popovers (a citation comment, a language search) live inside this element's
    // tree, so their keys and presses bubble here; only the editor's own are handled.
    // Every ancestor on the focus path reports the key with its own id, so ask who has focus.
    const fromEditor = (_event: EventPayload) => {
      const focusedId = gpuix.getFocusedElementId?.();
      return focusedId === undefined || focusedId === null || focusedId === editorIdRef.current?.id;
    };
    // Keystrokes this element received from GPUI, so the window handler can tell which keys
    // of a burst were dispatched before focus landed here (they never reached this element).
    const receivedKeystrokesRef = useRef<number[]>([]);
    const onKeyDown = (event: KeyEvent) => {
      if (!fromEditor(event)) return;
      if (event.keystrokeId !== undefined) {
        receivedKeystrokesRef.current.push(event.keystrokeId);
        if (receivedKeystrokesRef.current.length > 64) receivedKeystrokesRef.current.shift();
      }
      handleKey(event);
    };
    const handleKey = (event: KeyEvent) => {
      markFocused(true);
      const p = propsRef.current;
      const key = event.key ?? "";
      const mods = event.modifiers ?? { shift: false, ctrl: false, alt: false, cmd: false };
      const primary = IS_MAC ? mods.cmd : mods.ctrl;
      const wordMod = IS_MAC ? mods.alt : mods.ctrl;
      const current = stateRef.current!;
      const { doc, selection } = current;
      const inCode = selectionInOneCodeBlock(doc, selection);
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      // Code blocks take Enter and Tab before the composer does (web handleKeyDown order).
      if (!p.readOnly && key === "enter" && !primary && !(IS_MAC ? mods.ctrl : mods.cmd)) {
        if (inCode) {
          handled();
          const result =
            exitCodeBlockOnClosingFence(doc, selection) ?? exitCodeBlockOnTrailingBlankLines(doc, selection) ?? newlineInCodeBlock(doc, selection);
          apply(result, "other");
          return;
        }
        if (p.codeBlocks && !p.literal && !mods.shift && !mods.alt) {
          const converted = convertCodeFenceOnEnter(doc, selection);
          if (converted) {
            handled();
            apply(converted, "other");
            return;
          }
        }
      }
      if (!p.readOnly && key === "tab" && !primary && inCode) {
        handled();
        apply(indentCodeBlock(doc, selection, mods.shift ? "out" : "in"), "other");
        return;
      }

      if (p.onKeyCommand(event, { inCodeBlock: inCode, snapshot })) {
        handled();
        return;
      }

      const extend = mods.shift;
      const moveTo = (target: Pos | null, keepGoal = false) => {
        if (!target) return;
        select(extend ? { anchor: selection.anchor, head: target } : caret(target), { keepGoal });
      };
      const [from, to] = orderedRange(selection);
      const collapsed = isCollapsed(selection);

      switch (key) {
        case "left": {
          handled();
          if (IS_MAC && mods.cmd) return moveTo(lineBoundary(layoutRef.current, selection.head, false));
          if (!extend && !collapsed && !wordMod) return select(caret(from));
          return moveTo(wordMod ? wordBackward(doc, selection.head) : stepBackward(doc, selection.head));
        }
        case "right": {
          handled();
          if (IS_MAC && mods.cmd) return moveTo(lineBoundary(layoutRef.current, selection.head, true));
          if (!extend && !collapsed && !wordMod) return select(caret(to));
          return moveTo(wordMod ? wordForward(doc, selection.head) : stepForward(doc, selection.head));
        }
        case "up":
        case "down": {
          handled();
          const direction = key === "up" ? -1 : 1;
          if (IS_MAC && mods.cmd) return moveTo(direction < 0 ? { block: 0, offset: 0 } : docEnd(doc));
          const head = !extend && !collapsed ? (direction < 0 ? from : to) : selection.head;
          const rect = caretRect(layoutRef.current, head);
          const goal = goalXRef.current ?? rect?.x ?? 0;
          goalXRef.current = goal;
          const target = verticalTarget(layoutRef.current, head, goal, direction);
          // Past the first or last line the caret goes to the document's edge, as in a browser.
          return moveTo(target ?? (direction < 0 ? { block: 0, offset: 0 } : docEnd(doc)), true);
        }
        case "home":
          handled();
          return moveTo(mods.ctrl && !IS_MAC ? { block: 0, offset: 0 } : lineBoundary(layoutRef.current, selection.head, false));
        case "end":
          handled();
          return moveTo(mods.ctrl && !IS_MAC ? docEnd(doc) : lineBoundary(layoutRef.current, selection.head, true));
        case "backspace": {
          handled();
          if (p.readOnly) return;
          const result = deleteBackward(doc, selection, IS_MAC && mods.cmd ? "line" : wordMod ? "word" : "char");
          if (result) apply(result, collapsed ? "delete" : "other");
          return;
        }
        case "delete": {
          handled();
          if (p.readOnly) return;
          const result = deleteForward(doc, selection, wordMod ? "word" : "char");
          if (result) apply(result, collapsed ? "delete" : "other");
          return;
        }
        case "enter": {
          handled();
          if (p.readOnly) return;
          const removed = collapsed ? current : deleteSelection(doc, selection);
          apply(splitParagraph(removed.doc, removed.selection.head), "other");
          return;
        }
      }

      if (primary && !mods.alt) {
        switch (key) {
          case "a":
            handled();
            return select({ anchor: { block: 0, offset: 0 }, head: docEnd(doc) });
          case "z": {
            handled();
            if (p.readOnly) return;
            const restored = mods.shift ? historyRef.current.redo(current) : historyRef.current.undo(current);
            if (restored) applyRestored(restored);
            return;
          }
          case "y": {
            if (IS_MAC) break;
            handled();
            if (p.readOnly) return;
            const restored = historyRef.current.redo(current);
            if (restored) applyRestored(restored);
            return;
          }
          case "c":
            if (copySelection(false)) handled();
            return;
          case "x":
            if (copySelection(true)) handled();
            return;
          case "v":
            handled();
            paste();
            return;
        }
        return;
      }

      // Text: a produced character, without Ctrl/Cmd unless AltGr (Ctrl+Alt on Windows) made it.
      const char = typedText(event.keyChar);
      const altGr = !IS_MAC && mods.ctrl && mods.alt;
      if (char !== null && !mods.cmd && (!mods.ctrl || altGr)) {
        handled();
        if (p.readOnly) return;
        typeText(char);
      }
    };

    const applyRestored = (restored: EditorState) => {
      stateRef.current = restored;
      goalXRef.current = null;
      setBlinkEpoch((value) => value + 1);
      followCaret(restored);
      emit(restored);
      bump();
    };

    // ── Mouse ──
    const dragRef = useRef<{ anchor: Pos; unit: "char" | "word" | "block"; origin: [Pos, Pos] } | null>(null);
    const pointToPos = (event: EventPayload): Pos | null => {
      const id = viewportIdRef.current?.id;
      if (id === undefined) return null;
      const bounds = gpuix.getElementBounds?.(id);
      if (!bounds) return null;
      const x = Number(event.x ?? 0) - bounds.x;
      const y = Number(event.y ?? 0) - bounds.y + scrollTopRef.current;
      return posAtPoint(layoutRef.current, x, y);
    };
    const onMouseDown = (event: EventPayload) => {
      if ((event.button ?? 0) !== 0) return;
      focusEditor();
      const pos = pointToPos(event);
      if (!pos) return;
      const current = stateRef.current!;
      const count = event.clickCount ?? 1;
      if (count >= 3) {
        const block = current.doc.blocks[pos.block]!;
        const range: [Pos, Pos] = [
          { block: pos.block, offset: 0 },
          { block: pos.block, offset: block.text.length },
        ];
        dragRef.current = { anchor: range[0], unit: "block", origin: range };
        select({ anchor: range[0], head: range[1] });
        return;
      }
      if (count === 2) {
        const range = wordRangeAt(current.doc, pos);
        dragRef.current = { anchor: range[0], unit: "word", origin: range };
        select({ anchor: range[0], head: range[1] });
        return;
      }
      const anchor = event.modifiers?.shift ? current.selection.anchor : pos;
      dragRef.current = { anchor, unit: "char", origin: [pos, pos] };
      select({ anchor, head: pos });
    };
    const onMouseMove = (event: EventPayload) => {
      const drag = dragRef.current;
      if (!drag || event.pressedButton !== 0) return;
      const pos = pointToPos(event);
      if (!pos) return;
      // Dragging past the viewport's edges scrolls it.
      const id = viewportIdRef.current?.id;
      const bounds = id !== undefined ? gpuix.getElementBounds?.(id) : null;
      if (bounds) {
        const y = Number(event.y ?? 0) - bounds.y;
        const top = scrollTopRef.current;
        if (y < 0 && top > 0) setScrollTop((scrollTopRef.current = Math.max(0, top + y)));
        else if (y > viewportHeight && top < maxScroll) setScrollTop((scrollTopRef.current = Math.min(maxScroll, top + y - viewportHeight)));
      }
      const current = stateRef.current!;
      if (drag.unit === "char") {
        select({ anchor: drag.anchor, head: pos });
        return;
      }
      const range = drag.unit === "word" ? wordRangeAt(current.doc, pos) : ([{ block: pos.block, offset: 0 }, { block: pos.block, offset: current.doc.blocks[pos.block]!.text.length }] as [Pos, Pos]);
      if (comparePos(range[0], drag.origin[0]) < 0) select({ anchor: drag.origin[1], head: range[0] });
      else select({ anchor: drag.origin[0], head: range[1] });
    };
    const onMouseUp = () => {
      dragRef.current = null;
    };

    // ── Chip and code block actions ──
    const [requestedCitationKey, setRequestedCitationKey] = useState<string | null>(null);
    const lastCitationNonceRef = useRef(props.citationCommentRequest?.nonce ?? 0);
    useEffect(() => {
      const request = props.citationCommentRequest;
      if (!request || request.nonce === lastCitationNonceRef.current) return;
      lastCitationNonceRef.current = request.nonce;
      // The newest citation with that source is the one just inserted.
      let key: string | null = null;
      for (const block of stateRef.current!.doc.blocks) {
        if (block.kind !== "paragraph") continue;
        for (const atom of block.atoms) if (atom.kind === "citation" && atom.source === request.source) key = atom.key;
      }
      setRequestedCitationKey(key);
    });
    const chipActions = useMemo<ComposerChipActions>(
      () => ({
        requestedCitationKey,
        clearRequestedCitation: () => setRequestedCitationKey(null),
        readOnly: props.readOnly,
        updateCitation: (key, citation) => {
          const current = stateRef.current!;
          const result = mapAtoms(current.doc, (atom) =>
            atom.kind === "citation" && atom.key === key ? { ...atom, citation, source: serializeCitation(citation) } : atom,
          );
          if (result !== current.doc) apply({ doc: result, selection: current.selection }, "other");
          focusEditor();
        },
        removeCitation: (key) => {
          const current = stateRef.current!;
          for (let blockIndex = 0; blockIndex < current.doc.blocks.length; blockIndex += 1) {
            const block = current.doc.blocks[blockIndex]!;
            if (block.kind !== "paragraph") continue;
            let atomIndex = 0;
            for (let offset = 0; offset < block.text.length; offset += 1) {
              if (block.text[offset] !== ATOM_CHAR) continue;
              const atom = block.atoms[atomIndex++]!;
              if (atom.kind !== "citation" || atom.key !== key) continue;
              apply(deleteSelection(current.doc, { anchor: { block: blockIndex, offset }, head: { block: blockIndex, offset: offset + 1 } }), "other");
              return;
            }
          }
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [props.readOnly, requestedCitationKey],
    );
    const codeActions = useMemo<ComposerCodeBlockActions>(
      () => ({
        readOnly: props.readOnly,
        setLanguage: (blockIndex, language) => {
          const current = stateRef.current!;
          const block = current.doc.blocks[blockIndex];
          if (!block || block.kind !== "code") return;
          const next: CodeBlock = { ...block, info: withInfoStringLanguage(block.info, language) };
          // web changeLanguage: the caret goes to the end of the code.
          apply({ doc: replaceBlock(current.doc, blockIndex, [next]), selection: caret({ block: blockIndex, offset: next.text.length }) }, "other");
          focusEditor();
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [props.readOnly],
    );

    // ── Imperative handle ──
    useImperativeHandle(
      ref,
      () => ({
        get id() {
          return editorIdRef.current?.id ?? null;
        },
        focus: focusEditor,
        focusAt: (cursor: number) => {
          focusEditor();
          const current = stateRef.current!;
          select(caret(markdownToPos(current.doc, cursor)));
        },
        focusAtEnd: () => {
          focusEditor();
          select(caret(docEnd(stateRef.current!.doc)));
        },
        readSnapshot: snapshot,
        receivedKeystroke: (id) => receivedKeystrokesRef.current.includes(id),
        isCaretOnVisualEdge: (edge) => {
          const current = stateRef.current!;
          const value = serializeDocCached(current.doc);
          if (value.length === 0) return true;
          if (!isCollapsed(current.selection)) return false;
          const cursor = posToMarkdown(current.doc, current.selection.head);
          if (edge === "start" ? value.slice(0, cursor).includes("\n") : value.slice(cursor).includes("\n")) return false;
          return verticalTarget(layoutRef.current, current.selection.head, 0, edge === "start" ? -1 : 1) === null;
        },
        handleKey: (event) => handleKey(event),
        appendTyped: (text) => {
          const current = stateRef.current!;
          const end = docEnd(current.doc);
          apply(insertInline(current.doc, end, sanitizeText(text.replace(/\r\n?/g, "\n"))), "insert");
        },
        insertText: (text, where, options) => {
          const current = stateRef.current!;
          const at = where === "end" ? caret(docEnd(current.doc)) : current.selection;
          const [from] = orderedRange(at);
          const value = serializeDocCached(current.doc);
          const md = posToMarkdown(current.doc, from);
          const lead = options?.ensureLeadingBoundary && md > 0 && !/\s/.test(value[md - 1] ?? "") ? " " : "";
          // web inlineContextReferenceReplacement: the inserted trailing space takes the place
          // of one already after the caret, so a reference never leaves a double space.
          const block = current.doc.blocks[from.block]!;
          const swallow = isCollapsed(at) && text.endsWith(" ") && block.kind === "paragraph" && block.text[from.offset] === " ";
          const range = swallow ? { anchor: from, head: { block: from.block, offset: from.offset + 1 } } : at;
          insertMarkdown(`${lead}${text}`, { kind: "other", at: range });
        },
      }),
      // The handle reads refs; one identity is enough.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    // ── Paint ──
    const [from, to] = orderedRange(state.selection);
    const rects = isCollapsed(state.selection) ? [] : selectionRects(layout, from, to);
    const caretBox = focused && isCollapsed(state.selection) && !props.readOnly ? caretRect(layout, state.selection.head) : null;
    const empty = state.doc.blocks.length === 1 && state.doc.blocks[0]!.text.length === 0 && state.doc.blocks[0]!.kind === "paragraph";
    // Chrome's own selection colour (web styles no ::selection in the composer).
    const selectionColor = theme.appearance === "dark" ? NATIVE_SELECTION : "#accef7";
    const offsetY = props.resting ? (RESTING_LINE_HEIGHT - METRICS.lineHeight) / 2 : 0;
    const textStyle = { fontFamily: FONTS.sans, fontSize: METRICS.fontSize, lineHeight: METRICS.lineHeight, color: theme.foreground };

    return (
      <ComposerChipEnvironmentContext value={props.chipEnvironment}>
      <ComposerChipActionsContext value={chipActions}>
      <ComposerCodeBlockActionsContext value={codeActions}>
      <div
        ref={viewportIdRef as never}
        style={{ position: "relative", width: "100%", height: viewportHeight, overflow: "hidden", flexShrink: 0 }}
        onLayout={(event) => {
          const next = Number(event.width ?? 0);
          if (next > 0 && Math.abs(next - width) > 0.5) {
            lastKnownWidth = next;
            setWidth(next);
          }
        }}
        onScroll={(event) => {
          if (props.resting || maxScroll <= 0) return;
          const delta = Number(event.deltaY ?? 0) * (event.precise ? 1 : lineHeight);
          const next = Math.max(0, Math.min(maxScroll, scrollTopRef.current - delta));
          if (next !== scrollTopRef.current) {
            scrollTopRef.current = next;
            setScrollTop(next);
          }
        }}
      >
        <div
          ref={editorIdRef as never}
          testId={props.testId}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => markFocused(true)}
          onBlur={() => {
            if (pastingRef.current) return;
            dragRef.current = null;
            markFocused(false);
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          style={{
            position: "relative",
            width: "100%",
            height: Math.max(viewportHeight, layout.height + offsetY),
            marginTop: -Math.min(scrollTop, maxScroll),
            cursor: props.readOnly ? "default" : "text",
            userSelect: "none",
          }}
        >
          {empty && props.placeholder ? (
            <text
              style={{
                ...textStyle,
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                color: alpha(theme.mutedForeground, 0.75),
                pointerEvents: "none",
                ...(props.resting ? { lineHeight: RESTING_LINE_HEIGHT, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" } : {}),
              }}
            >
              {props.placeholder}
            </text>
          ) : null}
          {rects.map((rect, index) => (
            <div
              key={`sel${index}`}
              style={{
                position: "absolute",
                left: rect.x,
                top: rect.y + offsetY,
                width: rect.width,
                height: rect.height,
                backgroundColor: selectionColor,
                pointerEvents: "none",
              }}
            />
          ))}
          {layout.blocks.map((block, index) => (
            <EditorBlock
              key={index}
              layout={block}
              offsetY={offsetY}
              textStyle={textStyle}
              width={layoutWidth}
              blockIndex={index}
              selectedFrom={from.block < index ? -1 : from.block === index ? from.offset : Number.MAX_SAFE_INTEGER}
              selectedTo={to.block > index ? Number.MAX_SAFE_INTEGER : to.block === index ? to.offset : -1}
            />
          ))}
          {caretBox ? (
            <Caret x={Math.round(caretBox.x)} y={Math.round(caretBox.y + offsetY)} height={caretBox.height} color={theme.foreground} restartKey={blinkEpoch} />
          ) : null}
        </div>
        {/* A draft has no timeline to host text measuring; the newest host does the work. */}
        <TextMeasureHost />
        {/* Paste goes through a textarea's native paste: gpuix has no clipboard read for JS. */}
        <textarea
          key={sinkKey}
          ref={sinkIdRef as never}
          value=""
          style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
          onChange={(event) => {
            const text = event.value ?? "";
            setSinkKey((value) => value + 1);
            if (!pendingPasteRef.current) return;
            pendingPasteRef.current = false;
            if (text.length > 0) pasteText(text);
          }}
        />
      </div>
      </ComposerCodeBlockActionsContext>
      </ComposerChipActionsContext>
      </ComposerChipEnvironmentContext>
    );
  }),
);

// ── Painting a block ─────────────────────────────────────────────────────

/**
 * The caret blinks in its own component so a blink repaints one box, not the editor. Like
 * Chrome it stays on for a moment after each change (restartKey), then blinks.
 */
const Caret = memo(function Caret({ x, y, height, color, restartKey }: { x: number; y: number; height: number; color: string; restartKey: number }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(true);
    let visible = true;
    const id = setInterval(() => {
      visible = !visible;
      setOn(visible);
    }, 530);
    return () => clearInterval(id);
  }, [restartKey]);
  if (!on) return null;
  return <div style={{ position: "absolute", left: x, top: y, width: 1, height, backgroundColor: color, pointerEvents: "none" }} />;
});

const EditorBlock = memo(function EditorBlock({
  layout,
  offsetY,
  textStyle,
  width,
  blockIndex,
  selectedFrom,
  selectedTo,
}: {
  layout: BlockLayout;
  offsetY: number;
  textStyle: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
  width: number;
  blockIndex: number;
  /** The selection's range within this block (offsets; beyond the text when it covers all). */
  selectedFrom: number;
  selectedTo: number;
}) {
  const block = layout.block;
  if (block.kind === "code") {
    return <CodeBlockView layout={layout} offsetY={offsetY} width={width} blockIndex={blockIndex} />;
  }
  return (
    <>
      {layout.lines.map((line, index) => (
        <ParagraphLine
          key={index}
          line={line}
          text={block.text}
          top={layout.y + layout.textY + line.y + offsetY}
          left={layout.textX}
          textStyle={textStyle}
          selectedFrom={selectedFrom}
          selectedTo={selectedTo}
        />
      ))}
    </>
  );
});

const ParagraphLine = memo(function ParagraphLine({
  line,
  text,
  top,
  left,
  textStyle,
  selectedFrom,
  selectedTo,
}: {
  line: VisualLine;
  text: string;
  top: number;
  left: number;
  textStyle: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
  selectedFrom: number;
  selectedTo: number;
}) {
  return (
    <>
      {line.pieces.map((piece) =>
        piece.kind === "text" ? (
          <div
            key={`t${piece.start}`}
            style={{
              ...textStyle,
              position: "absolute",
              left: left + piece.x,
              top,
              height: line.height,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {text.slice(piece.start, piece.end).replaceAll("\t", "    ")}
          </div>
        ) : (
          <div
            key={`a${piece.offset}`}
            style={{
              position: "absolute",
              left: left + piece.x,
              top,
              width: piece.width,
              height: line.height,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <ComposerInlineChip atom={piece.atom} width={piece.width} fontSize={textStyle.fontSize} selected={piece.offset >= selectedFrom && piece.offset < selectedTo} />
          </div>
        ),
      )}
    </>
  );
});

function CodeBlockView({ layout, offsetY, width, blockIndex }: { layout: BlockLayout; offsetY: number; width: number; blockIndex: number }) {
  const block = layout.block as CodeBlock;
  const colors = useCodeBlockColors(block);
  const top = layout.y + offsetY;
  return (
    <>
      <ComposerCodeBlockFrame
        block={block}
        blockIndex={blockIndex}
        top={top + METRICS.codeMarginY}
        width={width}
        height={layout.height - 2 * METRICS.codeMarginY}
        headerHeight={METRICS.codeHeader}
      />
      {layout.lines.map((line, index) => (
        <CodeLine
          key={index}
          line={line}
          text={block.text}
          colors={colors}
          top={top + layout.textY + line.y}
          left={layout.textX}
          height={line.height}
        />
      ))}
    </>
  );
}

const CodeLine = memo(function CodeLine({
  line,
  text,
  colors,
  top,
  left,
  height,
}: {
  line: VisualLine;
  text: string;
  colors: (start: number, end: number) => ReadonlyArray<ColorRun>;
  top: number;
  left: number;
  height: number;
}) {
  const theme = useTheme();
  if (line.end <= line.start) return null;
  const runs = colors(line.start, line.end);
  let x = 0;
  return (
    <>
      {runs.map((run) => {
        const value = text.slice(run.start, run.end);
        const runX = x;
        x += textAdvance({ family: "mono", weight: 400 }, METRICS.codeFontSize, value);
        return (
          <div
            key={run.start}
            style={{
              position: "absolute",
              left: left + runX,
              top,
              height,
              fontFamily: FONTS.mono,
              fontSize: METRICS.codeFontSize,
              lineHeight: height,
              color: run.color || theme.foreground,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {value.replaceAll("\t", "    ")}
          </div>
        );
      })}
    </>
  );
});

// ── Helpers ──────────────────────────────────────────────────────────────

const serializeCache = new WeakMap<Doc, string>();
function serializeDocCached(doc: Doc): string {
  let value = serializeCache.get(doc);
  if (value === undefined) {
    value = serializeDoc(doc);
    serializeCache.set(doc, value);
  }
  return value;
}

function paragraphSourceUpTo(block: Block, offset: number): string {
  return block.kind === "paragraph" ? paragraphSource(block, 0, offset) : block.text.slice(0, offset);
}

/**
 * web skillChipReplacements: when the provider's skills change, `$name` text naming an
 * offered skill becomes its chip and a chip for a skill no longer offered goes back to text.
 */
function reconcileSkills(doc: Doc, skillMeta: (name: string) => SkillMeta | null): Doc {
  let changed = false;
  const blocks = doc.blocks.map((block, index) => {
    if (block.kind !== "paragraph") return block;
    const followed = index < doc.blocks.length - 1;
    const source = paragraphSource(block);
    const parsed = parseInline(followed ? `${source}\n` : source, { skillMeta, codeBlocks: true });
    const text = followed ? parsed.text.slice(0, -1) : parsed.text;
    const sameShape =
      text === block.text &&
      parsed.atoms.length === block.atoms.length &&
      parsed.atoms.every((atom, atomIndex) => atom.kind === block.atoms[atomIndex]!.kind && atom.source === block.atoms[atomIndex]!.source);
    if (sameShape) return block;
    // Only skill chips change here; every other atom stays as it was (keeping citation keys).
    const kept: Atom[] = [];
    let out = "";
    let oldAtom = 0;
    let newAtom = 0;
    let newOffset = 0;
    for (newOffset = 0; newOffset < text.length; newOffset += 1) {
      const char = text[newOffset]!;
      if (char !== ATOM_CHAR) {
        out += char;
        continue;
      }
      const atom = parsed.atoms[newAtom++]!;
      if (atom.kind === "skill") {
        kept.push(atom);
        out += ATOM_CHAR;
        continue;
      }
      // A non-skill atom: reuse the existing one with the same source, in order.
      while (oldAtom < block.atoms.length && block.atoms[oldAtom]!.source !== atom.source) oldAtom += 1;
      kept.push(block.atoms[oldAtom] ?? atom);
      oldAtom += 1;
      out += ATOM_CHAR;
    }
    changed = true;
    return { kind: "paragraph" as const, text: out, atoms: kept };
  });
  return changed ? { blocks } : doc;
}

function mapAtoms(doc: Doc, map: (atom: Atom) => Atom): Doc {
  let changed = false;
  const blocks = doc.blocks.map((block) => {
    if (block.kind !== "paragraph" || block.atoms.length === 0) return block;
    const atoms = block.atoms.map((atom) => {
      const next = map(atom);
      if (next !== atom) changed = true;
      return next;
    });
    return atoms.some((atom, index) => atom !== block.atoms[index]) ? { ...block, atoms } : block;
  });
  return changed ? { blocks } : doc;
}

function serializeCitation(citation: Extract<Atom, { kind: "citation" }>["citation"]): string {
  return serializeAssistantCitation(citation);
}
