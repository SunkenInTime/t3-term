// apps/web/src/components/chat/TimelineAssistantRows.tsx: assistant markdown,
// the copy / fork / time meta line, changed files, and the plan card row.
import { useAtomValue } from "@effect/atom-react";
import { canForkProjectedAssistantItem } from "@t3tools/client-runtime/state/thread-workflows";
import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/markdownPipeline";
import { memo, use, useState, type ReactNode } from "react";

import { getClientSettings } from "../../state/clientSettings.ts";
import { citationFromSelection, closeCitationToolbar, openCitationToolbar, readSelectedText, renderedPlainText } from "../markdown/citations.tsx";
import { parseChatMarkdown } from "../markdown/parse.ts";

import { v2ItemSupportAtom } from "../../state/timeline.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { resolveAssistantMessageCopyState } from "../../web/components/chat/MessagesTimeline.logic.ts";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../web/timestampFormat.ts";
import type { ChatMessage, TurnDiffSummary } from "../../web/types.ts";
import { ChangedFilesCard } from "./ChangedFilesCard.tsx";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { MessageCopyButton, MicroIconButton, useHover } from "./parts.tsx";
import { ProposedPlanCard } from "./ProposedPlanCard.tsx";
import { HtmlRenderCard } from "./HtmlRenderRow.tsx";
import { TimelineRowCtx, type TimelineRow } from "./rowContext.ts";

export const AssistantTimelineRow = memo(function AssistantTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const [hovered, hover] = useHover();
  const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");
  return (
    <div {...hover} style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }}>
      {messageText.length > 0 ? (
        <CitationSource messageId={row.message.id} text={messageText}>
          <ChatMarkdown text={messageText} tone="assistant" lineBreaks={shouldPreserveAssistantLineBreaks(messageText)} isStreaming={Boolean(row.message.streaming)} />
        </CitationSource>
      ) : null}
      <AssistantChangedFilesSection turnSummary={row.assistantTurnDiffSummary} />
      {row.showAssistantMeta ? (
        <AssistantMessageMeta
          marginTop={6}
          projectedItem={row.projectedItem}
          message={row.message}
          showCopyButton={row.showAssistantCopyButton}
          copyStreaming={row.assistantCopyStreaming}
          visible={hovered}
        />
      ) : null}
    </div>
  );
});

/**
 * AssistantCitationSource: a drag that ends inside the reply and leaves a
 * selection in it offers the Cite button at the pointer.
 */
function CitationSource({ messageId, text, children }: { messageId: string; text: string; children: ReactNode }) {
  const ctx = use(TimelineRowCtx);
  return (
    <div
      onMouseDown={() => closeCitationToolbar()}
      onMouseUp={(event) => {
        const position = { x: (event.x ?? 0) + 4, y: (event.y ?? 0) + 12 };
        // The selection settles with the release; read it after this event.
        setTimeout(() => {
          const selected = readSelectedText();
          if (!selected || !ctx) return;
          const tree = parseChatMarkdown(text, {
            lineBreaks: shouldPreserveAssistantLineBreaks(text),
            math: getClientSettings().mathRenderingEnabled,
          });
          const citation = citationFromSelection(ctx.threadRef, messageId, renderedPlainText(tree), selected);
          if (citation) openCitationToolbar(citation, position);
        }, 30);
      }}
      style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}
    >
      {children}
    </div>
  );
}

export function AssistantMetaTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "assistant-meta" }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 4, paddingRight: 4 }}>
      <AssistantMessageMeta
        marginTop={2}
        projectedItem={row.projectedItem}
        message={row.message}
        showCopyButton={row.showAssistantCopyButton}
        copyStreaming={row.assistantCopyStreaming}
        visible
      />
    </div>
  );
}

function AssistantForkButton({
  projectedItem,
}: {
  readonly projectedItem: NonNullable<Extract<TimelineRow, { kind: "message" }>["projectedItem"]>;
}) {
  const ctx = use(TimelineRowCtx);
  const [busy, setBusy] = useState(false);
  const support = useAtomValue(
    v2ItemSupportAtom({
      environmentId: ctx.activeThreadEnvironmentId,
      threadId: projectedItem.sourceThreadId,
      itemId: projectedItem.sourceItemId,
    }),
  );
  const canFork = canForkProjectedAssistantItem({ projectedItem, capabilities: support.providerSession?.capabilities });
  if (!canFork || projectedItem.item.runId === null) return null;
  const runId = projectedItem.item.runId;
  return (
    <MicroIconButton
      icon="git-fork"
      label="Fork from this response"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void ctx.onForkFromRun({ sourceThreadId: projectedItem.sourceThreadId, runId }).finally(() => setBusy(false));
      }}
    />
  );
}

