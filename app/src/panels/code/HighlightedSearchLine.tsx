// Port of apps/web/src/components/search/HighlightedSearchLine.tsx: one content-search
// result line, syntax-highlighted with the file's grammar (the same Shiki worker as the
// code views) and its match ranges washed with primary/25 over the token colours.
// Until the worker answers, the line paints plain, like web's Suspense fallback.
import type { ProjectContentMatch } from "@t3tools/contracts";
import { memo } from "react";

import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import { useSyntaxTokens, type SyntaxToken } from "./highlighter.ts";

interface Range {
  readonly start: number;
  readonly end: number;
}

/** web normalizeRanges: clamped, sorted, merged. */
function normalizeRanges(match: ProjectContentMatch): Range[] {
  const ranges = match.matchRanges
    .map((range) => ({
      start: Math.max(0, Math.min(match.lineContent.length, range.start)),
      end: Math.max(0, Math.min(match.lineContent.length, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .toSorted((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

interface Piece {
  readonly text: string;
  readonly color: string;
  readonly isMatch: boolean;
}

/** web splitToken over every token: each token cut at match boundaries. */
function pieces(line: string, tokens: ReadonlyArray<SyntaxToken>, ranges: ReadonlyArray<Range>, fallback: string): Piece[] {
  const out: Piece[] = [];
  let offset = 0;
  for (const token of tokens) {
    const tokenEnd = offset + token.text.length;
    let cursor = offset;
    for (const range of ranges) {
      if (range.end <= cursor) continue;
      if (range.start >= tokenEnd) break;
      const matchStart = Math.max(cursor, range.start);
      if (matchStart > cursor) out.push({ text: line.slice(cursor, matchStart), color: token.color || fallback, isMatch: false });
      const matchEnd = Math.min(tokenEnd, range.end);
      out.push({ text: line.slice(matchStart, matchEnd), color: token.color || fallback, isMatch: true });
      cursor = matchEnd;
    }
    if (cursor < tokenEnd) out.push({ text: line.slice(cursor, tokenEnd), color: token.color || fallback, isMatch: false });
    offset = tokenEnd;
  }
  return out;
}

/** Tabs as spaces to the next 2-column stop (pierre's tab-size), keeping the text length per tab. */
function expandForDisplay(text: string): string {
  return text.replaceAll("\t", "  ");
}

export const HighlightedSearchLine = memo(function HighlightedSearchLine(props: {
  readonly match: ProjectContentMatch;
  readonly path: string;
}) {
  const theme = useTheme();
  const line = props.match.lineContent;
  const syntax = useSyntaxTokens(line, props.path, theme.appearance);
  const tokens = syntax?.[0] ?? [{ text: line, color: theme.foreground }];
  const parts = pieces(line, tokens, normalizeRanges(props.match), theme.foreground);
  const textStyle = { fontFamily: FONTS.mono, fontSize: 12, lineHeight: 16, whiteSpace: "nowrap" as const };
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minWidth: 0, overflow: "hidden", flexGrow: 1 }}>
      {parts.map((part, index) => {
        const last = index === parts.length - 1;
        const text = (
          <text
            key={index}
            style={{
              ...textStyle,
              color: part.color,
              flexShrink: last ? 1 : 0,
              ...(last ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } : {}),
            }}
          >
            {expandForDisplay(part.text)}
          </text>
        );
        // <mark class="rounded-xs bg-primary/25 text-inherit">
        return part.isMatch ? (
          <div key={index} style={{ display: "flex", flexShrink: last ? 1 : 0, minWidth: 0, borderRadius: 2, backgroundColor: alpha(theme.primary, 0.25) }}>
            {text}
          </div>
        ) : (
          text
        );
      })}
    </div>
  );
});
