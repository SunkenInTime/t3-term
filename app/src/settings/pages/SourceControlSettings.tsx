// Port of apps/web/src/components/settings/SourceControlSettings.tsx: repository
// defaults, the server's version control tools and hosting integrations (with
// their expandable settings), and source control text generation.
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type {
  BackgroundActivitySettings,
  SourceControlDiscoveryResult,
  SourceControlProviderAuth,
  SourceControlProviderDiscoveryItem,
  VcsDiscoveryItem,
} from "@t3tools/contracts";
import {
  getBackgroundActivityBaseProfile,
  getBackgroundActivityPresetSettings,
  resolveServerBackgroundActivitySettings,
} from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import { useState, type ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Switch, Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { Badge, NumberField } from "../controls.tsx";
import { PolicyTooltip, SettingResetButton, SettingsPageContainer, SettingsSection, useSettingsSearchTarget } from "../layout.tsx";
import { ProjectDefaultsSettings } from "../ProjectDefaultsSettings.tsx";
import { useEnvironmentQuery } from "../query.ts";
import { RedactedText } from "../RedactedText.tsx";
import { useScopedSettings, useSettingsScope, useUpdateScopedSettings } from "../scope.tsx";
import { GitHubAccountSettings, GitHubTokenSettings, InlineCode, SourceControlHostSettings } from "../source-control/GitHubSettings.tsx";
import { SourceControlMark } from "../source-control/icons.tsx";
import { sourceControlEnvironment } from "../source-control/state.ts";
import { SourceControlWritingSettingsSection } from "../source-control/WritingSettings.tsx";

const EMPTY_DISCOVERY_RESULT: SourceControlDiscoveryResult = { versionControlSystems: [], sourceControlProviders: [] };

type BackgroundActivityOverridePatch = Partial<{
  [K in keyof BackgroundActivitySettings["overrides"]]: BackgroundActivitySettings["overrides"][K] | undefined;
}>;

function durationToSeconds(duration: Duration.Duration): number {
  return Math.round(Duration.toMillis(duration) / 1_000);
}

function backgroundActivityOverrideSettings(current: BackgroundActivitySettings, overrides: BackgroundActivityOverridePatch) {
  const nextOverrides: BackgroundActivityOverridePatch = { ...current.overrides, ...overrides };
  for (const [key, value] of Object.entries(nextOverrides)) {
    if (value === undefined) delete nextOverrides[key as keyof typeof nextOverrides];
  }
  return {
    backgroundActivity: {
      schemaVersion: 1 as const,
      profile: "custom" as const,
      baseProfile: getBackgroundActivityBaseProfile(current),
      overrides: nextOverrides as BackgroundActivitySettings["overrides"],
    },
  };
}

type DiscoveryItem = VcsDiscoveryItem | SourceControlProviderDiscoveryItem;

function isProviderItem(item: DiscoveryItem): item is SourceControlProviderDiscoveryItem {
  return "auth" in item;
}

function isVcsNotReady(item: DiscoveryItem): boolean {
  return !isProviderItem(item) && !item.implemented;
}

function authPresentation(auth: SourceControlProviderAuth): { readonly label: string; readonly badge: "warning" | null } {
  if (auth.status === "authenticated") return { label: "Authenticated", badge: null };
  if (auth.status === "unauthenticated") return { label: "Not authenticated", badge: "warning" };
  return { label: "Status unknown", badge: null };
}

function statusDotColor(item: DiscoveryItem, theme: ReturnType<typeof useTheme>): string {
  if (isVcsNotReady(item)) return alpha(theme.mutedForeground, 0.35);
  if (item.status !== "available") return theme.warning;
  if (isProviderItem(item) && item.auth.status !== "authenticated") return theme.warning;
  return theme.success;
}

function ItemMark({ item }: { item: DiscoveryItem }) {
  const theme = useTheme();
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0 }}>
      <SourceControlMark kind={item.kind} size={18} />
      <div
        style={{
          position: "absolute",
          left: -2,
          top: -2,
          width: 8,
          height: 8,
          borderRadius: 4,
          borderWidth: 2,
          borderColor: theme.background,
          backgroundColor: statusDotColor(item, theme),
        }}
      />
    </div>
  );
}

