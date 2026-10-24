// What a Files tree row offers besides opening: web FileBrowserPanel's right-click menu
// (apps/web/src/fileContextMenu.ts items, then "Copy mention" and "Add to chat") and
// dragging rows into the composer as mentions (fileTreeDragMention.ts +
// composerMentionDrag.ts). gpuix has no HTML drag and drop, so a drag is the row's own
// pointer capture, and the composer reports where it is (composerDropZonesAtom).
import {
  EDITORS,
  type ContextMenuItem,
  type EditorId,
  type EnvironmentId,
  type ServerConfig,
} from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { focusComposer, readComposerDraft, setComposerPrompt } from "../../state/composer.ts";
import { shellEnvironment } from "../../state/environment.ts";
import { toast } from "../../ui/toast.tsx";
import { copyTextToClipboard } from "../../chat/header/osActions.ts";

export type FileTreeMenuAction = "open" | "reveal-in-folder" | "open-with" | `editor:${EditorId}` | "copy-mention" | "add-to-chat";

const EDITOR_LABEL_BY_ID = new Map(EDITORS.map((editor) => [editor.id, editor.label]));

/** web fileExplorerLabel.ts */
function revealLabel(config: ServerConfig): string {
  const kind = (config as { shellRevealInFileManagerKind?: string }).shellRevealInFileManagerKind;
  if (kind === "finder") return "Reveal in Finder";
  if (kind === "file-explorer") return "Reveal in File Explorer";
  if (kind !== undefined) return "Reveal in Files";
  const os = config.environment.platform.os;
  if (os === "darwin") return "Reveal in Finder";
  if (os === "windows") return "Reveal in File Explorer";
  return "Reveal in Files";
}

/** web buildFileContextMenuItems (fileContextMenu.ts): Open, Reveal, Open with. The diff's filename menu. */
export function fileContextMenuItems(config: ServerConfig | null | undefined): ContextMenuItem<FileTreeMenuAction>[] {
  const items: ContextMenuItem<FileTreeMenuAction>[] = [];
  const editors = config?.availableEditors ?? [];
  if (editors.includes("file-manager")) items.push({ id: "open", label: "Open", icon: "pencil" });
  if (config && (config as { shellRevealInFileManager?: boolean }).shellRevealInFileManager === true && editors.includes("file-manager")) {
    items.push({ id: "reveal-in-folder", label: revealLabel(config), icon: "folder-tree" });
  }
  const editorIds = editors.filter((id) => id !== "file-manager");
  if (editorIds.length > 0) {
    items.push({
      id: "open-with",
      label: "Open with",
      children: editorIds.map((editorId) => ({
        id: `editor:${editorId}` as FileTreeMenuAction,
        label: EDITOR_LABEL_BY_ID.get(editorId) ?? editorId,
      })),
    });
  }
  return items;
}

/** web buildFileContextMenuItems + FileBrowserPanel's two chat rows. */
export function fileTreeMenuItems(config: ServerConfig | null | undefined): ContextMenuItem<FileTreeMenuAction>[] {
  return [...fileContextMenuItems(config), { id: "copy-mention", label: "Copy mention" }, { id: "add-to-chat", label: "Add to chat" }];
}

/** Appends text to a composer draft the way web insertTextAtEnd does (ensureLeadingBoundary). */
export function insertMentionAtEnd(draftKey: string, text: string): void {
  const prompt = readComposerDraft(draftKey).prompt;
  const separator = prompt.length > 0 && !/\s$/.test(prompt) ? " " : "";
  setComposerPrompt(draftKey, `${prompt}${separator}${text}`);
  focusComposer();
}

export async function runFileTreeMenuAction(input: {
  readonly action: FileTreeMenuAction;
  readonly environmentId: EnvironmentId;
  /** Workspace root, or the host folder the tree is rooted at. */
  readonly cwd: string;
  /** The row's path as the panel opens it (relative, or absolute for host folders). */
  readonly path: string;
  readonly draftKey: string | null;
}): Promise<void> {
  const { action, path } = input;
  const mention = serializeComposerFileLink(path);
  if (action === "copy-mention") {
    try {
      await copyTextToClipboard(mention);
      toast({ type: "success", title: "Mention copied", description: path });
    } catch (error) {
      toast({ type: "error", title: "Failed to copy mention", description: error instanceof Error ? error.message : "An error occurred." });
    }
    return;
  }
  if (action === "add-to-chat") {
    if (input.draftKey === null) {
      toast({ type: "error", title: "Unable to add to chat", description: "Open a chat for this project and try again." });
      return;
    }
    insertMentionAtEnd(input.draftKey, `${mention} `);
    return;
  }
  if (action === "open-with") return;
  const absolutePath = resolvePathLinkTarget(path, input.cwd);
  const reveal = action === "reveal-in-folder";
  const editor = action === "open" || reveal ? ("file-manager" as const) : (action.slice("editor:".length) as EditorId);
  const result = await runAtomCommand(
    appAtomRegistry,
    shellEnvironment.openInEditor,
    { environmentId: input.environmentId, input: { cwd: absolutePath, editor, ...(reveal ? { reveal: true } : {}) } } as never,
    { reportFailure: false },
  );
  if (result._tag !== "Failure") return;
  toast({
    type: "error",
    title: action === "open" ? "Could not open file" : reveal ? "Unable to reveal file" : `Could not open in ${EDITOR_LABEL_BY_ID.get(editor) ?? editor}`,
    description: absolutePath,
  });
}

// ── Drag a row into the composer ──

export interface ComposerDropZone {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where each mounted composer surface is, by composer draft key (set by the composer). */
export const composerDropZonesAtom = Atom.make<Readonly<Record<string, ComposerDropZone>>>({}).pipe(Atom.keepAlive);

/** The composer a tree drag is over, so it can show web's drag-over ring. */
export const mentionDragOverAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);

export function reportComposerDropZone(draftKey: string, zone: ComposerDropZone | null): void {
  const zones = appAtomRegistry.get(composerDropZonesAtom);
  if (zone === null) {
    if (!(draftKey in zones)) return;
    const { [draftKey]: _removed, ...rest } = zones;
    appAtomRegistry.set(composerDropZonesAtom, rest);
    return;
  }
  const current = zones[draftKey];
  if (current && current.x === zone.x && current.y === zone.y && current.width === zone.width && current.height === zone.height) return;
  appAtomRegistry.set(composerDropZonesAtom, { ...zones, [draftKey]: zone });
}

/** The composer under a window point, if any. */
export function composerAtPoint(x: number, y: number): string | null {
  for (const [draftKey, zone] of Object.entries(appAtomRegistry.get(composerDropZonesAtom))) {
    if (x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height) return draftKey;
  }
  return null;
}

/** web composerMentionFromTreePath. */
export function composerMentionFromTreePath(treePath: string): string | null {
  const relativePath = treePath.replace(/\/+$/, "");
  return relativePath.length === 0 ? null : serializeComposerFileLink(relativePath);
}
