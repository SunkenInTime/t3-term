// apps/web/src/components/chat/ProviderModelPicker.tsx: the composer's model control
// (provider mark + model name + chevron) and the popover holding ModelPickerContent.
// Open state is controlled; Composer.tsx binds it to `modelPickerOpenAtom` so the
// mod+shift+M shortcut and the trigger share it.
import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { ANTIGRAVITY_DEFAULT_MODEL } from "@t3tools/contracts";

import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import { resolveModelPickerSelectedModel } from "../../web/components/chat/ModelPickerContent.logic.ts";
import {
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
} from "../../web/components/chat/providerIconUtils.ts";
import { shortcutLabelForCommand } from "../../web/keybindings.ts";
import type { AppModelOption } from "../../web/modelSelection.ts";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../web/providerInstances.ts";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlLabel,
  type ComposerControlSize,
} from "./ComposerControl.tsx";
import { MODEL_PICKER_MAX_HEIGHT, ModelPickerContent, SHORTCUT_PLATFORM } from "./ModelPickerContent.tsx";
import { OutlineBadge } from "./ModelPickerListRow.tsx";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon.tsx";
import { usePopoverSide, useReopenGuard } from "./ModelPickerPopover.ts";

export interface ProviderModelPickerProps {
  readonly environmentId: EnvironmentId | null;
  readonly activeInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly lockedContinuationGroupKey?: string | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly keybindings?: ResolvedKeybindingsConfig;
  readonly size?: ComposerControlSize;
  readonly disabled?: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  readonly onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  readonly onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}

export function ProviderModelPicker(props: ProviderModelPickerProps) {
  const theme = useTheme();
  const size = props.size ?? "sm";
  const open = props.open && !props.disabled;
  const activeEntry = props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null;
  const options = props.modelOptionsByInstance.get(props.activeInstanceId) ?? [];
  const selectedModel =
    resolveModelPickerSelectedModel({ driverKind: activeEntry?.driverKind, model: props.model, options }) ??
    (activeEntry?.driverKind === "opencode" || activeEntry?.driverKind === "antigravity" ? undefined : options[0]);
  const triggerTitle = selectedModel
    ? getTriggerDisplayModelName(selectedModel)
    : props.model === ANTIGRAVITY_DEFAULT_MODEL
      ? "Choose model"
      : props.model || "Choose model";
  const triggerLabel = selectedModel
    ? `${getTriggerDisplayModelLabel(selectedModel)}${selectedModel.isUnavailable ? " (Unavailable)" : ""}`
    : triggerTitle;
  const shortcutLabel = props.keybindings
    ? shortcutLabelForCommand(props.keybindings, "modelPicker.toggle", SHORTCUT_PLATFORM)
    : null;
  const tooltip = shortcutLabel ? `${triggerLabel} · ${shortcutLabel}` : triggerLabel;

  const guard = useReopenGuard(props.onOpenChange);
  const { side, onTriggerLayout } = usePopoverSide(MODEL_PICKER_MAX_HEIGHT);

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    props.onInstanceModelChange(instanceId, model);
    props.onOpenChange(false);
  };

  const control = (
    <div style={{ display: "flex", flexShrink: 1, minWidth: 0 }} onLayout={onTriggerLayout}>
      <ComposerControl
        size={size}
        disabled={props.disabled}
        testId="composer-model-picker"
        onClick={() => guard.toggle(open)}
      >
        {activeEntry ? (
          <ProviderInstanceIcon
            driverKind={activeEntry.driverKind}
            displayName={activeEntry.displayName}
            accentColor={activeEntry.accentColor}
            size={16}
            color={size === "xs" ? alpha(theme.mutedForeground, 0.7) : theme.mutedForeground}
            monochrome={size === "xs"}
            showBadge={shouldShowInstanceBadge(activeEntry, props.instanceEntries)}
            compactBadge
            indicatorBackground={theme.input}
          />
        ) : null}
        <ComposerControlLabel size={size}>{triggerTitle}</ComposerControlLabel>
        {selectedModel?.isUnavailable ? <OutlineBadge>Unavailable</OutlineBadge> : null}
        <ComposerControlChevron size={size} />
      </ComposerControl>
    </div>
  );
  // The tooltip would open under the popover, so it only exists while the picker is closed.
  const trigger = open ? (
    control
  ) : (
    <Tooltip content={tooltip} side="top">
      {control}
    </Tooltip>
  );

  return (
    <Popover
      open={open}
      onOpenChange={guard.onOpenChange}
      side={side}
      align="start"
      sideOffset={4}
      testId="composer-model-picker-popover"
      // -ms-2.5 aligns the expanded footer's first control with the editor text; the
      // xs resting strip has no such shift.
      rootStyle={{ marginLeft: size === "xs" ? 0 : -10, flexShrink: 1, minWidth: 0 }}
      style={{ padding: 0, overflow: "hidden" }}
      trigger={trigger}
    >
      <ModelPickerContent
        environmentId={props.environmentId}
        activeInstanceId={props.activeInstanceId}
        model={props.model}
        lockedProvider={props.lockedProvider}
        lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
        instanceEntries={props.instanceEntries}
        keybindings={props.keybindings}
        modelOptionsByInstance={props.modelOptionsByInstance}
        onRequestClose={() => props.onOpenChange(false)}
        onOpenProviderSetup={props.onOpenProviderSetup}
        getModelDisabledReason={props.getModelDisabledReason}
        onInstanceModelChange={handleInstanceModelChange}
      />
    </Popover>
  );
}

