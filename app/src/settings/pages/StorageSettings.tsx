// Port of apps/web/src/components/settings/StorageSettings.tsx (+ DatabaseStorageNotice.tsx,
// FoldedSettingsSection.tsx): worktree location and cleanup rules, artifact and
// log retention, and the cleanup run with its last report.
import { useAtomValue } from "@effect/atom-react";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, StorageCleanupReport, StorageCleanupSettings, WorktreeCleanupRules } from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { useState, type ReactNode } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { environmentAtomList, environmentIdsKey, useAtomCommand } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Switch } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { localStore } from "../../web/lib/localStore.ts";
import type { ScopedSettingsTarget } from "../../web/components/settings/scopedSettings.ts";
import { settingsScopeEnvironmentLabel } from "../../web/components/settings/settingsScopeAxis.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { formatRelativeTimeLabel } from "../../web/timestampFormat.ts";
import { DraftTextField, SettingsSelect, fieldBackground } from "../controls.tsx";
import { SettingResetButton, SettingsGroup, SettingsMessage, SettingsPageContainer, SettingsRow, SettingsSection } from "../layout.tsx";
import { copyText } from "../openExternal.ts";
import { useClearScopedSettings, useScopedSettings, useScopedSettingsMixed, useSettingsScope, useUpdateScopedSettings } from "../scope.tsx";

