// Port of apps/web/src/components/settings/ScheduledTasksSettings.tsx: tasks per
// environment (live subscription), the row actions (enable, edit, run now,
// deliveries, delete) and the editor dialog with its fixed-time, interval and
// webhook schedules. T3 Connect webhook delivery mode is absent: t3-term has no
// cloud link. Spinners are static glyphs (no repainting animation).
import { useAtomValue } from "@effect/atom-react";
import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import {
  DEFAULT_WEBHOOK_PROMPT,
  emptyWebhookFilterDraft,
  parseWebhookFilterDrafts,
  removeWebhookFilterDraft,
  WEBHOOK_FILTER_OPS,
  type WebhookFilterDraft,
} from "@t3tools/client-runtime/scheduled-task-webhook";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { webhookAddress } from "@t3tools/client-runtime/webhook-address";
import {
  AuthOrchestrationOperateScope,
  MAX_WEBHOOK_DELIVERY_AGE_MINUTES,
  MAX_WEBHOOK_FILTERS,
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  ProviderInstanceId,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type ProjectId,
  type ScheduledTask,
  type ScheduledTaskId,
  type ScheduledTaskSchedule,
  type ScheduledTaskUpsertInput,
  type ScheduledTaskWebhookDeliverySummary,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { selectSettingsPageTarget, settingsPageTargetAtom } from "../navigation.ts";
import { requestConfirmDialog } from "../../dialogs/confirmDialog.ts";
import { usePaginatedBranches } from "../../state/composerQueries.ts";
import { useClientSettings } from "../../state/clientSettings.ts";
import { environmentSession, serverEnvironment } from "../../state/environment.ts";
import {
  EMPTY_SERVER_PROVIDERS,
  environmentAtomList,
  environmentIdsKey,
  mergeEnvironmentSettings,
  readEnvironmentScope,
  useAtomCommand,
  useEnvironment,
  useProjects,
  type EnvironmentPresentation,
} from "../../state/settings.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Dialog, Menu, MenuItem, MenuSeparator, Popover, Switch, Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { resolveBranchTriggerLabel, sanitizeNewRefName } from "../../web/components/BranchToolbar.logic.ts";
import {
  WEBHOOK_SIGNATURE_DEFAULTS,
  matchesScheduledTaskScope,
  scheduleFromDraft,
  scheduledTaskDefaultModel,
  taskToDraft,
  webhookDeliveryLabel,
  webhookDraftErrors,
  type DraftState,
  type ScheduleMode,
  type WorkspaceMode,
} from "../../web/components/settings/scheduledTasksSettings.logic.ts";
import { settingsScopeEnvironmentLabel, settingsScopeEnvironmentLabels } from "../../web/components/settings/settingsScopeAxis.ts";
import { getCustomModelOptionsByInstance } from "../../web/modelSelection.ts";
import { applyProviderInstanceSettings, deriveProviderInstanceEntries, sortProviderInstanceEntries } from "../../web/providerInstances.ts";
import { formatRelativeTime } from "../../web/timestampFormat.ts";
import { Badge, SettingsSelect, TextArea, TextField } from "../controls.tsx";
import { SettingsGroup, SettingsPageContainer, SettingsRow, SettingsSection, machineIcon } from "../layout.tsx";
import { SettingsModelPicker } from "../ModelPicker.tsx";
import { copyText } from "../openExternal.ts";
import { useEnvironmentQuery, formatEnvironmentQueryError } from "../query.ts";
import { useSettingsScope } from "../scope.tsx";

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

const WORKSPACE_MODE_LABELS: Record<WorkspaceMode, string> = {
  worktree: "Create a new worktree",
  root: "Use the project checkout",
  existing_worktree: "Use a specific checkout",
};

const EMPTY_DRAFT: DraftState = {
  editingId: null,
  title: "",
  prompt: "",
  enabled: true,
  scheduleMode: "fixed",
  intervalMinutes: "15",
  timeOfDay: "09:00",
  weekdays: new Set([1, 2, 3, 4, 5]),
  projectId: "",
  threadId: "",
  workspaceMode: "worktree",
  baseRef: "main",
  startFromOrigin: true,
  existingWorktreePath: "",
  modelKey: "",
  runtimeMode: "full-access",
  interactionMode: "default",
  baseModelSelection: null,
  signatureEnabled: false,
  ...WEBHOOK_SIGNATURE_DEFAULTS,
  signatureSecret: "",
  maxDeliveryAgeMinutes: "",
  replayKey: "",
  coalesceKey: "",
  coalesceWindowSeconds: "",
  filters: [],
  savedFilters: [],
};

type BadgeTone = "outline" | "success" | "warning" | "error" | "info";

function deliveryOutcomeVariant(outcome: string): BadgeTone {
  if (outcome === "accepted") return "success";
  if (["duplicate", "coalesced", "disabled", "rate_limited", "expired"].includes(outcome)) return "warning";
  if (outcome === "dispatch_failed" || outcome === "rejected_signature") return "error";
  return "outline";
}

function statusVariant(status: ScheduledTask["lastRunStatus"]): BadgeTone {
  if (status === "failed") return "error";
  if (status === "succeeded") return "success";
  if (status === "running") return "info";
  return "outline";
}

function splitModelKey(value: string): ModelSelection | null {
  const index = value.indexOf(":");
  if (index <= 0 || index === value.length - 1) return null;
  return { instanceId: ProviderInstanceId.make(value.slice(0, index)), model: value.slice(index + 1) };
}

export function scheduleLabel(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "webhook") return "On webhook";
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / 60_000;
    return Number.isInteger(minutes) ? `Every ${minutes} min` : `Every ${Math.round(schedule.everyMs / 1000)} sec`;
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

/** `formatRelativeTime` only handles the past; upcoming runs read "in 5m". */
function relativeLabel(value: string | null, nowMs: number): string {
  if (!value) return "Not scheduled";
  const diffMs = new Date(value).getTime() - nowMs;
  if (diffMs <= 0) {
    const relative = formatRelativeTime(value, nowMs);
    if (!relative) return "Not scheduled";
    return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
  }
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 2) return "in under a minute";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/** useNowMinute: re-render on each minute boundary. */
function useNowMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), 60_000 - (now % 60_000) + 50);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}

