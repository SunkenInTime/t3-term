// Port of apps/web/src/components/preview/PreviewMoreMenu.tsx for server tabs:
// hard reload, device toolbar, appearance, zoom, and the profile's cookies and
// cache. DevTools and the separate preview window are desktop-only on web too.
import type { DesktopPreviewColorScheme } from "@t3tools/contracts";
import { useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { ChromeButton } from "./PreviewChromeRow.tsx";

const COLOR_SCHEME_OPTIONS: ReadonlyArray<{ value: DesktopPreviewColorScheme; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export interface PreviewMoreMenuActions {
  readonly hardReload: () => void;
  readonly setColorScheme: (colorScheme: DesktopPreviewColorScheme) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly resetZoom: () => void;
  readonly clearCookies: () => void;
  readonly clearCache: () => void;
}

export function PreviewMoreMenu({
  enabled,
  actions,
  zoomFactor,
  colorScheme,
  deviceToolbarVisible,
  onToggleDeviceToolbar,
  profileName,
}: {
  enabled: boolean;
  actions: PreviewMoreMenuActions;
  zoomFactor: number;
  colorScheme: DesktopPreviewColorScheme;
  deviceToolbarVisible: boolean;
  onToggleDeviceToolbar: () => void;
  profileName: string | undefined;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const disabled = !enabled;
  const zoomLabel = `${Math.round(zoomFactor * 100)}%`;
  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAppearanceOpen(false);
      }}
      align="end"
      sideOffset={6}
      testId="preview-more-menu"
      trigger={({ toggle }) => <ChromeButton icon="ellipsis-vertical" label="More" onClick={toggle} testId="preview-more" />}
    >
      <MenuItem onSelect={actions.hardReload} disabled={disabled} testId="preview-more-hard-reload">
        Hard reload
      </MenuItem>
      <MenuItem onSelect={onToggleDeviceToolbar} disabled={disabled} testId="preview-more-device-toolbar">
        {deviceToolbarVisible ? "Hide device toolbar" : "Show device toolbar"}
      </MenuItem>
      <Popover
        open={appearanceOpen && !disabled}
        onOpenChange={setAppearanceOpen}
        side="left"
        align="start"
        sideOffset={4}
        style={{ padding: 4, minWidth: 128 }}
        rootStyle={{ alignItems: "stretch", flexDirection: "column" }}
        testId="preview-more-appearance-menu"
        trigger={
          <div
            testId="preview-more-appearance"
            onClick={disabled ? undefined : () => setAppearanceOpen((value) => !value)}
            onMouseEnter={disabled ? undefined : () => setAppearanceOpen(true)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              minHeight: 28,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: RADIUS.sm,
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "default" : "pointer",
              backgroundColor: appearanceOpen ? theme.accent : "#00000000",
              ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
            }}
          >
            <Text style={{ flexGrow: 1 }}>Appearance</Text>
            <Icon name="chevron-right" size={16} color={theme.mutedForeground} />
          </div>
        }
      >
        {COLOR_SCHEME_OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            checked={colorScheme === option.value}
            onSelect={() => {
              actions.setColorScheme(option.value);
              setAppearanceOpen(false);
              setOpen(false);
            }}
            testId={`preview-appearance-${option.value}`}
          >
            {option.label}
          </MenuItem>
        ))}
      </Popover>
      <MenuSeparator />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minHeight: 28,
          paddingLeft: 8,
          paddingRight: 8,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text>Zoom</Text>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          <ZoomButton icon="minus" outline disabled={disabled} onClick={actions.zoomOut} testId="preview-zoom-out" />
          <div style={{ minWidth: 48, display: "flex", justifyContent: "center" }}>
            <Text size="xs" color={theme.mutedForeground}>
              {zoomLabel}
            </Text>
          </div>
          <ZoomButton icon="plus" outline disabled={disabled} onClick={actions.zoomIn} testId="preview-zoom-in" />
          <ZoomButton icon="rotate-ccw" disabled={disabled} onClick={actions.resetZoom} testId="preview-zoom-reset" />
        </div>
      </div>
      <MenuSeparator />
      {profileName ? <MenuLabel>{`Profile: ${profileName}`}</MenuLabel> : null}
      <MenuItem onSelect={actions.clearCookies}>Clear cookies</MenuItem>
      <MenuItem onSelect={actions.clearCache}>Clear cache</MenuItem>
    </Menu>
  );
}

/** icon-xs outline/ghost buttons inside the zoom row; they keep the menu open. */
function ZoomButton({
  icon,
  outline,
  disabled,
  onClick,
  testId,
}: {
  icon: "minus" | "plus" | "rotate-ccw";
  outline?: boolean;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: RADIUS.md,
        borderWidth: outline ? 1 : 0,
        borderColor: theme.input,
        backgroundColor: outline ? alpha("#ffffff", theme.appearance === "dark" ? 0.026 : 0) : "#00000000",
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      <Icon name={icon} size={14} color={theme.mutedForeground} />
    </div>
  );
}
