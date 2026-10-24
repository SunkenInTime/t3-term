// apps/web/src/components/ChatMarkdown.tsx. The markdown goes through web's
// remark/rehype pipeline (chat/markdown/parse.ts) and renders tag by tag the
// way web's components do (chat/markdown/MarkdownView.tsx), with inline
// content laid out in JavaScript because gpuix has no inline formatting
// context. Links route like web (chat/markdown/linkActions.ts): file links open
// the Files surface at the line (Ctrl/Cmd+click: the editor; PDFs: the
// integrated browser), thread links navigate, web links follow the
// link-target preference. Right-click menus match MarkdownFileLink and
// externalLinkContextMenu.
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ContextMenuItem } from "@t3tools/contracts";
import { isHostPath } from "@t3tools/shared/path";
import { assistantCitationLabel } from "@t3tools/shared/assistantCitations";
import { formatProviderSkillDisplayName, type InlineSkill } from "@t3tools/shared/inlineSkills";
import { SKILL_CHIP_ICON_SVG } from "../markdown/chipIcons.ts";
import { mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import { memo, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { useClientSettings } from "../../state/clientSettings.ts";
import { rightPanelActions, threadKeyOf } from "../../state/rightPanel.ts";
import { routeAtom } from "../../state/ui.ts";
import { toast } from "../../ui/toast.tsx";
import { useTheme } from "../../ui/theme.ts";
import {
  markdownFileCopyMenuItems,
  shouldUseMarkdownFileBrowserPrimaryAction,
} from "../../web/components/chat/MarkdownFileLink.logic.ts";
import { showExternalLinkContextMenu } from "../../web/components/chat/externalLinkContextMenu.ts";
import { shouldOpenMarkdownFileLinkInEditor } from "../../web/markdown-links.ts";
import { environmentThreadShells } from "../../state/environment.ts";
import { usePullRequestLinking } from "../../dialogs/usePullRequestLinking.ts";
import { readEnvironmentScope } from "../../web/state/session.ts";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import {
  activateExternalLink,
  canOpenInIntegratedBrowser,
  canUseShellActions,
  editorMenuLabel,
  isBrowserPreviewFile,
  openFileInEditor,
  openFileInIntegratedBrowser,
  findWorkspaceFileMatch,
  openUrlInIntegratedBrowser,
  resolveCopyPaths,
  revealFileInFileManager,
  revealMenuLabel,
} from "../markdown/linkActions.ts";
import { claimWorkspaceBasenameLookup, needsWorkspaceBasenameLookup, stripRepeatedWorkspacePrefix } from "@t3tools/client-runtime/workspace-basename-lookup";
import { resolveMediaSource } from "@t3tools/client-runtime/media-source";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { environmentSession } from "../../state/environment.ts";
import { timelineAssets } from "../../state/timeline.ts";
import { chipAtom, checkboxAtom, CheckboxBox, ChipBox, faviconAtom, FaviconBox, type ChipPayload } from "../markdown/MarkdownChips.tsx";
import { MarkdownCodeBlock } from "../markdown/MarkdownCodeBlock.tsx";
import { InlineMathBox, inlineMathAtom, MathBlock, MermaidBlock } from "../markdown/MarkdownDiagrams.tsx";
import { InlineImageBox, inlineImageAtom, MarkdownImage, openExpandedImage } from "../markdown/MarkdownMedia.tsx";
import { asyncLayoutEpoch, subscribeAsyncLayout } from "../markdown/diagrams.ts";
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
import { openCitationPopover } from "../markdown/citations.tsx";
import { runShellCommandInTerminal } from "../markdown/runInTerminal.ts";
import { ArtifactTemplateCard } from "../markdown/ArtifactTemplateCard.tsx";
import { appendCodexArtifactTemplateUsePrompt, type CodexArtifactTemplate } from "@t3tools/shared/codexArtifactTemplates";
import { composerTargetKey, focusComposer, updateComposerDraft } from "../../state/composer.ts";
import { markdownStyles, type ChatMarkdownTone } from "../markdown/styles.ts";
import { NativeChatMarkdown } from "../../dev/nativeMarkdown.tsx";
import { TimelineRowCtx, type TimelineRowSharedState } from "./rowContext.ts";
import { copyTextToClipboard, openExternalUrl } from "./system.ts";

export type { ChatMarkdownTone };

const NO_SKILLS: ReadonlyArray<InlineSkill> = [];

/** Last measured width per placement, so a remounted row lays out at the right width in its first frame. */
const lastWidths = new Map<string, number>();

interface LinkContext {
  readonly row: TimelineRowSharedState | null;
  readonly contextChip: ((reference: { kind: string; contextId: string; label: string }) => ChipPayload | null) | undefined;
  /** usePullRequestLinking for the thread's environment, read at menu time. */
  readonly linking: { current: ReturnType<typeof usePullRequestLinking> | null };
  /** web onTaskListChange: a rendered Markdown file's task checkbox was toggled. */
  readonly onTaskListChange: ((input: { markerOffset: number; checked: boolean }) => void) | undefined;
  /** The markdown source, to find a task's `[ ]` marker from its list item's offset. */
  readonly text: string;
}

/** web ChatMarkdown findTaskListMarkerOffset. */
function findTaskListMarkerOffset(markdown: string, listItemStart: number): number | null {
  const firstLineEnd = markdown.indexOf("\n", listItemStart);
  const firstLine = markdown.slice(listItemStart, firstLineEnd === -1 ? markdown.length : firstLineEnd);
  const match = firstLine.match(/^(?:\s*(?:[-+*]|\d+[.)])\s+)(\[[ xX]\])/);
  if (!match?.[1]) return null;
  return listItemStart + firstLine.indexOf(match[1]);
}

function panelPathFor(target: FileChipTarget): string | null {
  const meta = target.meta;
  const canPreviewMedia = mediaMimeTypeFromExtension(meta.basename.slice(meta.basename.lastIndexOf("."))) !== null;
  return meta.workspaceRelativePath ?? (!canPreviewMedia && isHostPath(meta.filePath) ? meta.filePath : null);
}

/** Whether a link names a media file web previews in its viewer rather than the Files panel. */
function canPreviewMediaFile(target: FileChipTarget): boolean {
  const basename = target.meta.basename;
  return mediaMimeTypeFromExtension(basename.slice(basename.lastIndexOf("."))) !== null;
}

/**
 * web ChatMarkdown openFileInPanel: a bare basename or a path that repeats the
 * project's folders is looked up in the workspace first; the newest click wins
 * over a lookup still in flight.
 */
function openFileInPanel(target: FileChipTarget, context: LinkContext) {
  const row = context.row;
  const panelPath = panelPathFor(target);
  if (!row || !panelPath) {
    toast({ type: "info", title: "Can't open this file here", description: target.meta.targetPath });
    return;
  }
  const threadKey = threadKeyOf(row.threadRef.environmentId, row.threadRef.threadId);
  const isLatestLookup = claimWorkspaceBasenameLookup();
  const openAt = (path: string) => rightPanelActions.openFile(threadKey, path, target.meta.line);
  const cwd = row.markdownCwd;
  if (
    target.meta.workspaceLookupPath === null ||
    !cwd ||
    (!needsWorkspaceBasenameLookup(panelPath) && stripRepeatedWorkspacePrefix(panelPath, cwd) === null)
  ) {
    openAt(panelPath);
    return;
  }
  void findWorkspaceFileMatch(row.threadRef.environmentId, target.meta, cwd).then((match) => {
    if (isLatestLookup()) openAt(match ?? panelPath);
  });
}

/**
 * web openMarkdownMedia (resolveMarkdownMediaPreview): a media link with no
 * Files-panel path, such as an image outside the workspace, opens in the
 * image viewer through the server's asset URL. gpuix plays no video, so a
 * video opens in the system browser, t3-term's video fallback (media/VideoFallback.tsx).
 */
async function openMarkdownMedia(target: FileChipTarget, context: LinkContext) {
  const row = context.row;
  if (!row) return;
  const media = resolveMediaSource(target.meta.filePath, {
    threadId: row.threadRef.threadId,
    workspaceRoot: row.markdownCwd,
    resolvedFilePath: target.meta.filePath,
  });
  if (!media) return;
  try {
    let src: string;
    if (media.access === "direct") {
      src = media.uri.startsWith("//") ? `https:${media.uri}` : media.uri;
    } else {
      const prepared = appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(row.threadRef.environmentId));
      const base = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
      if (media.access === "unavailable" || !base) throw new Error("Reconnect to this environment and open the media again.");
      const result = await executeAtomQuery(
        appAtomRegistry,
        timelineAssets.createUrl({ environmentId: row.threadRef.environmentId, input: { resource: media.resource } } as never) as never,
        { label: "markdown media preview", reportFailure: false },
      );
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const url = resolveAssetUrl(base, (result.value as { relativeUrl: string }).relativeUrl);
      if (url === null) throw new Error("The environment returned an invalid media URL.");
      src = url + media.srcFragment;
    }
    if (media.kind === "video") openExternalUrl(src);
    else openExpandedImage({ images: [{ src, name: media.name }], index: 0 });
  } catch (error) {
    toast({
      type: "error",
      title: "Unable to open media",
      description: error instanceof Error ? error.message : "The file could not be loaded. It may have been moved or deleted.",
    });
  }
}

