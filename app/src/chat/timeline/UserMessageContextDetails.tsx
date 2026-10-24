// The read-only details a sent message's context chip opens:
// apps/web/src/components/chat/TerminalContextInlineChip.tsx (terminal excerpt),
// UserMessageContextChips.tsx (UserMessageElementDetails,
// UserMessageReviewCommentCard, UserMessagePreviewAnnotationDetails) and
// contextChipParts.tsx ContextChipPopover (popup side="top", width lg, compact
// padding).
//
// Chips are boxes inside chat markdown and cannot host a Popover trigger, so
// the popup opens in the markdown overlay host, anchored above the point the
// chip was pressed (the bubble records it on mouse down).
import { useAtomValue } from "@effect/atom-react";
import { DismissableLayer } from "@gpuix/react";
import type { KnownComposerContextRecord } from "@t3tools/contracts";
import { useMemo, type ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { surfaceStyle } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import { viewportHeightAtom, viewportWidthAtom } from "../../ui/viewport.tsx";
import { formatWorkspaceRelativePath } from "../../web/filePathDisplay.ts";
import { formatReviewCommentFence } from "../../web/reviewCommentContext.ts";
import { openExpandedImage, useImageInfo } from "../markdown/MarkdownMedia.tsx";
import { closeMarkdownOverlay, openMarkdownOverlay } from "../markdown/overlays.tsx";
import { DiffView } from "../../panels/diff/DiffView.tsx";
import { parseDiffFiles } from "../../panels/diff/diffModel.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";

const NO_COLLAPSED: ReadonlySet<string> = new Set();

type ContextRecord<K extends KnownComposerContextRecord["kind"]> = Extract<KnownComposerContextRecord, { kind: K }>;

// ── Popup host ──────────────────────────────────────────────────────────

let pressPoint = { x: 0, y: 0 };
function notePress(event: { x?: number; y?: number }) {
  pressPoint = { x: event.x ?? 0, y: event.y ?? 0 };
}

/**
 * Records where each press lands so a chip's popup can open above it. A chip's
 * filled box occludes its ancestors, so the bubble never sees the press; a
 * zero-size element's mouse-down-outside listener is window-wide and does,
 * and it fires on press, before the chip's click.
 */
export function ContextPressProbe() {
  return <div onMouseDownOutside={notePress} style={{ width: 0, height: 0 }} />;
}

// A press on the open chip closes the popup on mouse down; its click must not reopen it (web's trigger toggles).
let lastDismiss = { key: "", at: 0 };

const POPUP_WIDTH = 384; // w-96
const POPUP_PAD_X = 12;
const POPUP_PAD_Y = 8;
const POPUP_INNER_WIDTH = POPUP_WIDTH - 2 * POPUP_PAD_X - 2;

export function openContextDetails(key: string, render: () => ReactNode) {
  if (lastDismiss.key === key && Date.now() - lastDismiss.at < 500) return;
  const at = pressPoint;
  openMarkdownOverlay({
    kind: "custom",
    render: (close) => (
      <ContextDetailsPopup
        at={at}
        onClose={(byPress) => {
          if (byPress) lastDismiss = { key, at: Date.now() };
          close();
        }}
      >
        {render()}
      </ContextDetailsPopup>
    ),
  });
}

/** Openers for userMessageContextChips.ts, which builds chip payloads without JSX. */
export const contextDetails = {
  terminal: (key: string, record: ContextRecord<"terminal">) => openContextDetails(key, () => <TerminalExcerptDetails record={record} />),
  element: (key: string, record: ContextRecord<"element">) => openContextDetails(key, () => <ElementDetails record={record} />),
  reviewComment: (key: string, record: ContextRecord<"review-comment">, workspaceRoot: string | undefined) =>
    openContextDetails(key, () => <ReviewCommentDetails record={record} workspaceRoot={workspaceRoot} />),
  previewAnnotation: (key: string, record: ContextRecord<"preview-annotation">, image: AnnotationImage | null) =>
    openContextDetails(key, () => <PreviewAnnotationDetails record={record} image={image} />),
};

function ContextDetailsPopup({ at, onClose, children }: { at: { x: number; y: number }; onClose: (byPress: boolean) => void; children: ReactNode }) {
  const theme = useTheme();
  const viewportWidth = useAtomValue(viewportWidthAtom);
  const viewportHeight = useAtomValue(viewportHeightAtom);
  return (
    <DismissableLayer onEscapeKeyDown={() => onClose(false)}>
      {/* sideOffset 4 above a chip about 18px tall, measured from the press inside it. */}
      <anchored position={{ x: at.x, y: at.y - 14 }} anchor="bottomCenter" fit="snap" snapMargin={8} deferred priority={3} style={{ backgroundColor: "transparent" }}>
        <div
          testId="context-details-popup"
          onMouseDownOutside={() => onClose(true)}
          style={{
            ...surfaceStyle(theme),
            display: "flex",
            flexDirection: "column",
            width: Math.min(POPUP_WIDTH, viewportWidth - 32),
            maxHeight: viewportHeight - 16,
            overflow: "hidden",
            paddingLeft: POPUP_PAD_X,
            paddingRight: POPUP_PAD_X,
            paddingTop: POPUP_PAD_Y,
            paddingBottom: POPUP_PAD_Y,
            pointerEvents: "auto",
            cursor: "default",
          }}
        >
          {children}
        </div>
      </anchored>
    </DismissableLayer>
  );
}

// ── Shared pieces ───────────────────────────────────────────────────────

function codeTheme(theme: Palette, size: number, lineHeight: number) {
  return {
    appearance: theme.appearance,
    bg: "transparent",
    text: theme.foreground,
    textMuted: theme.mutedForeground,
    border: theme.border,
    accent: theme.primary,
    fontSans: FONTS.sans,
    fontMono: FONTS.mono,
    metrics: { codeTextSize: size, codeLineHeight: lineHeight },
  };
}

/** A bordered card: rounded-lg border-border/70 bg-background/70. */
function DetailsCard({ children, radius = RADIUS.lg, fill = 0.7 }: { children: ReactNode; radius?: number; fill?: number }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        overflow: "hidden",
        borderRadius: radius,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.7),
        backgroundColor: alpha(theme.background, fill),
      }}
    >
      {children}
    </div>
  );
}

