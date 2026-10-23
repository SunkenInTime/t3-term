// apps/web/src/components/chat/WorktreeSetupCard.tsx: worktree preparation
// stages, the setup script's output tail, and the Details / terminal / cancel
// actions. Web spins and shimmers running stages; t3-term shows them static
// (no continuously repainting animation), with elapsed times ticking once a second.
import {
  worktreeSetupStageLabel,
  type WorktreeSetupSnapshot,
  type WorktreeSetupStage,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { useState } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, type Palette, useTheme } from "../../ui/theme.ts";
import { useNowEverySecond } from "./parts.tsx";
import { WorkLogRow, WorkLogText } from "./WorkLog.tsx";

interface WorktreeSetupCardProps {
  snapshot: WorktreeSetupSnapshot;
  onCancel: (() => void) | null;
  onWorkLocally: (() => void) | null;
  onOpenTerminal: (() => void) | null;
}

function stageElapsedMs(stage: WorktreeSetupStage, nowMs: number): number | null {
  if (!stage.startedAt) return null;
  const start = Date.parse(stage.startedAt);
  const end = stage.endedAt ? Date.parse(stage.endedAt) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

const STAGE_ICONS: Record<WorktreeSetupStage["status"], IconName> = {
  done: "check",
  running: "loader-circle",
  failed: "x",
  warning: "circle-alert",
  skipped: "minus",
  pending: "circle",
};

function StageIcon({ status }: { status: WorktreeSetupStage["status"] }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", opacity: status === "pending" ? 0.4 : 1 }}>
      <Icon name={STAGE_ICONS[status]} size={16} color={theme.mutedForeground} />
    </div>
  );
}

function stageColor(theme: Palette, status: WorktreeSetupStage["status"]): { color: string; opacity?: number } {
  switch (status) {
    case "failed":
      return { color: theme.errorForeground };
    case "warning":
      return { color: theme.warningForeground };
    case "pending":
      return { color: theme.mutedForeground, opacity: 0.4 };
    default:
      return { color: theme.mutedForeground };
  }
}

function headerLabel(snapshot: WorktreeSetupSnapshot): string {
  switch (snapshot.phase) {
    case "running":
      return "Setting up worktree…";
    case "done":
      return snapshot.stages.some((stage) => stage.status === "failed") ? "Worktree ready, setup script failed" : "Worktree ready";
    case "failed":
      return "Worktree setup failed";
    case "cancelled":
      return "Worktree setup cancelled";
  }
}

function MetaText({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
      {children}
    </Text>
  );
}

function SetupHeaderRow({ snapshot, totalElapsed }: { snapshot: WorktreeSetupSnapshot; totalElapsed: number | null }) {
  const theme = useTheme();
  const failed = snapshot.phase === "failed";
  const finishedWithFailedStage = snapshot.phase === "done" && snapshot.stages.some((stage) => stage.status === "failed");
  const tone = failed ? theme.errorForeground : finishedWithFailedStage ? theme.warningForeground : theme.mutedForeground;
  return (
    <div style={{ borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6), paddingBottom: 8, paddingTop: 4 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 24, minWidth: 0, paddingLeft: 4, paddingRight: 4 }}>
        <Text size="sm" color={tone} truncate style={{ lineHeight: 23, flexShrink: 1 }}>
          {headerLabel(snapshot)}
        </Text>
        <div style={{ flexGrow: 1 }} />
        {totalElapsed !== null ? <MetaText>{formatDuration(totalElapsed)}</MetaText> : null}
      </div>
    </div>
  );
}

function StageRow({ stage, nowMs, scriptName }: { stage: WorktreeSetupStage; nowMs: number; scriptName: string | null }) {
  const theme = useTheme();
  const elapsed = stageElapsedMs(stage, nowMs);
  const label = stage.id === "setup-script" && scriptName ? scriptName : worktreeSetupStageLabel(stage.id);
  const trailing =
    stage.status === "pending"
      ? null
      : stage.status === "skipped"
        ? (stage.detail ?? "skipped")
        : stage.id === "checkout" && stage.status === "running" && stage.percent !== null
          ? `${stage.percent}%`
          : stage.detail;
  const tone = stageColor(theme, stage.status);
  return (
    <WorkLogRow
      testId={`worktree-stage-${stage.id}`}
      icon={<StageIcon status={stage.status} />}
      label={
        <WorkLogText color={tone.color} {...(tone.opacity === undefined ? {} : { style: { opacity: tone.opacity } })}>
          {label}
        </WorkLogText>
      }
      trailing={
        <>
          {trailing ? (
            <Text size="xs" color={theme.mutedForeground} truncate style={{ minWidth: 0 }}>
              {trailing}
            </Text>
          ) : null}
          {elapsed !== null && stage.status !== "skipped" && stage.status !== "pending" ? <MetaText>{formatDuration(elapsed)}</MetaText> : null}
        </>
      }
    />
  );
}

const OUTPUT_TAIL_LINES = 4;

