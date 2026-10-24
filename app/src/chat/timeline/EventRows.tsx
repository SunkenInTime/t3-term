// apps/web/src/components/chat/TimelineV2EventRow.tsx, V2LifecycleRow.tsx and
// SecretRequestCard.tsx: lifecycle dividers (interrupts, compaction, handoff,
// fork), created-thread rows, subagent rows and groups, provider errors and
// secret requests.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveHandoffEndpoints, type HandoffEndpoints } from "@t3tools/client-runtime/handoff";
import {
  SECRET_REQUEST_DEFAULT_PLACEHOLDER,
  SECRET_REQUEST_PRIVACY_NOTE,
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestFailureMessage,
  type SecretRequestItem,
} from "@t3tools/client-runtime/secret-request";
import {
  formatSubagentDisplayTitle,
  subagentGroupSummary,
  summarizeSubagentStatuses,
} from "@t3tools/client-runtime/state/subagent-display";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  isOrchestrationV2WorkActive,
  type EnvironmentId,
  type NodeId,
  type OrchestrationV2Notification,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2Subagent,
  type OrchestrationV2TurnItem,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { deriveSubagentElapsedMs } from "@t3tools/shared/orchestrationTiming";
import * as DateTime from "effect/DateTime";
import { memo, use, useRef, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentThreadDetails, serverEnvironment } from "../../state/environment.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, type Palette, useTheme } from "../../ui/theme.ts";
import { subagentGroupTiming, v2EventPresentation } from "../../web/components/chat/TimelineV2EventRow.logic.ts";
import { subagentResumedSince } from "../../web/components/chat/V2LifecycleRow.logic.ts";
import { formatShortTimestamp } from "../../web/timestampFormat.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { ProviderGlyph, providerDisplayName, providerTextColor } from "./eventProviderIcon.tsx";
import { TimelineSystemDivider, useHover, useNowEverySecond } from "./parts.tsx";
import { TimelineRowCtx, type TimelineRow } from "./rowContext.ts";
import { T3_WORDMARK_SVG } from "./ToolActivityIcon.tsx";
import { ItemInspector } from "./WorkEntryRow.tsx";
import { WorkLogBlock, WorkLogRow, WorkLogText } from "./WorkLog.tsx";

type EventTone = "muted" | "warning" | "danger" | "success";

function toneColors(theme: Palette, tone: EventTone) {
  switch (tone) {
    case "warning":
      return { border: alpha(theme.warning, 0.25), bg: alpha(theme.warning, 0.05), icon: theme.warning };
    case "danger":
      return { border: alpha(theme.error, 0.25), bg: alpha(theme.error, 0.05), icon: theme.error };
    case "success":
      return { border: alpha(theme.success, 0.2), bg: alpha(theme.success, 0.05), icon: theme.success };
    case "muted":
      return { border: alpha(theme.border, 0.6), bg: alpha(theme.card, 0.3), icon: theme.mutedForeground };
  }
}

/** 10px mono pill with the item status ("running", "failed"). */
function StatusPill({ status }: { status: OrchestrationV2TurnItem["status"] }) {
  const theme = useTheme();
  const failed = status === "failed";
  return (
    <div style={{ display: "flex", flexShrink: 0, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 999, borderWidth: 1, borderColor: failed ? alpha(theme.error, 0.4) : alpha(theme.border, 0.7) }}>
      <text style={{ color: failed ? theme.errorForeground : theme.mutedForeground, fontSize: 10, lineHeight: 14, fontFamily: FONTS.mono }}>{status}</text>
    </div>
  );
}

function VisibilityPill({ visibility }: { visibility: OrchestrationV2ProjectedTurnItem["visibility"] }) {
  const theme = useTheme();
  if (visibility === "local") return null;
  return (
    <div style={{ display: "flex", flexShrink: 0, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 999, backgroundColor: theme.appearance === "dark" ? "#ffffff0d" : theme.muted }}>
      <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontFamily: FONTS.sans }}>{visibility === "inherited" ? "Inherited" : "Synthetic"}</text>
    </div>
  );
}

