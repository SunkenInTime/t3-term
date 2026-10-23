// Automation hook for screenshots: T3TERM_OPEN_THREAD="<environmentId>/<threadId>"
// opens that thread at startup, so a check can reach threads the sidebar folds
// away (settled shelf, subagent threads). Imported for its side effect by Timeline.tsx,
// which loads with the app shell.
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { findBarOpenAtom, routeAtom } from "../../state/ui.ts";

const target = process.env.T3TERM_OPEN_THREAD?.trim();
if (target) {
  const slash = target.indexOf("/");
  if (slash > 0) {
    appAtomRegistry.set(routeAtom, {
      kind: "thread",
      environmentId: target.slice(0, slash) as EnvironmentId,
      threadId: target.slice(slash + 1) as ThreadId,
    });
  }
}

// T3TERM_OPEN_FIND=1 opens the find bar too.
if (process.env.T3TERM_OPEN_FIND === "1") appAtomRegistry.set(findBarOpenAtom, true);
