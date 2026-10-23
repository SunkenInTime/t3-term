// Client-only UI state. Lives in the same registry as the connection atoms.
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

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
      return { kind: "home" };
  }
}

export const routeAtom = Atom.make<Route>(initialRoute()).pipe(Atom.keepAlive);
export const sidebarOpenAtom = Atom.make(true).pipe(Atom.keepAlive);
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
