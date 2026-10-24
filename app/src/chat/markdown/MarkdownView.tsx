// HAST → gpuix elements, tag by tag like web's CHAT_MARKDOWN_COMPONENTS
// (apps/web/src/components/ChatMarkdown.tsx) styled by the `.chat-markdown`
// CSS (index.css 1787-2185).
//
// Blocks are flex columns whose gaps reproduce CSS margin collapsing (adjacent
// margins take the larger; a container without top/bottom padding passes its
// first/last child's margin out). Inline content goes through inline.ts and
// paints as rows of nowrap runs.
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import type { Element, ElementContent, Root } from "hast";
import { cloneElement, Fragment, isValidElement, memo, useSyncExternalStore, type ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { FONTS, alpha } from "../../ui/theme.ts";
import { hastHasText, hastPlainTextDeep, plainHastText } from "../../web/components/chat/markdownHast.logic.ts";
import { layoutInline, type BoxAtom, type InlineAtom, type InlineLine, type RunStyle } from "./inline.ts";
import {
  classifyLink,
  fileChipTarget,
  fileLinkShowsLabel,
  inlineCodeFileMeta,
  inlineCodeMediaSource,
  type FileChipTarget,
  type LinkKind,
  type MessageLinkIndex,
} from "./links.ts";
import { matchInlineSkills, type InlineSkill } from "@t3tools/shared/inlineSkills";
import { parseComposerContextHref } from "@t3tools/shared/composerContextReferences";
import { JOIN } from "./copy.ts";
import { textWidth } from "./measure.ts";
import { baselineOffset, deriveRun, fontAscent, fontLineHeight, xHeight, type MarkdownStyles } from "./styles.ts";

export function fontFamilyOf(style: RunStyle): string {
  return style.face.family === "mono" ? FONTS.mono : FONTS.sans;
}

// ── Environment ─────────────────────────────────────────────────────────

export interface LinkEntry {
  readonly href: string;
  readonly kind: LinkKind;
}

/** Hovered link per document: every run of a link underlines together. */
export class HoverStore {
  private hovered = -1;
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  get = () => this.hovered;
  set(index: number) {
    if (this.hovered === index) return;
    this.hovered = index;
    for (const listener of this.listeners) listener();
  }
}

export interface MarkdownActions {
  activateLink(entry: LinkEntry, modifiers: { ctrl: boolean; cmd: boolean; shift: boolean; alt: boolean }): void;
  linkContextMenu(entry: LinkEntry, position: { x: number; y: number }): void;
}

export interface InlineBoxRenderers {
  /** Paints a box atom (chips, favicons, checkboxes, inline math, images). */
  renderBox(atom: BoxAtom, env: RenderEnv, key: string, join: boolean): ReactNode;
  /** Measures and builds the box atom for an inline payload. */
  fileChip(target: FileChipTarget, env: RenderEnv, link: number | undefined): BoxAtom;
  threadChip(threadId: string, label: string, env: RenderEnv): BoxAtom;
  contextChip(kind: string, contextId: string, label: string, env: RenderEnv): BoxAtom | null;
  citationChip(entry: LinkEntry, env: RenderEnv): BoxAtom;
  favicon(host: string, link: number, env: RenderEnv): BoxAtom;
  checkbox(checked: boolean, env: RenderEnv): BoxAtom;
  skillChip(skill: InlineSkill, rawText: string, env: RenderEnv): BoxAtom;
  inlineMath(tex: string, display: boolean, env: RenderEnv, style: RunStyle): BoxAtom | null;
  inlineImage(node: Element, env: RenderEnv, style: RunStyle): BoxAtom | null;
}

export interface BlockRenderers {
  codeBlock(input: { code: string; language: string; meta: string | undefined; width: number; env: RenderEnv; key: string }): ReactNode;
  mathBlock(input: { tex: string; width: number; env: RenderEnv; key: string }): ReactNode;
  mermaid(input: { code: string; meta: string | undefined; width: number; env: RenderEnv; key: string }): ReactNode;
  table(input: { node: Element; width: number; env: RenderEnv; key: string }): ReactNode;
  details(input: { node: Element; width: number; env: RenderEnv; key: string }): ReactNode;
  image(input: { node: Element; width: number; env: RenderEnv; key: string }): ReactNode;
}

export interface RenderEnv {
  readonly styles: MarkdownStyles;
  readonly index: MessageLinkIndex;
  readonly links: LinkEntry[];
  readonly hover: HoverStore;
  readonly actions: MarkdownActions;
  readonly boxes: InlineBoxRenderers;
  readonly blocks: BlockRenderers;
  readonly mathEnabled: boolean;
  readonly skills: ReadonlyArray<InlineSkill>;
  /** Widest laid-out content, for shrink-to-fit placements (user bubbles). */
  readonly extent: { width: number; readonly root: number };
  /** Where media resolves from, and the message's images in order for the viewer. */
  readonly media: {
    readonly environmentId: EnvironmentId | null;
    readonly threadId: ThreadId | null;
    readonly cwd: string | undefined;
    readonly gallery: Array<{ src: string; name: string }>;
  };
  readonly isStreaming: boolean;
}

// ── Blocks ──────────────────────────────────────────────────────────────

export interface Block {
  readonly node: ReactNode;
  readonly mt: number;
  readonly mb: number;
}

export interface FlowCtx {
  /** Inherited run style (colour changes inside blockquotes). */
  readonly body: RunStyle;
  readonly ulDepth: number;
  readonly olDepth: number;
}

const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
  "wbr",
  "video",
]);