/** What a file link may do here, the props web's fileLinkChip hands MarkdownFileLink. */
function fileCapabilities(target: FileChipTarget, context: LinkContext) {
  const threadRef = context.row?.threadRef ?? null;
  const environmentId = threadRef?.environmentId ?? null;
  const canEditor = environmentId !== null && canUseShellActions(environmentId);
  return {
    environmentId,
    threadRef,
    canEditor,
    canBrowser: canOpenInIntegratedBrowser(threadRef) && isBrowserPreviewFile(target.meta.filePath),
    canPanel: threadRef !== null && panelPathFor(target) !== null,
    canMedia: threadRef !== null && canPreviewMediaFile(target),
    revealLabel: canEditor && environmentId !== null ? revealMenuLabel(environmentId) : undefined,
  };
}

/** MarkdownFileLink onClick: Ctrl/Cmd opens the editor, a PDF the browser, anything else the Files panel. */
function openFileTarget(target: FileChipTarget, context: LinkContext, modifiers?: { ctrl: boolean; cmd: boolean }) {
  const can = fileCapabilities(target, context);
  const cwd = context.row?.markdownCwd;
  if (can.canEditor && can.environmentId && modifiers && shouldOpenMarkdownFileLinkInEditor({ ctrlKey: modifiers.ctrl, metaKey: modifiers.cmd }, process.platform === "darwin" ? "MacIntel" : "Win32")) {
    void openFileInEditor(can.environmentId, target.meta, cwd);
    return;
  }
  if (shouldUseMarkdownFileBrowserPrimaryAction({ iconPath: target.meta.filePath, canOpenInEditor: can.canEditor, canOpenInBrowser: can.canBrowser, canOpenInPanel: can.canPanel }) && can.threadRef) {
    void openFileInIntegratedBrowser(can.threadRef, target.meta.filePath, cwd);
    return;
  }
  // MarkdownFileLink handleOpenInFilePreview: the panel, else the media viewer, else the editor.
  if (can.canPanel) {
    openFileInPanel(target, context);
    return;
  }
  if (can.canMedia) {
    void openMarkdownMedia(target, context);
    return;
  }
  if (!can.canEditor || !can.environmentId) {
    openFileInPanel(target, context);
    return;
  }
  void openFileInEditor(can.environmentId, target.meta, cwd);
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
  const can = fileCapabilities(target, context);
  const cwd = context.row?.markdownCwd;
  // web MarkdownFileLink: a click opens the Files panel; the menu holds the other actions.
  const items: ContextMenuItem<string>[] = [
    ...(can.canMedia ? [{ id: "preview-media", label: "Preview media" }] : []),
    ...(can.canEditor && can.environmentId ? [{ id: "open", label: editorMenuLabel(can.environmentId) }] : []),
    ...(can.canBrowser ? [{ id: "open-in-browser", label: "Open in integrated browser" }] : []),
    ...(can.revealLabel ? [{ id: "reveal", label: can.revealLabel }] : []),
    ...copyItems.map(({ id, label }) => ({ id, label })),
  ];
  void showMarkdownContextMenu(items, position).then((clicked) => {
    if (clicked === "preview-media") void openMarkdownMedia(target, context);
    if (clicked === "open" && can.environmentId) void openFileInEditor(can.environmentId, target.meta, cwd);
    if (clicked === "open-in-browser" && can.threadRef) void openFileInIntegratedBrowser(can.threadRef, target.meta.filePath, cwd);
    if (clicked === "reveal" && can.environmentId) void revealFileInFileManager(can.environmentId, target.meta, cwd);
    // web resolveCopyPaths: the paths after the workspace lookup, not the link's own text.
    if (clicked === "copy-relative" || clicked === "copy-full") {
      const title = clicked === "copy-relative" ? "Relative path" : "Full path";
      void resolveCopyPaths(can.environmentId, target.meta, cwd).then(
        (paths) => copyWithToast(clicked === "copy-relative" ? paths.relativePath : paths.fullPath, title),
        () => {
          const copyItem = copyItems.find((item) => item.id === clicked);
          if (copyItem) copyWithToast(copyItem.value, copyItem.title);
        },
      );
    }
  });
}

