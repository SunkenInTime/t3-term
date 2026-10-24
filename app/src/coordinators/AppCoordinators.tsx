// The toast coordinators web mounts in routes/__root.tsx, in web's order.
// Each renders nothing; they turn server and connection state into toasts.
import { BootstrapThreadCoordinator } from "./BootstrapThreadCoordinator.tsx";
import { HostFreezeToastCoordinator } from "./HostFreezeToastCoordinator.tsx";
import { KeybindingsToastCoordinator } from "./KeybindingsToastCoordinator.tsx";
import { LegacyThreadMigrationToast } from "./LegacyThreadMigrationToast.tsx";
import { PermissionUpdateNotice } from "./PermissionUpdateNotice.tsx";
import { ProjectCloneToastCoordinator } from "./ProjectCloneToastCoordinator.tsx";
import { SlowRpcRequestToastCoordinator } from "./SlowRpcRequestToastCoordinator.tsx";

export function AppCoordinators() {
  return (
    <>
      <SlowRpcRequestToastCoordinator />
      <HostFreezeToastCoordinator />
      <PermissionUpdateNotice />
      <LegacyThreadMigrationToast />
      <ProjectCloneToastCoordinator />
      {/* web: EventRouter's keybindings half. */}
      <KeybindingsToastCoordinator />
      {/* web: EventRouter's welcome half. */}
      <BootstrapThreadCoordinator />
    </>
  );
}
