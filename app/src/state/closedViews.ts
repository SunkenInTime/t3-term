// Closed right-panel tabs, newest first, for view.reopenClosed (mod+shift+T). After
// apps/web/src/closedViewStore.ts, reopenClosedView.ts and
// components/ReopenClosedViewShortcut.tsx. Web also keeps a global pull-requests
// panel and draft-owned tabs; t3-term's right panel lives on server threads only.
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  INCOGNITO_BROWSER_PROFILE_ID,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { toast } from "../ui/toast.tsx";
import * as Panel from "../web/rightPanelStore.ts";
import { environmentCatalog, environmentShell, environmentThreadShells } from "./environment.ts";
import { isRecord, persistedAtom } from "./persistedAtom.ts";
import { routeAtom } from "./ui.ts";

export type ClosedView =
  | {
      readonly kind: "panel-tab";
      readonly threadRef: ScopedThreadRef;
      readonly surface: Exclude<Panel.RightPanelSurface, { kind: "terminal" }>;
    }
  | { readonly kind: "browser"; readonly threadRef: ScopedThreadRef; readonly snapshot: PreviewSessionSnapshot };

export type ClosedViewEntry = ClosedView & { readonly id: string };

const MAX_ENTRIES = 20;

function decodeEntries(raw: unknown): ReadonlyArray<ClosedViewEntry> {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is ClosedViewEntry =>
      isRecord(entry) &&
      typeof entry.id === "string" &&
      isRecord(entry.threadRef) &&
      typeof entry.threadRef.environmentId === "string" &&
      typeof entry.threadRef.threadId === "string" &&
      ((entry.kind === "panel-tab" && isRecord(entry.surface) && typeof entry.surface.id === "string") ||
        (entry.kind === "browser" && isRecord(entry.snapshot) && typeof entry.snapshot.tabId === "string")),
  );
}

export const closedViewsAtom = persistedAtom<ReadonlyArray<ClosedViewEntry>>("closed-views", [], decodeEntries);

function sameTarget(entry: ClosedViewEntry, view: ClosedView): boolean {
  if (entry.kind !== view.kind || scopedThreadKey(entry.threadRef) !== scopedThreadKey(view.threadRef)) return false;
  return entry.kind === "panel-tab"
    ? view.kind === "panel-tab" && entry.surface.id === view.surface.id
    : view.kind === "browser" && entry.snapshot.tabId === view.snapshot.tabId;
}

export function rememberClosedView(view: ClosedView): void {
  if (view.kind === "browser" && view.snapshot.profileId === INCOGNITO_BROWSER_PROFILE_ID) return;
  const entry = { ...view, id: globalThis.crypto.randomUUID() } as ClosedViewEntry;
  appAtomRegistry.update(closedViewsAtom, (entries) =>
    [entry, ...entries.filter((candidate) => !sameTarget(candidate, view))].slice(0, MAX_ENTRIES),
  );
}

/**
 * rightPanelStore's close subscription: tabs a close removed, the active one last so it
 * reopens first. Terminals and live browser tabs are not panel-tab history (a browser
 * tab is remembered with its session snapshot when the session closes).
 */
export function rememberClosedSurfaces(
  threadKey: string,
  before: Panel.ThreadRightPanelState,
  after: Panel.ThreadRightPanelState,
): void {
  const threadRef = parseScopedThreadKey(threadKey);
  if (!threadRef) return;
  const removed = before.surfaces.filter((surface) => !after.surfaces.some((entry) => entry.id === surface.id));
  const closedInOrder = [
    ...removed.filter((surface) => surface.id !== before.activeSurfaceId),
    ...removed.filter((surface) => surface.id === before.activeSurfaceId),
  ];
  for (const surface of closedInOrder) {
    if (surface.kind === "terminal" || (surface.kind === "preview" && surface.resourceId !== null)) continue;
    rememberClosedView({ kind: "panel-tab", threadRef, surface });
  }
}

interface ReopenOwnerState {
  readonly environmentKnown: boolean;
  readonly catalogReady: boolean;
  readonly ownerExists: boolean;
  readonly shellLive: boolean;
  readonly panel: Panel.ThreadRightPanelState;
}

