// Port of apps/web/src/browser/ServerBrowserSurface.tsx: one server browser tab,
// streamed as JPEG frames over the preview WebSocket and painted into a gpuix
// <img> through its ref. Pointer, wheel and keys go back as page CSS px input.
//
// Differences from web, all forced by the host: frames go to `setImage` instead
// of a canvas (it decodes synchronously on the UI thread, so a frame that
// arrives meanwhile replaces the waiting one); there is no hidden textarea,
// the surface itself takes keyboard focus; touch gestures do not exist here.
import { useGpuixRequired, type EventPayload, type ImgInstance, type KeyEvent } from "@gpuix/react";
import {
  createPreviewStreamClient,
  previewStreamControlLabel,
  previewStreamHostSetupMessage,
  type PreviewStreamClient,
  type PreviewStreamControl,
  type PreviewStreamDownload,
  type PreviewStreamFileChooser,
  type PreviewStreamInput,
  type PreviewStreamMouseButton,
  type PreviewStreamPointer,
  type PreviewStreamViewport,
} from "@t3tools/client-runtime/preview/server-browser-stream";
import type { EnvironmentId, PreviewStreamHostSetup, PreviewViewportSetting } from "@t3tools/contracts";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { refreshPreviewStreamAccess, usePreviewStreamAccess } from "../../state/preview.ts";
import { readClipboardText, writeClipboardText } from "../../terminal/clipboard.ts";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast, dismissToast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, useTheme } from "../../ui/theme.ts";
import { AgentCursorMark } from "./AgentBrowserCursor.tsx";
import { containedRect, jpegSize, pageKeyInput, pageModifiers } from "./pageInput.ts";

export interface ServerBrowserHandle {
  readonly navigate: (url: string) => void;
  readonly history: (delta: -1 | 1) => void;
  readonly reload: (options?: { readonly ignoreCache?: boolean }) => void;
  readonly viewport: (setting: PreviewViewportSetting) => void;
}

const RESIZE_THROTTLE_MS = 150;
const ACCESS_RETRY_MS = 10_000;
const MAX_UNAUTHORIZED_REFUSALS = 3;
/** Pointer moves and wheel deltas are coalesced to one message per frame, like web's rAF flush. */
const INPUT_FLUSH_MS = 16;
/**
 * The server renders pages at 2x and scales frames down to this cap. gpuix does
 * not expose the window's scale factor, so ask for 2x the box: sharp on HiDPI,
 * downsampled on 1x.
 */
const FRAME_CAP_SCALE = 2;

/**
 * Dev only. `T3TERM_DEV_AGENT_POINTER="move:200,150@1500;click:400,300@5000"`
 * replays agent pointer events (page CSS px, ms after the first frame) through
 * the stream's onPointer path, so the cursor can be screenshotted without an
 * agent run.
 */
const DEV_AGENT_POINTER: ReadonlyArray<{ phase: "move" | "click"; x: number; y: number; at: number }> = (
  process.env.T3TERM_DEV_AGENT_POINTER ?? ""
)
  .split(";")
  .flatMap((entry) => {
    const match = /^(move|click):(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)@(\d+)$/.exec(entry.trim());
    return match ? [{ phase: match[1] as "move" | "click", x: Number(match[2]), y: Number(match[3]), at: Number(match[4]) }] : [];
  });

type MouseInput = Extract<PreviewStreamInput, { type: "mouse" }>;
type WheelInput = Extract<PreviewStreamInput, { type: "wheel" }>;

interface PagePoint {
  readonly x: number;
  readonly y: number;
}

const buttonOf = (button: number | undefined): PreviewStreamMouseButton =>
  button === 0 ? "left" : button === 1 ? "middle" : button === 2 ? "right" : "none";
const buttonBit = (button: PreviewStreamMouseButton): number =>
  button === "left" ? 1 : button === "right" ? 2 : button === "middle" ? 4 : 0;

