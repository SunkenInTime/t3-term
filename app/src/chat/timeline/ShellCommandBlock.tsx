// apps/web/src/components/chat/ShellCommandBlock.tsx: a tool call's command,
// highlighted as shell or PowerShell (commandHighlightLanguage) with the pierre
// Shiki themes, words wrapping at whitespace and breaking anywhere only when a
// word is wider than the line. Plain text at the same layout until the
// highlighter answers, so colours arriving never reflow it.
import { commandHighlightLanguage, withVisibleControlCharacters } from "@t3tools/client-runtime/work-log/command-label";
import { memo, useState } from "react";

import { expandTabs, segmentsFor } from "../../panels/code/codeRows.tsx";
import { useSyntaxTokens } from "../../panels/code/highlighter.ts";
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import { textWidth } from "../markdown/measure.ts";

/**
 * web wraps each word as an inline-block with `overflow-wrap: anywhere`: words
 * fill the line, and a word longer than the line breaks inside its own box,
 * which then takes the whole width, so the next word starts a new line.
 */
function wrapWords(line: string, columns: number): Array<readonly [number, number]> {
  if (line.length <= columns) return [[0, line.length]];
  const rows: Array<readonly [number, number]> = [];
  let rowStart = 0;
  let rowEnd = 0;
  for (const match of line.matchAll(/\S+\s*/g)) {
    const start = match.index;
    const word = match[0];
    const wordEnd = start + word.trimEnd().length;
    if (wordEnd - start > columns) {
      if (rowEnd > rowStart) rows.push([rowStart, start]);
      for (let chunk = start; chunk < wordEnd; chunk += columns) rows.push([chunk, Math.min(wordEnd, chunk + columns)]);
      rowStart = start + word.length;
      rowEnd = rowStart;
      continue;
    }
    if (wordEnd - rowStart > columns && rowEnd > rowStart) {
      rows.push([rowStart, start]);
      rowStart = start;
    }
    rowEnd = start + word.length;
  }
  if (rowEnd > rowStart || rows.length === 0) rows.push([rowStart, line.length]);
  return rows;
}

export const ShellCommandBlock = memo(function ShellCommandBlock({
  command,
  fontSize,
  lineHeight,
}: {
  command: string;
  fontSize: number;
  lineHeight: number;
}) {
  const theme = useTheme();
  const code = withVisibleControlCharacters(command.trim());
  const [width, setWidth] = useState(0);
  const language = commandHighlightLanguage(code);
  const tokens = useSyntaxTokens(code.length > 0 ? code : null, language === "powershell" ? "command.ps1" : "command.sh", theme.appearance);
  if (!code) return null;
  const charWidth = textWidth({ family: "mono", weight: 400 }, fontSize, "0");
  const columns = width > 0 ? Math.max(8, Math.floor(width / charWidth)) : Number.MAX_SAFE_INTEGER;
  const fallback = alpha(theme.foreground, 0.85);
  const rows = code.split("\n").flatMap((rawLine, lineIndex) => {
    const line = expandTabs(rawLine);
    return wrapWords(line, columns).map(([start, end]) => (
      <div key={`${lineIndex}:${start}`} style={{ display: "flex", flexDirection: "row", height: lineHeight, flexShrink: 0 }}>
        {segmentsFor(line, tokens?.[lineIndex] ?? null, start, end, [], fallback).map((segment, index) => (
          <text key={index} style={{ color: segment.color, fontFamily: FONTS.mono, fontSize, lineHeight, whiteSpace: "nowrap", flexShrink: 0 }}>
            {segment.text}
          </text>
        ))}
      </div>
    ));
  });
  return (
    <div
      onLayout={(event) => {
        const next = event.width ?? 0;
        if (next > 0 && Math.abs(next - width) > 0.5) setWidth(next);
      }}
      style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}
    >
      {rows}
    </div>
  );
});
