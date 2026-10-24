// web's AssistantSelectionToolbar + AssistantCitationSource: selecting text in
// an assistant reply offers a "Cite" button; citing puts an `[Assistant
// quote](t3-citation://...)` reference (AssistantCitation: the quote, its
// offsets in the reply's rendered text, and context either side) into the
// thread's composer. web finds the selection through DOM ranges; here the
// selection is gpuix's selected text, located in the reply's rendered text.
import { DismissableLayer } from "@gpuix/react";
import type { GpuixRenderer } from "@gpuix/native";
import { ASSISTANT_CITATION_CONTEXT_LENGTH, ASSISTANT_CITATION_MAX_TEXT_LENGTH, MessageId, type AssistantCitation, type ScopedThreadRef } from "@t3tools/contracts";
import type { Element, ElementContent, Root } from "hast";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerTargetKey, focusComposer, updateComposerDraft } from "../../state/composer.ts";
import { citationRequestAtom } from "../../state/timeline.ts";
import { routeAtom } from "../../state/ui.ts";
import { surfaceStyle } from "../../ui/overlay.tsx";
import { Button } from "../../ui/primitives.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import { formatAssistantCitationForComposer } from "../../web/composer-logic.ts";
import { cleanMarkdownSelection } from "./copy.ts";
import { closeMarkdownOverlay, openMarkdownOverlay } from "./overlays.tsx";

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "table", "td", "th", "tr", "ul", "details", "summary",
]);

/** The reply's text as it renders, with blocks separated (lib/assistantTextSelection's text stream). */
export function renderedPlainText(tree: Root): string {
  let out = "";
  const visit = (node: Root | ElementContent) => {
    if (node.type === "text") {
      out += node.value;
      return;
    }
    if (node.type !== "element" && node.type !== "root") return;
    const block = node.type === "element" && BLOCK_TAGS.has((node as Element).tagName);
    if (block) out += "\n";
    for (const child of node.children as ElementContent[]) visit(child);
    if (block) out += "\n";
  };
  visit(tree);
  return out;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

/** Builds the citation selector for a quote found in the rendered text (createAssistantTextSelector). */
export function citationFromSelection(
  threadRef: ScopedThreadRef,
  messageId: string,
  rendered: string,
  selected: string,
  /** Which occurrence of a repeated quote was selected (selectionOccurrence), 0 when unknown. */
  occurrence = 0,
): AssistantCitation | null {
  const normalized = normalizeWhitespace(rendered);
  const quote = normalizeWhitespace(cleanMarkdownSelection(selected)).trim();
  if (quote.length === 0) return null;
  let start = normalized.indexOf(quote);
  if (start === -1) return null;
  for (let skipped = 0; skipped < occurrence; skipped += 1) {
    const next = normalized.indexOf(quote, start + 1);
    if (next === -1) break;
    start = next;
  }
  const end = start + quote.length;
  return {
    version: 1,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    messageId: MessageId.make(messageId),
    text: quote,
    start,
    end,
    prefix: normalized.slice(Math.max(0, start - ASSISTANT_CITATION_CONTEXT_LENGTH), start),
    suffix: normalized.slice(end, end + ASSISTANT_CITATION_CONTEXT_LENGTH),
  };
}

function renderer(): GpuixRenderer | null {
  const slot = Reflect.get(globalThis, "__gpuixRenderHost") as { renderer?: GpuixRenderer } | undefined;
  return slot?.renderer ?? null;
}

export function readSelectedText(): string | null {
  return renderer()?.getSelectedText() ?? null;
}

let toolbarOpen = false;

/** Shows the Cite button at the pointer for a selection inside an assistant reply. */
export function openCitationToolbar(citation: AssistantCitation, position: { x: number; y: number }) {
  toolbarOpen = true;
  openMarkdownOverlay({
    kind: "custom",
    render: (close) => <CitationToolbar citation={citation} position={position} onClose={close} />,
  });
}

export function closeCitationToolbar() {
  if (!toolbarOpen) return;
  toolbarOpen = false;
  closeMarkdownOverlay();
}

function citeInComposer(citation: AssistantCitation) {
  const key = composerTargetKey({ kind: "thread", environmentId: citation.environmentId, threadId: citation.threadId });
  const reference = formatAssistantCitationForComposer(citation);
  updateComposerDraft(key, (draft) => ({
    ...draft,
    prompt: draft.prompt.length === 0 || /\s$/.test(draft.prompt) ? draft.prompt + reference : `${draft.prompt} ${reference}`,
  }));
  renderer()?.clearSelection();
  focusComposer();
}

/** Button size="xs" variant="glass": rounded-full glass surface, border-border/60, shadow-sm. */
function CitationToolbar({ citation, position, onClose }: { citation: AssistantCitation; position: { x: number; y: number }; onClose: () => void }) {
  const theme = useTheme();
  const tooLong = citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const label = tooLong ? "Shorten selection" : "Cite";
  return (
    <DismissableLayer
      onEscapeKeyDown={() => {
        toolbarOpen = false;
        onClose();
      }}
    >
      <anchored position={position} anchor="topLeft" fit="snap" snapMargin={8} deferred priority={2} style={{ backgroundColor: "transparent" }}>
        <div
          testId="assistant-cite-selection"
          onMouseDown={() => {
            if (tooLong) return;
            citeInComposer(citation);
            toolbarOpen = false;
            onClose();
          }}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            height: 24,
            paddingLeft: 7,
            paddingRight: 7,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.6),
            backgroundColor: theme.composer.surface,
            boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#0000001a" },
            cursor: tooLong ? "default" : "pointer",
            opacity: tooLong ? 0.64 : 1,
            pointerEvents: "auto",
            hover: tooLong ? undefined : { borderColor: theme.border },
          }}
        >
          <Icon name="quote" size={14} color={theme.mutedForeground} />
          <text style={{ fontFamily: FONTS.sans, fontSize: 12, fontWeight: 500, lineHeight: 16, color: theme.foreground, whiteSpace: "nowrap" }}>{label}</text>
        </div>
      </anchored>
    </DismissableLayer>
  );
}

