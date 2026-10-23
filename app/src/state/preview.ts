// Preview (server browser) state for the Browser surface and the mini player.
//
// - previewEnvironment: apps/web/src/state/preview.ts
// - preview session sync: apps/web/src/components/preview/usePreviewSession.ts
// - stream access: apps/web/src/state/previewStream.ts
// - capability: apps/web/src/state/entities.ts (useEnvironmentSupportsServerBrowser)
// - open/close/add: apps/web/src/components/preview/{openPreviewSession,closePreviewSession,addBrowserSurface,showPreviewPopup}.ts
// - mini player: apps/web/src/previewMiniPlayerStore.ts (zustand there, an atom here)
//
// The per-thread session index itself is the ported web store in web/previewStateStore.ts.
import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { PREVIEW_STREAM_BASE_PATH } from "@t3tools/client-runtime/preview/server-browser-stream";
import { type DeviceHubAccess, resolveDeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import { createPreviewEnvironmentAtoms } from "@t3tools/client-runtime/state/preview";
import { type AtomCommandResult, mapAtomCommandResult, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  AuthPreviewOperateScope,
  type DiscoveredLocalServer,
  type EnvironmentId,
  type PreviewRuntime,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import {
  boundConfiguredLocalServerUrls,
  mergeServers,
  type PreviewableServer,
} from "../web/components/preview/discoveredLocalServers.ts";
import { browserDefaultOpenProfileId, browserDefaultOpenViewport, resolveBrowserDefaults } from "../web/browser/browserDefaults.ts";
import {
  applyPreviewServerEvent,
  applyPreviewServerSnapshot,
  beginPreviewSessionClose,
  cancelPreviewSessionClose,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  rememberPreviewUrl,
  whenPreviewTabKnown,
} from "../web/previewStateStore.ts";
import { environmentServerConfigsAtom, environmentSession } from "./environment.ts";
import { rightPanelActions, threadKeyOf } from "./rightPanel.ts";
import { rememberClosedView } from "./closedViews.ts";
import { readEnvironmentScope } from "./terminal.ts";
import { rightPanelOpenAtom } from "./ui.ts";

export const previewEnvironment = createPreviewEnvironmentAtoms(connectionAtomRuntime);

export function threadRefOf(environmentId: EnvironmentId, threadId: ThreadId | string): ScopedThreadRef {
  return scopeThreadRef(environmentId, threadId as ThreadId);
}

// ── Capability ──────────────────────────────────────────────────────────

const serverBrowserAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) => get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities.serverBrowser === true,
  ),
);
const NO_SERVER_BROWSER = Atom.make(false);

/** web: `useEnvironmentSupportsServerBrowser`. The server advertises it in its descriptor. */
export function useEnvironmentSupportsServerBrowser(environmentId: EnvironmentId | null): boolean {
  return useAtomValue(environmentId === null ? NO_SERVER_BROWSER : serverBrowserAtom(environmentId));
}

export function readEnvironmentSupportsServerBrowser(environmentId: EnvironmentId): boolean {
  return appAtomRegistry.get(serverBrowserAtom(environmentId));
}

/** web: `previewRuntimeFor`. Without a desktop bridge every tab is a server tab. */
export function previewRuntimeFor(environmentId: EnvironmentId): PreviewRuntime | undefined {
  return readEnvironmentSupportsServerBrowser(environmentId) ? "server" : undefined;
}

/** web: `isPreviewAvailableFor`. Without a desktop bridge only the server browser can preview. */
export function isPreviewAvailableFor(environmentId: EnvironmentId): boolean {
  return readEnvironmentSupportsServerBrowser(environmentId);
}

// ── Session sync (usePreviewSession) ────────────────────────────────────

