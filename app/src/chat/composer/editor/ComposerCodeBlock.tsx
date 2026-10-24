// A code block in the composer: web's ComposerCodeBlockNodeView (MarkdownCodeBlockFrame with
// ComposerCodeBlockLanguagePicker in its header, Shiki colours from composerCodeBlockHighlight).
// The editor paints the code lines itself (they are editable text); this draws the card,
// the header and the language picker, and supplies the token colours.
//
// web geometry (measured): my-[0.65rem], radius 10, dark bg input/32 with a transparent
// border; header pt-1.5 pr-1.5 pl-3 (30px); picker button h-6 px-[7px] gap-1 rounded-lg,
// 12px/500 muted label, 14px language icon and chevron at 60%; code 13px at leading-snug,
// pre px-3 pt-1 pb-2. The composer's card has no copy button.
import { createContext, memo, use, useMemo, useState } from "react";

import { FileEntryIcon } from "../../../panels/files/FileEntryIcon.tsx";
import { segmentsFor } from "../../../panels/code/codeRows.tsx";
import { useSyntaxTokens } from "../../../panels/code/highlighter.ts";
import { Icon } from "../../../ui/Icon.tsx";
import { Popover } from "../../../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../../ui/theme.ts";
import { syntheticFileNameForLanguageId } from "../../../web/pierre-icons.ts";
import {
  CODE_BLOCK_LANGUAGES,
  type CodeBlockLanguage,
  codeLanguageEntry,
  codeLanguageLabel,
  languageOfInfoString,
} from "../../../web/composer-code-languages.ts";
import { markdownStyles } from "../../markdown/styles.ts";
import type { CodeBlock } from "./doc.ts";

export interface ComposerCodeBlockActions {
  readonly setLanguage: (blockIndex: number, language: string) => void;
  readonly readOnly: boolean;
}

export const ComposerCodeBlockActionsContext = createContext<ComposerCodeBlockActions>({
  setLanguage: () => {},
  readOnly: false,
});

/** Highlighting language for an info string: aliases resolve (ts → typescript). */
function highlightLanguage(info: string): string {
  const language = languageOfInfoString(info);
  return codeLanguageEntry(language)?.id || language || "text";
}

export interface ColorRun {
  readonly start: number;
  readonly end: number;
  readonly color: string;
}

/** Token colours of the block's text, as runs over block offsets. */
export function useCodeBlockColors(block: CodeBlock): (start: number, end: number) => ReadonlyArray<ColorRun> {
  const theme = useTheme();
  const language = highlightLanguage(block.info);
  const tokens = useSyntaxTokens(block.text.length <= 20_000 ? block.text : null, syntheticFileNameForLanguageId(language), theme.appearance);
  return useMemo(() => {
    const lineStarts: number[] = [0];
    for (let index = 0; index < block.text.length; index += 1) if (block.text[index] === "\n") lineStarts.push(index + 1);
    return (start: number, end: number) => {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= start) line += 1;
      const lineStart = lineStarts[line]!;
      const nextStart = lineStarts[line + 1];
      const lineText = block.text.slice(lineStart, nextStart === undefined ? block.text.length : nextStart - 1);
      const segments = segmentsFor(lineText, tokens?.[line] ?? null, start - lineStart, end - lineStart, [], theme.foreground);
      const runs: ColorRun[] = [];
      let offset = start;
      for (const segment of segments) {
        runs.push({ start: offset, end: offset + segment.text.length, color: segment.color });
        offset += segment.text.length;
      }
      return runs;
    };
  }, [block.text, tokens, theme.foreground]);
}

export const ComposerCodeBlockFrame = memo(function ComposerCodeBlockFrame({
  block,
  blockIndex,
  top,
  width,
  height,
  headerHeight,
}: {
  block: CodeBlock;
  blockIndex: number;
  top: number;
  width: number;
  height: number;
  headerHeight: number;
}) {
  const theme = useTheme();
  const styles = markdownStyles(theme, "assistant", 14).codeBlock;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          top,
          width,
          height,
          borderRadius: styles.radius,
          borderWidth: 1,
          borderColor: styles.border,
          backgroundColor: styles.background,
          pointerEvents: "none",
        }}
      />
      <div
        testId="composer-code-block-header"
        style={{
          position: "absolute",
          left: 0,
          top,
          width,
          height: headerHeight,
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-start",
          paddingTop: 6,
          paddingLeft: 6,
          paddingRight: 6,
          cursor: "default",
        }}
      >
        <LanguagePicker info={block.info} blockIndex={blockIndex} />
      </div>
    </>
  );
});

