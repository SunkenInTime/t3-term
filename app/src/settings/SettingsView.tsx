// Port of apps/web/src/routes/settings.tsx: the settings header (breadcrumb,
// Restore device defaults), the scope boundary, and the page switch.
// SettingsSidebar (the nav App shows in place of the thread sidebar) lives in
// SettingsSidebarNav.tsx.
import { useAtomValue } from "@effect/atom-react";
import { useState, type ComponentType, type ReactNode } from "react";

import { setSidebarVisible, sidebarVisibleAtom, type SettingsPage } from "../state/ui.ts";
import { useHeaderInset } from "../app/MainView.tsx";
import { useEnvironments } from "../state/settings.ts";
import { Dialog } from "../ui/overlay.tsx";
import { Button, IconButton, Text } from "../ui/primitives.tsx";
import { LAYOUT, useTheme } from "../ui/theme.ts";
import { useAtomSet } from "@effect/atom-react";
import {
  getSettingsSearchTargetScope,
  getThreadAutoSettlementSearchAvailability,
  isSettingsSearchScopeAvailable,
  SETTINGS_SECTION_LABELS,
} from "../web/components/settings/settingsSearch.ts";
import { isTextEntryFocused } from "./controls.tsx";
import { SETTINGS_DEVICE_ONLY_PAGES, SettingsMessage, SettingsPageContainer, settingsSearchTargetAtom } from "./layout.tsx";
import { SETTINGS_PATH_BY_PAGE, leaveSettings, requestSettingsSearchFocus } from "./navigation.ts";
import { SettingsScopeProvider, useSettingsScope } from "./scope.tsx";
import { SettingsScopeNotice } from "./ScopeNotice.tsx";
import { GeneralSettingsPanel, useSettingsRestore } from "./pages/GeneralSettings.tsx";
import { AppearanceSettings } from "./pages/AppearanceSettings.tsx";
import { ArchivedThreadsSettings } from "./pages/ArchivedThreadsSettings.tsx";
import { ConnectionsSettings } from "./pages/ConnectionsSettings.tsx";
import { DiagnosticsSettings } from "./pages/DiagnosticsSettings.tsx";
import { IntegrationsSettings } from "./pages/IntegrationsSettings.tsx";
import { KeybindingsSettings } from "./pages/KeybindingsSettings.tsx";
import { OpenSourceLicenses } from "./pages/OpenSourceLicenses.tsx";
import { ProjectsSettings } from "./pages/ProjectsSettings.tsx";
import { ProviderSettings } from "./pages/ProviderSettings.tsx";
import { ScheduledTasksSettings } from "./pages/ScheduledTasksSettings.tsx";
import { SnapShotSettings } from "./pages/SnapShotSettings.tsx";
import { SourceControlSettings } from "./pages/SourceControlSettings.tsx";
import { StorageSettings } from "./pages/StorageSettings.tsx";

export { SettingsSidebar } from "./SettingsSidebarNav.tsx";

const PAGES: Readonly<Record<SettingsPage, ComponentType>> = {
  general: GeneralSettingsPanel,
  appearance: AppearanceSettings,
  projects: ProjectsSettings,
  keybindings: KeybindingsSettings,
  "snap-shot": SnapShotSettings,
  providers: ProviderSettings,
  integrations: IntegrationsSettings,
  "scheduled-tasks": ScheduledTasksSettings,
  "source-control": SourceControlSettings,
  storage: StorageSettings,
  connections: ConnectionsSettings,
  archive: ArchivedThreadsSettings,
  diagnostics: DiagnosticsSettings,
  "open-source-licenses": OpenSourceLicenses,
};

/** SettingsBreadcrumb labels. */
function pageLabel(page: SettingsPage): string {
  if (page === "diagnostics") return "Diagnostics";
  if (page === "open-source-licenses") return "Open source licenses";
  const path = SETTINGS_PATH_BY_PAGE[page];
  return path ? SETTINGS_SECTION_LABELS[path] : "Settings";
}

export function SettingsView({ page }: { page: SettingsPage }) {
  return (
    <SettingsScopeProvider singleEnvironment={page === "providers"}>
      <SettingsContentLayout page={page} />
    </SettingsScopeProvider>
  );
}

