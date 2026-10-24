// Port of apps/web/src/components/chat/useQueuedRunEdit.ts (+ queuedMessageEdit.ts
// recoverQueuedMessageEdit). While editing, the composer edits `draftKey` (a per-run
// draft) so the thread's own draft survives untouched; submit calls `saveEdit(prompt)`.
// The queued message's attachments show in the composer and can be removed; attachments
// and context added during the edit upload on save, and the message is replaced whole
// (web submitQueuedRunEdit).
import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  ChatAttachment,
  EnvironmentId,
  MessageId,
  OrchestrationMessageContext,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";
import * as Option from "effect/Option";
import { Atom, AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  clearComposerContent,
  composerDraftHasUserContent,
  composerTargetKey,
  readComposerDraft,
  referencedReviewComments,
  referencedTerminalContexts,
  referencedThreadContexts,
  setComposerPrompt,
} from "../../state/composer.ts";
import { buildComposerMessageContext } from "../../web/lib/composerContextRecords.ts";
import { filterTerminalContextsWithText } from "../../web/lib/terminalContext.ts";
import { prepareTurnAttachments } from "./composerSend.ts";
import { environmentThreads, threadEnvironment } from "../../state/environment.ts";
import { toast } from "../../ui/toast.tsx";
import type { EditQueuedRunRequest } from "./QueuedRunsControl.tsx";

interface EditingQueuedRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly originalText: string;
  /** The queued message's attachments the edit keeps; removal is client state until save. */
  readonly existingAttachments: ReadonlyArray<ChatAttachment>;
  readonly removedAttachment: boolean;
  readonly context: OrchestrationMessageContext | undefined;
}

const NO_THREAD_STATE_ATOM = Atom.make(AsyncResult.initial()) as unknown as ReturnType<
  typeof environmentThreads.stateAtom
>;

function queuedEditDraftKey(environmentId: EnvironmentId, threadId: ThreadId, runId: RunId) {
  return `queued-edit:${environmentId}:${threadId}:${runId}`;
}