export const V2EventTimelineRow = memo(function V2EventTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  const ctx = use(TimelineRowCtx);
  const { item, visibility } = row.projectedItem;
  if (item.type === "subagent" && (row.subagents?.length ?? 1) > 1) {
    return <V2SubagentGroup row={row} />;
  }
  if (item.type === "secret_request") {
    return <SecretRequestCard environmentId={ctx.activeThreadEnvironmentId} item={item} visibility={visibility} />;
  }
  if (isV2LifecycleItem(item)) {
    return (
      <V2LifecycleRow
        environmentId={ctx.activeThreadEnvironmentId}
        item={item}
        resourceSummary={row.resourceSummary}
        createdAt={row.createdAt}
        timestampFormat={ctx.timestampFormat}
        runs={ctx.runs}
        onOpenThread={ctx.onOpenThread}
      />
    );
  }
  if (item.type === "error") return <V2ErrorDisclosure row={row} />;
  return <V2EventSection row={row} />;
});

/** A provider error: a `<details>` whose summary carries the label, status and first line. */
function V2ErrorDisclosure({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  const theme = useTheme();
  const { item, visibility, sourceThreadId } = row.projectedItem;
  const [open, setOpen] = useState(false);
  const presentation = v2EventPresentation(item);
  const tone = toneColors(theme, presentation.tone);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: presentation.tone === "muted" ? theme.border : tone.border,
        backgroundColor: presentation.tone === "muted" ? "#00000000" : tone.bg,
      }}
    >
      <div
        onClick={() => setOpen((value) => !value)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, cursor: "pointer" }}
      >
        <Icon name={presentation.icon as IconName} size={14} color={tone.icon} />
        <Text size="xs" weight={500} color={alpha(theme.foreground, 0.9)} style={{ flexShrink: 0 }}>
          {presentation.label}
        </Text>
        {item.status !== "completed" ? <StatusPill status={item.status} /> : null}
        {presentation.detail ? (
          <Text size="xs" color={alpha(theme.mutedForeground, 0.65)} truncate style={{ flexGrow: 1, flexBasis: 0 }}>
            {presentation.detail.replace(/\s+/g, " ")}
          </Text>
        ) : (
          <div style={{ flexGrow: 1 }} />
        )}
        <VisibilityPill visibility={visibility} />
        <Icon name={open ? "chevron-up" : "chevron-down"} size={12} color={alpha(theme.mutedForeground, 0.6)} />
      </div>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.45), paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
          {presentation.detail ? <ChatMarkdown text={presentation.detail} tone="muted" textSize={12} lineBreaks /> : null}
          {visibility === "inherited" ? <InheritedNote sourceThreadId={sourceThreadId} /> : null}
          <div style={{ display: "flex", flexDirection: "column", ...(presentation.detail ? { marginTop: 8 } : {}) }}>
            <ItemInspector projectedItem={row.projectedItem} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InheritedNote({ sourceThreadId }: { sourceThreadId: ThreadId }) {
  const theme = useTheme();
  return (
    <text style={{ color: alpha(theme.mutedForeground, 0.65), fontSize: 10, lineHeight: 14, fontFamily: FONTS.mono, marginTop: 4 }}>
      {`From ${sourceThreadId}`}
    </text>
  );
}

function V2EventSection({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  const theme = useTheme();
  const { item, visibility, sourceThreadId } = row.projectedItem;
  const presentation = v2EventPresentation(item);
  const tone = toneColors(theme, presentation.tone);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: tone.border,
        backgroundColor: tone.bg,
      }}
    >
      <div style={{ display: "flex", marginTop: 2 }}>
        <Icon name={presentation.icon as IconName} size={14} color={tone.icon} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Text size="xs" weight={500} color={alpha(theme.foreground, 0.9)}>
            {presentation.label}
          </Text>
          {item.status !== "completed" ? <StatusPill status={item.status} /> : null}
          <VisibilityPill visibility={visibility} />
        </div>
        {presentation.detail ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
            <ChatMarkdown text={presentation.detail} tone="muted" textSize={12} lineBreaks />
          </div>
        ) : null}
        {visibility === "inherited" ? <InheritedNote sourceThreadId={sourceThreadId} /> : null}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          <ItemInspector projectedItem={row.projectedItem} />
        </div>
      </div>
    </div>
  );
}

