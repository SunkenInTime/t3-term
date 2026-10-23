// Painting highlighted source as rows of <text> runs. Shared by the Diff and
// Files surfaces, which need what gpuix's native <code>/<diff> cannot do: soft
// wrap (the web viewers default to it), a split diff, and pierre's exact layout.
//
// Lines are monospaced, so wrapping is arithmetic: measure one character once,
// divide the content width, and break at spaces the way CSS `pre-wrap` +
// `overflow-wrap: break-word` does. Each visual row is a fixed 20px.
import { memo, useState, type ReactNode } from "react";

import { FONTS } from "../../ui/theme.ts";
import type { SyntaxToken } from "./highlighter.ts";

/** --diffs-font-size / --diffs-line-height in the web client. */
export const CODE_FONT_SIZE = 13;
export const CODE_LINE_HEIGHT = 20;
/** pierre's `tab-size: var(--diffs-tab-size, 2)`. */
const TAB_SIZE = 2;
const PROBE_TEXT = "0".repeat(64);

/**
 * The advance of one monospace character at CODE_FONT_SIZE, measured from a
 * hidden 64-character run (font metrics differ per platform). Render `probe`
 * anywhere inside the surface; `width` is a close estimate until it reports.
 */
export function useMonoCharWidth(): { width: number; probe: ReactNode } {
  const [width, setWidth] = useState(CODE_FONT_SIZE * 0.55);
  const probe = (
    <div style={{ position: "absolute", left: 0, top: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}>
      <text
        onLayout={(event) => {
          const measured = Number(event.width ?? 0) / PROBE_TEXT.length;
          if (measured > 0 && Math.abs(measured - width) > 0.001) setWidth(measured);
        }}
        style={{ color: "#00000000", fontFamily: FONTS.mono, fontSize: CODE_FONT_SIZE, lineHeight: CODE_LINE_HEIGHT, whiteSpace: "nowrap", flexShrink: 0 }}
      >
        {PROBE_TEXT}
      </text>
    </div>
  );
  return { width, probe };
}

/** Expands tabs to the next tab stop so column math and painting agree. */
export function expandTabs(text: string): string {
  if (!text.includes("\t")) return text;
  let out = "";
  for (const char of text) {
    if (char === "\t") out += " ".repeat(TAB_SIZE - (out.length % TAB_SIZE));
    else out += char;
  }
  return out;
}

/** Same expansion applied to a highlighted line, token by token. */
export function expandTokenTabs(tokens: ReadonlyArray<SyntaxToken>): ReadonlyArray<SyntaxToken> {
  if (!tokens.some((token) => token.text.includes("\t"))) return tokens;
  let column = 0;
  return tokens.map((token) => {
    let out = "";
    for (const char of token.text) {
      if (char === "\t") {
        const spaces = TAB_SIZE - (column % TAB_SIZE);
        out += " ".repeat(spaces);
        column += spaces;
      } else {
        out += char;
        column += 1;
      }
    }
    return { text: out, color: token.color };
  });
}

/**
 * Visual row boundaries for one line at `columns` characters: break after the
 * last space that fits, else mid-word (`overflow-wrap: break-word`).
 */
export function wrapLine(text: string, columns: number): ReadonlyArray<readonly [number, number]> {
  if (columns <= 0 || text.length <= columns) return [[0, text.length]];
  const rows: Array<readonly [number, number]> = [];
  let start = 0;
  while (text.length - start > columns) {
    let end = -1;
    // A space right at the limit may hang past it, like CSS pre-wrap.
    for (let index = start + columns; index > start; index -= 1) {
      if (text[index] === " ") {
        end = index + 1;
        break;
      }
    }
    if (end === -1) end = start + columns;
    // Swallow the rest of a run of spaces so the next row starts on a glyph.
    while (end < text.length && text[end] === " " && end - start < columns) end += 1;
    rows.push([start, end]);
    start = end;
  }
  rows.push([start, text.length]);
  return rows;
}

export interface Segment {
  readonly text: string;
  readonly color: string;
  readonly emphasis: boolean;
}

/**
 * The tokens of `[start, end)` split at emphasis boundaries. `tokens` may be
 * null (not highlighted yet): the whole line paints in `fallbackColor`.
 */
export function segmentsFor(
  text: string,
  tokens: ReadonlyArray<SyntaxToken> | null,
  start: number,
  end: number,
  emphasis: ReadonlyArray<readonly [number, number]>,
  fallbackColor: string,
): Segment[] {
  const runs = tokens ?? [{ text, color: fallbackColor }];
  const cuts = new Set<number>([start, end]);
  for (const [from, to] of emphasis) {
    if (from > start && from < end) cuts.add(from);
    if (to > start && to < end) cuts.add(to);
  }
  let offset = 0;
  for (const run of runs) {
    if (offset > start && offset < end) cuts.add(offset);
    offset += run.text.length;
  }
  const points = [...cuts].sort((left, right) => left - right);
  const out: Segment[] = [];
  let runIndex = 0;
  let runStart = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    while (runIndex < runs.length - 1 && runStart + runs[runIndex]!.text.length <= from) {
      runStart += runs[runIndex]!.text.length;
      runIndex += 1;
    }
    const run = runs[runIndex];
    const piece = text.slice(from, to);
    if (piece.length === 0) continue;
    const emphasized = emphasis.some(([emFrom, emTo]) => from >= emFrom && to <= emTo);
    const color = run?.color || fallbackColor;
    const previous = out.at(-1);
    if (previous && previous.color === color && previous.emphasis === emphasized) {
      out[out.length - 1] = { ...previous, text: previous.text + piece };
    } else {
      out.push({ text: piece, color, emphasis: emphasized });
    }
  }
  return out;
}

