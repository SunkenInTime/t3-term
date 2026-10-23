// Port of packages/client-runtime/src/device/stream.ts (createDeviceStreamClient)
// for a host without WebCodecs, canvases or WebRTC. The transport, retry and
// input code follow web line for line; what differs:
// - Decoding: an ffmpeg subprocess (h264Decoder.ts) stands in for VideoDecoder.
//   Android's Annex B packets go in as they are; iOS's AVCC chunks are rewritten
//   to Annex B with the description's SPS and PPS in front of each keyframe.
// - Output: decoded RGBA (or MJPEG's JPEG bytes) goes to a sink the view paints
//   into a gpuix <img>, instead of a canvas.
// - iOS without ffmpeg falls back to MJPEG like web without WebCodecs, read
//   with fetch rather than an <img>. WebRTC-only simulators cannot play: Bun has
//   no RTCPeerConnection, which web also treats as a failure.
// - The iPhone Duo panel feeds exist for the 3D view only, which t3-term lacks.
import { type DeviceHubAccess, withDeviceHubQuery } from "@t3tools/client-runtime/device/hub-access";
import type { DevicePlatform } from "@t3tools/contracts";

import { createH264Decoder, ffmpegBinary, FFMPEG_MISSING_DETAIL, type H264Decoder } from "./h264Decoder.ts";

// Types and parsers below are copied from client-runtime's stream.ts: importing
// that module pulls its WebCodecs and WebRTC code into this app's typecheck.
export type DeviceStreamStatus = "connecting" | "streaming" | "error";

export interface DeviceScreenSize {
  readonly width: number;
  readonly height: number;
  readonly orientation: "portrait" | "portrait_upside_down" | "landscape_left" | "landscape_right";
  readonly screenId?: number;
  readonly supportsHingeAngle?: boolean;
  readonly supportsPhysicalOrientation?: boolean;
  readonly hingeAngle?: number;
  readonly tableMode?: boolean;
  readonly tableModeAvailable?: boolean;
}

export type DeviceHardwareButton = "home" | "back" | "recents" | "power" | "appSwitcher";

const SEMU_MAGIC = 0x53454d55;
const SEMU_HEADER_BYTES = 16;
const SEMU_FLAG_KEY = 1;

export function parseSemuPacket(raw: ArrayBuffer): {
  readonly data: Uint8Array;
  readonly isKey: boolean | null;
  readonly timestamp: number | null;
} {
  const bytes = new Uint8Array(raw);
  if (bytes.byteLength > SEMU_HEADER_BYTES) {
    const view = new DataView(raw, 0, SEMU_HEADER_BYTES);
    if (view.getUint32(0, false) === SEMU_MAGIC && view.getUint8(4) === 1) {
      const pts = view.getBigUint64(8, false);
      return {
        data: bytes.subarray(SEMU_HEADER_BYTES),
        isKey: (view.getUint8(5) & SEMU_FLAG_KEY) !== 0,
        timestamp: pts <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(pts) : null,
      };
    }
  }
  return { data: bytes, isKey: null, timestamp: null };
}

export function scanAccessUnit(buf: Uint8Array): { isKey: boolean; sps: Uint8Array | null } {
  let isKey = false;
  let sps: Uint8Array | null = null;
  const len = buf.length;
  let i = 0;
  while (i + 2 < len) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      let codeLen = 0;
      if (buf[i + 2] === 1) codeLen = 3;
      else if (i + 3 < len && buf[i + 2] === 0 && buf[i + 3] === 1) codeLen = 4;
      if (codeLen) {
        const nalType = buf[i + codeLen]! & 0x1f;
        if (nalType === 7 && !sps) sps = buf.subarray(i + codeLen);
        if (nalType === 5) isKey = true;
        i += codeLen + 1;
        continue;
      }
    }
    i++;
  }
  return { isKey, sps };
}

type AvccChunk = { readonly type: "description" | "keyframe" | "delta" | "seed"; readonly payload: Uint8Array };