function SettingsContentLayout({ page }: { page: SettingsPage }) {
  const theme = useTheme();
  const { search, environment } = useSettingsScope();
  const inset = useHeaderInset();
  const sidebarVisible = useAtomValue(sidebarVisibleAtom);
  const [restoreSignal, setRestoreSignal] = useState(0);
  // Pages remount when the scope changes, like the web app's keyed outlet.
  const contentScopeKey =
    page === "diagnostics" || page === "providers" ? (environment?.environmentId ?? "") : JSON.stringify(search);
  const Page = PAGES[page];
  return (
    <div
      testId="settings-view"
      tabIndex={-1}
      autoFocus
      onKeyDown={(event) => {
        const modifiers = event.modifiers ?? { ctrl: false, cmd: false, alt: false, shift: false };
        const isFind = event.key === "f" && (modifiers.ctrl || modifiers.cmd) && !modifiers.alt && !modifiers.shift;
        const isSlash = event.keyChar === "/" && !modifiers.ctrl && !modifiers.cmd && !modifiers.alt;
        if ((isFind || isSlash) && !(isSlash && isTextEntryFocused())) {
          event.preventDefault();
          if (!sidebarVisible) setSidebarVisible(true);
          requestSettingsSearchFocus();
          return;
        }
        // useEscapeToGoBack: Escape leaves settings unless something above consumed it.
        if (event.key === "escape" && !event.defaultPrevented && !isTextEntryFocused()) {
          leaveSettings();
        }
      }}
      style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.background }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          height: LAYOUT.topbar,
          paddingLeft: inset.paddingLeft,
          paddingRight: inset.gutter,
          flexShrink: 0,
          position: "relative",
        }}
      >
        {inset.toggle}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: inset.crumbGap, flexGrow: 1, minWidth: 0 }}>
          <Text weight={500} color={theme.mutedForeground}>
            Settings
          </Text>
          <Text weight={500} color={theme.mutedForeground} style={{ opacity: 0.7 }}>
            /
          </Text>
          <Text weight={600} truncate>
            {pageLabel(page)}
          </Text>
        </div>
        {page === "general" ? <RestoreDeviceDefaultsButton onRestored={() => setRestoreSignal((value) => value + 1)} /> : null}
      </div>
      <div key={`${page}:${contentScopeKey}:${restoreSignal}`} style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
        <SettingsScopeBoundary page={page}>
          <Page />
        </SettingsScopeBoundary>
      </div>
    </div>
  );
}

function RestoreDeviceDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        icon="rotate-ccw"
        disabled={changedSettingLabels.length === 0}
        onClick={() => setConfirming(true)}
        testId="settings-restore-defaults"
      >
        Restore device defaults
      </Button>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Restore default settings?"
        description={`This will reset: ${changedSettingLabels.join(", ")}.`}
        testId="settings-restore-dialog"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              testId="settings-restore-confirm"
              onClick={() => {
                setConfirming(false);
                restoreDefaults();
              }}
            >
              Restore
            </Button>
          </>
        }
      />
    </>
  );
}

function SettingsScopeBoundary({ page, children }: { page: SettingsPage; children: ReactNode }) {
  const { scope, connectedEnvironments } = useSettingsScope();
  const { environments } = useEnvironments();
  const target = useAtomValue(settingsSearchTargetAtom);
  const searchTarget = target ? getSettingsSearchTargetScope(target.id) : null;
  const autoSettlementAvailability = searchTarget?.requiresThreadAutoSettlement
    ? getThreadAutoSettlementSearchAvailability(environments, scope)
    : null;
  if (scope.kind !== "unavailable" && target && searchTarget && autoSettlementAvailability && !autoSettlementAvailability.isTargetAvailable) {
    return (
      <SettingsScopeNotice target="environment" targetId={target.id} eligibleEnvironmentIds={autoSettlementAvailability.eligibleEnvironmentIds}>
        {autoSettlementAvailability.eligibleEnvironmentIds.length > 0
          ? `${searchTarget.title} requires a supporting environment. Choose one to continue.`
          : `${searchTarget.title} requires a supporting environment. Connect or update an environment to continue.`}
      </SettingsScopeNotice>
    );
  }
  if (scope.kind !== "unavailable" && target && searchTarget && !isSettingsSearchScopeAvailable(searchTarget.scope, scope.kind)) {
    const noticeTarget =
      searchTarget.scope === "environment" || searchTarget.scope === "project" || searchTarget.scope === "checkout"
        ? searchTarget.scope
        : "all";
    return (
      <SettingsScopeNotice target={noticeTarget} targetId={target.id}>
        {`${searchTarget.title} is not available for the selected target. Choose its owning scope to continue.`}
      </SettingsScopeNotice>
    );
  }
  if (SETTINGS_DEVICE_ONLY_PAGES.has(page) || page === "projects" || page === "open-source-licenses") return <>{children}</>;
  if (scope.kind === "unavailable") {
    return (
      <SettingsPageContainer showScope={false}>
        <SettingsMessage>{scope.message}</SettingsMessage>
      </SettingsPageContainer>
    );
  }
  if (scope.kind === "environment" && connectedEnvironments.length === 0) {
    return (
      <SettingsPageContainer>
        <SettingsMessage>{`Reconnect ${scope.label} to change its settings.`}</SettingsMessage>
      </SettingsPageContainer>
    );
  }
  return <>{children}</>;
}
