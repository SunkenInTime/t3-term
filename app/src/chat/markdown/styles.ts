// Every number and colour the markdown renderer paints, transcribed from the
// `.chat-markdown` rules in apps/web/src/index.css (1787-2185) and the chat
// components' Tailwind classes. rem is 16px; the body is text-sm (14px) with
// leading-relaxed (1.625).
import { alpha, type Palette } from "../../ui/theme.ts";
import { mixOklab, withAlpha } from "./colors.ts";
import type { FontFace, FontFamilyKind } from "./measure.ts";
import type { PillStyle, RunStyle } from "./inline.ts";

export type ChatMarkdownTone = "assistant" | "user" | "muted";

/** Vertical font metrics (em) GPUI and Chrome both read from the OS/2 win metrics on Windows. */
const FONT_METRICS: Record<FontFamilyKind, { ascent: number; descent: number; xHeight: number }> =
  process.platform === "win32"
    ? { sans: { ascent: 1.079, descent: 0.251, xHeight: 0.5 }, mono: { ascent: 0.92, descent: 0.251, xHeight: 0.49 } }
    : process.platform === "darwin"
      ? { sans: { ascent: 0.952, descent: 0.241, xHeight: 0.52 }, mono: { ascent: 0.928, descent: 0.236, xHeight: 0.545 } }
      : { sans: { ascent: 0.928, descent: 0.236, xHeight: 0.545 }, mono: { ascent: 0.928, descent: 0.236, xHeight: 0.545 } };

export function fontAscent(family: FontFamilyKind, size: number): number {
  return FONT_METRICS[family].ascent * size;
}

/** Distance from a line box's top to its baseline (CSS half-leading model). */
export function baselineOffset(family: FontFamilyKind, size: number, lineHeight: number): number {
  const metrics = FONT_METRICS[family];
  return (lineHeight - (metrics.ascent + metrics.descent) * size) / 2 + metrics.ascent * size;
}

/** Content-area height (ascent + descent): what a line of this font needs without leading. */
export function fontLineHeight(family: FontFamilyKind, size: number): number {
  return (FONT_METRICS[family].ascent + FONT_METRICS[family].descent) * size;
}

export function xHeight(family: FontFamilyKind, size: number): number {
  return FONT_METRICS[family].xHeight * size;
}

export interface MarkdownStyles {
  readonly palette: Palette;
  readonly tone: ChatMarkdownTone;
  readonly size: number;
  readonly lineHeight: number;
  readonly color: string;
  readonly strongColor: string;
  readonly headingColor: string;
  readonly mutedColor: string;
  readonly linkColor: string;
  readonly border: string;
  /** .chat-markdown p, ul, ol, blockquote, pre, table container: margin 0.65rem 0. */
  readonly blockMargin: number;
  readonly headingMarginTop: number;
  readonly headingMarginBottom: number;
  readonly headingSizes: readonly [number, number, number, number];
  readonly listIndent: number;
  readonly listItemGap: number;
  readonly quoteBorder: number;
  readonly quotePadding: number;
  readonly inlineCode: { readonly size: number; readonly color: string; readonly pill: PillStyle; readonly padY: number };
  readonly codeBlock: {
    readonly background: string;
    readonly border: string;
    readonly radius: number;
    readonly headerColor: string;
    readonly textSize: number;
    readonly lineHeight: number;
    readonly padX: number;
    readonly padY: number;
  };
  readonly body: RunStyle;
}

const SANS: FontFace = { family: "sans", weight: 400 };

const cache = new WeakMap<Palette, Map<string, MarkdownStyles>>();

function toneColor(palette: Palette, tone: ChatMarkdownTone): string {
  switch (tone) {
    // text-foreground/[calc(80%+var(--appearance-contrast-boost)/5)]
    case "assistant":
      return alpha(palette.foreground, 0.8);
    // UserMessageBody passes className="text-foreground"
    case "user":
      return palette.foreground;
    case "muted":
      return palette.mutedForeground;
  }
}

export function markdownStyles(palette: Palette, tone: ChatMarkdownTone, textSize: 14 | 12): MarkdownStyles {
  let byKey = cache.get(palette);
  if (!byKey) {
    byKey = new Map();
    cache.set(palette, byKey);
  }
  const key = `${tone}:${textSize}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const dark = palette.appearance === "dark";
  const size = textSize;
  // leading-relaxed
  const lineHeight = size * 1.625;
  const color = toneColor(palette, tone);
  const inlineCodeSize = 12;
  const inlineCodePadY = 1.6;
  const value: MarkdownStyles = {
    palette,
    tone,
    size,
    lineHeight,
    color,
    strongColor: color,
    headingColor: palette.foreground,
    mutedColor: palette.mutedForeground,
    // .chat-markdown a: var(--info-foreground)
    linkColor: palette.infoForeground,
    border: palette.border,
    blockMargin: 10.4,
    headingMarginTop: 20,
    headingMarginBottom: 8,
    headingSizes: [20, 18, 16, 14],
    listIndent: 20,
    listItemGap: 4,
    quoteBorder: 2,
    quotePadding: 12.8,
    inlineCode: {
      size: inlineCodeSize,
      color: palette.foreground,
      padY: inlineCodePadY,
      pill: {
        padX: 5.6,
        border: 1,
        radius: 6,
        background: palette.muted,
        borderColor: palette.border,
        // Consolas' content area (win ascent + descent) plus 0.1rem padding and the border, each side.
        height: (FONT_METRICS.mono.ascent + FONT_METRICS.mono.descent) * inlineCodeSize + 2 * (inlineCodePadY + 1),
      },
    },
    codeBlock: {
      // MarkdownCodeBlockFrame: bg-secondary, border-border/70; dark: transparent border, bg-input/32.
      background: dark ? withAlpha(palette.input, 0.32) : palette.secondary,
      border: dark ? "#00000000" : withAlpha(palette.border, 0.7),
      radius: 10,
      // .chat-markdown-codeblock-header: contrast-foreground at 72%.
      headerColor: mixOklab(palette.foreground, "#00000000", 0.72),
      // --font-size-code inherits text-sm; leading-snug.
      textSize: 14,
      lineHeight: 14 * 1.375,
      padX: 14.4,
      padY: 12.8,
    },
    body: {
      key: `body:${size}:${color}`,
      face: SANS,
      size,
      color,
      lineHeight,
    },
  };
  byKey.set(key, value);
  return value;
}

/** A run style derived from `base` with overrides; the key changes with every visual difference. */
export function deriveRun(base: RunStyle, patch: Partial<RunStyle>): RunStyle {
  const next = { ...base, ...patch };
  return {
    ...next,
    key: [
      next.face.family,
      next.face.weight,
      next.size,
      next.color,
      next.lineHeight,
      next.decoration ?? "",
      next.pill ? "pill" : "",
      next.breakAnywhere ? "any" : "",
      next.italic ? "i" : "",
    ].join("|"),
  };
}
