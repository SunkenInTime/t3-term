import { RegistryContext, useAtom, useAtomValue } from "@effect/atom-react";
import * as DialogPrimitive from "@gpuix/react/dialog";
import { useEffect, useState, type ReactNode } from "react";

import type { Boot } from "../connect/bootstrap.ts";
import { ConnectGate } from "../connect/ConnectGate.tsx";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentCatalog } from "../state/environment.ts";
import { routeAtom, sidebarMobileOpenAtom, sidebarOpenAtom } from "../state/ui.ts";
import { SidebarSheetWidthContext, smallViewportAtom, useMobileViewport, viewportWidthAtom, ViewportSync } from "../ui/viewport.tsx";
import { Sidebar } from "../sidebar/Sidebar.tsx";
import { LegacySidebar } from "../sidebar/legacy/LegacySidebar.tsx";
import { legacySidebarEnabledAtom } from "../state/legacySidebar.ts";
import { SidebarRail } from "../sidebar/SidebarRail.tsx";
import { SettingsSidebar } from "../settings/SettingsView.tsx";
import { CommandPalette } from "../palette/CommandPalette.tsx";
import { DialogHost } from "../dialogs/DialogHost.tsx";
import { ThemeEditorHost } from "../settings/appearance/ThemeEditorHost.tsx";
import { ChatGptWelcomeCoordinator } from "../settings/providers/ChatGptWelcomeCoordinator.tsx";
import { EnvironmentThemeSync } from "../web/hooks/useEnvironmentTheme.ts";
import { MainView } from "./MainView.tsx";
import { alpha, useTheme } from "../ui/theme.ts";
import { AppThemeProvider } from "../state/clientSettings.ts";
import { TooltipProvider } from "../ui/overlay.tsx";
import { PullRequestGuideRunCoordinator } from "../pullRequests/guide/PullRequestGuideRunCoordinator.tsx";
import { ToastHost } from "../ui/toast.tsx";
import { ThreadNotificationCoordinator } from "../notifications/ThreadNotificationCoordinator.tsx";
import { AppCoordinators } from "../coordinators/AppCoordinators.tsx";
import { noteUserInput } from "../notifications/platform.ts";
import { PerfRegion } from "../dev/PerfRegion.tsx";
import { AppErrorBoundary, DevCrash } from "./AppErrorBoundary.tsx";

export function App({ boot }: { boot: Boot }) {
  // "Reload app" on the error screen remounts everything under the boundary.
  const [appKey, setAppKey] = useState(0);
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <AppThemeProvider>
        <TooltipProvider>
          {/* One host root: gpuix paints a single root element, so sibling
              overlays at the top level would replace the shell when they mount. */}
          <div
            // Pointer movement marks the user as present where focus has no native signal (notifications/focus.ts).
            // onMouseMove alone doesn't arm pointer capture, so children keep their clicks.
            onMouseMove={noteUserInput}
            style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%" }}
          >
            <ViewportSync />
            {/* web __root errorComponent: a render error shows the report instead of the app. */}
            <AppErrorBoundary key={appKey} onReload={() => setAppKey((key) => key + 1)}>
              <DevCrash />
              <ConnectGate bootError={boot.error}>
                <Shell boot={boot} />
                {/* Before the palette and dialogs: same layer priority, so they paint over the editor. */}
                <ThemeEditorHost />
                <CommandPalette />
                <DialogHost />
                <ChatGptWelcomeCoordinator />
                <EnvironmentThemeSync />
              </ConnectGate>
              <ThreadNotificationCoordinator />
              <PullRequestGuideRunCoordinator />
              <AppCoordinators />
            </AppErrorBoundary>
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
  const mobile = useMobileViewport();
  useEffect(() => {
    if (boot.error) console.error(boot.error);
  }, [boot.error]);
  const route = useAtomValue(routeAtom);
  const legacySidebarEnabled = useAtomValue(legacySidebarEnabledAtom);
  const sidebar =
    route.kind === "settings" ? <SettingsSidebar /> : legacySidebarEnabled ? <LegacySidebar /> : <Sidebar />;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        backgroundColor: theme.background,
      }}
    >
      {/* Below md web's sidebar leaves the row and opens as an off-canvas sheet. */}
      <PerfRegion id="sidebar">{mobile ? <MobileSidebarSheet>{sidebar}</MobileSidebarSheet> : sidebarOpen ? sidebar : null}</PerfRegion>
      <PerfRegion id="main">
        <MainView />
      </PerfRegion>
      {/* After the main view so its overhang paints and hit-tests on top. */}
      {!mobile && sidebarOpen ? <SidebarRail /> : null}
    </div>
  );
}

/**
 * ui/sidebar.tsx below `md`: a left Sheet (SheetPopup side="left") over a
 * background/60 backdrop that closes it on press. Escape closes it too. Web blurs
 * the backdrop (`backdrop-blur-xs`); GPUI cannot.
 *
 * Width: web means it to be the window less 12px (SIDEBAR_WIDTH_MOBILE), but that
 * value is written as `calc(100vw - var(--spacing(3)))` in an inline style, where
 * Tailwind never expands `--spacing(3)`; the custom property is invalid, `width`
 * falls back to auto and the sheet takes its content's width. Measured in Chrome:
 * 315px from `sm` up, 428px below it (where controls grow). These match that.
 */
export function mobileSidebarSheetWidth(viewportWidth: number, small: boolean): number {
  return Math.min(small ? 428 : 315, Math.max(0, viewportWidth - 12));
}

function MobileSidebarSheet({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useAtom(sidebarMobileOpenAtom);
  const width = useAtomValue(viewportWidthAtom);
  const small = useAtomValue(smallViewportAtom);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal style={{ flexDirection: "row", justifyContent: "flex-start", alignItems: "stretch" }}>
        <DialogPrimitive.Backdrop style={{ backgroundColor: alpha(theme.background, 0.6), pointerEvents: "auto" }} />
        <DialogPrimitive.Popup
          testId="sidebar-sheet"
          style={{ position: "relative", display: "flex", flexDirection: "row", height: "100%" }}
        >
          <SidebarSheetWidthContext.Provider value={mobileSidebarSheetWidth(width, small)}>{children}</SidebarSheetWidthContext.Provider>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
