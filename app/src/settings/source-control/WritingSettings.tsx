// Ports of apps/web/src/components/settings/{SourceControlWritingSettings,BranchNamingSettings}.tsx:
// the "Text generation" section of Source Control.
import { BranchNamingMode, DEFAULT_SERVER_SETTINGS, type ServerSettings, type SourceControlWritingStyleMode } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveReviewGuideModelSelection, resolveSourceControlWriterModelSelection } from "@t3tools/shared/serverSettings";
import { useRef, useState } from "react";

import { EMPTY_SERVER_PROVIDERS, useEnvironmentProviders } from "../../state/settings.ts";
import { Switch } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { useTheme } from "../../ui/theme.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { getCustomModelOptionsByInstance, resolveAppModelSelectionState, selectsPlanAgent } from "../../web/modelSelection.ts";
import { applyProviderInstanceSettings, deriveProviderInstanceEntries, sortProviderInstanceEntries } from "../../web/providerInstances.ts";
import { DraftTextField, SettingsSelect, TextArea } from "../controls.tsx";
import { SettingResetButton, SettingsRow, SettingsSection } from "../layout.tsx";
import { SettingsModelPicker, SettingsTraitsPicker } from "../ModelPicker.tsx";
import { openSettingsPage } from "../navigation.ts";
import { useScopedModelDisabledReason } from "../ProjectDefaultsSettings.tsx";
import { useScopedSettings, useScopedSettingsMixed, useSettingsScope, useUpdateScopedSettings } from "../scope.tsx";

const MODE_OPTIONS: Record<SourceControlWritingStyleMode, { label: string; description: string }> = {
  repo_conventions: {
    label: "Repository conventions",
    description: "In each project, matches recent change descriptions and change request titles.",
  },
  conventional_commits: {
    label: "Conventional Commits",
    description: "Use Conventional Commit prefixes and keep change request text concise.",
  },
  custom: {
    label: "Custom instructions",
    description: "Use your instructions for change descriptions and change requests in every project.",
  },
};

const BRANCH_MODES = {
  static: "Static prefix",
  semantic: "Semantic prefix",
  custom: "Custom instructions",
} satisfies Record<BranchNamingMode, string>;

/** A textarea that commits its trimmed text on blur, keyed to the saved value. */
function InstructionsArea({
  saved,
  mixed,
  placeholder,
  mixedPlaceholder = "Mixed. Enter instructions to apply to all selected targets.",
  onCommit,
  testId,
}: {
  saved: string;
  mixed: boolean;
  placeholder: string;
  mixedPlaceholder?: string;
  onCommit: (value: string) => void;
  testId?: string;
}) {
  const initial = mixed ? "" : saved;
  const [draft, setDraft] = useState(initial);
  const [source, setSource] = useState(initial);
  const edited = useRef(false);
  if (source !== initial) {
    setSource(initial);
    setDraft(initial);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 12, paddingBottom: 14, maxWidth: 672 }}>
      <TextArea
        testId={testId}
        value={draft}
        minRows={3}
        maxRows={8}
        placeholder={mixed ? mixedPlaceholder : placeholder}
        onChange={(value) => {
          edited.current = true;
          setDraft(value);
        }}
        onBlur={() => {
          const value = draft.trim();
          if (edited.current && (mixed || value !== saved)) onCommit(value);
          edited.current = false;
        }}
      />
    </div>
  );
}

function BranchNamingSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const modeMixed = useScopedSettingsMixed(["branchNamingMode"]);
  const prefixMixed = useScopedSettingsMixed(["branchNamePrefix"]);
  const instructionsMixed = useScopedSettingsMixed(["branchNameInstructions"]);
  return (
    <>
      <SettingsRow
        serverScoped
        settingKeys={["branchNamingMode"]}
        {...searchableSetting("worktree-branch-naming")}
        description="Choose how new worktree branches are named from your first message."
        status={
          !modeMixed && settings.branchNamingMode === "semantic"
            ? "The model chooses a prefix that describes the work, such as feat/add-search, fix/login-timeout, or refactor/auth."
            : undefined
        }
        resetAction={
          settings.branchNamingMode !== DEFAULT_SERVER_SETTINGS.branchNamingMode || modeMixed ? (
            <SettingResetButton label="branch naming" onClick={() => updateSettings({ branchNamingMode: DEFAULT_SERVER_SETTINGS.branchNamingMode })} />
          ) : null
        }
        control={
          <SettingsSelect
            testId="settings-branch-naming"
            value={modeMixed ? null : settings.branchNamingMode}
            options={BranchNamingMode.literals.map((mode) => ({ value: mode, label: BRANCH_MODES[mode] }))}
            onChange={(value) => updateSettings({ branchNamingMode: value })}
          />
        }
      />
      {!modeMixed && settings.branchNamingMode === "static" ? (
        <SettingsRow
          serverScoped
          settingKeys={["branchNamePrefix"]}
          title="Branch prefix"
          description="For example, t3 or t3/ produces t3/add-search. Leave empty for no prefix."
          resetAction={
            prefixMixed || settings.branchNamePrefix !== DEFAULT_SERVER_SETTINGS.branchNamePrefix ? (
              <SettingResetButton label="branch prefix" onClick={() => updateSettings({ branchNamePrefix: DEFAULT_SERVER_SETTINGS.branchNamePrefix })} />
            ) : null
          }
          control={
            <DraftTextField
              testId="settings-branch-prefix"
              width={184}
              value={prefixMixed ? "" : settings.branchNamePrefix}
              placeholder={prefixMixed ? "Mixed" : "No prefix"}
              onCommit={(value) => {
                const trimmed = value.trim();
                if (prefixMixed || trimmed !== settings.branchNamePrefix) updateSettings({ branchNamePrefix: trimmed });
              }}
            />
          }
        />
      ) : null}
      {!modeMixed && settings.branchNamingMode === "custom" ? (
        <SettingsRow
          serverScoped
          settingKeys={["branchNameInstructions"]}
          title="Branch naming instructions"
          description="Appended to the naming prompt. The model returns the complete branch name; no prefix or suffix is added."
          resetAction={
            instructionsMixed || settings.branchNameInstructions !== "" ? (
              <SettingResetButton label="branch naming instructions" onClick={() => updateSettings({ branchNameInstructions: "" })} />
            ) : null
          }
        >
          <InstructionsArea
            saved={settings.branchNameInstructions}
            mixed={instructionsMixed}
            placeholder="Use julius/ followed by the issue ID and a short description."
            onCommit={(value) => updateSettings({ branchNameInstructions: value })}
          />
        </SettingsRow>
      ) : null}
    </>
  );
}

