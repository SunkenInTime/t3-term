// Files surface state shared with the right panel's tabs: which file tabs hold edits the
// autosave has not written yet (web ChatView pendingFileSurfaceIdsByProject, drawn as a
// dot on the tab icon by RightPanelTabs).
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";

/** `${threadKey}\u0000${relativePath}` of every file with an unsaved edit. */
export const fileSavePendingAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive);

export function fileSavePendingKey(threadKey: string, relativePath: string): string {
  return `${threadKey}\u0000${relativePath}`;
}

export function setFileSavePending(threadKey: string, relativePath: string, pending: boolean): void {
  const key = fileSavePendingKey(threadKey, relativePath);
  const current = appAtomRegistry.get(fileSavePendingAtom);
  if (current.has(key) === pending) return;
  const next = new Set(current);
  if (pending) next.add(key);
  else next.delete(key);
  appAtomRegistry.set(fileSavePendingAtom, next);
}
