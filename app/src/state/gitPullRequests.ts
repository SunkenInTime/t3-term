// Pull request atoms for the details card PR rows and the Pull request right-panel
// surface, wired like apps/web/src/state/pullRequests.ts.
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  createLinkedPullRequestSummaryAtomFamily,
  createPullRequestEnvironmentAtoms,
} from "@t3tools/client-runtime/state/pull-requests";
import type { PullRequestRef, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import { openRightPanelSurface } from "./git.ts";

export const pullRequestEnvironment = createPullRequestEnvironmentAtoms(connectionAtomRuntime);
export const linkedPullRequestDetailAtom = createLinkedPullRequestSummaryAtomFamily(
  connectionAtomRuntime,
  pullRequestEnvironment.refreshes,
);

export type PullRequestDetailTab = "summary" | "timeline" | "code";

/**
 * The pull request the right panel shows for a thread. Null falls back to the
 * thread's current pull request (web keeps this on the right-panel surface).
 */
export const selectedPullRequestAtom = Atom.family((_threadKey: string) =>
  Atom.make<PullRequestRef | null>(null).pipe(Atom.keepAlive),
);

export const pullRequestDetailTabAtom = Atom.family((_threadKey: string) =>
  Atom.make<PullRequestDetailTab>("summary").pipe(Atom.keepAlive),
);

/** Opens the Pull request surface on `reference` (web's rightPanelStore.openPullRequest). */
export function openPullRequestSurface(ref: ScopedThreadRef, reference: PullRequestRef | null): void {
  const key = scopedThreadKey(ref);
  const previous = appAtomRegistry.get(selectedPullRequestAtom(key));
  appAtomRegistry.set(selectedPullRequestAtom(key), reference);
  if (
    reference === null ||
    previous === null ||
    previous.number !== reference.number ||
    previous.repository !== reference.repository
  ) {
    appAtomRegistry.set(pullRequestDetailTabAtom(key), "summary");
  }
  openRightPanelSurface("pull-request");
}
