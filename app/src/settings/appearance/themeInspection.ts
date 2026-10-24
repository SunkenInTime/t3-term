// The theme editor's color inspection (apps/web/src/components/settings/themeInspector.ts),
// rebuilt for a renderer that keeps no record of which theme role produced a
// painted color. Web asks the DOM: utility classes and computed styles name the
// role under the pointer, and matched elements are counted and spotlit.
//
// Here the roles are made visible instead:
//   - Highlight: the selected role paints in a marker color across the app
//     (web's spotlight), through an overlay on the draft theme.
//   - Use count: a frame captured before and after the highlight; the regions
//     that changed are the places the role paints. They approximate web's count
//     of matching elements (two touching elements merge into one region).
//   - Inspect: one frame painted with every role in its own probe color is
//     captured, and the probe color at the clicked point names the role. The
//     probe frame shows for a moment, the way an eyedropper flashes.
// All of it needs window capture, which GPUI has on Windows and macOS native
// windows; elsewhere (kitty terminals) the panel hides Inspect and the count.
import type { NativeRenderer } from "@gpuix/react";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { termHome } from "../../runtime/paths.ts";
import { themePreviewOverlayAtom } from "../../state/clientSettings.ts";
import { THEME_COLOR_ROLES, type ThemeColorRole, type ThemeColors } from "../../web/themePalette.ts";

/** A magenta no shipped theme uses, so highlighted paint reads as "here". */
export const THEME_HIGHLIGHT_COLOR = "#ff2bd6";

type CaptureRenderer = NativeRenderer & { captureScreenshot?: (path: string) => void };

export function canInspectThemeColors(renderer: NativeRenderer | null): boolean {
  return typeof (renderer as CaptureRenderer | null)?.captureScreenshot === "function";
}

export function setThemeHighlight(roles: ReadonlyArray<ThemeColorRole> | null): void {
  appAtomRegistry.set(
    themePreviewOverlayAtom,
    roles && roles.length > 0 ? (Object.fromEntries(roles.map((role) => [role, THEME_HIGHLIGHT_COLOR])) as Partial<ThemeColors>) : null,
  );
}

// ── Capture ─────────────────────────────────────────────────────────────

interface Frame {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major. */
  readonly pixels: Uint8Array;
}

/** Enough for React to commit and GPUI to paint the changed palette. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** The 8-bit RGB/RGBA PNGs GPUI writes; anything else is rejected. */
function decodePng(bytes: Uint8Array): Frame | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8 || data[12] !== 0 || (colorType !== 6 && colorType !== 2)) return null;
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (width === 0 || channels === 0) return null;
  const raw = NodeZlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[rowStart + 1 + x]!;
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      current[x] =
        (filter === 0
          ? value
          : filter === 1
            ? value + left
            : filter === 2
              ? value + up
              : filter === 3
                ? value + ((left + up) >> 1)
                : value + paeth(left, up, upLeft)) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      out[target] = current[x * channels]!;
      out[target + 1] = current[x * channels + 1]!;
      out[target + 2] = current[x * channels + 2]!;
      out[target + 3] = channels === 4 ? current[x * channels + 3]! : 255;
    }
    previous.set(current);
  }
  return { width, height, pixels: out };
}

function captureFrame(renderer: NativeRenderer): Frame | null {
  const capture = (renderer as CaptureRenderer).captureScreenshot;
  if (!capture) return null;
  const directory = NodePath.join(termHome(), "tmp");
  NodeFS.mkdirSync(directory, { recursive: true });
  const path = NodePath.join(directory, `theme-inspect-${process.pid}-${Date.now()}.png`);
  try {
    capture.call(renderer, path);
    return decodePng(NodeFS.readFileSync(path));
  } catch {
    return null;
  } finally {
    NodeFS.rmSync(path, { force: true });
  }
}

/** Window points to captured pixels: the capture is in device pixels. */
function scaleFor(frame: Frame, renderer: NativeRenderer): number {
  const size = renderer.getWindowSize?.();
  return size && size.width > 0 ? frame.width / size.width : 1;
}

export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ── Use count ───────────────────────────────────────────────────────────

const BLOCK = 4;

/**
 * Captures the app, highlights `roles`, captures again, and counts the regions
 * that changed outside `exclude` (the editor panel). Leaves the highlight on.
 */