function sourceLabelOf(source: { readonly fileName?: string | null; readonly lineNumber?: number | null } | null | undefined): string | null {
  return source?.fileName ? `${source.fileName}${source.lineNumber == null ? "" : `:${source.lineNumber}`}` : null;
}

/** `<code>` selector, truncated, with the source location pushed right. */
function SelectorRow({ selector, sourceLabel }: { selector: string; sourceLabel: string | null }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
      <text style={{ color: theme.foreground, fontFamily: FONTS.mono, fontSize: 12, lineHeight: 16, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>
        {selector}
      </text>
      {sourceLabel ? (
        <>
          <div style={{ flexGrow: 1 }} />
          <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            {sourceLabel}
          </Text>
        </>
      ) : null}
    </div>
  );
}

/** ReadOnlySourcePreview in a fixed-height bordered box (h-40 / h-32). */
function SourceBox({ name, text, height }: { name: string; text: string; height: number }) {
  const theme = useTheme();
  return (
    <div style={{ height, overflowY: "scroll", scrollbarColor: theme.scrollbar, borderRadius: 4, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.codeBackground }}>
      <code code={text} path={name} showLineNumbers style={{ paddingTop: 8, paddingBottom: 8, paddingLeft: 4, paddingRight: 8, minWidth: 0 }} theme={codeTheme(theme, 12, 18)} />
    </div>
  );
}

// ── Terminal excerpt ────────────────────────────────────────────────────

export function TerminalExcerptDetails({ record }: { record: ContextRecord<"terminal"> }) {
  const theme = useTheme();
  return (
    <DetailsCard radius={RADIUS.md} fill={0.8}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.7) }}>
        <Icon name="terminal" size={16} color={theme.success} />
        <Text size="sm" weight={500} truncate style={{ minWidth: 0, flexShrink: 1 }}>
          {record.terminalLabel}
        </Text>
        <div style={{ flexGrow: 1 }} />
        <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          {record.lineStart === record.lineEnd ? `Line ${record.lineStart}` : `Lines ${record.lineStart}–${record.lineEnd}`}
        </Text>
      </div>
      {/* max-h-80, whitespace-pre: <code> keeps lines unwrapped and pans sideways itself. */}
      <div style={{ maxHeight: 320, overflowY: "scroll", scrollbarColor: theme.scrollbar, backgroundColor: theme.muted }}>
        <code code={record.text} language="text" style={{ padding: 12, minWidth: 0 }} theme={codeTheme(theme, 12, 19.5)} />
      </div>
    </DetailsCard>
  );
}

