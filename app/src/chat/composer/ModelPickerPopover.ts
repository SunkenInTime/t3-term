// Popover plumbing shared by the composer's model picker and traits menu.
import { useWindowSize } from "@gpuix/react";
import type { FloatingSide } from "@gpuix/react/floating";
import { useCallback, useRef, useState } from "react";

/**
 * Base UI opens composer popups below the trigger and flips them above when they do
 * not fit, which is the usual case for a composer pinned to the bottom of the window.
 * The trigger reports its window position through `onLayout`.
 */
export function usePopoverSide(popupHeight: number) {
  const { height: windowHeight } = useWindowSize();
  const [side, setSide] = useState<FloatingSide>("top");
  const onTriggerLayout = useCallback(
    (event: { y?: number; height?: number }) => {
      if (event.y === undefined || event.height === undefined || !windowHeight) return;
      const spaceBelow = windowHeight - (event.y + event.height);
      const spaceAbove = event.y;
      const next: FloatingSide = spaceBelow >= popupHeight + 12 || spaceBelow > spaceAbove ? "bottom" : "top";
      setSide((current) => (current === next ? current : next));
    },
    [popupHeight, windowHeight],
  );
  return { side, onTriggerLayout };
}

/**
 * A press on the trigger of an open popover first lands as a press outside it, which
 * closes it; the click that follows would reopen it. Base UI treats that press as a
 * toggle, so the click right after an outside close is dropped.
 */
export function useReopenGuard(onOpenChange: (open: boolean) => void) {
  const closedAt = useRef(0);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closedAt.current = Date.now();
      onOpenChange(open);
    },
    [onOpenChange],
  );
  const toggle = useCallback(
    (open: boolean) => {
      if (!open && Date.now() - closedAt.current < 300) return;
      handleOpenChange(!open);
    },
    [handleOpenChange],
  );
  return { onOpenChange: handleOpenChange, toggle };
}