function useScheduledRelativeLabel(value: string | null): string {
  return relativeLabel(value, useNowMinute());
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// ── Page ─────────────────────────────────────────────────────────────────

export function ScheduledTasksSettings() {
  const theme = useTheme();
  const { scope, environments, connectedEnvironments, environment } = useSettingsScope();
  const pageTarget = selectSettingsPageTarget(useAtomValue(settingsPageTargetAtom), "scheduled-tasks");
  const target = pageTarget?.target;
  const [editor, setEditor] = useState<{ environmentId: EnvironmentId; task: ScheduledTask | null } | null>(null);
  const openForEdit = (environmentId: EnvironmentId, task: ScheduledTask) => setEditor({ environmentId, task });
  const defaultEnvironment = environment ?? connectedEnvironments[0];
  const canCreate = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(defaultEnvironment?.environmentId ?? null));
  const targetEnvironmentId = target?.environmentId ?? defaultEnvironment?.environmentId;
  return (
    <>
    <SettingsPageContainer virtual>
      <SettingsSection
        title="Scheduled tasks"
        variant="plain"
        headerAction={
          <Button
            size="xs"
            variant="ghost-muted"
            icon="plus"
            testId="scheduled-tasks-new"
            disabled={!defaultEnvironment || !canCreate}
            onClick={() => defaultEnvironment && setEditor({ environmentId: defaultEnvironment.environmentId, task: null })}
          >
            New task
          </Button>
        }
      >
        {scope.kind === "unavailable" ? (
          <SettingsSection title="Unavailable selection">
            <SettingsRow title={scope.message} />
          </SettingsSection>
        ) : environments.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 48, paddingBottom: 48 }}>
            <Icon name="clock-3" size={20} color={theme.foreground} />
            <Text size="lg" weight={600}>
              No environments available
            </Text>
            <Text color={theme.mutedForeground}>Connect an environment to manage scheduled tasks.</Text>
          </div>
        ) : environments.length > 1 ? (
          <ScheduledTaskEnvironmentList
            key={`${targetEnvironmentId}:${target?.taskId ?? ""}:${pageTarget?.nonce ?? 0}`}
            environmentId={targetEnvironmentId}
            taskId={target?.taskId}
            onEdit={openForEdit}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {environments.map((entry) => (
              <ScheduledTaskEnvironmentSection
                key={`${entry.environmentId}:${target?.taskId ?? ""}:${pageTarget?.nonce ?? 0}`}
                environment={entry}
                showEnvironmentHeading={false}
                taskId={targetEnvironmentId === entry.environmentId ? target?.taskId : undefined}
                onEdit={openForEdit}
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPageContainer>
    {/* Outside the virtual list, so the dialog never depends on its item being mounted. */}
    {editor ? (
      <ScheduledTaskEditorDialog
        key={`${editor.environmentId}:${editor.task?.id ?? "new"}`}
        initialEnvironmentId={editor.environmentId}
        task={editor.task}
        onClose={() => setEditor(null)}
      />
    ) : null}
    </>
  );
}

const scheduledTasksListAtom = environmentAtomList("t3term-scheduled-tasks-list", (environmentId) =>
  serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
);

function ScheduledTaskEnvironmentList({
  environmentId,
  taskId,
  onEdit,
}: {
  readonly environmentId: EnvironmentId | undefined;
  readonly taskId: ScheduledTaskId | undefined;
  readonly onEdit: (environmentId: EnvironmentId, task: ScheduledTask) => void;
}) {
  const theme = useTheme();
  const { scope, environments } = useSettingsScope();
  const connectedIds = environments.flatMap((environment) =>
    environment.connection.phase === "connected" && environment.serverConfig !== null ? [environment.environmentId] : [],
  );
  const queries = useAtomValue(scheduledTasksListAtom(environmentIdsKey(connectedIds)));
  const states = environments.map((environment) => {
    const index = connectedIds.indexOf(environment.environmentId);
    const query = index < 0 ? null : queries[index]!;
    const data = query === null ? null : Option.getOrNull(AsyncResult.value(query));
    return {
      environment,
      connected: index >= 0,
      tasks: data?.tasks.filter((task) => matchesScheduledTaskScope(scope, environment.environmentId, task.projectId)),
      error: query?._tag === "Failure" ? formatEnvironmentQueryError(query.cause) : null,
    };
  });
  // web: a task link opens its editor once, as soon as the task has loaded.
  const linkedState = states.find((state) => state.environment.environmentId === environmentId);
  const linkedTask = linkedState?.tasks?.find((task) => task.id === taskId);
  const openedLink = useRef(false);
  useEffect(() => {
    if (!openedLink.current && environmentId && linkedTask) {
      openedLink.current = true;
      onEdit(environmentId, linkedTask);
    }
  }, [environmentId, linkedTask, onEdit]);
  const loaded = states.filter((state) => state.connected && state.error === null && state.tasks);
  const populated = loaded.filter((state) => state.tasks && state.tasks.length > 0);
  const summaries: Record<string, string[]> = {
    "Not connected:": [],
    "Loading scheduled tasks on": [],
    "Could not load scheduled tasks:": [],
    "No tasks on": [],
  };
  for (const { environment, connected, tasks, error } of states) {
    const label = settingsScopeEnvironmentLabel(environment, environments);
    if (!connected) summaries["Not connected:"]!.push(`${label} (${connectionStatusTitle(environment.connection)})`);
    else if (error !== null) summaries["Could not load scheduled tasks:"]!.push(`${label}: ${error}`);
    else if (!tasks) summaries["Loading scheduled tasks on"]!.push(label);
    else if (tasks.length === 0 && populated.length > 0) summaries["No tasks on"]!.push(label);
  }
  return (
    <SettingsGroup>
      {populated.map(({ environment, tasks }) => {
        const { primary, secondary } = settingsScopeEnvironmentLabels(environment, environments);
        const transport = environment.relayManaged ? "T3 Connect" : (environment.displayUrl ?? "Remote link");
        const connected = environment.connection.phase === "connected";
        return (
          <div key={environment.environmentId} style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
              <Icon name={machineIcon(environment.serverConfig)} size={16} color={theme.foreground} />
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                <Text weight={500} truncate>
                  {primary}
                </Text>
                {secondary && secondary !== transport ? (
                  <Text size="xs" color={theme.mutedForeground} truncate>
                    {secondary}
                  </Text>
                ) : null}
                <Text size="xs" color={theme.mutedForeground} truncate>
                  {transport}
                </Text>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: connected ? theme.success : theme.warning }} />
              <Text size="xs" color={theme.mutedForeground}>
                {connectionStatusTitle(environment.connection)}
              </Text>
            </div>
            {tasks?.map((task) => (
              <ScheduledTaskRow key={task.id} environmentId={environment.environmentId} task={task} onEdit={() => onEdit(environment.environmentId, task)} />
            ))}
          </div>
        );
      })}
      {taskId && linkedState?.tasks && linkedState.error === null && !linkedTask ? (
        <SettingsRow title="Task unavailable" description="This task no longer exists or is outside the selected project scope." />
      ) : null}
      {populated.length === 0 && loaded.length > 0 ? <SettingsRow title="No scheduled tasks" description="No tasks match this environment and project selection." /> : null}
      {Object.entries(summaries).map(([label, entries]) => {
        if (entries.length === 0) return null;
        const summary = `${label} ${entries.join(", ")}`;
        return (
          <Tooltip key={label} content={summary} side="top">
            <div style={{ display: "flex", paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10 }}>
              <Text size="xs" color={theme.mutedForeground} truncate>
                {summary}
              </Text>
            </div>
          </Tooltip>
        );
      })}
    </SettingsGroup>
  );
}

