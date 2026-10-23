// Port of apps/web/src/components/pullRequest/guide/useReviewGuideWriter.ts: reads a pull request's
// review guide and starts an agent writing one. Starting it goes through the write gate, since it
// launches a provider run on the server.
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { guideRunKey, guideRunStore, pullRequestEnvironment, useEnvironmentQuery } from "../../state/pullRequests.ts";
import { toast } from "../../ui/toast.tsx";
import { readableFailure } from "../../web/components/pullRequest/pullRequestDetail.logic.ts";
import { runPullRequestWrite } from "../pullRequestWrites.ts";

export function useReviewGuideWriter({
  environmentId,
  reference,
  title,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  title: string | null;
}) {
  const query = useEnvironmentQuery(pullRequestEnvironment.reviewGuide({ environmentId, input: reference }));
  const canWrite = useAtomValue(pullRequestEnvironment.generateReviewGuide.permissionAtom(environmentId));
  const [starting, setStarting] = useState(false);
  const data = query.data;
  const running = starting || data?.run?._tag === "Running";

  const latest = useRef({ data, title });
  latest.current = { data, title };
  const watchRun = () => {
    const current = latest.current.data;
    guideRunStore.watch({
      environmentId,
      reference,
      title: latest.current.title,
      previousGuideAt: current?.guide?.generatedAt ?? null,
      previousFailedAt: current?.run?._tag === "Failed" ? current.run.failedAt : null,
      since: Date.now(),
    });
  };
  useEffect(() => {
    if (data?.run?._tag === "Running") watchRun();
    // oxlint-disable-next-line react/exhaustive-deps -- watches each run once
  }, [data?.run?._tag]);

  const write = async () => {
    if (running) return;
    setStarting(true);
    watchRun();
    const result = await runPullRequestWrite(pullRequestEnvironment.generateReviewGuide, {
      environmentId,
      input: reference,
    });
    setStarting(false);
    if (result._tag === "Failure") {
      guideRunStore.settle(guideRunKey(environmentId, reference));
      toast({
        type: "error",
        title: "Could not start a review guide",
        description: readableFailure(
          squashAtomCommandFailure(result),
          "Check the review guide model in Settings → Source Control.",
        ),
      });
    }
  };

  return { query, data, running, canWrite, write };
}
