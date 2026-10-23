// Port of apps/web/src/components/settings/ThemeWireframe.tsx.
//
// The web lays the miniature app out in percentages; gpuix sizes are pixels,
// so the pane measures its width and converts. The System tile's split
// (clip-path on the web) is two clipping halves over full-width panes.
import { useState } from "react";

import { alpha, cssColorToHex, useTheme } from "../../ui/theme.ts";
import type { ThemeCardPreviewColors } from "./ThemePreviewCircles.tsx";

/** rgb(127 127 127 / 0.25) */
const LINE = "#7f7f7f40";

function color(value: string): string {
  return cssColorToHex(value);
}

function Box({
  left,
  top,
  width,
  height,
  radius,
  fill,
  opacity,
  outline,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
  fill: string;
  opacity?: number;
  outline?: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        borderRadius: radius,
        backgroundColor: fill,
        ...(opacity === undefined ? {} : { opacity }),
        ...(outline ? { borderWidth: 1, borderColor: LINE } : {}),
      }}
    />
  );
}

function ThemeWireframePane({ colors, width, height }: { colors: ThemeCardPreviewColors; width: number; height: number }) {
  const w = (fraction: number) => fraction * width;
  const h = (fraction: number) => fraction * height;
  const surface = color(colors.surface);
  const messageSurface = color(colors.messageSurface);
  const action = color(colors.messageAction);
  // The input bar: bottom 8%, left 26%, right 6%, h 15%, px-1, justify-between.
  const barLeft = w(0.26);
  const barWidth = width - barLeft - w(0.06);
  const barHeight = h(0.15);
  const barTop = height - h(0.08) - barHeight;
  const barInner = barWidth - 8;
  const dot = barHeight * 0.58;
  // The floating card: right 5%, top 8%, h 46%, w 20%.
  const cardWidth = w(0.2);
  const cardHeight = h(0.46);
  const cardLeft = width - w(0.05) - cardWidth;
  const cardTop = h(0.08);
  return (
    // overflow:hidden clips to a rectangle, so the pane rounds its own corners.
    <div style={{ pointerEvents: "none", position: "absolute", left: 0, top: 0, width, height, borderRadius: INNER_RADIUS, backgroundColor: color(colors.canvas) }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: w(0.22),
          height,
          borderTopLeftRadius: INNER_RADIUS,
          borderBottomLeftRadius: INNER_RADIUS,
          backgroundColor: color(colors.sidebar),
          borderRightWidth: 1,
          borderColor: LINE,
        }}
      />
      <Box left={w(0.03)} top={h(0.08)} width={w(0.16)} height={h(0.08)} radius={6} fill={surface} outline />
      <Box left={w(0.03)} top={h(0.22)} width={w(0.16)} height={h(0.07)} radius={6} fill={color(colors.accentSurface)} />
      <Box left={w(0.03)} top={h(0.32)} width={w(0.16)} height={h(0.07)} radius={6} fill={messageSurface} opacity={0.7} />
      <Box left={w(0.03)} top={h(0.42)} width={w(0.16)} height={h(0.07)} radius={6} fill={messageSurface} opacity={0.5} />

      <Box left={width - w(0.28) - w(0.24)} top={h(0.11)} width={w(0.24)} height={h(0.09)} radius={8} fill={messageSurface} />
      <Box left={w(0.27)} top={h(0.28)} width={w(0.34)} height={h(0.05)} radius={2} fill={LINE} />
      <Box left={w(0.27)} top={h(0.38)} width={w(0.26)} height={h(0.05)} radius={2} fill={LINE} />

      <div
        style={{
          position: "absolute",
          left: barLeft,
          top: barTop,
          width: barWidth,
          height: barHeight,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 4,
          paddingRight: 4,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: LINE,
          backgroundColor: surface,
        }}
      >
        <div style={{ pointerEvents: "none", width: barInner * 0.34, height: barHeight * 0.26, borderRadius: 99, backgroundColor: LINE, opacity: 0.7 }} />
        <div style={{ pointerEvents: "none", width: dot, height: dot, borderRadius: dot / 2, backgroundColor: action }} />
      </div>

      <div
        style={{
          position: "absolute",
          left: cardLeft,
          top: cardTop,
          width: cardWidth,
          height: cardHeight,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: LINE,
          backgroundColor: surface,
          boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 5, spreadRadius: 0, color: "#00000024" },
        }}
      >
        {[0, 1, 2].map((row) => {
          const rowHeight = cardHeight * 0.2;
          const marker = rowHeight * 0.26;
          return (
            <div
              key={row}
              style={{
                position: "absolute",
                left: cardWidth * 0.11,
                right: cardWidth * 0.11,
                top: cardHeight * ((10 + row * 30) / 100) - 1,
                height: rowHeight,
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              }}
            >
              <div
                style={{
                  width: marker,
                  height: marker,
                  borderRadius: marker / 2,
                  backgroundColor: row === 0 ? "#34d399" : row === 1 ? action : "#fbbf24",
                  opacity: 0.55,
                }}
              />
              <div style={{ pointerEvents: "none", width: cardWidth * 0.78 * 0.52, height: rowHeight * 0.3, borderRadius: 2, backgroundColor: LINE }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ThemeWireframe({
  panes,
  height = 140,
}: {
  panes: ReadonlyArray<{ colors: ThemeCardPreviewColors; clip?: "left" | "right" }>;
  height?: number;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  // Border-box: the panes sit inside the 1px border.
  const innerWidth = Math.max(0, width - 2);
  const innerHeight = height - 2;
  const middle = innerWidth / 2;
  return (
    <div
      onLayout={(event) => {
        const next = Math.round(event.width ?? 0);
        if (next !== width) setWidth(next);
      }}
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: RADIUS_LG,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {innerWidth > 0
        ? panes.map((pane) => {
            if (pane.clip === undefined) {
              return <ThemeWireframePane key="pane" colors={pane.colors} width={innerWidth} height={innerHeight} />;
            }
            const left = pane.clip === "left" ? 0 : middle + 1;
            const clipWidth = pane.clip === "left" ? middle - 1 : innerWidth - middle - 1;
            return (
              <div
                key={pane.clip}
                style={{ pointerEvents: "none", position: "absolute", left, top: 0, width: clipWidth, height: innerHeight, overflow: "hidden" }}
              >
                <div style={{ pointerEvents: "none", position: "absolute", left: -left, top: 0, width: innerWidth, height: innerHeight }}>
                  <ThemeWireframePane colors={pane.colors} width={innerWidth} height={innerHeight} />
                </div>
              </div>
            );
          })
        : null}
    </div>
  );
}

const RADIUS_LG = 10;
const INNER_RADIUS = RADIUS_LG - 1;
