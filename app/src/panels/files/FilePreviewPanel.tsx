// Port of apps/web/src/components/files/FilePreviewPanel.tsx.
//
// Workspace files open in FileEditor (editable, autosaved, line comments to the
// composer) when the connection may write them, else in the read-only SourceView.
// Not ported, by platform: rendered HTML/PDF (sandboxed iframes) and video and audio
// players; there is no browser surface here. HTML shows its source; the others show a notice.
import { useAtom, useAtomValue } from "@effect/atom-react";
import { AuthFilesystemWriteScope, type EnvironmentId, type ScopedThreadRef, type ThreadId } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { filePreviewDelimiter } from "@t3tools/shared/delimitedPreview";
import {
  isWorkspaceAudioPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspaceVideoPreviewPath,
} from "@t3tools/shared/filePreview";
import { isHostPath } from "@t3tools/shared/path";
import { useCallback, useMemo, useState } from "react";

import { wordWrapPref } from "../../state/codeView.ts";
import { persistedAtom } from "../../state/persistedAtom.ts";
import { SourceView } from "../code/SourceView.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import { breadcrumbPathOf, retainedBreadcrumbTrail, trailChildOf } from "../../web/components/files/filePath.ts";
import {
  filePreviewReadErrorMessage,
  isMarkdownPreviewFile,
  resolveFilePreviewPath,
  shouldShowFileExplorer,
  workspaceAssetResource,
} from "../../web/components/files/filePreviewMode.ts";
import {
  setProjectFileQueryData,
  useFilesystemReadAccess,
  useProjectFileQuery,
} from "../../web/components/files/projectFilesQueryState.ts";
import { useEnvironmentScope } from "../../web/state/session.ts";
import { composerTargetKey } from "../../state/composer.ts";
import { fileSavePendingAtom, fileSavePendingKey, setFileSavePending } from "../../state/files.ts";
import { threadKeyOf } from "../../state/rightPanel.ts";
import { ChatMarkdown } from "../../chat/timeline/ChatMarkdown.tsx";
import { TimelineRowCtx, type TimelineRowSharedState } from "../../chat/timeline/rowContext.ts";
import { FileEditor } from "./FileEditor.tsx";
import { DelimitedTablePreview } from "./DelimitedTablePreview.tsx";
import { useFileSaveCoordinator } from "./useFileSaveCoordinator.ts";
import { useAssetUrlState } from "./fileAssets.ts";
import FileBrowserPanel from "./FileBrowserPanel.tsx";
import { OpenInEditorButton } from "./OpenInEditorButton.tsx";
import { FileBreadcrumbs } from "./FileBreadcrumbs.tsx";
import {
  FileSurfaceAction,
  FileSurfaceFailure,
  FileSurfaceLoading,
  FileSurfaceNotice,
  FileSurfaceSubheader,
} from "./fileSurfaceChrome.tsx";
import { useWorkspaceMutationRefresh } from "./workspaceMutation.ts";

function decodeBoolean(fallback: boolean) {
  return (raw: unknown) => (typeof raw === "boolean" ? raw : fallback);
}

/** web: localStorage `t3code.fileExplorerOpen`, default open. */
const fileExplorerOpenAtom = persistedAtom("file-explorer-open", true, decodeBoolean(true));
/** web: localStorage `t3code.renderMarkdown`, default source. */
const renderMarkdownAtom = persistedAtom("file-render-markdown", false, decodeBoolean(false));
/** web: localStorage `t3code.renderTable`, default table. */
const renderTableAtom = persistedAtom("file-render-table", true, decodeBoolean(true));

const noop = () => {};

/**
 * What ChatMarkdown reads from its timeline row: the thread its file links open in and
 * the folder they resolve against. A file preview has no row, so the rest is inert.
 */
function filePreviewRowContext(threadRef: ScopedThreadRef, cwd: string): TimelineRowSharedState {
  return {
    timestampFormat: "locale",
    routeThreadKey: threadKeyOf(threadRef.environmentId, threadRef.threadId),
    threadRef,
    markdownCwd: cwd,
    skills: [],
    workflowOpening: null,
    workspaceRoot: cwd,
    runs: [],
    activeThreadEnvironmentId: threadRef.environmentId,
    onRevertToTurnCount: noop,
    onOpenTurnDiff: noop,
    onOpenThread: noop,
    onForkFromRun: async () => {},
    onRollbackCheckpoint: noop,
    onToggleTurnFold: noop,
    onToggleAttemptFold: noop,
    onToggleWorkGroup: noop,
    onCancelWorktreeSetup: null,
    retryableWorkspacePreparationRunIds: new Set(),
    onRetryWorkspacePreparation: null,
    onOpenWorktreeSetupTerminal: null,
    workGroupViewState: { expandedEntries: new Set() },
    changedFilesExpandedRunIds: new Set(),
    onToggleChangedFilesExpanded: noop,
  } as unknown as TimelineRowSharedState;
}

