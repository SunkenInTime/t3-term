// Settings' model and traits pickers. Web's settings reuse the composer's
// ProviderModelPicker and TraitsPicker (apps/web/src/components/chat/*) with a
// settings trigger class; here settings keeps its own trigger (ghost, provider
// icon + model + chevron) around the composer's ModelPickerContent (search,
// favorites, provider rail, keyboard navigation) and TraitsMenuContent (every
// select descriptor, then every boolean), so both lists match web's.
import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderOptionSelection,
  ServerProviderModel,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { buildTraitsTriggerDisplay } from "@t3tools/client-runtime/model-traits";
import { useState, type ReactNode } from "react";

import { MODEL_PICKER_MAX_HEIGHT, ModelPickerContent } from "../chat/composer/ModelPickerContent.tsx";
import { usePopoverSide, useReopenGuard } from "../chat/composer/ModelPickerPopover.ts";
import { TraitsMenuContent } from "../chat/composer/TraitsPicker.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Popover } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { RADIUS, useTheme } from "../ui/theme.ts";
import { getTraitsSectionVisibility } from "../web/components/chat/TraitsPicker.logic.ts";
import { getTriggerDisplayModelLabel } from "../web/components/chat/providerIconUtils.ts";
import type { ModelEsque } from "../web/components/chat/providerIconUtils.ts";
import type { ProviderInstanceEntry } from "../web/providerInstances.ts";
import { ProviderIcon } from "./brandIcons.tsx";

function PickerTrigger({
  children,
  onClick,
  onLayout,
  open,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  onLayout?: (event: { y?: number; height?: number }) => void;
  open: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onLayout={onLayout}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 28,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        backgroundColor: open ? theme.accent : "#00000000",
        cursor: "pointer",
        flexShrink: 0,
        hover: { backgroundColor: theme.accent },
      }}
    >
      {children}
      <Icon name="chevron-down" size={14} strokeWidth={2.25} color={theme.mutedForeground} />
    </div>
  );
}

export function SettingsModelPicker({
  environmentId = null,
  entries,
  modelOptionsByInstance,
  activeInstanceId,
  model,
  triggerLabel,
  getModelDisabledReason,
  onInstanceModelChange,
  onOpenProviderSetup,
  testId = "settings-model-picker",
}: {
  environmentId?: EnvironmentId | null;
  entries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  activeInstanceId: ProviderInstanceId;
  model: string;
  triggerLabel?: string;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  testId?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const guard = useReopenGuard(setOpen);
  const { side, onTriggerLayout } = usePopoverSide(MODEL_PICKER_MAX_HEIGHT);
  const activeEntry = entries.find((entry) => entry.instanceId === activeInstanceId);
  const activeOption = (modelOptionsByInstance.get(activeInstanceId) ?? []).find((option) => option.slug === model);
  const label = triggerLabel ?? (activeOption ? getTriggerDisplayModelLabel(activeOption) : model || "Choose model");
  return (
    <Popover
      open={open}
      onOpenChange={guard.onOpenChange}
      side={side}
      align="start"
      sideOffset={4}
      testId={`${testId}-menu`}
      style={{ padding: 0, overflow: "hidden" }}
      trigger={
        <PickerTrigger open={open} onClick={() => guard.toggle(open)} onLayout={onTriggerLayout} testId={testId}>
          {activeEntry ? <ProviderIcon driver={activeEntry.driverKind} size={16} /> : null}
          <Text weight={500} color={theme.mutedForeground} truncate style={{ maxWidth: 200 }}>
            {label}
          </Text>
        </PickerTrigger>
      }
    >
      <ModelPickerContent
        environmentId={environmentId}
        activeInstanceId={activeInstanceId}
        model={model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={modelOptionsByInstance}
        onRequestClose={() => setOpen(false)}
        onOpenProviderSetup={
          onOpenProviderSetup
            ? (instanceId) => {
                setOpen(false);
                onOpenProviderSetup(instanceId);
              }
            : undefined
        }
        getModelDisabledReason={getModelDisabledReason}
        onInstanceModelChange={(instanceId, nextModel) => {
          onInstanceModelChange(instanceId, nextModel);
          setOpen(false);
        }}
      />
    </Popover>
  );
}

/** TraitsPicker's estimate, for choosing which side of the trigger the menu opens on. */
const TRAITS_MENU_ESTIMATED_HEIGHT = 320;

/** web TraitsPicker with allowPromptInjectedEffort={false}: every select descriptor, then the booleans. */
export function SettingsTraitsPicker({
  provider,
  instanceId,
  models,
  model,
  modelOptions,
  planModeEnabled,
  onModelOptionsChange,
  testId = "settings-traits-picker",
}: {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  models: ReadonlyArray<ServerProviderModel>;
  model: string;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  planModeEnabled: boolean;
  onModelOptionsChange: (next: ReadonlyArray<ProviderOptionSelection>) => void;
  testId?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const guard = useReopenGuard(setOpen);
  const { side, onTriggerLayout } = usePopoverSide(TRAITS_MENU_ESTIMATED_HEIGHT);
  const traits = getTraitsSectionVisibility({
    provider,
    models,
    model,
    modelOptions,
    allowPromptInjectedEffort: false,
    planModeEnabled,
  });
  if (!traits.hasAnyControls) return null;
  const { label } = buildTraitsTriggerDisplay({
    provider,
    descriptors: traits.descriptors,
    primarySelectDescriptorId: traits.primarySelectDescriptor?.id ?? null,
    ultrathinkPromptControlled: traits.ultrathinkPromptControlled,
    modelSelection: instanceId ? { instanceId, model, options: modelOptions ?? [] } : null,
    reportedModelSelection: null,
  });
  return (
    <Popover
      open={open}
      onOpenChange={guard.onOpenChange}
      side={side}
      align="start"
      sideOffset={4}
      testId={`${testId}-menu`}
      style={{ padding: 4, minWidth: 160 }}
      trigger={
        <PickerTrigger open={open} onClick={() => guard.toggle(open)} onLayout={onTriggerLayout} testId={testId}>
          <Icon name="brain" size={16} color={theme.mutedForeground} />
          <Text weight={500} color={theme.mutedForeground} truncate style={{ maxWidth: 192 }}>
            {label}
          </Text>
        </PickerTrigger>
      }
    >
      <TraitsMenuContent
        provider={provider}
        {...(instanceId ? { instanceId } : {})}
        models={models}
        model={model}
        modelOptions={modelOptions}
        allowPromptInjectedEffort={false}
        planModeEnabled={planModeEnabled}
        onModelOptionsChange={(next) => onModelOptionsChange(next ?? [])}
        onClose={() => setOpen(false)}
      />
    </Popover>
  );
}