function Summary({ item }: { item: DiscoveryItem }) {
  const theme = useTheme();
  const muted = alpha(theme.mutedForeground, 0.8);
  const line = (text: string) => (
    <Text size="xs" color={muted} style={{ lineHeight: 18 }}>
      {text}
    </Text>
  );
  if (isVcsNotReady(item)) return line(`Support for ${item.label} is coming soon.`);
  if (item.status !== "available") return line(`Not available on this server: ${item.installHint}`);
  if (!isProviderItem(item)) return line("Available");
  const auth = item.auth;
  if (auth.status === "authenticated") {
    const detail = Option.getOrNull(auth.detail);
    const account = Option.getOrNull(auth.account);
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <Text size="xs" color={muted}>
          Authenticated
        </Text>
        {account ? (
          <>
            <Text size="xs" color={muted}>
              as
            </Text>
            <RedactedText value={account} revealTooltip="Click to reveal account" hideTooltip="Click to hide account" />
          </>
        ) : null}
        {detail ? (
          <Text size="xs" color={muted}>
            {`· ${detail}`}
          </Text>
        ) : null}
      </div>
    );
  }
  if (!item.executable && auth.status === "unauthenticated") return line(`Available. ${item.installHint}`);
  if (auth.status === "unauthenticated" && auth.accounts?.some((entry) => entry.authenticated)) {
    return line(Option.getOrNull(auth.detail) ?? `Every ${item.label} host is turned off.`);
  }
  if (auth.status === "unauthenticated") {
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <Text size="xs" color={muted}>
          {`${item.label} is not authenticated on this server. Sign in or configure credentials using the`}
        </Text>
        <InlineCode>{item.executable ?? ""}</InlineCode>
        <Text size="xs" color={muted}>
          tool on the server host to enable change request features.
        </Text>
      </div>
    );
  }
  return line(`Could not verify ${item.label}. ${Option.getOrNull(auth.detail) ?? item.installHint}`);
}

function DiscoveryItemRow({ item, children, first, last }: { item: DiscoveryItem; children?: ReactNode; first: boolean; last: boolean }) {
  const theme = useTheme();
  const version = Option.getOrNull(item.version);
  const enabled = isProviderItem(item)
    ? item.status === "available" && item.auth.status === "authenticated"
    : item.status === "available" && item.implemented;
  const authStatus = isProviderItem(item) ? authPresentation(item.auth) : null;
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(false);
  const hasDetails = children !== undefined;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        opacity: isVcsNotReady(item) ? 0.8 : 1,
        backgroundColor: hover ? alpha(theme.muted, 0.2) : "#00000000",
        ...(first ? { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl } : {}),
        ...(last ? { borderBottomLeftRadius: RADIUS.xl, borderBottomRightRadius: RADIUS.xl } : {}),
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <ItemMark item={item} />
            <Text weight={500} truncate>
              {item.label}
            </Text>
            {version ? (
              <Text size="xs" mono color={theme.mutedForeground}>
                {version}
              </Text>
            ) : null}
            {isVcsNotReady(item) ? <Badge tone="warning" size="sm">Coming Soon</Badge> : null}
            {authStatus?.badge ? <Badge tone={authStatus.badge} size="sm">{authStatus.label}</Badge> : null}
          </div>
          <Summary item={item} />
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {hasDetails ? (
            <IconButton
              icon={expanded ? "chevron-up" : "chevron-down"}
              size={24}
              iconSize={14}
              onClick={() => setExpanded(!expanded)}
              testId={`source-control-expand-${item.kind}`}
            />
          ) : null}
          {!isVcsNotReady(item) ? <Switch checked={enabled} disabled onChange={() => {}} /> : null}
        </div>
      </div>
      {hasDetails && expanded ? (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingBottom: 16, paddingTop: 4 }}>{children}</div>
      ) : null}
    </div>
  );
}