// ── Subagent groups ─────────────────────────────────────────────────────────

const V2SubagentGroup = memo(function V2SubagentGroup({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  const ctx = use(TimelineRowCtx);
  const theme = useTheme();
  const groupId = `subagent-group:${row.id}`;
  const [expanded, setExpanded] = useState(() => ctx.workGroupViewState.expandedEntries.has(groupId));
  const [hovered, hover] = useHover();
  const members = (row.subagents ?? [row.projectedItem]).flatMap(({ item }) => (item.type === "subagent" ? [item] : []));
  const liveAgents = useAtomValue(
    environmentThreadDetails.threadAtom(scopeThreadRef(ctx.activeThreadEnvironmentId, row.projectedItem.item.threadId)),
    (thread) => thread?.projection.subagents,
  );
  const agents = members.map((item) => {
    const live = liveAgents?.find((agent) => agent.id === item.subagentId);
    return {
      item,
      status: live?.status ?? item.status,
      startedAt: live?.startedAt ?? item.startedAt,
      completedAt: live?.completedAt ?? item.completedAt,
    };
  });
  const summary = subagentGroupSummary(agents);
  const label = `${members.length} ${members.length === 1 ? "subagent" : "subagents"}`;
  const statusSummary = summarizeSubagentStatuses(agents.map(({ status }) => status));
  const toggle = () => {
    const next = !expanded;
    if (next) ctx.workGroupViewState.expandedEntries.add(groupId);
    else ctx.workGroupViewState.expandedEntries.delete(groupId);
    setExpanded(next);
  };
  const emphasized = expanded || summary.active;
  return (
    <WorkLogBlock continues={row.continuesWorkLog}>
      <div
        testId={`subagent-group-${row.id}`}
        {...hover}
        onClick={toggle}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, width: "100%", minWidth: 0, paddingTop: 8, paddingBottom: 8, cursor: "pointer", opacity: emphasized || hovered ? 1 : 0.55 }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
          {agents.slice(0, 3).map(({ item, status }, index) => (
            <div key={item.id} style={{ display: "flex", marginLeft: index === 0 ? 0 : -6 }}>
              <EnvironmentSubagentAvatar
                environmentId={ctx.activeThreadEnvironmentId}
                providerInstanceId={item.providerInstanceId}
                driver={item.driver}
                status={agents.length === 1 ? status : undefined}
              />
            </div>
          ))}
          {agents.length > 3 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, marginLeft: -6, borderRadius: 999, backgroundColor: theme.appearance === "dark" ? "#1a1a1a" : theme.muted, borderWidth: 2, borderColor: theme.background }}>
              <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 12, fontWeight: 500, fontFamily: FONTS.sans }}>{`+${agents.length - 3}`}</text>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          <Text size="xs" weight={600} color={emphasized ? theme.foreground : theme.mutedForeground}>
            {label}
          </Text>
          <text
            style={{
              color: summary.active ? theme.info : summary.failed ? theme.errorForeground : theme.mutedForeground,
              fontSize: 10,
              lineHeight: 14,
              fontFamily: FONTS.sans,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
            }}
          >
            {statusSummary}
          </text>
        </div>
        <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
          <AgentElapsed agent={subagentGroupTiming(agents)} />
        </Text>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
      </div>
      {expanded ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 4, marginBottom: 4, padding: 4, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: alpha(theme.border, 0.6), backgroundColor: alpha(theme.card, 0.3) }}>
          {members.map((item) => (
            <V2LifecycleRow
              key={item.id}
              environmentId={ctx.activeThreadEnvironmentId}
              item={item}
              createdAt={row.createdAt}
              timestampFormat={ctx.timestampFormat}
              runs={ctx.runs}
              onOpenThread={ctx.onOpenThread}
            />
          ))}
        </div>
      ) : null}
    </WorkLogBlock>
  );
});

// ── Lifecycle rows ──────────────────────────────────────────────────────────

const LIFECYCLE_TYPES = new Set<OrchestrationV2TurnItem["type"]>([
  "run_interrupt_request",
  "run_interrupt_result",
  "compaction",
  "handoff",
  "fork",
  "subagent",
  "thread_created",
]);

