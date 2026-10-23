// Row dispatch and the fold rows from apps/web/src/components/chat/MessagesTimeline.tsx:1193-1380.
import { memo, use } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { AssistantMetaTimelineRow, AssistantTimelineRow, HtmlRenderTimelineRow, McpAppTimelineRow, ProposedPlanTimelineRow } from "./AssistantRows.tsx";
import { V2EventTimelineRow } from "./EventRows.tsx";
import { TimelineRowTimestamp, useHover } from "./parts.tsx";
import { TimelineRowCtx, type TimelineRow } from "./rowContext.ts";
import { UserMessageRow } from "./UserMessageRow.tsx";
import {
  LiveWorkEntryTimelineRow,
  ThinkingTimelineRow,
  WorkGroupSection,
  WorkGroupToggleTimelineRow,
  WorkingTimelineRow,
} from "./WorkGroupRows.tsx";
import { WorkLogBlock } from "./WorkLog.tsx";
import { WorktreeSetupCard } from "./WorktreeSetupCard.tsx";

/** Bottom spacing per row kind (MessagesTimeline.tsx:1206-1221). */
function rowPaddingBottom(row: TimelineRow): number {
  const isWorkLogRow = row.kind === "work" || row.kind === "work-live" || row.kind === "work-toggle" || row.kind === "thinking";
  const isSubagentGroup = row.kind === "event" && row.projectedItem.item.type === "subagent";
  if (isWorkLogRow || isSubagentGroup) return 0;
  if (row.kind === "turn-fold" || row.kind === "working") return 6;
  if (
    (row.kind === "message" && row.message.role === "assistant" && !row.showAssistantMeta) ||
    row.kind === "worktree-setup" ||
    row.kind === "event" ||
    row.kind === "attempt-fold" ||
    row.kind === "html-render" ||
    row.kind === "mcp-app"
  ) {
    return 8;
  }
  return 16;
}

export const TimelineRowContent = memo(function TimelineRowContent({ row }: { row: TimelineRow }) {
  const isWorkLogRow = row.kind === "work" || row.kind === "work-live" || row.kind === "work-toggle" || row.kind === "thinking";
  const isExpandedToolGroup = row.kind === "work" && row.isExpandedToolGroup;
  const isExpandedToolGroupHeader =
    (row.kind === "work-toggle" || row.kind === "work-live" || row.kind === "thinking") && row.expanded === true;
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: rowPaddingBottom(row), minWidth: 0 }}>
      {isWorkLogRow ? (
        <WorkLogBlock
          continues={row.continuesWorkLog}
          layout={isExpandedToolGroup ? "group-content" : isExpandedToolGroupHeader ? "group-header" : "standalone"}
        >
          {row.kind === "work" ? (
            <WorkGroupSection
              groupedEntries={row.groupedEntries}
              isExpandedToolGroup={row.isExpandedToolGroup}
              displayLabel={row.displayLabel}
            />
          ) : null}
          {row.kind === "work-live" ? <LiveWorkEntryTimelineRow row={row} /> : null}
          {row.kind === "work-toggle" ? <WorkGroupToggleTimelineRow row={row} /> : null}
          {row.kind === "thinking" ? <ThinkingTimelineRow row={row} /> : null}
        </WorkLogBlock>
      ) : null}
      {row.kind === "turn-fold" ? <TurnFoldTimelineRow row={row} /> : null}
      {row.kind === "attempt-fold" ? <AttemptFoldTimelineRow row={row} /> : null}
      {row.kind === "context-compaction" ? <ContextCompactionTimelineRow row={row} /> : null}
      {row.kind === "message" && row.message.role === "user" ? <UserMessageRow row={row} /> : null}
      {row.kind === "message" && row.message.role === "assistant" ? <AssistantTimelineRow row={row} /> : null}
      {row.kind === "assistant-meta" ? <AssistantMetaTimelineRow row={row} /> : null}
      {row.kind === "proposed-plan" ? <ProposedPlanTimelineRow row={row} /> : null}
      {row.kind === "html-render" ? <HtmlRenderTimelineRow row={row} /> : null}
      {row.kind === "mcp-app" ? <McpAppTimelineRow row={row} /> : null}
      {row.kind === "working" ? <WorkingTimelineRow row={row} /> : null}
      {row.kind === "worktree-setup" ? <WorktreeSetupTimelineRow row={row} /> : null}
      {row.kind === "event" ? <V2EventTimelineRow row={row} /> : null}
    </div>
  );
});

function WorktreeSetupTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "worktree-setup" }> }) {
  const ctx = use(TimelineRowCtx);
  const terminalId = row.snapshot.setupScript?.terminalId ?? null;
  const openTerminal = ctx.onOpenWorktreeSetupTerminal;
  return (
    <WorktreeSetupCard
      snapshot={row.snapshot}
      embedded={row.embedded}
      onCancel={row.embedded ? null : ctx.onCancelWorktreeSetup}
      onWorkLocally={null}
      onOpenTerminal={openTerminal && terminalId ? () => openTerminal(terminalId) : null}
    />
  );
}

/** "Context compacted 120k → 18k tokens" between two hairlines, 12px muted. */
function ContextCompactionTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "context-compaction" }> }) {
  const theme = useTheme();
  const line = <div style={{ height: 1, flexGrow: 1, flexBasis: 0, backgroundColor: alpha(theme.border, 0.7) }} />;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, width: "100%", paddingTop: 4, paddingBottom: 4 }}>
      {line}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <Icon name="minimize-2" size={12} color={theme.mutedForeground} />
        {row.tokenCounts ? (
          <>
            <Text size="xs" color={theme.mutedForeground}>
              {`Context compacted ${row.tokenCounts.before}`}
            </Text>
            <Icon name="arrow-right" size={12} color={theme.mutedForeground} />
            <Text size="xs" color={theme.mutedForeground}>
              {`${row.tokenCounts.after} tokens`}
            </Text>
          </>
        ) : (
          <Text size="xs" color={theme.mutedForeground}>
            {row.label}
          </Text>
        )}
      </div>
      {line}
    </div>
  );
}

/** "Worked for 10m 38s ›" with a bottom hairline; the timestamp appears on hover. */
function TurnFoldTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "turn-fold" }> }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const [hovered, hover] = useHover();
  const [buttonHovered, buttonHover] = useHover();
  const color = buttonHovered ? theme.foreground : theme.mutedForeground;
  return (
    <div
      {...hover}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        borderBottomWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        paddingTop: 4,
        paddingBottom: 8,
        paddingRight: 2,
      }}
    >
      <div
        testId={`turn-fold-${row.runId}`}
        {...buttonHover}
        onClick={() => ctx.onToggleTurnFold(row.runId)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 4, paddingRight: 4, borderRadius: RADIUS.md, cursor: "pointer", userSelect: "none" }}
      >
        <Text size="sm" color={color} style={{ lineHeight: 23 }}>
          {row.label}
        </Text>
        <Icon name={row.expanded ? "chevron-down" : "chevron-right"} size={14} color={color} />
      </div>
      <div style={{ flexGrow: 1 }} />
      <TimelineRowTimestamp createdAt={row.createdAt} timestampFormat={ctx.timestampFormat} visible={hovered} />
    </div>
  );
}

/** "Superseded attempt · Cut off by a steer" button with a muted fill. */
function AttemptFoldTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "attempt-fold" }> }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  return (
    <div
      onClick={() => ctx.onToggleAttemptFold(row.attemptId)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        width: "100%",
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        backgroundColor: alpha(theme.muted, 0.2),
        cursor: "pointer",
        hover: { backgroundColor: alpha(theme.muted, 0.35) },
      }}
    >
      <Icon name={row.expanded ? "chevron-down" : "chevron-right"} size={14} color={theme.mutedForeground} />
      <Text size="xs" weight={500} color={alpha(theme.foreground, 0.8)}>
        {row.label}
      </Text>
      <Text size="2xs" color={theme.mutedForeground}>
        Cut off by a steer
      </Text>
    </div>
  );
}
