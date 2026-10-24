// Multiple-model send: one new background thread per chosen model, each in its own
// worktree off the draft's branch. Ports apps/web/src/components/chat/useMultipleModelSend.ts,
// the fan-out half of chatViewSend.ts (draftFanoutSelectionsAtom, startFanoutThread,
// resolveMultipleModelTargets) and composerSend.logic.ts (multipleModelSendBlock,
// loadBalancingSendWarning).
//
// t3-term differences: attachments go through composerSend's prepareTurnAttachments; the
// draft has no terminal/preview/review/thread contexts yet, so there is no message context.
// loadBalancingSendWarning is ported for parity but has no caller: t3-term drafts never
// auto-balance across machines.
import { wasBootstrapThreadDeleted, wasBootstrapThreadNotCreated } from "@t3tools/client-runtime/errors";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  type AtomCommandResult,
  runAtomCommand,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  MessageId,
  type ModelSelection,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  ThreadId,
  type ThreadContextRecord,
} from "@t3tools/contracts";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";
import { createModelSelection } from "@t3tools/shared/model";
import { Atom } from "effect/reactivity";

import { requestConfirmDialog } from "../../dialogs/confirmDialog.ts";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  type ComposerAttachmentDraft,
  clearComposerContent,
  readComposerDraft,
  restoreComposerContent,
} from "../../state/composer.ts";
import { threadEnvironment } from "../../state/environment.ts";
import { routeAtom } from "../../state/ui.ts";
import { dismissToast, toast, updateToast } from "../../ui/toast.tsx";
import {
  formatOutgoingPrompt,
  getAntigravitySendBlockReason,
  resolveComposerInteractionMode,
} from "../../web/components/ChatView.logic.ts";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
} from "../../web/components/chat/composerProviderState.ts";
import type { ProviderInstanceEntry } from "../../web/providerInstances.ts";
import { composerSendErrorAtom, prepareTurnAttachments } from "./composerSend.ts";

// Kept per draft so the chosen models survive the composer remounting while the user navigates.
export const draftFanoutSelectionsAtom = Atom.family((_draftKey: string) =>
  Atom.make<ReadonlyArray<ModelSelection> | null>(null).pipe(Atom.keepAlive),
);

const draftSendStateByKey = new Map<
  string,
  { readonly sendInFlight: { current: boolean }; readonly uncertainSubmissions: Map<string, ThreadId> }
>();
function draftSendState(draftKey: string) {
  let state = draftSendStateByKey.get(draftKey);
  if (!state) {
    state = { sendInFlight: { current: false }, uncertainSubmissions: new Map() };
    draftSendStateByKey.set(draftKey, state);
  }
  return state;
}

/** composerSend.logic.ts: why a send waits for the user to pick a machine. */
export function loadBalancingSendWarning(input: {
  readonly pending: boolean;
  readonly threadContexts: ReadonlyArray<ThreadContextRecord>;
  readonly candidateEnvironmentIds: ReadonlyArray<EnvironmentId>;
}) {
  if (input.pending) {
    return {
      title: "Checking machine resources",
      description: "Resource checks are still running. You can choose a machine in the composer.",
    };
  }
  const noMachineReadsEveryThread =
    input.threadContexts.length > 0 &&
    !input.candidateEnvironmentIds.some((environmentId) =>
      input.threadContexts.every((record) => record.environmentId === environmentId),
    );
  return {
    title: "Choose a machine to continue",
    description: noMachineReadsEveryThread
      ? "No machine can read every attached thread. Choose a machine in the composer or remove the threads."
      : "No eligible machine has available resources. Choose a machine in the composer to override.",
  };
}

/**
 * composerSend.logic.ts: why a multiple-model send cannot start: the server predates worktree
 * bootstrap, or the draft is not a new thread on a Git branch with at least one model.
 */
export function multipleModelSendBlock(input: {
  readonly selectionCount: number;
  readonly serverSupportsWorktreeBootstrap: boolean;
  readonly isLocalDraftThread: boolean;
  readonly isGitRepo: boolean;
  readonly branch: string | null;
}): "server-outdated" | "needs-new-git-thread" | null {
  if (!input.serverSupportsWorktreeBootstrap) return "server-outdated";
  if (!input.isLocalDraftThread || !input.isGitRepo || !input.branch || input.selectionCount === 0) {
    return "needs-new-git-thread";
  }
  return null;
}

export interface MultipleModelTarget {
  readonly selection: ModelSelection;
  readonly text: string;
  readonly interactionMode: ProviderInteractionMode;
}