/**
 * web FileMarkdownPreview: the chat's markdown renderer (ChatMarkdown) at max-w-4xl
 * px-6 py-5, so file links open in Files, web links in the browser, and code, tables,
 * math and Mermaid render as in chat. Not ported: toggling task-list checkboxes (the
 * shared markdown renderer has no checkbox press yet) and resolving images against the
 * file's own folder (they resolve against the workspace, like its links).
 */
function RenderedMarkdown(props: { readonly text: string; readonly threadRef: ScopedThreadRef; readonly cwd: string }) {
  const row = useMemo(() => filePreviewRowContext(props.threadRef, props.cwd), [props.threadRef.environmentId, props.threadRef.threadId, props.cwd]);
  return (
    <div
      testId="files-markdown"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}
    >
      <div style={{ width: "100%", maxWidth: 896, paddingLeft: 24, paddingRight: 24, paddingTop: 20, paddingBottom: 20, flexShrink: 0 }}>
        <TimelineRowCtx.Provider value={row}>
          <ChatMarkdown text={props.text} />
        </TimelineRowCtx.Provider>
      </div>
    </div>
  );
}

function WorkspaceImagePreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly alt: string;
  readonly workspaceMutationId: string | null;
}) {
  const theme = useTheme();
  const resource = workspaceAssetResource({
    kind: "workspace-file",
    threadRef: props.threadRef,
    draft: false,
    workspaceRoot: props.workspaceRoot,
    absolutePath: props.absolutePath,
  });
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const revisionSuffix =
    props.workspaceMutationId === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.workspaceMutationId)}`;
  const imageUrl = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;
  if (assetUrl._tag === "Failure") {
    return (
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", paddingLeft: 24, paddingRight: 24 }}>
        <Text size="xs" color={theme.errorForeground}>
          Unable to load workspace image.
        </Text>
      </div>
    );
  }
  if (imageUrl === null) return <FileSurfaceLoading />;
  return (
    <div style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", padding: 16 }}>
      <img
        testId="files-image"
        src={imageUrl}
        alt={props.alt}
        objectFit="contain"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

function UnsupportedPreview(props: { readonly kind: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", paddingLeft: 24, paddingRight: 24 }}>
      <Text size="xs" color={theme.mutedForeground} style={{ textAlign: "center", lineHeight: 19.5 }}>
        {`${props.kind} previews are not available in t3-term yet.`}
      </Text>
    </div>
  );
}

/** web EditableFileSurface: the editor plus its autosave session. */
function EditableFileSurface(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly contents: string;
  readonly wrap: boolean;
  readonly revealLine: number | null;
  readonly revealKey: string;
}) {
  const threadKey = threadKeyOf(props.environmentId, props.threadId);
  const onPendingChange = useCallback(
    (relativePath: string, pending: boolean) => setFileSavePending(threadKey, relativePath, pending),
    [threadKey],
  );
  const saveCoordinator = useFileSaveCoordinator({
    environmentId: props.environmentId,
    cwd: props.cwd,
    relativePath: props.relativePath,
    onPendingChange,
  });
  return (
    <FileEditor
      testId="files-editor"
      path={props.relativePath}
      text={props.contents}
      wrap={props.wrap}
      revealLine={props.revealLine}
      revealKey={props.revealKey}
      draftKey={composerTargetKey({ kind: "thread", environmentId: props.environmentId, threadId: props.threadId })}
      onEdit={(contents) => {
        setProjectFileQueryData(props.environmentId, props.cwd, props.relativePath, contents);
        saveCoordinator.change(contents);
      }}
    />
  );
}

function ReadFailure(props: {
  readonly message: string;
  readonly attemptedPath: string | undefined;
  readonly workspaceFolder: string | null;
}) {
  const theme = useTheme();
  const mono = (value: string, color: string) => (
    <text style={{ color, fontSize: 12, lineHeight: 19.5, fontFamily: FONTS.mono, textAlign: "center" }}>{value}</text>
  );
  return (
    <div
      role="alert"
      testId="files-read-error"
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", justifyContent: "center" }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 24, flexShrink: 0 }}>
        <Text size="xs" color={theme.errorForeground} style={{ textAlign: "center", lineHeight: 19.5 }}>
          {props.message}
        </Text>
        {props.attemptedPath ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 19.5 }}>
              Attempted path
            </Text>
            {mono(props.attemptedPath, theme.foreground)}
          </div>
        ) : null}
        {props.workspaceFolder !== null ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 19.5 }}>
              Workspace folder:
            </Text>
            {mono(props.workspaceFolder, theme.mutedForeground)}
            <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 19.5, textAlign: "center" }}>
              Check the link's path or locate the file in Files.
            </Text>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface FilePreviewPanelProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  cwd: string;
  projectName: string;
  relativePath: string | null;
  revealLine: number | null;
  revealRequestId: number;
  onOpenFile: (relativePath: string) => void;
  /** Moves this folder browser to another folder in place; see `navigateFolder`. */
  onNavigateFolder: (relativePath: string, folderTrail: string, keepSource: boolean) => void;
  /** The deeper path breadcrumbs keep after the browser moved up; see `navigateFolder`. */
  folderTrail: string | undefined;
  workspaceMutationId: string | null;
}

export default function FilePreviewPanel({
  environmentId,
  threadId,
  cwd,
  projectName,
  relativePath: requestedPath,
  revealLine,
  revealRequestId,
  onOpenFile,
  onNavigateFolder,
  folderTrail,
  workspaceMutationId,
}: FilePreviewPanelProps) {
  const theme = useTheme();
  const threadRef = { environmentId, threadId } as ScopedThreadRef;
  const relativePath = resolveFilePreviewPath(requestedPath, cwd);
  const isVideo = relativePath !== null && isWorkspaceVideoPreviewPath(relativePath);
  const isAudio = relativePath !== null && !isVideo && isWorkspaceAudioPreviewPath(relativePath);
  const isImage = relativePath !== null && !isVideo && isWorkspaceImagePreviewPath(relativePath);
  const isMedia = isImage || isVideo || isAudio;
  const isPdf = relativePath !== null && /\.pdf$/i.test(relativePath);
  const isHostFile = relativePath !== null && isHostPath(relativePath);
  const file = useProjectFileQuery(environmentId, cwd, relativePath, relativePath !== null);
  const fileAccess = useFilesystemReadAccess(environmentId);
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const savePending = useAtomValue(fileSavePendingAtom);
  const selectedFilePending =
    relativePath !== null && savePending.has(fileSavePendingKey(threadKeyOf(environmentId, threadId), relativePath));
  const attemptedPath = file.readError?.resolvedPath ?? file.readError?.operationPath;
  // A chat link cannot tell a folder from a file, so a folder arrives here as
  // a file surface and the read fails. Keep the breadcrumbs, drop the preview
  // pane, and let the tree fill the surface with the folder revealed. A host
  // folder outside the workspace gets a tree of its own, rooted at that folder.
  // `folderTrail` is set only when crumbs walked the browser up: the deeper path
  // kept for the way back down. The explorer (`""`) shows crumbs only then.
  const breadcrumbPath = relativePath ?? (folderTrail === undefined ? null : "");
  const breadcrumbTrail = breadcrumbPath === null ? null : retainedBreadcrumbTrail(folderTrail, breadcrumbPath);
  // The trail only continues below folders, so a surface with one is a folder
  // before its read settles, and walking up never flashes a file preview.
  const isFolder = file.isNotFile || (folderTrail !== undefined && file.data === null && file.error === null);
  const hostFolderPath = isFolder && isHostFile ? relativePath : null;
  // Everything preview-related keys off previewPath; a folder has no preview.
  const previewPath = isFolder ? null : relativePath;
  const [explorerOpen, setExplorerOpen] = useAtom(fileExplorerOpenAtom);
  const [renderMarkdownPreferred, setRenderMarkdownPreferred] = useAtom(renderMarkdownAtom);
  const wordWrap = useAtomValue(wordWrapPref.atom);
  const showExplorer = shouldShowFileExplorer({ relativePath: previewPath, explorerOpen, attachmentOpen: false });
  // Paired with the path on purpose: each file surface counts its reveals from
  // one, so a bare id would let a dismissed reveal on one file swallow the first
  // reveal on the next.
  const [handledReveal, setHandledReveal] = useState<{ path: string; requestId: number } | null>(null);
  const isMarkdown = previewPath ? isMarkdownPreviewFile(previewPath) : false;
  const revealHandled =
    revealLine === null || (handledReveal?.path === relativePath && handledReveal.requestId === revealRequestId);
  const renderMarkdown = isMarkdown && renderMarkdownPreferred && revealHandled;
  const [renderTablePreferred, setRenderTablePreferred] = useAtom(renderTableAtom);
  const tableDelimiter = previewPath ? filePreviewDelimiter({ name: previewPath }) : null;
  const renderTable = tableDelimiter !== null && renderTablePreferred && revealHandled;
  const renderedMode = isMarkdown ? ("markdown" as const) : tableDelimiter ? ("table" as const) : null;
  const rendered = isMarkdown ? renderMarkdown : renderTable;
  const [panelWidth, setPanelWidth] = useState(540);

  const navigateToFolder = (crumbPath: string) => {
    const path =
      breadcrumbTrail !== null && breadcrumbPathOf(breadcrumbTrail) === crumbPath ? breadcrumbTrail : crumbPath;
    onNavigateFolder(path, retainedBreadcrumbTrail(breadcrumbTrail ?? undefined, path), !isFolder);
  };
  const absolutePath =
    breadcrumbPath === "" ? cwd : relativePath ? resolvePathLinkTarget(relativePath, cwd) : null;
  useWorkspaceMutationRefresh({
    // An unsaved edit must not be replaced by a re-read of the old contents.
    enabled: relativePath !== null && (isFolder || (!isMedia && !isPdf)) && !selectedFilePending,
    mutationId: workspaceMutationId,
    refresh: file.refresh,
    resourceKey: `file:${environmentId}:${cwd}:${relativePath ?? ""}`,
  });

  // web `showsRawText`: the wrap toggle exists while source text is on screen.
  const showsRawText =
    previewPath !== null &&
    !isMedia &&
    !isPdf &&
    !(isMarkdown && renderMarkdown) &&
    !(tableDelimiter && renderTable) &&
    !(file.error && file.data === null);

  const content = (() => {
    if (isFolder || !relativePath) return null;
    if (isVideo) return <UnsupportedPreview kind="Video" />;
    if (isAudio) return <UnsupportedPreview kind="Audio" />;
    if (isPdf) return <UnsupportedPreview kind="PDF" />;
    if (isImage && absolutePath) {
      return (
        <WorkspaceImagePreview
          key={absolutePath}
          environmentId={environmentId}
          threadRef={threadRef}
          absolutePath={absolutePath}
          workspaceRoot={cwd}
          alt={relativePath}
          workspaceMutationId={workspaceMutationId}
        />
      );
    }
    if (file.error && file.data === null) {
      return (
        <ReadFailure
          message={file.readError ? filePreviewReadErrorMessage(file.readError) : file.error}
          attemptedPath={attemptedPath}
          workspaceFolder={isHostFile ? null : (file.readError?.cwd ?? cwd)}
        />
      );
    }
    if (file.data === null) return <FileSurfaceLoading />;
    if (isMarkdown && renderMarkdown) return <RenderedMarkdown key={relativePath} text={file.data.contents} threadRef={threadRef} cwd={cwd} />;
    if (tableDelimiter && renderTable) {
      return <DelimitedTablePreview key={relativePath} name={relativePath} text={file.data.contents} delimiter={tableDelimiter} />;
    }
    if (!file.data.truncated && !isHostFile && canWriteFiles) {
      return (
        <EditableFileSurface
          key={`${relativePath}:${theme.appearance}`}
          environmentId={environmentId}
          threadId={threadId}
          cwd={cwd}
          relativePath={relativePath}
          contents={file.data.contents}
          wrap={wordWrap}
          revealLine={revealLine}
          revealKey={`${relativePath}:${revealRequestId}:${revealLine ?? ""}`}
        />
      );
    }
    return (
      <SourceView
        key={relativePath}
        testId="files-source"
        path={relativePath}
        text={file.data.contents}
        wrap={wordWrap}
        revealLine={revealLine}
        // Paired with the path: each file surface counts its reveals from one.
        revealKey={`${relativePath}:${revealRequestId}:${revealLine ?? ""}`}
      />
    );
  })();

  const explorerWidth = Math.max(256, Math.min(352, panelWidth * 0.46));

  return (
    <div
      onLayout={(event) => {
        const width = Number(event.width ?? 0);
        if (width > 0 && width !== panelWidth) setPanelWidth(width);
      }}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, overflow: "hidden", backgroundColor: theme.background }}
    >
      {breadcrumbPath !== null && breadcrumbTrail !== null ? (
        <FileSurfaceSubheader>
          <div
            testId="files-breadcrumbs"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              flexGrow: 1,
              minWidth: 0,
              height: "100%",
              overflowX: "scroll",
              scrollbarWidth: 0,
            }}
          >
            <div style={{ display: "flex", flexShrink: 0, height: "100%" }}>
              <FileBreadcrumbs
                cwd={cwd}
                environmentId={environmentId}
                onNavigateFolder={navigateToFolder}
                onOpenFile={onOpenFile}
                projectName={projectName}
                relativePath={breadcrumbPath}
                trail={breadcrumbTrail}
                workspaceMutationId={workspaceMutationId}
              />
            </div>
          </div>
          {absolutePath && !isFolder ? <OpenInEditorButton environmentId={environmentId} absolutePath={absolutePath} /> : null}
          {previewPath !== null && renderedMode !== null ? (
            <FileSurfaceAction
              testId="files-toggle-rendered"
              label={
                renderedMode === "markdown"
                  ? rendered
                    ? "Show markdown source"
                    : "Show rendered markdown"
                  : rendered
                    ? "Show source"
                    : "Show table"
              }
              icon={rendered ? "code" : renderedMode === "table" ? "table-2" : "eye"}
              pressed={rendered}
              onPress={() => {
                const pressed = !rendered;
                if (renderedMode === "markdown") setRenderMarkdownPreferred(pressed);
                else setRenderTablePreferred(pressed);
                setHandledReveal(pressed && relativePath !== null ? { path: relativePath, requestId: revealRequestId } : null);
              }}
            />
          ) : null}
          {showsRawText ? (
            <FileSurfaceAction
              testId="files-toggle-wrap"
              label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
              icon="wrap-text"
              pressed={wordWrap}
              onPress={() => wordWrapPref.set(!wordWrap)}
            />
          ) : null}
          {!isHostFile && previewPath !== null ? (
            <FileSurfaceAction
              testId="files-toggle-explorer"
              label={explorerOpen ? "Hide file explorer" : "Show file explorer"}
              icon="folder-tree"
              pressed={explorerOpen}
              onPress={() => setExplorerOpen(!explorerOpen)}
            />
          ) : null}
        </FileSurfaceSubheader>
      ) : null}
      {relativePath && !isHostFile && !canWriteFiles && !fileAccess.isPending ? (
        <FileSurfaceNotice tone="muted">Read-only connection. Unsaved edits are kept until write access returns.</FileSurfaceNotice>
      ) : null}
      {previewPath && !isMedia && file.data?.truncated ? (
        <FileSurfaceNotice>
          {`Preview limited to the first 1 MB of a ${file.data.byteLength.toLocaleString()} byte file.`}
        </FileSurfaceNotice>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
        {previewPath ? (
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            {content}
          </div>
        ) : null}
        {showExplorer ? (
          <div
            testId="files-explorer"
            style={
              previewPath
                ? {
                    display: "flex",
                    flexShrink: 0,
                    minHeight: 0,
                    width: explorerWidth,
                    borderLeftWidth: 1,
                    borderColor: alpha(theme.border, 0.6),
                    backgroundColor: theme.background,
                  }
                : { display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: theme.background }
            }
          >
            <FileBrowserPanel
              key={`${environmentId}:${hostFolderPath ?? cwd}`}
              environmentId={environmentId}
              cwd={hostFolderPath ?? cwd}
              projectName={hostFolderPath ?? projectName}
              hostFolder={hostFolderPath !== null}
              selectedPath={
                hostFolderPath === null ? relativePath : trailChildOf(hostFolderPath, breadcrumbTrail ?? hostFolderPath)
              }
              selectedPathRevealId={revealRequestId}
              onOpenFile={onOpenFile}
              workspaceMutationId={workspaceMutationId}
              composerDraftKey={composerTargetKey({ kind: "thread", environmentId, threadId })}
              {...(previewPath && !isMedia && !isPdf ? { onRefreshSelectedFile: file.refresh } : {})}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
