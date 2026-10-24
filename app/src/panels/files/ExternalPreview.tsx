// What the Files surface shows for PDFs, video and audio. Web previews them in place: a PDF
// in a sandboxed frame (BrowserDocumentFrame), video and audio in <video>/<audio> players.
// gpuix has no document frame, PDF rasterizer or media decoder to paint them with, so this
// says so and hands the file to the system browser through the same signed asset URL web
// plays them from. The thread's Browser is no help here: the server browser shows a PDF as
// "displayed in the connected client" and leaves it to a desktop client to render.
import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { AssetResource, PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";

import { isPreviewAvailableFor, openPreviewSession } from "../../state/preview.ts";
import { rightPanelActions } from "../../state/rightPanel.ts";
import { openExternalUrl } from "../../terminal/clipboard.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import { FileSurfaceLoading } from "./fileSurfaceChrome.tsx";

export type ExternalPreviewKind = "pdf" | "video" | "audio";

/** web openFileInPreview's asset resource: workspace files by workspace, others as media files. */
export function previewAssetResource(threadRef: ScopedThreadRef, absolutePath: string, workspaceRoot: string): AssetResource {
  const insideWorkspace = mediaFileReference(absolutePath, workspaceRoot).relativePath !== undefined;
  return { _tag: insideWorkspace ? "workspace-file" : "media-file", threadId: threadRef.threadId, path: absolutePath } as AssetResource;
}

/**
 * web openFileInPreview + handleOpenInBrowser: open the file's signed asset URL as a tab
 * of the thread's Browser and show it in the right panel.
 */
export async function openAssetInBrowser(threadRef: ScopedThreadRef, url: string): Promise<void> {
  const fail = (description: string) => toast({ type: "error", title: "Unable to open file in browser", description });
  if (!isPreviewAvailableFor(threadRef.environmentId)) {
    fail("The integrated browser is unavailable in this runtime.");
    return;
  }
  const result = await openPreviewSession({ threadRef, url });
  if (result._tag === "Failure") {
    fail("An error occurred.");
    return;
  }
  rightPanelActions.openBrowser(scopedThreadKey(threadRef), (result.value as PreviewSessionSnapshot).tabId);
}

const COPY: Record<ExternalPreviewKind, { icon: IconName; title: string; detail: string }> = {
  pdf: { icon: "file-text", title: "PDFs can't be shown inside t3-term", detail: "Open it in your system browser to read it." },
  video: { icon: "file-video", title: "Videos can't play inside t3-term", detail: "Open it in your system browser to watch it." },
  audio: { icon: "file-audio", title: "Audio can't play inside t3-term", detail: "Open it in your system browser to listen to it." },
};

export function ExternalPreview(props: {
  readonly kind: ExternalPreviewKind;
  readonly name: string;
  /** The signed asset URL, null while it is minted. */
  readonly url: string | null;
  readonly failed: boolean;
  /** Present when the thread's Browser can open the file (PDFs, like web's canOpenInBrowser). */
  readonly onOpenInBrowser?: (() => void) | undefined;
}) {
  const theme = useTheme();
  if (props.failed) {
    return (
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", paddingLeft: 24, paddingRight: 24 }}>
        <Text size="xs" color={theme.errorForeground} style={{ textAlign: "center" }}>
          Unable to load file preview.
        </Text>
      </div>
    );
  }
  if (props.url === null) return <FileSurfaceLoading />;
  const url = props.url;
  const copy = COPY[props.kind];
  return (
    <div
      testId={`files-external-${props.kind}`}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", gap: 6, paddingLeft: 24, paddingRight: 24 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          marginBottom: 6,
          borderRadius: 12,
          backgroundColor: alpha(theme.foreground, 0.06),
        }}
      >
        <Icon name={copy.icon} size={22} color={theme.mutedForeground} />
      </div>
      <Text size="sm" weight={500} truncate style={{ maxWidth: 384 }}>
        {props.name}
      </Text>
      <Text size="xs" color={theme.mutedForeground} style={{ textAlign: "center", maxWidth: 384, lineHeight: 19.5 }}>
        {`${copy.title}. ${copy.detail}`}
      </Text>
      {/* Stacked: the preview pane beside the file tree can be under 300px wide. */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 8 }}>
        {props.onOpenInBrowser ? (
          <Button testId="files-external-open-browser" size="sm" icon="globe-2" onClick={props.onOpenInBrowser}>
            Open in Browser
          </Button>
        ) : null}
        <Button
          testId="files-external-open-system"
          size="sm"
          variant={props.onOpenInBrowser ? "outline" : "default"}
          icon="external-link"
          onClick={() =>
            void openExternalUrl(url).catch((error: unknown) =>
              toast({ type: "error", title: "Unable to open file", description: error instanceof Error ? error.message : url }),
            )
          }
        >
          Open in system browser
        </Button>
      </div>
    </div>
  );
}

