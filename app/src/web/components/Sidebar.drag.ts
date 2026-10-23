// Ported from apps/web/src/components/Sidebar.drag.ts.
// Web runs these inside dnd-kit: a modifier, a collision detector, and a
// sorting strategy. t3-term has no dnd-kit, so the dnd-kit inputs become plain
// data the sidebar measures itself (item rects in list-content pixels, the
// dragged row's translated rect, the pointer), and closestCenter is inlined.
// The decisions (which section the pointer is in, where every row moves while
// a row is dragged) are the web code, unchanged.
import {
  resolveSidebarDropTarget,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic.ts";

/** A measured box, in list-content pixels (dnd-kit's ClientRect). */
export interface SidebarRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

/** dnd-kit's Transform, as the strategy uses it: a vertical shift, scaleY 0 = hidden. */
export interface SidebarTransform {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

const stationary: SidebarTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
const hidden: SidebarTransform = { ...stationary, scaleY: 0 };
type ThreadItem = Extract<SidebarListItem, { kind: "thread" }>;
const isShelfHeader = (item: SidebarListItem | undefined) =>
  item?.kind === "marker" &&
  (item.marker === "working-header" ||
    item.marker === "snoozed-header" ||
    item.marker === "settled-header");

/** Modifier: the dragged row cannot rise above the Pinned label. */
export function restrictBelowSidebarLabel(
  {
    transformY,
    containerTop,
    draggingTop,
  }: { readonly transformY: number; readonly containerTop: number; readonly draggingTop: number },
  offset: number,
): number {
  const minimumY = containerTop + offset - draggingTop;
  return transformY < minimumY ? minimumY : transformY;
}

export interface SidebarCollisionArgs {
  readonly activeId: string;
  /** The dragged row's initial rect, translated by the (modified) drag. */
  readonly collisionRect: SidebarRect;
  readonly droppables: ReadonlyArray<{ readonly id: string; readonly rect: SidebarRect }>;
  readonly pointer: { readonly x: number; readonly y: number } | null;
  /** The "Active" divider label's painted rect (`.sidebar-drag-boundary-label`), if shown. */
  readonly boundaryLabel: SidebarRect | null;
  /** The first shelf header's painted top, if any. */
  readonly firstShelfTop: number | null;
}

/** dnd-kit closestCenter: droppables by distance between centres, nearest first. */
function closestCenter(args: SidebarCollisionArgs): Array<{ id: string; value: number }> {
  const centerX = args.collisionRect.left + args.collisionRect.width / 2;
  const centerY = args.collisionRect.top + args.collisionRect.height / 2;
  return args.droppables
    .map(({ id, rect }) => ({
      id,
      value: Math.hypot(rect.left + rect.width / 2 - centerX, rect.top + rect.height / 2 - centerY),
    }))
    .sort((left, right) => left.value - right.value);
}

export function createSidebarCollisionDetection(
  isValidTarget: (id: string) => boolean,
  options: {
    items?: readonly SidebarListItem[];
    activationY?: number | null;
  } = {},
): (args: SidebarCollisionArgs) => Array<{ id: string }> {
  const validity = new Map<string, boolean>();
  const sections = new Map<string, SidebarSection | null>();
  let previousPointerY = options.activationY;
  let boundarySection: "pinned" | "active" | undefined;
  return (args) => {
    let collisions = closestCenter(args);
    const pointer = args.pointer;
    const items = options.items;
    const source = items?.find((item) => item.kind === "thread" && item.key === args.activeId);
    const boundary = args.boundaryLabel;
    if (items && boundary && source?.kind === "thread" && pointer) {
      boundarySection ??= source.section === "pinned" ? "pinned" : "active";
      // Use the visible divider row, including its sortable translation.
      // Only pointer movement can change sections: opening the destination
      // moves this row, but must not toggle a stationary gesture back.
      const previousY = previousPointerY ?? pointer.y;
      previousPointerY = pointer.y;
      if (pointer.x >= boundary.left && pointer.x <= boundary.right) {
        if (pointer.y < previousY && pointer.y <= boundary.bottom) boundarySection = "pinned";
        else if (pointer.y > previousY && pointer.y >= boundary.top) boundarySection = "active";
        const activeBottom = args.firstShelfTop;
        if (boundarySection === "pinned" || (activeBottom != null && pointer.y < activeBottom)) {
          const target = collisions.find((collision) => {
            const id = collision.id;
            if (!sections.has(id)) {
              sections.set(id, resolveSidebarDropTarget(items, args.activeId, id)?.section ?? null);
            }
            return sections.get(id) === boundarySection;
          });
          if (target) collisions = [target, ...collisions.filter((collision) => collision !== target)];
        }
      }
    }
    const nearest = collisions[0];
    if (!nearest || nearest.id === args.activeId) {
      return collisions;
    }
    const id = nearest.id;
    const valid = validity.get(id) ?? isValidTarget(id);
    validity.set(id, valid);
    return valid ? collisions : collisions.filter((collision) => collision.id === args.activeId);
  };
}

export interface SidebarSortingLayout {
  readonly rects: ReadonlyArray<SidebarRect>;
  readonly activeIndex: number;
  readonly overIndex: number;
}

/**
 * Where every list item sits while one row is dragged: the projected list
 * (destination section opened, settled tail recomputed, empty sections shown
 * as placeholders, the Pinned/Active labels given room) laid out top to
 * bottom. Returns one transform per item; the active item stays stationary
 * (the drag itself moves it).
 */
export function createSidebarSortingStrategy(input: {
  items: readonly SidebarListItem[];
  enabled?: boolean;
  settledOrder: readonly string[];
  activeOrder?: readonly string[];
  settledExpanded: boolean;
  settledVisibleCount?: number;
  routeThreadKey?: string | null;
  snoozedThreadCount?: number;
  cardHeight?: number;
  slimHeight?: number;
  boundaryLabelHeight?: number;
}): (layout: SidebarSortingLayout) => ReadonlyArray<SidebarTransform> {
  if (input.enabled === false) return ({ rects }) => rects.map(() => stationary);
  const { items } = input;
  const indices = new Map(items.map((item, index) => [sidebarListItemId(item), index]));

  return function project({ rects, activeIndex, overIndex }: SidebarSortingLayout) {
    const active = items[activeIndex];
    const over = items[overIndex] ?? active;
    if (active?.kind !== "thread" || !over || !rects[0]) return [];
    const target = resolveSidebarDropTarget(items, active.key, sidebarListItemId(over));
    if (!target) return [];
    const groups: Record<SidebarSection, ThreadItem[]> = {
      pinned: [],
      active: [],
      working: [],
      snoozed: [],
      settled: [],
    };
    let cardHeight = input.cardHeight;
    let slimHeight = input.slimHeight;
    let headerScale: number | undefined;
    for (const [index, item] of items.entries()) {
      if (item.kind === "marker") {
        if (isShelfHeader(item)) {
          const height = rects[index]?.height;
          if (height) headerScale ??= height / 32;
        }
        continue;
      }
      if (item.section === "pinned" || item.section === "active" || item.section === "working")
        cardHeight ??= rects[index]?.height;
      else slimHeight ??= rects[index]?.height;
      if (item.key !== active.key) groups[item.section].push(item);
    }
    const scale =
      slimHeight !== undefined ? slimHeight / 36 : (headerScale ?? (cardHeight ?? 82) / 82);
    cardHeight ??= 82 * scale;
    slimHeight ??= 36 * scale;
    const labelHeight = (input.boundaryLabelHeight ?? 0) * scale;
    const group = groups[target.section];
    const order =
      target.section === "pinned"
        ? target.pinnedOrder
        : target.section === "settled"
          ? input.settledOrder
          : (input.activeOrder ?? target.activeOrder);
    const ranks = new Map(order.map((key, index) => [key, index]));
    const rank = ranks.get(active.key) ?? Number.POSITIVE_INFINITY;
    const index = group.findIndex(
      (item) => (ranks.get(item.key) ?? Number.POSITIVE_INFINITY) > rank,
    );
    group.splice(index < 0 ? group.length : index, 0, { ...active, section: target.section });
    const settledOrder = (
      input.settledOrder.length > 0 ? input.settledOrder : groups.settled.map((item) => item.key)
    ).filter((key) => key !== active.key || target.section === "settled");
    const visible = input.settledExpanded
      ? settledOrder.slice(0, input.settledVisibleCount ?? settledOrder.length)
      : [];
    const routeKey = input.routeThreadKey;
    if (routeKey && settledOrder.includes(routeKey) && !visible.includes(routeKey)) {
      visible.push(routeKey);
    }
    groups.settled = visible.map((key) => ({ kind: "thread", key, section: "settled" }));
    const projected: SidebarListItem[] = [];
    const marker = (name: SidebarListMarker) => projected.push({ kind: "marker", marker: name });
    const section = (name: "active" | "settled") => {
      if (groups[name].length > 0) projected.push(...groups[name]);
      else marker(`${name}-placeholder`);
    };
    marker("pinned-header");
    projected.push(...groups.pinned);
    marker("pinned-divider");
    section("active");
    if (items.some((item) => item.kind === "marker" && item.marker === "working-header")) {
      marker("working-header");
      projected.push(...groups.working);
    }
    if (
      groups.snoozed.length > 0 ||
      ((active.section !== "snoozed" || (input.snoozedThreadCount ?? 0) > 1) &&
        items.some((item) => item.kind === "marker" && item.marker === "snoozed-header"))
    ) {
      marker("snoozed-header");
      projected.push(...groups.snoozed);
    }
    marker("settled-header");
    section("settled");
    const heights = projected.map((item) => {
      const index = indices.get(sidebarListItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      const fallback =
        item.kind === "thread" &&
        (item.section === "pinned" || item.section === "active" || item.section === "working")
          ? cardHeight
          : slimHeight;
      const moved = item.kind === "thread" && item.key === active.key;
      return item.kind === "marker" &&
        (item.marker === "pinned-header" || item.marker === "pinned-divider")
        ? labelHeight
        : item.kind === "marker" && item.marker.endsWith("placeholder")
          ? slimHeight
          : moved
            ? fallback
            : (rect?.height ?? fallback);
    });
    const firstShelf = items.findIndex(isShelfHeader);
    const shelfRect = rects[firstShelf];
    const beforeShelf = rects[firstShelf - 1];
    const lastRect = rects.at(-1);
    let shelfSpace =
      shelfRect && beforeShelf && lastRect && shelfRect.top > beforeShelf.bottom + 1
        ? Math.max(
            0,
            lastRect.bottom - rects[0].top - heights.reduce((sum, height) => sum + height + 1, -1),
          )
        : 0;
    const result: SidebarTransform[] = items.map(() => hidden);
    let top = rects[0].top;
    for (const [projectedIndex, item] of projected.entries()) {
      if (isShelfHeader(item)) {
        top += shelfSpace;
        shelfSpace = 0;
      }
      const index = indices.get(sidebarListItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      if (index !== undefined && rect) result[index] = { ...stationary, y: top - rect.top };
      top += heights[projectedIndex]! + 1;
    }
    result[activeIndex] = stationary;
    return result;
  };
}

