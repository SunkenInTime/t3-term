// apps/web/src/components/chat/TimelineWorkGroupRows.tsx: grouped tool calls,
// the live activity line, Working and Thinking. Web shimmers live labels; T3
// forbids continuously repainting animations in t3-term, so they are static.
import { liveThoughtLine } from "@t3tools/client-runtime/work-log/presentation";
import { getQuestionAnswerPreview, getQuestionTextPreview, hasQuestionAnswer } from "@t3tools/client-runtime/work-log/user-input";
import type { ToolActivityIcon, WorktreeSetupSnapshot } from "@t3tools/contracts";
import { memo, use, useState, type ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Popover } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import { liveWorkEntryLabel, workEntryIsVisibleInGroup, type MessagesTimelineRow } from "../../web/components/chat/MessagesTimeline.logic.ts";
import { toolGroupSummaryIconName, workEntryIconName, type WorkEntryIconName } from "../../web/components/chat/TimelineWorkEntryRow.logic.ts";
import { formatWorkingTimerNow } from "../../web/components/chat/TimelineWorkGroupRows.logic.ts";
import { workEntryDisplayIndicatesToolFailure } from "../../web/session-logic.ts";
import { TimelineRowTimestamp, useHover, useNowEverySecond } from "./parts.tsx";
import { TimelineRowActivityCtx, TimelineRowCtx, type TimelineRow, type TimelineWorkEntry } from "./rowContext.ts";
import { failedToolIconColor, toolIconAcceptsTint, ToolActivityIconView } from "./ToolActivityIcon.tsx";
import { ReasoningTraceContent, SimpleWorkEntryRow, thoughtPreviewText, threadReadLabel, useThreadReadTarget } from "./WorkEntryRow.tsx";
import { WorkLogList, WorkLogRow, WorkLogText } from "./WorkLog.tsx";
import { WorktreeSetupCard } from "./WorktreeSetupCard.tsx";

/** Entries shown when a group opens; the rest wait behind "Show N more". */
const EXPANDED_GROUP_PAGE = 40;

export const WorkGroupSection = memo(function WorkGroupSection({
  groupedEntries,
  isExpandedToolGroup,
  displayLabel,
}: {
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
  isExpandedToolGroup: boolean;
  displayLabel?: string | undefined;
}) {
  const { workspaceRoot } = use(TimelineRowCtx);
  const nonEmptyEntries = groupedEntries.filter((entry) => workEntryIsVisibleInGroup(entry, isExpandedToolGroup));
  if (nonEmptyEntries.length === 0) return null;
  if (isExpandedToolGroup && nonEmptyEntries.every((entry) => entry.itemType === "reasoning")) {
    return <ReasoningTraceContent entries={nonEmptyEntries} />;
  }
  if (isExpandedToolGroup) {
    return <ExpandedWorkGroupEntries entries={nonEmptyEntries} workspaceRoot={workspaceRoot} />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {nonEmptyEntries.map((workEntry) => (
        <SimpleWorkEntryRow key={workEntry.id} workEntry={workEntry} workspaceRoot={workspaceRoot} displayLabel={displayLabel} />
      ))}
    </div>
  );
});

/**
 * Web lists an open group in its own 18rem scroller. Here the entries sit in
 * the timeline row itself, paged, so the transcript stays the only scroller.
 */
function ExpandedWorkGroupEntries({ entries, workspaceRoot }: { entries: TimelineWorkEntry[]; workspaceRoot: string | undefined }) {
  const [limit, setLimit] = useState(EXPANDED_GROUP_PAGE);
  const hidden = Math.max(0, entries.length - limit);
  // The newest calls matter most while a turn runs, so a long group shows its tail.
  const shown = hidden > 0 ? entries.slice(entries.length - limit) : entries;
  return (
    <WorkLogList>
      {hidden > 0 ? (
        <div style={{ display: "flex", flexDirection: "row", paddingBottom: 2 }}>
          <Button size="xs" variant="ghost-muted" onClick={() => setLimit((value) => value + EXPANDED_GROUP_PAGE * 2)}>
            {`Show ${Math.min(hidden, EXPANDED_GROUP_PAGE * 2)} earlier`}
          </Button>
        </div>
      ) : null}
      {shown.map((entry) => (
        <SimpleWorkEntryRow key={entry.id} workEntry={entry} workspaceRoot={workspaceRoot} />
      ))}
    </WorkLogList>
  );
}

