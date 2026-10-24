// web markdownFindContext's findRevealRef: find opens folded or clipped text
// that holds the selected match, like the browser's `beforematch`. web keeps a
// folded body mounted (hidden) while find is open and reveals it when the
// match lands inside; gpuix has no hidden-but-laid-out text, so a fold whose
// whole body is hidden opens as soon as its entry holds the active match, and
// a long message clipped to 176px opens when the located match lies below the
// clip.
import type { GpuixRenderer } from "@gpuix/native";
import { useEffect, useRef } from "react";

interface Fold {
  readonly kind: "hidden" | "clipped";
  readonly reveal: () => void;
  /** The clip box's element id, for a clipped fold. */
  readonly clipId?: () => number | null;
}

const folds = new Map<string, Set<Fold>>();

function renderer(): GpuixRenderer | null {
  const slot = Reflect.get(globalThis, "__gpuixRenderHost") as { renderer?: GpuixRenderer } | undefined;
  return slot?.renderer ?? null;
}

/**
 * Opens the entry's folds of one kind that hide the match. For "clipped",
 * `matchBottom` is the match line's bottom in window coordinates: only a clip
 * that ends above it opens. Returns whether anything opened.
 */
export function revealFindFolds(entryId: string, kind: Fold["kind"], matchBottom?: number): boolean {
  let opened = false;
  for (const fold of folds.get(entryId) ?? []) {
    if (fold.kind !== kind) continue;
    if (kind === "clipped") {
      const id = fold.clipId?.();
      const bounds = id == null ? null : renderer()?.getElementBounds?.(id);
      if (!bounds || matchBottom === undefined || matchBottom <= bounds.y + bounds.height) continue;
    }
    fold.reveal();
    opened = true;
  }
  return opened;
}

/** Registers a fold while it hides content (`active`); `reveal` opens it. */
export function useFindFold(entryId: string | null, kind: Fold["kind"], active: boolean, reveal: () => void, clipId?: () => number | null) {
  const latest = useRef({ reveal, clipId });
  latest.current = { reveal, clipId };
  useEffect(() => {
    if (!entryId || !active) return;
    const fold: Fold = {
      kind,
      reveal: () => latest.current.reveal(),
      clipId: () => latest.current.clipId?.() ?? null,
    };
    let set = folds.get(entryId);
    if (!set) {
      set = new Set();
      folds.set(entryId, set);
    }
    set.add(fold);
    return () => {
      set.delete(fold);
      if (set.size === 0) folds.delete(entryId);
    };
  }, [entryId, kind, active]);
}
