// Settings' model and traits pickers. The web app reuses the composer's
// ProviderModelPicker and TraitsPicker (apps/web/src/components/chat/*); those
// belong to the composer area here, so settings draws the same trigger (ghost,
// provider icon + model + chevron) with a plain grouped menu until the
// composer's pickers can be shared.
import type {
  ProviderInstanceId,
  ProviderOptionSelection,
  ServerProviderModel,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { getTraitsSectionVisibility } from "../web/components/chat/TraitsPicker.logic.ts";
import { getTriggerDisplayModelLabel } from "../web/components/chat/providerIconUtils.ts";
import type { ModelEsque } from "../web/components/chat/providerIconUtils.ts";
import type { ProviderInstanceEntry } from "../web/providerInstances.ts";
import { ProviderIcon } from "./brandIcons.tsx";
import { toast } from "../ui/toast.tsx";

function PickerTrigger({
  children,
  onClick,
  open,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  open: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
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
  const activeEntry = entries.find((entry) => entry.instanceId === activeInstanceId);
  const activeOption = (modelOptionsByInstance.get(activeInstanceId) ?? []).find((option) => option.slug === model);
  const label = triggerLabel ?? (activeOption ? getTriggerDisplayModelLabel(activeOption) : model || "Choose model");
  const visibleEntries = entries.filter((entry) => entry.enabled);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      minWidth={260}
      maxHeight={420}
      testId={`${testId}-menu`}
      trigger={() => (
        <PickerTrigger open={open} onClick={() => setOpen(!open)} testId={testId}>
          {activeEntry ? <ProviderIcon driver={activeEntry.driverKind} size={16} /> : null}
          <Text weight={500} color={theme.mutedForeground} truncate style={{ maxWidth: 200 }}>
            {label}
          </Text>
        </PickerTrigger>
      )}
    >
      {visibleEntries.map((entry, index) => {
        const options = modelOptionsByInstance.get(entry.instanceId) ?? [];
        const unavailable = !entry.isAvailable || entry.status === "error" || entry.status === "disabled";
        return (
          <div key={entry.instanceId} style={{ display: "flex", flexDirection: "column" }}>
            {index > 0 ? <MenuSeparator /> : null}
            <MenuLabel>{entry.displayName}</MenuLabel>
            {unavailable && onOpenProviderSetup ? (
              <MenuItem icon="settings-2" onSelect={() => onOpenProviderSetup(entry.instanceId)}>
                Set up provider
              </MenuItem>
            ) : null}
            {options
              .filter((option) => !option.isUnavailable)
              .map((option) => {
                const reason = getModelDisabledReason?.(entry.instanceId, option.slug) ?? null;
                return (
                  <MenuItem
                    key={option.slug}
                    checked={entry.instanceId === activeInstanceId && option.slug === model}
                    trailing={
                      option.badge === "new" ? (
                        <Text size="2xs" weight={500} color={theme.infoForeground}>
                          New
                        </Text>
                      ) : undefined
                    }
                    onSelect={() => {
                      if (reason) {
                        toast({ type: "error", title: "Model unavailable", description: reason });
                        return;
                      }
                      onInstanceModelChange(entry.instanceId, option.slug);
                    }}
                  >
                    {getTriggerDisplayModelLabel(option)}
                  </MenuItem>
                );
              })}
          </div>
        );
      })}
      {visibleEntries.length === 0 ? (
        <div style={{ padding: 8 }}>
          <Text size="xs" color={alpha(theme.mutedForeground, 0.8)}>
            No providers available
          </Text>
        </div>
      ) : null}
    </Menu>
  );
}

/** TraitsPicker's effort select (plus boolean traits such as Fast mode). */
export function SettingsTraitsPicker({
  provider,
  models,
  model,
  modelOptions,
  planModeEnabled,
  onModelOptionsChange,
  testId = "settings-traits-picker",
}: {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  planModeEnabled: boolean;
  onModelOptionsChange: (next: ReadonlyArray<ProviderOptionSelection>) => void;
  testId?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const traits = getTraitsSectionVisibility({
    provider,
    models,
    model,
    modelOptions,
    allowPromptInjectedEffort: false,
    planModeEnabled,
  });
  const primary = traits.primarySelectDescriptor;
  if (!traits.hasAnyControls || !primary) return null;
  const currentId = traits.effort;
  const currentLabel = primary.options.find((option) => option.id === currentId)?.label ?? currentId ?? "Default";
  const setOption = (id: string, value: string | boolean) => {
    const rest = (modelOptions ?? []).filter((option) => option.id !== id);
    onModelOptionsChange([...rest, { id, value } as ProviderOptionSelection]);
  };
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      minWidth={200}
      testId={`${testId}-menu`}
      trigger={() => (
        <PickerTrigger open={open} onClick={() => setOpen(!open)} testId={testId}>
          <Icon name="brain" size={16} color={theme.mutedForeground} />
          <Text weight={500} color={theme.mutedForeground}>
            {currentLabel}
          </Text>
        </PickerTrigger>
      )}
    >
      <MenuLabel>{primary.label}</MenuLabel>
      {primary.options.map((option) => (
        <MenuItem key={option.id} checked={option.id === currentId} onSelect={() => setOption(primary.id, option.id)}>
          {option.label}
        </MenuItem>
      ))}
      {traits.booleanDescriptors.length > 0 ? <MenuSeparator /> : null}
      {traits.booleanDescriptors.map((descriptor) => (
        <MenuItem
          key={descriptor.id}
          checked={descriptor.currentValue === true}
          keepOpen
          onSelect={() => setOption(descriptor.id, descriptor.currentValue !== true)}
        >
          {descriptor.label}
        </MenuItem>
      ))}
    </Menu>
  );
}
