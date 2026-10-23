// apps/web/src/components/chat/ThreadVisitWatermark.tsx: marks the open thread
// visited, which clears its Done / Woke status in the sidebar. Web mounts it in
// ChatView; t3-term mounts it from the sidebar so the unread state stays with
// the code that reads it.
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentThreadShells, threadEnvironment } from "../state/environment.ts";
import { markThreadVisitedLocally, threadLocalLastVisitedAtAtom } from "../state/sidebar.ts";
import { resolveThreadLastVisitedAt } from "../web/components/Sidebar.logic.ts";

// During an active turn the thread's updatedAt advances several times per
// second, and every server-side visit is a full command dispatch plus a
// broadcast to all shell subscribers.
const VISIT_DISPATCH_THROTTLE_MS = 10_000;

export function ThreadVisitWatermark({ threadRef }: { threadRef: ScopedThreadRef }) {
  const serverThread = useAtomValue(environmentThreadShells.threadShellAtom(threadRef));
  const threadKey = scopedThreadKey(threadRef);
  const localLastVisitedAt = useAtomValue(threadLocalLastVisitedAtAtom).get(threadKey);
  const lastDispatchedVisit = useRef<string | null>(null);
  const lastVisitDispatchAt = useRef(0);

  useEffect(() => {
    if (!serverThread?.id) return;
    const threadUpdatedAt = Date.parse(serverThread.updatedAt);
    if (Number.isNaN(threadUpdatedAt)) return;
    const effectiveLastVisitedAt = resolveThreadLastVisitedAt(serverThread.lastVisitedAt, localLastVisitedAt);
    const lastVisitedAt = effectiveLastVisitedAt ? Date.parse(effectiveLastVisitedAt) : Number.NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= threadUpdatedAt) return;

    if (serverThread.lastVisitedAt !== undefined) {
      // Dedupe per watermark: the effect re-runs before the command's echo
      // lands. It also keeps a mark-unread on the open thread sticky until new
      // activity lands or the thread is reopened.
      const dispatchKey = `${threadKey}:${serverThread.updatedAt}`;
      if (lastDispatchedVisit.current === dispatchKey) return;
      const dispatch = () => {
        lastDispatchedVisit.current = dispatchKey;
        lastVisitDispatchAt.current = Date.now();
        void runAtomCommand(
          appAtomRegistry,
          threadEnvironment.visit,
          {
            environmentId: serverThread.environmentId,
            input: { threadId: serverThread.id, visitedAt: serverThread.updatedAt },
          },
          { reportFailure: false },
        );
      };
      const latestRunCompletedAtMs = serverThread.latestRun?.completedAt
        ? Date.parse(serverThread.latestRun.completedAt)
        : Number.NaN;
      const hasUnseenCompletion =
        !Number.isNaN(latestRunCompletedAtMs) &&
        (Number.isNaN(lastVisitedAt) || latestRunCompletedAtMs > lastVisitedAt);
      const elapsed = Date.now() - lastVisitDispatchAt.current;
      if (hasUnseenCompletion || elapsed >= VISIT_DISPATCH_THROTTLE_MS) {
        dispatch();
        return;
      }
      const timer = setTimeout(dispatch, VISIT_DISPATCH_THROTTLE_MS - elapsed);
      return () => clearTimeout(timer);
    }

    markThreadVisitedLocally(threadKey, serverThread.updatedAt);
  }, [
    localLastVisitedAt,
    threadKey,
    serverThread?.environmentId,
    serverThread?.id,
    serverThread?.lastVisitedAt,
    serverThread?.latestRun?.completedAt,
    serverThread?.updatedAt,
  ]);
  return null;
}
