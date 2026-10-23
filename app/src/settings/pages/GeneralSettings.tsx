// Port of apps/web/src/components/settings/SettingsPanels.tsx (GeneralSettingsPanel,
// useSettingsRestore, LegacyFeaturesSection) with NotificationSettings,
// BackgroundActivitySettings, ThreadTitleInstructionsSettings and
// MobileAppSettingsRow. Desktop-bridge rows (update track, CLI install, quit
// shortcut) are left out, as they are in the hosted app.
import {
  globalIdleCompaction,
  IDLE_COMPACTION_MODES,
  ProviderDriverKind,
  type BackgroundActivityProfile,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  SidebarProjectSortOrder,
  type DiffLayout,
  type NotificationMode,
  type ResponseStreamingMode,
} from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import { useRef, useState } from "react";

import { resetThemeState, useThemeState } from "../../state/clientSettings.ts";
import { EMPTY_SERVER_PROVIDERS, useEnvironmentProviders } from "../../state/settings.ts";
import { Dialog, Popover, Switch, Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { APP_VERSION } from "../../web/branding.ts";
import {
  backgroundActivityOverrideSettings,
  backgroundActivitySharedPolicySettings,
  durationToSeconds,
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  normalizeIntervalSeconds,
  PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
  resolveBackgroundActivityProfileOption,
} from "../../web/components/settings/SettingsPanels.logic.ts";
import { scopedIdleCompaction } from "../../web/components/settings/scopedSettings.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { isMacPlatform, PLATFORM } from "../../web/lib/utils.ts";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
  selectsPlanAgent,
} from "../../web/modelSelection.ts";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../web/providerInstances.ts";
import { BrandIcon } from "../brandIcons.tsx";
import { CollapsibleHeader, DraftTextField, NumberField, SettingsSelect, TextArea } from "../controls.tsx";
import {
  PolicyTooltip,
  SettingResetButton,
  SettingsGroup,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTarget,
} from "../layout.tsx";
import { SettingsModelPicker, SettingsTraitsPicker } from "../ModelPicker.tsx";
import { openSettingsPage } from "../navigation.ts";
import { ProjectDefaultsSettings, ScopedSwitch, useScopedModelDisabledReason } from "../ProjectDefaultsSettings.tsx";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useScopedSettingsWriteAllowed,
  useSettingsScope,
  useUpdateScopedSettings,
} from "../scope.tsx";
import { openExternal } from "../openExternal.ts";

const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: "Wait for the full response",
  paragraph: "Show finished paragraphs",
};

const RESPONSE_STREAMING_MODE_DESCRIPTIONS: Record<ResponseStreamingMode, string> = {
  turn: "Text appears once the agent finishes its turn.",
  paragraph: "Each paragraph or code block appears as soon as it is complete.",
};

const SIDEBAR_PROJECT_SORT_ORDER_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const DIFF_LAYOUT_LABELS: Record<DiffLayout, string> = {
  stacked: "Stacked",
  split: "Split",
};

/** threadNotifications.ts */
const NOTIFICATION_MODE_LABELS: Record<NotificationMode, string> = {
  off: "Off",
  notifications: "Notifications only",
  sound: "Sound only",
  "notifications-and-sound": "Notifications with sound",
};

const PRIVACY_POLICY_URL = "https://t3.codes/privacy";
const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ?? 3;

