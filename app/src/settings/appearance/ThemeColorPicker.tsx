// Port of apps/web/src/components/settings/ThemeColorPicker.tsx (ThemeColorField,
// the swatch popover, ThemeColorPickerPanel) and the two controls it uses from
// components/ui/color-picker.tsx (ColorSaturationValuePlane, ColorHueSlider).
//
// Not ported: the "Show where … is used" tooltips. On the web a selected role
// highlights its uses in the DOM; gpuix paints resolved colors with no record
// of which role produced them, so there is nothing to highlight.
import type { EventPayload } from "@gpuix/react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";

import { Popover } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { hexToHsv, hsvToHex, type HsvColor } from "../../web/lib/color.ts";
import {
  getThemeRoleLabel,
  normalizeThemePickerColor,
  themeColorFieldValue,
  themePickerAlphaSuffix,
  themeRgbToHex,
  themeRgbValue,
} from "../../web/components/settings/ThemeEditorPanel.logic.ts";
import { isThemeColor, themeColorToHex, type ThemeColorRole } from "../../web/themePalette.ts";

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

type Bounds = { x: number; y: number; width: number; height: number };

function readBounds(event: EventPayload): Bounds | null {
  const { x, y, width, height } = event as EventPayload & { width?: number; height?: number };
  if (typeof x !== "number" || typeof y !== "number" || !width || !height) return null;
  return { x, y, width, height };
}

/**
 * color-picker.tsx useColorDrag: press, drag and release over one element. In
 * gpuix an element with onMouseDown + onMouseMove captures the pointer, so the
 * drag keeps tracking outside the control until the button lifts.
 */
function useColorDrag(update: (x: number, y: number, bounds: Bounds) => void, onInteractionEnd?: () => void) {
  const bounds = useRef<Bounds | null>(null);
  const dragging = useRef(false);
  const end = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onInteractionEnd?.();
  };
  return {
    onLayout: (event: EventPayload) => {
      bounds.current = readBounds(event) ?? bounds.current;
    },
    onMouseDown: (event: EventPayload) => {
      if ((event.button ?? 0) !== 0 || !bounds.current) return;
      dragging.current = true;
      update(event.x ?? 0, event.y ?? 0, bounds.current);
    },
    onMouseMove: (event: EventPayload) => {
      if (!dragging.current || !bounds.current) return;
      if (event.pressedButton !== undefined && event.pressedButton !== 0) {
        end();
        return;
      }
      update(event.x ?? 0, event.y ?? 0, bounds.current);
    },
    onMouseUp: end,
  };
}