export function SourceControlWritingSettingsSection() {
  const theme = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedReviewGuidesEnabled = useScopedSettingsMixed(["reviewGuidesEnabled"]);
  const { environment, connectedEnvironments, targets, target } = useSettingsScope();
  const hasServerTargets = connectedEnvironments.length > 0;
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders = (environment?.serverConfig ? providersByEnvironment.get(environment.environmentId) : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const styleFieldMixed = (field: keyof ServerSettings["sourceControlWritingStyle"]) => {
    const first = targets[0];
    return first !== undefined && targets.some((candidate) => candidate.settings.sourceControlWritingStyle[field] !== first.settings.sourceControlWritingStyle[field]);
  };
  const modeMixed = styleFieldMixed("mode");
  const instructionsMixed = styleFieldMixed("customInstructions");
  const templatesMixed = styleFieldMixed("followChangeRequestTemplates");
  const writingStyleMixed = modeMixed || instructionsMixed;
  const mixedWriterModel = useScopedSettingsMixed(["sourceControlWriterModelSelection"]);
  const mixedReviewGuideModel = useScopedSettingsMixed(["reviewGuideModelSelection"]);
  const mixedReviewGuideInstructions = useScopedSettingsMixed(["reviewGuideInstructions"]);
  const [editingAllInstructions, setEditingAllInstructions] = useState(false);
  const [allInstructions, setAllInstructions] = useState<string | null>(null);
  const style = settings.sourceControlWritingStyle;
  const defaults = DEFAULT_UNIFIED_SETTINGS.sourceControlWritingStyle;
  const isStyleDirty = writingStyleMixed || style.mode !== defaults.mode || style.customInstructions !== defaults.customInstructions;
  const textGenerationProviders = serverProviders.filter((provider) => provider.supportsTextGeneration !== false);
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(textGenerationProviders), settings, target?.projectId ?? null),
  );
  const enabledIds = new Set(instanceEntries.filter((entry) => entry.enabled && entry.isAvailable).map((entry) => entry.instanceId));
  const effectiveProviders = textGenerationProviders.filter((provider) => enabledIds.has(provider.instanceId));
  const defaultModelSelection = resolveAppModelSelectionState(settings, effectiveProviders);
  const usesDedicatedModel = settings.sourceControlWriterModelSelection !== null;
  const activeSelection = resolveAppModelSelectionState(
    { ...settings, textGenerationModelSelection: resolveSourceControlWriterModelSelection(settings, effectiveProviders, target?.projectId ?? null) },
    effectiveProviders,
  );
  const canEnableDedicatedModel = instanceEntries.some(
    (entry) => entry.instanceId === defaultModelSelection.instanceId && entry.enabled && entry.isAvailable,
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(settings, effectiveProviders, activeSelection.instanceId, activeSelection.model);
  const writerModelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries);
  const writerInstanceEntry = instanceEntries.find((entry) => entry.instanceId === activeSelection.instanceId);
  const usesReviewGuideModel = settings.reviewGuideModelSelection !== null;
  const reviewGuideSelection = resolveAppModelSelectionState(
    { ...settings, textGenerationModelSelection: resolveReviewGuideModelSelection(settings, textGenerationProviders, target?.projectId ?? null) },
    textGenerationProviders,
  );
  const reviewGuideModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGenerationProviders,
    reviewGuideSelection.instanceId,
    reviewGuideSelection.model,
  );
  const reviewGuideInstanceEntry = instanceEntries.find((entry) => entry.instanceId === reviewGuideSelection.instanceId);

  return (
    <SettingsSection id="source-control-text-generation" title="Text generation">
      <BranchNamingSettings />
      <SettingsRow
        serverScoped
        settingKeys={["sourceControlWritingStyle"]}
        mixed={writingStyleMixed}
        {...searchableSetting("source-control-writing-style")}
        description={MODE_OPTIONS[style.mode].description}
        resetAction={
          isStyleDirty ? (
            <SettingResetButton
              label="source control writing style"
              onClick={() => updateSettings({ sourceControlWritingStyle: { mode: defaults.mode, customInstructions: defaults.customInstructions } })}
            />
          ) : null
        }
        control={
          <SettingsSelect
            testId="settings-writing-style"
            value={modeMixed ? null : style.mode}
            width={224}
            options={(Object.keys(MODE_OPTIONS) as SourceControlWritingStyleMode[]).map((mode) => ({ value: mode, label: MODE_OPTIONS[mode].label }))}
            onChange={(value) => updateSettings({ sourceControlWritingStyle: { mode: value } })}
          />
        }
      >
        {writingStyleMixed ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, paddingBottom: 14, maxWidth: 672 }}>
            {editingAllInstructions ? (
              <>
                <TextArea
                  value={allInstructions ?? ""}
                  onChange={setAllInstructions}
                  minRows={3}
                  placeholder="Write the instructions each selected environment should use."
                />
                <div style={{ display: "flex", flexDirection: "row" }}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={allInstructions === null}
                    onClick={() => {
                      if (allInstructions === null) return;
                      updateSettings({ sourceControlWritingStyle: { mode: "custom", customInstructions: allInstructions.trim() } });
                      setEditingAllInstructions(false);
                    }}
                  >
                    Apply instructions to all
                  </Button>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "row" }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAllInstructions(null);
                    setEditingAllInstructions(true);
                  }}
                >
                  Write custom instructions for all
                </Button>
              </div>
            )}
          </div>
        ) : style.mode === "custom" ? (
          <InstructionsArea
            saved={style.customInstructions}
            mixed={false}
            placeholder="Keep titles concise. Use short bullet points in descriptions."
            onCommit={(customInstructions) => updateSettings({ sourceControlWritingStyle: { customInstructions } })}
          />
        ) : null}
      </SettingsRow>
      <SettingsRow
        serverScoped
        settingKeys={["sourceControlWritingStyle"]}
        mixed={templatesMixed}
        {...searchableSetting("follow-change-request-templates")}
        description="Use the repository's template for change request descriptions when available."
        resetAction={
          templatesMixed || style.followChangeRequestTemplates !== defaults.followChangeRequestTemplates ? (
            <SettingResetButton
              label="change request templates"
              onClick={() => updateSettings({ sourceControlWritingStyle: { followChangeRequestTemplates: defaults.followChangeRequestTemplates } })}
            />
          ) : null
        }
        control={
          <Switch
            testId="settings-follow-templates"
            checked={templatesMixed ? false : style.followChangeRequestTemplates}
            onChange={(checked) => updateSettings({ sourceControlWritingStyle: { followChangeRequestTemplates: checked } })}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["sourceControlWriterModelSelection"]}
        {...searchableSetting("source-control-writer-model")}
        description="Model for source control text and branch or bookmark names. Off uses the environment's text generation model."
        control={
          !hasServerTargets ? (
            <Text color={theme.mutedForeground}>Connect an environment to choose its source control writer model.</Text>
          ) : (
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
              {usesDedicatedModel && !canEnableDedicatedModel ? <Text color={theme.mutedForeground}>No text generation providers available.</Text> : null}
              {usesDedicatedModel && canEnableDedicatedModel ? (
                <SettingsModelPicker
                  testId="settings-writer-model"
                  entries={instanceEntries}
                  activeInstanceId={activeSelection.instanceId}
                  model={activeSelection.model}
                  modelOptionsByInstance={modelOptionsByInstance}
                  {...(mixedWriterModel ? { triggerLabel: "Mixed" } : {})}
                  getModelDisabledReason={writerModelDisabledReason}
                  onOpenProviderSetup={() => openSettingsPage("providers")}
                  onInstanceModelChange={(instanceId, model) => {
                    const reason = writerModelDisabledReason(instanceId, model);
                    if (reason) {
                      toast({ type: "error", title: "Source control writer model not saved", description: reason });
                      return;
                    }
                    updateSettings({ sourceControlWriterModelSelection: createModelSelection(instanceId, model) });
                  }}
                />
              ) : null}
              {usesDedicatedModel && canEnableDedicatedModel && !mixedWriterModel && writerInstanceEntry ? (
                <SettingsTraitsPicker
                  provider={writerInstanceEntry.driverKind}
                  models={writerInstanceEntry.models}
                  model={activeSelection.model}
                  modelOptions={activeSelection.options ?? []}
                  planModeEnabled={settings.planModeEnabled || selectsPlanAgent(activeSelection.options)}
                  onModelOptionsChange={(options) =>
                    updateSettings({
                      sourceControlWriterModelSelection: createModelSelection(activeSelection.instanceId, activeSelection.model, options),
                    })
                  }
                />
              ) : null}
              <Switch
                testId="settings-writer-model-toggle"
                checked={usesDedicatedModel}
                disabled={!usesDedicatedModel && !canEnableDedicatedModel}
                onChange={(checked) =>
                  updateSettings({
                    sourceControlWriterModelSelection: checked
                      ? createModelSelection(defaultModelSelection.instanceId, defaultModelSelection.model, defaultModelSelection.options)
                      : null,
                  })
                }
              />
            </div>
          )
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["reviewGuidesEnabled"]}
        mixed={mixedReviewGuidesEnabled}
        {...searchableSetting("review-guides")}
        description="Adds a Guide tab to pull requests: an agent writes a tour of the change, stop by stop, with the calls a maintainer should make."
        control={
          <Switch
            testId="settings-review-guides"
            checked={mixedReviewGuidesEnabled ? false : settings.reviewGuidesEnabled}
            onChange={(checked) => updateSettings({ reviewGuidesEnabled: checked })}
          />
        }
      />
      {settings.reviewGuidesEnabled || mixedReviewGuidesEnabled ? (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["reviewGuideModelSelection"]}
            {...searchableSetting("review-guide-model")}
            description="Model that reads a pull request to write its review guide. It reads the change itself over many steps, so a stronger model helps. Off uses the source control writer model."
            control={
              !hasServerTargets ? (
                <Text color={theme.mutedForeground}>Connect an environment to choose its review guide model.</Text>
              ) : (
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                  {(usesReviewGuideModel || mixedReviewGuideModel) && canEnableDedicatedModel ? (
                    <SettingsModelPicker
                      entries={instanceEntries}
                      activeInstanceId={reviewGuideSelection.instanceId}
                      model={reviewGuideSelection.model}
                      modelOptionsByInstance={reviewGuideModelOptionsByInstance}
                      {...(mixedReviewGuideModel ? { triggerLabel: "Mixed" } : {})}
                      getModelDisabledReason={writerModelDisabledReason}
                      onInstanceModelChange={(instanceId, model) => {
                        const reason = writerModelDisabledReason(instanceId, model);
                        if (reason) {
                          toast({ type: "error", title: "Review guide model not saved", description: reason });
                          return;
                        }
                        updateSettings({ reviewGuideModelSelection: createModelSelection(instanceId, model) });
                      }}
                    />
                  ) : null}
                  {usesReviewGuideModel && canEnableDedicatedModel && !mixedReviewGuideModel && reviewGuideInstanceEntry ? (
                    <SettingsTraitsPicker
                      provider={reviewGuideInstanceEntry.driverKind}
                      models={reviewGuideInstanceEntry.models}
                      model={reviewGuideSelection.model}
                      modelOptions={reviewGuideSelection.options ?? []}
                      planModeEnabled={settings.planModeEnabled || selectsPlanAgent(reviewGuideSelection.options)}
                      onModelOptionsChange={(options) =>
                        updateSettings({
                          reviewGuideModelSelection: createModelSelection(reviewGuideSelection.instanceId, reviewGuideSelection.model, options),
                        })
                      }
                    />
                  ) : null}
                  <Switch
                    checked={mixedReviewGuideModel ? false : usesReviewGuideModel}
                    disabled={!usesReviewGuideModel && !canEnableDedicatedModel}
                    onChange={(checked) => {
                      if (!checked) {
                        updateSettings({ reviewGuideModelSelection: null });
                        return;
                      }
                      const reason = writerModelDisabledReason(activeSelection.instanceId, activeSelection.model);
                      if (reason) {
                        toast({ type: "error", title: "Review guide model not saved", description: reason });
                        return;
                      }
                      updateSettings({
                        reviewGuideModelSelection: createModelSelection(activeSelection.instanceId, activeSelection.model, activeSelection.options),
                      });
                    }}
                  />
                </div>
              )
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["reviewGuideInstructions"]}
            {...searchableSetting("review-guide-instructions")}
            description="Your preferences for review guides: what to show first, dwell on, or skip. The guide's format and coverage stay the same."
            resetAction={
              mixedReviewGuideInstructions || settings.reviewGuideInstructions !== "" ? (
                <SettingResetButton label="review guide instructions" onClick={() => updateSettings({ reviewGuideInstructions: "" })} />
              ) : null
            }
          >
            <InstructionsArea
              saved={settings.reviewGuideInstructions}
              mixed={mixedReviewGuideInstructions}
              placeholder="Show service interfaces before implementations. Skip test files unless they change behavior. Keep summaries to two sentences."
              onCommit={(value) => updateSettings({ reviewGuideInstructions: value })}
            />
          </SettingsRow>
        </>
      ) : null}
    </SettingsSection>
  );
}