function isWhitespaceText(node: ElementContent): boolean {
  return node.type === "text" && node.value.trim().length === 0;
}

function isInlineNode(node: ElementContent): boolean {
  if (node.type === "text") return true;
  if (node.type === "element") return INLINE_TAGS.has(node.tagName);
  return false;
}

export function className(node: Element): string {
  const value = node.properties.className;
  return Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
}

/**
 * Lays blocks out in a column. Gaps are the collapsed margins between
 * neighbours; the first child's top margin and the last child's bottom margin
 * are returned for the container to pass out (or drop).
 */
/** Components that take a `marginTop` prop and put it on their root, so a gap costs no wrapper element. */
export const MARGIN_AWARE = new Set<unknown>();

function withMarginTop(node: ReactNode, gap: number, key: string): ReactNode {
  if (isValidElement<{ style?: object; marginTop?: number }>(node)) {
    if (typeof node.type === "string") return cloneElement(node, { key, style: { ...node.props.style, marginTop: gap } });
    if (MARGIN_AWARE.has(node.type)) return cloneElement(node, { key, marginTop: gap });
  }
  return (
    <div key={key} style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: gap }}>
      {node}
    </div>
  );
}

/**
 * Lays blocks out in a column. Gaps are the collapsed margins between
 * neighbours; the first child's top margin and the last child's bottom margin
 * are returned for the container to pass out (or drop).
 */
export function stack(blocks: Block[]): { nodes: ReactNode[]; firstMt: number; lastMb: number } {
  const nodes: ReactNode[] = [];
  blocks.forEach((block, index) => {
    const gap = index === 0 ? 0 : Math.max(blocks[index - 1]!.mb, block.mt);
    nodes.push(gap > 0 ? withMarginTop(block.node, gap, `g${index}`) : <Fragment key={`b${index}`}>{block.node}</Fragment>);
  });
  return { nodes, firstMt: blocks[0]?.mt ?? 0, lastMb: blocks[blocks.length - 1]?.mb ?? 0 };
}

function column(nodes: ReactNode[], extra?: object): ReactNode {
  return <div style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, ...extra }}>{nodes}</div>;
}

/** Renders a run of block-level children, wrapping stray inline content in anonymous paragraphs. */
export function renderFlow(children: ReadonlyArray<ElementContent>, width: number, env: RenderEnv, ctx: FlowCtx, keyPrefix: string): Block[] {
  const blocks: Block[] = [];
  let inline: ElementContent[] = [];
  const flushInline = () => {
    if (inline.length === 0) return;
    const nodes = inline;
    inline = [];
    if (nodes.every(isWhitespaceText)) return;
    blocks.push({ node: renderParagraph(nodes, width, env, ctx.body, `${keyPrefix}i${blocks.length}`, true), mt: 0, mb: 0 });
  };
  children.forEach((child, index) => {
    if (isInlineNode(child)) {
      inline.push(child);
      return;
    }
    flushInline();
    if (child.type !== "element") return;
    const block = renderBlock(child, width, env, ctx, `${keyPrefix}${index}`);
    if (block) blocks.push(block);
  });
  flushInline();
  return blocks;
}

const ALERTS: Record<string, { label: string; icon: IconName; dark: [string, string]; light: [string, string] }> = {
  // [border (500 at 70%), title (dark 400 / light 600)]
  note: { label: "Note", icon: "info", dark: ["#2b7fff", "#51a2ff"], light: ["#2b7fff", "#155dfc"] },
  tip: { label: "Tip", icon: "lightbulb", dark: ["#00bc7d", "#00d492"], light: ["#00bc7d", "#009966"] },
  important: { label: "Important", icon: "message-square-warning", dark: ["#ad46ff", "#c27aff"], light: ["#ad46ff", "#9810fa"] },
  warning: { label: "Warning", icon: "triangle-alert", dark: ["#fe9a00", "#fe9a00"], light: ["#fe9a00", "#e17100"] },
  caution: { label: "Caution", icon: "octagon-alert", dark: ["#fb2c36", "#ff6467"], light: ["#fb2c36", "#e7000b"] },
};

