// Port of apps/web/src/components/device/DeviceStreamView.tsx: one device's live
// screen, its touch and keyboard input, and the controls rail beside it.
//
// Differences from web, all forced by the host:
// - Frames are painted into a gpuix <img> (setImagePixels for decoded video,
//   setImage for MJPEG) instead of a canvas; only a new frame repaints it.
// - Only the flat view exists. Web's default 3D phone (three.js scenes, GLB
//   models) needs WebGL, so 3D reports itself unavailable, the way web does on
//   a browser without WebGL.
// - gpuix has no CSS transforms, so an iOS simulator that reports landscape
//   while streaming portrait frames gets its decoded pixels rotated here.
// - There is no paste event: Ctrl+V / Shift+Insert read the clipboard directly.
import { useGpuixRequired, type EventPayload, type ImgInstance, type KeyEvent } from "@gpuix/react";
import type { DevicePlatform, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { refreshDeviceHubAccess, renewDeviceHubAccess, useDeviceHubAccess } from "../../state/device.ts";
import { readClipboardText } from "../../terminal/clipboard.ts";
import { Button, Text } from "../../ui/primitives.tsx";
import { alpha, RADIUS, useTheme } from "../../ui/theme.ts";
import { type DeviceAxElement, fetchDeviceAxTree } from "../../web/components/device/deviceHubApi.ts";
import { fitDeviceFrame } from "../../web/components/device/deviceFrameLayout.ts";
import { pageKeyInput } from "../browser/pageInput.ts";
import { DeviceAndroidFoldControls } from "./DeviceAndroidFoldControls.tsx";
import { DeviceLoadingView } from "./DeviceLoadingView.tsx";
import {
  createDeviceStreamClient,
  type DeviceFrame,
  type DeviceHardwareButton,
  type DeviceScreenSize,
  type DeviceStreamClient,
  type DeviceStreamStatus,
} from "./stream.ts";

const AX_POLL_INTERVAL_MS = 2_000;
const CONTROLS_RAIL_WIDTH = 56;
/** Web's reason when WebGL is missing, worded for this app. */
const PHONE_UNAVAILABLE_REASON = "3D is unavailable in t3-term";

function screenAspect(platform: DevicePlatform, screen: DeviceScreenSize | null): number {
  if (!screen) return platform === "ios" ? 9 / 19.5 : 9 / 20;
  const landscape = screen.orientation === "landscape_left" || screen.orientation === "landscape_right";
  const w = landscape ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const h = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  return w / h;
}

// serve-sim streams the raw framebuffer; rotate the display for a device
// that reports landscape while its frames stay portrait.
function screenRotation(platform: DevicePlatform, screen: DeviceScreenSize | null): number {
  if (platform !== "ios" || !screen || screen.width > screen.height) return 0;
  switch (screen.orientation) {
    case "landscape_left":
      return 90;
    case "landscape_right":
      return -90;
    case "portrait_upside_down":
      return 180;
    default:
      return 0;
  }
}

/** Clockwise rotation of RGBA pixels, standing in for web's CSS `rotate()`. */
function rotatePixels(frame: Extract<DeviceFrame, { kind: "pixels" }>, degrees: number) {
  const { width, height } = frame;
  const source = new Uint32Array(frame.pixels.buffer, frame.pixels.byteOffset, width * height);
  const sideways = degrees === 90 || degrees === -90;
  const outWidth = sideways ? height : width;
  const outHeight = sideways ? width : height;
  const out = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = source[y * width + x]!;
      if (degrees === 90) out[x * outWidth + (outWidth - 1 - y)] = pixel;
      else if (degrees === -90) out[(outHeight - 1 - x) * outWidth + y] = pixel;
      else out[(height - 1 - y) * width + (width - 1 - x)] = pixel;
    }
  }
  return { width: outWidth, height: outHeight, pixels: new Uint8Array(out.buffer) };
}

export interface DeviceViewControls {
  readonly phone: boolean;
  readonly streaming: boolean;
  readonly phoneUnavailableReason: string | null;
  readonly showPhone: () => void;
  readonly showFlat: () => void;
  readonly resetView: () => void;
  readonly foldingControls?: ReactNode;
  readonly keyboard: { readonly attached: boolean; readonly toggle: () => void } | null;
}