// ── Browser element ─────────────────────────────────────────────────────

export function ElementDetails({ record }: { record: ContextRecord<"element"> }) {
  const theme = useTheme();
  return (
    <DetailsCard>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.7) }}>
        <Text size="xs" weight={500} truncate>
          {record.pageTitle?.trim() || record.pageUrl}
        </Text>
        <Text size="3xs" color={theme.mutedForeground} truncate>
          {record.pageUrl}
        </Text>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, minWidth: 0 }}>
        <SelectorRow selector={record.selector || `<${record.tagName}>`} sourceLabel={sourceLabelOf(record.source)} />
        {record.htmlPreview?.trim() ? <SourceBox name="element.html" text={record.htmlPreview} height={160} /> : null}
        {record.styles?.trim() ? <SourceBox name="styles.css" text={record.styles} height={128} /> : null}
      </div>
    </DetailsCard>
  );
}

// ── Review comment ──────────────────────────────────────────────────────

/** apps/web/src/reviewCommentContext.ts buildReviewCommentRenderablePatch. */
function reviewCommentPatch(record: ContextRecord<"review-comment">): string {
  if ((record.fenceLanguage ?? "diff") !== "diff") return "";
  const diff = record.diff.trim();
  if (diff.length === 0) return "";
  if (diff.startsWith("diff --git ")) return diff;
  const path = record.filePath.replaceAll("\\", "/");
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, diff].join("\n");
}

export function ReviewCommentDetails({ record, workspaceRoot }: { record: ContextRecord<"review-comment">; workspaceRoot: string | undefined }) {
  const theme = useTheme();
  const fenceLanguage = record.fenceLanguage ?? "diff";
  const patch = reviewCommentPatch(record);
  const files = useMemo(() => parseDiffFiles(patch), [patch]);
  return (
    <DetailsCard>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <Text size="xs" weight={500}>
            {formatWorkspaceRelativePath(record.filePath, workspaceRoot)}
          </Text>
          <Text size="2xs" color={theme.mutedForeground}>
            {`${record.sectionTitle} · ${record.rangeLabel}`}
          </Text>
        </div>
        {record.text.length > 0 ? <ChatMarkdown text={record.text} tone="user" lineBreaks parseRawHtml={false} maxWidth={POPUP_INNER_WIDTH - 26} /> : null}
        {fenceLanguage !== "diff" && record.diff.trim().length > 0 ? (
          <ChatMarkdown text={formatReviewCommentFence(fenceLanguage, record.diff)} tone="user" maxWidth={POPUP_INNER_WIDTH - 26} />
        ) : null}
        {files.length > 0 ? (
          // FileDiff, unified and expanded: the diff surface's pierre port, laid out inline (a comment's hunk is short).
          <DiffView
            inline
            files={files}
            layout="stacked"
            wrap={false}
            collapsed={NO_COLLAPSED}
            onToggleFile={() => {}}
            onOpenFile={() => {}}
            resetKey={patch}
          />
        ) : patch ? (
          <div style={{ borderRadius: RADIUS.md, backgroundColor: alpha(theme.muted, 0.4), padding: 8 }}>
            <code code={patch} language="diff" style={{ minWidth: 0 }} theme={codeTheme(theme, 12, 16)} />
          </div>
        ) : null}
      </div>
    </DetailsCard>
  );
}

