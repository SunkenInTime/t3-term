// apps/web/src/components/chat/TimelineUserMessageRow.tsx: the right-aligned
// bubble, attachments, long-message collapse, steer marker, folded agent and
// automation prompts, and the hover meta (time, "Edit from here", copy).
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";
import type { AssetResource, EnvironmentId, MessageId } from "@t3tools/contracts";
import { collectComposerContextReferences, replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { buildNewThreadLink, PROMPT_LINK_MAX_PROMPT_LENGTH } from "@t3tools/shared/promptLinks";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { memo, use, useState, type ReactNode } from "react";

import { environmentSession, environmentThreadShells } from "../../state/environment.ts";
import { timelineAssets } from "../../state/timeline.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { shouldCollapseUserMessage } from "../../web/components/chat/MessagesTimeline.logic.ts";
import { asKnownContextRecord, resolveUserMessageContext } from "../../web/lib/userMessageContext.ts";
import { selectMessageImageResources } from "../../web/session-logic.ts";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../web/timestampFormat.ts";
import { isFileAttachment, isImageAttachment, isVideoAttachment, type ChatAttachment, type ChatFileAttachment } from "../../web/types.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { MessageCopyButton, MicroIconButton, useHover } from "./parts.tsx";
import { TimelineRowActivityCtx, TimelineRowCtx, type TimelineRow } from "./rowContext.ts";
import { openExternalUrl } from "./system.ts";

type MessageRow = Extract<TimelineRow, { kind: "message" }>;

const NO_SHELL_ATOM = Atom.make(null);
const EMPTY_URLS_ATOM = Atom.make<ReadonlyArray<ReturnType<typeof timelineAssets.createUrl> extends Atom.Atom<infer R> ? R : never>>([]);

/** Web's promptLinkFor without a repository: a hosted-app link that opens a new thread with the prompt. */
function promptLinkFor(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (trimmed.length === 0 || trimmed.length > PROMPT_LINK_MAX_PROMPT_LENGTH) return null;
  return buildNewThreadLink({ prompt: trimmed });
}

/** useAssetUrls: signed URLs for message attachments, resolved against the connection's base URL. */
function useAttachmentUrls(environmentId: EnvironmentId, resources: ReadonlyArray<AssetResource>): ReadonlyArray<string | null> {
  const prepared = useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId));
  const results = useAtomValue(resources.length === 0 ? EMPTY_URLS_ATOM : timelineAssets.createUrls({ environmentId, resources }));
  const httpBaseUrl = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  return resources.map((_, index) => {
    const result = results[index];
    if (!result || result._tag !== "Success" || httpBaseUrl === null) return null;
    return resolveAssetUrl(httpBaseUrl, result.value.relativeUrl);
  });
}

export function UserMessageRow({ row }: { row: MessageRow }) {
  return resolveUserMessagePresentation(row.message).attribution === "automation" ? (
    <AutomationMessageRow row={row} />
  ) : (
    <UserTimelineRow row={row} />
  );
}

function FoldedMessageHeader(props: { icon: IconName; label: string; summary: string; expanded: boolean; onToggle: () => void }) {
  const theme = useTheme();
  return (
    <div
      onClick={props.onToggle}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS["2xl"], cursor: "pointer" }}
    >
      <Icon name={props.icon} size={16} color={theme.mutedForeground} />
      <Text size="sm" color={theme.mutedForeground} truncate style={{ flexShrink: 0, maxWidth: 200 }}>
        {props.label}
      </Text>
      <Text size="sm" truncate style={{ flexGrow: 1, flexBasis: 0 }}>
        {props.summary}
      </Text>
      <Icon name={props.expanded ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
    </div>
  );
}

