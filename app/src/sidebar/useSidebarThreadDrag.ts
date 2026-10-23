// The thread list's drag (apps/web/src/components/Sidebar.tsx: DndContext's
// handleThreadDragStart / Over / End, the dnd-kit modifiers, the optimistic
// drop) and its action sweep (startActionSweep), driven by the row gestures in
// sidebarGesture.ts. Rows keep their layout during a drag; this hook measures
// them once at the start, asks Sidebar.drag.ts where every item moves, and
// hands the sidebar a view to paint: per-item offsets, the drop section, and
// where the lifted copy of the dragged row sits.
import { parseScopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import { sortInboxThreadsByReturn } from "@t3tools/client-runtime/state/thread-inbox";
import { useEffect, useMemo, useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentServerConfigsAtom } from "../state/environment.ts";
import {
  readCanOperate,
  routeThreadKeyAtom,
  sidebarInboxReturns,
  sidebarOptimisticDropAtom,
  threadShellKey,
  type SidebarOptimisticDrop,
  type SidebarThreadList,
} from "../state/sidebar.ts";
import { toast } from "../ui/toast.tsx";
import {
  createSidebarCollisionDetection,
  createSidebarSortingStrategy,
  restrictBelowSidebarLabel,
  type SidebarRect,
  type SidebarTransform,
} from "../web/components/Sidebar.drag.ts";
import {
  applySidebarThreadDrop,
  planSidebarThreadDrop,
  resolveSidebarDropTarget,
  resolveSidebarSweepKeys,
  shouldNavigateAfterThreadPark,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarSection,
} from "../web/components/Sidebar.logic.ts";
import {
  setSidebarGestureHost,
  cancelSidebarGesture,
  type SidebarGestureHost,
  type SidebarGesturePoint,
} from "./sidebarGesture.ts";
import type { SidebarSweepAction } from "./SidebarThreadRow.tsx";
import {
  attemptSettle,
  attemptUnsettle,
  attemptUnsnooze,
  isThreadSettling,
  markThreadSettling,
  pinThread,
  planForwardNavigation,
  readThreadShell,
  reorderActiveThread,
  reorderPinnedThread,
  reportResult,
  settleThread,
  unpinThread,
  unsettleThread,
  unsnoozeThread,
} from "./threadActions.ts";

/** Sidebar.tsx SIDEBAR_DRAG_LABEL_HEIGHT: room each boundary label takes in the projection. */
export const SIDEBAR_DRAG_LABEL_HEIGHT = 24;

/** Where the thread list's scroller sits in the window, and how far it is scrolled. */
export interface SidebarScrollMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollTop: number;
  contentHeight: number;
  /** The scroller's host element, for renderer.scrollTo. */
  elementId: number | null;
}

/** dnd-kit autoScroll defaults: a 20% edge band; up to 10px every 5ms at the very edge. */
const AUTO_SCROLL_THRESHOLD = 0.2;
const AUTO_SCROLL_TICK_MS = 16;
const AUTO_SCROLL_MAX_STEP = 10 * (AUTO_SCROLL_TICK_MS / 5);

export interface SidebarDragView {
  readonly activeKey: string;
  readonly activeSection: SidebarSection;
  readonly targetSection: SidebarSection | null;
  /** Vertical offset per list item id; null hides the item (scaleY 0). */
  readonly offsets: ReadonlyMap<string, number | null>;
  /** The lifted row's top, in list-content pixels. */
  readonly ghostTop: number;
}

export interface SidebarSweepView {
  readonly action: SidebarSweepAction;
  readonly keys: ReadonlySet<string>;
}

interface DragSession {
  readonly activeKey: string;
  readonly activeSection: SidebarSection;
  readonly activeIndex: number;
  readonly items: ReadonlyArray<SidebarListItem>;
  readonly rects: ReadonlyArray<SidebarRect>;
  readonly origin: SidebarGesturePoint;
  readonly labelOffset: number;
  readonly detect: ReturnType<typeof createSidebarCollisionDetection>;
  readonly project: ReturnType<typeof createSidebarSortingStrategy>;
  overId: string | null;
  transforms: ReadonlyArray<SidebarTransform>;
}

interface Input {
  readonly list: SidebarThreadList;
  readonly items: ReadonlyArray<SidebarListItem>;
  /** Each item's rect in list-content pixels, in `items` order. */
  readonly measure: () => ReadonlyArray<SidebarRect>;
  readonly metrics: { readonly current: SidebarScrollMetrics };
  readonly renamingThreadKey: string | null;
  readonly routeRowThreadKey: string | null;
  readonly scrollTo: (elementId: number, top: number) => void;
}

