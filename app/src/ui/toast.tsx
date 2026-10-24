// apps/web/src/components/ui/toast.tsx: top-right stack, max-w 360, radius 10,
// 14px body, a 16px icon tinted by type ahead of the title, the description
// under both, a 24px dismiss orb on the top-right corner, and optional actions.
//
// Stacking follows base-ui's Toast as web configures it: newest in front, at
// most 3 shown (older ones are kept, hidden, and come back as front ones
// close), the ones behind collapsed into 12px peeks scaled down by 10% each,
// and the stack opening into a list while the pointer is over it. Timers pause
// while the stack is hovered or t3-term is not focused (notifications/focus.ts).
// Toasts can be scoped to a thread (web shouldRenderThreadScopedToast) and can
// expire after time actually seen (web ThreadToastVisibleAutoDismiss).
//
// Not ported: swipe-to-dismiss. In gpuix a drag needs onMouseDown + onMouseMove
// on the card, which captures the pointer, so the action buttons and the dismiss
// orb under it would never see their release and their onClick would stop
// firing (docs/gpuix-notes.md, pointer findings). The sidebar works around that
// by having every control claim the press on mouse down, but ui/primitives
// Button has no mouse-down hook, and gpuix has no transforms or transitions to
// make the card follow the pointer and fly out. Enter/exit/expand animations are
// left out for the same reason (no transforms; T3 avoids repaint loops).
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { appFocusedAtom, isAppFocused, onAppFocusChange } from "../notifications/focus.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { composerTargetKey } from "../state/composer.ts";
import { routeAtom, type Route } from "../state/ui.ts";
import { shouldHideCollapsedToastContent, shouldRenderThreadScopedToast } from "../web/components/ui/toast.logic.ts";
import { BREAKPOINTS, viewportWidthAtom } from "./viewport.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { surfaceStyle } from "./overlay.tsx";
import { Button, Text, type ButtonVariant } from "./primitives.tsx";
import { alpha, useTheme } from "./theme.ts";

export type ToastType = "info" | "success" | "warning" | "error" | "loading";

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastInput {
  readonly type?: ToastType;
  /** web renders no icon for a toast added without a type; t3-term callers default to info, so opt out here. */
  readonly hideIcon?: boolean;
  /** web ThreadToastData.leadingIcon: replaces the type icon. */
  readonly leadingIcon?: { readonly name: IconName; readonly color?: string };
  readonly title: string;
  /** A string, or a node for richer content (web KeybindingsConfigWarning). */
  readonly description?: ReactNode;
  readonly action?: ToastAction;
  /** web ThreadToastData.secondaryActionProps: rendered before the action. */
  readonly secondaryAction?: ToastAction;
  /** web ThreadToastData.actionVariant; defaults to default (filled), outline when actionLayout is unset. */
  readonly actionVariant?: ButtonVariant;
  /** web ThreadToastData.secondaryActionVariant; defaults to outline. */
  readonly secondaryActionVariant?: ButtonVariant;
  /**
   * web ThreadToastData.actionLayout. "stacked-end" (web stackedThreadToast)
   * puts the actions on their own right-aligned row under the text; "inline"
   * trails them after the text. Unset keeps t3-term's original layout: an
   * outline action under the description, left-aligned.
   */
  readonly actionLayout?: "inline" | "stacked-end";
  /** Runs when the user dismisses the toast (web ThreadToastData.onClose), not on dismissToast(). */
  readonly onClose?: () => void;
  /** web ThreadToastData.expandableContent / expandableLabels / expandableDescriptionTrigger. */
  readonly expandable?: {
    readonly content: ReactNode;
    readonly labels?: { readonly expand?: string; readonly collapse?: string };
    /** The description itself toggles the panel, with a chevron after it. */
    readonly descriptionTrigger?: boolean;
  };
  /**
   * ms; 0 keeps it until dismissed. Defaults to 5000 (errors 8000, loading 0).
   * Paused while the stack is hovered or t3-term is unfocused (base-ui timers).
   */
  readonly duration?: number;
  /**
   * web ThreadToastData.dismissAfterVisibleMs: closes the toast after it has
   * been on screen this long while t3-term is focused. Time spent hidden by
   * thread scoping or with the app in the background does not count. Callers
   * usually pair it with `duration: 0`, as web pairs it with `timeout: 0`.
   */
  readonly dismissAfterVisibleMs?: number;
  /** web ThreadToastData.threadRef: shown only while that thread is open. */
  readonly threadRef?: ScopedThreadRef | null;
  /** web ThreadToastData.threadId: shown only while a thread with this id is open (any environment). */
  readonly threadId?: ThreadId | null;
  /**
   * Shown only while this new-thread draft is open (composerTargetKey of the
   * draft). Web drafts carry a thread id from the start and scope through
   * threadRef; t3-term drafts are keyed by environment and project instead.
   */
  readonly draftKey?: string | null;
}

