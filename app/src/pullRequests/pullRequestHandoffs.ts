// The "ask in a thread" hand-offs from apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx
// (`writeTaskToComposer`, `openThreadWithTask`, `startAsk`): a question, an explanation request,
// a finding to fix or a guide stop to ask about is written into a thread's composer, with its
// review comments as context chips (inline references plus records), for the reader to read
// over and send. Nothing is sent from here.
import type { ScopedProjectRef } from "@t3tools/contracts";

import { startNewThread } from "../palette/actions.ts";
import {
  addComposerReviewComment,
  composerTargetKey,
  focusComposer,
  readComposerDraft,
  updateComposerDraft,
} from "../state/composer.ts";
import { toast } from "../ui/toast.tsx";
import {
  handoffPrompt,
  handoffReviewComments,
  stripPullRequestHandoffReferences,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
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

export function openThreadWithTask(projectRef: ScopedProjectRef, task: PullRequestThreadTask): void {
  startNewThread(projectRef);
  writeTaskToComposer(
    composerTargetKey({ kind: "draft", environmentId: projectRef.environmentId, projectId: projectRef.projectId }),
    task,
  );
  focusComposer();
}

export function startPullRequestAsk(
  projectRef: ScopedProjectRef,
  task: PullRequestThreadTask,
  attachTo: string | null,
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
  openThreadWithTask(projectRef, task);
  toast({
    type: "success",
    title: "Asked in a thread",
    description:
      task.prompt.length > 0
        ? "The question is in the composer. Read it over, then send."
        : "The pull request is in the composer. Type your question, then send.",
  });
}