const NO_ORDER: ReadonlyArray<string> = [];

function translate(rect: SidebarRect, dy: number): SidebarRect {
  return { ...rect, top: rect.top + dy, bottom: rect.bottom + dy };
}

/** Sidebar.tsx resolveDraggedOrders: where the row would sort on the settled or time-ordered active shelf. */
function resolveDraggedOrders(
  thread: EnvironmentThreadShell,
  occurredAt: string,
  list: SidebarThreadList,
): { settledOrder: ReadonlyArray<string>; activeOrder: ReadonlyArray<string> | undefined } {
  const activeKey = threadShellKey(thread);
  const others = (threads: ReadonlyArray<EnvironmentThreadShell>) =>
    threads.filter((candidate) => threadShellKey(candidate) !== activeKey);
  return {
    settledOrder: sortSettledThreads([
      ...others(list.settledThreads),
      applySidebarThreadDrop(thread, "settled", occurredAt),
    ]).map(threadShellKey),
    activeOrder: list.workingShelfEnabled
      ? sortInboxThreadsByReturn(
          [...others(list.activeThreads), applySidebarThreadDrop(thread, "active", occurredAt)],
          sidebarInboxReturns.returnedAt,
        ).map(threadShellKey)
      : undefined,
  };
}

function supportsSettlement(thread: Pick<EnvironmentThreadShell, "environmentId">): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(thread.environmentId)?.environment.capabilities
      .threadSettlement === true
  );
}

function planDrop(list: SidebarThreadList, activeKey: string, activeSection: SidebarSection, target: NonNullable<ReturnType<typeof resolveSidebarDropTarget>>) {
  const source = list.threadByKey.get(activeKey);
  if (source === undefined) return null;
  return planSidebarThreadDrop({
    activeKey,
    activeSection,
    activePinned: source.pinnedAt != null,
    activeSettled: source.settledOverride === "settled",
    supportsSettlement: supportsSettlement(source),
    target,
    pinnedOrder: list.pinnedKeys,
    pinnedKeysById: list.pinnedKeysById,
    reorderableKeys: list.draggableThreadKeys,
    activeOrder: list.activeKeys,
    activeKeysById: list.activeKeysById,
    activeReorderableKeys: list.activeReorderableThreadKeys,
    activeTimeOrdered: list.workingShelfEnabled,
  });
}

/** Sidebar.tsx settleThreads: settle a batch; the open thread advances past every co-settling row. */
export function settleThreadKeys(list: SidebarThreadList, threadKeys: ReadonlyArray<string>): void {
  const coSettlingKeys = new Set(threadKeys);
  for (const threadKey of threadKeys) {
    const thread = list.threadByKey.get(threadKey);
    if (!thread || thread.settledOverride === "settled") continue;
    attemptSettle(scopeThreadRef(thread.environmentId, thread.id), { coSettlingKeys });
  }
}