export function isV2LifecycleItem(item: OrchestrationV2TurnItem): boolean {
  return LIFECYCLE_TYPES.has(item.type);
}

export function V2LifecycleRow(props: {
  readonly item: OrchestrationV2TurnItem;
  readonly environmentId: EnvironmentId;
  readonly resourceSummary?: boolean | undefined;
  readonly createdAt: string;
  readonly timestampFormat: TimestampFormat;
  readonly runs: ReadonlyArray<import("@t3tools/client-runtime/handoff").HandoffTimelineRun>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const theme = useTheme();
  const { item } = props;
  if (item.type === "run_interrupt_request") {
    return (
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "80%", minWidth: 0 }}>
          <text style={{ color: theme.errorForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.mono }}>■</text>
          <Text size="xs" weight={500} color={theme.errorForeground} style={{ flexShrink: 0 }}>
            Interrupt requested
          </Text>
          <Text size="xs" color={alpha(theme.errorForeground, 0.5)}>
            ·
          </Text>
          <Text size="xs" weight={500} color={theme.errorForeground} truncate>
            {item.message}
          </Text>
          <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontFamily: FONTS.sans, flexShrink: 0 }}>
            {formatShortTimestamp(props.createdAt, props.timestampFormat)}
          </text>
        </div>
      </div>
    );
  }
  if (item.type === "run_interrupt_result") {
    return <TimelineSystemDivider label="Run interrupted" detail={item.message} tone="danger" icon="x" />;
  }
  if (item.type === "compaction") {
    const tokenDetail =
      item.beforeTokenCount === undefined && item.afterTokenCount === undefined
        ? null
        : `${item.beforeTokenCount ?? "?"} → ${item.afterTokenCount ?? "?"} tokens`;
    const label =
      item.status === "failed"
        ? "Context compaction failed"
        : item.status === "cancelled" || item.status === "interrupted"
          ? "Context compaction stopped"
          : item.status === "pending" || item.status === "running" || item.status === "waiting"
            ? "Compacting context"
            : "Context compacted";
    return <TimelineSystemDivider label={label} detail={item.summary ?? tokenDetail} icon="minus" />;
  }
  if (item.type === "handoff") {
    return (
      <HandoffRow
        environmentId={props.environmentId}
        endpoints={resolveHandoffEndpoints(item, props.runs)}
        failed={item.status === "failed"}
      />
    );
  }
  if (item.type === "fork") {
    const relatedThreadId = item.source.type === "run" ? item.source.threadId : item.targetThreadId;
    return (
      <TimelineSystemDivider
        label={item.source.type === "run" ? "Forked from conversation" : "Conversation fork"}
        icon="git-fork"
        actionLabel={item.source.type === "run" ? "Open source conversation" : "Open fork"}
        onAction={() => props.onOpenThread(relatedThreadId)}
      />
    );
  }
  if (item.type === "thread_created") {
    if (props.resourceSummary) {
      return (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0, padding: 12, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, flexShrink: 0, borderRadius: RADIUS.lg, backgroundColor: theme.appearance === "dark" ? "#ffffff0a" : alpha(theme.muted, 0.6) }}>
            <Icon name="message-square" size={16} color={theme.mutedForeground} />
          </div>
          <Text size="sm" weight={500} truncate style={{ flexGrow: 1, flexBasis: 0 }}>
            {item.title ?? "Created thread"}
          </Text>
          <Button size="xs" variant="outline" onClick={() => props.onOpenThread(item.targetThreadId)}>
            Open chat
          </Button>
        </div>
      );
    }
    return (
      <WorkLogRow
        icon={<svg source={T3_WORDMARK_SVG} style={{ width: 16, height: 10, flexShrink: 0, color: theme.mutedForeground, pointerEvents: "none" }} />}
        label={<WorkLogText>{`Created thread${item.title ? ` · ${item.title}` : ""}`}</WorkLogText>}
        trailing={<InlineAction label="Open chat" onClick={() => props.onOpenThread(item.targetThreadId)} />}
      />
    );
  }
  if (item.type === "subagent") {
    return (
      <SubagentTimelineLink
        parentRef={scopeThreadRef(props.environmentId, item.threadId)}
        subagentId={item.subagentId}
        providerInstanceId={item.providerInstanceId}
        status={item.status}
        driver={item.driver}
        title={formatSubagentDisplayTitle(item.title ?? "Subagent")}
        result={item.result}
        progress={item.progress}
        startedAt={item.startedAt}
        completedAt={item.completedAt}
        threadId={item.childThreadId}
        onOpenThread={props.onOpenThread}
      />
    );
  }
  return null;
}