/** Blocks that take the whole width (cards, tables, rules) make a shrink-to-fit container take it all. */
const FULL_WIDTH_BLOCKS = new Set(["pre", "table", "details", "hr", "section"]);

function renderBlock(node: Element, width: number, env: RenderEnv, ctx: FlowCtx, key: string): Block | null {
  const { styles } = env;
  if (FULL_WIDTH_BLOCKS.has(node.tagName)) env.extent.width = env.extent.root;
  switch (node.tagName) {
    case "p": {
      // A paragraph holding only an image is a standalone figure.
      const image = standaloneImage(node);
      if (image) {
        const source = classifyMarkdownImageSource(String(image.properties.src ?? ""), null);
        if (source._tag === "Direct") {
          env.media.gallery.push({ src: source.uri.startsWith("//") ? `https:${source.uri}` : source.uri, name: String(image.properties.alt ?? "").trim() || "image" });
        }
        return { node: env.blocks.image({ node: image, width, env, key }), mt: styles.blockMargin, mb: styles.blockMargin };
      }
      return { node: renderParagraph(node.children, width, env, ctx.body, key, true), mt: styles.blockMargin, mb: styles.blockMargin };
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(node.tagName[1]);
      const size = styles.headingSizes[Math.min(level, 4) - 1]!;
      const run = deriveRun(ctx.body, {
        face: { family: "sans", weight: 600 },
        size,
        lineHeight: size * 1.3,
        color: level === 6 ? styles.mutedColor : styles.headingColor,
      });
      return { node: renderParagraph(node.children, width, env, run, key), mt: styles.headingMarginTop, mb: styles.headingMarginBottom };
    }
    case "ul":
    case "ol":
      return renderList(node, width, env, ctx, key);
    case "blockquote": {
      const alertKey = String(node.properties.dataAlert ?? "");
      const alert = ALERTS[alertKey];
      if (alert) return renderAlert(node, alert, width, env, ctx, key);
      const inner = width - styles.quoteBorder - styles.quotePadding;
      const quoteCtx: FlowCtx = { ...ctx, body: deriveRun(ctx.body, { color: styles.mutedColor }) };
      const { nodes, firstMt, lastMb } = stack(renderFlow(node.children, inner, env, quoteCtx, `${key}q`));
      return {
        node: column(nodes, {
          borderLeftWidth: styles.quoteBorder,
          borderColor: styles.border,
          paddingLeft: styles.quotePadding,
        }),
        mt: Math.max(styles.blockMargin, firstMt),
        mb: Math.max(styles.blockMargin, lastMb),
      };
    }
    case "hr":
      return { node: <div key={key} style={{ height: 1, width: "100%", backgroundColor: styles.border }} />, mt: 0, mb: 0 };
    case "pre": {
      const code = node.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
      if (!code) return { node: renderParagraph(node.children, width, env, ctx.body, key), mt: styles.blockMargin, mb: styles.blockMargin };
      const codeClass = className(code);
      const language = /(?:^|\s)language-([^\s]+)/.exec(codeClass)?.[1] ?? "text";
      const source = hastPlainTextDeep(code);
      if (env.mathEnabled && (language === "math" || /\bmath-display\b/.test(codeClass))) {
        return { node: env.blocks.mathBlock({ tex: source, width, env, key }), mt: styles.blockMargin, mb: styles.blockMargin };
      }
      const meta = typeof code.properties.dataCodeMeta === "string" ? code.properties.dataCodeMeta : undefined;
      return {
        node:
          language === "mermaid"
            ? env.blocks.mermaid({ code: source, meta, width, env, key })
            : env.blocks.codeBlock({ code: source, language: language === "gitignore" ? "ini" : language, meta, width, env, key }),
        mt: styles.blockMargin,
        mb: styles.blockMargin,
      };
    }
    case "table":
      return { node: env.blocks.table({ node, width, env, key }), mt: styles.blockMargin, mb: styles.blockMargin };
    case "details":
      // MarkdownDetails: my-2
      return { node: env.blocks.details({ node, width, env, key }), mt: 8, mb: 8 };
    case "section": {
      // Footnotes: mt 1.25rem, border-top, pt 0.75rem, muted, 0.75rem text.
      const footCtx: FlowCtx = { ...ctx, body: deriveRun(ctx.body, { color: styles.mutedColor, size: 12, lineHeight: 12 * 1.625 }) };
      const { nodes } = stack(renderFlow(node.children, width, env, footCtx, `${key}f`));
      return { node: column(nodes, { borderTopWidth: 1, borderColor: styles.border, paddingTop: 12 }), mt: 20, mb: 0 };
    }
    case "summary":
      return { node: renderParagraph(node.children, width, env, ctx.body, key), mt: 0, mb: 0 };
    default: {
      // div, figure, center, dl and anything else block-level: a plain container.
      const { nodes, firstMt, lastMb } = stack(renderFlow(node.children, width, env, ctx, `${key}d`));
      if (nodes.length === 0) return null;
      return { node: column(nodes), mt: firstMt, mb: lastMb };
    }
  }
}

