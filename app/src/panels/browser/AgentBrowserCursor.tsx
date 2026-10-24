// Port of AgentCursorMark in apps/web/src/components/preview/AgentBrowserCursor.tsx:
// the agent's pointer over a server browser page, dimmed 700 ms after its last event.
//
// web's AgentBrowserCursor wrapper reads browserPointerStore, which only the
// Electron desktop bridge feeds. t3-term has no desktop tabs; server tabs get
// their pointer from the preview stream (ServerBrowserSurface), as web's do.
//
// Differences forced by gpuix: no transforms, so the mark is placed with
// left/top; no transitions, so opacity flips in one repaint; no keyframes, so
// the click ping (web: a 2 s infinite burst that is visible for its first
// 0.8 s) is a static ring shown while the mark is active. The lucide icon is
// monochrome here, so web's `fill-background text-primary` is two layers.
import { useEffect, useState } from "react";

import {
  agentBrowserCursorOpacity,
  type BrowserController,
} from "../../web/components/preview/agentBrowserCursorLogic.ts";
import { Icon } from "../../ui/Icon.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";

const CURSOR_ACTIVE_MS = 700;

/** lucide mouse-pointer-2's outline as a filled shape, for the background fill under the stroke. */
const POINTER_FILL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#000" stroke="none"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" /></svg>';

export function AgentCursorMark(props: {
  readonly phase: "move" | "click";
  readonly sequence: number;
  readonly left: number;
  readonly top: number;
  readonly controller: BrowserController;
}) {
  const { phase, sequence, left, top, controller } = props;
  const theme = useTheme();
  const [inactiveSequence, setInactiveSequence] = useState<number | null>(null);
  const active = inactiveSequence !== sequence;

  useEffect(() => {
    const timeout = setTimeout(() => setInactiveSequence(sequence), CURSOR_ACTIVE_MS);
    return () => clearTimeout(timeout);
  }, [sequence]);

  // web: the mark's origin is the hot spot; the size-5 icon is nudged -0.5/-0.5
  // and the size-4 ping sits at left-0.5/top-0.5. Here the box starts at the icon.
  return (
    <div
      style={{
        position: "absolute",
        left: left - 2,
        top: top - 2,
        width: 20,
        height: 20,
        opacity: agentBrowserCursorOpacity(active, controller),
        pointerEvents: "none",
      }}
    >
      {phase === "click" && active ? (
        <div
          style={{
            position: "absolute",
            left: 4,
            top: 4,
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: alpha(theme.primary, 0.25),
            pointerEvents: "none",
          }}
        />
      ) : null}
      <svg
        source={POINTER_FILL_SVG}
        style={{ position: "absolute", left: 0, top: 0, width: 20, height: 20, color: theme.background, pointerEvents: "none" }}
      />
      <div style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
        <Icon name="mouse-pointer-2" size={20} color={theme.primary} />
      </div>
    </div>
  );
}
