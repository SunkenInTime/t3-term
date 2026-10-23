// Tokenizes source with the same Shiki setup the web client uses for diffs and
// file previews (@pierre/diffs' shared highlighter, Oniguruma WASM engine,
// pierre-dark / pierre-light). It runs in a Bun worker so a large file never
// blocks the UI thread; see highlighter.ts for the client side.
import { getFiletypeFromFileName, getSharedHighlighter, type DiffsHighlighter } from "@pierre/diffs";

declare const self: Worker;

export interface HighlightRequest {
  readonly id: number;
  readonly code: string;
  /** The file's path; its extension picks the grammar, like the web viewer. */
  readonly path: string;
  readonly theme: "pierre-dark" | "pierre-light";
}

/** Each line is a flat list of [text, colorIndex, text, colorIndex, ...]. */
export interface HighlightResponse {
  readonly id: number;
  readonly colors: ReadonlyArray<string>;
  readonly lines: ReadonlyArray<ReadonlyArray<string | number>> | null;
}

// web lib/syntaxHighlighting.ts: always the WASM engine, the JS regex engine can
// backtrack catastrophically.
const THEMES = ["pierre-dark", "pierre-light"] as const;
// Shiki gives up on one line past this many characters and returns it plain.
const TOKENIZE_MAX_LINE_LENGTH = 2000;

async function highlighterFor(lang: string): Promise<{ highlighter: DiffsHighlighter; lang: string }> {
  try {
    return { highlighter: await getSharedHighlighter({ themes: [...THEMES], langs: [lang as never], preferredHighlighter: "shiki-wasm" }), lang };
  } catch {
    return { highlighter: await getSharedHighlighter({ themes: [...THEMES], langs: ["text"], preferredHighlighter: "shiki-wasm" }), lang: "text" };
  }
}

let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let response: HighlightResponse;
    try {
      const { highlighter, lang } = await highlighterFor(getFiletypeFromFileName(request.path));
      const result = highlighter.codeToTokens(request.code, {
        lang: lang as never,
        theme: request.theme,
        tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
      });
      const colorIndex = new Map<string, number>();
      const colors: string[] = [];
      const lines = result.tokens.map((line) => {
        const flat: Array<string | number> = [];
        for (const token of line) {
          const color = (token.color ?? result.fg ?? "").toLowerCase();
          let index = colorIndex.get(color);
          if (index === undefined) {
            index = colors.length;
            colors.push(color);
            colorIndex.set(color, index);
          }
          // Merge same-colored neighbours: fewer text runs per painted row.
          if (flat.length > 0 && flat[flat.length - 1] === index) flat[flat.length - 2] = `${flat[flat.length - 2]}${token.content}`;
          else flat.push(token.content, index);
        }
        return flat;
      });
      response = { id: request.id, colors, lines };
    } catch {
      response = { id: request.id, colors: [], lines: null };
    }
    self.postMessage(response);
  });
};
