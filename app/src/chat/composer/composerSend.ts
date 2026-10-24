// The composer's send path, after apps/web/src/components/chat/useComposerSend.ts and
// apps/mobile/src/lib/{attachmentUpload,projectThreadStartTurn}.ts:
//   existing thread → persist runtime/interaction mode → upload attachments → startTurn
//   new thread      → upload attachments → startTurn with bootstrap.createThread
//                     (+ prepareWorktree) → open the thread.
import * as NodeFs from "node:fs";

import {
  type ApprovalResponder,
  declinePendingApprovals,
  type ThreadPendingApproval,
} from "@t3tools/client-runtime/state/thread-requests";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import type { ComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type ChatAttachment,
  type EnvironmentId,
  MessageId,
  type ModelSelection,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadContextRecord,
  ThreadId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  type ComposerAttachmentDraft,
  type DraftThreadEnvMode,
  addOptimisticMessage,
  draftPendingSendAtom,
  rememberSentImagePreview,
  clearComposerContent,
  deleteComposerDraft,
  readComposerDraft,
  draftIdOfKey,
  removeOptimisticMessages,
  restoreComposerContent,
} from "../../state/composer.ts";
import { buildComposerMessageContext } from "../../web/lib/composerContextRecords.ts";
import type { ChatMessage } from "../../web/types.ts";
import { approvalRedirectNotice } from "../../web/components/chat/composerSend.logic.ts";
import type { TerminalContextDraft } from "../../web/lib/terminalContext.ts";
import type { ReviewCommentContext } from "../../web/reviewCommentContext.ts";
import { environmentSession, threadEnvironment } from "../../state/environment.ts";
import { routeAtom } from "../../state/ui.ts";
import { startNewThread } from "../../palette/actions.ts";
import { toast } from "../../ui/toast.tsx";
import { DEV_SEND_HOLD } from "./devComposerAttachments.ts";
import {
  attachmentUploadStateAtom,
  environmentSupportsUploads,
  forgetAttachmentUploads,
  uploadedTurnAttachment,
  wireMimeType,
} from "./attachmentUploads.ts";

/** Sends in flight per draft key: the composer shows a spinner and refuses a second send. */
export const composerSendingAtom = Atom.family((_draftKey: string) =>
  Atom.make(false).pipe(Atom.keepAlive),
);

/** The last send failure per draft key, shown under the editor like web's thread error. */
export const composerSendErrorAtom = Atom.family((_draftKey: string) =>
  Atom.make<string | null>(null).pipe(Atom.keepAlive),
);

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function failureMessage(result: AtomCommandResult<unknown, unknown>): string {
  return result._tag === "Failure" ? errorMessage(squashAtomCommandFailure(result)) : "";
}

// ── Attachments ─────────────────────────────────────────────────────────

