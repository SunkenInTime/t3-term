// apps/web/src/components/ChatMarkdown.tsx. The markdown goes through web's
// remark/rehype pipeline (chat/markdown/parse.ts) and renders tag by tag the
// way web's components do (chat/markdown/MarkdownView.tsx), with inline
// content laid out in JavaScript because gpuix has no inline formatting
// context. Links route like web: file links open the Files surface at the
// line, thread links navigate, web links open the system browser.
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ContextMenuItem } from "@t3tools/contracts";
import { isHostPath } from "@t3tools/shared/path";
import { mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import { memo, useContext, useMemo, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { useClientSettings } from "../../state/clientSettings.ts";
import { rightPanelActions, threadKeyOf } from "../../state/rightPanel.ts";
import { routeAtom } from "../../state/ui.ts";
import { toast } from "../../ui/toast.tsx";
import { useTheme } from "../../ui/theme.ts";
import { markdownFileCopyMenuItems } from "../../web/components/chat/MarkdownFileLink.logic.ts";
import { chipAtom, checkboxAtom, CheckboxBox, ChipBox, faviconAtom, FaviconBox, type ChipPayload } from "../markdown/MarkdownChips.tsx";
import { MarkdownCodeBlock } from "../markdown/MarkdownCodeBlock.tsx";
import { MarkdownDetails } from "../markdown/MarkdownDetails.tsx";
import { MarkdownTable } from "../markdown/MarkdownTable.tsx";
import { useTextMetricsEpoch } from "../markdown/measure.ts";
import {
  HoverStore,
  renderDocument,
  type BlockRenderers,
  type InlineBoxRenderers,
  type LinkEntry,
  type MarkdownActions,
  type RenderEnv,
} from "../markdown/MarkdownView.tsx";
import type { BoxAtom } from "../markdown/inline.ts";
import { messageLinkIndex, type FileChipTarget } from "../markdown/links.ts";
import { parseChatMarkdown } from "../markdown/parse.ts";
import { showMarkdownContextMenu } from "../markdown/overlays.tsx";
import { markdownStyles, type ChatMarkdownTone } from "../markdown/styles.ts";
import { TimelineRowCtx, type TimelineRowSharedState } from "./rowContext.ts";
import { copyTextToClipboard, openExternalUrl } from "./system.ts";

export type { ChatMarkdownTone };

/** Last measured width per placement, so a remounted row lays out at the right width in its first frame. */
const lastWidths = new Map<string, number>();

interface LinkContext {
  readonly row: TimelineRowSharedState | null;
}

function panelPathFor(target: FileChipTarget): string | null {
  const meta = target.meta;
  const canPreviewMedia = mediaMimeTypeFromExtension(meta.basename.slice(meta.basename.lastIndexOf("."))) !== null;
  return meta.workspaceRelativePath ?? (!canPreviewMedia && isHostPath(meta.filePath) ? meta.filePath : null);
}

function openFileTarget(target: FileChipTarget, context: LinkContext) {
  const row = context.row;
  const panelPath = panelPathFor(target);
  if (!row || !panelPath) {
    toast({ type: "info", title: "Can't open this file here", description: target.meta.targetPath });
    return;
  }
  rightPanelActions.openFile(threadKeyOf(row.threadRef.environmentId, row.threadRef.threadId), panelPath, target.meta.line);
}

function copyWithToast(text: string, title: string) {
  copyTextToClipboard(text).then(
    () => toast({ type: "success", title: `${title} copied`, description: text }),
    (error: unknown) =>
      toast({
        type: "error",
        title: `Failed to copy ${title.toLowerCase()}`,
        description: error instanceof Error ? error.message : "The clipboard is unavailable.",
      }),
  );
}

function fileContextMenu(target: FileChipTarget, context: LinkContext, position: { x: number; y: number }) {
  const copyItems = markdownFileCopyMenuItems({ targetPath: target.meta.targetPath, workspaceRelativePath: target.meta.workspaceRelativePath });
  const panelPath = panelPathFor(target);
  const items: ContextMenuItem<string>[] = [
    ...(context.row && panelPath ? [{ id: "open-in-panel", label: "Open file" }] : []),
    ...copyItems.map(({ id, label }) => ({ id, label })),
  ];
  void showMarkdownContextMenu(items, position).then((clicked) => {
    if (clicked === "open-in-panel") openFileTarget(target, context);
    const copyItem = copyItems.find((item) => item.id === clicked);
    if (copyItem) copyWithToast(copyItem.value, copyItem.title);
  });
}

function externalContextMenu(href: string, position: { x: number; y: number }) {
  // web externalLinkContextMenu: without an integrated browser for this client, the
  // menu offers the system browser and copying.
  const items: ContextMenuItem<string>[] = [
    { id: "open-external", label: "Open in system browser" },
    { id: "copy-link", label: "Copy Link" },
  ];
  void showMarkdownContextMenu(items, position).then((clicked) => {
    if (clicked === "open-external") openExternalUrl(href);
    if (clicked === "copy-link") copyWithToast(href, "Link");
  });
}

function navigateToThread(environmentId: EnvironmentId, threadId: ThreadId) {
  appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId });
}

