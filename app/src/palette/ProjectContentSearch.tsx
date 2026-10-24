// Port of apps/web/src/components/search/ProjectContentSearchDialog.tsx: a 420px
// tall palette, Aa / ab / .* toggles, results grouped by file with line numbers.
// Each line is syntax-highlighted with its matches marked (HighlightedSearchLine).
// Like web, a file's header sticks to the top while its matches scroll under it, and
// the next 100 results load when the list nears its end (web's IntersectionObserver
// sentinel); keyboard selection past the window grows it too.
import type { EventPayload } from "@gpuix/native";
import type { KeyEvent } from "@gpuix/react";
import type { ProjectContentMatch } from "@t3tools/contracts";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";

import { Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { HighlightedSearchLine } from "../panels/code/HighlightedSearchLine.tsx";
import { FileEntryIcon } from "../panels/files/FileEntryIcon.tsx";
import { PaletteFooter, PaletteFrame, PaletteInput, paletteSurface } from "./command.tsx";
import { useProjectContentSearch } from "./hooks.ts";
import { requestOpenFile } from "./ProjectFilePicker.tsx";
import { useActiveProjectTarget, type ActiveProjectTarget } from "./projectTarget.ts";

const VISIBLE_MATCH_WINDOW = 100;
const DIALOG_HEIGHT = 420;
/** The results list: py-2, h-8 group headers, h-7 rows, pb-2 per section, an h-8 sentinel. */
const LIST_PADDING = 8;
const GROUP_HEADER_HEIGHT = 32;
const MATCH_ROW_HEIGHT = 28;
const SECTION_GAP = 8;
const SENTINEL_HEIGHT = 32;

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

/** A group's file header (web's `sticky top-0` section header). */
const GroupHeader = memo(function GroupHeader({ path, count, sticky }: { path: string; count: number; sticky?: boolean }) {
  const theme = useTheme();
  const parts = splitPath(path);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: GROUP_HEADER_HEIGHT,
        paddingLeft: 12,
        paddingRight: 12,
        flexShrink: 0,
        // bg-popover/95 with backdrop-blur on web; GPUI has no backdrop blur, so the pinned
        // copy is the palette surface, opaque, or the rows under it would show through sharp.
        ...(sticky ? { backgroundColor: paletteSurface(theme).background } : {}),
      }}
    >
      {/* PierreEntryIcon className="size-3.5" */}
      <FileEntryIcon pathValue={path} kind="file" size={14} />
      <Text size="xs" weight={500} style={{ flexShrink: 0 }}>
        {parts.name}
      </Text>
      {parts.directory ? (
        <Text size="xs" color={theme.mutedForeground} truncate style={{ flexShrink: 1 }}>
          {parts.directory}
        </Text>
      ) : null}
      <div style={{ flexGrow: 1 }} />
      <div style={{ display: "flex", alignItems: "center", height: 16, paddingLeft: 6, paddingRight: 6, borderRadius: 8, backgroundColor: theme.muted }}>
        <Text size="3xs" color={theme.mutedForeground}>
          {String(count)}
        </Text>
      </div>
    </div>
  );
});

/** Where each group's section starts and ends in the list (rows have fixed heights). */
function groupOffsets(groups: ReadonlyArray<MatchGroup>): Array<{ top: number; bottom: number }> {
  let top = LIST_PADDING;
  return groups.map((group) => {
    const bottom = top + GROUP_HEADER_HEIGHT + group.matches.length * MATCH_ROW_HEIGHT + SECTION_GAP;
    const offsets = { top, bottom };
    top = bottom;
    return offsets;
  });
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
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
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
    setScrollTop(0);
  }
  if (selectedIndex >= visibleCount) setVisibleCount(selectedIndex + VISIBLE_MATCH_WINDOW);
  const groups = groupMatches(matches.slice(0, visibleCount));
  const offsets = groupOffsets(groups);
  const contentHeight = (offsets.at(-1)?.bottom ?? LIST_PADDING) + (matches.length > visibleCount ? SENTINEL_HEIGHT : 0) + LIST_PADDING;
  // The sentinel came into view: load the next window, as web's observer does.
  const sentinelVisible = matches.length > visibleCount && viewportHeight > 0 && scrollTop + viewportHeight >= contentHeight - LIST_PADDING - SENTINEL_HEIGHT;
  useEffect(() => {
    if (sentinelVisible) setVisibleCount((count) => count + VISIBLE_MATCH_WINDOW);
  }, [sentinelVisible]);
  // The section under the list's top edge pins its header there until the section ends.
  const stickyGroupIndex = offsets.findIndex((offset) => scrollTop > offset.top && scrollTop < offset.bottom);
  const stickyGroup = stickyGroupIndex >= 0 ? groups[stickyGroupIndex] : undefined;
  const stickyTop = stickyGroupIndex >= 0 ? Math.min(0, offsets[stickyGroupIndex]!.bottom - SECTION_GAP - scrollTop - GROUP_HEADER_HEIGHT) : 0;
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
        <div style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
          <div
            testId="command-palette-results"
            onLayout={(event: EventPayload) => {
              const next = Math.floor(Number(event.height ?? 0));
              if (next !== viewportHeight) setViewportHeight(next);
            }}
            onScrollChange={(event: EventPayload) => setScrollTop(Math.max(0, -Number(event.scrollY ?? 0)))}
            style={{
              display: "flex",
              flexDirection: "column",
              paddingTop: LIST_PADDING,
              paddingBottom: LIST_PADDING,
              flexGrow: 1,
              flexShrink: 1,
              minHeight: 0,
              overflowY: "scroll",
              scrollbarColor: theme.scrollbar,
              scrollbarWidth: 6,
            }}
          >
            {groups.flatMap((group) => [
              <GroupHeader key={`header:${group.path}`} path={group.path} count={group.matches.length} />,
              ...group.matches.map((match, index) => (
                <div
                  key={`${match.path}:${match.lineNumber}:${match.resultIndex}`}
                  testId={`content-search-result-${match.resultIndex}`}
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
                    height: MATCH_ROW_HEIGHT,
                    paddingLeft: 12,
                    paddingRight: 12,
                    marginBottom: index === group.matches.length - 1 ? SECTION_GAP : 0,
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
                  <HighlightedSearchLine match={match} path={match.path} />
                </div>
              )),
            ])}
            {/* web's load-more sentinel: an empty h-8 row; reaching it loads the next 100. */}
            {matches.length > visibleCount ? <div testId="content-search-sentinel" style={{ height: SENTINEL_HEIGHT, flexShrink: 0 }} /> : null}
          </div>
          {stickyGroup ? (
            // Painted after the list so it covers the rows scrolling under it.
            <div style={{ position: "absolute", left: 0, right: 6, top: stickyTop, height: GROUP_HEADER_HEIGHT, overflow: "hidden" }}>
              <GroupHeader path={stickyGroup.path} count={stickyGroup.matches.length} sticky />
            </div>
          ) : null}
        </div>
      )}
      <PaletteFooter actionLabel="Open file" escapeLabel="Back" />
    </PaletteFrame>
  );
}
