// What a markdown link or inline code span points at, decided the way web's
// ChatMarkdown `a` and `code` components decide it (ChatMarkdown.tsx 1049-1350),
// plus the per-message lookups web builds in useChatMarkdownState.
import { buildFileLinkParentSuffixByPath, fileLinkLabel } from "@t3tools/shared/fileLinks";
import {
  extractInlineCodeSpans,
  extractMarkdownLinkHrefs,
  inlineCodeFilePathCandidate,
  isMarkdownFileLinkLabel,
  isWindowsDrivePathHref,
  normalizeMarkdownLinkDestination,
} from "@t3tools/shared/markdownLinks";
import { parseAssistantCitationHref } from "@t3tools/shared/assistantCitations";
import type { AssistantCitation } from "@t3tools/contracts";
import { parseComposerContextHref } from "@t3tools/shared/composerContextReferences";
import { renderCodexInlineDirectivesAsMarkdown } from "@t3tools/shared/codexMarkdownDirectives";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import type { ThreadId } from "@t3tools/contracts";

import { resolveExternalWebLinkHost } from "../../web/components/chat/externalLinkContextMenu.ts";
import {
  resolveInlineCodeFileLinkMeta,
  resolveMarkdownFileLinkMeta,
  rewriteMarkdownFileUriHref,
  type MarkdownFileLinkMeta,
} from "../../web/markdown-links.ts";

export type { MarkdownFileLinkMeta };

const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;

export function normalizeMarkdownLinkHrefKey(href: string): string {
  const normalizedHref = normalizeMarkdownLinkDestination(href);
  const rewrittenHref = rewriteMarkdownFileUriHref(normalizedHref) ?? normalizedHref;
  return WINDOWS_DRIVE_PATH_REGEX.test(rewrittenHref) ? rewrittenHref.replaceAll("\\", "/") : rewrittenHref;
}

/** Per-message file link lookups (web useChatMarkdownState). */
export interface MessageLinkIndex {
  readonly cwd: string | undefined;
  readonly metaByHref: ReadonlyMap<string, MarkdownFileLinkMeta>;
  readonly metaByInlineCode: ReadonlyMap<string, MarkdownFileLinkMeta>;
  readonly parentSuffixByPath: ReadonlyMap<string, string>;
}

const indexCache = new Map<string, MessageLinkIndex>();

export function messageLinkIndex(text: string, cwd: string | undefined): MessageLinkIndex {
  const key = `${cwd ?? ""}\u0000${text}`;
  const cached = indexCache.get(key);
  if (cached) return cached;
  const metaByHref = new Map<string, MarkdownFileLinkMeta>();
  for (const href of extractMarkdownLinkHrefs(renderCodexInlineDirectivesAsMarkdown(text))) {
    if (parseComposerContextHref(href)) continue;
    const normalized = normalizeMarkdownLinkHrefKey(href);
    if (metaByHref.has(normalized)) continue;
    const meta = resolveMarkdownFileLinkMeta(normalized, cwd, cwd);
    if (meta) metaByHref.set(normalized, meta);
  }
  const metaByInlineCode = new Map<string, MarkdownFileLinkMeta>();
  for (const span of extractInlineCodeSpans(text)) {
    if (metaByInlineCode.has(span)) continue;
    const meta = resolveInlineCodeFileLinkMeta(span, cwd, cwd);
    if (meta) metaByInlineCode.set(span, meta);
  }
  const parentSuffixByPath = buildFileLinkParentSuffixByPath([
    ...[...metaByHref.values()].map((meta) => meta.filePath),
    ...[...metaByInlineCode.values()].map((meta) => meta.filePath),
  ]);
  const index: MessageLinkIndex = { cwd, metaByHref, metaByInlineCode, parentSuffixByPath };
  indexCache.set(key, index);
  if (indexCache.size > 400) indexCache.delete(indexCache.keys().next().value!);
  return index;
}

export interface FileChipTarget {
  readonly meta: MarkdownFileLinkMeta;
  readonly label: string;
  /** web data-markdown-copy: what copying the chip yields. */
  readonly copyMarkdown: string;
}

export function fileChipTarget(meta: MarkdownFileLinkMeta, index: MessageLinkIndex, copyMarkdown: string): FileChipTarget {
  return {
    meta,
    copyMarkdown,
    label: fileLinkLabel(
      {
        path: meta.filePath,
        ...(meta.line !== undefined ? { line: meta.line } : {}),
        ...(meta.column !== undefined ? { column: meta.column } : {}),
      },
      index.parentSuffixByPath,
    ),
  };
}

export type LinkKind =
  | { readonly kind: "citation"; readonly citation: AssistantCitation }
  | { readonly kind: "thread"; readonly threadId: ThreadId }
  | { readonly kind: "context"; readonly contextKind: string; readonly contextId: string }
  | { readonly kind: "file"; readonly meta: MarkdownFileLinkMeta; readonly normalizedHref: string }
  | {
      readonly kind: "external";
      readonly href: string;
      /** Host for the favicon; null for mailto, same-document and other non-web links. */
      readonly faviconHost: string | null;
    };

export function classifyLink(href: string | undefined, index: MessageLinkIndex): LinkKind | null {
  if (!href) return null;
  const citation = parseAssistantCitationHref(href);
  if (citation) return { kind: "citation", citation };
  const threadId = parseThreadLinkHref(href);
  if (threadId) return { kind: "thread", threadId };
  const context = parseComposerContextHref(href);
  if (context) return { kind: "context", contextKind: context.kind, contextId: context.contextId };
  const normalizedHref = normalizeMarkdownLinkHrefKey(href);
  const meta = normalizedHref
    ? (index.metaByHref.get(normalizedHref) ?? resolveMarkdownFileLinkMeta(normalizedHref, index.cwd, index.cwd))
    : null;
  if (meta) return { kind: "file", meta, normalizedHref };
  return { kind: "external", href, faviconHost: resolveExternalWebLinkHost(href) };
}

export function inlineCodeFileMeta(codeText: string, index: MessageLinkIndex): MarkdownFileLinkMeta | null {
  return index.metaByInlineCode.get(codeText.trim()) ?? resolveInlineCodeFileLinkMeta(codeText, index.cwd, index.cwd);
}

export function inlineCodeMediaSource(codeText: string): string {
  return inlineCodeFilePathCandidate(codeText) ?? codeText.trim();
}

/** web: a file link whose label is its own path shows only the chip; other labels show text, then the chip. */
export function fileLinkShowsLabel(label: string, normalizedHref: string): boolean {
  return !isMarkdownFileLinkLabel(label, normalizedHref);
}

export { isWindowsDrivePathHref };