const previewSessionSyncAtom = Atom.family((threadKey: string) => {
  const threadRef = parseScopedThreadKey(threadKey);
  if (threadRef === null) throw new Error(`Invalid scoped preview thread key: ${threadKey}`);

  const sessionsAtom = previewEnvironment.list({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });
  const eventsAtom = previewEnvironment.events({
    environmentId: threadRef.environmentId,
    input: {},
  });

  return Atom.make((get) => {
    let disposed = false;
    let eventsVersion = 0;

    const reconcileSessions = (result: Atom.Type<typeof sessionsAtom>) => {
      if (result.waiting || !AsyncResult.isSuccess(result)) return;
      reconcilePreviewServerSessions(threadRef, result.value);
      if (!readThreadPreviewState(threadRef).listLoaded) {
        // An event overtook the first list. Retry the authoritative baseline.
        queueMicrotask(() => {
          if (!disposed) get.refresh(sessionsAtom);
        });
      }
    };

    const applyLatestEvent = (result: Atom.Type<typeof eventsAtom>) => {
      if (!AsyncResult.isSuccess(result) || result.value.threadId !== threadRef.threadId) return;
      const currentEpoch = readThreadPreviewState(threadRef).serverEpoch;
      if (currentEpoch !== null && currentEpoch !== result.value.serverEpoch) {
        get.refresh(sessionsAtom);
        return;
      }
      applyPreviewServerEvent(threadRef, result.value);
    };

    get.addFinalizer(() => {
      disposed = true;
    });
    const initialEvent = get.once(eventsAtom);
    get.once(sessionsAtom);
    get.subscribe(sessionsAtom, (result) => reconcileSessions(result));
    get.subscribe(eventsAtom, (result) => {
      eventsVersion += 1;
      applyLatestEvent(result);
    });
    get.mount(sessionsAtom);
    get.mount(eventsAtom);
    queueMicrotask(() => {
      if (disposed) return;
      // The cached list can predate an automation-created tab; refresh it.
      const current = get.once(sessionsAtom);
      if (!AsyncResult.isInitial(current) && !current.waiting) get.refresh(sessionsAtom);
      if (eventsVersion === 0) applyLatestEvent(initialEvent);
    });
  }).pipe(Atom.setIdleTTL(1_000), Atom.withLabel(`preview:session-sync:${threadKey}`));
});

const inactiveAtom = Atom.make(() => undefined);

/** Keeps a thread's preview sessions in sync with the server while mounted. */
export function usePreviewSession(threadRef: ScopedThreadRef | null, enabled = true): void {
  useAtomValue(threadRef && enabled ? previewSessionSyncAtom(scopedThreadKey(threadRef)) : inactiveAtom);
}

// ── Stream access (state/previewStream.ts) ──────────────────────────────

const previewStreamAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(get(environmentSession.preparedConnectionValueAtom(environmentId)));
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: PREVIEW_STREAM_BASE_PATH });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`preview-stream-access:${environmentId}`)),
);

export function usePreviewStreamAccess(environmentId: EnvironmentId): DeviceHubAccess | null {
  const result = useAtomValue(previewStreamAccessAtom(environmentId));
  return AsyncResult.isSuccess(result) ? result.value : null;
}

/** Bearer connections authenticate the stream with a one-shot ticket; a reconnect needs a new one. */
export function refreshPreviewStreamAccess(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(previewStreamAccessAtom(environmentId));
}

// ── Open / close (components/preview/*) ─────────────────────────────────

export class BrowserSettingsReadError extends Data.TaggedError("BrowserSettingsReadError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return "Saved browser settings could not be loaded.";
  }
}

