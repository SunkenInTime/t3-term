// PreviewFaviconIcon.tsx FaviconImage: show a page's favicon, falling back to a
// globe when it cannot load. gpuix paints a "load failed" placeholder for a
// broken <img src>, so the bytes are fetched here and only a good image is
// handed to the element.
import type { ImgInstance } from "@gpuix/react";
import { useLayoutEffect, useRef, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { useTheme } from "../../ui/theme.ts";

const cache = new Map<string, Promise<Uint8Array | null>>();

function loadFavicon(url: string): Promise<Uint8Array | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then(async (response) => (response.ok ? new Uint8Array(await response.arrayBuffer()) : null))
      .then((bytes) => (bytes && bytes.byteLength > 0 ? bytes : null))
      .catch(() => null);
    cache.set(url, pending);
  }
  return pending;
}

export function FaviconImage({ url, size, color }: { url: string | null; size: number; color?: string }) {
  const theme = useTheme();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const imgRef = useRef<ImgInstance | null>(null);
  useLayoutEffect(() => {
    setBytes(null);
    if (!url) return;
    let cancelled = false;
    void loadFavicon(url).then((loaded) => {
      if (!cancelled) setBytes(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  useLayoutEffect(() => {
    if (!bytes) return;
    try {
      imgRef.current?.setImage(bytes);
    } catch {
      setBytes(null);
    }
  }, [bytes]);
  if (!bytes) return <Icon name="globe" size={size} color={color ?? theme.mutedForeground} />;
  return <img ref={imgRef} objectFit="contain" style={{ width: size, height: size, borderRadius: 2, flexShrink: 0 }} />;
}
