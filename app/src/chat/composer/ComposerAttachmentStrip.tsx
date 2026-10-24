// apps/web/src/components/chat/ComposerAttachmentStrip.tsx: image thumbnails (64×64,
// radius 10, remove button top-right), the file list (icon, name, size, remove) and the
// paperclip attach button. Attachments are local paths; the bytes upload at send time.
import { Icon } from "../../ui/Icon.tsx";
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
}

export interface ComposerFileItem {
  readonly id: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly onRemove: () => void;
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
          {image.src ? <img src={image.src} objectFit="cover" style={{ width: 62, height: 62, borderRadius: RADIUS.lg - 1 }} /> : null}
          <div style={{ position: "absolute", top: 4, right: 4 }}>
            <MediaCloseButton label={`Remove ${image.name}`} onClick={image.onRemove} testId={`composer-remove-attachment-${index}`} />
          </div>
        </div>
      ))}
    </div>
  );
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
          <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
            {formatAttachmentSize(file.sizeBytes)}
          </Text>
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
