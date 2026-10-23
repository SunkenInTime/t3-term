// Port of apps/web/src/components/search/ProjectContentSearchDialog.tsx: a 420px
// tall palette, Aa / ab / .* toggles, results grouped by file with line numbers.
// Web syntax-highlights each line (HighlightedSearchLine); here the match range
// is marked on plain monospace text.
import type { KeyEvent } from "@gpuix/react";
import type { ProjectContentMatch } from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { PaletteFooter, PaletteFrame, PaletteInput, PalettePanel } from "./command.tsx";
import { useProjectContentSearch } from "./hooks.ts";
import { requestOpenFile } from "./ProjectFilePicker.tsx";
import { useActiveProjectTarget, type ActiveProjectTarget } from "./projectTarget.ts";

const VISIBLE_MATCH_WINDOW = 100;
const DIALOG_HEIGHT = 420;

interface MatchGroup {
  readonly path: string;
  readonly matches: ReadonlyArray<ProjectContentMatch & { readonly resultIndex: number }>;
}

function splitPath(path: string): { readonly name: string; readonly directory: string } {
  const separator = path.lastIndexOf("/");
  return separator === -1
    ? { name: path, directory: "" }
    : { name: path.slice(separator + 1), directory: path.slice(0, separator) };
}

function groupMatches(matches: ReadonlyArray<ProjectContentMatch>): MatchGroup[] {
  const groups = new Map<string, Array<ProjectContentMatch & { readonly resultIndex: number }>>();
  matches.forEach((match, resultIndex) => {
    const group = groups.get(match.path);
    const indexed = { ...match, resultIndex };
    if (group) group.push(indexed);
    else groups.set(match.path, [indexed]);
  });
  return [...groups].map(([path, grouped]) => ({ path, matches: grouped }));
}

function escapeBack(onBack: () => void) {
  return (event: KeyEvent) => {
    if (event.key !== "escape") return;
    event.preventDefault();
    event.stopPropagation();
    onBack();
  };
}

export function ProjectContentSearch({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const target = useActiveProjectTarget();
  const theme = useTheme();
  if (!target) {
    return (
      <PaletteFrame onClose={onClose} height={DIALOG_HEIGHT} testId="project-content-search">
        <PaletteInput value="" placeholder="Search project contents…" onChange={() => {}} disabled onKeyDown={escapeBack(onBack)} />
        <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", paddingLeft: 24, paddingRight: 24 }}>
          <Text color={theme.mutedForeground}>Open a project to search its files.</Text>
        </div>
        <PaletteFooter actionLabel="Open file" escapeLabel="Back" />
      </PaletteFrame>
    );
  }
  return <OpenContentSearch key={`${target.environmentId}:${target.cwd}`} target={target} onClose={onClose} onBack={onBack} />;
}

function SearchOptionButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <div
      testId={`content-search-${label.toLowerCase().replaceAll(" ", "-")}`}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 28,
        height: 24,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: RADIUS.sm,
        backgroundColor: active ? alpha(theme.foreground, 0.1) : "#00000000",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: active ? alpha(theme.foreground, 0.12) : theme.accent } }),
      }}
    >
      {children}
    </div>
  );
}

function MatchLine({ match }: { match: ProjectContentMatch }) {
  const theme = useTheme();
  const line = match.lineContent.replace(/	/g, "  ");
  const firstStart = match.matchRanges[0]?.start ?? 0;
  // Keep the first match near the start of a long line, like web's truncated row.
  const lead = Math.max(0, firstStart - 24);
  const segments: Array<{ text: string; hit: boolean }> = [];
  let cursor = lead;
  for (const range of match.matchRanges) {
    if (range.end <= cursor) continue;
    const start = Math.max(range.start, cursor);
    if (start > cursor) segments.push({ text: line.slice(cursor, start), hit: false });
    segments.push({ text: line.slice(start, range.end), hit: true });
    cursor = range.end;
  }
  if (cursor < line.length) segments.push({ text: line.slice(cursor), hit: false });
  if (lead > 0 && segments[0]) segments[0] = { ...segments[0], text: `…${segments[0].text}` };
  if (segments[0] && !segments[0].hit) segments[0] = { ...segments[0], text: segments[0].text.trimStart() };
  const textStyle = { fontFamily: FONTS.mono, fontSize: 12, lineHeight: 16, whiteSpace: "nowrap" as const };
  return (
    <div style={{ display: "flex", flexDirection: "row", minWidth: 0, overflow: "hidden", flexGrow: 1 }}>
      {segments.map((segment, index) =>
        segment.hit ? (
          <div key={index} style={{ backgroundColor: "#8c6c1f", borderRadius: 2, flexShrink: 0 }}>
            <text style={{ ...textStyle, color: "#f5f5f5" }}>{segment.text}</text>
          </div>
        ) : (
          <text key={index} style={{ ...textStyle, color: theme.foreground, flexShrink: index === segments.length - 1 ? 1 : 0 }}>
            {segment.text}
          </text>
        ),
      )}
    </div>
  );
}