const AVCC_TAGS: Record<number, AvccChunk["type"] | undefined> = { 1: "description", 2: "keyframe", 3: "delta", 4: "seed" };

export class AvccDemuxer {
  private buffer = new Uint8Array(64 * 1024);
  private length = 0;

  push(bytes: Uint8Array): AvccChunk[] {
    if (this.length + bytes.length > this.buffer.length) {
      let capacity = this.buffer.length;
      while (capacity < this.length + bytes.length) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
    const chunks: AvccChunk[] = [];
    let offset = 0;
    while (this.length - offset >= 4) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset, 4);
      const frameLength = view.getUint32(0, false);
      if (this.length - offset - 4 < frameLength) break;
      if (frameLength >= 1) {
        const type = AVCC_TAGS[this.buffer[offset + 4]!];
        if (type) chunks.push({ type, payload: this.buffer.slice(offset + 5, offset + 4 + frameLength) });
      }
      offset += 4 + frameLength;
    }
    if (offset > 0) {
      this.buffer.copyWithin(0, offset, this.length);
      this.length -= offset;
    }
    return chunks;
  }
}

export type DeviceFrame =
  | { readonly kind: "pixels"; readonly width: number; readonly height: number; readonly pixels: Uint8Array }
  | { readonly kind: "jpeg"; readonly width: number; readonly height: number; readonly bytes: Uint8Array };

/** frame.ts DeviceFrameSink: false means the frame could not be shown. */
export interface DeviceFrameSink {
  readonly present: (frame: DeviceFrame) => boolean;
}

export interface DeviceStreamEvents {
  readonly onStatus: (status: DeviceStreamStatus, detail?: string) => void;
  readonly onScreen: (screen: DeviceScreenSize) => void;
  readonly onUnauthorized: () => void;
  readonly onInputConnected: (connected: boolean, detail?: string) => void;
}

export interface DeviceStreamTarget {
  readonly platform: DevicePlatform;
  readonly deviceId: string;
  readonly access: DeviceHubAccess;
}

/** The parts of a KeyboardEvent web's sendKey reads. */
export interface DeviceKey {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

export interface DeviceStreamClient {
  readonly start: () => void;
  readonly stop: () => void;
  /** Normalized 0..1 coordinates in the displayed frame. */
  readonly sendTouch: (phase: "begin" | "move" | "end", x: number, y: number) => void;
  readonly sendKey: (event: DeviceKey, phase: "down" | "up") => void;
  /** Android only: iOS input is HID key codes, which cannot carry arbitrary text. */
  readonly sendText: (text: string) => void;
  readonly pressButton: (button: DeviceHardwareButton) => void;
  readonly rotate: () => void;
  readonly setOrientation: (orientation: DeviceScreenSize["orientation"]) => void;
}

const RETRY_DELAY_MS = 1_000;
const FIRST_FRAME_TIMEOUT_MS = 15_000;
const SOFT_DECODE_QUEUE = 8;
// expo-device-hub 0.15.3 serve-emu input.js MAX_TEXT_BYTES limits packets to 300 UTF-8 bytes.
const ANDROID_MAX_TEXT_BYTES = 300;
// The pinned hub queue depth is 128; the client does not read queue rejections.
const ANDROID_MAX_TEXT_CHUNKS = 64;
const MJPEG_MAX_FRAME_BYTES = 16 * 1024 * 1024;

const IOS_MSG_TOUCH = 0x03;
const IOS_MSG_BUTTON = 0x04;
const IOS_MSG_KEY = 0x06;
const IOS_MSG_ORIENTATION = 0x07;
const IOS_TAG_SCREEN_CONFIG = 0x82;
const IOS_TAG_INPUT_ADMITTED = 0x83;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function taggedJson(tag: number, payload: unknown): Uint8Array<ArrayBuffer> {
  const json = encoder.encode(JSON.stringify(payload));
  const out = new Uint8Array(1 + json.length);
  out[0] = tag;
  out.set(json, 1);
  return out;
}

const SCREEN_ORIENTATIONS = new Set(["portrait", "portrait_upside_down", "landscape_left", "landscape_right"]);

/** stream.ts screenConfigSchema, checked by hand to keep Effect Schema out of the hot path. */
function decodeScreenConfig(payload: unknown): (DeviceScreenSize & { readonly inputUnavailable?: boolean }) | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.width !== "number" || !(value.width > 0) || !Number.isFinite(value.width)) return null;
  if (typeof value.height !== "number" || !(value.height > 0) || !Number.isFinite(value.height)) return null;
  if (typeof value.orientation !== "string" || !SCREEN_ORIENTATIONS.has(value.orientation)) return null;
  return value as unknown as DeviceScreenSize & { readonly inputUnavailable?: boolean };
}