function AssistantMessageMeta({
  marginTop,
  projectedItem,
  message,
  showCopyButton,
  copyStreaming,
  visible,
}: {
  marginTop: number;
  projectedItem?: Extract<TimelineRow, { kind: "message" }>["projectedItem"];
  message: ChatMessage;
  showCopyButton: boolean;
  copyStreaming: boolean;
  visible: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const copy = resolveAssistantMessageCopyState({ text: message.text ?? null, showCopyButton, streaming: copyStreaming });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop,
        height: 24,
        // Hidden meta keeps its line, like web's opacity-0, so hovering never shifts the transcript.
        opacity: visible ? 1 : 0,
      }}
    >
      {projectedItem && projectedItem.item.status !== "completed" ? (
        <div style={{ display: "flex", paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 999, borderWidth: 1, borderColor: alpha(theme.border, 0.7) }}>
          <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontFamily: FONTS.mono }}>{projectedItem.item.status}</text>
        </div>
      ) : null}
      {copy.visible ? <MessageCopyButton text={copy.text ?? ""} testId={`copy-assistant-${message.id}`} /> : null}
      {projectedItem?.item.type === "assistant_message" ? <AssistantForkButton projectedItem={projectedItem} /> : null}
      {!message.streaming ? (
        <Tooltip content={formatChatTimestampTooltip(message.updatedAt, ctx.timestampFormat)} side="top">
          <div style={{ display: "flex" }}>
            <Text size="xs" color={theme.mutedForeground}>
              {formatDayAwareTimestamp(message.updatedAt, ctx.timestampFormat)}
            </Text>
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
}

const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
  turnSummary,
}: {
  turnSummary: TurnDiffSummary | undefined;
}) {
  const ctx = use(TimelineRowCtx);
  if (!turnSummary || turnSummary.files.length === 0) return null;
  return (
    <ChangedFilesCard
      runId={turnSummary.runId}
      files={turnSummary.files}
      allDirectoriesExpanded={ctx.changedFilesExpandedRunIds.has(turnSummary.runId)}
      onToggleAllDirectories={() => ctx.onToggleChangedFilesExpanded(turnSummary.runId)}
      onOpenTurnDiff={ctx.onOpenTurnDiff}
    />
  );
});

export function ProposedPlanTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "proposed-plan" }> }) {
  const ctx = use(TimelineRowCtx);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }}>
      <ProposedPlanCard planMarkdown={row.proposedPlan.planMarkdown} environmentId={ctx.activeThreadEnvironmentId} workspaceRoot={ctx.workspaceRoot} />
    </div>
  );
}

/**
 * McpAppFrame hosts an MCP app in an iframe that talks to the host over
 * postMessage (tool calls, context updates). gpuix has no web view, and a
 * server browser tab has no such host bridge, so the row names what it holds.
 */
function EmbeddedFramePlaceholder({ icon, title, detail }: { icon: "app-window" | "blocks"; title: string; detail: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 4, paddingRight: 4 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 12,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.8),
          backgroundColor: alpha(theme.card, 0.7),
        }}
      >
        <Icon name={icon} size={16} color={theme.mutedForeground} />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 }}>
          <Text size="sm" weight={500} truncate>
            {title}
          </Text>
          <Text size="xs" color={theme.mutedForeground} truncate>
            {detail}
          </Text>
        </div>
      </div>
    </div>
  );
}

export function HtmlRenderTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "html-render" }> }) {
  const ctx = use(TimelineRowCtx);
  return <HtmlRenderCard threadRef={ctx.threadRef} reference={row.htmlRender} />;
}

export function McpAppTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "mcp-app" }> }) {
  return <EmbeddedFramePlaceholder icon="blocks" title={`${row.mcpApp.server} · ${row.mcpApp.tool}`} detail="MCP app. Open this thread in T3 Code to use it." />;
}
