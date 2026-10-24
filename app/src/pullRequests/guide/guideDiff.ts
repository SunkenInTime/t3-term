// The guide's view of the pull request diff: apps/web/src/components/pullRequest/guide/
// useGuideDiffFiles.ts (pages loaded until every file a stop names has arrived), and the row
// model client-runtime's review-guide-tour slices excerpts from, built from t3-term's own diff
// model (web builds it from pierre's FileDiffMetadata with `fileDiffRows`).
import type { DiffRow as TourRow } from "@t3tools/client-runtime/review-guide-tour";
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useState } from "react";

import { parseDiffFiles, type DiffFileModel } from "../../panels/diff/diffModel.ts";
import { pullRequestEnvironment, pullRequestReviewKey, useEnvironmentQuery } from "../../state/pullRequests.ts";

/** `fileDiffRows` over DiffFileModel: one row per diff line, with where it sits on each side. */
export function modelTourRows(file: DiffFileModel): ReadonlyArray<TourRow> {
  const rows: TourRow[] = [];
  file.hunks.forEach((hunk, hunkIndex) => {
    const first = hunk.lines[0];
    let oldAt = first?.oldLine ?? hunk.lines.find((line) => line.oldLine !== null)?.oldLine ?? 1;
    let newAt = first?.newLine ?? hunk.lines.find((line) => line.newLine !== null)?.newLine ?? 1;
    for (const line of hunk.lines) {
      if (line.oldLine !== null) oldAt = line.oldLine;
      if (line.newLine !== null) newAt = line.newLine;
      rows.push({ kind: line.kind, oldLine: line.oldLine, newLine: line.newLine, oldAt, newAt, text: line.text, hunk: hunkIndex });
      if (line.oldLine !== null) oldAt += 1;
      if (line.newLine !== null) newAt += 1;
    }
  });
  return rows;
}

interface LoadedDiff {
  readonly key: string;
  readonly cursor: string | null;
  readonly done: boolean;
  readonly files: ReadonlyMap<string, DiffFileModel>;
  readonly folded: unknown;
}

const NO_FILES: ReadonlyMap<string, DiffFileModel> = new Map();

export function useGuideDiffFiles({
  environmentId,
  reference,
  headSha,
  wantedPaths,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  headSha: string;
  wantedPaths: ReadonlyArray<string>;
}) {
  const key = `${environmentId}:${pullRequestReviewKey(reference)}:${headSha}`;
  const [loaded, setLoaded] = useState<LoadedDiff>({ key, cursor: null, done: false, files: NO_FILES, folded: null });
  const current: LoadedDiff = loaded.key === key ? loaded : { key, cursor: null, done: false, files: NO_FILES, folded: null };
  const missing = wantedPaths.some((path) => !current.files.has(path));
  const loading = missing && !current.done;
  const query = useEnvironmentQuery(
    loading
      ? pullRequestEnvironment.diff({
          environmentId,
          input: { ...reference, ...(current.cursor === null ? {} : { cursor: current.cursor }) },
        })
      : null,
  );
  // Each page is folded in once, during the render that first sees it.
  const data = query.data;
  if (loading && data !== null && current.folded !== data) {
    const files = new Map(current.files);
    for (const file of parseDiffFiles(data.patch)) files.set(file.path, file);
    setLoaded({ key, cursor: data.nextCursor, done: data.nextCursor === null, files, folded: data });
  }
  return {
    files: current.files,
    loading: loading && query.error === null,
    error: loading ? query.error : null,
    retry: query.refresh,
  };
}
