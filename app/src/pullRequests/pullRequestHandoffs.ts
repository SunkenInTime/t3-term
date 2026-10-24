// The "ask in a thread" hand-offs from apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx
// (`writeTaskToComposer`, `openThreadWithTask`, `startAsk`): a question, an explanation request,
// a finding to fix or a guide stop to ask about is written into a thread's composer, with its
// review comments as context chips (inline references plus records), for the reader to read
// over and send. Nothing is sent from here.
//
// `runPullRequestCheckoutHandoff` is web's usePullRequestActions.ts `startHandoff`: it checks the
// pull request out (worktree or local) and opens a thread on the checkout with the task in its
// composer. The PR page's Fix/Resolve/Check out and the thread details row's Fix/Resolve share it.
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ThreadId, type EnvironmentId, type PullRequestRef, type ScopedProjectRef } from "@t3tools/contracts";

import { startNewThread } from "../palette/actions.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  addComposerReviewComment,
  focusComposer,
  readComposerDraft,
  setDraftWorkspace,
  updateComposerDraft,
} from "../state/composer.ts";
import { gitEnvironment } from "../state/git.ts";
import { draftPullRequestPaneAtom, guideRunKey, guideRunStore } from "../state/pullRequests.ts";
import { toast, updateToast } from "../ui/toast.tsx";
import {
  checkoutFailureDescription,
  handoffPrompt,
  handoffReviewComments,
  stripPullRequestHandoffReferences,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { guardPullRequestWrite, PullRequestDryRunError } from "./pullRequestWrites.ts";
import type { ReviewCommentContext } from "../web/components/pullRequest/pullRequestDetail.deps.ts";

export interface PullRequestThreadTask {
  readonly prompt: string;
  readonly reviewComments?: ReadonlyArray<ReviewCommentContext>;
}

/**
 * What the last hand-off wrote into each draft. Only the text still exactly as written may be
 * replaced by the next hand-off; anything the reader typed around it stays.
 */
const lastHandoffPromptByDraft = new Map<string, string>();

export function writeTaskToComposer(draftKey: string, task: PullRequestThreadTask): void {
  const draft = readComposerDraft(draftKey);
  const existing = draft.reviewComments ?? [];
  // A previous hand-off's chips go, with their references; the reader's own chips stay.
  const stripped = stripPullRequestHandoffReferences(draft.prompt, existing);
  const prompt = handoffPrompt(
    { prompt: stripped, lastHandoffPrompt: lastHandoffPromptByDraft.get(draftKey) },
    task.prompt,
  );
  lastHandoffPromptByDraft.set(draftKey, task.prompt);
  updateComposerDraft(draftKey, (current) => ({
    ...current,
    prompt,
    reviewComments: handoffReviewComments(existing, []),
  }));
  for (const comment of task.reviewComments ?? []) addComposerReviewComment(draftKey, comment);
}

/** Returns the composer key of the new draft (suffixed when the project's first draft has content). */
export function openThreadWithTask(projectRef: ScopedProjectRef, task: PullRequestThreadTask): string {
  const draftKey = startNewThread(projectRef);
  writeTaskToComposer(draftKey, task);
  focusComposer();
  return draftKey;
}

export function startPullRequestAsk(
  projectRef: ScopedProjectRef,
  task: PullRequestThreadTask,
  attachTo: string | null,
  options?: { readonly keepGuide?: { readonly environmentId: EnvironmentId; readonly reference: PullRequestRef } },
): void {
  if (attachTo !== null) {
    writeTaskToComposer(attachTo, task);
    toast({
      type: "success",
      title: "Added to the composer",
      description:
        task.prompt.length > 0
          ? "The question is in the composer. Read it over, then send."
          : "The pull request is in the composer. Type your question, then send.",
    });
    return;
  }
  const draftKey = openThreadWithTask(projectRef, task);
  const keepGuide = options?.keepGuide;
  if (keepGuide) {
    // web: the pull request reopens on its Guide beside the new draft, so the reader can keep
    // walking the guide while the question waits to be sent.
    appAtomRegistry.set(draftPullRequestPaneAtom, {
      draftKey,
      environmentId: keepGuide.environmentId,
      reference: keepGuide.reference,
      tab: "guide",
    });
    guideRunStore.requestOpen(guideRunKey(keepGuide.environmentId, keepGuide.reference));
  }
  toast({
    type: "success",
    title: "Asked in a thread",
    description:
      task.prompt.length > 0
        ? "The question is in the composer. Read it over, then send."
        : "The pull request is in the composer. Type your question, then send.",
  });
}

const OFF_HEAD_PULL_REQUEST_CHECKOUT_TOAST = {
  type: "warning",
  title: "Checked out, but not confirmed on the latest commit",
  description:
    "This checkout could not be confirmed at the pull request's latest commit, so its code may differ. Local commits or uncommitted work keep a checkout where it is.",
} as const;

/**
 * A dry run refuses the checkout like every other pull request write. With
 * `T3TERM_PR_DRY_RUN_SIMULATE_CHECKOUT=1` the hand-off then carries on as if the checkout had
 * landed, without pointing the draft at any branch or worktree, so a screenshot run can follow
 * Fix/Resolve to the prefilled composer. Nothing is checked out and nothing is sent.
 */
const SIMULATE_DRY_RUN_CHECKOUT = process.env.T3TERM_PR_DRY_RUN_SIMULATE_CHECKOUT === "1";

export interface PullRequestCheckoutHandoff {
  /** The environment that runs the checkout (the PR page can act from another machine). */
  readonly environmentId: EnvironmentId;
  readonly projectRef: ScopedProjectRef;
  readonly checkoutRoot: string;
  readonly url: string;
  readonly mode: "worktree" | "local";
  readonly task: PullRequestThreadTask | null;
}

export async function runPullRequestCheckoutHandoff(handoff: PullRequestCheckoutHandoff): Promise<void> {
  const { environmentId, projectRef, checkoutRoot, url, mode, task } = handoff;
  // A loading toast never expires; the result replaces it in place.
  const toastId = toast({ type: "loading", title: "Preparing the pull request checkout..." });
  // The thread id is chosen before the checkout: a worktree's setup script runs for the thread
  // it was made for.
  const threadId = ThreadId.make(globalThis.crypto.randomUUID());
  const input = { cwd: checkoutRoot, reference: url, mode, ...(mode === "worktree" ? { threadId } : {}) };
  const prepared = await guardPullRequestWrite(gitEnvironment.preparePullRequestThread.label, { environmentId, input }, () =>
    runAtomCommand(appAtomRegistry, gitEnvironment.preparePullRequestThread, { environmentId, input }, { reportFailure: false }),
  );
  if (prepared instanceof PullRequestDryRunError && SIMULATE_DRY_RUN_CHECKOUT) {
    const draftKey = startNewThread(projectRef);
    if (task !== null) {
      writeTaskToComposer(draftKey, task);
      focusComposer();
    }
    updateToast(toastId, { type: "info", title: "Dry run: checkout recorded, not run", description: "The task is in the composer of a thread on the current workspace. Nothing was checked out." });
    return;
  }
  if (prepared instanceof PullRequestDryRunError || prepared._tag === "Failure") {
    updateToast(toastId, {
      type: "error",
      title: "Could not prepare the pull request checkout",
      description:
        prepared instanceof PullRequestDryRunError
          ? prepared.message
          : checkoutFailureDescription(isAtomCommandInterrupted(prepared) ? undefined : squashAtomCommandFailure(prepared)),
    });
    return;
  }
  const draftKey = startNewThread(projectRef);
  setDraftWorkspace(draftKey, {
    envMode: prepared.value.worktreePath === null ? "local" : "worktree",
    branch: prepared.value.branch,
    worktreePath: prepared.value.worktreePath,
  });
  if (task !== null) {
    writeTaskToComposer(draftKey, task);
    focusComposer();
  }
  updateToast(
    toastId,
    !prepared.value.isOnPullRequestHead
      ? OFF_HEAD_PULL_REQUEST_CHECKOUT_TOAST
      : task !== null
        ? { type: "success", title: "Checkout ready", description: "The task is in the composer. Read it over, then send." }
        : {
            type: "success",
            title: mode === "local" ? "Checked out here" : "Checked out",
            description:
              mode === "local"
                ? "This repository is on the pull request's branch, with a thread open on it."
                : "The pull request is in its own worktree, with a thread open on it.",
          },
  );
}