function createActions(context: LinkContext): MarkdownActions {
  return {
    activateLink(entry) {
      const kind = entry.kind;
      if (kind.kind === "file") {
        openFileTarget({ meta: kind.meta, label: kind.meta.basename, copyMarkdown: entry.href }, context);
      } else if (kind.kind === "thread") {
        const environmentId = context.row?.threadRef.environmentId;
        if (environmentId) navigateToThread(environmentId, kind.threadId);
      } else if (kind.kind === "external") {
        if (entry.href.startsWith("#")) return;
        openExternalUrl(entry.href);
      }
    },
    linkContextMenu(entry, position) {
      const kind = entry.kind;
      if (kind.kind === "external" && kind.faviconHost) externalContextMenu(entry.href, position);
      if (kind.kind === "file") fileContextMenu({ meta: kind.meta, label: kind.meta.basename, copyMarkdown: entry.href }, context, position);
    },
  };
}

function createBoxes(context: LinkContext): InlineBoxRenderers {
  let nextId = 0;
  const id = (prefix: string) => `${prefix}${nextId++}`;
  const lineWidth = (env: RenderEnv) => env.styles.body.size * 40;
  return {
    renderBox(atom: BoxAtom, env: RenderEnv, key: string): ReactNode {
      const payload = atom.payload as { type: string };
      switch (payload.type) {
        case "chip":
          return <ChipBox key={key} atom={atom} env={env} />;
        case "favicon":
          return <FaviconBox key={key} atom={atom} env={env} />;
        case "checkbox":
          return <CheckboxBox key={key} atom={atom} env={env} />;
        default:
          return null;
      }
    },
    fileChip(target, env, link) {
      const payload: ChipPayload = {
        type: "chip",
        kind: "mention",
        label: target.label,
        icon: { kind: "file", path: target.meta.filePath },
        tooltip: target.meta.targetPath,
        onActivate: () => openFileTarget(target, context),
        onContextMenu: (position) => fileContextMenu(target, context, position),
        fileMetadata: { environmentId: context.row?.threadRef.environmentId ?? null, path: target.meta.filePath, cwd: context.row?.markdownCwd },
      };
      return chipAtom(id("file"), payload, env.styles.body, lineWidth(env), link);
    },
    threadChip(threadId, label, env) {
      const environmentId = context.row?.threadRef.environmentId;
      const payload: ChipPayload = {
        type: "chip",
        kind: "thread",
        label,
        icon: { kind: "lucide", name: "messages-square" },
        tooltip: "Open thread",
        ...(environmentId
          ? {
              onActivate: () => navigateToThread(environmentId, threadId as ThreadId),
              threadRef: { environmentId, threadId: threadId as ThreadId },
            }
          : {}),
      };
      return chipAtom(id("thread"), payload, env.styles.body, lineWidth(env));
    },
    contextChip(_kind, _contextId, label, env) {
      const payload: ChipPayload = { type: "chip", kind: "mention", label, icon: { kind: "lucide", name: "paperclip" } };
      return chipAtom(id("ctx"), payload, env.styles.body, lineWidth(env));
    },
    citationChip(entry: LinkEntry, env) {
      const label = entry.kind.kind === "citation" ? "Quote" : "Citation";
      const payload: ChipPayload = { type: "chip", kind: "citation", label, icon: { kind: "lucide", name: "quote" } };
      return chipAtom(id("cite"), payload, env.styles.body, lineWidth(env));
    },
    favicon(host, link, env) {
      return faviconAtom(id("fav"), host, env.styles.body, link);
    },
    checkbox(checked, env) {
      return checkboxAtom(id("chk"), checked, env.styles.body, env.styles.listIndent);
    },
    inlineMath() {
      return null;
    },
    inlineImage() {
      return null;
    },
  };
}

