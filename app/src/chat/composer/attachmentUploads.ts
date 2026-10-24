// Staged attachments upload as soon as they are added, the way apps/web/src/lib/
// attachmentUploadQueue.ts does: the strip shows each item's progress, a failed one offers
// Retry, and the send uses the server's record instead of uploading again. Servers without
// upload support keep the old path (images inlined at send time).
//
// The bytes go out with node:http(s) rather than fetch: fetch has no upload progress, and a
// streamed fetch body has no Content-Length, which the upload endpoint may refuse.
import * as NodeFs from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";

import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  clampFileAttachmentUploadBytes,
  deletePendingAttachmentUpload,
  fileAttachmentTooLargeMessage,
  runAttachmentUploadCycle,
} from "@t3tools/client-runtime/state/attachments";
import {
  type ChatAttachment,
  type EnvironmentId,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
} from "@t3tools/contracts";
import { imageMimeType } from "@t3tools/shared/image";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { type ComposerAttachmentDraft, composerAttachmentEnvironment, composerDraftAtom } from "../../state/composer.ts";
import { environmentServerConfigsAtom, environmentSession } from "../../state/environment.ts";
import { DEV_UPLOAD_DELAY_MS, DEV_UPLOAD_FAIL } from "./devComposerAttachments.ts";

export type AttachmentUploadState =
  | { readonly status: "uploading"; readonly environmentId: EnvironmentId; readonly progress: number }
  | { readonly status: "ready"; readonly environmentId: EnvironmentId; readonly attachmentId: string }
  | { readonly status: "failed"; readonly environmentId: EnvironmentId; readonly reason: string };

/** Upload state by staged attachment id (the draft's local id). */
export const attachmentUploadStateAtom = Atom.family((_attachmentId: string) =>
  Atom.make<AttachmentUploadState | null>(null).pipe(Atom.keepAlive),
);

/**
 * web attachmentUploadBlockReason: the send waits for staged uploads. A failed one does not
 * block (the send retries it). The same text for every keystroke, so subscribers only
 * re-render when an upload starts or settles.
 */
export const stagedUploadBlockReasonAtom = Atom.family((draftKey: string) =>
  Atom.make((get): string | null => {
    let pending = 0;
    for (const attachment of get(composerDraftAtom(draftKey)).attachments) {
      const upload = get(attachmentUploadStateAtom(attachment.id));
      if (upload?.status === "failed") continue;
      if (upload?.status !== "ready") pending += 1;
    }
    if (pending === 0) return null;
    return pending === 1 ? "Attachment still uploading" : "Attachments still uploading";
  }),
);

interface InFlight {
  readonly environmentId: EnvironmentId;
  readonly promise: Promise<AttachmentUploadState>;
  abort: () => void;
  /** The server's pending record, once minted: released if the attachment is removed. */
  mintedId: string | null;
  cancelled: boolean;
}

const inFlight = new Map<string, InFlight>();

type SupportedImageMimeType = (typeof PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES)[number];

export function supportedImageWireMimeType(attachment: ComposerAttachmentDraft): SupportedImageMimeType {
  const inferred = imageMimeType(attachment);
  const mimeType = PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
    (type) => type === attachment.mimeType.toLowerCase() || type === inferred,
  );
  if (!mimeType) throw new Error(`Unsupported image type for '${attachment.name}'.`);
  return mimeType;
}

export function wireMimeType(attachment: ComposerAttachmentDraft): string {
  return attachment.type === "image" ? supportedImageWireMimeType(attachment) : attachment.mimeType;
}

function capabilities(environmentId: EnvironmentId) {
  return appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities;
}

/** The server takes attachment uploads (web supportsAttachmentUploads). */
export function environmentSupportsUploads(environmentId: EnvironmentId): boolean {
  return capabilities(environmentId)?.attachmentUploads === true;
}

/**
 * Why this attachment cannot go to this server at all, checked when it is staged (web
 * useComposerAttachmentIntake) so the user hears about it before the send.
 */
export function attachmentStagingError(environmentId: EnvironmentId, attachment: ComposerAttachmentDraft): string | null {
  if (attachment.type === "image") return null;
  const caps = capabilities(environmentId);
  if (caps?.attachmentUploads !== true || caps.fileAttachments === undefined) {
    return "This server does not support file attachments.";
  }
  if (attachment.sizeBytes <= 0) return `'${attachment.name}' is empty or could not be read.`;
  const maxBytes = clampFileAttachmentUploadBytes(caps.fileAttachments.maxUploadBytes);
  if (attachment.sizeBytes > maxBytes) return fileAttachmentTooLargeMessage(attachment.name, maxBytes);
  return null;
}