/** chatViewSend.ts: the thread each chosen model starts, in order, or why it cannot. */
export function resolveMultipleModelTargets(input: {
  readonly selections: ReadonlyArray<ModelSelection>;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly messageText: string;
  readonly planModeEnabled: boolean;
  readonly interactionMode: ProviderInteractionMode;
}): Array<MultipleModelTarget | { readonly error: string }> {
  const { messageText, planModeEnabled } = input;
  return input.selections.map((selection) => {
    const provider = input.providerInstanceEntries.find((entry) => entry.instanceId === selection.instanceId);
    if (!provider?.enabled || !provider.isAvailable || provider.status !== "ready") {
      return { error: `Provider for ${selection.model} is unavailable.` };
    }
    const providerBlockReason = getAntigravitySendBlockReason(provider.snapshot, selection.model);
    if (providerBlockReason) return { error: providerBlockReason };
    const providerState = getComposerProviderState({
      provider: provider.driverKind,
      model: selection.model,
      models: provider.models,
      modelOptions: selection.options,
      promptInjectionState: getComposerPromptInjectionState(messageText),
      planModeEnabled,
    });
    return {
      selection: createModelSelection(selection.instanceId, selection.model, providerState.modelOptionsForDispatch),
      text: formatOutgoingPrompt({
        provider: provider.driverKind,
        model: selection.model,
        models: provider.models,
        effort: providerState.promptEffort,
        text: messageText || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
      }),
      interactionMode: resolveComposerInteractionMode({
        planModeEnabled,
        provider: provider.snapshot,
        interactionMode: input.interactionMode,
      }).interactionMode,
    };
  });
}

/**
 * chatViewSend.ts startFanoutThread: a request that may have reached the server before
 * failing is remembered by `retryKey`, so sending again cannot silently create a duplicate
 * thread; its failure toast offers to open that thread or to allow the retry.
 */
async function startFanoutThread(input: {
  readonly retryKey: string;
  readonly model: string;
  readonly uncertainSubmissions: Map<string, ThreadId>;
  readonly start: (threadId: ThreadId) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly openThread: (threadId: ThreadId) => void;
}): Promise<boolean> {
  const { retryKey, uncertainSubmissions } = input;
  const uncertainThreadId = uncertainSubmissions.get(retryKey);
  const targetThreadId = uncertainThreadId ?? ThreadId.make(globalThis.crypto.randomUUID());
  let requestMayHaveStarted = false;
  try {
    if (uncertainThreadId) {
      throw new Error("The previous request may have started. Open its thread to check before sending again.");
    }
    requestMayHaveStarted = true;
    const result = await input.start(targetThreadId);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      if (wasBootstrapThreadDeleted(error) || wasBootstrapThreadNotCreated(error)) requestMayHaveStarted = false;
      throw error;
    }
    return true;
  } catch (error) {
    if (requestMayHaveStarted && !uncertainSubmissions.has(retryKey)) uncertainSubmissions.set(retryKey, targetThreadId);
    const retainedThreadId = uncertainSubmissions.get(retryKey);
    const failureToastId: number = toast({
      type: "error",
      title: `Could not start ${input.model}`,
      description: error instanceof Error ? error.message : "Failed to send message.",
      actionLayout: "stacked-end",
      ...(retainedThreadId
        ? {
            duration: 0,
            secondaryAction: {
              label: "Allow retry",
              onClick: () => {
                void requestConfirmDialog(
                  "The previous request may already be running. Check its thread first. Allow another send that could create a duplicate thread?",
                ).then((confirmed) => {
                  if (confirmed && uncertainSubmissions.get(retryKey) === retainedThreadId) {
                    uncertainSubmissions.delete(retryKey);
                    dismissToast(failureToastId);
                  }
                });
              },
            },
            action: { label: "Open thread", onClick: () => input.openThread(retainedThreadId) },
          }
        : {}),
    });
    return false;
  }
}

export interface MultipleModelSendInput {
  readonly environmentId: EnvironmentId;
  readonly draftKey: string;
  readonly projectId: ProjectId;
  readonly projectCwd: string;
  readonly branch: string;
  readonly startFromOrigin: boolean;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<ComposerAttachmentDraft>;
  readonly selections: ReadonlyArray<ModelSelection>;
  readonly targets: ReadonlyArray<MultipleModelTarget>;
  readonly runtimeMode: RuntimeMode;
}

/**
 * web useMultipleModelSend: starts one background thread per selected model, each in its own
 * worktree. Failed models stay selected and the prompt comes back, straight into this draft
 * or, when the user has moved on, through a "Restore prompt" toast.
 */
