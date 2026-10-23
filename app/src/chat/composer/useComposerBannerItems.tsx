// The composer's notice stack, assembled in web ChatView's `composerBannerItems`
// order (apps/web/src/components/ChatView.tsx ~2603): feedback, usage-limit
// recovery, usage limits, project clone, system (machine), background work
// (child input, goal, background tasks), then the branch-mismatch notice.
// ComposerBannerStack sorts by urgency; this order breaks ties.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "../../state/environment.ts";
import type { ComposerBannerStackItem } from "./ComposerBannerStack.tsx";
import { useSystemComposerBanners } from "./useSystemComposerBanners.tsx";

const NO_AUTO_UPDATE_ENVIRONMENTS: never[] = [];

export interface ComposerBannerItemsInput {
  readonly environmentId: EnvironmentId;
}

export function useComposerBannerItems(input: ComposerBannerItemsInput): ReadonlyArray<ComposerBannerStackItem> {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const systemItems = useSystemComposerBanners({
    environmentId: input.environmentId,
    hasMultipleRegisteredEnvironments: catalog.entries.size > 1,
    // t3-term has no load-balanced drafts (see useSystemComposerBanners.tsx).
    automaticEnvironment: false,
    autoUpdateEnvironments: NO_AUTO_UPDATE_ENVIRONMENTS,
  });
  return systemItems;
}
