// Port of apps/web/src/components/chat/useQueuedRunEdit.ts (+ queuedMessageEdit.ts
// recoverQueuedMessageEdit), text only. While editing, the composer edits `draftKey`
// (a per-run draft) so the thread's own draft survives untouched; submit calls
// `saveEdit(prompt)`. Attachments of the queued message are kept as they are:
// adding or removing attachments during an edit is not ported.
import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
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
  setComposerPrompt,
} from "../../state/composer.ts";
import { environmentThreads, threadEnvironment } from "../../state/environment.ts";
import { toast } from "../../ui/toast.tsx";
import type { EditQueuedRunRequest } from "./QueuedRunsControl.tsx";

interface EditingQueuedRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly originalText: string;
  readonly hasAttachments: boolean;
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
      originalText: request.text,
      hasAttachments: request.attachments.length > 0,
    });
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
    if (text.length === 0 && !editing.hasAttachments) return false;
    saveInFlightRef.current = true;
    setIsSaving(true);
    const result = await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.editQueuedRun,
      {
        environmentId,
        input: {
          threadId: editing.threadId,
          runId: editing.runId,
          text: text.length === 0 ? ATTACHMENT_ONLY_BOOTSTRAP_PROMPT : text,
        },
      },
      { reportFailure: false },
    );
    saveInFlightRef.current = false;
    setIsSaving(false);
    if (result._tag === "Failure") {
      toast({ type: "error", title: "Could not save the edited queued message." });
      return false;
    }
    clearComposerContent(queuedEditDraftKey(environmentId, editing.threadId, editing.runId));
    setEditing(null);
    return true;
  };

  return {
    editingRunId: editing?.runId ?? null,
    isEditing: editing !== null,
    isSaving,
    /** Composer draft key to edit: the per-run edit draft while editing, else the thread draft. */
    draftKey,
    beginEdit,
    cancelEdit,
    saveEdit,
  };
}