function ScheduledTaskEnvironmentSection({
  environment,
  showEnvironmentHeading,
  taskId,
  onEdit,
}: {
  readonly environment: EnvironmentPresentation;
  readonly showEnvironmentHeading: boolean;
  readonly taskId?: ScheduledTaskId | undefined;
  readonly onEdit: (environmentId: EnvironmentId, task: ScheduledTask) => void;
}) {
  const theme = useTheme();
  const { scope } = useSettingsScope();
  const connected = environment.connection.phase === "connected" && environment.serverConfig !== null;
  const tasksQuery = useEnvironmentQuery(connected ? serverEnvironment.scheduledTasksLive({ environmentId: environment.environmentId, input: {} }) : null);
  const tasks = tasksQuery.data?.tasks.filter((task) => matchesScheduledTaskScope(scope, environment.environmentId, task.projectId));
  const linkedTask = tasks?.find((task) => task.id === taskId);
  const openedLink = useRef(false);
  useEffect(() => {
    if (!openedLink.current && linkedTask) {
      openedLink.current = true;
      onEdit(environment.environmentId, linkedTask);
    }
  }, [environment.environmentId, linkedTask, onEdit]);
  return (
    <SettingsSection
      title={environment.label}
      hideTitle={!showEnvironmentHeading}
      icon={<Icon name={machineIcon(environment.serverConfig)} size={14} color={alpha(theme.foreground, 0.7)} />}
    >
      {!connected ? (
        <SettingsRow title="Environment disconnected" description={`Reconnect ${environment.label} to view its scheduled tasks.`} />
      ) : tasksQuery.error ? (
        <SettingsRow title="Could not load scheduled tasks" description={tasksQuery.error} />
      ) : !tasks ? (
        <SettingsRow title="Loading scheduled tasks…" />
      ) : (
        <>
          {taskId && !linkedTask ? (
            <SettingsRow title="Task unavailable" description="This task no longer exists or is outside the selected project scope." />
          ) : null}
          {tasks.length === 0 ? (
            <SettingsRow title="No scheduled tasks" description="No tasks match this environment and project selection." />
          ) : (
            tasks.map((task) => (
              <ScheduledTaskRow key={task.id} environmentId={environment.environmentId} task={task} onEdit={() => onEdit(environment.environmentId, task)} />
            ))
          )}
        </>
      )}
    </SettingsSection>
  );
}