/** Sidebar.tsx handleThreadDragEnd, after the plan: the commands, with the optimistic hold. */
function commitDrop(list: SidebarThreadList, activeKey: string, activeSection: SidebarSection, target: NonNullable<ReturnType<typeof resolveSidebarDropTarget>>): void {
  const activeThread = list.threadByKey.get(activeKey);
  if (activeThread === undefined) return;
  const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
  const plan = planDrop(list, activeKey, activeSection, target);
  if (plan === null || plan.kind === "none") return;
  if (plan.kind === "settle" && isThreadSettling(activeKey)) return;
  const assignments =
    plan.kind === "pin"
      ? [...(plan.orderKey === undefined ? [] : [{ id: activeKey, orderKey: plan.orderKey }]), ...plan.extraAssignments]
      : plan.kind === "reorder-pinned" || plan.kind === "move-active"
        ? plan.assignments
        : [];
  // checkThreadOperations
  const touched = [activeKey, ...assignments.map(({ id }) => id)].flatMap((key) => {
    const thread = list.threadByKey.get(key);
    return thread ? [thread] : [];
  });
  if (!touched.every((thread) => readCanOperate(thread.environmentId))) {
    toast({
      type: "error",
      title: "Thread action unavailable",
      description: "This connection cannot change one or more selected threads.",
    });
    return;
  }
  const drop: SidebarOptimisticDrop = {
    key: activeKey,
    sourceSection: activeSection,
    section: target.section,
    occurredAt: new Date().toISOString(),
    clearsSnooze: plan.kind === "pin" || plan.kind === "settle" || (plan.kind === "move-active" && plan.unsnooze),
    order: plan.kind === "settle" ? null : plan.order,
    keysAtDrop: target.section === "active" ? list.activeKeysById : list.pinnedKeysById,
    assignedKeys: new Map(assignments.map(({ id, orderKey }) => [id, orderKey])),
  };
  appAtomRegistry.set(sidebarOptimisticDropAtom, drop);
  void (async () => {
    const run = async (operation: Promise<Parameters<typeof reportResult>[0]>, title: string) => {
      const result = await operation;
      if (result._tag === "Success") return true;
      if (appAtomRegistry.get(sidebarOptimisticDropAtom) === drop) appAtomRegistry.set(sidebarOptimisticDropAtom, null);
      reportResult(result, title);
      return false;
    };
    switch (plan.kind) {
      case "settle": {
        markThreadSettling(activeKey, true);
        const navigateAfterSettle = planForwardNavigation(activeKey);
        const settled = await run(settleThread(threadRef), "Failed to settle thread").finally(() =>
          markThreadSettling(activeKey, false),
        );
        if (
          settled &&
          shouldNavigateAfterThreadPark({
            threadKey: activeKey,
            currentThreadKey: appAtomRegistry.get(routeThreadKeyAtom),
            action: "settle",
            now: new Date().toISOString(),
            thread: readThreadShell(threadRef),
          })
        ) {
          navigateAfterSettle?.();
        }
        return;
      }
      case "move-active":
        if (plan.unpin && !(await run(unpinThread(threadRef), "Failed to unpin thread"))) return;
        if (plan.unsettle && !(await run(unsettleThread(threadRef), "Failed to un-settle thread"))) return;
        if (plan.unsnooze && !(await run(unsnoozeThread(threadRef), "Failed to wake thread"))) return;
        break;
      case "pin":
        if (
          !(await run(
            pinThread(threadRef, plan.orderKey === undefined ? {} : { orderKey: plan.orderKey }),
            "Failed to pin thread",
          ))
        )
          return;
        break;
      case "reorder-pinned":
        break;
    }
    const keyWrites = plan.kind === "pin" ? plan.extraAssignments : plan.assignments;
    for (const assignment of keyWrites) {
      const thread = list.threadByKey.get(assignment.id);
      if (thread === undefined) continue;
      if (
        !(await run(
          (plan.kind === "move-active" ? reorderActiveThread : reorderPinnedThread)(
            scopeThreadRef(thread.environmentId, thread.id),
            assignment.orderKey,
          ),
          plan.kind === "move-active" ? "Failed to reorder active threads" : "Failed to reorder pinned threads",
        ))
      )
        return;
    }
  })();
}

