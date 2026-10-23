// Settings reads and writes the Providers page needs, after apps/web/src/hooks/useSettings.ts
// (useEnvironmentSettings, useUpdateEnvironmentSettings, usePersistEnvironmentProviderInstanceMutation,
// useUpdateEnvironmentModelPreferences, useToggleEnvironmentModelFavorite). All of them write
// one environment's server settings through serverEnvironment commands.
import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  requiredScopesForServerSettingsPatch,
  type EnvironmentId,
  type ProviderInstanceId,
  type ProviderInstanceMutation,
  type ServerSettings,
  type ServerSettingsPatch,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { modelPreferencesMigrationPatch, resolveModelPreferences } from "@t3tools/shared/serverSettings";
import { AsyncResult, Atom } from "effect/reactivity";
import { useRef } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { getClientSettings, useClientSettings } from "../../state/clientSettings.ts";
import { serverEnvironment } from "../../state/environment.ts";
import { mergeEnvironmentSettings, readEnvironmentScope, useAtomCommand, useEnvironments } from "../../state/settings.ts";
import { toast } from "../../ui/toast.tsx";

const NO_SETTINGS_ATOM = Atom.make<ServerSettings | null>(null);

function settingsAtom(environmentId: EnvironmentId | null) {
  return environmentId === null ? NO_SETTINGS_ATOM : serverEnvironment.settingsValueAtom(environmentId);
}

/** One environment's server settings merged with this client's settings. */
export function useEnvironmentSettings(environmentId: EnvironmentId): UnifiedSettings {
  const serverSettings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const client = useClientSettings();
  return mergeEnvironmentSettings(serverSettings ?? DEFAULT_SERVER_SETTINGS, client);
}

function errorMessage(result: AsyncResult.AsyncResult<unknown, unknown>, fallback: string): string {
  if (result._tag !== "Failure") return fallback;
  const error = squashAtomCommandFailure(result as never);
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/** useUpdateEnvironmentSettings for server-owned keys: write the patch, toast on failure. */
export function useUpdateEnvironmentSettings(environmentId: EnvironmentId) {
  const persist = useAtomCommand(serverEnvironment.updateSettings, { label: "server settings update", reportFailure: false });
  const { environments } = useEnvironments();
  return (patch: ServerSettingsPatch) => {
    const label = environments.find((environment) => environment.environmentId === environmentId)?.label ?? "the selected environment";
    if (!requiredScopesForServerSettingsPatch(patch).every((scope) => readEnvironmentScope(environmentId, scope))) {
      toast({ type: "warning", title: "Setting not saved", description: `This connection lacks permission to change settings on ${label}.` });
      return;
    }
    void persist({ environmentId, input: { patch } }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        toast({
          type: "error",
          title: "Setting not saved",
          description: `Could not save on ${label}: ${errorMessage(result, "The save failed. Try reconnecting and saving again.")}`,
        });
      }
    });
  };
}

/** usePersistEnvironmentProviderInstanceMutation: upsert/remove/create one instance plus a patch. */
export function usePersistProviderInstance(environmentId: EnvironmentId) {
  const mutate = useAtomCommand(serverEnvironment.mutateProviderInstance, { reportFailure: false });
  return (providerInstanceMutation: ProviderInstanceMutation, patch: ServerSettingsPatch = {}) =>
    mutate({ environmentId, input: { patch, providerInstanceMutation } });
}

/** Model preference writes carry the legacy-preferences migration the first time. */
function prepareModelPreferencesPatch(settings: ServerSettings, patch: ServerSettingsPatch): ServerSettingsPatch {
  return { ...modelPreferencesMigrationPatch(settings, getClientSettings()), ...patch };
}

export function useUpdateModelPreferences(environmentId: EnvironmentId) {
  const save = useAtomCommand(serverEnvironment.updateSettings, "model preferences update");
  return async (patch: ServerSettingsPatch) => {
    const settings = appAtomRegistry.get(settingsAtom(environmentId));
    if (!settings) return undefined;
    return save({ environmentId, input: { patch: prepareModelPreferencesPatch(settings, patch) } });
  };
}

/** Send the desired state so two clients adding a favorite do not cancel each other. */
export function useToggleModelFavorite(environmentId: EnvironmentId) {
  const pendingFavorites = useRef(new Map<string, { favorite: boolean; settings: ServerSettings; pending: boolean }>());
  const save = useUpdateModelPreferences(environmentId);
  return async (provider: ProviderInstanceId, model: string) => {
    const atom = settingsAtom(environmentId);
    const currentSettings = appAtomRegistry.get(atom);
    if (!currentSettings) return;
    const favorites = resolveModelPreferences(currentSettings, getClientSettings()).favorites;
    const key = JSON.stringify([environmentId, provider, model]);
    const previous = pendingFavorites.current.get(key);
    // Keep the acknowledged choice until the config stream catches up with the RPC reply.
    const previousFavorite =
      previous && (previous.pending || previous.settings.favorites === currentSettings.favorites)
        ? previous.favorite
        : favorites.some((favorite) => favorite.provider === provider && favorite.model === model);
    const pending = { favorite: !previousFavorite, settings: currentSettings, pending: true };
    pendingFavorites.current.set(key, pending);
    const result = await save({ setModelFavorites: [{ provider, model, favorite: pending.favorite }] });
    if (result && AsyncResult.isSuccess(result) && appAtomRegistry.get(atom)?.favorites === currentSettings.favorites) {
      pendingFavorites.current.set(key, { ...pending, pending: false });
    } else if (pendingFavorites.current.get(key) === pending) {
      pendingFavorites.current.delete(key);
    }
  };
}
