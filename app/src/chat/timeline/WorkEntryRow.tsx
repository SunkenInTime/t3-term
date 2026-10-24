// apps/web/src/components/chat/TimelineWorkEntryRow.tsx + V2ItemInspector.tsx +
// CommandOutputPanel.tsx. Expanded tool output is capped by lines with a
// "Show all" toggle: gpuix allows one vertical scroller per region, so the
// web's max-h scroll boxes become fixed-height previews.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import { notificationChildThreadId } from "@t3tools/client-runtime/state/thread-execution";
import {
  toolCallLines,
  turnItemDetailRevision,
  turnItemHasDetail,
  turnItemNeedsDetailFetch,
  turnItemOutputImages,
  turnItemOutputText,
} from "@t3tools/client-runtime/work-log/item-detail";
import { workEntryViewedImagePath } from "@t3tools/client-runtime/work-log/presentation";
import {
  getQuestionAnswerPreview,
  getQuestionAnswerText,
  getQuestionTextPreview,
  hasQuestionAnswer,
} from "@t3tools/client-runtime/work-log/user-input";
import {
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  type EnvironmentId,
  type OrchestrationV2ProjectedTurnItem,
  ThreadId,
  type UserInputAttachmentAnswerPayload,
} from "@t3tools/contracts";
import { claudeSkillInvocation, isJavaScriptReplTool } from "@t3tools/shared/toolActivity";
import { AsyncResult, Atom } from "effect/reactivity";
import { memo, use, useState, type ReactNode } from "react";

import { environmentThreadShells, serverEnvironment } from "../../state/environment.ts";
import { timelineOrchestration, v2ItemSupportAtom } from "../../state/timeline.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { formatWorkspaceRelativePath } from "../../web/filePathDisplay.ts";
import {
  threadReadLabelPrefix,
  threadReadTargetId,
  threadReadTargetTitle,
  toolGroupAction,
  workEntryDisplayLabel,
  workEntryReadOutput,
} from "../../web/components/chat/MessagesTimeline.logic.ts";
import {
  buildToolCallExpandedBody,
  workEntryIconName,
  workEntryRawCommand,
  workToneIcon,
} from "../../web/components/chat/TimelineWorkEntryRow.logic.ts";
import {
  workEntryDisplayIndicatesToolFailure,
  workEntrySignalsSevereFailure,
  workLogEntryIsToolLike,
} from "../../web/session-logic.ts";
import { formatUpcomingTimestamp } from "../../web/timestampFormat.ts";
import { AssetImage } from "../markdown/MarkdownMedia.tsx";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { ShellCommandBlock } from "./ShellCommandBlock.tsx";
import { SubagentNotificationLink } from "./EventRows.tsx";
import { TimelineRowTimestamp, useHover } from "./parts.tsx";
import { TimelineRowActivityCtx, TimelineRowCtx, type TimelineWorkEntry } from "./rowContext.ts";
import { failedToolIconColor, toolIconAcceptsTint, ToolActivityIconView } from "./ToolActivityIcon.tsx";
import { WorkLogDetails, WorkLogRow, WorkLogText } from "./WorkLog.tsx";

const NO_SHELL_ATOM = Atom.make(null);
const EMPTY_DETAIL_ATOM = Atom.make(AsyncResult.initial<never, never>(false));