function GitFetchIntervalSettings() {
  const theme = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const resolved = resolveServerBackgroundActivitySettings(settings);
  const seconds = durationToSeconds(resolved.automaticGitFetchInterval);
  const defaultSeconds = durationToSeconds(
    getBackgroundActivityPresetSettings(getBackgroundActivityBaseProfile(settings.backgroundActivity)).automaticGitFetchInterval,
  );
  const setting = searchableSetting("git-fetch-interval");
  const { ref, highlighted } = useSettingsSearchTarget(setting.id);
  return (
    <div
      ref={ref as never}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        borderRadius: RADIUS.md,
        backgroundColor: highlighted ? alpha(theme.primary, 0.1) : "#00000000",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text size="xs" weight={500}>
            {setting.title}
          </Text>
          <PolicyTooltip>
            This interval is configured for Git only. The shared Background activity policy still decides whether Git refreshes may run when the timer fires. Custom intervals appear as Advanced in General settings.
          </PolicyTooltip>
          <div style={{ width: 20, height: 20 }}>
            {seconds !== defaultSeconds ? (
              <SettingResetButton
                label="fetch interval"
                onClick={() => updateSettings(backgroundActivityOverrideSettings(settings.backgroundActivity, { automaticGitFetchInterval: undefined }))}
              />
            ) : null}
          </div>
        </div>
        <Text size="xs" color={theme.mutedForeground}>
          Refresh remote branches in the background. Set to 0 to avoid automatic Git prompts.
        </Text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <IconButton
          icon="minus"
          size={28}
          iconSize={14}
          onClick={() =>
            updateSettings(
              backgroundActivityOverrideSettings(settings.backgroundActivity, { automaticGitFetchInterval: Duration.seconds(Math.max(0, seconds - 5)) }),
            )
          }
        />
        <NumberField
          testId="settings-git-fetch-interval"
          value={seconds}
          min={0}
          max={86_400}
          width={64}
          size="sm"
          onCommit={(value) =>
            updateSettings(backgroundActivityOverrideSettings(settings.backgroundActivity, { automaticGitFetchInterval: Duration.seconds(value) }))
          }
        />
        <IconButton
          icon="plus"
          size={28}
          iconSize={14}
          onClick={() =>
            updateSettings(backgroundActivityOverrideSettings(settings.backgroundActivity, { automaticGitFetchInterval: Duration.seconds(seconds + 5) }))
          }
        />
        <Text size="xs" color={theme.mutedForeground}>
          seconds
        </Text>
      </div>
    </div>
  );
}

/** Static skeleton rows (no shimmer: t3-term never repaints continuously). */
function SkeletonSection({ title, headerAction }: { title: string; headerAction?: ReactNode }) {
  const theme = useTheme();
  const block = (width: number, height: number, radius = height / 2) => (
    <div style={{ width, height, borderRadius: radius, backgroundColor: alpha(theme.foreground, 0.06), flexShrink: 0 }} />
  );
  return (
    <SettingsSection title={title} headerAction={headerAction}>
      {["primary", "secondary"].map((row) => (
        <div key={row} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flexGrow: 1 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
              {block(18, 18, 4)}
              {block(112, 16)}
              {block(56, 20)}
            </div>
            {block(320, 12)}
          </div>
          {block(28, 28, 8)}
          {block(36, 20)}
        </div>
      ))}
    </SettingsSection>
  );
}

