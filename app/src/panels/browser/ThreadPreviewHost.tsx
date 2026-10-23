// What web's ChatView does for previews of the active thread, plus the floating
// mini player it renders in ChatCanvas:
// - keeps the thread's preview sessions synced (usePreviewSession)
// - reconcileBrowserSurfaces: a tab the agent opens becomes a Browser tab
// - useAgentOpenedPreviews: an agent tab that asks to be revealed floats over chat
// - ThreadPreviewMiniPlayer.tsx (browser sources): the floating server tab
//
// Mounted inside the chat canvas so the mini player paints over the timeline.
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PreviewStreamViewport } from "@t3tools/client-runtime/preview/server-browser-stream";
import { FILL_PREVIEW_VIEWPORT, type EnvironmentId, type ScopedThreadRef, type ThreadId } from "@t3tools/contracts";
import type { EventPayload } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";

import {
  closeMiniPlayer,
  miniPlayerAtom,
  moveMiniPlayer,
  openMiniPlayer,
  resizeMiniPlayer,
  returnMiniPlayerToPanel,
  showPreviewPopup,
  threadRefOf,
  usePreviewSession,
  useEnvironmentSupportsServerBrowser,
  type PreviewMiniPlayerState,
} from "../../state/preview.ts";
import { rightPanelActions, rightPanelThreadStateAtom } from "../../state/rightPanel.ts";
import { rightPanelOpenAtom } from "../../state/ui.ts";
import { useClientSettings } from "../../web/browser/clientSettings.ts";
import { type BrowserViewportResizeDirection } from "../../web/browser/browserViewportLayout.ts";
import {
  clampPreviewMiniPlayerPosition,
  PREVIEW_MINI_PLAYER_CORNER_RADIUS,
  resizePreviewMiniPlayer,
  resolvePreviewMiniPlayerFrame,
  resolvePreviewMiniPlayerSourceSize,
  type PreviewMiniPlayerFrame,
} from "../../web/components/preview/previewMiniPlayerLayout.ts";
import { useThreadPreviewState } from "../../web/previewStateStore.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { ServerBrowserSurface } from "./ServerBrowserSurface.tsx";

const HANDLE_TAP_SLOP_PX = 6;

export function ThreadPreviewHost({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const threadRef = threadRefOf(environmentId, threadId);
  const threadKey = scopedThreadKey(threadRef);
  const serverBrowser = useEnvironmentSupportsServerBrowser(environmentId);
  usePreviewSession(threadRef, serverBrowser);
  const previewState = useThreadPreviewState(threadRef);
  const panel = useAtomValue(rightPanelThreadStateAtom(threadKey));
  const miniPlayer = useAtomValue(miniPlayerAtom(threadKey));
  const panelOpen = useAtomValue(rightPanelOpenAtom);
  const autoShowFloatingPreview = useClientSettings((settings) => settings.browserAutoShowFloatingPreview);
  const previewSessionsReady = !serverBrowser || previewState.listLoaded;

  // ChatView: browser tabs follow the server's sessions.
  useEffect(() => {
    if (!previewSessionsReady) return;
    const hiddenTabIds = new Set(
      Object.values(previewState.sessions)
        .filter((session) => session.runtime === "server" && session.reveal === false)
        .map((session) => session.tabId),
    );
    rightPanelActions.reconcileBrowserSurfaces(threadKey, Object.keys(previewState.sessions), hiddenTabIds);
  }, [previewState.sessions, threadKey, previewSessionsReady]);

  // ChatView: a floating tab closes with its session.
  useEffect(() => {
    if (previewSessionsReady && miniPlayer && !previewState.sessions[miniPlayer.tabId]) closeMiniPlayer(threadRef);
  }, [miniPlayer?.tabId, previewState.sessions, threadKey, previewSessionsReady]);

  // useAgentOpenedPreviews (browser half). The first list is a baseline so a
  // restart never reopens tabs the user dismissed.
  const previousServerTabs = useRef(new Map<string, Map<string, string | undefined>>());
  useEffect(() => {
    if (!serverBrowser || !previewState.listLoaded) return;
    const serverSessions = Object.values(previewState.sessions).filter((session) => session.runtime === "server");
    const previous = previousServerTabs.current.get(threadKey);
    previousServerTabs.current.set(threadKey, new Map(serverSessions.map((session) => [session.tabId, session.revealRequest?.id])));
    if (!previous) return;
    for (const session of serverSessions) {
      const requested = session.revealRequest;
      const fresh = requested ? previous.get(session.tabId) !== requested.id : !previous.has(session.tabId);
      if (!fresh || session.reveal !== true) continue;
      if (!autoShowFloatingPreview && requested?.force !== true) continue;
      const surface = panel.surfaces.find((entry) => entry.kind === "preview" && entry.resourceId === session.tabId);
      if (surface && requested?.force === true) rightPanelActions.activate(threadKey, surface.id);
      else if (!surface) openMiniPlayer(threadRef, session.tabId);
    }
  }, [serverBrowser, previewState.listLoaded, previewState.sessions, threadKey, autoShowFloatingPreview, panel.surfaces]);

  // ChatCanvas: the mini player hides while its tab is the panel's active surface.
  const active = panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId) ?? null;
  const shownInPanel = panelOpen && active?.kind === "preview" && active.resourceId === miniPlayer?.tabId;
  if (!miniPlayer || shownInPanel || !previewState.sessions[miniPlayer.tabId]) return null;
  return <BrowserMiniPlayer key={miniPlayer.tabId} threadRef={threadRef} miniPlayer={miniPlayer} />;
}

