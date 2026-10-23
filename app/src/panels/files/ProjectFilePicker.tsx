// Port of apps/web/src/components/files/ProjectFilePicker.tsx with the command palette
// chrome it renders through (CommandPaletteContent, CommandPaletteResults, ui/command.tsx
// and the CommandDialog popup). Metrics follow docs/web-ui-spec.md "Command palette".
import { dialogGlassShadow } from "../../ui/overlay.tsx";
import { useAtomValue } from "@effect/atom-react";
import { useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from "@gpuix/react";
import * as DialogPrimitive from "@gpuix/react/dialog";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Fragment, useRef, useState, type ReactNode } from "react";

import { openFileInActiveThread } from "../../state/rightPanel.ts";
import { routeAtom } from "../../state/ui.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  getProjectFilePickerMatches,
  PROJECT_FILE_PICKER_RESULT_LIMIT,
  type ProjectFilePickerMatch,
} from "../../web/components/files/ProjectFilePicker.logic.ts";
import { useProjectFilePickerQuery } from "../../web/components/files/projectFilesQueryState.ts";
import { FileEntryIcon } from "./FileEntryIcon.tsx";
import { useThreadWorkspace } from "./FilesSurface.tsx";

const PANEL_WIDTH = 576;
/** max-h-[min(34rem,76vh)] for the "tall-list" panel. */
const TALL_LIST_MAX_HEIGHT = 544;

interface ActiveProjectTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
}

/**
 * useActiveProjectTarget: the routed thread's workspace. The web also targets a draft
 * thread's project; t3-term's draft route has no thread to open a file in, so a draft
 * shows the no-project state.
 */
function ThreadPickerBody(props: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId; readonly close: () => void }) {
  const workspace = useThreadWorkspace(props.environmentId, props.threadId);
  if (workspace === null) return <EmptyProjectFilePicker />;
  const target = { environmentId: props.environmentId, cwd: workspace.cwd, projectName: workspace.projectName };
  return <OpenProjectFilePicker key={`${target.environmentId}:${target.cwd}`} target={target} close={props.close} />;
}

function PickerBody(props: { readonly close: () => void }) {
  const route = useAtomValue(routeAtom);
  if (route.kind !== "thread") return <EmptyProjectFilePicker />;
  return <ThreadPickerBody environmentId={route.environmentId} threadId={route.threadId} close={props.close} />;
}

function EmptyProjectFilePicker() {
  return (
    <PickerChrome value="" disabled>
      <EmptyState message="Open a project to search its files." />
    </PickerChrome>
  );
}

function getEmptyStateMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  const isSearching = query.trim().length > 0;
  if (isPending) return isSearching ? "Searching workspace files…" : "Indexing workspace files…";
  return isSearching ? "No matching files." : "No files found.";
}

/** Matched characters in semibold foreground over muted text, as one wrapped run. */
function HighlightedFuzzyText(props: {
  readonly active: boolean;
  readonly indices: ReadonlyArray<number>;
  readonly value: string;
  readonly size: number;
  readonly lineHeight: number;
  readonly color: string;
  readonly matchColor: string;
  readonly mutedColor: string;
}) {
  const base = {
    fontSize: props.size,
    lineHeight: props.lineHeight,
    fontFamily: FONTS.sans,
    whiteSpace: "nowrap" as const,
    pointerEvents: "none" as const,
  };
  if (!props.active || props.indices.length === 0) {
    return (
      <text style={{ ...base, color: props.active ? props.mutedColor : props.color, textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
        {props.value}
      </text>
    );
  }
  const parts: ReactNode[] = [];
  let start = 0;
  for (const index of props.indices) {
    if (start < index) {
      parts.push(
        <text key={`t${start}`} style={{ ...base, color: props.mutedColor }}>
          {props.value.slice(start, index)}
        </text>,
      );
    }
    parts.push(
      <text key={`m${index}`} style={{ ...base, color: props.matchColor, fontWeight: 600 }}>
        {props.value[index]}
      </text>,
    );
    start = index + 1;
  }
  if (start < props.value.length) {
    parts.push(
      <text key={`t${start}`} style={{ ...base, color: props.mutedColor }}>
        {props.value.slice(start)}
      </text>,
    );
  }
  return <div style={{ display: "flex", flexDirection: "row", overflow: "hidden", minWidth: 0 }}>{parts}</div>;
}

function Kbd(props: { readonly children?: string; readonly icon?: IconName }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 20,
        height: 20,
        paddingLeft: props.icon ? 0 : 4,
        paddingRight: props.icon ? 0 : 4,
        borderRadius: 4,
        backgroundColor: alpha(theme.foreground, 0.08),
        flexShrink: 0,
      }}
    >
      {props.icon ? (
        <Icon name={props.icon} size={12} color={theme.foreground} />
      ) : (
        <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, fontWeight: 500 }}>
          {props.children}
        </text>
      )}
    </div>
  );
}

