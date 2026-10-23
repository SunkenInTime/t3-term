import type { OrchestrationProjectShell } from "@t3tools/contracts";

import { FONTS, alpha, useTheme } from "../ui/theme.ts";

const MONOGRAM_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

function monogram(title: string): string {
  const words = title.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function colorFor(title: string): string {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length]!;
}

/** apps/web/src/components/ProjectMonogram.tsx: rounded tile, color at 14%, bold mono letters. */
export function ProjectGlyph({ project, size = 16 }: { project: OrchestrationProjectShell | undefined; size?: number }) {
  const theme = useTheme();
  const title = project?.title ?? "";
  const color = title ? colorFor(title) : theme.mutedForeground;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.25),
        backgroundColor: alpha(color, 0.14),
        flexShrink: 0,
      }}
    >
      <text style={{ color, fontSize: size * 0.52, fontWeight: 700, fontFamily: FONTS.mono, lineHeight: size }}>
        {title ? monogram(title) : ""}
      </text>
    </div>
  );
}
