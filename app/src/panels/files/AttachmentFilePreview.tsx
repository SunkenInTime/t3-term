// Port of apps/web/src/components/files/AttachmentFilePreview.tsx: a file a chat
// message carries, opened in the Files surface from its chip (web openAttachment).
// The server hands out a signed asset URL for the attachment; text-like files are
// read through it (first 1 MB) and shown as source, rendered markdown or a table,
// images inline. Not available here, by platform: rendered HTML and PDF (sandboxed
// frames) and audio and video players; those show web's "No preview" card. "Save
// file" writes the attachment into the Downloads folder, where web downloads it.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { readFilePreviewResponse } from "@t3tools/client-runtime/file-preview";
import type { EnvironmentId } from "@t3tools/contracts";
import { filePreviewDelimiter } from "@t3tools/shared/delimitedPreview";
import { FILE_TEXT_PREVIEW_MAX_BYTES, filePreviewKind } from "@t3tools/shared/filePreview";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { copyTextToClipboard } from "../../chat/header/osActions.ts";
import { wordWrapPref } from "../../state/codeView.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import { SourceView } from "../code/SourceView.tsx";
import { DelimitedTablePreview } from "./DelimitedTablePreview.tsx";
import { useAssetUrlState } from "./fileAssets.ts";
import {
  FileSurfaceAction,
  FileSurfaceFailure,
  FileSurfaceLoading,
  FileSurfaceNotice,
  FileSurfaceSubheader,
} from "./fileSurfaceChrome.tsx";

function renderedToggleLabel(mode: "markdown" | "table", rendered: boolean): string {
  if (mode === "markdown") return rendered ? "Show markdown source" : "Show rendered markdown";
  return rendered ? "Show source" : "Show table";
}

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