/** Flattens a reasoning trace to one label line, like web's remarkThoughtPreview. */
export function thoughtPreviewText(markdown: string | undefined, fallback: string): string {
  const text = (markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:#{1,6}|[-*+>]|\d+\.)[ \t]+/gm, "")
    .replace(/`+|\*\*|~~|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

// ── Thread-read labels ("Read thread “Title”") ─────────────────────────────

function useThreadReadTarget(entry: TimelineWorkEntry, environmentId: EnvironmentId) {
  const rawThreadId = threadReadTargetId(entry);
  const threadId = rawThreadId === null ? null : ThreadId.make(rawThreadId);
  const shell = useAtomValue(
    threadId ? environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, threadId)) : NO_SHELL_ATOM,
  );
  const title = threadReadTargetTitle(shell);
  return threadId && title ? { threadId, title } : null;
}

function threadReadLabel(label: string, target: ReturnType<typeof useThreadReadTarget>) {
  const prefix = target && threadReadLabelPrefix(label);
  return prefix ? { ...target, prefix, text: `${prefix} “${target.title}”` } : null;
}

export { useThreadReadTarget, threadReadLabel };

// ── Shared text blocks ──────────────────────────────────────────────────────

const CODE_SIZE = 13;
const CODE_LINE = 21;
/** Lines shown before "Show all", about web's max-h-64/max-h-80 at 13px. */
const PREVIEW_LINES = 14;

/** A pre-wrapped mono block. Long text shows its first lines and a toggle. */
export function MonoBlock({ text, color, previewLines = PREVIEW_LINES }: { text: string; color?: string; previewLines?: number }) {
  const theme = useTheme();
  const [showAll, setShowAll] = useState(false);
  const lines = text.split("\n");
  const capped = !showAll && lines.length > previewLines;
  const shown = capped ? lines.slice(0, previewLines) : lines;
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {shown.map((line, index) => (
        <text
          // Lines are positional and the text never reorders.
          key={index}
          style={{ color: color ?? theme.mutedForeground, fontSize: CODE_SIZE, lineHeight: CODE_LINE, fontFamily: FONTS.mono, minWidth: 0 }}
        >
          {line.length === 0 ? " " : line}
        </text>
      ))}
      {lines.length > previewLines ? (
        <div style={{ display: "flex", flexDirection: "row", marginTop: 2 }}>
          <Button size="xs" variant="ghost-muted" onClick={() => setShowAll((value) => !value)} style={{ marginLeft: -7 }}>
            {showAll ? "Show less" : `Show all ${lines.length} lines`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── Reasoning ───────────────────────────────────────────────────────────────

export function ReasoningTraceContent({ entries }: { entries: ReadonlyArray<TimelineWorkEntry> }) {
  return (
    <WorkLogDetails>
      {entries.map((entry) => (
        <ChatMarkdown key={entry.id} text={entry.detail ?? ""} tone="user" lineBreaks />
      ))}
    </WorkLogDetails>
  );
}

// ── Work entry rows ─────────────────────────────────────────────────────────

type WorkEntryRowProps = {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  displayLabel?: string | undefined;
};

export const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: WorkEntryRowProps) {
  const ctx = use(TimelineRowCtx);
  const item = props.workEntry.projectedItem?.item;
  const childThreadId = item?.type === "notification" ? notificationChildThreadId(item.source) : undefined;
  if (item?.type !== "notification" || childThreadId === undefined) {
    return <WorkEntryLogRow {...props} />;
  }
  return (
    <SubagentNotificationLink
      parentRef={scopeThreadRef(ctx.activeThreadEnvironmentId, item.threadId)}
      childThreadId={childThreadId}
      outcome={item.outcome}
      createdAt={props.workEntry.createdAt}
      timestampFormat={ctx.timestampFormat}
      onOpenThread={ctx.onOpenThread}
      fallback={<WorkEntryLogRow {...props} />}
    />
  );
});

function WorkEntryLogRow({ workEntry, workspaceRoot, displayLabel }: WorkEntryRowProps) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const [hovered, hover] = useHover();
  const threadTarget = useThreadReadTarget(workEntry, ctx.activeThreadEnvironmentId);
  const [expanded, setExpanded] = useState(() => ctx.workGroupViewState.expandedEntries.has(workEntry.id));
  const toggleExpanded = () => {
    const next = !expanded;
    if (next) ctx.workGroupViewState.expandedEntries.add(workEntry.id);
    else ctx.workGroupViewState.expandedEntries.delete(workEntry.id);
    setExpanded(next);
  };
  const createdThread = workEntry.projectedItem?.item.type === "thread_created" ? workEntry.projectedItem.item : undefined;
  const notifiedSubagentThreadId =
    workEntry.projectedItem?.item.type === "notification" ? notificationChildThreadId(workEntry.projectedItem.item.source) : undefined;

  const failureItem = workEntry.projectedItem?.item;
  if (failureItem?.type === "error" && failureItem.status === "failed") {
    const warning = failureItem.failure.class === "usage_limit";
    const resetAt = failureItem.failure.resetAt;
    const resetTime = resetAt ? formatUpcomingTimestamp(resetAt, ctx.timestampFormat) : null;
    const label = warning ? `Usage limit reached.${resetTime ? ` Retry after ${resetTime}.` : ""}` : workEntry.label;
    const tone = warning ? theme.warningForeground : theme.errorForeground;
    const retryRunId =
      failureItem.runId !== null &&
      ctx.retryableWorkspacePreparationRunIds.has(failureItem.runId) &&
      failureItem.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE
        ? failureItem.runId
        : null;
    return (
      <WorkLogRow
        wrapLabel
        icon={<Icon name="circle-alert" size={16} color={warning ? theme.warning : theme.error} />}
        label={
          <WorkLogText color={tone} weight={500} wrap>
            {label}
          </WorkLogText>
        }
        trailing={<TimelineRowTimestamp createdAt={workEntry.createdAt} timestampFormat={ctx.timestampFormat} />}
      >
        {!warning ? (
          <div style={{ marginLeft: 28, paddingTop: 4, paddingBottom: 4 }}>
            <WorkLogText color={alpha(theme.foreground, 0.8)} wrap>
              {failureItem.failure.message}
            </WorkLogText>
          </div>
        ) : null}
        {retryRunId !== null && ctx.onRetryWorkspacePreparation ? (
          <div style={{ display: "flex", flexDirection: "row", marginLeft: 28, paddingBottom: 4 }}>
            <Button size="xs" variant="outline" icon="rotate-ccw" onClick={() => ctx.onRetryWorkspacePreparation?.(retryRunId)}>
              Retry
            </Button>
          </div>
        ) : null}
      </WorkLogRow>
    );
  }

  const iconConfig = workToneIcon(workEntry.tone);
  const showWarningIndicator = workEntry.sourceActivityKind === "runtime.warning";
  const showFailedIndicator = !showWarningIndicator && workEntryDisplayIndicatesToolFailure(workEntry);
  const showDestructiveRowStyle =
    !showWarningIndicator && showFailedIndicator && (workEntrySignalsSevereFailure(workEntry) || !workLogEntryIsToolLike(workEntry));
  const entryIconName = showWarningIndicator || showDestructiveRowStyle ? "circle-alert" : workEntryIconName(workEntry);
  const entryToolIcon =
    showWarningIndicator || showDestructiveRowStyle ? undefined : (workEntry.toolIcon ?? workEntry.toolSource?.icon);
  const isReasoning = workEntry.itemType === "reasoning";
  const questionHeading = workEntry.questionAnswer ? getQuestionTextPreview(workEntry.questionAnswer) : "";
  const previewText =
    isReasoning && expanded
      ? workEntry.toolLifecycleStatus === "inProgress"
        ? "Thinking"
        : "Thought"
      : questionHeading || (displayLabel ?? workEntryDisplayLabel(workEntry, workspaceRoot));
  const answerPreview =
    workEntry.questionAnswer && hasQuestionAnswer(workEntry.questionAnswer) ? getQuestionAnswerPreview(workEntry.questionAnswer) : null;
  const viewedImagePath = workEntryViewedImagePath(workEntry);
  const payload = workEntry.structuredPayload;
  const skill = payload?.type === "dynamic_tool" ? claudeSkillInvocation(payload.toolName, payload.input) : undefined;
  const plainOutput =
    toolGroupAction(workEntry) === "read" ? workEntryReadOutput(workEntry, workspaceRoot) : skill ? (skill.args ?? null) : undefined;
  const canExpand =
    previewText.trim().length > 0 ||
    (workEntry.itemType === "dynamic_tool" && workEntry.toolData !== undefined) ||
    Boolean(workEntryRawCommand(workEntry) || workEntry.command?.trim() || workEntry.detail?.trim() || workEntry.changedFiles?.length);
  const expandedBody =
    expanded && !isReasoning
      ? plainOutput !== undefined
        ? plainOutput
        : buildToolCallExpandedBody(workEntry, workspaceRoot, previewText, viewedImagePath)
      : null;
  const plainOutputFetches =
    plainOutput !== undefined && workEntry.projectedItem !== undefined && turnItemNeedsDetailFetch(workEntry.projectedItem.item);
  const canExpandProjectedItem =
    plainOutput !== undefined
      ? Boolean(plainOutput || viewedImagePath || workEntry.questionAnswer || plainOutputFetches)
      : workEntry.projectedItem === undefined
        ? canExpand
        : isReasoning
          ? Boolean(workEntry.detail?.trim())
          : Boolean(viewedImagePath || workEntry.questionAnswer || turnItemHasDetail(workEntry.projectedItem.item));
  const iconColor = showWarningIndicator
    ? theme.warning
    : showDestructiveRowStyle
      ? theme.error
      : showFailedIndicator
        ? failedToolIconColor(theme)
        : workEntry.tone === "tool" || workEntry.tone === "thinking"
          ? theme.mutedForeground
          : iconConfig.iconName === "check"
            ? theme.mutedForeground
            : alpha(theme.foreground, 0.92);
  const headingColor = showWarningIndicator
    ? theme.warningForeground
    : showDestructiveRowStyle
      ? theme.errorForeground
      : workLogEntryIsToolLike(workEntry)
        ? theme.mutedForeground
        : alpha(theme.foreground, 0.8);
  const headingWeight = showWarningIndicator || showDestructiveRowStyle ? 500 : undefined;
  const threadLabel = isReasoning ? null : threadReadLabel(previewText, threadTarget);
  const labelText = isReasoning && !expanded
    ? thoughtPreviewText(workEntry.detail, workEntry.toolLifecycleStatus === "inProgress" ? "Thinking" : "Thought")
    : threadLabel
      ? threadLabel.text
      : previewText;

  return (
    <WorkLogRow
      testId={`work-entry-${workEntry.id}`}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      {...(canExpandProjectedItem ? { onClick: toggleExpanded } : {})}
      icon={
        <ToolActivityIconView icon={entryToolIcon} fallbackName={entryIconName} color={iconColor} muted />
      }
      label={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexGrow: 1, flexBasis: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", minWidth: 0, ...(answerPreview ? {} : { flexGrow: 1, flexBasis: 0 }) }}>
            <WorkLogText color={headingColor} {...(headingWeight === undefined ? {} : { weight: headingWeight })}>
              {labelText}
            </WorkLogText>
          </div>
          {answerPreview ? (
            <div style={{ display: "flex", flexDirection: "row", minWidth: 0, flexShrink: 1 }}>
              <WorkLogText color={!expanded ? theme.foreground : theme.mutedForeground}>{answerPreview}</WorkLogText>
            </div>
          ) : null}
        </div>
      }
      trailing={
        <>
          {createdThread ? (
            <div
              onClick={() => ctx.onOpenThread(createdThread.targetThreadId)}
              style={{ display: "flex", flexShrink: 0, cursor: "pointer", borderRadius: 4 }}
            >
              <Text size="sm" color={theme.primary}>
                Open chat
              </Text>
            </div>
          ) : null}
          {notifiedSubagentThreadId ? (
            <div
              onClick={() => ctx.onOpenThread(notifiedSubagentThreadId)}
              style={{ display: "flex", flexShrink: 0, cursor: "pointer" }}
            >
              <Text size="sm" weight={500} color={theme.foreground}>
                Open subagent
              </Text>
            </div>
          ) : null}
          {showFailedIndicator && !showDestructiveRowStyle && !toolIconAcceptsTint(entryToolIcon) ? (
            <Icon name="x" size={12} color={failedToolIconColor(theme)} />
          ) : null}
          <TimelineRowTimestamp createdAt={workEntry.createdAt} timestampFormat={ctx.timestampFormat} visible={hovered} />
          <div style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: canExpandProjectedItem ? 0.7 : 0 }}>
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} color={theme.mutedForeground} />
          </div>
        </>
      }
    >
      {expanded && workEntry.questionAnswer ? <QuestionAnswerHistory answer={workEntry.questionAnswer} /> : null}
      {expanded && isReasoning ? <ReasoningTraceContent entries={[workEntry]} /> : null}
      {expanded &&
      !isReasoning &&
      !workEntry.questionAnswer &&
      canExpandProjectedItem &&
      (expandedBody || plainOutputFetches || (workEntry.projectedItem && plainOutput === undefined)) ? (
        <WorkLogDetails kind="panel">
          {workEntry.projectedItem && plainOutput === undefined ? (
            <ItemInspector projectedItem={workEntry.projectedItem} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {expandedBody ? <MonoBlock text={expandedBody} /> : null}
              {plainOutputFetches && workEntry.projectedItem ? <FetchedToolOutput projectedItem={workEntry.projectedItem} /> : null}
            </div>
          )}
        </WorkLogDetails>
      ) : null}
    </WorkLogRow>
  );
}

function QuestionAnswerHistory({ answer }: { answer: UserInputAttachmentAnswerPayload }) {
  const theme = useTheme();
  const questionIds = [
    ...new Set([
      ...Object.keys(answer.questionTextById ?? {}),
      ...Object.keys(answer.answers),
      ...Object.keys(answer.attachmentsByQuestionId),
    ]),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginLeft: 28, marginTop: 8 }}>
      {questionIds.map((questionId) => {
        const answerText = getQuestionAnswerText(answer.answers[questionId]);
        const attachments = answer.attachmentsByQuestionId[questionId] ?? [];
        return (
          <div key={questionId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {answer.questionTextById?.[questionId] ? (
              <Text size="sm" color={theme.mutedForeground}>
                {answer.questionTextById[questionId]}
              </Text>
            ) : null}
            {answerText ? (
              <Text size="sm" color={theme.mutedForeground} style={{ marginLeft: 12 }}>
                {answerText}
              </Text>
            ) : null}
            {attachments.length > 0 ? (
              <Text size="sm" color={theme.mutedForeground}>
                {attachments.map((attachment) => attachment.name).join(", ")}
              </Text>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── V2ItemInspector ─────────────────────────────────────────────────────────

function useFetchedTurnItem(projectedItem: OrchestrationV2ProjectedTurnItem, environmentId: EnvironmentId, skip = false) {
  const wireItem = projectedItem.item;
  const fetches = !skip && turnItemNeedsDetailFetch(wireItem);
  const result = useAtomValue(
    fetches
      ? timelineOrchestration.turnItem({
          environmentId,
          input: {
            threadId: projectedItem.sourceThreadId,
            itemId: projectedItem.sourceItemId,
            revision: turnItemDetailRevision(wireItem),
          },
        })
      : EMPTY_DETAIL_ATOM,
  );
  const data = result._tag === "Success" ? (result.value as { item: typeof wireItem | null } | null) : null;
  const fetchedItem = data?.item;
  const item = fetchedItem?.type === wireItem.type ? fetchedItem : wireItem;
  return {
    item,
    output: {
      output: turnItemOutputText(item),
      images: turnItemOutputImages(item),
      environmentId,
      pending: fetches && item === wireItem && result._tag === "Initial",
      error: item !== wireItem ? null : data?.item === null ? "Output is no longer available." : result._tag === "Failure" ? "The request failed." : null,
      empty: fetches && item !== wireItem,
    },
  };
}

interface ToolOutputState {
  readonly output: string | null;
  readonly images: ReturnType<typeof turnItemOutputImages>;
  readonly environmentId: EnvironmentId;
  readonly pending: boolean;
  readonly error: string | null;
  readonly empty: boolean;
}

/** Images the tool returned (served as `tool-output-image` assets) above its text, like web. */
function ToolOutput(props: ToolOutputState) {
  const theme = useTheme();
  const text = props.output ? (
    <MonoBlock text={stripAnsi(props.output)} />
  ) : props.pending ? (
    <MonoBlock text="Loading output…" />
  ) : props.error ? (
    <MonoBlock text={`Couldn't load output: ${props.error}`} color={theme.errorForeground} />
  ) : props.empty && props.images.length === 0 ? (
    <MonoBlock text="No output." />
  ) : null;
  if (props.images.length === 0) return text;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {props.images.map((resource) => (
        // web maxHeightRem={16}
        <AssetImage key={resource.index} environmentId={props.environmentId} resource={resource} alt="Tool output image" maxHeight={256} />
      ))}
      {text}
    </div>
  );
}

