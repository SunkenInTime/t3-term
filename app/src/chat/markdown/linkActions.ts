// What a chat-markdown link can do, from apps/web/src/components/ChatMarkdown.tsx
// (fileLinkChip, the external-link anchor) and chat/MarkdownFileLink.tsx:
// open a file in the preferred editor, in the Files panel or in the
// integrated browser, reveal it in the file manager, open a web link in the
// integrated browser or the system browser, and link a pull request URL to
// the thread. Everything here runs at click time and reads state from the
// registry, so the per-message markdown subscribes to nothing extra.
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { executeAtomQuery, isAtomCommandInterrupted, runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import {
  AuthOrchestrationOperateScope,
  AuthPreviewOperateScope,
  EDITORS,
  type EditorId,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentSession, serverEnvironment, shellEnvironment } from "../../state/environment.ts";
import { preferredEditorPref } from "../../state/git.ts";
import { isPreviewAvailableFor, openPreviewSession, previewEnvironment } from "../../state/preview.ts";
import { rightPanelActions } from "../../state/rightPanel.ts";
import { timelineAssets } from "../../state/timeline.ts";
import { toast } from "../../ui/toast.tsx";
import { readRemoteOpenState } from "../details/WorkspaceRows.tsx";
import { openInEditorMenuLabel } from "../../web/editorLabels.ts";
import { revealInFileExplorerLabelForKind, revealInFileExplorerLabelForOs } from "../../web/components/preview/fileExplorerLabel.ts";
import { markdownFileEditorTarget, resolveMarkdownFileHostPath } from "../../web/markdownFileHostPath.ts";
import type { MarkdownFileLinkMeta } from "../../web/markdown-links.ts";
import { openTerminalLinkInPreview, type OpenPreviewMutation } from "../../web/components/preview/openTerminalLinkInPreview.ts";
import { readEnvironmentScope } from "../../web/state/session.ts";
import { openExternalUrl } from "../timeline/system.ts";

/** web browser/openFileInPreview.ts isBrowserPreviewFile. */
export const isBrowserPreviewFile = (path: string): boolean => /\.(?:html?|pdf)$/i.test(path.split(/[?#]/, 1)[0] ?? "");

function readConfig(environmentId: EnvironmentId) {
  return appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId));
}

/** web canUseMarkdownFileShellActions: the server's machine is this one, so it can launch editors. */
export function canUseShellActions(environmentId: EnvironmentId | null): boolean {
  return environmentId !== null && readRemoteOpenState(environmentId).mode === "local-exec";
}

/** usePreferredEditor: the last editor used when the server still offers it, else the first it offers. */
export function preferredEditorFor(environmentId: EnvironmentId): EditorId | null {
  const available = readConfig(environmentId)?.availableEditors ?? [];
  const preferred = appAtomRegistry.get(preferredEditorPref.atom) as EditorId | "";
  if (preferred && preferred !== "file-manager" && available.includes(preferred)) return preferred;
  return EDITORS.find((editor) => editor.id !== "file-manager" && available.includes(editor.id))?.id ?? null;
}

export function editorMenuLabel(environmentId: EnvironmentId): string {
  return openInEditorMenuLabel(preferredEditorFor(environmentId));
}

/** web markdownServerConfigFields revealInFileManagerLabel. */
export function revealMenuLabel(environmentId: EnvironmentId): string | undefined {
  const config = readConfig(environmentId);
  if (config?.shellRevealInFileManager !== true || !config.availableEditors.includes("file-manager")) return undefined;
  return config.shellRevealInFileManagerKind === undefined
    ? revealInFileExplorerLabelForOs(config.environment.platform.os)
    : revealInFileExplorerLabelForKind(config.shellRevealInFileManagerKind);
}

export function canOpenInIntegratedBrowser(threadRef: ScopedThreadRef | null): threadRef is ScopedThreadRef {
  return (
    threadRef !== null &&
    readEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope) &&
    isPreviewAvailableFor(threadRef.environmentId)
  );
}

function failureToast(title: string, error: unknown) {
  toast({ type: "error", title, description: error instanceof Error ? error.message : "An error occurred." });
}

async function hostPathFor(meta: MarkdownFileLinkMeta, cwd: string | undefined) {
  // web looks a bare basename up in the workspace first; without that search the link's own path stands.
  return resolveMarkdownFileHostPath({ meta, cwd, findWorkspaceMatch: async () => null });
}

export async function openFileInEditor(environmentId: EnvironmentId, meta: MarkdownFileLinkMeta, cwd: string | undefined) {
  const editor = preferredEditorFor(environmentId);
  if (!editor) {
    toast({ type: "error", title: "No editor available", description: meta.targetPath });
    return;
  }
  const target = markdownFileEditorTarget(meta, await hostPathFor(meta, cwd));
  const result = await runAtomCommand(appAtomRegistry, shellEnvironment.openInEditor, { environmentId, input: { cwd: target, editor } });
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) failureToast("Unable to open file", squashAtomCommandFailure(result));
}

