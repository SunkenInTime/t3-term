// The "ask in a thread" hand-offs from apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx
// (`writeTaskToComposer`, `openThreadWithTask`, `startAsk`): a question, an explanation request,
// a finding to fix or a guide stop to ask about is written into a thread's composer for the
// reader to read over and send. Nothing is sent from here.
//
// Web writes the task's review comments into the draft as context chips, which travel with the
// message as structured records. t3-term's composer has no context chips, so the records are
// written into the prompt in the form web itself uses for a server without inline message
// context (`serializeLegacyContextMessage`): the agent receives the same text either way.
import type { ComposerContextRecord, ScopedProjectRef } from "@t3tools/contracts";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";

import { startNewThread } from "../palette/actions.ts";
import {
  composerTargetKey,
  focusComposer,
  readComposerDraft,
  setComposerPrompt,
} from "../state/composer.ts";
import { toast } from "../ui/toast.tsx";
import { handoffPrompt } from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import type { ReviewCommentContext } from "../web/components/pullRequest/pullRequestDetail.deps.ts";

export interface PullRequestThreadTask {
  readonly prompt: string;
  readonly reviewComments?: ReadonlyArray<ReviewCommentContext>;
}

function reviewCommentRecord(comment: ReviewCommentContext): ComposerContextRecord {
  return {
    version: 1,
    contextId: comment.id,
    kind: "review-comment",
    label: comment.filePath,
    sectionId: comment.sectionId,
    sectionTitle: comment.sectionTitle,
    filePath: comment.filePath,
    startIndex: comment.startIndex,
    endIndex: comment.endIndex,
    rangeLabel: comment.rangeLabel,
    text: comment.text,
    diff: comment.diff,
    ...(comment.fenceLanguage === undefined ? {} : { fenceLanguage: comment.fenceLanguage }),
    ...(comment.pullRequest === undefined ? {} : { pullRequest: comment.pullRequest }),
  } as ComposerContextRecord;
}

/** The task as the one message text it becomes. */
export function pullRequestTaskText(task: PullRequestThreadTask): string {
  return serializeLegacyContextMessage({
    text: task.prompt,
    records: (task.reviewComments ?? []).map(reviewCommentRecord),
  });
}

/**
 * What the last hand-off wrote into each draft. Only the text still exactly as written may be
 * replaced by the next hand-off; anything the reader typed around it stays.
 */
const lastHandoffPromptByDraft = new Map<string, string>();

export function writeTaskToComposer(draftKey: string, task: PullRequestThreadTask): void {
  const incoming = pullRequestTaskText(task);
  const prompt = handoffPrompt(
    { prompt: readComposerDraft(draftKey).prompt, lastHandoffPrompt: lastHandoffPromptByDraft.get(draftKey) },
    incoming,
  );
  lastHandoffPromptByDraft.set(draftKey, incoming);
  setComposerPrompt(draftKey, prompt);
}

/** Opens a new thread draft in the project and writes the task into its composer. */
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
