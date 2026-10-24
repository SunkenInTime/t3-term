// Images in chat markdown: web's ChatMarkdownMedia (inline-block, at most
// min(100%, 30rem) wide and 30rem tall, workspace files framed), the
// ExpandedImageDialog with ZoomableImage (click to zoom 2x at the pointer,
// wheel to zoom, drag to pan, arrows between a message's images), and
// MediaActions' right-click menu (copy URL or path, save, copy image) plus
// OpenMediaLink for the original URL.
//
// gpuix <img> needs a size, so an image's pixel size is read from its header
// first (shared readImageDimensions); until then a standalone image holds
// web's aspect-video placeholder frame.
import { useAtomValue } from "@effect/atom-react";
import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ContextMenuItem } from "@t3tools/contracts";
import { IMAGE_DIMENSIONS_HEADER_BYTES, readImageDimensions } from "@t3tools/shared/imageDimensions";
import { DismissableLayer } from "@gpuix/react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import type { Element } from "hast";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { memo, useEffect, useState } from "react";

import { environmentSession } from "../../state/environment.ts";
import { timelineAssets } from "../../state/timeline.ts";
import { Icon } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import { viewportHeightAtom, viewportWidthAtom } from "../../ui/viewport.tsx";
import { copyTextToClipboard, openExternalUrl } from "../timeline/system.ts";
import { withAlpha } from "./colors.ts";
import { bumpAsyncLayout } from "./diagrams.ts";
import type { BoxAtom, RunStyle } from "./inline.ts";
import { closeMarkdownOverlay, openMarkdownOverlay, showMarkdownContextMenu } from "./overlays.tsx";
import { baselineOffset } from "./styles.ts";
import { MARGIN_AWARE, type RenderEnv } from "./MarkdownView.tsx";

const MEDIA_MAX = 480; // 30rem

// ── Image size lookup ───────────────────────────────────────────────────

type ImageInfo = { readonly width: number; readonly height: number } | { readonly error: true };
const infoCache = new Map<string, ImageInfo>();
const infoInflight = new Map<string, Promise<ImageInfo>>();