function setState(attachmentId: string, state: AttachmentUploadState | null): void {
  appAtomRegistry.set(attachmentUploadStateAtom(attachmentId), state);
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) return String((error as { message: unknown }).message);
  return fallback;
}

/** POSTs a file's bytes with a Content-Length, reporting how much has been written. */
function postFile(
  url: string,
  path: string,
  mimeType: string,
  sizeBytes: number,
  onProgress: (fraction: number) => void,
): { done: Promise<void>; abort: () => void } {
  let request: NodeHttp.ClientRequest | null = null;
  let aborted = false;
  const done = new Promise<void>((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? NodeHttps : NodeHttp;
    request = transport.request(
      target,
      { method: "POST", headers: { "Content-Type": mimeType, "Content-Length": String(sizeBytes) } },
      (response) => {
        response.resume();
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status >= 200 && status < 300) resolve();
          else reject(new Error(`Upload rejected (${status})`));
        });
      },
    );
    // web's XHR transport words: a socket error is just "Upload failed".
    request.on("error", () => reject(new Error(aborted ? "Upload cancelled" : "Upload failed")));
    if (DEV_UPLOAD_FAIL) {
      request.destroy();
      reject(new Error("Upload failed"));
      return;
    }
    const stream = NodeFs.createReadStream(path, { highWaterMark: 256 * 1024 });
    if (DEV_UPLOAD_DELAY_MS > 0) {
      stream.pause();
      setTimeout(() => stream.resume(), DEV_UPLOAD_DELAY_MS);
    }
    let sent = 0;
    // Written by hand rather than piped so progress counts what the socket took.
    stream.on("data", (chunk) => {
      sent += chunk.length;
      onProgress(sizeBytes > 0 ? sent / sizeBytes : 1);
      const flushed = request!.write(chunk);
      if (flushed && DEV_UPLOAD_DELAY_MS === 0) return;
      stream.pause();
      const resume = () => setTimeout(() => stream.resume(), DEV_UPLOAD_DELAY_MS);
      if (flushed) resume();
      else request!.once("drain", resume);
    });
    stream.on("end", () => request?.end());
    stream.on("error", (error) => {
      request?.destroy();
      reject(error);
    });
  });
  return {
    done,
    abort: () => {
      aborted = true;
      request?.destroy();
    },
  };
}

/**
 * Starts (or joins) the upload of a staged attachment to `environmentId`. Resolves with the
 * final state; never rejects.
 */