/** web ComposerCodeBlockLanguagePicker: a ghost button that opens a searchable list. */
function LanguagePicker({ info, blockIndex }: { info: string; blockIndex: number }) {
  const theme = useTheme();
  const actions = use(ComposerCodeBlockActionsContext);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const language = languageOfInfoString(info);
  const current = codeLanguageEntry(language)?.id ?? language;
  const label = codeLanguageLabel(language);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      testId="composer-code-language-popup"
      style={{ width: 224, padding: 0 }}
      trigger={
        <div
          testId="composer-code-language"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onMouseDown={(event) => {
            if ((event.button ?? 0) !== 0 || actions.readOnly) return;
            setOpen(!open);
          }}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            height: 24,
            paddingLeft: 7,
            paddingRight: 7,
            borderRadius: RADIUS.lg,
            backgroundColor: hovered || open ? theme.accent : "#00000000",
            cursor: actions.readOnly ? "default" : "pointer",
            opacity: actions.readOnly ? 0.64 : 1,
          }}
        >
          <LanguageIcon language={current} />
          <text
            style={{
              fontFamily: FONTS.sans,
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 16,
              color: hovered || open ? theme.foreground : theme.mutedForeground,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
              maxWidth: 160,
              pointerEvents: "none",
            }}
          >
            {label || "Plain text"}
          </text>
          <Icon name="chevron-down" size={14} color={theme.mutedForeground} opacity={0.6} />
        </div>
      }
    >
      <LanguageList
        current={current}
        onSelect={(id) => {
          setOpen(false);
          if (id !== current) actions.setLanguage(blockIndex, id);
        }}
        onClose={() => setOpen(false)}
      />
    </Popover>
  );
}

function LanguageIcon({ language }: { language: string }) {
  const fileName = language ? syntheticFileNameForLanguageId(language) : "file.txt";
  return (
    <div style={{ display: "flex", width: 14, height: 14, flexShrink: 0, pointerEvents: "none" }}>
      <FileEntryIcon pathValue={fileName} kind="file" size={14} />
    </div>
  );
}

const ITEM_HEIGHT = 28;
const LIST_MAX_HEIGHT = 325;

function LanguageList({ current, onSelect, onClose }: { current: string; onSelect: (id: string) => void; onClose: () => void }) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const items: CodeBlockLanguage[] = CODE_BLOCK_LANGUAGES.some((entry) => entry.id === current)
    ? [...CODE_BLOCK_LANGUAGES]
    : [{ id: current, label: current }, ...CODE_BLOCK_LANGUAGES];
  const needle = query.trim().toLowerCase();
  const filtered = needle ? items.filter((entry) => entry.label.toLowerCase().includes(needle) || entry.id.includes(needle)) : items;
  const [highlight, setHighlight] = useState<string | null>(current);
  const active = filtered.find((entry) => entry.id === highlight) ?? filtered[0] ?? null;
  const move = (direction: 1 | -1) => {
    if (filtered.length === 0) return;
    const index = active ? filtered.indexOf(active) : -1;
    setHighlight(filtered[(index + direction + filtered.length) % filtered.length]!.id);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          marginLeft: 8,
          marginRight: 8,
          marginTop: 8,
          paddingBottom: 6,
          borderBottomWidth: 1,
          borderColor: alpha(theme.border, 0.7),
        }}
      >
        <Icon name="search" size={16} color={alpha(theme.mutedForeground, 0.55)} />
        <input
          testId="composer-code-language-search"
          autoFocus
          value={query}
          placeholder="Search languages"
          theme={{ caret: theme.foreground }}
          style={{ flexGrow: 1, height: 26, fontFamily: FONTS.sans, fontSize: 14, color: theme.foreground }}
          onChange={(event) => {
            setQuery(event.value ?? "");
            setHighlight(null);
          }}
          onSubmit={() => {
            if (active) onSelect(active.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "down") {
              event.preventDefault();
              move(1);
            } else if (event.key === "up") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "escape") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: LIST_MAX_HEIGHT, overflowY: "scroll", padding: 4 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 8 }}>
            <text style={{ fontFamily: FONTS.sans, fontSize: 14, lineHeight: 20, color: theme.mutedForeground }}>No matching languages.</text>
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id || "plain"}
              testId={`composer-code-language-${entry.id || "plain"}`}
              onMouseEnter={() => setHighlight(entry.id)}
              onClick={() => onSelect(entry.id)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                height: ITEM_HEIGHT,
                flexShrink: 0,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: 6,
                cursor: "pointer",
                backgroundColor: active?.id === entry.id ? (theme.appearance === "dark" ? alpha("#ffffff", 0.04) : theme.accent) : "#00000000",
              }}
            >
              <LanguageIcon language={entry.id} />
              <text style={{ flexGrow: 1, minWidth: 0, fontFamily: FONTS.sans, fontSize: 14, lineHeight: 20, color: theme.foreground, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", pointerEvents: "none" }}>
                {entry.label}
              </text>
              {entry.id === current ? <Icon name="check" size={16} color={theme.mutedForeground} /> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