function requestImageInfo(src: string): Promise<ImageInfo> {
  const cached = infoCache.get(src);
  if (cached) return Promise.resolve(cached);
  const running = infoInflight.get(src);
  if (running) return running;
  const promise = (async (): Promise<ImageInfo> => {
    try {
      let bytes: Uint8Array;
      if (src.startsWith("data:")) {
        bytes = Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
      } else {
        const response = await fetch(src, { headers: { Range: `bytes=0-${IMAGE_DIMENSIONS_HEADER_BYTES - 1}` }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) return { error: true };
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      if (/^data:image\/svg|\.svg(?:$|[?#])/i.test(src)) {
        const text = new TextDecoder().decode(bytes);
        const width = Number(/<svg[^>]*\swidth="([\d.]+)/.exec(text)?.[1] ?? NaN);
        const height = Number(/<svg[^>]*\sheight="([\d.]+)/.exec(text)?.[1] ?? NaN);
        if (width > 0 && height > 0) return { width, height };
        const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(text);
        return box ? { width: Number(box[1]), height: Number(box[2]) } : { error: true };
      }
      return readImageDimensions(bytes) ?? { error: true };
    } catch {
      return { error: true };
    }
  })().then((info) => {
    infoCache.set(src, info);
    infoInflight.delete(src);
    return info;
  });
  infoInflight.set(src, promise);
  return promise;
}

function useImageInfo(src: string | null): ImageInfo | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!src || infoCache.has(src)) return;
    let live = true;
    void requestImageInfo(src).then(() => {
      if (live) bump((value) => value + 1);
    });
    return () => {
      live = false;
    };
  }, [src]);
  return src ? (infoCache.get(src) ?? null) : null;
}

/** authoredImageSizeStyle + the 30rem bounds, resolved to a box. */
function fitImage(info: { width: number; height: number }, available: number, authored: { width?: number; height?: number }): { width: number; height: number } {
  const ratio = info.width / info.height;
  let width = authored.width ?? (authored.height ? authored.height * ratio : info.width);
  let height = width / ratio;
  const maxWidth = Math.min(available, MEDIA_MAX);
  if (width > maxWidth) {
    width = maxWidth;
    height = width / ratio;
  }
  if (height > MEDIA_MAX) {
    height = MEDIA_MAX;
    width = height * ratio;
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

// ── Sources ─────────────────────────────────────────────────────────────

const NO_ASSET = Atom.make<unknown>(null);

/** A markdown image source as a URL gpuix can load: web URLs as they are, workspace files through the server's asset URLs. */
function useImageUrl(src: string, env: RenderEnv): { url: string | null; workspace: boolean; failed: boolean } {
  const context = env.media;
  const source = classifyMarkdownImageSource(src.replaceAll("\\", "/"), context.cwd ?? null);
  const environmentId = context.environmentId;
  const resource =
    source._tag === "WorkspaceFile" && environmentId && context.threadId
      ? { _tag: "media-file" as const, threadId: context.threadId, path: source.path }
      : null;
  const prepared = useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId ?? ("" as EnvironmentId)));
  const asset = useAtomValue(resource && environmentId ? timelineAssets.createUrl({ environmentId, input: { resource } }) : NO_ASSET) as
    | { _tag: string; value?: { relativeUrl: string } }
    | null;
  if (source._tag === "Direct") {
    const uri = source.uri.startsWith("//") ? `https:${source.uri}` : source.uri;
    return { url: uri, workspace: false, failed: false };
  }
  if (!resource) return { url: null, workspace: true, failed: true };
  const base = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  if (asset?._tag === "Success" && asset.value && base) return { url: resolveAssetUrl(base, asset.value.relativeUrl), workspace: true, failed: false };
  return { url: null, workspace: true, failed: asset?._tag === "Failure" };
}

export interface MediaContext {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly cwd: string | undefined;
}

// ── Media actions (right-click) ─────────────────────────────────────────

async function fetchBytes(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The image could not be downloaded (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function extensionFor(url: string, bytes: Buffer): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return ".png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg";
  if (bytes.subarray(0, 4).toString("ascii") === "GIF8") return ".gif";
  if (bytes.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (/^data:image\/svg|\.svg/i.test(url) || bytes.subarray(0, 256).toString("utf8").includes("<svg")) return ".svg";
  return ".png";
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim().slice(0, 80) || "image";
}

/** "Save image": web downloads; here it lands in ~/Downloads under a free name. */
async function saveImage(url: string, name: string): Promise<string> {
  const bytes = await fetchBytes(url);
  const directory = NodePath.join(NodeOS.homedir(), "Downloads");
  NodeFS.mkdirSync(directory, { recursive: true });
  const base = safeFileName(name.replace(/\.[a-z0-9]+$/i, ""));
  const extension = extensionFor(url, bytes);
  let target = NodePath.join(directory, `${base}${extension}`);
  for (let index = 1; NodeFS.existsSync(target); index += 1) target = NodePath.join(directory, `${base} (${index})${extension}`);
  NodeFS.writeFileSync(target, bytes);
  return target;
}

/** "Copy image": the OS clipboard takes a bitmap from a temporary file. */
async function copyImage(url: string): Promise<void> {
  const bytes = await fetchBytes(url);
  const file = NodePath.join(NodeOS.tmpdir(), `t3term-copy-${Date.now()}${extensionFor(url, bytes)}`);
  NodeFS.writeFileSync(file, bytes);
  const command =
    process.platform === "win32"
      ? [
          "powershell.exe",
          "-NoProfile",
          "-Command",
          `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${file.replaceAll("'", "''")}'))`,
        ]
      : process.platform === "darwin"
        ? ["osascript", "-e", `set the clipboard to (read (POSIX file "${file}") as «class PNGf»)`]
        : ["xclip", "-selection", "clipboard", "-t", "image/png", "-i", file];
  const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  if ((await proc.exited) !== 0) throw new Error("The clipboard did not take the image.");
}

export interface MediaActionSource {
  readonly url: string;
  readonly name: string;
  /** The authored source: a web URL or a host path. */
  readonly reference: string;
  readonly isFile: boolean;
}

export function showMediaActions(source: MediaActionSource, position: { x: number; y: number }) {
  const items: ContextMenuItem<string>[] = [
    source.isFile ? { id: "copy-path", label: "Copy full path" } : { id: "copy-url", label: "Copy URL" },
    { id: "save", label: "Save image" },
    { id: "copy-image", label: "Copy image" },
  ];
  void showMarkdownContextMenu(items, position).then(async (action) => {
    if (!action) return;
    try {
      if (action === "copy-path" || action === "copy-url") {
        await copyTextToClipboard(source.reference);
        toast({ type: "success", title: action === "copy-url" ? "URL copied" : "Path copied", description: source.reference });
      } else if (action === "save") {
        const target = await saveImage(source.url, source.name);
        toast({ type: "success", title: "Image saved", description: target });
      } else if (action === "copy-image") {
        await copyImage(source.url);
        toast({ type: "success", title: "Image copied" });
      }
    } catch (error) {
      toast({ type: "error", title: `Could not ${items.find((item) => item.id === action)?.label.toLowerCase() ?? "complete that"}`, description: error instanceof Error ? error.message : undefined });
    }
  });
}

// ── Block images ────────────────────────────────────────────────────────

function authoredSize(node: Element): { width?: number; height?: number } {
  const width = Number(node.properties.width);
  const height = Number(node.properties.height);
  return {
    ...(Number.isFinite(width) && width > 0 ? { width } : {}),
    ...(Number.isFinite(height) && height > 0 ? { height } : {}),
  };
}

/** Message images in document order, for the viewer's previous/next. */
export function collectImages(env: RenderEnv): ExpandedImageItem[] {
  return env.media.gallery;
}

export const MarkdownImage = memo(function MarkdownImage({
  node,
  width,
  env,
  marginTop,
}: {
  node: Element;
  width: number;
  env: RenderEnv;
  marginTop?: number;
}) {
  const palette = useTheme();
  const src = String(node.properties.src ?? "");
  const alt = String(node.properties.alt ?? "");
  const { url, workspace, failed } = useImageUrl(src, env);
  const info = useImageInfo(url);
  const frame = workspace ? { borderRadius: RADIUS.lg, borderWidth: 1, borderColor: withAlpha(palette.border, 0.4) } : {};
  const source: MediaActionSource | null = url ? { url, name: alt.trim() || "image", reference: src, isFile: workspace } : null;
  if (failed || (info && "error" in info) || (!url && !workspace)) {
    return (
      <div style={{ display: "flex", flexDirection: "row", marginTop }}>
        <ImageFallback alt={alt} />
      </div>
    );
  }
  if (!url || !info) {
    // Loading: web's aspect-video frame.
    const placeholderWidth = Math.min(width, MEDIA_MAX);
    return (
      <div
        style={{
          width: placeholderWidth,
          height: (placeholderWidth * 9) / 16,
          marginTop,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: withAlpha(palette.border, 0.4),
          backgroundColor: withAlpha(palette.muted, 0.6),
        }}
      />
    );
  }
  const size = fitImage(info, width, authoredSize(node));
  const border = workspace ? 2 : 0;
  return (
    <div style={{ display: "flex", flexDirection: "row", marginTop }}>
      <div
        onClick={() => {
          const gallery = env.media.gallery;
          const index = Math.max(0, gallery.findIndex((item) => item.src === url));
          openExpandedImage({ images: gallery.length > 0 ? gallery : [{ src: url, name: alt.trim() || "image", width: info.width, height: info.height }], index });
        }}
        onAuxClick={(event) => {
          if (event.isRightClick && source) showMediaActions(source, { x: event.x ?? 0, y: event.y ?? 0 });
        }}
        style={{ display: "flex", width: size.width + border, height: size.height + border, cursor: "pointer", overflow: "hidden", ...frame }}
      >
        <img src={url} objectFit="contain" style={{ width: size.width, height: size.height, ...(workspace ? { borderRadius: RADIUS.lg - 1 } : {}) }} />
      </div>
    </div>
  );
});
MARGIN_AWARE.add(MarkdownImage);

function ImageFallback({ alt }: { alt: string }) {
  const palette = useTheme();
  // rounded-md border border-border/40 bg-muted/40 px-2 py-1 text-xs text-muted-foreground
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 4,
        paddingBottom: 4,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: withAlpha(palette.border, 0.4),
        backgroundColor: withAlpha(palette.muted, 0.4),
      }}
    >
      <Icon name="triangle-alert" size={14} color={palette.mutedForeground} />
      <text style={{ fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, color: palette.mutedForeground }}>
        {["Image unavailable", alt].filter(Boolean).join(" · ")}
      </text>
    </div>
  );
}

// ── Inline images (badges) ──────────────────────────────────────────────

export interface InlineImagePayload {
  readonly type: "image";
  readonly url: string;
  readonly top: number;
  readonly imageHeight: number;
  readonly alt: string;
}

/** An inline web image as a box atom once its size is known; null until then (the alt text stands in). */
export function inlineImageAtom(id: string, node: Element, style: RunStyle, maxWidth: number): BoxAtom | null {
  const src = String(node.properties.src ?? "");
  const source = classifyMarkdownImageSource(src, null);
  if (source._tag !== "Direct") return null;
  const url = source.uri.startsWith("//") ? `https:${source.uri}` : source.uri;
  const cached = infoCache.get(url);
  if (!cached) {
    void requestImageInfo(url).then(bumpAsyncLayout);
    return null;
  }
  if ("error" in cached) return null;
  const size = fitImage(cached, maxWidth, authoredSize(node));
  // vertical-align: baseline puts the image's bottom on the text baseline.
  const top = baselineOffset(style.face.family, style.size, style.lineHeight) - size.height;
  // A picture taller than the text above the baseline grows the line, as a browser's line box does.
  const lift = Math.max(0, -top);
  return {
    kind: "box",
    id,
    width: size.width,
    height: Math.max(style.lineHeight, top + size.height),
    lift,
    payload: { type: "image", url, top, imageHeight: size.height, alt: String(node.properties.alt ?? "") } satisfies InlineImagePayload,
  };
}

export function InlineImageBox({ atom }: { atom: BoxAtom }) {
  const payload = atom.payload as InlineImagePayload;
  // A negative top reaches into the row's lift padding above the text.
  const top = payload.top;
  return (
    <div
      onAuxClick={(event) => {
        if (event.isRightClick) showMediaActions({ url: payload.url, name: payload.alt || "image", reference: payload.url, isFile: false }, { x: event.x ?? 0, y: event.y ?? 0 });
      }}
      style={{ display: "flex", width: atom.width, flexShrink: 0, marginTop: top }}
    >
      <img src={payload.url} objectFit="contain" style={{ width: atom.width, height: payload.imageHeight }} />
    </div>
  );
}

// ── Expanded viewer ─────────────────────────────────────────────────────

export interface ExpandedImageItem {
  readonly src: string;
  readonly name: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly originalUrl?: string | undefined;
}

export interface ExpandedImagePreview {
  readonly images: ReadonlyArray<ExpandedImageItem>;
  readonly index: number;
}

export function openExpandedImage(preview: ExpandedImagePreview) {
  openMarkdownOverlay({ kind: "custom", render: (close) => <ExpandedImageDialog preview={preview} onClose={close} /> });
}

const MAX_ZOOM = 8;

function ExpandedImageDialog({ preview, onClose }: { preview: ExpandedImagePreview; onClose: () => void }) {
  const palette = useTheme();
  const viewportWidth = useAtomValue(viewportWidthAtom);
  const viewportHeight = useAtomValue(viewportHeightAtom);
  const [offset, setOffset] = useState(0);
  const count = preview.images.length;
  const index = count > 0 ? (((preview.index + offset) % count) + count) % count : 0;
  const item = preview.images[index];
  const info = useImageInfo(item?.width ? null : (item?.src ?? null));
  const natural = item?.width && item.height ? { width: item.width, height: item.height } : info && !("error" in info) ? info : null;
  // --media-width: 92vw less the arrow gutters at sm+; --media-height: 86% of the window or 160px less.
  const small = viewportWidth < 640;
  const mediaWidth = viewportWidth * 0.92 - (small ? 0 : 96);
  const mediaHeight = Math.min(viewportHeight * 0.86, viewportHeight - 160);
  const fit = natural ? Math.min(1, mediaWidth / natural.width, mediaHeight / natural.height) : 1;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [index]);
  if (!item) return null;
  const baseWidth = natural ? natural.width * fit : Math.min(mediaWidth, 512);
  const baseHeight = natural ? natural.height * fit : Math.min(mediaHeight, 288);
  const width = baseWidth * zoom;
  const height = baseHeight * zoom;
  // The viewport is the fitted box; a zoomed image pans inside it.
  const maxPanX = Math.max(0, (width - baseWidth) / 2);
  const maxPanY = Math.max(0, (height - baseHeight) / 2);
  const clampPan = (x: number, y: number) => ({ x: Math.max(-maxPanX, Math.min(maxPanX, x)), y: Math.max(-maxPanY, Math.min(maxPanY, y)) });
  const changeZoom = (next: number) => {
    const clamped = Math.max(1, Math.min(MAX_ZOOM, next));
    setZoom(clamped);
    if (clamped === 1) setPan({ x: 0, y: 0 });
  };
  const navButton = (direction: -1 | 1) => (
    <div
      onClick={() => setOffset((value) => value + direction)}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: RADIUS.md, cursor: "pointer", hover: { backgroundColor: "#ffffff1a" } }}
    >
      <Icon name={direction < 0 ? "chevron-left" : "chevron-right"} size={20} color="#ffffffe6" />
    </div>
  );
  const gutter = count > 1 ? 48 : 0;
  const contentWidth = baseWidth + 2 * gutter;
  const contentHeight = baseHeight + 24;
  return (
    <DismissableLayer onEscapeKeyDown={onClose}>
      {/* The backdrop closes on a click outside the image, like web's popup. */}
      <anchored fill="window" deferred priority={2} style={{ backgroundColor: "transparent" }}>
        <div onClick={onClose} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.overlay, pointerEvents: "auto" }} />
      </anchored>
      <anchored
        position={{ x: Math.max(0, (viewportWidth - contentWidth) / 2), y: Math.max(0, (viewportHeight - contentHeight) / 2) }}
        anchor="topLeft"
        deferred
        priority={3}
        style={{ backgroundColor: "transparent" }}
      >
        <div
          testId="expanded-image-dialog"
          tabIndex={0}
          autoFocus
          onKeyDown={(event) => {
            if (count > 1 && event.key === "left") setOffset((value) => value - 1);
            else if (count > 1 && event.key === "right") setOffset((value) => value + 1);
            else if (event.key === "0") changeZoom(1);
            else if (event.key === "+" || event.key === "=") changeZoom(zoom * 1.5);
            else if (event.key === "-") changeZoom(zoom / 1.5);
            else if (event.key === "enter") changeZoom(zoom > 1 ? 1 : 2);
          }}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", pointerEvents: "auto" }}
        >
          {count > 1 ? <div style={{ display: "flex", width: gutter, justifyContent: "flex-start" }}>{navButton(-1)}</div> : null}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              onClick={(event) => {
                if (moved) return;
                void event;
                changeZoom(zoom > 1 ? 1 : 2);
              }}
              onScroll={(event) => changeZoom(zoom * Math.exp(-(Number(event.deltaY ?? 0)) * 0.002))}
              onMouseDown={(event) => {
                setMoved(false);
                setDrag({ x: event.x ?? 0, y: event.y ?? 0, panX: pan.x, panY: pan.y });
              }}
              onMouseMove={(event) => {
                if (!drag || zoom <= 1) return;
                const dx = (event.x ?? 0) - drag.x;
                const dy = (event.y ?? 0) - drag.y;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) setMoved(true);
                setPan(clampPan(drag.panX + dx, drag.panY + dy));
              }}
              onMouseUp={() => setDrag(null)}
              onAuxClick={(event) => {
                if (event.isRightClick) showMediaActions({ url: item.src, name: item.name, reference: item.originalUrl ?? item.src, isFile: false }, { x: event.x ?? 0, y: event.y ?? 0 });
              }}
              style={{
                position: "relative",
                width: baseWidth,
                height: baseHeight,
                overflow: "hidden",
                borderRadius: RADIUS.lg,
                borderWidth: 1,
                borderColor: withAlpha(palette.border, 0.7),
                cursor: zoom > 1 ? (drag ? "grabbing" : "grab") : "pointer",
                boxShadow: { offsetX: 0, offsetY: 25, blurRadius: 25, spreadRadius: -12, color: "#00000066" },
              }}
            >
              <img
                src={item.src}
                objectFit="contain"
                style={{ position: "absolute", left: (baseWidth - width) / 2 + pan.x, top: (baseHeight - height) / 2 + pan.y, width, height }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, height: 16 }}>
              <text style={{ fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, color: "#ffffffcc", whiteSpace: "nowrap" }}>
                {`${item.name}${count > 1 ? ` (${index + 1}/${count})` : ""}`}
              </text>
              {zoom > 1 ? <text style={{ fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, color: "#ffffff99" }}>{`${Math.round(zoom * 100)}%`}</text> : null}
              {item.originalUrl ? <OpenMediaLink url={item.originalUrl} /> : null}
            </div>
          </div>
          {count > 1 ? <div style={{ display: "flex", width: gutter, justifyContent: "flex-end" }}>{navButton(1)}</div> : null}
        </div>
      </anchored>
      <anchored position={{ x: viewportWidth * 0.96 - 28, y: viewportHeight * 0.04 }} anchor="topLeft" deferred priority={4} style={{ backgroundColor: "transparent" }}>
        <div
          onClick={onClose}
          testId="expanded-image-close"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: RADIUS.md,
            backgroundColor: "#000000a6",
            borderWidth: 1,
            borderColor: "#ffffff33",
            cursor: "pointer",
            pointerEvents: "auto",
            hover: { backgroundColor: "#000000cc" },
          }}
        >
          <Icon name="x" size={16} color="#ffffff" />
        </div>
      </anchored>
    </DismissableLayer>
  );
}

/** media/OpenMediaLink: "Open original" for media that came from a web URL. */
function OpenMediaLink({ url }: { url: string }) {
  return (
    <div
      onClick={() => openExternalUrl(url)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, cursor: "pointer" }}
    >
      <Icon name="external-link" size={12} color="#ffffffcc" />
      <text style={{ fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, color: "#ffffffcc" }}>Open original</text>
    </div>
  );
}

export function closeExpandedImage() {
  closeMarkdownOverlay();
}