function FooterHint(props: { readonly keys: ReactNode; readonly label: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>{props.keys}</div>
      <text style={{ color: theme.mutedForeground, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans, fontWeight: 500 }}>
        {props.label}
      </text>
    </div>
  );
}

/** CommandPaletteContent: search input, results panel, footer hints. */
function PickerChrome(props: {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onValueChange?: (value: string) => void;
  readonly onKeyDown?: (event: KeyEvent) => void;
  readonly onSubmit?: () => void;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 50, paddingLeft: 18, paddingRight: 16 }}>
        <Icon name="search" size={16} color={theme.mutedForeground} />
        <input
          testId="project-file-picker-input"
          autoFocus={!props.disabled}
          readOnly={props.disabled}
          value={props.value}
          placeholder="Search files…"
          onChange={(event) => props.onValueChange?.(String(event.value ?? ""))}
          onKeyDown={props.onKeyDown}
          onSubmit={() => props.onSubmit?.()}
          theme={{ caret: theme.foreground }}
          style={{
            flexGrow: 1,
            minWidth: 0,
            height: 36,
            fontSize: 14,
            fontFamily: FONTS.sans,
            color: theme.foreground,
            backgroundColor: "#00000000",
            opacity: props.disabled ? 0.64 : 1,
          }}
        />
      </div>
      {props.children}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 16,
          paddingRight: 16,
          backgroundColor: alpha(theme.foreground, 0.025),
        }}
      >
        <FooterHint
          keys={
            <>
              <Kbd icon="arrow-up" />
              <Kbd icon="arrow-down" />
            </>
          }
          label="Navigate"
        />
        <FooterHint keys={<Kbd>Enter</Kbd>} label="Open file" />
        <FooterHint keys={<Kbd>Esc</Kbd>} label="Back" />
      </div>
    </>
  );
}

function EmptyState(props: { readonly message: string }) {
  const theme = useTheme();
  return (
    <div testId="project-file-picker-empty" style={{ display: "flex", justifyContent: "center", paddingTop: 40, paddingBottom: 40 }}>
      <text style={{ color: theme.mutedForeground, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans }}>{props.message}</text>
    </div>
  );
}

function ResultRow(props: {
  readonly match: ProjectFilePickerMatch;
  readonly highlighted: boolean;
  readonly hasMatchedQuery: boolean;
  readonly onHover: () => void;
  readonly onPress: () => void;
  readonly rowRef: (instance: PublicInstance | null) => void;
}) {
  const theme = useTheme();
  const { match } = props;
  return (
    <div
      ref={props.rowRef}
      testId={`project-file-picker-row:${match.path}`}
      onMouseEnter={props.onHover}
      onClick={props.onPress}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        cursor: "pointer",
        backgroundColor: props.highlighted ? theme.accent : "#00000000",
      }}
    >
      <div style={{ display: "flex", height: 20, alignItems: "center", flexShrink: 0, paddingTop: 2 }}>
        <FileEntryIcon pathValue={match.path} kind="file" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <HighlightedFuzzyText
          active={props.hasMatchedQuery}
          value={match.name}
          indices={match.nameMatchIndices}
          size={14}
          lineHeight={20}
          color={theme.foreground}
          matchColor={theme.foreground}
          mutedColor={theme.mutedForeground}
        />
        <HighlightedFuzzyText
          active={props.hasMatchedQuery}
          value={match.path}
          indices={match.pathMatchIndices}
          size={12}
          lineHeight={16}
          color={alpha(theme.mutedForeground, 0.7)}
          matchColor={theme.foreground}
          mutedColor={theme.mutedForeground}
        />
      </div>
    </div>
  );
}

