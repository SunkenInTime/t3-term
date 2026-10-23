// The visible rows of the Files tree. The web client hands its paths to @pierre/trees
// (compact density, flattenEmptyDirectories, fileTreeSearchMode "hide-non-matches");
// this reproduces that projection for one <virtual-list>:
// - directories before files, each group in natural order;
// - a folder whose known children are exactly one folder shares a row with it ("a / b");
// - a search keeps entries whose path contains the query (case-insensitive, `\` as `/`),
//   plus their ancestors, all expanded (pierre's searchHelpers + FileTreeController).
import type { ProjectEntry } from "@t3tools/contracts";

export interface FileTreeRow {
  /** The entry the row acts on: the deepest folder of a flattened chain. */
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly depth: number;
  /** Labels of a flattened chain, else the entry's own name. */
  readonly segments: readonly string[];
  /** Folder paths a flattened row stands for, head first. */
  readonly chain: readonly string[];
  readonly expanded: boolean;
  readonly ignored: boolean;
}

let collator: Intl.Collator | undefined;

function compareEntries(left: ProjectEntry, right: ProjectEntry): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return collator.compare(baseName(left.path), baseName(right.path));
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function childrenByParent(entries: readonly ProjectEntry[]): ReadonlyMap<string, readonly ProjectEntry[]> {
  const children = new Map<string, ProjectEntry[]>();
  for (const entry of entries) {
    const parent = parentPath(entry.path);
    let list = children.get(parent);
    if (list === undefined) {
      list = [];
      children.set(parent, list);
    }
    list.push(entry);
  }
  for (const list of children.values()) list.sort(compareEntries);
  return children;
}

/** pierre's normalizeSearchQuery. */
export function normalizeTreeSearchQuery(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  return (trimmed.includes("\\") ? trimmed.replaceAll("\\", "/") : trimmed).toLowerCase();
}

/** Paths that match the search, and every path that must show for them. Null when none match. */
export function searchVisiblePaths(
  entries: readonly ProjectEntry[],
  query: string,
): ReadonlySet<string> | null {
  if (query.length === 0) return null;
  const visible = new Set<string>();
  for (const entry of entries) {
    // pierre lists folders with a trailing slash, and matches against that form.
    const listed = entry.kind === "directory" ? `${entry.path}/` : entry.path;
    if (!listed.toLowerCase().includes(query)) continue;
    visible.add(entry.path);
    let parent = parentPath(entry.path);
    while (parent !== "") {
      visible.add(parent);
      parent = parentPath(parent);
    }
  }
  return visible.size === 0 ? null : visible;
}

export function buildFileTreeRows(input: {
  readonly children: ReadonlyMap<string, readonly ProjectEntry[]>;
  readonly expanded: ReadonlySet<string>;
  /** Set while a search with matches is active: only these rows show, all expanded. */
  readonly searchVisible: ReadonlySet<string> | null;
}): FileTreeRow[] {
  const { children, expanded, searchVisible } = input;
  const rows: FileTreeRow[] = [];
  const visit = (directoryPath: string, depth: number, ignoredAncestor: boolean) => {
    for (const entry of children.get(directoryPath) ?? []) {
      if (searchVisible !== null && !searchVisible.has(entry.path)) continue;
      const ignored = ignoredAncestor || entry.ignored === true;
      if (entry.kind === "file") {
        rows.push({
          path: entry.path,
          kind: "file",
          depth,
          segments: [baseName(entry.path)],
          chain: [entry.path],
          expanded: false,
          ignored,
        });
        continue;
      }
      const chain = [entry.path];
      let chainIgnored = ignored;
      for (;;) {
        const known = children.get(chain.at(-1)!);
        if (known === undefined || known.length !== 1 || known[0]!.kind !== "directory") break;
        if (searchVisible !== null && !searchVisible.has(known[0]!.path)) break;
        chain.push(known[0]!.path);
        chainIgnored ||= known[0]!.ignored === true;
      }
      const tail = chain.at(-1)!;
      const isExpanded = searchVisible !== null || expanded.has(entry.path);
      rows.push({
        path: tail,
        kind: "directory",
        depth,
        segments: chain.map(baseName),
        chain,
        expanded: isExpanded,
        ignored: chainIgnored,
      });
      if (isExpanded) visit(tail, depth + 1, chainIgnored);
    }
  };
  visit("", 0, false);
  return rows;
}
