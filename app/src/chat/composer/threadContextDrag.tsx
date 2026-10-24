// Dragging a sidebar thread onto the composer: web's threadContextDrag.ts and
// ThreadContextDragGhost.tsx. The sidebar's row gesture (sidebar/useSidebarThreadDrag.ts)
// owns the pointer; once it leaves the thread list sideways the drag becomes a context drag
// (web Sidebar moveThreadContextDrag): the ghost follows the pointer and the composer under
// it lights up. Dropping adds the thread's chip to the end of that composer's prompt and its
// record to the draft (web addComposerDraftThreadContexts); the send attaches it.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerAtPoint, mentionDragOverAtom } from "../../panels/files/fileTreeActions.ts";
import { addComposerThreadContext } from "../../state/composer.ts";
import { Icon } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { threadContextRecord } from "../../web/lib/composerContextRecords.ts";

export interface ThreadContextDragSource {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
}

interface ThreadContextDrag extends ThreadContextDragSource {
  readonly x: number;
  readonly y: number;
}

/** The context drag in progress, or null. */
const threadContextDragAtom = Atom.make<ThreadContextDrag | null>(null).pipe(Atom.keepAlive);

/** web moveThreadContextDrag: the ghost follows the pointer and the composer under it lights. */
export function moveThreadContextDrag(point: { readonly x: number; readonly y: number }, source: ThreadContextDragSource): void {
  appAtomRegistry.set(threadContextDragAtom, { ...source, x: point.x, y: point.y });
  const over = composerAtPoint(point.x, point.y);
  if (appAtomRegistry.get(mentionDragOverAtom) !== over) appAtomRegistry.set(mentionDragOverAtom, over);
}

/** web endThreadContextDrag: back inside the list, or the drag ended. */
export function endThreadContextDrag(): void {
  if (appAtomRegistry.get(threadContextDragAtom) !== null) appAtomRegistry.set(threadContextDragAtom, null);
  if (appAtomRegistry.get(mentionDragOverAtom) !== null) appAtomRegistry.set(mentionDragOverAtom, null);
}

/** web dropThreadContext: the composer under the release takes the thread. True when one did. */
export function dropThreadContext(point: { readonly x: number; readonly y: number }, source: ThreadContextDragSource): boolean {
  endThreadContextDrag();
  const target = composerAtPoint(point.x, point.y);
  if (target === null) return false;
  addComposerThreadContext(target, threadContextRecord({ environmentId: source.environmentId, threadId: source.threadId } as never, source.title));
  return true;
}

/** web ThreadContextDragGhost: pointer +12, rounded-lg, border, popover fill, shadow-lg. Mounted once. */
export function ThreadContextDragGhost() {
  const drag = useAtomValue(threadContextDragAtom);
  const theme = useTheme();
  if (drag === null) return null;
  return (
    <anchored position={{ x: drag.x + 12, y: drag.y + 12 }} anchor="topLeft" deferred priority={7} occlude={false} style={{ backgroundColor: "transparent" }}>
      <div
        testId="thread-context-drag-ghost"
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
        <text style={{ fontFamily: FONTS.sans, fontSize: 14, lineHeight: 20, color: theme.foreground, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
          {drag.title}
        </text>
      </div>
    </anchored>
  );
}