/** InlineButton: medium-weight text that underlines on hover. */
function InlineAction({ label, onClick, tone = "default" }: { label: string; onClick: () => void; tone?: "default" | "muted" }) {
  const theme = useTheme();
  const [hovered, hover] = useHover();
  return (
    <div {...hover} onClick={onClick} style={{ display: "flex", flexShrink: 0, cursor: "pointer" }}>
      <Text
        size="sm"
        weight={500}
        color={tone === "muted" && !hovered ? theme.mutedForeground : theme.foreground}
        style={hovered ? { textDecoration: "underline" } : {}}
      >
        {label}
      </Text>
    </div>
  );
}

// ── Subagent rows ───────────────────────────────────────────────────────────

const STATUS_VISUALS: Record<OrchestrationV2TurnItem["status"], { dot: (theme: Palette) => string; label: string }> = {
  pending: { dot: (theme) => theme.info, label: "Queued" },
  running: { dot: (theme) => theme.info, label: "Running" },
  waiting: { dot: (theme) => theme.info, label: "Waiting" },
  idle: { dot: (theme) => alpha(theme.mutedForeground, 0.5), label: "Idle · resumable" },
  completed: { dot: (theme) => theme.success, label: "Completed" },
  failed: { dot: (theme) => theme.error, label: "Failed" },
  cancelled: { dot: (theme) => alpha(theme.mutedForeground, 0.6), label: "Stopped" },
  interrupted: { dot: (theme) => alpha(theme.mutedForeground, 0.6), label: "Stopped" },
};

const SETTLED_SUBAGENT_STATUSES = new Set<OrchestrationV2TurnItem["status"]>(["completed", "failed", "cancelled", "interrupted"]);

const GENERIC_CHILD_END = /^Child task ended with status\b/i;

function plainDetail(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isoOrNull(value: DateTime.Utc | null | undefined): string | null {
  return value ? DateTime.formatIso(value) : null;
}

function formatElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** AgentElapsed.tsx: elapsed run time, ticking once a second while the agent works. */
export function AgentElapsed({
  agent,
}: {
  agent: { readonly status: OrchestrationV2TurnItem["status"]; readonly startedAt: string | null; readonly completedAt: string | null };
}) {
  const live = isOrchestrationV2WorkActive(agent.status) && agent.startedAt !== null;
  const now = useNowEverySecond(live);
  const elapsedMs = deriveSubagentElapsedMs(agent, now);
  return <>{elapsedMs === null ? "" : formatElapsedSeconds(elapsedMs / 1000)}</>;
}

/** A 24px provider avatar with an optional status dot at its bottom right. */
function SubagentAvatar({
  driver,
  displayName,
  status,
}: {
  driver?: ProviderDriverKind | undefined;
  displayName: string;
  status?: OrchestrationV2TurnItem["status"] | undefined;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        flexShrink: 0,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.7),
        backgroundColor: theme.appearance === "dark" ? "#161616" : theme.muted,
        // ring-2 ring-background
        boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 2, color: theme.background },
      }}
    >
      {driver ? <ProviderGlyph driver={driver} displayName={displayName} size={14} /> : <Icon name="bot" size={14} color={theme.mutedForeground} />}
      {status ? (
        <div
          style={{
            position: "absolute",
            // size-2 dot with a 2px ring, set 1px outside the avatar like web's -right-px -bottom-px.
            right: -3,
            bottom: -3,
            width: 12,
            height: 12,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: theme.background,
            backgroundColor: STATUS_VISUALS[status].dot(theme),
          }}
        />
      ) : null}
    </div>
  );
}