function createBlocks(): BlockRenderers {
  return {
    codeBlock({ code, language, meta, width, env, key }) {
      return <MarkdownCodeBlock key={key} code={code} language={language} meta={meta} width={width} styles={env.styles} isStreaming={false} />;
    },
    mathBlock({ tex, width, env, key }) {
      return <MarkdownCodeBlock key={key} code={tex} language="math" meta={undefined} width={width} styles={env.styles} isStreaming={false} />;
    },
    table({ node, width, env, key }) {
      return <MarkdownTable key={key} node={node} width={width} env={env} />;
    },
    details({ node, width, env, key }) {
      return <MarkdownDetails key={key} node={node} width={width} env={env} />;
    },
    image() {
      return null;
    },
  };
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  tone = "assistant",
  textSize = 14,
  lineBreaks = false,
  parseRawHtml = true,
  maxWidth,
}: {
  text: string;
  tone?: ChatMarkdownTone;
  textSize?: 14 | 12;
  lineBreaks?: boolean;
  /** web UserMessageBody passes false: authored HTML shows as text. */
  parseRawHtml?: boolean;
  /** Shrink-to-fit inside a bubble: lay out at most this wide and take the content's width. */
  maxWidth?: number;
}) {
  const palette = useTheme();
  const styles = markdownStyles(palette, tone, textSize);
  const epoch = useTextMetricsEpoch();
  const row = useContext(TimelineRowCtx) as TimelineRowSharedState | null;
  const mathEnabled = useClientSettings((settings) => settings.mathRenderingEnabled);
  const widthKey = `${tone}:${textSize}`;
  const [measured, setMeasured] = useState(() => lastWidths.get(widthKey) ?? 0);
  const width = maxWidth ?? measured;
  const [hover] = useState(() => new HoverStore());
  const tree = parseChatMarkdown(text, { lineBreaks, math: mathEnabled, rawHtml: parseRawHtml });
  const cwd = row?.markdownCwd;
  const context = useMemo<LinkContext>(() => ({ row }), [row]);
  const handlers = useMemo(() => ({ actions: createActions(context), boxes: createBoxes(context), blocks: createBlocks() }), [context]);
  const rendered = useMemo(() => {
    if (width <= 0) return null;
    const env: RenderEnv = {
      styles,
      index: messageLinkIndex(text, cwd),
      links: [],
      hover,
      actions: handlers.actions,
      boxes: handlers.boxes,
      blocks: handlers.blocks,
      mathEnabled,
      extent: { width: 0, root: width },
    };
    const nodes = renderDocument(tree, width, env);
    return { nodes, extent: env.extent.width };
    // epoch: new text metrics re-lay out lines measured with estimates.
  }, [tree, width, styles, text, cwd, hover, handlers, mathEnabled, epoch]);
  const fitWidth = maxWidth !== undefined && rendered ? Math.min(maxWidth, Math.ceil(rendered.extent)) : undefined;
  return (
    <div
      onLayout={
        maxWidth === undefined
          ? (event) => {
              const next = event.width ?? 0;
              if (next > 0) lastWidths.set(widthKey, next);
              if (next > 0 && Math.abs(next - measured) > 0.5) setMeasured(next);
            }
          : undefined
      }
      style={{ display: "flex", flexDirection: "column", width: fitWidth ?? "100%", minWidth: 0 }}
    >
      {rendered?.nodes}
    </div>
  );
});