export async function highlightAndCountUses(
  renderer: NativeRenderer,
  roles: ReadonlyArray<ThemeColorRole>,
  exclude: WindowRect | null,
): Promise<number | null> {
  setThemeHighlight(null);
  await settle();
  const before = captureFrame(renderer);
  setThemeHighlight(roles);
  await settle();
  const after = captureFrame(renderer);
  if (!before || !after || before.width !== after.width || before.height !== after.height) return null;
  const scale = scaleFor(after, renderer);
  const columns = Math.ceil(after.width / BLOCK);
  const rows = Math.ceil(after.height / BLOCK);
  const changed = new Uint8Array(columns * rows);
  const excluded = (px: number, py: number) =>
    exclude !== null &&
    px >= exclude.x * scale &&
    px < (exclude.x + exclude.width) * scale &&
    py >= exclude.y * scale &&
    py < (exclude.y + exclude.height) * scale;
  for (let y = 0; y < after.height; y++) {
    for (let x = 0; x < after.width; x++) {
      const index = (y * after.width + x) * 4;
      if (
        before.pixels[index] === after.pixels[index] &&
        before.pixels[index + 1] === after.pixels[index + 1] &&
        before.pixels[index + 2] === after.pixels[index + 2]
      ) {
        continue;
      }
      if (excluded(x, y)) continue;
      changed[Math.floor(y / BLOCK) * columns + Math.floor(x / BLOCK)] = 1;
    }
  }
  // Connected blocks (8-neighbour) are one place the role paints; specks under
  // two blocks are antialiasing on an edge, not a use.
  let regions = 0;
  const stack: number[] = [];
  for (let start = 0; start < changed.length; start++) {
    if (changed[start] !== 1) continue;
    let size = 0;
    changed[start] = 2;
    stack.push(start);
    while (stack.length > 0) {
      const cell = stack.pop()!;
      size++;
      const cx = cell % columns;
      const cy = Math.floor(cell / columns);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
          const next = ny * columns + nx;
          if (changed[next] === 1) {
            changed[next] = 2;
            stack.push(next);
          }
        }
      }
    }
    if (size > 2) regions++;
  }
  return regions;
}

// ── Inspect ─────────────────────────────────────────────────────────────

/** Role i → a color 30 steps from every other probe on some channel. */
function probeColor(index: number): readonly [number, number, number] {
  return [16 + (index % 8) * 30, 16 + (Math.floor(index / 8) % 8) * 30, 16 + Math.floor(index / 64) * 60 + 120];
}

const PROBE_RADIUS = 3;

/**
 * Paints every role in its probe color for one captured frame and returns the
 * role painted at the window point (x, y). Text is thin, so the point's
 * neighbourhood is read and the role covering most of it wins; blended pixels
 * (translucent fills, antialiasing) match no probe and are skipped.
 */
export async function inspectThemeRoleAt(renderer: NativeRenderer, x: number, y: number): Promise<ThemeColorRole | null> {
  const probes = Object.fromEntries(
    THEME_COLOR_ROLES.map((role, index) => {
      const [r, g, b] = probeColor(index);
      return [role, `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`];
    }),
  ) as Partial<ThemeColors>;
  const previous = appAtomRegistry.get(themePreviewOverlayAtom);
  appAtomRegistry.set(themePreviewOverlayAtom, probes);
  await settle();
  const frame = captureFrame(renderer);
  appAtomRegistry.set(themePreviewOverlayAtom, previous);
  if (!frame) return null;
  const scale = scaleFor(frame, renderer);
  const centerX = Math.round(x * scale);
  const centerY = Math.round(y * scale);
  const votes = new Map<number, number>();
  for (let dy = -PROBE_RADIUS; dy <= PROBE_RADIUS; dy++) {
    for (let dx = -PROBE_RADIUS; dx <= PROBE_RADIUS; dx++) {
      const px = centerX + dx;
      const py = centerY + dy;
      if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) continue;
      const offset = (py * frame.width + px) * 4;
      const r = frame.pixels[offset]!;
      const g = frame.pixels[offset + 1]!;
      const b = frame.pixels[offset + 2]!;
      const index = THEME_COLOR_ROLES.findIndex((_, candidate) => {
        const [pr, pg, pb] = probeColor(candidate);
        return Math.abs(pr - r) <= 2 && Math.abs(pg - g) <= 2 && Math.abs(pb - b) <= 2;
      });
      if (index < 0) continue;
      // The pixel under the pointer counts most, so a click on a glyph names the text color.
      const weight = dx === 0 && dy === 0 ? PROBE_RADIUS * 4 : 1;
      votes.set(index, (votes.get(index) ?? 0) + weight);
    }
  }
  let best: number | null = null;
  for (const [index, count] of votes) if (best === null || count > votes.get(best)!) best = index;
  return best === null ? null : THEME_COLOR_ROLES[best]!;
}
