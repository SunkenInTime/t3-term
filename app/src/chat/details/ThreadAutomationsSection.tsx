// Scheduled tasks bound to this thread, after apps/web/src/components/chat/ThreadAutomationsPanel.tsx.
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskSchedule,
  type ThreadId,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { serverEnvironment } from "../../state/environment.ts";
import { openScheduledTaskSettings } from "../../settings/navigation.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Switch, Tooltip } from "../../ui/overlay.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha } from "../../ui/theme.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { readEnvironmentScope } from "../../web/state/session.ts";
import { DetailsIconAction, DetailsSection, useDetailsTokens } from "./detailsControls.tsx";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** apps/web/src/components/settings/ScheduledTasksSettings.tsx `scheduleLabel`. */
function scheduleLabel(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "webhook") return "On webhook";
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / 60_000;
    return Number.isInteger(minutes)
      ? `Every ${minutes} min`
      : `Every ${Math.round(schedule.everyMs / 1000)} sec`;
  }
  const weekdays = schedule.weekdays ?? [];
  const days =
    weekdays.length === 0
      ? "Daily"
      : weekdays.length === 5 && weekdays.every((day) => day >= 1 && day <= 5)
        ? "Weekdays"
        : weekdays.map((day) => WEEKDAY_LABELS[day]).join(", ");
  return `${days} at ${schedule.timeOfDay}`;
}

/** "in 5m" for upcoming runs (ScheduledRelativeLabel). */
function relativeLabel(value: string | null, nowMs: number): string {
  if (!value) return "Not scheduled";
  const diffMs = new Date(value).getTime() - nowMs;
  if (diffMs <= 0) return "now";
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 2) return "in under a minute";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

// A minute tick, the label's own clock (web's useNowMinute).
function useNowMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function taskScheduleLine(task: ScheduledTask, nowMs: number): string {
  const base = scheduleLabel(task.schedule);
  if (task.enabled && task.nextRunAt !== null) return `${base} · next ${relativeLabel(task.nextRunAt, nowMs)}`;
  return task.enabled ? base : `${base} · paused`;
}

export function ThreadAutomationsSection({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const { theme, label } = useDetailsTokens();
  const canOperate = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const tasksQuery = useEnvironmentQuery(serverEnvironment.scheduledTasksLive({ environmentId, input: {} }));
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const nowMs = useNowMinute();

  const boundTasks = (tasksQuery.data?.tasks ?? []).filter((task) => task.threadId === threadId);
  if (tasksQuery.error === null && boundTasks.length === 0) return null;

  const reportFailure = (title: string, error: unknown) =>
    toast({ type: "error", title, description: error instanceof Error ? error.message : String(error) });

  const toggleEnabled = async (task: ScheduledTask, enabled: boolean) => {
    if (busyTaskId !== null || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    setBusyTaskId(task.id);
    // Partial update: only the enabled flag changes, so a toggle never reverts edits made elsewhere.
    const result = await runAtomCommand(appAtomRegistry, serverEnvironment.setScheduledTaskEnabled, {
      environmentId,
      input: { id: task.id, enabled },
    });
    setBusyTaskId(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not update automation", squashAtomCommandFailure(result));
    }
  };

  const runNow = async (task: ScheduledTask) => {
    if (busyTaskId !== null || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    setBusyTaskId(task.id);
    const result = await runAtomCommand(appAtomRegistry, serverEnvironment.runScheduledTaskNow, {
      environmentId,
      input: { id: task.id },
    });
    setBusyTaskId(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not run automation", squashAtomCommandFailure(result));
    }
  };

  const statusDot: Record<ScheduledTask["lastRunStatus"], string> = {
    never: alpha(theme.mutedForeground, 0.4),
    running: "#0ea5e9",
    succeeded: "#10b981",
    failed: theme.error,
  };
  // web ThreadAutomationsPanel: Manage opens this environment's tasks; Edit opens the task's editor.
  const openSettings = () => openScheduledTaskSettings({ environmentId });

  return (
    <DetailsSection
      title="Automations"
      testId="details-automations"
      actions={
        <Tooltip content="Manage scheduled tasks">
          <DetailsIconAction icon="settings-2" onClick={openSettings} testId="details-automations-manage" />
        </Tooltip>
      }
    >
      {tasksQuery.error !== null ? (
        <div style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6 }}>
          <text style={{ color: theme.errorForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans }}>
            {`Could not load automations: ${tasksQuery.error}`}
          </text>
        </div>
      ) : null}
      {boundTasks.map((task) => (
        <div
          key={task.id}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 6,
            paddingBottom: 6,
            borderRadius: RADIUS.lg,
            flexShrink: 0,
          }}
        >
          <div style={{ position: "relative", width: 16, height: 16, flexShrink: 0 }}>
            <Icon name="calendar-clock" size={16} color={theme.mutedForeground} />
            <div
              style={{
                position: "absolute",
                right: -4,
                top: -4,
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: statusDot[task.lastRunStatus],
                pointerEvents: "none",
              }}
            />
          </div>
          <Tooltip content={`${task.title}\n${taskScheduleLine(task, nowMs)}`} side="left">
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
              <text
                style={{ color: label, fontSize: 14, lineHeight: 20, fontWeight: 500, fontFamily: FONTS.sans, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
              >
                {task.title}
              </text>
              <text
                style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
              >
                {taskScheduleLine(task, nowMs)}
              </text>
            </div>
          </Tooltip>
          <Tooltip content="Edit automation">
            <DetailsIconAction icon="pencil" onClick={() => openScheduledTaskSettings({ environmentId, taskId: task.id })} testId={`details-automation-edit-${task.id}`} />
          </Tooltip>
          {/* A webhook task runs from its URL; there is no request to run it with. */}
          {task.schedule.type === "webhook" ? null : (
            <Tooltip content="Run now">
              <DetailsIconAction
                icon="play"
                disabled={!canOperate || busyTaskId !== null || task.lastRunStatus === "running"}
                onClick={() => void runNow(task)}
                testId={`details-automation-run-${task.id}`}
              />
            </Tooltip>
          )}
          <Switch
            checked={task.enabled}
            disabled={!canOperate || busyTaskId !== null}
            onChange={(enabled) => void toggleEnabled(task, enabled)}
            testId={`details-automation-toggle-${task.id}`}
          />
        </div>
      ))}
    </DetailsSection>
  );
}
