// Pure parts of apps/web/src/lib/selectionActions.ts. observeSelectionActions
// listens to DOM pointer, key, focus and scroll events; terminal/TerminalView.tsx
// reproduces its gesture rules with gpuix element events instead.
export type SelectionActionPoint = { x: number; y: number };

export const SELECTION_MULTI_CLICK_INTERVAL_MS = 500;

export function resolveSelectionActionPosition(options: {
  bounds: { left: number; top: number; width: number; height: number };
  selectionRect: { right: number; bottom: number } | null;
  pointer: SelectionActionPoint | null;
  viewport: { width: number; height: number };
}): SelectionActionPoint {
  const { bounds, selectionRect, pointer, viewport } = options;
  const preferred = pointer ?? {
    x: selectionRect?.right ?? bounds.left + bounds.width - 140,
    y: selectionRect ? selectionRect.bottom + 4 : bounds.top + 12,
  };
  return {
    x: Math.max(
      8,
      Math.min(Math.max(bounds.left, preferred.x), bounds.left + bounds.width, viewport.width - 8),
    ),
    y: Math.max(
      8,
      Math.min(Math.max(bounds.top, preferred.y), bounds.top + bounds.height, viewport.height - 8),
    ),
  };
}

type SelectionRect = { left: number; top: number; right: number; bottom: number };

export function isSelectionRectVisible(rect: SelectionRect, clips: readonly SelectionRect[]) {
  let { left, top, right, bottom } = rect;
  for (const clip of clips) {
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  return right > left && bottom > top;
}