/** One painted row of runs. Emphasized runs get pierre's word-diff wash. */
export const CodeRun = memo(function CodeRun({
  segments,
  emphasisColor,
}: {
  segments: ReadonlyArray<Segment>;
  emphasisColor?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "row", height: CODE_LINE_HEIGHT, flexShrink: 0, alignItems: "center" }}>
      {segments.map((segment, index) => (
        <text
          key={index}
          style={{
            color: segment.color,
            fontFamily: FONTS.mono,
            fontSize: CODE_FONT_SIZE,
            lineHeight: CODE_LINE_HEIGHT,
            whiteSpace: "nowrap",
            flexShrink: 0,
            ...(segment.emphasis && emphasisColor ? { backgroundColor: emphasisColor, borderRadius: 3 } : {}),
          }}
        >
          {segment.text}
        </text>
      ))}
    </div>
  );
});

/** A 4px change bar. Deletions are pierre's 1px dashed stripe; additions are solid. */
export function ChangeBar({ kind, height, color, stripeBase }: { kind: "addition" | "deletion"; height: number; color: string; stripeBase: string }) {
  if (kind === "addition") {
    return <div style={{ position: "absolute", left: 0, top: 0, width: 4, height, backgroundColor: color, pointerEvents: "none" }} />;
  }
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 4, height, backgroundColor: stripeBase, pointerEvents: "none" }}>
      <svg source={stripeSvg(height)} style={{ width: 4, height, color }} />
    </div>
  );
}

const stripeCache = new Map<number, string>();
function stripeSvg(height: number): string {
  const cached = stripeCache.get(height);
  if (cached) return cached;
  let path = "";
  for (let y = 0; y < height; y += 2) path += `M0 ${y}h4v1H0z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="${height}" viewBox="0 0 4 ${height}"><path fill="currentColor" d="${path}"/></svg>`;
  stripeCache.set(height, svg);
  return svg;
}

const hatchCache = new Map<string, string>();
/** pierre's empty-side buffer: -45deg stripes, 8px period. */
export function hatchSvg(width: number, height: number): string {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const key = `${w}x${h}`;
  const cached = hatchCache.get(key);
  if (cached) return cached;
  let lines = "";
  for (let offset = -h; offset < w + h; offset += 8) {
    lines += `<line x1="${offset}" y1="${h}" x2="${offset + h}" y2="0"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g stroke="currentColor" stroke-width="1.4">${lines}</g></svg>`;
  if (hatchCache.size > 64) hatchCache.clear();
  hatchCache.set(key, svg);
  return svg;
}
