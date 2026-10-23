// Port of apps/web/src/components/settings/CustomModelEditor.tsx: edit a custom model's
// display name and the options the composer offers for it.
import type { ProviderDriverKind, ServerProviderModel } from "@t3tools/contracts";
import type { CustomModelDefinition } from "@t3tools/shared/model";
import { useState } from "react";

import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  DESCRIPTOR_PRESETS_BY_KIND,
  type CustomModelDraft,
  type EditorChoice,
  type EditorDescriptor,
  choiceFromPreset,
  definitionFromDraft,
  descriptorFromPreset,
  descriptorsFromCapabilities,
  draftFromDefinition,
  emptyEditorChoice,
  emptyEditorDescriptor,
  validateDraft,
} from "../../web/components/settings/customModelEditor.logic.ts";
import { SettingsSelect, TextField } from "../controls.tsx";
import { SmallSwitch } from "./parts.tsx";

const CUSTOM_ID_VALUE = "__custom__";

export function CustomModelEditor({
  driverKind,
  entry,
  builtInModels,
  onSave,
  onCancel,
}: {
  driverKind: ProviderDriverKind | null;
  entry: CustomModelDefinition;
  builtInModels: ReadonlyArray<ServerProviderModel>;
  onSave: (next: CustomModelDefinition) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<CustomModelDraft>(() => draftFromDefinition(entry));
  const [error, setError] = useState<string | null>(null);
  const presets = driverKind ? (DESCRIPTOR_PRESETS_BY_KIND[driverKind] ?? []) : [];
  const startFromCandidates = builtInModels.filter((model) => (model.capabilities?.optionDescriptors?.length ?? 0) > 0);

  const updateDescriptor = (key: string, patch: Partial<EditorDescriptor>) => {
    setError(null);
    setDraft((current) => ({
      ...current,
      descriptors: current.descriptors.map((descriptor) => (descriptor.key === key ? { ...descriptor, ...patch } : descriptor)),
    }));
  };
  const updateChoice = (descriptorKey: string, choiceKey: string, patch: Partial<EditorChoice>) => {
    setError(null);
    setDraft((current) => ({
      ...current,
      descriptors: current.descriptors.map((descriptor) =>
        descriptor.key !== descriptorKey
          ? descriptor
          : {
              ...descriptor,
              choices: descriptor.choices.map((choice) =>
                choice.key === choiceKey ? { ...choice, ...patch } : patch.isDefault ? { ...choice, isDefault: false } : choice,
              ),
            },
      ),
    }));
  };
  const removeDescriptor = (key: string) => {
    setError(null);
    setDraft((current) => ({ ...current, descriptors: current.descriptors.filter((descriptor) => descriptor.key !== key) }));
  };
  const addDescriptor = (descriptor: EditorDescriptor) => {
    setError(null);
    setDraft((current) => ({ ...current, descriptors: [...current.descriptors, descriptor] }));
  };
  const applyPresetId = (descriptor: EditorDescriptor, value: string) => {
    if (value === CUSTOM_ID_VALUE) return updateDescriptor(descriptor.key, { id: "" });
    const preset = presets.find((candidate) => candidate.id === value);
    if (!preset) return;
    updateDescriptor(descriptor.key, {
      id: preset.id,
      label: preset.label,
      type: preset.type,
      choices: (preset.choices ?? []).map(choiceFromPreset),
      currentBooleanValue: undefined,
      description: undefined,
    });
  };
  const handleStartFrom = (slug: string) => {
    const model = startFromCandidates.find((candidate) => candidate.slug === slug);
    if (!model) return;
    setError(null);
    setDraft((current) => ({ ...current, descriptors: descriptorsFromCapabilities(model.capabilities, driverKind) }));
  };
  const handleSave = () => {
    const problem = validateDraft(draft);
    if (problem) return setError(problem);
    onSave(definitionFromDraft(draft));
  };
  const idSelectValue = (descriptor: EditorDescriptor) =>
    presets.some((preset) => preset.id === descriptor.id) ? descriptor.id : CUSTOM_ID_VALUE;

  const renderChoice = (descriptor: EditorDescriptor, choice: EditorChoice) => (
    <div key={choice.key} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
      <TextField size="sm" mono width={112} value={choice.id} placeholder="value" onChange={(id) => updateChoice(descriptor.key, choice.key, { id })} />
      <TextField size="sm" value={choice.label} placeholder="Label" onChange={(label) => updateChoice(descriptor.key, choice.key, { label })} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <SmallSwitch checked={choice.isDefault} disabled={false} onChange={(isDefault) => updateChoice(descriptor.key, choice.key, { isDefault })} />
        <Text size="2xs" color={theme.mutedForeground}>
          Default
        </Text>
      </div>
      <IconButton
        icon="x"
        size={20}
        iconSize={12}
        onClick={() => updateDescriptor(descriptor.key, { choices: descriptor.choices.filter((candidate) => candidate.key !== choice.key) })}
      />
    </div>
  );

  const renderDescriptor = (descriptor: EditorDescriptor, index: number) => (
    <div
      key={descriptor.key}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        backgroundColor: alpha(theme.background, 0.4),
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text size="2xs" color={theme.mutedForeground} style={{ width: 56, flexShrink: 0 }}>
          {`Option ${index + 1}`}
        </Text>
        {presets.length > 0 ? (
          <SettingsSelect
            value={idSelectValue(descriptor)}
            width={160}
            align="start"
            label={idSelectValue(descriptor) === CUSTOM_ID_VALUE ? "Custom…" : descriptor.id}
            options={[
              ...presets.map((preset) => ({ value: preset.id, label: preset.id, description: preset.label })),
              { value: CUSTOM_ID_VALUE, label: "Custom…" },
            ]}
            onChange={(value) => applyPresetId(descriptor, value)}
          />
        ) : null}
        {idSelectValue(descriptor) === CUSTOM_ID_VALUE ? (
          <TextField size="sm" mono width={144} value={descriptor.id} placeholder="optionId" onChange={(id) => updateDescriptor(descriptor.key, { id })} />
        ) : null}
        <TextField size="sm" value={descriptor.label} placeholder="Label" onChange={(label) => updateDescriptor(descriptor.key, { label })} />
        <SettingsSelect
          value={descriptor.type}
          width={96}
          options={[
            { value: "select", label: "Choices" },
            { value: "boolean", label: "Toggle" },
          ]}
          onChange={(value) => updateDescriptor(descriptor.key, { type: value === "boolean" ? "boolean" : "select" })}
        />
        <IconButton icon="x" size={20} iconSize={12} onClick={() => removeDescriptor(descriptor.key)} />
      </div>
      {descriptor.type === "select" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 64 }}>
          {descriptor.choices.map((choice) => renderChoice(descriptor, choice))}
          <div style={{ display: "flex", flexDirection: "row", marginLeft: -8 }}>
            <Button
              size="xs"
              variant="ghost-muted"
              icon="plus"
              onClick={() => updateDescriptor(descriptor.key, { choices: [...descriptor.choices, emptyEditorChoice()] })}
            >
              Add choice
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      testId="provider-custom-model-editor"
      onKeyDown={(event) => {
        if (event.key === "escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        marginLeft: 8,
        marginRight: 8,
        marginTop: 4,
        marginBottom: 8,
        padding: 12,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: alpha(theme.muted, 0.2),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Text size="xs" color={theme.mutedForeground}>
          Display name
        </Text>
        <TextField
          testId="provider-custom-model-name"
          size="sm"
          width={288}
          value={draft.name}
          placeholder={draft.slug}
          onChange={(name) => setDraft((current) => ({ ...current, name }))}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text size="xs" color={theme.mutedForeground}>
            Options shown in the composer
          </Text>
          {startFromCandidates.length > 0 ? (
            <SettingsSelect
              value={null}
              width={176}
              label="Copy from…"
              options={startFromCandidates.map((model) => ({ value: model.slug, label: model.name }))}
              onChange={handleStartFrom}
            />
          ) : null}
        </div>
        {draft.descriptors.length === 0 ? (
          <Text size="xs" color={alpha(theme.mutedForeground, 0.7)}>
            No custom options. The composer uses the provider's default options.
          </Text>
        ) : null}
        {draft.descriptors.map(renderDescriptor)}
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {presets
            .filter((preset) => !draft.descriptors.some((descriptor) => descriptor.id === preset.id))
            .map((preset) => (
              <Button key={preset.id} size="xs" variant="ghost-muted" icon="plus" onClick={() => addDescriptor(descriptorFromPreset(preset))}>
                {preset.label}
              </Button>
            ))}
          <Button size="xs" variant="ghost-muted" icon="plus" onClick={() => addDescriptor(emptyEditorDescriptor())}>
            Custom option
          </Button>
        </div>
      </div>
      {error ? (
        <Text size="xs" color={theme.errorForeground}>
          {error}
        </Text>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
        <Button size="sm" variant="outline" onClick={handleSave} testId="provider-custom-model-save">
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} testId="provider-custom-model-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}
