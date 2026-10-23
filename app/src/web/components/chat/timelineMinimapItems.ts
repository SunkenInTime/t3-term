// Port of apps/web/src/components/chat/timelineMinimapItems.ts.
// Web flattens the assistant markdown with remark; t3-term has no markdown
// parser in JS (gpuix renders markdown natively), so markdownPreviewText strips
// the syntax with a few regexes. The preview is three clamped lines, so the
// rare construct this misses only changes punctuation in a tooltip.
import type { MessagesTimelineRow } from "./MessagesTimeline.logic.ts";

export interface TimelineMinimapItem {
  readonly id: string;
  readonly rowIndex: number;
  readonly userText: string | null;
  readonly assistantText: string | null;
}

export function deriveTimelineMinimapItems(rows: ReadonlyArray<MessagesTimelineRow>): TimelineMinimapItem[] {
  const items: TimelineMinimapItem[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message" || row.message.role !== "user") {
      continue;
    }

    items.push({
      id: row.id,
      rowIndex: index,
      userText: row.message.text,
      assistantText: resolveFinalAssistantTextForTurn(rows, index),
    });
  }
  return items;
}

function resolveFinalAssistantTextForTurn(rows: ReadonlyArray<MessagesTimelineRow>, userRowIndex: number) {
  let finalAssistantText: string | null = null;
  for (let index = userRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message") {
      continue;
    }
    if (row.message.role === "user") {
      break;
    }
    if (row.message.role === "assistant") {
      finalAssistantText = row.message.text ?? null;
    }
  }
  return finalAssistantText;
}

function markdownPreviewText(markdown: string): string {
  return (
    markdown
      // fenced code: keep the code, drop the fences
      .replace(/^\s*(```|~~~)[^\n]*$/gm, "")
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/<\/?[a-z][\w-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, " ")
      // images and links keep their text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      // block markers
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
      .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
      .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/gm, "")
      .replace(/\|/g, " ")
      // inline emphasis and code
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])/g, "$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`+([^`]+)`+/g, "$1")
  );
}

function compactMinimapPreview(text: string | null | undefined) {
  const compact = text?.replace(/\s+/g, " ").trim() ?? "";
  return compact.length > 0 ? compact : null;
}

export function resolveTimelineMinimapPreview(item: TimelineMinimapItem | null): TimelineMinimapItem | null {
  return item === null
    ? null
    : {
        ...item,
        userText: compactMinimapPreview(item.userText),
        // The tooltip shows three lines; bound parsing work while long responses stream.
        assistantText: compactMinimapPreview(
          item.assistantText === null ? null : markdownPreviewText(item.assistantText.slice(0, 1_500)),
        ),
      };
}
