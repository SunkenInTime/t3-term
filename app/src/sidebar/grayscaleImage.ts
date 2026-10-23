// CSS `grayscale` for raster and SVG favicons. gpuix's <img> takes no filters,
// so the image bytes are fetched once and wrapped in an SVG whose
// feColorMatrix saturate(0) (the same matrix as grayscale(1)) resvg applies
// when it rasterizes the wrapper. PNG, JPEG, GIF, WebP and SVG embed as they
// are; an ICO contributes its largest entry (PNG, or a 24/32-bit BMP turned
// into a PNG here).
import { useEffect, useState } from "react";
import { deflateSync } from "node:zlib";

const cache = new Map<string, Promise<string | null>>();
const settled = new Map<string, string | null>();

/** A grayscale `size`×`size` data URL for the image at `src`, or null when its format can't be embedded. */
export function grayscaleImageSource(src: string, size: number): Promise<string | null> {
  const key = `${size}:${src}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = build(src, size)
      .catch(() => null)
      .then((result) => {
        settled.set(key, result);
        return result;
      });
    cache.set(key, pending);
  }
  return pending;
}

/** The grayscale source once it is ready; null before then, when disabled, or when the image can't be converted. */
export function useGrayscaleImageSource(src: string | null, enabled: boolean, size: number): string | null {
  const key = src === null ? null : `${size}:${src}`;
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || src === null || key === null || settled.has(key)) return;
    let live = true;
    void grayscaleImageSource(src, size).then(() => {
      if (live) setVersion((version) => version + 1);
    });
    return () => {
      live = false;
    };
  }, [enabled, src, size, key]);
  return enabled && key !== null ? (settled.get(key) ?? null) : null;
}

async function build(src: string, size: number): Promise<string | null> {
  const bytes = await readBytes(src);
  const embedded = embeddable(bytes);
  if (!embedded) return null;
  const href = `data:${embedded.mime};base64,${Buffer.from(embedded.data).toString("base64")}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<filter id="g" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>` +
    `<image width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" filter="url(#g)" href="${href}" xlink:href="${href}"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function readBytes(src: string): Promise<Uint8Array> {
  if (src.startsWith("data:")) {
    const comma = src.indexOf(",");
    const meta = src.slice(5, comma);
    const body = src.slice(comma + 1);
    return meta.endsWith(";base64") ? new Uint8Array(Buffer.from(body, "base64")) : new TextEncoder().encode(decodeURIComponent(body));
  }
  const response = await fetch(src);
  if (!response.ok) throw new Error(`favicon ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function startsWith(bytes: Uint8Array, prefix: ReadonlyArray<number>, offset = 0): boolean {
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

function embeddable(bytes: Uint8Array): { mime: string; data: Uint8Array } | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { mime: "image/png", data: bytes };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", data: bytes };
  if (startsWith(bytes, [0x47, 0x49, 0x46])) return { mime: "image/gif", data: bytes };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: "image/webp", data: bytes };
  }
  if (startsWith(bytes, [0, 0, 1, 0])) return icoEntry(bytes);
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (/<svg[\s>]/i.test(head)) return { mime: "image/svg+xml", data: bytes };
  return null;
}

/** The largest image in an ICO: PNG entries embed directly; BMP entries are decoded. */
function icoEntry(bytes: Uint8Array): { mime: string; data: Uint8Array } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  let best: { area: number; offset: number; length: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    if (entry + 16 > bytes.length) break;
    const width = bytes[entry] || 256;
    const height = bytes[entry + 1] || 256;
    const length = view.getUint32(entry + 8, true);
    const offset = view.getUint32(entry + 12, true);
    if (offset + length > bytes.length) continue;
    if (!best || width * height > best.area) best = { area: width * height, offset, length };
  }
  if (!best) return null;
  const data = bytes.subarray(best.offset, best.offset + best.length);
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47])) return { mime: "image/png", data };
  const rgba = decodeDib(data);
  return rgba ? { mime: "image/png", data: encodePng(rgba.pixels, rgba.width, rgba.height) } : null;
}

/** An ICO's BITMAPINFOHEADER image (height doubled for the AND mask), 24 or 32 bits per pixel. */
function decodeDib(data: Uint8Array): { pixels: Uint8Array; width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerSize = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  const height = Math.abs(view.getInt32(8, true)) / 2;
  const bpp = view.getUint16(14, true);
  if (bpp !== 32 && bpp !== 24) return null;
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const maskStart = headerSize + stride * height;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = headerSize + (height - 1 - y) * stride;
    const maskRow = maskStart + (height - 1 - y) * maskStride;
    for (let x = 0; x < width; x += 1) {
      const source = row + x * (bpp / 8);
      const target = (y * width + x) * 4;
      pixels[target] = data[source + 2] ?? 0;
      pixels[target + 1] = data[source + 1] ?? 0;
      pixels[target + 2] = data[source] ?? 0;
      if (bpp === 32) {
        pixels[target + 3] = data[source + 3] ?? 0;
      } else {
        const masked = ((data[maskRow + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
        pixels[target + 3] = masked ? 0 : 255;
      }
    }
  }
  return { pixels, width, height };
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

function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
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
