// Port of apps/web/src/components/files/ProjectFilePicker.tsx (+ ProjectFilePicker.logic.ts
// via useActiveProjectTarget). Opening a file goes through the right panel
// (openFileInActiveThread).
import { useAtomValue } from "@effect/atom-react";
import type { KeyEvent } from "@gpuix/react";
import type { ProjectEntry } from "@t3tools/contracts";
import { normalizeSearchQuery } from "@t3tools/shared/searchRanking";
import { useRef, useState } from "react";

import { activeKeybindingsAtom } from "../state/keybindings.ts";
import { openFileInActiveThread } from "../state/rightPanel.ts";
import { Text } from "../ui/primitives.tsx";
import { alpha, useTheme } from "../ui/theme.ts";
import { buildCommandPaletteRows, type CommandPaletteActionItem } from "../web/components/CommandPalette.logic.ts";
import { ItemIcon, PaletteEmptyState, PaletteFooter, PaletteFrame, PaletteInput, PaletteRows, type PaletteItem } from "./command.tsx";
import { useProjectFilePickerQuery } from "./hooks.ts";
import { useActiveProjectTarget, type ActiveProjectTarget } from "./projectTarget.ts";

export const PROJECT_FILE_PICKER_RESULT_LIMIT = 200;

interface ProjectFilePickerMatch {
  readonly name: string;
  readonly nameMatchIndices: ReadonlyArray<number>;
  readonly path: string;
  readonly pathMatchIndices: ReadonlyArray<number>;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function findMatchIndices(value: string, query: string): number[] | null {
  if (!query) return [];
  const normalizedValue = value.toLowerCase();
  const indices: number[] = [];
  let queryIndex = 0;
  for (let valueIndex = 0; valueIndex < normalizedValue.length; valueIndex += 1) {
    if (normalizedValue[valueIndex] !== query[queryIndex]) continue;
    indices.push(valueIndex);
    queryIndex += 1;
    if (queryIndex === query.length) return indices;
  }
  return null;
}

/** ProjectFilePicker.logic.ts getProjectFilePickerMatches */
function getProjectFilePickerMatches(entries: ReadonlyArray<ProjectEntry>, rawQuery: string): ProjectFilePickerMatch[] {
  const query = normalizeSearchQuery(rawQuery, { trimLeadingPattern: /^[@./]+/ }).replaceAll(/\s/g, "");
  const matches: ProjectFilePickerMatch[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const name = fileName(entry.path);
    matches.push({
      name,
      nameMatchIndices: findMatchIndices(name, query) ?? [],
      path: entry.path,
      pathMatchIndices: findMatchIndices(entry.path, query) ?? [],
    });
    if (matches.length >= PROJECT_FILE_PICKER_RESULT_LIMIT) break;
  }
  return matches;
}

/** HighlightedFuzzyText: matched characters bold in fg, the rest muted. */
function HighlightedFuzzyText({
  active,
  indices,
  value,
  size,
  baseColor,
}: {
  active: boolean;
  indices: ReadonlyArray<number>;
  value: string;
  size: "sm" | "xs";
  baseColor: string;
}) {
  const theme = useTheme();
  if (!active || indices.length === 0) {
    return (
      <Text size={size} color={baseColor} truncate>
        {value}
      </Text>
    );
  }
  const parts: Array<{ text: string; bold: boolean }> = [];
  let start = 0;
  for (const index of indices) {
    if (start < index) parts.push({ text: value.slice(start, index), bold: false });
    parts.push({ text: value[index] ?? "", bold: true });
    start = index + 1;
  }
  if (start < value.length) parts.push({ text: value.slice(start), bold: false });
  // Adjacent <text> siblings flow as one line in gpuix.
  return (
    <div style={{ display: "flex", flexDirection: "row", minWidth: 0, overflow: "hidden" }}>
      {parts.map((part, index) => (
        <Text
          key={index}
          size={size}
          weight={part.bold ? 600 : undefined}
          color={part.bold ? theme.foreground : theme.mutedForeground}
          style={{ flexShrink: part.bold ? 0 : 1, whiteSpace: "nowrap" }}
        >
          {part.text}
        </Text>
      ))}
    </div>
  );
}

function emptyMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  const isSearching = query.trim().length > 0;
  if (isPending) return isSearching ? "Searching workspace files…" : "Indexing workspace files…";
  return isSearching ? "No matching files." : "No files found.";
}

