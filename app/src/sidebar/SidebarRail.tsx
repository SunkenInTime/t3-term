// apps/web/src/components/ui/sidebar.tsx SidebarRail, as AppSidebarLayout
// configures it: a 16px grab strip centred on the docked sidebar's right edge.
// Dragging resizes the sidebar between 13rem and the window less a 40rem main
// column; release persists the width; double-click forgets it. Below `md` the
// sidebar is a sheet and web resolves `resizable` to null, so there is no rail.
//
// It lives in the shell after the main view: gpuix paints in tree order, and
// the strip's right half sits over the main column (web lifts it with z-20).
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { Tooltip } from "../ui/overlay.tsx";
import { useTheme } from "../ui/theme.ts";
import {
  THREAD_SIDEBAR_MINIMUM_WIDTH,
  sidebarDragWidthAtom,
  sidebarWidthAtom,
  storedSidebarWidthAtom,
  threadSidebarMaximumWidth,
  viewportWidthAtom,
} from "../ui/viewport.tsx";
import { THREAD_MAIN_CONTENT_MIN_WIDTH, clampThreadSidebarWidth } from "../web/components/threadSidebarWidth.ts";

const RAIL_WIDTH = 16;
const DOUBLE_CLICK_MS = 500;

export function SidebarRail() {
  const theme = useTheme();
  const width = useAtomValue(sidebarWidthAtom);
  const [hovered, setHovered] = useState(false);
  const lastClickAt = useRef(0);
  const drag = useRef<{ startX: number; startWidth: number; width: number; moved: boolean } | null>(null);

  const finish = () => {
    const state = drag.current;
    drag.current = null;
    if (state === null) return;
    appAtomRegistry.set(sidebarDragWidthAtom, null);
    // useResizeDrag commits only a real move; a press alone leaves the stored width.
    if (state.moved) appAtomRegistry.set(storedSidebarWidthAtom, state.width);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: width - RAIL_WIDTH / 2,
        width: RAIL_WIDTH,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Tooltip content="Drag to resize sidebar" side="right" rootStyle={{ flexGrow: 1, flexDirection: "column", alignItems: "stretch" }}>
        <div
          testId="sidebar-rail"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onMouseDown={(event) => {
            if ((event.button ?? 0) !== 0) return;
            drag.current = { startX: event.x ?? 0, startWidth: width, width, moved: false };
          }}
          onMouseMove={(event) => {
            const state = drag.current;
            if (state === null) return;
            if (event.pressedButton === undefined || event.pressedButton === null) {
              // The release landed outside the window.
              finish();
              return;
            }
            const delta = (event.x ?? 0) - state.startX;
            if (Math.abs(delta) > 2) state.moved = true;
            const viewportWidth = appAtomRegistry.get(viewportWidthAtom);
            const next = clampThreadSidebarWidth(
              state.startWidth + delta,
              THREAD_SIDEBAR_MINIMUM_WIDTH,
              threadSidebarMaximumWidth(viewportWidth),
            );
            // AppSidebarLayout's shouldAcceptWidth: shrinking always, growing only
            // while the main column keeps 40rem.
            if (next <= state.width || viewportWidth - next >= THREAD_MAIN_CONTENT_MIN_WIDTH) {
              state.width = next;
              appAtomRegistry.set(sidebarDragWidthAtom, next);
            }
          }}
          onMouseUp={finish}
          onClick={(event) => {
            // Synthetic (automation) clicks always report clickCount 1; time them too.
            const now = Date.now();
            const double = (event.clickCount ?? 1) === 2 || now - lastClickAt.current < DOUBLE_CLICK_MS;
            lastClickAt.current = double ? 0 : now;
            if (double) appAtomRegistry.set(storedSidebarWidthAtom, null);
          }}
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "center",
            flexGrow: 1,
            width: RAIL_WIDTH,
            cursor: "w-resize",
          }}
        >
          {/* after:w-[2px] hover:after:bg-sidebar-border, centred on the edge. */}
          <div
            style={{
              width: 2,
              height: "100%",
              pointerEvents: "none",
              backgroundColor: hovered || drag.current !== null ? theme.sidebar.border : "#00000000",
            }}
          />
        </div>
      </Tooltip>
    </div>
  );
}
