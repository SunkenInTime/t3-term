// The window of rows a windowed <virtual-list> mounts (`itemCount` +
// `windowStart`), shared by the Diff and Files code views.
//
// A long wheel fling can carry the list past the mounted rows; the range gpuix
// reports in that frame describes the rows it could lay out, not where the
// scroll landed. So the window follows the list's logical anchor
// (`getListScrollTop`), and that anchor is put back after the new rows commit.
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useLayoutEffect, useRef, useState } from "react";

const MIN_ROW_HEIGHT = 20;

export function useListWindow(size: number) {
  const renderer = useGpuixRequired();
  const listRef = useRef<PublicInstance | null>(null);
  const [start, setStartState] = useState(0);
  const anchor = useRef<readonly [number, number] | null>(null);

  useLayoutEffect(() => {
    const pending = anchor.current;
    anchor.current = null;
    if (pending && listRef.current) renderer.scrollToItem?.(listRef.current.id, pending[0], pending[1]);
  }, [start, renderer]);

  /** Feed `onVisibleRange` here; slides the window when the viewport leaves or nears its edge. */
  const onVisibleRange = (reportedFirst: number, reportedLast: number) => {
    const id = listRef.current?.id;
    const top = id == null ? null : renderer.getListScrollTop?.(id);
    const first = top ? top[0]! : reportedFirst;
    const last = top ? first + Math.ceil((top[2] ?? 0) / MIN_ROW_HEIGHT) : reportedLast;
    if (first >= start && last <= start + size - 8) return;
    const next = Math.max(0, first - Math.floor(size / 4));
    if (next === start) return;
    if (top) anchor.current = [top[0]!, top[1]!];
    setStartState(next);
  };

  /** Jump (for a reveal): no anchor to keep, the caller scrolls next. */
  const reset = (next: number) => {
    anchor.current = null;
    setStartState(next);
  };

  /** The first row actually under the viewport top, for sticky headers. */
  const topIndex = (fallback: number): number => {
    const id = listRef.current?.id;
    const top = id == null ? null : renderer.getListScrollTop?.(id);
    return top ? top[0]! : fallback;
  };

  return { listRef, start, onVisibleRange, reset, topIndex };
}
