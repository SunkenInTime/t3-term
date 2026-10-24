// Dragging a sidebar thread onto the composer: web's threadContextDrag.ts and
// ThreadContextDragGhost.tsx. Dropping it adds the thread's chip to the end of the prompt and
// its record to the draft (web addComposerDraftThreadContexts), and the send attaches it.
//
// gpuix has no drag and drop between elements. An element that has both onMouseDown and
// onMouseMove when pressed captures the pointer and starves its child buttons of clicks, so
// the row takes onMouseMove only once pressed (no capture; moves reach it while the pointer
// is over it) and watches the pointer pass the threshold. From there a window-filling layer
// follows the pointer, paints the ghost, lights the composer under it and takes the release.
import { useAtomValue } from "@effect/atom-react";
import type { EventPayload } from "@gpuix/react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerAtPoint, mentionDragOverAtom } from "../../panels/files/fileTreeActions.ts";
import { addComposerThreadContext } from "../../state/composer.ts";
import { Icon } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { threadContextRecord } from "../../web/lib/composerContextRecords.ts";

const DRAG_DISTANCE = 4;

interface ThreadDragSource {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
}

interface ThreadDrag extends ThreadDragSource {
  readonly x: number;
  readonly y: number;
}

/** The drag in progress, or null. */
export const threadContextDragAtom = Atom.make<ThreadDrag | null>(null).pipe(Atom.keepAlive);

let press: (ThreadDragSource & { readonly x: number; readonly y: number }) | null = null;

/** Handlers for a thread row; `onMouseMove` is undefined until the row is pressed. */
export function useThreadDrag(source: ThreadDragSource) {
  const [pressed, setPressed] = useState(false);
  return {
    onMouseDown: (event: EventPayload) => {
      if ((event.button ?? 0) !== 0) return;
      press = { ...source, x: Number(event.x ?? 0), y: Number(event.y ?? 0) };
      setPressed(true);
    },
    onMouseMove: !pressed
      ? undefined
      : (event: EventPayload) => {
      if (!press || press.threadId !== source.threadId || event.pressedButton !== 0) {
        if (event.pressedButton !== 0) press = null;
        setPressed(false);
        return;
      }
      const x = Number(event.x ?? 0);
      const y = Number(event.y ?? 0);
      if (Math.hypot(x - press.x, y - press.y) < DRAG_DISTANCE) return;
      const { x: _x, y: _y, ...rest } = press;
      press = null;
      // The press also began a text selection in the row; a drag is not one.
      (Reflect.get(globalThis, "__gpuixRenderHost") as { renderer?: { clearSelection?: () => void } } | undefined)?.renderer?.clearSelection?.();
      setPressed(false);
      appAtomRegistry.set(threadContextDragAtom, { ...rest, x, y });
    },
    onMouseLeave: () => {
      if (pressed && press?.threadId !== source.threadId) setPressed(false);
    },
  };
}

function endDrag() {
  appAtomRegistry.set(threadContextDragAtom, null);
  if (appAtomRegistry.get(mentionDragOverAtom) !== null) appAtomRegistry.set(mentionDragOverAtom, null);
}

/** web dropThreadContext: the composer under the release takes the thread. */
function drop(drag: ThreadDrag, x: number, y: number) {
  endDrag();
  const target = composerAtPoint(x, y);
  if (target === null) return;
  addComposerThreadContext(target, threadContextRecord({ environmentId: drag.environmentId, threadId: drag.threadId } as never, drag.title));
}

/** Mounted once (by the composer): the pointer layer and the ghost while a thread is dragged. */
export function ThreadContextDragLayer() {
  const drag = useAtomValue(threadContextDragAtom);
  const theme = useTheme();
  if (drag === null) return null;
  return (
    <>
      <anchored fill="window" deferred priority={6} style={{ backgroundColor: "transparent" }}>
        <div
          testId="thread-drag-layer"
          onMouseMove={(event) => {
            const x = Number(event.x ?? 0);
            const y = Number(event.y ?? 0);
            if (event.pressedButton !== 0) {
              drop(drag, x, y);
              return;
            }
            appAtomRegistry.set(threadContextDragAtom, { ...drag, x, y });
            const over = composerAtPoint(x, y);
            if (appAtomRegistry.get(mentionDragOverAtom) !== over) appAtomRegistry.set(mentionDragOverAtom, over);
          }}
          onMouseUp={(event) => drop(drag, Number(event.x ?? 0), Number(event.y ?? 0))}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "auto", cursor: "grabbing" }}
        />
      </anchored>
      {/* web ThreadContextDragGhost: pointer +12, rounded-lg, border, popover fill, shadow-lg. */}
      <anchored position={{ x: drag.x + 12, y: drag.y + 12 }} anchor="topLeft" deferred priority={7} occlude={false} style={{ backgroundColor: "transparent" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            maxWidth: 288,
            height: 38,
            paddingLeft: 12,
            paddingRight: 12,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha("#ffffff", 0.06),
            backgroundColor: theme.appearance === "dark" ? "#111111" : "#ffffff",
            boxShadow: [
              { offsetX: 0, offsetY: 10, blurRadius: 8, spreadRadius: -3, color: "#0000001a" },
              { offsetX: 0, offsetY: 4, blurRadius: 3, spreadRadius: -4, color: "#0000001a" },
            ],
            pointerEvents: "none",
          }}
        >
          <Icon name="messages-square" size={16} color={theme.mutedForeground} />
          <text
            style={{
              fontFamily: FONTS.sans,
              fontSize: 14,
              lineHeight: 20,
              color: theme.foreground,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {drag.title}
          </text>
        </div>
      </anchored>
    </>
  );
}
