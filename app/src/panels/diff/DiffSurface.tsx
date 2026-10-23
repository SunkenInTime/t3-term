// The right panel's Diff surface: port of apps/web/src/components/DiffPanel.tsx
// (+ DiffPanelShell.tsx, diffPanelStore.ts, lib/diffCollapse.ts). Scopes: the
// branch's changes against its base (with a base-ref picker), uncommitted
// changes, the latest turn or any earlier turn. One native <diff> renders the
// patch with its own virtualized scroll, so nothing nests a vertical scroller.
import { useAtomValue } from "@effect/atom-react";
import type { EventPayload } from "@gpuix/native";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthFilesystemReadScope,
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ReviewDiffPreviewSource,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { useEffect, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  environmentThreadDetails,
  environmentThreadShells,
  projectIndexAtom,
  serverEnvironment,
  shellEnvironment,
} from "../../state/environment.ts";
import {
  diffCollapsedFilesAtom,
  diffFileTreeOpenPref,
  diffFilesCollapsedPref,
  diffFocusedFileAtom,
  diffIgnoreWhitespacePref,
  diffSelectionAtom,
  orchestrationEnvironment,
  reviewEnvironment,
  selectDiffBaseRef,
  selectDiffGitScope,
  selectDiffTurn,
  vcsEnvironment,
} from "../../state/git.ts";
import { ActionMenu } from "../../chat/header/ActionMenu.tsx";
import { copyTextToClipboard } from "../../chat/header/osActions.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { areAllDiffFilesCollapsed, toggleAllDiffFiles } from "../../web/lib/diffCollapse.ts";
import { buildBaseRefChoices } from "../../web/lib/baseRefChoices.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../../web/state/session.ts";
import { splitPatch, type PatchFile } from "./patchFiles.ts";

