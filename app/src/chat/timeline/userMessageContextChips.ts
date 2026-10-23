// apps/web/src/components/chat/UserMessageContextChips.tsx: the chip each
// `t3-context:` reference in a sent message renders as (file mention, skill,
// thread, image, file, terminal excerpt, browser element, review comment,
// preview annotation), or the dashed "no longer available" chip. Web opens
// popovers with the element, comment and annotation details; here the chip
// carries a tooltip with the same summary.
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import type { ComposerContextRecord, EnvironmentId, ThreadId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { rightPanelActions, threadKeyOf } from "../../state/rightPanel.ts";
import { routeAtom } from "../../state/ui.ts";
import { SKILL_CHIP_ICON_SVG } from "../markdown/chipIcons.ts";
import type { ChipPayload } from "../markdown/MarkdownChips.tsx";
import { openExpandedImage } from "../markdown/MarkdownMedia.tsx";
import { asKnownContextRecord } from "../../web/lib/userMessageContext.ts";

/** composerInlineChip.ts middleTruncateAttachmentName */
export function middleTruncateAttachmentName(name: string, maxCharacters = 36): string {
  const characters = Array.from(name);
  if (characters.length <= maxCharacters) return name;
  if (maxCharacters <= 0) return "";
  if (maxCharacters === 1) return "…";
  const available = maxCharacters - 1;
  const suffixLength = Math.min(available - 1, available >= 18 ? 14 : Math.ceil(available / 2));
  const prefixLength = available - suffixLength;
  const suffix = suffixLength === 0 ? "" : characters.slice(-suffixLength).join("");
  return `${characters.slice(0, prefixLength).join("")}…${suffix}`;
}

export interface ContextChipEnvironment {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string | undefined;
  readonly recordsById: ReadonlyMap<string, ComposerContextRecord>;
  /** Image attachment URLs by attachment id, for the image viewer. */
  readonly imageUrls: ReadonlyMap<string, string>;
}

function unavailable(label: string): ChipPayload {
  return {
    type: "chip",
    kind: "neutral",
    label,
    icon: { kind: "lucide", name: "circle-dashed" },
    tooltip: "This context is no longer available.",
    dashed: true,
  };
}

export function userMessageContextChip(
  reference: { readonly kind: string; readonly contextId: string; readonly label: string },
  context: ContextChipEnvironment,
): ChipPayload {
  const record = asKnownContextRecord(context.recordsById.get(reference.contextId));
  if (!record || record.kind !== reference.kind) return unavailable(reference.label);
  switch (record.kind) {
    case "mention":
      return {
        type: "chip",
        kind: "mention",
        label: record.label,
        icon: { kind: "file", path: record.path },
        tooltip: record.path,
        fileMetadata: { environmentId: context.environmentId, path: record.path, cwd: context.workspaceRoot },
        onActivate: () => rightPanelActions.openFile(threadKeyOf(context.environmentId, context.threadId), record.path),
      };
    case "skill":
      return {
        type: "chip",
        kind: "skill",
        label: record.label || record.name,
        icon: { kind: "svg", source: SKILL_CHIP_ICON_SVG },
        tooltip: `$${record.name}`,
      };
    case "thread":
      return {
        type: "chip",
        kind: "thread",
        label: record.title,
        icon: { kind: "lucide", name: "messages-square" },
        tooltip: "Open thread",
        threadRef: { environmentId: record.environmentId, threadId: record.threadId },
        onActivate: () => appAtomRegistry.set(routeAtom, { kind: "thread", environmentId: record.environmentId, threadId: record.threadId }),
      };
    case "image": {
      const url = context.imageUrls.get(record.attachmentId);
      return {
        type: "chip",
        kind: "image",
        label: middleTruncateAttachmentName(record.name),
        suffix: formatAttachmentSize(record.sizeBytes),
        icon: { kind: "lucide", name: "image" },
        tooltip: `${record.name}\n${formatAttachmentSize(record.sizeBytes)}`,
        ...(url ? { onActivate: () => openExpandedImage({ images: [{ src: url, name: record.name }], index: 0 }) } : {}),
      };
    }
    case "file": {
      const video = record.mimeType.startsWith("video/");
      return {
        type: "chip",
        kind: video ? "video" : "file",
        label: middleTruncateAttachmentName(record.name),
        suffix: formatAttachmentSize(record.sizeBytes),
        icon: video ? { kind: "lucide", name: "film" } : { kind: "file", path: record.name },
        tooltip: `${record.name}\n${formatAttachmentSize(record.sizeBytes)}`,
      };
    }
    case "terminal":
      return {
        type: "chip",
        kind: "terminal",
        label: record.label,
        icon: { kind: "lucide", name: "terminal" },
        tooltip: `${record.terminalLabel} · lines ${record.lineStart}-${record.lineEnd}`,
      };
    case "element":
      return {
        type: "chip",
        kind: "element",
        label: record.label,
        icon: { kind: "lucide", name: "mouse-pointer-click" },
        tooltip: [record.pageTitle ?? record.pageUrl, record.selector ?? record.tagName].filter(Boolean).join("\n"),
      };
    case "preview-annotation":
      return {
        type: "chip",
        kind: "element",
        label: record.label,
        icon: { kind: "lucide", name: "mouse-pointer-click" },
        tooltip: [record.pageTitle?.trim() || record.pageUrl, record.comment].filter(Boolean).join("\n"),
      };
    case "review-comment":
      return {
        type: "chip",
        kind: record.pullRequest ? "pull-request" : "review-comment",
        label: record.label,
        icon: { kind: "lucide", name: record.pullRequest ? "git-pull-request" : "message-circle" },
        tooltip: [record.filePath, `${record.sectionTitle} · ${record.rangeLabel}`, record.text].filter(Boolean).join("\n"),
      };
    default:
      return unavailable(reference.label);
  }
}
