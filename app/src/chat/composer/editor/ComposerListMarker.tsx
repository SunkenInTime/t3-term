// List markers in the composer: what web's composer shows beside a list item
// (apps/web/src/index.css: `ul` disc, `ul ul` circle, `ul ul ul` square, an ordered item's
// `content: attr(data-marker) " "` marker, and a task item's native checkbox in
// `li[data-checked] > label`). Painted as boxes beside the item's first line; the editor's
// press handler toggles a checkbox (ComposerEditor checkboxAt), since a press there also
// reaches the editor, which captures the pointer.
import { memo } from "react";

import { useTheme } from "../../../ui/theme.ts";
import type { ListMarker } from "./layout.ts";

/** The checkbox label's width (web `width: 0.95rem`): the part of the line a press toggles. */
export const TASK_LABEL_WIDTH = 15.2;

// Chrome's bullet glyphs at 14px, measured on web at 1440x900 against this editor's text: a
// 5px disc or square starting 17px before the text, a 7px ring 18px before it, both centred
// 12px below the line's top.
const BULLET_CENTER_Y = 12;

// Chrome's own check mark, traced in a 15px box.
const CHECK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 15"><path d="M3.6 7.6 L6.1 10.2 L11.4 3.6" fill="none" stroke="black" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter"/></svg>';

export const ListMarkerView = memo(function ListMarkerView({
  marker,
  top,
  textStyle,
}: {
  marker: ListMarker;
  /** Top of the item's first line. */
  top: number;
  textStyle: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
}) {
  const theme = useTheme();
  switch (marker.kind) {
    case "text":
      return (
        <div style={{ ...textStyle, position: "absolute", left: marker.x, top, height: textStyle.lineHeight, whiteSpace: "nowrap", pointerEvents: "none" }}>
          {marker.text}
        </div>
      );
    case "disc":
    case "square":
    case "circle": {
      const size = marker.kind === "circle" ? 7 : 5;
      return (
        <div
          style={{
            position: "absolute",
            left: marker.contentX - (marker.kind === "circle" ? 18 : 17),
            top: top + BULLET_CENTER_Y - size / 2,
            width: size,
            height: size,
            borderRadius: marker.kind === "square" ? 0 : size / 2,
            ...(marker.kind === "circle" ? { borderWidth: 1, borderColor: textStyle.color } : { backgroundColor: textStyle.color }),
            pointerEvents: "none",
          }}
        />
      );
    }
    case "checkbox": {
      // Chrome's native box, sampled from web: dark #3b3b3b / #858585 and #99c8ff, light white
      // / #767676 and #0075ff. `height: 1lh` centres the 0.95rem box in the line; GPUI sets
      // the text a pixel lower in the line than Chrome, so the box goes 5px down, not 3.9px.
      const dark = theme.appearance === "dark";
      const checkedFill = dark ? "#99c8ff" : "#0075ff";
      return (
        <div
          style={{
            position: "absolute",
            left: Math.round(marker.x),
            top: top + Math.round((textStyle.lineHeight - TASK_LABEL_WIDTH) / 2) + 1,
            width: 15,
            height: 15,
            borderRadius: 2,
            borderWidth: marker.checked ? 0 : 1,
            borderColor: dark ? "#858585" : "#767676",
            backgroundColor: marker.checked ? checkedFill : dark ? "#3b3b3b" : "#ffffff",
            pointerEvents: "none",
          }}
        >
          {marker.checked ? (
            <svg source={CHECK_SVG} style={{ position: "absolute", left: 0, top: 0, width: 15, height: 15, color: dark ? "#3b3b3b" : "#ffffff", pointerEvents: "none" }} />
          ) : null}
        </div>
      );
    }
  }
});
