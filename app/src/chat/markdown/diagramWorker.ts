// Renders Mermaid diagrams (pele, the renderer web uses) and TeX (MathJax's SVG
// output) to standalone SVG off the UI thread. Neither needs a DOM: pele lays
// out with the text widths the client measured in GPUI and sends along, and
// MathJax draws glyphs as paths, so the SVG paints the same through gpuix <img>.
import { render as renderMermaid } from "pele";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

declare const self: Worker;

export type DiagramRequest =
  | {
      readonly id: number;
      readonly kind: "mermaid";
      readonly source: string;
      readonly fontFamily: string;
      readonly monoFamily: string;
      readonly fontSize: number;
      readonly maxWidth: number;
      /** em advances per face ("sans:400", "sans:700", "mono:400"), measured by the client. */
      readonly advances: Readonly<Record<string, Readonly<Record<string, number>>>>;
      /** web's `.pele` theme: values for the `--pele-*` custom properties. */
      readonly theme: Readonly<Record<string, string>>;
    }
  | { readonly id: number; readonly kind: "math"; readonly tex: string; readonly display: boolean; readonly color: string };

export type DiagramResponse =
  | { readonly id: number; readonly svg: string; readonly width: number; readonly height: number; readonly baseline?: number }
  | { readonly id: number; readonly error: string };

// pele's Style bit flags.
const BOLD = 1;
const MONO = 4;

function measurer(advances: Readonly<Record<string, Readonly<Record<string, number>>>>) {
  return {
    width(text: string, size: number, style: number): number {
      const face = style & MONO ? "mono:400" : style & BOLD ? "sans:700" : "sans:400";
      const table = advances[face] ?? advances["sans:400"] ?? {};
      let em = 0;
      for (const char of text) em += table[char] ?? 0.55;
      return em * size;
    },
  };
}

/**
 * Inlines the theme: usvg has no CSS custom properties. pele declares its
 * private `--_x` variables on the root as `var(--pele-y, default)`; `theme`
 * carries web's `.pele` values for the `--pele-*` names.
 */
function resolveMermaidSvg(svg: string, theme: Readonly<Record<string, string>>, fontFamily: string, fontSize: number): string {
  const root = /<svg[^>]*?style="([^"]*)"/.exec(svg)?.[1] ?? "";
  const resolvePele = (text: string) =>
    text.replace(/var\((--pele-[a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name: string, fallback?: string) => theme[name] ?? fallback?.trim() ?? "#888888");
  const locals = new Map<string, string>();
  for (const declaration of root.split(";")) {
    const match = /^\s*(--_[a-z0-9]+)\s*:\s*(.+)$/.exec(declaration);
    if (match) locals.set(match[1]!, resolvePele(match[2]!.trim()));
  }
  let out = svg.replace(/(<svg[^>]*?) style="[^"]*"/, `$1 font-family="${fontFamily}" font-size="${fontSize}"`);
  out = resolvePele(out);
  out = out.replace(/var\((--_[a-z0-9]+)\)/g, (_, name: string) => locals.get(name) ?? "#888888");
  // SVG 2 geometry properties in style attributes; usvg reads them as attributes.
  out = out.replace(/style="rx:\s*([\d.]+)(?:px)?;?"/g, 'rx="$1" ry="$1"');
  return out;
}

let mathDocument: ReturnType<typeof mathjax.document> | null = null;
let adaptor: ReturnType<typeof liteAdaptor> | null = null;

function texToSvg(tex: string, display: boolean, color: string) {
  if (!mathDocument) {
    adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    mathDocument = mathjax.document("", {
      InputJax: new TeX({ packages: AllPackages, formatError: (_jax: unknown, error: Error) => { throw error; } }),
      OutputJax: new SVG({ fontCache: "local" }),
    });
  }
  const node = mathDocument.convert(tex, { display });
  let svg = adaptor!.innerHTML(node);
  // MathJax wraps display math in <mjx-container>; keep the <svg>.
  const start = svg.indexOf("<svg");
  svg = svg.slice(start, svg.lastIndexOf("</svg>") + 6);
  if (svg.includes("data-mjx-error") || svg.includes('data-mml-node="merror"')) throw new Error("TeX error");
  const viewBox = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
  if (!viewBox) throw new Error("No viewBox");
  const minY = Number(viewBox[2]);
  const width = Number(viewBox[3]);
  const height = Number(viewBox[4]);
  svg = svg.replaceAll("currentColor", color).replace(/ style="vertical-align:[^"]*"/, "");
  // viewBox units are thousandths of an em; the baseline is at y = 0.
  return { svg, width: width / 1000, height: height / 1000, baseline: -minY / 1000 };
}

let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<DiagramRequest>) => {
  const request = event.data;
  queue = queue.then(() => {
    let response: DiagramResponse;
    try {
      if (request.kind === "mermaid") {
        const result = renderMermaid(request.source, {
          measurer: measurer(request.advances),
          fontFamily: request.fontFamily,
          fontFamilyMono: request.monoFamily,
          fontSize: request.fontSize,
          maxWidth: request.maxWidth,
          autoDirection: false,
          links: false,
          images: false,
        });
        response = {
          id: request.id,
          svg: resolveMermaidSvg(result.svg, request.theme, request.fontFamily, request.fontSize),
          width: result.width,
          height: result.height,
        };
      } else {
        const result = texToSvg(request.tex, request.display, request.color);
        response = { id: request.id, ...result };
      }
    } catch (error) {
      response = { id: request.id, error: error instanceof Error ? error.message : String(error) };
    }
    self.postMessage(response);
  });
};