interface ToastEntry extends ToastInput {
  readonly id: number;
}

/** base-ui Toast.Provider defaults, which web keeps. */
const TOAST_LIMIT = 3;
// Hidden (limited) toasts are kept so they can return; this only stops a runaway caller.
const MAX_KEPT_TOASTS = 50;
const TOAST_GAP = 12;
const TOAST_PEEK = 12;

/** Newest first, like base-ui's store: index 0 is the front of the stack. */
const toastsAtom = Atom.make<ReadonlyArray<ToastEntry>>([]).pipe(Atom.keepAlive);
let nextId = 1;

// ── Timers ──────────────────────────────────────────────────────────────
// One countdown per toast that can pause and resume with what is left, so an
// update replaces the old countdown instead of racing it (base-ui scheduleTimer).

interface Countdown {
  remaining: number;
  startedAt: number | null;
  handle: ReturnType<typeof setTimeout> | null;
}

const timers = new Map<number, Countdown>();
let focusSubscribed = false;

function timersPaused(): boolean {
  return appAtomRegistry.get(stackHoveredAtom) || !isAppFocused();
}

function startCountdown(id: number, countdown: Countdown): void {
  if (countdown.handle !== null) return;
  countdown.startedAt = Date.now();
  countdown.handle = setTimeout(() => dismissToast(id), countdown.remaining);
}

function pauseCountdown(countdown: Countdown): void {
  if (countdown.handle === null) return;
  clearTimeout(countdown.handle);
  countdown.handle = null;
  countdown.remaining = Math.max(0, countdown.remaining - (Date.now() - (countdown.startedAt ?? Date.now())));
  countdown.startedAt = null;
}

function syncTimers(): void {
  const paused = timersPaused();
  for (const [id, countdown] of timers) {
    if (paused) pauseCountdown(countdown);
    else startCountdown(id, countdown);
  }
}

function clearCountdown(id: number): void {
  const countdown = timers.get(id);
  if (countdown?.handle) clearTimeout(countdown.handle);
  timers.delete(id);
}

function schedule(id: number, input: ToastInput): void {
  if (!focusSubscribed) {
    focusSubscribed = true;
    onAppFocusChange(syncTimers);
  }
  clearCountdown(id);
  const duration = input.duration ?? (input.type === "error" ? 8000 : input.type === "loading" ? 0 : 5000);
  if (duration <= 0) return;
  const countdown: Countdown = { remaining: duration, startedAt: null, handle: null };
  timers.set(id, countdown);
  if (!timersPaused()) startCountdown(id, countdown);
}

// ── Shared hover ────────────────────────────────────────────────────────
// base-ui expands the stack while the pointer is anywhere over the viewport.
// gpuix sends hover to the topmost element only, so a card's filled children
// (its surface, the orb, a hovered trigger) each end the hover of what is under
// them. Every hover target reports under its own key; the stack counts as
// hovered while any key is in, and a short delay covers the hop between them.

export const stackHoveredAtom = Atom.make(false).pipe(Atom.keepAlive);
const hoverKeys = new Set<string>();
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
const HOVER_LEAVE_DELAY_MS = 120;

function setStackHovered(hovered: boolean): void {
  if (appAtomRegistry.get(stackHoveredAtom) === hovered) return;
  appAtomRegistry.set(stackHoveredAtom, hovered);
  syncTimers();
}

function hoverEnter(key: string): void {
  hoverKeys.add(key);
  if (leaveTimer !== null) clearTimeout(leaveTimer);
  leaveTimer = null;
  setStackHovered(true);
}

function hoverLeave(key: string): void {
  if (!hoverKeys.delete(key) || hoverKeys.size > 0) return;
  if (leaveTimer !== null) clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    leaveTimer = null;
    if (hoverKeys.size === 0) setStackHovered(false);
  }, HOVER_LEAVE_DELAY_MS);
}

function resetStackHover(): void {
  hoverKeys.clear();
  if (leaveTimer !== null) clearTimeout(leaveTimer);
  leaveTimer = null;
  setStackHovered(false);
}