const isVideoSessionMessage = (text: string) => {
  try {
    const message = JSON.parse(text) as { type?: unknown };
    return message.type === "video-session";
  } catch {
    return false;
  }
};

const START_CODE = Uint8Array.of(0, 0, 0, 1);

/** The SPS and PPS of an avcC record, and its NAL length size, for AVCC → Annex B. */
function parseAvcConfig(description: Uint8Array): { lengthSize: number; parameterSets: Uint8Array } | null {
  if (description.length < 7 || description[0] !== 1) return null;
  const lengthSize = (description[4]! & 0x03) + 1;
  const sets: Uint8Array[] = [];
  let position = 5;
  for (const mask of [0x1f, 0xff]) {
    if (position >= description.length) return null;
    const count = description[position++]! & mask;
    for (let index = 0; index < count; index++) {
      if (position + 2 > description.length) return null;
      const length = description[position]! * 256 + description[position + 1]!;
      position += 2;
      if (position + length > description.length) return null;
      sets.push(START_CODE, description.subarray(position, position + length));
      position += length;
    }
  }
  return { lengthSize, parameterSets: concat(sets) };
}

function avccToAnnexB(payload: Uint8Array, lengthSize: number, prefix: Uint8Array | null): Uint8Array | null {
  const parts: Uint8Array[] = prefix ? [prefix] : [];
  let position = 0;
  while (position + lengthSize <= payload.length) {
    let length = 0;
    for (let index = 0; index < lengthSize; index++) length = length * 256 + payload[position + index]!;
    position += lengthSize;
    if (length === 0 || position + length > payload.length) return null;
    parts.push(START_CODE, payload.subarray(position, position + length));
    position += length;
  }
  return position === payload.length ? concat(parts) : null;
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** JPEG frames out of a multipart/x-mixed-replace body: SOI…EOI, whatever the part headers say. */
class MjpegReader {
  private buffer = new Uint8Array(256 * 1024);
  private length = 0;

  push(chunk: Uint8Array): Uint8Array[] {
    if (this.length + chunk.length > this.buffer.length) {
      if (this.length + chunk.length > MJPEG_MAX_FRAME_BYTES) this.length = 0;
      const grown = new Uint8Array(Math.max(this.buffer.length * 2, this.length + chunk.length));
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(chunk, this.length);
    this.length += chunk.length;
    const frames: Uint8Array[] = [];
    let consumed = 0;
    for (;;) {
      const start = this.find(0xd8, consumed);
      if (start < 0) break;
      const end = this.find(0xd9, start + 2);
      if (end < 0) {
        consumed = start;
        break;
      }
      frames.push(this.buffer.slice(start, end + 2));
      consumed = end + 2;
    }
    this.buffer.copyWithin(0, consumed, this.length);
    this.length -= consumed;
    return frames;
  }

  private find(marker: number, from: number): number {
    for (let index = from; index + 1 < this.length; index++) {
      if (this.buffer[index] === 0xff && this.buffer[index + 1] === marker) return index;
    }
    return -1;
  }
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]! };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + ((bytes[offset + 2]! << 8) | bytes[offset + 3]!);
  }
  return null;
}

