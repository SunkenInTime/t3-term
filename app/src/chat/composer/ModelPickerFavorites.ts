// Favorites for the model picker, after apps/web/src/hooks/useSettings.ts
// (`useEnvironmentModelPreferences`, `useToggleEnvironmentModelFavorite`).
// The server owns favorites; a toggle sends the desired state, not a flip, so two
// clients favoriting at once do not cancel each other. Until the config stream echoes
// the write, the requested state is shown so a fast second click toggles it back.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerSettingsAtom } from "../../state/composer.ts";
import { serverEnvironment } from "../../state/environment.ts";
import { providerModelKey } from "../../web/modelOrdering.ts";

interface PendingFavorite {
  readonly favorite: boolean;
  /** The favorites list the toggle was made against; a new list means the server answered. */
  readonly base: UnifiedSettings["favorites"];
}

export function useModelPickerFavorites(environmentId: EnvironmentId | null) {
  const serverFavorites = useAtomValue(composerSettingsAtom(environmentId)).favorites;
  const [pending, setPending] = useState<ReadonlyMap<string, PendingFavorite>>(new Map());

  const favoriteKeys = useMemo(() => {
    const keys = new Set(serverFavorites.map((fav) => providerModelKey(fav.provider, fav.model)));
    for (const [key, entry] of pending) {
      if (entry.base !== serverFavorites) continue;
      if (entry.favorite) keys.add(key);
      else keys.delete(key);
    }
    return keys as ReadonlySet<string>;
  }, [serverFavorites, pending]);

  const toggleFavorite = useCallback(
    (provider: ProviderInstanceId, model: string) => {
      if (!environmentId) return;
      const key = providerModelKey(provider, model);
      const favorite = !favoriteKeys.has(key);
      const entry: PendingFavorite = { favorite, base: serverFavorites };
      setPending((current) => new Map(current).set(key, entry));
      void runAtomCommand(
        appAtomRegistry,
        serverEnvironment.updateSettings,
        { environmentId, input: { patch: { setModelFavorites: [{ provider, model, favorite }] } } },
        { label: "model favorite update" },
      ).then((result) => {
        // On failure drop the optimistic state so the star shows what the server has.
        if (AsyncResult.isSuccess(result)) return;
        setPending((current) => {
          if (current.get(key) !== entry) return current;
          const next = new Map(current);
          next.delete(key);
          return next;
        });
      });
    },
    [environmentId, favoriteKeys, serverFavorites],
  );

  return { favorites: serverFavorites, favoriteKeys, toggleFavorite };
}