const ToastHoverScope = createContext<string>("toast");

/**
 * Mouse handlers that keep the stack open while this element is hovered. A
 * target that unmounts under the pointer never sees its mouse-leave, so it
 * drops its key on unmount.
 */
function useStackHover(part: string): { onMouseEnter: () => void; onMouseLeave: () => void } {
  const scope = useContext(ToastHoverScope);
  const key = `${scope}:${part}`;
  useEffect(() => () => hoverLeave(key), [key]);
  return useMemo(() => ({ onMouseEnter: () => hoverEnter(key), onMouseLeave: () => hoverLeave(key) }), [key]);
}

// ── Visible-time expiry ─────────────────────────────────────────────────

const visibleRemainingMs = new Map<number, number>();

/** web ThreadToastVisibleAutoDismiss: mounted only while the toast passes its thread scope. */
function VisibleAutoDismiss({ id, ms }: { id: number; ms: number | undefined }) {
  const focused = useAtomValue(appFocusedAtom);
  useEffect(() => {
    if (!ms || ms <= 0 || !focused) return;
    const remaining = visibleRemainingMs.get(id) ?? ms;
    if (remaining <= 0) {
      visibleRemainingMs.delete(id);
      dismissToast(id);
      return;
    }
    const startedAt = Date.now();
    const handle = setTimeout(() => {
      visibleRemainingMs.delete(id);
      dismissToast(id);
    }, remaining);
    return () => {
      clearTimeout(handle);
      if (isToastOpen(id)) visibleRemainingMs.set(id, Math.max(0, remaining - (Date.now() - startedAt)));
    };
  }, [focused, id, ms]);
  return null;
}

// ── API ─────────────────────────────────────────────────────────────────

export function dismissToast(id: number): void {
  clearCountdown(id);
  visibleRemainingMs.delete(id);
  const toasts = appAtomRegistry.get(toastsAtom);
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) return;
  appAtomRegistry.set(toastsAtom, next);
  // base-ui: closing the last toast collapses the viewport, so the next one starts collapsed.
  if (next.length === 0) resetStackHover();
}

export function toast(input: ToastInput): number {
  const id = nextId++;
  const toasts = [{ ...input, id }, ...appAtomRegistry.get(toastsAtom)];
  for (const dropped of toasts.slice(MAX_KEPT_TOASTS)) {
    clearCountdown(dropped.id);
    visibleRemainingMs.delete(dropped.id);
  }
  appAtomRegistry.set(toastsAtom, toasts.slice(0, MAX_KEPT_TOASTS));
  schedule(id, input);
  return id;
}

/** Replaces a live toast's content in place (web toastManager.update). No-op once it is gone. */
export function updateToast(id: number, input: ToastInput): void {
  const toasts = appAtomRegistry.get(toastsAtom);
  if (!toasts.some((toast) => toast.id === id)) return;
  appAtomRegistry.set(
    toastsAtom,
    toasts.map((toast) => (toast.id === id ? { ...input, id } : toast)),
  );
  schedule(id, input);
}

/** True while the toast is on screen; coordinators use it to re-add one the user closed. */
export function isToastOpen(id: number): boolean {
  return appAtomRegistry.get(toastsAtom).some((toast) => toast.id === id);
}

/** web useActiveThreadRefFromRoute, plus the draft key t3-term drafts are scoped by. */
function activeToastScope(route: Route): { threadRef: ScopedThreadRef | null; draftKey: string | null } {
  if (route.kind === "thread") return { threadRef: { environmentId: route.environmentId, threadId: route.threadId }, draftKey: null };
  if (route.kind === "draft") {
    return {
      threadRef: null,
      // The draft id is part of the key DraftView scopes toasts by: two drafts of one project are distinct.
      draftKey: composerTargetKey({
        kind: "draft",
        environmentId: route.environmentId,
        projectId: route.projectId,
        ...(route.draftId ? { draftId: route.draftId } : {}),
      }),
    };
  }
  return { threadRef: null, draftKey: null };
}

function shouldRenderToast(entry: ToastEntry, scope: ReturnType<typeof activeToastScope>): boolean {
  if (entry.draftKey) return scope.draftKey === entry.draftKey;
  return shouldRenderThreadScopedToast(entry, scope.threadRef);
}

const ICONS: Record<ToastType, IconName> = {
  info: "info",
  success: "circle-check",
  warning: "triangle-alert",
  error: "circle-alert",
  loading: "loader-circle",
};

