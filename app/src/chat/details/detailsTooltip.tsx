// A Tooltip whose wrapper can grow and shrink inside a flex row. The overlay kit's
// Tooltip wraps its trigger in a content-sized root, so a truncating row label inside
// it would push past the card instead of ellipsizing.
import * as TooltipPrimitive from "@gpuix/react/tooltip";
import type { ReactElement } from "react";

import type { FloatingSide } from "@gpuix/react/floating";
import { RADIUS, useTheme, FONTS } from "../../ui/theme.ts";

export function GrowTooltip({
  content,
  side = "bottom",
  children,
}: {
  content: string;
  side?: FloatingSide;
  children: ReactElement;
}) {
  const theme = useTheme();
  return (
    <TooltipPrimitive.Root style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, alignItems: "stretch" }}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={6}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 8,
          paddingRight: 8,
          maxWidth: 320,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.appearance === "dark" ? "#141414" : "#ffffff",
        }}
      >
        <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>{content}</text>
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Root>
  );
}
