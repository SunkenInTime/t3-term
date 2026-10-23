// apps/web/src/components/chat/ComposerStashBadge.tsx and ComposerStashMenu.tsx: the
// "Stash N" shoulder tab beside the banner dock, and the list of stashed prompts that
// opens above the editor. Keys while the list is open (web uses arrows; the gpuix
// textarea swallows Up/Down, see docs/gpuix-notes.md): Ctrl+N / Ctrl+P or Tab /
// Shift+Tab move the highlight, Enter restores it, Escape closes. Composer.tsx routes them.
import { memo } from "react";

import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";

import { useRelativeTimeLabel } from "../../settings/RelativeTime.tsx";
import type { PromptStashEntry } from "../../state/promptStash.ts";
import { Icon } from "../../ui/Icon.tsx";
import { alpha, RADIUS, useTheme } from "../../ui/theme.ts";
import {
  BannerActions,
  BannerAttachment,
  BannerContent,
  BannerCount,
  BannerIcon,
  BannerIconButton,
  BannerRoot,
  BannerRow,
  BannerText,
  BannerToggleIcon,
} from "./ComposerBannerParts.tsx";

const SNIPPET_MAX_CHARS = 90;

export function stashEntrySnippet(entry: PromptStashEntry): string {
  const trimmed = assistantCitationsToPlainText(entry.prompt).trim().replace(/\s+/g, " ");
  if (trimmed.length > 0) {
    return trimmed.length > SNIPPET_MAX_CHARS ? `${trimmed.slice(0, SNIPPET_MAX_CHARS)}…` : trimmed;
  }
  const imageCount = entry.attachments.filter((attachment) => attachment.type === "image").length;
  const fileCount = entry.attachments.length - imageCount;
  const attachmentCount = imageCount + fileCount;
  if (attachmentCount === 0) return "(empty)";
  const label = imageCount > 0 && fileCount > 0 ? "attachment" : fileCount > 0 ? "file" : "image";
  return `(${attachmentCount} ${label}${attachmentCount === 1 ? "" : "s"})`;
}

/** The shoulder tab: hidden while nothing is stashed; the count turns primary for a moment after a stash. */
export const ComposerStashBadge = memo(function ComposerStashBadge(props: {
  count: number;
  menuOpen: boolean;
  pulsing: boolean;
  onToggleMenu: () => void;
}) {
  const theme = useTheme();
  if (props.count === 0) return null;
  const active = props.menuOpen || props.pulsing;
  return (
    <BannerAttachment testId="composer-stash-badge">
      <BannerRoot density="comfortable">
        <BannerRow testId="composer-stash-toggle" onClick={props.menuOpen ? undefined : props.onToggleMenu}>
          <BannerIcon name="bookmark" color={active ? theme.foreground : theme.mutedForeground} />
          <BannerText color={active ? theme.foreground : theme.mutedForeground}>Stash</BannerText>
          <div style={{ display: "flex", justifyContent: "center", minWidth: 24, flexShrink: 0 }}>
            <BannerText weight={500} color={props.pulsing ? theme.primary : theme.mutedForeground}>
              {String(props.count)}
            </BannerText>
          </div>
        </BannerRow>
      </BannerRoot>
    </BannerAttachment>
  );
});

export const ComposerStashMenu = memo(function ComposerStashMenu(props: {
  entries: ReadonlyArray<PromptStashEntry>;
  highlightedId: string | null;
  stashShortcutLabel: string | null;
  onHighlight: (entryId: string) => void;
  onRestore: (entry: PromptStashEntry) => void;
  onDelete: (entry: PromptStashEntry) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const highlighted = props.entries.find((entry) => entry.id === props.highlightedId) ?? props.entries[0];
  return (
    <BannerRoot placement="floating" testId="composer-stash-menu" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
      <BannerRow testId="composer-stash-close" onClick={props.onClose}>
        <BannerIcon name="bookmark" />
        <BannerContent>
          <BannerText color={theme.mutedForeground}>Stash</BannerText>
        </BannerContent>
        <BannerActions>
          <BannerCount>{String(props.entries.length)}</BannerCount>
          <BannerToggleIcon expanded />
        </BannerActions>
      </BannerRow>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 128, overflowY: "scroll", scrollbarColor: theme.scrollbar, rowGap: 1 }}>
        {props.entries.length === 0 ? (
          <BannerRow>
            <BannerIcon />
            <BannerContent>
              <BannerText color={theme.mutedForeground} truncate grow>
                {`Nothing stashed yet.${props.stashShortcutLabel ? ` Press ${props.stashShortcutLabel} with a prompt in the composer to stash it.` : ""}`}
              </BannerText>
            </BannerContent>
          </BannerRow>
        ) : (
          props.entries.map((entry) => (
            <StashRow
              key={entry.id}
              entry={entry}
              highlighted={highlighted?.id === entry.id}
              onHighlight={props.onHighlight}
              onRestore={props.onRestore}
              onDelete={props.onDelete}
            />
          ))
        )}
      </div>
    </BannerRoot>
  );
});

function StashRow(props: {
  entry: PromptStashEntry;
  highlighted: boolean;
  onHighlight: (entryId: string) => void;
  onRestore: (entry: PromptStashEntry) => void;
  onDelete: (entry: PromptStashEntry) => void;
}) {
  const theme = useTheme();
  const { entry } = props;
  const age = useRelativeTimeLabel(entry.createdAt);
  const fileCount = entry.attachments.filter((attachment) => attachment.type === "file").length;
  const imageCount = entry.attachments.length - fileCount;
  return (
    <div
      testId={`composer-stash-entry-${entry.id}`}
      onMouseEnter={() => props.onHighlight(entry.id)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        columnGap: 4,
        minHeight: 24,
        borderRadius: RADIUS.sm,
        ...(props.highlighted ? { backgroundColor: theme.accent } : {}),
      }}
    >
      <div
        testId={`composer-stash-restore-${entry.id}`}
        onClick={() => props.onRestore(entry)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 4, flexGrow: 1, flexBasis: 0, minWidth: 0, cursor: "pointer" }}
      >
        <BannerIcon name="file-text" />
        <BannerText truncate grow color={alpha(theme.foreground, 0.8)}>
          {stashEntrySnippet(entry)}
        </BannerText>
      </div>
      <BannerActions>
        {imageCount > 0 ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <Icon name="image" size={12} color={theme.mutedForeground} />
            <BannerText color={theme.mutedForeground}>{String(imageCount)}</BannerText>
          </div>
        ) : null}
        {fileCount > 0 ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <Icon name="file" size={12} color={theme.mutedForeground} />
            <BannerText color={theme.mutedForeground}>{String(fileCount)}</BannerText>
          </div>
        ) : null}
        <BannerText color={theme.mutedForeground}>{age}</BannerText>
        <BannerIconButton icon="x" testId={`composer-stash-delete-${entry.id}`} onClick={() => props.onDelete(entry)} />
      </BannerActions>
    </div>
  );
}
