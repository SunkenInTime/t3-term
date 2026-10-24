// apps/web/src/components/chat/UserMessageContextChips.tsx: the chip each
// `t3-context:` reference in a sent message renders as (file mention, skill,
// thread, image, file, terminal excerpt, browser element, review comment,
// preview annotation), or the dashed "no longer available" chip. Terminal,
// element, review-comment and annotation chips open web's read-only details
// popup (UserMessageContextDetails.tsx) instead of a tooltip.
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import type { ComposerContextRecord, EnvironmentId, ThreadId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { rightPanelActions, threadKeyOf } from "../../state/rightPanel.ts";
import { routeAtom } from "../../state/ui.ts";
import { SKILL_CHIP_ICON_SVG } from "../markdown/chipIcons.ts";
import type { ChipPayload } from "../markdown/MarkdownChips.tsx";
import { openExpandedImage } from "../markdown/MarkdownMedia.tsx";
import { asKnownContextRecord } from "../../web/lib/userMessageContext.ts";
import { contextDetails, type AnnotationImage } from "./UserMessageContextDetails.tsx";
import { openExternalUrl } from "./system.ts";
import { reviewCommentContextLabel } from "../../web/lib/composerContextRecords.ts";
import { openPullRequestLink } from "../../pullRequests/openPullRequestLink.ts";
import type { IconName } from "../../ui/Icon.tsx";

/** web PULL_REQUEST_CHIP_KINDS with PULL_REQUEST_STATE_PRESENTATION's glyphs. */
const PULL_REQUEST_CHIP = {
  open: { kind: "pr-open", icon: "git-pull-request-arrow", label: "Open" },
  draft: { kind: "pr-draft", icon: "git-pull-request-draft", label: "Draft" },
  merged: { kind: "pr-merged", icon: "git-merge", label: "Merged" },
  closed: { kind: "pr-closed", icon: "git-pull-request-closed", label: "Closed" },
  unknown: { kind: "pull-request", icon: "git-pull-request-arrow", label: "" },
} as const satisfies Record<string, { kind: ChipPayload["kind"]; icon: IconName; label: string }>;

type PreviewAnnotationRecord = Extract<NonNullable<ReturnType<typeof asKnownContextRecord>>, { kind: "preview-annotation" }>;

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
  /** File attachments by id: a file chip opens its attachment in the Files surface. */
  readonly files: ReadonlyMap<string, Parameters<typeof rightPanelActions.openAttachment>[1]>;
  /** The screenshot sent with a preview annotation (web resolvePreviewAnnotationImage). */
  readonly annotationImage?: ((record: PreviewAnnotationRecord) => AnnotationImage | null) | undefined;
  /** A video attachment's playable URL; its chip plays it in the system browser (gpuix has no video element). */
  readonly videoUrl?: ((attachmentId: string) => string | null) | undefined;
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
      const file = context.files.get(record.attachmentId);
      // Web expands a video chip into its player; here it plays in the system browser.
      const videoUrl = video ? (context.videoUrl?.(record.attachmentId) ?? null) : null;
      return {
        type: "chip",
        kind: video ? "video" : "file",
        label: middleTruncateAttachmentName(record.name),
        suffix: formatAttachmentSize(record.sizeBytes),
        icon: video ? { kind: "lucide", name: "film" } : { kind: "file", path: record.name },
        tooltip: `${record.name}\n${formatAttachmentSize(record.sizeBytes)}`,
        ...(file && !video
          ? { onActivate: () => rightPanelActions.openAttachment(threadKeyOf(context.environmentId, context.threadId), file) }
          : videoUrl
            ? { onActivate: () => openExternalUrl(videoUrl), tooltip: `${record.name}\n${formatAttachmentSize(record.sizeBytes)}\nPlays in your browser` }
            : {}),
      };
    }
    case "terminal":
      return {
        type: "chip",
        kind: "terminal",
        label: record.label,
        icon: { kind: "lucide", name: "terminal" },
        // TerminalContextInlineChip: an excerpt with text opens its popup; an empty one is a plain chip.
        ...(record.text.length > 0 ? { onActivate: () => contextDetails.terminal(reference.contextId, record) } : {}),
      };
    case "element":
      return {
        type: "chip",
        kind: "element",
        label: record.label,
        icon: { kind: "lucide", name: "mouse-pointer-click" },
        onActivate: () => contextDetails.element(reference.contextId, record),
      };
    case "preview-annotation":
      return {
        type: "chip",
        kind: "element",
        label: record.label,
        icon: { kind: "lucide", name: "mouse-pointer-click" },
        onActivate: () => contextDetails.previewAnnotation(reference.contextId, record, context.annotationImage?.(record) ?? null),
      };
    case "review-comment": {
      // web UserMessagePullRequestContextChip: a pull-request summary is a link
      // chip in its state's colour and icon that opens the pull request.
      const pullRequest = record.pullRequest;
      if (pullRequest) {
        const state = pullRequest.state === "open" && pullRequest.isDraft ? "draft" : pullRequest.state;
        const presentation = PULL_REQUEST_CHIP[state as keyof typeof PULL_REQUEST_CHIP] ?? PULL_REQUEST_CHIP.unknown;
        return {
          type: "chip",
          kind: presentation.kind,
          label: reviewCommentContextLabel(record as never),
          icon: { kind: "lucide", name: presentation.icon },
          // web pullRequestContextKindLabel: "Merged pull request", or "Pull request" without a state.
          tooltip: `${pullRequest.title}\n${presentation.label ? `${presentation.label} pull request` : "Pull request"} #${pullRequest.number}`,
          onActivate: (modifiers) =>
            openPullRequestLink(pullRequest.url, {
              threadRef: { environmentId: context.environmentId, threadId: context.threadId },
              modifiers,
            }),
        };
      }
      return {
            type: "chip",
            kind: "review-comment",
            label: record.label,
            icon: { kind: "lucide", name: "message-circle" },
            onActivate: () => contextDetails.reviewComment(reference.contextId, record, context.workspaceRoot),
          };
    }
    default:
      return unavailable(reference.label);
  }
}
