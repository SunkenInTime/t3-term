// Dev-only latency probe for perf passes. Off unless T3TERM_PERF names a
// directory; scripts/shot.ts drives it with {perf: "label"} / {perfEnd: true}.
//
// GPUI draws on its own UI thread on Windows and Linux, so the debug overlay's
// draw time leaves out the JavaScript side (event handlers, React render,
// applyBatch) and any wait between them. During a phase the probe records
// when each React commit ends (applyBatch returns) and when GPUI's frame
// counter moves (polled every few ms). shot.ts writes the wall-clock time it
// sent each input to <dir>/sends.json, and the summary times every input:
//   first   until the first frame drawn after it
//   settle  until the last commit or frame before the next input (or before
//           150 ms pass without either): the screen has caught up
//   js      onEvent (right after the handler) to the end of the next commit
// plus the overlay's draw-time percentiles, frame count and commit count
// (an idle phase should have neither).
//
// Reading the frame counter is a synchronous round trip to the UI thread, so
// it waits out a frame in progress. Latencies taken with the probe on are a
// little pessimistic; the draw percentiles are not affected.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GpuixRenderer, type EventPayload } from "@gpuix/native";

import { auditApplyBatch, layoutAuditReport } from "./layoutAudit.ts";

type Phase = {
  label: string;
  startedAt: number;
  framesAtStart: number;
  frames: number;
  commitMs: number;
  events: number[];
  commits: number[];
  frameTimes: number[];
};

const QUIET_MS = 150;
const POLL_MS = 4;

const dir = process.env.T3TERM_PERF?.trim() || null;

export const perfProbeEnabled = dir !== null;

let renderer: GpuixRenderer | null = null;
let phase: Phase | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const wallNow = () => performance.timeOrigin + performance.now();

function frames(): number {
  return renderer?.getDebugFrameOverlayStats().frames ?? 0;
}

function poll() {
  if (!phase) return;
  const count = frames();
  if (count > phase.frames) {
    phase.frames = count;
    phase.frameTimes.push(wallNow());
  }
}

/** render()'s onEvent: called after each handled input event. */
export function perfOnEvent(_event: EventPayload) {
  phase?.events.push(wallNow());
}

function onCommit(durationMs: number) {
  if (!phase) return;
  phase.commits.push(wallNow());
  phase.commitMs += durationMs;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

const round = (value: number | null | undefined) => (value == null ? null : Math.round(value * 10) / 10);

function readSends(): number[] {
  if (!dir) return [];
  const path = join(dir, "sends.json");
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as number[];
  } catch {
    return [];
  }
}

function endPhase() {
  if (!phase || !renderer || !dir) return;
  const current = phase;
  phase = null;
  if (timer !== null) clearInterval(timer);
  timer = null;
  const stats = renderer.getDebugFrameOverlayStats();
  const end = wallNow();
  const sends = readSends().filter((time) => time >= current.startedAt && time <= end);
  const first: number[] = [];
  const settle: number[] = [];
  sends.forEach((sent, index) => {
    const limit = sends[index + 1] ?? end;
    const activity = [...current.commits, ...current.frameTimes]
      .filter((time) => time >= sent && time < limit)
      .sort((a, b) => a - b);
    const firstFrame = current.frameTimes.find((time) => time >= sent && time < limit);
    if (firstFrame !== undefined) first.push(firstFrame - sent);
    let last = sent;
    for (const time of activity) {
      if (time - last > QUIET_MS) break;
      last = time;
    }
    if (activity.length > 0) settle.push(last - sent);
  });
  const js = current.events.flatMap((time) => {
    const commit = current.commits.find((at) => at >= time);
    return commit === undefined || commit - time > 1000 ? [] : [commit - time];
  });
  const summary = {
    label: current.label,
    seconds: round((end - current.startedAt) / 1000),
    inputs: sends.length,
    drawP90: round(stats.p90Ms),
    drawP99: round(stats.p99Ms),
    drawMax: round(stats.maxMs),
    frames: stats.frames - current.framesAtStart,
    commits: current.commits.length,
    applyBatchMs: round(current.commitMs),
    jsP50: round(percentile(js, 50)),
    jsP90: round(percentile(js, 90)),
    firstP50: round(percentile(first, 50)),
    firstP90: round(percentile(first, 90)),
    settleP50: round(percentile(settle, 50)),
    settleP90: round(percentile(settle, 90)),
    settleMax: round(percentile(settle, 100)),
    react: Object.fromEntries([...regionTotals].map(([id, entry]) => [id, `${entry.renders}x ${round(entry.ms)}ms`])),
  };
  regionTotals.clear();
  appendFileSync(join(dir, "perf.jsonl"), `${JSON.stringify(summary)}\n`);
  console.error("[perf]", JSON.stringify(summary));
}