export function EnvironmentSubagentAvatar({
  environmentId,
  providerInstanceId,
  driver,
  status,
}: {
  environmentId: EnvironmentId;
  providerInstanceId: ProviderInstanceId;
  driver?: ProviderDriverKind | undefined;
  status?: OrchestrationV2TurnItem["status"] | undefined;
}) {
  const displayName = useAtomValue(serverEnvironment.providersValueAtom(environmentId), (providers) => {
    const provider = providers?.find((candidate) => candidate.instanceId === providerInstanceId);
    return driver ? providerDisplayName(driver, providerInstanceId, provider) : (provider?.displayName ?? providerInstanceId);
  });
  return <SubagentAvatar driver={driver} displayName={displayName} status={status} />;
}

const NOTIFICATION_OUTCOME_STATUS: Record<OrchestrationV2Notification["outcome"], OrchestrationV2TurnItem["status"] | null> = {
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  updated: null,
  unknown: null,
};

const NOTIFICATION_OUTCOME_LABEL: Record<OrchestrationV2Notification["outcome"], string> = {
  completed: "Finished",
  failed: "Failed",
  cancelled: "Stopped",
  updated: "Updated",
  unknown: "Finished",
};

/** V2LifecycleRow.tsx SubagentNotificationLink: a notification about a child thread renders as its subagent row. */
export function SubagentNotificationLink(props: {
  readonly parentRef: ScopedThreadRef;
  readonly childThreadId: ThreadId;
  readonly outcome: OrchestrationV2Notification["outcome"];
  readonly createdAt: string;
  readonly timestampFormat: TimestampFormat;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly fallback: ReactNode;
}) {
  const agent = useAtomValue(
    environmentThreadDetails.threadAtom(props.parentRef),
    (thread) => thread?.projection.subagents.find((candidate) => candidate.childThreadId === props.childThreadId) ?? null,
  );
  if (agent === null) return <>{props.fallback}</>;
  // A subagent resumed since this notification shows its live status, not the outcome reported then.
  const resumed = NOTIFICATION_OUTCOME_STATUS[props.outcome] !== null && subagentResumedSince(agent, props.createdAt);
  return (
    <SubagentTimelineLink
      parentRef={props.parentRef}
      subagentId={agent.id}
      providerInstanceId={agent.providerInstanceId}
      status={agent.status}
      driver={agent.driver}
      title={formatSubagentDisplayTitle(agent.title ?? "Subagent")}
      result={agent.result}
      progress={agent.progress}
      startedAt={agent.startedAt}
      completedAt={agent.completedAt}
      threadId={props.childThreadId}
      onOpenThread={props.onOpenThread}
      {...(resumed
        ? {}
        : {
            event: {
              status: NOTIFICATION_OUTCOME_STATUS[props.outcome],
              label: NOTIFICATION_OUTCOME_LABEL[props.outcome],
              timestamp: formatShortTimestamp(props.createdAt, props.timestampFormat),
            },
          })}
    />
  );
}

