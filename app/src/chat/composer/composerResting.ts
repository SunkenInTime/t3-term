// The resting (collapsed) composer, after apps/web's useComposerFocusState +
// composerScrollGesture: scrolling the timeline away from its end collapses the composer
// of an existing thread to one row with its controls in the strip below; reaching the end
// again, clicking it or typing restores it.
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../runtime/runtime.ts";

export const composerRestingAtom = Atom.family((_draftKey: string) => Atom.make(false).pipe(Atom.keepAlive));

const COLLAPSE_THRESHOLD_PX = 24;
const GESTURE_RESET_MS = 120;
let gesture = { accumulated: 0, lastAt: 0 };

/**
 * Feed timeline wheel deltas here (negative = towards older messages). `atEnd` is whether the
 * timeline currently shows its last row.
 */
export function reportTimelineWheel(draftKey: string, deltaY: number, atEnd: boolean): void {
  const now = Date.now();
  if (now - gesture.lastAt > GESTURE_RESET_MS) gesture = { accumulated: 0, lastAt: now };
  gesture.lastAt = now;
  if (deltaY > 0 && atEnd) {
    appAtomRegistry.set(composerRestingAtom(draftKey), false);
    return;
  }
  if (deltaY < 0) {
    gesture.accumulated += -deltaY;
    if (gesture.accumulated >= COLLAPSE_THRESHOLD_PX) {
      appAtomRegistry.set(composerRestingAtom(draftKey), true);
    }
  }
}

export function restoreComposerFromResting(draftKey: string): void {
  appAtomRegistry.set(composerRestingAtom(draftKey), false);
}
