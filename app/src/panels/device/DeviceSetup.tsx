// Port of apps/web/src/components/device/DeviceSetup.tsx inside WizardPopup
// (components/ui/wizard.tsx): the "Set up devices" dialog web shows while the
// device hub is off or onboarding is incomplete. The status helpers are shared
// with the Integrations settings page (settings/integrations/DeviceParts.tsx).
import { AuthSettingsWriteScope, type DeviceServiceState, type EnvironmentId } from "@t3tools/contracts";
import * as DialogPrimitive from "@gpuix/react/dialog";
import { useEffect, useState, type ReactNode } from "react";

import {
  AgentDeviceSetupStatus,
  agentDeviceDescription,
  DeviceHostDiagnostics,
  DeviceHostUpdates,
  DeviceHubSetupStatus,
  deviceHubDescription,
  deviceHubReadiness,
  PlatformStatus,
  platformSetupStatus,
} from "../../settings/integrations/DeviceParts.tsx";
import { deviceEnvironment } from "../../state/device.ts";
import { useAtomCommand } from "../../state/settings.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/terminal.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Switch } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { alpha, FONTS, RADIUS, useTheme } from "../../ui/theme.ts";

export function DeviceSetupDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly state: DeviceServiceState;
  readonly onComplete?: () => void;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  if (!props.open) return null;
  return (
    <DialogPrimitive.Root open onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.overlay, pointerEvents: "auto" }}
        />
        <DialogPrimitive.Popup
          testId="device-setup-dialog"
          style={{
            display: "flex",
            flexDirection: "column",
            width: 576,
            maxWidth: "92%",
            borderRadius: RADIUS["2xl"],
            borderWidth: 1,
            borderColor: dark ? alpha("#ffffff", 0.08) : alpha(theme.foreground, 0.1),
            backgroundColor: dark ? theme.background : "#ffffff",
            boxShadow: { offsetX: 0, offsetY: 24, blurRadius: 72, spreadRadius: -20, color: "#000000e6" },
            overflow: "hidden",
            position: "relative",
          }}
        >
          <DeviceSetup
            environmentId={props.environmentId}
            state={props.state}
            onCancel={() => props.onOpenChange(false)}
            {...(props.onComplete ? { onComplete: props.onComplete } : {})}
          />
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex" }}>
            <IconButton testId="device-setup-close" icon="x" size={28} iconSize={16} onClick={() => props.onOpenChange(false)} />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function DeviceSetup(props: {
  readonly environmentId: EnvironmentId;
  readonly state: DeviceServiceState;
  readonly onCancel: () => void;
  readonly onComplete?: () => void;
}) {
  const theme = useTheme();
  const canConfigure = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const configure = useAtomCommand(deviceEnvironment.configure);
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const [pending, setPending] = useState<"hub" | "check" | "agent" | "complete" | null>(null);
  const [step, setStep] = useState(0);
  const enabled = props.state.hostStatus !== "disabled";
  const { ready, busy } = deviceHubReadiness(props.state);
  const localPlatformsUnavailable = props.state.hosts.some(
    (host) => host.kind === "local" && !host.platforms.some((platform) => platform.available),
  );

  // Remote hosts report platforms only after a probe, like the Device panel's refresh on open.
  useEffect(() => {
    if (enabled) void list({ environmentId: props.environmentId, input: {} });
  }, [enabled, props.environmentId]);

  const update = async (
    kind: NonNullable<typeof pending>,
    input: { enabled?: boolean; agentAccessEnabled?: boolean; onboardingCompleted?: boolean },
  ) => {
    if (!readEnvironmentScope(props.environmentId, AuthSettingsWriteScope)) return;
    setPending(kind);
    const result = await configure({ environmentId: props.environmentId, input });
    setPending(null);
    if (kind === "complete" && result._tag === "Success") props.onComplete?.();
  };

  return (
    <>
      {/* DialogHeader: gap-2 p-6, pb-3 above a panel; DialogTitle is text-xl leading-none. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 24, paddingBottom: 12 }}>
        <Text size="xl" weight={600} style={{ lineHeight: 20 }}>
          Set up devices
        </Text>
        <Text color={theme.mutedForeground}>Review what runs on this environment before using simulators and emulators.</Text>
        <WizardSteps
          steps={["Device hub", "Simulators", "Agent access"]}
          currentStep={step}
          onStepChange={setStep}
          isStepDisabled={(requested) => busy || pending !== null || requested > step}
        />
      </div>
      <WizardPanel>
        <DeviceHostUpdates state={props.state} environmentId={props.environmentId} />
        {step === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Text weight={500}>Enable the device hub</Text>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
                <Text color={theme.mutedForeground}>{deviceHubDescription}</Text>
              </div>
              <div style={{ marginTop: 2 }}>
                <Switch
                  testId="device-setup-hub-switch"
                  checked={enabled}
                  disabled={!canConfigure || busy || pending !== null}
                  onChange={(checked) => void update("hub", { enabled: checked, ...(checked ? {} : { agentAccessEnabled: false }) })}
                />
              </div>
            </div>
            <DeviceHubSetupStatus state={props.state} pending={pending === "hub" || (busy && pending !== "agent")} />
          </div>
        ) : null}

        {step === 1 || (step === 0 && enabled && localPlatformsUnavailable) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, ...(step === 0 ? { marginTop: 16 } : {}) }}>
            <Text weight={500}>Check simulator support</Text>
            <PlatformStatus platform="iOS" status={platformSetupStatus(props.state, "ios")} />
            <PlatformStatus platform="Android" status={platformSetupStatus(props.state, "android")} />
            <DeviceHostDiagnostics hosts={props.state.hosts} hostStatuses={props.state.hostStatuses} />
            <Text size="xs" color={theme.mutedForeground}>
              You can use either platform. Fixing a missing platform does not block the other one.
            </Text>
            <div style={{ display: "flex", flexDirection: "row" }}>
              <Button
                testId="device-setup-check"
                size="sm"
                variant="outline"
                disabled={!enabled || busy || pending !== null}
                icon={pending === "check" ? "loader-circle" : undefined}
                onClick={() => {
                  setPending("check");
                  void list({ environmentId: props.environmentId, input: {} }).finally(() => setPending(null));
                }}
              >
                {pending === "check" ? "Checking…" : "Check again"}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Text weight={500}>Allow agent control</Text>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
                <Text color={theme.mutedForeground}>{agentDeviceDescription}</Text>
              </div>
              <div style={{ marginTop: 2 }}>
                <Switch
                  testId="device-setup-agent-switch"
                  checked={props.state.agentAccessEnabled}
                  disabled={!canConfigure || !enabled || busy || pending !== null}
                  onChange={(checked) => void update("agent", { agentAccessEnabled: checked })}
                />
              </div>
            </div>
            <AgentDeviceSetupStatus state={props.state} pending={pending === "agent"} />
            <Text size="xs" color={theme.mutedForeground}>
              Leave this off to keep manual device controls without giving agents access.
            </Text>
          </div>
        ) : null}
        {props.state.hostStatus === "failed" && props.state.hostStatusDetail ? (
          <Text size="xs" color={theme.errorForeground} style={{ marginTop: 12 }}>
            {props.state.hostStatusDetail}
          </Text>
        ) : null}
      </WizardPanel>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
          paddingLeft: 24,
          paddingRight: 24,
          paddingTop: 16,
          paddingBottom: 16,
        }}
      >
        {step === 0 ? (
          <Button testId="device-setup-cancel" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : (
          <Button testId="device-setup-back" variant="outline" disabled={busy || pending !== null} onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < 2 ? (
          <Button testId="device-setup-continue" disabled={!ready || pending !== null} onClick={() => setStep(step + 1)}>
            Continue
          </Button>
        ) : (
          <Button
            testId="device-setup-done"
            disabled={!canConfigure || !ready || pending !== null}
            onClick={() => void update("complete", { onboardingCompleted: true })}
          >
            {pending === "complete" ? "Saving…" : "Done"}
          </Button>
        )}
      </div>
    </>
  );
}

/** ui/wizard.tsx WizardPanel: the tinted band between header and footer. */
function WizardPanel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 20,
        paddingBottom: 20,
        backgroundColor: dark ? alpha("#ffffff", 0.02) : alpha(theme.background, 0.8),
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: dark ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05),
      }}
    >
      {children}
    </div>
  );
}

/** ui/wizard.tsx WizardSteps: numbered steps; done ones show a check, later ones are disabled. */
function WizardSteps({
  steps,
  currentStep,
  onStepChange,
  isStepDisabled,
}: {
  steps: readonly string[];
  currentStep: number;
  onStepChange: (step: number) => void;
  isStepDisabled: (step: number) => boolean;
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
            testId={`device-setup-step-${index}`}
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