export async function sendToMultipleModels(input: MultipleModelSendInput): Promise<void> {
  const { environmentId, draftKey } = input;
  const state = draftSendState(draftKey);
  if (state.sendInFlight.current) return;
  state.sendInFlight.current = true;
  const fanoutSelectionsAtom = draftFanoutSelectionsAtom(draftKey);
  const snapshot = { prompt: input.prompt, attachments: input.attachments };
  const failedSelections: ModelSelection[] = [];
  let clearedDraft = false;
  let canRestoreDraft = () => false;
  let startedCount = 0;
  appAtomRegistry.set(composerSendErrorAtom(draftKey), null);
  const createdAt = new Date().toISOString();
  // Anything thrown here (an attachment the server can no longer take) fails every
  // selection; the draft restore below still runs.
  const sendResult = await settlePromise(async () => {
    const attachments = await prepareTurnAttachments(environmentId, input.attachments);
    const title = deriveThreadTitleSeed({ text: input.prompt, attachments: input.attachments });
    clearComposerContent(draftKey);
    clearedDraft = true;
    const clearedDraftSnapshot = readComposerDraft(draftKey);
    const submittedSelections = appAtomRegistry.get(fanoutSelectionsAtom);
    canRestoreDraft = () =>
      readComposerDraft(draftKey) === clearedDraftSnapshot &&
      appAtomRegistry.get(fanoutSelectionsAtom) === submittedSelections;
    const starts = Promise.all(
      input.targets.map(async (target) => {
        const started = await startFanoutThread({
          retryKey: JSON.stringify([draftKey, target.selection.instanceId, target.selection.model]),
          model: target.selection.model,
          uncertainSubmissions: state.uncertainSubmissions,
          start: (targetThreadId) =>
            runAtomCommand(
              appAtomRegistry,
              threadEnvironment.startTurn,
              {
                environmentId,
                input: {
                  threadId: targetThreadId,
                  message: {
                    messageId: MessageId.make(globalThis.crypto.randomUUID()),
                    role: "user",
                    text: target.text,
                    attachments,
                  },
                  modelSelection: target.selection,
                  titleSeed: title,
                  runtimeMode: input.runtimeMode,
                  interactionMode: target.interactionMode,
                  bootstrap: {
                    createThread: {
                      projectId: input.projectId,
                      title,
                      modelSelection: target.selection,
                      runtimeMode: input.runtimeMode,
                      interactionMode: target.interactionMode,
                      branch: input.branch,
                      worktreePath: null,
                      createdAt,
                    },
                    prepareWorktree: {
                      projectCwd: input.projectCwd,
                      baseBranch: input.branch,
                      requireWorktree: true,
                      ...(input.startFromOrigin ? { startFromOrigin: true } : {}),
                    },
                    runSetupScript: true,
                  },
                  createdAt,
                },
              } as never,
              { reportFailure: false },
            ) as Promise<AtomCommandResult<unknown, unknown>>,
          openThread: (threadId) => appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId }),
        });
        if (started) startedCount += 1;
        else failedSelections.push(target.selection);
      }),
    );
    // The composer is free again while the threads start.
    state.sendInFlight.current = false;
    await starts;
    if (startedCount > 0) {
      toast({
        type: "success",
        title: `Started ${startedCount} ${startedCount === 1 ? "thread" : "threads"} in background`,
      });
    }
  });
  if (sendResult._tag === "Failure") {
    const error = squashAtomCommandFailure(sendResult);
    failedSelections.push(...input.selections);
    appAtomRegistry.set(
      composerSendErrorAtom(draftKey),
      error instanceof Error ? error.message : "Failed to send messages.",
    );
  }
  const restoreFailedDraft = () => {
    appAtomRegistry.set(fanoutSelectionsAtom, failedSelections);
    if (clearedDraft) restoreComposerContent(draftKey, snapshot);
  };
  if (failedSelections.length > 0) {
    if (canRestoreDraft() || !clearedDraft) {
      restoreFailedDraft();
    } else {
      const recoveryToastId: number = toast({
        type: "error",
        title: "A background prompt could not be sent",
        description: "Your newer draft is unchanged. Restore the failed prompt when this composer is empty.",
        duration: 0,
        actionLayout: "stacked-end",
        action: {
          label: "Restore prompt",
          onClick: () => {
            const current = readComposerDraft(draftKey);
            if (state.sendInFlight.current || current.prompt.trim().length > 0 || current.attachments.length > 0) {
              updateToast(recoveryToastId, {
                type: "error",
                title: "A background prompt could not be sent",
                description: "Return to the original draft and send or clear its current prompt before restoring.",
                duration: 0,
              });
              return;
            }
            restoreFailedDraft();
            dismissToast(recoveryToastId);
          },
        },
      });
    }
  }
  state.sendInFlight.current = false;
}
