// A read-only source file the way the web Files surface paints it (@pierre/diffs
// File in editor mode): line-number gutter, Shiki pierre-dark/light colors,
// soft wrap by default (client setting `wordWrap`) or one shared horizontal pan.
// Rows sit in a windowed <virtual-list>, so a 1 MB file mounts a screenful.
import type { EventPayload } from "@gpuix/native";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";

import { FONTS, useTheme } from "../../ui/theme.ts";
import { diffPalette, mix } from "./palette.ts";
import { CODE_LINE_HEIGHT, CodeRun, expandTabs, expandTokenTabs, segmentsFor, useMonoCharWidth, wrapLine } from "./codeRows.tsx";
import { useSyntaxTokens, type SyntaxToken } from "./highlighter.ts";

const WINDOW = 200;
const PADDING_Y = 8;

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).map(expandTabs);
}

export function SourceView(props: {
  readonly path: string;
  readonly text: string;
  readonly wrap: boolean;
  /** 1-based line to center and tint, or null. */
  readonly revealLine: number | null;
  readonly revealKey: string;
  readonly testId?: string;
}) {
  const theme = useTheme();
  const palette = diffPalette(theme);
  const renderer = useGpuixRequired();
  const listRef = useRef<PublicInstance | null>(null);
  const { width: ch, probe } = useMonoCharWidth();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [start, setStart] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const lines = useMemo(() => splitLines(props.text), [props.text]);
  const syntax = useSyntaxTokens(props.text, props.path, theme.appearance);
  const digits = String(lines.length).length;
  const gutter = Math.ceil((digits + 3) * ch);
  const longest = useMemo(() => (props.wrap ? 0 : lines.reduce((max, line) => Math.max(max, line.length), 0)), [lines, props.wrap]);
  const maxScrollX = props.wrap ? 0 : Math.max(0, Math.ceil((longest + 2) * ch) - (size.width - gutter - 2));
  const clampedScrollX = Math.min(scrollX, maxScrollX);
  const columns = Math.max(1, Math.floor((size.width - gutter - 2 - 2 * ch) / ch));

  // Center the revealed line once per request (FilePreviewPanel's reveal).
  const handled = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (props.revealLine === null || listRef.current === null || size.height === 0) return;
    if (handled.current === props.revealKey) return;
    handled.current = props.revealKey;
    const index = Math.min(lines.length - 1, Math.max(0, props.revealLine - 1));
    setStart(Math.max(0, index - WINDOW / 2));
    renderer.scrollToItem?.(listRef.current.id, index + 1, -Math.max(0, Math.floor(size.height / 2 - CODE_LINE_HEIGHT / 2)));
  }, [props.revealLine, props.revealKey, size.height, lines.length, renderer]);

  const end = Math.min(lines.length, start + WINDOW);
  const rows = [];
  // Item 0 is the top padding row; line N is item N.
  // The code surface ends with the file (pierre's File is content-sized), so the
  // panel background shows below a short file.
  const codeBg = theme.codeBackground;
  if (start === 0) rows.push(<div key="pad-top" style={{ height: PADDING_Y, backgroundColor: codeBg }} />);
  for (let index = start; index < end; index += 1) {
    rows.push(
      <SourceLine
        key={index}
        number={index + 1}
        text={lines[index]!}
        tokens={syntax?.[index] ?? null}
        wrap={props.wrap}
        columns={columns}
        gutter={gutter}
        width={size.width}
        ch={ch}
        scrollX={clampedScrollX}
        revealed={props.revealLine === index + 1}
        fg={palette.fg}
        numberColor={palette.number}
        revealColor={mix(theme.codeBackground.slice(0, 7), theme.primary.slice(0, 7), 0.18)}
        background={codeBg}
      />,
    );
  }
  if (end === lines.length) rows.push(<div key="pad-bottom" style={{ height: PADDING_Y, backgroundColor: codeBg }} />);

  return (
    <div
      {...(props.testId ? { testId: props.testId } : {})}
      onLayout={(event) => {
        const width = Math.floor(Number(event.width ?? 0));
        const height = Math.floor(Number(event.height ?? 0));
        if (width > 0 && (width !== size.width || height !== size.height)) setSize({ width, height });
      }}
      onScroll={(event: EventPayload) => {
        if (props.wrap) return;
        const deltaX = Number(event.deltaX ?? 0);
        if (deltaX !== 0) setScrollX((current) => Math.max(0, Math.min(maxScrollX, current - deltaX)));
      }}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, position: "relative", backgroundColor: theme.background }}
    >
      {probe}
      {size.width > 0 ? (
        <virtual-list
          ref={listRef}
          itemCount={lines.length + 2}
          windowStart={start === 0 ? 0 : start + 1}
          estimatedItemHeight={CODE_LINE_HEIGHT}
          overdraw={600}
          onVisibleRange={(event) => {
            const first = Math.max(0, Math.floor(Number(event.startIndex ?? 0)) - 1);
            const last = Math.ceil(Number(event.endIndex ?? first));
            if (first < start || last > start + WINDOW - 8) setStart(Math.max(0, first - WINDOW / 4));
          }}
          style={{ flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar }}
        >
          {rows}
        </virtual-list>
      ) : null}
    </div>
  );
}

const SourceLine = memo(function SourceLine(props: {
  number: number;
  text: string;
  tokens: ReadonlyArray<SyntaxToken> | null;
  wrap: boolean;
  columns: number;
  gutter: number;
  width: number;
  ch: number;
  scrollX: number;
  revealed: boolean;
  fg: string;
  numberColor: string;
  revealColor: string;
  background: string;
}) {
  const tokens = props.tokens ? expandTokenTabs(props.tokens) : null;
  const ranges = props.wrap ? wrapLine(props.text, props.columns) : [[0, props.text.length] as const];
  const height = ranges.length * CODE_LINE_HEIGHT;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: props.width,
        height,
        backgroundColor: props.revealed ? props.revealColor : props.background,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "flex-end",
          width: props.gutter,
          height,
          flexShrink: 0,
          paddingRight: Math.round(props.ch),
          userSelect: "none",
        }}
      >
        <text style={{ color: props.numberColor, fontFamily: FONTS.mono, fontSize: 13, lineHeight: CODE_LINE_HEIGHT, whiteSpace: "nowrap" }}>
          {String(props.number)}
        </text>
      </div>
      <div style={{ width: 2, flexShrink: 0 }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minWidth: 0,
          height,
          overflow: "hidden",
          paddingLeft: props.ch,
          paddingRight: props.ch,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, marginLeft: props.wrap ? 0 : -props.scrollX }}>
          {ranges.map((range, index) => (
            <CodeRun key={index} segments={segmentsFor(props.text, tokens, range[0], range[1], [], props.fg)} />
          ))}
        </div>
      </div>
    </div>
  );
});
