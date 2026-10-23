import { useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";

import { detailsPresentationAtom } from "../state/git.ts";
import { detailsPanelOpenAtom } from "../state/ui.ts";
import { LAYOUT } from "../ui/theme.ts";

const CARD_GAP = 12;
// web chatCanvasLayout.ts DETAILS_CARD_CLEARANCE
const DETAILS_CARD_CLEARANCE = 32;

/** True while the details card floats inline over the canvas (not as a header popover). */
export function useDetailsCardInline(): boolean {
  const open = useAtomValue(detailsPanelOpenAtom);
  const presentation = useAtomValue(detailsPresentationAtom);
  return open && presentation === "inline";
}

/**
 * The centered chat column (web chatCanvasLayout.ts resolveChatCanvasLayout):
 * at most 736 wide, 48 from each edge, centered, but its right edge stays 32
 * clear of the inline details card.
 *
 * Done with flex rather than a measured width so it follows the canvas in the
 * same frame: both spacers grow equally (centering), the right one cannot go
 * below the card's clearance, and the lane shrinks once the spacers hit their
 * minimums. That reproduces web's `min(centered, laneRight - width)`.
 * The timeline rows and the composer overlay both use it so their edges line up.
 */
export function ChatLane({ cardInline, children }: { cardInline: boolean; children: ReactNode }) {
  const padding = LAYOUT.chatLanePadding;
  const rightMin = cardInline ? CARD_GAP + LAYOUT.detailsCardWidth + DETAILS_CARD_CLEARANCE : padding;
  return (
    <div style={{ display: "flex", flexDirection: "row", width: "100%" }}>
      <div style={{ flexGrow: 1, flexShrink: 0, flexBasis: 0, minWidth: padding }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 0,
          flexShrink: 1,
          flexBasis: LAYOUT.chatMaxWidth,
          maxWidth: LAYOUT.chatMaxWidth,
          minWidth: 0,
        }}
      >
        {children}
      </div>
      <div style={{ flexGrow: 1, flexShrink: 0, flexBasis: 0, minWidth: rightMin }} />
    </div>
  );
}
