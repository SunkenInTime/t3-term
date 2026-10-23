// apps/web/src/components/chat/ProviderInstanceIcon.tsx, reduced to what the
// sidebar draws: the driver's brand mark (OpenAI, Claude) tinted like web, or
// the instance's initials for drivers without a bundled mark.
import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";

import { FONTS, useTheme } from "../ui/theme.ts";
import { CLAUDE_SVG, OPENAI_SVG } from "./providerMarks.gen.ts";

export function ProviderIcon({
  driverKind,
  displayName,
  size = 14,
  opacity = 1,
  grayscale = false,
  color: currentColor,
}: {
  driverKind: string;
  displayName: string;
  size?: number;
  opacity?: number;
  /** Web's `grayscale` filter for previous providers in the stack. */
  grayscale?: boolean;
  /** The surrounding text colour: marks drawn with `fill-current` (OpenAI) take it. */
  color?: string;
}) {
  const theme = useTheme();
  const mark = driverKind === "codex" ? OPENAI_SVG : driverKind === "claudeAgent" ? CLAUDE_SVG : null;
  if (mark === null) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          flexShrink: 0,
          opacity,
          pointerEvents: "none",
        }}
      >
        <text style={{ color: theme.foreground, fontSize: 10, fontWeight: 600, fontFamily: FONTS.sans, lineHeight: 10 }}>
          {providerInstanceInitials(displayName)}
        </text>
      </div>
    );
  }
  // Claude's mark is brand orange; grayscale turns it into its luminance.
  const color =
    driverKind === "claudeAgent" ? (grayscale ? "#9a9a9a" : "#d97757") : (currentColor ?? theme.foreground);
  return (
    <svg
      source={mark}
      style={{ width: size, height: size, flexShrink: 0, color, opacity, pointerEvents: "none" }}
    />
  );
}
