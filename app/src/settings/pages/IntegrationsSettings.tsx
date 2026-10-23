// Port of apps/web/src/components/settings/IntegrationsSettings.tsx as the hosted
// web app renders it: the browser preview defaults depend on the desktop
// preview bridge (profiles, cookie import, viewport), so they show disabled under
// "Only available in the desktop app." until t3-term's browser surface reads them.
// Agent browser access, search engine, pull request links and the Devices section
// are live.
import {
  AuthSettingsWriteScope,
  BROWSER_RECORDING_FRAME_RATES,
  BrowserSearchEngine,
  DEFAULT_BROWSER_SEARCH_ENGINE,
  DEFAULT_SERVER_SETTINGS,
  PREVIEW_ZOOM_LEVELS,
  findBrowserProfile,
  resolveBrowserProfiles,
  DEFAULT_BROWSER_PROFILE_ID,
  type BrowserLinkTarget,
  type EnvironmentId,
  type PreviewAppearancePreference,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import { isValidSearchUrlTemplate } from "@t3tools/shared/preview";
import { PREVIEW_VIEWPORT_PRESETS } from "@t3tools/shared/previewViewport";
import { useState, type ReactNode } from "react";

import { updateClientSettings, useClientSettings } from "../../state/clientSettings.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironmentScope } from "../../state/settings.ts";
import { Switch } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { formatEnvironmentQueryError } from "../query.ts";
import { DraftTextField, SettingsSelect } from "../controls.tsx";
import { SettingResetButton, SettingsPageContainer, SettingsRow, SettingsSection, SettingsUnavailableGroup } from "../layout.tsx";
import { ScopedSwitch } from "../ProjectDefaultsSettings.tsx";
import { useScopedSettings, useSettingsScope, useUpdateScopedSettings } from "../scope.tsx";
import {
  AgentDeviceSetupStatus,
  DeviceHostDiagnostics,
  DeviceHostUpdates,
  DeviceHubSetupStatus,
  DeviceToolVersions,
  PlatformStatus,
  agentDeviceDescription,
  deviceHubDescription,
  deviceHubReadiness,
  platformSetupStatus,
} from "../integrations/DeviceParts.tsx";
import { DeviceHostsSettings } from "../integrations/DeviceHostsSettings.tsx";
import { EasDeviceHostsSettings } from "../integrations/EasDeviceHostsSettings.tsx";
import { deviceEnvironment, useDeviceState } from "../integrations/state.ts";

function resetIf(dirty: boolean, label: string, onClick: () => void) {
  return dirty ? <SettingResetButton label={label} onClick={onClick} /> : null;
}

// ── Browser ─────────────────────────────────────────────────────────────

const APPEARANCE_LABELS: Readonly<Record<PreviewAppearancePreference, string>> = { system: "System", light: "Light", dark: "Dark" };
const LINK_TARGET_LABELS: Readonly<Record<BrowserLinkTarget, string>> = { system: "Your default browser", app: "T3 Code" };
const SEARCH_ENGINE_LABELS: Readonly<Record<BrowserSearchEngine, string>> = {
  duckduckgo: "DuckDuckGo",
  google: "Google",
  bing: "Bing",
  brave: "Brave Search",
  kagi: "Kagi",
  ecosia: "Ecosia",
  custom: "Custom",
};
const zoomLabel = (zoomFactor: number) => `${Math.round(zoomFactor * 100)}%`;

const viewportSelectValue = (viewport: PreviewViewportSetting): string => {
  if (viewport._tag === "fill") return "fill";
  if (viewport._tag === "preset" && PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === viewport.presetId)) return viewport.presetId;
  return "responsive";
};
const viewportSelectLabel = (viewport: PreviewViewportSetting): string => {
  const value = viewportSelectValue(viewport);
  if (value === "fill") return "Fill panel";
  if (value === "responsive") return "Responsive";
  return PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === value)?.label ?? "Responsive";
};

