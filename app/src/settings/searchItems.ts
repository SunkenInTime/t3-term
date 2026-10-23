// Port of apps/web/src/components/settings/useAvailableSettingsSearchItems.ts.
// t3-term has no T3 Connect cloud config, no desktop WSL backend and no local
// backend it manages, so those items stay filtered out.
//
// The same index feeds the command palette's "Settings" group (web
// CommandPalette's settingsSearchItems), registered below.
import { registerPaletteSettingsSearch } from "../state/palette.ts";
import { readEnvironments, useEnvironments, type EnvironmentPresentation } from "../state/settings.ts";
import { isProviderSettingsEnvironmentAvailable } from "../web/components/settings/ProviderSettingsPanel.logic.ts";
import type { SettingsScopeSearch } from "../web/components/settings/settingsScope.ts";
import {
  filterAvailableSettingsSearchItems,
  getThreadAutoSettlementSearchAvailability,
  searchSettings,
  SETTINGS_SECTION_LABELS,
} from "../web/components/settings/settingsSearch.ts";
import { openSettingsPage, pageForSettingsPath } from "./navigation.ts";

function availableSettingsSearchItems(environments: ReadonlyArray<EnvironmentPresentation>, scopeSearch: SettingsScopeSearch) {
  const hasEnvironment = environments.some((environment) => environment.serverConfig !== null);
  const hasProviderSettingsEnvironment = environments.some((environment) =>
    isProviderSettingsEnvironmentAvailable({
      connectionPhase: environment.connection.phase,
      hasServerConfig: environment.serverConfig !== null,
    }),
  );
  const hasMacProviderSettingsEnvironment = environments.some(
    (environment) =>
      (scopeSearch.machine === undefined || environment.environmentId === scopeSearch.machine) &&
      environment.serverConfig?.environment.platform.os === "darwin" &&
      isProviderSettingsEnvironmentAvailable({ connectionPhase: environment.connection.phase, hasServerConfig: true }),
  );
  const hasThreadAutoSettlement = getThreadAutoSettlementSearchAvailability(environments).eligibleEnvironmentIds.length > 0;
  return filterAvailableSettingsSearchItems({
    localEnvironmentDisabled: true,
    hasCloudPublicConfig: false,
    hasEnvironment,
    hasProviderSettingsEnvironment,
    hasMacProviderSettingsEnvironment,
    canManageLocalBackend: false,
    isWslSettingsRowVisible: false,
    hasThreadAutoSettlement,
    managedTunnelActive: false,
  });
}

export function useAvailableSettingsSearchItems(scopeSearch: SettingsScopeSearch = {}) {
  const { environments } = useEnvironments();
  return availableSettingsSearchItems(environments, scopeSearch);
}

registerPaletteSettingsSearch((query) =>
  searchSettings(query, availableSettingsSearchItems(readEnvironments(), {})).map((item) => ({
    id: item.id,
    title: item.title,
    sectionLabel: SETTINGS_SECTION_LABELS[item.to],
    searchTerms: item.searchTerms ?? [],
    ...(item.secondary ? { secondary: true } : {}),
    open: () => openSettingsPage(pageForSettingsPath(item.to), item.targetId ?? item.id),
  })),
);
