// Port of apps/web/src/components/pullRequest/usePullRequestFilesViewed.ts: the Code tab's "Viewed"
// ticks. A press shows at once and is sent with the others pressed in the next 400 ms; it holds
// until a read that could have seen it comes back.
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { pullRequestEnvironment, useEnvironmentQuery } from "../state/pullRequests.ts";
import { toast } from "../ui/toast.tsx";
import {
  isFileViewed,
  isStaleViewedState,
  revertFileViewedOverlay,
  settleFileViewedOverlay,
  toFileViewedBatch,
  toFileViewedStates,
  type FileViewedOverlay,
  type FileViewedStates,
} from "../web/components/pullRequest/pullRequestFilesViewed.logic.ts";
import { PullRequestDryRunError, runPullRequestWrite } from "./pullRequestWrites.ts";

const FLUSH_DELAY_MS = 400;
const NO_OVERLAY: FileViewedOverlay = new Map();

export interface PullRequestFilesViewedView {
  readonly enabled: boolean;
  readonly isViewed: (path: string) => boolean;
  readonly isStale: (path: string) => boolean;
  readonly setViewed: (path: string, viewed: boolean) => void;
  readonly truncated: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function usePullRequestFilesViewed(options: {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly enabled: boolean;
}): PullRequestFilesViewedView {
  const { environmentId, reference, enabled } = options;
  const query = useEnvironmentQuery(
    enabled ? pullRequestEnvironment.filesViewed({ environmentId, input: reference }) : null,
  );
  const refresh = query.refresh;
  // One Map per host answer: the comparisons below are by identity (web relies on its compiler for this).
  const states = useMemo(() => toFileViewedStates(query.data), [query.data]);
  const [overlay, setOverlay] = useState<FileViewedOverlay>(NO_OVERLAY);
  const queued = useRef<Map<string, boolean>>(new Map());
  const sentBy = useRef<Map<string, number>>(new Map());
  const requests = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Everything held here belongs to one change request on one environment.
  const scopeKey = `${environmentId} ${reference.projectId} ${reference.repository} ${reference.number}`;
  const scope = useRef(scopeKey);
  // The host's answer when a write was acknowledged, per path; the first answer that differs is
  // the first read that could have seen the write.
  const answeredFrom = useRef<Map<string, FileViewedStates | null>>(new Map());
  const committedStates = useRef(states);

  useEffect(() => {
    committedStates.current = states;
    const pending = new Set([...queued.current.keys(), ...sentBy.current.keys()]);
    const answered = new Set<string>();
    for (const [path, from] of answeredFrom.current) {
      if (pending.has(path) || from === states) continue;
      answered.add(path);
      answeredFrom.current.delete(path);
    }
    setOverlay((current) => settleFileViewedOverlay(current, states, pending, answered));
    // oxlint-disable-next-line react/exhaustive-deps -- runs per host answer
  }, [query.data]);

  const flush = (target: { readonly environmentId: EnvironmentId; readonly reference: PullRequestRef }) => {
    flushTimer.current = null;
    const batch = toFileViewedBatch(queued.current);
    if (batch.length === 0) return;
    queued.current = new Map();
    const sentFrom = scope.current;
    const request = ++requests.current;
    for (const file of batch) sentBy.current.set(file.path, request);
    void runPullRequestWrite(pullRequestEnvironment.setFilesViewed, {
      environmentId: target.environmentId,
      input: { ...target.reference, files: batch },
    }).then((result) => {
      const mine = batch.map((file) => file.path).filter((path) => sentBy.current.get(path) === request);
      for (const path of mine) sentBy.current.delete(path);
      if (scope.current !== sentFrom) return;
      if (result._tag === "Failure") {
        const owned = new Set(mine.filter((path) => !queued.current.has(path)));
        setOverlay((current) => revertFileViewedOverlay(current, batch, owned));
        if (owned.size > 0 && !isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          toast({
            type: "error",
            title: "Could not update viewed files",
            ...(failure instanceof PullRequestDryRunError ? { description: failure.message } : {}),
          });
          refresh();
        }
        return;
      }
      for (const path of mine) answeredFrom.current.set(path, committedStates.current);
      refresh();
    });
  };

  const latest = useRef({ environmentId, reference, flush });
  latest.current = { environmentId, reference, flush };

  // Leaving a change request sends its last presses to it, then drops the rest.
  useEffect(() => {
    const leaving = { environmentId: latest.current.environmentId, reference: latest.current.reference };
    scope.current = scopeKey;
    return () => {
      if (flushTimer.current !== null) {
        clearTimeout(flushTimer.current);
        latest.current.flush(leaving);
      }
      queued.current = new Map();
      sentBy.current = new Map();
      answeredFrom.current = new Map();
      setOverlay(NO_OVERLAY);
    };
  }, [scopeKey]);

  const setViewed = (path: string, viewed: boolean) => {
    setOverlay((current) => new Map(current).set(path, viewed));
    queued.current.set(path, viewed);
    if (flushTimer.current !== null) clearTimeout(flushTimer.current);
    const target = { environmentId, reference };
    flushTimer.current = setTimeout(() => latest.current.flush(target), FLUSH_DELAY_MS);
  };

  return {
    enabled,
    isViewed: (path: string) => isFileViewed(path, states, overlay),
    isStale: (path: string) => !overlay.has(path) && isStaleViewedState(states?.get(path)),
    setViewed,
    truncated: query.data?.truncated === true,
    error: query.error,
    refresh,
  };
}
