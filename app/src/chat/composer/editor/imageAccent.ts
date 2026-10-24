// web contextChipParts averageImageColor: an image chip takes its accent from the picture
// (the alpha-weighted mean of a 16×16 downscale). Web draws the image into a canvas; t3-term
// has no pixel readback, so PNGs (what screenshots are) are decoded here with zlib, and other
// formats keep the image kind's accent. The mean over every pixel stands in for the 16×16
// downscale's mean, which is the same up to the browser's resampling.
import * as NodeFs from "node:fs";
import * as NodeZlib from "node:zlib";

import { Atom } from "effect/reactivity";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Larger files are left on the default accent: decoding them would stall for little gain. */
const MAX_PNG_BYTES = 12 * 1024 * 1024;

interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** The mean colour of an 8-bit, non-interlaced PNG as `#rrggbb`, or null. */
export function averagePngColor(bytes: Buffer): string | null {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let header: PngHeader | null = null;
  let palette: Buffer | null = null;
  let paletteAlpha: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8]!, colorType: data[9]!, interlace: data[12]! };
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") paletteAlpha = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!header || header.bitDepth !== 8 || header.interlace !== 0 || idat.length === 0) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (channels === undefined || (header.colorType === 3 && !palette)) return null;
  let raw: Buffer;
  try {
    raw = NodeZlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = header.width * channels;
  if (raw.length < (stride + 1) * header.height) return null;
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  let red = 0;
  let green = 0;
  let blue = 0;
  let weightSum = 0;
  for (let y = 0; y < header.height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart]!;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + 1 + x]!;
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      current[x] =
        filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + ((left + up) >> 1) : filter === 4 ? value + paeth(left, up, upLeft) : value;
    }
    for (let x = 0; x < header.width; x += 1) {
      const at = x * channels;
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (header.colorType === 3) {
        const index = current[at]!;
        r = palette![index * 3] ?? 0;
        g = palette![index * 3 + 1] ?? 0;
        b = palette![index * 3 + 2] ?? 0;
        a = paletteAlpha?.[index] ?? 255;
      } else if (header.colorType === 0 || header.colorType === 4) {
        r = g = b = current[at]!;
        if (header.colorType === 4) a = current[at + 1]!;
      } else {
        r = current[at]!;
        g = current[at + 1]!;
        b = current[at + 2]!;
        if (header.colorType === 6) a = current[at + 3]!;
      }
      red += r * a;
      green += g * a;
      blue += b * a;
      weightSum += a;
    }
    [previous, current] = [current, previous];
  }
  if (weightSum === 0) return null;
  const hex = (sum: number) => Math.round(sum / weightSum).toString(16).padStart(2, "0");
  return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

/** An image file's sampled accent, null while it is read or when it cannot be sampled. */
export const imageAccentAtom = Atom.family((path: string) =>
  Atom.make<string | null>((get) => {
    let cancelled = false;
    get.addFinalizer(() => {
      cancelled = true;
    });
    void NodeFs.promises
      .stat(path)
      .then((stat) => (stat.size > MAX_PNG_BYTES ? null : NodeFs.promises.readFile(path)))
      .then((bytes) => {
        if (!cancelled && bytes) get.setSelf(averagePngColor(bytes));
      })
      .catch(() => {});
    return null;
  }).pipe(Atom.keepAlive),
);
