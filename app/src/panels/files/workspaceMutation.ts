// The "workspace changed" signal that refreshes open file views. Ports
// apps/web/src/hooks/useWorkspaceMutationRefresh.ts and deriveWorkspaceMutationId from
// apps/web/src/components/ChatView.logic.ts; the web computes the id in ChatView and
// passes it down, here the Files surface reads the thread itself.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { environmentThreadDetails } from "../../state/environment.ts";

function workspaceMutationRefreshToken(resourceKey: string, mutationId: string | null): string | null {
  return mutationId === null ? null : `${resourceKey}\u0000${mutationId}`;
}

export function useWorkspaceMutationRefresh(input: {
  readonly enabled?: boolean;
  readonly mutationId: string | null;
  readonly refresh: () => void;
  readonly resourceKey: string;
}): void {
  const { enabled = true, mutationId, refresh, resourceKey } = input;
  const handledTokenRef = useRef<string | null>(null);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    const token = workspaceMutationRefreshToken(resourceKey, mutationId);
    if (token === null) return;
    // The first token is the state the view already loaded with, not a change.
    if (handledTokenRef.current === null) {
      handledTokenRef.current = token;
      return;
    }
    if (token === handledTokenRef.current) return;
    handledTokenRef.current = token;
    refreshRef.current();
  }, [enabled, mutationId, resourceKey]);
}

type VisibleTurnItems = ReadonlyArray<{ readonly item?: { readonly id: string; readonly type: string; readonly status?: string } }>;

function lastFinishedMutationItemId(visibleTurnItems: VisibleTurnItems): string | null {
  for (let index = visibleTurnItems.length - 1; index >= 0; index -= 1) {
    const item = visibleTurnItems[index]?.item;
    if (!item) continue;
    if (item.type !== "command_execution" && item.type !== "file_change") continue;
    if (item.status === "pending" || item.status === "running" || item.status === "waiting") continue;
    return item.id;
  }
  return null;
}

function lastCheckpointCompletedAt(summaries: ReadonlyArray<{ readonly completedAt?: string | null }>): string | null {
  return summaries.at(-1)?.completedAt ?? null;
}

/** deriveWorkspaceMutationId: changes whenever a command or file edit finishes, or a checkpoint lands. */
export function useWorkspaceMutationId(environmentId: EnvironmentId, threadId: ThreadId): string | null {
  const ref = { environmentId, threadId } as ScopedThreadRef;
  const itemId = useAtomValue(
    environmentThreadDetails.visibleTurnItemsAtom(ref),
    lastFinishedMutationItemId as (items: unknown) => string | null,
  );
  const completedAt = useAtomValue(
    environmentThreadDetails.checkpointSummariesAtom(ref),
    lastCheckpointCompletedAt as (summaries: unknown) => string | null,
  );
  return itemId === null && completedAt === null ? null : JSON.stringify([itemId, completedAt]);
}
