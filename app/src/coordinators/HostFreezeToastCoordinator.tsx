// apps/web/src/components/HostFreezeToastCoordinator.tsx
import { useAtomValue } from "@effect/atom-react";
import { hostFreezeNotice } from "@t3tools/client-runtime/connection";
import { useEffect, useRef } from "react";

import { hostFreezeServerConfigsAtom } from "../state/coordinators.ts";
import { environmentSummaries } from "../state/settings.ts";
import { toast } from "../ui/toast.tsx";

/** Tells the user why a host dropped, once per stall, when it reports one on reconnect. */
export function HostFreezeToastCoordinator() {
  const configs = useAtomValue(hostFreezeServerConfigsAtom);
  const identities = useAtomValue(environmentSummaries.identitiesAtom);
  const shownRef = useRef(new Set<string>());

  useEffect(() => {
    for (const [environmentId, config] of configs) {
      const stall = config.lastEventLoopStall;
      if (stall === undefined) continue;
      const key = `${environmentId}:${stall.detectedAt}`;
      if (shownRef.current.has(key)) continue;
      shownRef.current.add(key);
      const label =
        identities.find((identity) => identity.environmentId === environmentId)?.label ??
        config.environment.label;
      const notice = hostFreezeNotice(label, stall);
      if (notice !== null) {
        toast({ type: "warning", ...notice });
      }
    }
  }, [configs, identities]);

  return null;
}
