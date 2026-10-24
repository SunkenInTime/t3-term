// Makes a picked, dropped or pasted image sendable: HEIC/HEIF becomes JPEG, PNG/JPEG over
// 2000px on a side is fitted, and anything over the provider byte limit is re-encoded at
// falling quality, then falling size (port of apps/web/src/lib/imageCompression.ts
// prepareImageForAttachment / compressImageToByteLimit).
// Web decodes with canvas and the heic-to wasm package. t3-term ships no image library, so
// this drives what each OS has:
// - Windows: one PowerShell run of WPF/WIC for every attempt, so a full quality ladder costs
//   one process. HEIC decodes through the "HEIF Image Extensions" codec, when installed.
// - macOS: sips, one run per attempt. ImageIO reads HEIC natively.
// - Linux: heif-dec / heif-convert for HEIC, then ImageMagick, then ffmpeg.
// Re-encodes are always JPEG: web probes WebP first, but neither WIC nor sips can write it.
import { spawn } from "node:child_process";
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import {
  downscalableImageMimeType,
  fitImageAttachmentSize,
  IMAGE_ATTACHMENT_MAX_EDGE,
} from "@t3tools/client-runtime/image-attachment-size";
import { isProviderSendTurnSupportedImageMimeType } from "@t3tools/contracts";
import { IMAGE_DIMENSIONS_HEADER_BYTES, readImageDimensions } from "@t3tools/shared/imageDimensions";

/** File size stands in for pixel count; beyond this decoding risks running out of memory. */
const MAX_COMPRESSIBLE_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_HEIC_DECODE_PIXELS = 64_000_000;
const MAX_HEIC_METADATA_BYTES = 1024 * 1024;
const QUALITY_STEPS = [0.92, 0.85, 0.78, 0.68] as const;
const FALLBACK_SCALE_STEPS = [0.75, 0.55] as const;
const HEIC_IMAGE_MIME_TYPE = /^image\/hei(?:c|f)$/i;
const HEIC_IMAGE_EXTENSION = /\.(?:heic|heif)$/i;
const TOOL_TIMEOUT_MS = 120_000;

const IMAGE_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type PreparedImage =
  | { ok: true; path: string; name: string; mimeType: string; sizeBytes: number; converted: boolean }
  | { ok: false; reason: "unreadable" | "too-large" | "unsupported" };

/** Finder and some apps omit the MIME type when handing over HEIC photos. */
export function isHeicImage(input: { name: string; mimeType?: string }): boolean {
  const mimeType = input.mimeType ?? "";
  if (HEIC_IMAGE_MIME_TYPE.test(mimeType)) return true;
  return (mimeType === "" || mimeType.toLowerCase() === "application/octet-stream") && HEIC_IMAGE_EXTENSION.test(input.name);
}

/** Web normalizeComposerImageFileMimeType: an empty or generic type falls back to the extension. */
function normalizedMimeType(input: { name: string; mimeType: string }): string {
  const mimeType = input.mimeType.toLowerCase();
  if (mimeType === "image/jpg") return "image/jpeg";
  if (mimeType !== "" && mimeType !== "application/octet-stream") return mimeType;
  const dotIndex = input.name.lastIndexOf(".");
  return (dotIndex > 0 && IMAGE_MIME_TYPE_BY_EXTENSION[input.name.slice(dotIndex + 1).toLowerCase()]) || mimeType;
}

function fileNameForJpeg(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return `${dotIndex > 0 ? name.slice(0, dotIndex) : name}.jpg`;
}

