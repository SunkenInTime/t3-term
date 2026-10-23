// Entry point for the global keybinding dispatcher while the Usage route shows.
import { applyUsageShortcutCommand } from "../state/usage.ts";

/**
 * Applies `usage.cost|tokens|limits` and `usage.period.day|week|month|quarter`
 * to the Usage page. Returns true when the command is a usage command (the key
 * is consumed), including a period command ignored while Limits shows, as web does.
 */
export function handleUsageShortcutCommand(command: string): boolean {
  return applyUsageShortcutCommand(command);
}