export interface DeviceStreamHandle {
  readonly pressButton: (button: DeviceHardwareButton) => void;
  readonly rotate: () => void;
  readonly inputConnected: boolean;
}

export function DeviceStreamView(props: {
  readonly environmentId: EnvironmentId;
  readonly platform: DevicePlatform;
  readonly deviceId: string;
  readonly deviceName?: string;
  readonly deviceDescription?: string;
  readonly visible: boolean;
  readonly hostId: string;
  readonly renderControls?: (view: DeviceViewControls) => ReactNode;
  readonly axOverlay?: boolean;
  readonly onHandle?: (handle: DeviceStreamHandle | null) => void;
  readonly onScreen?: (screen: DeviceScreenSize | null) => void;
  /** Web: `bg-black/90` without the phone view (the floating player), else the panel background. */
  readonly background?: string;
  /**
   * gpuix delivers a press to every element under the pointer. A host whose own
   * controls overlap the screen (the floating player's handle) reports here when
   * the pointer is on them, so the device gets no touch.
   */
  readonly pointerBlocked?: () => boolean;
  /** Corner radius of the screen image: gpuix clips an <img> by its own radius, not its parent's. */
  readonly screenRadius?: number;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const access = useDeviceHubAccess(props.environmentId, props.hostId);
  const imgRef = useRef<ImgInstance | null>(null);
  const hostElementRef = useRef<number | null>(null);
  const frameElementRef = useRef<number | null>(null);
  const clientRef = useRef<DeviceStreamClient | null>(null);
  const [status, setStatus] = useState<DeviceStreamStatus>("connecting");
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const [screen, setScreen] = useState<DeviceScreenSize | null>(null);
  const [inputState, setInputState] = useState<{ connected: boolean; detail?: string }>({ connected: false });
  const [focused, setFocused] = useState(false);
  const [host, setHost] = useState({ width: 0, height: 0 });
  const rotationRef = useRef(0);
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    if (!access || !props.visible) {
      setStatus("connecting");
      callbacks.current.onHandle?.(null);
      return;
    }
    // One upload at a time: setImagePixels waits for the UI thread, and a frame
    // that arrives meanwhile replaces the one waiting.
    let waiting: DeviceFrame | null = null;
    let scheduled = false;
    let stopped = false;
    const paint = () => {
      scheduled = false;
      const frame = waiting;
      waiting = null;
      const img = imgRef.current;
      if (stopped || !frame || !img) return;
      try {
        if (frame.kind === "jpeg") img.setImage(frame.bytes);
        else {
          const rotation = rotationRef.current;
          const shown = rotation === 0 ? frame : rotatePixels(frame, rotation);
          img.setImagePixels(shown.width, shown.height, shown.pixels, { format: "rgba" });
        }
      } catch {}
    };
    const client = createDeviceStreamClient(
      { platform: props.platform, deviceId: props.deviceId, access },
      {
        present(frame) {
          waiting = frame;
          if (!scheduled) {
            scheduled = true;
            setImmediate(paint);
          }
          return true;
        },
      },
      {
        onStatus: (next, nextDetail) => {
          setStatus(next);
          setDetail(nextDetail);
        },
        onScreen: (next) => {
          setScreen(next);
          callbacks.current.onScreen?.(next);
        },
        onUnauthorized: () => refreshDeviceHubAccess(props.environmentId),
        onInputConnected: (connected, inputDetail) => {
          setInputState({ connected, ...(inputDetail ? { detail: inputDetail } : {}) });
          callbacks.current.onHandle?.({ pressButton: client.pressButton, rotate: client.rotate, inputConnected: connected });
        },
      },
    );
    clientRef.current = client;
    setInputState({ connected: false });
    client.start();
    callbacks.current.onHandle?.({ pressButton: client.pressButton, rotate: client.rotate, inputConnected: false });
    return () => {
      stopped = true;
      client.stop();
      clientRef.current = null;
      callbacks.current.onHandle?.(null);
      callbacks.current.onScreen?.(null);
      setScreen(null);
    };
  }, [access, props.deviceId, props.environmentId, props.platform, props.visible]);

  const aspect = screenAspect(props.platform, screen);
  rotationRef.current = screenRotation(props.platform, screen);
  const controlsInset = props.renderControls ? CONTROLS_RAIL_WIDTH : 0;
  // The frame is the largest box at `aspect` that fits the host, so a narrow
  // panel shows a shorter phone rather than a squeezed one.
  const frame = fitDeviceFrame(aspect, host.width, host.height, controlsInset);

  const [axElements, setAxElements] = useState<ReadonlyArray<DeviceAxElement>>([]);
  useEffect(() => {
    if (!props.axOverlay || !access || !props.visible) return;
    const target = { access, platform: props.platform, deviceId: props.deviceId };
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const poll = async () => {
      controller = new AbortController();
      try {
        const tree = await fetchDeviceAxTree(target, controller.signal);
        if (!stopped) setAxElements(tree.elements);
      } catch {}
      if (!stopped) timer = setTimeout(() => void poll(), AX_POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
      setAxElements([]);
    };
  }, [access, props.axOverlay, props.deviceId, props.platform, props.visible]);

  const pointerActive = useRef(false);
  const normalizedPoint = (event: EventPayload) => {
    const id = frameElementRef.current;
    const bounds = id === null ? null : renderer.getElementBounds?.(id);
    if (!bounds || bounds.width < 1 || bounds.height < 1) return null;
    const x = ((event.x ?? 0) - bounds.x) / bounds.width;
    const y = ((event.y ?? 0) - bounds.y) / bounds.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };
  const focusHost = () => {
    if (hostElementRef.current !== null) renderer.focusElement?.(hostElementRef.current);
    setFocused(true);
  };

  const onKeyDown = (event: KeyEvent) => {
    const dom = pageKeyInput("down", event);
    if (!dom) return;
    const mods = event.modifiers;
    if (mods?.cmd && dom.key.toLowerCase() !== "r") return;
    if ((mods?.ctrl && dom.key.toLowerCase() === "v") || (mods?.shift && dom.key === "Insert")) {
      // Web lets the browser's paste event deliver the text.
      event.preventDefault();
      event.stopPropagation();
      void readClipboardText()
        .then((text) => {
          if (text) clientRef.current?.sendText(text);
        })
        .catch(() => {});
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clientRef.current?.sendKey({ key: dom.key, code: dom.code, metaKey: Boolean(mods?.cmd), ctrlKey: Boolean(mods?.ctrl) }, "down");
  };
  const onKeyUp = (event: KeyEvent) => {
    const dom = pageKeyInput("up", event);
    if (!dom) return;
    const mods = event.modifiers;
    clientRef.current?.sendKey({ key: dom.key, code: dom.code, metaKey: Boolean(mods?.cmd), ctrlKey: Boolean(mods?.ctrl) }, "up");
  };

  const streaming = status === "streaming";
  const view: DeviceViewControls = {
    phone: false,
    streaming,
    phoneUnavailableReason: PHONE_UNAVAILABLE_REASON,
    showPhone: () => {},
    showFlat: () => {},
    resetView: () => {},
    foldingControls:
      props.platform === "android" && access ? (
        <DeviceAndroidFoldControls
          key={`${props.hostId}:${props.deviceId}`}
          access={access}
          deviceId={props.deviceId}
          visible={props.visible}
          enabled={streaming}
          screenWidth={screen?.width}
          screenHeight={screen?.height}
          renewAccess={() => renewDeviceHubAccess(props.environmentId, props.hostId)}
        />
      ) : null,
    keyboard: null,
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        flexGrow: 1,
        width: "100%",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        backgroundColor: props.background ?? theme.background,
        ...(props.screenRadius ? { borderRadius: props.screenRadius, overflow: "hidden" } : {}),
      }}
    >
      <div
        ref={(instance: { id: number } | null) => {
          hostElementRef.current = instance?.id ?? null;
        }}
        testId="device-screen"
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onLayout={(event: EventPayload) => {
          const width = Math.round(event.width ?? 0);
          const height = Math.round(event.height ?? 0);
          setHost((current) => (current.width === width && current.height === height ? current : { width, height }));
        }}
        style={{
          position: "relative",
          display: "flex",
          flexGrow: 1,
          minHeight: 0,
          minWidth: 0,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          paddingRight: controlsInset,
        }}
      >
        <div
          ref={(instance: { id: number } | null) => {
            frameElementRef.current = instance?.id ?? null;
          }}
          testId="device-frame"
          onMouseDown={(event: EventPayload) => {
            if (event.button !== undefined && event.button !== 0) return;
            if (callbacks.current.pointerBlocked?.()) return;
            focusHost();
            const point = normalizedPoint(event);
            if (!point) return;
            pointerActive.current = true;
            clientRef.current?.sendTouch("begin", point.x, point.y);
          }}
          onMouseMove={(event: EventPayload) => {
            if (!pointerActive.current) return;
            const point = normalizedPoint(event);
            if (point) clientRef.current?.sendTouch("move", point.x, point.y);
          }}
          onMouseUp={(event: EventPayload) => {
            if (!pointerActive.current) return;
            pointerActive.current = false;
            const point = normalizedPoint(event);
            if (point) clientRef.current?.sendTouch("end", point.x, point.y);
          }}
          style={{ position: "relative", width: frame.width, height: frame.height, flexShrink: 0, userSelect: "none" }}
        >
          <img
            ref={imgRef}
            objectFit="fill"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: frame.width,
              height: frame.height,
              pointerEvents: "none",
              ...(props.screenRadius ? { borderRadius: props.screenRadius } : {}),
            }}
          />
          {axElements.map((element) => (
            <div
              key={element.id}
              style={{
                position: "absolute",
                left: element.x * frame.width,
                top: element.y * frame.height,
                width: element.width * frame.width,
                height: element.height * frame.height,
                borderWidth: 1,
                borderColor: alpha(theme.info, 0.8),
                backgroundColor: alpha(theme.info, 0.1),
                pointerEvents: "none",
              }}
            >
              {element.label ? (
                <div
                  style={{
                    position: "absolute",
                    top: -14,
                    left: 0,
                    maxWidth: "100%",
                    paddingLeft: 4,
                    paddingRight: 4,
                    borderRadius: 2,
                    backgroundColor: theme.info,
                  }}
                >
                  <text style={{ color: "#ffffff", fontSize: 10, lineHeight: 14, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                    {element.label}
                  </text>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {streaming && !inputState.connected ? (
          <BottomNotice>{`Input disconnected${inputState.detail ? ` (${inputState.detail})` : ""}, reconnecting…`}</BottomNotice>
        ) : null}
        {!streaming ? (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex" }}>
            <DeviceLoadingView
              testId="device-stream-status"
              name={props.deviceName ?? "Device"}
              description={props.deviceDescription ?? ""}
              stage="stream"
              {...(props.screenRadius ? { radius: props.screenRadius } : {})}
              message={status === "error" ? (detail ?? "Stream failed.") : "Connecting video…"}
              error={status === "error"}
            >
              {status === "error" ? (
                <Button
                  size="sm"
                  variant="outline"
                  testId="device-reconnect"
                  onClick={() => {
                    // An expired ticket surfaces as unauthorized on restart and
                    // refreshes access through the effect; no need to mint one here.
                    clientRef.current?.stop();
                    clientRef.current?.start();
                  }}
                >
                  Reconnect
                </Button>
              ) : null}
            </DeviceLoadingView>
          </div>
        ) : null}
        {focused ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderWidth: 2,
              borderColor: theme.primary,
              pointerEvents: "none",
              ...(props.screenRadius ? { borderRadius: props.screenRadius } : {}),
            }}
          />
        ) : null}
      </div>
      {props.renderControls ? props.renderControls(view) : null}
    </div>
  );
}

function BottomNotice({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        justifyContent: "center",
        padding: 8,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 4,
          paddingBottom: 4,
          borderRadius: RADIUS.md,
          backgroundColor: alpha(theme.background, 0.85),
        }}
      >
        <Text size="xs" color={theme.mutedForeground}>
          {children}
        </Text>
      </div>
    </div>
  );
}
