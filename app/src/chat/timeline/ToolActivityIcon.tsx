// apps/web/src/components/chat/TimelineToolActivityIcon.tsx: the 16px glyph in
// front of every tool row. Lucide names map 1:1; the browser glyph and the T3
// wordmark are inline SVGs like in web.
import type { ToolActivityIcon } from "@t3tools/contracts";
import { toolActivityFaviconUrl } from "@t3tools/shared/favicon";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { useTheme } from "../../ui/theme.ts";
import type { WorkEntryIconName } from "../../web/components/chat/TimelineWorkEntryRow.logic.ts";

export function toolIconAcceptsTint(toolIcon: ToolActivityIcon | undefined): boolean {
  return toolIcon === undefined;
}

/** `text-tool-error-icon/40`. */
export function failedToolIconColor(theme: ReturnType<typeof useTheme>): string {
  return theme.appearance === "dark" ? "#fca5a566" : "#fb2c3666";
}

const BROWSER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 19H7.2C4.4 19 3 17.5 3 14.6V7.4C3 4.5 4.5 3 7.4 3h8.2C18.5 3 20 4.5 20 7.4v2.4"/><circle cx="7.4" cy="7.2" r="0.75" fill="#000" stroke="none"/><path d="M11.2 7.2h4.3"/><path d="m12.4 11.4 7.5 2.6-3.4 1.6-1.5 3.6z" fill="#000" stroke="none"/></svg>';

export const T3_WORDMARK_SVG =
  '<svg viewBox="15.5309 37 94.3941 56.96" xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"/></svg>';

const LUCIDE_FOR: Record<Exclude<WorkEntryIconName, "browser" | "computer" | "t3-code">, IconName> = {
  bot: "bot",
  brain: "brain",
  check: "check",
  "circle-alert": "circle-alert",
  code: "code-xml",
  device: "smartphone",
  eye: "eye",
  globe: "globe",
  hammer: "hammer",
  "message-circle": "message-circle",
  search: "search",
  "square-pen": "square-pen",
  terminal: "terminal",
  "pull-request": "git-pull-request-arrow",
  wrench: "wrench",
  x: "x",
  zap: "zap",
};

export function WorkEntryIcon({ name, size = 16, color }: { name: WorkEntryIconName; size?: number; color: string }) {
  if (name === "browser" || name === "computer") {
    return <svg source={BROWSER_SVG} style={{ width: size, height: size, flexShrink: 0, color, pointerEvents: "none" }} />;
  }
  if (name === "t3-code") {
    // The wordmark is wider than tall; web sizes it to the 16px box.
    return <svg source={T3_WORDMARK_SVG} style={{ width: size, height: Math.round(size * 0.6), flexShrink: 0, color, pointerEvents: "none" }} />;
  }
  return <Icon name={LUCIDE_FOR[name]} size={size} color={color} />;
}

/** ToolActivityIconView: a favicon or provider logo when the tool names one, else the glyph. */
export function ToolActivityIconView({
  icon,
  fallbackName,
  color,
  muted,
  size = 16,
}: {
  icon: ToolActivityIcon | undefined;
  fallbackName: WorkEntryIconName;
  color: string;
  muted: boolean;
  size?: number;
}) {
  const theme = useTheme();
  const glyph = <WorkEntryIcon name={fallbackName} size={size} color={color} />;
  if (!icon) return <div style={{ opacity: muted ? 0.7 : 1, display: "flex" }}>{glyph}</div>;
  const src =
    icon._tag === "website"
      ? toolActivityFaviconUrl(icon, theme.appearance, 32)
      : icon._tag === "themed-logo"
        ? theme.appearance === "dark"
          ? (icon.logoUrlDark ?? icon.logoUrl)
          : icon.logoUrl
        : null;
  if (!src) return <div style={{ opacity: muted ? 0.7 : 1, display: "flex" }}>{glyph}</div>;
  return (
    <img
      src={src}
      objectFit="contain"
      style={{ width: size, height: size, borderRadius: 2, flexShrink: 0, opacity: muted ? 0.7 : 1, pointerEvents: "none" }}
    />
  );
}
