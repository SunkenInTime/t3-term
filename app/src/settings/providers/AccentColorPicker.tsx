// Port of apps/web/src/components/settings/ProviderAccentColorPicker.tsx (+ ui/color-picker.tsx's
// saturation/value plane and hue slider). gpuix paints two-stop gradients only, so the plane is
// the hue under a white and a black gradient, and the hue track is six two-stop segments.
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import type { LinearGradientBackground } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Popover } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { hexToHsv, hsvToHex, type HsvColor } from "../../web/lib/color.ts";
import { TextField } from "../controls.tsx";

const FALLBACK_ACCENT_COLOR = "#2563eb";
const PANEL_WIDTH = 224;
const PLANE_HEIGHT = 144;
const HUE_WIDTH = PANEL_WIDTH - 24;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function linear(angle: number, from: string, to: string): LinearGradientBackground {
  return {
    type: "linear-gradient",
    angle,
    stops: [
      { color: from, position: 0 },
      { color: to, position: 1 },
    ],
  };
}

/** Drag tracking shared by the plane and the hue track: positions are window coordinates. */
function useDrag(onPoint: (x: number, y: number) => void) {
  const origin = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  return {
    onLayout: (event: { x?: number; y?: number }) => {
      origin.current = { x: event.x ?? 0, y: event.y ?? 0 };
    },
    onMouseDown: (event: { x?: number; y?: number }) => {
      dragging.current = true;
      onPoint((event.x ?? 0) - origin.current.x, (event.y ?? 0) - origin.current.y);
    },
    onMouseMove: (event: { x?: number; y?: number; pressedButton?: unknown }) => {
      if (!dragging.current || event.pressedButton === undefined || event.pressedButton === null) return;
      onPoint((event.x ?? 0) - origin.current.x, (event.y ?? 0) - origin.current.y);
    },
    onMouseUp: () => {
      dragging.current = false;
    },
  };
}

function SaturationValuePlane({ value, onChange }: { value: HsvColor; onChange: (next: HsvColor) => void }) {
  const drag = useDrag((x, y) => onChange({ ...value, s: clamp01(x / PANEL_WIDTH), v: clamp01(1 - y / PLANE_HEIGHT) }));
  const thumb = 12;
  return (
    <div testId="provider-accent-plane" {...drag} style={{ position: "relative", width: PANEL_WIDTH, height: PLANE_HEIGHT, cursor: "pointer", flexShrink: 0 }}>
      <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: hsvToHex(value.h, 1, 1), pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, background: linear(90, "#ffffffff", "#ffffff00"), pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, background: linear(180, "#00000000", "#000000ff"), pointerEvents: "none" }} />
      <div
        style={{
          position: "absolute",
          left: value.s * PANEL_WIDTH - thumb / 2,
          top: (1 - value.v) * PLANE_HEIGHT - thumb / 2,
          width: thumb,
          height: thumb,
          borderRadius: thumb / 2,
          borderWidth: 2,
          borderColor: "#ffffff",
          boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 2, spreadRadius: 0, color: "#00000099" },
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360];

function HueSlider({ hue, onChange }: { hue: number; onChange: (hue: number) => void }) {
  const drag = useDrag((x) => onChange(clamp01(x / HUE_WIDTH) * 360));
  const thumb = 16;
  const segment = HUE_WIDTH / (HUE_STOPS.length - 1);
  return (
    <div testId="provider-accent-hue" {...drag} style={{ position: "relative", width: HUE_WIDTH, height: thumb, cursor: "pointer", flexShrink: 0 }}>
      <div style={{ position: "absolute", left: 0, top: 4, display: "flex", flexDirection: "row", width: HUE_WIDTH, height: 8, borderRadius: 4, overflow: "hidden", pointerEvents: "none" }}>
        {HUE_STOPS.slice(0, -1).map((stop, index) => (
          <div key={stop} style={{ width: segment, height: 8, background: linear(90, hsvToHex(stop, 1, 1), hsvToHex(HUE_STOPS[index + 1]!, 1, 1)) }} />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: (hue / 360) * HUE_WIDTH - thumb / 2,
          top: 0,
          width: thumb,
          height: thumb,
          borderRadius: thumb / 2,
          borderWidth: 2,
          borderColor: "#ffffff",
          backgroundColor: hsvToHex(hue, 1, 1),
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function CustomColorPanel({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const currentColor = hsvToHex(hsv.h, hsv.s, hsv.v);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const commitHsv = (next: HsvColor) => {
    setHsv(next);
    onCommit(hsvToHex(next.h, next.s, next.v));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", width: PANEL_WIDTH }}>
      <SaturationValuePlane value={hsv} onChange={commitHsv} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
        <HueSlider hue={hsv.h} onChange={(h) => commitHsv({ ...hsv, h })} />
        <TextField
          testId="provider-accent-hex"
          size="sm"
          mono
          width="100%"
          value={hexDraft ?? currentColor}
          onChange={(next) => {
            setHexDraft(next);
            if (!/^#[\da-f]{6}$/i.test(next)) return;
            setHsv(hexToHsv(next));
            onCommit(next);
          }}
          onBlur={() => setHexDraft(null)}
        />
      </div>
    </div>
  );
}

/**
 * ProviderAccentColorPicker layout="inline": a 28px trigger (Plus, or filled with the
 * color) opening the custom color panel. Commits are debounced by `commitDelayMs`.
 */
export function AccentColorPicker({
  value,
  onCommit,
  commitDelayMs = 0,
  testId,
}: {
  value: string | undefined;
  onCommit: (value: string) => void;
  commitDelayMs?: number;
  testId?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [optimisticValue, setOptimisticValue] = useState(() => value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (pending.current !== null) return;
    setOptimisticValue(value ?? "");
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (pending.current !== null) onCommitRef.current(pending.current);
    },
    [],
  );

  const commit = (next: string) => {
    const normalized = normalizeProviderAccentColor(next) ?? "";
    setOptimisticValue(normalized);
    if (commitDelayMs <= 0) {
      onCommit(normalized);
      return;
    }
    pending.current = normalized;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const latest = pending.current;
      pending.current = null;
      if (latest !== null) onCommitRef.current(latest);
    }, commitDelayMs);
  };

  const normalized = normalizeProviderAccentColor(optimisticValue);
  const [hover, setHover] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      sideOffset={6}
      testId={testId ? `${testId}-popover` : undefined}
      style={{ padding: 0, overflow: "hidden" }}
      trigger={
        <div
          testId={testId}
          onClick={() => setOpen(!open)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: RADIUS.md,
            backgroundColor: normalized ?? (hover ? theme.accent : "#00000000"),
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {normalized ? null : <Icon name="plus" size={16} color={theme.mutedForeground} />}
        </div>
      }
    >
      <CustomColorPanel value={normalized ?? FALLBACK_ACCENT_COLOR} onCommit={commit} />
      {normalized ? (
        <div style={{ display: "flex", flexDirection: "column", padding: 4, borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
          <div
            testId={testId ? `${testId}-clear` : undefined}
            onClick={() => {
              commit("");
              setOpen(false);
            }}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              height: 28,
              paddingLeft: 8,
              borderRadius: RADIUS.sm,
              cursor: "pointer",
              hover: { backgroundColor: theme.accent },
            }}
          >
            <Icon name="x" size={14} color={theme.mutedForeground} />
            <Text size="xs" weight={500} color={theme.mutedForeground}>
              Clear color
            </Text>
          </div>
        </div>
      ) : null}
    </Popover>
  );
}
