// Port of apps/web/src/components/pullRequest/{PullRequestSpeedActions.tsx,usePullRequestActions.ts
// (usePullRequestActionRunner)}: hold Shift over the pull request list and each row offers its
// quick actions (Close, Merge, Ready for review, Reopen), carried out at once with no confirm, as
// web does. Every press goes through the write gate.
//
// Close also starts web's close sweep (usePullRequestCloseSweep.ts): drag from it across rows to
// close several. The button holds the pointer for the whole gesture, so it stays mounted (shown)
// while armed even if Shift is let go.
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EventPayload } from "@gpuix/native";
import type { KeyEvent } from "@gpuix/react";
import type { PullRequestAction, PullRequestDetail, PullRequestMergeMethod } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { shiftOnlyHeldAtom } from "../state/keybindings.ts";
import { lastPullRequestMergeMethodAtom, pullRequestEnvironment, pullRequestEnvironmentsAtom } from "../state/pullRequests.ts";
import type { IconName } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { toast } from "../ui/toast.tsx";
import { readableFailure, resolvePullRequestMergeMethod } from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { pullRequestQuickActions, type EnvironmentPullRequestEntry } from "../web/components/pullRequest/pullRequestList.logic.ts";
import { PrButton } from "./prControls.tsx";
import { PullRequestGlyph } from "./pullRequestPresentation.tsx";
import { markRowControlClick } from "./PullRequestStack.tsx";
import { runPullRequestWrite } from "./pullRequestWrites.ts";
import type { CloseSweepHandlers } from "./usePullRequestCloseSweep.ts";

const ACTIONS: Record<"close" | "merge" | "ready" | "reopen", { readonly label: string; readonly icon: IconName }> = {
  close: { label: "Close", icon: PullRequestGlyph.closed },
  merge: { label: "Merge", icon: PullRequestGlyph.merged },
  ready: { label: "Ready for review", icon: PullRequestGlyph.pullRequest },
  reopen: { label: "Reopen", icon: PullRequestGlyph.reopen },
};

const ACTION_SUCCESS_LABELS: Partial<Record<PullRequestAction, string>> = {
  merge: "Merge requested",
  ready: "Marked ready for review",
  close: "Pull request closed",
  reopen: "Pull request reopened",
};

const ACTION_FAILURE_LABELS: Partial<Record<PullRequestAction, string>> = {
  merge: "Could not merge this pull request",
  ready: "Could not mark this ready for review",
  close: "Could not close this pull request",
  reopen: "Could not reopen this pull request",
};

const ACTION_FAILURE_HINTS: Partial<Record<PullRequestAction, string>> = {
  merge:
    "The host refused the merge. Check that you have write access, that the checks it requires have passed, and that the branch is not conflicting.",
  ready: "The host refused it. Check that you have write access to this repository.",
  close: "The host refused it. Check that you have write access, or that you opened it.",
  reopen: "The host refused it. Check that you have write access, and that the branch still exists.",
};

