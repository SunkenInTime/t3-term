// apps/web/src/components/chat/useComposerProviderModel.ts: the provider instances the
// composer offers, which one is selected, and the model and options the draft resolves to.
import {
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { type UnifiedSettings } from "@t3tools/contracts/settings";

import { resolveComposerProviderSelection } from "../../web/components/ChatView.logic.ts";
import {
  getComposerProviderState,
  type ComposerPromptInjectionState,
} from "../../web/components/chat/composerProviderState.ts";
import {
  deriveEffectiveComposerModelState,
  type ComposerDraftModelState,
} from "../../web/composerDraftStore.ts";
import {
  NO_PROVIDER_MODEL_SELECTION,
  type ProviderInstanceEntry,
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../web/providerInstances.ts";

const NO_PROVIDER_MODELS: ServerProvider["models"] = [];

export function resolveComposerProviderModel(input: {
  readonly providerStatuses: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly activeProjectId: ProjectId | null;
  readonly draft: ComposerDraftModelState;
  readonly threadModelSelection: ModelSelection | null | undefined;
  readonly projectModelSelection: ModelSelection | null | undefined;
  readonly promptInjectionState: ComposerPromptInjectionState;
  readonly candidateInstanceIds: ReadonlyArray<ProviderInstanceId | null | undefined>;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly lockedInstanceId: ProviderInstanceId | null | undefined;
}) {
  const providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry> = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(input.providerStatuses),
      input.settings,
      input.activeProjectId,
    ),
  );
  const selection = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds: input.candidateInstanceIds,
    lockedProvider: input.lockedProvider,
    lockedInstanceId: input.lockedInstanceId,
  });
  const selectedInstanceId =
    selection.selectedProviderEntry?.instanceId ?? NO_PROVIDER_MODEL_SELECTION.instanceId;
  const selectedProvider: ProviderDriverKind =
    selection.selectedProviderEntry?.driverKind ?? selection.requestedDriverKind;
  const modelState = deriveEffectiveComposerModelState({
    draft: input.draft,
    providers: input.providerStatuses,
    selectedProvider,
    selectedInstanceId,
    threadModelSelection: input.threadModelSelection,
    projectModelSelection: input.projectModelSelection,
    settings: input.settings,
  });
  const selectedProviderModels = selection.selectedProviderEntry?.models ?? NO_PROVIDER_MODELS;
  const composerProviderState = getComposerProviderState({
    provider: selectedProvider,
    model: modelState.selectedModel,
    models: selectedProviderModels,
    promptInjectionState: input.promptInjectionState,
    modelOptions: modelState.modelOptions?.[selectedInstanceId],
    planModeEnabled: input.settings.planModeEnabled,
  });
  return {
    providerInstanceEntries,
    ...selection,
    selectedInstanceId,
    selectedProvider,
    selectedProviderModels,
    composerModelOptions: modelState.modelOptions,
    selectedModel: modelState.selectedModel,
    composerProviderState,
  };
}
