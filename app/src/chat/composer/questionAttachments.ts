// Files attached to a pending question's answer (web questionAttachments.ts and the question
// half of usePendingThreadRequests): each question of a request has its own composer draft,
// whose attachments upload like any staged attachment and go out with the answers as
// `attachmentsByQuestionId`. Only where the server advertises `questionAttachments`.
import type { ChatAttachment, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerDraftAtom, composerDraftsAtom, deleteComposerDraft, readComposerDraft } from "../../state/composer.ts";
import { environmentServerConfigsAtom } from "../../state/environment.ts";
import { attachmentUploadStateAtom, forgetAttachmentUploads, releaseAttachmentUpload, wireMimeType } from "./attachmentUploads.ts";

function questionPrefix(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `question:${environmentId}:${threadId}:`;
}

export function questionAttachmentDraftKey(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  requestId: string,
  questionId: string,
): string {
  return `${questionPrefix(environmentId, threadId)}${encodeURIComponent(requestId)}:${encodeURIComponent(questionId)}`;
}

export function environmentSupportsQuestionAttachments(environmentId: EnvironmentId): boolean {
  return appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities.questionAttachments === true;
}

export interface QuestionAttachmentStatus {
  readonly count: number;
  /** web attachmentsBlocked: an upload still going (or failed) holds the answer back. */
  readonly blocked: boolean;
}

/**
 * Per question of one request, by a key of `environmentId|threadId|requestId|questionId,...`.
 * Returns the previous record while nothing changed, so the question card only re-renders
 * when an attachment or its upload does.
 */
export const questionAttachmentStatusAtom = Atom.family((key: string) =>
  Atom.make((get): Readonly<Record<string, QuestionAttachmentStatus>> => {
    const [environmentId, threadId, requestId, questionList] = key.split("|") as [EnvironmentId, ThreadId, string, string];
    const next: Record<string, QuestionAttachmentStatus> = {};
    for (const questionId of questionList ? questionList.split(",").map(decodeURIComponent) : []) {
      const attachments = get(composerDraftAtom(questionAttachmentDraftKey(environmentId, threadId, requestId, questionId))).attachments;
      next[questionId] = {
        count: attachments.length,
        blocked: attachments.some((attachment) => get(attachmentUploadStateAtom(attachment.id))?.status !== "ready"),
      };
    }
    const previous = get.self<Readonly<Record<string, QuestionAttachmentStatus>>>();
    if (previous._tag === "Some" && JSON.stringify(previous.value) === JSON.stringify(next)) return previous.value;
    return next;
  }),
);

export function questionAttachmentStatusKey(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  requestId: string,
  questionIds: ReadonlyArray<string>,
): string {
  return [environmentId, threadId, requestId, questionIds.map(encodeURIComponent).join(",")].join("|");
}

/**
 * The uploaded attachments of each question that has any, or a reason the answer cannot go
 * yet (web onRespondToUserInput's upload check).
 */
export function collectQuestionAttachments(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  requestId: string,
  questionIds: ReadonlyArray<string>,
): { readonly attachments: Record<string, ChatAttachment[]> } | { readonly error: string } {
  const attachments: Record<string, ChatAttachment[]> = {};
  for (const questionId of questionIds) {
    const staged = readComposerDraft(questionAttachmentDraftKey(environmentId, threadId, requestId, questionId)).attachments;
    if (staged.length === 0) continue;
    const uploaded: ChatAttachment[] = [];
    for (const attachment of staged) {
      const upload = appAtomRegistry.get(attachmentUploadStateAtom(attachment.id));
      if (upload?.status !== "ready" || upload.environmentId !== environmentId) {
        return { error: "Wait for attachments to finish uploading, or remove failed uploads." };
      }
      const mimeType = wireMimeType(attachment);
      uploaded.push(
        attachment.type === "image"
          ? { type: "image", id: upload.attachmentId as never, name: attachment.name, mimeType, sizeBytes: attachment.sizeBytes }
          : { type: "file", id: upload.attachmentId as never, name: attachment.name, mimeType, sizeBytes: attachment.sizeBytes },
      );
    }
    attachments[questionId] = uploaded;
  }
  return { attachments };
}

/** After the answer went out the request owns the uploads; drop the drafts. */
export function clearAnsweredQuestionAttachments(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  requestId: string,
  questionIds: ReadonlyArray<string>,
): void {
  for (const questionId of questionIds) {
    const key = questionAttachmentDraftKey(environmentId, threadId, requestId, questionId);
    forgetAttachmentUploads(readComposerDraft(key).attachments.map((attachment) => attachment.id));
    deleteComposerDraft(key);
  }
}

/** web: drafts of questions no longer pending (answered elsewhere, dismissed) are released. */
export function pruneQuestionAttachmentDrafts(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  retainedKeys: ReadonlySet<string>,
): void {
  const prefix = questionPrefix(environmentId, threadId);
  for (const key of Object.keys(appAtomRegistry.get(composerDraftsAtom))) {
    if (!key.startsWith(prefix) || retainedKeys.has(key)) continue;
    for (const attachment of readComposerDraft(key).attachments) releaseAttachmentUpload(attachment.id, attachment);
    deleteComposerDraft(key);
  }
}