function stripAnsi(text: string): string {
  // Terminal colors arrive as SGR escapes; the preview shows plain text.
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}

function FetchedToolOutput({ projectedItem }: { projectedItem: OrchestrationV2ProjectedTurnItem }) {
  const ctx = use(TimelineRowCtx);
  const { output } = useFetchedTurnItem(projectedItem, ctx.activeThreadEnvironmentId);
  return <ToolOutput {...output} />;
}

function CommandOutputPanel({ projectedItem }: { projectedItem: OrchestrationV2ProjectedTurnItem }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const result = useAtomValue(
    timelineOrchestration.v2.commandOutput({
      environmentId: ctx.activeThreadEnvironmentId,
      input: { threadId: projectedItem.sourceThreadId, itemId: projectedItem.sourceItemId },
    }),
  );
  const data = result._tag === "Success" ? result.value : null;
  const text = data?.output.text ?? "";
  if (text.length === 0) {
    if (result._tag === "Failure") return <MonoBlock text="Couldn't load output." color={theme.errorForeground} />;
    if (data === null) return <MonoBlock text="Loading output…" />;
    return data.running ? null : <MonoBlock text="No output." />;
  }
  const lines = stripAnsi(text).replace(/\n$/, "");
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {data?.output.truncated ? <MonoBlock text="Earlier output not shown" /> : null}
      {/* A running command shows its newest lines, like web's follow-to-end scroller. */}
      {data?.running ? <MonoBlock text={lines.split("\n").slice(-PREVIEW_LINES).join("\n")} /> : <MonoBlock text={lines} />}
    </div>
  );
}

