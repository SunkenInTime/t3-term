// Client-only UI state. Lives in the same registry as the connection atoms.
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { mobileViewportAtom } from "../ui/viewport.tsx";

export type SettingsPage =
  | "general"
  | "appearance"
  | "projects"
  | "keybindings"
  | "snap-shot"
  | "providers"
  | "integrations"
  | "scheduled-tasks"
  | "source-control"
  | "storage"
  | "connections"
  | "archive"
  | "diagnostics"
  | "open-source-licenses";

export type Route =
  | { readonly kind: "home" }
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  | {
      readonly kind: "draft";
      readonly environmentId: EnvironmentId | null;
      readonly projectId: ProjectId | null;
      /**
       * One of several drafts in the project (web draftId). Absent for the project's first
       * draft, which every older entry point opens.
       */
      readonly draftId?: string;
    }
  | { readonly kind: "settings"; readonly page: SettingsPage }
  // Sidebar footer utility pages (web: /pull-requests, /usage).
  | { readonly kind: "pull-requests" }
  | { readonly kind: "usage" }
  // A prompt link's landing (web: /new, and thread URLs with ?prompt=); `t3-term --open <link>`.
  | { readonly kind: "prompt-link"; readonly link: string; readonly key: number };

// T3TERM_ROUTE opens a top-level page at launch, for screenshots and automation.
function initialRoute(): Route {
  switch (process.env.T3TERM_ROUTE) {
    case "usage":
      return { kind: "usage" };
    case "pull-requests":
      return { kind: "pull-requests" };
    case "settings":
      return { kind: "settings", page: "general" };
    default:
      // settings/<page>, e.g. settings/open-source-licenses
      if (process.env.T3TERM_ROUTE?.startsWith("settings/")) {
        return { kind: "settings", page: process.env.T3TERM_ROUTE.slice("settings/".length) as SettingsPage };
      }
      // thread/<environmentId>/<threadId>: narrow windows hide the sidebar, so
      // screenshots cannot click their way to a thread.
      if (process.env.T3TERM_ROUTE?.startsWith("thread/")) {
        const [, environmentId, threadId] = process.env.T3TERM_ROUTE.split("/");
        return { kind: "thread", environmentId: environmentId as EnvironmentId, threadId: threadId as ThreadId };
      }
      // draft/<environmentId>/<projectId>: that project's new-thread draft.
      if (process.env.T3TERM_ROUTE?.startsWith("draft/")) {
        const [, environmentId, projectId] = process.env.T3TERM_ROUTE.split("/");
        return { kind: "draft", environmentId: environmentId as EnvironmentId, projectId: projectId as ProjectId };
      }
      return { kind: "home" };
  }
}

export const routeAtom = Atom.make<Route>(initialRoute()).pipe(Atom.keepAlive);
/** The docked sidebar (web SidebarProvider `open`). Below 768 the sheet below is used instead. */
export const sidebarOpenAtom = Atom.make(true).pipe(Atom.keepAlive);
/** web SidebarProvider `openMobile`: the off-canvas sheet below `md`, closed by default. */
export const sidebarMobileOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
/** web useSidebarVisibility: whichever of the two applies at this width. */
export const sidebarVisibleAtom = Atom.make((get) =>
  get(mobileViewportAtom) ? get(sidebarMobileOpenAtom) : get(sidebarOpenAtom),
).pipe(Atom.keepAlive);

/** web useSidebar().toggleSidebar: the sheet below `md`, the docked sidebar above. */
export function toggleSidebar(): void {
  setSidebarVisible(!appAtomRegistry.get(sidebarVisibleAtom));
}

export function setSidebarVisible(visible: boolean): void {
  appAtomRegistry.set(appAtomRegistry.get(mobileViewportAtom) ? sidebarMobileOpenAtom : sidebarOpenAtom, visible);
}

// web Sidebar.tsx navigateToThread / navigateToDraft / SidebarChrome: picking a
// destination in the mobile sheet closes it. Settings pages swap in place, like web's
// SettingsSidebarNav, which leaves the sheet open.
let previousRouteKind = appAtomRegistry.get(routeAtom).kind;
appAtomRegistry.subscribe(routeAtom, (route) => {
  const withinSettings = route.kind === "settings" && previousRouteKind === "settings";
  previousRouteKind = route.kind;
  if (withinSettings) return;
  if (appAtomRegistry.get(sidebarMobileOpenAtom)) appAtomRegistry.set(sidebarMobileOpenAtom, false);
});
export const detailsPanelOpenAtom = Atom.make(true).pipe(Atom.keepAlive);
export const terminalOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
export const rightPanelOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
export const commandPaletteOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
export const sidebarSearchAtom = Atom.make("").pipe(Atom.keepAlive);

export type RightPanelSurface = "terminal" | "files" | "diff" | "pull-request";
export const rightPanelSurfaceAtom = Atom.make<RightPanelSurface>("diff").pipe(Atom.keepAlive);
/**
 * Bumped with every "show this surface" request, so asking for the kind the
 * atom above already holds (its default is "diff") still reaches the panel.
 */
export const rightPanelSurfaceRequestAtom = Atom.make(0).pipe(Atom.keepAlive);

/** Open requests for pickers that keybindings and the palette can trigger. */
export const modelPickerOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
export const findBarOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
/** The right panel fills the workspace, hiding the chat column (web's rightPanelMaximized). */
export const rightPanelMaximizedAtom = Atom.make(false).pipe(Atom.keepAlive);