/** ColorSaturationValuePlane variant "inset": h-32 rounded-lg, white→hue across, transparent→black up. */
function ColorSaturationValuePlane({
  value,
  onChange,
  onInteractionEnd,
  testId,
}: {
  value: HsvColor;
  onChange: (value: HsvColor) => void;
  onInteractionEnd?: () => void;
  testId?: string;
}) {
  const [width, setWidth] = useState(264);
  const height = 128;
  const thumb = 12;
  const drag = useColorDrag((x, y, bounds) => {
    onChange({
      ...value,
      s: clamp((x - bounds.x) / bounds.width),
      v: 1 - clamp((y - bounds.y) / bounds.height),
    });
  }, onInteractionEnd);
  const layer = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: RADIUS.lg, pointerEvents: "none" } as const;
  return (
    <div
      testId={testId}
      {...drag}
      onLayout={(event: EventPayload) => {
        drag.onLayout(event);
        const next = readBounds(event)?.width;
        if (next && Math.abs(next - width) > 0.5) setWidth(next);
      }}
      style={{
        position: "relative",
        height,
        borderRadius: RADIUS.lg,
        backgroundColor: hsvToHex(value.h, 1, 1),
        cursor: "crosshair",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          ...layer,
          background: {
            type: "linear-gradient",
            angle: 90,
            stops: [
              { color: "#ffffff", position: 0 },
              { color: "#ffffff00", position: 1 },
            ],
          },
        }}
      />
      <div
        style={{
          ...layer,
          background: {
            type: "linear-gradient",
            angle: 0,
            stops: [
              { color: "#000000", position: 0 },
              { color: "#00000000", position: 1 },
            ],
          },
        }}
      />
      <div
        style={{
          position: "absolute",
          left: value.s * (width - thumb),
          top: (1 - value.v) * (height - thumb),
          width: thumb,
          height: thumb,
          borderRadius: thumb / 2,
          borderWidth: 2,
          borderColor: "#ffffff",
          boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 1, color: "#00000066" },
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

const HUE_STOPS = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"] as const;

/** ColorHueSlider: h-6 hit area, h-2.5 rainbow track, 16px thumb. gpuix gradients have two stops, so the track is six segments. */
function ColorHueSlider({
  value,
  onChange,
  onInteractionEnd,
  testId,
}: {
  value: number;
  onChange: (value: number) => void;
  onInteractionEnd?: () => void;
  testId?: string;
}) {
  const [width, setWidth] = useState(264);
  const thumb = 16;
  const drag = useColorDrag((x, _y, bounds) => {
    onChange(clamp((x - bounds.x) / bounds.width) * 360);
  }, onInteractionEnd);
  return (
    <div
      testId={testId}
      {...drag}
      onLayout={(event: EventPayload) => {
        drag.onLayout(event);
        const next = readBounds(event)?.width;
        if (next && Math.abs(next - width) > 0.5) setWidth(next);
      }}
      style={{ position: "relative", display: "flex", flexDirection: "row", alignItems: "center", height: 24, cursor: "pointer", flexShrink: 0 }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          width: "100%",
          height: 10,
          borderRadius: 5,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {HUE_STOPS.slice(0, -1).map((from, index) => (
          <div
            key={from + index}
            style={{
              flexGrow: 1,
              flexBasis: 0,
              height: 10,
              background: {
                type: "linear-gradient",
                angle: 90,
                stops: [
                  { color: from, position: 0 },
                  { color: HUE_STOPS[index + 1]!, position: 1 },
                ],
              },
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: 4,
          left: (value / 360) * (width - thumb),
          width: thumb,
          height: thumb,
          borderRadius: thumb / 2,
          borderWidth: 2,
          borderColor: "#ffffff",
          backgroundColor: hsvToHex(value, 1, 1),
          boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 1, color: "#00000066" },
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/** The HEX / RGB fields under the picker: 10px caps label over a rounded-lg input. */
function PickerTextField({
  label,
  value,
  swatch,
  onChange,
  onFocus,
  onBlur,
  testId,
  grow,
}: {
  label: string;
  value: string;
  swatch?: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  testId?: string;
  grow: number;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: grow, flexBasis: 0, minWidth: 0 }}>
      <div style={{ paddingLeft: 4, paddingRight: 4 }}>
        <Text size="3xs" weight={600} color={theme.mutedForeground}>
          {label}
        </Text>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 34,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: focused ? theme.primary : theme.input,
          backgroundColor: theme.background,
        }}
      >
        {swatch ? <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: swatch, flexShrink: 0 }} /> : null}
        <input
          testId={testId}
          value={value}
          theme={{ caret: theme.foreground }}
          onChange={(event) => onChange(String(event.value ?? ""))}
          onFocus={() => {
            setFocused(true);
            onFocus();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur();
          }}
          style={{ flexGrow: 1, minWidth: 0, height: 32, fontSize: 12, fontFamily: FONTS.mono, color: theme.foreground }}
        />
      </div>
    </div>
  );
}

function ThemeColorPickerPanel({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  const theme = useTheme();
  const normalizedValue = normalizeThemePickerColor(value);
  const alphaSuffix = themePickerAlphaSuffix(value);
  const [hsv, setHsv] = useState(() => hexToHsv(normalizedValue));
  const [hexDraft, setHexDraft] = useState(normalizedValue);
  const [rgbDraft, setRgbDraft] = useState(() => themeRgbValue(normalizedValue));
  const [isEditingText, setIsEditingText] = useState(false);
  const [syncedValue, setSyncedValue] = useState(normalizedValue);
  const currentColor = hsvToHex(hsv.h, hsv.s, hsv.v);
  const currentRgb = themeRgbValue(currentColor);

  if (syncedValue !== normalizedValue) {
    setSyncedValue(normalizedValue);
    // While a text field is focused, the incoming value may be the guided
    // editor's readability-adjusted echo of what is being typed; rewriting the
    // draft would fight the keystrokes. The swatch still tracks via hsv.
    if (!isEditingText) {
      setHexDraft(normalizedValue);
      setRgbDraft(themeRgbValue(normalizedValue));
    }
    // Keep the current hue/saturation when the incoming value is just our own
    // change echoed back; hex → HSV is lossy for greys, white, and black.
    if (currentColor !== normalizedValue) setHsv(hexToHsv(normalizedValue));
  }

  // Local state updates immediately for a smooth thumb; the parent commit
  // (which can regenerate a whole guided palette and repaints the whole app)
  // is batched to one call per frame.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pendingCommitRef = useRef<string | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingCommit = () => {
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const pending = pendingCommitRef.current;
    pendingCommitRef.current = null;
    if (pending !== null) onChangeRef.current(pending);
  };
  const flushRef = useRef(flushPendingCommit);
  flushRef.current = flushPendingCommit;
  // Flush only on unmount: the final drag frame must not be lost when the popover closes.
  useEffect(() => () => flushRef.current(), []);
  const scheduleCommit = (color: string) => {
    pendingCommitRef.current = color;
    if (commitTimerRef.current !== null) return;
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = null;
      if (pending !== null) onChangeRef.current(pending);
    }, 16);
  };

  const commitHsv = (nextHsv: HsvColor) => {
    setHsv(nextHsv);
    const nextColor = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v);
    setHexDraft(nextColor);
    setRgbDraft(themeRgbValue(nextColor));
    scheduleCommit(nextColor + alphaSuffix);
  };

  const handleHexChange = (nextValue: string) => {
    setHexDraft(nextValue);
    if (!/^#[0-9a-f]{6}$/i.test(nextValue)) return;
    const nextHsv = hexToHsv(nextValue);
    setHsv(nextHsv);
    setRgbDraft(themeRgbValue(nextValue));
    onChange(nextValue.toLowerCase());
  };

  const handleRgbChange = (nextValue: string) => {
    setRgbDraft(nextValue);
    const nextColor = themeRgbToHex(nextValue);
    if (!nextColor) return;
    setHsv(hexToHsv(nextColor));
    setHexDraft(nextColor);
    onChange(nextColor + alphaSuffix);
  };

  const endTextEdit = () => {
    setIsEditingText(false);
    setHexDraft(currentColor);
    setRgbDraft(currentRgb);
  };

  return (
    <div testId={testId} style={{ display: "flex", flexDirection: "column", width: 288 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderColor: alpha(theme.border, 0.7),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Text size="xs" weight={600} truncate>
            {label}
          </Text>
          <Text size="2xs" color={theme.mutedForeground}>
            Choose a color
          </Text>
        </div>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: currentColor,
            flexShrink: 0,
            boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#0000000d" },
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
        <ColorSaturationValuePlane
          testId={testId ? `${testId}-plane` : undefined}
          value={hsv}
          onChange={commitHsv}
          onInteractionEnd={flushPendingCommit}
        />
        <ColorHueSlider
          testId={testId ? `${testId}-hue` : undefined}
          value={hsv.h}
          onChange={(h) => commitHsv({ ...hsv, h })}
          onInteractionEnd={flushPendingCommit}
        />
        <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          <PickerTextField
            label="HEX"
            grow={1}
            value={hexDraft}
            swatch={currentColor}
            testId={testId ? `${testId}-hex` : undefined}
            onChange={handleHexChange}
            onFocus={() => setIsEditingText(true)}
            onBlur={endTextEdit}
          />
          <PickerTextField
            label="RGB"
            grow={1.2}
            value={rgbDraft}
            testId={testId ? `${testId}-rgb` : undefined}
            onChange={handleRgbChange}
            onFocus={() => setIsEditingText(true)}
            onBlur={endTextEdit}
          />
        </div>
      </div>
    </div>
  );
}

function ThemeColorPicker({
  label,
  value,
  onChange,
  onInteract,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onInteract?: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const swatch: ReactNode = (
    <div
      testId={testId}
      onClick={() => {
        onInteract?.();
        setOpen(!open);
      }}
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: alpha(theme.foreground, 0.3),
        backgroundColor: themeColorToHex(value) ?? "#000000",
        cursor: "pointer",
        flexShrink: 0,
      }}
    />
  );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={swatch}
      side="bottom"
      align="end"
      sideOffset={10}
      testId={testId ? `${testId}-popover` : undefined}
      style={{ backgroundColor: theme.popover, borderColor: alpha(theme.border, 0.7), overflow: "hidden" }}
    >
      <ThemeColorPickerPanel label={label} onChange={onChange} value={value} testId={testId ? `${testId}-picker` : undefined} />
    </Popover>
  );
}

/** web Input size="compact" font="mono" at w-28: 30 tall, rounded-md, 12px mono. */
function HexInput({
  value,
  invalid,
  onChange,
  onFocus,
  testId,
}: {
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const dark = theme.appearance === "dark";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        width: 112,
        height: 30,
        paddingLeft: 9,
        paddingRight: 9,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: focused
          ? invalid
            ? alpha(theme.error, 0.64)
            : theme.primary
          : invalid
            ? alpha(theme.error, 0.36)
            : theme.input,
        backgroundColor: dark ? alpha(theme.input, 0.32) : theme.background,
        flexShrink: 0,
      }}
    >
      <input
        testId={testId}
        value={value}
        theme={{ caret: theme.foreground }}
        onChange={(event) => onChange(String(event.value ?? ""))}
        onFocus={() => {
          setFocused(true);
          onFocus();
        }}
        onBlur={() => setFocused(false)}
        style={{ flexGrow: 1, minWidth: 0, height: 28, fontSize: 12, fontFamily: FONTS.mono, color: theme.foreground }}
      />
    </div>
  );
}