function startPhase(label: string) {
  if (!renderer) return;
  endPhase();
  renderer.resetDebugFrameOverlayStats();
  regionTotals.clear();
  const count = frames();
  phase = {
    label,
    startedAt: wallNow(),
    framesAtStart: count,
    frames: count,
    commitMs: 0,
    events: [],
    commits: [],
    frameTimes: [],
  };
  timer = setInterval(poll, POLL_MS);
}

// Patched on the prototype, before render() creates the renderer, so the
// layout audit sees the mount batch too.
if (dir) {
  const applyBatch = GpuixRenderer.prototype.applyBatch;
  GpuixRenderer.prototype.applyBatch = function (this: GpuixRenderer, json: string) {
    const started = performance.now();
    const destroyed = applyBatch.call(this, json);
    const elapsed = performance.now() - started;
    const ops = JSON.parse(json) as unknown[][];
    auditApplyBatch(ops);
    if (process.env.PERF_DEBUG && phase) {
      const kinds: Record<string, number> = {};
      for (const op of ops) kinds[String(op[0])] = (kinds[String(op[0])] ?? 0) + 1;
      console.error("[perfdbg] batch", json.length, JSON.stringify(kinds));
      if (process.env.PERF_DEBUG === "ops") console.error(json.slice(0, 4000));
    }
    onCommit(elapsed);
    return destroyed;
  };
}

/** Call once after render(). Reads phase commands from <dir>/ctl.txt. */
export function installPerfProbe() {
  if (!dir) return;
  const slot = Reflect.get(globalThis, "__gpuixRenderHost") as { renderer?: GpuixRenderer } | undefined;
  if (!slot?.renderer) return;
  renderer = slot.renderer;
  mkdirSync(dir, { recursive: true });
  // Stats are recorded only while the overlay is on.
  if (renderer.getDebugFrameOverlay() === "hidden") renderer.setDebugFrameOverlay("minimal");
  // Commands: "<seq> phase <label>" or "<seq> end". Polled, not sent as input,
  // so markers never cause a frame of their own.
  const control = join(dir, "ctl.txt");
  rmSync(control, { force: true });
  let lastSeq = "";
  setInterval(() => {
    if (!existsSync(control)) return;
    const line = readFileSync(control, "utf8").trim();
    const [seq, command, ...rest] = line.split(" ");
    if (!seq || seq === lastSeq) return;
    lastSeq = seq;
    if (command === "phase") startPhase(rest.join(" "));
    else if (command === "end") endPhase();
    else if (command === "layout") writeFileSync(join(dir, `${rest.join(" ") || "layout"}.layout.txt`), layoutAuditReport());
  }, 20);
}

// Per-region React render time (development React only; production builds
// report zero). Logged per phase as renders and total ms per region.
const regionTotals = new Map<string, { renders: number; ms: number }>();

export function perfOnRender(id: string, _phase: string, actualDuration: number) {
  if (!phase) return;
  const entry = regionTotals.get(id) ?? { renders: 0, ms: 0 };
  entry.renders += 1;
  entry.ms += actualDuration;
  regionTotals.set(id, entry);
}