// ── Host ────────────────────────────────────────────────────────────────

export function ToastHost() {
  const toasts = useAtomValue(toastsAtom);
  const route = useAtomValue(routeAtom);
  const hovered = useAtomValue(stackHoveredAtom);
  const viewportWidth = useAtomValue(viewportWidthAtom);
  const [frontHeight, setFrontHeight] = useState(0);
  const scope = activeToastScope(route);
  // base-ui marks the oldest toasts beyond the limit before web filters by thread,
  // so a toast for another thread still takes one of the three places.
  const visible = toasts
    .map((entry, index) => ({ entry, limited: index >= TOAST_LIMIT }))
    .filter(({ entry }) => shouldRenderToast(entry, scope));
  useEffect(() => {
    if (visible.length === 0 && appAtomRegistry.get(stackHoveredAtom)) resetStackHover();
  }, [visible.length]);
  if (visible.length === 0) return null;
  // web --toast-inset: 1rem below `sm`, 2rem from it; w-[calc(100%-inset*2)] max-w-90.
  const inset = viewportWidth < BREAKPOINTS.sm ? 16 : 32;
  const width = Math.min(360, viewportWidth - inset * 2);
  const shown = visible.map((item, visibleIndex) => ({ ...item, visibleIndex })).filter((item) => !item.limited);
  const expanded = hovered;
  // Collapsed, the cards behind paint first (tree order is paint order); open,
  // the list reads front to back. React moves the keyed cards without remounting.
  const ordered = expanded ? shown : [...shown].reverse();
  return (
    <anchored fill="window" deferred priority={5} occlude={false} style={{ backgroundColor: "transparent", pointerEvents: "none" }}>
      {visible.map(({ entry }) => (
        <VisibleAutoDismiss key={entry.id} id={entry.id} ms={entry.dismissAfterVisibleMs} />
      ))}
      {/* web: --toast-inset below --workspace-topbar-height (52), so toasts clear the header. */}
      <div testId="toast-stack" style={{ position: "absolute", top: inset + 52, right: inset, display: "flex", flexDirection: "column", width }}>
        {ordered.map(({ entry, visibleIndex }) => {
          const collapsedBack = !expanded && shouldHideCollapsedToastContent(visibleIndex, visible.length);
          return (
            <ToastHoverScope.Provider key={entry.id} value={`toast-${entry.id}`}>
              <ToastCard
                entry={entry}
                {...(collapsedBack ? { collapsed: collapsedGeometry(visibleIndex, frontHeight, width) } : {})}
                {...(visibleIndex === 0 ? { onFrontHeight: setFrontHeight } : {})}
              />
            </ToastHoverScope.Provider>
          );
        })}
      </div>
    </anchored>
  );
}

