// Atoms owned by the chat timeline. Factories are wired the way
// apps/web/src/state/{orchestration,vcs,assets}.ts wire them.
import { createAssetEnvironmentAtoms } from "@t3tools/client-runtime/state/assets";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import { createVcsEnvironmentAtoms } from "@t3tools/client-runtime/state/vcs";
import type { AssistantCitation, EnvironmentId, MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../runtime/runtime.ts";

export const timelineOrchestration = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);
export const timelineVcs = createVcsEnvironmentAtoms(connectionAtomRuntime);
export const timelineAssets = createAssetEnvironmentAtoms(connectionAtomRuntime);

/**
 * Errors the timeline raises itself (a failed revert or fork), keyed by thread
 * key. ChatView in web keeps these as local state next to the runtime error.
 */
export const timelineLocalErrorsAtom = Atom.make<ReadonlyMap<string, string>>(new Map()).pipe(
  Atom.keepAlive,
);

/** "Edit from here" asks before it rewinds; web's RevertConfirmHost reads the same shape. */
export interface PendingRevert {
  readonly threadKey: string;
  readonly turnCount: number;
  readonly messageId: MessageId;
}
export const revertConfirmAtom = Atom.make<PendingRevert | null>(null).pipe(Atom.keepAlive);

/**
 * A rewind returns the reverted prompt to the composer. The composer owns its
 * draft, so the timeline posts the text here and the composer consumes it
 * (matching `threadId`) and clears the atom.
 */
export interface RestoredPrompt {
  readonly threadId: ThreadId;
  readonly prompt: string;
  readonly nonce: number;
}
export const restoredPromptAtom = Atom.make<RestoredPrompt | null>(null).pipe(Atom.keepAlive);

/** Thread keys with a rewind in flight; the composer can disable sending while set. */
export const rewindingThreadKeysAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive,
);

/**
 * Height the composer overlay covers at the bottom of the chat canvas. The
 * timeline pads its end by this much (web: composerTimelineInset) so the last
 * row clears the composer. The composer may write its measured height here.
 */
export const composerInsetAtom = Atom.make(164).pipe(Atom.keepAlive);

/**
 * "Open diff" from a changed-files card or a file-change row. The diff surface
 * (right panel) reads this to select the turn and file.
 */
export interface TurnDiffRequest {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly filePath: string | null;
  readonly nonce: number;
}
export const turnDiffRequestAtom = Atom.make<TurnDiffRequest | null>(null).pipe(Atom.keepAlive);

import {
  EMPTY_V2_ITEM_SUPPORT,
  resolveV2ItemSupport,
  v2ItemSupportEqual,
  type V2ItemSupport,
} from "@t3tools/client-runtime/state/item-support";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { TurnItemId } from "@t3tools/contracts";
import { environmentThreadDetails } from "./environment.ts";

/** apps/web/src/state/v2ItemSupport.ts: the run, checkpoint and session an item belongs to. */
const itemSupportAtomFamily = Atom.family((key: string) => {
  const target = JSON.parse(key) as { environmentId: EnvironmentId; threadId: ThreadId; itemId: TurnItemId };
  const ref = scopeThreadRef(target.environmentId, target.threadId);
  let previous = EMPTY_V2_ITEM_SUPPORT;
  return Atom.make((get): V2ItemSupport => {
    const scoped = get(environmentThreadDetails.threadAtom(ref));
    if (scoped === null) return EMPTY_V2_ITEM_SUPPORT;
    const next = resolveV2ItemSupport(scoped.projection, target.itemId);
    if (v2ItemSupportEqual(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`t3term-v2-item-support:${key}`));
});

export function v2ItemSupportAtom(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
}) {
  return itemSupportAtomFamily(
    JSON.stringify({ environmentId: input.environmentId, threadId: input.threadId, itemId: input.itemId }),
  );
}

/**
 * "Go to source" on a citation chip (web assistantCitationNavigation): the
 * thread's timeline loads and reveals the cited reply, then pulses the quote.
 * `key` makes a repeated click a new request.
 */
export interface CitationRequest {
  readonly key: number;
  readonly citation: AssistantCitation;
}
export const citationRequestAtom = Atom.make<CitationRequest | null>(null).pipe(Atom.keepAlive);