export function requestOpenFile(_target: ActiveProjectTarget, path: string, line: number | null): void {
  openFileInActiveThread(path, line ?? undefined);
}

export function ProjectFilePicker({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const target = useActiveProjectTarget();
  if (!target) {
    return (
      <PaletteFrame onClose={onClose} testId="project-file-picker">
        <PaletteInput value="" placeholder="Search files…" onChange={() => {}} disabled onKeyDown={escapeBack(onBack)} />
        <PaletteEmptyState message="Open a project to search its files." />
        <PaletteFooter actionLabel="Open file" escapeLabel="Back" />
      </PaletteFrame>
    );
  }
  return <OpenProjectFilePicker target={target} onClose={onClose} onBack={onBack} />;
}

function escapeBack(onBack: () => void) {
  return (event: KeyEvent) => {
    if (event.key !== "escape") return;
    event.preventDefault();
    event.stopPropagation();
    onBack();
  };
}

function OpenProjectFilePicker({
  target,
  onClose,
  onBack,
}: {
  target: ActiveProjectTarget;
  onClose: () => void;
  onBack: () => void;
}) {
  const theme = useTheme();
  const inputRef = useRef<{ id: number } | null>(null);
  const keybindings = useAtomValue(activeKeybindingsAtom);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const result = useProjectFilePickerQuery(target.environmentId, target.cwd, query, PROJECT_FILE_PICKER_RESULT_LIMIT);
  const matches = getProjectFilePickerMatches(result.entries, result.matchedQuery);
  const hasMatchedQuery = /\S/.test(result.matchedQuery);
  const items: CommandPaletteActionItem[] = matches.map((match) => ({
    kind: "action",
    value: `file:${match.path}`,
    searchTerms: [match.name, match.path],
    title: (
      <HighlightedFuzzyText active={hasMatchedQuery} value={match.name} indices={match.nameMatchIndices} size="sm" baseColor={theme.foreground} />
    ),
    description: (
      <HighlightedFuzzyText
        active={hasMatchedQuery}
        value={match.path}
        indices={match.pathMatchIndices}
        size="xs"
        baseColor={alpha(theme.mutedForeground, 0.7)}
      />
    ),
    icon: <ItemIcon name="file" />,
    run: async () => requestOpenFile(target, match.path, null),
  }));
  const rows = buildCommandPaletteRows(items.length > 0 ? [{ value: "project-files", label: target.projectName, items }] : []);
  const effectiveHighlight =
    highlighted !== null && rows.itemValues.includes(highlighted) ? highlighted : (rows.itemValues[0] ?? null);

  const execute = (item: PaletteItem) => {
    if (item.kind !== "action") return;
    onClose();
    void item.run();
  };
  const move = (delta: 1 | -1) => {
    const values = rows.itemValues;
    if (values.length === 0) return;
    const index = effectiveHighlight === null ? -1 : values.indexOf(effectiveHighlight);
    setHighlighted(values[(index + delta + values.length) % values.length] ?? null);
    setScrollNonce((nonce) => nonce + 1);
  };

  return (
    <PaletteFrame onClose={onClose} initialFocus={inputRef} testId="project-file-picker">
      <PaletteInput
        inputRef={inputRef}
        value={query}
        placeholder="Search files…"
        onChange={(value) => {
          setHighlighted(null);
          setQuery(value);
        }}
        onSubmit={() => {
          const item = items.find((candidate) => candidate.value === effectiveHighlight);
          if (item) execute(item);
        }}
        onKeyDown={(event) => {
          if (event.key === "escape") {
            escapeBack(onBack)(event);
            return;
          }
          if (event.key === "down" || event.key === "up") {
            event.preventDefault();
            event.stopPropagation();
            move(event.key === "down" ? 1 : -1);
          }
        }}
      />
      <PaletteRows
        rows={rows.rows}
        highlightedValue={effectiveHighlight}
        keybindings={keybindings}
        onExecute={execute}
        onHighlight={setHighlighted}
        scrollToHighlight={scrollNonce}
        emptyMessage={emptyMessage(query, result.error, result.isPending)}
      />
      <PaletteFooter actionLabel="Open file" escapeLabel="Back" />
    </PaletteFrame>
  );
}
