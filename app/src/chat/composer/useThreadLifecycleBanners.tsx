// The banner half of apps/web/src/components/chat/useThreadLifecycle.tsx: subagents
// waiting on the user, the provider goal (with its /goal resume and /goal clear
// standalone commands), background work the provider still runs, and the local
// checkout's branch moving off the thread's. The snooze/settle status line from the
// same hook is ThreadStatusFooter in the timeline.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { isAtomCommandInterrupted, runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  type EnvironmentId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2ThreadProjection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useRef, useState } from "react";

import { requestConfirmDialog } from "../../dialogs/confirmDialog.ts";
import { useEnvironmentQuery } from "../../palette/hooks.ts";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentShell, environmentThreadShells, threadEnvironment } from "../../state/environment.ts";
import { vcsEnvironment } from "../../state/git.ts";
import { routeAtom } from "../../state/ui.ts";
import { toast } from "../../ui/toast.tsx";
import { resolveLocalCheckoutBranchMismatch } from "../../web/components/BranchToolbar.logic.ts";
import {
  branchMismatchKey,
  deriveThreadPendingBackgroundTasks,
  dismissBranchMismatchForSession,
  isBranchMismatchDismissedForSession,
  shouldShowBranchMismatchBanner,
} from "../../web/components/ChatView.logic.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../../web/state/session.ts";
import type { ComposerBannerStackItem } from "./ComposerBannerStack.tsx";
import { devBackgroundTasks, devChildInputs, devCurrentGitBranch } from "./devComposerBanners.ts";
import { composerSendErrorAtom } from "./composerSend.ts";
import {
  backgroundWorkBannerItem,
  branchMismatchBannerItem,
  childInputBannerItem,
  goalBannerItem,
} from "./ThreadActivityBanners.tsx";

const NO_CHILD_INPUTS_ATOM = Atom.make<ReadonlyArray<EnvironmentThreadShell>>([]);

/** What a standalone command sends with: the composer's current model and modes. */
export interface StandaloneSendContext {
  readonly providerAvailable: boolean;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export interface ThreadLifecycleBannersInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly draftKey: string;
  readonly shell: EnvironmentThreadShell | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly projectCwd: string | null;
  readonly canOperateThread: boolean;
  readonly isWorking: boolean;
  readonly parentAwaitingUser: boolean;
  readonly composerHasDraftContent: boolean;
  readonly getSendContext: () => StandaloneSendContext;
  /** Clears the /usage-limits panel once a turn spends quota (web clearUsageLimitsFor). */
  readonly onTurnStarted: () => void;
}

