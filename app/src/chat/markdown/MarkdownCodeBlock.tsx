// apps/web/src/components/chat/MarkdownCodeBlock.tsx: the fenced code card.
// Header (language icon or label, fence title) with wrap, run-in-terminal and
// copy buttons; Shiki highlighting with the pierre themes (same worker the
// Files and Diff surfaces use). Lines wrap like `pre-wrap` when the wordWrap
// client setting is on (web's default), otherwise the block scrolls sideways.
import { memo, useEffect, useState, type ReactNode } from "react";

import { FileEntryIcon } from "../../panels/files/FileEntryIcon.tsx";
import { expandTabs, segmentsFor, wrapLine } from "../../panels/code/codeRows.tsx";
import { useSyntaxTokens } from "../../panels/code/highlighter.ts";
import { getClientSettings } from "../../state/clientSettings.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { useSmallViewport } from "../../ui/viewport.tsx";
import { FONTS, RADIUS, useTheme } from "../../ui/theme.ts";
import { hasSpecificPierreIconForFileName, syntheticFileNameForLanguageId } from "../../web/pierre-icons.ts";
import { copyTextToClipboard } from "../timeline/system.ts";
import { textWidth } from "./measure.ts";
import type { MarkdownStyles } from "./styles.ts";
import { MARGIN_AWARE } from "./MarkdownView.tsx";

const FENCE_TITLE_ATTR_REGEX = /(?:^|\s)(?:title|file(?:name)?)=(?:"([^"]+)"|'([^']+)'|(\S+))/i;
const FENCE_FILENAME_TOKEN_REGEX = /^[\w@][\w@./-]*\.[A-Za-z0-9]+$/;

/** MarkdownCodeBlock.logic.ts extractFenceTitle. */
export function extractFenceTitle(meta: string | undefined): string | null {
  if (!meta) return null;
  const attrMatch = FENCE_TITLE_ATTR_REGEX.exec(meta);
  const attrTitle = attrMatch?.[1] ?? attrMatch?.[2] ?? attrMatch?.[3];
  if (attrTitle) return attrTitle;
  return meta.split(/\s+/).find((candidate) => FENCE_FILENAME_TOKEN_REGEX.test(candidate)) ?? null;
}

/** web Button variant="ghost-muted" size="icon-xs" (24px at sm+, 12px icon). */
export function CodeBlockIconButton({
  icon,
  label,
  pressed,
  onClick,
  color,
  testId,
}: {
  icon: IconName;
  label: string;
  pressed?: boolean;
  onClick: () => void;
  color?: string;
  testId?: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  // icon-xs: size-7 below the sm breakpoint, size-6 from it.
  const buttonSize = useSmallViewport() ? 28 : 24;
  return (
    <Tooltip content={label} side="top">
      <div
        testId={testId}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: buttonSize,
          height: buttonSize,
          flexShrink: 0,
          borderRadius: RADIUS.md,
          cursor: "pointer",
          // variant secondary when pressed (the wrap toggle), ghost-muted otherwise.
          backgroundColor: pressed ? theme.secondary : hovered ? theme.accent : "#00000000",
        }}
      >
        <Icon name={icon} size={12} color={color ?? (hovered || pressed ? theme.foreground : theme.mutedForeground)} />
      </div>
    </Tooltip>
  );
}

export function useCopyFeedback(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(id);
  }, [copied]);
  return [
    copied,
    (text: string) => {
      void copyTextToClipboard(text).then(
        () => setCopied(true),
        () => {},
      );
    },
  ];
}

const SHELL_LANGUAGE = /^(?:sh|bash|zsh|fish|shell|powershell|pwsh)$/;

function canRunCommand(code: string, language: string): boolean {
  const command = code.trim();
  return (
    SHELL_LANGUAGE.test(language) &&
    code.endsWith("\n") &&
    command.length > 0 &&
    !command.endsWith("\\") &&
    !/[\p{Cc}\p{Cf}]/u.test(code.slice(0, -1))
  );
}