const AUTOMATIC_BASE_REF = "__automatic_base_ref__";
const LAZY_FILE_BATCH = 20;
const EMPTY_SET: ReadonlySet<string> = new Set();

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
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [baseMenuOpen, setBaseMenuOpen] = useState(false);
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
  const scopeKey = `${threadKey}:${sectionId}`;

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
  const lazyFiles = lazySource?.files?.slice(0, lazyLimit) ?? [];
  const lazyMap = lazyPatches.key === lazyKey ? lazyPatches.byPath : new Map<string, string | null>();

  const rawPatch = selectedTurn
    ? (checkpointDiff.data?.diff ?? null)
    : lazySource
      ? lazyFiles
          .map((file) => lazyMap.get(file.path))
          .filter((patch): patch is string => typeof patch === "string")
          .join("")
      : (gitSource?.diff ?? null);
  const files = splitPatch(rawPatch);
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
  const focused = useAtomValue(diffFocusedFileAtom(scopeKey));
  const focusedFile = focused ? files.find((file) => file.path === focused) : undefined;
  const shownPatch = focusedFile ? focusedFile.patch : rawPatch;

  const updateCollapsed = (update: (current: ReadonlySet<string>) => ReadonlySet<string>) =>
    appAtomRegistry.set(diffCollapsedFilesAtom(scopeKey), update(collapsed));
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

  const refs = useEnvironmentQuery(
    selectedRunId === null && gitScope === "branch" && preview.data?.cwd
      ? vcsEnvironment.listRefs({ environmentId, input: { cwd: preview.data.cwd, includeMatchingRemoteRefs: true, limit: 100 } })
      : null,
  );
  const baseChoices = buildBaseRefChoices(
    (refs.data?.refs ?? []).filter((candidate) => !candidate.isRemote && candidate.name !== gitSource?.headRef),
    (refs.data?.refs ?? []).filter((candidate) => candidate.isRemote),
  );

  const openFileInEditor = async (path: string) => {
    if (!activeCwd || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    const config = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId));
    const editor = config?.availableEditors.find((candidate) => candidate !== "file-manager");
    if (!editor) {
      toast({ type: "error", title: "No installed editors found" });
      return;
    }
    const separator = activeCwd.includes("\\") ? "\\" : "/";
    const absolute = `${activeCwd}${activeCwd.endsWith(separator) ? "" : separator}${path.replaceAll("/", separator)}`;
    const result = (await runAtomCommand(
      appAtomRegistry,
      shellEnvironment.openInEditor,
      { environmentId, input: { cwd: absolute, editor } } as never,
      { reportFailure: false },
    )) as AtomCommandResult<unknown, unknown>;
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toast({ type: "error", title: "Unable to open file", description: error instanceof Error ? error.message : "" });
    }
  };

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
        height: 40,
        flexShrink: 0,
        paddingLeft: 8,
        paddingRight: 8,
        borderBottomWidth: 1,
        borderColor: alpha(theme.border, 0.6),
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
            <ActionMenu
              open={baseMenuOpen}
              onOpenChange={setBaseMenuOpen}
              testId="diff-base-menu"
              minWidth={240}
              items={[
                { id: AUTOMATIC_BASE_REF, label: "Automatic", checked: selectedBaseRef === null },
                ...baseChoices.slice(0, 40).map((choice) => {
                  const value = choice.local?.name ?? choice.remote?.name ?? choice.id;
                  return {
                    id: value,
                    label: choice.local ? choice.label : `${choice.label} (remote)`,
                    checked: selectedBaseRef === value,
                  };
                }),
              ]}
              onSelect={(id: string) => selectDiffBaseRef(ref, id === AUTOMATIC_BASE_REF ? null : id)}
              trigger={
                <div
                  testId="diff-base-ref"
                  onClick={() => setBaseMenuOpen(!baseMenuOpen)}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    height: 24,
                    paddingLeft: 7,
                    paddingRight: 7,
                    borderRadius: RADIUS.md,
                    cursor: "pointer",
                    minWidth: 36,
                    flexShrink: 1,
                    hover: { backgroundColor: theme.accent },
                  }}
                >
                  <Text size="xs" color={theme.mutedForeground} truncate style={{ maxWidth: 160 }}>
                    {gitSource.baseRef}
                  </Text>
                  <Icon name="chevron-down" size={14} color={alpha(theme.mutedForeground, 0.7)} />
                </div>
              }
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
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
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
          {focusedFile ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingLeft: 12, paddingRight: 8, flexShrink: 0, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
              <Text size="xs" color={theme.mutedForeground} truncate style={{ flexGrow: 1 }}>
                {`Showing ${focusedFile.path}`}
              </Text>
              <div
                testId="diff-show-all"
                onClick={() => appAtomRegistry.set(diffFocusedFileAtom(scopeKey), null)}
                style={{ display: "flex", alignItems: "center", height: 24, paddingLeft: 7, paddingRight: 7, borderRadius: RADIUS.md, cursor: "pointer", hover: { backgroundColor: theme.accent } }}
              >
                <Text size="xs" weight={500}>{`Show all ${files.length} files`}</Text>
              </div>
            </div>
          ) : null}
          <diff
            testId="diff-view"
            patch={shownPatch ?? ""}
            wordDiff
            scroll
            collapsedPaths={[...collapsed]}
            onToggleFile={(event: EventPayload) => {
              if (typeof event.value === "string") toggleFile(event.value);
            }}
            theme={{
              appearance: theme.appearance,
              bg: theme.background,
              text: theme.foreground,
              textMuted: theme.mutedForeground,
              diffAdd: theme.diffAdd,
              diffDel: theme.diffDel,
              fontSans: FONTS.sans,
              fontMono: FONTS.mono,
              metrics: { diffTextSize: 12, diffLineHeight: 20, diffFileHeaderHeight: 32, diffHunkHeaderHeight: 24 },
            }}
            style={{ flexGrow: 1, minHeight: 0, width: "100%", scrollbarColor: theme.scrollbar }}
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
          <DiffFileList
            files={files}
            focused={focused}
            onFocus={(path) => appAtomRegistry.set(diffFocusedFileAtom(scopeKey), path === focused ? null : path)}
            onOpen={(path) => void openFileInEditor(path)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div testId="diff-surface" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.background }}>
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