function uniqueDownloadPath(name: string): string {
  const directory = NodePath.join(NodeOs.homedir(), "Downloads");
  NodeFs.mkdirSync(directory, { recursive: true });
  const parsed = NodePath.parse(name.replace(/[\\/:*?"<>|]/g, "_") || "attachment");
  let candidate = NodePath.join(directory, `${parsed.name}${parsed.ext}`);
  for (let index = 1; NodeFs.existsSync(candidate); index += 1) {
    candidate = NodePath.join(directory, `${parsed.name} (${index})${parsed.ext}`);
  }
  return candidate;
}

export function AttachmentFilePreview(props: {
  readonly environmentId: EnvironmentId;
  readonly attachmentId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly origin?: string;
}) {
  const theme = useTheme();
  const kind = filePreviewKind(props);
  const delimiter = filePreviewDelimiter(props);
  const renderedMode = kind === "markdown" ? ("markdown" as const) : delimiter ? ("table" as const) : null;
  const [rendered, setRendered] = useState(true);
  const [revision, setRevision] = useState(0);
  const [content, setContent] = useState<{ text: string; truncated: boolean } | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const wordWrap = useAtomValue(wordWrapPref.atom);
  const resource = {
    _tag: "attachment" as const,
    attachmentId: props.attachmentId,
    fileName: props.name,
    mimeType: props.mimeType,
    disposition: "inline" as const,
  };
  const assetUrl = useAssetUrlState(props.environmentId, resource as never);
  const url = assetUrl._tag === "Success" ? assetUrl.url : null;
  const urlError = assetUrl._tag === "Failure" ? "The attachment is unavailable." : null;
  // web: html shows its source here too (no rendered frame).
  const needsText = kind === "text" || kind === "markdown" || kind === "html";

  useEffect(() => {
    if (!needsText || !url) return;
    const controller = new AbortController();
    setContent(null);
    setContentError(null);
    void (async () => {
      const response = await fetch(url, {
        signal: controller.signal,
        ...(props.sizeBytes > 0 ? { headers: { Range: `bytes=0-${FILE_TEXT_PREVIEW_MAX_BYTES}` } } : {}),
      });
      const result = await readFilePreviewResponse(response as never, controller.signal);
      if (!controller.signal.aborted) setContent(result);
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted) setContentError(cause instanceof Error ? cause.message : "Could not load this file.");
    });
    return () => controller.abort();
  }, [url, needsText, revision, props.sizeBytes]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const failure = urlError ?? (needsText ? contentError : null);
  const showsRawText =
    failure === null && needsText && content !== null && !(delimiter && rendered) && !(kind === "markdown" && rendered);

  const save = () => {
    if (!url) return;
    setSaving(true);
    void (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("The file could not be loaded. Try again.");
      const target = uniqueDownloadPath(props.name);
      await Bun.write(target, await response.arrayBuffer());
      toast({ type: "success", title: "File saved", description: target });
    })()
      .catch((cause: unknown) =>
        toast({ type: "error", title: "Could not save file", description: cause instanceof Error ? cause.message : "Please try again." }),
      )
      .finally(() => setSaving(false));
  };

  const body = failure ? (
    <FileSurfaceFailure
      message={failure}
      onRetry={() => {
        setContentError(null);
        setRevision((value) => value + 1);
      }}
    />
  ) : !url || (needsText && !content) ? (
    <FileSurfaceLoading />
  ) : needsText && content ? (
    delimiter && rendered ? (
      <DelimitedTablePreview name={props.name} text={content.text} delimiter={delimiter} />
    ) : kind === "markdown" && rendered ? (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
        <div style={{ width: "100%", maxWidth: 896, paddingLeft: 24, paddingRight: 24, paddingTop: 20, paddingBottom: 20, flexShrink: 0 }}>
          <markdown source={content.text} theme={markdownTheme(theme)} />
        </div>
      </div>
    ) : (
      <SourceView path={props.name} text={content.text} wrap={wordWrap} revealLine={null} revealKey={props.attachmentId} />
    )
  ) : kind === "image" ? (
    <div style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", padding: 16 }}>
      <img testId="attachment-image" src={url} alt={props.name} objectFit="contain" style={{ width: "100%", height: "100%" }} />
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", gap: 4, paddingLeft: 24, paddingRight: 24 }}>
      <Text size="sm" weight={500}>
        No preview for this file
      </Text>
      <Text size="xs" color={theme.mutedForeground} style={{ textAlign: "center", maxWidth: 384, lineHeight: 19.5 }}>
        {`Save it to open in an app that supports ${props.name.split(".").at(-1) || "this format"} files.`}
      </Text>
    </div>
  );

  return (
    <div testId="attachment-preview" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden", backgroundColor: theme.background }}>
      <FileSurfaceSubheader>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexGrow: 1, minWidth: 0 }}>
          <div style={{ paddingLeft: 2, paddingRight: 2, flexShrink: 0 }}>
            <Text size="xs" color={theme.mutedForeground}>
              {props.origin ?? "Attachment"}
            </Text>
          </div>
          <div style={{ marginLeft: 4, marginRight: 4, flexShrink: 0 }}>
            <Icon name="chevron-right" size={14} color={alpha(theme.mutedForeground, 0.6)} />
          </div>
          <div style={{ display: "flex", minWidth: 0, flexShrink: 1, paddingLeft: 2, paddingRight: 2 }}>
            <Text size="xs" weight={500} truncate>
              {props.name}
            </Text>
          </div>
          {props.sizeBytes > 0 ? (
            <div style={{ marginLeft: 8, flexShrink: 0 }}>
              <Text size="xs" color={theme.mutedForeground}>
                {formatAttachmentSize(props.sizeBytes)}
              </Text>
            </div>
          ) : null}
        </div>
        {renderedMode ? (
          <FileSurfaceAction
            testId="attachment-toggle-rendered"
            label={renderedToggleLabel(renderedMode, rendered)}
            icon={rendered ? "code" : renderedMode === "table" ? "table-2" : "eye"}
            pressed={rendered}
            onPress={() => setRendered((value) => !value)}
          />
        ) : null}
        {showsRawText ? (
          <FileSurfaceAction
            label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
            icon="wrap-text"
            pressed={wordWrap}
            onPress={() => wordWrapPref.set(!wordWrap)}
          />
        ) : null}
        {content ? (
          <FileSurfaceAction
            label={copied ? "Copied" : content.truncated ? "Copy preview" : "Copy contents"}
            icon={copied ? "check" : "copy"}
            onPress={() => void copyTextToClipboard(content.text).then(() => setCopied(true))}
          />
        ) : null}
        {url ? (
          <FileSurfaceAction label={saving ? "Preparing file…" : "Save file"} icon="download" disabled={saving} onPress={save} />
        ) : null}
      </FileSurfaceSubheader>
      {content?.truncated ? (
        <FileSurfaceNotice>
          {`Preview limited to the first 1 MB${props.sizeBytes > 0 ? ` of a ${props.sizeBytes.toLocaleString()} byte file` : ""}. Save the file to read it in full.`}
        </FileSurfaceNotice>
      ) : null}
      {body}
    </div>
  );
}
