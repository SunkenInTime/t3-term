// Pointer gestures of the legacy tree's project rows: click to expand or
// collapse, and (with "Sort projects: Manual") drag to reorder, which web runs
// through dnd-kit's PointerSensor with a 6px activation distance.
//
// gpuix only follows a drag on an element that captures the pointer
// (onMouseDown + onMouseMove), and a captured press swallows the release of
// every control inside the row. So the row's controls claim the press on mouse
// down (claimProjectPress) and the row runs the claim on its own click, the
// same scheme sidebarGesture.ts uses for thread rows.

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

interface Claim {
  readonly run: () => void;
  readonly at: number;
}

interface Press {
  readonly projectKey: string;
  readonly origin: LegacyGesturePoint;
  readonly claim: Claim | null;
  phase: "pending" | "static" | "dragging";
  last: LegacyGesturePoint;
}

let pendingClaim: Claim | null = null;
let press: Press | null = null;
let lastOutcome: { readonly projectKey: string; readonly moved: boolean; readonly claim: Claim | null } | null = null;

/** A control inside a project row takes the press; `run` fires on release unless it became a drag. */
export function claimProjectPress(run: () => void): void {
  pendingClaim = { run, at: performance.now() };
}

export function projectMouseDown(projectKey: string, event: { x?: number; y?: number; button?: number }): void {
  const claim = pendingClaim !== null && performance.now() - pendingClaim.at < 1_000 ? pendingClaim : null;
  pendingClaim = null;
  if ((event.button ?? 0) !== 0) {
    press = null;
    return;
  }
  lastOutcome = null;
  const origin = { x: event.x ?? 0, y: event.y ?? 0 };
  press = { projectKey, origin, claim, phase: "pending", last: origin };
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
    // A press on a control never drags: web's new-thread button is not the drag handle.
    if (current.claim === null && host?.startDrag(current.projectKey, current.origin, point)) {
      current.phase = "dragging";
    } else {
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
  lastOutcome = { projectKey: current.projectKey, moved, claim: current.claim };
}

export function cancelLegacyProjectGesture(): void {
  const current = press;
  press = null;
  if (current === null) return;
  if (current.phase === "dragging") host?.endDrag(null);
  lastOutcome = { projectKey: current.projectKey, moved: true, claim: null };
}

/**
 * From the row's onClick: "claimed" ran a control's action, "moved" was a drag
 * (handleProjectButtonClick suppresses the click after one), "row" is a click.
 */
export function consumeProjectClick(projectKey: string): "claimed" | "moved" | "row" {
  if (press !== null && press.projectKey === projectKey) finish(press.last, true);
  const outcome = lastOutcome;
  lastOutcome = null;
  if (outcome === null || outcome.projectKey !== projectKey) return "row";
  if (outcome.moved) return "moved";
  if (outcome.claim !== null) {
    outcome.claim.run();
    return "claimed";
  }
  return "row";
}
