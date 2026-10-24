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
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  clampFileAttachmentUploadBytes,
  fileAttachmentTooLargeMessage,
  runAttachmentUploadCycle,
} from "@t3tools/client-runtime/state/attachments";
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
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  ThreadId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { imageMimeType } from "@t3tools/shared/image";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  type ComposerAttachmentDraft,
  type DraftThreadEnvMode,
  clearComposerContent,
  composerAttachmentEnvironment,
  restoreComposerContent,
} from "../../state/composer.ts";
import { buildComposerMessageContext } from "../../web/lib/composerContextRecords.ts";
import type { TerminalContextDraft } from "../../web/lib/terminalContext.ts";
import type { ReviewCommentContext } from "../../web/reviewCommentContext.ts";
import {
  environmentServerConfigsAtom,
  environmentSession,
  threadEnvironment,
} from "../../state/environment.ts";
import { routeAtom } from "../../state/ui.ts";
import { startNewThread } from "../../palette/actions.ts";
import { toast } from "../../ui/toast.tsx";

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

type SupportedImageMimeType = (typeof PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES)[number];

function supportedImageWireMimeType(attachment: ComposerAttachmentDraft): SupportedImageMimeType {
  const inferred = imageMimeType(attachment);
  const mimeType = PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
    (type) => type === attachment.mimeType.toLowerCase() || type === inferred,
  );
  if (!mimeType) throw new Error(`Unsupported image type for '${attachment.name}'.`);
  return mimeType;
}

function wireMimeType(attachment: ComposerAttachmentDraft): string {
  return attachment.type === "image" ? supportedImageWireMimeType(attachment) : attachment.mimeType;
}

async function readDataUrl(attachment: ComposerAttachmentDraft): Promise<string> {
  const bytes = await Bun.file(attachment.path).arrayBuffer();
  return `data:${wireMimeType(attachment)};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * The attachments a turn sends: the server's upload records when it takes uploads (the
 * client-runtime upload cycle, bytes POSTed from disk), otherwise images inlined as data URLs.
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
    if (!NodeFs.existsSync(attachment.path)) {
      throw new Error(`'${attachment.name}' is no longer on disk. Remove it and attach it again.`);
    }
  }
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null;
  const capabilities = config?.environment.capabilities;
  const supportsUploads = capabilities?.attachmentUploads === true;
  const files = attachments.filter((attachment) => attachment.type === "file");
  if (files.length > 0) {
    if (!supportsUploads || capabilities?.fileAttachments === undefined) {
      throw new Error("This server does not support file attachments.");
    }
    const maxBytes = clampFileAttachmentUploadBytes(capabilities.fileAttachments.maxUploadBytes);
    const oversized = files.find((file) => file.sizeBytes > maxBytes);
    if (oversized) throw new Error(fileAttachmentTooLargeMessage(oversized.name, maxBytes));
  }
  if (!supportsUploads) {
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

  const uploaded: Array<ChatAttachment> = [];
  for (const attachment of attachments) {
    const mimeType = wireMimeType(attachment);
    const upload =
      attachment.type === "image"
        ? {
            name: attachment.name,
            sizeBytes: attachment.sizeBytes,
            mimeType: supportedImageWireMimeType(attachment),
          }
        : { type: "file" as const, name: attachment.name, sizeBytes: attachment.sizeBytes, mimeType };
    const result = await runAttachmentUploadCycle({
      registry: appAtomRegistry,
      createUploadUrl: composerAttachmentEnvironment.createUploadUrl,
      remove: composerAttachmentEnvironment.remove,
      environmentId,
      upload,
      resolveUploadUrl: (relativeUrl) => {
        const current = appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId));
        return Option.isNone(current) ? null : resolveAssetUrl(current.value.httpBaseUrl, relativeUrl);
      },
      transport: (url) => {
        const controller = new AbortController();
        return {
          done: (async () => {
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": mimeType },
              body: Bun.file(attachment.path),
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(`Upload failed for '${attachment.name}' (${response.status}).`);
            }
          })(),
          abort: () => controller.abort(),
        };
      },
    });
    if (result.status !== "uploaded") {
      throw result.status === "failed" && result.error !== undefined
        ? result.error
        : new Error(`Upload failed for '${attachment.name}'.`);
    }
    uploaded.push(
      attachment.type === "image"
        ? {
            type: "image",
            id: result.attachmentId as never,
            name: attachment.name,
            mimeType,
            sizeBytes: attachment.sizeBytes,
          }
        : {
            type: "file",
            id: result.attachmentId as never,
            name: attachment.name,
            mimeType,
            sizeBytes: attachment.sizeBytes,
          },
    );
  }
  return uploaded;
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
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly dispatchMode: ComposerDispatchMode;
  /** Shown approvals a redirecting send declines first (web: approvalsToDecline). */
  readonly approvalsToDecline?: ReadonlyArray<ThreadPendingApproval>;
  readonly respondToApproval?: ApprovalResponder;
  /** Implements a proposed plan (web: sourceProposedPlan). */
  readonly sourceProposedPlan?: { readonly threadId: ThreadId; readonly planId: string };
  /**
   * web ComposerSubmissionIntent "background": a draft starts its thread without opening it
   * (a fresh draft stays, "Started in background"); a thread opens a new draft in
   * `backgroundProjectId` once the send lands (send and new thread).
   */
  readonly background?: { readonly projectId: ProjectId | null };
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
  });
  // Clear first, like web: the prompt leaves the composer the moment the user sends.
  clearComposerContent(input.draftKey);
  const createdAt = new Date().toISOString();
  let failure: string | null = null;
  try {
    if (input.approvalsToDecline && input.approvalsToDecline.length > 0 && input.respondToApproval) {
      const declined = await declinePendingApprovals(input.approvalsToDecline, input.respondToApproval);
      if (!declined) throw new Error("Couldn't decline the pending approval. Send again when it's ready.");
    }
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
    const attachments = await prepareTurnAttachments(input.environmentId, input.attachments);
    const title = deriveThreadTitleSeed({ text: input.prompt, attachments: input.attachments });
    const threadId =
      input.target.kind === "thread" ? input.target.threadId : ThreadId.make(newId());
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
              worktreePath: input.target.envMode === "worktree" ? null : input.target.worktreePath,
              createdAt,
            },
            ...(input.target.envMode === "worktree" && input.target.branch
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
    const result = await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.startTurn,
      {
        environmentId: input.environmentId,
        input: {
          threadId,
          message: {
            messageId: MessageId.make(newId()),
            role: "user",
            text: input.outgoingText,
            ...(messageContext ? { context: messageContext } : {}),
            attachments,
          },
          modelSelection: input.modelSelection,
          titleSeed: title,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          dispatchMode: input.dispatchMode,
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
      if (isAtomCommandInterrupted(result)) return false;
      throw squashAtomCommandFailure(result);
    }
    if (input.background) {
      finishBackgroundSend(input.environmentId, input.target.kind, threadId, input.background.projectId);
    } else if (input.target.kind === "draft") {
      appAtomRegistry.set(routeAtom, { kind: "thread", environmentId: input.environmentId, threadId });
    }
    return true;
  } catch (error) {
    failure = errorMessage(error);
    return false;
  } finally {
    appAtomRegistry.set(sendingAtom, false);
    if (failure !== null) {
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