/** "Working for 12s"; the seconds update once a second, nothing animates. */
function WorkingLabel({ createdAt }: { createdAt: string }) {
  const theme = useTheme();
  useNowEverySecond();
  return (
    <Text testId="working-row" size="sm" color={theme.mutedForeground} style={{ lineHeight: 23, whiteSpace: "nowrap" }}>
      {`Working for ${formatWorkingTimerNow(createdAt)}`}
    </Text>
  );
}

export function WorkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  const theme = useTheme();
  const { isCompacting, isPreparingWorktree, backgroundWorktreeSetup } = use(TimelineRowActivityCtx);
  return (
    <div style={{ borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6), paddingBottom: 8, paddingTop: 4 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 24, minWidth: 0, paddingLeft: 4, paddingRight: 4 }}>
        {isPreparingWorktree ? (
          <Text size="sm" color={theme.mutedForeground} style={{ lineHeight: 23, whiteSpace: "nowrap" }}>
            Setting up worktree…
          </Text>
        ) : isCompacting ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="minimize-2" size={12} color={theme.mutedForeground} />
            <Text size="sm" color={theme.mutedForeground} style={{ lineHeight: 23 }}>
              Compacting…
            </Text>
          </div>
        ) : (
          row.createdAt ? (
            <WorkingLabel createdAt={row.createdAt} />
          ) : (
            <Text testId="working-row" size="sm" color={theme.mutedForeground} style={{ lineHeight: 23, whiteSpace: "nowrap" }}>
              Working...
            </Text>
          )
        )}
        {backgroundWorktreeSetup ? (
          <>
            <div style={{ flexGrow: 1 }} />
            <BackgroundWorktreeSetupChip snapshot={backgroundWorktreeSetup} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function BackgroundWorktreeSetupChip({ snapshot }: { snapshot: WorktreeSetupSnapshot }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const terminalId = snapshot.setupScript?.terminalId ?? null;
  const openTerminal = ctx.onOpenWorktreeSetupTerminal;
  return (
    <div style={{ display: "flex", flexShrink: 0 }}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="end"
        trigger={
          <div
            onClick={() => setOpen((value) => !value)}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 20, paddingLeft: 5, paddingRight: 5, borderRadius: 6, cursor: "pointer", hover: { backgroundColor: theme.accent } }}
          >
            <Icon name="loader-circle" size={12} color={theme.mutedForeground} />
            <Text size="2xs" weight={500} color={theme.mutedForeground}>
              Background setup
            </Text>
          </div>
        }
        style={{ width: 384, padding: 8 }}
      >
        <WorktreeSetupCard
          snapshot={snapshot}
          embedded
          onCancel={null}
          onWorkLocally={null}
          onOpenTerminal={openTerminal && terminalId ? () => openTerminal(terminalId) : null}
        />
      </Popover>
    </div>
  );
}

export function ThinkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "thinking" }> }) {
  const ctx = use(TimelineRowCtx);
  const { isCompacting, isPreparingWorktree } = use(TimelineRowActivityCtx);
  if (isPreparingWorktree || isCompacting) return <WorkLogRow label="" />;
  const activity = <LiveActivityContent label="Thinking" iconName="brain" />;
  const { groupId } = row;
  if (groupId === undefined) return activity;
  return (
    <div onClick={() => ctx.onToggleWorkGroup(groupId)} style={{ display: "flex", minHeight: 24, cursor: "pointer" }}>
      {activity}
    </div>
  );
}