interface Gesture {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly frame: PreviewMiniPlayerFrame;
  readonly direction: BrowserViewportResizeDirection | null;
  moved: boolean;
}

const RESIZE_HANDLES: ReadonlyArray<{
  readonly direction: BrowserViewportResizeDirection;
  readonly style: (frame: PreviewMiniPlayerFrame) => Record<string, number>;
  readonly cursor: "ns-resize" | "ew-resize" | "nwse-resize" | "nesw-resize";
}> = [
  { direction: "north", cursor: "ns-resize", style: (f) => ({ left: 0, top: -4, width: f.width, height: 8 }) },
  { direction: "south", cursor: "ns-resize", style: (f) => ({ left: 0, top: f.height - 4, width: f.width, height: 8 }) },
  { direction: "west", cursor: "ew-resize", style: (f) => ({ left: -4, top: 0, width: 8, height: f.height }) },
  { direction: "east", cursor: "ew-resize", style: (f) => ({ left: f.width - 4, top: 0, width: 8, height: f.height }) },
  { direction: "northwest", cursor: "nwse-resize", style: () => ({ left: -8, top: -8, width: 16, height: 16 }) },
  { direction: "northeast", cursor: "nesw-resize", style: (f) => ({ left: f.width - 8, top: -8, width: 16, height: 16 }) },
  { direction: "southwest", cursor: "nesw-resize", style: (f) => ({ left: -8, top: f.height - 8, width: 16, height: 16 }) },
  { direction: "southeast", cursor: "nwse-resize", style: (f) => ({ left: f.width - 8, top: f.height - 8, width: 16, height: 16 }) },
];