interface CollapsedGeometry {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * web, collapsed: a card behind is forced to the front card's height, scaled
 * by 1 - 0.1 * index around its top centre, and shifted down by
 * index * peek + (1 - scale) * height, so its bottom edge shows `peek` px below
 * the card in front. gpuix has no transforms, so the scaled box is laid out
 * directly at that size.
 */
function collapsedGeometry(index: number, frontHeight: number, width: number): CollapsedGeometry {
  const scale = Math.max(0, 1 - index * 0.1);
  const height = frontHeight * scale;
  return {
    top: index * TOAST_PEEK + (1 - scale) * frontHeight,
    left: (width - width * scale) / 2,
    width: width * scale,
    height,
  };
}

function ToastCard({
  entry,
  collapsed,
  onFrontHeight,
}: {
  entry: ToastEntry;
  collapsed?: CollapsedGeometry;
  onFrontHeight?: (height: number) => void;
}) {
  const theme = useTheme();
  const wrapperHover = useStackHover("wrap");
  const surfaceHover = useStackHover("surface");
  const orbHover = useStackHover("orb");
  // A native `hover:` style on the absolutely placed orb made gpuix send a
  // mouse-leave about 50 ms after the enter while the pointer sat still, which
  // collapsed the stack under it; the hover fill is driven from state instead.
  const [orbHovered, setOrbHovered] = useState(false);
  const actionHover = useStackHover("action");
  const secondaryHover = useStackHover("secondary");
  // web's `after:` strip: the gap below each card still counts as the stack, so
  // moving between open cards does not collapse them.
  const wrapperStyle = {
    display: "flex",
    flexDirection: "column",
    pointerEvents: "auto",
    paddingBottom: TOAST_GAP,
    ...(collapsed
      ? { position: "absolute", top: collapsed.top, left: collapsed.left, width: collapsed.width }
      : { position: "relative", width: "100%" }),
  } as const;
  if (collapsed) {
    // The content of a card behind is hidden (web opacity-0), so only its surface shows.
    return (
      <div testId={`toast-${entry.id}`} {...wrapperHover} style={wrapperStyle}>
        <div {...surfaceHover} style={{ ...surfaceStyle(theme), height: collapsed.height, width: "100%" }} />
      </div>
    );
  }
  const type = entry.type ?? "info";
  const tint: Record<ToastType, string> = {
    info: theme.infoForeground,
    success: theme.successForeground,
    warning: theme.warningForeground,
    error: theme.errorForeground,
    loading: alpha(theme.foreground, 0.8),
  };
  const hasActions = entry.action !== undefined || entry.secondaryAction !== undefined;
  // web's two layouts, plus t3-term's original one for callers that name none:
  // the actions on a row of their own under the text, left-aligned.
  const layout = !hasActions ? "inline" : (entry.actionLayout ?? "below");
  const stacked = layout === "stacked-end" && entry.action !== undefined;
  const inlineActions = layout === "inline" && hasActions;
  const actions = hasActions ? (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        ...(stacked ? { justifyContent: "flex-end", width: "100%" } : layout === "below" ? { marginTop: 4 } : { flexShrink: 0 }),
      }}
    >
      {entry.secondaryAction ? (
        <Button
          size="xs"
          variant={entry.secondaryActionVariant ?? "outline"}
          onClick={entry.secondaryAction.onClick}
          onMouseEnter={secondaryHover.onMouseEnter}
          onMouseLeave={secondaryHover.onMouseLeave}
        >
          {entry.secondaryAction.label}
        </Button>
      ) : null}
      {entry.action ? (
        <Button
          size="xs"
          testId={`toast-${entry.id}-action`}
          variant={entry.actionVariant ?? (layout === "below" ? "outline" : "default")}
          onClick={entry.action.onClick}
          onMouseEnter={actionHover.onMouseEnter}
          onMouseLeave={actionHover.onMouseLeave}
        >
          {entry.action.label}
        </Button>
      ) : null}
    </div>
  ) : null;
  const icon = entry.leadingIcon ? (
    <Icon name={entry.leadingIcon.name} size={16} color={entry.leadingIcon.color ?? tint[type]} />
  ) : entry.hideIcon ? null : (
    <Icon name={ICONS[type]} size={16} color={tint[type]} />
  );
  return (
    // The orb is the card's sibling, not its child: GPUI strokes a border over
    // the element's children, so the card's edge would cut through the orb.
    <div testId={`toast-${entry.id}`} {...wrapperHover} style={wrapperStyle}>
      <div
        {...surfaceHover}
        {...(onFrontHeight
          ? {
              onLayout: (event: unknown) => {
                const height = (event as { height?: number }).height;
                if (typeof height === "number" && height > 0) onFrontHeight(height);
              },
            }
          : {})}
        style={{
          ...surfaceStyle(theme),
          display: "flex",
          // web: stacked-end is a column with the actions last; inline keeps them trailing.
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "stretch" : "center",
          gap: stacked ? 8 : 6,
          paddingTop: stacked ? 10 : 12,
          paddingBottom: stacked ? 10 : 12,
          paddingLeft: 14,
          paddingRight: inlineActions ? 24 : 14,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 0,
            ...(stacked ? { paddingRight: 20 } : { flexGrow: 1, flexShrink: 1, flexBasis: 0 }),
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", gap: 8, minWidth: 0, ...(stacked || inlineActions ? {} : { paddingRight: 24 }) }}>
            {icon ? <div style={{ display: "flex", alignItems: "center", height: 20, flexShrink: 0 }}>{icon}</div> : null}
            <Text weight={500} style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
              {entry.title}
            </Text>
          </div>
          <ToastDescription entry={entry} />
          {layout === "below" ? actions : null}
        </div>
        {layout === "below" ? null : actions}
      </div>
      {/* web toastCornerDismissClass: a 24px orb half over the top-right corner. */}
      <div
        testId={`toast-${entry.id}-dismiss`}
        onMouseEnter={() => {
          setOrbHovered(true);
          orbHover.onMouseEnter();
        }}
        onMouseLeave={() => {
          setOrbHovered(false);
          orbHover.onMouseLeave();
        }}
        onClick={() => {
          entry.onClose?.();
          dismissToast(entry.id);
        }}
        style={{
          position: "absolute",
          top: -6,
          right: -6,
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.6),
          backgroundColor: orbHovered ? theme.popover : alpha(theme.popover, 0.92),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#0000000d" },
        }}
      >
        {/* web hover:text-foreground */}
        <Icon name="x" size={12} color={orbHovered ? theme.foreground : theme.mutedForeground} />
      </div>
    </div>
  );
}