async function readHead(path: string, length: number): Promise<Uint8Array> {
  const handle = await NodeFs.promises.open(path, "r");
  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// HEIC dimension check, verbatim from web: refuse before decoding a picture too big to hold.
interface HeicMetadataBox {
  payloadOffset: number;
  endOffset: number;
}

function findHeicMetadataBox(view: DataView, startOffset: number, endOffset: number, type: number): HeicMetadataBox | null {
  let offset = startOffset;
  while (offset + 8 <= endOffset) {
    let size = view.getUint32(offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > endOffset) return null;
      const extendedSize = view.getBigUint64(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = endOffset - offset;
    }
    if (size < headerSize || size > endOffset - offset) return null;

    const nextOffset = offset + size;
    if (view.getUint32(offset + 4) === type) {
      return { payloadOffset: offset + headerSize, endOffset: nextOffset };
    }
    offset = nextOffset;
  }
  return null;
}

function validateHeicImageDimensions(metadata: Uint8Array): "unreadable" | "too-large" | null {
  const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
  const meta = findHeicMetadataBox(view, 0, view.byteLength, 0x6d657461);
  if (!meta || meta.payloadOffset + 4 > meta.endOffset) return "unreadable";
  const properties = findHeicMetadataBox(view, meta.payloadOffset + 4, meta.endOffset, 0x69707270);
  if (!properties) return "unreadable";
  const containers = findHeicMetadataBox(view, properties.payloadOffset, properties.endOffset, 0x6970636f);
  if (!containers) return "unreadable";

  let offset = containers.payloadOffset;
  let foundImageDimensions = false;
  while (offset < containers.endOffset) {
    const image = findHeicMetadataBox(view, offset, containers.endOffset, 0x69737065);
    if (!image) break;
    if (image.payloadOffset + 12 > image.endOffset) return "unreadable";
    const width = view.getUint32(image.payloadOffset + 4);
    const height = view.getUint32(image.payloadOffset + 8);
    if (width === 0 || height === 0) return "unreadable";
    if (width > MAX_HEIC_DECODE_PIXELS / height) return "too-large";
    foundImageDimensions = true;
    offset = image.endOffset;
  }
  return foundImageDimensions ? null : "unreadable";
}

/**
 * One encode to try. `scale` is relative to the longest edge capped at 2000px, so the fallback
 * passes shrink even an image already under the cap (web reencodeWithinBudget).
 */
interface Attempt {
  format: "png" | "jpeg";
  scale: number;
  quality: number;
}

type EncodeResult =
  | { kind: "ok"; index: number; file: string }
  | { kind: "too-large" }
  | { kind: "unreadable" }
  /** No tool on this machine can decode or encode the image. */
  | { kind: "unavailable" };

function targetEdge(longest: number, scale: number): number {
  return Math.max(1, Math.round(Math.min(IMAGE_ATTACHMENT_MAX_EDGE, longest) * scale));
}

function run(command: string, args: ReadonlyArray<string>, env?: Record<string, string>): Promise<{ code: number; stdout: string; missing: boolean }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, [...args], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: env ? { ...process.env, ...env } : process.env,
      });
    } catch {
      resolve({ code: -1, stdout: "", missing: true });
      return;
    }
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), TOOL_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: "", missing: error.code === "ENOENT" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(chunks).toString("utf8"), missing: false });
    });
  });
}

function fileSize(path: string): number | null {
  try {
    return NodeFs.statSync(path).size;
  } catch {
    return null;
  }
}

