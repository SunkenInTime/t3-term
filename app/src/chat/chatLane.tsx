import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import type { ReactNode } from "react";

import { detailsPresentationAtom } from "../state/git.ts";
import { detailsPanelOpenAtom } from "../state/ui.ts";
import { LAYOUT } from "../ui/theme.ts";
import { chatLanePadding, useSmallViewport } from "../ui/viewport.tsx";

const CARD_GAP = 12;
// web chatCanvasLayout.ts DETAILS_CARD_CLEARANCE
const DETAILS_CARD_CLEARANCE = 32;
// web chatCanvasLayout.ts GAP and minChatWidth (min-w-[40rem])
const MINI_PLAYER_GAP = 12;
const MIN_CHAT_WIDTH = 640;

/**
 * The browser mini player floating over the chat canvas: its left edge and the
 * canvas width, in canvas pixels. The player (panels/browser/ThreadPreviewHost)
 * publishes it so the lane can make room, like web's chatBeside.
 */
export const chatLaneMiniPlayerAtom = Atom.make<{ readonly left: number; readonly canvasWidth: number } | null>(null).pipe(
  Atom.keepAlive,
);

/** True while the details card floats inline over the canvas (not as a header popover). */
export function useDetailsCardInline(): boolean {
  const open = useAtomValue(detailsPanelOpenAtom);
  const presentation = useAtomValue(detailsPresentationAtom);
  return open && presentation === "inline";
}

/**
 * The centered chat column (web chatCanvasLayout.ts resolveChatCanvasLayout):
 * at most 736 wide, 48 from each edge (12 below `sm`), centered, but its right edge stays 32
 * clear of the inline details card.
 *
 * Done with flex rather than a measured width so it follows the canvas in the
 * same frame: both spacers grow equally (centering), the right one cannot go
 * below the card's clearance, and the lane shrinks once the spacers hit their
 * minimums. That reproduces web's `min(centered, laneRight - width)`.
 * The timeline rows and the composer overlay both use it so their edges line up.
 */
export function ChatLane({ cardInline, children }: { cardInline: boolean; children: ReactNode }) {
  // 12px a side below `sm`, 48 from it (index.css .chat-composer-lane).
  const padding = chatLanePadding(useSmallViewport());
  const player = useAtomValue(chatLaneMiniPlayerAtom);
  let rightMin = cardInline ? CARD_GAP + LAYOUT.detailsCardWidth + DETAILS_CARD_CLEARANCE : padding;
  // web chatBeside: the lane ends 12px left of the mini player while that still
  // leaves a 640px lane; otherwise the lane keeps its place and web moves the player.
  if (player) {
    const besideWidth = Math.min(LAYOUT.chatMaxWidth, player.left - MINI_PLAYER_GAP - padding);
    if (besideWidth >= MIN_CHAT_WIDTH) rightMin = Math.max(rightMin, player.canvasWidth - player.left + MINI_PLAYER_GAP);
  }
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