const EXPANDABLE_PANEL_MAX_HEIGHT = 160;

function ToastDescription({ entry }: { entry: ToastEntry }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const triggerHover = useStackHover("expand");
  const description =
    entry.description === undefined || entry.description === null || entry.description === "" ? null : typeof entry.description === "string" ? (
      <Text
        color={theme.mutedForeground}
        // web clamps long error descriptions to four lines.
        {...(entry.type === "error" && entry.description.length >= 180 ? { lineClamp: 4 } : {})}
        style={hovered && entry.expandable?.descriptionTrigger ? { textDecoration: "underline" } : undefined}
      >
        {entry.description}
      </Text>
    ) : (
      entry.description
    );
  const expandable = entry.expandable;
  if (!expandable) return description;
  const expandLabel = expandable.labels?.expand ?? "Show details";
  const collapseLabel = expandable.labels?.collapse ?? "Hide details";
  const panel = open ? (
    <div
      style={{
        marginTop: 8,
        maxHeight: EXPANDABLE_PANEL_MAX_HEIGHT,
        overflowY: "scroll",
        paddingRight: 2,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {expandable.content}
    </div>
  ) : null;
  if (expandable.descriptionTrigger) {
    return (
      <>
        <div
          testId={`toast-${entry.id}-expand`}
          onClick={() => setOpen((value) => !value)}
          onMouseEnter={() => {
            setHovered(true);
            triggerHover.onMouseEnter();
          }}
          onMouseLeave={() => {
            setHovered(false);
            triggerHover.onMouseLeave();
          }}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 6,
            width: "100%",
            minWidth: 0,
            borderRadius: 4,
            cursor: "pointer",
            backgroundColor: hovered ? alpha(theme.muted, 0.4) : "#00000000",
          }}
        >
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>{description}</div>
          <div style={{ display: "flex", alignItems: "center", height: 20, flexShrink: 0, opacity: 0.8 }}>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
          </div>
        </div>
        {panel}
      </>
    );
  }
  return (
    <>
      {description}
      <div
        testId={`toast-${entry.id}-expand`}
        onClick={() => setOpen((value) => !value)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 2, paddingBottom: 2, cursor: "pointer" }}
      >
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          {open ? collapseLabel : expandLabel}
        </Text>
      </div>
      {panel}
    </>
  );
}

// ── Dev-only sample toasts ──────────────────────────────────────────────
// Inert unless T3TERM_DEV_TOASTS is set, for screenshots against web:
//   stack            four toasts that stay until dismissed (the oldest is held back by the limit)
//   timed            one 5 s toast (shows the timer pausing while unfocused or hovered)
//   scoped:<thread>  one toast scoped to that thread id that expires after 3 s seen
// Several can be combined with commas.
const devToasts = process.env.T3TERM_DEV_TOASTS?.trim();
if (devToasts) {
  setTimeout(() => {
    for (const part of devToasts.split(",")) {
      if (part === "stack") {
        toast({ type: "success", title: "Thread completed", description: "Refactor sidebar drag handling", duration: 0 });
        toast({ type: "warning", title: "Approval needed", description: "Update dependencies", duration: 0 });
        toast({ type: "error", title: "Action failed", description: "git push was rejected: the remote has new commits.", duration: 0 });
        toast({ type: "info", title: "Pull request opened", description: "#42 Fix toast stacking", duration: 0, actionLayout: "inline", action: { label: "View", onClick: () => {} } });
      } else if (part === "timed") {
        toast({ type: "info", title: "Five second toast", description: "Pauses while t3-term is unfocused or the stack is hovered.", duration: 5000 });
      } else if (part.startsWith("scoped:")) {
        toast({
          type: "success",
          title: "Scoped to one thread",
          description: "Counts down only while this thread is open.",
          threadId: part.slice("scoped:".length) as ThreadId,
          duration: 0,
          dismissAfterVisibleMs: 3000,
        });
      }
    }
  }, 1500);
}
