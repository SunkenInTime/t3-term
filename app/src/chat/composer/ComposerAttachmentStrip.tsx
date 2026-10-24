// apps/web/src/components/chat/ComposerAttachmentStrip.tsx: image thumbnails (64×64,
// radius 10, remove button top-right, a press opens the image viewer), the file list (icon,
// name, size, remove) and the paperclip attach button. Each staged item shows its upload
// (attachmentUploads.ts): a percentage while it goes up, Retry with the reason if it failed.
import { useAtomValue } from "@effect/atom-react";

import { Icon } from "../../ui/Icon.tsx";
import { attachmentUploadStateAtom } from "./attachmentUploads.ts";
import { useSmallViewport } from "../../ui/viewport.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { IconButton, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";

/** A thumbnail in the media row: a staged local file, or a queued message's stored image. */
export interface ComposerMediaItem {
  readonly id: string;
  readonly name: string;
  /** Local path or URL; null while a stored image's URL resolves. */
  readonly src: string | null;
  readonly onRemove: () => void;
  /** Opens the image viewer at this image (web ExpandedImageDialog). */
  readonly onExpand?: () => void;
  /** A staged item's upload, by its id; a queued message's stored image has none. */
  readonly uploadId?: string;
  readonly onRetry?: () => void;
}

export interface ComposerFileItem {
  readonly id: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly onRemove: () => void;
  readonly uploadId?: string;
  readonly onRetry?: () => void;
  /** web composerFileNeedsReattach: its bytes are gone and nothing was uploaded. */
  readonly needsReattach?: boolean;
}

/** web formatAttachmentUploadProgress. */
function formatUploadProgress(progress: number): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return `${Math.floor(bounded * 100)}%`;
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace(/\.0$/, "")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

export function ComposerAttachmentMediaRow({ images }: { images: ReadonlyArray<ComposerMediaItem> }) {
  const theme = useTheme();
  if (images.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      {images.map((image, index) => (
        <div
          key={image.id}
          testId={`composer-attachment-image-${index}`}
          style={{
            position: "relative",
            width: 64,
            height: 64,
            flexShrink: 0,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.8),
            backgroundColor: theme.background,
            overflow: "hidden",
          }}
        >
          {image.src ? (
            <div
              testId={`composer-attachment-preview-${index}`}
              onClick={image.onExpand}
              style={{ width: 62, height: 62, cursor: image.onExpand ? "pointer" : "default" }}
            >
              <img src={image.src} objectFit="cover" style={{ width: 62, height: 62, borderRadius: RADIUS.lg - 1, pointerEvents: "none" }} />
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 62, height: 62, paddingLeft: 4, paddingRight: 4 }}>
              <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 12, textAlign: "center", lineClamp: 3 }}>{image.name}</text>
            </div>
          )}
          {image.uploadId ? <MediaUploadOverlay uploadId={image.uploadId} onRetry={image.onRetry} index={index} /> : null}
          <div style={{ position: "absolute", top: 4, right: 4 }}>
            <MediaCloseButton label={`Remove ${image.name}`} onClick={image.onRemove} testId={`composer-remove-attachment-${index}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * web ComposerAttachmentMediaRow upload states: the percentage on a strip along the bottom
 * (`bg-background/85 text-3xs`), or a Retry button at the bottom left whose tooltip is the reason.
 */
function MediaUploadOverlay({ uploadId, onRetry, index }: { uploadId: string; onRetry: (() => void) | undefined; index: number }) {
  const theme = useTheme();
  const upload = useAtomValue(attachmentUploadStateAtom(uploadId));
  if (upload?.status === "uploading") {
    return (
      <div
        testId={`composer-attachment-progress-${index}`}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingLeft: 4, paddingRight: 4, backgroundColor: alpha(theme.background, 0.85), pointerEvents: "none" }}
      >
        <text style={{ color: theme.foreground, fontSize: 10, lineHeight: 14, textAlign: "center" }}>{formatUploadProgress(upload.progress)}</text>
      </div>
    );
  }
  if (upload?.status === "failed" && onRetry) {
    return (
      <div style={{ position: "absolute", left: 4, bottom: 4 }}>
        <Tooltip content={upload.reason} side="top">
          <div
            testId={`composer-attachment-retry-${index}`}
            onClick={onRetry}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              borderRadius: RADIUS.md,
              backgroundColor: "#000000b3",
              cursor: "pointer",
              hover: { backgroundColor: "#000000e6" },
            }}
          >
            <Icon name="refresh-cw" size={14} color="#ffffffa6" />
          </div>
        </Tooltip>
      </div>
    );
  }
  return null;
}

/** web `variant="media-close"`: a small dark circle with a white X over the thumbnail. */
function MediaCloseButton({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return (
    <Tooltip content={label} side="top">
      <div
        testId={testId}
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: "#000000b3",
          cursor: "pointer",
          hover: { backgroundColor: "#000000e6" },
        }}
      >
        <Icon name="x" size={12} color="#ffffff" />
      </div>
    </Tooltip>
  );
}

export function ComposerAttachmentFileList({ files }: { files: ReadonlyArray<ComposerFileItem> }) {
  const theme = useTheme();
  if (files.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
      {files.map((file, index) => (
        <div
          key={file.id}
          testId={`composer-attachment-file-${index}`}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4, paddingBottom: 4, minWidth: 0 }}
        >
          <Icon name="file" size={16} color={theme.mutedForeground} />
          <Text truncate style={{ flexGrow: 1, flexShrink: 1 }}>
            {file.name}
          </Text>
          <FileUploadStatus file={file} index={index} />
          <IconButton
            icon="x"
            size={24}
            iconSize={14}
            onClick={file.onRemove}
            testId={`composer-remove-file-${index}`}
          />
        </div>
      ))}
    </div>
  );
}

/** web ComposerAttachmentFileList's trailing text and Retry: size, progress, or a reattach hint. */
function FileUploadStatus({ file, index }: { file: ComposerFileItem; index: number }) {
  const theme = useTheme();
  const upload = useAtomValue(attachmentUploadStateAtom(file.uploadId ?? ""));
  const shown = file.uploadId ? upload : null;
  const label = file.needsReattach
    ? "Attach again"
    : shown?.status === "uploading"
      ? formatUploadProgress(shown.progress)
      : formatAttachmentSize(file.sizeBytes);
  return (
    <>
      <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }} testId={`composer-attachment-file-status-${index}`}>
        {label}
      </Text>
      {!file.needsReattach && shown?.status === "failed" && file.onRetry ? (
        <Tooltip content={shown.reason} side="top">
          <div style={{ display: "flex" }}>
            <IconButton icon="refresh-cw" size={24} iconSize={14} onClick={file.onRetry} testId={`composer-retry-file-${index}`} />
          </div>
        </Tooltip>
      ) : null}
    </>
  );
}

export function ComposerAttachButton({ onClick }: { onClick: () => void }) {
  // Button size="icon-sm" with the default svg size: 32 / 18 below `sm`.
  const small = useSmallViewport();
  return (
    <Tooltip content="Attach files" side="top">
      <div style={{ display: "flex" }}>
        <IconButton icon="paperclip" size={28} iconSize={small ? 18 : 16} responsive onClick={onClick} testId="composer-attach" />
      </div>
    </Tooltip>
  );
}
