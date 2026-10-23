// Port of apps/web/src/components/settings/useAvailableSettingsSearchItems.ts.
// t3-term has no T3 Connect cloud config, no desktop WSL backend and no local
// backend it manages, so those items stay filtered out.
import { useEnvironments } from "../state/settings.ts";
import { isProviderSettingsEnvironmentAvailable } from "../web/components/settings/ProviderSettingsPanel.logic.ts";
import type { SettingsScopeSearch } from "../web/components/settings/settingsScope.ts";
import {
  filterAvailableSettingsSearchItems,
  getThreadAutoSettlementSearchAvailability,
} from "../web/components/settings/settingsSearch.ts";

export function useAvailableSettingsSearchItems(scopeSearch: SettingsScopeSearch = {}) {
  const { environments } = useEnvironments();
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
