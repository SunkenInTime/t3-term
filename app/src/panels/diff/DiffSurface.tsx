// The right panel's Diff surface: port of apps/web/src/components/DiffPanel.tsx
// (+ DiffPanelShell.tsx, diffPanelStore.ts, lib/diffCollapse.ts). Scopes: the
// branch's changes against its base (with a base-ref picker), uncommitted
// changes, the latest turn or any earlier turn. DiffView paints the patch the
// way @pierre/diffs does on the web (stacked/split, wrap) in one windowed
// virtual list, so nothing nests a vertical scroller.
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  AuthFilesystemReadScope,
  type EnvironmentId,
  type ReviewDiffPreviewSource,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  environmentThreadDetails,
  environmentThreadShells,
  projectIndexAtom,
} from "../../state/environment.ts";
import {
  diffCollapsedFilesAtom,
  diffFileTreeOpenPref,
  diffFilesCollapsedPref,
  diffIgnoreWhitespacePref,
  diffSelectionAtom,
  orchestrationEnvironment,
  reviewEnvironment,
  selectDiffBaseRef,
  selectDiffGitScope,
  selectDiffTurn,
  vcsEnvironment,
} from "../../state/git.ts";
import { rightPanelActions } from "../../state/rightPanel.ts";
import { composerTargetKey } from "../../state/composer.ts";
import { diffLayoutPref, wordWrapPref } from "../../state/codeView.ts";
import { ActionMenu } from "../../chat/header/ActionMenu.tsx";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { areAllDiffFilesCollapsed, toggleAllDiffFiles } from "../../web/lib/diffCollapse.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { useEnvironmentScope } from "../../web/state/session.ts";
import { resolveDiffPathForWorkspace } from "../../web/diffFileActions.ts";
import { parseDiffFiles } from "./diffModel.ts";
import { DiffView } from "./DiffView.tsx";
import { DiffFileTree } from "./DiffFileTree.tsx";
import { DiffBaseRefPicker } from "./DiffBaseRefPicker.tsx";

