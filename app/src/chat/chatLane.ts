import { LAYOUT } from "../ui/theme.ts";

/**
 * The centered chat column, narrowed so it clears the floating details card
 * (web: DETAILS_CARD_CLEARANCE 32). The timeline and the composer overlay both
 * use it so their edges line up.
 */
export function resolveChatLane(width: number, detailsCardOpen: boolean) {
  const padding = LAYOUT.chatLanePadding;
  const laneRight = detailsCardOpen ? width - 12 - LAYOUT.detailsCardWidth - 32 : width - padding;
  const laneWidth = Math.max(0, Math.min(LAYOUT.chatMaxWidth, width - padding * 2, laneRight - padding));
  const left = Math.max(padding, Math.min((width - laneWidth) / 2, laneRight - laneWidth));
  return { left: Math.round(left), width: Math.round(laneWidth) };
}
