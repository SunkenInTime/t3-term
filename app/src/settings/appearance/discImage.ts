// Rasterizes the theme preview disc (ThemePreviewCircles.tsx
// getThemePreviewStyle) to a PNG data URL.
//
// The web paints it with CSS: a canvas tint, two radial gradients
// interpolated in oklab, `filter: blur(3px)`, `transform: scale(1.1)` and a
// round clip. gpuix paints neither radial gradients nor blur, and GPUI's SVG
// image path drops filters, so the disc is computed here pixel by pixel with
// the same geometry and encoded as a small PNG (cached per color set).
import {
  THEME_PREVIEW_RENDER_SPECS,
  mixThemePreviewBase,
} from "@t3tools/shared/themePreview";
import { deflateSync } from "node:zlib";

import { cssColorToHex, type ThemeAppearance } from "../../ui/theme.ts";

export interface DiscColors {
  readonly canvas: string;
  readonly accent: string;
  readonly messageAction: string;
}

/** The painted area inside the disc's 2px border, in CSS px. */
export const DISC_SIZE = 52;
/** Pixels per CSS px, so the disc stays smooth on high-DPI screens. */
const SCALE = 2;
/**
 * The blurred field is smooth, so it is computed at 1x and sampled
 * bilinearly; only the clip edge needs the full output resolution.
 */
const LOCAL_SCALE = 1;
/** Room around the local box for the blur to spread into before clipping. */
const PAD = 10;

type Rgba = [number, number, number, number];

function parseHex(color: string): Rgba {
  const hex = cssColorToHex(color);
  const channel = (index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return [channel(0), channel(1), channel(2), hex.length === 9 ? channel(3) : 1];
}

/** CSS radial-gradient `circle at cx cy` with the default farthest-corner size. */
function farthestCorner(cx: number, cy: number, size: number): number {
  return Math.max(
    Math.hypot(cx, cy),
    Math.hypot(size - cx, cy),
    Math.hypot(cx, size - cy),
    Math.hypot(size - cx, size - cy),
  );
}

/** Piecewise-linear alpha over gradient stops [offset, alpha]. */
function stopAlpha(t: number, stops: ReadonlyArray<readonly [number, number]>): number {
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let index = 1; index < stops.length; index += 1) {
    const [offset, value] = stops[index]!;
    const [previousOffset, previousValue] = stops[index - 1]!;
    if (t <= offset) return previousValue + ((t - previousOffset) / (offset - previousOffset)) * (value - previousValue);
  }
  return stops[stops.length - 1]![1];
}

/** Premultiplied source-over. */
function over(dst: Rgba, color: Rgba, alpha: number): Rgba {
  const a = color[3] * alpha;
  return [color[0] * a + dst[0] * (1 - a), color[1] * a + dst[1] * (1 - a), color[2] * a + dst[2] * (1 - a), a + dst[3] * (1 - a)];
}

function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let index = -radius; index <= radius; index += 1) {
    const value = Math.exp(-(index * index) / (2 * sigma * sigma));
    kernel[index + radius] = value;
    sum += value;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index]! /= sum;
  return kernel;
}

function blur(pixels: Float64Array, size: number, sigma: number): Float64Array {
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  const pass = (source: Float64Array, horizontal: boolean) => {
    const target = new Float64Array(source.length);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const out = (y * size + x) * 4;
        for (let k = -radius; k <= radius; k += 1) {
          const sx = horizontal ? x + k : x;
          const sy = horizontal ? y : y + k;
          if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
          const weight = kernel[k + radius]!;
          const from = (sy * size + sx) * 4;
          target[out] += source[from]! * weight;
          target[out + 1] += source[from + 1]! * weight;
          target[out + 2] += source[from + 2]! * weight;
          target[out + 3] += source[from + 3]! * weight;
        }
      }
    }
    return target;
  };
  return pass(pass(pixels, true), false);
}

function sample(pixels: Float64Array, size: number, x: number, y: number): Rgba {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const result: Rgba = [0, 0, 0, 0];
  for (const [dx, dy, weight] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ] as const) {
    const sx = x0 + dx;
    const sy = y0 + dy;
    if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
    const index = (sy * size + sx) * 4;
    for (let channel = 0; channel < 4; channel += 1) result[channel]! += pixels[index + channel]! * weight;
  }
  return result;
}

