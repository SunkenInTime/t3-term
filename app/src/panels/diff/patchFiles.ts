// Splits a unified git patch into per-file chunks with their paths and line
// stats. diffModel.ts parses each chunk's hunks for DiffView.

export interface PatchFile {
  readonly path: string;
  readonly previousPath: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly kind: "new" | "deleted" | "renamed" | "changed";
  readonly patch: string;
}

function stripPrefix(path: string): string {
  const unquoted = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
  return unquoted.replace(/^[ab]\//, "");
}

export function splitPatch(patch: string | null | undefined): ReadonlyArray<PatchFile> {
  if (!patch || patch.trim().length === 0) return [];
  const chunks = patch.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith("diff --git "));
  return chunks.map((chunk) => {
    const lines = chunk.split("\n");
    let oldPath: string | null = null;
    let newPath: string | null = null;
    let kind: PatchFile["kind"] = "changed";
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of lines) {
      if (!inHunk) {
        if (line.startsWith("--- ")) oldPath = line.slice(4).trim() === "/dev/null" ? null : stripPrefix(line.slice(4).trim());
        else if (line.startsWith("+++ ")) newPath = line.slice(4).trim() === "/dev/null" ? null : stripPrefix(line.slice(4).trim());
        else if (line.startsWith("new file mode")) kind = "new";
        else if (line.startsWith("deleted file mode")) kind = "deleted";
        else if (line.startsWith("rename from ")) {
          kind = "renamed";
          oldPath = line.slice("rename from ".length).trim();
        } else if (line.startsWith("rename to ")) newPath = line.slice("rename to ".length).trim();
        else if (line.startsWith("@@")) inHunk = true;
        continue;
      }
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
    }
    if (newPath === null && oldPath === null) {
      // Binary or mode-only change: `diff --git a/x b/x`.
      const match = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/m.exec(chunk);
      newPath = match?.[2] ?? match?.[1] ?? "unknown";
    }
    const path = newPath ?? oldPath ?? "unknown";
    return {
      path,
      previousPath: kind === "renamed" ? oldPath : null,
      additions,
      deletions,
      kind,
      patch: chunk.endsWith("\n") ? chunk : `${chunk}\n`,
    };
  });
}
