// Subset of apps/web/src/components/ChatView.logic.ts: the composer's provider
// selection, send-state and prompt helpers. Functions are copied verbatim; the
// thread-type parameters are narrowed to the fields they read.
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  isProviderDriverKind,
  type ModelSelection,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type ServerProvider,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { applyClaudePromptEffortPrefix, resolvePromptInjectedEffort } from "@t3tools/shared/model";

import { stripInlineContextReferences } from "../lib/composerContextReferences";
import {
  NO_PROVIDER_MODEL_SELECTION,
  type ProviderInstanceEntry,
  resolveSelectableProviderInstanceEntry,
} from "../providerInstances";
import { getProviderModelCapabilities } from "../providerModels";

/** t3-term has no terminal-context chips yet; the send state keeps the web signature. */
export interface TerminalContextDraft {
  readonly text: string;
}
function filterTerminalContextsWithText<T extends TerminalContextDraft>(
  contexts: ReadonlyArray<T>,
): T[] {
  return contexts.filter((context) => context.text.trim().length > 0);
}

/** The fields `threadHasStarted` reads from the web `Thread` view model. */
export interface StartedThreadLike {
  readonly latestRun: unknown;
  readonly itemCount: number;
  readonly runtime: { readonly providerName?: string | null } | null | undefined;
}

export function resolveComposerProviderSelection(input: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  candidateInstanceIds: ReadonlyArray<ProviderInstanceId | null | undefined>;
  lockedProvider: ProviderDriverKind | null;
  lockedInstanceId: ProviderInstanceId | null | undefined;
}) {
  const requestedInstanceId = input.candidateInstanceIds.find(
    (candidate) => candidate != null && candidate !== NO_PROVIDER_MODEL_SELECTION.instanceId,
  );
  const requestedDriverKind =
    input.lockedProvider ??
    input.entries.find((entry) => entry.instanceId === requestedInstanceId)?.driverKind ??
    input.entries[0]?.driverKind ??
    ProviderDriverKind.make("unconfigured");
  const lockedContinuationGroupKey = input.lockedProvider
    ? (input.entries.find((entry) => entry.instanceId === input.lockedInstanceId)
        ?.continuationGroupKey ?? null)
    : null;
  // Missing metadata must not move Antigravity history into another Google profile.
  const requiresExactInstance =
    input.lockedProvider === "antigravity" &&
    input.lockedInstanceId != null &&
    lockedContinuationGroupKey === null;
  const compatibleEntries = input.entries.filter(
    (entry) =>
      (!input.lockedProvider || entry.driverKind === input.lockedProvider) &&
      (!lockedContinuationGroupKey || entry.continuationGroupKey === lockedContinuationGroupKey) &&
      (!requiresExactInstance || entry.instanceId === input.lockedInstanceId),
  );
  const selectedProviderEntry =
    input.candidateInstanceIds
      .map((candidate) =>
        compatibleEntries.find(
          (entry) => entry.instanceId === candidate && entry.enabled && entry.isAvailable,
        ),
      )
      .find((entry) => entry !== undefined) ??
    resolveSelectableProviderInstanceEntry(
      compatibleEntries.filter((entry) => entry.driverKind === requestedDriverKind),
      undefined,
    ) ??
    resolveSelectableProviderInstanceEntry(compatibleEntries, undefined);
  const unavailableProviderInstanceId = selectedProviderEntry
    ? undefined
    : input.lockedProvider
      ? (input.lockedInstanceId ?? requestedInstanceId)
      : requestedInstanceId;
  return {
    selectedProviderEntry,
    requestedDriverKind,
    lockedContinuationGroupKey,
    unavailableProviderInstanceId,
  };
}

export function resolveComposerInteractionMode(input: {
  planModeEnabled: boolean;
  provider: Pick<ServerProvider, "showInteractionModeToggle"> | null | undefined;
  interactionMode: ProviderInteractionMode;
}): { enabled: boolean; interactionMode: ProviderInteractionMode } {
  const enabled =
    input.planModeEnabled &&
    input.provider != null &&
    input.provider.showInteractionModeToggle !== false;
  return {
    enabled,
    interactionMode: enabled ? input.interactionMode : "default",
  };
}

export function getAntigravitySendBlockReason(
  provider:
    | Pick<ServerProvider, "driver" | "installed" | "auth" | "models" | "status">
    | null
    | undefined,
  model: string,
): string | null {
  if (provider?.driver !== "antigravity") return null;
  if (!provider.installed) {
    return "Install Antigravity in provider settings before sending.";
  }
  if (provider.auth.status === "unauthenticated") {
    return "Sign in to Antigravity in provider settings before sending.";
  }
  const slug = model.trim();
  if (slug.length === 0) return "Choose an Antigravity model before sending.";
  if (provider.auth.status === "unknown") return null;
  if (provider.models.length === 0) {
    return "Refresh Antigravity models in provider settings before sending.";
  }
  if (
    provider.status === "ready" &&
    slug !== ANTIGRAVITY_DEFAULT_MODEL &&
    !provider.models.some((entry) => entry.slug === slug || entry.aliases?.includes(slug))
  ) {
    return "That Antigravity model is no longer available. Choose another model.";
  }
  return null;
}


