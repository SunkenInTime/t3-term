// Port of apps/web/src/components/settings/PanelAnimationsPreview.tsx: a
// miniature app whose side panels and bottom bar fold on click at the chosen
// duration. The CSS width/height transition becomes a one-shot motion.div.
import { motion } from "@gpuix/react";
import { useState } from "react";

import { Tooltip } from "../../ui/overlay.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";

export function PanelAnimationsPreview({ durationMs, width = 112 }: { durationMs: number; width?: number }) {
  const theme = useTheme();
  const [panelsOpen, setPanelsOpen] = useState(true);
  const transition = { duration: durationMs / 1000, ease: "easeOut" as const };
  const line = (fraction: number, opacity: number) => (
    <div style={{ width: `${Math.round(fraction * 100)}%` as "100%", height: 2, borderRadius: 1, backgroundColor: alpha(theme.mutedForeground, opacity) }} />
  );
  return (
    <Tooltip content="Replay panel animation preview" side="top">
      <div
        testId="panel-animations-preview"
        onClick={() => setPanelsOpen((open) => !open)}
        style={{
          display: "flex",
          flexDirection: "row",
          width,
          height: 40,
          padding: 4,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.background,
          overflow: "hidden",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <motion.div
          initial={false}
          animate={{ width: panelsOpen ? 16 : 0 }}
          transition={transition}
          style={{ height: "100%", borderRadius: RADIUS.sm, backgroundColor: theme.sidebar.background, flexShrink: 0, pointerEvents: "none" }}
        />
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, paddingLeft: 4, paddingRight: 4, pointerEvents: "none" }}>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, gap: 4, paddingTop: 4 }}>
            {line(1, 0.25)}
            {line(0.8, 0.2)}
            {line(0.6, 0.15)}
          </div>
          <motion.div
            initial={false}
            animate={{ height: panelsOpen ? 8 : 0 }}
            transition={transition}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              flexShrink: 0,
              overflow: "hidden",
              paddingLeft: 8,
              paddingRight: 8,
              borderTopWidth: panelsOpen ? 1 : 0,
              borderColor: alpha(theme.border, 0.7),
              backgroundColor: alpha(theme.foreground, 0.05),
            }}
          >
            <div style={{ width: "66%" as "100%", height: 1, borderRadius: 1, backgroundColor: alpha(theme.mutedForeground, 0.25) }} />
          </motion.div>
        </div>
        <motion.div
          initial={false}
          animate={{ width: panelsOpen ? 20 : 0 }}
          transition={transition}
          style={{ height: "100%", borderRadius: RADIUS.sm, backgroundColor: theme.muted, flexShrink: 0, pointerEvents: "none" }}
        />
      </div>
    </Tooltip>
  );
}