const LAZY_FILE_BATCH = 20;
const EMPTY_SET: ReadonlySet<string> = new Set();
const FILE_PATH_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function shortTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatCompactDiffCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  const m = value / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}m`;
}

/** chat/DiffStatLabel.tsx, inline layout. */
export function DiffStatLabel({ additions, deletions, size = 11 }: { additions: number; deletions: number; size?: number }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <text style={{ color: theme.diffAdd, fontSize: size, lineHeight: 16, fontFamily: FONTS.mono }}>{`+${formatCompactDiffCount(additions)}`}</text>
      <text style={{ color: theme.diffDel, fontSize: size, lineHeight: 16, fontFamily: FONTS.mono }}>{`-${formatCompactDiffCount(deletions)}`}</text>
    </div>
  );
}

/** Button size="icon-sm" variant="ghost" / Toggle size="sm": 28 square, radius 8. */
function HeaderIconButton({
  icon,
  tooltip,
  onClick,
  pressed,
  disabled,
  testId,
}: {
  icon: IconName;
  tooltip: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  testId: string;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={tooltip}>
      <div
        testId={testId}
        onClick={disabled ? undefined : onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: RADIUS.md,
          flexShrink: 0,
          opacity: disabled ? 0.64 : 1,
          cursor: disabled ? "default" : "pointer",
          backgroundColor: pressed ? theme.accent : "#00000000",
          ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
        }}
      >
        <Icon name={icon} size={14} color={alpha(theme.foreground, 0.8)} />
      </div>
    </Tooltip>
  );
}

function CenteredNote({ children, tone }: { children: ReactNode; tone?: "error" }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", paddingLeft: 20, paddingRight: 20 }}>
      <text
        style={{
          color: tone === "error" ? alpha(theme.errorForeground, 0.8) : alpha(theme.mutedForeground, 0.7),
          fontSize: 12,
          lineHeight: 16,
          fontFamily: FONTS.sans,
          textAlign: "center",
        }}
      >
        {children}
      </text>
    </div>
  );
}

/** DiffPanelLoadingState: static skeleton bars (no shimmer: t3-term never repaints idle). */
function LoadingState() {
  const theme = useTheme();
  const bar = (width: number | "100%", height = 12) => (
    <div style={{ width, height, borderRadius: height / 2, backgroundColor: alpha(theme.foreground, 0.06), flexShrink: 0 }} />
  );
  const header = (width: number) => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingLeft: 8, paddingRight: 12 }}>
      {bar(10, 10)}
      {bar(20, 20)}
      {bar(width)}
      <div style={{ flexGrow: 1 }} />
      {bar(20)}
      {bar(20)}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      {header(260)}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
        {bar(340, 10)}
        {bar(420, 10)}
        {bar(300, 10)}
      </div>
      {header(180)}
      {header(320)}
    </div>
  );
}

/** Loads one file's patch from a truncated preview (useReviewFilePatches). Renders nothing. */
function LazyFilePatch({
  environmentId,
  cwd,
  source,
  file,
  ignoreWhitespace,
  onLoaded,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  source: ReviewDiffPreviewSource;
  file: { path: string; previousPath: string | null };
  ignoreWhitespace: boolean;
  onLoaded: (path: string, patch: string | null, error: string | null) => void;
}) {
  const query = useEnvironmentQuery(
    reviewEnvironment.diffFilePatch({
      environmentId,
      input: {
        request: {
          cwd,
          ...(source.baseRef ? { baseRef: source.baseRef } : {}),
          ignoreWhitespace,
          file: { path: file.path, previousPath: file.previousPath, sourceKind: source.kind },
        },
        cacheKey: `${source.diffHash}:${file.path}:${ignoreWhitespace}`,
      },
    } as never),
  ) as { data: ReviewDiffPreviewSource | null; error: string | null };
  useEffect(() => {
    if (query.data) onLoaded(file.path, query.data.diff, null);
    else if (query.error) onLoaded(file.path, null, query.error);
  }, [query.data, query.error]);
  return null;
}

export function DiffSurface({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const theme = useTheme();
  const ref = { environmentId, threadId };
  const threadKey = scopedThreadKey(ref);
  const thread = useAtomValue(environmentThreadShells.threadShellAtom(ref as never)) as EnvironmentThreadShell | null | undefined;
  const projects = useAtomValue(projectIndexAtom);
  const project = thread ? projects.get(`${environmentId}:${thread.projectId}`) : undefined;
  const activeCwd = thread?.worktreePath ?? project?.workspaceRoot ?? null;
  const canReadFiles = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const selection = useAtomValue(diffSelectionAtom(threadKey));
  const ignoreWhitespace = useAtomValue(diffIgnoreWhitespacePref.atom);
  const fileTreeOpen = useAtomValue(diffFileTreeOpenPref.atom);
  const filesCollapsedByDefault = useAtomValue(diffFilesCollapsedPref.atom);
  const diffLayout = useAtomValue(diffLayoutPref.atom);
  // DiffPanel: wrap starts from the wordWrap setting and stays local to the panel.
  const [wordWrap, setWordWrap] = useState(() => appAtomRegistry.get(wordWrapPref.atom));
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [lazyLimit, setLazyLimit] = useState(LAZY_FILE_BATCH);
  const [lazyPatches, setLazyPatches] = useState<{ key: string; byPath: ReadonlyMap<string, string | null> }>({ key: "", byPath: new Map() });

  const status = useEnvironmentQuery(activeCwd ? vcsEnvironment.status({ environmentId, input: { cwd: activeCwd } }) : null);
  const isGitRepo = status.data?.isRepo ?? true;
  const summaries = useAtomValue(environmentThreadDetails.checkpointSummariesAtom(ref as never)) as ReadonlyArray<ThreadCheckpointSummary>;
  const ordered = summaries.toSorted((left, right) =>
    left.checkpointTurnCount !== right.checkpointTurnCount
      ? right.checkpointTurnCount - left.checkpointTurnCount
      : right.completedAt.localeCompare(left.completedAt),
  );
  const latestTurn = ordered[0];

  // diffPanelStore.reconcileTurnSelection: a selected turn that disappeared falls back to the latest.
  useEffect(() => {
    if (selection.kind !== "turn" || !latestTurn) return;
    if (!ordered.some((summary) => summary.runId === selection.turnId)) selectDiffTurn(ref, latestTurn.runId);
  }, [selection, latestTurn?.runId]);

  const selectedRunId = selection.kind === "turn" ? selection.turnId : null;
  const gitScope = selection.kind === "unstaged" ? "unstaged" : "branch";
  const selectedBaseRef = selection.kind === "branch" ? selection.baseRef : null;
  const selectedTurn = selectedRunId === null ? undefined : (ordered.find((summary) => summary.runId === selectedRunId) ?? ordered[0]);
  const turnCount = selectedTurn?.checkpointTurnCount;
  const scopeLabel =
    selectedRunId === null
      ? gitScope === "unstaged"
        ? "Uncommitted"
        : "Changes"
      : selectedTurn?.runId === latestTurn?.runId
        ? "Latest turn"
        : `Turn ${turnCount ?? "?"}`;
  const sectionId = selectedTurn ? `turn:${selectedTurn.runId}` : gitScope;
  const sectionTitle = selectedTurn ? `Turn ${turnCount ?? "?"}` : gitScope === "unstaged" ? "Uncommitted" : "Changes";
  const scopeKey = `${threadKey}:${sectionId}`;
  const commentsConfig = useMemo(
    () => ({ sectionId, sectionTitle, draftKey: composerTargetKey({ kind: "thread", environmentId, threadId }) }),
    [sectionId, sectionTitle, environmentId, threadId],
  );
  const [treeReveal, setTreeReveal] = useState<{ path: string; requestId: number } | null>(null);
  const [bodyWidth, setBodyWidth] = useState(0);

  const turnTarget =
    selectedTurn && typeof turnCount === "number" && isGitRepo
      ? {
          environmentId,
          input: {
            threadId,
            ...(turnCount - 1 > 0 ? { fromTurnCount: turnCount - 1 } : {}),
            toTurnCount: turnCount,
            ignoreWhitespace,
          },
        }
      : null;
  const fullThreadDiff = useEnvironmentQuery(
    turnTarget && turnCount === 1 ? orchestrationEnvironment.fullThreadDiff(turnTarget as never) : null,
  ) as { data: { diff: string } | null; error: string | null; isPending: boolean; refresh: () => void };
  const turnDiff = useEnvironmentQuery(
    turnTarget && turnCount !== 1 ? orchestrationEnvironment.turnDiff({ ...turnTarget, input: { ...turnTarget.input, fromTurnCount: (turnCount ?? 1) - 1 } } as never) : null,
  ) as { data: { diff: string } | null; error: string | null; isPending: boolean; refresh: () => void };
  const checkpointDiff = turnCount === 1 ? fullThreadDiff : turnDiff;

  const preview = useEnvironmentQuery(
    canReadFiles && selectedRunId === null && activeCwd && isGitRepo
      ? reviewEnvironment.diffPreview({
          environmentId,
          input: { cwd: activeCwd, ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}), ignoreWhitespace },
        })
      : null,
  );
  const gitSource = preview.data?.sources.find(
    (source) => source.kind === (gitScope === "unstaged" ? "working-tree" : "branch-range"),
  );
  const lazySource = !selectedTurn && gitSource?.truncated && gitSource.files ? gitSource : null;
  const lazyKey = lazySource ? `${lazySource.diffHash}:${ignoreWhitespace}` : "";
  const lazyFiles = lazySource?.files?.toSorted((left, right) => FILE_PATH_COLLATOR.compare(left.path, right.path)).slice(0, lazyLimit) ?? [];
  const lazyMap = lazyPatches.key === lazyKey ? lazyPatches.byPath : new Map<string, string | null>();

  const rawPatch = selectedTurn
    ? (checkpointDiff.data?.diff ?? null)
    : lazySource
      ? lazyFiles
          .map((file) => lazyMap.get(file.path))
          .filter((patch): patch is string => typeof patch === "string")
          // A truncated file patch can end mid-line; the next file must start on its own line.
          .map((patch) => (patch.length === 0 || patch.endsWith("\n") ? patch : `${patch}\n`))
          .join("")
      : (gitSource?.diff ?? null);
  // useReviewFilePatches: files in path order (numeric, case-insensitive).
  const files = useMemo(
    () => parseDiffFiles(rawPatch).toSorted((left, right) => FILE_PATH_COLLATOR.compare(left.path, right.path)),
    [rawPatch],
  );
  const patchQuery = selectedTurn ? checkpointDiff : preview;
  const isLoading = patchQuery.isPending && patchQuery.data === null;
  const patchError = selectedTurn ? checkpointDiff.error : preview.error;
  const sourceStat =
    !selectedTurn && gitSource?.files
      ? gitSource.files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), {
          additions: 0,
          deletions: 0,
        })
      : null;
  const lineStat = sourceStat ?? files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 });

  const storedCollapsed = useAtomValue(diffCollapsedFilesAtom(scopeKey));
  const fileKeys = files.map((file) => file.path);
  const collapsed = storedCollapsed ?? (filesCollapsedByDefault ? new Set(fileKeys) : EMPTY_SET);
  const allCollapsed = areAllDiffFilesCollapsed(fileKeys, collapsed);
  // A fresh Set each render (default-collapsed case) must not rebuild every row.
  const collapsedKey = [...collapsed].join("\n");
  const collapsedSet = useMemo(() => collapsed, [collapsedKey]);

  const updateCollapsed = (update: (current: ReadonlySet<string>) => ReadonlySet<string>) =>
    appAtomRegistry.set(diffCollapsedFilesAtom(scopeKey), update(collapsed));
  // DiffPanel.revealDiffFile: unfold the file and bring its header to the top.
  const revealDiffFile = (path: string) => {
    if (!files.some((file) => file.path === path)) return;
    if (collapsed.has(path)) {
      updateCollapsed((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
    setTreeReveal((current) => ({ path, requestId: (current?.requestId ?? 0) + 1 }));
  };
  const toggleFile = (path: string) =>
    updateCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // DiffPanel refreshes the git preview whenever the panel opens on it.
  useEffect(() => {
    if (preview.data !== null && !preview.isPending) preview.refresh();
  }, [threadKey]);

  const scopeItems = [
    { id: "branch", label: "Changes", checked: selectedRunId === null && gitScope === "branch" },
    { id: "unstaged", label: "Uncommitted", checked: selectedRunId === null && gitScope === "unstaged" },
    { id: "latest", label: "Latest turn", checked: selectedTurn !== undefined && selectedTurn.runId === latestTurn?.runId, disabled: !latestTurn },
    {
      id: "turn",
      label: "Turn",
      separatorBefore: true,
      disabled: ordered.length === 0,
      children: ordered.map((summary) => ({
        id: `turn:${summary.runId}`,
        label: `Turn ${summary.checkpointTurnCount}  ·  ${shortTime(summary.completedAt)}`,
        checked: selectedTurn?.runId === summary.runId,
      })),
    },
  ];

  const header = (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        // In the right panel (data-preview-panel-mode=inline) the row is h-7 with
        // mb-3 and a transparent border.
        height: 28,
        marginBottom: 12,
        flexShrink: 0,
        paddingLeft: 8,
        paddingRight: 8,
        backgroundColor: theme.background,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1, minWidth: 0 }}>
        <ActionMenu
          open={scopeMenuOpen}
          onOpenChange={setScopeMenuOpen}
          items={scopeItems as never}
          testId="diff-scope-menu"
          onSelect={(id: string) => {
            if (id === "branch" || id === "unstaged") selectDiffGitScope(ref, id);
            else if (id === "latest" && latestTurn) selectDiffTurn(ref, latestTurn.runId);
            else if (id.startsWith("turn:")) selectDiffTurn(ref, id.slice(5) as RunId);
          }}
          trigger={
            <div
              testId="diff-scope"
              onClick={() => setScopeMenuOpen(!scopeMenuOpen)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                height: 24,
                paddingLeft: 7,
                paddingRight: 7,
                borderRadius: RADIUS.md,
                backgroundColor: alpha(theme.foreground, 0.06),
                cursor: "pointer",
                hover: { backgroundColor: alpha(theme.foreground, 0.1) },
              }}
            >
              <Text size="xs" weight={500}>
                {scopeLabel}
              </Text>
              <Icon name="chevron-down" size={14} color={alpha(theme.foreground, 0.7)} />
            </div>
          }
        />
        {selectedRunId === null && gitScope === "branch" && gitSource?.baseRef ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden" }}>
            <Tooltip content={`${gitSource.headRef ?? "HEAD"} → ${gitSource.baseRef}`}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 }}>
                <Text size="xs" color={theme.mutedForeground} truncate style={{ maxWidth: 192 }}>
                  {gitSource.headRef ?? "HEAD"}
                </Text>
                <Icon name="arrow-right" size={14} color={alpha(theme.mutedForeground, 0.7)} />
              </div>
            </Tooltip>
            <DiffBaseRefPicker
              environmentId={environmentId}
              cwd={preview.data?.cwd ?? activeCwd ?? ""}
              headRef={gitSource.headRef ?? null}
              baseRef={gitSource.baseRef}
              selectedBaseRef={selectedBaseRef}
              onSelect={(baseRef) => selectDiffBaseRef(ref, baseRef)}
            />
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {files.length > 0 || (!selectedTurn && (gitSource?.files?.length ?? 0) > 0) ? (
          <div style={{ marginRight: 4 }}>
            <DiffStatLabel additions={lineStat.additions} deletions={lineStat.deletions} />
          </div>
        ) : null}
        {selectedRunId === null && isGitRepo ? (
          <HeaderIconButton
            icon="refresh-cw"
            testId="diff-refresh"
            tooltip={preview.isPending ? "Refreshing diff…" : "Refresh diff"}
            onClick={() => preview.refresh()}
          />
        ) : null}
        {fileKeys.length > 0 ? (
          <HeaderIconButton
            icon={allCollapsed ? "chevrons-up-down" : "chevrons-down-up"}
            testId="diff-collapse-all"
            tooltip={allCollapsed ? "Expand all files" : "Collapse all files"}
            onClick={() => updateCollapsed((current) => toggleAllDiffFiles(fileKeys, current))}
          />
        ) : null}
        <LayoutToggle value={diffLayout} onChange={(next) => diffLayoutPref.set(next)} />
        <HeaderIconButton
          icon="text-wrap"
          testId="diff-wrap"
          pressed={wordWrap}
          tooltip={wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
          onClick={() => setWordWrap(!wordWrap)}
        />
        <HeaderIconButton
          icon="pilcrow"
          testId="diff-whitespace"
          pressed={ignoreWhitespace}
          tooltip={ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
          onClick={() => diffIgnoreWhitespacePref.set(!ignoreWhitespace)}
        />
        {fileKeys.length > 0 ? (
          <HeaderIconButton
            icon="folder-tree"
            testId="diff-file-tree"
            pressed={fileTreeOpen}
            tooltip={fileTreeOpen ? "Hide file tree" : "Show file tree"}
            onClick={() => diffFileTreeOpenPref.set(!fileTreeOpen)}
          />
        ) : null}
      </div>
    </div>
  );

  let body: ReactNode;
  if (!thread) body = <CenteredNote>Select a thread to inspect turn diffs.</CenteredNote>;
  else if (!isGitRepo) body = <CenteredNote>Turn diffs are unavailable because this project is not a git repository.</CenteredNote>;
  else if (selectedRunId !== null && ordered.length === 0) body = <CenteredNote>No completed turns yet.</CenteredNote>;
  else if (selectedRunId === null && !canReadFiles) body = <CenteredNote>This connection cannot read local diffs.</CenteredNote>;
  else if (isLoading) body = <LoadingState />;
  else if (files.length === 0 && !lazySource) {
    body = patchError ? (
      <CenteredNote tone="error">{patchError}</CenteredNote>
    ) : (
      <CenteredNote>{rawPatch !== null && rawPatch.trim().length === 0 ? "No net changes in this selection." : "No patch available for this selection."}</CenteredNote>
    );
  } else {
    body = (
      <div
        onLayout={(event) => {
          const next = Math.floor(Number(event.width ?? 0));
          if (next > 0 && next !== bodyWidth) setBodyWidth(next);
        }}
        style={{ display: "flex", flexDirection: "row", width: "100%", flexGrow: 1, minHeight: 0, overflow: "hidden" }}
      >
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
          {gitSource?.truncated && !selectedTurn ? (
            <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.7), backgroundColor: alpha(theme.muted, 0.4), flexShrink: 0 }}>
              <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans }}>
                {lazySource
                  ? `This change is large, so files load in batches (${Math.min(lazyLimit, lazySource.files?.length ?? 0)} of ${lazySource.files?.length ?? 0}).`
                  : "This preview exceeds the size limit. Changes shown are incomplete."}
              </text>
            </div>
          ) : null}
          <DiffView
            files={files}
            layout={diffLayout}
            wrap={wordWrap}
            collapsed={collapsedSet}
            resetKey={scopeKey}
            comments={commentsConfig}
            reveal={treeReveal}
            onToggleFile={toggleFile}
            onOpenFile={(path) => {
              const relative = resolveDiffPathForWorkspace({
                filePath: path,
                workspaceRoot: activeCwd ?? undefined,
                repositoryRoot: thread?.worktreePath ? undefined : (project?.repositoryIdentity?.rootPath ?? undefined),
              });
              if (relative) rightPanelActions.openFile(threadKey, relative);
            }}
          />
          {lazySource && (lazySource.files?.length ?? 0) > lazyLimit ? (
            <div
              testId="diff-load-more"
              onClick={() => setLazyLimit(lazyLimit + LAZY_FILE_BATCH)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 32, flexShrink: 0, borderTopWidth: 1, borderColor: alpha(theme.border, 0.6), cursor: "pointer", hover: { backgroundColor: theme.accent } }}
            >
              <Text size="xs" color={theme.mutedForeground}>{`Load ${Math.min(LAZY_FILE_BATCH, (lazySource.files?.length ?? 0) - lazyLimit)} more files`}</Text>
            </div>
          ) : null}
        </div>
        {fileTreeOpen ? (
          // aside w-[min(16rem,40%)] min-w-40 border-l border-border/60
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              minHeight: 0,
              width: Math.max(160, Math.min(256, Math.floor(bodyWidth * 0.4))),
              borderLeftWidth: 1,
              borderColor: alpha(theme.border, 0.6),
            }}
          >
            <DiffFileTree files={files} selectedPath={treeReveal?.path ?? null} onSelectFile={revealDiffFile} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div testId="diff-surface" style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.background }}>
      {header}
      {body}
      {lazySource && activeCwd
        ? lazyFiles.map((file) => (
            <LazyFilePatch
              key={`${lazyKey}:${file.path}`}
              environmentId={environmentId}
              cwd={preview.data?.cwd ?? activeCwd}
              source={lazySource}
              file={file}
              ignoreWhitespace={ignoreWhitespace}
              onLoaded={(path, patch) =>
                setLazyPatches((current) => {
                  const base = current.key === lazyKey ? current.byPath : new Map<string, string | null>();
                  if (base.get(path) === patch) return current;
                  const next = new Map(base);
                  next.set(path, patch);
                  return { key: lazyKey, byPath: next };
                })
              }
            />
          ))
        : null}
    </div>
  );
}

/** ToggleGroup variant="segmented": Stacked (Rows3) / Split (Columns2). */
function LayoutToggle({ value, onChange }: { value: "stacked" | "split"; onChange: (next: "stacked" | "split") => void }) {
  const theme = useTheme();
  const item = (id: "stacked" | "split", icon: IconName, label: string) => {
    const pressed = value === id;
    return (
      <Tooltip content={label}>
        <div
          testId={`diff-layout-${id}`}
          onClick={() => onChange(id)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 31,
            height: 24,
            borderRadius: 6,
            cursor: "pointer",
            backgroundColor: pressed ? alpha(theme.foreground, 0.09) : "#00000000",
            ...(pressed ? {} : { hover: { backgroundColor: alpha(theme.foreground, 0.05) } }),
          }}
        >
          <Icon name={icon} size={14} color={pressed ? theme.foreground : theme.mutedForeground} />
        </div>
      </Tooltip>
    );
  };
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        padding: 2,
        borderRadius: RADIUS.lg,
        flexShrink: 0,
        backgroundColor: alpha(theme.foreground, 0.032),
      }}
    >
      {item("stacked", "rows-3", "Stacked diff view")}
      {item("split", "columns-2", "Split diff view")}
    </div>
  );
}