/** Antialiased coverage of a circle of radius r centred at c for a pixel centred at (x, y). */
function coverage(x: number, y: number, c: number, r: number, pixel: number): number {
  const distance = Math.hypot(x - c, y - c);
  return Math.max(0, Math.min(1, (r - distance) / pixel + 0.5));
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(rgba: Uint8Array, size: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function renderDisc(colors: DiscColors, mode: ThemeAppearance): Uint8Array {
  const spec = THEME_PREVIEW_RENDER_SPECS[mode];
  const base = parseHex(mixThemePreviewBase(colors, mode));
  const accent = parseHex(colors.accent);
  const action = parseHex(colors.messageAction);
  const [ax, ay] = [spec.accent.center[0] * DISC_SIZE, spec.accent.center[1] * DISC_SIZE];
  const [bx, by] = [spec.action.center[0] * DISC_SIZE, spec.action.center[1] * DISC_SIZE];
  const accentRadius = farthestCorner(ax, ay, DISC_SIZE);
  const actionRadius = farthestCorner(bx, by, DISC_SIZE);
  const accentStops = [
    [0, 1],
    [spec.accent.middleOffset, spec.accent.middleOpacity],
    [spec.accent.endOffset, 0],
  ] as const;
  const actionStops = [
    [0, spec.action.startOpacity],
    [spec.action.endOffset, 0],
  ] as const;
  const half = DISC_SIZE / 2;
  const pixel = 1 / SCALE;

  // 1. The unblurred, untransformed round span, on a padded local grid.
  const localSize = (DISC_SIZE + PAD * 2) * LOCAL_SCALE;
  const local = new Float64Array(localSize * localSize * 4);
  for (let gy = 0; gy < localSize; gy += 1) {
    for (let gx = 0; gx < localSize; gx += 1) {
      const u = (gx + 0.5) / LOCAL_SCALE - PAD;
      const v = (gy + 0.5) / LOCAL_SCALE - PAD;
      const shape = coverage(u, v, half, half, 1 / LOCAL_SCALE);
      if (shape <= 0) continue;
      let color: Rgba = [base[0] * base[3], base[1] * base[3], base[2] * base[3], base[3]];
      color = over(color, action, stopAlpha(Math.hypot(u - bx, v - by) / actionRadius, actionStops));
      color = over(color, accent, stopAlpha(Math.hypot(u - ax, v - ay) / accentRadius, accentStops));
      const index = (gy * localSize + gx) * 4;
      local[index] = color[0] * shape;
      local[index + 1] = color[1] * shape;
      local[index + 2] = color[2] * shape;
      local[index + 3] = color[3] * shape;
    }
  }
  // 2. filter: blur() runs in local space, before the transform.
  const blurred = blur(local, localSize, spec.blurAt56Px * LOCAL_SCALE);
  // 3. scale() about the centre, then the outer span's round clip.
  const size = DISC_SIZE * SCALE;
  const rgba = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) / SCALE;
      const y = (py + 0.5) / SCALE;
      const clip = coverage(x, y, half, half, pixel);
      if (clip <= 0) continue;
      const u = half + (x - half) / spec.scale;
      const v = half + (y - half) / spec.scale;
      const [r, g, b, a] = sample(blurred, localSize, (u + PAD) * LOCAL_SCALE - 0.5, (v + PAD) * LOCAL_SCALE - 0.5);
      const alpha = a * clip;
      const index = (py * size + px) * 4;
      if (a > 0) {
        rgba[index] = Math.round(Math.min(1, r / a) * 255);
        rgba[index + 1] = Math.round(Math.min(1, g / a) * 255);
        rgba[index + 2] = Math.round(Math.min(1, b / a) * 255);
      }
      rgba[index + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  return encodePng(rgba, size);
}

const cache = new Map<string, string>();

export function themePreviewDiscSource(colors: DiscColors, mode: ThemeAppearance): string {
  const key = `${mode}|${colors.canvas}|${colors.accent}|${colors.messageAction}`;
  let source = cache.get(key);
  if (!source) {
    source = `data:image/png;base64,${Buffer.from(renderDisc(colors, mode)).toString("base64")}`;
    cache.set(key, source);
  }
  return source;
}
