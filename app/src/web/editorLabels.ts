// Ported from apps/web/src/editorLabels.ts. getLocalFileManagerName (web
// lib/utils.ts) is inlined; it reads a platform string the same way.
import { EDITORS, type EditorId } from "@t3tools/contracts";

const editorLabels = new Map<EditorId, string>(EDITORS.map((editor) => [editor.id, editor.label]));

function getLocalFileManagerName(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac") || normalized === "darwin") return "Finder";
  if (normalized.includes("win")) return "File Explorer";
  return "Files";
}

export function editorLabelForPlatform(editorId: EditorId, platform: string): string {
  if (editorId === "file-manager") {
    return getLocalFileManagerName(platform);
  }

  return editorLabels.get(editorId) ?? "Editor";
}

export function openInEditorMenuLabel(editorId: EditorId | null): string {
  return editorId === null || editorId === "file-manager"
    ? "Open in editor"
    : `Open in ${editorLabels.get(editorId) ?? "Editor"}`;
}
