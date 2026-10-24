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

/** Owned by the terminal area (TerminalView sets it on focus/blur); `when: "terminalFocus"` reads it. */
export { terminalFocusAtom } from "./terminal.ts";

/** The composer's editor has focus (web `composerFocus`, from document.activeElement). The composer sets it. */
export const composerFocusAtom = Atom.make(false).pipe(Atom.keepAlive);

/** Shift is held with no other modifier (the pull request list's quick actions show while it is). */
export const shiftOnlyHeldAtom = Atom.make(false).pipe(Atom.keepAlive);
