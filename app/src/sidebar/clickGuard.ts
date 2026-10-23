// GPUI delivers a click to every hovered hitbox, so a button inside a row also
// clicks the row. Inner controls claim the click on mouse down (always before
// the click, whatever order the click listeners run in); the row skips it.
let claimedAt = Number.NEGATIVE_INFINITY;

export function claimClick(): void {
  claimedAt = performance.now();
}

/** True once for a click an inner control claimed. A stale claim (drag-off) expires. */
export function consumeClaimedClick(): boolean {
  const claimed = performance.now() - claimedAt < 3_000;
  claimedAt = Number.NEGATIVE_INFINITY;
  return claimed;
}
