// The resting (collapsed) composer, after apps/web's useComposerFocusState +
// composerScrollGesture: scrolling the timeline back from its end collapses the composer
// of an existing thread to one row with its controls in the strip below; scrolling back to
// the end, clicking the composer or typing restores it.
//
// The timeline is another module, so ChatView feeds wheel deltas here from the chat canvas.
// gpuix reports the delta, not the list's offset, so "at the end" is the net distance
// scrolled since the composer last expanded returning to zero.
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../runtime/runtime.ts";

export const composerRestingAtom = Atom.family((_draftKey: string) => Atom.make(false).pipe(Atom.keepAlive));

/** web COMPOSER_SCROLL_COLLAPSE_THRESHOLD_PX */
const COLLAPSE_THRESHOLD_PX = 24;
const netScrolledUpByKey = new Map<string, number>();

/**
 * `deltaY` as gpuix reports wheel input on the chat canvas: positive moves the content down,
 * i.e. scrolls back towards older messages.
 */
export function reportTimelineWheel(draftKey: string, deltaY: number): void {
  if (!Number.isFinite(deltaY) || deltaY === 0) return;
  const net = Math.max(0, (netScrolledUpByKey.get(draftKey) ?? 0) + deltaY);
  netScrolledUpByKey.set(draftKey, net);
  const resting = appAtomRegistry.get(composerRestingAtom(draftKey));
  if (!resting && net >= COLLAPSE_THRESHOLD_PX) {
    appAtomRegistry.set(composerRestingAtom(draftKey), true);
  } else if (resting && net === 0) {
    appAtomRegistry.set(composerRestingAtom(draftKey), false);
  }
}

export function restoreComposerFromResting(draftKey: string): void {
  netScrolledUpByKey.set(draftKey, 0);
  appAtomRegistry.set(composerRestingAtom(draftKey), false);
}
