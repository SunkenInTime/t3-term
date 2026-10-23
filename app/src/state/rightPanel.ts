// Right panel state per thread: which surfaces are open, which one is active,
// the panel width. The web client keeps this in rightPanelStore (zustand +
// localStorage); here it is one persisted atom driven by the same reducers.
//
// Visibility is the shared `rightPanelOpenAtom` (the header toggle), and
// `rightPanelSurfaceAtom` is the shared "show this kind" request other areas
// write. RightPanel keeps the latter in sync with the active surface, so a
// write that names another kind is always a fresh request.
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import * as Panel from "../web/rightPanelStore.ts";
import { isRecord, persistedAtom } from "./persistedAtom.ts";
import { rightPanelOpenAtom, rightPanelSurfaceAtom, routeAtom, type RightPanelSurface as SharedSurfaceKind } from "./ui.ts";

export type { RightPanelSurface, ThreadRightPanelState } from "../web/rightPanelStore.ts";

export const RIGHT_PANEL_DEFAULT_WIDTH = 540;
export const RIGHT_PANEL_MIN_WIDTH = 360;
export const RIGHT_PANEL_MAX_WIDTH_FRACTION = 0.7;
/** Floor for the chat column beside the panel; below it the composer overflows. */
export const RIGHT_PANEL_SIBLING_MIN_WIDTH = 360;

function decodeStates(raw: unknown): Record<string, Panel.ThreadRightPanelState> {
  if (!isRecord(raw)) return {};
  const result: Record<string, Panel.ThreadRightPanelState> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value) || !Array.isArray(value.surfaces)) continue;
    const surfaces = (value.surfaces as Panel.RightPanelSurface[]).filter(
      (surface) => isRecord(surface) && typeof surface.id === "string" && typeof surface.kind === "string",
    );
    const activeSurfaceId =
      typeof value.activeSurfaceId === "string" && surfaces.some((surface) => surface.id === value.activeSurfaceId)
        ? value.activeSurfaceId
        : (surfaces[0]?.id ?? null);
    result[key] = {
      isOpen: value.isOpen === true,
      surfaces,
      activeSurfaceId,
      ...(value.maximized === true ? { maximized: true as const } : {}),
    };
  }
  return result;
}

export const rightPanelStatesAtom = persistedAtom("right-panel", {}, decodeStates);