function standaloneImage(node: Element): Element | null {
  const meaningful = node.children.filter((child) => !isWhitespaceText(child));
  if (meaningful.length !== 1) return null;
  const only = meaningful[0]!;
  if (only.type === "element" && only.tagName === "img" && only.properties.dataStandalone) {
    return typeof only.properties.src === "string" && parseComposerContextHref(only.properties.src) ? null : only;
  }
  return null;
}

function renderAlert(
  node: Element,
  alert: (typeof ALERTS)[string],
  width: number,
  env: RenderEnv,
  ctx: FlowCtx,
  key: string,
): Block {
  const { styles } = env;
  const [border, title] = styles.palette.appearance === "dark" ? alert.dark : alert.light;
  const inner = width - 2 - 12;
  const titleRun = deriveRun(ctx.body, { face: { family: "sans", weight: 500 }, color: title });
  const titleRow = (
    <div key="t" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: styles.lineHeight, userSelect: "none" }}>
      <Icon name={alert.icon} size={14} color={title} />
      <text style={{ fontFamily: fontFamilyOf(titleRun), fontSize: titleRun.size, fontWeight: 500, lineHeight: styles.lineHeight, color: title, whiteSpace: "nowrap" }}>{alert.label}</text>
    </div>
  );
  const body = renderFlow(node.children, inner, env, ctx, `${key}a`);
  // The title is a <p>: its 0.65rem margins collapse with the alert's my-1.
  const { nodes, lastMb } = stack([{ node: titleRow, mt: styles.blockMargin, mb: styles.blockMargin }, ...body]);
  return {
    node: column(nodes, { borderLeftWidth: 2, borderColor: alpha(border, 0.7), paddingLeft: 12 }),
    mt: Math.max(4, styles.blockMargin),
    mb: Math.max(4, lastMb),
  };
}

// ── Lists ───────────────────────────────────────────────────────────────

function toAlpha(value: number): string {
  let out = "";
  let n = value;
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function toRoman(value: number): string {
  const numerals: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let n = value;
  for (const [amount, numeral] of numerals) {
    while (n >= amount) {
      out += numeral;
      n -= amount;
    }
  }
  return out;
}

function renderList(node: Element, width: number, env: RenderEnv, ctx: FlowCtx, key: string): Block {
  const { styles } = env;
  const ordered = node.tagName === "ol";
  const items = node.children.filter((child): child is Element => child.type === "element" && child.tagName === "li");
  const start = ordered ? Number.parseInt(String(node.properties.start ?? 1), 10) || 1 : 1;
  const olDepth = ordered ? ctx.olDepth + 1 : ctx.olDepth;
  const ulDepth = ordered ? ctx.ulDepth : ctx.ulDepth + 1;
  const markerFor = (index: number) => {
    const n = start + index;
    if (!ordered) return null;
    const style = olDepth === 2 ? toAlpha(n) : olDepth >= 3 ? toRoman(n) : String(n);
    return `${style}.`;
  };
  // ChatMarkdown's `ol` widens --list-gutter to (marker chars + 2)ch for multi-digit markers.
  let indent = styles.listIndent;
  if (ordered && olDepth === 1) {
    const last = start + Math.max(items.length - 1, 0);
    const markerWidth = Math.max(String(start).length, String(last).length);
    if (markerWidth > 1) indent = (markerWidth + 2) * textWidth(ctx.body.face, ctx.body.size, "0");
  }
  const inner = width - indent;
  const childCtx: FlowCtx = { ...ctx, olDepth, ulDepth };
  const rows: Block[] = items.map((item, index) => {
    const isTask = /\btask-list-item\b/.test(className(item));
    const content = renderFlow(item.children, inner, env, childCtx, `${key}l${index}`);
    const { nodes, firstMt, lastMb } = stack(content);
    const marker = isTask ? null : listMarker(markerFor(index), ulDepth, indent, env, ctx.body);
    return {
      node: (
        <div style={{ display: "flex", flexDirection: "row", width: "100%" }}>
          <div style={{ width: indent, flexShrink: 0, position: "relative", userSelect: "none" }}>{marker}</div>
          {column(nodes, { flexGrow: 1, flexShrink: 1, flexBasis: 0, width: undefined })}
        </div>
      ),
      // li + li { margin-top: 0.25rem }; a loose item's paragraph margins collapse through the li.
      mt: Math.max(index > 0 ? styles.listItemGap : 0, firstMt),
      mb: lastMb,
    };
  });
  const { nodes, firstMt, lastMb } = stack(rows);
  // ul/ol margins collapse with the first and last items' margins.
  const nested = ctx.ulDepth + ctx.olDepth > 0;
  const own = nested ? 0 : styles.blockMargin;
  return { node: column(nodes), mt: Math.max(own, firstMt), mb: Math.max(own, lastMb) };
}

function listMarker(ordered: string | null, ulDepth: number, indent: number, env: RenderEnv, body: RunStyle): ReactNode {
  const baseline = baselineOffset("sans", body.size, body.lineHeight);
  if (ordered !== null) {
    // Outside marker "1. ": its end (after the space) touches the content.
    const space = textWidth(body.face, body.size, " ");
    return (
      <text
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: indent - space,
          textAlign: "right",
          whiteSpace: "nowrap",
          fontSize: body.size,
          lineHeight: body.lineHeight,
          color: body.color,
          fontFamily: fontFamilyOf(body),
        }}
      >
        {ordered}
      </text>
    );
  }
  // Chrome paints disc/circle/square markers as shapes ~0.36em wide, 17px
  // left of the content at 14px, centred ~0.39em above the baseline.
  const size = body.size * 0.357;
  const left = indent - body.size * 1.214;
  const top = baseline - body.size * 0.39 - size / 2;
  const kind = ulDepth <= 1 ? "disc" : ulDepth === 2 ? "circle" : "square";
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        borderRadius: kind === "square" ? 0 : size / 2,
        backgroundColor: kind === "circle" ? "#00000000" : body.color,
        borderWidth: kind === "circle" ? 1 : 0,
        borderColor: body.color,
      }}
    />
  );
}