/** web: offerDownload. A toast whose Save writes the file to the Downloads folder. */
function offerDownload(download: PreviewStreamDownload) {
  const id = toast({
    type: "info",
    title: `Downloaded ${download.fileName}`,
    duration: 0,
    action: {
      label: "Save",
      onClick: () => {
        dismissToast(id);
        void saveDownload(download).then(
          (path) => toast({ type: "success", title: "Saved", description: path }),
          (cause: unknown) =>
            toast({
              type: "error",
              title: "Could not save the download",
              description: cause instanceof Error ? cause.message : undefined,
            }),
        );
      },
    },
  });
}

export async function saveDownload(download: PreviewStreamDownload): Promise<string> {
  const response = await fetch(download.url);
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const directory = NodePath.join(NodeOS.homedir(), "Downloads");
  await NodeFS.mkdir(directory, { recursive: true });
  const safeName = NodePath.basename(download.fileName).replace(/[<>:"/\\|?*]/g, "_") || "download";
  const extension = NodePath.extname(safeName);
  const stem = safeName.slice(0, safeName.length - extension.length);
  for (let attempt = 0; ; attempt += 1) {
    const path = NodePath.join(directory, attempt === 0 ? safeName : `${stem} (${attempt})${extension}`);
    try {
      await NodeFS.writeFile(path, bytes, { flag: "wx" });
      return path;
    } catch (cause) {
      if ((cause as { code?: string }).code !== "EEXIST" || attempt > 100) throw cause;
    }
  }
}

async function uploadFiles(chooser: PreviewStreamFileChooser, paths: ReadonlyArray<string>): Promise<void> {
  const body = new FormData();
  for (const path of paths) {
    body.append("file", new File([await NodeFS.readFile(path)], NodePath.basename(path)));
  }
  const response = await fetch(chooser.uploadUrl, { method: "POST", body });
  if (!response.ok) throw new Error((await response.text()) || "The upload was refused.");
}

interface AgentCursorPlacement {
  readonly phase: PreviewStreamPointer["phase"];
  readonly sequence: number;
  readonly left: number;
  readonly top: number;
}

export function ServerBrowserSurface(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly tabId: string;
  readonly visible: boolean;
  /** Hidden under the empty and error states, but still connected so a URL picked there reaches the page. */
  readonly hidden?: boolean;
  readonly followSize?: boolean;
  readonly controlPosition?: "top" | "bottom";
  readonly onFirstFrame?: () => void;
  readonly onViewport?: (viewport: PreviewStreamViewport) => void;
  readonly onControl?: (control: PreviewStreamControl | null) => void;
  readonly onPopup?: (tabId: string) => void;
  readonly handleRef?: Ref<ServerBrowserHandle>;
  /**
   * gpuix delivers a press to every element under the pointer, not only the
   * topmost. A host whose own controls overlap the page (the mini player's drag
   * handle) reports here when the pointer is on them, so the page gets no click.
   */
  readonly pointerBlocked?: () => boolean;
  readonly testId?: string;
}) {
  const {
    environmentId,
    threadId,
    tabId,
    visible,
    hidden = false,
    followSize = true,
    controlPosition = "top",
    handleRef,
  } = props;
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const access = usePreviewStreamAccess(environmentId);
  const imgRef = useRef<ImgInstance | null>(null);
  const surfaceIdRef = useRef<number | null>(null);
  const clientRef = useRef<PreviewStreamClient | null>(null);
  const viewportRef = useRef<PreviewStreamViewport | null>(null);
  const frameSizeRef = useRef<{ width: number; height: number } | null>(null);
  const sizeRef = useRef<{ width: number; height: number } | null>(null);
  const hasFrameRef = useRef(false);
  const controlRef = useRef<PreviewStreamControl | null>(null);
  const [control, setControl] = useState<PreviewStreamControl | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [fileChooser, setFileChooser] = useState<PreviewStreamFileChooser | null>(null);
  const [agentCursor, setAgentCursor] = useState<AgentCursorPlacement | null>(null);
  const unauthorizedRef = useRef(0);
  const [accessDenied, setAccessDenied] = useState(false);
  const [hostSetup, setHostSetup] = useState<PreviewStreamHostSetup | null>(null);
  const [cap, setCap] = useState<{ width: number; height: number } | null>(null);
  // The img takes the box in px: a percentage height resolves against the nearest
  // definite ancestor, which in the mini player includes the control row.
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const pendingMoveRef = useRef<MouseInput | null>(null);
  const pendingWheelRef = useRef<WheelInput | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseButtonsRef = useRef(0);
  const callbacks = useRef(props);
  callbacks.current = props;

  const send = (input: PreviewStreamInput) => {
    clientRef.current?.send(input);
  };

  const clearInput = () => {
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    pendingMoveRef.current = pendingWheelRef.current = null;
    mouseButtonsRef.current = 0;
  };

  const flushInput = () => {
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    const move = pendingMoveRef.current;
    const wheel = pendingWheelRef.current;
    pendingMoveRef.current = pendingWheelRef.current = null;
    if (move) send(move);
    if (wheel) send(wheel);
  };

  const scheduleFlush = () => {
    if (flushTimerRef.current === null) flushTimerRef.current = setTimeout(flushInput, INPUT_FLUSH_MS);
  };

  /** web pagePoint: window px → page CSS px through the contained frame rect. */
  const pagePoint = (windowX: number, windowY: number, clamp: boolean): PagePoint | null => {
    if (hidden) return null;
    const viewport = viewportRef.current;
    const frame = frameSizeRef.current;
    const elementId = surfaceIdRef.current;
    if (!viewport || !frame || !hasFrameRef.current || elementId === null) return null;
    if (controlRef.current?.controller !== "you") return null;
    const bounds = renderer.getElementBounds?.(elementId);
    if (!bounds || bounds.width < 1 || bounds.height < 1) return null;
    const rect = containedRect(bounds, frame);
    if (!(rect.width > 0 && rect.height > 0)) return null;
    const x = (windowX - bounds.x - rect.x) * (viewport.width / rect.width);
    const y = (windowY - bounds.y - rect.y) * (viewport.height / rect.height);
    const inside = x >= 0 && y >= 0 && x <= viewport.width && y <= viewport.height;
    if (!inside && !clamp) return null;
    return { x: Math.min(Math.max(x, 0), viewport.width), y: Math.min(Math.max(y, 0), viewport.height) };
  };

  useImperativeHandle(
    handleRef,
    () => ({
      navigate: (url) => send({ type: "navigate", url }),
      history: (delta) => send({ type: "history", delta }),
      reload: (options) => send({ type: "reload", ...(options?.ignoreCache ? { ignoreCache: true } : {}) }),
      viewport: (setting) => send({ type: "viewport", setting }),
    }),
    [],
  );

  // web: observeResize on the canvas parent. onLayout reports the box once per size change.
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLayout = (event: EventPayload) => {
    const width = Math.round(event.width ?? 0);
    const height = Math.round(event.height ?? 0);
    if (width < 1 || height < 1) return;
    setBox((current) => (current?.width === width && current.height === height ? current : { width, height }));
    const measure = () => {
      resizeTimer.current = null;
      const previous = sizeRef.current;
      if (previous?.width === width && previous.height === height) return;
      sizeRef.current = { width, height };
      if (followSize) clientRef.current?.send({ type: "resize", width, height });
      // Outgrowing the cap reconnects the stream, so grow it once the size settles.
      if (capTimer.current !== null) clearTimeout(capTimer.current);
      capTimer.current = setTimeout(
        () => {
          capTimer.current = null;
          const size = sizeRef.current;
          if (!size) return;
          const capWidth = Math.round(size.width * FRAME_CAP_SCALE);
          const capHeight = Math.round(size.height * FRAME_CAP_SCALE);
          setCap((current) =>
            current !== null && current.width >= capWidth && current.height >= capHeight
              ? current
              : { width: Math.max(capWidth, current?.width ?? 0), height: Math.max(capHeight, current?.height ?? 0) },
          );
        },
        previous === null ? 0 : RESIZE_THROTTLE_MS * 2,
      );
    };
    if (resizeTimer.current !== null) clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(measure, sizeRef.current === null ? 0 : RESIZE_THROTTLE_MS);
  };
  useEffect(
    () => () => {
      if (resizeTimer.current !== null) clearTimeout(resizeTimer.current);
      if (capTimer.current !== null) clearTimeout(capTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!visible || accessDenied || hostSetup || !access || !cap) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    // One decode at a time: setImage blocks until the UI thread has decoded, and
    // a frame that arrives meanwhile replaces the one waiting.
    let waiting: ArrayBuffer | null = null;
    let paintScheduled = false;
    const devPointerTimers: ReturnType<typeof setTimeout>[] = [];
    const onPointer = (pointer: PreviewStreamPointer) => {
      const placed = placeAgentCursor(pointer);
      if (placed) setAgentCursor(placed);
    };
    const paint = () => {
      paintScheduled = false;
      const jpeg = waiting;
      waiting = null;
      const img = imgRef.current;
      if (stopped || !jpeg || !img) return;
      const bytes = new Uint8Array(jpeg);
      const size = jpegSize(bytes);
      if (size) frameSizeRef.current = size;
      try {
        img.setImage(bytes);
      } catch {
        return;
      }
      if (!hasFrameRef.current) {
        hasFrameRef.current = true;
        setHasFrame(true);
        callbacks.current.onFirstFrame?.();
        DEV_AGENT_POINTER.forEach(({ at, ...pointer }, index) =>
          devPointerTimers.push(setTimeout(() => onPointer({ ...pointer, sequence: -1 - index }), at)),
        );
      }
    };
    const client = createPreviewStreamClient(
      { access, threadId, tabId, maxWidth: cap.width, maxHeight: cap.height },
      {
        onFrame: (jpeg) => {
          unauthorizedRef.current = 0;
          waiting = jpeg;
          if (!paintScheduled) {
            paintScheduled = true;
            setImmediate(paint);
          }
        },
        onPointer,
        onClipboard: (text) =>
          void writeClipboardText(text).catch(() =>
            toast({ type: "info", title: "The page copied text", action: { label: "Copy", onClick: () => void writeClipboardText(text) } }),
          ),
        onDownload: offerDownload,
        onPopup: (popupTabId) => callbacks.current.onPopup?.(popupTabId),
        onFileChooser: setFileChooser,
        onViewport: (viewport) => {
          viewportRef.current = viewport;
          callbacks.current.onViewport?.(viewport);
        },
        onControl: (next) => {
          const previous = controlRef.current;
          controlRef.current = next;
          setControl(next);
          callbacks.current.onControl?.(next);
          if (next.dialog?.message !== previous?.dialog?.message || next.dialog?.defaultValue !== previous?.dialog?.defaultValue) {
            setPromptText(next.dialog?.defaultValue ?? "");
          }
          if (next.controller !== "you") {
            clearInput();
          } else if (previous?.controller !== "you") {
            const size = sizeRef.current;
            if (followSize && size) client.send({ type: "resize", ...size });
          }
        },
        onConnectedChange: (connected) => {
          if (connected) return;
          setFileChooser(null);
          controlRef.current = null;
          setControl(null);
          callbacks.current.onControl?.(null);
          clearInput();
        },
        onHostSetup: setHostSetup,
        onUnauthorized: () => {
          const refusals = ++unauthorizedRef.current;
          if (refusals >= MAX_UNAUTHORIZED_REFUSALS) {
            setAccessDenied(true);
            return;
          }
          refreshTimer = setTimeout(
            () => refreshPreviewStreamAccess(environmentId),
            refusals === 1 ? 0 : 1_000 * 2 ** (refusals - 1),
          );
        },
      },
    );
    clientRef.current = client;
    return () => {
      stopped = true;
      devPointerTimers.forEach(clearTimeout);
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      client.stop();
      if (clientRef.current === client) clientRef.current = null;
      controlRef.current = null;
      setControl(null);
      callbacks.current.onControl?.(null);
      clearInput();
    };
  }, [access, accessDenied, cap, environmentId, followSize, hostSetup, tabId, threadId, visible]);

  useEffect(() => {
    if (!visible || accessDenied || access !== null) return;
    const timer = setInterval(() => refreshPreviewStreamAccess(environmentId), ACCESS_RETRY_MS);
    return () => clearInterval(timer);
  }, [access, accessDenied, environmentId, visible]);

  useEffect(() => () => clearInput(), []);

  function placeAgentCursor(pointer: PreviewStreamPointer): AgentCursorPlacement | null {
    const viewport = viewportRef.current;
    const frame = frameSizeRef.current;
    const box = sizeRef.current;
    if (!viewport || !frame || !box) return null;
    const rect = containedRect(box, frame);
    return {
      phase: pointer.phase,
      sequence: pointer.sequence,
      left: rect.x + (pointer.x * rect.width) / viewport.width,
      top: rect.y + (pointer.y * rect.height) / viewport.height,
    };
  }

  const youControl = control?.controller === "you";
  const overlayOpen = Boolean(control?.dialog) || (fileChooser !== null && youControl);

  const onMouseDown = (event: EventPayload) => {
    if (controlRef.current?.controller !== "you" || props.pointerBlocked?.()) return;
    if (surfaceIdRef.current !== null) renderer.focusElement?.(surfaceIdRef.current);
    const point = pagePoint(event.x ?? 0, event.y ?? 0, false);
    if (!point) return;
    flushInput();
    const button = buttonOf(event.button);
    mouseButtonsRef.current |= buttonBit(button);
    send({
      type: "mouse",
      action: "down",
      ...point,
      modifiers: pageModifiers(event.modifiers),
      button,
      buttons: mouseButtonsRef.current,
      clickCount: event.clickCount ?? 1,
    });
  };

  const onMouseUp = (event: EventPayload) => {
    if (controlRef.current?.controller !== "you" || mouseButtonsRef.current === 0) return;
    const point = pagePoint(event.x ?? 0, event.y ?? 0, true);
    if (!point) return;
    flushInput();
    const button = buttonOf(event.button);
    mouseButtonsRef.current &= ~buttonBit(button);
    send({
      type: "mouse",
      action: "up",
      ...point,
      modifiers: pageModifiers(event.modifiers),
      button,
      buttons: mouseButtonsRef.current,
      clickCount: event.clickCount ?? 1,
    });
  };

  const onMouseMove = (event: EventPayload) => {
    if (controlRef.current?.controller !== "you") return;
    const held = mouseButtonsRef.current;
    const point = pagePoint(event.x ?? 0, event.y ?? 0, held !== 0);
    if (!point) return;
    const pressed = event.pressedButton === undefined ? (held !== 0 ? "left" : "none") : buttonOf(event.pressedButton);
    pendingMoveRef.current = {
      type: "mouse",
      action: "move",
      ...point,
      modifiers: pageModifiers(event.modifiers),
      button: held === 0 ? "none" : pressed,
      buttons: held,
      clickCount: 0,
    };
    scheduleFlush();
  };

  const onScroll = (event: EventPayload) => {
    const point = pagePoint(event.x ?? 0, event.y ?? 0, false);
    if (!point) return;
    // gpuix deltas are px with positive moving content down; DOM wheel deltas are the opposite.
    const pending = pendingWheelRef.current;
    pendingWheelRef.current = {
      type: "wheel",
      ...point,
      deltaX: (pending?.deltaX ?? 0) - (event.deltaX ?? 0),
      deltaY: (pending?.deltaY ?? 0) - (event.deltaY ?? 0),
      modifiers: pageModifiers(event.modifiers),
    };
    scheduleFlush();
  };

  const handleKey = (action: "down" | "up", event: KeyEvent) => {
    if (controlRef.current?.controller !== "you") return;
    const key = (event.key ?? "").toLowerCase();
    const mods = event.modifiers;
    if (key === "escape" && mods?.shift) {
      // web: Shift+Escape leaves the page.
      event.preventDefault();
      event.stopPropagation();
      if (action === "down") renderer.blur?.();
      return;
    }
    const shortcut = Boolean(mods?.ctrl || mods?.cmd);
    if (shortcut && key === "v") {
      // web lets the native paste event deliver the text; here the clipboard is read directly.
      if (action === "down") {
        event.preventDefault();
        event.stopPropagation();
        void readClipboardText().then((text) => {
          if (text) send({ type: "text", text });
        });
      }
      return;
    }
    const input = pageKeyInput(action, event);
    if (!input) return;
    send(input);
    // Shortcuts reach the page and the app alike, as on web.
    if (shortcut) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const controlRow = (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        flexShrink: 0,
        minHeight: 32,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 4,
        paddingBottom: 4,
        backgroundColor: theme.background,
        borderColor: theme.border,
        ...(controlPosition === "bottom" ? { borderTopWidth: 1 } : { borderBottomWidth: 1 }),
      }}
    >
      <Text size="xs" color={theme.mutedForeground} testId={props.testId ? `${props.testId}-control-label` : undefined}>
        {previewStreamControlLabel(control)}
      </Text>
      {control?.canOperate ? (
        <Button
          variant="outline"
          size="xs"
          disabled={control.controller === "another-viewer"}
          onClick={() => send({ type: control.controller === "you" ? "releaseControl" : "takeControl" })}
          testId={props.testId ? `${props.testId}-control-button` : undefined}
        >
          {control.controller === "you" ? "Release control" : "Take control"}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {controlPosition === "top" ? controlRow : null}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          ...(hidden ? { opacity: 0 } : {}),
        }}
      >
        <div
          ref={(instance: { id: number } | null) => {
            surfaceIdRef.current = instance?.id ?? null;
          }}
          testId={props.testId}
          tabIndex={0}
          onLayout={onLayout}
          // A dialog or file chooser card sits over the page, or the empty and error
          // states sit under the hidden page; the page must not capture presses
          // meant for their buttons (see pointerBlocked).
          onMouseDown={overlayOpen || hidden ? undefined : onMouseDown}
          onMouseUp={overlayOpen || hidden ? undefined : onMouseUp}
          onMouseMove={overlayOpen || hidden ? undefined : onMouseMove}
          onScroll={onScroll}
          onKeyDown={(event) => handleKey("down", event)}
          onKeyUp={(event) => handleKey("up", event)}
          // Hidden under the empty or error state: let clicks reach it (gpuix has no z-index).
          style={{ position: "relative", flexGrow: 1, minHeight: 0, overflow: "hidden", pointerEvents: hidden ? "none" : "auto" }}
        >
          <img
            ref={imgRef}
            objectFit="contain"
            style={{ width: box?.width ?? 0, height: box?.height ?? 0, opacity: hasFrame ? 1 : 0, pointerEvents: "none" }}
          />
          {agentCursor && !youControl && !hidden ? (
            <AgentCursorMark {...agentCursor} controller={control?.controller === "agent" ? "agent" : "none"} />
          ) : null}
        </div>
        {fileChooser && youControl ? (
          <OverlayCard testId={props.testId ? `${props.testId}-file-chooser` : undefined}>
            <Text>The page asks for {fileChooser.multiple ? "files" : "a file"}.</Text>
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const chooser = fileChooser;
                  setFileChooser(null);
                  void uploadFiles(chooser, []).catch(() => undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const chooser = fileChooser;
                  void renderer
                    .promptForPaths?.({ files: true, directories: false, multiple: chooser.multiple })
                    .then((paths: string[] | null) => {
                      if (!paths || paths.length === 0) return;
                      setFileChooser(null);
                      return uploadFiles(chooser, paths);
                    })
                    .catch((cause: unknown) =>
                      toast({
                        type: "error",
                        title: "Could not send the files to the page",
                        description: cause instanceof Error ? cause.message : undefined,
                      }),
                    );
                }}
              >
                {`Choose ${fileChooser.multiple ? "files" : "file"}`}
              </Button>
            </div>
          </OverlayCard>
        ) : null}
        {control?.dialog ? (
          <OverlayCard testId={props.testId ? `${props.testId}-dialog` : undefined}>
            <Text>{control.dialog.message}</Text>
            {control.controller === "you" ? (
              <>
                {control.dialog.type === "prompt" ? (
                  <input
                    testId={props.testId ? `${props.testId}-dialog-input` : undefined}
                    value={promptText}
                    onChange={(event: EventPayload) => setPromptText(String(event.value ?? ""))}
                    theme={{ caret: theme.foreground }}
                    style={{
                      height: 32,
                      paddingLeft: 10,
                      paddingRight: 10,
                      borderRadius: RADIUS.md,
                      borderWidth: 1,
                      borderColor: theme.input,
                      fontSize: 14,
                      fontFamily: FONTS.sans,
                      color: theme.foreground,
                    }}
                  />
                ) : null}
                <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                  <Button variant="outline" size="sm" onClick={() => send({ type: "dialog", accept: false })}>
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      send({ type: "dialog", accept: true, ...(control.dialog?.type === "prompt" ? { promptText } : {}) })
                    }
                    testId={props.testId ? `${props.testId}-dialog-accept` : undefined}
                  >
                    Accept
                  </Button>
                </div>
              </>
            ) : (
              <Text size="xs" color={theme.mutedForeground}>
                Take control to respond.
              </Text>
            )}
          </OverlayCard>
        ) : null}
      </div>
      {controlPosition === "bottom" ? controlRow : null}
      {visible && hostSetup ? (
        <FullCover>
          <Text color={theme.mutedForeground} style={{ maxWidth: 384, textAlign: "center" }}>
            {previewStreamHostSetupMessage(hostSetup)}
          </Text>
          <div
            style={{
              width: "100%",
              maxWidth: 448,
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: RADIUS.md,
              backgroundColor: theme.muted,
            }}
          >
            <text style={{ color: theme.foreground, fontFamily: FONTS.mono, fontSize: 12, lineHeight: 18 }}>{hostSetup.command}</text>
          </div>
          <Button variant="outline" size="sm" onClick={() => setHostSetup(null)}>
            Try again
          </Button>
        </FullCover>
      ) : null}
      {visible && accessDenied ? (
        <FullCover>
          <Text size="xs" color={theme.mutedForeground}>
            Browser connection was refused.
          </Text>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              unauthorizedRef.current = 0;
              setAccessDenied(false);
              refreshPreviewStreamAccess(environmentId);
            }}
          >
            Reconnect
          </Button>
        </FullCover>
      ) : null}
    </div>
  );
}

/** web: the absolute `inset-x-2 top-2` cards for dialogs and file choosers. */
function OverlayCard({ children, testId }: { children: React.ReactNode; testId?: string | undefined }) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        right: 8,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.background,
        boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 15, spreadRadius: -3, color: "#00000040" },
        pointerEvents: "auto",
      }}
    >
      {children}
    </div>
  );
}

function FullCover({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 16,
        backgroundColor: theme.background,
        pointerEvents: "auto",
      }}
    >
      {children}
    </div>
  );
}