const HID_USAGE_BY_CODE: Readonly<Record<string, number>> = {
  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  Space: 0x2c,
  Minus: 0x2d,
  Equal: 0x2e,
  BracketLeft: 0x2f,
  BracketRight: 0x30,
  Backslash: 0x31,
  Semicolon: 0x33,
  Quote: 0x34,
  Backquote: 0x35,
  Comma: 0x36,
  Period: 0x37,
  Slash: 0x38,
  Delete: 0x4c,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,
  ControlLeft: 0xe0,
  ShiftLeft: 0xe1,
  AltLeft: 0xe2,
  MetaLeft: 0xe3,
  ControlRight: 0xe4,
  ShiftRight: 0xe5,
  AltRight: 0xe6,
  MetaRight: 0xe7,
};

function hidUsageForCode(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return 0x04 + (code.charCodeAt(3) - 65);
  if (/^Digit[1-9]$/.test(code)) return 0x1e + (code.charCodeAt(5) - 49);
  if (code === "Digit0") return 0x27;
  return HID_USAGE_BY_CODE[code] ?? null;
}

const ANDROID_KEYCODE_BY_KEY: Readonly<Record<string, number>> = {
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Tab: 61,
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
};

const IOS_ORIENTATIONS: ReadonlyArray<DeviceScreenSize["orientation"]> = [
  "portrait",
  "landscape_left",
  "portrait_upside_down",
  "landscape_right",
];