// ── Citation chip popover (AssistantCitationChip outside the composer) ────

/** Opens the chip's popover above the click: the quote, its comment, and "Go to source". */
export function openCitationPopover(citation: AssistantCitation, position: { x: number; y: number }) {
  openMarkdownOverlay({
    kind: "custom",
    render: (close) => <CitationPopover citation={citation} position={position} onClose={close} />,
  });
}

/** web assistantCitationNavigation: open the cited thread and ask its timeline to reveal the quote. */
export function goToCitationSource(citation: AssistantCitation) {
  appAtomRegistry.set(citationRequestAtom, { key: Date.now(), citation });
  appAtomRegistry.set(routeAtom, { kind: "thread", environmentId: citation.environmentId, threadId: citation.threadId });
}

/** ContextChipPopover side="top" width="lg" padding="compact" around AssistantCitationQuote. */
function CitationPopover({ citation, position, onClose }: { citation: AssistantCitation; position: { x: number; y: number }; onClose: () => void }) {
  const theme = useTheme();
  const textStyle = { fontFamily: FONTS.sans, fontSize: 14, lineHeight: 20 } as const;
  return (
    <DismissableLayer onEscapeKeyDown={onClose}>
      <anchored position={{ x: position.x, y: position.y - 8 }} anchor="bottomLeft" fit="snap" snapMargin={8} deferred priority={2} style={{ backgroundColor: "transparent" }}>
        <div
          testId="citation-popover"
          onMouseDownOutside={onClose}
          style={{
            ...surfaceStyle(theme),
            display: "flex",
            flexDirection: "column",
            width: 384,
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 12,
            paddingRight: 12,
            pointerEvents: "auto",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, padding: 4 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, alignSelf: "stretch", maxHeight: 256, overflowY: "scroll", scrollbarColor: theme.scrollbar }}>
              <div style={{ display: "flex", flexDirection: "column", borderLeftWidth: 2, borderColor: theme.border, paddingLeft: 12 }}>
                {citation.text.split("\n").map((line, index) => (
                  <text key={index} style={{ ...textStyle, color: theme.mutedForeground }}>
                    {line.length > 0 ? line : " "}
                  </text>
                ))}
              </div>
              {citation.comment ? <text style={{ ...textStyle, color: theme.foreground }}>{citation.comment}</text> : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              icon="arrow-up-right"
              testId="citation-go-to-source"
              onClick={() => {
                onClose();
                goToCitationSource(citation);
              }}
            >
              Go to source
            </Button>
          </div>
        </div>
      </anchored>
    </DismissableLayer>
  );
}
