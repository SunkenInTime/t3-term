// apps/web/src/components/PermissionUpdateNotice.tsx. Not desktop-only: any
// client paired before permissions were split (t3-term pairs through the same
// flow) holds a session with the old scopes, and only re-pairing fixes it.
import { useAtomValue } from "@effect/atom-react";
import { sessionHasLegacyPermissions, type EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  devLegacyPermissions,
  permissionUpdateDismissedAtom,
  persistPermissionUpdateDismissal,
} from "../state/coordinators.ts";
import { environmentSession } from "../state/environment.ts";
import { useEnvironments } from "../state/settings.ts";
import { routeAtom } from "../state/ui.ts";
import { dismissToast, toast } from "../ui/toast.tsx";

// Keep an active toast across remounts.
const shown = new Set<EnvironmentId>();

function EnvironmentPermissionNotice({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const session = useAtomValue(environmentSession.sessionStateAtom(environmentId));
  useEffect(() => {
    if (
      session._tag !== "Success" ||
      session.waiting ||
      !(devLegacyPermissions ? session.value.authenticated : sessionHasLegacyPermissions(session.value))
    )
      return;
    if (shown.has(environmentId)) return;
    if (appAtomRegistry.get(permissionUpdateDismissedAtom)[environmentId] === true) return;
    shown.add(environmentId);
    const persistDismissal = () => persistPermissionUpdateDismissal(environmentId);
    const dismiss = () => {
      persistDismissal();
      dismissToast(id);
    };
    const id = toast({
      hideIcon: true,
      title: `Permissions have changed for ${label}`,
      description:
        "This connection still uses the old permissions, so some actions may no longer be available. Pair again using a new link with the permissions you need.",
      duration: 0,
      onClose: persistDismissal,
      actionLayout: "stacked-end",
      action: {
        label: "Open Connections",
        onClick: () => {
          dismiss();
          appAtomRegistry.set(routeAtom, { kind: "settings", page: "connections" });
        },
      },
      secondaryAction: { label: "Dismiss", onClick: dismiss },
      secondaryActionVariant: "ghost",
    });
  }, [environmentId, label, session]);
  return null;
}

export function PermissionUpdateNotice() {
  const { environments } = useEnvironments();
  return environments.map(({ environmentId, label }) => (
    <EnvironmentPermissionNotice key={environmentId} environmentId={environmentId} label={label} />
  ));
}