export function useQueuedRunEdit(input: {
  readonly environmentId: EnvironmentId;
  /** Null while the route has no thread yet; an edit needs one to target. */
  readonly threadId: ThreadId | null;
}) {
  const { environmentId, threadId } = input;
  const [editing, setEditing] = useState<EditingQueuedRun | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  // Navigating to another thread ends the edit; its draft stays for later.
  if (editing !== null && threadId !== editing.threadId) setEditing(null);

  const threadDraftKey = threadId ? composerTargetKey({ kind: "thread", environmentId, threadId }) : null;
  const draftKey =
    editing === null ? threadDraftKey : queuedEditDraftKey(environmentId, editing.threadId, editing.runId);

  const projectedThreadId = editing?.threadId ?? threadId;
  const result = useAtomValue(
    projectedThreadId === null ? NO_THREAD_STATE_ATOM : environmentThreads.stateAtom(environmentId, projectedThreadId),
  );
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;

  // Exit edit mode when the edited run leaves the queue (it started, or another client
  // cancelled it). A dirty edit moves into the thread's own draft when that draft is
  // empty; otherwise it is dropped, with a toast either way.
  useEffect(() => {
    if (editing === null || projection === null || projection.thread.id !== editing.threadId) return;
    const run = projection.runs.find((candidate) => candidate.id === editing.runId);
    if (run !== undefined && run.status === "queued") return;
    const editKey = queuedEditDraftKey(environmentId, editing.threadId, editing.runId);
    const threadKey = composerTargetKey({ kind: "thread", environmentId, threadId: editing.threadId });
    const editPrompt = readComposerDraft(editKey).prompt;
    const dirty = editPrompt !== editing.originalText;
    if (dirty && !composerDraftHasUserContent(readComposerDraft(threadKey))) {
      setComposerPrompt(threadKey, editPrompt);
      toast({
        type: "info",
        title: "Queued message is no longer queued",
        description: "Your unsaved edit was kept in the composer.",
      });
    } else if (dirty) {
      toast({
        type: "warning",
        title: "Queued message is no longer queued",
        description: "Your unsaved edit was discarded.",
      });
    }
    clearComposerContent(editKey);
    setEditing(null);
  }, [editing, environmentId, projection]);

  const beginEdit = (request: EditQueuedRunRequest) => {
    if (threadId === null) return;
    if (editing !== null && editing.runId !== request.runId) {
      clearComposerContent(queuedEditDraftKey(environmentId, editing.threadId, editing.runId));
    }
    const key = queuedEditDraftKey(environmentId, threadId, request.runId);
    clearComposerContent(key);
    setComposerPrompt(key, request.text);
    setEditing({
      threadId,
      runId: request.runId,
      messageId: request.messageId,
      originalText: request.text,
      existingAttachments: request.attachments,
      removedAttachment: false,
      context: projection?.messages.find((message) => message.id === request.messageId)?.context,
    });
  };

  const removeEditingAttachment = (attachmentId: string) => {
    setEditing((current) =>
      current === null
        ? current
        : {
            ...current,
            existingAttachments: current.existingAttachments.filter((attachment) => attachment.id !== attachmentId),
            removedAttachment: true,
          },
    );
  };

  const cancelEdit = () => {
    if (editing === null) return;
    clearComposerContent(queuedEditDraftKey(environmentId, editing.threadId, editing.runId));
    setEditing(null);
  };

  /** Saves `prompt` as the queued message's text. Returns false when nothing was saved. */
  const saveEdit = async (prompt: string): Promise<boolean> => {
    if (editing === null || saveInFlightRef.current) return false;
    const text = prompt.trim();
    const editKey = queuedEditDraftKey(environmentId, editing.threadId, editing.runId);
    const editDraft = readComposerDraft(editKey);
    const newAttachments = editDraft.attachments;
    const newContext = buildComposerMessageContext({
      terminalContexts: filterTerminalContextsWithText(referencedTerminalContexts(editDraft, prompt)),
      reviewComments: referencedReviewComments(editDraft, prompt),
      threadContexts: referencedThreadContexts(editDraft, prompt),
    });
    if (text.length === 0 && editing.existingAttachments.length === 0 && newAttachments.length === 0) return false;
    saveInFlightRef.current = true;
    setIsSaving(true);
    let failure: string | null = null;
    try {
      // A text-only change leaves the stored attachments alone; anything else replaces the
      // message's attachments and context whole.
      const replaceWhole = editing.removedAttachment || newAttachments.length > 0 || newContext !== undefined;
      let edit: { messageId: MessageId; attachments: ReadonlyArray<unknown>; context?: OrchestrationMessageContext } | undefined;
      if (replaceWhole) {
        const uploads = await prepareTurnAttachments(environmentId, newAttachments);
        // Kept records for removed attachments would point at nothing.
        const keptRecords = (editing.context?.records ?? []).filter(
          (record) =>
            !("attachmentId" in record) ||
            editing.existingAttachments.some((attachment) => attachment.id === record.attachmentId),
        );
        const records = [
          ...new Map([...keptRecords, ...(newContext?.records ?? [])].map((record) => [record.contextId, record] as const)).values(),
        ];
        edit = {
          messageId: editing.messageId,
          attachments: [...editing.existingAttachments, ...uploads],
          ...(records.length > 0 ? { context: { version: 1, records } as OrchestrationMessageContext } : {}),
        };
      }
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.editQueuedRun,
        {
          environmentId,
          input: {
            threadId: editing.threadId,
            runId: editing.runId,
            text: text.length === 0 ? ATTACHMENT_ONLY_BOOTSTRAP_PROMPT : text,
            ...(edit ? { edit: edit as never } : {}),
          },
        },
        { reportFailure: false },
      );
      if (result._tag === "Failure") failure = "Could not save the edited queued message.";
    } catch (error) {
      failure = error instanceof Error ? error.message : "Could not save the edited queued message.";
    }
    saveInFlightRef.current = false;
    setIsSaving(false);
    if (failure !== null) {
      toast({ type: "error", title: failure });
      return false;
    }
    clearComposerContent(queuedEditDraftKey(environmentId, editing.threadId, editing.runId));
    setEditing(null);
    return true;
  };

  return {
    editingRunId: editing?.runId ?? null,
    isEditing: editing !== null,
    /** The queued message's own attachments still kept by the edit (shown in the composer). */
    editingAttachments: editing?.existingAttachments ?? null,
    removeEditingAttachment,
    isSaving,
    /** Composer draft key to edit: the per-run edit draft while editing, else the thread draft. */
    draftKey,
    beginEdit,
    cancelEdit,
    saveEdit,
  };
}