// ── Inline ──────────────────────────────────────────────────────────────

function bolder(weight: number): number {
  if (weight < 400) return 400;
  if (weight < 600) return 700;
  return 900;
}

function collapseWhitespace(value: string): string {
  return value.replace(/[ \t\n\r\f]+/g, " ");
}

interface InlineCollect {
  readonly atoms: InlineAtom[];
  readonly env: RenderEnv;
  /** Link index of the enclosing <a>, so images inside links do not open the lightbox. */
  readonly link: number | undefined;
  /** SkillInlineText: `$skill` tokens in paragraph and list text become chips (not inside code or links). */
  readonly skills: boolean;
}

function pushText(out: InlineCollect, text: string, style: RunStyle) {
  if (text.length > 0) out.atoms.push({ kind: "text", text, style });
}

function pushSkillText(out: InlineCollect, text: string, style: RunStyle) {
  let cursor = 0;
  for (const { start, end, skill, rawText } of matchInlineSkills(text, out.env.skills)) {
    if (start > cursor) pushText(out, text.slice(cursor, start), style);
    out.atoms.push(out.env.boxes.skillChip(skill, rawText, out.env));
    cursor = end;
  }
  if (cursor < text.length) pushText(out, text.slice(cursor), style);
}

function collectInline(nodes: ReadonlyArray<ElementContent>, style: RunStyle, out: InlineCollect) {
  for (const node of nodes) {
    if (node.type === "text") {
      const value = collapseWhitespace(node.value);
      if (out.skills && out.link === undefined && out.env.skills.length > 0) pushSkillText(out, value, style);
      else pushText(out, value, style);
      continue;
    }
    if (node.type !== "element") continue;
    collectElement(node, style, out);
  }
}

function collectElement(node: Element, style: RunStyle, out: InlineCollect) {
  const { env } = out;
  const { styles } = env;
  switch (node.tagName) {
    case "strong":
    case "b":
      collectInline(node.children, deriveRun(style, { face: { ...style.face, weight: bolder(style.face.weight) } }), out);
      return;
    case "em":
    case "i":
    case "cite":
    case "dfn":
    case "var":
      collectInline(node.children, deriveRun(style, { italic: true }), out);
      return;
    case "del":
    case "s":
    case "strike":
      collectInline(node.children, deriveRun(style, { decoration: "line-through" }), out);
      return;
    case "u":
    case "ins":
      collectInline(node.children, deriveRun(style, { decoration: "underline" }), out);
      return;
    case "kbd":
    case "samp":
    case "tt":
      collectInline(node.children, deriveRun(style, { face: { family: "mono", weight: style.face.weight } }), out);
      return;
    case "sub":
    case "sup":
    case "small":
      collectInline(node.children, deriveRun(style, { size: style.size * (node.tagName === "small" ? 0.833 : 0.75) }), out);
      return;
    case "br":
      out.atoms.push({ kind: "break" });
      return;
    case "wbr":
      return;
    case "code":
      collectCode(node, style, out);
      return;
    case "a":
      collectLink(node, style, out);
      return;
    case "input": {
      if (node.properties.type === "checkbox") out.atoms.push(env.boxes.checkbox(Boolean(node.properties.checked), env));
      return;
    }
    case "img": {
      // web's img renderer: `![label](t3-context://...)` is a context reference, not media.
      const reference = typeof node.properties.src === "string" ? parseComposerContextHref(node.properties.src) : null;
      if (reference) {
        const label = String(node.properties.alt ?? "") || reference.contextId;
        const chip = env.boxes.contextChip(reference.kind, reference.contextId, label, env);
        if (chip) out.atoms.push(chip);
        else pushText(out, label, style);
        return;
      }
      const box = env.boxes.inlineImage(node, env, style);
      if (box) out.atoms.push(box);
      else pushText(out, String(node.properties.alt ?? ""), style);
      return;
    }
    default:
      void styles;
      collectInline(node.children, style, out);
  }
}

