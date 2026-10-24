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

import { citeInComposer as insertCitation, composerTargetKey } from "../../state/composer.ts";
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
): AssistantCitation | null {
  const normalized = normalizeWhitespace(rendered);
  const quote = normalizeWhitespace(cleanMarkdownSelection(selected)).trim();
  if (quote.length === 0) return null;
  const start = normalized.indexOf(quote);
  if (start === -1) return null;
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
  // web inserts at the composer's caret and opens the chip's comment editor.
  insertCitation(key, formatAssistantCitationForComposer(citation));
  renderer()?.clearSelection();
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
