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
  verifyPersistedAttachmentUpload,
} from "@t3tools/client-runtime/state/attachments";
import {
  type ChatAttachment,
  type EnvironmentId,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
} from "@t3tools/contracts";
import { imageMimeType } from "@t3tools/shared/image";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  type ComposerAttachmentDraft,
  composerAttachmentEnvironment,
  composerDraftAtom,
  composerDraftsAtom,
  updateComposerDraft,
} from "../../state/composer.ts";
import { timelineAssets } from "../../state/timeline.ts";
import { environmentCatalog, environmentServerConfigsAtom, environmentSession } from "../../state/environment.ts";
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
  readonly attachment: ComposerAttachmentDraft;
  readonly promise: Promise<AttachmentUploadState>;
  readonly settle: (state: AttachmentUploadState) => void;
  abort: () => void;
  /** The server's pending record, once minted: released if the attachment is removed. */
  mintedId: string | null;
  cancelled: boolean;
  started: boolean;
}

const inFlight = new Map<string, InFlight>();

/**
 * web attachmentUploadQueue MAX_UPLOADS_PER_ENVIRONMENT: at most three transfers (or checks
 * of an upload kept from an earlier run) per server at a time; the rest wait their turn and
 * show 0% meanwhile.
 */
const MAX_UPLOADS_PER_ENVIRONMENT = 3;
const queue: InFlight[] = [];
const activeUploadsByEnvironment = new Map<EnvironmentId, number>();

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
  // web fileAttachmentStagingLimit: before the server's capabilities arrive, a file is held to
  // the protocol's own limit rather than refused; the send waits for the server anyway.
  if (caps !== undefined && (caps.attachmentUploads !== true || caps.fileAttachments === undefined)) {
    return "This server does not support file attachments.";
  }
  if (attachment.sizeBytes <= 0) return `'${attachment.name}' is empty or could not be read.`;
  const maxBytes = caps?.fileAttachments
    ? clampFileAttachmentUploadBytes(caps.fileAttachments.maxUploadBytes)
    : PROVIDER_SEND_TURN_MAX_FILE_BYTES;
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
 * web stampDraftFileUpload: a file's finished upload is written onto the draft that holds it,
 * so the next run sends that server copy instead of uploading the bytes again. Every draft
 * holding the attachment, not just the mounted composer's: the user may have moved on.
 * Images are not stamped, as on web (its images re-upload after a reload).
 */
function stampDraftFileUpload(attachmentId: string, environmentId: EnvironmentId, uploadedAttachmentId: string | null): void {
  for (const [key, draft] of Object.entries(appAtomRegistry.get(composerDraftsAtom))) {
    const staged = draft.attachments.find((attachment) => attachment.id === attachmentId);
    if (!staged || staged.type !== "file") continue;
    const unchanged =
      uploadedAttachmentId === null
        ? staged.uploadedAttachmentId === undefined
        : staged.uploadedAttachmentId === uploadedAttachmentId && staged.uploadEnvironmentId === environmentId;
    if (unchanged) continue;
    updateComposerDraft(key, (current) => ({
      ...current,
      attachments: current.attachments.map((attachment) => {
        if (attachment.id !== attachmentId) return attachment;
        if (uploadedAttachmentId !== null) return { ...attachment, uploadedAttachmentId, uploadEnvironmentId: environmentId };
        const { uploadedAttachmentId: _id, uploadEnvironmentId: _environment, ...rest } = attachment;
        return rest;
      }),
    }));
  }
}

/** The upload a file kept from an earlier run, if it was made on this server. */
function persistedUploadId(attachment: ComposerAttachmentDraft, environmentId: EnvironmentId): string | null {
  return attachment.type === "file" && attachment.uploadEnvironmentId === environmentId && attachment.uploadedAttachmentId
    ? attachment.uploadedAttachmentId
    : null;
}

