// Port of apps/web/src/components/chat/TraitsSpeed.tsx: which speed tier a model selection
// runs at ("Fast" / "Ultrafast") and its lightning icon.
import type { ProviderDriverKind, ProviderOptionDescriptor } from "@t3tools/contracts";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";

import { LUCIDE } from "../../ui/lucide.gen.ts";
import { alpha, useTheme } from "../../ui/theme.ts";

export function getTraitsSpeedDisplay(
  provider: ProviderDriverKind,
  descriptor: ProviderOptionDescriptor,
): { label: string; speedIcon: "fast" | "ultrafast" | null } | null {
  if (descriptor.id === "fastMode" && descriptor.type === "boolean") {
    return {
      label: descriptor.currentValue === true ? "Fast" : "Normal",
      speedIcon: descriptor.currentValue === true ? "fast" : null,
    };
  }
  if (provider !== "codex" || descriptor.id !== "serviceTier" || descriptor.type !== "select") {
    return null;
  }
  const currentValue = getProviderOptionCurrentValue(descriptor);
  const fastTier = descriptor.options.find(({ label }) => label === "Fast");
  const ultrafastTier = descriptor.options.find(({ label }) => label === "Ultrafast");
  if (
    ((fastTier || ultrafastTier) && currentValue === "default") ||
    (fastTier && currentValue === fastTier.id) ||
    (ultrafastTier && currentValue === ultrafastTier.id)
  ) {
    return {
      label: descriptor.options.find(({ id }) => id === currentValue)?.label ?? "Normal",
      speedIcon:
        ultrafastTier && currentValue === ultrafastTier.id
          ? "ultrafast"
          : fastTier && currentValue === fastTier.id
            ? "fast"
            : null,
    };
  }
  return null;
}

// web Icons.tsx UltrafastIcon: a faded bolt behind a solid one. Monochrome svgs tint every
// path alike, so the faded bolt is its own svg at 40% opacity.
const BOLT_BACK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000"><path d="m17 2-10 12h7l-1 8 10-12h-7l1-8Z"/></svg>`;
const BOLT_FRONT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000"><path d="m11 2-10 12h7l-1 8 10-12h-7l1-8Z"/></svg>`;

/** web `ZapIcon` with `fill-current`. */
const FILLED_ZAP = LUCIDE.zap.replace('fill="none"', 'fill="#000"');

/** The filled bolt (Claude's in its orange at sm), 80% opacity. `xs` follows the text color. */
export function TraitsSpeedIcon({
  provider,
  speedIcon,
  size = "sm",
  color,
}: {
  provider: ProviderDriverKind;
  speedIcon: "fast" | "ultrafast";
  size?: "xs" | "sm";
  color?: string;
}) {
  const theme = useTheme();
  const px = size === "xs" ? 12 : 14;
  const tint = alpha(
    size === "xs" ? (color ?? theme.mutedForeground) : provider === "claudeAgent" ? "#d97757" : theme.foreground,
    0.8,
  );
  if (speedIcon === "fast") {
    return <svg source={FILLED_ZAP} style={{ width: px, height: px, flexShrink: 0, color: tint }} />;
  }
  return (
    <div style={{ position: "relative", width: px, height: px, flexShrink: 0 }}>
      <svg source={BOLT_BACK} style={{ position: "absolute", left: 0, top: 0, width: px, height: px, color: tint, opacity: 0.4 }} />
      <svg source={BOLT_FRONT} style={{ position: "absolute", left: 0, top: 0, width: px, height: px, color: tint }} />
    </div>
  );
}