function OutputTail({ lines, failed }: { lines: ReadonlyArray<string>; failed: boolean }) {
  const theme = useTheme();
  const rows = Array.from({ length: OUTPUT_TAIL_LINES }, (_, slot) => lines[lines.length - OUTPUT_TAIL_LINES + slot] ?? "");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        marginBottom: 4,
        marginLeft: 32,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: failed ? alpha(theme.error, 0.2) : theme.border,
        backgroundColor: failed ? alpha(theme.error, theme.appearance === "dark" ? 0.16 : 0.08) : theme.codeBackground,
        overflow: "hidden",
      }}
    >
      {rows.map((line, slot) => (
        <text
          key={slot}
          style={{
            color: failed ? theme.errorForeground : theme.mutedForeground,
            fontSize: 11,
            lineHeight: 18,
            fontFamily: FONTS.mono,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
          }}
        >
          {line.length === 0 ? " " : line}
        </text>
      ))}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 12, minWidth: 0 }}>
      <Text size="xs" color={alpha(theme.foreground, 0.8)} style={{ width: 44, flexShrink: 0 }}>
        {label}
      </Text>
      <text
        style={{
          color: theme.mutedForeground,
          fontSize: 12,
          lineHeight: 16,
          fontFamily: FONTS.mono,
          whiteSpace: "nowrap",
          textOverflow: label === "Setup" ? "ellipsis" : "ellipsis-start",
          overflow: "hidden",
          minWidth: 0,
          flexGrow: 1,
          flexBasis: 0,
        }}
      >
        {value}
      </text>
    </div>
  );
}

function SetupDetails({ snapshot }: { snapshot: WorktreeSetupSnapshot }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4, marginBottom: 6, marginLeft: 32 }}>
      {snapshot.branch ? <DetailRow label="Branch" value={snapshot.branch} /> : null}
      {snapshot.baseRef ? <DetailRow label="Base" value={snapshot.baseRef} /> : null}
      {snapshot.worktreePath ? <DetailRow label="Path" value={snapshot.worktreePath} /> : null}
      {snapshot.setupScript ? <DetailRow label="Setup" value={snapshot.setupScript.command} /> : null}
    </div>
  );
}

function CollapsedSummaryRow({ snapshot, totalElapsed }: { snapshot: WorktreeSetupSnapshot; totalElapsed: number | null }) {
  const theme = useTheme();
  const status: WorktreeSetupStage["status"] =
    snapshot.phase === "failed" || snapshot.phase === "cancelled"
      ? "failed"
      : snapshot.stages.some((stage) => stage.id === "setup-script" && stage.status === "failed")
        ? "failed"
        : "done";
  return (
    <WorkLogRow
      icon={<StageIcon status={status} />}
      label={<WorkLogText color={stageColor(theme, status).color}>{headerLabel(snapshot)}</WorkLogText>}
      trailing={totalElapsed !== null ? <MetaText>{formatDuration(totalElapsed)}</MetaText> : null}
    />
  );
}

export function WorktreeSetupCard({
  snapshot,
  onCancel,
  onWorkLocally,
  onOpenTerminal,
  embedded = false,
}: WorktreeSetupCardProps & { embedded?: boolean }) {
  const running = snapshot.phase === "running";
  const nowMs = useNowEverySecond(running);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const start = Date.parse(snapshot.startedAt);
  const end = snapshot.endedAt ? Date.parse(snapshot.endedAt) : nowMs;
  const totalElapsed = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  const setupStage = snapshot.stages.find((stage) => stage.id === "setup-script");
  const showTerminal = onOpenTerminal && setupStage && setupStage.status !== "pending";
  const collapsed = embedded && !running;
  const showHeader = !embedded && !running && snapshot.phase !== "done";
  const showTail =
    setupStage !== undefined && (setupStage.status === "failed" || (setupStage.status === "running" && setupStage.tail.length > 0));
  const theme = useTheme();

  return (
    <div testId="worktree-setup-card" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {showHeader ? <SetupHeaderRow snapshot={snapshot} totalElapsed={totalElapsed} /> : null}
      {collapsed ? (
        <CollapsedSummaryRow snapshot={snapshot} totalElapsed={totalElapsed} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", ...(showHeader ? { paddingTop: 6 } : {}) }}>
          {snapshot.stages.map((stage) => (
            <div key={stage.id} style={{ display: "flex", flexDirection: "column" }}>
              <StageRow stage={stage} nowMs={nowMs} scriptName={snapshot.setupScript?.name ?? null} />
              {stage.id === "setup-script" && showTail ? <OutputTail lines={stage.tail} failed={stage.status === "failed"} /> : null}
            </div>
          ))}
        </div>
      )}
      {snapshot.phase === "failed" && snapshot.error ? (
        <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 4, marginLeft: 32 }}>
          {snapshot.error}
        </Text>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 2, marginTop: 2, marginLeft: 19 }}>
        <Button size="xs" variant="ghost-muted" icon={detailsOpen ? "chevron-down" : "chevron-right"} onClick={() => setDetailsOpen((open) => !open)} testId="worktree-setup-details">
          Details
        </Button>
        {showTerminal ? (
          <Button size="xs" variant="ghost-muted" icon="terminal" onClick={onOpenTerminal}>
            Open terminal
          </Button>
        ) : null}
        {onWorkLocally ? (
          <Button size="xs" variant="ghost-muted" icon="laptop" onClick={onWorkLocally}>
            Work locally
          </Button>
        ) : null}
        {onCancel && running ? (
          <Button size="xs" variant="ghost-muted" icon="x" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      {detailsOpen ? <SetupDetails snapshot={snapshot} /> : null}
    </div>
  );
}