export function startAttachmentUpload(
  environmentId: EnvironmentId,
  attachment: ComposerAttachmentDraft,
): Promise<AttachmentUploadState> {
  const current = inFlight.get(attachment.id);
  if (current && current.environmentId === environmentId && !current.cancelled) return current.promise;
  const existing = appAtomRegistry.get(attachmentUploadStateAtom(attachment.id));
  if (existing?.status === "ready" && existing.environmentId === environmentId) return Promise.resolve(existing);

  setState(attachment.id, { status: "uploading", environmentId, progress: 0 });
  const entry: InFlight = {
    environmentId,
    promise: null as never,
    abort: () => {},
    mintedId: null,
    cancelled: false,
  };
  const run = async (): Promise<AttachmentUploadState> => {
    const stagingError = attachmentStagingError(environmentId, attachment);
    if (stagingError) return { status: "failed", environmentId, reason: stagingError };
    if (!NodeFs.existsSync(attachment.path)) {
      return { status: "failed", environmentId, reason: "Original file is no longer available" };
    }
    let mimeType: string;
    try {
      mimeType = wireMimeType(attachment);
    } catch {
      return { status: "failed", environmentId, reason: "Unsupported image type" };
    }
    const upload =
      attachment.type === "image"
        ? { name: attachment.name, sizeBytes: attachment.sizeBytes, mimeType: mimeType as SupportedImageMimeType }
        : { type: "file" as const, name: attachment.name, sizeBytes: attachment.sizeBytes, mimeType };
    let lastShown = 0;
    const result = await runAttachmentUploadCycle({
      registry: appAtomRegistry,
      createUploadUrl: composerAttachmentEnvironment.createUploadUrl,
      remove: composerAttachmentEnvironment.remove,
      environmentId,
      upload: upload as never,
      onMinted: (attachmentId) => {
        entry.mintedId = attachmentId;
        return entry.cancelled ? "cancel" : "continue";
      },
      resolveUploadUrl: (relativeUrl) => {
        const connection = appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId));
        return Option.isNone(connection) ? null : resolveAssetUrl(connection.value.httpBaseUrl, relativeUrl);
      },
      transport: (url) =>
        postFile(url, attachment.path, mimeType, attachment.sizeBytes, (fraction) => {
          // One state write per visible percent: the strip re-renders on each.
          const shown = Math.floor(fraction * 100);
          if (shown === lastShown || entry.cancelled) return;
          lastShown = shown;
          setState(attachment.id, { status: "uploading", environmentId, progress: fraction });
        }),
      onTransferStart: (abort) => {
        entry.abort = abort;
      },
    });
    if (result.status === "uploaded") return { status: "ready", environmentId, attachmentId: result.attachmentId };
    if (result.status === "cancelled") return { status: "failed", environmentId, reason: "Upload cancelled" };
    // web attachmentUploadQueue's reasons, shown in the Retry tooltip.
    return {
      status: "failed",
      environmentId,
      reason:
        result.step === "mint"
          ? "Upload could not start"
          : result.step === "resolve-url"
            ? "Not connected"
            : result.error instanceof Error
              ? result.error.message
              : "Upload failed",
    };
  };
  const promise = run().then(
    (state) => {
      if (inFlight.get(attachment.id) === entry) inFlight.delete(attachment.id);
      if (!entry.cancelled) setState(attachment.id, state);
      return state;
    },
    (error: unknown) => {
      if (inFlight.get(attachment.id) === entry) inFlight.delete(attachment.id);
      const state: AttachmentUploadState = { status: "failed", environmentId, reason: errorText(error, "Upload failed.") };
      if (!entry.cancelled) setState(attachment.id, state);
      return state;
    },
  );
  (entry as { promise: Promise<AttachmentUploadState> }).promise = promise;
  inFlight.set(attachment.id, entry);
  return promise;
}

/** web retryAttachmentUpload: a failed item goes again from the start. */
export function retryAttachmentUpload(environmentId: EnvironmentId, attachment: ComposerAttachmentDraft): void {
  const state = appAtomRegistry.get(attachmentUploadStateAtom(attachment.id));
  if (state?.status === "uploading") return;
  setState(attachment.id, null);
  void startAttachmentUpload(environmentId, attachment);
}

/**
 * A staged attachment was removed: stop its transfer and drop the server's pending record,
 * which no turn will reference now.
 */
export function releaseAttachmentUpload(attachmentId: string): void {
  const entry = inFlight.get(attachmentId);
  const state = appAtomRegistry.get(attachmentUploadStateAtom(attachmentId));
  if (entry) {
    entry.cancelled = true;
    entry.abort();
    inFlight.delete(attachmentId);
    if (entry.mintedId) {
      deletePendingAttachmentUpload({
        registry: appAtomRegistry,
        remove: composerAttachmentEnvironment.remove,
        environmentId: entry.environmentId,
        attachmentId: entry.mintedId,
      });
    }
  } else if (state?.status === "ready") {
    deletePendingAttachmentUpload({
      registry: appAtomRegistry,
      remove: composerAttachmentEnvironment.remove,
      environmentId: state.environmentId,
      attachmentId: state.attachmentId,
    });
  }
  setState(attachmentId, null);
}

/** After a send the turn owns the uploaded records; forget them without deleting. */
export function forgetAttachmentUploads(attachmentIds: ReadonlyArray<string>): void {
  for (const id of attachmentIds) {
    inFlight.delete(id);
    setState(id, null);
  }
}

/**
 * The turn attachment for a staged item: its finished upload, the one in flight, or a new
 * one (a failed item retries, as web's send does). Throws with the reason when it fails.
 */
export async function uploadedTurnAttachment(
  environmentId: EnvironmentId,
  attachment: ComposerAttachmentDraft,
): Promise<ChatAttachment> {
  const state = await startAttachmentUpload(environmentId, attachment);
  if (state.status !== "ready") {
    throw new Error(state.status === "failed" ? state.reason : `Upload failed for '${attachment.name}'.`);
  }
  const mimeType = wireMimeType(attachment);
  return attachment.type === "image"
    ? { type: "image", id: state.attachmentId as never, name: attachment.name, mimeType, sizeBytes: attachment.sizeBytes }
    : { type: "file", id: state.attachmentId as never, name: attachment.name, mimeType, sizeBytes: attachment.sizeBytes };
}
