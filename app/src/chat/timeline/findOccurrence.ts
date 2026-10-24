// Where the active find occurrence sits inside a timeline row, for the reveal
// in useThreadFindNavigation. Web measures the DOM Range of the match; gpuix
// paints the wash natively, and its painted-highlight log is a UI-thread local
// that reads back empty from JS on Windows. The automation tree carries every
// laid-out text run with its bounds, so the occurrence is found there: runs on
// one visual line are joined (a match never crosses a line, like gpuix's
// `highlight`) and matches are counted case-insensitively in reading order.

interface TreeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TreeNode {
  readonly id: number;
  readonly text?: string;
  readonly bounds?: TreeBounds;
  readonly children?: ReadonlyArray<TreeNode>;
}

interface Run {
  readonly text: string;
  readonly bounds: TreeBounds;
}

/** The U+2060 joiners the markdown renderer ends continuing runs with. */
const WORD_JOINER = /\u2060/g;

function findNode(node: TreeNode, id: number): TreeNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function collectRuns(node: TreeNode, runs: Run[]) {
  if (typeof node.text === "string" && node.text.length > 0 && node.bounds && node.bounds.height > 0) {
    runs.push({ text: node.text.replace(WORD_JOINER, ""), bounds: node.bounds });
  }
  for (const child of node.children ?? []) collectRuns(child, runs);
}

function countMatches(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  if (needle.length === 0) return starts;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return starts;
    starts.push(index);
    from = index + needle.length;
  }
}

/**
 * The occurrence's line box relative to the row's top (and the row's painted
 * top in window coordinates), or null when the row is
 * not in the tree or holds fewer occurrences than asked for.
 */
export function locateFindOccurrence(
  treeJson: string,
  rowElementId: number,
  query: string,
  occurrence: number,
): { readonly rowTop: number; readonly top: number; readonly height: number } | null {
  let tree: TreeNode | null;
  try {
    tree = JSON.parse(treeJson) as TreeNode | null;
  } catch {
    return null;
  }
  const row = tree ? findNode(tree, rowElementId) : null;
  if (!row?.bounds) return null;
  const runs: Run[] = [];
  collectRuns(row, runs);
  // Runs whose vertical centres fall within one another's box share a line.
  runs.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const lines: { top: number; bottom: number; runs: Run[] }[] = [];
  for (const run of runs) {
    const centre = run.bounds.y + run.bounds.height / 2;
    const line = lines.find((candidate) => centre >= candidate.top && centre <= candidate.bottom);
    if (line) {
      line.runs.push(run);
      line.top = Math.min(line.top, run.bounds.y);
      line.bottom = Math.max(line.bottom, run.bounds.y + run.bounds.height);
    } else {
      lines.push({ top: run.bounds.y, bottom: run.bounds.y + run.bounds.height, runs: [run] });
    }
  }
  lines.sort((a, b) => a.top - b.top);
  const needle = query.toLowerCase();
  let seen = 0;
  for (const line of lines) {
    const text = line.runs
      .sort((a, b) => a.bounds.x - b.bounds.x)
      .map((run) => run.text)
      .join("")
      .toLowerCase();
    const matches = countMatches(text, needle).length;
    if (seen + matches > occurrence) return { rowTop: row.bounds.y, top: line.top - row.bounds.y, height: line.bottom - line.top };
    seen += matches;
  }
  return null;
}