function ToolCallBody(
  props: ToolOutputState & {
    readonly command?: string;
    readonly args?: unknown;
    readonly toolName?: string | null;
    readonly exitCode?: number | undefined;
    readonly outputSlot?: ReactNode;
  },
) {
  const theme = useTheme();
  const call = toolCallLines({ command: props.command, args: props.args });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {call.command ? <ShellCommandBlock command={call.command} fontSize={CODE_SIZE} lineHeight={CODE_LINE} /> : null}
      {call.args ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {call.args.map(([key, value]) =>
            key === "code" && isJavaScriptReplTool(props.toolName) ? (
              <div key={key} style={{ display: "flex", flexDirection: "column" }}>
                <MonoBlock text={key} />
                <MonoBlock text={value} color={alpha(theme.foreground, 0.85)} />
              </div>
            ) : (
              <ArgLine key={key} name={key} value={value} />
            ),
          )}
        </div>
      ) : null}
      {call.argsText ? <MonoBlock text={call.argsText} /> : null}
      {props.outputSlot ?? <ToolOutput {...props} />}
      {props.exitCode !== undefined && props.exitCode !== 0 ? (
        <MonoBlock text={`exit ${props.exitCode}`} color={theme.errorForeground} />
      ) : null}
    </div>
  );
}