export function useSettingsRestore(onRestored?: () => void) {
  const themeState = useThemeState();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);
  const d = DEFAULT_UNIFIED_SETTINGS;
  const changed = (label: string, dirty: boolean) => (dirty ? [label] : []);
  const changedSettingLabels = [
    ...changed("Theme", themeState.theme !== "system"),
    ...changed("Follow system", themeState.appearanceMode !== "system"),
    ...changed("Theme mix", themeState.halves !== null),
    ...changed("Contrast", settings.appearanceContrast !== d.appearanceContrast),
    ...changed("Glass opacity", settings.glassOpacity !== d.glassOpacity),
    ...changed("Diff colors", settings.diffColorScheme !== d.diffColorScheme),
    ...changed("Chat width", settings.chatWidth !== d.chatWidth),
    ...changed("Render math", settings.mathRenderingEnabled !== d.mathRenderingEnabled),
    ...changed("Panel animations", settings.panelAnimationDurationMs !== d.panelAnimationDurationMs),
    ...changed("Environment identification", settings.environmentIdentificationMode !== d.environmentIdentificationMode),
    ...changed("Time format", settings.timestampFormat !== d.timestampFormat),
    ...changed("Thread notifications", settings.notificationMode !== d.notificationMode),
    ...changed("In-app notifications", settings.inAppNotificationsEnabled !== d.inAppNotificationsEnabled),
    ...changed("Visible threads", settings.sidebarThreadPreviewCount !== d.sidebarThreadPreviewCount),
    ...changed("Project Grouping", settings.sidebarProjectGroupingMode !== d.sidebarProjectGroupingMode),
    ...changed("Project order", settings.sidebarProjectSortOrder !== d.sidebarProjectSortOrder),
    ...changed("Working section", settings.sidebarWorkingShelfEnabled !== d.sidebarWorkingShelfEnabled),
    ...changed("Auto-settle inactive threads", settings.sidebarAutoSettleAfterDays !== d.sidebarAutoSettleAfterDays),
    ...changed("Keep threads with a PR", settings.sidebarAutoSettleKeepPullRequests !== d.sidebarAutoSettleKeepPullRequests),
    ...changed("Auto-settle merged threads", settings.sidebarAutoSettleOnMerge !== d.sidebarAutoSettleOnMerge),
    ...changed("Auto-resume limited threads", settings.autoResumeLimitedThreads !== d.autoResumeLimitedThreads),
    ...changed("Snooze limited threads", settings.snoozeLimitedThreads !== d.snoozeLimitedThreads),
    ...changed("Word wrap", settings.wordWrap !== d.wordWrap),
    ...changed("Composer context", settings.persistComposerContextStrip !== d.persistComposerContextStrip),
    ...getChangedTypographySettingLabels(settings),
    ...changed("Default diff file state", settings.diffFilesCollapsed !== d.diffFilesCollapsed),
    ...changed("Diff whitespace changes", settings.diffIgnoreWhitespace !== d.diffIgnoreWhitespace),
    ...changed("Diff layout", settings.diffLayout !== d.diffLayout),
    ...changed("Proactive panels", settings.proactivePanelsEnabled !== d.proactivePanelsEnabled),
    ...changed("Show skills in slash menu", settings.showSkillsInSlashMenu !== d.showSkillsInSlashMenu),
    ...changed("Collapse composer on scroll", settings.composerCollapseOnScroll !== d.composerCollapseOnScroll),
    ...changed("Rich text composer", settings.composerRichTextEnabled !== d.composerRichTextEnabled),
    ...changed("Send shortcut", settings.sendShortcut !== d.sendShortcut),
    ...changed("Follow-up behavior", settings.followUpBehavior !== d.followUpBehavior),
    ...changed("Context window indicator", settings.contextWindowMeterEnabled !== d.contextWindowMeterEnabled),
    ...changed("Response streaming", settings.responseStreamingMode !== d.responseStreamingMode),
    ...changed("Provider update checks", settings.enableProviderUpdateChecks !== d.enableProviderUpdateChecks),
    ...changed("Continue threads after restarts", settings.continueThreadsAfterServerUpdate !== d.continueThreadsAfterServerUpdate),
    ...changed("Background activity", isBackgroundActivityDirty),
    ...changed("New thread mode", settings.defaultThreadEnvMode !== d.defaultThreadEnvMode),
    ...changed("New worktrees start from remote", settings.newWorktreesStartFromOrigin !== d.newWorktreesStartFromOrigin),
    ...changed("Add project base directory", settings.addProjectBaseDirectory !== d.addProjectBaseDirectory),
    ...changed("Unpin confirmation", settings.confirmThreadUnpin !== d.confirmThreadUnpin),
    ...changed("Archive confirmation", settings.confirmThreadArchive !== d.confirmThreadArchive),
    ...changed("Delete confirmation", settings.confirmThreadDelete !== d.confirmThreadDelete),
    ...changed("Quit shortcut", settings.confirmQuit !== d.confirmQuit),
    ...changed("Text generation model", isTextGenerationModelDirty),
    ...changed("Thread title instructions", settings.threadTitleInstructions !== d.threadTitleInstructions),
    ...getChangedBrowserSettingLabels(settings),
    ...changed("Agent browser access", settings.enableAgentBrowserAccess !== d.enableAgentBrowserAccess),
  ];

  const restoreDefaults = () => {
    if (changedSettingLabels.length === 0) return;
    resetThemeState();
    updateSettings({
      appearanceContrast: d.appearanceContrast,
      diffColorScheme: d.diffColorScheme,
      chatWidth: d.chatWidth,
      mathRenderingEnabled: d.mathRenderingEnabled,
      timestampFormat: d.timestampFormat,
      notificationMode: d.notificationMode,
      inAppNotificationsEnabled: d.inAppNotificationsEnabled,
      wordWrap: d.wordWrap,
      persistComposerContextStrip: d.persistComposerContextStrip,
      diffFilesCollapsed: d.diffFilesCollapsed,
      diffIgnoreWhitespace: d.diffIgnoreWhitespace,
      diffLayout: d.diffLayout,
      proactivePanelsEnabled: d.proactivePanelsEnabled,
      showSkillsInSlashMenu: d.showSkillsInSlashMenu,
      composerCollapseOnScroll: d.composerCollapseOnScroll,
      composerRichTextEnabled: d.composerRichTextEnabled,
      sendShortcut: d.sendShortcut,
      followUpBehavior: d.followUpBehavior,
      contextWindowMeterEnabled: d.contextWindowMeterEnabled,
      environmentIdentificationMode: d.environmentIdentificationMode,
      glassOpacity: d.glassOpacity,
      panelAnimationDurationMs: d.panelAnimationDurationMs,
      sidebarThreadPreviewCount: d.sidebarThreadPreviewCount,
      sidebarProjectGroupingMode: d.sidebarProjectGroupingMode,
      sidebarProjectSortOrder: d.sidebarProjectSortOrder,
      sidebarWorkingShelfEnabled: d.sidebarWorkingShelfEnabled,
      sidebarAutoSettleAfterDays: d.sidebarAutoSettleAfterDays,
      sidebarAutoSettleKeepPullRequests: d.sidebarAutoSettleKeepPullRequests,
      sidebarAutoSettleOnMerge: d.sidebarAutoSettleOnMerge,
      autoResumeLimitedThreads: d.autoResumeLimitedThreads,
      snoozeLimitedThreads: d.snoozeLimitedThreads,
      responseStreamingMode: d.responseStreamingMode,
      enableProviderUpdateChecks: d.enableProviderUpdateChecks,
      continueThreadsAfterServerUpdate: d.continueThreadsAfterServerUpdate,
      backgroundActivity: d.backgroundActivity,
      backgroundActivityProfile: d.backgroundActivityProfile,
      automaticGitFetchInterval: d.automaticGitFetchInterval,
      providerHealthRefreshInterval: d.providerHealthRefreshInterval,
      defaultThreadEnvMode: d.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: d.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: d.addProjectBaseDirectory,
      confirmThreadArchive: d.confirmThreadArchive,
      confirmThreadDelete: d.confirmThreadDelete,
      confirmThreadUnpin: d.confirmThreadUnpin,
      confirmQuit: d.confirmQuit,
      textGenerationModelSelection: d.textGenerationModelSelection,
      threadTitleInstructions: d.threadTitleInstructions,
      fontFamilySans: d.fontFamilySans,
      fontFamilyComposer: d.fontFamilyComposer,
      fontFamilyCode: d.fontFamilyCode,
      fontFamilyTerminal: d.fontFamilyTerminal,
      fontSizeInterface: d.fontSizeInterface,
      fontSizePrompt: d.fontSizePrompt,
      fontSizeCode: d.fontSizeCode,
      fontSizeTerminal: d.fontSizeTerminal,
      browserDefaultViewport: d.browserDefaultViewport,
      browserDefaultZoomFactor: d.browserDefaultZoomFactor,
      browserDefaultAppearance: d.browserDefaultAppearance,
      browserRecordingFrameRate: d.browserRecordingFrameRate,
      browserRecordingShowKeyPresses: d.browserRecordingShowKeyPresses,
      browserRecordingShowMousePresses: d.browserRecordingShowMousePresses,
      browserLinkTarget: d.browserLinkTarget,
      browserSearchEngine: d.browserSearchEngine,
      browserCustomSearchUrl: d.browserCustomSearchUrl,
      browserAutoShowFloatingPreview: d.browserAutoShowFloatingPreview,
      pullRequestLinksOpenInApp: d.pullRequestLinksOpenInApp,
      enableAgentBrowserAccess: d.enableAgentBrowserAccess,
    });
    onRestored?.();
  };

  return { changedSettingLabels, restoreDefaults };
}