// ── Preview annotation ──────────────────────────────────────────────────

export interface AnnotationImage {
  readonly url: string;
  readonly name: string;
}

export function PreviewAnnotationDetails({ record, image }: { record: ContextRecord<"preview-annotation">; image: AnnotationImage | null }) {
  const theme = useTheme();
  const elements = record.elements ?? [];
  const styleChanges = record.styleChanges?.length ?? 0;
  return (
    <DetailsCard>
      {image ? <AnnotationScreenshot image={image} /> : (
        <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.7), backgroundColor: alpha(theme.muted, 0.4) }}>
          <Text size="xs" color={theme.mutedForeground}>
            Screenshot unavailable
          </Text>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}>
        <Text size="xs" weight={500}>
          {record.pageTitle?.trim() || record.pageUrl || "Preview annotation"}
        </Text>
        {record.comment ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 4, minWidth: 0 }}>
            {record.comment.split("\n").map((line, index) => (
              <Text key={index} size="sm">
                {line.length === 0 ? " " : line}
              </Text>
            ))}
          </div>
        ) : null}
        {record.targetSummary || styleChanges > 0 ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, minWidth: 0 }}>
            {record.targetSummary ? (
              <Text size="3xs" color={theme.mutedForeground} truncate style={{ minWidth: 0, flexShrink: 1 }}>
                {record.targetSummary}
              </Text>
            ) : null}
            {styleChanges > 0 ? (
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <Icon name="paintbrush" size={12} color={theme.mutedForeground} />
                <Text size="3xs" color={theme.mutedForeground}>
                  {String(styleChanges)}
                </Text>
              </div>
            ) : null}
          </div>
        ) : null}
        {elements.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: alpha(theme.border, 0.6), minWidth: 0 }}>
            {elements.map((element, index) => (
              <div key={index} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <SelectorRow selector={element.selector || `<${element.tagName}>`} sourceLabel={sourceLabelOf(element.source)} />
                {element.htmlPreview?.trim() ? (
                  // max-h-24 overflow-auto whitespace-pre-wrap: every wrapped line, scrolling past 96px.
                  <div style={{ display: "flex", flexDirection: "column", marginTop: 4, maxHeight: 96, overflowY: "scroll", scrollbarColor: theme.scrollbar, borderRadius: 4, backgroundColor: alpha(theme.muted, 0.6), paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}>
                    {element.htmlPreview
                      .trim()
                      .split("\n")
                      .map((line, lineIndex) => (
                        <text key={lineIndex} style={{ color: theme.foreground, fontFamily: FONTS.mono, fontSize: 10, lineHeight: 16, minWidth: 0 }}>
                          {line.length === 0 ? " " : line}
                        </text>
                      ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </DetailsCard>
  );
}

/** max-h-64 w-full object-contain over bg-muted; click to expand. */
function AnnotationScreenshot({ image }: { image: AnnotationImage }) {
  const theme = useTheme();
  const info = useImageInfo(image.url);
  const width = POPUP_INNER_WIDTH;
  const height = info && !("error" in info) ? Math.min(256, (width * info.height) / info.width) : 160;
  return (
    <div
      onClick={() => {
        closeMarkdownOverlay();
        openExpandedImage({ images: [{ src: image.url, name: image.name }], index: 0 });
      }}
      style={{ display: "flex", width, height, cursor: "pointer", borderBottomWidth: 1, borderColor: alpha(theme.border, 0.7), backgroundColor: theme.muted }}
    >
      <img src={image.url} objectFit="contain" style={{ width, height }} />
    </div>
  );
}
