// apps/web/src/components/ui/dialog.tsx as the Usage dialogs compose it: header
// (title + description, optional leading icon), close button at the top right,
// a scrolling panel, and a bare footer. The kit Dialog in ui/overlay.tsx has a
// string-only header and a bordered footer, so these dialogs build their own shell.
import { useWindowSize } from "@gpuix/react";
import * as DialogPrimitive from "@gpuix/react/dialog";
import type { ReactNode } from "react";

import { IconButton, Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";

export function UsageDialog({
  open,
  onOpenChange,
  title,
  titleIcon,
  description,
  children,
  footer,
  width,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  titleIcon?: ReactNode;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width: number;
  testId?: string;
}) {
  const theme = useTheme();
  const { height: viewportHeight } = useWindowSize();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.overlay, pointerEvents: "auto" }}
        />
        <DialogPrimitive.Popup
          testId={testId}
          style={{
            display: "flex",
            flexDirection: "column",
            width,
            maxWidth: "92%",
            maxHeight: Math.max(240, viewportHeight - 64),
            borderRadius: RADIUS["2xl"],
            borderWidth: 1,
            borderColor: theme.appearance === "dark" ? alpha("#ffffff", 0.08) : alpha(theme.foreground, 0.1),
            backgroundColor: theme.appearance === "dark" ? "#0f0f0f" : "#ffffff",
            boxShadow: { offsetX: 0, offsetY: 24, blurRadius: 72, spreadRadius: -20, color: "#000000e6" },
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              paddingTop: 24,
              paddingLeft: 24,
              paddingRight: 8,
              paddingBottom: 12,
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flexGrow: 1, minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                {titleIcon}
                <Text size="xl" weight={600} style={{ lineHeight: 20 }}>
                  {title}
                </Text>
              </div>
              {description ? <Text color={theme.mutedForeground}>{description}</Text> : null}
            </div>
            <IconButton icon="x" size={32} testId={testId ? `${testId}-close` : undefined} onClick={() => onOpenChange(false)} style={{ marginTop: -16 }} />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              paddingLeft: 24,
              paddingRight: 24,
              paddingTop: 4,
              paddingBottom: footer ? 4 : 24,
              minHeight: 0,
              flexShrink: 1,
              overflowY: "scroll",
            }}
          >
            {children}
          </div>
          {footer ? (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                paddingTop: 16,
                paddingBottom: 16,
                paddingLeft: 24,
                paddingRight: 24,
                flexShrink: 0,
              }}
            >
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
