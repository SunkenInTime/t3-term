// The Lineage section of the thread details card: parent, forks, subagents and
// workflows, after apps/web/src/components/chat/{ThreadRelationshipsControl.tsx,
// ThreadLineageWorkflowRow.tsx,ThreadRelationshipIcon.tsx,AgentElapsed.tsx}.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import {
  deriveWorkflowGroups,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
  type SubagentWorkflowGroup,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { deriveProviderSubagentStatus } from "@t3tools/client-runtime/state/thread-execution";
import {
  deriveThreadRelationshipGraph,
  immediateThreadRelationships,
  isParentThreadRelationship,
  orderWebThreadLineageRows,
  resolveMergeBackTargetThreadId,
  threadRelationshipRowStatus,
  type ThreadRelationshipEdge,
  type ThreadRelationshipWalkRow,
} from "@t3tools/client-runtime/state/thread-relationships";
import {
  canDetachThreadProviderSession,
  resolveLatestMergeBackRun,
} from "@t3tools/client-runtime/state/thread-workflows";
import {
  isOrchestrationV2WorkActive,
  isProviderNativeSubagentThread,
  NodeId,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import { deriveSubagentElapsedMs } from "@t3tools/shared/orchestrationTiming";
import * as DateTime from "effect/DateTime";
import { Atom } from "effect/reactivity";
import { useState, type ReactElement, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/environment.ts";
import { orchestrationEnvironment } from "../../state/git.ts";
import { routeAtom } from "../../state/ui.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Menu, MenuItem, Tooltip } from "../../ui/overlay.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { useNowEverySecond } from "../timeline/parts.tsx";
import { GrowTooltip } from "./detailsTooltip.tsx";
import { SubagentRowHoverCard } from "../subagents/SubagentTooltipContent.tsx";
import {
  DetailsIconAction,
  DetailsSection,
  useDetailsTokens,
} from "./detailsControls.tsx";

const THREAD_LINEAGE_INITIAL_COUNT = 6;
const THREAD_LINEAGE_PAGE_COUNT = 12;

// ── ThreadRelationshipIcon.tsx ────────────────────────────────────────────

export function threadRelationshipStatusLabel(status: string | null): string {
  switch (status) {
    case "preparing":
    case "starting":
      return "Starting";
    case "running":
    case "in_progress":
      return "Running";
    case "pending":
    case "queued":
      return "Queued";
    case "waiting":
    case "blocked":
      return "Waiting";
    case "completed":
      return "Done";
    case "failed":
    case "error":
      return "Failed";
    case "cancelled":
    case "interrupted":
      return "Stopped";
    case "rolled_back":
      return "Reverted";
    case "resolved_native":
      return "Resolved (native)";
    case "resolved_portable":
      return "Resolved (portable)";
    case "consumed":
      return "Consumed";
    case "superseded":
      return "Superseded";
    case "idle":
      return "Idle";
    default:
      return "Unknown";
  }
}

function RelationshipIcon({ icon, status }: { icon: IconName; status: string | null }) {
  const theme = useTheme();
  const dot =
    status === "running" || status === "in_progress" || status === "pending" || status === "waiting"
      ? theme.info
      : status === "failed" || status === "error"
        ? theme.error
        : status === "completed"
          ? theme.success
          : alpha(theme.mutedForeground, 0.45);
  return (
    <div style={{ position: "relative", width: 16, height: 16, flexShrink: 0 }}>
      <Icon name={icon} size={16} color={theme.mutedForeground} />
      <div
        style={{
          position: "absolute",
          right: -4,
          bottom: -4,
          width: 8,
          height: 8,
          borderRadius: 4,
          borderWidth: 2,
          borderColor: theme.appearance === "dark" ? "#141414" : "#ffffff",
          backgroundColor: dot,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ── AgentElapsed.tsx ──────────────────────────────────────────────────────

function formatElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatCompactElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  if (minutes >= 600) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 6) / 10}h`;
}

/** Ticks once a second only while the agent works; a settled agent renders once. */
function AgentElapsed({
  agent,
  compact = false,
}: {
  agent: Pick<RuntimeSubagent, "status" | "startedAt" | "completedAt">;
  compact?: boolean;
}) {
  const theme = useTheme();
  const live = isOrchestrationV2WorkActive(agent.status);
  const now = useNowEverySecond(live && agent.startedAt !== null);
  if (!agent.startedAt) return null;
  const elapsedMs = deriveSubagentElapsedMs(
    { status: agent.status, startedAt: agent.startedAt, completedAt: agent.completedAt },
    now,
  );
  if (elapsedMs === null) return null;
  return (
    <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans, flexShrink: 0 }}>
      {(compact ? formatCompactElapsedSeconds : formatElapsedSeconds)(elapsedMs / 1000)}
    </text>
  );
}

// ── Shared row pieces ─────────────────────────────────────────────────────

function RowButton({
  children,
  onClick,
  disabled,
  tooltip,
  testId,
  split,
  onHoverChange,
  hoverCard,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tooltip: string;
  /** Wraps the row in a rich hover card (subagents) instead of the plain tooltip. */
  hoverCard?: (row: ReactElement) => ReactElement;
  testId?: string;
  split?: boolean;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const { hover } = useDetailsTokens();
  const interactive = !disabled && onClick !== undefined;
  const row = (
      <div
        testId={testId}
        onClick={interactive ? onClick : undefined}
        onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
        onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          height: 32,
          paddingLeft: 10,
          paddingRight: 10,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          borderRadius: RADIUS.lg,
          ...(split ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : {}),
          opacity: disabled ? 0.64 : 1,
          cursor: interactive ? "pointer" : "default",
          ...(interactive ? { hover: { backgroundColor: hover } } : {}),
        }}
      >
        {children}
      </div>
  );
  if (hoverCard) return hoverCard(row);
  return (
    <GrowTooltip content={tooltip} side="left">
      {row}
    </GrowTooltip>
  );
}

/** CollapsibleSectionHeader variant="panel": label, a 1px rule, an optional accessory, a chevron. */
function CollapsibleHeader({
  children,
  expanded,
  onClick,
  accessory,
  tone = "muted",
  testId,
}: {
  children: ReactNode;
  expanded: boolean;
  onClick: () => void;
  accessory?: ReactNode;
  tone?: "muted" | "emphasized";
  testId?: string;
}) {
  const theme = useTheme();
  const color =
    tone === "emphasized" ? alpha(theme.sidebar.foreground, 0.8) : alpha(theme.sidebar.mutedForeground, 0.6);
  const line = tone === "emphasized" ? alpha(theme.sidebar.foreground, 0.25) : alpha(theme.sidebar.border, 0.6);
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 32,
        paddingLeft: 8,
        paddingRight: 10,
        borderRadius: RADIUS.sm,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <text style={{ color, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans, flexShrink: 0 }}>{children}</text>
      <div style={{ height: 1, minWidth: 8, flexGrow: 1, backgroundColor: line }} />
      {accessory}
      <Icon name={expanded ? "chevron-down" : "chevron-up"} size={12} color={color} />
    </div>
  );
}

function SectionHeaderStatus({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <text style={{ color: theme.errorForeground, fontSize: 10, lineHeight: 12, fontFamily: FONTS.sans, flexShrink: 0 }}>{children}</text>
  );
}

// ── ThreadLineageWorkflowRow.tsx ──────────────────────────────────────────

function phaseElapsed(phase: SubagentWorkflowGroup["phases"][number]) {
  const instants = (key: "startedAt" | "completedAt") =>
    phase.members
      .map((member) => member[key])
      .filter((value) => value !== null)
      .sort();
  const running = phase.state === "running";
  const startedAt = instants("startedAt")[0] ?? null;
  const completedAt = running ? null : (instants("completedAt").at(-1) ?? null);
  return {
    status: running ? ("running" as const) : ("completed" as const),
    startedAt: running || completedAt !== null ? startedAt : null,
    completedAt,
  };
}

function phaseStatusLabel(phase: SubagentWorkflowGroup["phases"][number]) {
  if (phase.state === "running") return "running";
  if (phase.members.some((member) => member.status === "failed")) return "failed";
  if (phase.members.some((member) => member.status === "cancelled" || member.status === "interrupted")) {
    return "stopped";
  }
  return phase.state === "done" ? "done" : "not started";
}

function WorkflowMemberRow({
  member,
  onOpen,
  isThreadAvailable,
}: {
  member: RuntimeSubagent;
  onOpen: (threadId: string) => void;
  isThreadAvailable: (threadId: string) => boolean;
}) {
  const { label } = useDetailsTokens();
  const threadId = member.childThreadId;
  const canOpen = threadId !== null && isThreadAvailable(threadId);
  return (
    <div style={{ display: "flex", flexDirection: "row", flexShrink: 0, minWidth: 0 }}>
      <RowButton
        tooltip={`Open ${member.title} chat`}
        disabled={!canOpen}
        onClick={() => canOpen && threadId !== null && onOpen(threadId)}
      >
        <RelationshipIcon icon="bot" status={member.status} />
        <text style={{ color: label, fontSize: 13, lineHeight: 18, fontWeight: 500, fontFamily: FONTS.sans, flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
          {member.title}
        </text>
        {member.startedAt ? <AgentElapsed agent={member} /> : null}
      </RowButton>
    </div>
  );
}

function ThreadLineageWorkflowRow({
  group,
  header,
  onOpenThread,
  isThreadAvailable,
  onStop,
  stopping,
  stopDisabled,
}: {
  readonly group: SubagentWorkflowGroup;
  readonly header: ReactNode;
  readonly onOpenThread: (threadId: string) => void;
  readonly isThreadAvailable: (threadId: string) => boolean;
  readonly onStop?: (() => void) | undefined;
  readonly stopping: boolean;
  readonly stopDisabled: boolean;
}) {
  const { theme, hover, separator } = useDetailsTokens();
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [phaseOpen, setPhaseOpen] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  const label = group.workflow.workflowName ?? group.workflow.title;
  const phases = group.phases.filter((phase) => phase.members.length > 0);
  return (
    <div
      style={{ display: "flex", flexDirection: "column", flexShrink: 0, width: "100%", minWidth: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minWidth: 0, borderRadius: RADIUS.lg, backgroundColor: hovered ? hover : "#00000000" }}>
        {header}
        {onStop && hovered ? (
          <Tooltip content="Stop entire workflow" side="left">
            <DetailsIconAction icon={stopping ? "loader-circle" : "square"} color={theme.errorForeground} disabled={stopDisabled} onClick={onStop} />
          </Tooltip>
        ) : null}
        <div style={{ width: 1, height: 16, backgroundColor: separator, flexShrink: 0 }} />
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            flexShrink: 0,
            cursor: "pointer",
            borderTopRightRadius: RADIUS.lg,
            borderBottomRightRadius: RADIUS.lg,
            hover: { backgroundColor: hover },
          }}
        >
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
        </div>
      </div>
      {expanded ? (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 26 }}>
          {phases.map((phase) => {
            const open = phaseOpen.get(phase.index) ?? phase.state === "running";
            const status = phaseStatusLabel(phase);
            return (
              <div key={phase.index} style={{ display: "flex", flexDirection: "column" }}>
                <CollapsibleHeader
                  tone={phase.state === "running" ? "emphasized" : "muted"}
                  expanded={open}
                  onClick={() => setPhaseOpen((current) => new Map(current).set(phase.index, !open))}
                  accessory={
                    <>
                      {status === "failed" ? <SectionHeaderStatus>Failed</SectionHeaderStatus> : null}
                      <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans, flexShrink: 0 }}>
                        {`${phase.settledCount}/${phase.members.length} ${phase.members.length === 1 ? "agent" : "agents"}`}
                      </text>
                      <AgentElapsed agent={phaseElapsed(phase)} />
                    </>
                  }
                >
                  {phase.title}
                </CollapsibleHeader>
                {open
                  ? phase.members.map((member) => (
                      <WorkflowMemberRow key={member.id} member={member} onOpen={onOpenThread} isThreadAvailable={isThreadAvailable} />
                    ))
                  : null}
              </div>
            );
          })}
          {group.unphasedMembers.map((member) => (
            <WorkflowMemberRow key={member.id} member={member} onOpen={onOpenThread} isThreadAvailable={isThreadAvailable} />
          ))}
          {phases.length === 0 && group.unphasedMembers.length === 0 ? (
            <div style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6 }}>
              <text style={{ color: alpha(theme.mutedForeground, 0.7), fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans }}>No agents yet</text>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── ThreadRelationshipsControl.tsx ────────────────────────────────────────

function ThreadLineageGroup(props: {
  readonly label: string | null;
  readonly rows: ReadonlyArray<ThreadRelationshipWalkRow>;
  readonly expanded: boolean;
  readonly testId: string;
  readonly children: (rows: ReadonlyArray<ThreadRelationshipWalkRow>) => ReactNode;
}) {
  const theme = useTheme();
  const { hover } = useDetailsTokens();
  const [expanded, setExpanded] = useState(props.expanded);
  const [visibleCount, setVisibleCount] = useState(THREAD_LINEAGE_INITIAL_COUNT);
  if (props.rows.length === 0) return null;
  const visibleRows = props.rows.slice(0, visibleCount);
  const hiddenCount = props.rows.length - visibleRows.length;
  const failedCount = props.rows.filter(({ edge }) => edge.status === "failed" || edge.status === "error").length;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, width: "100%", minWidth: 0 }}>
      {props.label ? (
        <CollapsibleHeader
          testId={props.testId}
          expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          accessory={failedCount > 0 ? <SectionHeaderStatus>{`${failedCount} failed`}</SectionHeaderStatus> : null}
        >
          {expanded ? props.label : `${props.label} (${props.rows.length})`}
        </CollapsibleHeader>
      ) : null}
      {expanded ? (
        <>
          {/* Web caps this list at 13.5rem with its own scroller; the card is already the
              scroller and gpuix has no nested vertical scrolling, so "Show more" pages it. */}
          {props.children(visibleRows)}
          {hiddenCount > 0 ? (
            <div
              onClick={() => setVisibleCount((count) => count + THREAD_LINEAGE_PAGE_COUNT)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                height: 32,
                paddingLeft: 10,
                paddingRight: 10,
                borderRadius: RADIUS.lg,
                cursor: "pointer",
                hover: { backgroundColor: hover },
              }}
            >
              <Icon name="plus" size={16} color={alpha(theme.mutedForeground, 0.7)} />
              <text style={{ color: alpha(theme.mutedForeground, 0.7), fontSize: 14, lineHeight: 20, fontWeight: 500, fontFamily: FONTS.sans }}>
                {`Show ${Math.min(hiddenCount, THREAD_LINEAGE_PAGE_COUNT)} more`}
              </text>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function relationshipLabel(edge: ThreadRelationshipEdge, currentThreadId: ThreadId) {
  if (edge.kind === "transfer") return "Context transfer";
  if (edge.kind === "subagent") {
    return edge.sourceThreadId === currentThreadId ? "Subagent" : "Parent agent";
  }
  return edge.sourceThreadId === currentThreadId ? "Fork" : "Parent thread";
}

function currentSubagent<Agent extends RuntimeSubagent>(
  agent: Agent | undefined,
  childThread: OrchestrationV2ThreadShell | null | undefined,
): Agent | undefined {
  if (!agent || !childThread || isOrchestrationV2WorkActive(agent.status)) return agent;
  const liveStatus = childThread.activityRunStatus ?? (childThread.status === "queued" ? "queued" : null);
  const newerRun =
    childThread.latestRunRequestedAt &&
    DateTime.toEpochMillis(childThread.latestRunRequestedAt) >
      Date.parse(agent.completedAt ?? agent.startedAt ?? agent.updatedAt);
  if (!liveStatus && !newerRun) return agent;
  const status = liveStatus ?? childThread.status;
  const startedAt = liveStatus ? childThread.activityRunStartedAt : childThread.latestRunStartedAt;
  const completedAt = liveStatus ? null : childThread.latestRunCompletedAt;
  return {
    ...agent,
    status:
      status === "preparing" || status === "starting" || status === "queued"
        ? "pending"
        : status === "rolled_back"
          ? "interrupted"
          : status,
    startedAt: startedAt ? DateTime.formatIso(startedAt) : null,
    completedAt: completedAt ? DateTime.formatIso(completedAt) : null,
    progress: null,
    result: null,
    error: null,
  };
}

function shellParentThreadId(thread: Pick<OrchestrationV2ThreadShell, "forkedFrom" | "lineage">): ThreadId | null {
  return thread.forkedFrom?.type === "run" ? thread.forkedFrom.threadId : thread.lineage.parentThreadId;
}

/** apps/web/src/state/entities.ts selectThreadRelationshipShells. */
function selectThreadRelationshipShells(
  threadId: ThreadId,
  projection: Pick<OrchestrationV2ThreadProjection, "thread" | "subagents" | "contextTransfers"> | null,
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
): ReadonlyArray<OrchestrationV2ThreadShell> {
  const named = new Set<string>([threadId]);
  if (projection !== null) {
    const parentThreadId = shellParentThreadId(projection.thread);
    if (parentThreadId !== null) named.add(parentThreadId);
    for (const subagent of projection.subagents) {
      if (subagent.childThreadId !== null) named.add(subagent.childThreadId);
      for (const agent of subagent.workflow?.agents ?? []) {
        if (agent.childThreadId !== undefined) named.add(agent.childThreadId);
      }
    }
    for (const transfer of projection.contextTransfers) {
      named.add(transfer.sourceThreadId);
      named.add(transfer.targetThreadId);
    }
  }
  const current = threads.find((thread) => thread.id === threadId);
  const currentParentId = current === undefined ? null : shellParentThreadId(current);
  if (currentParentId !== null) named.add(currentParentId);
  return threads.filter((thread) => named.has(thread.id) || shellParentThreadId(thread) === threadId);
}

const EMPTY_PROJECTION_ATOM = Atom.make(null);

export function ThreadRelationshipsSection({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const theme = useTheme();
  const { separator } = useDetailsTokens();
  const ref = scopeThreadRef(environmentId, threadId);
  const projection = useAtomValue(environmentThreadDetails.threadAtom(ref))?.projection ?? null;
  const environmentThreads = useAtomValue(environmentThreadShells.environmentThreadsAtom(environmentId));
  const relationshipShells = selectThreadRelationshipShells(threadId, projection, environmentThreads);
  const currentThread = projection?.thread ?? relationshipShells.find((thread) => thread.id === threadId);
  const parentThreadId =
    currentThread?.forkedFrom?.type === "run" ? currentThread.forkedFrom.threadId : currentThread?.lineage.parentThreadId;
  const parentShell = parentThreadId ? relationshipShells.find((thread) => thread.id === parentThreadId) : undefined;
  const parentRef = parentShell && isProviderNativeSubagentThread(parentShell) ? scopeThreadRef(environmentId, parentShell.id) : null;
  const parentProjection =
    useAtomValue(parentRef === null ? EMPTY_PROJECTION_ATOM : environmentThreadDetails.threadAtom(parentRef))?.projection;
  const setRoute = useAtomSet(routeAtom);
  const canOperateWorkflow = useAtomValue(orchestrationEnvironment.stopWorkflow.permissionAtom(environmentId));
  const [busyAction, setBusyAction] = useState<"merge" | "detach" | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const parentNativeStatus = parentProjection ? deriveProviderSubagentStatus(parentProjection)?.status : undefined;
  const projected = projection?.subagents ?? [];
  const runtimeSubagents = projectedSubagentsToRuntime(projected);
  const byId = new Map(runtimeSubagents.map((agent) => [agent.id, agent]));
  const subagentsByThreadId = new Map(
    projected
      .filter((subagent) => subagent.childThreadId !== null)
      .map((subagent) => [
        subagent.childThreadId,
        {
          ...byId.get(subagent.id)!,
          id: subagent.id,
          threadId: subagent.threadId,
          runId: subagent.runId,
          nativeTaskRef: subagent.nativeTaskRef,
          nativeStatus: subagent.status,
          driver: subagent.driver,
          providerInstanceId: subagent.providerInstanceId,
          origin: subagent.origin,
          modelSelection: subagent.modelSelection,
        },
      ]),
  );
  const workflowGroupsById = new Map(deriveWorkflowGroups(runtimeSubagents).map((group) => [group.workflow.id, group]));
  const graph = deriveThreadRelationshipGraph({ threads: relationshipShells, projection });
  const latestMergeBackRun = projection === null ? null : resolveLatestMergeBackRun(projection);
  const mergeTargetThreadId = resolveMergeBackTargetThreadId(projection);
  const relationshipRows = orderWebThreadLineageRows({
    graph,
    rows: immediateThreadRelationships(graph, threadId),
    currentThreadId: threadId,
    mergeTargetThreadId,
  }).map((row) => {
    const agent =
      row.edge.kind === "subagent" && !isParentThreadRelationship(row.edge, threadId)
        ? subagentsByThreadId.get(row.threadId)
        : undefined;
    const workflowGroup = agent === undefined ? undefined : workflowGroupsById.get(agent.id);
    return workflowGroup === undefined ? row : { ...row, edge: { ...row.edge, status: workflowGroup.workflow.status } };
  });
  const canMerge = mergeTargetThreadId !== null && latestMergeBackRun !== null;
  const canDetach = projection ? canDetachThreadProviderSession(projection) : false;

  const related: ThreadRelationshipWalkRow[] = [];
  const active: ThreadRelationshipWalkRow[] = [];
  const previous: ThreadRelationshipWalkRow[] = [];
  for (const row of relationshipRows) {
    if (row.edge.kind !== "subagent" || isParentThreadRelationship(row.edge, threadId)) related.push(row);
    else if (["completed", "failed", "error", "cancelled", "interrupted", "idle"].includes(row.edge.status ?? "")) previous.push(row);
    else active.push(row);
  }
  const groups = [
    { id: "related", label: null, rows: related, expanded: true },
    { id: "active", label: null, rows: active, expanded: true },
    { id: "previous", label: "Previous agents", rows: previous, expanded: false },
  ];
  const runningCount =
    (projection?.subagents.filter((agent) => agent.childThreadId === null && agent.status === "running").length ?? 0) +
    active.filter(({ edge }) => edge.status === "running").length;

  if (relationshipRows.length === 0 && runningCount === 0) return null;

  const openThread = (target: ThreadId) => setRoute({ kind: "thread", environmentId, threadId: target });

  const merge = async () => {
    if (!latestMergeBackRun || mergeTargetThreadId === null || busyAction !== null) return;
    setBusyAction("merge");
    const result = await runAtomCommand(appAtomRegistry, threadEnvironment.mergeBack, {
      environmentId,
      input: { sourceThreadId: threadId, targetThreadId: mergeTargetThreadId, runId: latestMergeBackRun.id },
    });
    setBusyAction(null);
    if (result._tag === "Success") openThread(mergeTargetThreadId);
  };

  const detach = async () => {
    if (!canDetach || busyAction !== null) return;
    setBusyAction("detach");
    await runAtomCommand(appAtomRegistry, threadEnvironment.stopSession, { environmentId, input: { threadId } });
    setBusyAction(null);
  };

  const stopSubagent = async (childThreadId: ThreadId, agent: Pick<OrchestrationV2Subagent, "id" | "threadId">) => {
    if (stoppingId !== null) return;
    setStoppingId(childThreadId);
    const result = await runAtomCommand(appAtomRegistry, threadEnvironment.interruptTurn, {
      environmentId,
      input: { threadId: agent.threadId, subagentId: agent.id },
    });
    setStoppingId(null);
    if (result._tag === "Failure") toast({ type: "error", title: "Could not stop subagent" });
  };

  const stopWorkflow = async (subagentId: string) => {
    if (stoppingId !== null) return;
    setStoppingId(subagentId);
    const result = await runAtomCommand(appAtomRegistry, orchestrationEnvironment.stopWorkflow, {
      environmentId,
      input: { threadId, subagentId: NodeId.make(subagentId) },
    });
    setStoppingId(null);
    if (result._tag === "Failure") toast({ type: "error", title: "Could not stop workflow" });
  };

  const parentTitle = mergeTargetThreadId === null ? null : (graph.nodes.get(mergeTargetThreadId)?.thread?.title ?? null);

  return (
    <DetailsSection
      testId="details-lineage"
      title={runningCount > 0 ? `Lineage · ${runningCount} running` : "Lineage"}
      actions={
        canDetach ? (
          <Menu
            align="end"
            minWidth={240}
            trigger={({ toggle }) => (
              <DetailsIconAction icon="ellipsis" onClick={toggle} disabled={busyAction !== null} testId="details-lineage-more" />
            )}
          >
            <MenuItem icon="unplug" onSelect={() => void detach()}>
              Disconnect agent session
            </MenuItem>
          </Menu>
        ) : null
      }
    >
      {groups.map((group) => (
        <ThreadLineageGroup
          key={`${scopedThreadKey(ref)}:${group.id}`}
          label={group.label}
          rows={group.rows}
          expanded={group.expanded}
          testId={`details-lineage-${group.id}`}
        >
          {(visibleRows) =>
            visibleRows.map(({ threadId: rowThreadId, edge }) => {
              const node = graph.nodes.get(rowThreadId);
              const isSubagent = edge.kind === "subagent";
              const isMergeTarget = rowThreadId === mergeTargetThreadId;
              const isParent = isParentThreadRelationship(edge, threadId);
              const rowStatus =
                (isParent && rowThreadId === parentRef?.threadId
                  ? (node?.thread?.activityRunStatus ?? parentNativeStatus)
                  : undefined) ?? threadRelationshipRowStatus(graph, { threadId: rowThreadId, edge });
              const icon: IconName = isParent ? "corner-left-up" : isSubagent ? "bot" : "git-fork";
              const relationship = relationshipLabel(edge, threadId);
              const projectedAgent = isSubagent && !isParent ? subagentsByThreadId.get(rowThreadId) : undefined;
              const workflowGroup = projectedAgent === undefined ? undefined : workflowGroupsById.get(projectedAgent.id);
              const agent = workflowGroup ? projectedAgent : currentSubagent(projectedAgent, node?.thread);
              const failed = rowStatus === "failed" || rowStatus === "error";
              const canStop =
                agent &&
                (agent.origin === "app_owned" ||
                  (agent.origin === "provider_native" &&
                    agent.driver === "claudeAgent" &&
                    agent.runId != null &&
                    agent.nativeTaskRef?.strength === "strong" &&
                    agent.nativeTaskRef.nativeId !== null &&
                    ["pending", "running", "waiting"].includes(agent.nativeStatus))) &&
                agent.startedAt &&
                ["pending", "running", "waiting"].includes(agent.status);
              const rawTitle = workflowGroup?.workflow.workflowName ?? node?.thread?.title ?? agent?.title ?? rowThreadId;
              const threadTitle = isSubagent ? formatSubagentDisplayTitle(rawTitle) : rawTitle;
              const canStopWorkflow =
                canOperateWorkflow &&
                workflowGroup?.workflow.status === "running" &&
                agent?.origin === "provider_native" &&
                agent.driver === "claudeAgent";
              const hovered = hoveredRow === rowThreadId;
              const hideTrailing = hovered && (workflowGroup ? canStopWorkflow : Boolean(canStop));
              const tooltip = node?.missing
                ? "This related thread is unavailable"
                : agent
                  ? `${threadTitle} · ${threadRelationshipStatusLabel(agent.status)}`
                  : `Open ${relationship.toLowerCase()} in this chat`;
              const content = (
                <>
                  <RelationshipIcon icon={icon} status={rowStatus} />
                  <text
                    style={{
                      color: alpha(theme.foreground, 0.85),
                      fontSize: 14,
                      lineHeight: 16,
                      fontWeight: 500,
                      fontFamily: FONTS.sans,
                      flexGrow: 1,
                      flexShrink: 1,
                      minWidth: 0,
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      overflow: "hidden",
                    }}
                  >
                    {threadTitle}
                  </text>
                  {agent ? null : hovered ? <Icon name="arrow-right" size={12} color={theme.mutedForeground} /> : null}
                  {hideTrailing ? null : agent && !failed && deriveSubagentElapsedMs(agent, 0) !== null ? (
                    <AgentElapsed agent={agent} compact />
                  ) : !isMergeTarget && !workflowGroup ? (
                    <text style={{ color: failed ? theme.errorForeground : theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans, flexShrink: 0 }}>
                      {threadRelationshipStatusLabel(rowStatus)}
                    </text>
                  ) : null}
                </>
              );
              const link = (
                <RowButton
                  testId={`details-lineage-row-${rowThreadId}`}
                  tooltip={tooltip}
                  disabled={node?.missing === true}
                  split={Boolean(workflowGroup) || isMergeTarget}
                  onClick={() => openThread(rowThreadId)}
                  onHoverChange={(value) => setHoveredRow(value ? rowThreadId : null)}
                  {...(agent && !node?.missing
                    ? {
                        // web ThreadRelationshipsControl: subagent rows show SubagentTooltipContent.
                        hoverCard: (row: ReactElement) => (
                          <SubagentRowHoverCard
                            environmentId={environmentId}
                            parentThreadId={threadId}
                            childThreadId={rowThreadId}
                            title={threadTitle}
                            model={agent.model}
                            providerInstanceId={agent.providerInstanceId}
                            origin={agent.origin}
                            modelSelection={agent.modelSelection}
                            driver={agent.driver}
                            elapsed={<AgentElapsed agent={agent} />}
                            status={agent.status as never}
                            result={agent.result}
                            progress={agent.progress}
                            rootStyle={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}
                            side="left"
                          >
                            {row}
                          </SubagentRowHoverCard>
                        ),
                      }
                    : {})}
                >
                  {content}
                </RowButton>
              );
              if (workflowGroup && agent) {
                return (
                  <ThreadLineageWorkflowRow
                    key={rowThreadId}
                    group={workflowGroup}
                    onOpenThread={(memberThreadId) => openThread(memberThreadId as ThreadId)}
                    isThreadAvailable={(memberThreadId) => graph.nodes.get(memberThreadId as ThreadId)?.missing === false}
                    onStop={canStopWorkflow ? () => void stopWorkflow(agent.id) : undefined}
                    stopping={stoppingId === agent.id}
                    stopDisabled={stoppingId !== null}
                    header={link}
                  />
                );
              }
              return (
                <div key={rowThreadId} style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 32, flexShrink: 0, width: "100%", minWidth: 0 }}>
                  {isMergeTarget ? (
                    <>
                      {link}
                      <div style={{ width: 1, height: 16, backgroundColor: separator, flexShrink: 0 }} />
                      <Tooltip
                        content={
                          latestMergeBackRun === null
                            ? "Complete a run in this fork before merging it back"
                            : parentTitle
                              ? `Merge this conversation back into ${parentTitle}`
                              : "Merge this conversation back into its source"
                        }
                        side="left"
                      >
                        <DetailsIconAction
                          icon={busyAction === "merge" ? "loader-circle" : "git-merge"}
                          disabled={!canMerge || busyAction !== null}
                          onClick={() => void merge()}
                          testId="details-lineage-merge"
                        />
                      </Tooltip>
                      <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans, paddingLeft: 4, paddingRight: 10, flexShrink: 0 }}>
                        {threadRelationshipStatusLabel(rowStatus)}
                      </text>
                    </>
                  ) : (
                    link
                  )}
                  {canStop && agent && hovered ? (
                    <Tooltip content="Stop subagent" side="left">
                      <DetailsIconAction
                        icon={stoppingId === rowThreadId ? "loader-circle" : "square"}
                        color={theme.errorForeground}
                        disabled={stoppingId !== null}
                        onClick={() => void stopSubagent(rowThreadId, agent)}
                      />
                    </Tooltip>
                  ) : null}
                </div>
              );
            })
          }
        </ThreadLineageGroup>
      ))}
    </DetailsSection>
  );
}