function UserMessageProjectedStatus({ row }: { row: MessageRow }) {
  const theme = useTheme();
  const status = row.projectedItem?.item.status;
  if (status === undefined || status === "completed" || status === "pending" || status === "waiting") return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", marginRight: 4 }}>
      <div style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 999, borderWidth: 1, borderColor: alpha(theme.error, 0.25), backgroundColor: alpha(theme.error, 0.08) }}>
        <text style={{ color: theme.errorForeground, fontSize: 10, lineHeight: 14, fontWeight: 500, fontFamily: FONTS.sans }}>{status}</text>
      </div>
    </div>
  );
}

function UserMessageIntentMarker({ intent }: { readonly intent: "steer" | "promoted_queued_to_steer" }) {
  const theme = useTheme();
  return (
    <Tooltip
      content={intent === "promoted_queued_to_steer" ? "Originally queued, then promoted to steer the active turn" : "Steered the active turn"}
      side="top"
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginRight: 4 }}>
        <Icon name="redo-2" size={12} color={theme.mutedForeground} />
        <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 12 }}>
          Steer
        </Text>
      </div>
    </Tooltip>
  );
}

function RevertUserMessageButton({ turnCount, messageId }: { turnCount: number; messageId: MessageId }) {
  const ctx = use(TimelineRowCtx);
  const activity = use(TimelineRowActivityCtx);
  return (
    <MicroIconButton
      icon="undo-2"
      label="Edit from here"
      testId={`edit-from-here-${messageId}`}
      disabled={activity.isRevertingCheckpoint || activity.isWorking}
      onClick={() => ctx.onRevertToTurnCount(turnCount, messageId)}
    />
  );
}

/** The meta line under a user bubble: shown while the row is hovered, space kept otherwise. */
function UserMessageMeta({ row, visible, copyText, promptLink, leading }: { row: MessageRow; visible: boolean; copyText: string; promptLink: string | null; leading?: ReactNode }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", alignItems: "center", width: "80%", paddingRight: 4, opacity: visible ? 1 : 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {leading}
        <Tooltip content={formatChatTimestampTooltip(row.message.createdAt, ctx.timestampFormat)} side="top">
          <div style={{ display: "flex" }}>
            <Text size="xs" color={theme.mutedForeground}>
              {formatDayAwareTimestamp(row.message.createdAt, ctx.timestampFormat)}
            </Text>
          </div>
        </Tooltip>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>
          {typeof row.revertTurnCount === "number" ? <RevertUserMessageButton turnCount={row.revertTurnCount} messageId={row.message.id} /> : null}
          {copyText ? <MessageCopyButton text={copyText} testId={`copy-user-${row.message.id}`} /> : null}
          {promptLink !== null ? <MessageCopyButton text={promptLink} label="Copy prompt link" icon="link" /> : null}
        </div>
      </div>
    </div>
  );
}

/** Automation prompts are long, repeated runbooks; a folded bubble keeps them out of the way. */
function AutomationMessageRow({ row }: { row: MessageRow }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [hovered, hover] = useHover();
  const { text } = resolveUserMessagePresentation(row.message);
  const summary = text.trim().split(/\r?\n/, 1)[0] ?? "";
  return (
    <div {...hover} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      {row.message.inputIntent === "steer" || row.message.inputIntent === "promoted_queued_to_steer" ? (
        <UserMessageIntentMarker intent={row.message.inputIntent} />
      ) : null}
      <div {...hover} style={{ display: "flex", flexDirection: "column", minWidth: 0, maxWidth: "80%", ...(expanded ? { width: "80%" } : {}), borderRadius: RADIUS["2xl"], backgroundColor: theme.messageSurface }}>
        <FoldedMessageHeader icon="calendar-clock" label="Automation" summary={summary} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
        {expanded ? (
          <div style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 12 }}>
            <CollapsibleUserMessageBody text={text} />
          </div>
        ) : null}
      </div>
      <UserMessageProjectedStatus row={row} />
      {expanded ? <UserMessageMeta row={row} visible={hovered} copyText={text} promptLink={promptLinkFor(text)} /> : null}
    </div>
  );
}

