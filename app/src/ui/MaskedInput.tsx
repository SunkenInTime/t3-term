// web <Input type="password"> (apps/web/src/components/settings/SecretInput.tsx,
// SecretRequestCard.tsx). gpuix inputs cannot mask, so the real value lives in a
// normal <input> whose text is transparent, and bullets are painted over it.
// The input keeps every native edit (caret moves, selection, mid-string inserts,
// deletes, paste over a selection), because it edits the real text. Both runs
// use the monospaced font, whose glyphs (the bullet included) share one
// advance, so the caret and selection the input draws line up with the bullets.
import type { Style } from "./primitives.tsx";
import { useState } from "react";

import { FONTS, alpha, useTheme } from "./theme.ts";

const MASK = "•";
const PROBE_LENGTH = 20;

export function MaskedInput({
  value,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  placeholder,
  readOnly,
  testId,
  fontSize = 14,
  height,
  color,
  style,
}: {
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  readOnly?: boolean;
  testId?: string;
  fontSize?: number;
  /** The input's line box; the bullets are centred on it. */
  height: number;
  color?: string;
  style?: Style;
}) {
  const theme = useTheme();
  // Consolas/Menlo cells are wider than the proportional bullets web's password
  // field draws; three quarters of the size brings the run to web's density.
  const maskFontSize = Math.round(fontSize * 0.75 * 2) / 2;
  const [advance, setAdvance] = useState(0);
  const [width, setWidth] = useState(0);
  const length = [...value].length;
  // Past the field's width the input scrolls to keep the caret visible; every
  // bullet looks alike, so a full row of them, pinned to the edge the caret is
  // nearest when typing, stands in for whatever slice the input shows.
  const overflowing = advance > 0 && width > 0 && length * advance > width;
  const bullets = overflowing ? Math.ceil(width / advance) : length;
  const textColor = color ?? theme.foreground;
  return (
    <div
      style={{ position: "relative", display: "flex", flexDirection: "row", alignItems: "center", flexGrow: 1, minWidth: 0, height, ...style }}
      onLayout={(event) => {
        const next = (event as { width?: number }).width;
        if (typeof next === "number" && next !== width) setWidth(next);
      }}
    >
      <input
        testId={testId}
        value={value}
        readOnly={readOnly}
        theme={{ caret: theme.foreground, textMuted: theme.mutedForeground, appearance: theme.appearance }}
        onChange={(event) => onChange?.(event.value ?? "")}
        onSubmit={(event) => onSubmit?.(event.value ?? value)}
        onFocus={() => onFocus?.()}
        onBlur={() => onBlur?.()}
        style={{
          flexGrow: 1,
          minWidth: 0,
          height,
          lineHeight: height,
          fontSize: maskFontSize,
          fontFamily: FONTS.mono,
          color: "#00000000",
          selectionColor: alpha(theme.primary, 0.4),
        }}
      />
      {/* The input's own placeholder would take the small monospaced mask font. */}
      {length === 0 && placeholder ? (
        <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, display: "flex", flexDirection: "row", alignItems: "center", overflow: "hidden", pointerEvents: "none" }}>
          <text style={{ color: theme.mutedForeground, fontSize, lineHeight: height, fontFamily: FONTS.sans, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
            {placeholder}
          </text>
        </div>
      ) : null}
      {bullets > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: overflowing ? "flex-end" : "flex-start",
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <text style={{ color: textColor, fontSize: maskFontSize, lineHeight: height, fontFamily: FONTS.mono, whiteSpace: "nowrap" }}>
            {MASK.repeat(bullets)}
          </text>
        </div>
      ) : null}
      {/* One bullet's advance at this size, measured by GPUI rather than assumed. */}
      <text
        onLayout={(event) => {
          const measured = (event as { width?: number }).width;
          if (typeof measured === "number" && measured > 0 && measured / PROBE_LENGTH !== advance) setAdvance(measured / PROBE_LENGTH);
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          color: "#00000000",
          fontSize: maskFontSize,
          fontFamily: FONTS.mono,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {MASK.repeat(PROBE_LENGTH)}
      </text>
    </div>
  );
}
