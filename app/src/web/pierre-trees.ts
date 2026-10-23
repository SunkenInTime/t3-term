// The parts of @pierre/trees that apps/web/src/pierre-icons.ts uses, ported from
// @pierre/trees 1.0.0-beta.6 dist/render/iconResolver.js, dist/iconConfig.js and
// dist/builtInIcons.js. The package is not a t3-term dependency; its data lives in
// pierre-trees.data.ts.
import {
  BUILT_IN_FILE_EXTENSION_TOKENS,
  BUILT_IN_FILE_NAME_TOKENS,
  BUILT_IN_ICON_SVGS,
  COMPLETE_EXTENSION_OVERRIDES,
} from "./pierre-trees.data.ts";

export type FileTreeIconEntry = string | { readonly name: string; readonly token?: string };

export interface FileTreeIcons {
  readonly set?: "minimal" | "standard" | "complete" | "none";
  readonly colored?: boolean;
  readonly spriteSheet?: string;
  readonly remap?: Readonly<Record<string, FileTreeIconEntry>>;
  readonly byFileName?: Readonly<Record<string, FileTreeIconEntry>>;
  readonly byFileExtension?: Readonly<Record<string, FileTreeIconEntry>>;
  readonly byFileNameContains?: Readonly<Record<string, FileTreeIconEntry>>;
}

export interface ResolvedFileTreeIcon {
  readonly name: string;
  readonly token?: string;
  readonly remappedFrom?: string;
}

const STANDARD_TIER_TOKENS = new Set([
  "bash",
  "c",
  "cpp",
  "css",
  "database",
  "default",
  "font",
  "git",
  "go",
  "html",
  "image",
  "javascript",
  "json",
  "markdown",
  "mcp",
  "python",
  "ruby",
  "rust",
  "swift",
  "table",
  "text",
  "typescript",
  "zip",
]);

export function getBuiltInFileIconName(token: string): string {
  return `file-tree-builtin-${token}`;
}

function resolveBuiltInFileIconToken(
  set: NonNullable<FileTreeIcons["set"]>,
  fileName: string,
  extensionCandidates: ReadonlyArray<string>,
): string | undefined {
  if (set === "minimal" || set === "none") return undefined;
  const isComplete = set === "complete";
  const fileNameToken = BUILT_IN_FILE_NAME_TOKENS[fileName.toLowerCase()];
  if (fileNameToken != null) {
    if (isComplete || STANDARD_TIER_TOKENS.has(fileNameToken)) return fileNameToken;
  }
  for (const extension of extensionCandidates) {
    if (isComplete) {
      const override = COMPLETE_EXTENSION_OVERRIDES[extension];
      if (override != null) return override;
    }
    const match = BUILT_IN_FILE_EXTENSION_TOKENS[extension];
    if (match != null) {
      if (isComplete || STANDARD_TIER_TOKENS.has(match)) return match;
    }
  }
  return "default";
}

function hasCustomIconOverrides(icons: FileTreeIcons): boolean {
  return (
    icons.spriteSheet != null ||
    icons.remap != null ||
    icons.byFileName != null ||
    icons.byFileExtension != null ||
    icons.byFileNameContains != null
  );
}

function normalizeFileTreeIcons(icons: FileTreeIcons) {
  return {
    ...icons,
    set: icons.set ?? (hasCustomIconOverrides(icons) ? "none" : "complete"),
    colored: icons.colored ?? true,
  };
}

const normalizeIconRuleKey = (value: string) => value.trim().toLowerCase();
const getBaseFileName = (path: string) => path.split("/").at(-1) ?? path;
const getExtensionCandidates = (fileName: string) => {
  const segments = fileName.toLowerCase().split(".");
  const candidates: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    candidates.push(segments.slice(index).join("."));
  }
  return candidates;
};

function remapEntryToIcon(entry: FileTreeIconEntry, remappedFrom: string): ResolvedFileTreeIcon {
  if (typeof entry === "string") return { name: entry, remappedFrom };
  return { ...entry, remappedFrom };
}

export function createFileTreeIconResolver(icons: FileTreeIcons) {
  const normalizedIcons = normalizeFileTreeIcons(icons);
  const iconRemap = normalizedIcons.remap;
  const iconByFileName = new Map<string, FileTreeIconEntry>();
  for (const [fileName, icon] of Object.entries(normalizedIcons.byFileName ?? {})) {
    iconByFileName.set(fileName.toLowerCase(), icon);
  }
  const iconByFileExtension = new Map<string, FileTreeIconEntry>();
  for (const [extension, icon] of Object.entries(normalizedIcons.byFileExtension ?? {})) {
    iconByFileExtension.set(normalizeIconRuleKey(extension), icon);
  }
  const iconByFileNameContains = Object.entries(normalizedIcons.byFileNameContains ?? {}).map(
    ([needle, icon]) => [needle.toLowerCase(), icon] as const,
  );
  const resolveIcon = (name: string, filePath?: string): ResolvedFileTreeIcon => {
    if (name === "file-tree-icon-file" && filePath != null) {
      const fileName = getBaseFileName(filePath);
      const lowerFileName = fileName.toLowerCase();
      const fileNameEntry = iconByFileName.get(lowerFileName);
      if (fileNameEntry != null) return remapEntryToIcon(fileNameEntry, name);
      for (const [needle, matchEntry] of iconByFileNameContains) {
        if (lowerFileName.includes(needle)) return remapEntryToIcon(matchEntry, name);
      }
      const extensionCandidates = getExtensionCandidates(fileName);
      for (const extension of extensionCandidates) {
        const extensionEntry = iconByFileExtension.get(extension);
        if (extensionEntry != null) return remapEntryToIcon(extensionEntry, name);
      }
      const builtInToken = resolveBuiltInFileIconToken(
        normalizedIcons.set,
        fileName,
        extensionCandidates,
      );
      if (builtInToken != null && normalizedIcons.set !== "none") {
        if (builtInToken === "default") {
          const remappedEntry = iconRemap?.[name];
          if (remappedEntry != null) return remapEntryToIcon(remappedEntry, name);
        }
        return { name: getBuiltInFileIconName(builtInToken), remappedFrom: name, token: builtInToken };
      }
    }
    const remappedEntry = iconRemap?.[name];
    if (remappedEntry == null) return { name };
    return remapEntryToIcon(remappedEntry, name);
  };
  return { resolveIcon };
}

/** Standalone <svg> markup for a built-in symbol (the web app references them from a DOM sprite). */
export function builtInIconSvg(name: string): string | undefined {
  return BUILT_IN_ICON_SVGS[name];
}