function SubagentTimelineLink(props: {
  readonly parentRef: ScopedThreadRef;
  readonly subagentId: NodeId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly title: string;
  readonly result: string | null;
  readonly progress: string | undefined;
  readonly status: OrchestrationV2TurnItem["status"];
  readonly startedAt: DateTime.Utc | null;
  readonly completedAt: DateTime.Utc | null;
  readonly threadId: ThreadId | null;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly event?: {
    readonly status: OrchestrationV2TurnItem["status"] | null;
    readonly label: string;
    readonly timestamp: string;
  };
}) {
  const theme = useTheme();
  const [hovered, hover] = useHover();
  const agent = useAtomValue(
    environmentThreadDetails.threadAtom(props.parentRef),
    (thread): OrchestrationV2Subagent | null => thread?.projection.subagents.find((candidate) => candidate.id === props.subagentId) ?? null,
  );
  const threadId = props.threadId;
  const liveStatus = agent?.status ?? props.status;
  const status = props.event ? props.event.status : liveStatus;
  const statusLabel = props.event?.label ?? STATUS_VISUALS[liveStatus].label;
  const result = (agent?.result ?? props.result)?.trim();
  const progress = (agent?.progress ?? props.progress)?.trim();
  const settled = SETTLED_SUBAGENT_STATUSES.has(status ?? liveStatus);
  const rawDetail = settled ? result || progress : progress || result;
  const detail = rawDetail && !GENERIC_CHILD_END.test(rawDetail) ? plainDetail(rawDetail) || null : null;
  const failed = status === "failed";
  const timing = {
    status: liveStatus,
    startedAt: isoOrNull(agent?.startedAt ?? props.startedAt),
    completedAt: isoOrNull(agent?.completedAt ?? props.completedAt),
  };
  const model = agent?.model ?? null;
  const tooltip = [props.title, model, statusLabel].filter(Boolean).join(" · ");
  const clickable = threadId !== null;
  return (
    <Tooltip content={tooltip} side="top">
      <div
        testId={`subagent-${props.subagentId}`}
        {...hover}
        onClick={clickable ? () => props.onOpenThread(threadId) : undefined}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          width: "100%",
          minWidth: 0,
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 6,
          paddingBottom: 6,
          borderRadius: RADIUS.md,
          ...(clickable ? { cursor: "pointer", hover: { backgroundColor: alpha(theme.accent, 0.2) } } : {}),
        }}
      >
        <EnvironmentSubagentAvatar
          environmentId={props.parentRef.environmentId}
          providerInstanceId={props.providerInstanceId}
          driver={props.driver}
          status={status ?? undefined}
        />
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Text size="xs" weight={500} truncate>
              {props.title}
            </Text>
            {detail !== null && (props.event !== undefined || status !== "completed") ? (
              <text style={{ color: failed ? theme.errorForeground : theme.mutedForeground, fontSize: 10, lineHeight: 14, fontFamily: FONTS.sans, flexShrink: 0 }}>
                {statusLabel}
              </text>
            ) : null}
          </div>
          <text
            style={{
              color: failed ? theme.errorForeground : theme.mutedForeground,
              fontSize: 11,
              lineHeight: 18,
              fontFamily: FONTS.sans,
              whiteSpace: "nowrap",
              textOverflow: detail !== null && detail.includes("/") && !detail.includes(" ") ? "ellipsis-start" : "ellipsis",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {detail === null ? statusLabel : detail}
          </text>
        </div>
        <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
          {props.event ? props.event.timestamp : <AgentElapsed agent={timing} />}
        </Text>
        {clickable ? <Icon name="chevron-right" size={14} color={hovered ? theme.foreground : alpha(theme.mutedForeground, 0.6)} /> : null}
      </div>
    </Tooltip>
  );
}

// ── Handoff ─────────────────────────────────────────────────────────────────

export function HandoffRow(props: {
  readonly environmentId: EnvironmentId;
  readonly endpoints: HandoffEndpoints;
  readonly pending?: boolean;
  readonly failed?: boolean;
}) {
  const { from, to } = props.endpoints;
  const theme = useTheme();
  return (
    <TimelineSystemDivider
      label={props.pending ? "Context handoff pending" : "Context handoff"}
      icon="arrow-right-left"
      showDetailSeparator={false}
      tone={props.failed ? "danger" : "neutral"}
      detail={
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0 }}>
          {from.map((endpoint, index) => (
            <div key={`${endpoint.instanceId}:${endpoint.model ?? ""}`} style={{ display: "flex", flexDirection: "row", alignItems: "center", minWidth: 0 }}>
              <HandoffEndpoint environmentId={props.environmentId} instanceId={endpoint.instanceId} model={endpoint.model} />
              {index < from.length - 1 ? (
                <Text size="2xs" color={theme.mutedForeground} style={{ marginLeft: 2 }}>
                  ,
                </Text>
              ) : null}
            </div>
          ))}
          {from.length > 0 ? <Icon name="arrow-right" size={12} color={theme.mutedForeground} /> : null}
          <HandoffEndpoint environmentId={props.environmentId} instanceId={to.instanceId} model={to.model} />
        </div>
      }
    />
  );
}

