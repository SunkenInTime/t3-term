// web PullRequestMarkdown renders bodies and comments through ChatMarkdown with `githubMedia` and
// the pull request panel's link routing. This is that over t3-term's chat markdown renderer
// (chat/markdown/*, the JavaScript inline layout): the same parse and layout, with pull request
// actions in place of the timeline's.
//
// - Images expand in the image viewer and step through the body's other images; GitHub uploads
//   load through the server's authenticated `github-media` asset (web ChatMarkdownAssetImage).
// - Links: pull request URLs open inside t3-term (openChangeRequestLinkInApp); a bare `#123`
//   is confirmed as a pull request before opening in the app, else it opens as written (web
//   PullRequestLinkPreview `confirmBeforeOpen`); other links follow the link-target preference
//   (integrated browser beside a thread). Workspace file links open in the Files panel or the
//   editor. Right-click gives web's link and file menus.
// - Hovering a pull request link shows web's preview card (repository, number, state, title,
//   author, opened); other links, and a preview that fails, show the URL instead.
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { ContextMenuItem, EnvironmentId, PullRequestRef, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { parseChangeRequestUrl, pullRequestCandidateUrlFromReferenceAutolink } from "@t3tools/shared/changeRequestUrl";
import { githubMediaFetchUrl } from "@t3tools/shared/githubMedia";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";
import type { Element, Root, ElementContent } from "hast";
import { memo, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { CheckboxBox, ChipBox, FaviconBox, checkboxAtom, chipAtom, faviconAtom, type ChipPayload } from "../chat/markdown/MarkdownChips.tsx";
import { MarkdownCodeBlock } from "../chat/markdown/MarkdownCodeBlock.tsx";
import { MarkdownDetails } from "../chat/markdown/MarkdownDetails.tsx";
import { InlineMathBox, MathBlock, MermaidBlock, inlineMathAtom } from "../chat/markdown/MarkdownDiagrams.tsx";
import { InlineImageBox, MarkdownImage, inlineImageAtom, useTimelineAssetUrl } from "../chat/markdown/MarkdownMedia.tsx";
import { MarkdownTable } from "../chat/markdown/MarkdownTable.tsx";
import {
  HoverStore,
  renderDocument,
  type BlockRenderers,
  type InlineBoxRenderers,
  type LinkEntry,
  type MarkdownActions,
  type RenderEnv,
} from "../chat/markdown/MarkdownView.tsx";
import type { BoxAtom } from "../chat/markdown/inline.ts";
import { asyncLayoutEpoch, subscribeAsyncLayout } from "../chat/markdown/diagrams.ts";
import {
  activateExternalLink,
  canOpenInIntegratedBrowser,
  canUseShellActions,
  editorMenuLabel,
  openFileInEditor,
  openUrlInIntegratedBrowser,
  revealFileInFileManager,
  revealMenuLabel,
} from "../chat/markdown/linkActions.ts";
import { messageLinkIndex, type FileChipTarget } from "../chat/markdown/links.ts";
import { useTextMetricsEpoch } from "../chat/markdown/measure.ts";
import { showMarkdownContextMenu } from "../chat/markdown/overlays.tsx";
import { parseChatMarkdown } from "../chat/markdown/parse.ts";
import { markdownStyles } from "../chat/markdown/styles.ts";
import { copyTextToClipboard, openExternalUrl } from "../chat/timeline/system.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { useClientSettings } from "../state/clientSettings.ts";
import { environmentProjects } from "../state/environment.ts";
import { pullRequestEnvironment, pullRequestEnvironmentsAtom, useEnvironmentQuery } from "../state/pullRequests.ts";
import { rightPanelActions, threadKeyOf } from "../state/rightPanel.ts";
import { toast } from "../ui/toast.tsx";
import { surfaceStyle } from "../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { markdownFileCopyMenuItems } from "../web/components/chat/MarkdownFileLink.logic.ts";
import { showExternalLinkContextMenu } from "../web/components/chat/externalLinkContextMenu.ts";
import { findProjectForChangeRequest } from "../web/lib/openPullRequestLink.ts";
import { shouldOpenMarkdownFileLinkInEditor } from "../web/markdown-links.ts";
import { waitForAtomValue } from "../web/state/waitForAtomValue.ts";
import { openChangeRequestLinkInApp } from "./openPullRequestLink.ts";
import { autolinkPullRequestMarkdown } from "./pullRequestMarkdownAutolinks.ts";
import { PullRequestMarkdownContext } from "./pullRequestMarkdownContext.ts";
import { PullRequestActorAvatar, formatRelativeTimeLabel, resolvePullRequestState } from "./pullRequestPresentation.tsx";
import { Icon } from "../ui/Icon.tsx";

interface PrLinkContext {
  readonly threadRef: ScopedThreadRef | null;
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | undefined;
}

// ── Pull request link targets (apps/web/src/lib/openPullRequestLink.ts) ──

interface PreviewTarget {
  readonly environmentId: EnvironmentId;
  readonly input: PullRequestRef;
}

/** web resolvePullRequestPreviewTarget: a pull request URL a project on this environment reads. */
function resolvePullRequestPreviewTarget(environmentId: EnvironmentId | null, url: string): PreviewTarget | null {
  if (environmentId === null) return null;
  const capabilities = appAtomRegistry
    .get(pullRequestEnvironmentsAtom)
    .find((environment) => environment.environmentId === environmentId)?.serverConfig?.environment.capabilities;
  if (capabilities?.pullRequests !== true) return null;
  const parsed = parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const projects = (appAtomRegistry.get(environmentProjects.projectsAtom) as ReadonlyArray<EnvironmentProject>).filter(
    (candidate) => candidate.environmentId === environmentId,
  );
  const project = findProjectForChangeRequest(projects, parsed);
  if (project === undefined) return null;
  return {
    environmentId,
    input: {
      projectId: project.id as PullRequestRef["projectId"],
      host: parsed.authority ?? parsed.host,
      repository: sourceControlRepositorySelector(project.repositoryIdentity) ?? parsed.repository,
      number: parsed.number,
    },
  };
}

/** The link's preview target, and whether a click must confirm it is a pull request first. */
function previewTargetFor(href: string, autolink: string, context: PrLinkContext) {
  const confirmBeforeOpen = autolink === "reference";
  const candidate = confirmBeforeOpen ? pullRequestCandidateUrlFromReferenceAutolink(href) : href;
  const target = candidate ? resolvePullRequestPreviewTarget(context.environmentId, candidate) : null;
  return target === null ? null : { target, confirmBeforeOpen };
}

function openOrdinaryLink(href: string, context: PrLinkContext, alt: boolean) {
  activateExternalLink(href, context.threadRef, alt);
}

/** web PullRequestLinkPreview confirmBeforeOpen: a `#123` that is an issue opens as written. */
async function openConfirmedPullRequest(href: string, target: PreviewTarget, context: PrLinkContext) {
  const atom = pullRequestEnvironment.preview(target);
  const unmount = appAtomRegistry.mount(atom);
  try {
    await waitForAtomValue({ registry: appAtomRegistry, atom, predicate: (value) => !value.waiting, timeoutMs: 15_000 });
    const result = appAtomRegistry.get(atom);
    if (result._tag === "Success" && !isAtomCommandInterrupted(result as never)) {
      const url = (result.value as { url: string }).url;
      if (openChangeRequestLinkInApp(url, { threadRef: context.threadRef, environmentId: context.environmentId })) return;
    }
    openOrdinaryLink(href, context, false);
  } finally {
    unmount();
  }
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

// ── File links (web MarkdownFileLink, without a thread's Files panel on the page) ──

function openFileTarget(target: FileChipTarget, context: PrLinkContext, modifiers?: { ctrl: boolean; cmd: boolean }) {
  const environmentId = context.environmentId;
  const canEditor = environmentId !== null && canUseShellActions(environmentId);
  const wantsEditor =
    modifiers !== undefined &&
    shouldOpenMarkdownFileLinkInEditor({ ctrlKey: modifiers.ctrl, metaKey: modifiers.cmd }, process.platform === "darwin" ? "MacIntel" : "Win32");
  const relativePath = target.meta.workspaceRelativePath;
  if (!wantsEditor && context.threadRef && relativePath) {
    rightPanelActions.openFile(threadKeyOf(context.threadRef.environmentId, context.threadRef.threadId), relativePath, target.meta.line);
    return;
  }
  if (canEditor && environmentId) {
    void openFileInEditor(environmentId, target.meta, context.cwd);
    return;
  }
  toast({ type: "info", title: "Can't open this file here", description: target.meta.targetPath });
}

function fileContextMenu(target: FileChipTarget, context: PrLinkContext, position: { x: number; y: number }) {
  const environmentId = context.environmentId;
  const canEditor = environmentId !== null && canUseShellActions(environmentId);
  const reveal = canEditor && environmentId ? revealMenuLabel(environmentId) : undefined;
  const copyItems = markdownFileCopyMenuItems({ targetPath: target.meta.targetPath, workspaceRelativePath: target.meta.workspaceRelativePath });
  const items: ContextMenuItem<string>[] = [
    ...(canEditor && environmentId ? [{ id: "open", label: editorMenuLabel(environmentId) }] : []),
    ...(reveal ? [{ id: "reveal", label: reveal }] : []),
    ...copyItems.map(({ id, label }) => ({ id, label })),
  ];
  void showMarkdownContextMenu(items, position).then((clicked) => {
    if (clicked === "open" && environmentId) void openFileInEditor(environmentId, target.meta, context.cwd);
    if (clicked === "reveal" && environmentId) void revealFileInFileManager(environmentId, target.meta, context.cwd);
    const copyItem = copyItems.find((item) => item.id === clicked);
    if (copyItem) copyWithToast(copyItem.value, copyItem.title);
  });
}

function externalContextMenu(href: string, context: PrLinkContext, position: { x: number; y: number }) {
  const threadRef = context.threadRef;
  void showExternalLinkContextMenu({
    href,
    position,
    canOpenInPreview: canOpenInIntegratedBrowser(threadRef),
    showContextMenu: (items, at) => showMarkdownContextMenu(items as ContextMenuItem<string>[], at) as never,
    openInPreview: async (target) => {
      if (threadRef) await openUrlInIntegratedBrowser(threadRef, target);
    },
    openExternal: async (target) => openExternalUrl(target),
    copyLink: async (target) => copyWithToast(target, "Link"),
    updateThreadLink: async () => {},
    reportFailure: () => {},
  });
}

/** The `data-pull-request-autolink` flag of a link, which the tree carries as written. */
const autolinkByLink = new WeakMap<LinkEntry, string>();

function createActions(context: PrLinkContext): MarkdownActions {
  return {
    activateLink(entry, modifiers) {
      const kind = entry.kind;
      if (kind.kind === "file") {
        openFileTarget({ meta: kind.meta, label: kind.meta.basename, copyMarkdown: entry.href }, context, modifiers);
        return;
      }
      if (kind.kind !== "external" || entry.href.startsWith("#")) return;
      const external = modifiers.ctrl || modifiers.cmd;
      const preview = external ? null : previewTargetFor(entry.href, autolinkByLink.get(entry) ?? "", context);
      if (preview?.confirmBeforeOpen) {
        void openConfirmedPullRequest(entry.href, preview.target, context);
        return;
      }
      if (openChangeRequestLinkInApp(entry.href, { threadRef: context.threadRef, environmentId: context.environmentId, external })) return;
      openOrdinaryLink(entry.href, context, modifiers.alt);
    },
    linkContextMenu(entry, position) {
      const kind = entry.kind;
      if (kind.kind === "external" && kind.faviconHost) externalContextMenu(entry.href, context, position);
      if (kind.kind === "file") fileContextMenu({ meta: kind.meta, label: kind.meta.basename, copyMarkdown: entry.href }, context, position);
    },
  };
}

function createBoxes(context: PrLinkContext): InlineBoxRenderers {
  let nextId = 0;
  const id = (prefix: string) => `pr-${prefix}${nextId++}`;
  const lineWidth = (env: RenderEnv) => env.styles.body.size * 40;
  const plainChip = (prefix: string, label: string, env: RenderEnv, icon: ChipPayload["icon"]) =>
    chipAtom(id(prefix), { type: "chip", kind: "mention", label, icon }, env.styles.body, lineWidth(env));
  return {
    renderBox(atom: BoxAtom, env: RenderEnv, key: string, join: boolean): ReactNode {
      switch ((atom.payload as { type: string }).type) {
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
        fileMetadata: { environmentId: context.environmentId, path: target.meta.filePath, cwd: context.cwd },
      };
      return chipAtom(id("file"), payload, env.styles.body, lineWidth(env), link);
    },
    // Thread, context, citation and skill references belong to agent messages; a pull request
    // body that happens to hold one shows its label.
    threadChip: (_threadId, label, env) => plainChip("thread", label, env, { kind: "lucide", name: "messages-square" }),
    contextChip: () => null,
    citationChip: (_entry, env) => plainChip("cite", "Quote", env, { kind: "lucide", name: "quote" }),
    skillChip: (_skill, rawText, env) => plainChip("skill", rawText, env, { kind: "lucide", name: "zap" }),
    favicon: (host, link, env) => faviconAtom(id("fav"), host, env.styles.body, link),
    checkbox: (checked, env) => checkboxAtom(id("chk"), checked, env.styles.body, env.styles.listIndent),
    inlineMath: (tex, display, env, style) => inlineMathAtom(id("math"), tex, display, style, env.extent.root),
    inlineImage: (node, env, style) => inlineImageAtom(id("img"), node, style, env.extent.root),
  };
}

// ── Images (web ChatMarkdown `githubMedia`) ──

function resolveProtocolRelative(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

/** A GitHub upload loads through the server, which holds the repository's credential. */
const PrMarkdownImage = memo(function PrMarkdownImage({
  node,
  width,
  env,
  context,
}: {
  node: Element;
  width: number;
  env: RenderEnv;
  context: PrLinkContext;
}) {
  const theme = useTheme();
  const src = resolveProtocolRelative(String(node.properties.src ?? ""));
  const fetchUrl = context.environmentId !== null && context.cwd ? githubMediaFetchUrl(src) : null;
  const asset = useTimelineAssetUrl(
    context.environmentId ?? ("" as EnvironmentId),
    fetchUrl !== null && context.cwd ? { _tag: "github-media", cwd: context.cwd, url: fetchUrl } : null,
  );
  if (fetchUrl === null) return <MarkdownImage node={node} width={width} env={env} />;
  // web: the direct URL when the server cannot fetch it (a public upload still loads).
  const resolved = asset._tag === "Success" ? asset.url : asset._tag === "Failure" ? fetchUrl : null;
  if (resolved === null) {
    const placeholder = Math.min(width, 480);
    return (
      <div
        style={{
          width: placeholder,
          height: (placeholder * 9) / 16,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.4),
          backgroundColor: alpha(theme.muted, 0.6),
        }}
      />
    );
  }
  // The viewer steps through the body's images by URL: name this one by where it loads from.
  for (const item of env.media.gallery) if (item.src === src) item.src = resolved;
  return <MarkdownImage node={{ ...node, properties: { ...node.properties, src: resolved } }} width={width} env={env} />;
});

function createBlocks(context: PrLinkContext): BlockRenderers {
  return {
    codeBlock: ({ code, language, meta, width, env, key }) => (
      <MarkdownCodeBlock key={key} code={code} language={language} meta={meta} width={width} styles={env.styles} isStreaming={false} />
    ),
    mathBlock: ({ tex, width, env, key }) => <MathBlock key={key} tex={tex} width={width} styles={env.styles} />,
    mermaid: ({ code, meta, width, env, key }) => <MermaidBlock key={key} code={code} meta={meta} width={width} env={env} isStreaming={false} />,
    table: ({ node, width, env, key }) => <MarkdownTable key={key} node={node} width={width} env={env} />,
    details: ({ node, width, env, key }) => <MarkdownDetails key={key} node={node} width={width} env={env} />,
    image: ({ node, width, env, key }) => <PrMarkdownImage key={key} node={node} width={width} env={env} context={context} />,
  };
}

// ── Autolinks ──

/**
 * The source rewrite turns `#123` and SHAs into plain markdown links; mark them the way web's
 * remark plugin does (`data-pull-request-autolink`), so they show no favicon, a SHA sets in mono,
 * and a reference confirms before it opens.
 */
function markAutolinks(tree: Root, repositoryUrl: string | null): Root {
  if (repositoryUrl === null) return tree;
  const base = repositoryUrl.replace(/\/+$/u, "");
  const visit = (nodes: ReadonlyArray<ElementContent | Root["children"][number]>) => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.tagName === "a") {
        const href = String(node.properties.href ?? "");
        const text = node.children.length === 1 && node.children[0]?.type === "text" ? node.children[0].value : null;
        if (text !== null && /^#[1-9]\d*$/u.test(text) && href === `${base}/issues/${text.slice(1)}`) {
          node.properties.dataPullRequestAutolink = "reference";
        } else if (text !== null && /^[0-9a-f]{7}$/iu.test(text) && href.startsWith(`${base}/commit/${text}`)) {
          node.properties.dataPullRequestAutolink = "commit";
        }
      }
      visit(node.children);
    }
  };
  visit(tree.children);
  return tree;
}