function ScheduledTaskRow({ environmentId, task, onEdit }: { readonly environmentId: EnvironmentId; readonly task: ScheduledTask; readonly onEdit: () => void }) {
  const theme = useTheme();
  const canOperate = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  const isWebhook = task.schedule.type === "webhook";
  const nextRun = useScheduledRelativeLabel(task.nextRunAt);
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, { label: "scheduled task enabled" });
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow, { label: "scheduled task run now" });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, { label: "scheduled task delete" });
  const act = async (action: "toggle" | "run" | "delete") => {
    if (busy || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    setBusy(true);
    const result =
      action === "toggle"
        ? await toggle({ environmentId, input: { id: task.id, enabled: !task.enabled } })
        : action === "run"
          ? await run({ environmentId, input: { id: task.id } })
          : await remove({ environmentId, input: { id: task.id } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toast({ type: "error", title: "Could not update scheduled task", description: String(squashAtomCommandFailure(result)) });
    }
  };
  const statusText = `${scheduleLabel(task.schedule)} · ${
    !task.enabled ? "Paused" : isWebhook ? "Listening" : task.nextRunAt ? `Next run ${nextRun}` : "Not scheduled"
  }`;
  return (
    <SettingsRow
      testId={`scheduled-task-${task.id}`}
      title={task.title}
      // line-clamp-2 on web; gpuix text has no line clamp, so long prompts are cut.
      description={task.prompt.length > 220 ? `${task.prompt.slice(0, 220).trimEnd()}…` : task.prompt}
      status={
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Text size="xs" color={theme.mutedForeground}>
            {statusText}
          </Text>
          {task.lastRunStatus !== "never" ? (
            <Badge size="sm" tone={statusVariant(task.lastRunStatus)}>
              {task.lastRunStatus}
            </Badge>
          ) : null}
          {task.lastRunError ? (
            <Text size="xs" color={theme.errorForeground}>
              {task.lastRunError}
            </Text>
          ) : null}
        </div>
      }
      control={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Switch testId={`scheduled-task-enabled-${task.id}`} checked={task.enabled} disabled={busy || !canOperate} onChange={() => void act("toggle")} />
          <Menu
            align="end"
            trigger={({ toggle: toggleMenu }) => (
              <IconButton icon="ellipsis" size={28} iconSize={16} disabled={busy || !canOperate} onClick={toggleMenu} testId={`scheduled-task-menu-${task.id}`} />
            )}
          >
            <MenuItem icon="pencil" onSelect={onEdit}>
              Edit
            </MenuItem>
            {isWebhook ? (
              <MenuItem icon="inbox" onSelect={() => setDeliveriesOpen(true)}>
                Deliveries
              </MenuItem>
            ) : (
              <MenuItem icon="play" onSelect={() => void act("run")}>
                Run now
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon="trash-2" onSelect={() => void act("delete")}>
              Delete
            </MenuItem>
          </Menu>
          {deliveriesOpen ? <WebhookDeliveriesDialog environmentId={environmentId} task={task} onClose={() => setDeliveriesOpen(false)} /> : null}
        </div>
      }
    />
  );
}

// ── Webhook deliveries ───────────────────────────────────────────────────

function WebhookDeliveriesDialog({ environmentId, task, onClose }: { readonly environmentId: EnvironmentId; readonly task: ScheduledTask; readonly onClose: () => void }) {
  const theme = useTheme();
  const deliveriesQuery = useEnvironmentQuery(serverEnvironment.scheduledTaskWebhookDeliveries({ environmentId, input: { id: task.id, acceptAnyOutcome: true } }));
  const [selectedId, setSelectedId] = useState<ScheduledTaskWebhookDeliverySummary["id"] | null>(null);
  const selectedQuery = useEnvironmentQuery(
    selectedId === null ? null : serverEnvironment.scheduledTaskWebhookDelivery({ environmentId, input: { id: task.id, deliveryId: selectedId, acceptAnyOutcome: true } }),
  );
  const deliveries = deliveriesQuery.data?.deliveries ?? null;
  const selected = selectedQuery.data?.delivery ?? null;
  const error = selectedId === null ? deliveriesQuery.error : selectedQuery.error;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={672}
      showCloseButton
      title={`Deliveries · ${task.title}`}
      description="Recent requests to this task's webhook URL."
      footer={
        <>
          {selectedId !== null ? (
            <Button variant="outline" size="sm" onClick={() => setSelectedId(null)}>
              Back
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={deliveriesQuery.isPending} onClick={deliveriesQuery.refresh}>
              Refresh
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 520, overflowY: "scroll" }}>
        {error ? <Text color={theme.errorForeground}>{error}</Text> : null}
        {selectedId !== null && selected === null && selectedQuery.error === null ? (
          <Text color={theme.mutedForeground}>Loading delivery…</Text>
        ) : selected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Badge tone={deliveryOutcomeVariant(selected.pendingWindow ? "coalesced" : selected.outcome)}>{webhookDeliveryLabel(selected)}</Badge>
              <DeliveryWhen method={selected.method} receivedAt={selected.receivedAt} />
              {selected.signatureVerified ? <Text color={theme.mutedForeground}>Signature verified</Text> : null}
            </div>
            {selected.error ? <Text color={selected.outcome === "filtered" ? theme.mutedForeground : theme.errorForeground}>{selected.error}</Text> : null}
            <DeliveryBlock title={selected.pendingWindow ? "Scheduled run" : "Prompt sent to the agent"}>
              {selected.renderedPrompt ?? (selected.pendingWindow ? "Run scheduled when the window closes; no run started yet." : "No run was started for this request.")}
            </DeliveryBlock>
            {selected.missingFields.length > 0 ? <Text color={theme.mutedForeground}>{`Empty placeholders: ${selected.missingFields.join(", ")}`}</Text> : null}
            <DeliveryBlock title="Headers">
              {Object.entries(selected.headers)
                .map(([name, value]) => `${name}: ${value}`)
                .join("\n")}
            </DeliveryBlock>
            {selected.query ? <DeliveryBlock title="Query">{selected.query}</DeliveryBlock> : null}
            <DeliveryBlock title={selected.bodyTruncated ? "Body (truncated)" : "Body"}>{selected.body || "(empty)"}</DeliveryBlock>
          </div>
        ) : selectedId !== null ? null : deliveries === null ? (
          <Text color={theme.mutedForeground}>Loading deliveries…</Text>
        ) : deliveries.length === 0 ? (
          <Text color={theme.mutedForeground}>No requests yet.</Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {deliveries.map((delivery, index) => (
              <div
                key={delivery.id}
                onClick={() => setSelectedId(delivery.id)}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                  paddingTop: 8,
                  paddingBottom: 8,
                  cursor: "pointer",
                  hover: { backgroundColor: alpha(theme.accent, 0.4) },
                  ...(index > 0 ? { borderTopWidth: 1, borderColor: theme.border } : {}),
                }}
              >
                <Badge tone={deliveryOutcomeVariant(delivery.pendingWindow ? "coalesced" : delivery.outcome)}>{webhookDeliveryLabel(delivery)}</Badge>
                <DeliveryWhen method={delivery.method} receivedAt={delivery.receivedAt} />
                {delivery.outcome === "filtered" && delivery.error ? <Text color={theme.mutedForeground}>{delivery.error}</Text> : null}
                {delivery.missingFields.length > 0 ? (
                  <Text color={theme.mutedForeground}>{`${delivery.missingFields.length} empty placeholder${delivery.missingFields.length === 1 ? "" : "s"}`}</Text>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function DeliveryWhen({ method, receivedAt }: { method: string; receivedAt: string }) {
  const theme = useTheme();
  const when = useScheduledRelativeLabel(receivedAt);
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
      <Text>{method}</Text>
      <Text color={theme.mutedForeground}>{when}</Text>
    </div>
  );
}

function DeliveryBlock({ title, children }: { title: string; children: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Text weight={500}>{title}</Text>
      <div style={{ display: "flex", maxHeight: 256, overflowY: "scroll", borderRadius: RADIUS.md, backgroundColor: theme.muted, padding: 8 }}>
        <Text size="xs" style={{ fontFamily: FONTS.mono }}>
          {children}
        </Text>
      </div>
    </div>
  );
}

function WebhookEndpointField({ environmentId, task }: { readonly environmentId: EnvironmentId; readonly task: ScheduledTask | null }) {
  const theme = useTheme();
  const canRotate = useAtomValue(serverEnvironment.rotateScheduledTaskWebhookToken.permissionAtom(environmentId));
  const prepared = Option.getOrNull(useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId)));
  const httpBaseUrl = prepared?.httpBaseUrl ?? null;
  const rotate = useAtomCommand(serverEnvironment.rotateScheduledTaskWebhookToken, { label: "scheduled task rotate webhook token" });
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const endpoint = task?.webhook;
  if (!task || !endpoint) return <Text color={theme.mutedForeground}>The URL appears after you save.</Text>;
  const { address: url, copyable, note } = webhookAddress(endpoint, httpBaseUrl);
  const rotateUrl = async () => {
    const confirmed = await requestConfirmDialog("Rotate this webhook URL?\nThe current URL stops working.", { variant: "destructive" });
    if (!confirmed) return;
    setRotating(true);
    const result = await rotate({ environmentId, input: { id: task.id } });
    setRotating(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toast({ type: "error", title: "Could not rotate webhook URL", description: String(squashAtomCommandFailure(result)) });
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextField value={url} readOnly />
        <Button
          size="sm"
          variant="outline"
          icon="copy"
          disabled={!copyable}
          onClick={() => {
            if (copyText(url)) setCopied(true);
            else toast({ type: "error", title: "Could not copy webhook URL" });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" variant="outline" disabled={rotating || !canRotate} onClick={() => void rotateUrl()}>
          Rotate
        </Button>
      </div>
      {note !== null ? (
        <Text size="xs" color={theme.mutedForeground}>
          {note}
        </Text>
      ) : null}
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text weight={500}>{label}</Text>
        {hint ? (
          <Text size="2xs" color={alpha(theme.mutedForeground, 0.8)}>
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** ToggleGroup / Toggle: pressed items fill; `multiple` keeps several pressed. */
function ToggleGroup<V extends string>({
  options,
  isPressed,
  onToggle,
  outline = false,
  testIdPrefix,
}: {
  options: ReadonlyArray<{ value: V; label: string }>;
  isPressed: (value: V) => boolean;
  onToggle: (value: V) => void;
  outline?: boolean;
  testIdPrefix?: string;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: outline ? 0 : 2,
        ...(outline ? { borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.input, overflow: "hidden" } : { padding: 2, borderRadius: RADIUS.lg, backgroundColor: alpha(theme.foreground, 0.05) }),
      }}
    >
      {options.map((option) => {
        const pressed = isPressed(option.value);
        return (
          <div
            key={option.value}
            testId={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
            onClick={() => onToggle(option.value)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: outline ? 28 : 24,
              minWidth: outline ? 32 : undefined,
              paddingLeft: outline ? 6 : 10,
              paddingRight: outline ? 6 : 10,
              borderRadius: outline ? 0 : RADIUS.md,
              cursor: "pointer",
              ...(outline
                ? { backgroundColor: pressed ? alpha(theme.foreground, 0.1) : "#00000000" }
                : { backgroundColor: pressed ? (theme.appearance === "dark" ? alpha("#ffffff", 0.1) : "#ffffff") : "#00000000" }),
            }}
          >
            <Text size="xs" weight={500} color={pressed ? theme.foreground : theme.mutedForeground}>
              {option.label}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

function WebhookFiltersField({ filters, onChange }: { filters: ReadonlyArray<WebhookFilterDraft>; onChange: (filters: ReadonlyArray<WebhookFilterDraft>) => void }) {
  const theme = useTheme();
  const update = (index: number, patch: Partial<WebhookFilterDraft>) => onChange(filters.map((filter, at) => (at === index ? { ...filter, ...patch } : filter)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 1, minWidth: 0 }}>
          <Text weight={500}>Filters</Text>
          <Text color={theme.mutedForeground}>
            Run only when every filter matches. Other requests are logged as filtered. Separate “is one of” values with commas; a value can't contain a comma.
          </Text>
        </div>
        <Button variant="outline" size="sm" icon="plus" disabled={filters.length >= MAX_WEBHOOK_FILTERS} onClick={() => onChange([...filters, emptyWebhookFilterDraft()])}>
          Add filter
        </Button>
      </div>
      {filters.map((filter, index) => (
        <div key={filter.id} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextField placeholder="body.action" value={filter.path} onChange={(path) => update(index, { path })} />
            <IconButton icon="trash-2" size={28} iconSize={16} onClick={() => onChange(removeWebhookFilterDraft(filters, filter.id))} />
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <SettingsSelect
              width={176}
              align="start"
              value={filter.op}
              options={WEBHOOK_FILTER_OPS.map((option) => ({ value: option.op, label: option.label }))}
              onChange={(op) => update(index, { op })}
            />
            {filter.op === "exists" ? null : (
              <TextField placeholder={filter.op === "in" ? "opened, reopened" : "opened"} value={filter.value} onChange={(value) => update(index, { value })} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** WorktreeBaseBranchPicker: the base ref for a new worktree plus "start from origin". */
function BaseBranchPicker({
  environmentId,
  cwd,
  value,
  onValueChange,
  startFromOrigin,
  onStartFromOriginChange,
  disabled,
}: {
  environmentId: EnvironmentId;
  cwd: string | null;
  value: string;
  onValueChange: (branch: string) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Closed, the query looks up the selected ref so the label can say "(remote)".
  const branches = usePaginatedBranches({ environmentId, cwd, query: sanitizeNewRefName((open ? query : value).trim()) });
  const selectedRef = branches.refs.find((branch) => branch.name === value);
  const label = resolveBranchTriggerLabel({
    activeWorktreePath: null,
    effectiveEnvMode: "worktree",
    resolvedActiveBranch: value || null,
    resolvedActiveBranchIsRemote: selectedRef ? selectedRef.isRemote === true : null,
    startFromOrigin,
  });
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const statusText =
    branches.isPending && branches.data === null
      ? "Loading refs..."
      : branches.data?.nextCursor != null
        ? `Showing ${branches.refs.length} of ${branches.data.totalCount} refs`
        : null;
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      align="start"
      style={{ width: 320, padding: 0 }}
      trigger={
        <div
          testId="scheduled-task-base-ref"
          onClick={() => (disabled || !cwd ? undefined : setOpen(!open))}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            height: 28,
            width: "100%",
            paddingLeft: 9,
            paddingRight: 9,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: theme.input,
            opacity: disabled || !cwd ? 0.64 : 1,
            cursor: disabled || !cwd ? "default" : "pointer",
          }}
        >
          <Icon name="git-branch" size={14} color={theme.mutedForeground} />
          <Text weight={500} truncate style={{ flexGrow: 1 }}>
            {label}
          </Text>
          <Icon name="chevron-down" size={14} color={theme.mutedForeground} />
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 8 }}>
          <TextField size="sm" width="100%" value={query} placeholder="Search refs…" onChange={setQuery} onSubmit={() => branches.refs[0] && (onValueChange(branches.refs[0].name), close())} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 280, overflowY: "scroll", paddingLeft: 4, paddingRight: 4 }}>
          {branches.refs.slice(0, 200).map((branch) => (
            <div
              key={branch.name}
              onClick={() => {
                onValueChange(branch.name);
                close();
              }}
              style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: RADIUS.sm, cursor: "pointer", hover: { backgroundColor: theme.accent } }}
            >
              <Text truncate style={{ flexGrow: 1 }}>
                {branch.name}
              </Text>
              {branch.name === value ? <Icon name="check" size={14} color={theme.foreground} /> : null}
            </div>
          ))}
          {statusText ? (
            <div style={{ paddingLeft: 8, paddingTop: 6, paddingBottom: 6 }}>
              <Text size="xs" color={theme.mutedForeground}>
                {statusText}
              </Text>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 8, borderTopWidth: 1, borderColor: theme.border }}>
          <Text size="xs">Start from origin</Text>
          <Switch checked={startFromOrigin} onChange={onStartFromOriginChange} />
        </div>
      </div>
    </Popover>
  );
}

function ScheduledTaskEditorDialog({ initialEnvironmentId, task, onClose }: { readonly initialEnvironmentId: EnvironmentId; readonly task: ScheduledTask | null; readonly onClose: () => void }) {
  const theme = useTheme();
  const { scope, connectedEnvironments } = useSettingsScope();
  const [saving, setSaving] = useState(false);
  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId);
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected" && environment.serverConfig !== null;
  const tasksQuery = useEnvironmentQuery(connected ? serverEnvironment.scheduledTasksLive({ environmentId, input: {} }) : null);
  const allProjects = useProjects();
  const projects = allProjects.filter((project) => project.environmentId === environmentId && matchesScheduledTaskScope(scope, environmentId, project.id));
  const clientSettings = useClientSettings();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const settings = mergeEnvironmentSettings(serverConfig?.settings ?? environment?.serverConfig?.settings ?? ({} as never), clientSettings);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const canOperate = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const upsertTask = useAtomCommand(serverEnvironment.upsertScheduledTask, { label: "scheduled task upsert" });
  const [draft, setDraft] = useState<DraftState>(() => (task ? taskToDraft(task) : { ...EMPTY_DRAFT, projectId: projects[0]?.id ?? "" }));
  const submissionPending = useRef(false);
  const editingTaskMissing = draft.editingId !== null && tasksQuery.data !== null && !tasksQuery.data.tasks.some((entry) => entry.id === draft.editingId);
  const liveTask = tasksQuery.data ? (tasksQuery.data.tasks.find((entry) => entry.id === draft.editingId) ?? null) : task;
  const selectedProjectId = draft.projectId || projects[0]?.id || "";
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const instanceEntries = sortProviderInstanceEntries(applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, selectedProject?.id ?? null));
  const firstInstance = instanceEntries[0];
  const draftSelection = draft.modelKey ? splitModelKey(draft.modelKey) : null;
  const activeSelection =
    draftSelection && instanceEntries.some((entry) => entry.instanceId === draftSelection.instanceId && entry.enabled)
      ? draftSelection
      : scheduledTaskDefaultModel(settings, selectedProject ?? null, instanceEntries);
  const activeInstanceId = activeSelection?.instanceId ?? firstInstance?.instanceId ?? ("" as ProviderInstanceId);
  const activeModel = activeSelection?.model ?? "";
  const modelOptionsByInstance = getCustomModelOptionsByInstance(settings, providers, activeInstanceId, activeModel);
  const set = (patch: Partial<DraftState>) => setDraft((current) => ({ ...current, ...patch }));

  const reportFailure = (title: string, error: unknown) => toast({ type: "error", title, description: errorText(error) });

  const submit = async () => {
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) || submissionPending.current || saving || editingTaskMissing || !connected || tasksQuery.data === null) return;
    const selection = activeSelection;
    if (!draft.title.trim() || !draft.prompt.trim() || !projects.some((project) => project.id === selectedProjectId) || selection === null) {
      reportFailure("Scheduled task is incomplete", "Add a title, prompt, project, and model.");
      return;
    }
    const parsedFilters = parseWebhookFilterDrafts(draft.filters);
    if (draft.scheduleMode === "webhook" && "error" in parsedFilters) {
      reportFailure("Invalid filter", parsedFilters.error);
      return;
    }
    const schedule = scheduleFromDraft(draft);
    if (schedule === null) {
      for (const error of webhookDraftErrors(draft)) reportFailure(error.title, error.description);
      return;
    }
    if (
      schedule.type === "webhook" &&
      schedule.signature &&
      (!schedule.signature.header || (!schedule.signature.secret && !(liveTask?.schedule.type === "webhook" && liveTask.webhook?.hasSecret)))
    ) {
      reportFailure("Signing secret is required", "Enter the signature header and secret.");
      return;
    }
    if (schedule.type === "interval" && (!Number.isSafeInteger(schedule.everyMs) || schedule.everyMs < MIN_SCHEDULED_TASK_INTERVAL_MS)) {
      reportFailure("Invalid interval", "Enter an interval of at least one minute.");
      return;
    }
    if (draft.workspaceMode === "existing_worktree" && !draft.existingWorktreePath.trim()) {
      reportFailure("Checkout path is required", "Enter the path of the checkout to run in.");
      return;
    }
    const modelSelection =
      draft.baseModelSelection !== null && draft.baseModelSelection.instanceId === selection.instanceId && draft.baseModelSelection.model === selection.model
        ? draft.baseModelSelection
        : selection;
    const workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy =
      draft.workspaceMode === "root"
        ? { type: "root" }
        : draft.workspaceMode === "existing_worktree"
          ? { type: "existing_worktree", worktreePath: draft.existingWorktreePath.trim() }
          : { type: "worktree", baseRef: draft.baseRef.trim() || "main", startFromOrigin: draft.startFromOrigin };
    const input: ScheduledTaskUpsertInput = {
      ...(draft.editingId ? { id: draft.editingId as ScheduledTaskId, requireExisting: true } : {}),
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      enabled: draft.enabled,
      schedule,
      projectId: selectedProjectId as ProjectId,
      threadId: draft.threadId ? (draft.threadId as ThreadId) : null,
      workspaceStrategy,
      modelSelection,
      runtimeMode: draft.runtimeMode,
      interactionMode: draft.interactionMode,
      creationSource: "web",
    };
    submissionPending.current = true;
    setSaving(true);
    const result = await upsertTask({ environmentId, input });
    setSaving(false);
    if (result._tag === "Failure") {
      submissionPending.current = false;
      if (!isAtomCommandInterrupted(result)) reportFailure("Could not save scheduled task", squashAtomCommandFailure(result));
      return;
    }
    onClose();
  };

  const labeledSwitchRow = (label: string, description: string, checked: boolean, onChange: (checked: boolean) => void, testId?: string) => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 1, minWidth: 0 }}>
        <Text weight={500}>{label}</Text>
        <Text color={theme.mutedForeground}>{description}</Text>
      </div>
      <Switch testId={testId} checked={checked} onChange={onChange} />
    </div>
  );
  const environmentIcon: IconName = machineIcon(environment?.serverConfig ?? null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      width={576}
      showCloseButton={!saving}
      testId="scheduled-task-editor"
      title={draft.editingId ? "Edit task" : "New task"}
      description="Run a prompt automatically on an interval, at a fixed time, or when a webhook is called."
      footer={
        <>
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" testId="scheduled-task-submit" disabled={!canOperate || saving || editingTaskMissing || !connected || !tasksQuery.data} onClick={() => void submit()}>
            {draft.editingId ? "Save task" : "Create task"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxHeight: 620, overflowY: "scroll", paddingRight: 4, opacity: saving ? 0.64 : 1 }}>
        {!connected ? <Text color={theme.errorForeground}>Reconnect this environment before saving.</Text> : null}
        <Field label="Runs on">
          <SettingsSelect
            width={520}
            align="start"
            icon={environmentIcon}
            disabled={task !== null || saving}
            value={environmentId}
            label={environment?.label ?? "Unavailable environment"}
            options={connectedEnvironments.map((entry) => ({ value: entry.environmentId, label: entry.label }))}
            onChange={(id) => {
              const next = connectedEnvironments.find((entry) => entry.environmentId === id);
              if (!next) return;
              setEnvironmentId(next.environmentId);
              set({ projectId: "", modelKey: "", baseModelSelection: null, baseRef: "main", startFromOrigin: true, existingWorktreePath: "" });
            }}
          />
        </Field>
        {tasksQuery.error ? <Text color={theme.errorForeground}>{tasksQuery.error}</Text> : null}
        {editingTaskMissing ? (
          <Text size="xs" color={theme.errorForeground}>
            This scheduled task no longer exists.
          </Text>
        ) : null}
        <Field label="Name">
          <TextField width="100%" testId="scheduled-task-title" placeholder="e.g. Check for Sentry issues" value={draft.title} onChange={(title) => set({ title })} />
        </Field>
        <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
          <Field label="Project">
            <SettingsSelect
              width={254}
              align="start"
              testId="scheduled-task-project"
              value={selectedProjectId || null}
              label={selectedProject?.title ?? "Select a project"}
              options={projects.map((project) => ({ value: project.id as string, label: project.title }))}
              onChange={(projectId) => set({ projectId })}
            />
          </Field>
          <Field label="Workspace">
            <SettingsSelect
              width={254}
              align="start"
              value={draft.workspaceMode}
              options={(["worktree", "root", "existing_worktree"] as const).map((value) => ({ value, label: WORKSPACE_MODE_LABELS[value] }))}
              onChange={(workspaceMode) => set({ workspaceMode })}
            />
          </Field>
        </div>
        {draft.workspaceMode === "worktree" ? (
          <Field label="Base branch">
            <BaseBranchPicker
              key={`${environmentId}:${selectedProjectId}`}
              environmentId={environmentId}
              cwd={selectedProject?.workspaceRoot ?? null}
              value={draft.baseRef}
              onValueChange={(baseRef) => set({ baseRef })}
              startFromOrigin={draft.startFromOrigin}
              onStartFromOriginChange={(startFromOrigin) => set({ startFromOrigin })}
              disabled={saving || !connected}
            />
          </Field>
        ) : null}
        {draft.workspaceMode === "existing_worktree" ? (
          <Field label="Checkout path">
            <TextField width="100%" value={draft.existingWorktreePath} placeholder="/path/to/checkout" onChange={(existingWorktreePath) => set({ existingWorktreePath })} />
          </Field>
        ) : null}
        <Field label="Prompt">
          <TextArea testId="scheduled-task-prompt" width="100%" minRows={3} maxRows={10} placeholder="What should the agent do each time this runs?" value={draft.prompt} onChange={(prompt) => set({ prompt })} />
        </Field>
        <Field label="Model">
          <div style={{ display: "flex" }}>
            <SettingsModelPicker
              testId="scheduled-task-model"
              environmentId={environmentId}
              entries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              activeInstanceId={activeInstanceId}
              model={activeModel}
              onInstanceModelChange={(instanceId, model) => set({ modelKey: `${instanceId}:${model}` })}
            />
          </div>
        </Field>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {task?.schedule.type === "interval" && task.schedule.everyMs < MIN_SCHEDULED_TASK_INTERVAL_MS ? (
            <Text color={theme.mutedForeground}>This task uses a legacy interval below one minute. Saving updates it to at least one minute.</Text>
          ) : null}
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text weight={500}>Schedule</Text>
            <ToggleGroup<ScheduleMode>
              testIdPrefix="scheduled-task-schedule"
              options={[
                { value: "fixed", label: "At a time" },
                { value: "interval", label: "Every interval" },
                { value: "webhook", label: "On webhook" },
              ]}
              isPressed={(mode) => draft.scheduleMode === mode}
              onToggle={(mode) =>
                setDraft((current) => ({ ...current, scheduleMode: mode, prompt: mode === "webhook" && !current.prompt.trim() ? DEFAULT_WEBHOOK_PROMPT : current.prompt }))
              }
            />
          </div>
          {draft.scheduleMode === "webhook" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <WebhookEndpointField environmentId={environmentId} task={liveTask} />
              <Text size="xs" color={theme.mutedForeground}>
                {"Each request runs the prompt. Use {{body.path}}, {{headers.name}}, {{query.name}}, {{body}} or {{request}} in the prompt; only what it names reaches the agent."}
              </Text>
              <Field label="Skip requests older than" hint="minutes, optional">
                <TextField
                  width="100%"
                  placeholder="Run every request"
                  value={draft.maxDeliveryAgeMinutes}
                  onChange={(value) => set({ maxDeliveryAgeMinutes: value.replace(/[^0-9]/g, "").slice(0, String(MAX_WEBHOOK_DELIVERY_AGE_MINUTES).length) })}
                />
              </Field>
              <WebhookFiltersField filters={draft.filters} onChange={(filters) => set({ filters })} />
              <Field label="Replay key" hint="template, optional">
                <TextField width="100%" placeholder="{{headers.delivery-id}}" value={draft.replayKey} onChange={(replayKey) => set({ replayKey })} />
              </Field>
              <Field label="Coalesce key" hint="template, optional">
                <TextField width="100%" placeholder="{{body.id}}" value={draft.coalesceKey} onChange={(coalesceKey) => set({ coalesceKey })} />
              </Field>
              <Field label="Coalesce window" hint="seconds, 10–3600">
                <TextField width="100%" placeholder="120" value={draft.coalesceWindowSeconds} onChange={(value) => set({ coalesceWindowSeconds: value.replace(/[^0-9]/g, "") })} />
              </Field>
              <Text size="xs" color={theme.mutedForeground}>
                Replay keys suppress repeat deliveries for 7 days. Coalescing runs the latest payload once when the window from the first delivery closes. Empty keys run normally.
              </Text>
              {labeledSwitchRow("Require signature", "Reject requests without a valid HMAC-SHA256 signature of the body.", draft.signatureEnabled, (signatureEnabled) => set({ signatureEnabled }))}
              {draft.signatureEnabled ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
                    <Field label="Header">
                      <TextField width="100%" value={draft.signatureHeader} onChange={(signatureHeader) => set({ signatureHeader })} />
                    </Field>
                    <Field label="Prefix">
                      <TextField width="100%" value={draft.signaturePrefix} placeholder="None" onChange={(signaturePrefix) => set({ signaturePrefix })} />
                    </Field>
                  </div>
                  <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
                    <Field label="Encoding">
                      <SettingsSelect
                        width={254}
                        align="start"
                        value={draft.signatureEncoding}
                        options={[
                          { value: "hex", label: "hex" },
                          { value: "base64", label: "base64" },
                        ]}
                        onChange={(signatureEncoding) => set({ signatureEncoding })}
                      />
                    </Field>
                    <Field label="Secret">
                      <TextField
                        width="100%"
                        secret
                        value={draft.signatureSecret}
                        placeholder={liveTask?.schedule.type === "webhook" && liveTask.webhook?.hasSecret ? "Unchanged" : "Shared secret"}
                        onChange={(signatureSecret) => set({ signatureSecret })}
                      />
                    </Field>
                  </div>
                </div>
              ) : null}
            </div>
          ) : draft.scheduleMode === "fixed" ? (
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text weight={500}>Run at</Text>
                <TextField width={128} testId="scheduled-task-time" trailing={<Icon name="clock" size={14} color={theme.mutedForeground} />} value={draft.timeOfDay} placeholder="09:00" onChange={(timeOfDay) => set({ timeOfDay: timeOfDay.replace(/[^0-9:]/g, "").slice(0, 5) })} />
                <Text size="xs" color={theme.mutedForeground}>
                  on
                </Text>
              </div>
              <ToggleGroup<string>
                outline
                testIdPrefix="scheduled-task-day"
                options={WEEKDAY_ORDER.map((day) => ({ value: String(day), label: WEEKDAY_SHORT[day] }))}
                isPressed={(day) => draft.weekdays.has(Number(day))}
                onToggle={(day) =>
                  setDraft((current) => {
                    const next = new Set(current.weekdays);
                    if (next.has(Number(day))) next.delete(Number(day));
                    else next.add(Number(day));
                    return next.size === 0 ? current : { ...current, weekdays: next };
                  })
                }
              />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text weight={500}>Run every</Text>
              <TextField width={96} testId="scheduled-task-interval" value={draft.intervalMinutes} onChange={(value) => set({ intervalMinutes: value.replace(/[^0-9.]/g, "") })} />
              <Text size="xs" color={theme.mutedForeground}>
                minutes
              </Text>
            </div>
          )}
        </div>
        {labeledSwitchRow("Enabled", "Disabled tasks stay saved but do not run.", draft.enabled, (enabled) => set({ enabled }), "scheduled-task-enabled")}
      </div>
    </Dialog>
  );
}
