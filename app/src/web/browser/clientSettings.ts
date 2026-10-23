// Stand-in for the slice of apps/web/src/hooks/useSettings.ts the browser
// defaults read. t3-term keeps client settings in one atom (state/sidebar.ts);
// it is already hydrated at startup, so there is nothing to wait for.
import { useAtomValue } from "@effect/atom-react";
import type { ClientSettings } from "@t3tools/contracts/settings";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { sidebarClientSettingsAtom } from "../../state/sidebar.ts";

export function getClientSettings(): ClientSettings {
  return appAtomRegistry.get(sidebarClientSettingsAtom);
}

export async function ensureClientSettingsHydrated(): Promise<void> {}

export function useClientSettings<A>(select: (settings: ClientSettings) => A): A {
  return select(useAtomValue(sidebarClientSettingsAtom));
}