export function useThreadLifecycleBanners(input: ThreadLifecycleBannersInput) {
  const {
    environmentId,
    threadId,
    draftKey,
    shell,
    projection,
    projectCwd,
    canOperateThread,
    isWorking,
    parentAwaitingUser,
    composerHasDraftContent,
  } = input;
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const activeThread = threadId !== null ? shell : null;

  // ── Branch mismatch (web ChatView localCheckoutBranchMismatch) ────────
  // A server thread without its own worktree runs in the project's checkout ("local"),
  // so the checkout's current branch can drift from the thread's.
  const gitCwd = activeThread && activeThread.worktreePath === null ? projectCwd : null;
  const gitStatus = useEnvironmentQuery(gitCwd ? vcsEnvironment.status({ environmentId, input: { cwd: gitCwd } }) : null);
  const localCheckoutBranchMismatch = activeThread
    ? resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: activeThread.worktreePath ? "worktree" : "local",
        activeWorktreePath: activeThread.worktreePath,
        activeThreadBranch: activeThread.branch,
        currentGitBranch: devCurrentGitBranch((gitStatus.data as { refName?: string | null } | null)?.refName ?? null),
      })
    : null;
  const [isRestoringThreadBranch, setIsRestoringThreadBranch] = useState(false);
  const [revealedBranchMismatchKey, setRevealedBranchMismatchKey] = useState<string | null>(null);
  const [, setBranchMismatchDismissTick] = useState(0);
  const activeBranchMismatchKey = branchMismatchKey(activeThread?.id ?? null, localCheckoutBranchMismatch);
  const showBranchMismatchBanner = shouldShowBranchMismatchBanner({
    hasMismatch: localCheckoutBranchMismatch !== null,
    isDismissed: isBranchMismatchDismissedForSession(activeBranchMismatchKey),
    composerHasContent: composerHasDraftContent,
    wasShownForCurrentMismatch: revealedBranchMismatchKey !== null && revealedBranchMismatchKey === activeBranchMismatchKey,
  });
  const nextRevealedBranchMismatchKey = showBranchMismatchBanner
    ? activeBranchMismatchKey
    : revealedBranchMismatchKey !== activeBranchMismatchKey
      ? null
      : revealedBranchMismatchKey;
  if (nextRevealedBranchMismatchKey !== revealedBranchMismatchKey) {
    setRevealedBranchMismatchKey(nextRevealedBranchMismatchKey);
  }
  const handleSwitchCheckoutToThread = async () => {
    if (!canWriteSourceControl) return;
    if (!projectCwd || !activeThread || !localCheckoutBranchMismatch || isRestoringThreadBranch) return;
    setIsRestoringThreadBranch(true);
    const checkoutResult = await runAtomCommand(
      appAtomRegistry,
      vcsEnvironment.switchRef,
      { environmentId, input: { cwd: projectCwd, refName: localCheckoutBranchMismatch.threadBranch } } as never,
      { reportFailure: false },
    );
    if (checkoutResult._tag === "Failure") {
      setIsRestoringThreadBranch(false);
      if (!isAtomCommandInterrupted(checkoutResult)) {
        toast({ type: "error", title: "Failed to switch checkout", description: errorText(squashAtomCommandFailure(checkoutResult)) });
      }
      return;
    }
    if (!readEnvironmentScope(environmentId, AuthSourceControlWriteScope)) {
      setIsRestoringThreadBranch(false);
      return;
    }
    const nextBranch =
      (checkoutResult.value as { refName?: string | null } | undefined)?.refName ?? localCheckoutBranchMismatch.threadBranch;
    if (nextBranch !== activeThread.branch) {
      const updateResult = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.updateMetadata,
        { environmentId, input: { threadId: activeThread.id, branch: nextBranch, worktreePath: null } } as never,
        { reportFailure: false },
      );
      if (updateResult._tag === "Failure") {
        setIsRestoringThreadBranch(false);
        if (!isAtomCommandInterrupted(updateResult)) {
          toast({
            type: "error",
            title: "Checkout switched, but the thread could not be updated",
            description: errorText(squashAtomCommandFailure(updateResult)),
          });
        }
        gitStatus.refresh();
        return;
      }
    }
    gitStatus.refresh();
    setIsRestoringThreadBranch(false);
  };

  // ── Background work ───────────────────────────────────────────────────
  // The interrupt path also accepts a completed run while its provider still
  // has background work.
  const activeBackgroundTasks =
    !isWorking && activeThread ? devBackgroundTasks(threadId, deriveThreadPendingBackgroundTasks(projection)) : [];
  const [stoppingBackgroundWorkKey, setStoppingBackgroundWorkKey] = useState<string | null>(null);
  const isStoppingBackgroundWork = stoppingBackgroundWorkKey === `${environmentId}:${threadId}`;
  const handleStopBackgroundWork = async () => {
    if (!activeThread || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    const requestKey = `${environmentId}:${activeThread.id}`;
    setStoppingBackgroundWorkKey(requestKey);
    const result = await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.interruptTurn,
      { environmentId, input: { threadId: activeThread.id, createdAt: new Date().toISOString() } } as never,
      { reportFailure: false },
    );
    // Acceptance does not confirm termination. Allow retry while the provider
    // finishes stopping the tasks or reports a failure.
    setStoppingBackgroundWorkKey((current) => (current === requestKey ? null : current));
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      appAtomRegistry.set(
        composerSendErrorAtom(draftKey),
        error instanceof Error ? error.message : "Failed to stop background work.",
      );
    }
  };

  // ── Related threads ───────────────────────────────────────────────────
  const onOpenRelatedThread = (target: ThreadId) => {
    const related = appAtomRegistry.get(environmentThreadShells.threadShellAtom({ environmentId, threadId: target }));
    const live = appAtomRegistry.get(environmentShell.stateValueAtom(environmentId)).status === "live";
    if (related === null ? live : related.deletedAt != null) {
      toast({ type: "info", title: "This thread is no longer available" });
      return;
    }
    appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId: target });
  };
  const childThreadInputs = devChildInputs(shell, useAtomValue(
    threadId === null ? NO_CHILD_INPUTS_ATOM : environmentThreadShells.childThreadInputsAtom({ environmentId, threadId }),
  ));
  const childInputBanner = childInputBannerItem({
    childThreadInputs,
    parentAwaitingUser: parentAwaitingUser || Boolean(activeThread?.hasPendingUserInput),
    onOpenThread: onOpenRelatedThread,
  });

  // ── Standalone commands (/goal resume, /goal clear) ───────────────────
  const sendInFlightRef = useRef(false);
  const sendStandaloneCommand = async (text: string, failureMessage: string) => {
    if (!activeThread || sendInFlightRef.current) return;
    const context = input.getSendContext();
    if (!context.providerAvailable) return;
    const createdAt = new Date().toISOString();
    sendInFlightRef.current = true;
    appAtomRegistry.set(composerSendErrorAtom(draftKey), null);
    let failure: unknown = null;
    // web persistThreadSettingsForNextTurn: the command runs with the composer's modes.
    if (context.runtimeMode !== activeThread.runtimeMode) {
      const result = await runAtomCommand(appAtomRegistry, threadEnvironment.setRuntimeMode, {
        environmentId,
        input: { threadId: activeThread.id, runtimeMode: context.runtimeMode, createdAt },
      } as never);
      if (result._tag === "Failure") failure = isAtomCommandInterrupted(result) ? null : squashAtomCommandFailure(result);
    }
    if (failure === null && context.interactionMode !== activeThread.interactionMode) {
      const result = await runAtomCommand(appAtomRegistry, threadEnvironment.setInteractionMode, {
        environmentId,
        input: { threadId: activeThread.id, interactionMode: context.interactionMode, createdAt },
      } as never);
      if (result._tag === "Failure") failure = isAtomCommandInterrupted(result) ? null : squashAtomCommandFailure(result);
    }
    if (failure === null) {
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.startTurn,
        {
          environmentId,
          input: {
            threadId: activeThread.id,
            message: { messageId: MessageId.make(globalThis.crypto.randomUUID()), role: "user", text, attachments: [] },
            modelSelection: context.modelSelection,
            runtimeMode: context.runtimeMode,
            interactionMode: context.interactionMode,
            createdAt,
          },
        } as never,
        { reportFailure: false },
      );
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) failure = squashAtomCommandFailure(result);
      } else {
        input.onTurnStarted();
      }
    }
    if (failure !== null) {
      appAtomRegistry.set(composerSendErrorAtom(draftKey), failure instanceof Error ? failure.message : failureMessage);
    }
    sendInFlightRef.current = false;
  };
  const activeGoal = activeThread?.goal ?? null;
  const goalBanner =
    activeThread && activeGoal !== null
      ? goalBannerItem({ threadId: activeThread.id, goal: activeGoal, isWorking, onSendCommand: sendStandaloneCommand })
      : null;
  const backgroundWorkBanner = activeThread
    ? backgroundWorkBannerItem({
        threadId: activeThread.id,
        tasks: activeBackgroundTasks,
        stopDisabled: !canOperateThread || isStoppingBackgroundWork,
        stopping: isStoppingBackgroundWork,
        onStop: handleStopBackgroundWork,
        onOpenThread: onOpenRelatedThread,
      })
    : null;
  const branchMismatchBanner: ComposerBannerStackItem | null =
    localCheckoutBranchMismatch && showBranchMismatchBanner && activeBranchMismatchKey
      ? branchMismatchBannerItem({
          mismatchKey: activeBranchMismatchKey,
          mismatch: localCheckoutBranchMismatch,
          restoreDisabled: !canWriteSourceControl || isRestoringThreadBranch,
          restoring: isRestoringThreadBranch,
          // web handleRestoreThreadBranch + BranchRestoreConfirmHost: a dirty checkout confirms first.
          onRestore: () => {
            if (!canWriteSourceControl) return;
            if ((gitStatus.data as { hasWorkingTreeChanges?: boolean } | null)?.hasWorkingTreeChanges) {
              void requestConfirmDialog(
                `Switch to ${localCheckoutBranchMismatch.threadBranch}?
You have uncommitted changes. They'll carry over to the other branch, or block the switch if they conflict.`,
              ).then((confirmed) => {
                if (confirmed) void handleSwitchCheckoutToThread();
              });
              return;
            }
            void handleSwitchCheckoutToThread();
          },
          onDismiss: () => {
            dismissBranchMismatchForSession(activeBranchMismatchKey);
            setBranchMismatchDismissTick((tick) => tick + 1);
          },
        })
      : null;

  return { childInputBanner, goalBanner, backgroundWorkBanner, branchMismatchBanner };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}
