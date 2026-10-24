// apps/web/src/lib/diffRendering.ts `hideWhitespaceChanges`, over t3-term's diff model: inside
// each hunk the removed and added lines are compared again with all whitespace stripped, and the
// pairs that then match turn back into unchanged lines (shown from the new side). Lines that
// differ in more than whitespace stay removed or added. Web re-diffs each hunk with @pierre/diffs;
// this pairs each run of changes by longest common subsequence, which is the same diff inside a
// hunk whose unchanged lines already match.
import type { DiffFileModel, DiffHunk, DiffLine } from "../panels/diff/diffModel.ts";

/** A run past this many line pairs keeps its changes as they are rather than stall a frame. */
const MAX_PAIRS = 4_000_000;

function normalized(line: DiffLine): string {
  return line.raw.replace(/\s/gu, "");
}

function pairRun(deletions: ReadonlyArray<DiffLine>, additions: ReadonlyArray<DiffLine>): DiffLine[] {
  if (deletions.length === 0 || additions.length === 0 || deletions.length * additions.length > MAX_PAIRS) {
    return [...deletions, ...additions];
  }
  const a = deletions.map(normalized);
  const b = additions.map(normalized);
  const n = a.length;
  const m = b.length;
  // lengths[i][j]: the common subsequence of a[i..] and b[j..], flattened.
  const lengths = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i * (m + 1) + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(lengths[(i + 1) * (m + 1) + j]!, lengths[i * (m + 1) + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  const pendingDeletions: DiffLine[] = [];
  const pendingAdditions: DiffLine[] = [];
  const flush = () => {
    out.push(...pendingDeletions, ...pendingAdditions);
    pendingDeletions.length = 0;
    pendingAdditions.length = 0;
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      const removed = deletions[i]!;
      out.push({ ...additions[j]!, kind: "context", oldLine: removed.oldLine, oldIndex: removed.oldIndex });
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * (m + 1) + j]! >= lengths[i * (m + 1) + j + 1]!) {
      pendingDeletions.push(deletions[i]!);
      i += 1;
    } else {
      pendingAdditions.push(additions[j]!);
      j += 1;
    }
  }
  pendingDeletions.push(...deletions.slice(i));
  pendingAdditions.push(...additions.slice(j));
  flush();
  return out;
}

function filterHunk(hunk: DiffHunk): DiffHunk {
  const lines: DiffLine[] = [];
  let deletions: DiffLine[] = [];
  let additions: DiffLine[] = [];
  let changed = false;
  const endRun = () => {
    if (deletions.length > 0 && additions.length > 0) {
      const paired = pairRun(deletions, additions);
      if (paired.some((line) => line.kind === "context")) changed = true;
      lines.push(...paired);
    } else {
      lines.push(...deletions, ...additions);
    }
    deletions = [];
    additions = [];
  };
  for (const line of hunk.lines) {
    if (line.kind === "deletion") deletions.push(line);
    else if (line.kind === "addition") additions.push(line);
    else {
      endRun();
      lines.push(line);
    }
  }
  endRun();
  return changed ? { ...hunk, lines } : hunk;
}

const filtered = new WeakMap<DiffFileModel, DiffFileModel>();

export function hideWhitespaceChanges(file: DiffFileModel): DiffFileModel {
  const cached = filtered.get(file);
  if (cached) return cached;
  const hunks = file.hunks.map(filterHunk);
  const next = hunks.every((hunk, index) => hunk === file.hunks[index]) ? file : { ...file, hunks };
  filtered.set(file, next);
  return next;
}
