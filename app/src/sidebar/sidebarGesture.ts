// The thread rows' pointer gestures: click, drag to move a row between
// sections (apps/web/src/components/Sidebar.pointer.ts SidebarPointerSensor
// under dnd-kit), and the action sweep (press a row's Settle / Un-settle /
// Wake button and drag across rows to apply it to all of them).
//
// gpuix gives a row the pointer only by capturing it: an element with
// onMouseDown + onMouseMove keeps receiving moves and the release wherever the
// pointer goes. A captured press also swallows the release of every control
// inside the row, so their onClick never fires. Those controls instead claim
// the press on mouse down (claimRowPress); the row runs the claimed action on
// its own click if the press never became a drag, which keeps click-on-release
// semantics and lets a press on Settle start a sweep.
import type { SidebarSweepAction } from "./SidebarThreadRow.tsx";

/** Sidebar.tsx SIDEBAR_DRAG_DISTANCE: the pointer travels this far before a press drags. */
export const SIDEBAR_DRAG_DISTANCE = 6;

export interface SidebarGesturePoint {
  readonly x: number;
  readonly y: number;
}

/** The sidebar implements the drag and the sweep; rows only report the pointer. */
export interface SidebarGestureHost {
  /** False when the row cannot move (no reorder capability, renaming, a drop still landing…). */
  startDrag(threadKey: string, origin: SidebarGesturePoint, point: SidebarGesturePoint): boolean;
  moveDrag(point: SidebarGesturePoint): void;
  endDrag(point: SidebarGesturePoint | null): void;
  startSweep(threadKey: string, action: SidebarSweepAction): void;
  moveSweep(point: SidebarGesturePoint): void;
  endSweep(commit: boolean): void;
}

let host: SidebarGestureHost | null = null;

export function setSidebarGestureHost(next: SidebarGestureHost | null): void {
  if (host !== null && next !== host) cancelSidebarGesture();
  host = next;
}

interface Claim {
  readonly run: () => void;
  readonly sweep: SidebarSweepAction | null;
  readonly at: number;
}

interface Press {
  readonly threadKey: string;
  readonly origin: SidebarGesturePoint;
  readonly claim: Claim | null;
  phase: "pending" | "dragging" | "sweeping" | "cancelled";
  last: SidebarGesturePoint;
}

let pendingClaim: Claim | null = null;
let press: Press | null = null;
/** How the last press ended, for the row's click that follows its release. */
let lastOutcome: { readonly threadKey: string; readonly moved: boolean; readonly claim: Claim | null } | null = null;

/**
 * A control inside a row takes the press (call from its onMouseDown). `run`
 * fires on release if the pointer never left the press; a `sweep` action
 * turns a drag from this control into a sweep.
 */
export function claimRowPress(run: () => void, sweep: SidebarSweepAction | null = null): void {
  pendingClaim = { run, sweep, at: performance.now() };
}

export function rowMouseDown(threadKey: string, event: { x?: number; y?: number; button?: number }): void {
  // A control's claim lands just before its row's press; anything older is stale.
  const claim = pendingClaim !== null && performance.now() - pendingClaim.at < 1_000 ? pendingClaim : null;
  pendingClaim = null;
  if ((event.button ?? 0) !== 0) {
    press = null;
    return;
  }
  lastOutcome = null;
  const origin = { x: event.x ?? 0, y: event.y ?? 0 };
  press = { threadKey, origin, claim, phase: "pending", last: origin };
}

export function rowMouseMove(event: { x?: number; y?: number; pressedButton?: number | null }): void {
  const current = press;
  if (current === null || current.phase === "cancelled") return;
  const point = { x: event.x ?? 0, y: event.y ?? 0 };
  current.last = point;
  // Desktop can report no button on the last move before the release, and a
  // release outside the window never arrives: either way the press is over.
  if (event.pressedButton === undefined || event.pressedButton === null) {
    finish(point, current.phase === "dragging");
    return;
  }
  if (current.phase === "pending") {
    if (Math.hypot(point.x - current.origin.x, point.y - current.origin.y) <= SIDEBAR_DRAG_DISTANCE) return;
    if (current.claim?.sweep) {
      current.phase = "sweeping";
      host?.startSweep(current.threadKey, current.claim.sweep);
    } else if (host?.startDrag(current.threadKey, current.origin, point)) {
      current.phase = "dragging";
    } else {
      // A row that cannot move: the press is spent and its release clicks nothing.
      current.phase = "cancelled";
      lastOutcome = { threadKey: current.threadKey, moved: true, claim: null };
      return;
    }
  }
  if (current.phase === "dragging") host?.moveDrag(point);
  else if (current.phase === "sweeping") host?.moveSweep(point);
}

export function rowMouseUp(event: { x?: number; y?: number }): void {
  if (press === null) return;
  finish({ x: event.x ?? 0, y: event.y ?? 0 }, true);
}

function finish(point: SidebarGesturePoint, commit: boolean): void {
  const current = press;
  press = null;
  if (current === null) return;
  const moved = current.phase !== "pending";
  if (current.phase === "dragging") host?.endDrag(commit ? point : null);
  else if (current.phase === "sweeping") host?.endSweep(commit);
  if (current.phase !== "cancelled") lastOutcome = { threadKey: current.threadKey, moved, claim: current.claim };
}

/** Escape, an unmount, or the row leaving the list: drop the gesture without applying it. */
export function cancelSidebarGesture(): void {
  const current = press;
  press = null;
  if (current === null) return;
  if (current.phase === "dragging") host?.endDrag(null);
  else if (current.phase === "sweeping") host?.endSweep(false);
  lastOutcome = { threadKey: current.threadKey, moved: true, claim: null };
}

export function isSidebarGestureActive(): boolean {
  return press !== null && (press.phase === "dragging" || press.phase === "sweeping");
}

/**
 * Called from the row's onClick. "claimed" ran a control's action; "moved"
 * means the press became a drag or sweep (web suppresses that click); "row"
 * is a plain click on the row.
 */
export function consumeRowClick(threadKey: string): "claimed" | "moved" | "row" {
  // The click can arrive before the row's own mouse-up listener.
  if (press !== null && press.threadKey === threadKey) finish(press.last, true);
  const outcome = lastOutcome;
  lastOutcome = null;
  if (outcome === null || outcome.threadKey !== threadKey) return "row";
  if (outcome.moved) return "moved";
  if (outcome.claim !== null) {
    outcome.claim.run();
    return "claimed";
  }
  return "row";
}