function AgentBrowserAccessSetting() {
  const { scope } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  return (
    <SettingsRow
      serverScoped
      settingKeys={["enableAgentBrowserAccess"]}
      {...searchableSetting("agent-browser-access")}
      description={
        isProjectScope
          ? "Allow agents in this project to use the shared browser. Applies when the agent session next starts."
          : "Allow agents to use the shared browser. Projects can override it."
      }
      resetAction={resetIf(settings.enableAgentBrowserAccess !== DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess, "default browser access", () =>
        updateSettings({ enableAgentBrowserAccess: DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess }),
      )}
      control={
        <ScopedSwitch
          testId="settings-agent-browser-access"
          settingKeys={["enableAgentBrowserAccess"]}
          checked={settings.enableAgentBrowserAccess}
          onChange={(enabled) => updateSettings({ enableAgentBrowserAccess: enabled })}
        />
      }
    />
  );
}

/** The preview defaults, shown disabled: they need the desktop preview bridge. */
function BrowserPreviewDefaults() {
  const theme = useTheme();
  const settings = useClientSettings();
  const profiles = resolveBrowserProfiles(settings.browserProfiles).filter((profile) => profile.kind !== "incognito");
  const defaultId = findBrowserProfile(profiles, settings.browserDefaultProfileId)?.id ?? DEFAULT_BROWSER_PROFILE_ID;
  const noop = () => {};
  return (
    <>
      <SettingsRow
        {...searchableSetting("browser-profiles")}
        description="Profiles separate cookies and logins. Incognito data is cleared when the app closes."
        control={
          <Button size="sm" variant="outline" icon="plus" disabled>
            Add profile
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8, marginBottom: 8, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
          {profiles.map((profile, index) => (
            <div
              key={profile.id}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 8,
                paddingBottom: 8,
                ...(index > 0 ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) } : {}),
              }}
            >
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, minWidth: 0 }}>
                <Text truncate>{profile.name}</Text>
                {profile.id === defaultId ? (
                  <div style={{ display: "flex", paddingLeft: 4, paddingRight: 4, borderRadius: RADIUS.sm, backgroundColor: theme.primary }}>
                    <Text size="xs" weight={500} color={theme.primaryForeground}>
                      Default
                    </Text>
                  </div>
                ) : null}
              </div>
              <IconButton icon="ellipsis-vertical" size={24} iconSize={14} color={theme.mutedForeground} disabled onClick={noop} />
            </div>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow
        {...searchableSetting("browser-default-viewport")}
        description="Tab size for you and agents. Fill fits the panel; other sizes show the device toolbar."
        control={
          <SettingsSelect
            disabled
            value={viewportSelectValue(settings.browserDefaultViewport)}
            label={viewportSelectLabel(settings.browserDefaultViewport)}
            options={[
              { value: "fill", label: "Fill panel" },
              { value: "responsive", label: "Responsive" },
              ...PREVIEW_VIEWPORT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
            ]}
            width={176}
            onChange={noop}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("browser-default-zoom")}
        description="Page zoom applied to new browser tabs."
        control={
          <SettingsSelect
            disabled
            value={String(settings.browserDefaultZoomFactor)}
            options={PREVIEW_ZOOM_LEVELS.map((level) => ({ value: String(level), label: zoomLabel(level) }))}
            onChange={noop}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("browser-default-appearance")}
        description="The color scheme pages are told to prefer. System follows your OS setting."
        control={
          <SettingsSelect
            disabled
            value={settings.browserDefaultAppearance}
            options={(Object.keys(APPEARANCE_LABELS) as PreviewAppearancePreference[]).map((value) => ({ value, label: APPEARANCE_LABELS[value] }))}
            onChange={noop}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("browser-recording-frame-rate")}
        description="Maximum recording rate. 30 fps saves CPU and storage; 60 fps is smoother."
        control={
          <SettingsSelect
            disabled
            value={String(settings.browserRecordingFrameRate)}
            options={BROWSER_RECORDING_FRAME_RATES.map((rate) => ({ value: String(rate), label: `${rate} fps` }))}
            onChange={noop}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("browser-recording-key-presses")}
        description="Show pressed keys and shortcuts in new recordings. Password fields are excluded."
        control={<Switch disabled checked={settings.browserRecordingShowKeyPresses} onChange={noop} />}
      />
      <SettingsRow
        {...searchableSetting("browser-recording-mouse-presses")}
        description="Highlight mouse presses and held buttons in new recordings."
        control={<Switch disabled checked={settings.browserRecordingShowMousePresses} onChange={noop} />}
      />
      <SettingsRow
        {...searchableSetting("browser-link-target")}
        description="Where links in the chat and terminal open. Hold ⌘ or Ctrl while clicking a link to open it in your default browser either way."
        control={
          <SettingsSelect
            disabled
            value={settings.browserLinkTarget}
            options={(Object.keys(LINK_TARGET_LABELS) as BrowserLinkTarget[]).map((value) => ({ value, label: LINK_TARGET_LABELS[value] }))}
            onChange={noop}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("browser-auto-show-floating-preview")}
        description="Show the floating preview when an agent opens a browser or device unless the agent says otherwise."
        control={<Switch disabled checked={settings.browserAutoShowFloatingPreview} onChange={noop} />}
      />
    </>
  );
}