function decodeWidths(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

/** Per-thread panel width, like web's `t3code:preview-panel-width:<threadKey>`. */
export const rightPanelWidthsAtom = persistedAtom("right-panel-width", {}, decodeWidths);

/** The tab bar's add-surface menu; `rightPanel.new` (mod+T, panel open, terminal unfocused) opens it. */
export const rightPanelAddMenuOpenAtom = Atom.make(false).pipe(Atom.keepAlive);

export function threadKeyOf(environmentId: EnvironmentId | string, threadId: ThreadId | string): string {
  return scopedThreadKey({ environmentId, threadId } as ScopedThreadRef);
}

export const rightPanelThreadStateAtom = Atom.family((threadKey: string) =>
  Atom.make((get) => get(rightPanelStatesAtom)[threadKey] ?? Panel.EMPTY_THREAD_STATE),
);

export const rightPanelWidthAtom = Atom.family((threadKey: string) =>
  Atom.make((get) => get(rightPanelWidthsAtom)[threadKey] ?? RIGHT_PANEL_DEFAULT_WIDTH),
);

export function setRightPanelWidth(threadKey: string, width: number): void {
  appAtomRegistry.update(rightPanelWidthsAtom, (current) =>
    current[threadKey] === width ? current : { ...current, [threadKey]: width },
  );
}

/** The shared request vocabulary is coarser than the surface kinds. */
export function sharedKindOf(surface: Panel.RightPanelSurface | null): SharedSurfaceKind | null {
  switch (surface?.kind) {
    case "terminal":
      return "terminal";
    case "files":
    case "file":
      return "files";
    case "diff":
      return "diff";
    case "pull-request":
    case "pull-requests":
      return "pull-request";
    default:
      return null;
  }
}

/** The last value RightPanel wrote to `rightPanelSurfaceAtom`, so it can tell its own writes from requests. */
export const lastSyncedSharedKind: { current: SharedSurfaceKind | null } = {
  current: appAtomRegistry.get(rightPanelSurfaceAtom),
};

export function updateRightPanel(
  threadKey: string,
  updater: (current: Panel.ThreadRightPanelState) => Panel.ThreadRightPanelState,
): Panel.ThreadRightPanelState {
  let next: Panel.ThreadRightPanelState = Panel.EMPTY_THREAD_STATE;
  appAtomRegistry.update(rightPanelStatesAtom, (states) => {
    const current = states[threadKey] ?? Panel.EMPTY_THREAD_STATE;
    next = updater(current);
    if (next === current) return states;
    if (next.surfaces.length === 0 && next.activeSurfaceId === null && next.maximized === undefined) {
      const { [threadKey]: _removed, ...rest } = states;
      return rest;
    }
    return { ...states, [threadKey]: next };
  });
  syncSharedAtoms(next);
  return next;
}

function syncSharedAtoms(state: Panel.ThreadRightPanelState): void {
  const kind = sharedKindOf(Panel.selectedSurface(state));
  if (kind !== null && appAtomRegistry.get(rightPanelSurfaceAtom) !== kind) {
    lastSyncedSharedKind.current = kind;
    appAtomRegistry.set(rightPanelSurfaceAtom, kind);
  }
}

/** Opens the panel (the shared toggle) after an action that shows a surface. */
function reveal(state: Panel.ThreadRightPanelState): void {
  if (state.activeSurfaceId !== null && !appAtomRegistry.get(rightPanelOpenAtom)) {
    appAtomRegistry.set(rightPanelOpenAtom, true);
  }
}

export const rightPanelActions = {
  open(threadKey: string, kind: Panel.SingletonKind | "preview") {
    reveal(updateRightPanel(threadKey, (current) => Panel.openSingleton(current, kind)));
  },
  openFile(threadKey: string, relativePath: string, line?: number) {
    reveal(updateRightPanel(threadKey, (current) => Panel.openFile(current, relativePath, line)));
  },
  navigateFolder(threadKey: string, surfaceId: string, relativePath: string, folderTrail: string, keepSource?: boolean) {
    reveal(
      updateRightPanel(threadKey, (current) =>
        Panel.navigateFolder(current, surfaceId, relativePath, folderTrail, keepSource),
      ),
    );
  },
  openPullRequest(threadKey: string, target: Parameters<typeof Panel.pullRequestSurface>[0]) {
    reveal(updateRightPanel(threadKey, (current) => Panel.openPullRequest(current, target)));
  },
  openTerminal(threadKey: string, terminalId: string) {
    reveal(updateRightPanel(threadKey, (current) => Panel.openTerminal(current, terminalId)));
  },
  splitTerminal(threadKey: string, surfaceId: string, terminalId: string, direction?: "horizontal" | "vertical") {
    updateRightPanel(threadKey, (current) => Panel.splitTerminal(current, surfaceId, terminalId, direction));
  },
  activateTerminal(threadKey: string, surfaceId: string, terminalId: string) {
    updateRightPanel(threadKey, (current) => Panel.activateTerminal(current, surfaceId, terminalId));
  },
  closeTerminal(threadKey: string, surfaceId: string, terminalId: string) {
    updateRightPanel(threadKey, (current) => Panel.closeTerminal(current, surfaceId, terminalId));
  },
  activate(threadKey: string, surfaceId: string) {
    updateRightPanel(threadKey, (current) => Panel.activateSurface(current, surfaceId));
  },
  close(threadKey: string, surfaceId: string) {
    updateRightPanel(threadKey, (current) => Panel.closeSurface(current, surfaceId));
  },
  closeOthers(threadKey: string, surfaceId: string) {
    updateRightPanel(threadKey, (current) => Panel.closeOtherSurfaces(current, surfaceId));
  },
  closeToRight(threadKey: string, surfaceId: string) {
    updateRightPanel(threadKey, (current) => Panel.closeSurfacesToRight(current, surfaceId));
  },
  closeAll(threadKey: string) {
    updateRightPanel(threadKey, Panel.closeAllSurfaces);
  },
  move(threadKey: string, surfaceId: string, toIndex: number) {
    updateRightPanel(threadKey, (current) => Panel.moveSurface(current, surfaceId, toIndex));
  },
  setMaximized(threadKey: string, maximized: boolean) {
    updateRightPanel(threadKey, (current) => Panel.setMaximized(current, maximized));
  },
};

/** The thread the main view shows, or null on home, drafts and settings. */
export function activeThreadKey(): string | null {
  const route = appAtomRegistry.get(routeAtom);
  return route.kind === "thread" ? threadKeyOf(route.environmentId, route.threadId) : null;
}

/** Opens a workspace file in the active thread's right panel (file picker, chat links). */
export function openFileInActiveThread(relativePath: string, line?: number): boolean {
  const threadKey = activeThreadKey();
  if (threadKey === null) return false;
  rightPanelActions.openFile(threadKey, relativePath, line);
  return true;
}
