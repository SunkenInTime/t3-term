// Keybinding state shared by the global dispatcher and the areas that own the
// shortcut targets. Mirrors apps/web/src/state/server.ts `primaryServerKeybindingsAtom`.
import type { EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { Atom } from "effect/reactivity";

import { environmentCatalog, serverEnvironment } from "./environment.ts";

/**
 * The server's keybindings merged over the defaults. t3-term has no primary
 * (desktop-local) environment, so the first environment whose config has
 * loaded is authoritative, which is what web does without a primary.
 */
export const activeKeybindingsAtom = Atom.make((get): ResolvedKeybindingsConfig => {
  let custom: ResolvedKeybindingsConfig | null = null;
  for (const environmentId of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    const config = get(serverEnvironment.configValueAtom(environmentId as EnvironmentId));
    if (config) {
      custom = config.keybindings;
      break;
    }
  }
  return mergeWithDefaultKeybindings(custom ?? []);
}).pipe(Atom.keepAlive);

/**
 * True while the embedded terminal has keyboard focus. The terminal area sets
 * it from its onFocus/onBlur; `when: "terminalFocus"` clauses read it.
 */
export const terminalFocusAtom = Atom.make(false).pipe(Atom.keepAlive);

/**
 * The thread order the sidebar shows, as `${environmentId}:${threadId}` keys,
 * for thread.previous/next and the Mod+1..9 jumps. The sidebar writes its exact
 * order here; until it does, the dispatcher derives pinned + active order itself.
 */
export const sidebarThreadOrderAtom = Atom.make<ReadonlyArray<string> | null>(null).pipe(
  Atom.keepAlive,
);