function BrowserSearchEngineSetting() {
  const engine = useClientSettings((settings) => settings.browserSearchEngine);
  const customUrl = useClientSettings((settings) => settings.browserCustomSearchUrl);
  return (
    <>
      <SettingsRow
        {...searchableSetting("browser-search-engine")}
        description="What the address bar searches when you type something that isn't a URL."
        resetAction={resetIf(engine !== DEFAULT_BROWSER_SEARCH_ENGINE || customUrl !== "", "search engine", () =>
          updateClientSettings({ browserSearchEngine: DEFAULT_BROWSER_SEARCH_ENGINE, browserCustomSearchUrl: "" }),
        )}
        control={
          <SettingsSelect
            testId="settings-browser-search-engine"
            value={engine}
            options={BrowserSearchEngine.literals.map((literal) => ({ value: literal, label: SEARCH_ENGINE_LABELS[literal] }))}
            onChange={(value) => updateClientSettings({ browserSearchEngine: value })}
          />
        }
      />
      {engine === "custom" ? (
        <SettingsRow
          title="Custom search URL"
          description="Use %s where the search terms go."
          status={isValidSearchUrlTemplate(customUrl) ? undefined : "Enter an http or https URL containing %s. Searches use DuckDuckGo until then."}
          control={
            <DraftTextField
              size="sm"
              width={256}
              testId="settings-browser-custom-search-url"
              placeholder="https://example.com/search?q=%s"
              value={customUrl}
              onCommit={(next) => updateClientSettings({ browserCustomSearchUrl: next.trim() })}
            />
          }
        />
      ) : null}
    </>
  );
}

function PullRequestLinksOpenInAppSetting() {
  const openInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  return (
    <SettingsRow
      {...searchableSetting("pull-request-links-open-in-app")}
      description="Clicking a pull request link opens it in T3 Code. Turn off to open pull request links like any other link, on GitHub or your git host."
      resetAction={resetIf(!openInApp, "open pull requests in T3 Code", () => updateClientSettings({ pullRequestLinksOpenInApp: true }))}
      control={
        <Switch testId="settings-pull-request-links-open-in-app" checked={openInApp} onChange={(checked) => updateClientSettings({ pullRequestLinksOpenInApp: checked })} />
      }
    />
  );
}

// ── Devices ─────────────────────────────────────────────────────────────

function DeviceIntegrationSettings() {
  const { search, environment: selected } = useSettingsScope();
  const settings = useScopedSettings();
  const connected = selected?.connection.phase === "connected" && selected.serverConfig !== null;
  const environmentId = connected ? selected.environmentId : null;
  return (
    <SettingsSection id="devices" title="Devices">
      <DeviceIntegrationControls
        key={`${environmentId}:${JSON.stringify(search)}`}
        environmentId={environmentId}
        enabled={settings.enableDeviceSupport}
        agentAccessEnabled={settings.enableAgentDeviceAccess}
      />
    </SettingsSection>
  );
}

