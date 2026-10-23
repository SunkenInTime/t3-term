// Adapted from apps/web/src/components/files/fileTreeExpansion.ts. The web version drives
// @pierre/trees item handles; t3-term's tree keeps expansion as a set of directory paths,
// so the same two operations work on that set.

export function areAllDirectoriesExpanded(
  expanded: ReadonlySet<string>,
  directoryPaths: readonly string[],
): boolean {
  return directoryPaths.length > 0 && directoryPaths.every((path) => expanded.has(path));
}

export function setAllDirectoriesExpanded(
  expanded: ReadonlySet<string>,
  directoryPaths: readonly string[],
  value: boolean,
): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const path of directoryPaths) {
    if (expanded.has(path) === value) continue;
    next ??= new Set(expanded);
    if (value) next.add(path);
    else next.delete(path);
  }
  return next ?? expanded;
}
