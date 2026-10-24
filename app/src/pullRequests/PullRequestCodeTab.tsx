// Port of apps/web/src/components/pullRequest/PullRequestCodeTab.tsx over t3-term's diff renderer
// (panels/diff/DiffView.tsx, the same rows the Diff surface paints after @pierre/diffs): the
// change one slice at a time, stacked or split, wrapped or panned, with each file's "Viewed" tick,
// the review conversations under their lines, pending line comments, and a draft box a press on a
// line number opens. A commit scope narrows it to one commit; a file tree sits beside it.
//
// "N unmodified lines" separators expand from each file's full contents at the pull request's
// head (web: createPullRequestDiffFileContentsLoader, the host's diffFileContents command).
//
// "Hide whitespace changes" (web's pilcrow toggle, starting from the diffIgnoreWhitespace setting)
// re-pairs each hunk ignoring whitespace (pullRequestWhitespace.ts), as web does client-side.
//
// Line numbers select ranges as pierre's do (press, drag across numbers, or the gutter "+"); on
// release the draft box opens under the range's last line. As on web, a review comment lands on
// that last line (only GitHub carries multi-line comments), while "Add to agent" carries the whole
// range as context.
import { runAtomCommand, squashAtomCommandFailure, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestRef,
  PullRequestReviewPosition,
  PullRequestReviewThread,
  PullRequestThreadCommentsResult,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  EXPANSION_LINE_COUNT,
  diffFileChangeType,
  diffReviewLines,
  expandDiffFile,
  parseDiffFiles,
  type DiffFileContents,
  type DiffFileModel,
  type ExpandedRegion,
} from "../panels/diff/diffModel.ts";
import { DiffView, type DiffExternalAnnotation, type GapDirection } from "../panels/diff/DiffView.tsx";
import { FileEntryIcon } from "../panels/files/FileEntryIcon.tsx";
import { diffLayoutPref, wordWrapPref } from "../state/codeView.ts";
import { diffFilesCollapsedPref, diffFileTreeOpenPref, diffIgnoreWhitespacePref } from "../state/git.ts";
import { hideWhitespaceChanges } from "./pullRequestWhitespace.ts";
import {
  nextPendingReviewCommentId,
  pullRequestEnvironment,
  pullRequestReviewKey,
  pullRequestReviewStore,
  useEnvironmentQuery,
  usePendingReviewComments,
} from "../state/pullRequests.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast } from "../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import {
  pullRequestFindingKey,
  type PullRequestFinding,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import type { ReviewCommentContext } from "../web/components/pullRequest/pullRequestDetail.deps.ts";
import { buildDiffReviewComment, type SelectedLineRange } from "../web/reviewCommentContext.ts";
import {
  areAllDiffFilesCollapsed,
  isFileDiffCollapsed,
  isLineInDiffModel,
  toggleFileDiffFoldForViewed,
  type DiffFoldOverride,
} from "../web/components/pullRequest/pullRequestDiff.logic.ts";
import {
  canEditPullRequestComment,
  canResolvePullRequestThread,
} from "../web/components/pullRequest/pullRequestEditing.logic.ts";
import { orderDiffFiles } from "../web/components/pullRequest/pullRequestFileOrder.logic.ts";
import type { PullRequestDetailView } from "./PullRequestDetailPanel.tsx";
import { GhostBar } from "./PullRequestListStates.tsx";
import { PrMenu, PrMenuItem } from "./PullRequestMenus.tsx";
import { PrButton } from "./prControls.tsx";
import {
  DiffCommentDraft,
  PendingReviewCommentCard,
  ReviewThreadCard,
} from "./PullRequestReviewAnnotation.tsx";
import {
  findDiffLine,
  getReviewPositionAnchor,
  reviewPositionForLine,
  toViewerSide,
} from "./pullRequestReviewPosition.ts";
import { PullRequestDiffUnavailableState } from "./PullRequestUnavailableStates.tsx";
import { PullRequestDryRunError, runPullRequestWrite } from "./pullRequestWrites.ts";
import { usePullRequestFilesViewed } from "./usePullRequestFilesViewed.ts";

const COMMIT_PAGE_SIZE = 10;

interface DiffSlice {
  readonly cursor: string | null;
  readonly patch: string;
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

interface DraftAnchor {
  readonly path: string;
  readonly oldPath: string | null;
  readonly position: PullRequestReviewPosition;
  readonly range: SelectedLineRange;
}

export interface PullRequestAgentSelectionInput {
  readonly comment: ReviewCommentContext;
  readonly request: string;
}

/** Files in the order a reader takes them in: sources by import order, their tests, then generated files. */
function orderFiles(files: ReadonlyArray<DiffFileModel>): ReadonlyArray<DiffFileModel> {
  const wrapped = files.map((file) => ({
    name: file.path,
    prevName: file.previousPath ?? undefined,
    additionLines: file.newSource.split("\n"),
    deletionLines: file.oldSource.split("\n"),
    file,
  }));
  return orderDiffFiles(wrapped).map((entry) => entry.file);
}

const parsedSlices = new WeakMap<DiffSlice, ReadonlyArray<DiffFileModel>>();
function parseSlice(slice: DiffSlice): ReadonlyArray<DiffFileModel> {
  const cached = parsedSlices.get(slice);
  if (cached) return cached;
  const files = orderFiles(parseDiffFiles(slice.patch));
  parsedSlices.set(slice, files);
  return files;
}

export function PullRequestCodeTab({
  environmentId,
  reference,
  detail,
  selectedCommitOid,
  onSelectedCommitChange,
  pendingFinding = null,
  fixFindingLabel = "Fix in a thread",
  onFixFinding,
  onAddToAgentSelection,
  onRefresh,
  refreshToken = 0,
  backgroundRefreshToken = 0,
  revealRequest = null,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  selectedCommitOid: string | null;
  onSelectedCommitChange: (oid: string | null) => void;
  pendingFinding?: string | null;
  fixFindingLabel?: string;
  onFixFinding?: (finding: PullRequestFinding) => void;
  onAddToAgentSelection?: (input: PullRequestAgentSelectionInput) => void;
  onRefresh: () => void;
  refreshToken?: number;
  backgroundRefreshToken?: number;
  revealRequest?: { readonly path: string; readonly nonce: number } | null;
}) {
  const theme = useTheme();
  const diffLayout = useAtomValue(diffLayoutPref.atom);
  const initialWrap = useAtomValue(wordWrapPref.atom);
  const filesCollapsedByDefault = useAtomValue(diffFilesCollapsedPref.atom);
  const fileTreeOpen = useAtomValue(diffFileTreeOpenPref.atom);
  const [wordWrap, setWordWrap] = useState(initialWrap);
  // web: seeded from the diffIgnoreWhitespace setting, then local to the tab.
  const initialIgnoreWhitespace = useAtomValue(diffIgnoreWhitespacePref.atom);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(initialIgnoreWhitespace);
  const [toggledFiles, setToggledFiles] = useState<ReadonlySet<string>>(() => new Set());
  const [foldOverride, setFoldOverride] = useState<DiffFoldOverride>(null);
  const effectiveFoldOverride = foldOverride ?? (filesCollapsedByDefault ? "folded" : "expanded");
  const [visibleCommitCount, setVisibleCommitCount] = useState(COMMIT_PAGE_SIZE);
  const [draft, setDraft] = useState<DraftAnchor | null>(null);
  // web selectedLines: the range stays painted while its draft is open.
  const [selectedLines, setSelectedLines] = useState<{ readonly path: string; readonly range: SelectedLineRange } | null>(null);
  const [threadPending, setThreadPending] = useState(false);
  const [orphansOpen, setOrphansOpen] = useState(false);
  const [reveal, setReveal] = useState<{ readonly path: string; readonly requestId: number } | null>(null);
  const reviewKey = pullRequestReviewKey(reference);
  const commit = selectedCommitOid;
  const scopeKey = JSON.stringify([environmentId, reviewKey, commit]);
  const [sliceState, setSliceState] = useState<{
    readonly key: string;
    readonly cursor: string | null;
    readonly slices: ReadonlyArray<DiffSlice>;
  }>({ key: "", cursor: null, slices: [] });
  // Kept mounted across pull requests in web; here it remounts, but a scope change inside one
  // (a commit picked) still has to drop the previous scope's draft and pages.
  const [stateScopeKey, setStateScopeKey] = useState(scopeKey);
  if (stateScopeKey !== scopeKey) {
    setStateScopeKey(scopeKey);
    setDraft(null);
    setSelectedLines(null);
    setToggledFiles(new Set());
    setFoldOverride(null);
    setVisibleCommitCount(COMMIT_PAGE_SIZE);
    setOrphansOpen(false);
    setSliceState({ key: scopeKey, cursor: null, slices: [] });
  }
  const loadedSlices = sliceState.key === scopeKey ? sliceState.slices : [];
  const cursor = sliceState.key === scopeKey ? sliceState.cursor : null;
  const diffInput = {
    ...reference,
    ...(cursor === null ? {} : { cursor }),
    ...(commit === null ? {} : { commit }),
  };
  const diffQuery = useEnvironmentQuery(pullRequestEnvironment.diff({ environmentId, input: diffInput }));
  const [appliedPage, setAppliedPage] = useState<{
    readonly data: typeof diffQuery.data;
    readonly cursor: string | null;
    readonly scopeKey: string;
  } | null>(null);
  const data = diffQuery.data;
  if (data !== null && (appliedPage?.data !== data || appliedPage.cursor !== cursor || appliedPage.scopeKey !== scopeKey)) {
    setAppliedPage({ data, cursor, scopeKey });
    setSliceState((previous) => {
      const slices = previous.key === scopeKey ? previous.slices : [];
      const next: DiffSlice = { cursor, patch: data.patch, truncated: data.truncated, nextCursor: data.nextCursor };
      const index = slices.findIndex((slice) => slice.cursor === cursor);
      if (index === -1) return { key: scopeKey, cursor, slices: [...slices, next] };
      const existing = slices[index];
      if (existing && existing.patch === next.patch && existing.truncated === next.truncated && existing.nextCursor === next.nextCursor) {
        return previous;
      }
      // A page that came back different means the diff moved under the review: the pages after
      // it go too, since their cursors were positions in the old diff.
      return { key: scopeKey, cursor, slices: [...slices.slice(0, index), next] };
    });
  }
  const firstPageAtom = pullRequestEnvironment.diff({
    environmentId,
    input: { ...reference, ...(commit === null ? {} : { commit }) },
  });
  const pendingComments = usePendingReviewComments(reference);
  const filesViewed = usePullRequestFilesViewed({
    environmentId,
    reference,
    enabled: detail.capabilities.viewedFiles !== undefined,
  });
  const appliedRefreshToken = useRef(refreshToken);
  useEffect(() => {
    if (appliedRefreshToken.current === refreshToken) return;
    appliedRefreshToken.current = refreshToken;
    setSliceState({ key: scopeKey, cursor: null, slices: [] });
    setAppliedPage(null);
    appAtomRegistry.refresh(firstPageAtom);
    filesViewed.refresh();
    // oxlint-disable-next-line react/exhaustive-deps -- one reload per token
  }, [refreshToken]);
  const appliedBackgroundRefreshToken = useRef(backgroundRefreshToken);
  useEffect(() => {
    if (appliedBackgroundRefreshToken.current === backgroundRefreshToken) return;
    appliedBackgroundRefreshToken.current = backgroundRefreshToken;
    // Keeping the pages preserves the scroll position; the page merge drops changed ones.
    setSliceState((previous) => ({ ...previous, cursor: null }));
    appAtomRegistry.refresh(firstPageAtom);
    filesViewed.refresh();
    // oxlint-disable-next-line react/exhaustive-deps -- one reload per token
  }, [backgroundRefreshToken]);

  const hostReview = detail.capabilities.review;
  const review = {
    inlineComment: hostReview.inlineComment && detail.viewerPermissions.comment,
    reply: hostReview.reply && detail.viewerPermissions.comment,
    resolve: hostReview.resolve && detail.viewerPermissions.resolve,
  };
  const canCommentOnLines = review.inlineComment && commit === null;
  // Agent context is local, so it does not need the host's comment permission.
  const canSelectLines = commit === null && (review.inlineComment || onAddToAgentSelection !== undefined);
  const files = useMemo(
    () => loadedSlices.flatMap((slice) => (ignoreWhitespace ? parseSlice(slice).map(hideWhitespaceChanges) : parseSlice(slice))),
    [loadedSlices, ignoreWhitespace],
  );
  // web loadDiffFiles: each file's full contents, fetched on its first expand, reveal the
  // unchanged lines between hunks. Keyed so a refresh, another commit or the whitespace toggle
  // starts over.
  const expansionKey = `${scopeKey}:${detail.updatedAt}:${ignoreWhitespace}`;
  const [expansion, setExpansion] = useState<{
    readonly key: string;
    readonly contents: ReadonlyMap<string, DiffFileContents>;
    readonly regions: ReadonlyMap<string, ReadonlyMap<number, ExpandedRegion>>;
  }>({ key: "", contents: new Map(), regions: new Map() });
  const liveExpansion = expansion.key === expansionKey ? expansion : null;
  const displayFiles = useMemo(() => {
    if (!liveExpansion || liveExpansion.contents.size === 0) return files;
    return files.map((file) => {
      const contents = liveExpansion.contents.get(file.path);
      return contents ? expandDiffFile(file, contents, liveExpansion.regions.get(file.path) ?? new Map()) : file;
    });
  }, [files, liveExpansion]);
  const loadingContents = useRef(new Set<string>());
  const expandGap = (file: DiffFileModel, expandIndex: number, direction: GapDirection) => {
    const key = expansionKey;
    setExpansion((current) => {
      const base =
        current.key === key
          ? current
          : { key, contents: new Map<string, DiffFileContents>(), regions: new Map<string, ReadonlyMap<number, ExpandedRegion>>() };
      const fileRegions = new Map<number, ExpandedRegion>(base.regions.get(file.path) ?? []);
      const region = fileRegions.get(expandIndex) ?? { fromStart: 0, fromEnd: 0 };
      fileRegions.set(expandIndex, {
        fromStart: region.fromStart + (direction === "down" ? 0 : EXPANSION_LINE_COUNT),
        fromEnd: region.fromEnd + (direction === "up" ? 0 : EXPANSION_LINE_COUNT),
      });
      return { ...base, regions: new Map(base.regions).set(file.path, fileRegions) };
    });
    const loadKey = `${key}\n${file.path}`;
    if (liveExpansion?.contents.has(file.path) || loadingContents.current.has(loadKey)) return;
    loadingContents.current.add(loadKey);
    void (
      runAtomCommand(
        appAtomRegistry,
        pullRequestEnvironment.diffFileContents,
        {
          environmentId,
          input: {
            ...reference,
            ...(commit === null ? {} : { commit }),
            changeType: diffFileChangeType(file),
            oldPath: file.previousPath ?? file.path,
            newPath: file.path,
          },
        },
        { reportFailure: false },
      ) as Promise<AtomCommandResult<DiffFileContents, unknown>>
    ).then((result) => {
      loadingContents.current.delete(loadKey);
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        toast({
          type: "error",
          title: "Could not load the file to expand it",
          description: error instanceof Error && error.message.trim() ? error.message : file.path,
        });
        return;
      }
      setExpansion((current) => (current.key !== key ? current : { ...current, contents: new Map(current.contents).set(file.path, result.value) }));
    });
  };
  const filePaths = files.map((file) => file.path);
  // A conversation is placed only when its line falls inside a hunk that was drawn. While a commit
  // is on screen every conversation is listed instead: its line numbers belong to the whole change.
  const placedThreadIds = useMemo(() => {
    const placed = new Set<string>();
    if (commit !== null) return placed;
    for (const file of files) {
      for (const thread of detail.reviewThreads) {
        if (thread.path === file.path && thread.line !== null && isLineInDiffModel(file, thread.side, thread.line)) {
          placed.add(thread.id);
        }
      }
    }
    return placed;
  }, [files, detail.reviewThreads, commit]);

  // Annotation groups per file, keyed by `${side}:${line}` (web: MutableAnnotationGroup).
  const groups = useMemo(() => {
    const byFile = new Map<
      string,
      Map<string, { side: "additions" | "deletions"; line: number; threads: PullRequestReviewThread[]; pendingIds: string[]; draft: boolean }>
    >();
    const groupAt = (path: string, side: "additions" | "deletions", line: number) => {
      let file = byFile.get(path);
      if (!file) {
        file = new Map();
        byFile.set(path, file);
      }
      const key = `${side}:${line}`;
      let group = file.get(key);
      if (!group) {
        group = { side, line, threads: [], pendingIds: [], draft: false };
        file.set(key, group);
      }
      return group;
    };
    for (const thread of detail.reviewThreads) {
      if (thread.line === null || !placedThreadIds.has(thread.id)) continue;
      groupAt(thread.path, toViewerSide(thread.side), thread.line).threads.push(thread);
    }
    if (commit === null) {
      for (const comment of pendingComments) {
        const anchor = getReviewPositionAnchor(comment.position);
        groupAt(comment.path, toViewerSide(anchor.side), anchor.line).pendingIds.push(comment.id);
      }
    }
    if (draft !== null) {
      const anchor = getReviewPositionAnchor(draft.position);
      groupAt(draft.path, toViewerSide(anchor.side), anchor.line).draft = true;
    }
    return byFile;
  }, [detail.reviewThreads, placedThreadIds, pendingComments, draft, commit]);
  const annotations = useMemo(() => {
    const map = new Map<string, DiffExternalAnnotation[]>();
    for (const [path, fileGroups] of groups) {
      map.set(
        path,
        [...fileGroups.values()].map((group) => ({
          key: `${group.side}:${group.line}:${group.threads.map((thread) => thread.id).join(",")}:${group.pendingIds.join(",")}:${group.draft ? "d" : ""}`,
          side: group.side,
          lineNumber: group.line,
        })),
      );
    }
    return map;
  }, [groups]);

  const nextCursor = loadedSlices.at(-1)?.nextCursor ?? null;
  const withheldContent = loadedSlices.some((slice) => slice.truncated);
  const canLoadNextSlice = nextCursor !== null && nextCursor !== cursor && !diffQuery.isPending && diffQuery.error === null;
  const loadNextSlice = () => {
    if (nextCursor === null) return;
    setSliceState((previous) => ({ ...previous, cursor: nextCursor }));
  };
  const collapsedPaths = useMemo(
    () => new Set(filePaths.filter((path) => isFileDiffCollapsed(path, effectiveFoldOverride, toggledFiles))),
    // oxlint-disable-next-line react/exhaustive-deps -- filePaths follows files
    [files, effectiveFoldOverride, toggledFiles],
  );
  const allFilesCollapsed = areAllDiffFilesCollapsed(filePaths, collapsedPaths);
  const toggleFile = (path: string) =>
    setToggledFiles((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const toggleAllFiles = () => {
    setFoldOverride(allFilesCollapsed ? "expanded" : "folded");
    setToggledFiles(new Set());
  };
  const setFileViewed = (path: string, viewed: boolean) => {
    filesViewed.setViewed(path, viewed);
    setToggledFiles((current) => toggleFileDiffFoldForViewed(path, viewed, effectiveFoldOverride, current));
  };
  const revealFile = (path: string) => {
    if (collapsedPaths.has(path)) toggleFile(path);
    setReveal((previous) => ({ path, requestId: (previous?.requestId ?? 0) + 1 }));
  };
  // A reveal for a file not loaded yet pages forward until it arrives.
  const answeredReveal = useRef<number | null>(null);
  useEffect(() => {
    if (revealRequest === null || answeredReveal.current === revealRequest.nonce) return;
    if (!filePaths.includes(revealRequest.path)) {
      if (canLoadNextSlice) loadNextSlice();
      return;
    }
    answeredReveal.current = revealRequest.nonce;
    revealFile(revealRequest.path);
    // oxlint-disable-next-line react/exhaustive-deps -- re-checked as pages and rows arrive
  }, [revealRequest, files, canLoadNextSlice]);

  const orderedCommits = detail.commits.toSorted(
    (left, right) => Date.parse(right.committedDate) - Date.parse(left.committedDate),
  );
  const selectedCommit = orderedCommits.find((entry) => entry.oid === commit);
  useEffect(() => {
    // A rebase can take the scoped commit out of the change; go back to the whole change.
    if (commit !== null && selectedCommit === undefined) onSelectedCommitChange(null);
  }, [commit, selectedCommit, onSelectedCommitChange]);

  const runThreadCommand = async (label: string, run: () => Promise<{ readonly _tag: string; readonly cause?: unknown }>) => {
    if (threadPending) return false;
    setThreadPending(true);
    const result = await run();
    setThreadPending(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result as never);
      toast({
        type: "error",
        title: label,
        ...(failure instanceof PullRequestDryRunError ? { description: failure.message } : {}),
      });
      return false;
    }
    onRefresh();
    return true;
  };
  const renderThreadCard = (thread: PullRequestReviewThread) => (
    <ReviewThreadCard
      key={`${reference.projectId}#${reference.number}:${thread.id}`}
      thread={thread}
      canReply={review.reply}
      canResolve={review.resolve && canResolvePullRequestThread(detail, thread)}
      canReact={detail.capabilities.reactions === true}
      environmentId={environmentId}
      reference={reference}
      pending={threadPending}
      fixPending={pendingFinding === pullRequestFindingKey({ kind: "thread", thread })}
      fixLabel={fixFindingLabel}
      {...(onFixFinding ? { onFix: () => onFixFinding({ kind: "thread", thread }) } : {})}
      onLoadMore={async (threadCursor): Promise<PullRequestThreadCommentsResult | null> => {
        const result = await runPullRequestReadCommand(environmentId, reference, thread.id, threadCursor);
        if (result === null) toast({ type: "error", title: "More comments could not be loaded" });
        return result;
      }}
      onReply={(body) =>
        runThreadCommand("Reply could not be posted", () =>
          runPullRequestWrite(pullRequestEnvironment.replyToThread, {
            environmentId,
            input: { ...reference, threadId: thread.id, body },
          }),
        )
      }
      canEditComment={(comment) =>
        canEditPullRequestComment(detail, { author: comment.author, kind: "review-comment", canEdit: comment.canEdit })
      }
      onEditComment={(commentId, body) =>
        runThreadCommand("The comment could not be saved", () =>
          runPullRequestWrite(pullRequestEnvironment.updateComment, {
            environmentId,
            input: { ...reference, commentId, kind: "review-comment", body },
          }),
        )
      }
      onToggleResolved={() =>
        void runThreadCommand("The conversation could not be updated", () =>
          runPullRequestWrite(pullRequestEnvironment.setThreadResolution, {
            environmentId,
            input: { ...reference, threadId: thread.id, resolved: !thread.isResolved },
          }),
        )
      }
      onReacted={onRefresh}
    />
  );
  const renderAnnotation = (file: DiffFileModel, annotation: DiffExternalAnnotation) => {
    const group = groups.get(file.path)?.get(`${annotation.side}:${annotation.lineNumber}`);
    if (!group) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", paddingTop: 4, paddingBottom: 4 }}>
        {group.threads.map(renderThreadCard)}
        {group.pendingIds.map((id) => {
          const comment = pendingComments.find((entry) => entry.id === id);
          return comment ? (
            <PendingReviewCommentCard
              key={comment.id}
              comment={comment}
              onRemove={() => pullRequestReviewStore.removeComments(reviewKey, [comment.id])}
            />
          ) : null;
        })}
        {group.draft && draft !== null && canSelectLines ? (
          <DiffCommentDraft
            rangeLabel={`${draft.path}:${getReviewPositionAnchor(draft.position).line}`}
            submitLabel={canCommentOnLines ? "Add to review" : "Add to agent"}
            {...(canCommentOnLines && onAddToAgentSelection
              ? {
                  secondaryAction: {
                    label: "Add to agent",
                    onAction: (text: string) =>
                      finishSelection(draft, text, (comment) => onAddToAgentSelection({ comment, request: text })),
                  },
                }
              : {})}
            onCancel={() => {
              setDraft(null);
              setSelectedLines(null);
            }}
            onComment={(body) => {
              if (!canCommentOnLines) {
                if (onAddToAgentSelection) {
                  finishSelection(draft, body, (comment) => onAddToAgentSelection({ comment, request: body }));
                }
                return;
              }
              pullRequestReviewStore.addComment(reviewKey, {
                id: nextPendingReviewCommentId(),
                path: draft.path,
                ...(draft.oldPath === null ? {} : { oldPath: draft.oldPath }),
                position: draft.position,
                body,
              });
              setDraft(null);
              setSelectedLines(null);
            }}
          />
        ) : null}
      </div>
    );
  };
  // web beginComment: a range collapses to its last line for the host comment.
  const beginComment = (file: DiffFileModel, range: SelectedLineRange) => {
    if (!canSelectLines || draft !== null) return;
    const side = (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions";
    const found = findDiffLine(file, side, range.end);
    const position = found === null ? null : reviewPositionForLine(found.line, side);
    if (position === null) {
      setSelectedLines(null);
      return;
    }
    setSelectedLines({ path: file.path, range });
    setDraft({ path: file.path, oldPath: file.previousPath, position, range });
  };
  // web finishSelection: the whole range becomes agent context.
  const finishSelection = (anchor: DraftAnchor, text: string, onFinish: (comment: ReviewCommentContext) => void) => {
    // The rows the range was picked from, revealed context included.
    const file = displayFiles.find((candidate) => candidate.path === anchor.path);
    const comment =
      file === undefined
        ? null
        : buildDiffReviewComment({
            id: `pull-request-selection:${anchor.path}:${anchor.range.start}:${anchor.range.end}`,
            sectionId: `pull-request:${detail.number}`,
            sectionTitle: `PR #${detail.number} review`,
            filePath: anchor.path,
            lines: diffReviewLines(file),
            range: anchor.range,
            text,
          });
    setDraft(null);
    setSelectedLines(null);
    if (comment !== null) onFinish(comment);
  };
  const renderHeaderExtras = (file: DiffFileModel) => {
    if (!filesViewed.enabled) return null;
    const viewed = filesViewed.isViewed(file.path);
    const stale = filesViewed.isStale(file.path);
    return (
      <div
        testId={`pr-viewed-${file.path}`}
        onClick={() => setFileViewed(file.path, !viewed)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, cursor: "pointer" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            borderRadius: 4,
            borderWidth: viewed ? 0 : 1,
            borderColor: theme.input,
            backgroundColor: viewed ? theme.primary : alpha(theme.input, 0.32),
          }}
        >
          {viewed ? <Icon name="check" size={12} color={theme.primaryForeground} /> : null}
        </div>
        {stale ? (
          <Tooltip content="This file has been pushed to since you marked it viewed." side="bottom">
            <div style={{ display: "flex" }}>
              <Text size="2xs" color={theme.warningForeground}>
                Changed
              </Text>
            </div>
          </Tooltip>
        ) : (
          <Text size="2xs" color={theme.mutedForeground}>
            Viewed
          </Text>
        )}
      </div>
    );
  };

  const orphanThreads = detail.reviewThreads.filter((thread) => !placedThreadIds.has(thread.id));
  const orphanFiles = new Map<string, PullRequestReviewThread[]>();
  for (const thread of orphanThreads) {
    const existing = orphanFiles.get(thread.path);
    if (existing) existing.push(thread);
    else orphanFiles.set(thread.path, [thread]);
  }

  const toolbar = (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        height: 40,
        paddingLeft: 16,
        paddingRight: 16,
        borderBottomWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        backgroundColor: theme.background,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1, minWidth: 0 }}>
        {orderedCommits.length > 0 ? (
          <PrMenu
            minWidth={280}
            testId="pr-code-commits-menu"
            trigger={({ toggle }) => (
              <div
                testId="pr-code-commits"
                onClick={toggle}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  height: 24,
                  maxWidth: 256,
                  paddingLeft: 7,
                  paddingRight: 7,
                  borderRadius: RADIUS.md,
                  cursor: "pointer",
                  backgroundColor: theme.secondary,
                  hover: { backgroundColor: alpha(theme.secondary, 0.9) },
                }}
              >
                <Text size="xs" weight={500} truncate>
                  {selectedCommit ? selectedCommit.messageHeadline : "All commits"}
                </Text>
                <Icon name="chevron-down" size={14} color={alpha(theme.foreground, 0.7)} />
              </div>
            )}
          >
            <PrMenuItem checked={commit === null} onSelect={() => onSelectedCommitChange(null)} testId="pr-code-commit-all">
              All commits
            </PrMenuItem>
            {orderedCommits.slice(0, visibleCommitCount).map((entry) => (
              <PrMenuItem
                key={entry.oid}
                checked={commit === entry.oid}
                onSelect={() => onSelectedCommitChange(entry.oid)}
                testId={`pr-code-commit-${entry.oid.slice(0, 7)}`}
                iconNode={
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, minWidth: 0, maxWidth: 420 }}>
                    <Text truncate style={{ flexShrink: 1 }}>
                      {entry.messageHeadline}
                    </Text>
                    <div style={{ flexGrow: 1 }} />
                    <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.mono, flexShrink: 0 }}>
                      {entry.oid.slice(0, 7)}
                    </text>
                  </div>
                }
              >
                {null}
              </PrMenuItem>
            ))}
            {orderedCommits.length > visibleCommitCount ? (
              <PrMenuItem keepOpen onSelect={() => setVisibleCommitCount((count) => count + COMMIT_PAGE_SIZE)}>
                <Text color={theme.mutedForeground}>{`Show more (${orderedCommits.length - visibleCommitCount} left)`}</Text>
              </PrMenuItem>
            ) : null}
          </PrMenu>
        ) : null}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
            {`${files.length} ${files.length === 1 ? "file" : "files"}${nextCursor === null ? "" : "+"}`}
          </Text>
          {filesViewed.enabled && files.length > 0 ? (
            <>
              <Text size="xs" color={alpha(theme.mutedForeground, 0.5)}>
                ·
              </Text>
              <Text size="xs" color={theme.mutedForeground} truncate testId="pr-code-viewed-count">
                {`${filePaths.filter(filesViewed.isViewed).length} / ${files.length} ${detail.capabilities.viewedFiles === "environment" ? "viewed in T3 Code" : "viewed"}`}
              </Text>
              {detail.capabilities.viewedFiles === "environment" ? (
                <ToolbarHint
                  icon="info"
                  text="This host keeps no shared record of which files you have read, so these ticks are kept by this environment. They follow you between the apps connected to it, but the host's own web UI will not show them."
                />
              ) : null}
              {filesViewed.error !== null ? (
                <ToolbarHint
                  icon="triangle-alert"
                  warning
                  text={`The boxes below are whatever was last read, and empty if nothing has been read yet. ${filesViewed.error}`}
                />
              ) : null}
              {filesViewed.truncated ? (
                <ToolbarHint
                  icon="triangle-alert"
                  warning
                  text="This change has more files than the host will report ticks for in one read, so the count is short and some boxes below start empty."
                />
              ) : null}
            </>
          ) : null}
          {withheldContent ? (
            <ToolbarHint
              icon="triangle-alert"
              warning
              text="The host withheld part of this diff: a binary file, or a change too large to inline."
            />
          ) : null}
          {commit !== null && review.inlineComment ? (
            <ToolbarHint
              icon="message-square-off"
              text="A comment is anchored to the whole change, so switch to All commits to write one."
            />
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <ToolbarToggle
          icon="pilcrow"
          pressed={ignoreWhitespace}
          label={ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
          onClick={() => {
            // web changeIgnoreWhitespace: a draft anchored to a line may no longer exist.
            setIgnoreWhitespace(!ignoreWhitespace);
            setDraft(null);
            setSelectedLines(null);
          }}
          testId="pr-code-whitespace"
        />
        <SegmentedIcons
          value={diffLayout === "split" ? "split" : "stacked"}
          onChange={(next) => diffLayoutPref.set(next)}
          items={[
            { value: "stacked", icon: "rows-3", label: "Stacked diff view" },
            { value: "split", icon: "columns-2", label: "Split diff view" },
          ]}
        />
        <ToolbarToggle
          icon="text-wrap"
          pressed={wordWrap}
          label={wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
          onClick={() => setWordWrap(!wordWrap)}
          testId="pr-code-wrap"
        />
        {filePaths.length > 0 ? (
          <ToolbarToggle
            icon={allFilesCollapsed ? "chevrons-up-down" : "chevrons-down-up"}
            pressed={false}
            label={allFilesCollapsed ? "Expand all files" : "Collapse all files"}
            onClick={toggleAllFiles}
            testId="pr-code-fold"
          />
        ) : null}
        {filePaths.length > 0 ? (
          <ToolbarToggle
            icon="folder-tree"
            pressed={fileTreeOpen}
            label={fileTreeOpen ? "Hide file tree" : "Show file tree"}
            onClick={() => diffFileTreeOpenPref.set(!fileTreeOpen)}
            testId="pr-code-tree"
          />
        ) : null}
      </div>
    </div>
  );

  const body: ReactNode =
    diffQuery.isPending && loadedSlices.length === 0 ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
        <Text size="xs" color={theme.mutedForeground}>
          Loading pull request diff...
        </Text>
        <GhostBar width="70%" height={14} />
        <GhostBar width="55%" height={14} />
      </div>
    ) : diffQuery.error && loadedSlices.length === 0 ? (
      <PullRequestDiffUnavailableState
        error={diffQuery.error}
        provider={detail.provider}
        url={detail.url}
        onRetry={() => diffQuery.refresh()}
      />
    ) : files.length === 0 && nextCursor === null ? (
      <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 20 }}>
        <Text color={theme.mutedForeground}>
          {commit === null ? "This pull request has no file changes." : "This commit has no file changes."}
        </Text>
      </div>
    ) : (
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
        <div testId="pr-code-diff" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
          <DiffView
            files={displayFiles}
            onExpandGap={expandGap}
            layout={diffLayout === "split" ? "split" : "stacked"}
            wrap={wordWrap}
            collapsed={collapsedPaths}
            onToggleFile={toggleFile}
            onOpenFile={toggleFile}
            resetKey={scopeKey}
            annotations={annotations}
            renderAnnotation={renderAnnotation}
            {...(canSelectLines
              ? { lineSelection: { enabled: draft === null, selected: selectedLines, onSelectionEnd: beginComment } }
              : {})}
            renderHeaderExtras={renderHeaderExtras}
            reveal={reveal}
            onReachEnd={() => {
              if (canLoadNextSlice) loadNextSlice();
            }}
          />
          {nextCursor !== null && diffQuery.error !== null ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 8, paddingBottom: 8 }}>
              <Text size="xs" color={theme.mutedForeground}>
                The rest of this diff could not be loaded.
              </Text>
              <PrButton onClick={() => diffQuery.refresh()}>Retry</PrButton>
            </div>
          ) : null}
        </div>
        {fileTreeOpen ? (
          <PullRequestFileTree
            files={files}
            isViewed={filesViewed.enabled ? filesViewed.isViewed : null}
            onSelect={revealFile}
            footer={
              nextCursor === null ? null : (
                <PrButton
                  disabled={diffQuery.isPending}
                  onClick={diffQuery.error !== null ? () => diffQuery.refresh() : loadNextSlice}
                  style={{ width: "100%" }}
                  testId="pr-code-tree-more"
                >
                  {diffQuery.error !== null ? "Retry" : diffQuery.isPending ? "Loading more files..." : "Load more files"}
                </PrButton>
              )
            }
          />
        ) : null}
      </div>
    );

  return (
    <div testId="pr-code-tab" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      {toolbar}
      {orphanFiles.size > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
          <div
            testId="pr-code-orphans"
            onClick={() => setOrphansOpen(!orphansOpen)}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, cursor: "pointer" }}
          >
            <Text size="xs" color={theme.mutedForeground}>
              {nextCursor === null ? "Conversations not on the current diff" : "Conversations not on the diff loaded so far"}
            </Text>
            <Icon name={orphansOpen ? "chevron-down" : "chevron-right"} size={14} color={theme.mutedForeground} />
            <Text size="xs" color={theme.mutedForeground}>
              {String(orphanThreads.length)}
            </Text>
          </div>
          {orphansOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 256, overflowY: "scroll", paddingLeft: 16, paddingRight: 16, paddingBottom: 12 }}>
              {[...orphanFiles].map(([path, threads]) => (
                <div key={path} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                  <Text size="xs" color={theme.mutedForeground} truncate style={{ paddingLeft: 12, paddingRight: 12 }}>
                    {path}
                  </Text>
                  {threads.map((thread) => (
                    <div key={thread.id} style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
                      {thread.line === null ? null : (
                        <Text size="xs" color={theme.mutedForeground} style={{ paddingLeft: 12, paddingRight: 12 }}>
                          {`Line ${thread.line}`}
                        </Text>
                      )}
                      {renderThreadCard(thread)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {body}
    </div>
  );
}

/** Reads a thread's next page of comments; a read, so it does not go through the write gate. */
async function runPullRequestReadCommand(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
  threadId: string,
  cursor: string,
): Promise<PullRequestThreadCommentsResult | null> {
  const result = await runAtomCommand(
    appAtomRegistry,
    pullRequestEnvironment.threadComments,
    { environmentId, input: { ...reference, threadId, cursor } },
    { reportFailure: false },
  );
  return result._tag === "Failure" ? null : result.value;
}

function ToolbarHint({ icon, text, warning = false }: { icon: IconName; text: string; warning?: boolean }) {
  const theme = useTheme();
  return (
    <Tooltip content={text} side="bottom">
      <div style={{ display: "flex", flexShrink: 0 }}>
        <Icon name={icon} size={14} color={warning ? theme.warningForeground : theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}

function ToolbarToggle({
  icon,
  pressed,
  label,
  onClick,
  testId,
}: {
  icon: IconName;
  pressed: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={label} side="top">
      <div
        testId={testId}
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: RADIUS.md,
          cursor: "pointer",
          backgroundColor: pressed ? theme.accent : "#00000000",
          hover: { backgroundColor: theme.accent },
        }}
      >
        <Icon name={icon} size={14} color={pressed ? theme.foreground : theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}

function SegmentedIcons<V extends string>({
  value,
  onChange,
  items,
}: {
  value: V;
  onChange: (value: V) => void;
  items: ReadonlyArray<{ readonly value: V; readonly icon: IconName; readonly label: string }>;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 2, padding: 2, borderRadius: RADIUS.lg, backgroundColor: alpha(theme.input, 0.4) }}>
      {items.map((item) => {
        const pressed = item.value === value;
        return (
          <Tooltip key={item.value} content={item.label} side="top">
            <div
              testId={`pr-code-layout-${item.value}`}
              onClick={() => onChange(item.value)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 24,
                borderRadius: RADIUS.md,
                cursor: "pointer",
                backgroundColor: pressed ? alpha(theme.input, 0.72) : "#00000000",
                ...(pressed ? {} : { hover: { backgroundColor: alpha(theme.input, 0.32) } }),
              }}
            >
              <Icon name={item.icon} size={14} color={pressed ? theme.foreground : theme.mutedForeground} />
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ── File tree (apps/web/src/components/diffs/DiffFileTree.tsx) ──────────

interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly children: Map<string, TreeNode>;
  file: DiffFileModel | null;
}

function buildTree(files: ReadonlyArray<DiffFileModel>): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), file: null };
  for (const file of files) {
    const segments = file.path.split("/");
    let node = root;
    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join("/");
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path, children: new Map(), file: null };
        node.children.set(segment, child);
      }
      if (index === segments.length - 1) child.file = file;
      node = child;
    });
  }
  return root;
}

/** pierre's trees fold a directory holding one directory into one row ("src/components"). */
function flattenTree(
  node: TreeNode,
  depth: number,
  collapsed: ReadonlySet<string>,
  out: Array<{ node: TreeNode; label: string; depth: number }>,
) {
  const entries = [...node.children.values()].toSorted((a, b) => {
    const aDir = a.file === null;
    const bDir = b.file === null;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    let current = entry;
    let label = entry.name;
    while (current.file === null && current.children.size === 1) {
      const only = [...current.children.values()][0]!;
      if (only.file !== null) break;
      current = only;
      label = `${label}/${only.name}`;
    }
    out.push({ node: current, label, depth });
    if (current.file === null && !collapsed.has(current.path)) flattenTree(current, depth + 1, collapsed, out);
  }
}

function PullRequestFileTree({
  files,
  isViewed,
  onSelect,
  footer,
}: {
  files: ReadonlyArray<DiffFileModel>;
  isViewed: ((path: string) => boolean) | null;
  onSelect: (path: string) => void;
  footer: ReactNode;
}) {
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => {
    const out: Array<{ node: TreeNode; label: string; depth: number }> = [];
    flattenTree(buildTree(files), 0, collapsed, out);
    return out;
  }, [files, collapsed]);
  const statusColor = (file: DiffFileModel) =>
    file.kind === "new" ? theme.diffAdd : file.kind === "deleted" ? theme.diffDel : file.kind === "renamed" ? theme.warningForeground : theme.infoForeground;
  return (
    <div
      testId="pr-code-file-tree"
      style={{
        display: "flex",
        flexDirection: "column",
        width: 280,
        minWidth: 192,
        flexShrink: 0,
        borderLeftWidth: 1,
        borderColor: alpha(theme.border, 0.6),
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingLeft: 12, paddingRight: 8, flexShrink: 0 }}>
        <Text size="xs" weight={600} style={{ flexGrow: 1 }}>
          Files
        </Text>
        <Text size="xs" color={theme.mutedForeground}>
          {String(files.length)}
        </Text>
        <Tooltip content={collapsed.size > 0 ? "Expand all folders" : "Collapse all folders"}>
          <div
            testId="pr-code-tree-fold"
            onClick={() =>
              setCollapsed(collapsed.size > 0 ? new Set() : new Set(rows.filter((row) => row.node.file === null).map((row) => row.node.path)))
            }
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: RADIUS.sm, cursor: "pointer", hover: { backgroundColor: theme.accent } }}
          >
            <Icon name={collapsed.size > 0 ? "chevrons-up-down" : "chevrons-down-up"} size={12} color={theme.mutedForeground} />
          </div>
        </Tooltip>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar, padding: 4 }}>
        {rows.map(({ node, label, depth }) => {
          const file = node.file;
          const folded = collapsed.has(node.path);
          return (
            <div
              key={node.path}
              testId={`pr-code-tree-${node.path}`}
              onClick={() => {
                if (file) onSelect(file.path);
                else
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(node.path)) next.delete(node.path);
                    else next.add(node.path);
                    return next;
                  });
              }}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                height: 28,
                paddingLeft: 8 + depth * 12,
                paddingRight: 8,
                borderRadius: RADIUS.md,
                flexShrink: 0,
                cursor: "pointer",
                hover: { backgroundColor: alpha(theme.accent, 0.6) },
              }}
            >
              {file ? null : <Icon name={folded ? "chevron-right" : "chevron-down"} size={12} color={theme.mutedForeground} />}
              <FileEntryIcon pathValue={node.path} kind={file ? "file" : "directory"} size={14} />
              <text
                style={{
                  color: file && isViewed?.(file.path) ? theme.mutedForeground : theme.foreground,
                  fontSize: 12,
                  lineHeight: 16,
                  fontFamily: FONTS.sans,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  minWidth: 0,
                  flexGrow: 1,
                }}
              >
                {label}
              </text>
              {file ? (
                <>
                  {isViewed?.(file.path) ? <Icon name="check" size={12} color={theme.mutedForeground} /> : null}
                  <text style={{ color: statusColor(file), fontSize: 11, lineHeight: 16, fontWeight: 600, fontFamily: FONTS.sans, flexShrink: 0 }}>
                    {file.kind === "new" ? "A" : file.kind === "deleted" ? "D" : file.kind === "renamed" ? "R" : "M"}
                  </text>
                </>
              ) : (
                <div style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: alpha(theme.infoForeground, 0.7), flexShrink: 0 }} />
              )}
            </div>
          );
        })}
      </div>
      {footer ? <div style={{ display: "flex", padding: 8, borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>{footer}</div> : null}
    </div>
  );
}