const UserTimelineRow = memo(function UserTimelineRow({ row }: { row: MessageRow }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const [hovered, hover] = useHover();
  const attachments = row.message.attachments ?? [];
  const images = attachments.filter(isImageAttachment);
  const regularImages = images.filter((image) => !image.name.startsWith("preview-annotation-"));
  const files = attachments.filter(isFileAttachment);
  const unknownAttachments = attachments.filter((attachment) => !isImageAttachment(attachment) && !isFileAttachment(attachment));
  const userMessage = resolveUserMessagePresentation(row.message);
  // Messages from other agents fold to one line so the user's own messages stay easy to find.
  const folded = userMessage.attribution === "agent";
  const [expanded, setExpanded] = useState(false);
  const senderThreadId = row.message.senderThreadId;
  const senderShell = useAtomValue(
    folded && senderThreadId
      ? environmentThreadShells.threadShellAtom(scopeThreadRef(ctx.activeThreadEnvironmentId, senderThreadId))
      : NO_SHELL_ATOM,
  );
  const resolvedContext = resolveUserMessageContext(row.message);
  // Context chips render as their labels; gpuix markdown has no inline components.
  const plainText = replaceComposerContextReferences(resolvedContext.text, (reference) => reference.label);
  // Web renders context references as inline chips; gpuix markdown has no inline
  // components, so a chip becomes inline code, the closest native pill.
  const chippedText = replaceComposerContextReferences(resolvedContext.text, (reference) => `\`${reference.label.replaceAll("`", "")}\``);
  // Files a chip already shows are not listed again (web's chippedAttachmentIds).
  const chippedAttachmentIds = new Set(
    collectComposerContextReferences(resolvedContext.text).flatMap((occurrence) => {
      const record = asKnownContextRecord(resolvedContext.recordsById.get(occurrence.contextId));
      return record?.kind === "file" || record?.kind === "image" ? [record.attachmentId] : [];
    }),
  );
  const videos = files.filter(isVideoAttachment);
  const unchippedFiles = files.filter((file) => !isVideoAttachment(file) && !chippedAttachmentIds.has(file.id));
  const foldSummary = plainText.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
  const promptLink = promptLinkFor(plainText);

  return (
    <div {...hover} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      {userMessage.attribution === "t3code" ? (
        <Text size="2xs" color={alpha(theme.mutedForeground, 0.7)} style={{ marginRight: 4 }}>
          Sent by T3 Code
        </Text>
      ) : null}
      {row.message.inputIntent === "steer" || row.message.inputIntent === "promoted_queued_to_steer" ? (
        <UserMessageIntentMarker intent={row.message.inputIntent} />
      ) : null}
      <div
        testId={`user-message-${row.message.id}`}
        {...hover}
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          maxWidth: "80%",
          ...(folded && expanded ? { width: "80%" } : {}),
          borderRadius: RADIUS["2xl"],
          backgroundColor: theme.messageSurface,
          ...(folded ? {} : { padding: 12 }),
        }}
      >
        {folded ? (
          <FoldedMessageHeader
            icon="messages-square"
            label={senderShell?.title.trim() || "Agent"}
            summary={foldSummary}
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
          />
        ) : null}
        {!folded || expanded ? (
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, ...(folded ? { paddingLeft: 12, paddingRight: 12, paddingBottom: 12 } : {}) }}>
            {regularImages.length > 0 || videos.length > 0 ? <UserImageGrid images={regularImages} videos={videos} /> : null}
            {unchippedFiles.length > 0 || unknownAttachments.length > 0 ? <UserFileList files={[...unchippedFiles, ...unknownAttachments]} /> : null}
            {resolvedContext.text.trim().length > 0 ? <CollapsibleUserMessageBody text={chippedText} collapsible={!folded} /> : null}
          </div>
        ) : null}
      </div>
      <UserMessageProjectedStatus row={row} />
      {!folded || expanded ? (
        <UserMessageMeta
          row={row}
          visible={hovered}
          copyText={plainText}
          promptLink={promptLink}
          leading={
            folded && senderThreadId ? (
              <div onClick={() => ctx.onOpenThread(senderThreadId)} style={{ display: "flex", cursor: "pointer" }}>
                <Text size="xs" weight={500} color={theme.mutedForeground}>
                  Open thread
                </Text>
              </div>
            ) : undefined
          }
        />
      ) : null}
    </div>
  );
});

