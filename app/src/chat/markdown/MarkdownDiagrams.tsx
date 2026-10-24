// web's MarkdownMath (KaTeX) and MarkdownMermaidCodeBlock + MermaidDiagram
// (pele), drawn without a DOM: the diagram worker renders SVG, shown through
// <img> as a data URL. While the worker runs, and when it cannot parse the
// source, both show what web shows: the TeX source, or the code block.
import { memo, useState } from "react";

import { FONTS, alpha, type Palette } from "../../ui/theme.ts";
import { advanceTable } from "./measure.ts";
import { requestInlineDiagram, svgDataUrl, useDiagram } from "./diagrams.ts";
import type { BoxAtom, RunStyle } from "./inline.ts";
import { CodeBlockIconButton, HighlightedCode, MarkdownCodeBlock, useCopyFeedback } from "./MarkdownCodeBlock.tsx";
import { MARGIN_AWARE, type RenderEnv } from "./MarkdownView.tsx";
import { baselineOffset, type MarkdownStyles } from "./styles.ts";
import { openExpandedImage } from "./MarkdownMedia.tsx";

/** KaTeX sets `.katex { font-size: 1.21em }`; MathJax's viewBox is in em, scaled to match. */
const MATH_SCALE = 1.21;

function mathColor(color: string): string {
  // usvg reads #rrggbbaa, but premultiplied alpha on thin strokes looks heavier; flatten alpha into opacity.
  return color.length === 9 ? color.slice(0, 7) : color;
}

function mathOpacity(color: string): number {
  return color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) / 255 : 1;
}

export interface InlineMathPayload {
  readonly type: "math";
  readonly url: string;
  readonly top: number;
  readonly opacity: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly centred: boolean;
}

/** An inline formula as a box atom sized from its rendered SVG, or null until the worker answers (the TeX shows meanwhile). */
export function inlineMathAtom(id: string, tex: string, display: boolean, style: RunStyle, lineWidth: number): BoxAtom | null {
  const result = requestInlineDiagram({ kind: "math", tex: tex.trim(), display, color: mathColor(style.color) });
  if (!result || "error" in result) return null;
  const em = style.size * MATH_SCALE;
  const width = result.width * em;
  const height = result.height * em;
  const url = svgDataUrl(result.svg);
  const opacity = mathOpacity(style.color);
  if (display) {
    // A display formula takes the line: centred, py-0.75 around it.
    return {
      kind: "box",
      id,
      width: Math.max(lineWidth, width + 4) - 0.02,
      height: height + 6,
      payload: { type: "math", url, top: 3, opacity, imageWidth: width, imageHeight: height, centred: true } satisfies InlineMathPayload,
    };
  }
  const lineBaseline = baselineOffset(style.face.family, style.size, style.lineHeight);
  const top = lineBaseline - (result.baseline ?? 0) * em;
  // px-0.5 around the formula.
  const lift = Math.max(0, -top);
  return {
    kind: "box",
    id,
    width: width + 4,
    height: Math.max(style.lineHeight, top + height),
    lift,
    payload: { type: "math", url, top, opacity, imageWidth: width, imageHeight: height, centred: false } satisfies InlineMathPayload,
  };
}

export function InlineMathBox({ atom }: { atom: BoxAtom }) {
  const payload = atom.payload as InlineMathPayload;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: payload.centred ? "center" : "flex-start",
        flexShrink: 0,
        width: atom.width,
        paddingLeft: 2,
        paddingRight: 2,
      }}
    >
      <img src={payload.url} style={{ width: payload.imageWidth, height: payload.imageHeight, marginTop: payload.top, opacity: payload.opacity, flexShrink: 0 }} />
    </div>
  );
}

/** web MarkdownMath display: a block of its own, my-[0.65rem], centred, scrolling sideways when wider than the message. */
export const MathBlock = memo(function MathBlock({
  tex,
  width,
  styles,
  marginTop,
}: {
  tex: string;
  width: number;
  styles: MarkdownStyles;
  marginTop?: number;
}) {
  const color = styles.color;
  const result = useDiagram({ kind: "math", tex: tex.trim(), display: true, color: mathColor(color) });
  if (!result || "error" in result) {
    // Unfinished or unsupported TeX stays readable as its source (web's fallback).
    return (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop, paddingTop: 3, paddingBottom: 3 }}>
        {`\\[\n${tex.trim()}\n\\]`.split("\n").map((line, index) => (
          <text key={index} style={{ fontFamily: FONTS.sans, fontSize: styles.size, lineHeight: styles.lineHeight, color }}>
            {line}
          </text>
        ))}
      </div>
    );
  }
  const em = styles.size * MATH_SCALE;
  const imageWidth = result.width * em;
  const imageHeight = result.height * em;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: imageWidth + 4 <= width ? "center" : "flex-start",
        width: "100%",
        marginTop,
        paddingTop: 3,
        paddingBottom: 3,
        paddingLeft: 2,
        paddingRight: 2,
        overflowX: "scroll",
      }}
    >
      <img src={svgDataUrl(result.svg)} style={{ width: imageWidth, height: imageHeight, flexShrink: 0, opacity: mathOpacity(color) }} />
    </div>
  );
});
MARGIN_AWARE.add(MathBlock);

