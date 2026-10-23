// Web's responsive rules keyed on the window width, which in terminal mode is the
// terminal's size (often a split pane far narrower than a desktop browser).
// apps/web/src/hooks/useMediaQuery.ts (Tailwind breakpoints), rightPanelLayout.ts,
// threadSidebarWidth.ts, index.css (--workspace-gutter, chat lane padding).
//
// One component (ViewportSync, at the app root) samples the window size and writes
// it to an atom; everything else reads boolean atoms, so a resize re-renders only
// what crosses a breakpoint.
import { useAtomValue } from "@effect/atom-react";
import { useWindowSize } from "@gpuix/react";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useLayoutEffect, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { persistedAtom } from "../state/persistedAtom.ts";
import {
  clampThreadSidebarWidth,
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  resolveThreadSidebarMinimumWidth,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "../web/components/threadSidebarWidth.ts";

/** Tailwind v4 defaults (useMediaQuery.ts BREAKPOINTS). */
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
/** rightPanelLayout.ts RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY `(max-width: 980px)`. */
export const RIGHT_PANEL_SHEET_MAX_WIDTH = 980;

export const viewportWidthAtom = Atom.make(1440).pipe(Atom.keepAlive);
export const viewportHeightAtom = Atom.make(900).pipe(Atom.keepAlive);

/** `max-sm`: below 640. Web's mobile control sizes, tighter gutters, collapsed composer. */
export const smallViewportAtom = Atom.make((get) => get(viewportWidthAtom) < BREAKPOINTS.sm).pipe(Atom.keepAlive);
/** useIsMobile (`max-md`): below 768 the sidebar becomes an off-canvas sheet. */
export const mobileViewportAtom = Atom.make((get) => get(viewportWidthAtom) < BREAKPOINTS.md).pipe(Atom.keepAlive);
/** `lg`: the draft hero's one-line heading needs at least 1024. */
export const largeViewportAtom = Atom.make((get) => get(viewportWidthAtom) >= BREAKPOINTS.lg).pipe(Atom.keepAlive);
/** At or below 980 the right panel opens as a sheet over the chat instead of beside it. */
export const rightPanelSheetAtom = Atom.make((get) => get(viewportWidthAtom) <= RIGHT_PANEL_SHEET_MAX_WIDTH).pipe(
  Atom.keepAlive,
);

/** Mount once at the root, above everything that reads the atoms. */
export function ViewportSync() {
  const size = useWindowSize();
  // The first frame already lays out at the real size: write before children read.
  useState(() => {
    appAtomRegistry.set(viewportWidthAtom, size.width);
    appAtomRegistry.set(viewportHeightAtom, size.height);
    return null;
  });
  useLayoutEffect(() => {
    if (appAtomRegistry.get(viewportWidthAtom) !== size.width) appAtomRegistry.set(viewportWidthAtom, size.width);
    if (appAtomRegistry.get(viewportHeightAtom) !== size.height) appAtomRegistry.set(viewportHeightAtom, size.height);
  }, [size.width, size.height]);
  return null;
}

export function useSmallViewport(): boolean {
  return useAtomValue(smallViewportAtom);
}

export function useMobileViewport(): boolean {
  return useAtomValue(mobileViewportAtom);
}

/** index.css --workspace-gutter: 0.75rem, 1.25rem from `sm`. Page headers and the chat column. */
export function workspaceGutter(small: boolean): number {
  return small ? 12 : 20;
}

/** .chat-composer-lane / .messages-timeline-scroll inline padding: 0.75rem, 3rem from `sm`. */
export function chatLanePadding(small: boolean): number {
  return small ? 12 : 48;
}

/** --workspace-titlebar-control-size: 1.75rem, `max-sm` 2rem (ui/sidebar.tsx). */
export function titlebarControlSize(small: boolean): number {
  return small ? 32 : 28;
}

/**
 * --workspace-titlebar-content-left: where page headers start their content when the
 * sidebar toggle floats at the window's left (controls-left 12 + control + gap 12).
 */
export function titlebarContentLeft(small: boolean): number {
  return 12 + titlebarControlSize(small) + 12;
}

export { THREAD_MAIN_CONTENT_MIN_WIDTH } from "../web/components/threadSidebarWidth.ts";

/**
 * The width the user dragged the rail to (web: localStorage
 * `chat_thread_sidebar_width`), null until they do. Double-clicking the rail
 * clears it.
 */
export const storedSidebarWidthAtom = persistedAtom<number | null>(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, null, (raw) =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : null,
);

/** The rail's live width while it is dragged; written to the stored width on release. */
export const sidebarDragWidthAtom = Atom.make<number | null>(null).pipe(Atom.keepAlive);

/**
 * AppSidebarLayout's minimum: the brand probe (titlebar inset, wordmark, pr-3)
 * measures about 120px, under the 13rem floor, so the floor always wins.
 */
export const THREAD_SIDEBAR_MINIMUM_WIDTH = resolveThreadSidebarMinimumWidth(0);

export function threadSidebarMaximumWidth(viewportWidth: number): number {
  return resolveThreadSidebarMaximumWidth(viewportWidth, THREAD_SIDEBAR_MINIMUM_WIDTH);
}

/**
 * `--sidebar-width`: the stored (or default) width clamped to the window, so a
 * narrower window shrinks the sidebar without forgetting the user's width.
 */
export function threadSidebarWidth(viewportWidth: number, storedWidth: number | null = null): number {
  return clampThreadSidebarWidth(
    resolveInitialThreadSidebarWidth(storedWidth, Number.POSITIVE_INFINITY),
    THREAD_SIDEBAR_MINIMUM_WIDTH,
    threadSidebarMaximumWidth(viewportWidth),
  );
}

/** The docked sidebar's width at the current window size. */
export const sidebarWidthAtom = Atom.make((get) =>
  threadSidebarWidth(get(viewportWidthAtom), get(sidebarDragWidthAtom) ?? get(storedSidebarWidthAtom)),
).pipe(Atom.keepAlive);

/** Set by the mobile sidebar sheet (app/App.tsx mobileSidebarSheetWidth). */
export const SidebarSheetWidthContext = createContext<number | null>(null);

/** The sidebar's own width: the sheet's inside it, else the docked width. */
export function useSidebarWidth(): number {
  const sheetWidth = useContext(SidebarSheetWidthContext);
  const docked = useAtomValue(sidebarWidthAtom);
  return sheetWidth ?? docked;
}

/** True inside the mobile sheet, where the sidebar header drops the brand. */
export function useInSidebarSheet(): boolean {
  return useContext(SidebarSheetWidthContext) !== null;
}