async function runUpload(entry: InFlight): Promise<AttachmentUploadState> {
  const { environmentId } = entry;
  // The draft's copy, which carries a stamp written after this upload was first queued.
  const attachment =
    Object.values(appAtomRegistry.get(composerDraftsAtom))
      .flatMap((draft) => draft.attachments)
      .find((candidate) => candidate.id === entry.attachment.id) ?? entry.attachment;
  // web runUpload: a kept upload is checked first. Pending uploads are swept after a day, so
  // a missing one uploads again from the local file; a check that fails leaves it for Retry.
  const persistedId = persistedUploadId(attachment, environmentId);
  if (persistedId !== null) {
    const verification = await verifyPersistedAttachmentUpload({
      registry: appAtomRegistry,
      createAssetUrl: timelineAssets.createUrl,
      environmentId,
      attachmentId: persistedId,
    });
    if (entry.cancelled) return { status: "failed", environmentId, reason: "Upload cancelled" };
    if (verification.status === "verified") return { status: "ready", environmentId, attachmentId: persistedId };
    const localFileExists = NodeFs.existsSync(attachment.path);
    if (verification.status === "missing" && !localFileExists) {
      // web markFileUploadMissing: nothing is left to send; the item asks to be attached again.
      stampDraftFileUpload(attachment.id, environmentId, null);
      return { status: "failed", environmentId, reason: "Uploaded file expired. Remove it and attach it again." };
    }
    if (verification.status === "failed") {
      return { status: "failed", environmentId, reason: "Uploaded file could not be verified. Retry when the server reconnects." };
    }
  }
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
  let lastStep = 0;
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
      if (entry.cancelled) return null;
      const connection = appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId));
      return Option.isNone(connection) ? null : resolveAssetUrl(connection.value.httpBaseUrl, relativeUrl);
    },
    transport: (url) =>
      postFile(url, attachment.path, mimeType, attachment.sizeBytes, (fraction) => {
        // web: one state write per 5% step; each one re-renders (and re-lays out) the chip.
        const step = Math.floor(fraction * 20);
        if (step === lastStep || entry.cancelled) return;
        lastStep = step;
        setState(attachment.id, { status: "uploading", environmentId, progress: fraction });
      }),
    onTransferStart: (abort) => {
      entry.abort = abort;
    },
  });
  if (result.status === "uploaded") {
    if (!entry.cancelled) stampDraftFileUpload(attachment.id, environmentId, result.attachmentId);
    return { status: "ready", environmentId, attachmentId: result.attachmentId };
  }
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
}

/**
 * web startAttachmentUpload's connection watch: an upload that failed (often because the
 * socket was still connecting, or dropped mid-transfer) goes again by itself when its server
 * reconnects, as long as the item is still staged and still failed.
 */
const failedUploads = new Map<string, { readonly environmentId: EnvironmentId; readonly attachment: ComposerAttachmentDraft }>();
const connectionWatches = new Map<EnvironmentId, () => void>();

function isConnected(environmentId: EnvironmentId): boolean {
  return Option.exists(
    AsyncResult.value(appAtomRegistry.get(environmentCatalog.stateAtom(environmentId))),
    (state) => state.phase === "connected",
  );
}

function watchConnection(environmentId: EnvironmentId): void {
  if (connectionWatches.has(environmentId)) return;
  let wasConnected = isConnected(environmentId);
  const stop = appAtomRegistry.subscribe(environmentCatalog.stateAtom(environmentId), () => {
    const connected = isConnected(environmentId);
    const reconnected = connected && !wasConnected;
    wasConnected = connected;
    if (!reconnected) return;
    for (const [attachmentId, failed] of [...failedUploads]) {
      if (failed.environmentId !== environmentId) continue;
      if (appAtomRegistry.get(attachmentUploadStateAtom(attachmentId))?.status !== "failed") {
        failedUploads.delete(attachmentId);
        continue;
      }
      retryAttachmentUpload(environmentId, failed.attachment);
    }
  });
  connectionWatches.set(environmentId, stop);
}