export async function revealFileInFileManager(environmentId: EnvironmentId, meta: MarkdownFileLinkMeta, cwd: string | undefined) {
  if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
    failureToast("Unable to reveal file", new Error("This connection cannot reveal files on this environment."));
    return;
  }
  const { absolutePath } = await hostPathFor(meta, cwd);
  const result = await runAtomCommand(appAtomRegistry, shellEnvironment.openInEditor, {
    environmentId,
    input: { cwd: absolutePath, editor: "file-manager", reveal: true },
  });
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) failureToast("Unable to reveal file", squashAtomCommandFailure(result));
}

/** web openUrlInPreview: open the URL in a new integrated-browser tab and show it. */
export async function openUrlInIntegratedBrowser(threadRef: ScopedThreadRef, url: string): Promise<boolean> {
  const result = await openPreviewSession({ threadRef, url });
  if (result._tag === "Failure") {
    if (!isAtomCommandInterrupted(result)) failureToast("Unable to open link in browser", squashAtomCommandFailure(result));
    return false;
  }
  rightPanelActions.openBrowser(scopedThreadKey(threadRef), result.value.tabId);
  return true;
}

/** web openFileInPreview: serve the file through an asset URL and open that in the integrated browser. */
export async function openFileInIntegratedBrowser(threadRef: ScopedThreadRef, filePath: string, cwd: string | undefined) {
  const insideWorkspace = mediaFileReference(filePath, cwd).relativePath !== undefined;
  const asset = await executeAtomQuery(
    appAtomRegistry,
    timelineAssets.createUrl({
      environmentId: threadRef.environmentId,
      input: { resource: { _tag: insideWorkspace ? "workspace-file" : "media-file", threadId: threadRef.threadId, path: filePath } },
    } as never) as never,
    { label: "markdown file preview", reportFailure: false },
  );
  if (asset._tag === "Failure") {
    if (!isAtomCommandInterrupted(asset)) failureToast("Unable to open file in browser", squashAtomCommandFailure(asset));
    return;
  }
  const prepared = appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(threadRef.environmentId));
  const base = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  const url = base ? resolveAssetUrl(base, (asset.value as { relativeUrl: string }).relativeUrl) : null;
  if (!url) {
    failureToast("Unable to open file in browser", new Error("The environment returned an invalid asset URL."));
    return;
  }
  await openUrlInIntegratedBrowser(threadRef, url);
}

/**
 * The web anchor's click: with the link-target preference "app" a web link
 * opens in the thread's integrated browser; Alt+click, or no browser access,
 * opens the system browser.
 */
export function activateExternalLink(href: string, threadRef: ScopedThreadRef | null, alt: boolean) {
  if (!canOpenInIntegratedBrowser(threadRef)) {
    openExternalUrl(href);
    return;
  }
  const openPreview: OpenPreviewMutation = (input) =>
    runAtomCommand(appAtomRegistry, previewEnvironment.open, input as never) as ReturnType<OpenPreviewMutation>;
  void openTerminalLinkInPreview({
    url: href,
    threadRef,
    openPreview,
    fallbackToBrowser: () => openExternalUrl(href),
    forceBrowser: alt,
  }).catch((error: unknown) => failureToast("Unable to open link", error));
}