function externalContextMenu(href: string, context: LinkContext, position: { x: number; y: number }) {
  const threadRef = context.row?.threadRef ?? null;
  const linking = context.linking.current;
  const shell = threadRef ? appAtomRegistry.get(environmentThreadShells.threadShellAtom(threadRef)) : null;
  const canOperateHost = threadRef !== null && readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  // ChatMarkdown's anchor: a pull request URL can be linked to (or unlinked from) this thread.
  const threadLinkAction =
    !canOperateHost || !linking || shell === null
      ? undefined
      : linking.isLinked(shell, href)
        ? ("unlink-from-thread" as const)
        : linking.canLink(href)
          ? ("link-to-thread" as const)
          : undefined;
  void showExternalLinkContextMenu({
    href,
    position,
    canOpenInPreview: canOpenInIntegratedBrowser(threadRef),
    threadLinkAction,
    showContextMenu: (items, at) => showMarkdownContextMenu(items as ContextMenuItem<string>[], at) as never,
    openInPreview: async (target) => {
      if (threadRef) await openUrlInIntegratedBrowser(threadRef, target);
    },
    openExternal: async (target) => openExternalUrl(target),
    copyLink: async (target) => copyWithToast(target, "Link"),
    updateThreadLink: async (target, linked) => {
      if (threadRef && linking) await linking.changeLink(threadRef, target, linked);
    },
    reportFailure: (operation, cause) => {
      if (operation === "link-pull-request-to-thread" || operation === "unlink-pull-request-from-thread") {
        toast({
          type: "error",
          title: operation === "link-pull-request-to-thread" ? "Unable to link pull request" : "Unable to unlink pull request",
          description: cause instanceof Error ? cause.message : "The request failed.",
        });
      }
    },
  });
}

