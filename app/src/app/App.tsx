import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import type { Boot } from "../connect/bootstrap.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentCatalog } from "../state/environment.ts";
import { routeAtom, sidebarOpenAtom } from "../state/ui.ts";
import { Sidebar } from "../sidebar/Sidebar.tsx";
import { SettingsSidebar } from "../settings/SettingsView.tsx";
import { CommandPalette } from "../palette/CommandPalette.tsx";
import { DialogHost } from "../dialogs/DialogHost.tsx";
import { MainView } from "./MainView.tsx";
import { useTheme } from "../ui/theme.ts";
import { AppThemeProvider } from "../state/clientSettings.ts";
import { TooltipProvider } from "../ui/overlay.tsx";
import { ToastHost } from "../ui/toast.tsx";

export function App({ boot }: { boot: Boot }) {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <AppThemeProvider>
        <TooltipProvider>
          <Shell boot={boot} />
          <CommandPalette />
          <DialogHost />
          <ToastHost />
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
      {sidebarOpen ? route.kind === "settings" ? <SettingsSidebar /> : <Sidebar /> : null}
      <MainView />
    </div>
  );
}