export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  elementContextCount?: number;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineContextReferences(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  const elementContextCount = options.elementContextCount ?? 0;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 ||
      options.imageCount > 0 ||
      sendableTerminalContexts.length > 0 ||
      elementContextCount > 0,
  };
}


export function shouldShowPlanFollowUpPrompt(input: {
  pendingUserInputCount: number;
  interactionMode: ProviderInteractionMode;
  latestTurnSettled: boolean;
  hasActionableProposedPlan: boolean;
  hasComposerAttachments: boolean;
}): boolean {
  return (
    input.pendingUserInputCount === 0 &&
    input.interactionMode === "plan" &&
    input.latestTurnSettled &&
    input.hasActionableProposedPlan &&
    !input.hasComposerAttachments
  );
}

const sessionDismissedBranchMismatchKeys = new Set<string>();


export function threadHasStarted(thread: StartedThreadLike | null | undefined): boolean {
  return Boolean(thread && (thread.latestRun !== null || thread.itemCount > 0 || thread.runtime));
}

export function threadShellHasStarted(
  shell:
    | Pick<EnvironmentThreadShell, "latestRun" | "latestUserMessageAt" | "runtime">
    | null
    | undefined,
): boolean {
  return Boolean(
    shell &&
    (shell.latestRun !== null || shell.latestUserMessageAt !== null || shell.runtime !== null),
  );
}

// Imported history has no session until its first prompt. Resolve its instance
// through the environment's provider catalog before locking to a driver.
export function deriveLockedProvider(input: {
  thread: StartedThreadLike | null | undefined;
  selectedProvider: string | null;
  threadProvider: string | null;
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver">>;
}): ProviderDriverKind | null {
  if (!threadHasStarted(input.thread)) {
    return null;
  }
  const sessionProvider = input.thread?.runtime?.providerName ?? null;
  if (sessionProvider && isProviderDriverKind(sessionProvider)) {
    return sessionProvider;
  }
  // Preserve the existing lock while an instance is missing from the catalog;
  // a started thread must not silently fall back to a different driver.
  const threadProvider =
    input.providers.find((provider) => provider.instanceId === input.threadProvider)?.driver ??
    input.threadProvider;
  const selectedProvider =
    input.providers.find((provider) => provider.instanceId === input.selectedProvider)?.driver ??
    input.selectedProvider;
  const narrowedThreadProvider =
    threadProvider && isProviderDriverKind(threadProvider) ? threadProvider : null;
  const narrowedSelectedProvider =
    selectedProvider && isProviderDriverKind(selectedProvider) ? selectedProvider : null;
  return narrowedThreadProvider ?? narrowedSelectedProvider ?? null;
}

export function getStartedThreadModelChangeBlockReason(input: {
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "requiresNewThreadForModelChange">>;
  hasStartedSession: boolean;
  supportsProviderSwitchingViaHandoff?: boolean;
  currentModelSelection: ModelSelection;
  currentProviderInstanceId?: ModelSelection["instanceId"] | null | undefined;
  nextModelSelection: ModelSelection;
}): { title: string; description: string } | null {
  if (!input.hasStartedSession) {
    return null;
  }
  const currentModelSelection = {
    ...input.currentModelSelection,
    instanceId: input.currentProviderInstanceId ?? input.currentModelSelection.instanceId,
  };
  if (
    currentModelSelection.instanceId === input.nextModelSelection.instanceId &&
    currentModelSelection.model === input.nextModelSelection.model
  ) {
    return null;
  }
  if (currentModelSelection.instanceId !== input.nextModelSelection.instanceId) {
    if (input.supportsProviderSwitchingViaHandoff === true) {
      return null;
    }
    return {
      title: "Start a new chat to switch providers",
      description: "This thread does not support switching providers after it has started.",
    };
  }
  const currentProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === currentModelSelection.instanceId,
  );
  const nextProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === input.nextModelSelection.instanceId,
  );
  if (
    currentProvider?.requiresNewThreadForModelChange !== true &&
    nextProvider?.requiresNewThreadForModelChange !== true
  ) {
    return null;
  }
  return {
    title: "Start a new chat to change models",
    description: "This provider does not allow switching models after a conversation has started.",
  };
}


export function formatOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  const promptEffort = resolvePromptInjectedEffort(caps, params.effort);
  return applyClaudePromptEffortPrefix(params.text, promptEffort);
}


export function makeModelDisabledReason(
  context: Omit<
    Parameters<typeof getStartedThreadModelChangeBlockReason>[0],
    "nextModelSelection"
  > | null,
) {
  return (instanceId: ProviderInstanceId, model: string): string | null => {
    if (!context) return null;
    const reason = getStartedThreadModelChangeBlockReason({
      ...context,
      nextModelSelection: { instanceId, model },
    });
    return reason ? `${reason.description} Start a new thread to use this model.` : null;
  };
}

