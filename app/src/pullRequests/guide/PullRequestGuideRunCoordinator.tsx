// Port of apps/web/src/components/pullRequest/guide/PullRequestGuideRunCoordinator.tsx: watches the
// review guides being written, polling each every five seconds, and says when one is ready or
// failed with an "Open guide" action, unless the reader is already looking at that guide.
// Mounted once for the app. Web also plays the notification sound and raises a desktop
// notification when the window is in the background; t3-term announces it in the window only.
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import {
  guideRunStateAtom,
  guideRunStore,
  openPullRequestsPage,
  pullRequestEnvironment,
  pullRequestPanel,
  useEnvironmentQuery,
  type GuideRunWatch,
} from "../../state/pullRequests.ts";
import { dismissToast, toast } from "../../ui/toast.tsx";

const RUN_POLL_MS = 5_000;
const UNSEEN_RUN_MS = 60_000;

export function PullRequestGuideRunCoordinator() {
  const watches = useAtomValue(guideRunStateAtom).watches;
  return (
    <>
      {Object.entries(watches).map(([key, watch]) => (
        <GuideRunWatcher key={key} runKey={key} watch={watch} />
      ))}
    </>
  );
}

function GuideRunWatcher({ runKey, watch }: { runKey: string; watch: GuideRunWatch }) {
  const query = useEnvironmentQuery(
    pullRequestEnvironment.reviewGuide({ environmentId: watch.environmentId, input: watch.reference }),
  );
  const refresh = query.refresh;
  useEffect(() => {
    const timer = setInterval(refresh, RUN_POLL_MS);
    return () => clearInterval(timer);
    // oxlint-disable-next-line react/exhaustive-deps -- one timer per watch
  }, []);
  const data = query.data;
  const sawRunning = useRef(false);
  useEffect(() => {
    if (data === null) return;
    if (data.run?._tag === "Running") {
      sawRunning.current = true;
      return;
    }
    const failure = data.run?._tag === "Failed" && data.run.failedAt !== watch.previousFailedAt ? data.run.detail : null;
    const written = failure === null && data.guide !== null && data.guide.generatedAt !== watch.previousGuideAt;
    if (failure === null && !written) {
      if (sawRunning.current || Date.now() - watch.since > UNSEEN_RUN_MS) guideRunStore.settle(runKey);
      return;
    }
    guideRunStore.settle(runKey);
    if (guideRunStore.read().shownKey === runKey) return;
    const body = watch.title ?? `${watch.reference.repository} #${watch.reference.number}`;
    const open = () => {
      guideRunStore.requestOpen(runKey);
      openPullRequestsPage();
      pullRequestPanel.open({
        environmentId: watch.environmentId,
        projectId: watch.reference.projectId,
        ...(watch.reference.host === undefined ? {} : { host: watch.reference.host }),
        repository: watch.reference.repository,
        number: watch.reference.number,
        detailTab: "guide",
      });
    };
    const id = toast({
      type: failure === null ? "success" : "error",
      title: failure === null ? "Review guide ready" : "Review guide failed",
      description: failure === null ? body : `${body}: ${failure}`,
      action: {
        label: "Open guide",
        onClick: () => {
          dismissToast(id);
          open();
        },
      },
    });
  }, [data, runKey, watch]);
  return null;
}
