// Client of diagramWorker.ts: one shared Bun worker, a result cache (rows
// remount while the timeline scrolls), and hooks that return null while the
// worker runs. Results are SVG strings shown through <img> as data URLs.
import { useEffect, useState } from "react";

import type { DiagramRequest, DiagramResponse } from "./diagramWorker.ts";

type Payload = DiagramRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;
export type DiagramResult = Extract<DiagramResponse, { svg: string }> | { readonly error: string };

const CACHE_LIMIT = 200;
const cache = new Map<string, DiagramResult>();
const inflight = new Map<string, Promise<DiagramResult>>();
const pending = new Map<number, (response: DiagramResponse) => void>();
let worker: Worker | null | undefined;
let nextId = 1;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    // Compiled binaries embed the worker at its path under src/ (scripts/build.ts).
    const compiled = /~BUN|%7EBUN|\$bunfs/i.test(import.meta.url);
    worker = new Worker(compiled ? "./chat/markdown/diagramWorker.ts" : new URL("./diagramWorker.ts", import.meta.url).href);
    worker.onmessage = (event: MessageEvent<DiagramResponse>) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      resolve?.(event.data);
    };
    (worker as Worker & { unref?: () => void }).unref?.();
  } catch {
    worker = null;
  }
  return worker;
}

function keyOf(payload: Payload): string {
  if (payload.kind === "math") return `math:${payload.display ? 1 : 0}:${payload.color}:${payload.tex}`;
  return `mermaid:${payload.fontSize}:${payload.maxWidth}:${JSON.stringify(payload.theme)}:${payload.source}`;
}

function remember(key: string, value: DiagramResult) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export function peekDiagram(payload: Payload): DiagramResult | undefined {
  return cache.get(keyOf(payload));
}

export function requestDiagram(payload: Payload): Promise<DiagramResult> {
  const key = keyOf(payload);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running) return running;
  const target = getWorker();
  if (!target) {
    const failed = { error: "The diagram renderer is unavailable." };
    remember(key, failed);
    return Promise.resolve(failed);
  }
  const id = nextId++;
  const promise = new Promise<DiagramResult>((resolve) => {
    pending.set(id, (response) => {
      const { id: _id, ...rest } = response;
      const result = rest as DiagramResult;
      remember(key, result);
      inflight.delete(key);
      resolve(result);
    });
  });
  inflight.set(key, promise);
  target.postMessage({ ...payload, id } as DiagramRequest);
  return promise;
}

/** The rendered diagram, or null while the worker runs. `payload` null renders nothing. */
export function useDiagram(payload: Payload | null): DiagramResult | null {
  const key = payload ? keyOf(payload) : null;
  const cached = key ? cache.get(key) : undefined;
  const [result, setResult] = useState<{ key: string; value: DiagramResult } | null>(null);
  useEffect(() => {
    if (!payload || !key || cache.has(key)) return;
    let live = true;
    void requestDiagram(payload).then((value) => {
      if (live) setResult({ key, value });
    });
    return () => {
      live = false;
    };
    // The key captures everything the payload renders from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return null;
  if (cached) return cached;
  return result && result.key === key ? result.value : null;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

// Inline formulas and images are laid out with their rendered size, so a
// result arriving re-lays out the markdown that asked for it.
let epoch = 0;
const epochListeners = new Set<() => void>();

export function bumpAsyncLayout() {
  epoch += 1;
  for (const listener of epochListeners) listener();
}

export function requestInlineDiagram(payload: Payload): DiagramResult | undefined {
  const cached = cache.get(keyOf(payload));
  if (cached) return cached;
  void requestDiagram(payload).then(bumpAsyncLayout);
  return undefined;
}

export function subscribeAsyncLayout(listener: () => void): () => void {
  epochListeners.add(listener);
  return () => epochListeners.delete(listener);
}

export function asyncLayoutEpoch(): number {
  return epoch;
}