export function createDeviceStreamClient(
  target: DeviceStreamTarget,
  sink: DeviceFrameSink,
  events: DeviceStreamEvents,
): DeviceStreamClient {
  const { access, platform, deviceId } = target;
  const vendor = platform === "ios" ? "/vendor/serve-sim" : "/vendor/serve-emu";
  const device = encodeURIComponent(deviceId);
  const httpUrl = (path: string) => withDeviceHubQuery(`${access.httpBase}${vendor}${path}`, access);
  const wsUrl = (path: string) => withDeviceHubQuery(`${access.wsBase}${vendor}${path}`, access);

  let stopped = true;
  let socket: WebSocket | null = null;
  let controller: AbortController | null = null;
  const retryTimers = new Map<"video" | "input", ReturnType<typeof setTimeout>>();
  let primeController: AbortController | null = null;
  let videoDecoder: H264Decoder | null = null;
  let iosInputAdmitted = false;
  let iosInputUnavailable = false;
  let awaitingKeyframe = true;
  let screen: DeviceScreenSize | null = null;
  let firstFrame = false;
  let mjpeg = false;
  let generation = 0;
  let decoderEpoch = 0;
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  let videoReadTimer: ReturnType<typeof setTimeout> | null = null;
  let videoGeneration = 0;
  let avcConfig: { lengthSize: number; parameterSets: Uint8Array } | null = null;
  let decodedVideoGeneration: number | null = null;

  const setStatus = (status: DeviceStreamStatus, detail?: string) => {
    if (!stopped) events.onStatus(status, detail);
  };

  const clearFrameTimer = () => {
    if (frameTimer !== null) clearTimeout(frameTimer);
    frameTimer = null;
  };

  const fail = (detail: string) => {
    if (stopped) return;
    stop();
    events.onInputConnected(false, detail);
    events.onStatus("error", detail);
  };

  const connecting = (detail?: string) => {
    firstFrame = false;
    if (frameTimer === null) {
      frameTimer = setTimeout(() => fail("No video received from the device. Reconnect to try again."), FIRST_FRAME_TIMEOUT_MS);
    }
    setStatus("connecting", detail);
  };

  const frameReceived = () => {
    if (firstFrame) return;
    firstFrame = true;
    clearFrameTimer();
    setStatus("streaming");
  };

  const paint = (frame: DeviceFrame) => {
    if (stopped) return;
    const { width, height } = frame;
    if (platform === "android" && (screen?.width !== width || screen.height !== height)) {
      screen = { width, height, orientation: width > height ? "landscape_left" : "portrait" };
      events.onScreen(screen);
    }
    if (!sink.present(frame)) {
      fail("Could not display the device stream. Reconnect to try again.");
      return;
    }
    frameReceived();
  };

  const closeDecoder = () => {
    decoderEpoch++;
    videoDecoder?.close();
    videoDecoder = null;
    awaitingKeyframe = true;
  };

  const recoverDecoder = () => {
    if (platform === "ios") fallBackToMjpeg();
    else {
      closeDecoder();
      connecting("Video decoder restarted.");
      requestKeyframe();
    }
  };

  /** VideoDecoder.configure: false when no decoder can run (no ffmpeg). */
  const configureDecoder = (isCurrent = () => !stopped): boolean => {
    const binary = ffmpegBinary();
    if (!isCurrent()) return false;
    if (!binary) {
      if (platform === "android") fail(FFMPEG_MISSING_DETAIL);
      return false;
    }
    const epoch = ++decoderEpoch;
    const feedGeneration = videoGeneration;
    videoDecoder?.close();
    const created = createH264Decoder(binary, {
      onFrame: (frame) => {
        if (videoDecoder !== created || (platform === "ios" && feedGeneration !== videoGeneration)) return;
        decodedVideoGeneration = feedGeneration;
        paint({ kind: "pixels", ...frame });
      },
      onError: () => {
        if (stopped || videoDecoder !== created || epoch !== decoderEpoch) return;
        recoverDecoder();
      },
    });
    videoDecoder = created;
    return true;
  };

  const decode = (isKey: boolean, data: Uint8Array) => {
    if (!videoDecoder) return;
    if (awaitingKeyframe) {
      if (!isKey) return;
      awaitingKeyframe = false;
    }
    if (videoDecoder.queueSize() > SOFT_DECODE_QUEUE) {
      if (platform !== "ios") {
        recoverDecoder();
        return;
      }
      // Native IDRs are spaced by frame count, so an idle simulator may take
      // minutes to produce one. A new AVCC subscription forces a fresh IDR.
      controller?.abort();
      closeDecoder();
      return;
    }
    videoDecoder.decode(data);
  };

  const requestKeyframe = () => {
    if (platform === "android" && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "reset-video", ack: false }));
    }
  };

  const scheduleRetry = (channel: "video" | "input", run: () => void) => {
    if (stopped || retryTimers.has(channel)) return;
    retryTimers.set(
      channel,
      setTimeout(() => {
        retryTimers.delete(channel);
        run();
      }, RETRY_DELAY_MS),
    );
  };

  const handleUnauthorized = () => {
    stop();
    events.onInputConnected(false);
    events.onUnauthorized();
  };

  /** Reads a streamed body chunk by chunk; a body that goes quiet is aborted. */
  const readBody = async (
    response: Response,
    signal: AbortController,
    isCurrent: () => boolean,
    onChunk: (chunk: Uint8Array) => boolean | Promise<boolean>,
  ): Promise<string | undefined> => {
    const reader = response.body!.getReader();
    let retryDetail: string | undefined;
    for (;;) {
      // An AVCC body can stay open after its helper stops producing frames.
      const timer = setTimeout(() => {
        if (!isCurrent()) return;
        retryDetail = "Device stream stopped receiving video. Reconnecting…";
        signal.abort();
      }, FIRST_FRAME_TIMEOUT_MS);
      videoReadTimer = timer;
      let result: Awaited<ReturnType<typeof reader.read>>;
      try {
        result = await reader.read();
      } finally {
        clearTimeout(timer);
        if (videoReadTimer === timer) videoReadTimer = null;
      }
      if (!isCurrent() || result.done) {
        await reader.cancel().catch(() => {});
        return retryDetail;
      }
      if (!(await onChunk(result.value))) {
        await reader.cancel().catch(() => {});
        return retryDetail;
      }
    }
  };

  const readIosVideo = async () => {
    const lifecycle = generation;
    const feedGeneration = ++videoGeneration;
    const demuxer = new AvccDemuxer();
    const videoController = new AbortController();
    controller = videoController;
    const isCurrent = () =>
      !stopped && generation === lifecycle && videoGeneration === feedGeneration && controller === videoController;
    let retryDetail: string | undefined;
    try {
      const response = await fetch(httpUrl(`/helper/${device}/stream.avcc`), { signal: videoController.signal });
      if (!isCurrent()) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 401 || response.status === 403) return handleUnauthorized();
      if (response.status === 409) {
        // stream_transport_locked: this serve-sim streams WebRTC only.
        await response.body?.cancel();
        return fail("This simulator streams over WebRTC only, which t3-term cannot play.");
      }
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
      let fellBack = false;
      retryDetail = await readBody(response, videoController, isCurrent, (bytes) => {
        for (const chunk of demuxer.push(bytes)) {
          if (videoController.signal.aborted) return false;
          switch (chunk.type) {
            case "seed": {
              // The helper's last still, shown until the first decoded frame.
              const size = jpegSize(chunk.payload);
              if (size && decodedVideoGeneration !== feedGeneration) paint({ kind: "jpeg", ...size, bytes: chunk.payload });
              break;
            }
            case "description": {
              awaitingKeyframe = true;
              avcConfig = parseAvcConfig(chunk.payload);
              if (!avcConfig || !configureDecoder(isCurrent)) {
                if (!isCurrent()) return false;
                fellBack = true;
                fallBackToMjpeg();
                return false;
              }
              break;
            }
            case "keyframe":
            case "delta": {
              if (!avcConfig) break;
              const isKey = chunk.type === "keyframe";
              const unit = avccToAnnexB(chunk.payload, avcConfig.lengthSize, isKey ? avcConfig.parameterSets : null);
              if (unit) decode(isKey, unit);
              break;
            }
          }
        }
        return true;
      });
      if (fellBack) return;
    } catch (cause) {
      if (!isCurrent()) return;
      retryDetail ??= videoController.signal.aborted ? "Video decoder fell behind. Reconnecting…" : (cause as Error).message;
    }
    if (isCurrent()) {
      controller = null;
      videoController.abort();
      closeDecoder();
      connecting(retryDetail);
      scheduleRetry("video", () => void readIosVideo());
    }
  };

  /** Web shows MJPEG in an <img>; here the multipart body is split into JPEGs. */
  const readMjpeg = async () => {
    const lifecycle = generation;
    const feedGeneration = ++videoGeneration;
    const videoController = new AbortController();
    controller = videoController;
    const isCurrent = () =>
      !stopped && mjpeg && generation === lifecycle && videoGeneration === feedGeneration && controller === videoController;
    let retryDetail: string | undefined;
    try {
      const response = await fetch(httpUrl(`/helper/${device}/stream.mjpeg`), { signal: videoController.signal });
      if (!isCurrent()) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 401 || response.status === 403) return handleUnauthorized();
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return fail("Could not receive the device stream. Reconnect to try again.");
      }
      const reader = new MjpegReader();
      retryDetail = await readBody(response, videoController, isCurrent, (bytes) => {
        const frames = reader.push(bytes);
        const latest = frames.at(-1);
        const size = latest ? jpegSize(latest) : null;
        if (latest && size) paint({ kind: "jpeg", ...size, bytes: latest });
        return true;
      });
    } catch (cause) {
      if (!isCurrent()) return;
      retryDetail ??= (cause as Error).message;
    }
    if (isCurrent()) {
      controller = null;
      videoController.abort();
      connecting(retryDetail);
      scheduleRetry("video", () => void readMjpeg());
    }
  };

  const fallBackToMjpeg = () => {
    if (stopped || mjpeg) return;
    mjpeg = true;
    controller?.abort();
    controller = null;
    closeDecoder();
    connecting();
    void readMjpeg();
  };

  /**
   * serve-sim's helper only accepts HID and pushes its screen config once
   * screen capture is running, and the AVCC stream does not reliably start
   * it. Touching the MJPEG endpoint does; one aborted request is enough.
   */
  const primeIosHelper = async (session: number) => {
    const prime = new AbortController();
    primeController = prime;
    const timeout = setTimeout(() => prime.abort(), 2_000);
    try {
      const response = await fetch(httpUrl(`/helper/${device}/stream.mjpeg`), { signal: prime.signal });
      if (stopped || generation !== session) return;
      if (response.status === 401 || response.status === 403) return handleUnauthorized();
      await response.body?.getReader().read();
    } catch {
    } finally {
      clearTimeout(timeout);
      prime.abort();
      if (primeController === prime) primeController = null;
    }
  };

  const connectIosInput = async () => {
    if (stopped) return;
    const session = generation;
    await primeIosHelper(session);
    if (stopped || generation !== session) return;
    const ws = new WebSocket(wsUrl(`/helper/ws?device=${device}`));
    ws.binaryType = "arraybuffer";
    socket = ws;
    iosInputAdmitted = false;
    iosInputUnavailable = false;
    ws.onmessage = (event) => {
      if (stopped || socket !== ws) return;
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      if (bytes.length < 1) return;
      if (bytes[0] === IOS_TAG_INPUT_ADMITTED) {
        iosInputAdmitted = true;
        events.onInputConnected(!iosInputUnavailable);
        return;
      }
      if (bytes[0] !== IOS_TAG_SCREEN_CONFIG) return;
      try {
        const config = decodeScreenConfig(JSON.parse(decoder.decode(bytes.subarray(1))));
        if (!config) return;
        iosInputUnavailable = config.inputUnavailable === true;
        events.onInputConnected(
          iosInputAdmitted && !iosInputUnavailable,
          iosInputUnavailable ? "Simulator input is unavailable" : undefined,
        );
        screen = config;
        events.onScreen(screen);
      } catch {}
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      iosInputAdmitted = false;
      if (stopped) return;
      events.onInputConnected(false, event.reason || (event.code === 1006 ? "input socket refused" : `closed ${event.code}`));
      // A rejected HTTP upgrade surfaces as 1006, including an expired stream ticket.
      if (event.code === 1008 || event.code === 4401 || (event.code === 1006 && access.query.wsTicket)) {
        return handleUnauthorized();
      }
      scheduleRetry("input", () => void connectIosInput());
    };
    ws.onerror = () => ws.close();
  };

  const connectAndroid = () => {
    if (stopped) return;
    const ws = new WebSocket(wsUrl(`/ws?device=${device}&frame-meta=1`));
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.onopen = () => {
      if (stopped || socket !== ws) return;
      connecting();
      events.onInputConnected(true);
    };
    ws.onmessage = (event) => {
      if (stopped || socket !== ws) return;
      if (typeof event.data === "string") {
        // The encoder restarts at a new size when the device rotates; the
        // next keyframe carries a fresh SPS, so the decoder is rebuilt from it.
        if (isVideoSessionMessage(event.data)) {
          closeDecoder();
          connecting();
          requestKeyframe();
        }
        return;
      }
      if (!(event.data instanceof ArrayBuffer)) return;
      const packet = parseSemuPacket(event.data);
      const needsScan = packet.isKey === null || (packet.isKey && !videoDecoder);
      const scanned = needsScan ? scanAccessUnit(packet.data) : null;
      const isKey = packet.isKey ?? scanned?.isKey ?? false;
      if (scanned?.sps && !videoDecoder) {
        // Web configures from this SPS, then asks for a fresh keyframe to start on.
        if (configureDecoder(() => !stopped && socket === ws)) {
          awaitingKeyframe = true;
          requestKeyframe();
        }
        return;
      }
      if (!videoDecoder) {
        if (!isKey) requestKeyframe();
        return;
      }
      decode(isKey, packet.data);
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      closeDecoder();
      if (stopped) return;
      events.onInputConnected(false, event.reason || `closed ${event.code}`);
      if (event.code === 1008 || event.code === 4401 || (event.code === 1006 && access.query.wsTicket)) {
        return handleUnauthorized();
      }
      connecting(event.reason || undefined);
      scheduleRetry("input", connectAndroid);
    };
    ws.onerror = () => ws.close();
  };

  const start = () => {
    if (!stopped) return;
    stopped = false;
    generation++;
    iosInputAdmitted = false;
    iosInputUnavailable = false;
    connecting();
    if (platform === "ios") {
      void connectIosInput();
      if (ffmpegBinary()) void readIosVideo();
      else fallBackToMjpeg();
    } else if (ffmpegBinary()) {
      connectAndroid();
    } else {
      fail(FFMPEG_MISSING_DETAIL);
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    generation++;
    videoGeneration++;
    mjpeg = false;
    clearFrameTimer();
    if (videoReadTimer !== null) clearTimeout(videoReadTimer);
    videoReadTimer = null;
    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
    primeController?.abort();
    primeController = null;
    controller?.abort();
    controller = null;
    const discarded = socket;
    socket = null;
    discarded?.close();
    closeDecoder();
  };

  const send = (payload: Uint8Array<ArrayBuffer> | string) => {
    if (
      !stopped &&
      (platform !== "ios" || (iosInputAdmitted && !iosInputUnavailable)) &&
      socket?.readyState === WebSocket.OPEN
    )
      socket.send(payload);
  };

  const rawPoint = (x: number, y: number) => {
    // serve-sim streams the raw framebuffer; rotated devices need input
    // remapped into that raw space.
    if (platform !== "ios" || !screen || screen.width > screen.height) return { x, y };
    switch (screen.orientation) {
      case "landscape_left":
        return { x: y, y: 1 - x };
      case "landscape_right":
        return { x: 1 - y, y: x };
      case "portrait_upside_down":
        return { x: 1 - x, y: 1 - y };
      default:
        return { x, y };
    }
  };

  return {
    start,
    stop,
    sendTouch: (phase, x, y) => {
      if (platform === "ios") {
        send(taggedJson(IOS_MSG_TOUCH, { type: phase, ...rawPoint(x, y) }));
        return;
      }
      const action = phase === "begin" ? "down" : phase === "move" ? "move" : "up";
      send(JSON.stringify({ type: "touch", action, x, y }));
    },
    sendKey: (event, phase) => {
      if (platform === "ios") {
        const usage = hidUsageForCode(event.code);
        if (usage !== null) send(taggedJson(IOS_MSG_KEY, { type: phase, usage }));
        return;
      }
      if (phase !== "down") return;
      if (event.key === "Escape") return send(JSON.stringify({ type: "back" }));
      const keycode = ANDROID_KEYCODE_BY_KEY[event.key];
      if (keycode !== undefined) return send(JSON.stringify({ type: "key", keycode }));
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        send(JSON.stringify({ type: "text", text: event.key }));
      }
    },
    sendText: (text) => {
      if (platform !== "android") return;
      let chunk = "";
      let chunkBytes = 0;
      let sentChunks = 0;
      for (const character of text) {
        const characterBytes = utf8ByteLength(character.codePointAt(0)!);
        if (chunkBytes + characterBytes > ANDROID_MAX_TEXT_BYTES) {
          send(JSON.stringify({ type: "text", text: chunk }));
          if (++sentChunks >= ANDROID_MAX_TEXT_CHUNKS) return;
          chunk = "";
          chunkBytes = 0;
        }
        chunk += character;
        chunkBytes += characterBytes;
      }
      if (chunk.length > 0) send(JSON.stringify({ type: "text", text: chunk }));
    },
    pressButton: (button) => {
      if (platform === "ios") {
        const name = button === "home" ? "home" : button === "appSwitcher" ? "app_switcher" : button === "power" ? "lock" : null;
        if (name) send(taggedJson(IOS_MSG_BUTTON, { button: name }));
        return;
      }
      const type = button === "appSwitcher" ? "recents" : button;
      if (type === "home" || type === "back" || type === "recents" || type === "power") {
        send(JSON.stringify({ type }));
      }
    },
    rotate: () => {
      if (platform !== "ios") return;
      const current = screen?.orientation ?? "portrait";
      const next = IOS_ORIENTATIONS[(IOS_ORIENTATIONS.indexOf(current) + 1) % IOS_ORIENTATIONS.length]!;
      send(taggedJson(IOS_MSG_ORIENTATION, { orientation: next }));
    },
    setOrientation: (orientation) => {
      if (platform === "ios") send(taggedJson(IOS_MSG_ORIENTATION, { orientation }));
    },
  };
}
