// Client side of the syntax highlighter: one shared Bun worker (highlightWorker.ts),
// a small result cache, and `useSyntaxTokens`, which returns null until the
// worker answers. Callers paint plain text meanwhile; the font is monospaced, so
// the colors arriving never move a glyph.
import { useEffect, useState } from "react";

import type { HighlightRequest, HighlightResponse } from "./highlightWorker.ts";

export interface SyntaxToken {
  readonly text: string;
  readonly color: string;
}
export type SyntaxLines = ReadonlyArray<ReadonlyArray<SyntaxToken>>;

// pierre's DEFAULT_TOKENIZE_MAX_LENGTH: files past 100k lines stay plain.
const MAX_HIGHLIGHT_LINES = 100_000;
const CACHE_LIMIT = 48;

const cache = new Map<string, SyntaxLines | null>();
const pending = new Map<number, (response: HighlightResponse) => void>();
const inflight = new Map<string, Promise<SyntaxLines | null>>();
let worker: Worker | null | undefined;
let nextId = 1;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./highlightWorker.ts", import.meta.url).href);
    worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      resolve?.(event.data);
    };
    // The worker must not keep the process alive after the window closes.
    (worker as Worker & { unref?: () => void }).unref?.();
  } catch {
    worker = null;
  }
  return worker;
}

function remember(key: string, lines: SyntaxLines | null) {
  cache.delete(key);
  cache.set(key, lines);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function decode(response: HighlightResponse): SyntaxLines | null {
  if (!response.lines) return null;
  return response.lines.map((flat) => {
    const tokens: SyntaxToken[] = [];
    for (let index = 0; index + 1 < flat.length; index += 2) {
      tokens.push({ text: flat[index] as string, color: response.colors[flat[index + 1] as number] ?? "" });
    }
    return tokens;
  });
}

function lineCountAtLeast(code: string, limit: number): boolean {
  let count = 1;
  for (let index = code.indexOf("\n"); index !== -1; index = code.indexOf("\n", index + 1)) {
    if (++count >= limit) return true;
  }
  return false;
}

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  return name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : name;
}

function cacheKey(code: string, path: string, theme: string): string {
  return `${theme}:${extensionOf(path)}:${code.length}:${Bun.hash(code).toString(36)}`;
}

export function highlightTheme(appearance: "dark" | "light"): HighlightRequest["theme"] {
  return appearance === "dark" ? "pierre-dark" : "pierre-light";
}

export function requestSyntaxTokens(code: string, path: string, appearance: "dark" | "light"): Promise<SyntaxLines | null> {
  const theme = highlightTheme(appearance);
  const key = cacheKey(code, path, theme);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const running = inflight.get(key);
  if (running) return running;
  const target = lineCountAtLeast(code, MAX_HIGHLIGHT_LINES) ? null : getWorker();
  if (!target) {
    remember(key, null);
    return Promise.resolve(null);
  }
  const id = nextId++;
  const promise = new Promise<SyntaxLines | null>((resolve) => {
    pending.set(id, (response) => {
      const lines = decode(response);
      remember(key, lines);
      inflight.delete(key);
      resolve(lines);
    });
  });
  inflight.set(key, promise);
  target.postMessage({ id, code, path, theme } satisfies HighlightRequest);
  return promise;
}

export function peekSyntaxTokens(code: string, path: string, appearance: "dark" | "light"): SyntaxLines | null | undefined {
  const key = cacheKey(code, path, highlightTheme(appearance));
  return cache.has(key) ? (cache.get(key) ?? null) : undefined;
}

/** Highlighted lines for `code`, or null while the worker runs (or when it cannot highlight). */
export function useSyntaxTokens(code: string | null, path: string, appearance: "dark" | "light"): SyntaxLines | null {
  const cached = code === null ? null : peekSyntaxTokens(code, path, appearance);
  const [result, setResult] = useState<{ code: string; path: string; appearance: string; lines: SyntaxLines | null } | null>(null);
  useEffect(() => {
    if (code === null || cached !== undefined) return;
    let live = true;
    void requestSyntaxTokens(code, path, appearance).then((lines) => {
      if (live) setResult({ code, path, appearance, lines });
    });
    return () => {
      live = false;
    };
  }, [code, path, appearance, cached === undefined]);
  if (code === null) return null;
  if (cached !== undefined) return cached;
  return result && result.code === code && result.path === path && result.appearance === appearance ? result.lines : null;
}
