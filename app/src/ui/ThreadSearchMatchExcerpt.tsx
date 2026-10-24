// apps/web/src/components/ThreadSearchMatch.tsx: a message match under a thread
// title in the palette and the sidebar search results. "You:" / "Agent:" in the
// info / success colour, then the snippet with every occurrence of the query in
// semibold foreground, on one truncated line.
//
// gpuix has no inline runs, so the line is a row of nowrap runs. CSS truncates
// the whole line with one ellipsis wherever it overflows; here the runs are cut
// in JavaScript from measured glyph advances (chat/markdown/measure.ts) once the
// row's width is known, and the run that overflows ends in "…".
import { useState } from "react";

import { textWidth, useTextMetricsEpoch, type FontFace } from "../chat/markdown/measure.ts";
import { FONTS, alpha, useTheme } from "./theme.ts";

const FONT_SIZE = 12;
const REGULAR: FontFace = { family: "sans", weight: 400 };
const SEMIBOLD: FontFace = { family: "sans", weight: 600 };
const ELLIPSIS = "…";
// Summed advances land within about a pixel of GPUI's shaped width.
const SAFETY = 2;

function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

interface Run {
  readonly text: string;
  readonly highlighted: boolean;
}

/** HighlightedSearchText's split: plain and matched parts, case folded for ASCII only. */
export function splitHighlightedSearchText(text: string, rawQuery: string): Run[] {
  const query = rawQuery.trim();
  if (query.length === 0) return [{ text, highlighted: false }];
  const normalizedText = foldAsciiCase(text);
  const normalizedQuery = foldAsciiCase(query);
  const parts: Run[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, cursor);
    if (matchIndex === -1) {
      parts.push({ text: text.slice(cursor), highlighted: false });
      break;
    }
    if (matchIndex > cursor) parts.push({ text: text.slice(cursor, matchIndex), highlighted: false });
    parts.push({ text: text.slice(matchIndex, matchIndex + query.length), highlighted: true });
    cursor = matchIndex + query.length;
  }
  return parts;
}

/** The runs that fit in `width`, the last one cut and ended with an ellipsis if the line overflows. */
function fitRuns(runs: ReadonlyArray<Run & { readonly face: FontFace }>, width: number) {
  const fitted: Array<Run & { readonly face: FontFace }> = [];
  let used = 0;
  for (const run of runs) {
    const runWidth = textWidth(run.face, FONT_SIZE, run.text);
    if (used + runWidth <= width - SAFETY) {
      fitted.push(run);
      used += runWidth;
      continue;
    }
    const room = width - SAFETY - used - textWidth(run.face, FONT_SIZE, ELLIPSIS);
    const characters = Array.from(run.text);
    let taken = "";
    let takenWidth = 0;
    for (const character of characters) {
      const next = textWidth(run.face, FONT_SIZE, character);
      if (takenWidth + next > room) break;
      taken += character;
      takenWidth += next;
    }
    fitted.push({ ...run, text: `${taken.trimEnd()}${ELLIPSIS}` });
    break;
  }
  return fitted;
}

export function ThreadSearchMatchExcerpt({
  match,
}: {
  match: { readonly source: "user" | "assistant"; readonly snippet: string; readonly query: string };
}) {
  const theme = useTheme();
  const [width, setWidth] = useState<number | null>(null);
  // Re-fit when measured advances replace the estimates.
  useTextMetricsEpoch();
  const isUser = match.source === "user";
  const muted = alpha(theme.mutedForeground, 0.85);
  const runs = [
    { text: `${isUser ? "You:" : "Agent:"} `, highlighted: false, face: REGULAR },
    ...splitHighlightedSearchText(match.snippet, match.query).map((run) => ({
      ...run,
      face: run.highlighted ? SEMIBOLD : REGULAR,
    })),
  ];
  const shown = width === null ? runs : fitRuns(runs, width);
  return (
    <div
      onLayout={(event) => {
        const next = Math.floor(event.width ?? 0);
        if (next !== width) setWidth(next);
      }}
      style={{ display: "flex", flexDirection: "row", width: "100%", minWidth: 0, height: 16, overflow: "hidden" }}
    >
      {shown.map((run, index) => (
        <text
          key={index}
          style={{
            fontSize: FONT_SIZE,
            lineHeight: 16,
            fontFamily: FONTS.sans,
            whiteSpace: "nowrap",
            flexShrink: 0,
            fontWeight: run.face.weight,
            color: index === 0 ? (isUser ? theme.infoForeground : theme.successForeground) : run.highlighted ? theme.foreground : muted,
          }}
        >
          {run.text}
        </text>
      ))}
    </div>
  );
}
