// Port of apps/web/src/components/chat/useUsageLimitsPanel.ts.
import type { EnvironmentId, ProviderInstanceId, ServerProvider, UsageLimitSourceSnapshots } from "@t3tools/contracts";
import { collectProviderUsageLimits, hasProviderUsageLimits } from "@t3tools/shared/usageLimits";
import { Atom } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { toast } from "../../ui/toast.tsx";
import { usageLimitsBannerItem } from "./ComposerUsageLimits.tsx";

interface UsageLimitsPanelState {
  readonly key: string;
  readonly threadKey: string;
  readonly now: number;
}

// Web keeps this in ChatView state, which outlives the composer; t3-term remounts the
// composer per thread, so the open panel lives in an atom per environment.
const usageLimitsPanelAtom = Atom.family((_environmentId: string) =>
  Atom.make<UsageLimitsPanelState | null>(null).pipe(Atom.keepAlive),
);

/**
 * The open /usage-limits panel for one thread, model and turn. Only the open
 * moment is stored: the rows read live provider data, so a redeemed reset
 * credit or refreshed probe shows through. Anything that spends quota closes
 * it: a new turn from any source, or the agent resuming after an approval or
 * answered question.
 *
 * `panelKey` names that thread, model and turn. It is null while the provider
 * list or the thread itself is unavailable, such as during a reconnect; the
 * panel then stays hidden rather than being dropped.
 */
export function useUsageLimitsPanel(input: {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
  readonly panelKey: string | null;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providerDriver: ServerProvider["driver"] | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
}) {
  const { environmentId, threadKey, panelKey, providerInstanceId, providerDriver, providers, sources } = input;
  const panelAtom = usageLimitsPanelAtom(environmentId);
  const panel = useAtomValue(panelAtom);
  const setPanel = (next: UsageLimitsPanelState | null) => appAtomRegistry.set(panelAtom, next);
  // Drop the snapshot as soon as the thread or model changes so it cannot resurface stale.
  const stale = panel !== null && panelKey !== null && panel.key !== panelKey;
  useEffect(() => {
    if (stale && appAtomRegistry.get(panelAtom) === panel) setPanel(null);
  });
  const report =
    panel !== null && panelKey !== null && panel.key === panelKey && providerInstanceId !== null
      ? collectProviderUsageLimits(providerInstanceId, providers, sources, panel.now)
      : null;
  const banner =
    report !== null && panel !== null
      ? // A fresh id per opening: the stack keeps the last dismissed id as "exiting".
        usageLimitsBannerItem(`usage-limits:${panel.key}:${panel.now}`, report, environmentId, () => setPanel(null))
      : null;
  // T3 owns /usage-limits only where Limits has data for the selected provider;
  // elsewhere the name stays the provider's own and is sent through untouched.
  const offered = providerDriver !== null && hasProviderUsageLimits(providerDriver, providers, sources);

  // Answered locally from the last Limits snapshot; the agent never sees it.
  const open = () => {
    const now = Date.now();
    const nextReport =
      providerInstanceId !== null && panelKey !== null
        ? collectProviderUsageLimits(providerInstanceId, providers, sources, now)
        : null;
    if (nextReport && panelKey !== null) {
      setPanel({ key: panelKey, threadKey, now });
      return true;
    }
    setPanel(null);
    toast({ type: "info", title: "Usage limits are unavailable for this provider" });
    return false;
  };
  // Responses can resolve after navigating away; only the originating thread's panel clears.
  const clearFor = (originThreadKey: string) => {
    const current = appAtomRegistry.get(panelAtom);
    if (current !== null && current.threadKey === originThreadKey) setPanel(null);
  };

  return { banner, offered, open, clearFor };
}