/** The file list beside the diff (DiffFileTree, flattened to paths). */
function DiffFileList({
  files,
  focused,
  onFocus,
  onOpen,
}: {
  files: ReadonlyArray<PatchFile>;
  focused: string | null;
  onFocus: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const theme = useTheme();
  return (
    <div
      testId="diff-file-list"
      style={{
        display: "flex",
        flexDirection: "column",
        width: 216,
        minWidth: 160,
        flexShrink: 0,
        borderLeftWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        overflowY: "scroll",
        scrollbarColor: theme.scrollbar,
        padding: 4,
        pointerEvents: "auto",
      }}
    >
      {files.map((file) => (
        <DiffFileListRow key={file.path} file={file} selected={file.path === focused} onFocus={onFocus} onOpen={onOpen} />
      ))}
    </div>
  );
}

function DiffFileListRow({
  file,
  selected,
  onFocus,
  onOpen,
}: {
  file: PatchFile;
  selected: boolean;
  onFocus: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const name = file.path.split("/").at(-1) ?? file.path;
  const dir = file.path.slice(0, Math.max(0, file.path.length - name.length - 1));
  const icon: IconName = file.kind === "new" ? "file-plus" : file.kind === "deleted" ? "file-minus" : "file-diff";
  return (
    <ActionMenu<"open" | "copy-path" | "focus">
      open={menuOpen}
      onOpenChange={setMenuOpen}
      items={[
        { id: "focus", label: selected ? "Show all files" : "Show only this file", icon: "focus" },
        { id: "open", label: "Open in editor", icon: "square-arrow-out-up-right" },
        { id: "copy-path", label: "Copy path", icon: "copy" },
      ]}
      onSelect={(id) => {
        if (id === "focus") onFocus(file.path);
        else if (id === "open") onOpen(file.path);
        else
          void copyTextToClipboard(file.path).then(
            () => toast({ type: "success", title: "Path copied", description: file.path }),
            () => toast({ type: "error", title: "Failed to copy path" }),
          );
      }}
      rootStyle={{ width: "100%" }}
      trigger={
        <div
          testId={`diff-file-${file.path}`}
          onClick={(event: EventPayload) => ((event.clickCount ?? 1) > 1 ? onOpen(file.path) : onFocus(file.path))}
          onAuxClick={(event: EventPayload) => {
            if (event.isRightClick) setMenuOpen(true);
          }}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            width: "100%",
            height: 28,
            paddingLeft: 8,
            paddingRight: 6,
            borderRadius: RADIUS.md,
            flexShrink: 0,
            cursor: "pointer",
            backgroundColor: selected ? theme.accent : "#00000000",
            hover: { backgroundColor: alpha(theme.accent, 0.6) },
          }}
        >
          <Icon name={icon} size={14} color={theme.mutedForeground} />
          <Tooltip content={file.path}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexGrow: 1, minWidth: 0 }}>
              <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, whiteSpace: "nowrap", flexShrink: 0, maxWidth: 140, textOverflow: "ellipsis", overflow: "hidden" }}>
                {name}
              </text>
              {dir ? (
                <text style={{ color: alpha(theme.mutedForeground, 0.7), fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans, whiteSpace: "nowrap", textOverflow: "ellipsis-start", overflow: "hidden", minWidth: 0 }}>
                  {dir}
                </text>
              ) : null}
            </div>
          </Tooltip>
          <DiffStatLabel additions={file.additions} deletions={file.deletions} size={10} />
        </div>
      }
    />
  );
}