// ── Hover preview (web PullRequestLinkPreview) ──

/** web PreviewCardTrigger delay / closeDelay. */
const PREVIEW_OPEN_DELAY = 350;
const PREVIEW_CLOSE_DELAY = 120;

function PullRequestPreviewCard({
  href,
  target,
  position,
  onHover,
}: {
  href: string;
  target: PreviewTarget | null;
  position: { x: number; y: number };
  onHover: (hovered: boolean) => void;
}) {
  const theme = useTheme();
  const detailQuery = useEnvironmentQuery(target ? pullRequestEnvironment.detail(target) : null);
  const detail = detailQuery.data;
  // web: no card while it loads; a failed or non-pull-request preview shows the URL.
  if (target !== null && detail === null && detailQuery.error === null) return null;
  const state = detail === null ? null : resolvePullRequestState({ state: detail.state, isDraft: detail.isDraft });
  const authorLabel =
    detail === null
      ? null
      : detail.author === null
        ? "ghost"
        : detail.author.name && detail.author.name !== detail.author.login
          ? `${detail.author.name} (@${detail.author.login})`
          : detail.author.login;
  const muted = theme.mutedForeground;
  return (
    <anchored
      position={{ x: position.x, y: position.y + 16 }}
      anchor="topLeft"
      fit="snap"
      snapMargin={8}
      deferred
      priority={2}
      style={{ backgroundColor: "transparent", borderRadius: RADIUS.lg }}
    >
      <div
        testId={detail === null ? "pr-link-url-tooltip" : "pr-link-preview"}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        style={
          detail === null
            ? { ...surfaceStyle(theme), display: "flex", paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, maxWidth: 320, borderRadius: RADIUS.md }
            : { ...surfaceStyle(theme), display: "flex", flexDirection: "column", width: 320, padding: 12 }
        }
      >
        {detail === null ? (
          <text style={{ color: theme.foreground, fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16 }}>{href}</text>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
              <text style={{ color: muted, fontFamily: FONTS.sans, fontSize: 11, lineHeight: 16, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>
                {detail.repository}
              </text>
              <text style={{ color: muted, fontFamily: FONTS.sans, fontSize: 11, lineHeight: 16, flexShrink: 0 }}>{`#${detail.number}`}</text>
              <text style={{ color: muted, fontFamily: FONTS.sans, fontSize: 11, lineHeight: 16, flexShrink: 0 }}>·</text>
              {state ? (
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <Icon name={state.icon} size={12} color={state.tone(theme)} />
                  <text style={{ color: muted, fontFamily: FONTS.sans, fontSize: 11, lineHeight: 16 }}>{state.label}</text>
                </div>
              ) : null}
            </div>
            <text style={{ color: theme.foreground, fontFamily: FONTS.sans, fontSize: 14, lineHeight: 19, fontWeight: 500, marginTop: 4 }}>{detail.title}</text>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, minWidth: 0 }}>
              <PullRequestActorAvatar actor={detail.author} size={16} />
              <text style={{ color: muted, fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>
                {authorLabel ?? ""}
              </text>
              <text style={{ color: muted, fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, flexShrink: 0 }}>·</text>
              <text style={{ color: muted, fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, flexShrink: 0 }}>
                {`opened ${formatRelativeTimeLabel(detail.createdAt)}`}
              </text>
            </div>
          </>
        )}
      </div>
    </anchored>
  );
}

/** Opens the preview a beat after a link is hovered, and keeps it while the card is hovered. */
function useLinkPreview(hover: HoverStore, links: () => ReadonlyArray<LinkEntry>, context: PrLinkContext) {
  const hovered = useSyncExternalStore(hover.subscribe, hover.get, hover.get);
  const pointer = useRef({ x: 0, y: 0 });
  const [open, setOpen] = useState<{ readonly href: string; readonly target: PreviewTarget | null; readonly x: number; readonly y: number } | null>(null);
  const cardHovered = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const entry = hovered >= 0 ? links()[hovered] : undefined;
    if (entry === undefined || entry.kind.kind !== "external" || !entry.kind.faviconHost) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => {
        if (!cardHovered.current) setOpen(null);
      }, PREVIEW_CLOSE_DELAY);
      return;
    }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const preview = previewTargetFor(entry.href, autolinkByLink.get(entry) ?? "", context);
    const timer = setTimeout(
      () => setOpen({ href: entry.href, target: preview?.target ?? null, x: pointer.current.x, y: pointer.current.y }),
      PREVIEW_OPEN_DELAY,
    );
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react/exhaustive-deps -- follows the hovered link only
  }, [hovered]);
  const onCardHover = (next: boolean) => {
    cardHovered.current = next;
    if (!next && hover.get() < 0) setOpen(null);
  };
  return { open, pointer, onCardHover };
}