/** A reset button shown only when `dirty`. */
function resetIf(dirty: boolean, label: string, onClick: () => void) {
  return dirty ? <SettingResetButton label={label} onClick={onClick} /> : null;
}

function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description="System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open."
      control={
        <SettingsSelect
          testId="settings-thread-notifications"
          value={mode}
          width={224}
          options={(Object.keys(NOTIFICATION_MODE_LABELS) as NotificationMode[]).map((value) => ({
            value,
            label: NOTIFICATION_MODE_LABELS[value],
          }))}
          onChange={(value) => updateSettings({ notificationMode: value })}
        />
      }
    />
  );
}

const BACKGROUND_ACTIVITY_PROFILE_LABELS: Record<BackgroundActivityProfile, string> = {
  balanced: "Balanced",
  performance: "Performance",
  "battery-saver": "Battery saver",
};
const BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS: Record<BackgroundActivityProfile, string> = {
  balanced: "Pauses probes for idle clients, locked hosts, or low power mode.",
  performance: "Allows scoped background probes while any subscribed client remains connected.",
  "battery-saver": "Also pauses background probes when the host or client is on battery.",
};
const BACKGROUND_ACTIVITY_BOOLEAN_OVERRIDES = [
  { key: "pauseWhenHostLocked", label: "Pause when host is locked" },
  { key: "pauseWhenHostLowPower", label: "Pause on host low power" },
  { key: "pauseWhenClientLowPower", label: "Pause on client low power" },
  { key: "pauseWhenOnBattery", label: "Pause on battery" },
] as const;

function BackgroundActivitySettingsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { scope, environment } = useSettingsScope();
  const isEnvironmentScope = scope.environmentIds.length === 1 && environment !== null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const mixed = useScopedSettingsMixed(["backgroundActivity"]);
  const resolved = resolveServerBackgroundActivitySettings(settings);
  const option = resolveBackgroundActivityProfileOption(settings);
  const description =
    option === "advanced"
      ? `Uses custom intervals. Shared policy: ${BACKGROUND_ACTIVITY_PROFILE_LABELS[resolved.profile]}.`
      : BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS[resolved.profile];
  const canReset = !Equal.equals(settings.backgroundActivity, DEFAULT_UNIFIED_SETTINGS.backgroundActivity);
  const theme = useTheme();
  return (
    <SettingsRow
      serverScoped
      settingKeys={["backgroundActivity"]}
      id={searchableSetting("background-activity").id}
      title={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text weight={500}>{searchableSetting("background-activity").title}</Text>
          <PolicyTooltip>
            This shared policy gates background work such as Git refreshes and provider health probes after their individual intervals elapse.
          </PolicyTooltip>
        </div>
      }
      description={description}
      resetAction={resetIf(canReset, "background activity", () =>
        updateSettings({ backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity }),
      )}
      control={
        <>
          <SettingsSelect
            testId="settings-background-activity"
            value={mixed ? null : option}
            label={mixed ? "Mixed" : option === "advanced" ? "Advanced" : BACKGROUND_ACTIVITY_PROFILE_LABELS[option]}
            options={[
              { value: "balanced", label: "Balanced" },
              { value: "performance", label: "Performance" },
              { value: "battery-saver", label: "Battery saver" },
              {
                value: "advanced",
                label: isEnvironmentScope ? "Advanced" : "Advanced (one environment)",
                disabled: !isEnvironmentScope,
              },
            ]}
            onChange={(value) => {
              if (value === "advanced") {
                if (isEnvironmentScope) setDialogOpen(true);
                return;
              }
              updateSettings({ backgroundActivity: { schemaVersion: 1, profile: value, overrides: {} } });
            }}
          />
          {option === "advanced" && isEnvironmentScope ? (
            <Tooltip content="Configure background activity" side="top">
              <div
                onClick={() => setDialogOpen(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: RADIUS.md,
                  borderWidth: 1,
                  borderColor: theme.input,
                  cursor: "pointer",
                }}
              >
                <IconButton icon="settings" size={24} iconSize={16} />
              </div>
            </Tooltip>
          ) : null}
          <BackgroundActivityAdvancedDialog open={dialogOpen && isEnvironmentScope} onOpenChange={setDialogOpen} />
        </>
      }
    />
  );
}

function IntervalRow({
  title,
  description,
  value,
  min,
  onCommit,
  bordered,
}: {
  title: string;
  description: string;
  value: number;
  min: number;
  onCommit: (seconds: number) => void;
  bordered: boolean;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: 12,
        ...(bordered ? { borderTopWidth: 1, borderColor: theme.border } : {}),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
        <Text weight={500}>{title}</Text>
        <Text size="xs" color={theme.mutedForeground}>
          {description}
        </Text>
      </div>
      <NumberField value={value} min={min} max={86_400} onCommit={onCommit} width={96} size="sm" />
      <Text size="xs" color={theme.mutedForeground}>
        seconds
      </Text>
    </div>
  );
}

function BackgroundActivityAdvancedDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const theme = useTheme();
  const canWriteSettings = useScopedSettingsWriteAllowed();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const resolved = resolveServerBackgroundActivitySettings(settings);
  const override = (patch: Parameters<typeof backgroundActivityOverrideSettings>[2]) =>
    updateSettings(backgroundActivityOverrideSettings(settings.backgroundActivity, resolved, patch));
  return (
    <Dialog
      open={open && canWriteSettings}
      onOpenChange={onOpenChange}
      width={576}
      title="Background Activity"
      description="Tune the shared power policy and the background intervals that feed it."
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={!canWriteSettings}
            onClick={() => updateSettings({ backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity })}
          >
            Reset all
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
            <Text weight={500}>Shared policy</Text>
            <Text size="xs" color={theme.mutedForeground}>
              Controls whether background work may run after a subscribed interval fires.
            </Text>
          </div>
          <SettingsSelect
            value={resolved.profile}
            options={(Object.keys(BACKGROUND_ACTIVITY_PROFILE_LABELS) as BackgroundActivityProfile[]).map((value) => ({
              value,
              label: BACKGROUND_ACTIVITY_PROFILE_LABELS[value],
            }))}
            onChange={(value) => updateSettings({ backgroundActivity: backgroundActivitySharedPolicySettings(settings, value) })}
          />
        </div>
        <IntervalRow
          bordered
          title={searchableSetting("git-fetch-interval").title}
          description="Refresh remote branch status in the background."
          value={durationToSeconds(resolved.automaticGitFetchInterval)}
          min={0}
          onCommit={(value) => override({ automaticGitFetchInterval: Duration.seconds(normalizeIntervalSeconds(value)) })}
        />
        <IntervalRow
          bordered
          title="Provider health interval"
          description={`Refresh provider availability, versions, and auth state. Model catalog updates follow Provider update checks. Steps of ${PROVIDER_HEALTH_INTERVAL_STEP_SECONDS}s.`}
          value={durationToSeconds(resolved.providerHealthRefreshInterval)}
          min={0}
          onCommit={(value) => override({ providerHealthRefreshInterval: Duration.seconds(normalizeIntervalSeconds(value)) })}
        />
        <IntervalRow
          bordered
          title="Host power monitor"
          description="Poll host power state while clients are active."
          value={durationToSeconds(resolved.hostPowerMonitorActiveInterval)}
          min={5}
          onCommit={(value) => override({ hostPowerMonitorActiveInterval: Duration.seconds(normalizeIntervalSeconds(value, 5)) })}
        />
        <IntervalRow
          bordered
          title="Idle host monitor"
          description="Poll host power state when no foreground client is active."
          value={durationToSeconds(resolved.hostPowerMonitorIdleInterval)}
          min={5}
          onCommit={(value) => override({ hostPowerMonitorIdleInterval: Duration.seconds(normalizeIntervalSeconds(value, 5)) })}
        />
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderColor: theme.border }}>
          {BACKGROUND_ACTIVITY_BOOLEAN_OVERRIDES.map(({ key, label }) => (
            <div
              key={key}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                width: "50%",
                paddingLeft: 16,
                paddingRight: 16,
                paddingTop: 12,
                paddingBottom: 12,
              }}
            >
              <Text weight={500}>{label}</Text>
              <Switch checked={resolved[key]} onChange={(checked) => override({ [key]: checked })} />
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function ThreadTitleInstructionsSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["threadTitleInstructions"]);
  const saved = mixed ? "" : settings.threadTitleInstructions;
  const [draft, setDraft] = useState(saved);
  const [source, setSource] = useState(saved);
  const edited = useRef(false);
  if (source !== saved) {
    setSource(saved);
    setDraft(saved);
  }
  return (
    <SettingsRow
      serverScoped
      settingKeys={["threadTitleInstructions"]}
      {...searchableSetting("thread-title-instructions")}
      description="Appended to the prompt for new and regenerated thread titles."
      resetAction={resetIf(mixed || settings.threadTitleInstructions !== "", "thread title instructions", () =>
        updateSettings({ threadTitleInstructions: "" }),
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", marginTop: 12, paddingBottom: 14, maxWidth: 672 }}>
        <TextArea
          testId="settings-thread-title-instructions"
          value={draft}
          minRows={3}
          maxRows={8}
          placeholder={mixed ? "Mixed. Enter instructions to apply to all selected targets." : "Keep titles to a few words. Lead with the main subject."}
          onChange={(value) => {
            edited.current = true;
            setDraft(value);
          }}
          onBlur={() => {
            const value = draft.trim();
            if (edited.current && (mixed || value !== settings.threadTitleInstructions)) {
              updateSettings({ threadTitleInstructions: value });
            }
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}

const MOBILE_STORES = [
  {
    label: "iPhone and iPad",
    store: "App Store",
    url: "https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824",
    icon: "apple",
  },
  {
    label: "Android",
    store: "Google Play",
    url: "https://play.google.com/store/apps/details?id=com.t3tools.t3code",
    icon: "android",
  },
] as const;

function MobileAppSettingsRow() {
  const theme = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <SettingsRow
      {...searchableSetting("mobile-app")}
      description="Connect to your server from your phone or tablet."
      control={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          {MOBILE_STORES.map((store) => (
            <Popover
              key={store.store}
              open={open === store.store}
              onOpenChange={(next) => setOpen(next ? store.store : null)}
              align="end"
              style={{ padding: 16, width: 240 }}
              trigger={
                <div
                  testId={`settings-mobile-${store.icon}`}
                  onClick={() => setOpen(open === store.store ? null : store.store)}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    height: 28,
                    paddingLeft: 9,
                    paddingRight: 9,
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: theme.input,
                    backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.026) : theme.popover,
                    cursor: "pointer",
                    hover: { backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.05) : theme.accent },
                  }}
                >
                  <BrandIcon name={store.icon} size={16} color={theme.mutedForeground} />
                  <Text weight={500}>{store.label}</Text>
                </div>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <Text weight={600}>{store.store}</Text>
                <Text size="xs" color={theme.mutedForeground}>
                  {store.url}
                </Text>
                <Button size="sm" variant="outline" onClick={() => openExternal(store.url)}>
                  {`Open ${store.store}`}
                </Button>
              </div>
            </Popover>
          ))}
        </div>
      }
    />
  );
}

const LEGACY_FEATURE_TARGET_IDS: ReadonlySet<string> = new Set(["legacy-plan-mode", "legacy-context-window-indicator", "legacy-sidebar"]);

function LegacyFeaturesSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const [open, setOpen] = useState(false);
  const { ref } = useSettingsSearchTarget("legacy-features");
  void LEGACY_FEATURE_TARGET_IDS;
  return (
    <div ref={ref as never} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <CollapsibleHeader open={open} onToggle={() => setOpen(!open)} testId="settings-legacy-features">
        Legacy features
      </CollapsibleHeader>
      {open ? (
        <SettingsGroup>
          <SettingsRow
            {...searchableSetting("legacy-plan-mode")}
            description="Restore Build/Plan, /plan, /default, and Shift+Tab. Off uses build mode."
            control={<Switch checked={settings.planModeEnabled} onChange={(checked) => updateSettings({ planModeEnabled: checked })} />}
          />
          <SettingsRow
            {...searchableSetting("legacy-context-window-indicator")}
            description="Shows context window usage as a circular indicator in the composer."
            control={
              <Switch checked={settings.contextWindowMeterEnabled} onChange={(checked) => updateSettings({ contextWindowMeterEnabled: checked })} />
            }
          />
          <SettingsRow
            {...searchableSetting("legacy-sidebar")}
            description="Restore per-project thread trees instead of the default flat sidebar."
            control={<Switch checked={settings.legacySidebarEnabled} onChange={(checked) => updateSettings({ legacySidebarEnabled: checked })} />}
          />
        </SettingsGroup>
      ) : null}
    </div>
  );
}