function collectCode(node: Element, style: RunStyle, out: InlineCollect) {
  const { env } = out;
  const { styles } = env;
  const classes = className(node);
  const text = hastPlainTextDeep(node);
  if (env.mathEnabled && /\bmath-(inline|display)\b/.test(classes)) {
    // MarkdownMath: `$$...$$` inside a paragraph is still display math, a centred
    // block of its own. Until the formula renders, and when it cannot, its TeX
    // source shows instead (web's fallback), never a code pill.
    const display = /\bmath-display\b/.test(classes);
    const tex = text.trim();
    const box = env.boxes.inlineMath(tex, display, env, style);
    if (display) out.atoms.push({ kind: "break" });
    if (box) out.atoms.push(box);
    else if (display) {
      pushText(out, "\\[", style);
      for (const line of tex.split("\n")) {
        out.atoms.push({ kind: "break" });
        pushText(out, line, style);
      }
      out.atoms.push({ kind: "break" });
      pushText(out, "\\]", style);
    } else pushText(out, `\\(${tex}\\)`, style);
    if (display) out.atoms.push({ kind: "break" });
    return;
  }
  if (node.properties.dataInlineCode != null && out.link === undefined) {
    const meta = inlineCodeFileMeta(text, env.index);
    if (meta) {
      const target = fileChipTarget(meta, env.index, `\`${text}\``);
      const link = registerLink(env, inlineCodeMediaSource(text), { kind: "file", meta, normalizedHref: meta.targetPath });
      out.atoms.push(env.boxes.fileChip(target, env, link));
      return;
    }
  }
  if (out.link !== undefined) {
    // Code inside a link keeps the link's colour, as web's `a code` does not restyle it.
    pushText(out, collapseWhitespace(text), deriveRun(style, { face: { family: "mono", weight: style.face.weight }, size: styles.inlineCode.size }));
    return;
  }
  pushText(
    out,
    collapseWhitespace(text),
    deriveRun(style, {
      face: { family: "mono", weight: 400 },
      size: styles.inlineCode.size,
      color: styles.inlineCode.color,
      pill: styles.inlineCode.pill,
      decoration: undefined,
    }),
  );
}

function registerLink(env: RenderEnv, href: string, kind: LinkKind): number {
  env.links.push({ href, kind });
  return env.links.length - 1;
}

function leadingExternalLinkTextLength(text: string): number {
  const protocol = /^(?:https?:\/\/)/i.exec(text)?.[0];
  if (protocol) return protocol.length;
  return Math.min(text.length, 1);
}

function collectLink(node: Element, style: RunStyle, out: InlineCollect) {
  const { env } = out;
  const href = typeof node.properties.href === "string" ? node.properties.href : undefined;
  const kind = classifyLink(href, env.index);
  if (!kind || !href) {
    collectInline(node.children, style, out);
    return;
  }
  switch (kind.kind) {
    case "citation": {
      const link = registerLink(env, href, kind);
      out.atoms.push(env.boxes.citationChip(env.links[link]!, env));
      return;
    }
    case "thread": {
      const label = hastPlainTextDeep(node) || kind.threadId;
      out.atoms.push(env.boxes.threadChip(kind.threadId, label, env));
      return;
    }
    case "context": {
      const label = hastPlainTextDeep(node) || kind.contextId;
      const box = env.boxes.contextChip(kind.contextKind, kind.contextId, label, env);
      if (box) out.atoms.push(box);
      else pushText(out, label, style);
      return;
    }
    case "file": {
      const label = hastPlainTextDeep(node);
      const normalizedHref = kind.normalizedHref;
      const copyMarkdown = `[${(label || kind.meta.basename).replace(/[\\[\]]/g, "\\$&")}](${normalizedHref})`;
      const link = registerLink(env, normalizedHref, kind);
      const chip = env.boxes.fileChip(fileChipTarget(kind.meta, env.index, copyMarkdown), env, link);
      if (label && fileLinkShowsLabel(label, normalizedHref)) {
        collectInline(node.children, style, out);
        pushText(out, " ", style);
      }
      out.atoms.push(chip);
      return;
    }
    case "external": {
      const link = registerLink(env, href, kind);
      const autolink = String(node.properties.dataPullRequestAutolink ?? "");
      const linkStyle = deriveRun(style, {
        color: env.styles.linkColor,
        link,
        ...(autolink === "commit" ? { face: { family: "mono" as const, weight: style.face.weight } } : {}),
      });
      const inner: InlineCollect = { ...out, link };
      const hasText = hastHasText(node);
      const plain = plainHastText(node);
      if (kind.faviconHost && hasText && autolink === "") {
        // MarkdownExternalLinkContent: the favicon and the first characters never
        // part; every later character may break (one <wbr> per character).
        out.atoms.push(env.boxes.favicon(kind.faviconHost, link, env));
        if (plain) {
          const lead = leadingExternalLinkTextLength(plain);
          pushText(out, collapseWhitespace(plain.slice(0, lead)), linkStyle);
          pushText(out, collapseWhitespace(plain.slice(lead)), deriveRun(linkStyle, { breakAnywhere: true, link }));
          return;
        }
      }
      collectInline(node.children, linkStyle, inner);
      return;
    }
  }
}

