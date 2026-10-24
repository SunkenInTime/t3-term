// web's AssistantSelectionToolbar + AssistantCitationSource: selecting text in
// an assistant reply offers a "Cite" button; citing puts an `[Assistant
// quote](t3-citation://...)` reference (AssistantCitation: the quote, its
// offsets in the reply's rendered text, and context either side) into the
// thread's composer. web finds the selection through DOM ranges; here the
// selection is gpuix's selected text, located in the reply's rendered text
// (timeline/findOccurrence.ts selectionSelector).
import { DismissableLayer } from "@gpuix/react";
import type { GpuixRenderer } from "@gpuix/native";
import { ASSISTANT_CITATION_MAX_TEXT_LENGTH, type AssistantCitation } from "@t3tools/contracts";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { citeInComposer as insertCitation, composerTargetKey } from "../../state/composer.ts";
import { citationRequestAtom } from "../../state/timeline.ts";
import { routeAtom } from "../../state/ui.ts";
import { surfaceStyle } from "../../ui/overlay.tsx";
import { Button } from "../../ui/primitives.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import { formatAssistantCitationForComposer } from "../../web/composer-logic.ts";
import { closeMarkdownOverlay, openMarkdownOverlay } from "./overlays.tsx";

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
