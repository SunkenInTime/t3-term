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
import { MainView } from "./MainView.tsx";
import { AppearanceThemeProvider } from "../palette/AppearanceThemeProvider.tsx";
import { useTheme } from "../ui/theme.ts";
import { TooltipProvider } from "../ui/overlay.tsx";
import { ToastHost } from "../ui/toast.tsx";

export function App({ boot }: { boot: Boot }) {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <AppearanceThemeProvider>
        <TooltipProvider>
          {/* One host root: gpuix paints a single root element, so sibling
              overlays at the top level would replace the shell when they mount. */}
          <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
            <ConnectGate bootError={boot.error}>
              <Shell boot={boot} />
              <CommandPalette />
              <DialogHost />
            </ConnectGate>
            <ToastHost />
          </div>
        </TooltipProvider>
      </AppearanceThemeProvider>
    </RegistryContext.Provider>
  );
}

function Shell({ boot }: { boot: Boot }) {
  // Mounting the catalog starts the connection registry; saved environments reconnect.
  useAtomValue(environmentCatalog.catalogAtom);
  const sidebarOpen = useAtomValue(sidebarOpenAtom);
  useEffect(() => {
    if (boot.error) console.error(boot.error);
  }, [boot.error]);
  const route = useAtomValue(routeAtom);
  const theme = useTheme();
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
