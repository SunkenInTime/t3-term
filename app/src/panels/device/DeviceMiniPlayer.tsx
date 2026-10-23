// The floating device player: ThreadPreviewMiniPlayer.tsx (DeviceMiniPlayer and
// MiniPlayerShell) for device sources. "Float device over chat" opens it; it
// streams the device without the controls rail and returns to the right panel
// from its handle. Gesture and layout code follow the browser player in
// panels/browser/ThreadPreviewHost.tsx.
//
// Web keeps one floating player per thread for both sources. The browser one
// lives in the Browser surface's state, so the two coordinate from here: a
// floated device closes a floating browser tab, and a browser tab that starts
// floating closes the device player.
import { useAtomValue } from "@effect/atom-react";
import type { EventPayload } from "@gpuix/react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { chatLaneMiniPlayerAtom } from "../../chat/chatLane.tsx";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  closeDeviceMiniPlayer,
  deviceMiniPlayerAtom,
  moveDeviceMiniPlayer,
  openDeviceMiniPlayer,
  resizeDeviceMiniPlayer,
  useDeviceState,
  type DeviceMiniPlayerState,
} from "../../state/device.ts";
import { detailsCardRectAtom } from "../../state/git.ts";
import { closeMiniPlayer, miniPlayerAtom, threadRefOf } from "../../state/preview.ts";
import { rightPanelActions, rightPanelThreadStateAtom, threadKeyOf } from "../../state/rightPanel.ts";
import { rightPanelOpenAtom } from "../../state/ui.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import type { BrowserViewportResizeDirection } from "../../web/browser/browserViewportLayout.ts";
import {
  clampPreviewMiniPlayerPosition,
  PREVIEW_MINI_PLAYER_EDGE_GAP,
  resizePreviewMiniPlayer,
  resolveDeviceMiniPlayerCornerRadius,
  resolveDeviceMiniPlayerSourceSize,
  resolvePreviewMiniPlayerFrame,
  type PreviewMiniPlayerFrame,
} from "../../web/components/preview/previewMiniPlayerLayout.ts";
import { DeviceStreamView } from "./DeviceStreamView.tsx";
import type { DeviceScreenSize } from "./stream.ts";

const HANDLE_TAP_SLOP_PX = 6;
/** Two 24px icon buttons, a 2px gap, 2px padding and a 1px border each side. */
const PILL_WIDTH = 56;

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

interface Gesture {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly frame: PreviewMiniPlayerFrame;
  readonly direction: BrowserViewportResizeDirection | null;
  moved: boolean;
}

/** Mounted in the chat canvas next to the browser's ThreadPreviewHost. */
export function DeviceMiniPlayerHost({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const threadKey = threadKeyOf(environmentId, threadId);
  const miniPlayer = useAtomValue(deviceMiniPlayerAtom(threadKey));
  const browserPlayer = useAtomValue(miniPlayerAtom(threadKey));
  const panel = useAtomValue(rightPanelThreadStateAtom(threadKey));
  const panelOpen = useAtomValue(rightPanelOpenAtom);

  // One floating player per thread: a browser tab that starts floating replaces the device.
  const previousBrowserTab = useRef(browserPlayer?.tabId ?? null);
  useEffect(() => {
    const tabId = browserPlayer?.tabId ?? null;
    if (tabId !== null && tabId !== previousBrowserTab.current) closeDeviceMiniPlayer(threadKey);
    previousBrowserTab.current = tabId;
  }, [browserPlayer?.tabId, threadKey]);

  if (!miniPlayer) return null;
  // ChatCanvas: the player hides while its device is the panel's active surface.
  const active = panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId) ?? null;
  const shownInPanel =
    panelOpen &&
    active?.kind === "device" &&
    active.target?.hostId === miniPlayer.source.hostId &&
    active.target.deviceId === miniPlayer.source.deviceId;
  if (shownInPanel) return null;
  return (
    <DeviceMiniPlayer
      key={`${miniPlayer.source.hostId}\u0000${miniPlayer.source.deviceId}`}
      environmentId={environmentId}
      threadId={threadId}
      miniPlayer={miniPlayer}
    />
  );
}