/** web reopenClosedView.ts planNextReopen (verbatim logic). */
function planNextReopen(
  entries: ReadonlyArray<ClosedViewEntry>,
  ownerState: (entry: ClosedViewEntry) => ReopenOwnerState,
): { drop: ClosedViewEntry[]; restore: ClosedViewEntry | null } {
  const drop: ClosedViewEntry[] = [];
  for (const entry of entries) {
    const owner = ownerState(entry);
    if (!owner.environmentKnown) {
      if (!owner.catalogReady) break;
      drop.push(entry);
      continue;
    }
    if (!owner.ownerExists) {
      if (owner.shellLive) continue;
      break;
    }
    const alreadyOpen =
      entry.kind === "panel-tab"
        ? owner.panel.isOpen && owner.panel.surfaces.some((surface) => surface.id === entry.surface.id)
        : owner.panel.surfaces.some((surface) => surface.kind === "preview" && surface.resourceId === entry.snapshot.tabId);
    if (alreadyOpen) {
      drop.push(entry);
      continue;
    }
    return { drop, restore: entry };
  }
  return { drop, restore: null };
}

export function hasClosedViews(): boolean {
  return appAtomRegistry.get(closedViewsAtom).length > 0;
}

function removeEntry(id: string): void {
  appAtomRegistry.update(closedViewsAtom, (entries) => entries.filter((entry) => entry.id !== id));
}

function deferEntry(id: string): void {
  appAtomRegistry.update(closedViewsAtom, (entries) => {
    const entry = entries.find((candidate) => candidate.id === id);
    return entry ? [...entries.filter((candidate) => candidate.id !== id), entry] : entries;
  });
}

/** The panel's restore actions; RightPanel's state module provides them to avoid an import cycle. */
export interface ReopenPanelActions {
  readonly readState: (threadKey: string) => Panel.ThreadRightPanelState;
  readonly open: (threadKey: string, kind: Panel.SingletonKind) => void;
  readonly openFile: (threadKey: string, relativePath: string, line?: number) => void;
  readonly openPullRequest: (threadKey: string, target: Parameters<typeof Panel.pullRequestSurface>[0]) => void;
  readonly openDevice: (threadKey: string, target: Panel.DeviceTabTarget) => void;
  readonly renameDevice: (threadKey: string, surfaceId: string, title: string) => void;
  /** Reopens a browser session (openPreviewSession + openBrowser); false when the server refuses. */
  readonly openBrowserSession: (threadRef: ScopedThreadRef, snapshot: PreviewSessionSnapshot) => Promise<boolean>;
}

async function reopenClosedView(view: ClosedView, actions: ReopenPanelActions): Promise<boolean> {
  const threadKey = scopedThreadKey(view.threadRef);
  if (view.kind === "browser") return actions.openBrowserSession(view.threadRef, view.snapshot);
  const surface = view.surface;
  switch (surface.kind) {
    case "preview":
      return false;
    case "file":
      actions.openFile(threadKey, surface.relativePath, surface.revealLine ?? undefined);
      return true;
    case "device":
      if (surface.target) {
        actions.openDevice(threadKey, surface.target);
        if (surface.title) actions.renameDevice(threadKey, surface.id, surface.title);
      } else actions.open(threadKey, "device");
      return true;
    case "pull-request":
      actions.openPullRequest(threadKey, surface);
      return true;
    default:
      actions.open(threadKey, surface.kind);
      return true;
  }
}

let pending: Promise<void> = Promise.resolve();

/** web ReopenClosedViewShortcut reopenNext: restores the newest reopenable view and opens its thread. */
export function reopenNextClosedView(actions: ReopenPanelActions): void {
  pending = pending
    .then(async () => {
      const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
      const { drop, restore } = planNextReopen(appAtomRegistry.get(closedViewsAtom), (entry) => ({
        environmentKnown: catalog.entries.has(entry.threadRef.environmentId),
        catalogReady: catalog.isReady,
        ownerExists: appAtomRegistry.get(environmentThreadShells.threadShellAtom(entry.threadRef)) !== null,
        shellLive: appAtomRegistry.get(environmentShell.stateValueAtom(entry.threadRef.environmentId)).status === "live",
        panel: actions.readState(scopedThreadKey(entry.threadRef)),
      }));
      for (const entry of drop) removeEntry(entry.id);
      if (!restore) return;
      if (!(await reopenClosedView(restore, actions))) {
        deferEntry(restore.id);
        return;
      }
      removeEntry(restore.id);
      const route = appAtomRegistry.get(routeAtom);
      if (
        route.kind !== "thread" ||
        route.environmentId !== restore.threadRef.environmentId ||
        route.threadId !== restore.threadRef.threadId
      ) {
        appAtomRegistry.set(routeAtom, {
          kind: "thread",
          environmentId: restore.threadRef.environmentId,
          threadId: restore.threadRef.threadId,
        });
      }
    })
    .catch((error: unknown) => {
      toast({
        type: "error",
        title: "Could not reopen view",
        description: error instanceof Error ? error.message : String(error),
      });
    });
}