/** Inline content → laid-out lines → rows of runs. */
export function renderParagraph(children: ReadonlyArray<ElementContent>, width: number, env: RenderEnv, style: RunStyle, key: string, skills = false): ReactNode {
  const out: InlineCollect = { atoms: [], env, link: undefined, skills };
  collectInline(children, style, out);
  // Trim the paragraph's leading whitespace (CSS collapses it at line starts).
  const first = out.atoms[0];
  if (first?.kind === "text" && first.text.startsWith(" ")) out.atoms[0] = { ...first, text: first.text.trimStart() };
  const lines = layoutInline(out.atoms, width, style.lineHeight);
  // Indents (lists, quotes) sit left of this paragraph: its right edge is that far plus its widest line.
  const offset = env.extent.root - width;
  // Shrink-to-fit takes min(max-content, available): a paragraph that had to
  // soft-wrap wants more than the room, so the container takes all of it.
  const hardBreaks = out.atoms.filter((atom) => atom.kind === "break").length;
  if (lines.length > hardBreaks + 1) env.extent.width = env.extent.root;
  for (const line of lines) env.extent.width = Math.max(env.extent.width, offset + line.width);
  return <InlineLines key={key} lines={lines} env={env} base={style} />;
}

/** A line that is one plain run: consecutive ones paint as a single wrapping <text>. */
function plainLine(line: InlineLine, base: RunStyle): boolean {
  if (line.pieces.length !== 1) return false;
  const piece = line.pieces[0]!;
  return piece.kind === "text" && piece.style.key === base.key && piece.style.link === undefined && line.height === base.lineHeight;
}

/**
 * Paints laid-out lines. Every host <text> costs per frame, so runs of plain
 * lines (no pills, links or style changes) collapse into one <text> that GPUI
 * wraps itself: their words are the same either way, and the rows after the
 * group start on their own line, so a wrap that differs by a word only moves
 * where that group's own lines break.
 */
const InlineLines = memo(function InlineLines({
  lines,
  env,
  base,
  marginTop,
}: {
  lines: InlineLine[];
  env: RenderEnv;
  base: RunStyle;
  marginTop?: number;
}) {
  const baseline = baselineOffset(base.face.family, base.size, base.lineHeight);
  // Runs in the paragraph's own style paint as bare strings that inherit it
  // from their row: a bare string is one element, a <text> is two, and every
  // element costs per frame. Bare strings that sit side by side also copy as
  // one line.
  const textStyle = {
    fontFamily: fontFamilyOf(base),
    fontSize: base.size,
    fontWeight: base.face.weight,
    color: base.color,
    lineHeight: base.lineHeight,
  };
  const children: ReactNode[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; ) {
    const line = lines[lineIndex]!;
    if (plainLine(line, base)) {
      let end = lineIndex + 1;
      let text = (line.pieces[0] as { text: string }).text;
      // A hard break ends the group: the next line starts a new line, not a wrap.
      while (end < lines.length && !lines[end - 1]!.hardBreak && plainLine(lines[end]!, base)) {
        text += (lines[end]!.pieces[0] as { text: string }).text;
        end += 1;
      }
      // copy.ts: a group that wraps into the next row joins it when copied.
      const continues = end < lines.length && !lines[end - 1]!.hardBreak;
      children.push(continues ? text + JOIN : text);
      lineIndex = end;
      continue;
    }
    // copy.ts: every run that the same paragraph continues after (on this row
    // or, after a soft wrap, the next) ends with JOIN so a copy keeps it on one line.
    const lineContinues = lineIndex < lines.length - 1 && !line.hardBreak;
    const pieces = line.pieces.map((piece, pieceIndex) => {
      const join = pieceIndex < line.pieces.length - 1 || lineContinues;
      if (piece.kind === "box") return <Fragment key={pieceIndex}>{env.boxes.renderBox(piece.atom, env, `${lineIndex}:${pieceIndex}`, join)}</Fragment>;
      const text = join ? piece.text + JOIN : piece.text;
      if (piece.style.link !== undefined) {
        return <LinkRun key={pieceIndex} text={text} style={piece.style} width={piece.width} baseline={baseline} env={env} />;
      }
      if (piece.style.key === base.key) return text;
      return (
        <text key={pieceIndex} style={runStyle(piece.style, piece.width, baseline)}>
          {text}
        </text>
      );
    });
    children.push(
      <div
        key={lineIndex}
        style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", height: line.height, width: "100%", whiteSpace: "nowrap", ...(line.lift > 0 ? { paddingTop: line.lift } : {}) }}
      >
        {pieces}
      </div>,
    );
    lineIndex += 1;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", ...textStyle, ...(marginTop ? { marginTop } : {}) }}>{children}</div>
  );
});
MARGIN_AWARE.add(InlineLines);