function DeviceIntegrationControls({ environmentId, enabled, agentAccessEnabled }: { environmentId: EnvironmentId | null; enabled: boolean; agentAccessEnabled: boolean }) {
  const theme = useTheme();
  const canConfigure = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const { state, loaded } = useDeviceState(environmentId);
  const { scope, environments, connectedEnvironments } = useSettingsScope();
  const updateSettings = useUpdateScopedSettings();
  const projectScope = scope.kind === "project" || scope.kind === "checkout";
  const anyHubEnabled = connectedEnvironments.some((environment) => environment.serverConfig?.settings.enableDeviceSupport);
  const configure = useAtomCommand(deviceEnvironment.configure, { reportFailure: false });
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const [pending, setPending] = useState<"hub" | "check" | "agent" | "update-hub" | "update-agent" | null>(null);
  const { ready: hubReady, busy } = deviceHubReadiness(state);
  const localPlatformsUnavailable = state.hosts.some((host) => host.kind === "local" && !host.platforms.some((platform) => platform.available));
  const [platformsRevealed, setPlatformsRevealed] = useState(false);
  if (platformsRevealed && !enabled) setPlatformsRevealed(false);
  if (enabled && !platformsRevealed && (hubReady || localPlatformsUnavailable) && pending !== "hub") setPlatformsRevealed(true);

  const update = async (kind: NonNullable<typeof pending>, input: { enabled?: boolean; agentAccessEnabled?: boolean }) => {
    if (!environmentId || !readEnvironmentScope(environmentId, AuthSettingsWriteScope)) return;
    setPending(kind);
    const results = await Promise.allSettled(
      environments.map(async (environment) => {
        if (environment.connection.phase !== "connected" || !environment.serverConfig) throw new Error("Environment disconnected");
        if (!readEnvironmentScope(environment.environmentId, AuthSettingsWriteScope)) throw new Error("This connection cannot change device settings.");
        return configure({ environmentId: environment.environmentId, input: { ...input, ...(input.enabled ? { onboardingCompleted: true } : {}) } });
      }),
    );
    setPending(null);
    const failed = environments.filter((_, index) => {
      const result = results[index];
      return result?.status !== "fulfilled" || result.value._tag === "Failure";
    });
    if (failed.length > 0) {
      toast({
        type: "error",
        title: "Device settings not saved on all environments",
        description: `Could not update ${failed.map((environment) => environment.label).join(", ")}.`,
      });
    }
  };

  const [updateError, setUpdateError] = useState<{ tool: "hub" | "agent"; message: string } | null>(null);
  const localTools = state.hosts.find((host) => host.kind === "local")?.tools;
  const versionActions = (tool: "hub" | "agent") => {
    const version = localTools?.[tool];
    const needsUpdate = version && !version.installedVersions.includes(version.requiredVersion);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {state.supportsToolUpdate && needsUpdate ? (
            <Button
              size="sm"
              disabled={!environmentId || pending !== null || busy}
              onClick={() => {
                if (!environmentId) return;
                setUpdateError(null);
                setPending(`update-${tool}`);
                void list({ environmentId, input: { updateTool: tool } })
                  .then((result) => {
                    if (result._tag === "Failure") setUpdateError({ tool, message: formatEnvironmentQueryError(result.cause) });
                  })
                  .finally(() => setPending(null));
              }}
            >
              {pending === `update-${tool}` ? "Updating…" : `Update to v${version.requiredVersion}`}
            </Button>
          ) : null}
          {state.supportsToolInspection ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!environmentId || pending !== null || busy}
              onClick={() => {
                if (!environmentId) return;
                setPending("check");
                void list({ environmentId, input: { inspectOnly: true } }).finally(() => setPending(null));
              }}
            >
              {pending === "check" ? "Checking…" : "Check versions"}
            </Button>
          ) : null}
        </div>
        {updateError?.tool === tool ? (
          <Text size="xs" color={theme.errorForeground}>
            {updateError.message}
          </Text>
        ) : null}
      </div>
    );
  };
  const controlRow = (children: ReactNode) => <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>{children}</div>;

  return (
    <>
      <SettingsRow
        {...searchableSetting("device-hub")}
        serverScoped
        settingKeys={["enableDeviceSupport"]}
        description={deviceHubDescription}
        control={controlRow(
          <>
            <DeviceToolVersions action={versionActions("hub")} kind="hub" tools={localTools} />
            {pending === "hub" ? <DeviceHubSetupStatus state={state} pending compact /> : null}
            <ScopedSwitch
              testId="settings-device-hub"
              settingKeys={["enableDeviceSupport"]}
              checked={enabled}
              disabled={!canConfigure || projectScope || !loaded || !environmentId || busy || pending !== null}
              onChange={(checked) => void update("hub", { enabled: checked, ...(checked ? {} : { agentAccessEnabled: false }) })}
            />
          </>,
        )}
      />
      {platformsRevealed ? (
        <SettingsRow
          {...searchableSetting("device-platform-support")}
          description={
            connectedEnvironments.length > 1
              ? `Status for ${connectedEnvironments.find((environment) => environment.environmentId === environmentId)?.label}. Select an environment to inspect its simulator support.`
              : undefined
          }
          status={
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", columnGap: 20, rowGap: 8 }}>
                <PlatformStatus compact platform="iOS" status={platformSetupStatus(state, "ios")} />
                <PlatformStatus compact platform="Android" status={platformSetupStatus(state, "android")} />
              </div>
              {/* Remote hosts report their own warnings in the device host list below. */}
              <DeviceHostDiagnostics hosts={state.hosts.filter((host) => host.kind === "local")} hostStatuses={state.hostStatuses} />
            </div>
          }
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!environmentId || !enabled || busy || pending !== null}
              onClick={() => {
                if (!environmentId) return;
                setPending("check");
                void list({ environmentId, input: {} }).finally(() => setPending(null));
              }}
            >
              {pending === "check" ? "Checking…" : "Refresh"}
            </Button>
          }
        />
      ) : null}
      <SettingsRow
        {...searchableSetting("agent-device-access")}
        serverScoped
        settingKeys={["enableAgentDeviceAccess"]}
        description={agentDeviceDescription}
        control={controlRow(
          <>
            <DeviceToolVersions action={versionActions("agent")} kind="agent" tools={localTools} />
            {pending === "agent" ? <AgentDeviceSetupStatus state={state} pending compact /> : null}
            <ScopedSwitch
              testId="settings-agent-device-access"
              settingKeys={["enableAgentDeviceAccess"]}
              checked={agentAccessEnabled}
              disabled={!canConfigure || connectedEnvironments.length === 0 || (!projectScope && (!loaded || !anyHubEnabled || busy)) || pending !== null}
              onChange={(checked) => (projectScope ? updateSettings({ enableAgentDeviceAccess: checked }) : void update("agent", { agentAccessEnabled: checked }))}
            />
          </>,
        )}
      />
      {environmentId ? <DeviceHostUpdates state={{ ...state, hosts: state.hosts.filter((host) => host.kind === "local") }} environmentId={environmentId} /> : null}
      <DeviceHostsSettings environmentId={environmentId} />
      {state.supportsEasHosts ? <EasDeviceHostsSettings environmentId={environmentId} /> : null}
    </>
  );
}

export function IntegrationsSettings() {
  return (
    <SettingsPageContainer virtual>
      <SettingsSection id="browser" title="Browser">
        <AgentBrowserAccessSetting />
        <SettingsUnavailableGroup message="Only available in the desktop app.">
          <BrowserPreviewDefaults />
        </SettingsUnavailableGroup>
        {/* Not desktop-only: web clients search from server-run browser tabs too. */}
        <BrowserSearchEngineSetting />
        <PullRequestLinksOpenInAppSetting />
      </SettingsSection>
      <DeviceIntegrationSettings />
    </SettingsPageContainer>
  );
}