function OpenContentSearch({
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
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_MATCH_WINDOW);
  const rowRefs = useRef(new Map<number, { scrollIntoView?: () => void }>());
  const search = useProjectContentSearch({
    environmentId: target.environmentId,
    cwd: target.cwd,
    query,
    caseSensitive,
    wholeWord,
    useRegex,
  });
  const canOpenMatches = search.canReadFiles && !search.isPending && search.error === null;
  const matches = search.matches;
  const [resultsFor, setResultsFor] = useState(matches);
  if (resultsFor !== matches) {
    setResultsFor(matches);
    setSelectedIndex(0);
    setVisibleCount(VISIBLE_MATCH_WINDOW);
  }
  if (selectedIndex >= visibleCount) setVisibleCount(selectedIndex + VISIBLE_MATCH_WINDOW);
  const groups = groupMatches(matches.slice(0, visibleCount));
  const fileCount = new Set(matches.map((match) => match.path)).size;
  const showSearchStatus =
    search.canReadFiles && (search.hasQuery || search.isPending || search.error !== null || search.invalidRegex);

  useEffect(() => {
    rowRefs.current.get(selectedIndex)?.scrollIntoView?.();
  }, [selectedIndex]);

  const openMatch = (match: ProjectContentMatch) => {
    if (!canOpenMatches) return;
    onClose();
    requestOpenFile(target, match.path, match.lineNumber);
  };

  const onKeyDown = (event: KeyEvent) => {
    if (event.key === "escape") {
      escapeBack(onBack)(event);
      return;
    }
    if (event.key === "down" && matches.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex((current) => (current + 1) % matches.length);
    } else if (event.key === "up" && matches.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex((current) => (current - 1 + matches.length) % matches.length);
    }
  };

  return (
    <PaletteFrame onClose={onClose} height={DIALOG_HEIGHT} initialFocus={inputRef} testId="project-content-search">
      <PaletteInput
        inputRef={inputRef}
        testId="content-search-input"
        value={query}
        placeholder={`Search in ${target.projectName}`}
        disabled={!search.canReadFiles && !search.isCheckingAccess}
        onChange={setQuery}
        onKeyDown={onKeyDown}
        onSubmit={() => {
          const match = matches[selectedIndex];
          if (match) openMatch(match);
        }}
        accessoryWidth={0}
        accessory={
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 2,
              padding: 2,
              marginRight: 2,
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: alpha(theme.muted, 0.3),
              flexShrink: 0,
            }}
          >
            <SearchOptionButton active={caseSensitive} disabled={!search.canReadFiles} label="Match case" onClick={() => setCaseSensitive((value) => !value)}>
              <Text size="xs" mono color={theme.mutedForeground}>
                Aa
              </Text>
            </SearchOptionButton>
            <SearchOptionButton active={wholeWord} disabled={!search.canReadFiles} label="Match whole word" onClick={() => setWholeWord((value) => !value)}>
              <Text size="xs" mono color={theme.mutedForeground} style={{ textDecoration: "underline" }}>
                ab
              </Text>
            </SearchOptionButton>
            <SearchOptionButton active={useRegex} disabled={!search.canReadFiles} label="Use regular expression" onClick={() => setUseRegex((value) => !value)}>
              <Text size="xs" mono color={theme.mutedForeground}>
                .*
              </Text>
            </SearchOptionButton>
          </div>
        }
      />
      {showSearchStatus ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 36, paddingLeft: 12, paddingRight: 12, borderBottomWidth: 1, borderColor: theme.border, flexShrink: 0 }}>
          {search.isPending ? (
            <Text size="xs" color={theme.mutedForeground}>
              Searching…
            </Text>
          ) : search.error ? (
            <Text size="xs" color={theme.errorForeground}>
              {search.error}
            </Text>
          ) : search.invalidRegex ? (
            <Text size="xs" color={theme.errorForeground}>
              Invalid regular expression
            </Text>
          ) : (
            <Text size="xs" color={theme.mutedForeground}>
              {`${matches.length.toLocaleString()}${search.truncated ? "+" : ""} results in ${fileCount.toLocaleString()} files`}
            </Text>
          )}
        </div>
      ) : null}
      {matches.length === 0 ? (
        <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", paddingLeft: 24, paddingRight: 24 }}>
          <Text color={theme.mutedForeground} style={{ textAlign: "center" }}>
            {search.isCheckingAccess
              ? "Checking file access…"
              : !search.canReadFiles
                ? (search.error ?? "")
                : search.hasQuery && !search.isPending && !search.error
                  ? "No results found."
                  : "Type to search across your project."}
          </Text>
        </div>
      ) : (
        <PalettePanel fill padding={{ y: 8, x: 0 }}>
          {groups.flatMap((group) => {
            const path = splitPath(group.path);
            return [
              <div key={`header:${group.path}`} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingLeft: 12, paddingRight: 12, flexShrink: 0 }}>
                <Icon name="file" size={14} color={theme.mutedForeground} />
                <Text size="xs" weight={500} style={{ flexShrink: 0 }}>
                  {path.name}
                </Text>
                {path.directory ? (
                  <Text size="xs" color={theme.mutedForeground} truncate style={{ flexShrink: 1 }}>
                    {path.directory}
                  </Text>
                ) : null}
                <div style={{ flexGrow: 1 }} />
                <div style={{ display: "flex", alignItems: "center", height: 16, paddingLeft: 6, paddingRight: 6, borderRadius: 8, backgroundColor: theme.muted }}>
                  <Text size="3xs" color={theme.mutedForeground}>
                    {String(group.matches.length)}
                  </Text>
                </div>
              </div>,
              ...group.matches.map((match, index) => (
                <div
                  key={`${match.path}:${match.lineNumber}:${match.resultIndex}`}
                  ref={((instance: { scrollIntoView?: () => void } | null) => {
                    if (instance) rowRefs.current.set(match.resultIndex, instance);
                    else rowRefs.current.delete(match.resultIndex);
                  }) as never}
                  onMouseEnter={() => setSelectedIndex(match.resultIndex)}
                  onClick={() => openMatch(match)}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    height: 28,
                    paddingLeft: 12,
                    paddingRight: 12,
                    marginBottom: index === group.matches.length - 1 ? 8 : 0,
                    backgroundColor: match.resultIndex === selectedIndex ? theme.accent : "#00000000",
                    cursor: canOpenMatches ? "pointer" : "default",
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "flex-end", width: 40, flexShrink: 0 }}>
                    <Text size="xs" mono color={alpha(theme.mutedForeground, 0.7)}>
                      {String(match.lineNumber)}
                    </Text>
                  </div>
                  <MatchLine match={match} />
                </div>
              )),
            ];
          })}
          {matches.length > visibleCount ? (
            <div
              onClick={() => setVisibleCount((count) => count + VISIBLE_MATCH_WINDOW)}
              style={{ display: "flex", justifyContent: "center", paddingTop: 6, paddingBottom: 6, cursor: "pointer", flexShrink: 0 }}
            >
              <Text size="xs" color={theme.mutedForeground}>
                Show more results
              </Text>
            </div>
          ) : null}
        </PalettePanel>
      )}
      <PaletteFooter actionLabel="Open file" escapeLabel="Back" />
    </PaletteFrame>
  );
}
