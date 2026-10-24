// What an attachment's inline chip shows after its name (web composerContextPresentation
// ImageContextChip / FileContextChip): the size in text-3xs, then the upload's progress,
// "upload failed", or "attach again" for a file whose bytes are gone. The editor's layout
// sizes the chip box from the same strings, so they live here, outside the chip view.
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { Atom } from "effect/reactivity";

import { type AttachmentUploadState, attachmentUploadStateAtom } from "../attachmentUploads.ts";

/** A staged attachment as its chip needs it, by its context id (`file_<id>` / `image_<id>`). */
export interface ComposerChipAttachment {
  readonly id: string;
  readonly type: "image" | "file";
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Local file the image thumbnail is drawn from. */
  readonly path: string;
  /** web composerFileNeedsReattach: the bytes are gone and nothing was uploaded. */
  readonly needsReattach: boolean;
  /** Uploads run for this server, so the chip reports them. */
  readonly tracksUpload: boolean;
}

/** web formatAttachmentUploadProgress. */
export function formatAttachmentUploadProgress(progress: number): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return `${Math.floor(bounded * 100)}%`;
}

/** web uploadStatusSuffix, with FileContextChip's "attach again" first. */
export function attachmentChipSuffix(attachment: ComposerChipAttachment, upload: AttachmentUploadState | null): string | null {
  if (attachment.type === "file" && attachment.needsReattach) return "attach again";
  if (!attachment.tracksUpload) return null;
  if (upload?.status === "uploading") return formatAttachmentUploadProgress(upload.progress);
  if (upload?.status === "failed") return "upload failed";
  return null;
}

export function attachmentChipSize(attachment: Pick<ComposerChipAttachment, "sizeBytes">): string {
  return formatAttachmentSize(attachment.sizeBytes);
}

/** web attachmentTooltip: name and size, then the failure's reason after a blank line. */
export function attachmentChipTooltip(attachment: ComposerChipAttachment, upload: AttachmentUploadState | null): string {
  if (attachment.type === "file" && attachment.needsReattach) {
    return `${attachment.name} was not saved with this draft. Attach it again to send it.`;
  }
  const lines = [attachment.name, attachmentChipSize(attachment)];
  if (attachment.tracksUpload && upload?.status === "failed") lines.push("", upload.reason);
  return lines.join("\n");
}

/** web text-3xs: the size and status after an attachment's name. */
export const ATTACHMENT_CHIP_TRAILING_FONT_SIZE = 10;

// ── Chip widths ─────────────────────────────────────────────────────────
// The editor lays chips out without React, so the trailing text of each attachment chip is
// published here by the mounted composer (keyed by context id), and the editor relayouts
// when its key changes.

let trailingByContextId: ReadonlyMap<string, ReadonlyArray<string>> = new Map();
let trailingKey = "";

/** The size and status strings an attachment chip draws after its name. */
export function attachmentChipTrailing(contextId: string): ReadonlyArray<string> {
  return trailingByContextId.get(contextId) ?? [];
}

/**
 * Publishes the trailing strings of the staged attachments' chips; returns a key that
 * changes with them, for the editor's layout cache.
 */
export function publishAttachmentChipTrailing(entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): string {
  const key = JSON.stringify(entries);
  if (key !== trailingKey) {
    trailingKey = key;
    trailingByContextId = new Map(entries);
  }
  return key;
}

/**
 * The trailing strings for a set of staged attachments, as one string that only changes when
 * a chip's text does (an upload's 5% step), so subscribers re-render that often and no more.
 */
export const attachmentChipTrailingAtom = Atom.family((spec: string) =>
  Atom.make((get): string => {
    const attachments = JSON.parse(spec) as ReadonlyArray<readonly [string, ComposerChipAttachment]>;
    return JSON.stringify(
      attachments.map(([contextId, attachment]) => {
        const upload = attachment.tracksUpload ? get(attachmentUploadStateAtom(attachment.id)) : null;
        const suffix = attachmentChipSuffix(attachment, upload);
        return [contextId, suffix ? [attachmentChipSize(attachment), suffix] : [attachmentChipSize(attachment)]] as const;
      }),
    );
  }),
);
