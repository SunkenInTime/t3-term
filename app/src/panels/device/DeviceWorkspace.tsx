// Port of apps/web/src/components/device/DeviceWorkspace.tsx: the open device's
// stream, controls rail and tools panel. A saved screenshot goes to the
// Downloads folder (web downloads it through the browser).
import type { DeviceSummary, EnvironmentId } from "@t3tools/contracts";
import type { EventPayload } from "@gpuix/react";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { useEffect, useRef, useState } from "react";

import { refreshDeviceHubAccess, useDeviceHubAccess } from "../../state/device.ts";
import { Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { useTheme } from "../../ui/theme.ts";
import { DeviceControlsRail } from "./DeviceControlsRail.tsx";
import { captureDeviceScreenshot, DeviceScreenshotError } from "./screenshot.ts";
import { DeviceStreamView, type DeviceStreamHandle } from "./DeviceStreamView.tsx";
import { DeviceToolsPanel, TOOLS_PANEL_WIDTH } from "./DeviceToolsPanel.tsx";
import { useDeviceControls } from "./useDeviceControls.ts";

/** web: the tools panel sits beside the stream from a 700px container (`@[700px]:static`). */
const TOOLS_SIDE_BY_SIDE_WIDTH = 700;

async function saveScreenshotFile(deviceName: string, image: Blob): Promise<string> {
  const directory = NodePath.join(NodeOS.homedir(), "Downloads");
  await NodeFS.mkdir(directory, { recursive: true });
  const path = NodePath.join(directory, `${deviceName.replace(/[^a-z0-9-]/gi, "-")}-${Date.now()}.png`);
  await NodeFS.writeFile(path, new Uint8Array(await image.arrayBuffer()), { flag: "wx" });
  return path;
}

export function DeviceWorkspace(props: {
  environmentId: EnvironmentId;
  device: DeviceSummary;
  hostLabel: string;
  hostDiagnostics: string | undefined;
  visible: boolean;
  onFloat?: () => void;
  onClose: () => void;
  onPowerOff: () => void;
}) {
  const theme = useTheme();
  const [handle, setHandle] = useState<DeviceStreamHandle | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [axOverlay, setAxOverlay] = useState(false);
  const [screenshotPending, setScreenshotPending] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const captureRef = useRef<AbortController | null>(null);
  const access = useDeviceHubAccess(props.environmentId, props.device.hostId);
  const controls = useDeviceControls({ ...props, access });
  useEffect(() => {
    if (!access || !props.visible) captureRef.current?.abort();
    return () => captureRef.current?.abort();
  }, [access, props.visible]);
  const saveScreenshot = () => {
    if (!access || captureRef.current || !props.visible) return;
    const controller = new AbortController();
    captureRef.current = controller;
    setScreenshotPending(true);
    setScreenshotError(null);
    return captureDeviceScreenshot({ access, platform: props.device.platform, deviceId: props.device.id }, controller.signal)
      .then(async (image) => {
        if (controller.signal.aborted) return;
        const path = await saveScreenshotFile(props.device.name, image);
        toast({ type: "success", title: "Screenshot saved", description: path });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          if (cause instanceof DeviceScreenshotError && cause.status === 401) refreshDeviceHubAccess(props.environmentId);
          setScreenshotError(cause instanceof Error ? cause.message : "Screenshot capture failed. Try again.");
        }
      })
      .finally(() => {
        if (captureRef.current === controller) {
          captureRef.current = null;
          setScreenshotPending(false);
        }
      });
  };
  const sideBySide = width >= TOOLS_SIDE_BY_SIDE_WIDTH;
  const tools = toolsOpen ? (
    <DeviceToolsPanel
      device={props.device}
      controls={controls}
      hostDiagnostics={props.hostDiagnostics}
      access={access}
      axOverlay={axOverlay}
      onAxOverlayChange={setAxOverlay}
      onClose={() => setToolsOpen(false)}
      overlay={!sideBySide}
    />
  ) : null;
  return (
    <div
      onLayout={(event: EventPayload) => setWidth(Math.round(event.width ?? 0))}
      style={{ position: "relative", display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, minWidth: 0 }}
    >
      <div style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
        {screenshotError || (controls.error && !toolsOpen) ? (
          <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, flexShrink: 0 }}>
            <Text size="xs" color={theme.errorForeground}>
              {screenshotError ?? controls.error ?? ""}
            </Text>
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
          <DeviceStreamView
            environmentId={props.environmentId}
            platform={props.device.platform}
            deviceName={props.device.name}
            deviceDescription={`${props.hostLabel} · ${props.device.version}`}
            deviceId={props.device.id}
            hostId={props.device.hostId}
            visible={props.visible}
            axOverlay={axOverlay}
            onHandle={setHandle}
            renderControls={(view) => (
              <DeviceControlsRail
                platform={props.device.platform}
                handle={handle}
                view={view}
                controls={controls}
                screenshotPending={screenshotPending}
                onScreenshot={() => void saveScreenshot()}
                toolsOpen={toolsOpen}
                onTools={() => setToolsOpen(!toolsOpen)}
                {...(props.onFloat ? { onFloat: props.onFloat } : {})}
                onClose={props.onClose}
                onPowerOff={props.onPowerOff}
              />
            )}
          />
        </div>
      </div>
      {tools && sideBySide ? <div style={{ display: "flex", width: TOOLS_PANEL_WIDTH, flexShrink: 0, overflow: "hidden" }}>{tools}</div> : null}
      {tools && !sideBySide ? (
        <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: Math.min(TOOLS_PANEL_WIDTH, width), display: "flex", overflow: "hidden" }}>
          {tools}
        </div>
      ) : null}
    </div>
  );
}