/** DevicePanel floatActive: float the device over chat and close the panel. */
export function floatDevice(environmentId: EnvironmentId, threadId: ThreadId, source: DeviceMiniPlayerState["source"]): void {
  closeMiniPlayer(threadRefOf(environmentId, threadId));
  openDeviceMiniPlayer(threadKeyOf(environmentId, threadId), source);
  appAtomRegistry.set(rightPanelOpenAtom, false);
}

function DeviceMiniPlayer({
  environmentId,
  threadId,
  miniPlayer,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  miniPlayer: DeviceMiniPlayerState;
}) {
  const theme = useTheme();
  const threadKey = threadKeyOf(environmentId, threadId);
  const source = miniPlayer.source;
  const { state: deviceState } = useDeviceState(environmentId);
  const device = deviceState.devices.find((entry) => entry.hostId === source.hostId && entry.id === source.deviceId);
  const hostLabel = deviceState.hosts.find((host) => host.id === source.hostId)?.label ?? "Device host";
  const [screen, setScreen] = useState<DeviceScreenSize | null>(null);
  const [container, setContainer] = useState<{ width: number; height: number } | null>(null);
  const [handleHovered, setHandleHovered] = useState(false);
  // The pill's buttons cover the handle, and in gpuix covering ends the handle's
  // hover; handle and buttons share one hover that closes a moment after the last leave.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = useRef(new Set<string>());
  const gestureRef = useRef<Gesture | null>(null);
  const hoverGroup = {
    enter: (member: string) => {
      hovering.current.add(member);
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
      setHandleHovered(true);
    },
    leave: (member: string) => {
      hovering.current.delete(member);
      if (hovering.current.size > 0) return;
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => {
        leaveTimer.current = null;
        if (hovering.current.size === 0 && gestureRef.current === null) setHandleHovered(false);
      }, 120);
    },
  };
  useEffect(
    () => () => {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    },
    [],
  );

  const sourceSize = resolveDeviceMiniPlayerSourceSize(source.platform, screen);
  const detailsCard = useAtomValue(detailsCardRectAtom);
  const frame = container ? playerFrame(miniPlayer, sourceSize, container, detailsCard) : null;
  // The chat lane narrows to sit beside the player (chat/chatLane.tsx).
  const frameLeft = frame ? Math.round(frame.x) : null;
  const canvasWidth = container?.width ?? null;
  useEffect(() => {
    appAtomRegistry.set(chatLaneMiniPlayerAtom, frameLeft !== null && canvasWidth !== null ? { left: frameLeft, canvasWidth } : null);
  }, [frameLeft, canvasWidth]);
  useEffect(() => () => appAtomRegistry.set(chatLaneMiniPlayerAtom, null), []);
  const radius = frame ? resolveDeviceMiniPlayerCornerRadius(source.platform, frame) : 12;
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
      moveDeviceMiniPlayer(
        threadKey,
        source,
        clampPreviewMiniPlayerPosition({ x: gesture.frame.x + delta.x, y: gesture.frame.y + delta.y }, container, gesture.frame),
      );
      return;
    }
    const next = resizePreviewMiniPlayer({ start: gesture.frame, direction: gesture.direction, delta, source: sourceSize, container });
    resizeDeviceMiniPlayer(threadKey, source, next.width, { x: next.x, y: next.y });
  };
  const end = () => {
    gestureRef.current = null;
  };

  const openInPanel = () => {
    closeDeviceMiniPlayer(threadKey);
    rightPanelActions.openDevice(threadKey, source);
  };

  const probe = (
    <div
      onLayout={(event: EventPayload) => {
        const width = Math.round(event.width ?? 0);
        const height = Math.round(event.height ?? 0);
        if (width > 0 && height > 0) setContainer((current) => (current?.width === width && current.height === height ? current : { width, height }));
      }}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" }}
    />
  );
  // gpuix does not let a child re-enable pointer events under a `none` parent, so the
  // layout probe above and the player are siblings rather than one full-cover layer.
  return (
    <>
      {probe}
      {frame ? (
        <div
          testId="device-mini-player"
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
            <DeviceStreamView
              environmentId={environmentId}
              platform={source.platform}
              deviceId={source.deviceId}
              hostId={source.hostId}
              deviceName={device?.name ?? source.name}
              deviceDescription={`${hostLabel} · ${device?.version ?? source.platform}`}
              visible
              background={alpha("#000000", 0.9)}
              screenRadius={radius}
              onScreen={setScreen}
              pointerBlocked={() => hovering.current.size > 0 || gestureRef.current !== null}
            />
          </div>
          {RESIZE_HANDLES.map(({ direction, style, cursor }) => (
            <div
              key={direction}
              onMouseDown={(event: EventPayload) => begin(event, direction)}
              onMouseMove={move}
              onMouseUp={end}
              onMouseEnter={() => hovering.current.add(direction)}
              onMouseLeave={() => hovering.current.delete(direction)}
              style={{ position: "absolute", cursor, pointerEvents: "auto", ...style(frame) }}
            />
          ))}
          {/* Drag handle: a dot that becomes the action pill on hover. */}
          <div
            testId="device-mini-handle"
            onMouseEnter={() => hoverGroup.enter("handle")}
            onMouseLeave={() => hoverGroup.leave("handle")}
            onMouseDown={(event: EventPayload) => begin(event, null)}
            onMouseMove={move}
            onMouseUp={end}
            style={{
              position: "absolute",
              top: pillInset,
              left: frame.width - pillInset - (handleHovered ? PILL_WIDTH : 12),
              width: handleHovered ? PILL_WIDTH : 12,
              height: handleHovered ? 32 : 12,
              display: "flex",
              flexDirection: "row",
              alignItems: handleHovered ? "center" : "flex-start",
              justifyContent: handleHovered ? "flex-start" : "flex-end",
              gap: 2,
              padding: handleHovered ? 2 : 0,
              cursor: "grab",
              pointerEvents: "auto",
              ...(handleHovered
                ? {
                    borderRadius: RADIUS.lg,
                    borderWidth: 1,
                    borderColor: alpha(theme.border, 0.8),
                    backgroundColor: alpha(theme.appearance === "dark" ? "#141414" : "#ffffff", 0.92),
                  }
                : {}),
            }}
          >
            {handleHovered ? (
              <>
                <PillButton icon="panel-right" label="Open in right panel" hoverGroup={hoverGroup} onClick={openInPanel} testId="device-mini-open-panel" />
                <PillButton
                  icon="x"
                  label="Close floating preview"
                  hoverGroup={hoverGroup}
                  onClick={() => closeDeviceMiniPlayer(threadKey)}
                  testId="device-mini-close"
                />
              </>
            ) : (
              // A filled child takes the pointer from its parent in gpuix, hence pointerEvents none.
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: alpha(theme.background, 0.7),
                  backgroundColor: alpha(theme.foreground, 0.25),
                  boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#0000000d" },
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** chatCanvasLayout.ts: an unplaced player sits bottom-right; a dragged one stays clear of the details card. */
function playerFrame(
  miniPlayer: DeviceMiniPlayerState,
  source: { width: number; height: number },
  container: { width: number; height: number },
  detailsCard: { left: number; right: number; bottom: number } | null,
): PreviewMiniPlayerFrame {
  let frame = resolvePreviewMiniPlayerFrame({ width: miniPlayer.width, position: miniPlayer.position, source, container });
  if (miniPlayer.position === null) frame = { ...frame, y: container.height - frame.height - PREVIEW_MINI_PLAYER_EDGE_GAP };
  const obstacle = miniPlayer.lastInteraction === "resize" ? null : detailsCard;
  return { ...frame, ...clampPreviewMiniPlayerPosition(frame, container, frame, { detailsCard: obstacle, composer: null }) };
}

function PillButton({
  icon,
  label,
  onClick,
  hoverGroup,
  testId,
}: {
  icon: "panel-right" | "x";
  label: string;
  onClick: () => void;
  hoverGroup: { enter: (member: string) => void; leave: (member: string) => void };
  testId: string;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={label} side="top">
      <div
        testId={testId}
        // gpuix delivers a press to every element under the pointer, so the handle's
        // drag listeners capture the release and a click never completes here; act on press.
        onMouseDown={(event: EventPayload) => {
          if ((event.button ?? 0) === 0) onClick();
        }}
        onMouseEnter={() => hoverGroup.enter(testId)}
        onMouseLeave={() => hoverGroup.leave(testId)}
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