export function PullRequestSpeedActions({
  entry,
  hostActions,
  onActed,
  closing = false,
  sweeping = false,
  sweep,
}: {
  entry: EnvironmentPullRequestEntry;
  hostActions: ReadonlySet<PullRequestAction>;
  onActed?: (action: PullRequestAction) => void;
  /** In a batch close that is running. */
  closing?: boolean;
  /** Marked by a close sweep in progress. */
  sweeping?: boolean;
  sweep?: CloseSweepHandlers;
}) {
  const speedMode = useAtomValue(shiftOnlyHeldAtom);
  const [pending, setPending] = useState(false);
  const [armed, setArmedState] = useState(false);
  // Read by the move and release handlers, which can arrive before the press re-renders.
  const armedRef = useRef(false);
  const setArmed = (next: boolean) => {
    armedRef.current = next;
    setArmedState(next);
  };
  const pendingRef = useRef(false);
  const actions = pullRequestQuickActions(entry, hostActions);
  // web: busy rows keep their actions on screen, spinning, whether or not Shift is held.
  const busy = pending || closing || sweeping;
  if (actions.length === 0 || (!speedMode && !busy && !armed)) return null;

  // Small surfaces resolve the merge method on the click, not for every visible row.
  const resolveMergeMethod = (detail: PullRequestDetail): PullRequestMergeMethod => {
    const allowed = detail.capabilities.mergeMethods.filter((method) => detail.mergeCapabilities[method]);
    if (allowed.length === 0) throw new Error("No merge method is available for this repository.");
    const serverConfig =
      appAtomRegistry.get(pullRequestEnvironmentsAtom).find((environment) => environment.environmentId === entry.environmentId)
        ?.serverConfig ?? null;
    const projectDefault =
      serverConfig === null
        ? undefined
        : (resolveProjectSettings(serverConfig.settings, entry.projectId).settings.pullRequestMergeMethod ?? undefined);
    return resolvePullRequestMergeMethod(allowed, null, projectDefault, appAtomRegistry.get(lastPullRequestMergeMethodAtom) ?? "merge");
  };
  const perform = async (action: PullRequestAction) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const result = await runPullRequestWrite(pullRequestEnvironment.runAction, {
      environmentId: entry.environmentId,
      input: {
        projectId: entry.projectId,
        host: entry.host,
        repository: entry.repository,
        number: entry.number,
        action,
        ...(action === "merge" ? { resolveMergeMethod } : {}),
      },
    });
    pendingRef.current = false;
    setPending(false);
    if (result._tag === "Failure") {
      toast({
        type: "error",
        title: ACTION_FAILURE_LABELS[action] ?? "The action failed",
        description: readableFailure(squashAtomCommandFailure(result), ACTION_FAILURE_HINTS[action] ?? ""),
      });
      return;
    }
    toast({ type: "success", title: ACTION_SUCCESS_LABELS[action] ?? "Done" });
    onActed?.(action);
  };
  return (
    <div testId={`pr-speed-${entry.number}`} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, paddingRight: 12 }}>
      {actions.map((action) => {
        const { label, icon } = ACTIONS[action];
        const stacked = action === "merge" && entry.stack !== undefined;
        const sweepable = action === "close" && sweep !== undefined;
        // The Close button holds the pointer from press to release (gpuix capture), so the
        // release decides: after a drag it ends the sweep, otherwise it is this row's Close.
        const sweepHandlers = sweepable
          ? {
              onMouseDown: (event: EventPayload) => {
                if ((event.button ?? 0) !== 0 || busy) return;
                setArmed(true);
                sweep.start(entry, { x: Number(event.x ?? 0), y: Number(event.y ?? 0) });
              },
              onMouseMove: (event: EventPayload) => {
                if (!armedRef.current || event.pressedButton !== 0) return;
                sweep.move({ x: Number(event.x ?? 0), y: Number(event.y ?? 0) });
              },
              onMouseUp: (event: EventPayload) => {
                if (!armedRef.current) return;
                setArmed(false);
                markRowControlClick(event);
                if (!sweep.end()) void perform("close");
              },
              // web: Escape cancels the sweep. The press focused this button, so Escape lands here
              // before the page's own Escape (going back).
              onKeyDown: (event: KeyEvent) => {
                if (event.key !== "escape" || !armedRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                sweep.cancel();
              },
            }
          : null;
        return (
          <Tooltip
            key={action}
            content={
              stacked
                ? "Open this pull request to merge its stack"
                : sweepable
                  ? "Close immediately, or drag across rows to close several"
                  : `${label} immediately`
            }
          >
            <div style={{ display: "flex" }}>
              <PrButton
                {...(sweepHandlers ? { pointer: sweepHandlers, style: { userSelect: "none" } } : {})}
                variant={action === "close" ? "destructive-outline" : "outline"}
                icon={busy ? "loader" : icon}
                disabled={busy || stacked}
                {...(sweepable
                  ? {}
                  : {
                      onClick: (event: EventPayload) => {
                        markRowControlClick(event);
                        void perform(action);
                      },
                    })}
                testId={`pr-speed-${action}-${entry.number}`}
              >
                {label}
              </PrButton>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}