/** Style for one painted run; pills get their border box and baseline offset. */
export function runStyle(style: RunStyle, width: number, lineBaseline: number, decoration?: "underline") {
  const pill = style.pill;
  const base = {
    width,
    flexShrink: 0,
    whiteSpace: "nowrap" as const,
    fontFamily: fontFamilyOf(style),
    fontSize: style.size,
    fontWeight: style.face.weight,
    color: style.color,
    textDecoration: decoration ?? style.decoration,
  };
  if (pill) {
    // CSS: the pill's text sits on the line's baseline; padding and border extend its box.
    const contentHeight = pill.height - 2 * pill.border;
    const glyphTop = (contentHeight - fontLineHeight("mono", style.size)) / 2;
    const top = lineBaseline - pill.border - glyphTop - fontAscent("mono", style.size);
    return {
      ...base,
      height: pill.height,
      lineHeight: pill.height - 2 * pill.border,
      marginTop: top,
      paddingLeft: pill.padX,
      paddingRight: pill.padX,
      borderWidth: pill.border,
      borderColor: pill.borderColor,
      borderRadius: pill.radius,
      backgroundColor: pill.background,
    };
  }
  const ownBaseline = baselineOffset(style.face.family, style.size, style.lineHeight);
  return { ...base, lineHeight: style.lineHeight, marginTop: lineBaseline - ownBaseline };
}

function LinkRun({ text, style, width, baseline, env }: { text: string; style: RunStyle; width: number; baseline: number; env: RenderEnv }) {
  const link = style.link!;
  const hovered = useSyncExternalStore(env.hover.subscribe, env.hover.get, env.hover.get) === link;
  const entry = env.links[link];
  return (
    <text
      onMouseEnter={() => env.hover.set(link)}
      onMouseLeave={() => {
        if (env.hover.get() === link) env.hover.set(-1);
      }}
      onClick={(event) => {
        if (entry) env.actions.activateLink(entry, normalizeModifiers(event.modifiers));
      }}
      onAuxClick={(event) => {
        if (entry && event.isRightClick) env.actions.linkContextMenu(entry, { x: event.x ?? 0, y: event.y ?? 0 });
      }}
      style={{ ...runStyle(style, width, baseline, hovered ? "underline" : undefined), cursor: "pointer" }}
    >
      {text}
    </text>
  );
}

export function normalizeModifiers(modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean } | undefined) {
  return {
    shift: Boolean(modifiers?.shift),
    ctrl: Boolean(modifiers?.ctrl),
    alt: Boolean(modifiers?.alt),
    cmd: Boolean(modifiers?.cmd),
  };
}

/** Vertical offset placing an inline box like CSS `vertical-align: middle`. */
export function middleAlignedTop(base: RunStyle, boxHeight: number): number {
  return baselineOffset(base.face.family, base.size, base.lineHeight) - xHeight(base.face.family, base.size) / 2 - boxHeight / 2;
}

// ── Document ───────────────────────────────────────────────────────────

export interface DocumentLayout {
  readonly node: ReactNode;
}

export function renderDocument(tree: Root, width: number, env: RenderEnv): ReactNode {
  const ctx: FlowCtx = { body: env.styles.body, ulDepth: 0, olDepth: 0 };
  const blocks = renderFlow(tree.children as ElementContent[], width, env, ctx, "r");
  // .chat-markdown > :first-child / :last-child drop their outer margins.
  const { nodes } = stack(blocks);
  return nodes;
}

export function useLinkHover(env: RenderEnv, link: number | undefined): [boolean, { onMouseEnter?: () => void; onMouseLeave?: () => void }] {
  const hovered = useSyncExternalStore(env.hover.subscribe, env.hover.get, env.hover.get) === link && link !== undefined;
  if (link === undefined) return [false, {}];
  return [
    hovered,
    {
      onMouseEnter: () => env.hover.set(link),
      onMouseLeave: () => {
        if (env.hover.get() === link) env.hover.set(-1);
      },
    },
  ];
}
