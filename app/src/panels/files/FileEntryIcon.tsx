// Port of apps/web/src/components/chat/PierreEntryIcon.tsx and the resolver half of
// apps/web/src/pierre-icons.ts (T3_PIERRE_ICONS over @pierre/trees' "complete" set).
// Pierre icons are two layers of currentColor (a faded "bg" and a solid "fg"), which is
// what gpuix's tinted monochrome <svg> draws, so the tint carries the file-type colour.
import { memo } from "react";
import { VIDEO_FILE_EXTENSIONS } from "@t3tools/shared/video";
import { fileIconPathForMimeType } from "@t3tools/shared/filePreview";

import { Icon } from "../../ui/Icon.tsx";
import { useTheme } from "../../ui/theme.ts";
import {
  BUILT_IN_FILE_EXTENSION_TOKENS,
  BUILT_IN_FILE_NAME_TOKENS,
  COMPLETE_EXTENSION_OVERRIDES,
  PIERRE_ICON_INTRINSIC_COLORS,
  PIERRE_ICON_SVGS,
} from "./fileIcons.gen.ts";

const ICON_COLORS: Record<string, readonly [light: string, dark: string]> = {
  astro: ["#a631be", "#d568ea"],
  babel: ["#d5a910", "#ffd452"],
  bash: ["#199f43", "#5ecc71"],
  biome: ["#1a85d4", "#69b1ff"],
  bootstrap: ["#693acf", "#9d6afb"],
  browserslist: ["#d5a910", "#ffd452"],
  bun: ["#594c5b", "#79697b"],
  c: ["#1a85d4", "#69b1ff"],
  claude: ["#d47628", "#ffa359"],
  cpp: ["#1a85d4", "#69b1ff"],
  css: ["#693acf", "#9d6afb"],
  database: ["#a631be", "#d568ea"],
  default: ["#84848a", "#adadb1"],
  docker: ["#1a85d4", "#69b1ff"],
  eslint: ["#693acf", "#9d6afb"],
  git: ["#ff8c5b", "#d5512f"],
  go: ["#1ca1c7", "#68cdf2"],
  graphql: ["#d32a61", "#ff678d"],
  html: ["#d47628", "#ffa359"],
  image: ["#d32a61", "#ff678d"],
  javascript: ["#d5a910", "#ffd452"],
  json: ["#d47628", "#ffa359"],
  markdown: ["#199f43", "#5ecc71"],
  mcp: ["#17a5af", "#64d1db"],
  nextjs: ["#84848a", "#adadb1"],
  npm: ["#d52c36", "#ff6762"],
  oxc: ["#1ca1c7", "#68cdf2"],
  postcss: ["#d52c36", "#ff6762"],
  prettier: ["#17a5af", "#64d1db"],
  python: ["#1a85d4", "#69b1ff"],
  react: ["#1ca1c7", "#68cdf2"],
  ruby: ["#d52c36", "#ff6762"],
  rust: ["#d47628", "#ffa359"],
  sass: ["#d32a61", "#ff678d"],
  stylelint: ["#84848a", "#adadb1"],
  svelte: ["#d52c36", "#ff6762"],
  svg: ["#d47628", "#ffa359"],
  svgo: ["#199f43", "#5ecc71"],
  swift: ["#d47628", "#ffa359"],
  table: ["#17a5af", "#64d1db"],
  tailwind: ["#1ca1c7", "#68cdf2"],
  terraform: ["#693acf", "#9d6afb"],
  text: ["#84848a", "#adadb1"],
  typescript: ["#1a85d4", "#69b1ff"],
  vite: ["#a631be", "#d568ea"],
  vscode: ["#1a85d4", "#69b1ff"],
  vue: ["#199f43", "#5ecc71"],
  wasm: ["#693acf", "#9d6afb"],
  webpack: ["#1a85d4", "#69b1ff"],
  yml: ["#d52c36", "#ff6762"],
  zig: ["#d47628", "#ffa359"],
  zip: ["#d47628", "#ffa359"],
};