function BrowserMiniPlayer({ threadRef, miniPlayer }: { threadRef: ScopedThreadRef; miniPlayer: PreviewMiniPlayerState }) {
  const theme = useTheme();
  const tabId = miniPlayer.tabId;
  const previewState = useThreadPreviewState(threadRef);
  const snapshot = previewState.sessions[tabId] ?? null;
  const [container, setContainer] = useState<{ width: number; height: number } | null>(null);
  const [streamViewport, setStreamViewport] = useState<PreviewStreamViewport | null>(null);
  const [handleHovered, setHandleHovered] = useState(false);
  const gestureRef = useRef<Gesture | null>(null);
  const sourceSize = streamViewport ?? resolvePreviewMiniPlayerSourceSize(snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT, null, snapshot?.zoomFactor ?? 1);
  const frame = container
    ? resolvePreviewMiniPlayerFrame({ width: miniPlayer.width, position: miniPlayer.position, source: sourceSize, container })
    : null;
  const radius = PREVIEW_MINI_PLAYER_CORNER_RADIUS;
  const pillInset = Math.max(8, Math.round(radius * 0.55));

  const begin = (event: EventPayload, direction: BrowserViewportResizeDirection | null) => {
    if ((event.button ?? 0) !== 0 || !frame) return;
    gestureRef.current = { pointerX: event.x ?? 0, pointerY: event.y ?? 0, frame, direction, moved: false };
  };
  const move = (event: EventPayload) => {
    const gesture = gestureRef.current;
    if (!gesture || !container) return;
    const delta = { x: (event.x ?? 0) - gesture.pointerX, y: (event.y ?? 0) - gesture.pointerY };
    if (!gesture.moved && Math.hypot(delta.x, delta.y) < HANDLE_TAP_SLOP_PX) return;
    gesture.moved = true;
    if (gesture.direction === null) {
      moveMiniPlayer(
        threadRef,
        tabId,
        clampPreviewMiniPlayerPosition({ x: gesture.frame.x + delta.x, y: gesture.frame.y + delta.y }, container, gesture.frame),
      );
      return;
    }
    const next = resizePreviewMiniPlayer({ start: gesture.frame, direction: gesture.direction, delta, source: sourceSize, container });
    resizeMiniPlayer(threadRef, tabId, next.width, { x: next.x, y: next.y });
  };
  const end = () => {
    gestureRef.current = null;
  };

  return (
    <div
      onLayout={(event: EventPayload) => {
        const width = Math.round(event.width ?? 0);
        const height = Math.round(event.height ?? 0);
        if (width > 0 && height > 0) setContainer((current) => (current?.width === width && current.height === height ? current : { width, height }));
      }}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" }}
    >
      {frame ? (
        <div
          testId="preview-mini-player"
          style={{ position: "absolute", left: frame.x, top: frame.y, width: frame.width, height: frame.height, pointerEvents: "auto" }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: frame.width,
              height: frame.height,
              display: "flex",
              flexDirection: "column",
              borderRadius: radius,
              overflow: "hidden",
              backgroundColor: theme.muted,
              borderWidth: 1,
              borderColor: alpha(theme.border, 0.8),
              boxShadow: { offsetX: 0, offsetY: 25, blurRadius: 50, spreadRadius: -12, color: "#00000059" },
            }}
          >
            <ServerBrowserSurface
              testId="preview-mini-surface"
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              tabId={tabId}
              visible
              followSize={false}
              controlPosition="bottom"
              onViewport={setStreamViewport}
              onPopup={(popupTabId) => showPreviewPopup(threadRef, popupTabId, "floating")}
            />
          </div>
          {RESIZE_HANDLES.map(({ direction, style, cursor }) => (
            <div
              key={direction}
              onMouseDown={(event: EventPayload) => begin(event, direction)}
              onMouseMove={move}
              onMouseUp={end}
              style={{ position: "absolute", cursor, ...style(frame) }}
            />
          ))}
          {/* Drag handle: a dot that becomes the action pill on hover. */}
          <div
            testId="preview-mini-handle"
            onMouseEnter={() => setHandleHovered(true)}
            onMouseLeave={() => setHandleHovered(false)}
            onMouseDown={(event: EventPayload) => begin(event, null)}
            onMouseMove={move}
            onMouseUp={end}
            style={{
              position: "absolute",
              top: pillInset,
              right: pillInset,
              display: "flex",
              flexDirection: "row",
              justifyContent: "flex-end",
              cursor: "grab",
            }}
          >
            {handleHovered ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 2,
                  height: 32,
                  padding: 2,
                  borderRadius: RADIUS.lg,
                  borderWidth: 1,
                  borderColor: alpha(theme.border, 0.8),
                  backgroundColor: alpha(theme.appearance === "dark" ? "#141414" : "#ffffff", 0.92),
                }}
              >
                <PillButton icon="panel-right" label="Open in right panel" onClick={() => returnMiniPlayerToPanel(threadRef, tabId)} testId="preview-mini-open-panel" />
                <PillButton icon="x" label="Close floating preview" onClick={() => closeMiniPlayer(threadRef)} testId="preview-mini-close" />
              </div>
            ) : (
              <div style={{ width: 12, height: 12, display: "flex", justifyContent: "flex-end" }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: alpha(theme.foreground, 0.25) }} />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PillButton({ icon, label, onClick, testId }: { icon: "panel-right" | "x"; label: string; onClick: () => void; testId: string }) {
  const theme = useTheme();
  return (
    <Tooltip content={label} side="top">
      <div
        testId={testId}
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: RADIUS.md,
          cursor: "pointer",
          hover: { backgroundColor: theme.accent },
        }}
      >
        <Icon name={icon} size={14} color={theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}