/** web: `openPreviewSession`. */
export async function openPreviewSession(input: {
  threadRef: ScopedThreadRef;
  url?: string;
  viewport?: PreviewViewportSetting;
  profileId?: string;
  runtime?: PreviewRuntime;
}): Promise<AtomCommandResult<PreviewSessionSnapshot, unknown>> {
  const defaults = await resolveBrowserDefaults().catch((cause: unknown) => new BrowserSettingsReadError({ cause }));
  if (defaults instanceof BrowserSettingsReadError) return AsyncResult.failure(Cause.fail(defaults));
  const runtime = input.runtime ?? previewRuntimeFor(input.threadRef.environmentId);
  const result = await runAtomCommand(appAtomRegistry, previewEnvironment.open, {
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      ...(input.url === undefined ? {} : { url: input.url }),
      viewport: input.viewport ?? browserDefaultOpenViewport(defaults),
      profileId: input.profileId ?? browserDefaultOpenProfileId(defaults),
      ...(runtime === undefined || runtime === "desktop" ? {} : { runtime }),
    },
  } as never);
  if (result._tag === "Failure") return result as AtomCommandResult<PreviewSessionSnapshot, unknown>;
  const snapshot = result.value as PreviewSessionSnapshot;
  applyPreviewServerSnapshot(input.threadRef, snapshot);
  if (input.url !== undefined) {
    rememberPreviewUrl(input.threadRef, snapshot.navStatus._tag === "Idle" ? input.url : snapshot.navStatus.url);
  }
  return AsyncResult.success(snapshot) as AtomCommandResult<PreviewSessionSnapshot, unknown>;
}

/** web: `addBrowserSurface`: opens a new server tab and shows it in the right panel. */
export async function addBrowserSurface(threadRef: ScopedThreadRef, profileId?: string) {
  const result = await openPreviewSession({ threadRef, ...(profileId === undefined ? {} : { profileId }) });
  return mapAtomCommandResult(result, (snapshot) => {
    rightPanelActions.openBrowser(scopedThreadKey(threadRef), snapshot.tabId);
  });
}

/** web: `closePreviewSession`. Hides the tab at once; restores it if the server refuses. */
export async function closePreviewSession(input: {
  readonly threadRef: ScopedThreadRef;
  readonly snapshot: PreviewSessionSnapshot | null;
  readonly tabId: string;
}) {
  beginPreviewSessionClose(input.threadRef, input.tabId);
  const result = await runAtomCommand(appAtomRegistry, previewEnvironment.close, {
    environmentId: input.threadRef.environmentId,
    input: { threadId: input.threadRef.threadId, tabId: input.tabId },
  } as never);
  if (result._tag === "Failure") cancelPreviewSessionClose(input.threadRef, input.snapshot, input.tabId);
  else if (input.snapshot) rememberClosedView({ kind: "browser", threadRef: input.threadRef, snapshot: input.snapshot });
  return result;
}

/**
 * web: `useRightPanelSurfaceClose` for browser surfaces. A closed browser tab
 * closes its server session too; without preview access only the tab goes.
 */
export function releasePreviewSurface(
  environmentId: EnvironmentId,
  threadId: ThreadId | string,
  surface: { readonly kind: string; readonly resourceId?: string | null },
): void {
  if (surface.kind !== "preview" || !surface.resourceId) return;
  if (!readEnvironmentScope(environmentId, AuthPreviewOperateScope)) return;
  const threadRef = threadRefOf(environmentId, threadId);
  void closePreviewSession({
    threadRef,
    snapshot: readThreadPreviewState(threadRef).sessions[surface.resourceId] ?? null,
    tabId: surface.resourceId,
  });
}

/** web: `showPreviewPopup`. A page's popup opens as its own tab once the server lists it. */
export function showPreviewPopup(threadRef: ScopedThreadRef, popupTabId: string, from: "panel" | "floating"): void {
  whenPreviewTabKnown(threadRef, popupTabId, () => {
    if (from === "floating") openMiniPlayer(threadRef, popupTabId);
    else rightPanelActions.openBrowser(scopedThreadKey(threadRef), popupTabId);
  });
}

// ── Mini player (previewMiniPlayerStore.ts, browser sources only) ───────

export interface PreviewMiniPlayerPosition {
  readonly x: number;
  readonly y: number;
}

export interface PreviewMiniPlayerState {
  readonly tabId: string;
  readonly position: PreviewMiniPlayerPosition | null;
  readonly width: number | null;
  readonly lastInteraction: "drag" | "resize";
}

const miniPlayersAtom = Atom.make<Record<string, PreviewMiniPlayerState>>({}).pipe(Atom.keepAlive);

export const miniPlayerAtom = Atom.family((threadKey: string) =>
  Atom.make((get) => get(miniPlayersAtom)[threadKey] ?? null),
);