function OpenProjectFilePicker(props: { readonly target: ActiveProjectTarget; readonly close: () => void }) {
  const { target } = props;
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const [query, setQuery] = useState("");
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, PublicInstance>());
  const result = useProjectFilePickerQuery(target.environmentId, target.cwd, query, PROJECT_FILE_PICKER_RESULT_LIMIT);
  const matches = getProjectFilePickerMatches(result.entries, result.matchedQuery);
  const hasMatchedQuery = /\S/.test(result.matchedQuery);
  // autoHighlight="always": Enter opens the first row until the arrows pick another.
  const highlightedIndex = Math.max(0, matches.findIndex((match) => match.path === highlightedPath));
  const activePath = highlightedPath !== null && matches.some((match) => match.path === highlightedPath) ? highlightedPath : null;

  const open = (path: string) => {
    props.close();
    openFileInActiveThread(path);
  };

  const move = (delta: number) => {
    if (matches.length === 0) return;
    const current = activePath === null ? (delta > 0 ? -1 : matches.length) : highlightedIndex;
    const next = matches[Math.min(matches.length - 1, Math.max(0, current + delta))]!;
    setHighlightedPath(next.path);
    const row = rowRefs.current.get(next.path);
    if (row) renderer.scrollIntoView?.(row.id);
  };

  return (
    <PickerChrome
      value={query}
      onValueChange={(value) => {
        setHighlightedPath(null);
        setQuery(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "down") {
          event.preventDefault();
          move(1);
        } else if (event.key === "up") {
          event.preventDefault();
          move(-1);
        }
      }}
      onSubmit={() => {
        const match = matches[highlightedIndex];
        if (match) open(match.path);
      }}
    >
      {matches.length === 0 ? (
        <EmptyState message={getEmptyStateMessage(query, result.error, result.isPending)} />
      ) : (
        <div
          testId="project-file-picker-list"
          style={{ display: "flex", flexDirection: "column", maxHeight: TALL_LIST_MAX_HEIGHT, overflowY: "scroll", padding: 8 }}
        >
          <div style={{ display: "flex", paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, flexShrink: 0 }}>
            <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, fontWeight: 500 }}>
              {target.projectName}
            </text>
          </div>
          {matches.map((match) => (
            <Fragment key={match.path}>
              <ResultRow
                match={match}
                highlighted={activePath === match.path}
                hasMatchedQuery={hasMatchedQuery}
                onHover={() => setHighlightedPath(match.path)}
                onPress={() => open(match.path)}
                rowRef={(instance) => {
                  if (instance) rowRefs.current.set(match.path, instance);
                  else rowRefs.current.delete(match.path);
                }}
              />
            </Fragment>
          ))}
        </div>
      )}
    </PickerChrome>
  );
}

/**
 * The Go to file dialog (mod+P). Self-contained: the host mounts it and owns `open`.
 * Picking a file opens it in the routed thread's right panel.
 */
export function ProjectFilePicker(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const theme = useTheme();
  const windowSize = useWindowSize();
  const top = Math.max(16, Math.round(windowSize.height * 0.1));
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: top }}>
        <DialogPrimitive.Backdrop
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.overlay, pointerEvents: "auto" }}
        />
        <DialogPrimitive.Popup
          testId="project-file-picker"
          aria-label="File picker"
          style={{
            display: "flex",
            flexDirection: "column",
            width: PANEL_WIDTH,
            maxWidth: "92%",
            borderRadius: RADIUS["2xl"],
            borderWidth: 1,
            borderColor: theme.appearance === "dark" ? alpha("#ffffff", 0.08) : alpha(theme.foreground, 0.1),
            backgroundColor: theme.background,
            boxShadow: dialogGlassShadow(theme),
            overflow: "hidden",
          }}
        >
          <PickerBody close={() => props.onOpenChange(false)} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