// ── The component ──

/** Last measured width per text size, so a remount lays out at the right width at once. */
const lastWidths = new Map<number, number>();

export const PrRichMarkdown = memo(function PrRichMarkdown({ source, size = 14 }: { source: string; size?: number }) {
  const palette = useTheme();
  const textSize = size <= 12 ? 12 : 14;
  const styles = markdownStyles(palette, "assistant", textSize);
  const epoch = useTextMetricsEpoch();
  const asyncEpoch = useSyncExternalStore(subscribeAsyncLayout, asyncLayoutEpoch, asyncLayoutEpoch);
  const mathEnabled = useClientSettings((settings) => settings.mathRenderingEnabled);
  const markdownContext = useContext(PullRequestMarkdownContext);
  const repositoryUrl = markdownContext?.repositoryUrl ?? null;
  const context = useMemo<PrLinkContext>(
    () => ({
      threadRef: markdownContext?.threadRef ?? null,
      environmentId: markdownContext?.environmentId ?? null,
      cwd: markdownContext?.cwd ?? undefined,
    }),
    [markdownContext?.threadRef, markdownContext?.environmentId, markdownContext?.cwd],
  );
  const [measured, setMeasured] = useState(() => lastWidths.get(textSize) ?? 0);
  const [hover] = useState(() => new HoverStore());
  const linksRef = useRef<ReadonlyArray<LinkEntry>>([]);
  const text = autolinkPullRequestMarkdown(source, repositoryUrl);
  const tree = markAutolinks(parseChatMarkdown(text, { lineBreaks: false, math: mathEnabled, rawHtml: true }), repositoryUrl);
  const handlers = useMemo(
    () => ({ actions: createActions(context), boxes: createBoxes(context), blocks: createBlocks(context) }),
    [context],
  );
  const rendered = useMemo(() => {
    if (measured <= 0) return null;
    const env: RenderEnv = {
      styles,
      index: messageLinkIndex(text, context.cwd),
      links: [],
      hover,
      actions: handlers.actions,
      boxes: handlers.boxes,
      blocks: handlers.blocks,
      mathEnabled,
      skills: [],
      extent: { width: 0, root: measured },
      media: { environmentId: context.environmentId, threadId: (context.threadRef?.threadId ?? null) as ThreadId | null, cwd: context.cwd, gallery: [] },
      isStreaming: false,
      source: text,
    };
    const nodes = renderDocument(tree, measured, env);
    return { nodes, links: env.links };
    // epoch: new text metrics re-lay out lines measured with estimates.
  }, [tree, measured, styles, text, context, hover, handlers, mathEnabled, epoch, asyncEpoch]);
  linksRef.current = rendered?.links ?? [];
  // Which links are autolinks, read from the hast node each link entry came from (in order).
  if (rendered) tagAutolinkEntries(tree, rendered.links);
  const preview = useLinkPreview(hover, () => linksRef.current, context);
  return (
    <div
      testId="pr-markdown"
      onLayout={(event) => {
        const next = event.width ?? 0;
        if (next > 0) lastWidths.set(textSize, next);
        if (next > 0 && Math.abs(next - measured) > 0.5) setMeasured(next);
      }}
      // Pointer position for the preview card; a move listener alone does not capture.
      onMouseMove={(event) => {
        preview.pointer.current = { x: Number(event.x ?? 0), y: Number(event.y ?? 0) };
      }}
      style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, flexGrow: 1 }}
    >
      {rendered?.nodes}
      {preview.open ? (
        <PullRequestPreviewCard
          key={preview.open.href}
          href={preview.open.href}
          target={preview.open.target}
          position={preview.open}
          onHover={preview.onCardHover}
        />
      ) : null}
    </div>
  );
});

/** Pairs each registered external link with its anchor's autolink flag, in document order. */
function tagAutolinkEntries(tree: Root, links: ReadonlyArray<LinkEntry>) {
  const flags = new Map<string, string>();
  const visit = (nodes: ReadonlyArray<ElementContent | Root["children"][number]>) => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.tagName === "a" && node.properties.dataPullRequestAutolink) {
        flags.set(String(node.properties.href ?? ""), String(node.properties.dataPullRequestAutolink));
      }
      visit(node.children);
    }
  };
  visit(tree.children);
  for (const entry of links) {
    const flag = flags.get(entry.href);
    if (flag) autolinkByLink.set(entry, flag);
  }
}
