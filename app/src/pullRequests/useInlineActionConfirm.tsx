// Port of apps/web/src/components/pullRequest/useInlineActionConfirm.ts. The first press arms an
// action ("Confirm merge?"), the second carries it out; anything else in between disarms it: three
// seconds passing, Escape, or a press anywhere outside the armed control.
//
// Web compares DOM elements to tell two controls for the same action apart (the header's Merge
// and the menu's Merge now). gpuix has no element identity to compare, so callers name the
// control with `slot` instead.
import { DismissableLayer } from "@gpuix/react";
import { useEffect, useState, type ReactNode } from "react";

interface Armed {
  readonly scopeKey: string;
  readonly action: string;
  readonly slot: string;
}

export function useInlineActionConfirm(scopeKey: string) {
  const [armed, setArmed] = useState<Armed | null>(null);
  const active = armed?.scopeKey === scopeKey ? armed : null;
  if (armed !== null && armed.scopeKey !== scopeKey) setArmed(null);

  useEffect(() => {
    if (active === null) return;
    const timeout = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(timeout);
  }, [active]);

  const disarm = () => setArmed(null);
  return {
    isArmed: (action: string, slot = action) => active?.action === action && active.slot === slot,
    /** Spread onto the control's root div. */
    props: (action: string, onConfirm: () => void, slot = action) => ({
      onClick: () => {
        if (active?.action === action && active.slot === slot) {
          setArmed(null);
          onConfirm();
        } else {
          setArmed({ scopeKey, action, slot });
        }
      },
      onMouseDownOutside: () => {
        if (active?.action === action && active.slot === slot) setArmed(null);
      },
    }),
    /** Render once beside the controls: while armed, Escape disarms before it closes anything. */
    escapeLayer: (active === null ? null : (
      <DismissableLayer onEscapeKeyDown={disarm}>{null}</DismissableLayer>
    )) as ReactNode,
  };
}