function HandoffEndpoint(props: { readonly environmentId: EnvironmentId; readonly instanceId: ProviderInstanceId; readonly model?: string | undefined }) {
  const theme = useTheme();
  const provider = useAtomValue(serverEnvironment.providersValueAtom(props.environmentId), (providers) =>
    providers?.find((candidate) => candidate.instanceId === props.instanceId),
  );
  const driver = (provider?.driver ?? props.instanceId) as ProviderDriverKind;
  const displayName = providerDisplayName(driver, props.instanceId, provider);
  const model = props.model?.trim();
  const providerModel = model ? provider?.models.find((candidate) => candidate.slug === model) : undefined;
  const label = providerModel ? (providerModel.shortName ?? providerModel.name) : model ? model : displayName;
  return (
    <Tooltip content={`${displayName} · ${label}`} side="top">
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        <ProviderGlyph driver={driver} displayName={displayName} size={14} />
        <Text size="2xs" weight={500} color={providerTextColor(driver, theme.foreground)} truncate>
          {label}
        </Text>
      </div>
    </Tooltip>
  );
}

// ── Secret requests ─────────────────────────────────────────────────────────

function SecretRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
}) {
  const theme = useTheme();
  const display = secretRequestDisplay(props.item, props.visibility);
  if (display.kind === "answered" || display.kind === "pending-elsewhere") {
    const icon: IconName = display.kind === "pending-elsewhere" ? "lock" : display.outcome === "saved" ? "check" : "minus";
    return (
      <WorkLogRow
        icon={<Icon name={icon} size={14} color={theme.mutedForeground} />}
        label={<WorkLogText>{`${props.item.label} · ${display.label}`}</WorkLogText>}
      />
    );
  }
  return <PendingSecretRequestForm environmentId={props.environmentId} item={props.item} />;
}

const MASK = "•";

/**
 * The secret field. gpuix inputs cannot mask, so the field shows bullets and
 * keeps the real text aside: typed or pasted characters append, deleting
 * trims from the end.
 */
function PendingSecretRequestForm(props: { readonly environmentId: EnvironmentId; readonly item: SecretRequestItem }) {
  const theme = useTheme();
  const { item } = props;
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const send = async (reply: { readonly type: "save"; readonly secret: string } | { readonly type: "decline" }) => {
    const input = secretRequestAnswerInput(item, reply);
    if (input === null || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await runAtomCommand(appAtomRegistry, serverEnvironment.answerSecretRequest, {
      environmentId: props.environmentId,
      input,
    }).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Success") {
      setSecret("");
      return;
    }
    if (!isAtomCommandInterrupted(result)) setError(secretRequestFailureMessage(squashAtomCommandFailure(result)));
  };

  const onMaskedChange = (value: string) => {
    if (value.length < secret.length && [...value].every((char) => char === MASK)) {
      setSecret(secret.slice(0, value.length));
      return;
    }
    const added = [...value].filter((char) => char !== MASK).join("");
    setSecret(secret + added);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, padding: 16, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: alpha(theme.border, 0.6), backgroundColor: theme.card }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <Text size="sm" weight={500}>
          {item.label}
        </Text>
        {item.reason.trim() ? (
          <Text size="sm" color={theme.mutedForeground}>
            {item.reason}
          </Text>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0, height: 32, alignItems: "center", paddingLeft: 10, paddingRight: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.input, backgroundColor: theme.appearance === "dark" ? "#ffffff05" : theme.popover }}>
          <input
            testId={`secret-input-${item.id}`}
            value={MASK.repeat(secret.length)}
            placeholder={item.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER}
            readOnly={submitting}
            onChange={(event) => onMaskedChange(event.value ?? "")}
            onSubmit={() => void send({ type: "save", secret })}
            style={{ flexGrow: 1, color: theme.foreground, fontSize: 14, fontFamily: FONTS.sans }}
          />
        </div>
        <Button disabled={submitting || secret.trim().length === 0} onClick={() => void send({ type: "save", secret })}>
          Save securely
        </Button>
      </div>
      {error !== null ? (
        <Text size="xs" color={theme.errorForeground}>
          {error}
        </Text>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Icon name="shield-check" size={14} color={theme.mutedForeground} />
          <Text size="xs" color={theme.mutedForeground} truncate>
            {SECRET_REQUEST_PRIVACY_NOTE}
          </Text>
        </div>
        <Button size="xs" variant="ghost-muted" disabled={submitting} onClick={() => void send({ type: "decline" })}>
          Decline
        </Button>
      </div>
    </div>
  );
}
