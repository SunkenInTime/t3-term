// apps/web/src/components/RightPanelSheet.tsx: at or below a 980px window the right
// panel opens as a sheet over the chat (ui/sheet.tsx SheetPopup side="right")
// instead of beside it. A press outside it or Escape closes the panel.
import { useAtomValue } from "@effect/atom-react";
import * as DialogPrimitive from "@gpuix/react/dialog";
import type { ReactNode } from "react";

import { useTheme } from "../ui/theme.ts";
import { viewportWidthAtom } from "../ui/viewport.tsx";

/**
 * `w-[min(42vw,28rem)] min-w-80 max-w-[28rem]`, and below 760
 * `w-[min(88vw,24rem)] min-w-0`.
 */
export function rightPanelSheetWidth(viewportWidth: number): number {
  if (viewportWidth < 760) return Math.min(viewportWidth * 0.88, 384);
  return Math.min(448, Math.max(320, Math.min(viewportWidth * 0.42, 448)));
}

export function RightPanelSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const viewportWidth = useAtomValue(viewportWidthAtom);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "stretch" }}>
        {/* Web's right-panel sheet mounts no SheetBackdrop (the chat stays undimmed); a
            press outside still closes it, as a modal sheet does. */}
        <DialogPrimitive.Backdrop style={{ backgroundColor: "#00000000", pointerEvents: "auto" }} />
        <DialogPrimitive.Popup
          testId="right-panel-sheet"
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            width: Math.floor(rightPanelSheetWidth(viewportWidth)),
            height: "100%",
            backgroundColor: theme.popover,
            borderLeftWidth: 1,
            borderColor: theme.border,
          }}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
