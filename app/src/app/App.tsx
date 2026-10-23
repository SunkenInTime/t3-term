import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import type { Boot } from "../connect/bootstrap.ts";
import { ConnectGate } from "../connect/ConnectGate.tsx";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentCatalog } from "../state/environment.ts";
import { routeAtom, sidebarOpenAtom } from "../state/ui.ts";
import { Sidebar } from "../sidebar/Sidebar.tsx";
import { SettingsSidebar } from "../settings/SettingsView.tsx";
import { CommandPalette } from "../palette/CommandPalette.tsx";
import { DialogHost } from "../dialogs/DialogHost.tsx";
import { ThemeEditorHost } from "../settings/appearance/ThemeEditorHost.tsx";
import { MainView } from "./MainView.tsx";
import { useTheme } from "../ui/theme.ts";
import { AppThemeProvider } from "../state/clientSettings.ts";
import { TooltipProvider } from "../ui/overlay.tsx";
import { ToastHost } from "../ui/toast.tsx";
import { ThreadNotificationCoordinator } from "../notifications/ThreadNotificationCoordinator.tsx";
import { AppCoordinators } from "../coordinators/AppCoordinators.tsx";
import { noteUserInput } from "../notifications/platform.ts";
import { PerfRegion } from "../dev/PerfRegion.tsx";

export function App({ boot }: { boot: Boot }) {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <AppThemeProvider>
        <TooltipProvider>
          {/* One host root: gpuix paints a single root element, so sibling
              overlays at the top level would replace the shell when they mount. */}
          <div
            // Pointer movement marks the user as present (gpuix has no window-focus state).
            // onMouseMove alone doesn't arm pointer capture, so children keep their clicks.
            onMouseMove={noteUserInput}
            style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%" }}
          >
            <ConnectGate bootError={boot.error}>
              <Shell boot={boot} />
              {/* Before the palette and dialogs: same layer priority, so they paint over the editor. */}
              <ThemeEditorHost />
              <CommandPalette />
              <DialogHost />
            </ConnectGate>
            <ThreadNotificationCoordinator />
            <AppCoordinators />
            <ToastHost />
          </div>
        </TooltipProvider>
      </AppThemeProvider>
    </RegistryContext.Provider>
  );
}

function Shell({ boot }: { boot: Boot }) {
  const theme = useTheme();
  // Mounting the catalog starts the connection registry; saved environments reconnect.
  useAtomValue(environmentCatalog.catalogAtom);
  const sidebarOpen = useAtomValue(sidebarOpenAtom);
  useEffect(() => {
    if (boot.error) console.error(boot.error);
  }, [boot.error]);
  const route = useAtomValue(routeAtom);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        backgroundColor: theme.background,
      }}
    >
      <PerfRegion id="sidebar">{sidebarOpen ? route.kind === "settings" ? <SettingsSidebar /> : <Sidebar /> : null}</PerfRegion>
      <PerfRegion id="main">
        <MainView />
      </PerfRegion>
    </div>
  );
}