/** Two 4:3 thumbnails per row in a 210px grid, radius 10. */
function UserImageGrid({ images, videos }: { images: ReadonlyArray<ChatAttachment>; videos: ReadonlyArray<ChatFileAttachment> }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const resources = selectMessageImageResources(images as never);
  const urls = useAttachmentUrls(ctx.activeThreadEnvironmentId, resources);
  const urlById = new Map(resources.map((resource, index) => [resource._tag === "attachment" ? resource.attachmentId : "", urls[index] ?? null]));
  const cellWidth = 101;
  return (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, maxWidth: 210, marginBottom: 8 }}>
      {images.map((image) => {
        const url = urlById.get(image.id) ?? ("previewUrl" in image ? (image.previewUrl ?? null) : null);
        return (
          <div
            key={image.id}
            onClick={url ? () => openExternalUrl(url) : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: cellWidth,
              height: Math.round((cellWidth * 3) / 4),
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              borderColor: alpha(theme.border, 0.8),
              backgroundColor: alpha(theme.background, 0.7),
              overflow: "hidden",
              cursor: url ? "pointer" : "default",
            }}
          >
            {url ? (
              <img src={url} objectFit="cover" style={{ width: cellWidth, height: Math.round((cellWidth * 3) / 4), borderRadius: RADIUS.lg }} />
            ) : (
              <Text size="2xs" color={alpha(theme.mutedForeground, 0.7)} style={{ textAlign: "center", width: cellWidth - 16 }}>
                {image.name}
              </Text>
            )}
          </div>
        );
      })}
      {videos.map((video) => (
        // MediaVideoPlayer's resting state: a black 4:3 tile with a play glyph.
        <div
          key={video.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: cellWidth,
            height: Math.round((cellWidth * 3) / 4),
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.8),
            backgroundColor: "#000000",
          }}
        >
          <Icon name="play" size={16} color="#ffffff" />
        </div>
      ))}
    </div>
  );
}

function UserFileList({ files }: { files: ReadonlyArray<ChatAttachment> }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
      {files.map((file) => (
        <div key={file.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, paddingTop: 4, paddingBottom: 4 }}>
          <Icon name="file" size={16} color={theme.mutedForeground} />
          <Text size="sm" truncate style={{ flexGrow: 1, flexBasis: 0 }}>
            {file.name}
          </Text>
        </div>
      ))}
    </div>
  );
}

const COLLAPSED_HEIGHT = 176;
const FADE_HEIGHT = 28;

/** Long messages collapse to 176px with a fade and a "Show full message" toggle. */
const CollapsibleUserMessageBody = memo(function CollapsibleUserMessageBody({ text, collapsible = true }: { text: string; collapsible?: boolean }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const canCollapse = collapsible && text.trim().length > 0 && shouldCollapseUserMessage(text);
  const isCollapsed = canCollapse && !expanded;
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ position: "relative", minWidth: 0, ...(isCollapsed ? { height: COLLAPSED_HEIGHT, overflow: "hidden" } : {}) }}>
        <ChatMarkdown text={text} tone="user" lineBreaks />
        {isCollapsed ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: FADE_HEIGHT,
              background: { type: "linear-gradient", angle: 180, stops: [{ color: alpha(theme.messageSurface, 0), position: 0 }, { color: theme.messageSurface, position: 1 }] },
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
      {canCollapse ? (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", marginTop: 6 }}>
          <Button size="xs" variant="ghost-muted" onClick={() => setExpanded((value) => !value)} style={{ marginLeft: -4 }}>
            {expanded ? "Show less" : "Show full message"}
          </Button>
        </div>
      ) : null}
    </div>
  );
});
