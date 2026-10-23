// Port of apps/web/src/browser/BrowserDeviceToolbar.tsx: preset picker, width ×
// height fields, aspect lock, rotate, and close (back to fill). Shown above a
// server tab whose viewport is not "fill"; the page frame letterboxes below it.
import type { EventPayload } from "@gpuix/react";
import {
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import { PREVIEW_VIEWPORT_PRESETS, resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import { useState } from "react";

import { BROWSER_DEVICE_TOOLBAR_HEIGHT, resizeFreeformViewport } from "../../web/browser/browserViewportLayout.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Menu, MenuItem, MenuLabel } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { ChromeButton } from "./PreviewChromeRow.tsx";

const RESPONSIVE_VALUE = "responsive";

const ROTATE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="7.25" y="7.25" width="9.5" height="9.5" rx="1.4" transform="rotate(-45 12 12)"/><path d="M12.5 2a10 10 0 0 1 8.4 5.4"/><path d="M20.8 3.5v4h-4"/><path d="M11.5 22a10 10 0 0 1-8.4-5.4"/><path d="M3.2 20.5v-4h4"/></svg>`;

export function BrowserDeviceToolbar({
  setting,
  width,
  aspectRatio,
  onAspectRatioChange,
  onChange,
}: {
  readonly setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>;
  readonly width: number;
  readonly aspectRatio: number | null;
  readonly onAspectRatioChange: (aspectRatio: number | null) => void;
  readonly onChange: (setting: PreviewViewportSetting) => Promise<void>;
}) {
  const theme = useTheme();
  const [pending, setPending] = useState(false);
  const [customSize, setCustomSize] = useState<{ readonly width: string; readonly height: string } | null>(null);
  const presentedSize = customSize ?? { width: String(setting.width), height: String(setting.height) };
  const selectedValue =
    setting._tag === "preset" && PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === setting.presetId)
      ? setting.presetId
      : RESPONSIVE_VALUE;
  const selectedLabel =
    selectedValue === RESPONSIVE_VALUE
      ? "Responsive"
      : (PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === selectedValue)?.label ?? "Responsive");
  const customWidth = Number(presentedSize.width);
  const customHeight = Number(presentedSize.height);
  const customValid =
    Number.isInteger(customWidth) &&
    Number.isInteger(customHeight) &&
    customWidth >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    customWidth <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    customHeight >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    customHeight <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    customWidth * customHeight <= PREVIEW_VIEWPORT_MAX_AREA;

  const apply = (next: PreviewViewportSetting, nextAspectRatio = aspectRatio) => {
    setPending(true);
    void onChange(next).then(
      () => {
        onAspectRatioChange(nextAspectRatio);
        setPending(false);
        setCustomSize(null);
      },
      () => setPending(false),
    );
  };

  const applyCustomSize = () => {
    if (!customValid || (customWidth === setting.width && customHeight === setting.height)) {
      setCustomSize(null);
      return;
    }
    apply({ _tag: "freeform", width: customWidth, height: customHeight });
  };

  const updateCustomDimension = (axis: "width" | "height", value: string) => {
    setCustomSize((current) => {
      const next = {
        width: axis === "width" ? value : (current?.width ?? String(setting.width)),
        height: axis === "height" ? value : (current?.height ?? String(setting.height)),
      };
      const numeric = Number(value);
      if (
        aspectRatio === null ||
        !Number.isInteger(numeric) ||
        numeric < PREVIEW_VIEWPORT_MIN_DIMENSION ||
        numeric > PREVIEW_VIEWPORT_MAX_DIMENSION
      ) {
        return next;
      }
      const resized = resizeFreeformViewport(
        setting,
        axis === "width" ? { x: numeric - setting.width, y: 0 } : { x: 0, y: numeric - setting.height },
        1,
        axis === "width" ? "east" : "south",
        aspectRatio,
      );
      return { width: String(resized.width), height: String(resized.height) };
    });
  };

  const selectViewport = (value: string) => {
    if (value === RESPONSIVE_VALUE) {
      if (setting._tag === "freeform") return;
      apply({ _tag: "freeform", width: setting.width, height: setting.height });
      return;
    }
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === value);
    if (!preset) return;
    apply(resolvePreviewViewport({ mode: "preset", preset: preset.id }), aspectRatio === null ? null : preset.width / preset.height);
  };

  const rotate = () => {
    const hasCustomSize = customValid && (customWidth !== setting.width || customHeight !== setting.height);
    const source = hasCustomSize ? ({ _tag: "freeform", width: customWidth, height: customHeight } as const) : setting;
    apply({ ...source, width: source.height, height: source.width }, aspectRatio === null ? null : 1 / aspectRatio);
  };

  const dimensionInput = (axis: "width" | "height") => (
    <input
      testId={`preview-viewport-${axis}`}
      value={presentedSize[axis]}
      readOnly={pending}
      onFocus={() => setCustomSize((current) => current ?? { width: String(setting.width), height: String(setting.height) })}
      onChange={(event: EventPayload) => updateCustomDimension(axis, String(event.value ?? "").replace(/[^0-9]/g, ""))}
      onSubmit={applyCustomSize}
      onBlur={applyCustomSize}
      theme={{ caret: theme.foreground }}
      style={{
        width: width >= 360 ? 56 : 52,
        height: 28,
        paddingLeft: 9,
        paddingRight: 9,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: customValid ? theme.input : alpha(theme.error, 0.36),
        backgroundColor: alpha(theme.input, 0.32),
        fontSize: 12,
        fontFamily: FONTS.mono,
        color: theme.foreground,
      }}
    />
  );

  return (
    <div
      testId="preview-device-toolbar"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        height: BROWSER_DEVICE_TOOLBAR_HEIGHT,
        flexShrink: 0,
        paddingLeft: 6,
        paddingRight: 6,
        borderBottomWidth: 1,
        borderColor: alpha(theme.border, 0.7),
        backgroundColor: alpha(theme.background, 0.95),
        overflowX: "scroll",
        scrollbarWidth: 0,
      }}
    >
      {width >= 560 ? (
        <Text size="2xs" weight={500} color={theme.mutedForeground} style={{ marginRight: 2, flexShrink: 0 }}>
          Dimensions
        </Text>
      ) : null}
      <Menu
        align="start"
        minWidth={200}
        testId="preview-viewport-preset-menu"
        trigger={({ toggle }) => (
          <div
            testId="preview-viewport-preset"
            onClick={pending ? undefined : toggle}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 4,
              width: width >= 440 ? 144 : 96,
              height: 24,
              paddingLeft: 7,
              paddingRight: 5,
              borderRadius: RADIUS.md,
              flexShrink: 0,
              cursor: pending ? "default" : "pointer",
              hover: { backgroundColor: theme.accent },
            }}
          >
            <Text size="xs" truncate>
              {selectedLabel}
            </Text>
            <Icon name="chevrons-up-down" size={14} color={theme.mutedForeground} />
          </div>
        )}
      >
        <MenuItem checked={selectedValue === RESPONSIVE_VALUE} onSelect={() => selectViewport(RESPONSIVE_VALUE)}>
          Responsive
        </MenuItem>
        <MenuLabel>Standard</MenuLabel>
        {PREVIEW_VIEWPORT_PRESETS.map((preset) => (
          <MenuItem
            key={preset.id}
            checked={selectedValue === preset.id}
            onSelect={() => selectViewport(preset.id)}
            trailing={
              <Text size="xs" color={theme.mutedForeground} style={{ marginLeft: 20 }}>
                {preset.detail}
              </Text>
            }
          >
            {preset.label}
          </MenuItem>
        ))}
      </Menu>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
        {dimensionInput("width")}
        <Text size="xs" color={theme.mutedForeground}>
          ×
        </Text>
        {dimensionInput("height")}
      </div>
      <ChromeButton
        icon={aspectRatio === null ? "unlink-2" : "link-2"}
        label={aspectRatio === null ? "Lock aspect ratio" : "Unlock aspect ratio"}
        pressed={aspectRatio !== null}
        disabled={pending || !customValid}
        onClick={() => onAspectRatioChange(aspectRatio === null ? customWidth / customHeight : null)}
        testId="preview-viewport-aspect"
      />
      <div
        testId="preview-viewport-rotate"
        onClick={pending ? undefined : rotate}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          flexShrink: 0,
          borderRadius: RADIUS.md,
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.64 : 1,
          hover: { backgroundColor: theme.accent },
        }}
      >
        <svg source={ROTATE_ICON} style={{ width: 14, height: 14, color: theme.mutedForeground }} />
      </div>
      <div style={{ flexGrow: 1 }} />
      <ChromeButton icon="x" label="Close device toolbar" disabled={pending} onClick={() => apply({ _tag: "fill" }, null)} testId="preview-viewport-close" />
    </div>
  );
}
