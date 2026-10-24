// Markdown → HAST the way web's ChatMarkdown gets it: react-markdown runs the
// shared remark plugins, remark-rehype with raw HTML allowed, and the shared
// rehype plugins (raw HTML, sanitizer), then rewrites URL attributes through
// `urlTransform`. The renderer walks the resulting element tree with the same
// tag-by-tag components web uses.
import type { Element, ElementContent, Root, RootContent } from "hast";
import { parseAssistantCitationHref } from "@t3tools/shared/assistantCitations";
import { parseComposerContextHref } from "@t3tools/shared/composerContextReferences";
import { isWindowsDrivePathHref } from "@t3tools/shared/markdownLinks";
import {
  CHAT_MARKDOWN_REHYPE_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS,
} from "@t3tools/shared/markdownPipeline";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type PluggableList } from "unified";

import { rewriteMarkdownFileUriHref } from "../../web/markdown-links.ts";

export type { Element, ElementContent, Root, RootContent };

function buildProcessor(lineBreaks: boolean, math: boolean, rawHtml: boolean) {
  const remarkPlugins: PluggableList = [
    ...(math ? ([[remarkMath, { singleDollarTextMath: true }]] as PluggableList) : []),
    ...(lineBreaks ? CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS : CHAT_MARKDOWN_REMARK_PLUGINS),
  ];
  return unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rawHtml ? CHAT_MARKDOWN_REHYPE_PLUGINS : [])
    .freeze();
}

const processors = new Map<string, ReturnType<typeof buildProcessor>>();

function processorFor(lineBreaks: boolean, math: boolean, rawHtml: boolean) {
  const key = `${lineBreaks ? 1 : 0}${math ? 1 : 0}${rawHtml ? 1 : 0}`;
  let processor = processors.get(key);
  if (!processor) {
    processor = buildProcessor(lineBreaks, math, rawHtml);
    processors.set(key, processor);
  }
  return processor;
}

// react-markdown's defaultUrlTransform: relative URLs and a few safe protocols.
const SAFE_PROTOCOL = /^(https?|ircs?|mailto|xmpp)$/i;

function defaultUrlTransform(value: string): string {
  const colon = value.indexOf(":");
  const questionMark = value.indexOf("?");
  const numberSign = value.indexOf("#");
  const slash = value.indexOf("/");
  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_PROTOCOL.test(value.slice(0, colon))
  ) {
    return value;
  }
  return "";
}

/** web ChatMarkdown's markdownUrlTransform. */
export function markdownUrlTransform(href: string): string {
  if (parseAssistantCitationHref(href)) return href;
  if (parseComposerContextHref(href)) return href;
  if (parseThreadLinkHref(href)) return href;
  if (isWindowsDrivePathHref(href)) return href;
  return rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href);
}

const URL_ATTRIBUTES: Record<string, ReadonlyArray<string>> = {
  a: ["href"],
  img: ["src"],
  video: ["src", "poster"],
  source: ["src"],
  area: ["href"],
};

/** react-markdown with skipHtml off: HTML the pipeline did not parse renders as its source text. */
function rawToText(node: Root | Element) {
  node.children.forEach((child, index) => {
    if ((child as { type: string }).type === "raw") {
      node.children[index] = { type: "text", value: (child as unknown as { value: string }).value };
    } else if (child.type === "element") {
      rawToText(child);
    }
  });
}

function transformUrls(node: Root | Element) {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    const keys = URL_ATTRIBUTES[child.tagName];
    if (keys) {
      for (const key of keys) {
        const value = child.properties[key];
        if (typeof value !== "string") continue;
        const next = markdownUrlTransform(value);
        if (next) child.properties[key] = next;
        else delete child.properties[key];
      }
    }
    transformUrls(child);
  }
}

const MAX_CACHE = 400;
const cache = new Map<string, Root>();

/** Parsed, sanitized HAST for a message. Cached: virtualized rows remount while scrolling. */
export function parseChatMarkdown(text: string, options: { lineBreaks: boolean; math: boolean; rawHtml?: boolean }): Root {
  const rawHtml = options.rawHtml ?? true;
  const key = `${options.lineBreaks ? 1 : 0}${options.math ? 1 : 0}${rawHtml ? 1 : 0}\u0000${text}`;
  const cached = cache.get(key);
  if (cached) {
    // Refresh recency.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const processor = processorFor(options.lineBreaks, options.math, rawHtml);
  let tree: Root;
  try {
    tree = processor.runSync(processor.parse(text)) as Root;
    rawToText(tree);
    transformUrls(tree);
  } catch {
    tree = { type: "root", children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: text }] }] };
  }
  cache.set(key, tree);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return tree;
}
