// Videos in chat (web: media/MediaVideoPlayer.tsx, an inline <video> with
// controls). gpuix has no video element: its elements are div, text, code,
// diff, markdown, input, textarea, virtual-list, img, svg and anchored, and its
// native side has no media decoder or audio output. t3-term does not fake
// playback. A video shows its real first frame when ffmpeg is installed
// (otherwise a black frame), a play button, and plays in the system browser,
// which is web's own "Open in browser" fallback (media/OpenMediaLink.tsx).
import { readImageDimensions } from "@t3tools/shared/imageDimensions";
import { useEffect, useState } from "react";

import { Tooltip } from "../../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { openExternalUrl } from "../timeline/system.ts";

// ── First frame ─────────────────────────────────────────────────────────

export interface VideoPoster {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

const POSTER_TIMEOUT_MS = 20_000;
/** Wide enough for the 30rem markdown frame at 2x; the thumbnails scale it down. */
const POSTER_MAX_WIDTH = 960;

const posters = new Map<string, VideoPoster | null>();
const pending = new Map<string, Promise<VideoPoster | null>>();
let queue: Promise<unknown> = Promise.resolve();
let ffmpegPath: string | null | undefined;

function ffmpeg(): string | null {
  if (ffmpegPath === undefined) ffmpegPath = Bun.which("ffmpeg") ?? null;
  return ffmpegPath;
}

/** Decodes the first frame with ffmpeg, one video at a time; null when ffmpeg is missing or the video cannot be read. */
async function extractPoster(url: string): Promise<VideoPoster | null> {
  const binary = ffmpeg();
  if (!binary) return null;
  try {
    const proc = Bun.spawn(
      [binary, "-v", "error", "-nostdin", "-i", url, "-frames:v", "1", "-vf", `scale='min(${POSTER_MAX_WIDTH},iw)':-2`, "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
      { stdout: "pipe", stderr: "ignore", stdin: "ignore", windowsHide: true },
    );
    const timer = setTimeout(() => proc.kill(), POSTER_TIMEOUT_MS);
    const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    clearTimeout(timer);
    if ((await proc.exited) !== 0 || bytes.length === 0) return null;
    const size = readImageDimensions(bytes);
    if (!size) return null;
    return { src: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

function requestPoster(key: string, url: string): Promise<VideoPoster | null> {
  const running = pending.get(key);
  if (running) return running;
  const next = queue.then(() => extractPoster(url));
  queue = next.catch(() => null);
  const promise = next.then((poster) => {
    posters.set(key, poster);
    pending.delete(key);
    return poster;
  });
  pending.set(key, promise);
  return promise;
}

/**
 * The first frame of `url`, cached by `key` (an attachment id or the authored
 * source, since signed URLs change). undefined while decoding, null when none.
 */
export function useVideoPoster(key: string | null, url: string | null): VideoPoster | null | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key || !url || posters.has(key)) return;
    let live = true;
    void requestPoster(key, url).then(() => {
      if (live) bump((value) => value + 1);
    });
    return () => {
      live = false;
    };
  }, [key, url]);
  if (!key || !url) return null;
  return posters.has(key) ? posters.get(key) : undefined;
}

// ── Frame ───────────────────────────────────────────────────────────────

/** lucide PlayIcon with fill-current, as web's play button draws it (ui/Icon has no fill). */
const FILLED_PLAY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>';

/**
 * A video at rest: the first frame on black (object-contain, like web's
 * <video>), web's 32px play circle in the middle, and a click that plays it in
 * the system browser. `url` null means the video cannot be reached: the frame
 * keeps its play glyph, as web's player does, but does nothing.
 */
export function VideoFrame({
  url,
  posterKey,
  label,
  width,
  height,
  radius = RADIUS.lg,
  borderColor,
  showName = false,
  testId,
}: {
  url: string | null;
  posterKey: string | null;
  label: string;
  width: number;
  height: number;
  radius?: number;
  /** border-border/80 for attachments (default); markdown frames use /40. */
  borderColor?: string;
  /** With no URL: the name instead of the play glyph (web: an attachment with no source at all). */
  showName?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  const poster = useVideoPoster(posterKey, url);
  const [hovered, setHovered] = useState(false);
  const inner = { width: width - 2, height: height - 2 };
  const frame = (
    <div
      testId={testId}
      onClick={url ? () => openExternalUrl(url) : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height,
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: radius,
        borderWidth: 1,
        borderColor: borderColor ?? alpha(theme.border, 0.8),
        backgroundColor: "#000000",
        cursor: url ? "pointer" : "default",
      }}
    >
      {poster ? <img src={poster.src} objectFit="contain" style={{ width: inner.width, height: inner.height, borderRadius: radius - 1 }} /> : null}
      {url || !showName ? (
        <div
          style={{
            position: "absolute",
            left: (width - 32) / 2 - 1,
            top: (height - 32) / 2 - 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: hovered ? "#000000a6" : "#00000080",
            pointerEvents: "none",
          }}
        >
          <svg source={FILLED_PLAY_SVG} style={{ width: 16, height: 16, color: "#ffffff" }} />
        </div>
      ) : (
        <text style={{ color: "#ffffffb3", fontFamily: FONTS.sans, fontSize: 11, lineHeight: 16, textAlign: "center", width: width - 16, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
          {label}
        </text>
      )}
    </div>
  );
  return (
    <Tooltip content={url ? (label ? `Play ${label} in browser` : "Play in browser") : "Video unavailable"} side="top">
      {frame}
    </Tooltip>
  );
}