export function useSidebarThreadDrag(input: Input): {
  readonly dragView: SidebarDragView | null;
  readonly sweep: SidebarSweepView | null;
} {
  const latest = useRef(input);
  latest.current = input;
  const [dragView, setDragView] = useState<SidebarDragView | null>(null);
  const [sweep, setSweep] = useState<SidebarSweepView | null>(null);

  const host = useMemo((): SidebarGestureHost => {
    let session: DragSession | null = null;
    let sweepState: {
      readonly originKey: string;
      readonly action: SidebarSweepAction;
      readonly canApply: (key: string) => boolean;
      targetKey: string | null;
      keys: ReadonlyArray<string>;
    } | null = null;

    const toContent = (point: SidebarGesturePoint): SidebarGesturePoint => {
      const metrics = latest.current.metrics.current;
      return { x: point.x - metrics.x, y: point.y - metrics.y + metrics.scrollTop };
    };

    let autoScroll: { timer: ReturnType<typeof setInterval>; step: number } | null = null;
    let lastPoint: SidebarGesturePoint | null = null;
    const stopAutoScroll = () => {
      if (autoScroll !== null) clearInterval(autoScroll.timer);
      autoScroll = null;
    };
    /** Scroll while the pointer sits in the list's top or bottom edge band. */
    const steerAutoScroll = (point: SidebarGesturePoint) => {
      const metrics = latest.current.metrics.current;
      const band = metrics.height * AUTO_SCROLL_THRESHOLD;
      const y = point.y - metrics.y;
      const depth =
        band <= 0 ? 0 : y < band ? -(band - y) / band : y > metrics.height - band ? (y - (metrics.height - band)) / band : 0;
      const step = Math.max(-1, Math.min(1, depth)) * AUTO_SCROLL_MAX_STEP;
      if (step === 0 || metrics.elementId === null) {
        stopAutoScroll();
        return;
      }
      if (autoScroll !== null) {
        autoScroll.step = step;
        return;
      }
      const elementId = metrics.elementId;
      autoScroll = {
        step,
        timer: setInterval(() => {
          const current = latest.current.metrics.current;
          const maxTop = Math.max(0, current.contentHeight - current.height);
          const next = Math.min(maxTop, Math.max(0, current.scrollTop + (autoScroll?.step ?? 0)));
          if (next === current.scrollTop) return;
          current.scrollTop = next;
          latest.current.scrollTo(elementId, next);
          if (lastPoint !== null) update(lastPoint, false);
        }, AUTO_SCROLL_TICK_MS),
      };
    };

    const update = (point: SidebarGesturePoint, steer = true) => {
      const current = session;
      if (current === null) return;
      lastPoint = point;
      if (steer) steerAutoScroll(point);
      const metrics = latest.current.metrics.current;
      const pointer = toContent(point);
      const activeRect = current.rects[current.activeIndex]!;
      // restrictToVerticalAxis, restrictBelowPins, restrictToFirstScrollableAncestor.
      let transformY = restrictBelowSidebarLabel(
        { transformY: pointer.y - current.origin.y, containerTop: 0, draggingTop: activeRect.top },
        current.labelOffset,
      );
      const visibleTop = metrics.scrollTop;
      const visibleBottom = metrics.scrollTop + metrics.height;
      if (activeRect.top + transformY <= visibleTop) transformY = visibleTop - activeRect.top;
      else if (activeRect.bottom + transformY >= visibleBottom) transformY = visibleBottom - activeRect.bottom;

      const painted = (index: number) => current.rects[index]!.top + (current.transforms[index]?.y ?? 0);
      const dividerIndex = current.items.findIndex(
        (item) => item.kind === "marker" && item.marker === "pinned-divider",
      );
      const shelfIndex = current.items.findIndex(
        (item) =>
          item.kind === "marker" &&
          (item.marker === "working-header" || item.marker === "snoozed-header" || item.marker === "settled-header"),
      );
      const width = metrics.width;
      const collisions = current.detect({
        activeId: current.activeKey,
        collisionRect: translate(activeRect, transformY),
        droppables: current.items.map((item, index) => ({ id: sidebarListItemId(item), rect: current.rects[index]! })),
        pointer,
        // .sidebar-drag-boundary-label: the li's mx-0.5 plus the label's inset-x-2 inside the list's px-2.
        boundaryLabel:
          dividerIndex === -1
            ? null
            : {
                top: painted(dividerIndex) + 4,
                bottom: painted(dividerIndex) + 20,
                left: 18,
                right: width - 18,
                width: width - 36,
                height: 16,
              },
        firstShelfTop: shelfIndex === -1 ? null : painted(shelfIndex),
      });
      const overId = collisions[0]?.id ?? null;
      const overIndex = overId === null ? -1 : current.items.findIndex((item) => sidebarListItemId(item) === overId);
      current.overId = overId;
      current.transforms =
        overIndex === -1
          ? []
          : current.project({ rects: current.rects, activeIndex: current.activeIndex, overIndex });
      const target = overId === null ? null : resolveSidebarDropTarget(current.items, current.activeKey, overId);
      const offsets = new Map<string, number | null>();
      current.items.forEach((item, index) => {
        const transform = current.transforms[index];
        if (transform && index !== current.activeIndex) {
          offsets.set(sidebarListItemId(item), transform.scaleY === 0 ? null : transform.y);
        }
      });
      setDragView({
        activeKey: current.activeKey,
        activeSection: current.activeSection,
        targetSection: target?.section ?? null,
        offsets,
        ghostTop: activeRect.top + transformY,
      });
    };

    return {
      startDrag(threadKey, origin, point) {
        const { list, items, renamingThreadKey, measure } = latest.current;
        if (appAtomRegistry.get(sidebarOptimisticDropAtom) !== null) return false;
        if (renamingThreadKey === threadKey || !list.draggableThreadKeys.has(threadKey)) return false;
        const thread = list.threadByKey.get(threadKey);
        const activeSection = list.sectionByThreadKey.get(threadKey);
        // Working rows (beta shelf) only drag out as chat context, never between sections.
        if (!thread || activeSection === undefined || activeSection === "working") return false;
        if (!readCanOperate(thread.environmentId)) return false;
        const activeIndex = items.findIndex((item) => item.kind === "thread" && item.key === threadKey);
        if (activeIndex === -1) return false;
        const rects = measure();
        const headerIndex = items.findIndex((item) => item.kind === "marker" && item.marker === "pinned-header");
        const occurredAt = new Date().toISOString();
        const orders = resolveDraggedOrders(thread, occurredAt, list);
        const originContent = toContent(origin);
        session = {
          activeKey: threadKey,
          activeSection,
          activeIndex,
          items,
          rects,
          origin: originContent,
          labelOffset: (headerIndex === -1 ? 0 : rects[headerIndex]!.top) + SIDEBAR_DRAG_LABEL_HEIGHT,
          detect: createSidebarCollisionDetection(
            (id) => {
              const target = resolveSidebarDropTarget(items, threadKey, id);
              if (target === null) return false;
              return planDrop(list, threadKey, activeSection, target)?.kind !== "none";
            },
            { items, activationY: originContent.y },
          ),
          project: createSidebarSortingStrategy({
            items,
            boundaryLabelHeight: SIDEBAR_DRAG_LABEL_HEIGHT,
            settledOrder: orders.settledOrder.length > 0 ? orders.settledOrder : NO_ORDER,
            ...(orders.activeOrder === undefined ? {} : { activeOrder: orders.activeOrder }),
            settledExpanded: list.settledExpanded,
            settledVisibleCount: list.settledVisibleCount,
            routeThreadKey: latest.current.routeRowThreadKey,
            snoozedThreadCount: list.snoozedThreads.length,
          }),
          overId: threadKey,
          transforms: [],
        };
        update(point);
        return true;
      },
      moveDrag(point) {
        update(point);
      },
      endDrag(point) {
        const current = session;
        if (current === null) return;
        if (point !== null) update(point, false);
        stopAutoScroll();
        session = null;
        setDragView(null);
        if (point === null || current.overId === null) return;
        const target = resolveSidebarDropTarget(current.items, current.activeKey, current.overId);
        if (target === null) return;
        commitDrop(latest.current.list, current.activeKey, current.activeSection, target);
      },
      startSweep(threadKey, action) {
        const { list } = latest.current;
        const originSection = list.sectionByThreadKey.get(threadKey);
        const canApply = (key: string) => {
          const thread = latest.current.list.threadByKey.get(key);
          const capabilities =
            thread && appAtomRegistry.get(environmentServerConfigsAtom).get(thread.environmentId)?.environment.capabilities;
          return (
            thread !== undefined &&
            latest.current.list.sectionByThreadKey.get(key) === originSection &&
            (action === "unsnooze" ? capabilities?.threadSnooze === true : capabilities?.threadSettlement === true)
          );
        };
        sweepState = { originKey: threadKey, action, canApply, targetKey: null, keys: [] };
        sweepTo(threadKey);
      },
      moveSweep(point) {
        sweepTo(threadKeyAtY(toContent(point).y));
      },
      endSweep(commit) {
        const current = sweepState;
        sweepState = null;
        setSweep(null);
        if (current === null || !commit) return;
        const keys = current.keys.filter(current.canApply);
        if (current.action === "settle") {
          settleThreadKeys(latest.current.list, keys);
          return;
        }
        for (const key of keys) {
          const ref = parseScopedThreadKey(key);
          if (ref === null) continue;
          if (current.action === "unsettle") attemptUnsettle(ref);
          else attemptUnsnooze(ref);
        }
      },
    };

    function sweepTo(key: string | null) {
      const current = sweepState;
      if (current === null || key === null || key === current.targetKey) return;
      current.targetKey = key;
      current.keys = resolveSidebarSweepKeys(
        latest.current.list.orderedThreadKeys,
        current.originKey,
        key,
        current.canApply,
      );
      setSweep({ action: current.action, keys: new Set(current.keys) });
    }

    /** Sidebar.logic.ts sidebarThreadKeyAtY: the last row starting at or above `y`, clamped to the viewport. */
    function threadKeyAtY(y: number): string | null {
      const { items, measure, metrics } = latest.current;
      const visibleY = Math.min(Math.max(y, metrics.current.scrollTop), metrics.current.scrollTop + metrics.current.height - 1);
      const rects = measure();
      let key: string | null = null;
      for (const [index, item] of items.entries()) {
        if (item.kind !== "thread") continue;
        if (key !== null && rects[index]!.top > visibleY) break;
        key = item.key;
      }
      return key;
    }
  }, []);

  useEffect(() => {
    setSidebarGestureHost(host);
    return () => setSidebarGestureHost(null);
  }, [host]);

  // A row that leaves the list mid-drag (settled elsewhere, archived) ends the drag.
  useEffect(() => {
    if (dragView !== null && !input.items.some((item) => item.kind === "thread" && item.key === dragView.activeKey)) {
      cancelSidebarGesture();
    }
  }, [dragView, input.items]);

  return { dragView, sweep };
}

