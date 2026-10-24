// "Edit from here" returns the message's attachments to the composer, like web
// chatViewSend.ts revertToTurn + ChatView.logic prepareRevertedMessageAttachments:
// the files are fetched before the rewind is committed (so a failure leaves the
// thread untouched), and the composer must have room for them. t3-term drafts
// read attachment bytes from a local path at send time, so each file is saved
// under $T3TERM_HOME/restored-attachments first.
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, type EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { termHome } from "../../runtime/paths.ts";
import { composerDraftAtom, type ComposerAttachmentDraft } from "../../state/composer.ts";
import { environmentSession } from "../../state/environment.ts";
import { timelineAssets } from "../../state/timeline.ts";
import { isImageAttachment, type ChatMessage } from "../../web/types.ts";

/** A file name safe on every platform, keeping the extension. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return cleaned.length > 0 ? cleaned.slice(-120) : "attachment";
}

export async function prepareRevertedMessageAttachments(input: {
  readonly message: ChatMessage;
  readonly environmentId: EnvironmentId;
  readonly draftKey: string;
}): Promise<ReadonlyArray<ComposerAttachmentDraft>> {
  const attachments = input.message.attachments ?? [];
  if (attachments.length === 0) return [];
  const draft = appAtomRegistry.get(composerDraftAtom(input.draftKey));
  if ((draft?.attachments.length ?? 0) + attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    throw new Error("Make room for this message's attachments in the composer before rewinding.");
  }
  const prepared = appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(input.environmentId));
  if (Option.isNone(prepared)) throw new Error("The environment is not connected.");
  const httpBaseUrl = prepared.value.httpBaseUrl;
  const folder = NodePath.join(termHome(), "restored-attachments", crypto.randomUUID());
  const restored = await Promise.all(
    attachments.map(async (attachment, index): Promise<ComposerAttachmentDraft> => {
      if (attachment.type !== "image" && attachment.type !== "file") {
        throw new Error("This message has an attachment that cannot be restored.");
      }
      const { id, name, mimeType } = attachment as { id: string; name: string; mimeType: string };
      const result = await executeAtomQuery(
        appAtomRegistry,
        timelineAssets.createUrl({
          environmentId: input.environmentId,
          input: { resource: { _tag: "attachment", attachmentId: id, fileName: name, mimeType } },
        } as never) as never,
        { label: "restore attachment", reportFailure: false },
      );
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const url = resolveAssetUrl(httpBaseUrl, (result.value as { relativeUrl: string }).relativeUrl);
      if (url === null) throw new Error("The environment returned an invalid attachment URL.");
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Could not restore attachment: ${name}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // One folder per rewind, one subfolder per attachment, so equal names never collide.
      const path = NodePath.join(folder, String(index), safeFileName(name));
      NodeFs.mkdirSync(NodePath.dirname(path), { recursive: true });
      NodeFs.writeFileSync(path, bytes);
      return {
        id: crypto.randomUUID(),
        type: isImageAttachment(attachment) ? "image" : "file",
        name,
        mimeType,
        sizeBytes: bytes.byteLength,
        path,
      };
    }),
  );
  // web revertToTurn checks the live draft again: attachments added while these
  // downloaded could leave the restored draft over the limit.
  const live = appAtomRegistry.get(composerDraftAtom(input.draftKey));
  if ((live?.attachments.length ?? 0) + restored.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    NodeFs.rmSync(folder, { recursive: true, force: true });
    throw new Error("Make room for this message's attachments in the composer before rewinding.");
  }
  return restored;
}