function LiveActivityContent({
  label,
  iconName,
  toolIcon,
  failed = false,
}: {
  label: ReactNode;
  iconName: WorkEntryIconName | undefined;
  toolIcon?: ToolActivityIcon | undefined;
  failed?: boolean;
}) {
  const theme = useTheme();
  const showTrailingFailureMark = failed && iconName !== undefined && !toolIconAcceptsTint(toolIcon);
  const iconColor = failed ? failedToolIconColor(theme) : theme.mutedForeground;
  return (
    <WorkLogRow
      icon={iconName ? <ToolActivityIconView icon={toolIcon} fallbackName={iconName} color={iconColor} muted /> : null}
      label={typeof label === "string" ? <WorkLogText>{label}</WorkLogText> : label}
      trailing={showTrailingFailureMark ? <Icon name="x" size={12} color={failedToolIconColor(theme)} /> : null}
    />
  );
}

export function LiveWorkEntryTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "work-live" }> }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const threadTarget = useThreadReadTarget(row.entry, ctx.activeThreadEnvironmentId);
  const questionHeading = row.entry.questionAnswer ? getQuestionTextPreview(row.entry.questionAnswer) : "";
  const label = questionHeading || liveWorkEntryLabel(row.entry, ctx.workspaceRoot, row.active);
  const threadLabel = threadReadLabel(label, threadTarget);
  const failed = workEntryDisplayIndicatesToolFailure(row.entry);
  const thoughtLine = row.thought && !row.expanded ? liveThoughtLine(row.thought.detail ?? "") : "";
  const thoughtIsStatus = thoughtLine !== "" && row.entry === row.thought;
  const activityLabel: ReactNode = thoughtIsStatus ? (
    row.active ? "Thinking" : "Thought"
  ) : row.entry.questionAnswer && hasQuestionAnswer(row.entry.questionAnswer) ? (
    <div style={{ display: "flex", flexDirection: "row", gap: 6, minWidth: 0 }}>
      <WorkLogText>{label}</WorkLogText>
      <WorkLogText color={theme.foreground}>{getQuestionAnswerPreview(row.entry.questionAnswer)}</WorkLogText>
    </div>
  ) : row.entry.itemType === "reasoning" ? (
    thoughtPreviewText(row.entry.detail ?? label, row.active ? "Thinking" : "Thought")
  ) : threadLabel ? (
    threadLabel.text
  ) : (
    label
  );
  return (
    <div
      testId={`work-live-${row.groupId}`}
      onClick={() => ctx.onToggleWorkGroup(row.groupId)}
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", cursor: "pointer", minHeight: 24 }}
    >
      {thoughtLine ? (
        <WorkLogRow
          wrapLabel
          icon={<ToolActivityIconView icon={undefined} fallbackName="brain" color={theme.mutedForeground} muted />}
          label={
            <WorkLogText wrap style={{ lineClamp: 4 }}>
              {thoughtPreviewText(thoughtLine, "Thought")}
            </WorkLogText>
          }
        />
      ) : null}
      <LiveActivityContent
        label={activityLabel}
        iconName={workEntryIconName(row.entry)}
        toolIcon={row.entry.toolIcon ?? row.entry.toolSource?.icon}
        failed={failed}
      />
    </div>
  );
}

export function WorkGroupToggleTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "work-toggle" }> }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const [hovered, hover] = useHover();
  const iconName = row.summaryToolIcon ?? row.toolSurface ?? toolGroupSummaryIconName(row.summaryKind);
  return (
    <WorkLogRow
      testId={`work-toggle-${row.groupId}`}
      onClick={() => ctx.onToggleWorkGroup(row.groupId)}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      icon={<ToolActivityIconView icon={row.toolIcon} fallbackName={iconName} color={theme.mutedForeground} muted />}
      label={<WorkLogText>{row.summary}</WorkLogText>}
      trailing={<TimelineRowTimestamp createdAt={row.createdAt} timestampFormat={ctx.timestampFormat} visible={hovered} />}
    />
  );
}