// Search ids each row component holds, for the virtual page (SettingsPageContainer `virtual`).
Object.assign(NotificationSettings, { searchIds: ["thread-notifications"] });
Object.assign(BackgroundActivitySettingsRow, { searchIds: ["background-activity"] });
Object.assign(ThreadTitleInstructionsSettings, { searchIds: ["thread-title-instructions"] });
Object.assign(MobileAppSettingsRow, { searchIds: ["mobile-app"] });
Object.assign(LegacyFeaturesSection, { searchIds: ["legacy-features", "legacy-context-window-indicator", "legacy-plan-mode", "legacy-sidebar"] });
Object.assign(ProjectDefaultsSettings, {
  searchIds: ["new-threads", "default-permissions", "worktree-submodules", "pull-request-merge-method", "remove-agent-credits-on-merge"],
});

export function GeneralSettingsPanel() {
  const theme = useTheme();
  const modifierLabel = isMacPlatform(PLATFORM) ? "⌘" : "Ctrl";
  const sendShortcutOptions = [
    { value: "enter", label: "Enter" },
    { value: "mod-enter-multiline", label: `${modifierLabel} + Enter for multiline prompts` },
    { value: "mod-enter", label: `${modifierLabel} + Enter always` },
  ] as const;
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { scope, environment, connectedEnvironments, target, targets } = useSettingsScope();
  const idleCompaction = scopedIdleCompaction(targets.length > 0 ? targets : [{ settings }]);
  const environmentId = environment?.environmentId ?? null;
  const isEnvironmentScope = scope.environmentIds.length === 1 && environmentId !== null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const mixedResponseStreamingMode = useScopedSettingsMixed(["responseStreamingMode"]);
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(readLastEnabledProjectGroupingMode());
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig ? providersByEnvironment.get(environment.environmentId) : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const supportsAutoSettlement =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every((candidate) => candidate.serverConfig?.environment.capabilities.threadAutoSettlement === true);
  const supportsAutoSettlementScope = connectedEnvironments.every(
    (candidate) => candidate.serverConfig?.environment.capabilities.threadAutoSettlementScope === true,
  );
  const supportsRestartContinuation =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every((candidate) => candidate.serverConfig?.environment.capabilities.threadRestartContinuation === true);

  const textGenerationProviders = serverProviders.filter((provider) => provider.supportsTextGeneration !== false);
  const textGenerationModelSelection = resolveAppModelSelectionState(settings, textGenerationProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(textGenerationProviders), settings, target?.projectId ?? null),
  );
  const hasTextGenerationProvider = textGenerationModelInstanceEntries.some((entry) => entry.enabled && entry.isAvailable);
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find((entry) => entry.instanceId === textGenInstanceId);
  const textGenProvider = textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGenerationProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const textGenerationModelDisabledReason = useScopedModelDisabledReason(settings, textGenerationModelInstanceEntries);
  const mixedAddProjectBaseDirectory = useScopedSettingsMixed(["addProjectBaseDirectory"]);
  const mixedTextGenerationModel = useScopedSettingsMixed(["textGenerationModelSelection"]);
  const d = DEFAULT_UNIFIED_SETTINGS;

  return (
    <SettingsPageContainer virtual>
      <ProjectDefaultsSettings category="general" />
      <SettingsSection id="organization" title="Organization">
        <SettingsRow
          {...searchableSetting("project-grouping")}
          description="Combine matching repositories across environments."
          resetAction={resetIf(settings.sidebarProjectGroupingMode !== d.sidebarProjectGroupingMode, "project grouping", () =>
            updateSettings({ sidebarProjectGroupingMode: d.sidebarProjectGroupingMode }),
          )}
          control={
            <Switch
              testId="settings-project-grouping"
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(checked, lastEnabledProjectGroupingMode.current),
                });
              }}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("project-order")}
          description="Order of projects in the sidebar project picker and command palette."
          resetAction={resetIf(settings.sidebarProjectSortOrder !== d.sidebarProjectSortOrder, "project order", () =>
            updateSettings({ sidebarProjectSortOrder: d.sidebarProjectSortOrder }),
          )}
          control={
            <SettingsSelect
              testId="settings-project-order"
              value={settings.sidebarProjectSortOrder}
              width={176}
              options={SidebarProjectSortOrder.literals.map((value) => ({ value, label: SIDEBAR_PROJECT_SORT_ORDER_LABELS[value] }))}
              onChange={(value) => updateSettings({ sidebarProjectSortOrder: value })}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("auto-resume-limited-threads")}
          description="Resume usage-limit stops at the reported reset time. Each thread can cancel its scheduled continuation."
          settingKeys={["autoResumeLimitedThreads"]}
          control={
            <ScopedSwitch
              testId="settings-auto-resume-limited-threads"
              settingKeys={["autoResumeLimitedThreads"]}
              checked={settings.autoResumeLimitedThreads}
              onChange={(checked) => updateSettings({ autoResumeLimitedThreads: checked })}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("snooze-limited-threads")}
          description="Snooze usage-limit stops until the reported reset time. Combine with auto-resume to continue when they wake."
          settingKeys={["snoozeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["snoozeLimitedThreads"]}
              checked={settings.snoozeLimitedThreads}
              onChange={(checked) => updateSettings({ snoozeLimitedThreads: checked })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("working-shelf")}
          description="Fold working and monitoring threads into a Working section. They return to the top of the inbox when they need you."
          resetAction={resetIf(settings.sidebarWorkingShelfEnabled !== d.sidebarWorkingShelfEnabled, "working section", () =>
            updateSettings({ sidebarWorkingShelfEnabled: d.sidebarWorkingShelfEnabled }),
          )}
          control={
            <Switch
              checked={settings.sidebarWorkingShelfEnabled}
              onChange={(checked) => updateSettings({ sidebarWorkingShelfEnabled: checked })}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["idleCompaction", "compactIdleThreads"]}
          mixed={idleCompaction.mixed}
          {...searchableSetting("compact-idle-threads")}
          description="When to compact an idle Claude thread over 200,000 tokens: after you return, just before its prompt cache expires, or never. Each Claude provider can override this."
          resetAction={resetIf(globalIdleCompaction(settings) !== globalIdleCompaction(d), "compact idle threads", () =>
            updateSettings({ idleCompaction: globalIdleCompaction(d) }),
          )}
          control={
            <SettingsSelect
              testId="settings-compact-idle-threads"
              value={idleCompaction.mixed ? null : globalIdleCompaction(settings)}
              width={224}
              options={IDLE_COMPACTION_MODES.map((mode) => ({
                value: mode.value,
                label: mode.label,
                disabled: mode.value === "off" && !idleCompaction.neverAvailable,
              }))}
              onChange={(value) => updateSettings({ idleCompaction: value })}
            />
          }
        />
        {supportsAutoSettlement ? (
          <>
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleOnMerge"]}
              {...searchableSetting("auto-settle-merged-threads")}
              description="Settle a thread when its pull request merges. Closed pull requests still settle automatically."
              resetAction={resetIf(settings.sidebarAutoSettleOnMerge !== d.sidebarAutoSettleOnMerge, "auto-settle on merge", () =>
                updateSettings({ sidebarAutoSettleOnMerge: d.sidebarAutoSettleOnMerge }),
              )}
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleOnMerge"]}
                  checked={settings.sidebarAutoSettleOnMerge}
                  onChange={(checked) => updateSettings({ sidebarAutoSettleOnMerge: checked })}
                />
              }
            />
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleAfterDays"]}
              {...searchableSetting("auto-settle-inactive-threads")}
              description="Sidebar threads with no activity for this long settle automatically."
              resetAction={resetIf(settings.sidebarAutoSettleAfterDays !== d.sidebarAutoSettleAfterDays, "auto-settle", () =>
                updateSettings({ sidebarAutoSettleAfterDays: d.sidebarAutoSettleAfterDays }),
              )}
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleAfterDays"]}
                  checked={settings.sidebarAutoSettleAfterDays !== null}
                  onChange={(checked) => updateSettings({ sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null })}
                />
              }
            />
            {settings.sidebarAutoSettleAfterDays !== null ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleAfterDays"]}
                title={searchableSetting("days-before-auto-settle").title}
                description="Any new activity un-settles a thread automatically."
                control={
                  <NumberField
                    testId="settings-auto-settle-days"
                    value={settings.sidebarAutoSettleAfterDays}
                    min={MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
                    max={MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
                    onCommit={(days) => updateSettings({ sidebarAutoSettleAfterDays: days })}
                  />
                }
              />
            ) : null}
            {settings.sidebarAutoSettleAfterDays !== null && supportsAutoSettlementScope ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                title="Keep threads with a PR"
                description="Inactivity does not settle threads with a pull request. Merge and close still do."
                control={
                  <ScopedSwitch
                    settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                    checked={settings.sidebarAutoSettleKeepPullRequests}
                    onChange={(checked) => updateSettings({ sidebarAutoSettleKeepPullRequests: checked })}
                  />
                }
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>
      <SettingsSection id="behavior" title="Behavior">
        <NotificationSettings />
        <SettingsRow
          {...searchableSetting("in-app-notifications")}
          description="Show a toast when another thread finishes, fails, or needs input or approval while this app has focus."
          control={
            <Switch
              testId="settings-in-app-notifications"
              checked={settings.inAppNotificationsEnabled}
              onChange={(checked) => updateSettings({ inAppNotificationsEnabled: checked })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("time-format")}
          description="System default follows your browser or OS clock preference."
          resetAction={resetIf(settings.timestampFormat !== d.timestampFormat, "time format", () =>
            updateSettings({ timestampFormat: d.timestampFormat }),
          )}
          control={
            <SettingsSelect
              testId="settings-time-format"
              value={settings.timestampFormat}
              options={(["locale", "12-hour", "24-hour"] as const).map((value) => ({ value, label: TIMESTAMP_FORMAT_LABELS[value] }))}
              onChange={(value) => updateSettings({ timestampFormat: value })}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["responseStreamingMode"]}
          {...searchableSetting("response-streaming")}
          description={
            mixedResponseStreamingMode
              ? "The selected targets use different streaming modes."
              : RESPONSE_STREAMING_MODE_DESCRIPTIONS[settings.responseStreamingMode]
          }
          resetAction={resetIf(settings.responseStreamingMode !== d.responseStreamingMode, "response streaming", () =>
            updateSettings({ responseStreamingMode: d.responseStreamingMode }),
          )}
          control={
            <SettingsSelect
              testId="settings-response-streaming"
              value={mixedResponseStreamingMode ? null : settings.responseStreamingMode}
              width={224}
              options={(["turn", "paragraph"] as const).map((value) => ({ value, label: RESPONSE_STREAMING_MODE_LABELS[value] }))}
              onChange={(value) => updateSettings({ responseStreamingMode: value })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("hide-whitespace-changes")}
          description="Set whether the diff panel ignores whitespace-only edits by default."
          resetAction={resetIf(settings.diffIgnoreWhitespace !== d.diffIgnoreWhitespace, "diff whitespace changes", () =>
            updateSettings({ diffIgnoreWhitespace: d.diffIgnoreWhitespace }),
          )}
          control={
            <Switch
              testId="settings-hide-whitespace"
              checked={settings.diffIgnoreWhitespace}
              onChange={(checked) => updateSettings({ diffIgnoreWhitespace: checked })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("default-diff-file-state")}
          description="Start with files expanded or collapsed when opening diffs or a pull request's Code tab."
          resetAction={resetIf(settings.diffFilesCollapsed !== d.diffFilesCollapsed, "default diff file state", () =>
            updateSettings({ diffFilesCollapsed: d.diffFilesCollapsed }),
          )}
          control={
            <SettingsSelect
              value={settings.diffFilesCollapsed ? "collapsed" : "expanded"}
              options={[
                { value: "expanded", label: "Expanded" },
                { value: "collapsed", label: "Collapsed" },
              ]}
              onChange={(value) => updateSettings({ diffFilesCollapsed: value === "collapsed" })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("diff-layout")}
          description="Show diffs stacked or side by side. The toggle in the diff toolbar changes this too."
          resetAction={resetIf(settings.diffLayout !== d.diffLayout, "diff layout", () => updateSettings({ diffLayout: d.diffLayout }))}
          control={
            <SettingsSelect
              value={settings.diffLayout}
              options={(["stacked", "split"] as const).map((value) => ({ value, label: DIFF_LAYOUT_LABELS[value] }))}
              onChange={(value) => updateSettings({ diffLayout: value })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("proactive-panels")}
          description="Open linked pull requests first. Otherwise, open Changes for edits to at least 3 files or 50 lines."
          resetAction={resetIf(settings.proactivePanelsEnabled !== d.proactivePanelsEnabled, "proactive panels", () =>
            updateSettings({ proactivePanelsEnabled: d.proactivePanelsEnabled }),
          )}
          control={<Switch checked={settings.proactivePanelsEnabled} onChange={(checked) => updateSettings({ proactivePanelsEnabled: checked })} />}
        />
        <SettingsRow
          {...searchableSetting("skills-in-slash-menu")}
          description="Also include skills in the / command menu. Skills always appear when you type $."
          resetAction={resetIf(settings.showSkillsInSlashMenu !== d.showSkillsInSlashMenu, "skills in slash menu", () =>
            updateSettings({ showSkillsInSlashMenu: d.showSkillsInSlashMenu }),
          )}
          control={<Switch checked={settings.showSkillsInSlashMenu} onChange={(checked) => updateSettings({ showSkillsInSlashMenu: checked })} />}
        />
        <SettingsRow
          {...searchableSetting("composer-rich-text")}
          description="Show formatted Markdown as you type."
          resetAction={resetIf(settings.composerRichTextEnabled !== d.composerRichTextEnabled, "rich text composer", () =>
            updateSettings({ composerRichTextEnabled: d.composerRichTextEnabled }),
          )}
          control={
            <Switch checked={settings.composerRichTextEnabled} onChange={(checked) => updateSettings({ composerRichTextEnabled: checked })} />
          }
        />
        <SettingsRow
          {...searchableSetting("composer-collapse")}
          description="Rest the composer of an existing thread into a single line when you scroll the conversation. Focus the composer or start typing to expand it again."
          resetAction={resetIf(settings.composerCollapseOnScroll !== d.composerCollapseOnScroll, "collapse composer on scroll", () =>
            updateSettings({ composerCollapseOnScroll: d.composerCollapseOnScroll }),
          )}
          control={
            <Switch checked={settings.composerCollapseOnScroll} onChange={(checked) => updateSettings({ composerCollapseOnScroll: checked })} />
          }
        />
        <SettingsRow
          {...searchableSetting("send-shortcut")}
          description="Choose when Enter sends a prompt or inserts a new line"
          resetAction={resetIf(settings.sendShortcut !== d.sendShortcut, "send shortcut", () => updateSettings({ sendShortcut: d.sendShortcut }))}
          control={
            <SettingsSelect
              testId="settings-send-shortcut"
              value={settings.sendShortcut}
              width="auto"
              menuWidth={280}
              options={sendShortcutOptions.map((option) => ({ value: option.value, label: option.label }))}
              onChange={(value) => updateSettings({ sendShortcut: value })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("follow-up-behavior")}
          description={
            "Queue follow-ups while the agent runs or steer the current run. " +
            (settings.sendShortcut === "mod-enter-multiline"
              ? `Press ${modifierLabel} + Enter for single-line prompts or ${modifierLabel} + Shift + Enter for multiline prompts to do the opposite for one message.`
              : `Press ${modifierLabel}${settings.sendShortcut === "mod-enter" ? " + Shift" : ""} + Enter to do the opposite for one message.`)
          }
          resetAction={resetIf(settings.followUpBehavior !== d.followUpBehavior, "follow-up behavior", () =>
            updateSettings({ followUpBehavior: d.followUpBehavior }),
          )}
          control={
            <SettingsSelect
              value={settings.followUpBehavior}
              width="auto"
              menuWidth={120}
              options={[
                { value: "queue", label: "Queue" },
                { value: "steer", label: "Steer" },
              ]}
              onChange={(value) => updateSettings({ followUpBehavior: value })}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["enableProviderUpdateChecks"]}
          {...searchableSetting("provider-update-checks")}
          description="Check installed provider CLIs for newer available versions and fetch model catalog updates. When off, new models may not appear."
          resetAction={resetIf(settings.enableProviderUpdateChecks !== d.enableProviderUpdateChecks, "provider update checks", () =>
            updateSettings({ enableProviderUpdateChecks: d.enableProviderUpdateChecks }),
          )}
          control={
            <ScopedSwitch
              settingKeys={["enableProviderUpdateChecks"]}
              checked={settings.enableProviderUpdateChecks}
              onChange={(checked) => updateSettings({ enableProviderUpdateChecks: checked })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("continue-threads-after-server-update")}
          serverScoped
          settingKeys={["continueThreadsAfterServerUpdate"]}
          description="Automatically resume interrupted threads after an update, crash, or machine restart on the selected environments."
          status={!supportsRestartContinuation ? "All selected connected environments must support restart continuation." : undefined}
          resetAction={resetIf(
            supportsRestartContinuation && settings.continueThreadsAfterServerUpdate !== d.continueThreadsAfterServerUpdate,
            "continue threads after restarts",
            () => updateSettings({ continueThreadsAfterServerUpdate: d.continueThreadsAfterServerUpdate }),
          )}
          control={
            <ScopedSwitch
              settingKeys={["continueThreadsAfterServerUpdate"]}
              checked={settings.continueThreadsAfterServerUpdate}
              disabled={!supportsRestartContinuation}
              onChange={(checked) => updateSettings({ continueThreadsAfterServerUpdate: checked })}
            />
          }
        />
        <BackgroundActivitySettingsRow />
      </SettingsSection>
      <SettingsSection id="projects-and-threads" title="Projects & threads">
        <SettingsRow
          serverScoped
          settingKeys={["newWorktreesStartFromOrigin"]}
          {...searchableSetting("start-from-origin")}
          description="Uses the latest commit of the base branch’s tracked remote branch, even if its name differs. Otherwise uses the same-named branch on origin. Uses your local branch if that remote branch is missing."
          resetAction={resetIf(settings.newWorktreesStartFromOrigin !== d.newWorktreesStartFromOrigin, "new worktrees start from remote", () =>
            updateSettings({ newWorktreesStartFromOrigin: d.newWorktreesStartFromOrigin }),
          )}
          control={
            <ScopedSwitch
              settingKeys={["newWorktreesStartFromOrigin"]}
              checked={settings.newWorktreesStartFromOrigin}
              onChange={(checked) => updateSettings({ newWorktreesStartFromOrigin: checked })}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["addProjectBaseDirectory"]}
          {...searchableSetting("add-project-starts-in")}
          description='Leave empty to use "~/" when the Add Project browser opens.'
          resetAction={resetIf(settings.addProjectBaseDirectory !== d.addProjectBaseDirectory, "add project base directory", () =>
            updateSettings({ addProjectBaseDirectory: d.addProjectBaseDirectory }),
          )}
          control={
            <DraftTextField
              testId="settings-add-project-base-directory"
              size="sm"
              width={288}
              value={mixedAddProjectBaseDirectory ? "" : settings.addProjectBaseDirectory}
              placeholder={mixedAddProjectBaseDirectory ? "Mixed" : "~/"}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
            />
          }
        />
      </SettingsSection>
      <SettingsSection id="confirmations" title="Confirmations">
        <SettingsRow
          {...searchableSetting("unpin-confirmation")}
          description="Ask before unpinning a thread from the pinned section."
          resetAction={resetIf(settings.confirmThreadUnpin !== d.confirmThreadUnpin, "unpin confirmation", () =>
            updateSettings({ confirmThreadUnpin: d.confirmThreadUnpin }),
          )}
          control={<Switch checked={settings.confirmThreadUnpin} onChange={(checked) => updateSettings({ confirmThreadUnpin: checked })} />}
        />
        <SettingsRow
          {...searchableSetting("archive-confirmation")}
          description="Require a second click on the inline archive action before a thread is archived."
          resetAction={resetIf(settings.confirmThreadArchive !== d.confirmThreadArchive, "archive confirmation", () =>
            updateSettings({ confirmThreadArchive: d.confirmThreadArchive }),
          )}
          control={
            <Switch testId="settings-archive-confirmation" checked={settings.confirmThreadArchive} onChange={(checked) => updateSettings({ confirmThreadArchive: checked })} />
          }
        />
        <SettingsRow
          {...searchableSetting("delete-confirmation")}
          description="Ask before deleting a thread and its chat history."
          resetAction={resetIf(settings.confirmThreadDelete !== d.confirmThreadDelete, "delete confirmation", () =>
            updateSettings({ confirmThreadDelete: d.confirmThreadDelete }),
          )}
          control={<Switch checked={settings.confirmThreadDelete} onChange={(checked) => updateSettings({ confirmThreadDelete: checked })} />}
        />
      </SettingsSection>
      <SettingsSection id="text-generation" title="Text generation">
        <SettingsRow
          serverScoped
          settingKeys={["textGenerationModelSelection"]}
          {...searchableSetting("text-generation-model")}
          description="Used for thread titles and other generated text on connected devices with this provider. Source control can override it."
          resetAction={resetIf(hasServerTargets && isTextGenerationModelDirty, "text generation model", () =>
            updateSettings({ textGenerationModelSelection: d.textGenerationModelSelection }),
          )}
          control={
            !hasServerTargets ? (
              <Text color={theme.mutedForeground}>Connect an environment to choose its text generation model.</Text>
            ) : !hasTextGenerationProvider ? (
              <Text color={theme.mutedForeground}>No text generation providers available.</Text>
            ) : (
              <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                <SettingsModelPicker
                  testId="settings-text-generation-model"
                  entries={textGenerationModelInstanceEntries}
                  activeInstanceId={textGenInstanceId}
                  model={textGenModel}
                  modelOptionsByInstance={textGenerationModelOptionsByInstance}
                  {...(mixedTextGenerationModel ? { triggerLabel: "Mixed" } : {})}
                  getModelDisabledReason={textGenerationModelDisabledReason}
                  onOpenProviderSetup={() => openSettingsPage("providers")}
                  onInstanceModelChange={(instanceId, model) => {
                    const reason = textGenerationModelDisabledReason(instanceId, model);
                    if (reason) {
                      toast({ type: "error", title: "Text generation model not saved", description: reason });
                      return;
                    }
                    updateSettings({
                      textGenerationModelSelection: resolveAppModelSelectionState(
                        { ...settings, textGenerationModelSelection: createModelSelection(instanceId, model) },
                        textGenerationProviders,
                      ),
                    });
                  }}
                />
                {textGenInstanceEntry ? (
                  <SettingsTraitsPicker
                    testId="settings-text-generation-traits"
                    provider={textGenProvider}
                    models={textGenInstanceEntry.models}
                    model={textGenModel}
                    modelOptions={textGenModelOptions}
                    planModeEnabled={settings.planModeEnabled || selectsPlanAgent(textGenModelOptions)}
                    onModelOptionsChange={(nextOptions) =>
                      updateSettings({
                        textGenerationModelSelection: resolveAppModelSelectionState(
                          {
                            ...settings,
                            textGenerationModelSelection: createModelSelection(textGenInstanceId, textGenModel, nextOptions),
                          },
                          textGenerationProviders,
                        ),
                      })
                    }
                  />
                ) : null}
              </div>
            )
          }
        />
        <ThreadTitleInstructionsSettings />
      </SettingsSection>
      <SettingsSection id="about" title="About">
        <SettingsRow
          id={searchableSetting("app-version").id}
          title={
            <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              <Text weight={500}>Version</Text>
              <Text size="2xs" weight={500} mono color={theme.mutedForeground}>
                {APP_VERSION}
              </Text>
            </div>
          }
          description="Current version of the application."
        />
        <MobileAppSettingsRow />
        <SettingsRow
          {...searchableSetting("privacy-policy")}
          description="How we handle your data, including the anonymous usage data T3 Code collects."
          control={
            <Button size="sm" variant="outline" onClick={() => openExternal(PRIVACY_POLICY_URL)} testId="settings-privacy-policy">
              View policy
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title="Diagnostics">
        <SettingsRow
          {...searchableSetting("diagnostics")}
          description={
            isEnvironmentScope
              ? "Inspect processes, resource use, and logs on this environment."
              : "Inspect processes, resource use, and logs on one environment at a time."
          }
          control={
            <Button size="sm" variant="outline" onClick={() => openSettingsPage("diagnostics")} testId="settings-view-diagnostics">
              View diagnostics
            </Button>
          }
        />
        <SettingsRow
          {...searchableSetting("open-source-licenses")}
          description="Notices for dependencies, assets, and optional tools used by T3 Code."
          control={
            <Button size="sm" variant="outline" onClick={() => openSettingsPage("open-source-licenses")} testId="settings-view-licenses">
              View licenses
            </Button>
          }
        />
      </SettingsSection>
      <LegacyFeaturesSection />
    </SettingsPageContainer>
  );
}

