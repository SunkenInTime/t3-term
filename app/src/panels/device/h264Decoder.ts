// H.264 decoding for the Device surface. Web decodes with WebCodecs'
// VideoDecoder (packages/client-runtime/src/device/stream.ts); Bun has no video
// decoder, so each decoder here is an ffmpeg subprocess.
//
// Why ffmpeg and not WASM: measured on the hub's redroid stream (720x1280,
// Constrained Baseline) on a 4 vCPU VM, ffmpeg costs about 3.4 ms of CPU per
// frame in its own process, and handles every profile the hubs produce (iOS
// simulators stream High). The only maintained WASM build of a full H.264
// decoder, libav.js, leaves H.264 out of its published variants; tinyh264
// (h264bsd) decodes Baseline only and took 4.5 ms per frame plus about 8 ms of
// YUV to RGBA conversion, all on the JS thread that also runs React.
//
// Two ffmpeg details keep latency at one decode instead of one frame interval:
// - Input is IVF-framed. ffmpeg's raw `-f h264` parser only ends an access unit
//   when it sees the next one's start code, so a still screen would never show
//   its last frame.
// - Output is PAM through image2pipe. The ffmpeg CLI's rawvideo encoder also
//   holds one frame back; the PAM encoder does not, and its header carries the
//   frame size, so a stream that changes size needs no extra signalling.
import type { Subprocess } from "bun";
import { existsSync, readFileSync } from "node:fs";

export interface DecodedFrame {
  readonly width: number;
  readonly height: number;
  /** Straight-alpha RGBA, top row first. */
  readonly pixels: Uint8Array;
}

export interface H264Decoder {
  /** One Annex B access unit (start-code delimited NAL units). */
  readonly decode: (accessUnit: Uint8Array) => void;
  /** Access units written but not yet returned as frames, like VideoDecoder.decodeQueueSize. */
  readonly queueSize: () => number;
  readonly close: () => void;
}

export interface H264DecoderEvents {
  readonly onFrame: (frame: DecodedFrame) => void;
  /** ffmpeg exited or refused the stream. Not called after `close()`. */
  readonly onError: (detail: string) => void;
}

const FFMPEG_ARGS = [
  "-hide_banner",
  "-nostdin",
  "-loglevel",
  "error",
  "-probesize",
  "32",
  "-analyzeduration",
  "0",
  // Turns off frame threading, which would delay output by one frame per thread.
  "-flags",
  "low_delay",
  "-f",
  "ivf",
  "-i",
  "pipe:0",
  "-flush_packets",
  "1",
  "-f",
  "image2pipe",
  "-c:v",
  "pam",
  "-pix_fmt",
  "rgba",
  "pipe:1",
];

let resolvedFfmpeg: string | null | undefined;

/** The ffmpeg binary: `T3TERM_FFMPEG`, else `ffmpeg` on PATH. Null when neither exists. */
export function ffmpegBinary(): string | null {
  if (resolvedFfmpeg !== undefined) return resolvedFfmpeg;
  const override = process.env.T3TERM_FFMPEG?.trim();
  resolvedFfmpeg = override ? (existsSync(override) ? override : null) : Bun.which("ffmpeg");
  return resolvedFfmpeg;
}

export const FFMPEG_MISSING_DETAIL =
  "Device video needs ffmpeg to decode H.264. Install ffmpeg and make sure it is on PATH (or set T3TERM_FFMPEG to its path), then reconnect.";

function ivfFileHeader(): Uint8Array {
  const header = new Uint8Array(32);
  const view = new DataView(header.buffer);
  header.set([0x44, 0x4b, 0x49, 0x46]); // DKIF
  view.setUint16(4, 0, true);
  view.setUint16(6, 32, true);
  header.set([0x48, 0x32, 0x36, 0x34], 8); // H264
  // Width and height are advisory; the decoder reads the SPS.
  view.setUint32(16, 1000, true);
  view.setUint32(20, 1, true);
  return header;
}

function ivfFrameHeader(size: number, pts: number): Uint8Array {
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  view.setUint32(0, size, true);
  view.setBigUint64(4, BigInt(pts), true);
  return header;
}

const ENDHDR = [0x45, 0x4e, 0x44, 0x48, 0x44, 0x52, 0x0a]; // "ENDHDR\n"
const MAX_PAM_HEADER = 512;

/** Splits ffmpeg's PAM stream into frames without re-concatenating chunks. */
class PamReader {
  private header = new Uint8Array(MAX_PAM_HEADER);
  private headerLength = 0;
  private frame: { width: number; height: number; pixels: Uint8Array; filled: number } | null = null;

  constructor(private readonly onFrame: (frame: DecodedFrame) => void) {}