/** web pumpUploads: starts queued uploads while their server has a free slot. */
function pumpUploads(): void {
  for (let index = 0; index < queue.length; ) {
    const entry = queue[index]!;
    const active = activeUploadsByEnvironment.get(entry.environmentId) ?? 0;
    if (active >= MAX_UPLOADS_PER_ENVIRONMENT) {
      index += 1;
      continue;
    }
    queue.splice(index, 1);
    if (entry.cancelled) continue;
    entry.started = true;
    activeUploadsByEnvironment.set(entry.environmentId, active + 1);
    void runUpload(entry)
      .catch(
        (error: unknown): AttachmentUploadState => ({
          status: "failed",
          environmentId: entry.environmentId,
          reason: errorText(error, "Upload failed."),
        }),
      )
      .then((state) => {
        const remaining = (activeUploadsByEnvironment.get(entry.environmentId) ?? 1) - 1;
        if (remaining > 0) activeUploadsByEnvironment.set(entry.environmentId, remaining);
        else activeUploadsByEnvironment.delete(entry.environmentId);
        entry.settle(state);
        pumpUploads();
      });
  }
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
  if (current) cancelInFlight(current);
  const existing = appAtomRegistry.get(attachmentUploadStateAtom(attachment.id));
  if (existing?.status === "ready" && existing.environmentId === environmentId) return Promise.resolve(existing);

  setState(attachment.id, { status: "uploading", environmentId, progress: 0 });
  let settle: (state: AttachmentUploadState) => void = () => {};
  const settled = new Promise<AttachmentUploadState>((resolve) => {
    settle = resolve;
  });
  const entry: InFlight = {
    environmentId,
    attachment,
    promise: null as never,
    settle: (state) => settle(state),
    abort: () => {},
    mintedId: null,
    cancelled: false,
    started: false,
  };
  (entry as { promise: Promise<AttachmentUploadState> }).promise = settled.then((state) => {
    if (inFlight.get(attachment.id) === entry) inFlight.delete(attachment.id);
    if (!entry.cancelled) {
      setState(attachment.id, state);
      if (state.status === "failed") failedUploads.set(attachment.id, { environmentId, attachment });
      else failedUploads.delete(attachment.id);
    }
    return state;
  });
  watchConnection(environmentId);
  inFlight.set(attachment.id, entry);
  queue.push(entry);
  pumpUploads();
  return entry.promise;
}

/** web retryAttachmentUpload: a failed item goes again from the start. */
export function retryAttachmentUpload(environmentId: EnvironmentId, attachment: ComposerAttachmentDraft): void {
  const state = appAtomRegistry.get(attachmentUploadStateAtom(attachment.id));
  if (state?.status === "uploading") return;
  setState(attachment.id, null);
  void startAttachmentUpload(environmentId, attachment);
}

/** Stops a transfer (or takes it out of the queue) without touching what the server holds. */
function cancelInFlight(entry: InFlight): void {
  entry.cancelled = true;
  entry.abort();
  if (inFlight.get(entry.attachment.id) === entry) inFlight.delete(entry.attachment.id);
  const queued = queue.indexOf(entry);
  if (queued !== -1) {
    queue.splice(queued, 1);
    entry.settle({ status: "failed", environmentId: entry.environmentId, reason: "Upload cancelled" });
  }
}

function deleteUpload(environmentId: EnvironmentId, attachmentId: string): void {
  deletePendingAttachmentUpload({
    registry: appAtomRegistry,
    remove: composerAttachmentEnvironment.remove,
    environmentId,
    attachmentId,
  });
}

/**
 * A staged attachment was removed: stop its transfer and drop the server's pending record,
 * which no turn will reference now. web releaseDraftAttachment: a file's upload kept from an
 * earlier run may only be known to the draft, so the removed attachment is passed in.
 */
export function releaseAttachmentUpload(attachmentId: string, removed?: ComposerAttachmentDraft): void {
  const entry = inFlight.get(attachmentId);
  const state = appAtomRegistry.get(attachmentUploadStateAtom(attachmentId));
  const released = new Set<string>();
  const release = (environmentId: EnvironmentId, serverId: string) => {
    const key = `${environmentId}:${serverId}`;
    if (released.has(key)) return;
    released.add(key);
    deleteUpload(environmentId, serverId);
  };
  if (entry) {
    cancelInFlight(entry);
    if (entry.mintedId) release(entry.environmentId, entry.mintedId);
  } else if (state?.status === "ready") {
    release(state.environmentId, state.attachmentId);
  }
  if (removed?.type === "file" && removed.uploadedAttachmentId && removed.uploadEnvironmentId) {
    release(removed.uploadEnvironmentId, removed.uploadedAttachmentId);
  }
  failedUploads.delete(attachmentId);
  setState(attachmentId, null);
}

/** After a send the turn owns the uploaded records; forget them without deleting. */
export function forgetAttachmentUploads(attachmentIds: ReadonlyArray<string>): void {
  for (const id of attachmentIds) {
    const entry = inFlight.get(id);
    if (entry && !entry.started) cancelInFlight(entry);
    inFlight.delete(id);
    failedUploads.delete(id);
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
