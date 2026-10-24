// Dev-only: the previous renderer (gpuix native <markdown>), kept for perf A/B runs
// with T3TERM_NATIVE_MD=1. Not used otherwise.
import { memo } from "react";

import { FONTS, alpha, type Palette, useTheme } from "../ui/theme.ts";
import { openExternalUrl } from "../chat/timeline/system.ts";

export type ChatMarkdownTone = "assistant" | "user" | "muted";

interface MarkdownTheme {
  readonly appearance: "dark" | "light";
  readonly bg: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textFaint: string;
  readonly textDim: string;
  readonly border: string;
  readonly accent: string;
  readonly codeText: string;
  readonly codeWash: string;
  readonly fontSans: string;
  readonly fontMono: string;
  readonly metrics: Record<string, number | number[]>;
}

const themeCache = new WeakMap<Palette, Map<string, MarkdownTheme>>();

function toneColor(theme: Palette, tone: ChatMarkdownTone): string {
  switch (tone) {
    case "assistant":
      return alpha(theme.foreground, 0.8);
    case "user":
      return theme.foreground;
    case "muted":
      return theme.mutedForeground;
  }
}

export function chatMarkdownTheme(
  theme: Palette,
  tone: ChatMarkdownTone,
  textSize: 14 | 12 = 14,
): MarkdownTheme {
  let byKey = themeCache.get(theme);
  if (!byKey) {
    byKey = new Map();
    themeCache.set(theme, byKey);
  }
  const key = `${tone}:${textSize}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const text = toneColor(theme, tone);
  const lineHeight = textSize === 14 ? 23 : 20;
  const value: MarkdownTheme = {
    appearance: theme.appearance,
    bg: theme.background,
    text,
    textMuted: theme.mutedForeground,
    textFaint: alpha(theme.mutedForeground, 0.7),
    textDim: theme.mutedForeground,
    border: theme.border,
    // gpuix tints list markers and the quote rail with `accent`; web draws
    // both in the text color, so the accent follows the tone.
    accent: text,
    codeText: theme.foreground,
    // Web paints inline code on --muted with a 1px contrast border; one wash
    // a step lighter than the card reads the same at 12px.
    codeWash: theme.appearance === "dark" ? "#ffffff14" : "#0000000d",
    fontSans: FONTS.sans,
    fontMono: FONTS.mono,
    metrics: {
      mdTextSize: textSize,
      mdLineHeight: lineHeight,
      mdBlockGap: textSize === 14 ? 10 : 8,
      mdHeadingSizes: textSize === 14 ? [20, 18, 16, 14] : [16, 14, 13, 12],
      mdHeadingLineHeights: textSize === 14 ? [26, 23, 21, 18] : [21, 18, 17, 16],
      mdInlineCodeRadius: 6,
      mdCodeRadius: 10,
      mdCodePaddingX: 12,
      mdCodePaddingY: 9,
      mdCodeHeaderPaddingY: 6,
      mdCodeHeaderTextSize: 11,
      codeTextSize: 13,
      codeLineHeight: 18,
      mdTableCellPadding: 10,
    },
  };
  byKey.set(key, value);
  return value;
}

/**
 * Web's `lineBreaks` (remark-breaks) turns every newline into a <br>. The native
 * parser is plain CommonMark, so mark each newline outside fenced code as a hard
 * break instead.
 */
export function withHardLineBreaks(text: string): string {
  const lines = text.split("\n");
  let inFence = false;
  let fence = "";
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index]!;
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!inFence) {
        inFence = true;
        fence = marker[0]!.repeat(marker.length);
      } else if (marker.startsWith(fence)) {
        inFence = false;
      }
      continue;
    }
    if (inFence || line.trim() === "" || lines[index + 1]!.trim() === "") continue;
    if (!line.endsWith("  ") && !line.endsWith("\\")) lines[index] = `${line}  `;
  }
  return lines.join("\n");
}

function handleLinkClick(event: { value?: string }) {
  if (event.value) openExternalUrl(event.value);
}

export const NativeChatMarkdown = memo(function NativeChatMarkdown({
  text,
  tone = "assistant",
  textSize = 14,
  lineBreaks = false,
}: {
  text: string;
  tone?: ChatMarkdownTone;
  textSize?: 14 | 12;
  lineBreaks?: boolean;
}) {
  const theme = useTheme();
  const source = lineBreaks ? withHardLineBreaks(text) : text;
  return (
    <markdown
      source={source}
      theme={chatMarkdownTheme(theme, tone, textSize)}
      onLinkClick={handleLinkClick}
      style={{ width: "100%", minWidth: 0 }}
    />
  );
});
