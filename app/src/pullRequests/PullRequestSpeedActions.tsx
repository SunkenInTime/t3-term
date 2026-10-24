// Port of apps/web/src/components/pullRequest/{PullRequestSpeedActions.tsx,usePullRequestActions.ts
// (usePullRequestActionRunner)}: hold Shift over the pull request list and each row offers its
// quick actions (Close, Merge, Ready for review, Reopen), carried out at once with no confirm, as
// web does. Every press goes through the write gate.
//
// Not ported: web's drag across rows to close several (the close sweep).
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
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
}: {
  entry: EnvironmentPullRequestEntry;
  hostActions: ReadonlySet<PullRequestAction>;
  onActed?: (action: PullRequestAction) => void;
}) {
  const speedMode = useAtomValue(shiftOnlyHeldAtom);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const actions = pullRequestQuickActions(entry, hostActions);
  if (actions.length === 0 || (!speedMode && !pending)) return null;

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
        return (
          <Tooltip key={action} content={stacked ? "Open this pull request to merge its stack" : `${label} immediately`}>
            <div style={{ display: "flex" }}>
              <PrButton
                variant={action === "close" ? "destructive-outline" : "outline"}
                icon={pending ? "loader" : icon}
                disabled={pending || stacked}
                onClick={(event) => {
                  markRowControlClick(event);
                  void perform(action);
                }}
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