  push(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.frame) {
        const frame = this.frame;
        const take = Math.min(chunk.length - offset, frame.pixels.length - frame.filled);
        frame.pixels.set(chunk.subarray(offset, offset + take), frame.filled);
        frame.filled += take;
        offset += take;
        if (frame.filled === frame.pixels.length) {
          this.frame = null;
          this.onFrame({ width: frame.width, height: frame.height, pixels: frame.pixels });
        }
        continue;
      }
      if (this.headerLength >= MAX_PAM_HEADER) throw new Error("ffmpeg wrote an unreadable frame header");
      this.header[this.headerLength++] = chunk[offset++]!;
      if (this.headerLength >= ENDHDR.length && this.endsWithEndHdr()) {
        this.frame = this.parseHeader();
        this.headerLength = 0;
      }
    }
  }

  private endsWithEndHdr(): boolean {
    const start = this.headerLength - ENDHDR.length;
    for (let index = 0; index < ENDHDR.length; index++) {
      if (this.header[start + index] !== ENDHDR[index]) return false;
    }
    return true;
  }

  private parseHeader() {
    const text = new TextDecoder().decode(this.header.subarray(0, this.headerLength));
    const field = (name: string) => Number(new RegExp(`^${name} (\\d+)$`, "m").exec(text)?.[1] ?? Number.NaN);
    const width = field("WIDTH");
    const height = field("HEIGHT");
    const depth = field("DEPTH");
    if (!text.startsWith("P7\n") || !(width > 0) || !(height > 0) || depth !== 4) {
      throw new Error("ffmpeg wrote an unexpected frame format");
    }
    return { width, height, pixels: new Uint8Array(width * height * 4), filled: 0 };
  }
}

/** Debug timing: `T3TERM_DEVICE_STATS=1` logs decode latency and ffmpeg CPU every 120 frames. */
const STATS = process.env.T3TERM_DEVICE_STATS === "1";

function cpuSeconds(pid: number): number | null {
  if (process.platform !== "linux") return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return (Number(fields[11]) + Number(fields[12])) / 100;
  } catch {
    return null;
  }
}

export function createH264Decoder(binary: string, events: H264DecoderEvents): H264Decoder {
  let closed = false;
  let written = 0;
  let decoded = 0;
  const sentAt: number[] = [];
  const latencies: number[] = [];
  let statsStart = performance.now();
  let statsCpu = 0;
  let stderrTail = "";

  const fail = (detail: string) => {
    if (closed) return;
    closed = true;
    try {
      child?.kill();
    } catch {}
    events.onError(detail);
  };

  const reader = new PamReader((frame) => {
    if (closed) return;
    decoded++;
    if (STATS) {
      const sent = sentAt.shift();
      if (sent !== undefined) latencies.push(performance.now() - sent);
      if (latencies.length >= 120 && child) {
        const sorted = latencies.toSorted((a, b) => a - b);
        const wall = (performance.now() - statsStart) / 1000;
        const cpu = cpuSeconds(child.pid);
        console.error(
          `[device-decoder] ${frame.width}x${frame.height} frames=${sorted.length} latency p50=${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)}ms p90=${sorted[Math.floor(sorted.length * 0.9)]!.toFixed(1)}ms max=${sorted.at(-1)!.toFixed(1)}ms fps=${(sorted.length / wall).toFixed(1)}${cpu === null ? "" : ` ffmpegCpu=${(((cpu - statsCpu) / wall) * 100).toFixed(1)}%`}`,
        );
        latencies.length = 0;
        statsStart = performance.now();
        statsCpu = cpu ?? 0;
      }
    }
    events.onFrame(frame);
  });

  let child: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  try {
    child = Bun.spawn([binary, ...FFMPEG_ARGS], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
  } catch (cause) {
    queueMicrotask(() => fail(`Could not start ffmpeg: ${(cause as Error).message}`));
  }

  if (child) {
    const running = child;
    void (async () => {
      try {
        for await (const chunk of running.stdout) {
          if (closed) return;
          reader.push(chunk);
        }
      } catch (cause) {
        fail((cause as Error).message);
      }
    })();
    void (async () => {
      const text = new TextDecoder();
      try {
        for await (const chunk of running.stderr) stderrTail = (stderrTail + text.decode(chunk)).slice(-400);
      } catch {}
    })();
    void running.exited.then((code) => {
      if (!closed) fail(`ffmpeg stopped decoding (exit ${code})${stderrTail ? `: ${stderrTail.trim().split("\n").at(-1)}` : ""}`);
    });
    try {
      running.stdin.write(ivfFileHeader());
    } catch {}
  }

  return {
    decode(accessUnit) {
      if (closed || !child) return;
      try {
        child.stdin.write(ivfFrameHeader(accessUnit.length, written));
        child.stdin.write(accessUnit);
        child.stdin.flush();
        written++;
        if (STATS) sentAt.push(performance.now());
      } catch (cause) {
        fail((cause as Error).message);
      }
    },
    queueSize: () => written - decoded,
    close() {
      if (closed) return;
      closed = true;
      try {
        child?.stdin.end();
      } catch {}
      try {
        child?.kill();
      } catch {}
    },
  };
}
