// Terminal keybinding commands that arrive while no terminal has focus. A
// focused terminal runs terminal.* itself (TerminalView). By default those
// chords only apply with `when: terminalFocus`, but a user binding without it
// reaches the window dispatcher, and web then acts on the thread's drawer,
// opening it first when closed (useChatTerminalActions `shortcuts`).
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AuthTerminalOperateScope, type KeybindingCommand } from "@t3tools/contracts";

import { registerShortcutHandler } from "../keybindings/useGlobalKeybindings.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { readEnvironmentScope, terminalUiActions } from "../state/terminal.ts";
import { routeAtom } from "../state/ui.ts";

export type TerminalShortcutCommand = "split" | "splitVertical" | "new" | "close";

/** The keybinding commands a terminal runs (web useChatTerminalActions shortcuts). */
export const TERMINAL_SHORTCUT_COMMANDS: Partial<Record<KeybindingCommand, TerminalShortcutCommand>> = {
  "terminal.split": "split",
  "terminal.splitVertical": "splitVertical",
  "terminal.new": "new",
  "terminal.close": "close",
};

/** A split or new terminal asked for while the drawer was closed; the drawer runs it once it mounts. */
const pendingByThreadKey = new Map<string, TerminalShortcutCommand>();

export function takePendingDrawerShortcut(threadKey: string): TerminalShortcutCommand | null {
  const command = pendingByThreadKey.get(threadKey) ?? null;
  pendingByThreadKey.delete(threadKey);
  return command;
}

/**
 * The open drawer registers its own handlers, which run before these. These
 * cover a closed drawer: split and new open it and leave the command for it;
 * close has nothing to close but still takes the key, as in web.
 */
function handleWithDrawerClosed(command: TerminalShortcutCommand): boolean {
  const route = appAtomRegistry.get(routeAtom);
  if (route.kind !== "thread") return false;
  if (!readEnvironmentScope(route.environmentId, AuthTerminalOperateScope)) return false;
  if (command === "close") return true;
  const threadKey = scopedThreadKey(scopeThreadRef(route.environmentId, route.threadId));
  pendingByThreadKey.set(threadKey, command);
  terminalUiActions.setOpen(threadKey, true);
  return true;
}

for (const [command, action] of Object.entries(TERMINAL_SHORTCUT_COMMANDS)) {
  registerShortcutHandler(command as KeybindingCommand, () => handleWithDrawerClosed(action!));
}
