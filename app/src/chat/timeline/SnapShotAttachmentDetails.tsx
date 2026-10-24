// apps/web/src/components/chat/SnapShotAttachmentDetails.tsx: a SnapShot window
// capture in a sent message shows the source app's icon (or initial), name and
// window title over the bottom of the picture, and a button that opens the
// accessibility data the capture carried.
import type { SnapShotSource } from "@t3tools/contracts";
import { useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

/** SNAP_SHOT_ATTACHMENT_FRAME_CLASS: h-28 w-52 max-w-full, spanning both grid columns. */
export const SNAP_SHOT_FRAME = { width: 208, height: 112 } as const;
// Frame less the band's padding (2 × 10), icon (28), two gaps (2 × 6) and the 20px button.
const APP_NAME_MAX_WIDTH = SNAP_SHOT_FRAME.width - 20 - 28 - 12 - 20;

interface SnapShotAccessibilityDetails {
  readonly content: string;
  readonly format: "json" | "text";
}

export function snapShotAccessibilityDetails(source: SnapShotSource): SnapShotAccessibilityDetails | undefined {
  if (source.accessibility?.format === "element-tree") {
    return { content: JSON.stringify(source.accessibility, null, 2), format: "json" };
  }
  const text = source.accessibility?.format === "flat-text" ? source.accessibility.text.trim() : source.accessibleText?.trim();
  return text ? { content: text, format: "text" } : undefined;
}

function snapShotIncludesAccessibility(source: SnapShotSource): boolean {
  return Boolean(source.accessibility || source.accessibleText?.trim());
}

/** The bottom band over the picture. Clicks outside the contents button open the picture, as web's pass-through band does. */
export function SnapShotAttachmentDetails({ source, onOpenImage }: { source: SnapShotSource; onOpenImage: () => void }) {
  return (
    <div
      onClick={onOpenImage}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 24,
        paddingBottom: 8,
        cursor: "pointer",
        // bg-linear-to-t from-black/85 via-black/55 to-transparent (gpuix gradients take two stops).
        background: { type: "linear-gradient", angle: 180, stops: [{ color: "#00000000", position: 0 }, { color: "#000000d9", position: 1 }] },
      }}
    >
      {source.appIconDataUrl ? (
        <img src={source.appIconDataUrl} objectFit="contain" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: RADIUS.md, pointerEvents: "none" }} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, flexShrink: 0, borderRadius: RADIUS.md, backgroundColor: "#ffffff33", pointerEvents: "none" }}>
          <text style={{ color: "#ffffff", fontFamily: FONTS.sans, fontSize: 10, lineHeight: 14, fontWeight: 500 }}>{source.appName.slice(0, 1).toUpperCase()}</text>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1, flexBasis: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          {/* The band is a fixed width, so the name gets a fixed cap: a shrinkable run was sized a hair short and showed an ellipsis. */}
          <text style={{ color: "#ffffff", fontFamily: FONTS.sans, fontSize: 11, lineHeight: 14, fontWeight: 500, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", flexShrink: 0, maxWidth: APP_NAME_MAX_WIDTH }}>
            {source.appName}
          </text>
          <SnapShotContentsButton source={source} />
        </div>
        <text style={{ color: "#ffffffb3", fontFamily: FONTS.sans, fontSize: 10, lineHeight: 14, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
          {source.windowTitle || "Captured window"}
        </text>
      </div>
    </div>
  );
}

/** The popup's height with a full text box (title, 15 rows, padding) plus its offset. */
const POPUP_ROOM_ABOVE = 340;
const POPUP_WIDTH = 320; // width md

/** Button size icon-micro, variant overlay: a 20px black/70 square with a 12px glyph, opening the accessibility popup (width md). */
function SnapShotContentsButton({ source }: { source: SnapShotSource }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"top" | "bottom">("top");
  const [hovered, setHovered] = useState(false);
  const includes = snapShotIncludesAccessibility(source);
  const details = snapShotAccessibilityDetails(source);
  const trigger = (
    <Tooltip content={includes ? "Accessibility data" : "No accessibility data"} side="top">
      <div
        testId="snapshot-contents-button"
        onClick={(event) => {
          // side="top" when the popup fits above, else below, as web's popup flips.
          setSide((event.y ?? 0) > POPUP_ROOM_ABOVE ? "top" : "bottom");
          setOpen((value) => !value);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: RADIUS.sm,
          backgroundColor: hovered || open ? "#000000e6" : "#000000b3",
          cursor: "pointer",
        }}
      >
        <Icon name={includes ? "text" : "image"} size={12} color="#ffffffa6" />
      </div>
    </Tooltip>
  );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      side={side}
      // align="center" over the 20px button. gpuix's center placed this popup's right edge at
      // the button here (inside a clipped, absolutely placed band), so it is start-aligned and
      // shifted back by half the width difference.
      align="start"
      alignOffset={-(POPUP_WIDTH - 20) / 2}
      testId="snapshot-accessibility-popup"
      rootStyle={{ flexShrink: 0 }}
      style={{ width: POPUP_WIDTH, padding: 16, gap: 8 }}
    >
      <Text size="sm" weight={600} style={{ lineHeight: 14 }}>
        Accessibility data
      </Text>
      {details ? (
        // A read-only textarea wraps, scrolls and selects the text as one native element; a long
        // capture is thousands of lines, too many for one text element per line.
        <textarea
          value={details.content}
          readOnly
          minRows={1}
          maxRows={15}
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            lineHeight: 16,
            color: theme.foreground,
            backgroundColor: alpha(theme.muted, 0.45),
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.7),
            borderRadius: RADIUS.md,
            padding: 10,
          }}
        />
      ) : (
        <div style={{ borderRadius: RADIUS.md, borderWidth: 1, borderColor: alpha(theme.border, 0.7), backgroundColor: alpha(theme.muted, 0.45), padding: 10 }}>
          <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 16 }}>
            {includes
              ? "Structured accessibility elements were included, but they have no readable names or values."
              : "The app or capture backend did not provide verified accessibility data."}
          </Text>
        </div>
      )}
    </Popover>
  );
}