export function CodeBlockTitle({ fenceTitle, language, color }: { fenceTitle: string | null; language: string; color: string }) {
  const text = (value: string) => (
    <text style={{ fontFamily: FONTS.mono, fontSize: 11, lineHeight: 16, color, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
      {value}
    </text>
  );
  if (fenceTitle) {
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        <FileEntryIcon pathValue={fenceTitle} kind="file" size={14} />
        {text(fenceTitle)}
      </div>
    );
  }
  const fileName = syntheticFileNameForLanguageId(language);
  if (!hasSpecificPierreIconForFileName(fileName)) return text(language);
  return (
    <Tooltip content={language} side="top">
      <div style={{ display: "flex", flexShrink: 0 }}>
        <FileEntryIcon pathValue={fileName} kind="file" size={14} />
      </div>
    </Tooltip>
  );
}

export const MarkdownCodeBlock = memo(function MarkdownCodeBlock({
  code,
  language,
  meta,
  width,
  styles,
  isStreaming,
  onRunShellCommand,
  viewToggle,
  children,
  marginTop,
}: {
  code: string;
  language: string;
  meta: string | undefined;
  width: number;
  styles: MarkdownStyles;
  isStreaming: boolean;
  onRunShellCommand?: ((command: string) => void) | undefined;
  viewToggle?: ReactNode;
  /** Replaces the highlighted body (the Mermaid diagram). */
  children?: ReactNode;
  marginTop?: number;
}) {
  const [wrapped, setWrapped] = useState(() => getClientSettings().wordWrap);
  const [copied, copy] = useCopyFeedback();
  const fenceTitle = extractFenceTitle(meta);
  const block = styles.codeBlock;
  const canRun = onRunShellCommand !== undefined && !isStreaming && canRunCommand(code, language);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        marginTop,
        borderRadius: block.radius,
        borderWidth: 1,
        borderColor: block.border,
        backgroundColor: block.background,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingTop: 6,
          paddingRight: 6,
          paddingLeft: 12,
          userSelect: "none",
        }}
      >
        <CodeBlockTitle fenceTitle={fenceTitle} language={language} color={block.headerColor} />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>
          {children ? null : (
            <CodeBlockIconButton icon="wrap-text" label={wrapped ? "Disable line wrap" : "Wrap lines"} pressed={wrapped} onClick={() => setWrapped((value) => !value)} />
          )}
          {canRun ? <CodeBlockIconButton icon="play" label="Run in terminal" onClick={() => onRunShellCommand?.(code.trim())} /> : null}
          {viewToggle}
          <CodeBlockIconButton
            icon={copied ? "check" : "copy"}
            label={copied ? "Copied" : "Copy code"}
            onClick={() => copy(code)}
          />
        </div>
      </div>
      {children ?? <HighlightedCode code={code} language={language} width={width - 2} wrapped={wrapped} styles={styles} />}
    </div>
  );
});

/** The highlighted body: rows of colored runs, wrapped at the block width when `wrapped`. */
export const HighlightedCode = memo(function HighlightedCode({
  code,
  language,
  width,
  wrapped,
  styles,
}: {
  code: string;
  language: string;
  width: number;
  wrapped: boolean;
  styles: MarkdownStyles;
}) {
  const palette = styles.palette;
  const block = styles.codeBlock;
  const source = code.endsWith("\n") ? code.slice(0, -1) : code;
  const tokens = useSyntaxTokens(source, syntheticFileNameForLanguageId(language), palette.appearance);
  const charWidth = textWidth({ family: "mono", weight: 400 }, block.textSize, "0");
  const contentWidth = width - 2 * block.padX;
  const columns = wrapped ? Math.max(8, Math.floor(contentWidth / charWidth)) : Number.MAX_SAFE_INTEGER;
  const fallback = palette.foreground;
  const rows: ReactNode[] = [];
  source.split("\n").forEach((rawLine, lineIndex) => {
    const line = expandTabs(rawLine);
    const lineTokens = tokens?.[lineIndex] ?? null;
    for (const [start, end] of wrapLine(line, columns)) {
      const segments = segmentsFor(line, lineTokens, start, end, [], fallback);
      rows.push(
        <div key={`${lineIndex}:${start}`} style={{ display: "flex", flexDirection: "row", height: block.lineHeight, flexShrink: 0 }}>
          {segments.map((segment, index) => (
            <text
              key={index}
              style={{
                color: segment.color,
                fontFamily: FONTS.mono,
                fontSize: block.textSize,
                lineHeight: block.lineHeight,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {segment.text}
            </text>
          ))}
        </div>,
      );
    }
  });
  const body = (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, paddingLeft: block.padX, paddingRight: block.padX, paddingTop: block.padY, paddingBottom: block.padY }}>
      {rows}
    </div>
  );
  if (wrapped) return body;
  return (
    <div style={{ display: "flex", flexDirection: "row", width: "100%", overflowX: "scroll", scrollbarColor: palette.border }}>
      {body}
    </div>
  );
});
MARGIN_AWARE.add(MarkdownCodeBlock);
