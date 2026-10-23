// Local paths (picker, file drop) → composer draft attachments. Images by extension go up as
// images; everything else as files (web composerAttachmentFiles + the desktop file picker).
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import type { ComposerAttachmentDraft } from "../../state/composer.ts";

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const FILE_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  svg: "image/svg+xml",
  zip: "application/zip",
};

/** Draft attachments for local paths; folders are skipped (web inserts them as @mentions). */
export function attachmentsFromPaths(paths: ReadonlyArray<string>): {
  attachments: ComposerAttachmentDraft[];
  folders: string[];
} {
  const attachments: ComposerAttachmentDraft[] = [];
  const folders: string[] = [];
  for (const path of paths) {
    let stat: NodeFs.Stats;
    try {
      stat = NodeFs.statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      folders.push(path);
      continue;
    }
    const name = NodePath.basename(path);
    const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    const imageMime = IMAGE_MIME_BY_EXTENSION[extension];
    attachments.push({
      id: globalThis.crypto.randomUUID(),
      type: imageMime ? "image" : "file",
      name,
      mimeType: imageMime ?? FILE_MIME_BY_EXTENSION[extension] ?? (stat.size < 2_000_000 ? "text/plain" : "application/octet-stream"),
      sizeBytes: stat.size,
      path,
    });
  }
  return { attachments, folders };
}

