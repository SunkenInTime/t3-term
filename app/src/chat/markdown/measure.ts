// Text widths for laying out markdown inline content in JavaScript.
//
// gpuix has no inline formatting context: a <text> element is one box with one
// style, and every host text element costs ~25 µs per frame. Web's markdown is
// inline runs (links, inline code pills, chips) wrapping as one paragraph, so
// the renderer breaks lines itself and paints a few nowrap runs per line. That
// needs the width of any string in the fonts GPUI actually uses.
//
// Widths come from GPUI itself: TextMeasureHost paints each character repeated
// MEASURE_REPEAT times in a hidden nowrap <text> and reads its onLayout width.
// Summed per-character advances matched GPUI's shaped widths of 500px lines to
// within a pixel (no kerning shows up in Segoe UI or Consolas through
// DirectWrite), so a run's width is the sum of its characters' advances.
// Advances are kept in em (measured at MEASURE_SIZE, scaled linearly) and
// persisted to $T3TERM_HOME/text-metrics.json, so after the first run the
// first frame is already exact.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { useSyncExternalStore } from "react";

import { termHome } from "../../runtime/paths.ts";
import { FONTS } from "../../ui/theme.ts";

export type FontFamilyKind = "sans" | "mono";
export interface FontFace {
  readonly family: FontFamilyKind;
  readonly weight: number;
}

const MEASURE_SIZE = 20;
const MEASURE_REPEAT = 20;
const METRICS_VERSION = 1;

/** Characters most chat text is made of; requested up front for every face in use. */
const BASE_CHARS = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).concat([
  "…",
  "—",
  "–",
  "’",
  "‘",
  "“",
  "”",
  "•",
  "→",
  "←",
  "×",
  "·",
  "✓",
  "◦",
  "▪",
]);

export function faceKey(face: FontFace): string {
  return `${face.family}:${face.weight}`;
}

function fontFamilyName(family: FontFamilyKind): string {
  return family === "mono" ? FONTS.mono : FONTS.sans;
}

// em advances per face key, then per character (one grapheme cluster).
const advances = new Map<string, Map<string, number>>();
const pending = new Map<string, Set<string>>();
let epoch = 0;
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function metricsFile(): string {
  return NodePath.join(termHome(), "text-metrics.json");
}

function fontSignature(): string {
  return `${process.platform}|${FONTS.sans}|${FONTS.mono}`;
}

(function loadPersisted() {
  try {
    const raw = JSON.parse(NodeFS.readFileSync(metricsFile(), "utf8")) as {
      version?: number;
      fonts?: string;
      faces?: Record<string, Record<string, number>>;
    };
    if (raw.version !== METRICS_VERSION || raw.fonts !== fontSignature() || !raw.faces) return;
    for (const [key, chars] of Object.entries(raw.faces)) {
      advances.set(key, new Map(Object.entries(chars)));
    }
  } catch {
    // First run, or an unreadable file: measure again.
  }
})();

function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const faces: Record<string, Record<string, number>> = {};
      for (const [key, chars] of advances) faces[key] = Object.fromEntries(chars);
      NodeFS.mkdirSync(termHome(), { recursive: true });
      NodeFS.writeFileSync(
        metricsFile(),
        JSON.stringify({ version: METRICS_VERSION, fonts: fontSignature(), faces }),
      );
    } catch {
      // Metrics are a cache; a failed write only costs a re-measure next run.
    }
  }, 2000);
}