function updateMiniPlayer(
  threadKey: string,
  update: (current: PreviewMiniPlayerState | null) => PreviewMiniPlayerState | null,
): void {
  appAtomRegistry.update(miniPlayersAtom, (all) => {
    const current = all[threadKey] ?? null;
    const next = update(current);
    if (next === current) return all;
    if (next === null) {
      const { [threadKey]: _closed, ...rest } = all;
      return rest;
    }
    return { ...all, [threadKey]: next };
  });
}

export function openMiniPlayer(threadRef: ScopedThreadRef, tabId: string): void {
  updateMiniPlayer(scopedThreadKey(threadRef), (current) =>
    current?.tabId === tabId
      ? current
      : {
          tabId,
          position: current?.position ?? null,
          width: current?.width ?? null,
          lastInteraction: current?.lastInteraction ?? "drag",
        },
  );
}

export function closeMiniPlayer(threadRef: ScopedThreadRef): void {
  updateMiniPlayer(scopedThreadKey(threadRef), () => null);
}

export function moveMiniPlayer(threadRef: ScopedThreadRef, tabId: string, position: PreviewMiniPlayerPosition): void {
  updateMiniPlayer(scopedThreadKey(threadRef), (current) =>
    !current || current.tabId !== tabId
      ? current
      : current.position?.x === position.x && current.position.y === position.y && current.lastInteraction === "drag"
        ? current
        : { ...current, position, lastInteraction: "drag" },
  );
}

export function resizeMiniPlayer(
  threadRef: ScopedThreadRef,
  tabId: string,
  width: number,
  position?: PreviewMiniPlayerPosition,
): void {
  updateMiniPlayer(scopedThreadKey(threadRef), (current) =>
    !current || current.tabId !== tabId
      ? current
      : { ...current, width, position: position ?? current.position, lastInteraction: "resize" },
  );
}

/** PreviewView's picture-in-picture button: float the tab over chat and close the panel. */
export function toggleMiniPlayer(threadRef: ScopedThreadRef, tabId: string): void {
  const current = appAtomRegistry.get(miniPlayerAtom(scopedThreadKey(threadRef)));
  if (current?.tabId === tabId) {
    closeMiniPlayer(threadRef);
    return;
  }
  openMiniPlayer(threadRef, tabId);
  appAtomRegistry.set(rightPanelOpenAtom, false);
}

/** The mini player's "back to panel" button. */
export function returnMiniPlayerToPanel(threadRef: ScopedThreadRef, tabId: string): void {
  closeMiniPlayer(threadRef);
  rightPanelActions.openBrowser(threadKeyOf(threadRef.environmentId, threadRef.threadId), tabId);
}

// ── Local servers (portDiscoveryState.ts + useDiscoveredLocalServers.ts) ─

const NO_DISCOVERED_SERVERS = Atom.make(AsyncResult.initial<never, never>());

/**
 * Live localhost servers on the environment, for the empty state. The server
 * browser runs on the environment's host, so loopback URLs need no rewriting
 * (web's resolveDiscoveredServerUrl only matters for desktop tabs).
 */
export function useDiscoveredLocalServers(
  environmentId: EnvironmentId | null,
  configuredUrls?: ReadonlyArray<string>,
): ReadonlyArray<PreviewableServer> {
  const bounded = boundConfiguredLocalServerUrls(configuredUrls);
  const result = useAtomValue(
    environmentId === null
      ? NO_DISCOVERED_SERVERS
      : previewEnvironment.discoveredServers({
          environmentId,
          input: bounded.length ? { configuredUrls: bounded } : {},
        } as never),
  ) as AsyncResult.AsyncResult<{ servers: ReadonlyArray<DiscoveredLocalServer>; configuredUrlProbing?: boolean }, unknown>;
  const data = AsyncResult.isSuccess(result) ? result.value : null;
  return mergeServers({
    scanner: (data?.servers ?? []).map((server) => ({ ...server, requestedUrl: server.url })),
    configuredUrls: configuredUrls ?? [],
    configuredUrlProbing: data?.configuredUrlProbing === true,
  });
}
