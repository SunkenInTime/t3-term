// Port of apps/web/src/components/settings/ProjectDefaultsSettings.tsx (+
// useScopedModelAvailability.ts and ScopedSwitch.tsx). General shows the
// "New threads" section, Source Control the "Repositories" section, and a
// project scope the model and workspace rows.
import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderInstanceId,
  type ServerSettings,
  type UnifiedSettings,
  type WorktreeSubmodules,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { EMPTY_SERVER_PROVIDERS, mergeEnvironmentSettings, useEnvironmentProviders, useEnvironments } from "../state/settings.ts";
import { Switch } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast } from "../ui/toast.tsx";
import { useTheme } from "../ui/theme.ts";
import { runtimeModeConfig, runtimeModeOptions } from "../web/components/chat/runtimeModeConfig.ts";
import { searchableSetting } from "../web/components/settings/settingsSearch.ts";
import { getCustomModelOptionsByInstance, resolveEffectiveDefaultModelSelection } from "../web/modelSelection.ts";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../web/providerInstances.ts";
import { SettingsSelect } from "./controls.tsx";
import { SettingResetButton, SettingsRow, SettingsSection } from "./layout.tsx";
import { SettingsModelPicker, SettingsTraitsPicker } from "./ModelPicker.tsx";
import { openProviderSettings } from "./navigation.ts";
import {
  useScopedSettings,
  useScopedSettingSource,
  useScopedSettingsMixed,
  useSettingsScope,
  useUpdateScopedSettings,
} from "./scope.tsx";

export type ProjectSettingsCategory = "general" | "source-control" | "project";

/** BranchToolbar.logic.ts */
export function resolveEnvModeLabel(mode: "local" | "worktree"): string {
  return mode === "worktree" ? "New worktree" : "Current checkout";
}

export const WORKTREE_SUBMODULES_LABELS: Record<WorktreeSubmodules, string> = {
  recursive: "Recursive",
  "top-level": "Top level only",
  none: "Skip",
};

/** pullRequestDetail.logic.ts */
export const PULL_REQUEST_MERGE_METHOD_LABELS = {
  merge: "Merge",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
} as const;

const WORKTREE_SUBMODULES_OPTIONS = ["recursive", "top-level", "none"] as const;