/** web's `.pele` theme (index.css 1734). */
function peleTheme(palette: Palette): Record<string, string> {
  return {
    "--pele-bg": palette.background,
    "--pele-fg": palette.foreground,
    "--pele-muted": palette.mutedForeground,
    "--pele-line": palette.mutedForeground,
    "--pele-surface": palette.secondary,
    "--pele-surface-alt": palette.accent,
    "--pele-border": alpha(palette.foreground, 0.28),
    "--pele-accent": palette.primary,
    "--pele-critical": palette.error,
    "--pele-font": FONTS.sans,
    "--pele-font-mono": FONTS.mono,
  };
}

/**
 * MarkdownMermaidCodeBlock: a finished ```mermaid fence shows the diagram
 * under a bare header (show code, copy); the toggle swaps to the code card.
 * Clicking the diagram opens it in the image viewer.
 */
export const MermaidBlock = memo(function MermaidBlock({
  code,
  meta,
  width,
  env,
  isStreaming,
  marginTop,
}: {
  code: string;
  meta: string | undefined;
  width: number;
  env: RenderEnv;
  isStreaming: boolean;
  marginTop?: number;
}) {
  const styles = env.styles;
  const [showCode, setShowCode] = useState(false);
  const [copied, copy] = useCopyFeedback();
  const showDiagram = !showCode && !isStreaming && code.trim().length > 0;
  const result = useDiagram(
    showDiagram
      ? {
          kind: "mermaid",
          source: code.trim(),
          fontFamily: FONTS.sans,
          monoFamily: FONTS.mono,
          // pele's own default: web mounts it without a font-size override.
          fontSize: 16,
          maxWidth: Math.floor(width),
          advances: {
            "sans:400": advanceTable({ family: "sans", weight: 400 }),
            "sans:700": advanceTable({ family: "sans", weight: 700 }),
            "mono:400": advanceTable({ family: "mono", weight: 400 }),
          },
          theme: peleTheme(styles.palette),
        }
      : null,
  );
  const toggle = isStreaming ? null : (
    <CodeBlockIconButton icon={showCode ? "workflow" : "code"} label={showCode ? "Show diagram" : "Show code"} onClick={() => setShowCode((value) => !value)} />
  );
  if (!showDiagram || (result && "error" in result && !showCode)) {
    const error = result && "error" in result ? result.error : null;
    return (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop }}>
        {error && showDiagram ? (
          <text style={{ fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, color: styles.palette.errorForeground, marginBottom: 8 }}>
            {`Unable to render diagram: ${error}`}
          </text>
        ) : null}
        <MarkdownCodeBlock code={code} language="mermaid" meta={meta} width={width} styles={styles} isStreaming={isStreaming} viewToggle={toggle} />
      </div>
    );
  }
  const scale = result && !("error" in result) ? Math.min(1, width / Math.max(1, result.width)) : 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop, borderWidth: 1, borderColor: "#00000000" }}>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 2, paddingTop: 6, paddingRight: 6, userSelect: "none" }}>
        {toggle}
        <CodeBlockIconButton icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy code"} onClick={() => copy(code)} />
      </div>
      {result && !("error" in result) ? (
        <div
          onClick={() => openExpandedImage({ images: [{ src: svgDataUrl(result.svg), name: "Mermaid diagram", width: result.width, height: result.height }], index: 0 })}
          style={{ display: "flex", flexDirection: "row", justifyContent: "center", width: "100%", cursor: "pointer" }}
        >
          <img src={svgDataUrl(result.svg)} style={{ width: result.width * scale, height: result.height * scale }} />
        </div>
      ) : (
        // web's Suspense fallback: the source, invisible, holding the space.
        <div style={{ opacity: 0 }}>
          <HighlightedCode code={code} language="mermaid" width={width} wrapped styles={styles} />
        </div>
      )}
    </div>
  );
});
MARGIN_AWARE.add(MermaidBlock);
