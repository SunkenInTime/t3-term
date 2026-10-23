// Port of apps/web/src/components/device/DeviceControlsRail.tsx: the pill of
// hardware buttons, device settings and view switches on the stream's right.
import type { DevicePlatform } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Menu, MenuItem, MenuSeparator, Tooltip } from "../../ui/overlay.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import type { DeviceStreamHandle, DeviceViewControls } from "./DeviceStreamView.tsx";
import type { DeviceControls } from "./useDeviceControls.ts";

const TEXT_SIZES = [
  ["small", "Small"],
  ["default", "Default"],
  ["large", "Large"],
  ["extra-large", "Extra large"],
] as const;

export function DeviceControlsRail(props: {
  platform: DevicePlatform;
  handle: DeviceStreamHandle | null;
  view: DeviceViewControls;
  controls: DeviceControls;
  screenshotPending: boolean;
  onScreenshot: () => void;
  toolsOpen: boolean;
  onTools: () => void;
  onFloat?: () => void;
  onClose: () => void;
  onPowerOff: () => void;
}) {
  const theme = useTheme();
  const { view, handle, controls } = props;
  const settings = controls.detail?.settings;
  const inputDisabled = !handle?.inputConnected;
  const nextAppearance = settings?.appearance === "dark" ? "light" : "dark";
  return (
    <div
      testId="device-controls"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 0,
        width: 56,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingTop: 12,
        paddingBottom: 12,
        paddingRight: 8,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          flexShrink: 0,
          padding: 8,
          borderRadius: 9999,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.5),
          backgroundColor: alpha(theme.background, 0.8),
          boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#0000000d" },
          pointerEvents: "auto",
        }}
      >
        <RailButton testId="device-home" label="Home" icon="house" disabled={inputDisabled} onClick={() => handle?.pressButton("home")} />
        {props.platform === "android" ? (
          <>
            <RailButton testId="device-back" label="Back" icon="chevron-left" disabled={inputDisabled} onClick={() => handle?.pressButton("back")} />
            <RailButton
              testId="device-recents"
              label="Recents"
              icon="square"
              disabled={inputDisabled}
              onClick={() => handle?.pressButton("recents")}
            />
            <Menu
              side="left"
              minWidth={128}
              testId="device-rotate"
              trigger={({ open, toggle }) => (
                <RailButton testId="device-rotate-trigger" label="Rotate device" icon="rotate-ccw" pressed={open} disabled={controls.disabled} onClick={toggle} />
              )}
            >
              <MenuItem testId="device-rotate-portrait" onSelect={() => void controls.act({ type: "setOrientation", value: "portrait" })}>
                Portrait
              </MenuItem>
              <MenuItem testId="device-rotate-landscape" onSelect={() => void controls.act({ type: "setOrientation", value: "landscape_left" })}>
                Landscape
              </MenuItem>
            </Menu>
          </>
        ) : (
          <RailButton
            testId="device-rotate"
            label="Rotate device"
            icon="rotate-ccw"
            disabled={inputDisabled || Boolean(view.keyboard?.attached)}
            onClick={() => handle?.rotate()}
          />
        )}
        <RailDivider />
        <RailButton
          testId="device-appearance"
          label={`Switch device to ${nextAppearance} mode`}
          icon={settings?.appearance === "dark" ? "sun" : "moon"}
          disabled={controls.disabled || !settings?.appearance}
          onClick={() => void controls.act({ type: "setAppearance", value: nextAppearance })}
        />
        <Menu
          side="left"
          minWidth={160}
          testId="device-text-size"
          trigger={({ open, toggle }) => (
            <RailButton
              testId="device-text-size-trigger"
              label="Device text size"
              icon="type"
              pressed={open}
              disabled={controls.disabled || !settings?.textSize}
              onClick={toggle}
            />
          )}
        >
          {TEXT_SIZES.map(([value, label]) => (
            <MenuItem
              key={value}
              checked={settings?.textSize === value}
              onSelect={() => {
                if (settings?.textSize !== value) void controls.act({ type: "setTextSize", value });
              }}
            >
              {label}
            </MenuItem>
          ))}
        </Menu>
        <RailButton testId="device-tools" label="Device tools" icon="sliders-horizontal" pressed={props.toolsOpen} onClick={props.onTools} />
        <RailButton
          testId="device-screenshot"
          label={props.screenshotPending ? "Capturing screenshot" : "Save screenshot"}
          icon="camera"
          disabled={!view.streaming || props.screenshotPending}
          onClick={props.onScreenshot}
        />
        <Menu
          side="left"
          align="end"
          minWidth={192}
          testId="device-more"
          trigger={({ open, toggle }) => (
            <RailButton testId="device-more-trigger" label="More device actions" icon="ellipsis" pressed={open} onClick={toggle} />
          )}
        >
          {props.onFloat ? (
            <MenuItem icon="picture-in-picture-2" testId="device-float" onSelect={props.onFloat}>
              Float device over chat
            </MenuItem>
          ) : null}
          <MenuItem icon="x" testId="device-close" onSelect={props.onClose}>
            Close device panel
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="power" destructive testId="device-power-off" onSelect={props.onPowerOff}>
            Power off device
          </MenuItem>
        </Menu>
        <RailDivider />
        <RailButton
          testId="device-view-3d"
          label="3D view"
          icon="box"
          pressed={view.phone}
          disabled={!view.streaming || Boolean(view.phoneUnavailableReason)}
          description={view.phoneUnavailableReason ?? undefined}
          onClick={view.showPhone}
        />
        <RailButton testId="device-view-flat" label="Flat view" icon="smartphone" pressed={!view.phone} disabled={!view.streaming} onClick={view.showFlat} />
        {view.keyboard ? (
          <RailButton
            label={view.keyboard.attached ? "Detach Magic Keyboard" : "Attach Magic Keyboard"}
            icon="keyboard"
            pressed={view.keyboard.attached}
            onClick={view.keyboard.toggle}
          />
        ) : null}
        {view.phone ? <RailButton label="Restore 3D view" icon="maximize" onClick={view.resetView} /> : null}
      </div>
      {view.foldingControls}
    </div>
  );
}

function RailDivider() {
  const theme = useTheme();
  return <div style={{ marginTop: 4, marginBottom: 4, height: 1, width: 20, flexShrink: 0, backgroundColor: alpha(theme.border, 0.7) }} />;
}

/** web RailButton: an icon-sm Button, secondary while pressed, with a left tooltip. */
function RailButton(props: {
  label: string;
  icon: IconName;
  description?: string | undefined;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  testId?: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={props.description ?? props.label} side="left">
      <div
        testId={props.testId}
        onClick={props.disabled ? undefined : props.onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 8,
          flexShrink: 0,
          backgroundColor: props.pressed ? theme.secondary : "#00000000",
          opacity: props.disabled ? 0.64 : 1,
          cursor: props.disabled ? "default" : "pointer",
          ...(props.disabled ? {} : { hover: { backgroundColor: theme.accent } }),
        }}
      >
        <Icon name={props.icon} size={16} color={theme.foreground} />
      </div>
    </Tooltip>
  );
}