export const ThemeColorField = memo(function ThemeColorField({
  role,
  value,
  onChange,
  onSelect,
  onToggleSelected,
  selected = false,
  label: customLabel,
}: {
  role: ThemeColorRole;
  value: string;
  onChange: (role: ThemeColorRole, value: string) => void;
  onSelect?: (role: ThemeColorRole) => void;
  onToggleSelected?: (role: ThemeColorRole) => void;
  selected?: boolean;
  label?: string;
}) {
  const theme = useTheme();
  const [labelHovered, setLabelHovered] = useState(false);
  const label = customLabel ?? getThemeRoleLabel(role);
  const isColorValue = isThemeColor(value);
  const swatchValue = isColorValue ? value : "#000000";
  const editorValue = themeColorFieldValue(value);

  return (
    <div
      testId={`theme-color-${role}`}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 44,
        minWidth: 0,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: selected ? theme.primary : "#00000000",
        backgroundColor: selected ? alpha(theme.accent, 0.6) : "#00000000",
      }}
    >
      <div
        testId={`theme-color-${role}-label`}
        onClick={() => onToggleSelected?.(role)}
        onMouseEnter={() => setLabelHovered(true)}
        onMouseLeave={() => setLabelHovered(false)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", flexGrow: 1, minWidth: 0, alignSelf: "stretch", cursor: "pointer" }}
      >
        <Text color={labelHovered ? theme.foreground : theme.mutedForeground} truncate>
          {label}
        </Text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <ThemeColorPicker
          label={label}
          onChange={(nextValue) => onChange(role, nextValue)}
          onInteract={() => onSelect?.(role)}
          value={swatchValue}
          testId={`theme-color-${role}-swatch`}
        />
        <HexInput
          testId={`theme-color-${role}-hex`}
          value={editorValue}
          invalid={!isColorValue}
          onChange={(nextValue) => onChange(role, nextValue)}
          onFocus={() => onSelect?.(role)}
        />
      </div>
    </div>
  );
});