// Draws through a DrawingVisual so one pass applies the EXIF orientation (web decodes with
// imageOrientation "from-image"), converts an embedded profile such as an iPhone's Display P3
// to sRGB, scales, and lays JPEG output on a white matte as web's canvas does.
// Exit 2: unreadable. Exit 3: no attempt fit the byte limit.
const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
try {
  $decoder = [Windows.Media.Imaging.BitmapDecoder]::Create([Uri]$env:T3TERM_IMG_SRC, [Windows.Media.Imaging.BitmapCreateOptions]::None, [Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
  $frame = $decoder.Frames[0]
  $sw = $frame.PixelWidth; $sh = $frame.PixelHeight
  if ($sw -le 0 -or $sh -le 0) { exit 2 }
} catch { exit 2 }
$source = $frame
try {
  if ($frame.ColorContexts -and $frame.ColorContexts.Count -gt 0) {
    $srgb = New-Object Windows.Media.ColorContext ([Windows.Media.PixelFormats]::Bgra32)
    $source = New-Object Windows.Media.Imaging.ColorConvertedBitmap $frame, $frame.ColorContexts[0], $srgb, ([Windows.Media.PixelFormats]::Bgra32)
  }
} catch { $source = $frame }
$orientation = 1
try { $value = $frame.Metadata.GetQuery('System.Photo.Orientation'); if ($value) { $orientation = [int]$value } } catch {}
$swap = $orientation -ge 5
$ow = if ($swap) { $sh } else { $sw }; $oh = if ($swap) { $sw } else { $sh }
$longest = [Math]::Max($ow, $oh)
$base = [Math]::Min([int]$env:T3TERM_IMG_MAX_EDGE, $longest)
$maxBytes = [long]$env:T3TERM_IMG_MAX_BYTES
$rendered = @{}
$index = -1
$failed = $false
foreach ($attempt in $env:T3TERM_IMG_ATTEMPTS.Split(';')) {
  $index++
  try {
    $format, $scale, $quality = $attempt.Split(':')
    $target = [Math]::Max(1, [Math]::Round($base * [double]$scale))
    $f = [Math]::Min(1.0, $target / $longest)
    $tw = [int][Math]::Max(1, [Math]::Min($target, [Math]::Round($ow * $f)))
    $th = [int][Math]::Max(1, [Math]::Min($target, [Math]::Round($oh * $f)))
    $key = "$format/$tw/$th"
    $bitmap = $rendered[$key]
    if (-not $bitmap) {
      $uw = if ($swap) { $th } else { $tw }; $uh = if ($swap) { $tw } else { $th }
      $m = switch ($orientation) { 2 { ,@(-1,0,0,1,$uw,0) } 3 { ,@(-1,0,0,-1,$uw,$uh) } 4 { ,@(1,0,0,-1,0,$uh) } 5 { ,@(0,1,1,0,0,0) } 6 { ,@(0,1,-1,0,$uh,0) } 7 { ,@(0,-1,-1,0,$uh,$uw) } 8 { ,@(0,-1,1,0,0,$uw) } default { ,@(1,0,0,1,0,0) } }
      $visual = New-Object Windows.Media.DrawingVisual
      [Windows.Media.RenderOptions]::SetBitmapScalingMode($visual, [Windows.Media.BitmapScalingMode]::HighQuality)
      $dc = $visual.RenderOpen()
      if ($format -eq 'jpeg') { $dc.DrawRectangle([Windows.Media.Brushes]::White, $null, (New-Object Windows.Rect 0, 0, $tw, $th)) }
      $dc.PushTransform((New-Object Windows.Media.MatrixTransform $m[0], $m[1], $m[2], $m[3], $m[4], $m[5]))
      $dc.DrawImage($source, (New-Object Windows.Rect 0, 0, $uw, $uh))
      $dc.Pop(); $dc.Close()
      $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap $tw, $th, 96, 96, ([Windows.Media.PixelFormats]::Pbgra32)
      $bitmap.Render($visual)
      $bitmap.Freeze()
      $rendered[$key] = $bitmap
    }
    if ($format -eq 'png') { $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder }
    else { $encoder = New-Object Windows.Media.Imaging.JpegBitmapEncoder; $encoder.QualityLevel = [int][Math]::Round([double]$quality * 100) }
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = New-Object IO.MemoryStream
    $encoder.Save($stream)
    $failed = $false
    if ($stream.Length -le $maxBytes) {
      [IO.File]::WriteAllBytes($env:T3TERM_IMG_OUT, $stream.ToArray())
      [Console]::Out.WriteLine("OK $index")
      exit 0
    }
  } catch { $failed = $true }
}
if ($failed) { exit 2 }
exit 3
`;

async function encodeWindows(src: string, dir: string, attempts: ReadonlyArray<Attempt>, maxBytes: number): Promise<EncodeResult> {
  // Each attempt writes the same file name; the extension only has to match the chosen format.
  const out = NodePath.join(dir, "encoded");
  const result = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")],
    {
      T3TERM_IMG_SRC: src,
      T3TERM_IMG_OUT: out,
      T3TERM_IMG_MAX_BYTES: String(maxBytes),
      T3TERM_IMG_MAX_EDGE: String(IMAGE_ATTACHMENT_MAX_EDGE),
      T3TERM_IMG_ATTEMPTS: attempts.map((attempt) => `${attempt.format}:${attempt.scale}:${attempt.quality}`).join(";"),
    },
  );
  if (result.missing) return { kind: "unavailable" };
  const match = /^OK (\d+)/m.exec(result.stdout);
  if (result.code === 0 && match && fileSize(out) !== null) return { kind: "ok", index: Number(match[1]), file: out };
  return result.code === 3 ? { kind: "too-large" } : { kind: "unreadable" };
}

type EncodeOne = (attempt: Attempt, out: string) => Promise<"ok" | "failed" | "missing">;

/** One tool run per attempt, keeping the first output within the byte limit. */
async function encodeEach(dir: string, attempts: ReadonlyArray<Attempt>, maxBytes: number, encodeOne: EncodeOne): Promise<EncodeResult> {
  let failed = false;
  for (const [index, attempt] of attempts.entries()) {
    const out = NodePath.join(dir, attempt.format === "png" ? "encoded.png" : "encoded.jpg");
    const status = await encodeOne(attempt, out);
    if (status === "missing") return { kind: "unavailable" };
    const size = status === "ok" ? fileSize(out) : null;
    if (size === null || size === 0) {
      failed = true;
      continue;
    }
    failed = false;
    if (size <= maxBytes) return { kind: "ok", index, file: out };
    NodeFs.rmSync(out, { force: true });
  }
  return failed ? { kind: "unreadable" } : { kind: "too-large" };
}

// sips keeps the EXIF orientation tag rather than baking it in, which viewers and providers
// honor; -Z scales the longest edge, which orientation does not change.
async function encodeMac(src: string, dir: string, attempts: ReadonlyArray<Attempt>, maxBytes: number): Promise<EncodeResult> {
  const probe = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src]);
  if (probe.missing) return { kind: "unavailable" };
  const width = Number(/pixelWidth:\s*(\d+)/.exec(probe.stdout)?.[1] ?? 0);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(probe.stdout)?.[1] ?? 0);
  if (probe.code !== 0 || width <= 0 || height <= 0) return { kind: "unreadable" };
  const longest = Math.max(width, height);
  return encodeEach(dir, attempts, maxBytes, async (attempt, out) => {
    const edge = targetEdge(longest, attempt.scale);
    const result = await run("sips", [
      "-s", "format", attempt.format,
      ...(attempt.format === "jpeg" ? ["-s", "formatOptions", String(Math.round(attempt.quality * 100))] : []),
      ...(edge < longest ? ["-Z", String(edge)] : []),
      src,
      "--out", out,
    ]);
    return result.missing ? "missing" : result.code === 0 ? "ok" : "failed";
  });
}

function imageMagickEncoder(command: string, src: string): EncodeOne {
  return async (attempt, out) => {
    const percent = Math.round(attempt.scale * 10000) / 100;
    const result = await run(command, [
      `${src}[0]`,
      "-auto-orient",
      "-resize", `${IMAGE_ATTACHMENT_MAX_EDGE}x${IMAGE_ATTACHMENT_MAX_EDGE}>`,
      ...(attempt.scale < 1 ? ["-resize", `${percent}%`] : []),
      ...(attempt.format === "jpeg"
        ? ["-background", "white", "-alpha", "remove", "-alpha", "off", "-quality", String(Math.round(attempt.quality * 100))]
        : []),
      "-strip",
      `${attempt.format}:${out}`,
    ]);
    return result.missing ? "missing" : result.code === 0 ? "ok" : "failed";
  };
}

// ffmpeg reads a "%" in an input name as an image-sequence pattern, so it gets a plain link.
// Its JPEG output drops alpha without a white matte; it is the last resort.
function ffmpegEncoder(src: string, dir: string): EncodeOne {
  let input = src;
  if (src.includes("%")) {
    input = NodePath.join(dir, `source${NodePath.extname(src).replaceAll("%", "")}`);
    try {
      NodeFs.symlinkSync(src, input);
    } catch {
      NodeFs.copyFileSync(src, input);
    }
  }
  return async (attempt, out) => {
    const target = `max(1,round(min(${IMAGE_ATTACHMENT_MAX_EDGE},max(iw,ih))*${attempt.scale}))`;
    const factor = `min(1,${target}/max(iw,ih))`;
    const scale = `scale=w='max(1,round(iw*${factor}))':h='max(1,round(ih*${factor}))':flags=lanczos`;
    // -q:v runs 2 (best) to 31; this maps web's 0..1 quality steps onto it roughly linearly.
    const qscale = String(Math.round(2 + (1 - attempt.quality) * 29));
    const result = await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", input,
      "-frames:v", "1",
      "-vf", scale,
      ...(attempt.format === "jpeg" ? ["-q:v", qscale] : []),
      "-update", "1",
      out,
    ]);
    return result.missing ? "missing" : result.code === 0 ? "ok" : "failed";
  };
}

async function encodeLinux(src: string, dir: string, attempts: ReadonlyArray<Attempt>, maxBytes: number, heic: boolean): Promise<EncodeResult> {
  let source = src;
  let heifTool: string | null = null;
  if (heic) {
    // Decode losslessly to PNG first: libheif applies the HEIC rotation, and ImageMagick or
    // ffmpeg builds often lack HEIC support of their own.
    const decoded = NodePath.join(dir, "decoded.png");
    for (const tool of ["heif-dec", "heif-convert"]) {
      const result = await run(tool, [src, decoded]);
      if (result.missing) continue;
      heifTool = tool;
      if (result.code === 0 && fileSize(decoded)) source = decoded;
      break;
    }
  }
  const encoders = [() => imageMagickEncoder("magick", source), () => imageMagickEncoder("convert", source), () => ffmpegEncoder(source, dir)];
  for (const encoder of encoders) {
    const result = await encodeEach(dir, attempts, maxBytes, encoder());
    if (result.kind !== "unavailable") return result;
  }
  const tool = heifTool;
  if (!tool) return { kind: "unavailable" };
  // libheif alone cannot resize: like web without a canvas, send the picture at its own size.
  return encodeEach(dir, attempts.filter((attempt) => attempt.scale === 1 && attempt.format === "jpeg"), maxBytes, async (attempt, out) => {
    const result = await run(tool, ["-q", String(Math.round(attempt.quality * 100)), src, out]);
    return result.missing ? "missing" : result.code === 0 ? "ok" : "failed";
  });
}

function encode(src: string, dir: string, attempts: ReadonlyArray<Attempt>, maxBytes: number, heic: boolean): Promise<EncodeResult> {
  switch (process.platform) {
    case "win32":
      return encodeWindows(src, dir, attempts, maxBytes);
    case "darwin":
      return encodeMac(src, dir, attempts, maxBytes);
    default:
      return encodeLinux(src, dir, attempts, maxBytes, heic);
  }
}

/**
 * Returns the original path untouched when it is already a supported type within maxBytes (and,
 * for PNG/JPEG, within 2000px on a side, as web fitImageToMaxEdge). Otherwise writes a JPEG (or a
 * fitted PNG) under os.tmpdir()/t3term-images/<id>/, named after the original.
 */
export async function prepareImageAttachment(
  input: { path: string; name: string; mimeType: string; sizeBytes: number },
  maxBytes: number,
): Promise<PreparedImage> {
  const heic = isHeicImage(input);
  const mimeType = heic ? "image/heic" : normalizedMimeType(input);
  if (!heic && !isProviderSendTurnSupportedImageMimeType(mimeType)) return { ok: false, reason: "unsupported" };

  const sizeBytes = fileSize(input.path);
  if (!sizeBytes) return { ok: false, reason: "unreadable" };
  const passThrough: PreparedImage = { ok: true, path: input.path, name: input.name, mimeType, sizeBytes, converted: false };

  const attempts: Attempt[] = [];
  let fitFormat: "png" | "jpeg" | null = null;
  if (heic) {
    if (sizeBytes > MAX_COMPRESSIBLE_SOURCE_BYTES) return { ok: false, reason: "too-large" };
    let dimensionError: "unreadable" | "too-large" | null;
    try {
      dimensionError = validateHeicImageDimensions(await readHead(input.path, MAX_HEIC_METADATA_BYTES));
    } catch {
      dimensionError = "unreadable";
    }
    if (dimensionError) return { ok: false, reason: dimensionError };
  } else {
    const downscalable = downscalableImageMimeType(mimeType);
    if (downscalable && sizeBytes <= MAX_COMPRESSIBLE_SOURCE_BYTES) {
      const header = await readHead(input.path, IMAGE_DIMENSIONS_HEADER_BYTES).catch(() => null);
      const dimensions = header ? readImageDimensions(header) : null;
      if (dimensions && fitImageAttachmentSize(dimensions)) fitFormat = downscalable === "image/png" ? "png" : "jpeg";
    }
    if (!fitFormat && sizeBytes <= maxBytes) return passThrough;
    if (sizeBytes > MAX_COMPRESSIBLE_SOURCE_BYTES) return { ok: false, reason: "too-large" };
  }
  if (fitFormat) attempts.push({ format: fitFormat, scale: 1, quality: QUALITY_STEPS[0] });
  for (const scale of [1, ...FALLBACK_SCALE_STEPS]) {
    for (const quality of QUALITY_STEPS) {
      const last = attempts.at(-1);
      // A JPEG fit (or HEIC conversion) is the same encode as the first re-encode pass.
      if (last && last.format === "jpeg" && last.scale === scale && last.quality === quality) continue;
      attempts.push({ format: "jpeg", scale, quality });
    }
  }

  const dir = NodePath.join(NodeOs.tmpdir(), "t3term-images", globalThis.crypto.randomUUID());
  let result: EncodeResult;
  try {
    NodeFs.mkdirSync(dir, { recursive: true });
    result = await encode(input.path, dir, attempts, maxBytes, heic);
  } catch {
    result = { kind: "unreadable" };
  }
  if (result.kind !== "ok") {
    NodeFs.rmSync(dir, { recursive: true, force: true });
    // Web falls back to the untouched file when the 2000px fit cannot run but the file fits.
    if (!heic && sizeBytes <= maxBytes) return passThrough;
    if (result.kind === "unavailable") return { ok: false, reason: heic ? "unreadable" : "too-large" };
    return { ok: false, reason: result.kind };
  }

  const attempt = attempts[result.index]!;
  // Web keeps the name for a fitted PNG/JPEG and renames re-encodes and HEIC conversions to .jpg.
  const name = fitFormat && result.index === 0 ? input.name : fileNameForJpeg(input.name || "image");
  const path = NodePath.join(dir, name);
  try {
    NodeFs.renameSync(result.file, path);
    for (const entry of NodeFs.readdirSync(dir)) {
      if (entry !== name) NodeFs.rmSync(NodePath.join(dir, entry), { recursive: true, force: true });
    }
  } catch {
    NodeFs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: "unreadable" };
  }
  return {
    ok: true,
    path,
    name,
    mimeType: attempt.format === "png" ? "image/png" : "image/jpeg",
    sizeBytes: fileSize(path) ?? 0,
    converted: true,
  };
}