/** ScopedSwitch.tsx: a switch that reads "off" while the selected targets disagree. */
export function ScopedSwitch({
  settingKeys,
  checked,
  onChange,
  disabled,
  testId,
}: {
  settingKeys: readonly (keyof ServerSettings)[];
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const mixed = useScopedSettingsMixed(settingKeys);
  return <Switch checked={mixed ? false : checked} onChange={onChange} disabled={disabled} testId={testId} />;
}

/** useScopedModelAvailability.ts */
export function useScopedModelDisabledReason(settings: UnifiedSettings, entries: readonly ProviderInstanceEntry[]) {
  const { targets } = useSettingsScope();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  return (instanceId: ProviderInstanceId, model: string): string | null => {
    const sourceEntry = entries.find((entry) => entry.instanceId === instanceId);
    for (const candidate of targets) {
      const environment = environments.find((entry) => entry.environmentId === candidate.environmentId);
      const providers = providersByEnvironment.get(candidate.environmentId);
      if (!environment?.serverConfig || !providers) continue;
      const entry = applyProviderInstanceSettings(
        deriveProviderInstanceEntries(providers),
        candidate.settings,
        candidate.projectId,
      ).find((option) => option.instanceId === instanceId);
      const options = getCustomModelOptionsByInstance(mergeEnvironmentSettings(candidate.settings, settings), providers).get(
        instanceId,
      );
      if (
        !entry?.enabled ||
        !entry.isAvailable ||
        entry.driverKind !== sourceEntry?.driverKind ||
        !options?.some((option) => option.slug === model && !option.isUnavailable)
      ) {
        return `This model is unavailable on ${environment?.label ?? "a selected environment"}. Select that environment to choose its model separately.`;
      }
    }
    return null;
  };
}

export function ProjectDefaultsSettings({ category }: { category: ProjectSettingsCategory }) {
  const theme = useTheme();
  const { scope, target, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const representative = target ? environments.find((environment) => environment.environmentId === target.environmentId) : undefined;
  const providers =
    (representative?.serverConfig ? providersByEnvironment.get(representative.environmentId) : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const storedSelection = resolveDefaultProviderModelSelection(providers, settings.defaultModelSelection);
  const selection = storedSelection ? resolveEffectiveDefaultModelSelection(settings, providers, storedSelection) : null;
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, target?.projectId ?? null),
  );
  const modelOptions = getCustomModelOptionsByInstance(settings, providers, selection?.instanceId, selection?.model);
  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const mixedModel = useScopedSettingsMixed(["defaultModelSelection"]);
  const mixedPermissions = useScopedSettingsMixed(["defaultRuntimeMode"]);
  const mixedWorkspace = useScopedSettingsMixed(["defaultThreadEnvMode"]);
  const mixedSubmodules = useScopedSettingsMixed(["worktreeSubmodules"]);
  const mixedAutoPull = useScopedSettingsMixed(["defaultAutoPull"]);
  const mixedAgentCredits = useScopedSettingsMixed(["removeAgentCreditsOnMerge"]);
  const mixedMergeMethod = useScopedSettingsMixed(["pullRequestMergeMethod"]);
  const modelSource = useScopedSettingSource(["defaultModelSelection"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unavailable = connectedEnvironments.length === 0;
  const effective = target ? resolveProjectSettings(target.settings, null, null, null).settings : null;
  const modelDisabledReason = useScopedModelDisabledReason(settings, entries);

  const setModel = (value: ModelSelection | null) => {
    const reason = value ? modelDisabledReason(value.instanceId, value.model) : null;
    if (reason) {
      toast({ type: "error", title: "Default model not saved", description: reason });
      return;
    }
    updateSettings({ defaultModelSelection: value });
  };

  const modelRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultModelSelection"]}
      mixed={mixedModel}
      id="default-model"
      title="Model"
      description={isProjectScope ? "Model for new threads in this project." : "Default model for new threads. Projects can override it."}
      status={
        unavailable || mixedModel || modelSource === "project"
          ? undefined
          : settings.defaultModelSelection === null
            ? "Automatic"
            : undefined
      }
      resetAction={
        settings.defaultModelSelection !== null ? <SettingResetButton label="default model" onClick={() => setModel(null)} /> : null
      }
      control={
        selection && activeEntry ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <SettingsModelPicker
              testId="settings-default-model"
              environmentId={representative?.environmentId ?? null}
              entries={entries}
              modelOptionsByInstance={modelOptions}
              activeInstanceId={selection.instanceId}
              model={selection.model}
              {...(mixedModel ? { triggerLabel: "Mixed" } : {})}
              getModelDisabledReason={modelDisabledReason}
              onOpenProviderSetup={(instanceId) => {
                if (representative) openProviderSettings({ environmentId: representative.environmentId, instanceId });
              }}
              onInstanceModelChange={(instanceId, model) => setModel(createModelSelection(instanceId, model))}
            />
            {!mixedModel ? (
              <SettingsTraitsPicker
                testId="settings-default-traits"
                provider={activeEntry.driverKind}
                instanceId={selection.instanceId}
                models={activeEntry.models}
                model={selection.model}
                modelOptions={selection.options ?? []}
                planModeEnabled={settings.planModeEnabled}
                onModelOptionsChange={(options) => setModel(createModelSelection(selection.instanceId, selection.model, options))}
              />
            ) : null}
          </div>
        ) : (
          <Text color={theme.mutedForeground}>No providers available</Text>
        )
      }
    />
  );

  const workspaceValue = mixedWorkspace ? null : (effective?.defaultThreadEnvMode ?? null);
  const workspaceRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultThreadEnvMode"]}
      mixed={mixedWorkspace}
      id={searchableSetting("new-threads").id}
      title="Workspace"
      description={
        isProjectScope ? "Where new threads in this project start." : "Where new threads start. Projects and their t3.json can override it."
      }
      resetAction={
        !isProjectScope && settings.defaultThreadEnvMode !== null ? (
          <SettingResetButton label="default workspace" onClick={() => updateSettings({ defaultThreadEnvMode: null })} />
        ) : null
      }
      control={
        <SettingsSelect
          testId="settings-default-workspace"
          value={workspaceValue}
          label={workspaceValue === "local" || workspaceValue === "worktree" ? resolveEnvModeLabel(workspaceValue) : unavailable ? "Unavailable" : "Mixed"}
          options={[
            { value: "local", label: resolveEnvModeLabel("local") },
            { value: "worktree", label: resolveEnvModeLabel("worktree") },
          ]}
          onChange={(value) => updateSettings({ defaultThreadEnvMode: value })}
        />
      }
    />
  );

  return (
    <SettingsSection
      id={category === "source-control" ? "source-control-defaults" : "project-defaults"}
      title={category === "source-control" ? "Repositories" : "New threads"}
    >
      {category === "project" ? (
        <>
          {modelRow}
          {workspaceRow}
        </>
      ) : category === "general" ? (
        <>
          {modelRow}
          <SettingsRow
            serverScoped
            settingKeys={["defaultRuntimeMode"]}
            mixed={mixedPermissions}
            {...searchableSetting("default-permissions")}
            description={
              isProjectScope ? "Permissions for new threads in this project." : "Default permissions for new threads. Projects can override them."
            }
            resetAction={
              settings.defaultRuntimeMode !== DEFAULT_SERVER_SETTINGS.defaultRuntimeMode ? (
                <SettingResetButton
                  label="default permissions"
                  onClick={() => updateSettings({ defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode })}
                />
              ) : null
            }
            control={
              <SettingsSelect
                testId="settings-default-permissions"
                value={mixedPermissions ? null : settings.defaultRuntimeMode}
                {...(mixedPermissions ? {} : { icon: runtimeModeConfig[settings.defaultRuntimeMode].icon })}
                menuWidth={256}
                options={runtimeModeOptions.map((mode) => ({
                  value: mode,
                  label: runtimeModeConfig[mode].label,
                  description: runtimeModeConfig[mode].description,
                  icon: runtimeModeConfig[mode].icon,
                }))}
                onChange={(value) => updateSettings({ defaultRuntimeMode: value })}
              />
            }
          />
          {workspaceRow}
          <SettingsRow
            serverScoped
            settingKeys={["worktreeSubmodules"]}
            mixed={mixedSubmodules}
            {...searchableSetting("worktree-submodules")}
            description={
              isProjectScope
                ? "How new worktrees in this project populate git submodules."
                : "How new worktrees populate git submodules. Projects and their t3.json can override it."
            }
            resetAction={
              !isProjectScope && settings.worktreeSubmodules !== null ? (
                <SettingResetButton label="worktree submodules" onClick={() => updateSettings({ worktreeSubmodules: null })} />
              ) : null
            }
            control={
              <SettingsSelect
                testId="settings-worktree-submodules"
                value={mixedSubmodules ? null : (effective?.worktreeSubmodules ?? null)}
                label={
                  !mixedSubmodules && effective?.worktreeSubmodules
                    ? WORKTREE_SUBMODULES_LABELS[effective.worktreeSubmodules]
                    : unavailable
                      ? "Unavailable"
                      : "Mixed"
                }
                options={WORKTREE_SUBMODULES_OPTIONS.map((option) => ({ value: option, label: WORKTREE_SUBMODULES_LABELS[option] }))}
                onChange={(value) => updateSettings({ worktreeSubmodules: value })}
              />
            }
          />
        </>
      ) : (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["defaultAutoPull"]}
            mixed={mixedAutoPull}
            id="automatic-pull"
            title="Automatically pull"
            description={
              isProjectScope
                ? "Keeps this project's default branch current when the checkout has no local changes or commits."
                : "Keeps the default branch current when the checkout has no local changes or commits. Projects can override it."
            }
            resetAction={
              settings.defaultAutoPull ? (
                <SettingResetButton label="default automatic pull" tooltip="Reset automatic pull to off" onClick={() => updateSettings({ defaultAutoPull: false })} />
              ) : null
            }
            control={
              <Switch
                testId="settings-default-auto-pull"
                checked={mixedAutoPull ? false : settings.defaultAutoPull}
                onChange={(enabled) => updateSettings({ defaultAutoPull: enabled })}
              />
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["removeAgentCreditsOnMerge"]}
            mixed={mixedAgentCredits}
            {...searchableSetting("remove-agent-credits-on-merge")}
            description="Remove recognized agent credit lines from GitHub merge and squash messages, keeping human co-authors. Includes auto-merge. Excludes merge queues, stack merges, and existing commits."
            resetAction={
              settings.removeAgentCreditsOnMerge ? (
                <SettingResetButton label="agent credit removal" tooltip="Keep agent credits" onClick={() => updateSettings({ removeAgentCreditsOnMerge: false })} />
              ) : null
            }
            control={
              <Switch
                checked={mixedAgentCredits ? false : settings.removeAgentCreditsOnMerge}
                onChange={(enabled) => updateSettings({ removeAgentCreditsOnMerge: enabled })}
              />
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["pullRequestMergeMethod"]}
            mixed={mixedMergeMethod}
            {...searchableSetting("pull-request-merge-method")}
            description={
              isProjectScope
                ? "Pull requests in this project start with this method."
                : "Pull requests start with this method. Last selected reuses whatever you chose most recently on this device."
            }
            resetAction={
              settings.pullRequestMergeMethod !== null ? (
                <SettingResetButton label="default merge method" tooltip="Reset to last selected" onClick={() => updateSettings({ pullRequestMergeMethod: null })} />
              ) : null
            }
            control={
              <SettingsSelect
                value={mixedMergeMethod ? null : (settings.pullRequestMergeMethod ?? "last")}
                options={[
                  { value: "last", label: "Last selected" },
                  { value: "merge", label: PULL_REQUEST_MERGE_METHOD_LABELS.merge },
                  { value: "squash", label: PULL_REQUEST_MERGE_METHOD_LABELS.squash },
                  { value: "rebase", label: PULL_REQUEST_MERGE_METHOD_LABELS.rebase },
                ]}
                width={176}
                onChange={(value) => updateSettings({ pullRequestMergeMethod: value === "last" ? null : value })}
              />
            }
          />
        </>
      )}
    </SettingsSection>
  );
}
