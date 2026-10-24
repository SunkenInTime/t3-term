// Ported from apps/web/src/components/pullRequest/pullRequestDiff.logic.ts (the fold helpers) and
// apps/web/src/lib/diffCollapse.ts. `isLineInFileDiff` reads pierre's FileDiffMetadata; t3-term's
// equivalent over its own diff model is `isLineInDiffModel` below.
import type { PullRequestDiffSide } from "@t3tools/contracts";

import type { DiffFileModel } from "../../../panels/diff/diffModel.ts";

export type DiffFoldOverride = "expanded" | "folded" | null;

/**
 * A diff arrives a slice at a time, so the reader's own choices are kept as the difference from
 * what the toolbar last said rather than as the set of folded files: a file that has not loaded
 * yet cannot be in a set, and would otherwise land expanded moments after the reader folded
 * everything.
 */
export function isFileDiffCollapsed(
  fileKey: string,
  foldOverride: DiffFoldOverride,
  toggledFileKeys: ReadonlySet<string>,
): boolean {
  const foldedByDefault = foldOverride === "folded";
  return toggledFileKeys.has(fileKey) ? !foldedByDefault : foldedByDefault;
}

export function toggleFileDiffFoldForViewed(
  fileKey: string,
  viewed: boolean,
  foldOverride: DiffFoldOverride,
  toggledFileKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  if (isFileDiffCollapsed(fileKey, foldOverride, toggledFileKeys) === viewed)
    return toggledFileKeys;
  const next = new Set(toggledFileKeys);
  if (next.has(fileKey)) next.delete(fileKey);
  else next.add(fileKey);
  return next;
}

export function areAllDiffFilesCollapsed(
  fileKeys: ReadonlyArray<string>,
  collapsedFileKeys: ReadonlySet<string>,
): boolean {
  return fileKeys.length > 0 && fileKeys.every((fileKey) => collapsedFileKeys.has(fileKey));
}


/**
 * A thread naming a file is not the same as a thread the diff can show: its line may have moved
 * out of the change, or sit in a hunk the host withheld. Pinning it anyway would put the remark
 * against whatever code now occupies that line number.
 */
export function isLineInDiffModel(file: DiffFileModel, side: PullRequestDiffSide, line: number): boolean {
  return file.hunks.some((hunk) =>
    hunk.lines.some((entry) =>
      side === "left"
        ? entry.kind !== "addition" && entry.oldLine === line
        : entry.kind !== "deletion" && entry.newLine === line,
    ),
  );
}