function navigateToThread(environmentId: EnvironmentId, threadId: ThreadId) {
  appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId });
}

function createActions(context: LinkContext): MarkdownActions {
  return {
    activateLink(entry, modifiers) {
      const kind = entry.kind;
      if (kind.kind === "file") {
        openFileTarget({ meta: kind.meta, label: kind.meta.basename, copyMarkdown: entry.href }, context, modifiers);
      } else if (kind.kind === "thread") {
        const environmentId = context.row?.threadRef.environmentId;
        if (environmentId) navigateToThread(environmentId, kind.threadId);
      } else if (kind.kind === "external") {
        if (entry.href.startsWith("#")) return;
        activateExternalLink(entry.href, context.row?.threadRef ?? null, modifiers.alt);
      }
    },
    linkContextMenu(entry, position) {
      const kind = entry.kind;
      if (kind.kind === "external" && kind.faviconHost) externalContextMenu(entry.href, context, position);
      if (kind.kind === "file") fileContextMenu({ meta: kind.meta, label: kind.meta.basename, copyMarkdown: entry.href }, context, position);
    },
  };
}

function createBoxes(context: LinkContext): InlineBoxRenderers {
  let nextId = 0;
  const id = (prefix: string) => `${prefix}${nextId++}`;
  const lineWidth = (env: RenderEnv) => env.styles.body.size * 40;
  return {
    renderBox(atom: BoxAtom, env: RenderEnv, key: string, join: boolean): ReactNode {
      const payload = atom.payload as { type: string };
      switch (payload.type) {
        case "chip":
          return <ChipBox key={key} atom={atom} env={env} join={join} />;
        case "favicon":
          return <FaviconBox key={key} atom={atom} env={env} />;
        case "checkbox":
          return <CheckboxBox key={key} atom={atom} env={env} />;
        case "math":
          return <InlineMathBox key={key} atom={atom} />;
        case "image":
          return <InlineImageBox key={key} atom={atom} />;
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
        onActivate: (modifiers) => openFileTarget(target, context, modifiers),
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
    contextChip(kind, contextId, label, env) {
      // web renders the reference's label as plain text when the caller has no chip for it.
      const payload = context.contextChip?.({ kind, contextId, label });
      return payload ? chipAtom(id("ctx"), payload, env.styles.body, lineWidth(env)) : null;
    },
    citationChip(entry: LinkEntry, env) {
      // AssistantCitationChip: the quote (or its comment) as the label; the source opens on click.
      if (entry.kind.kind !== "citation") return chipAtom(id("cite"), { type: "chip", kind: "citation", label: "Quote", icon: { kind: "lucide", name: "quote" } }, env.styles.body, lineWidth(env));
      const citation = entry.kind.citation;
      const payload: ChipPayload = {
        type: "chip",
        kind: "citation",
        label: assistantCitationLabel(citation),
        icon: { kind: "lucide", name: "quote" },
        tooltip: citation.comment ? `${citation.text}\n\n${citation.comment}` : citation.text,
        // Outside the composer the chip opens a popover with the quote and "Go to source".
        onActivate: (_modifiers, position) => openCitationPopover(citation, position),
      };
      return chipAtom(id("cite"), payload, env.styles.body, Math.min(lineWidth(env), env.styles.body.size * 0.86 * 16 + 40));
    },
    favicon(host, link, env) {
      return faviconAtom(id("fav"), host, env.styles.body, link);
    },
    skillChip(skill, rawText, env) {
      const payload: ChipPayload = {
        type: "chip",
        kind: "skill",
        label: formatProviderSkillDisplayName(skill),
        icon: { kind: "svg", source: SKILL_CHIP_ICON_SVG },
        copyText: rawText,
      };
      return chipAtom(id("skill"), payload, env.styles.body, lineWidth(env));
    },
    checkbox(checked, env, listItemOffset) {
      const onTaskListChange = context.onTaskListChange;
      const toggle =
        onTaskListChange && listItemOffset !== undefined
          ? () => {
              const markerOffset = findTaskListMarkerOffset(context.text, listItemOffset);
              if (markerOffset !== null) onTaskListChange({ markerOffset, checked: !checked });
            }
          : undefined;
      return checkboxAtom(id("chk"), checked, env.styles.body, env.styles.listIndent, toggle);
    },
    inlineMath(tex, display, env, style) {
      return inlineMathAtom(id("math"), tex, display, style, env.extent.root);
    },
    inlineImage(node, env, style) {
      return inlineImageAtom(id("img"), node, style, env.extent.root);
    },
  };
}

/**
 * ChatView insertArtifactTemplate: append the template's prompt to the thread's
 * draft unless the draft already ends with it, then focus the composer.
 */
function insertArtifactTemplate(threadRef: { environmentId: EnvironmentId; threadId: ThreadId }, template: CodexArtifactTemplate) {
  const key = composerTargetKey({ kind: "thread", environmentId: threadRef.environmentId, threadId: threadRef.threadId });
  updateComposerDraft(key, (draft) => ({ ...draft, prompt: appendCodexArtifactTemplateUsePrompt(draft.prompt, template) }));
  focusComposer();
}

function createBlocks(context: LinkContext): BlockRenderers {
  const threadRef = context.row?.threadRef ?? null;
  // web ChatView passes onRunShellCommand with an active project; ChatMarkdown
  // offers it once the fence has closed and the message stopped streaming.
  const runShellCommand = threadRef && context.row?.workspaceRoot ? (command: string) => void runShellCommandInTerminal(threadRef, command) : undefined;
  return {
    codeBlock({ code, language, meta, width, env, key, closedFence }) {
      return (
        <MarkdownCodeBlock
          key={key}
          code={code}
          language={language}
          meta={meta}
          width={width}
          styles={env.styles}
          isStreaming={env.isStreaming}
          onRunShellCommand={runShellCommand && !env.isStreaming && closedFence ? runShellCommand : undefined}
        />
      );
    },
    mathBlock({ tex, width, env, key }) {
      return <MathBlock key={key} tex={tex} width={width} styles={env.styles} />;
    },
    mermaid({ code, meta, width, env, key }) {
      return <MermaidBlock key={key} code={code} meta={meta} width={width} env={env} isStreaming={env.isStreaming} />;
    },
    table({ node, width, env, key }) {
      return <MarkdownTable key={key} node={node} width={width} env={env} />;
    },
    details({ node, width, env, key }) {
      return <MarkdownDetails key={key} node={node} width={width} env={env} />;
    },
    image({ node, width, env, key }) {
      return <MarkdownImage key={key} node={node} width={width} env={env} />;
    },
    artifactTemplate({ template, key }) {
      return <ArtifactTemplateCard key={key} template={template} onUse={threadRef ? (picked) => insertArtifactTemplate(threadRef, picked) : undefined} />;
    },
  };
}

// T3TERM_NATIVE_MD=1: the previous native renderer, for perf comparisons only.
const NATIVE_MARKDOWN = process.env.T3TERM_NATIVE_MD === "1";

export const ChatMarkdown = memo(function ChatMarkdown(props: Parameters<typeof RenderedChatMarkdown>[0]) {
  if (NATIVE_MARKDOWN) return <NativeChatMarkdown text={props.text} tone={props.tone ?? "assistant"} textSize={props.textSize ?? 14} lineBreaks={props.lineBreaks ?? false} />;
  return <RenderedChatMarkdown {...props} />;
});

const RenderedChatMarkdown = memo(function RenderedChatMarkdown({
  text,
  tone = "assistant",
  textSize = 14,
  lineBreaks = false,
  parseRawHtml = true,
  maxWidth,
  onFitWidth,
  isStreaming = false,
  contextChip,
  onTaskListChange,
  imageBaseDir,
}: {
  text: string;
  tone?: ChatMarkdownTone;
  textSize?: 14 | 12;
  lineBreaks?: boolean;
  /** web UserMessageBody passes false: authored HTML shows as text. */
  parseRawHtml?: boolean;
  /** Shrink-to-fit inside a bubble: lay out at most this wide and take the content's width. */
  maxWidth?: number;
  /** Reports the shrink-to-fit width, so wrappers can take it as a definite width (Taffy lays auto-width chains out repeatedly). */
  onFitWidth?: (width: number) => void;
  /** The message is still streaming: Mermaid shows its code until the fence closes. */
  isStreaming?: boolean;
  /** Chips for `t3-context:` references (user messages: UserMessageContextChips). */
  contextChip?: LinkContext["contextChip"];
  /** web FileMarkdownPreview: task checkboxes toggle through this. */
  onTaskListChange?: LinkContext["onTaskListChange"];
  /** web imageBaseDir: images resolve against the Markdown file's folder; links keep the workspace. */
  imageBaseDir?: string;
}) {
  const palette = useTheme();
  const styles = markdownStyles(palette, tone, textSize);
  const epoch = useTextMetricsEpoch();
  // Inline formulas and images re-lay out once their size is known.
  const asyncEpoch = useSyncExternalStore(subscribeAsyncLayout, asyncLayoutEpoch, asyncLayoutEpoch);
  const row = useContext(TimelineRowCtx) as TimelineRowSharedState | null;
  const mathEnabled = useClientSettings((settings) => settings.mathRenderingEnabled);
  const widthKey = `${tone}:${textSize}`;
  const [measured, setMeasured] = useState(() => lastWidths.get(widthKey) ?? 0);
  const width = maxWidth ?? measured;
  const [hover] = useState(() => new HoverStore());
  const tree = parseChatMarkdown(text, { lineBreaks, math: mathEnabled, rawHtml: parseRawHtml });
  const cwd = row?.markdownCwd;
  const linking = usePullRequestLinking(row?.threadRef.environmentId ?? null);
  const [linkingRef] = useState<LinkContext["linking"]>(() => ({ current: null }));
  linkingRef.current = linking;
  const context = useMemo<LinkContext>(
    () => ({ row, contextChip, linking: linkingRef, onTaskListChange, text }),
    [row, contextChip, linkingRef, onTaskListChange, text],
  );
  const handlers = useMemo(() => ({ actions: createActions(context), boxes: createBoxes(context), blocks: createBlocks(context) }), [context]);
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
      skills: row?.skills ?? NO_SKILLS,
      extent: { width: 0, root: width },
      media: { environmentId: row?.threadRef.environmentId ?? null, threadId: row?.threadRef.threadId ?? null, cwd: imageBaseDir ?? cwd, gallery: [] },
      isStreaming,
      source: text,
    };
    const nodes = renderDocument(tree, width, env);
    return { nodes, extent: env.extent.width };
    // epoch: new text metrics re-lay out lines measured with estimates.
  }, [tree, width, styles, text, cwd, imageBaseDir, row, hover, handlers, mathEnabled, epoch, asyncEpoch, isStreaming]);
  const fitWidth = maxWidth !== undefined && rendered ? Math.min(maxWidth, Math.ceil(rendered.extent)) : undefined;
  useEffect(() => {
    if (fitWidth !== undefined) onFitWidth?.(fitWidth);
  }, [fitWidth, onFitWidth]);
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
