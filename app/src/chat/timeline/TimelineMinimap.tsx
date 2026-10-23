// Port of apps/web/src/components/chat/TimelineMinimap.tsx: the turn rail at the
// left edge of the timeline. One strip per user message, the ones on screen lit,
// a fisheye under the pointer with a preview card, Previous/Next turn buttons
// that appear when hovered, and a click jumps to that message.
//
// Differences forced by gpuix: no transforms, so strips change width instead of
// scaling; the preview card is a deferred floating layer that takes no input
// (web lets you select its text); the hit strip keeps its collapsed width.
import { useWindowSize } from "@gpuix/react";
import { FloatingLayer } from "@gpuix/react/floating";
import { useState } from "react";

import { Tooltip } from "../../ui/overlay.tsx";
import { IconButton } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  resolveTimelineMinimapIndexFromPointer,
  resolveTimelineMinimapNavigationInteractive,
  resolveTimelineMinimapTopPercent,
  TIMELINE_MINIMAP_MIN_ITEMS,
} from "../../web/components/chat/MessagesTimeline.logic.ts";
import { resolveTimelineMinimapPreview, type TimelineMinimapItem } from "../../web/components/chat/timelineMinimapItems.ts";

const ITEM_SPACING = 8;
// web: calc(100vh - 18rem)
const MAX_HEIGHT_INSET = 288;
const RAIL_LEFT = 12;
const STRIP_WIDTH = 24;
// web scale-x per distance from the hovered strip: 1, .667, .417, .333
const STRIP_SCALE = [1, 0.667, 0.417] as const;
const STRIP_REST_SCALE = 0.333;

