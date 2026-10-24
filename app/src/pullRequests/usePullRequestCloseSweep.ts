// The pull request list's close sweep, from apps/web/src/components/pullRequest/PullRequestsPage.tsx
// (`startCloseSweep`) and usePullRequestActions.ts (`usePullRequestCloseBatch`): with Shift held,
// press a row's Close and drag across the rows below or above it; every open row of the same
// group the drag covers is marked, Escape cancels, and the release closes the marked rows in one
// batch. A press released without dragging is an ordinary single Close.
//
// Web runs this on a document-level pointer sensor. In gpuix the Close button that took the press
// captures the pointer (onMouseDown + onMouseMove), so its moves arrive in window coordinates and
// the row under the pointer is found from the list's fixed row heights, as the page already does
// for the rows on screen.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { pullRequestEnvironment } from "../state/pullRequests.ts";
import { toast } from "../ui/toast.tsx";
import { resolveSidebarSweepKeys } from "../web/components/Sidebar.logic.ts";
import { readableFailure } from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { pullRequestEntryKey, type EnvironmentPullRequestEntry } from "../web/components/pullRequest/pullRequestList.logic.ts";
import { runPullRequestWrite } from "./pullRequestWrites.ts";

/** web SidebarPointerSensor `distance`: movement before a press becomes a sweep. */
const SWEEP_DISTANCE = 6;

const CLOSE_FAILURE_HINT = "The host refused it. Check that you have write access, or that you opened it.";

export interface CloseSweepPoint {
  readonly x: number;
  readonly y: number;
}

/** What a row's Close button calls while it holds the pointer. Stable for the page's life. */
export interface CloseSweepHandlers {
  readonly start: (entry: EnvironmentPullRequestEntry, point: CloseSweepPoint) => void;
  readonly move: (point: CloseSweepPoint) => void;
  /** The release. True when it ended a sweep (or a cancelled one): no single Close then. */
  readonly end: () => boolean;
  /** Escape: the sweep ends and nothing is closed. */
  readonly cancel: () => void;
}

export interface CloseSweepRow {
  readonly entry: EnvironmentPullRequestEntry;
  readonly groupKey: string;
}

export interface CloseSweepSource {
  /** Every listed row, in list order, with its group. */
  readonly rows: ReadonlyArray<CloseSweepRow>;
  readonly canClose: (entry: EnvironmentPullRequestEntry) => boolean;
  /** The row under a window y, clamped to the list's viewport. */
  readonly rowKeyAtY: (y: number) => string | null;
}

/** usePullRequestCloseBatch: closes several at once, one toast for the lot. */
function usePullRequestCloseBatch(onClosed: () => void) {
  const pending = useRef(new Set<string>());
  const [closingKeys, setClosingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const close = async (entries: ReadonlyArray<EnvironmentPullRequestEntry>) => {
    const batch = entries.filter((entry) => {
      const key = pullRequestEntryKey(entry);
      if (entry.state !== "open" || pending.current.has(key)) return false;
      pending.current.add(key);
      return true;
    });
    if (batch.length === 0) return;
    setClosingKeys(new Set(pending.current));
    const failures: string[] = [];
    const outcomes = await Promise.all(
      batch.map(async (entry) => {
        const result = await runPullRequestWrite(pullRequestEnvironment.runAction, {
          environmentId: entry.environmentId,
          input: {
            projectId: entry.projectId,
            host: entry.host,
            repository: entry.repository,
            number: entry.number,
            action: "close" as const,
          },
        });
        pending.current.delete(pullRequestEntryKey(entry));
        setClosingKeys(new Set(pending.current));
        if (result._tag === "Failure") {
          failures.push(`#${entry.number}: ${readableFailure(squashAtomCommandFailure(result), CLOSE_FAILURE_HINT)}`);
          return false;
        }
        return true;
      }),
    );
    const closed = outcomes.filter(Boolean).length;
    if (closed > 0) onClosed();
    toast({
      type: failures.length > 0 ? "error" : "success",
      title:
        failures.length > 0
          ? `Closed ${closed} of ${batch.length} pull requests`
          : `Closed ${closed} pull request${closed === 1 ? "" : "s"}`,
      ...(failures.length > 0 ? { description: failures.slice(0, 3).join("\n") } : {}),
    });
  };
  return { close, closingKeys };
}

interface SweepGesture {
  readonly originKey: string;
  readonly groupKey: string;
  readonly origin: CloseSweepPoint;
  active: boolean;
  cancelled: boolean;
  targetKey: string | null;
  sweptKeys: string[];
}

export function usePullRequestCloseSweep(source: CloseSweepSource, onClosed: () => void) {
  const { close, closingKeys } = usePullRequestCloseBatch(onClosed);
  const [sweepingKeys, setSweepingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const gesture = useRef<SweepGesture | null>(null);
  // A sweep spans many renders; each step reads the rows on screen at that moment.
  const latest = useRef({ source, close, closingKeys });
  latest.current = { source, close, closingKeys };

  const canSweep = (key: string, groupKey: string) => {
    const { source, closingKeys } = latest.current;
    const row = source.rows.find((candidate) => pullRequestEntryKey(candidate.entry) === key);
    return (
      row !== undefined &&
      row.groupKey === groupKey &&
      row.entry.state === "open" &&
      source.canClose(row.entry) &&
      !closingKeys.has(key)
    );
  };
  const sweepTo = (current: SweepGesture, key: string) => {
    if (key === current.targetKey) return;
    current.targetKey = key;
    const ordered = latest.current.source.rows.map((row) => pullRequestEntryKey(row.entry));
    current.sweptKeys = resolveSidebarSweepKeys(ordered, current.originKey, key, (candidate) => canSweep(candidate, current.groupKey));
    setSweepingKeys(new Set(current.sweptKeys));
  };

  const handlers = useRef<CloseSweepHandlers>({
    start: (entry, point) => {
      const key = pullRequestEntryKey(entry);
      const row = latest.current.source.rows.find((candidate) => pullRequestEntryKey(candidate.entry) === key);
      if (!row || latest.current.closingKeys.has(key)) {
        gesture.current = null;
        return;
      }
      gesture.current = { originKey: key, groupKey: row.groupKey, origin: point, active: false, cancelled: false, targetKey: null, sweptKeys: [] };
    },
    move: (point) => {
      const current = gesture.current;
      if (!current || current.cancelled) return;
      if (!current.active) {
        if (Math.hypot(point.x - current.origin.x, point.y - current.origin.y) < SWEEP_DISTANCE) return;
        current.active = true;
        sweepTo(current, current.originKey);
      }
      const key = latest.current.source.rowKeyAtY(point.y);
      if (key !== null) sweepTo(current, key);
    },
    end: () => {
      const current = gesture.current;
      gesture.current = null;
      if (!current) return false;
      setSweepingKeys(new Set());
      if (current.cancelled) return true;
      if (!current.active) return false;
      const rows = latest.current.source.rows;
      const batch = current.sweptKeys
        .filter((key) => canSweep(key, current.groupKey))
        .flatMap((key) => {
          const row = rows.find((candidate) => pullRequestEntryKey(candidate.entry) === key);
          return row ? [row.entry] : [];
        });
      void latest.current.close(batch);
      return true;
    },
    cancel: () => {
      const current = gesture.current;
      if (!current) return;
      current.cancelled = true;
      setSweepingKeys(new Set());
    },
  }).current;

  return { handlers, sweepingKeys, closingKeys, cancel: handlers.cancel, sweeping: sweepingKeys.size > 0 };
}