export function SourceControlSettings() {
  const theme = useTheme();
  const { scope, environment, connectedEnvironments } = useSettingsScope();
  const environmentId = environment?.connection.phase === "connected" ? environment.environmentId : null;
  const aggregate = scope.environmentIds.length !== 1 && connectedEnvironments.length > 1;
  const environmentSuffix = aggregate && environment ? ` · ${environment.label}` : "";
  const discovery = useEnvironmentQuery(environmentId === null ? null : sourceControlEnvironment.discovery({ environmentId, input: {} }));
  const result = discovery.data ?? EMPTY_DISCOVERY_RESULT;
  const hasVcs = result.versionControlSystems.length > 0;
  const hasItems = hasVcs || result.sourceControlProviders.length > 0;
  const isInitialScanPending = discovery.isPending && discovery.data === null;
  const handleScan = () => discovery.refresh();

  const hostSettingsPanel = (kind: string) => {
    const definition = sourceControlClients.find(kind);
    if (!definition?.settings || environmentId === null) return undefined;
    return (
      <SourceControlHostSettings
        key={environmentId}
        environmentId={environmentId}
        definition={{ ...definition, settings: definition.settings }}
        onSaved={handleScan}
      />
    );
  };

  const scanButton = (
    <Tooltip content="Rescan Git and hosting integrations" side="top">
      <IconButton icon="refresh-cw" size={24} iconSize={14} disabled={discovery.isPending} onClick={handleScan} testId="source-control-rescan" />
    </Tooltip>
  );

  return (
    <SettingsPageContainer virtual>
      <ProjectDefaultsSettings category="source-control" />
      {environmentId === null ? (
        <SettingsSection id={searchableSetting("source-control").id} title="Server environment">
          <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
            <Text color={theme.mutedForeground}>Connect an environment to inspect its version control tools and hosting integrations.</Text>
          </div>
        </SettingsSection>
      ) : isInitialScanPending ? (
        <>
          <SkeletonSection title={`Version Control${environmentSuffix}`} headerAction={scanButton} />
          <SkeletonSection title="Source Control Providers" />
        </>
      ) : hasItems ? (
        <>
          {hasVcs ? (
            <SettingsSection id={searchableSetting("source-control").id} title={`Version Control${environmentSuffix}`} headerAction={scanButton}>
              {result.versionControlSystems.map((item, index) => (
                <DiscoveryItemRow key={`vcs:${item.kind}`} item={item} first={index === 0} last={index === result.versionControlSystems.length - 1}>
                  {item.kind === "git" ? <GitFetchIntervalSettings /> : undefined}
                </DiscoveryItemRow>
              ))}
            </SettingsSection>
          ) : null}
          {result.sourceControlProviders.length > 0 ? (
            <SettingsSection
              id={hasVcs ? undefined : searchableSetting("source-control").id}
              title={hasVcs ? "Source Control Providers" : `Source Control Providers${environmentSuffix}`}
              headerAction={hasVcs ? null : scanButton}
            >
              {result.sourceControlProviders.map((item, index) => (
                <DiscoveryItemRow
                  key={`provider:${item.kind}`}
                  item={item}
                  first={index === 0}
                  last={index === result.sourceControlProviders.length - 1}
                >
                  {item.kind === "github" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                      <GitHubTokenSettings key={`token-${environmentId}`} environmentId={environmentId} onSaved={handleScan} />
                      {item.status === "available" ? (
                        <GitHubAccountSettings key={environmentId} environmentId={environmentId} auth={item.auth} onSaved={handleScan} />
                      ) : null}
                    </div>
                  ) : (
                    hostSettingsPanel(item.kind)
                  )}
                </DiscoveryItemRow>
              ))}
            </SettingsSection>
          ) : null}
        </>
      ) : (
        <SettingsSection id={searchableSetting("source-control").id} title="Server environment">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 32, paddingBottom: 32, paddingLeft: 16, paddingRight: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: RADIUS.md, backgroundColor: theme.muted }}>
              <Icon name="git-pull-request" size={18} color={theme.mutedForeground} />
            </div>
            <Text weight={600}>{discovery.error ? "Could not scan the server environment" : "Nothing detected yet"}</Text>
            <Text size="sm" color={theme.mutedForeground} style={{ textAlign: "center", maxWidth: 420 }}>
              {discovery.error ??
                "Install Git on the server, add optional hosting integrations or credentials your workspace needs, then rescan."}
            </Text>
            <Button size="sm" variant="outline" icon="refresh-cw" disabled={discovery.isPending} onClick={handleScan}>
              Scan
            </Button>
          </div>
        </SettingsSection>
      )}
      <SourceControlWritingSettingsSection />
    </SettingsPageContainer>
  );
}