// T3_PIERRE_ICONS.byFileName / byFileExtension (apps/web/src/pierre-icons.ts).
const BY_FILE_NAME: Record<string, string> = {
  "package.json": "file-tree-builtin-npm",
  "tsconfig.json": "file-tree-builtin-typescript",
  "agents.md": "t3-file-icon-agents",
  "pnpm-lock.yaml": "t3-file-icon-pnpm",
  "pnpm-workspace.yaml": "t3-file-icon-pnpm",
};

const BY_FILE_EXTENSION: Record<string, string> = {
  ...Object.fromEntries(VIDEO_FILE_EXTENSIONS.map((extension) => [extension, "t3-file-icon-video"])),
  cs: "t3-file-icon-csharp",
  csx: "t3-file-icon-csharp",
  dart: "t3-file-icon-dart",
  diff: "t3-file-icon-diff",
  patch: "t3-file-icon-diff",
  ex: "t3-file-icon-elixir",
  exs: "t3-file-icon-elixir",
  hs: "t3-file-icon-haskell",
  lhs: "t3-file-icon-haskell",
  java: "t3-file-icon-java",
  kt: "t3-file-icon-kotlin",
  kts: "t3-file-icon-kotlin",
  lua: "t3-file-icon-lua",
  php: "t3-file-icon-php",
  ps1: "t3-file-icon-powershell",
  psm1: "t3-file-icon-powershell",
  psd1: "t3-file-icon-powershell",
  r: "t3-file-icon-r",
  scala: "t3-file-icon-scala",
  toml: "t3-file-icon-toml",
  xml: "t3-file-icon-xml",
};

export interface PierreIconResolution {
  readonly name: string;
  readonly token?: string;
}

function extensionCandidates(fileName: string): string[] {
  const segments = fileName.toLowerCase().split(".");
  const candidates: string[] = [];
  for (let index = 1; index < segments.length; index += 1) candidates.push(segments.slice(index).join("."));
  return candidates;
}

/** @pierre/trees createFileTreeIconResolver(T3_PIERRE_ICONS).resolveIcon("file-tree-icon-file", path). */
function resolveFileIcon(pathValue: string): PierreIconResolution {
  const fileName = pathValue.slice(pathValue.lastIndexOf("/") + 1);
  const lower = fileName.toLowerCase();
  const byName = BY_FILE_NAME[lower];
  if (byName) return { name: byName };
  const candidates = extensionCandidates(fileName);
  for (const extension of candidates) {
    const byExtension = BY_FILE_EXTENSION[extension];
    if (byExtension) return { name: byExtension };
  }
  const nameToken = BUILT_IN_FILE_NAME_TOKENS[lower];
  if (nameToken) return { name: `file-tree-builtin-${nameToken}`, token: nameToken };
  for (const extension of candidates) {
    const token = COMPLETE_EXTENSION_OVERRIDES[extension] ?? BUILT_IN_FILE_EXTENSION_TOKENS[extension];
    if (token) return { name: `file-tree-builtin-${token}`, token };
  }
  return { name: "file-tree-builtin-default", token: "default" };
}

export function resolvePierreIconForEntry(
  pathValue: string,
  kind: "file" | "directory",
  mimeType?: string,
): PierreIconResolution | null {
  if (kind === "directory") return null;
  const icon = resolveFileIcon(pathValue);
  return icon.token === "default" && mimeType
    ? resolveFileIcon(fileIconPathForMimeType(pathValue, mimeType))
    : icon;
}

export const FileEntryIcon = memo(function FileEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  mimeType?: string;
  size?: number;
}) {
  const theme = useTheme();
  const icon = resolvePierreIconForEntry(props.pathValue, props.kind, props.mimeType);
  const size = props.size ?? 16;
  const source = icon ? PIERRE_ICON_SVGS[icon.name] : undefined;
  if (!icon || !source) {
    return (
      <Icon name={props.kind === "directory" ? "folder" : "file"} size={size} color={theme.mutedForeground} />
    );
  }
  const colors =
    PIERRE_ICON_INTRINSIC_COLORS[icon.name] ?? ICON_COLORS[icon.token ?? "default"] ?? ICON_COLORS.default!;
  return (
    <svg
      source={source}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        color: colors[theme.appearance === "light" ? 0 : 1],
        pointerEvents: "none",
      }}
    />
  );
});