function notify() {
  epoch += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getEpoch(): number {
  return epoch;
}

/** Re-renders the caller whenever new advances arrive, so layouts made with estimates get redone. */
export function useTextMetricsEpoch(): number {
  return useSyncExternalStore(subscribe, getEpoch, getEpoch);
}

const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u;

function estimateEm(face: FontFace, char: string): number {
  if (face.family === "mono") return 0.55;
  if (WIDE_CHAR.test(char)) return 1;
  return 0.52;
}

function request(face: FontFace, key: string, char: string) {
  let set = pending.get(key);
  if (!set) {
    set = new Set();
    pending.set(key, set);
  }
  if (set.has(char)) return;
  set.add(char);
  scheduleHostUpdate();
}

/** Advance of one character (grapheme) in em. Unknown characters return an estimate and get measured. */
export function advanceEm(face: FontFace, char: string): number {
  const key = faceKey(face);
  let table = advances.get(key);
  if (!table) {
    table = new Map();
    advances.set(key, table);
    for (const base of BASE_CHARS) request(face, key, base);
  }
  const known = table.get(char);
  if (known !== undefined) return known;
  request(face, key, char);
  return estimateEm(face, char);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Splits text into the units advances are kept for. ASCII takes the fast path. */
export function graphemeList(text: string): string[] {
  // eslint-disable-next-line no-control-regex
  if (/^[\u0000-\u007f]*$/.test(text)) return text.split("");
  return Array.from(graphemes.segment(text), (segment) => segment.segment);
}

/** Width in px of `text` set in `face` at `size`. */
export function textWidth(face: FontFace, size: number, text: string): number {
  let em = 0;
  for (const char of graphemeList(text)) em += advanceEm(face, char);
  return em * size;
}

// ── Measuring host ────────────────────────────────────────────────────

let hostUpdate: (() => void) | null = null;
let hostScheduled = false;

function scheduleHostUpdate() {
  if (hostScheduled) return;
  hostScheduled = true;
  queueMicrotask(() => {
    hostScheduled = false;
    hostUpdate?.();
  });
}

export interface MeasureProbe {
  readonly id: string;
  readonly key: string;
  readonly char: string;
  readonly face: FontFace;
  readonly text: string;
  readonly family: string;
}

/** Probes for every requested, unmeasured character. Each probe pairs the char with a reference so space measures. */
export function pendingProbes(): MeasureProbe[] {
  const out: MeasureProbe[] = [];
  for (const [key, chars] of pending) {
    const [family, weight] = key.split(":") as [FontFamilyKind, string];
    const face: FontFace = { family, weight: Number(weight) };
    for (const char of chars) {
      out.push({
        id: `${key}|${char}`,
        key,
        char,
        face,
        // A space alone collapses at the run's edges, so it is measured between two
        // "x" and the pair "xx" is subtracted.
        text: char === " " ? `x${" ".repeat(MEASURE_REPEAT)}x` : char.repeat(MEASURE_REPEAT),
        family: fontFamilyName(family),
      });
    }
    if (chars.has(" ")) {
      out.push({ id: `${key}|xx`, key, char: "\u0000xx", face, text: "xx", family: fontFamilyName(family) });
    }
  }
  return out;
}

const spaceParts = new Map<string, { spaced?: number; pair?: number }>();

/** Records a probe's laid-out width. Returns true when it completed a measurement. */
export function recordProbe(probe: MeasureProbe, width: number) {
  const table = advances.get(probe.key) ?? new Map<string, number>();
  advances.set(probe.key, table);
  const set = pending.get(probe.key);
  if (probe.char === " " || probe.char === "\u0000xx") {
    const parts = spaceParts.get(probe.key) ?? {};
    if (probe.char === " ") parts.spaced = width;
    else parts.pair = width;
    spaceParts.set(probe.key, parts);
    if (parts.spaced === undefined || parts.pair === undefined) return;
    table.set(" ", (parts.spaced - parts.pair) / MEASURE_REPEAT / MEASURE_SIZE);
    spaceParts.delete(probe.key);
    set?.delete(" ");
  } else {
    table.set(probe.char, width / MEASURE_REPEAT / MEASURE_SIZE);
    set?.delete(probe.char);
  }
  if (set && set.size === 0) pending.delete(probe.key);
  measuredSinceNotify = true;
  scheduleNotify();
}

let measuredSinceNotify = false;
let notifyScheduled = false;

function scheduleNotify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  // Probes report in one burst after a frame; one re-layout covers them all.
  setTimeout(() => {
    notifyScheduled = false;
    if (!measuredSinceNotify) return;
    measuredSinceNotify = false;
    persistSoon();
    notify();
    hostUpdate?.();
  }, 0);
}

export function setMeasureHostUpdater(update: (() => void) | null) {
  hostUpdate = update;
  if (update && pending.size > 0) scheduleHostUpdate();
}

export const MEASURE_FONT_SIZE = MEASURE_SIZE;

/** Known advances for a face (em), for renderers that lay text out elsewhere (diagram worker). */
export function advanceTable(face: FontFace): Record<string, number> {
  // Asking for one character makes sure the base set gets measured for this face.
  advanceEm(face, "a");
  return Object.fromEntries(advances.get(faceKey(face)) ?? []);
}
