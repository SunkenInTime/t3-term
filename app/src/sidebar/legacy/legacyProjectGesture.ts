// Pointer gestures of the legacy tree's project rows: click to expand or
// collapse, and (with "Sort projects: Manual") drag to reorder, which web runs
// through dnd-kit's PointerSensor with a 6px activation distance.
//
// gpuix only follows a drag on an element that captures the pointer
// (onMouseDown + onMouseMove), and a captured press swallows the release of
// every control inside the row. The row's only control (new thread) sits in an
// absolutely positioned wrapper, which keeps its presses from reaching the row
// at all, so it takes a plain click.

/** PROJECT_POINTER_SENSOR_OPTIONS activationConstraint.distance. */
export const PROJECT_DRAG_DISTANCE = 6;

export interface LegacyGesturePoint {
  readonly x: number;
  readonly y: number;
}

export interface LegacyProjectGestureHost {
  /** False when projects cannot move (the sort order is not manual). */
  startDrag(projectKey: string, origin: LegacyGesturePoint, point: LegacyGesturePoint): boolean;
  moveDrag(point: LegacyGesturePoint): void;
  endDrag(point: LegacyGesturePoint | null): void;
}

let host: LegacyProjectGestureHost | null = null;

export function setLegacyProjectGestureHost(next: LegacyProjectGestureHost | null): void {
  if (host !== null && next !== host) cancelLegacyProjectGesture();
  host = next;
}

interface Press {
  readonly projectKey: string;
  readonly origin: LegacyGesturePoint;
  phase: "pending" | "static" | "dragging";
  last: LegacyGesturePoint;
}

let press: Press | null = null;
let lastOutcome: { readonly projectKey: string; readonly moved: boolean } | null = null;

export function projectMouseDown(projectKey: string, event: { x?: number; y?: number; button?: number }): void {
  if ((event.button ?? 0) !== 0) {
    press = null;
    return;
  }
  lastOutcome = null;
  const origin = { x: event.x ?? 0, y: event.y ?? 0 };
  press = { projectKey, origin, phase: "pending", last: origin };
}

export function projectMouseMove(event: { x?: number; y?: number; pressedButton?: number | null }): void {
  const current = press;
  if (current === null) return;
  const point = { x: event.x ?? 0, y: event.y ?? 0 };
  current.last = point;
  // No button on a move: the release happened outside the window.
  if (event.pressedButton === undefined || event.pressedButton === null) {
    finish(point, current.phase === "dragging");
    return;
  }
  if (current.phase === "pending") {
    if (Math.hypot(point.x - current.origin.x, point.y - current.origin.y) <= PROJECT_DRAG_DISTANCE) return;
    if (host?.startDrag(current.projectKey, current.origin, point)) {
      current.phase = "dragging";
    } else {
      // Not draggable: the press stays a click, as web's button would.
      current.phase = "static";
      return;
    }
  }
  if (current.phase === "dragging") host?.moveDrag(point);
}

export function projectMouseUp(event: { x?: number; y?: number }): void {
  if (press === null) return;
  finish({ x: event.x ?? 0, y: event.y ?? 0 }, true);
}

function finish(point: LegacyGesturePoint, commit: boolean): void {
  const current = press;
  press = null;
  if (current === null) return;
  const moved = current.phase === "dragging";
  if (moved) host?.endDrag(commit ? point : null);
  lastOutcome = { projectKey: current.projectKey, moved };
}

export function cancelLegacyProjectGesture(): void {
  const current = press;
  press = null;
  if (current === null) return;
  if (current.phase === "dragging") host?.endDrag(null);
  lastOutcome = { projectKey: current.projectKey, moved: true };
}

/**
 * From the row's onClick: false after a drag (handleProjectButtonClick
 * suppresses the click that ends one), true for a click.
 */
export function consumeProjectClick(projectKey: string): boolean {
  if (press !== null && press.projectKey === projectKey) finish(press.last, true);
  const outcome = lastOutcome;
  lastOutcome = null;
  return outcome === null || outcome.projectKey !== projectKey || !outcome.moved;
}
