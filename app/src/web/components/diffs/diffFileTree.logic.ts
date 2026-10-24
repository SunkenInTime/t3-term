// Adapted from apps/web/src/components/diffs/diffFileTree.logic.ts. The web tree hands
// these paths to @pierre/trees (compact density, flattenEmptyDirectories, initial
// expansion "open", a sort comparator keyed on diff order, a git status lane). t3-term
// draws the tree itself, so the same ordering and status rules project to rows here.
import type { PatchFile } from "../../../panels/diff/patchFiles.ts";

/** @pierre/trees GitStatus, the subset a diff produces. */
export type DiffGitStatus = "added" | "deleted" | "renamed" | "modified";

export interface DiffFileTreeEntry {
  readonly path: string;
  readonly status: DiffGitStatus;
}

function toGitStatus(file: PatchFile): DiffGitStatus {
  switch (file.kind) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    case "changed":
      return "modified";
  }
}

export function diffFileTreeEntries(files: ReadonlyArray<PatchFile>): ReadonlyArray<DiffFileTreeEntry> {
  const statusByPath = new Map<string, DiffGitStatus>();
  for (const file of files) {
    const status = toGitStatus(file);
    const previous = statusByPath.get(file.path);
    statusByPath.set(file.path, previous === undefined || previous === status ? status : "modified");
  }
  return [...statusByPath].map(([path, status]) => ({ path, status }));
}

export function collectDirectoryPaths(paths: ReadonlyArray<string>): ReadonlyArray<string> {
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    let directory = "";
    for (const segment of segments.slice(0, -1)) {
      directory += `${segment}/`;
      directories.add(directory);
    }
  }
  return [...directories];
}

export function diffFileTreePositions(paths: ReadonlyArray<string>): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  paths.forEach((path, index) => {
    positions.set(path, index);
    let directory = "";
    for (const segment of path.split("/").slice(0, -1)) {
      directory += `${segment}/`;
      if (!positions.has(directory)) positions.set(directory, index);
    }
  });
  return positions;
}

export interface DiffTreeRow {
  /** Directory paths end in "/" like pierre's; a flattened row carries its deepest folder. */
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly depth: number;
  /** Folder names of a flattened chain ("a / b"), else the entry's own name. */
  readonly segments: ReadonlyArray<string>;
  /** Every folder path a flattened row stands for, head first. */
  readonly chain: ReadonlyArray<string>;
  readonly expanded: boolean;
  /** Files only. */
  readonly status: DiffGitStatus | null;
}

interface TreeNode {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly children: TreeNode[];
}

/**
 * The visible rows: pierre's compareDiffFileTreeEntries order (first diff position under a
 * node, then depth, then path), with a folder whose only child is a folder flattened into
 * one row, and collapsed folders hiding what is under them.
 */
export function buildDiffTreeRows(
  entries: ReadonlyArray<DiffFileTreeEntry>,
  collapsed: ReadonlySet<string>,
): DiffTreeRow[] {
  const paths = entries.map((entry) => entry.path);
  const statusByPath = new Map(entries.map((entry) => [entry.path, entry.status]));
  const positions = diffFileTreePositions(paths);
  const root: TreeNode = { path: "", name: "", kind: "directory", children: [] };
  const directories = new Map<string, TreeNode>([["", root]]);
  for (const path of paths) {
    const segments = path.split("/");
    let parent = root;
    let directory = "";
    for (const segment of segments.slice(0, -1)) {
      directory += `${segment}/`;
      let node = directories.get(directory);
      if (!node) {
        node = { path: directory, name: segment, kind: "directory", children: [] };
        directories.set(directory, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.children.push({ path, name: segments.at(-1) ?? path, kind: "file", children: [] });
  }
  const depthOf = (path: string) => path.split("/").filter(Boolean).length;
  const order = (left: TreeNode, right: TreeNode) =>
    (positions.get(left.path) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.path) ?? Number.MAX_SAFE_INTEGER) ||
    depthOf(left.path) - depthOf(right.path) ||
    left.path.localeCompare(right.path);

  const rows: DiffTreeRow[] = [];
  const visit = (node: TreeNode, depth: number) => {
    for (const child of node.children.toSorted(order)) {
      if (child.kind === "file") {
        rows.push({
          path: child.path,
          kind: "file",
          depth,
          segments: [child.name],
          chain: [child.path],
          expanded: false,
          status: statusByPath.get(child.path) ?? null,
        });
        continue;
      }
      const chain = [child];
      while (chain.at(-1)!.children.length === 1 && chain.at(-1)!.children[0]!.kind === "directory") {
        chain.push(chain.at(-1)!.children[0]!);
      }
      const tail = chain.at(-1)!;
      const expanded = !chain.some((link) => collapsed.has(link.path));
      rows.push({
        path: tail.path,
        kind: "directory",
        depth,
        segments: chain.map((link) => link.name),
        chain: chain.map((link) => link.path),
        expanded,
        status: null,
      });
      if (expanded) visit(tail, depth + 1);
    }
  };
  visit(root, 0);
  return rows;
}