export function TimelineMinimap({
  items,
  hitStripWidth,
  currentIndex,
  inView,
  onSelect,
}: {
  items: ReadonlyArray<TimelineMinimapItem>;
  hitStripWidth: number;
  currentIndex: number | null;
  /** Ids of the user messages whose rows are on screen. */
  inView: ReadonlySet<string>;
  onSelect: (item: TimelineMinimapItem) => void;
}) {
  const theme = useTheme();
  const { height: windowHeight } = useWindowSize();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [railTop, setRailTop] = useState(0);
  const [hoveredNav, setHoveredNav] = useState<"previous" | "next" | null>(null);

  if (items.length < TIMELINE_MINIMAP_MIN_ITEMS) return null;

  const height = Math.max(1, Math.min((items.length - 1) * ITEM_SPACING, windowHeight - MAX_HEIGHT_INSET));
  const resolvedActiveIndex = activeIndex !== null && activeIndex < items.length ? activeIndex : null;
  const activeItem = resolveTimelineMinimapPreview(resolvedActiveIndex === null ? null : (items[resolvedActiveIndex] ?? null));
  const resolvedCurrentIndex = currentIndex !== null && currentIndex >= 0 && currentIndex < items.length ? currentIndex : null;
  const previousItem = resolvedCurrentIndex === null ? null : (items[resolvedCurrentIndex - 1] ?? null);
  const nextItem = resolvedCurrentIndex === null ? null : (items[resolvedCurrentIndex + 1] ?? null);
  const navigationInteractive = resolveTimelineMinimapNavigationInteractive(hitStripWidth);

  const indexAt = (pointerY: number) =>
    resolveTimelineMinimapIndexFromPointer({ itemCount: items.length, railTop, railHeight: height, pointerY });
  const topOf = (index: number) => (resolveTimelineMinimapTopPercent(index, items.length) / 100) * height;

  const navButton = (direction: "previous" | "next") => {
    const previous = direction === "previous";
    const target = previous ? previousItem : nextItem;
    const label = previous ? "Previous turn" : "Next turn";
    return (
      <div
        style={{
          position: "absolute",
          left: -6,
          ...(previous ? { bottom: height + 2 } : { top: height + 2 }),
          // Hidden until the pointer is on it, like web's opacity-0 hover:opacity-100.
          opacity: hoveredNav === direction ? 1 : 0,
          pointerEvents: navigationInteractive ? "auto" : "none",
        }}
        onMouseEnter={() => setHoveredNav(direction)}
        onMouseLeave={() => setHoveredNav((current) => (current === direction ? null : current))}
      >
        <Tooltip content={label} side={previous ? "top" : "bottom"}>
          <IconButton
            icon={previous ? "chevron-up" : "chevron-down"}
            size={20}
            iconSize={16}
            color={alpha(theme.foreground, 0.9)}
            disabled={target === null}
            onClick={() => {
              if (target) onSelect(target);
            }}
            testId={`timeline-minimap-${direction}`}
          />
        </Tooltip>
      </div>
    );
  };

  return (
    <div
      testId="timeline-minimap"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: 72,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div style={{ position: "relative", marginLeft: RAIL_LEFT, width: hitStripWidth, height }}>
        {navButton("previous")}
        <div
          testId="timeline-minimap-rail"
          onLayout={(event) => setRailTop(event.y ?? 0)}
          onMouseMove={(event) => {
            const next = indexAt(event.y ?? 0);
            setActiveIndex((current) => (current === next ? current : next));
          }}
          onMouseLeave={() => setActiveIndex(null)}
          onClick={(event) => {
            const index = indexAt(event.y ?? 0);
            const item = index === null ? null : (items[index] ?? null);
            if (item) onSelect(item);
          }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: hitStripWidth,
            height,
            cursor: "pointer",
            pointerEvents: hitStripWidth > 0 ? "auto" : "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 12,
              width: 1,
              height,
              backgroundColor: alpha(theme.border, 0.15),
              pointerEvents: "none",
            }}
          />
          {items.map((item, index) => {
            const distance = resolvedActiveIndex === null ? null : Math.abs(index - resolvedActiveIndex);
            const scale = distance === null ? STRIP_REST_SCALE : (STRIP_SCALE[distance] ?? STRIP_REST_SCALE);
            const lit = inView.has(item.id);
            return (
              <div
                key={item.id}
                style={{
                  position: "absolute",
                  left: 0,
                  top: topOf(index) - 1,
                  width: Math.round(STRIP_WIDTH * scale),
                  height: 2,
                  borderRadius: 999,
                  backgroundColor: lit
                    ? alpha(theme.foreground, 0.9)
                    : alpha(theme.mutedForeground, distance === 0 ? 0.75 : 0.35),
                  pointerEvents: "none",
                }}
              />
            );
          })}
        </div>
        {activeItem && resolvedActiveIndex !== null ? (
          <div style={{ position: "absolute", left: 32, top: topOf(resolvedActiveIndex), width: 0, height: 0 }}>
            <FloatingLayer
              side="right"
              align={resolvedActiveIndex === 0 ? "start" : resolvedActiveIndex === items.length - 1 ? "end" : "center"}
              style={{
                width: 320,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: 12,
                borderRadius: RADIUS.xl,
                borderWidth: 1,
                borderColor: alpha(theme.foreground, 0.1),
                backgroundColor: theme.appearance === "dark" ? "#141414" : "#ffffff",
                boxShadow: { offsetX: 0, offsetY: 20, blurRadius: 25, spreadRadius: -5, color: "#00000040" },
                pointerEvents: "none",
              }}
            >
              <text
                style={{
                  color: theme.foreground,
                  fontSize: 14,
                  lineHeight: 20,
                  fontWeight: 500,
                  fontFamily: FONTS.sans,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                }}
              >
                {activeItem.userText ?? "User message"}
              </text>
              {activeItem.assistantText ? (
                <text style={{ color: theme.mutedForeground, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans, lineClamp: 3 }}>
                  {activeItem.assistantText}
                </text>
              ) : null}
            </FloatingLayer>
          </div>
        ) : null}
        {navButton("next")}
      </div>
    </div>
  );
}
