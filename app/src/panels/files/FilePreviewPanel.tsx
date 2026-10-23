// Port of apps/web/src/components/files/FilePreviewPanel.tsx (read-only).
//
// Not ported, by design or by platform:
// - Editing, saving and line comments (the web preview is a @pierre/diffs editor).
// - Rendered HTML/PDF (sandboxed iframes), video and audio players: there is no
//   browser surface here. HTML shows its source; the others show a notice.
// - Chat attachments.
import { useAtom, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import {
  isWorkspaceAudioPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspaceVideoPreviewPath,
} from "@t3tools/shared/filePreview";
import { isHostPath } from "@t3tools/shared/path";
import { useState } from "react";

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
import { useProjectFileQuery } from "../../web/components/files/projectFilesQueryState.ts";
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

function markdownTheme(theme: Palette) {
  return {
    appearance: theme.appearance,
    text: alpha(theme.foreground, 0.8),
    bg: theme.background,
    accent: theme.infoForeground,
    fontSans: FONTS.sans,
    fontMono: FONTS.mono,
    metrics: { mdTextSize: 14, mdLineHeight: 23, mdBlockGap: 10, mdHeadingSizes: [20, 18, 16, 14] },
  };
}

function RenderedMarkdown(props: { readonly text: string }) {
  const theme = useTheme();
  return (
    <div
      testId="files-markdown"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}
    >
      <div style={{ width: "100%", maxWidth: 896, paddingLeft: 24, paddingRight: 24, paddingTop: 20, paddingBottom: 20, flexShrink: 0 }}>
        <markdown source={props.text} theme={markdownTheme(theme)} />
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
  const [panelWidth, setPanelWidth] = useState(540);

  const navigateToFolder = (crumbPath: string) => {
    const path =
      breadcrumbTrail !== null && breadcrumbPathOf(breadcrumbTrail) === crumbPath ? breadcrumbTrail : crumbPath;
    onNavigateFolder(path, retainedBreadcrumbTrail(breadcrumbTrail ?? undefined, path), !isFolder);
  };
  const absolutePath =
    breadcrumbPath === "" ? cwd : relativePath ? resolvePathLinkTarget(relativePath, cwd) : null;
  useWorkspaceMutationRefresh({
    enabled: relativePath !== null && (isFolder || (!isMedia && !isPdf)),
    mutationId: workspaceMutationId,
    refresh: file.refresh,
    resourceKey: `file:${environmentId}:${cwd}:${relativePath ?? ""}`,
  });

  // web `showsRawText`: the wrap toggle exists while source text is on screen.
  const showsRawText =
    previewPath !== null && !isMedia && !isPdf && !(isMarkdown && renderMarkdown) && !(file.error && file.data === null);

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
    if (isMarkdown && renderMarkdown) return <RenderedMarkdown key={relativePath} text={file.data.contents} />;
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
          {previewPath !== null && isMarkdown ? (
            <FileSurfaceAction
              testId="files-toggle-rendered"
              label={renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
              icon={renderMarkdown ? "code" : "eye"}
              pressed={renderMarkdown}
              onPress={() => {
                const pressed = !renderMarkdown;
                setRenderMarkdownPreferred(pressed);
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
              {...(previewPath && !isMedia && !isPdf ? { onRefreshSelectedFile: file.refresh } : {})}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