/** "key value" with the key muted, wrapping like web's inline spans. */
function ArgLine({ name, value }: { name: string; value: string }) {
  const theme = useTheme();
  const [first, ...rest] = value.split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", minWidth: 0 }}>
        <text style={{ color: theme.mutedForeground, fontSize: CODE_SIZE, lineHeight: CODE_LINE, fontFamily: FONTS.mono, flexShrink: 0 }}>{`${name} `}</text>
        <text style={{ color: alpha(theme.foreground, 0.85), fontSize: CODE_SIZE, lineHeight: CODE_LINE, fontFamily: FONTS.mono, minWidth: 0 }}>
          {first ?? ""}
        </text>
      </div>
      {rest.length > 0 ? <MonoBlock text={rest.join("\n")} color={alpha(theme.foreground, 0.85)} /> : null}
    </div>
  );
}

export const ItemInspector = memo(function ItemInspector({ projectedItem }: { projectedItem: OrchestrationV2ProjectedTurnItem }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const config = useAtomValue(serverEnvironment.configValueAtom(ctx.activeThreadEnvironmentId));
  const streamsOutput =
    config?.environment.capabilities.commandOutputStreaming === true && projectedItem.item.type === "command_execution";
  const fetched = useFetchedTurnItem(projectedItem, ctx.activeThreadEnvironmentId, streamsOutput);
  const support = useAtomValue(
    v2ItemSupportAtom({
      environmentId: ctx.activeThreadEnvironmentId,
      threadId: projectedItem.sourceThreadId,
      itemId: projectedItem.sourceItemId,
    }),
  );
  const item = fetched.item;
  const muted = theme.mutedForeground;
  const text = (value: string, color = muted) => <MonoBlock text={value} color={color} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {item.type === "reasoning" && item.text ? (
        <div style={{ borderRadius: RADIUS.sm, borderWidth: 1, borderColor: alpha(theme.border, 0.45), backgroundColor: alpha(theme.muted, 0.15), padding: 8 }}>
          <ChatMarkdown text={item.text} tone="muted" textSize={12} lineBreaks />
        </div>
      ) : null}
      {item.type === "command_execution" ? (
        <ToolCallBody
          command={item.input}
          exitCode={item.exitCode}
          {...fetched.output}
          {...(streamsOutput ? { outputSlot: <CommandOutputPanel projectedItem={projectedItem} /> } : {})}
        />
      ) : null}
      {item.type === "file_change" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <text style={{ color: muted, fontSize: 12, lineHeight: 16, fontFamily: FONTS.mono }}>
              {formatWorkspaceRelativePath(item.fileName, ctx.workspaceRoot)}
            </text>
            {item.additions !== undefined || item.deletions !== undefined ? (
              <div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
                <Text size="xs" color={theme.diffAdd}>{`+${formatDiffCount(item.additions ?? 0)}`}</Text>
                <Text size="xs" color={theme.diffDel}>{`-${formatDiffCount(item.deletions ?? 0)}`}</Text>
              </div>
            ) : null}
            {item.runId !== null ? (
              <Button size="xs" variant="outline" onClick={() => ctx.onOpenTurnDiff(item.runId!, item.fileName)}>
                Open diff
              </Button>
            ) : null}
          </div>
          {item.status === "failed" && item.diffStr?.trim() ? text(item.diffStr) : null}
          {item.changes !== undefined && item.changes.length > 0
            ? text(
                item.changes
                  .map(
                    (change) =>
                      `${change.operation} ${change.oldPath ? `${change.oldPath} → ` : ""}${formatWorkspaceRelativePath(change.path, ctx.workspaceRoot)}${
                        change.fileType || change.mimeType ? ` (${[change.fileType, change.mimeType].filter(Boolean).join(", ")})` : ""
                      }`,
                  )
                  .join("\n"),
              )
            : null}
        </div>
      ) : null}
      {item.type === "file_search" && item.pattern?.trim() ? text(item.pattern, alpha(theme.foreground, 0.85)) : null}
      {item.type === "web_search" && item.patterns?.length ? text(item.patterns.join("\n"), alpha(theme.foreground, 0.85)) : null}
      {item.type === "file_search" && item.results?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {item.results.slice(0, 50).map((result, index) => (
            <div key={index} style={{ display: "flex", flexDirection: "column" }}>
              <text style={{ color: alpha(theme.foreground, 0.8), fontSize: 12, lineHeight: 16, fontFamily: FONTS.mono }}>
                {`${formatWorkspaceRelativePath(result.fileName, ctx.workspaceRoot)}${result.line === undefined ? "" : `:${result.line}`}${result.column === undefined ? "" : `:${result.column}`}`}
              </text>
              {result.preview ? (
                <Text size="xs" color={muted}>
                  {result.preview}
                </Text>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {item.type === "web_search" && item.results?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {item.results.map((result, index) => (
            <div key={index} style={{ display: "flex", flexDirection: "column" }}>
              <Text size="xs" weight={500}>
                {result.title ?? result.url ?? "Search result"}
              </Text>
              {result.snippet ? (
                <Text size="xs" color={muted}>
                  {result.snippet}
                </Text>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {item.type === "dynamic_tool" ? <ToolCallBody toolName={item.toolName} args={item.input} {...fetched.output} /> : null}
      {item.type === "approval_request" && item.prompt ? text(item.prompt) : null}
      {item.type === "user_input_request" ? text(item.questions.map((question) => question.question).join("\n\n")) : null}
      {item.type === "notification" && item.detail ? text(typeof item.detail === "string" ? item.detail : JSON.stringify(item.detail, null, 2)) : null}
      {item.type === "system_notice" ? text(item.message) : null}
      {item.type === "error" ? text(item.failure.message) : null}
      {item.type === "proposed_plan" ? text(item.markdown) : null}
      {item.type === "todo_list" ? text(item.steps.map((step) => `${step.status === "completed" ? "✓" : "○"} ${step.text}`).join("\n")) : null}
      {item.type === "checkpoint" ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text size="xs" color={muted}>
            {`${support.checkpoint?.status ?? item.status} · ${item.files.length} files`}
          </Text>
          {support.checkpoint?.status === "ready" ? (
            <Button
              size="xs"
              variant="outline"
              icon="rotate-ccw"
              onClick={() => ctx.onRollbackCheckpoint({ checkpointId: item.checkpointId, scopeId: item.scopeId })}
            >
              Roll back
            </Button>
          ) : null}
        </div>
      ) : null}
      {item.type === "fork" ? (
        <div style={{ display: "flex", flexDirection: "row" }}>
          <Button size="xs" variant="outline" icon="git-branch" onClick={() => ctx.onOpenThread(item.targetThreadId)}>
            Open fork
          </Button>
        </div>
      ) : null}
      {item.type === "subagent" && item.childThreadId !== null ? (
        <div style={{ display: "flex", flexDirection: "row" }}>
          <Button size="xs" variant="outline" onClick={() => ctx.onOpenThread(item.childThreadId!)}>
            Open subagent thread
          </Button>
        </div>
      ) : null}
      {item.type === "handoff" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size="xs" color={muted}>
            {`${item.fromProviderInstanceIds.join(", ")} → ${item.toProviderInstanceId}`}
          </Text>
          <Text size="xs" color={muted}>
            {`${item.strategy.replaceAll("_", " ")} · ${support.contextHandoff?.status ?? item.status}`}
          </Text>
        </div>
      ) : null}
    </div>
  );
});