/** apps/web/src/lib/formatBytes.ts */
export function formatBytes(value: number): string {
  if (value < 1_024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let next = value;
  let unitIndex = -1;
  do {
    next /= 1_024;
    unitIndex += 1;
  } while (next >= 1_024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 100 ? 0 : next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function WorktreesDirectoryRow() {
  const { connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["worktreesDirectory"]);
  if (connectedEnvironments.some((environment) => environment.serverConfig?.environment.capabilities.worktreesDirectory !== true)) return null;
  return (
    <SettingsRow
      {...searchableSetting("storage-worktrees-location")}
      description={
        "Folder where new worktrees are created, on any drive, such as D:\\worktrees or ~/worktrees. Existing worktrees stay where they are. Leave empty to use the T3 home folder."
      }
      serverScoped
      settingKeys={["worktreesDirectory"]}
      resetAction={
        mixed || settings.worktreesDirectory !== "" ? (
          <SettingResetButton label="worktree location" onClick={() => updateSettings({ worktreesDirectory: "" })} />
        ) : null
      }
      control={
        <DraftTextField
          testId="settings-worktrees-directory"
          width={184}
          value={mixed ? "" : settings.worktreesDirectory}
          placeholder={mixed ? "Mixed" : "Default"}
          onCommit={(value) => {
            const trimmed = value.trim();
            if (mixed || trimmed !== settings.worktreesDirectory) updateSettings({ worktreesDirectory: trimmed });
          }}
        />
      }
    />
  );
}

/** RetentionControl: a days stepper next to an on/off switch. */
function RetentionControl({
  label,
  value,
  onChange,
  minimum = 1,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  minimum?: number;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setDraft(value === null ? "" : String(value));
  }
  const commit = (raw: number) => {
    const days = Math.min(3650, Math.max(minimum, Math.round(raw)));
    setDraft(String(days));
    if (days !== value) onChange(days);
  };
  const testId = `retention-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
      {value !== null ? (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            height: 28,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: fieldBackground(theme),
          }}
        >
          <IconButton icon="minus" size={26} iconSize={14} onClick={() => commit(value - 1)} testId={`${testId}-decrement`} />
          <input
            value={draft}
            testId={`${testId}-input`}
            theme={{ caret: theme.foreground, appearance: theme.appearance }}
            onChange={(event) => setDraft(event.value ?? "")}
            onSubmit={() => {
              const parsed = Number(draft);
              if (draft.trim() !== "" && Number.isFinite(parsed)) commit(parsed);
              else setDraft(String(value));
            }}
            onBlur={() => {
              const parsed = Number(draft);
              if (draft.trim() !== "" && Number.isFinite(parsed)) commit(parsed);
              else setDraft(String(value));
            }}
            style={{ width: Math.max(1, draft.length) * 8 + 4, height: 26, fontSize: 14, lineHeight: 26, color: theme.foreground, textAlign: "right" }}
          />
          <Text size="xs" style={{ paddingLeft: 4, paddingRight: 4 }}>
            days
          </Text>
          <IconButton icon="plus" size={26} iconSize={14} onClick={() => commit(value + 1)} testId={`${testId}-increment`} />
        </div>
      ) : (
        <Text size="xs" color={theme.mutedForeground}>
          Off
        </Text>
      )}
      <Switch testId={testId} checked={value !== null} onChange={(enabled) => onChange(enabled ? 8 : null)} />
    </div>
  );
}

const KEEP_WHEN_LABELS = {
  "any-local-files": "Any local files",
  "uncommitted-changes": "Uncommitted changes",
  "tracked-changes": "Edited tracked files",
} as const;

function lastRunSummary(entries: readonly { readonly label: string; readonly counts: string }[], machineCount: number) {
  const first = entries[0];
  if (!first) return "";
  if (machineCount <= 1) return first.counts;
  if (entries.length === machineCount && entries.every((entry) => entry.counts === first.counts)) return `${first.counts} on every machine`;
  return entries.map((entry) => `${entry.label}: ${entry.counts}`).join(" · ");
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
      <Text size="xs" color={theme.mutedForeground} style={{ width: 56 }}>
        {label}
      </Text>
      <Text size="xs" mono={mono} color={alpha(theme.foreground, 0.8)} style={{ flexGrow: 1, minWidth: 0 }}>
        {value}
      </Text>
    </div>
  );
}

function CleanupResults({ report, environmentLabel }: { report: StorageCleanupReport; environmentLabel: string }) {
  const theme = useTheme();
  return (
    <>
      {report.entries.map((entry, index) => {
        const name =
          entry.kind === "worktree"
            ? ((entry.threadId === null ? entry.path : entry.path?.split(/[\\/]/).findLast(Boolean)) ?? "Worktrees")
            : entry.kind === "logs"
              ? "Rotated logs"
              : "Browser artifacts";
        const size = [
          entry.kind !== "worktree" && entry.files !== null ? `${entry.files.toLocaleString()} ${entry.files === 1 ? "file" : "files"}` : null,
          entry.bytes !== null ? formatBytes(entry.bytes) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <SettingsRow
            key={`${entry.path ?? entry.kind}:${entry.threadId ?? index}`}
            title={name}
            description={
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Text size="xs" color={entry.outcome === "failed" ? theme.errorForeground : alpha(theme.mutedForeground, 0.8)}>
                  {entry.reason}
                </Text>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 12, borderLeftWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
                  <DetailLine label="Machine" value={environmentLabel} />
                  {entry.projectPath ? <DetailLine label="Project" value={entry.projectPath} mono /> : null}
                  {entry.path ? <DetailLine label="Folder" value={entry.path} mono /> : null}
                  {entry.threadTitle ? <DetailLine label="Thread" value={entry.threadTitle} /> : null}
                </div>
              </div>
            }
            control={
              entry.outcome === "removed" || (entry.outcome === "kept" && entry.bytes !== null) ? (
                <Text size="xs" color={theme.mutedForeground}>
                  {size}
                </Text>
              ) : undefined
            }
          />
        );
      })}
      {report.omittedCount > 0 ? (
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10 }}>
          <Text size="xs" color={theme.mutedForeground}>{`${environmentLabel}: ${report.omittedCount.toLocaleString()} more results.`}</Text>
        </div>
      ) : null}
      {report.entries.length === 0 && report.omittedCount === 0 ? (
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10 }}>
          <Text size="xs" color={theme.mutedForeground}>{`${environmentLabel}: Nothing needed cleanup.`}</Text>
        </div>
      ) : null}
    </>
  );
}

/** FoldedSettingsSection with the header inside the group. */
function FoldedGroup({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <SettingsGroup divided={false}>
      <div
        testId="storage-last-run"
        onClick={() => setOpen(!open)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingLeft: 16, paddingRight: 16, cursor: "pointer" }}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={16} color={theme.mutedForeground} />
        <Text weight={500}>{title}</Text>
        {summary ? (
          <Text size="xs" color={theme.mutedForeground} truncate>
            {summary}
          </Text>
        ) : null}
      </div>
      {open ? <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) }}>{children}</div> : null}
    </SettingsGroup>
  );
}

const storageCleanupReportsAtom = environmentAtomList("t3term-storage-cleanup-reports", (environmentId) =>
  serverEnvironment.storageCleanupReport({ environmentId, input: {} }),
);
const storageCleanupPermissionsAtom = environmentAtomList(
  "t3term-storage-cleanup-permissions",
  serverEnvironment.runStorageCleanup.permissionAtom,
);

function CleanupSection() {
  const theme = useTheme();
  const { connectedEnvironments } = useSettingsScope();
  const [pending, setPending] = useState(false);
  const run = useAtomCommand(serverEnvironment.runStorageCleanup);
  const supported = connectedEnvironments.filter((environment) => environment.serverConfig?.environment.capabilities.storageCleanupRun === true);
  const supportedIds = supported.map(({ environmentId }) => environmentId);
  const reports = useAtomValue(storageCleanupReportsAtom(environmentIdsKey(supportedIds)));
  const permissions = useAtomValue(storageCleanupPermissionsAtom(environmentIdsKey(supportedIds)));
  const state = supportedIds.map((environmentId, index) => {
    const query = reports[index]!;
    return {
      environmentId,
      allowed: permissions[index]!,
      report: query._tag === "Success" ? query.value : null,
      loading: query.waiting,
      failed: query._tag === "Failure",
    };
  });
  const hasRules = supported.some((environment) => {
    const settings = environment.serverConfig?.settings;
    if (!settings) return false;
    const enabled = (rules: WorktreeCleanupRules) =>
      rules.worktreeAfterDays !== null || rules.worktreeSettledAfterDays !== null || rules.worktreeOnMerge || rules.worktreeOnDelete || rules.worktreeUnchanged;
    return (
      settings.storageCleanup.browserArtifactsAfterDays !== null ||
      settings.storageCleanup.logsAfterDays !== null ||
      enabled(resolveWorktreeCleanup(settings, null)) ||
      Object.values(settings.projectSettingsOverrides).some(
        (override) => override.worktreeCleanup?.mode === "custom" && enabled(override.worktreeCleanup.rules),
      )
    );
  });
  if (supported.length === 0) return null;
  const summaries = supported.map((environment) => {
    const query = state.find((entry) => entry.environmentId === environment.environmentId);
    const report = query?.report ?? null;
    return {
      environment,
      report,
      label: settingsScopeEnvironmentLabel(environment, connectedEnvironments),
      counts: report
        ? `${report.counts.removed} removed, ${report.counts.kept} kept${report.counts.failed > 0 ? `, ${report.counts.failed} failed` : ""}`
        : "",
      description: report
        ? `Last run ${formatRelativeTimeLabel(report.finishedAt)}. ${formatBytes(report.bytesFreed)} recovered.${report.counts.failed > 0 ? ` ${report.counts.failed} ${report.counts.failed === 1 ? "item" : "items"} couldn't be removed.` : ""}`
        : query?.failed
          ? "Could not load the last run."
          : query?.loading
            ? "Loading last run…"
            : "Cleanup hasn't run yet.",
    };
  });
  const deleteNow = async () => {
    if (pending) return;
    setPending(true);
    await Promise.all(
      supported
        .filter((environment) => state.some((entry) => entry.environmentId === environment.environmentId && entry.allowed))
        .map(async (environment) => {
          const result = await run({ environmentId: environment.environmentId, input: {} });
          if (result._tag === "Success") {
            const failures = result.value.entries.filter((entry) => entry.outcome === "failed");
            if (failures.length > 0) toast({ type: "error", title: `Cleanup failed on ${environment.label}`, description: failures[0]!.reason });
          } else if (!isAtomCommandInterrupted(result)) {
            toast({ type: "error", title: `Could not run cleanup on ${environment.label}`, description: String(squashAtomCommandFailure(result)) });
          }
        }),
    ).finally(() => setPending(false));
  };
  return (
    <SettingsSection id="storage-cleanup" title="Cleanup" variant="plain">
      <SettingsGroup>
        <SettingsRow
          {...searchableSetting("storage-delete-now")}
          description={
            <div style={{ display: "flex", flexDirection: "column" }}>
              {!hasRules ? (
                <Text size="xs" color={alpha(theme.mutedForeground, 0.8)}>
                  Turn on a cleanup rule to use this.
                </Text>
              ) : (
                summaries.map(({ environment, label, description }) => (
                  <Text key={environment.environmentId} size="xs" color={alpha(theme.mutedForeground, 0.8)}>
                    {`${supported.length > 1 ? `${label}: ` : ""}${description}`}
                  </Text>
                ))
              )}
            </div>
          }
          control={
            <Button
              variant="outline"
              size="sm"
              testId="storage-delete-now"
              disabled={pending || !hasRules || !state.some((entry) => entry.allowed)}
              onClick={() => void deleteNow()}
            >
              {pending ? "Deleting…" : "Delete now"}
            </Button>
          }
        />
      </SettingsGroup>
      {summaries.some(({ report }) => report !== null) ? (
        <FoldedGroup
          title="Last run"
          summary={lastRunSummary(
            summaries.filter(({ report }) => report !== null),
            connectedEnvironments.length,
          )}
        >
          {summaries.map(({ environment, label, report }) =>
            report ? <CleanupResults key={environment.environmentId} report={report} environmentLabel={label} /> : null,
          )}
        </FoldedGroup>
      ) : null}
    </SettingsSection>
  );
}

const DISMISSED_KEY = "database-storage-notice-dismissed";

function readDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStore.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

/** DatabaseStorageNotice: suggests `t3 doctor` where a database holds at least 1 GiB of freed pages. */
function DatabaseStorageNotice({ environments }: { environments: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }> }) {
  const theme = useTheme();
  const recommendations = useAtomValue(
    serverEnvironment.databaseCompactionRecommendations(JSON.stringify(environments.map((environment) => environment.environmentId))),
  );
  const [dismissed, setDismissed] = useState(readDismissed);
  const visible = recommendations.filter((recommendation) => !dismissed.includes(recommendation.environmentId));
  if (visible.length === 0) return null;
  return (
    <SettingsSection id="storage-database" title="Database">
      <SettingsRow
        title="Reclaim freed database space"
        description="Old history is cleaned up automatically, but these databases still hold the freed space. Run the command on each machine to return it to disk; it pauses and restarts the background service. Quit the desktop app first if it hosts the environment."
      />
      {visible.map(({ environmentId, status }) => (
        <SettingsRow
          key={environmentId}
          title={`${(status.reclaimableBytes / 1024 ** 3).toFixed(1)} GiB on ${
            environments.find((environment) => environment.environmentId === environmentId)?.label ?? environmentId
          }`}
          description={
            <Text size="xs" mono color={alpha(theme.mutedForeground, 0.8)}>
              {status.compactCommand}
            </Text>
          }
          control={
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  if (copyText(status.compactCommand)) toast({ type: "success", title: "Command copied" });
                  else toast({ type: "error", title: "Could not copy the command" });
                }}
              >
                Copy command
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  const next = [...dismissed, environmentId];
                  localStore.setItem(DISMISSED_KEY, JSON.stringify(next));
                  setDismissed(next);
                }}
              >
                Dismiss
              </Button>
            </div>
          }
        />
      ))}
    </SettingsSection>
  );
}

export function StorageSettings() {
  const { scope, environments, connectedEnvironments, targets, target, selectScope } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = { ...scopedSettings.storageCleanup, ...resolveWorktreeCleanup(scopedSettings, null) };
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project" ? (entry.settings.worktreeCleanup?.mode ?? "inherit") : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some(
      (candidate) => ({ ...candidate.settings.storageCleanup, ...resolveWorktreeCleanup(candidate.settings, null) })[key] !== settings[key],
    )
      ? "Mixed across selected machines"
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) => updateSettings({ storageCleanup: patch });
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } }) : update(patch);
  if (isProjectScope && connectedEnvironments.some((environment) => environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true)) {
    return (
      <SettingsPageContainer>
        <SettingsMessage>Update the selected machines to configure project worktree cleanup.</SettingsMessage>
        <div style={{ display: "flex", flexDirection: "row" }}>
          <Button size="sm" variant="outline" onClick={() => selectScope({})}>
            Show all projects and environments
          </Button>
        </div>
      </SettingsPageContainer>
    );
  }
  if (connectedEnvironments.some((environment) => environment.serverConfig?.environment.capabilities.storageCleanup !== true)) {
    return (
      <SettingsPageContainer>
        <SettingsMessage>Update the selected environments to use storage cleanup, or choose a machine that supports it.</SettingsMessage>
      </SettingsPageContainer>
    );
  }
  return (
    <SettingsPageContainer>
      {!isProjectScope ? (
        <DatabaseStorageNotice
          environments={connectedEnvironments.filter((environment) => environment.serverConfig?.environment.capabilities.databaseStorage === true)}
        />
      ) : null}
      <SettingsSection id="storage-worktrees" title="Worktrees">
        {!isProjectScope ? <WorktreesDirectoryRow /> : null}
        {isProjectScope ? (
          <SettingsRow
            title="Automatic worktree cleanup"
            description={
              mode === "off"
                ? "Keep this project's worktrees until you delete them manually."
                : mode === "custom"
                  ? "Use these rules for this project."
                  : "Use each machine's worktree cleanup settings."
            }
            serverScoped
            settingKeys={["worktreeCleanup"]}
            mixed={mixedModes}
            control={
              <SettingsSelect
                value={mixedModes ? null : mode}
                options={[
                  { value: "inherit", label: "Inherit" },
                  { value: "off", label: "Off" },
                  { value: "custom", label: "Custom" },
                ]}
                onChange={(next) => {
                  if (next === "inherit") clearSettings(["worktreeCleanup"]);
                  else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                  else updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
                }}
              />
            }
          />
        ) : null}
        {!isProjectScope || (!mixedModes && mode === "custom") ? (
          <>
            <SettingsRow
              title="Delete worktrees with deleted threads"
              status={ruleStatus("worktreeOnDelete")}
              description="Remove unused worktrees when active or archived threads are deleted. Worktrees with local changes are kept."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  testId="storage-worktree-on-delete"
                  checked={settings.worktreeOnDelete}
                  onChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
                />
              }
            />
            <SettingsRow
              title="Delete inactive worktrees"
              status={ruleStatus("worktreeAfterDays")}
              description="Remove worktrees after their threads have been inactive for this many days. Branches and thread history are kept."
              serverScoped={!isProjectScope}
              control={
                <RetentionControl
                  label="Delete inactive worktrees"
                  value={settings.worktreeAfterDays}
                  onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
                />
              }
            />
            {connectedEnvironments.length > 0 &&
            connectedEnvironments.every((environment) => environment.serverConfig?.environment.capabilities.settledWorktreeCleanup === true) ? (
              <SettingsRow
                title="Delete settled worktrees"
                status={
                  [
                    ruleStatus("worktreeSettledAfterDays"),
                    environments.length > connectedEnvironments.length ? "Offline machines will not get this setting" : undefined,
                  ]
                    .filter(Boolean)
                    .join(". ") || undefined
                }
                description="Remove worktrees this many days after their thread settles. Set 0 days to remove them at the next cleanup. Branches and thread history are kept."
                serverScoped={!isProjectScope}
                control={
                  <RetentionControl
                    label="Delete settled worktrees"
                    value={settings.worktreeSettledAfterDays}
                    minimum={0}
                    onChange={(worktreeSettledAfterDays) => updateWorktree({ worktreeSettledAfterDays })}
                  />
                }
              />
            ) : null}
            <SettingsRow
              title="Delete merged worktrees"
              status={ruleStatus("worktreeOnMerge")}
              description="Remove worktrees whose pull request is merged and whose commits are included in the default branch."
              serverScoped={!isProjectScope}
              control={<Switch checked={settings.worktreeOnMerge} onChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })} />}
            />
            <SettingsRow
              title="Delete unchanged worktrees"
              status={ruleStatus("worktreeUnchanged")}
              description="Remove worktrees with no commits beyond the default branch."
              serverScoped={!isProjectScope}
              control={<Switch checked={settings.worktreeUnchanged} onChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })} />}
            />
            {connectedEnvironments.every((environment) => environment.serverConfig?.environment.capabilities.storageCleanupRun === true) ? (
              <SettingsRow
                {...searchableSetting("storage-worktree-keep-when")}
                status={ruleStatus("worktreeKeepWhen")}
                description={
                  settings.worktreeKeepWhen === "any-local-files"
                    ? "Includes ignored files, except node_modules."
                    : settings.worktreeKeepWhen === "tracked-changes"
                      ? "Deletes untracked and ignored files, including .env."
                      : "Keeps edits and untracked files. Deletes ignored files, including .env."
                }
                serverScoped={!isProjectScope}
                control={
                  <SettingsSelect
                    testId="storage-keep-when"
                    width="auto"
                    menuWidth={200}
                    value={ruleStatus("worktreeKeepWhen") ? null : settings.worktreeKeepWhen}
                    options={(Object.keys(KEEP_WHEN_LABELS) as Array<keyof typeof KEEP_WHEN_LABELS>).map((value) => ({
                      value,
                      label: KEEP_WHEN_LABELS[value],
                    }))}
                    onChange={(next) => updateWorktree({ worktreeKeepWhen: next })}
                  />
                }
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>
      {!isProjectScope ? (
        <SettingsSection id="storage-artifacts" title="Artifacts and logs">
          <SettingsRow
            title="Delete old browser artifacts"
            status={ruleStatus("browserArtifactsAfterDays")}
            description="Delete saved browser captures after this many days. Older capture links will no longer open."
            serverScoped
            control={
              <RetentionControl
                label="Delete old browser artifacts"
                value={settings.browserArtifactsAfterDays}
                onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
              />
            }
          />
          <SettingsRow
            title="Delete old rotated logs"
            status={ruleStatus("logsAfterDays")}
            description="Delete inactive rotated log files after this many days. Current logs are kept."
            serverScoped
            control={<RetentionControl label="Delete old rotated logs" value={settings.logsAfterDays} onChange={(logsAfterDays) => update({ logsAfterDays })} />}
          />
        </SettingsSection>
      ) : null}
      {!isProjectScope ? <CleanupSection /> : null}
    </SettingsPageContainer>
  );
}
