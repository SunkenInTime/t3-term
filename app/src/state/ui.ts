// Client-only UI state. Lives in the same registry as the connection atoms.
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

export type SettingsPage =
  | "general"
  | "appearance"
  | "keybindings"
  | "providers"
  | "integrations"
  | "scheduled-tasks"
  | "source-control"
  | "storage"
  | "connections"
  | "archive"
  | "diagnostics";

export type Route =
  | { readonly kind: "home" }
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  | {
      readonly kind: "draft";
      readonly environmentId: EnvironmentId | null;
      readonly projectId: ProjectId | null;
    }
  | { readonly kind: "settings"; readonly page: SettingsPage };

export const routeAtom = Atom.make<Route>({ kind: "home" }).pipe(Atom.keepAlive);
export const sidebarOpenAtom = Atom.make(true).pipe(Atom.keepAlive);
export const detailsPanelOpenAtom = Atom.make(true).pipe(Atom.keepAlive);
export const terminalOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
export const rightPanelOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
export const commandPaletteOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
export const sidebarSearchAtom = Atom.make("").pipe(Atom.keepAlive);
