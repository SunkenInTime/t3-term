// apps/web/src/components/ui/wizard.tsx for the welcome wizard: WizardPopup,
// WizardHeader, WizardSteps and WizardPanel, on gpuix's dialog primitive.
// settings/providers/AddProviderDialog.tsx draws the same steps for its own
// wizard; this copy carries the props the welcome wizard needs.
import * as DialogPrimitive from "@gpuix/react/dialog";
import type { ReactNode } from "react";

import { Icon } from "../ui/Icon.tsx";
import { dialogGlassShadow } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { T3_WORDMARK_SVG } from "../chat/timeline/ToolActivityIcon.tsx";

/**
 * `<Dialog open disablePointerDismissal>` whose every close request is cancelled
 * except the X, which calls `onClosePress` (WelcomeWizard finishes setup there).
 */
export function WizardPopup({
  onClosePress,
  closeDisabled,
  children,
  testId,
}: {
  readonly onClosePress: () => void;
  readonly closeDisabled?: boolean;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  return (
    <DialogPrimitive.Root open onOpenChange={() => undefined}>
      <DialogPrimitive.Portal style={{ flexDirection: "column", justifyContent: "center", alignItems: "center", padding: 16 }}>
        <DialogPrimitive.Backdrop
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.overlay, pointerEvents: "auto" }}
        />
        <DialogPrimitive.Popup
          testId={testId}
          style={{
            display: "flex",
            flexDirection: "column",
            width: 768,
            maxWidth: "100%",
            borderRadius: RADIUS["2xl"],
            borderWidth: 1,
            borderColor: dark ? alpha("#ffffff", 0.08) : alpha(theme.foreground, 0.1),
            backgroundColor: dark ? theme.background : "#ffffff",
            boxShadow: dialogGlassShadow(theme),
            overflow: "hidden",
            position: "relative",
          }}
        >
          {children}
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex" }}>
            <IconButton
              testId="welcome-close"
              icon="x"
              size={28}
              iconSize={16}
              onClick={closeDisabled ? () => undefined : onClosePress}
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** WizardHeader with WelcomeWizard's identity: the T3 wordmark and a muted "Code". */
export function WizardHeader({ children }: { readonly children?: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 24, paddingRight: 24, paddingTop: 24, paddingBottom: 12 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
        <svg source={T3_WORDMARK_SVG} style={{ width: 27, height: 16, marginBottom: 6, color: theme.foreground }} />
        <text style={{ color: theme.mutedForeground, fontSize: 24, lineHeight: 32, fontWeight: 500, fontFamily: FONTS.sans }}>Code</text>
      </div>
      {children}
    </div>
  );
}

export function WizardSteps({
  steps,
  currentStep,
  isStepDisabled,
  onStepChange,
}: {
  readonly steps: readonly string[];
  readonly currentStep: number;
  readonly isStepDisabled: (step: number) => boolean;
  readonly onStepChange: (step: number) => void;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 4,
        padding: 4,
        borderRadius: RADIUS.xl,
        backgroundColor: dark ? alpha("#ffffff", 0.04) : theme.background,
        borderWidth: 1,
        borderColor: dark ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05),
      }}
    >
      {steps.map((step, index) => {
        const current = index === currentStep;
        const done = index < currentStep;
        const disabled = isStepDisabled(index);
        return (
          <div
            key={step}
            testId={`welcome-step-${index}`}
            onClick={disabled ? undefined : () => onStepChange(index)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 8,
              paddingBottom: 8,
              borderRadius: RADIUS.lg,
              cursor: disabled ? "default" : "pointer",
              ...(current
                ? { backgroundColor: theme.card, borderWidth: 1, borderColor: dark ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05) }
                : disabled
                  ? {}
                  : { hover: { backgroundColor: theme.card } }),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: done ? theme.primary : current ? alpha(theme.primary, 0.3) : dark ? alpha("#ffffff", 0.1) : alpha("#000000", 0.1),
                backgroundColor: done ? theme.primary : current ? alpha(theme.primary, 0.1) : dark ? alpha("#ffffff", 0.05) : theme.card,
                flexShrink: 0,
                pointerEvents: "none",
              }}
            >
              {done ? (
                <Icon name="check" size={16} color={theme.primaryForeground} />
              ) : (
                <text style={{ color: current ? theme.primary : theme.mutedForeground, fontSize: 14, lineHeight: 18, fontWeight: 500, fontFamily: FONTS.sans }}>
                  {String(index + 1)}
                </text>
              )}
            </div>
            <Text weight={500} color={current ? theme.foreground : theme.mutedForeground} truncate>
              {step}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

/** `bg-background/80 px-6 py-5 ring-1 ring-black/5 dark:bg-white/2 dark:ring-white/5` */
export function WizardPanel({ children }: { readonly children: ReactNode }) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 20,
        paddingBottom: 20,
        backgroundColor: dark ? alpha("#ffffff", 0.02) : alpha(theme.background, 0.8),
        borderTopWidth: 1,
        borderColor: dark ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05),
      }}
    >
      {children}
    </div>
  );
}