async function readDataUrl(attachment: ComposerAttachmentDraft): Promise<string> {
  const bytes = await Bun.file(attachment.path).arrayBuffer();
  return `data:${wireMimeType(attachment)};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * The attachments a turn sends: the server's upload records when it takes uploads (each
 * staged item's upload, started when it was added; attachmentUploads.ts), otherwise images
 * inlined as data URLs.
 */
export async function prepareTurnAttachments(
  environmentId: EnvironmentId,
  attachments: ReadonlyArray<ComposerAttachmentDraft>,
): Promise<ReadonlyArray<ChatAttachment | UploadChatAttachment>> {
  if (attachments.length === 0) return [];
  if (attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    throw new Error(`You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`);
  }
  for (const attachment of attachments) {
    if (!NodeFs.existsSync(attachment.path) && appAtomRegistry.get(attachmentUploadStateAtom(attachment.id))?.status !== "ready") {
      throw new Error(`'${attachment.name}' is no longer on disk. Remove it and attach it again.`);
    }
  }
  if (!environmentSupportsUploads(environmentId)) {
    if (attachments.some((attachment) => attachment.type === "file")) {
      throw new Error("This server does not support file attachments.");
    }
    return Promise.all(
      attachments.map(async (attachment) => ({
        type: "image" as const,
        name: attachment.name,
        mimeType: wireMimeType(attachment),
        sizeBytes: attachment.sizeBytes,
        dataUrl: await readDataUrl(attachment),
      })),
    );
  }
  const connection = appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId));
  if (Option.isNone(connection)) throw new Error("The environment is not connected.");
  return Promise.all(attachments.map((attachment) => uploadedTurnAttachment(environmentId, attachment)));
}

// ── Send ────────────────────────────────────────────────────────────────

export type ComposerSendTarget =
  | {
      readonly kind: "thread";
      readonly threadId: ThreadId;
      readonly currentRuntimeMode: RuntimeMode;
      readonly currentInteractionMode: ProviderInteractionMode;
    }
  | {
      readonly kind: "draft";
      readonly projectId: ProjectId;
      readonly projectCwd: string;
      readonly envMode: DraftThreadEnvMode;
      readonly branch: string | null;
      readonly worktreePath: string | null;
      readonly startFromOrigin: boolean;
    };

export interface ComposerSendInput {
  readonly environmentId: EnvironmentId;
  readonly draftKey: string;
  readonly target: ComposerSendTarget;
  /** The prompt as the user wrote it (restored on failure, title seed). */
  readonly prompt: string;
  /** What goes on the wire (effort prefix applied). */
  readonly outgoingText: string;
  readonly attachments: ReadonlyArray<ComposerAttachmentDraft>;
  /** Diff and file comments the prompt references; they go out as message context records. */
  readonly reviewComments?: ReadonlyArray<ReviewCommentContext>;
  /** Terminal selections the prompt references; they go out as message context records too. */
  readonly terminalContexts?: ReadonlyArray<TerminalContextDraft>;
  /** Threads the prompt references (dropped on the composer); context records as well. */
  readonly threadContexts?: ReadonlyArray<ThreadContextRecord>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly dispatchMode: ComposerDispatchMode;
  /** Shown approvals a redirecting send declines first (web: approvalsToDecline). */
  readonly approvalsToDecline?: ReadonlyArray<ThreadPendingApproval>;
  readonly respondToApproval?: ApprovalResponder;
  /** The thread's pending approvals and those being answered, read live (web refs). */
  readonly readPendingApprovalIds?: () => ReadonlyArray<string>;
  readonly readRespondingApprovalIds?: () => ReadonlyArray<string>;
  /** Work still landing in the draft (a pasted image being prepared). */
  readonly readDraftBusy?: () => boolean;
  /** Implements a proposed plan (web: sourceProposedPlan). */
  readonly sourceProposedPlan?: { readonly threadId: ThreadId; readonly planId: string };
  /**
   * web ComposerSubmissionIntent "background": a draft starts its thread without opening it
   * (a fresh draft stays, "Started in background"); a thread opens a new draft in
   * `backgroundProjectId` once the send lands (send and new thread).
   */
  readonly background?: { readonly projectId: ProjectId | null };
  /** A run is in progress: a queued send waits behind it instead of showing in the timeline. */
  readonly running?: boolean;
  /**
   * web planComposerTurn compactBeforeSend: a stale Claude session runs /compact first and the
   * message queues behind it, so the turn does not re-read the old history.
   */
  readonly compactBeforeSend?: boolean;
}

export async function sendComposerMessage(input: ComposerSendInput): Promise<boolean> {
  const sendingAtom = composerSendingAtom(input.draftKey);
  if (appAtomRegistry.get(sendingAtom)) return false;
  appAtomRegistry.set(sendingAtom, true);
  appAtomRegistry.set(composerSendErrorAtom(input.draftKey), null);
  const snapshot = {
    prompt: input.prompt,
    attachments: input.attachments,
    reviewComments: input.reviewComments ?? [],
    terminalContexts: input.terminalContexts ?? [],
  };
  const messageContext = buildComposerMessageContext({
    terminalContexts: input.terminalContexts ?? [],
    reviewComments: input.reviewComments ?? [],
    threadContexts: input.threadContexts ?? [],
  });
  // web useComposerSend: a message sent over approvals declines them first, and only goes
  // out if it is still the message the user sent, no approval was already being answered,
  // and no new approval arrived meanwhile. Otherwise the draft stays for the next send.
  const approvalsToDecline = input.approvalsToDecline ?? [];
  if (approvalsToDecline.length > 0 && input.respondToApproval) {
    const attachmentIdsAtSend = input.attachments.map((attachment) => attachment.id).join("\n");
    // A paste still landing in the draft (an image being prepared) changes it too.
    const draftChangedSinceSend = () => {
      if (input.readDraftBusy?.()) return true;
      const live = readComposerDraft(input.draftKey);
      return live.prompt !== input.prompt || live.attachments.map((attachment) => attachment.id).join("\n") !== attachmentIdsAtSend;
    };
    const draftBeforeDecline = readComposerDraft(input.draftKey);
    const changedBeforeDecline = draftChangedSinceSend();
    const pendingIdsBeforeDecline = input.readPendingApprovalIds?.() ?? approvalsToDecline.map((approval) => approval.requestId);
    const responding = input.readRespondingApprovalIds?.() ?? [];
    const approvalResponding = approvalsToDecline.some((approval) => responding.includes(approval.requestId));
    const declined =
      !changedBeforeDecline &&
      !approvalResponding &&
      (await declinePendingApprovals(approvalsToDecline, input.respondToApproval).catch(() => false));
    // web compares the whole draft too: a context chip or model change during the decline is
    // an edit the user made after sending.
    const draftChanged = changedBeforeDecline || draftChangedSinceSend() || readComposerDraft(input.draftKey) !== draftBeforeDecline;
    const approvalArrived = (input.readPendingApprovalIds?.() ?? []).some((id) => !pendingIdsBeforeDecline.includes(id));
    if (!declined || draftChanged || approvalArrived) {
      appAtomRegistry.set(sendingAtom, false);
      const notice = approvalRedirectNotice({ draftChanged, declined, approvalResponding, approvalArrived });
      if (notice !== null) toast({ type: "info", title: notice, description: "Send again when it's ready." });
      else if (!declined) toast({ type: "error", title: "Couldn't decline the pending approval.", description: "Send again when it's ready." });
      return false;
    }
  }
  // Clear first, like web: the prompt leaves the composer the moment the user sends.
  clearComposerContent(input.draftKey);
  const createdAt = new Date().toISOString();
  const messageId = MessageId.make(newId());
  // web useComposerSend: the message shows in the thread at once, before uploads and the
  // server round trip; images preview from their local files until the server's copy lands.
  // A new thread's id is chosen here, so its first message can show before the server has it:
  // the draft docks into a thread-like view (web promotes the draft at once) and the thread's
  // timeline keeps the message until the server's copy arrives.
  const threadId = input.target.kind === "thread" ? input.target.threadId : ThreadId.make(newId());
  const showsPendingDraft = input.target.kind === "draft" && !input.background;
  const optimisticThreadKey =
    input.target.kind === "thread" || showsPendingDraft ? scopedThreadKey(scopeThreadRef(input.environmentId, threadId)) : null;
  const queuesBehind = input.compactBeforeSend === true || (input.running === true && input.dispatchMode === "queue");
  const optimisticMessage: ChatMessage = {
      id: messageId,
      role: "user",
      text: input.outgoingText,
      ...(input.attachments.length > 0
        ? {
            attachments: input.attachments.map((attachment) => ({
              type: attachment.type,
              id: attachment.id as never,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              ...(attachment.type === "image" ? { previewUrl: attachment.path } : {}),
            })),
          }
        : {}),
      ...(messageContext ? { context: messageContext } : {}),
      runId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
      ...(queuesBehind
        ? { inputIntent: "queued_turn" as const }
        : input.running && input.dispatchMode === "steer"
          ? { inputIntent: "steer" as const }
          : {}),
  };
  if (optimisticThreadKey !== null) addOptimisticMessage(optimisticThreadKey, optimisticMessage);
  if (showsPendingDraft) {
    appAtomRegistry.set(draftPendingSendAtom(input.draftKey), {
      threadId,
      message: optimisticMessage,
      title: deriveThreadTitleSeed({ text: input.prompt, attachments: input.attachments }),
    });
  }
  let failure: string | null = null;
  try {
    if (input.target.kind === "thread") {
      const { threadId } = input.target;
      if (input.runtimeMode !== input.target.currentRuntimeMode) {
        const result = await runAtomCommand(appAtomRegistry, threadEnvironment.setRuntimeMode, {
          environmentId: input.environmentId,
          input: { threadId, runtimeMode: input.runtimeMode, createdAt },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      }
      if (input.interactionMode !== input.target.currentInteractionMode) {
        const result = await runAtomCommand(appAtomRegistry, threadEnvironment.setInteractionMode, {
          environmentId: input.environmentId,
          input: { threadId, interactionMode: input.interactionMode, createdAt },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      }
    }
    // web planComposerTurn: a worktree draft with a worktree already picked (a previous
    // one) runs there; only a draft with no path creates one, and that needs a base branch.
    const shouldCreateWorktree =
      input.target.kind === "draft" && input.target.envMode === "worktree" && !input.target.worktreePath;
    if (shouldCreateWorktree && input.target.kind === "draft" && !input.target.branch) {
      throw new Error("Select a base branch before sending in New worktree mode.");
    }
    const attachments = await prepareTurnAttachments(input.environmentId, input.attachments);
    attachments.forEach((attachment, index) => {
      const local = input.attachments[index];
      if (local?.type === "image" && attachment.type === "image" && "id" in attachment && attachment.id) rememberSentImagePreview(attachment.id, local.path);
    });
    const title = deriveThreadTitleSeed({ text: input.prompt, attachments: input.attachments });
    const bootstrap =
      input.target.kind === "draft"
        ? {
            createThread: {
              projectId: input.target.projectId,
              title,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              branch: input.target.branch,
              worktreePath: input.target.worktreePath,
              createdAt,
            },
            ...(shouldCreateWorktree && input.target.branch
              ? {
                  prepareWorktree: {
                    projectCwd: input.target.projectCwd,
                    baseBranch: input.target.branch,
                    ...(input.target.startFromOrigin ? { startFromOrigin: true } : {}),
                  },
                  runSetupScript: true,
                }
              : {}),
          }
        : undefined;
    if (DEV_SEND_HOLD) await new Promise<never>(() => {});
    if (input.compactBeforeSend && input.target.kind === "thread") {
      const compact = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.startTurn,
        {
          environmentId: input.environmentId,
          input: {
            threadId,
            message: { messageId: MessageId.make(newId()), role: "user", text: "/compact", attachments: [] },
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            createdAt,
          } as never,
        },
        { reportFailure: false },
      );
      if (compact._tag === "Failure") throw squashAtomCommandFailure(compact);
    }
    const result = await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.startTurn,
      {
        environmentId: input.environmentId,
        input: {
          threadId,
          message: {
            messageId,
            role: "user",
            text: input.outgoingText,
            ...(messageContext ? { context: messageContext } : {}),
            attachments,
          },
          modelSelection: input.modelSelection,
          titleSeed: title,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          dispatchMode: input.compactBeforeSend ? "queue" : input.dispatchMode,
          ...(bootstrap ? { bootstrap } : {}),
          ...(input.sourceProposedPlan
            ? { sourceProposedPlan: input.sourceProposedPlan as never }
            : {}),
          createdAt,
        } as never,
      },
      { reportFailure: false },
    );
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        if (optimisticThreadKey !== null) removeOptimisticMessages(optimisticThreadKey, (message) => message.id === messageId);
        return false;
      }
      throw squashAtomCommandFailure(result);
    }
    // The turn owns the uploaded records now.
    forgetAttachmentUploads(input.attachments.map((attachment) => attachment.id));
    // A queued message waits in the queue control, never in the timeline.
    if (optimisticThreadKey !== null && queuesBehind) {
      removeOptimisticMessages(optimisticThreadKey, (message) => message.id === messageId);
    }
    if (input.background) {
      finishBackgroundSend(input.environmentId, input.target.kind, threadId, input.background.projectId);
    } else if (input.target.kind === "draft") {
      appAtomRegistry.set(routeAtom, { kind: "thread", environmentId: input.environmentId, threadId });
    }
    // A further draft of the project has become its thread; the first draft stays as the
    // project's empty new-thread composer.
    if (input.target.kind === "draft" && draftIdOfKey(input.draftKey) && !input.background) deleteComposerDraft(input.draftKey);
    return true;
  } catch (error) {
    failure = errorMessage(error);
    return false;
  } finally {
    appAtomRegistry.set(sendingAtom, false);
    if (showsPendingDraft) appAtomRegistry.set(draftPendingSendAtom(input.draftKey), null);
    if (failure !== null) {
      if (optimisticThreadKey !== null) removeOptimisticMessages(optimisticThreadKey, (message) => message.id === messageId);
      restoreComposerContent(input.draftKey, snapshot);
      appAtomRegistry.set(composerSendErrorAtom(input.draftKey), failure);
      toast({
        type: "error",
        title: input.target.kind === "draft" ? "Could not start thread" : "Failed to send message",
        description: failure,
      });
    }
  }
}

/** web useComposerSend after a background turn starts. */
function finishBackgroundSend(
  environmentId: EnvironmentId,
  targetKind: ComposerSendTarget["kind"],
  threadId: ThreadId,
  projectId: ProjectId | null,
): void {
  const openThread = () => appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId });
  if (targetKind === "draft") {
    // The draft route is the fresh composer: its content was cleared on send.
    toast({ type: "success", title: "Started in background", duration: 5000, action: { label: "Open", onClick: openThread } });
    return;
  }
  const route = appAtomRegistry.get(routeAtom);
  // Only when the user is still looking at the thread they sent from.
  if (projectId === null || route.kind !== "thread" || route.environmentId !== environmentId || route.threadId !== threadId) {
    return;
  }
  // handleNewThreadInActiveProject: the same new draft mod+N opens, model and mode carried over.
  startNewThread({ environmentId, projectId });
}

export async function interruptComposerTurn(environmentId: EnvironmentId, threadId: ThreadId): Promise<void> {
  const result = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.interruptTurn,
    { environmentId, input: { threadId, createdAt: new Date().toISOString() } as never },
    { reportFailure: false },
  );
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    toast({ type: "error", title: "Couldn't stop the turn", description: failureMessage(result) });
  }
}
