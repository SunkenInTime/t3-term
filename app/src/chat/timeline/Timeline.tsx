// The chat timeline: apps/web/src/components/chat/ThreadTimeline.tsx +
// MessagesTimeline.tsx, with the thread-state wiring ChatView.tsx does for them
// (latest run, working state, checkpoints, history paging, rewind and fork).
import { optimisticMessagesAtom } from "../../state/composer.ts";
import { openDiffSurface } from "../../state/git.ts";
import { useAtomValue } from "@effect/atom-react";

import { clientSettingAtom } from "../../state/clientSettings.ts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { HandoffTimelineRun } from "@t3tools/client-runtime/handoff";
import {
  deriveLatestThreadRun,
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveThreadStructureRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import { runAtomCommand, isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { workspacePreparationRetryRunIds } from "@t3tools/client-runtime/state/turn-item-presentation";
import { resolveVisibleWorktreeSetup, worktreeSetupAgentStarted } from "@t3tools/client-runtime/worktree-setup";
import {
  CommandId,
  type EnvironmentId,
  type MessageId,
  type RunAttemptId,
  type RunId,
  type ScopedThreadRef,
  ThreadId,
  type WorktreeSetupSnapshot,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { AsyncResult, Atom } from "effect/reactivity";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  environmentProjects,
  environmentThreadDetails,
  environmentThreadShells,
  serverEnvironment,
  threadEnvironment,
} from "../../state/environment.ts";
import {
  composerInsetAtom,
  restoredPromptAtom,
  revertConfirmAtom,
  rewindingThreadKeysAtom,
  timelineLocalErrorsAtom,
  timelineVcs,
  turnDiffRequestAtom,
} from "../../state/timeline.ts";
import { findBarOpenAtom, routeAtom } from "../../state/ui.ts";
import { Dialog } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { LAYOUT, alpha, useTheme } from "../../ui/theme.ts";
import { chatLanePadding, useSmallViewport } from "../../ui/viewport.tsx";
import { toast } from "../../ui/toast.tsx";
import { deriveAvailableRevertTurnCounts, resolveWorktreeSetupProgress } from "../../web/components/chatViewTimeline.logic.ts";
import { recallableComposerPrompt } from "../../web/components/chat/composerPromptHistory.ts";
import { timelineTurnFoldRunIdsByEntryId, type MessagesTimelineRow } from "../../web/components/chat/MessagesTimeline.logic.ts";
import { useIncrementalTimelineRows, useStableHandoffRuns, useStableRows } from "../../web/components/chat/useTimelineRows.ts";
import { useIncrementalTimelineEntries } from "../../web/hooks/useIncrementalTimelineEntries.ts";
import { deriveActiveWorkStartedAt, derivePhase, findRevertCheckpoint, isLatestRunSettled } from "../../web/session-logic.ts";
import type { ChatMessage } from "../../web/types.ts";
import { Icon } from "../../ui/Icon.tsx";
import {
  resolveTimelineMinimapCurrentIndex,
  resolveTimelineMinimapHasPersistentGutter,
  resolveTimelineMinimapHitStripWidth,
} from "../../web/components/chat/MessagesTimeline.logic.ts";
import { deriveTimelineMinimapItems, type TimelineMinimapItem } from "../../web/components/chat/timelineMinimapItems.ts";
import { ChatLane, useDetailsCardInline } from "../chatLane.tsx";
import "./devOpenThread.ts";
import { TimelineMinimap } from "./TimelineMinimap.tsx";
import { ThreadErrorBanner } from "./ThreadErrorBanner.tsx";
import { findHighlightColors, ThreadFindBar, type ThreadFindState } from "./ThreadFindBar.tsx";
import { ThreadStatusFooter } from "./ThreadStatusLine.tsx";
import { PendingHandoffRow } from "./PendingHandoffRow.tsx";
import { TimelineRowContent } from "./TimelineRows.tsx";
import { TimelineSystemDivider } from "./parts.tsx";
import { MarkdownOverlayHost } from "../markdown/overlays.tsx";
import { resolveProviderSkillsForCwd } from "@t3tools/client-runtime/providerSkills";
import { resolveWorkflowOpening, workflowOpeningParentThreadId } from "@t3tools/client-runtime/state/subagentRuntime";
import type { InlineSkill } from "@t3tools/shared/inlineSkills";

const NO_TIMELINE_SKILLS: ReadonlyArray<InlineSkill> = [];
const NO_PARENT_STRUCTURE = Atom.make(null);
import { TextMeasureHost } from "../markdown/TextMeasureHost.tsx";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
  type WorkGroupViewState,
} from "./rowContext.ts";

const EMPTY_RUN_IDS: ReadonlySet<RunId> = new Set();

/** Disclosure state per thread, so returning to a thread reopens what the reader opened. */
interface RememberedDisclosures {
  runs: ReadonlySet<RunId>;
  workGroups: ReadonlySet<string>;
  attempts: ReadonlySet<RunAttemptId>;
  changedFiles: ReadonlySet<RunId>;
  workGroupViewState: WorkGroupViewState;
}
const rememberedDisclosures = new Map<string, RememberedDisclosures>();

function rememberedFor(threadKey: string): RememberedDisclosures {
  let remembered = rememberedDisclosures.get(threadKey);
  if (!remembered) {
    remembered = {
      runs: new Set(),
      workGroups: new Set(),
      attempts: new Set(),
      changedFiles: new Set(),
      workGroupViewState: { expandedEntries: new Set() },
    };
    rememberedDisclosures.set(threadKey, remembered);
  }
  return remembered;
}

/** A callback whose identity never changes but always calls the latest closure. */
function useStableCallback<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
  const ref = useRef(callback);
  ref.current = callback;
  return useRef((...args: A) => ref.current(...args)).current;
}

function toggleIn<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function Timeline({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const threadRef = useMemo(() => scopeThreadRef(environmentId, threadId), [environmentId, threadId]);
  // Keyed by thread: switching threads starts a fresh list, like web's list identity.
  return <ThreadTimeline key={scopedThreadKey(threadRef)} threadRef={threadRef} />;
}

function ThreadTimeline({ threadRef }: { threadRef: ScopedThreadRef }) {
  const theme = useTheme();
  const threadKey = scopedThreadKey(threadRef);
  const { environmentId, threadId } = threadRef;

  const structure = useAtomValue(environmentThreadDetails.quietThreadAtom(threadRef));
  const projection = structure?.projection ?? null;
  // web ChatView: a workflow coordinator's thread opens with its script; the plan that
  // replaces it lives on the parent's coordinator row, so only such a thread loads its parent.
  const workflowParentId = projection === null ? null : workflowOpeningParentThreadId({ thread: projection.thread, messages: projection.messages });
  const workflowParent = useAtomValue(
    workflowParentId === null ? NO_PARENT_STRUCTURE : environmentThreadDetails.quietThreadAtom(scopeThreadRef(threadRef.environmentId, workflowParentId)),
  );
  const workflowOpening = useMemo(
    () =>
      projection === null || workflowParentId === null
        ? null
        : resolveWorkflowOpening({
            thread: projection.thread,
            messages: projection.messages,
            parentSubagents: (workflowParent as { projection?: { subagents?: Parameters<typeof resolveWorkflowOpening>[0]["parentSubagents"] } } | null)?.projection?.subagents ?? null,
          }),
    [projection, workflowParentId, workflowParent],
  );
  const visibleTurnItems = useAtomValue(environmentThreadDetails.visibleTurnItemsAtom(threadRef));
  const history = useAtomValue(environmentThreadDetails.historyAtom(threadRef));
  const status = useAtomValue(environmentThreadDetails.statusAtom(threadRef));
  const checkpointSummaries = useAtomValue(environmentThreadDetails.checkpointSummariesAtom(threadRef));
  const shell = useAtomValue(environmentThreadShells.threadShellAtom(threadRef));
  const projectId = shell?.projectId ?? projection?.thread.projectId ?? null;
  const project = useAtomValue(
    projectId === null ? NO_PROJECT_ATOM : environmentProjects.projectAtom({ environmentId, projectId }),
  );
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const parentRef =
    shell?.lineage.relationshipToParent === "subagent" && shell.lineage.parentThreadId
      ? scopeThreadRef(environmentId, shell.lineage.parentThreadId)
      : null;
  const parentShell = useAtomValue(
    environmentThreadShells.threadShellAtom(parentRef ?? scopeThreadRef(environmentId, ThreadId.make("__none__"))),
  );
  const localErrors = useAtomValue(timelineLocalErrorsAtom);
  const rewinding = useAtomValue(rewindingThreadKeysAtom).has(threadKey);

  // ── Run and runtime state (ChatView.tsx:740-1420) ─────────────────────────
  // Web relies on the React Compiler to cache these per projection; the rows
  // hook compares its inputs by identity, so they must be memoized here.
  const { latestRun, activityRun, runtime, runlessWorkStartedAt } = useMemo(
    () => ({
      latestRun: projection === null ? null : deriveLatestThreadRun(projection),
      activityRun: projection === null ? null : deriveThreadActivityRun(projection),
      runtime: projection === null ? null : deriveThreadStructureRuntime(projection),
      runlessWorkStartedAt: projection === null ? null : deriveRunlessWorkStartedAt(projection),
    }),
    [projection],
  );
  const phase = derivePhase(runtime);
  const compactionRunning =
    projection?.turnItems.some(
      (item) =>
        item.type === "compaction" &&
        item.runId !== null &&
        item.runId === runtime?.activeRunId &&
        item.status === "running",
    ) ?? false;
  const isCompacting = (phase === "connecting" || phase === "running") && compactionRunning;
  const isWorking = phase === "running" || isCompacting || runlessWorkStartedAt !== null;
  const latestRunSettled = isLatestRunSettled(latestRun, runtime);
  const activeWorkStartedAt = deriveActiveWorkStartedAt(activityRun, runtime, null) ?? runlessWorkStartedAt;
  const providerStatus = providers?.find((provider) => provider.instanceId === runtime?.providerInstanceId) ?? null;
  const supportsConversationRollback =
    providerStatus === null || providerStatus.supportsConversationRollback !== false;
  const availableRevertTurnCounts = useMemo(() => deriveAvailableRevertTurnCounts(projection), [projection]);
  const threadStartCheckpointReady =
    !history.hasMoreHistory && findRevertCheckpoint(projection?.checkpoints ?? [], 0) !== undefined;
  const workspaceRoot = shell?.worktreePath ?? project?.workspaceRoot ?? undefined;
  const markdownCwd = workspaceRoot;
  // web ChatView timelineSkills: the active provider's skills for this workspace.
  const skills = useMemo(
    () => (providerStatus ? resolveProviderSkillsForCwd(providerStatus, workspaceRoot) : NO_TIMELINE_SKILLS),
    [providerStatus, workspaceRoot],
  );

  // ── Worktree setup (useWorktreeSetup.ts) ──────────────────────────────────
  const runPreparing = activityRun?.status === "preparing";
  const [heldSnapshot, setHeldSnapshot] = useState<WorktreeSetupSnapshot | null>(null);
  const setupResult = useAtomValue(
    runPreparing || heldSnapshot?.phase === "running"
      ? timelineVcs.worktreeSetup({ environmentId, input: { threadId } })
      : EMPTY_SETUP_ATOM,
  );
  const latestSnapshot = setupResult._tag === "Success" ? setupResult.value : null;
  useEffect(() => {
    if (latestSnapshot && latestSnapshot !== heldSnapshot) {
      setHeldSnapshot((current) =>
        current?.threadId === latestSnapshot.threadId && current.sequence > latestSnapshot.sequence ? current : latestSnapshot,
      );
    }
  }, [latestSnapshot, heldSnapshot]);
  const { snapshot: liveSetup, isPreparingWorktree } = resolveWorktreeSetupProgress({
    threadId,
    localPreparing: false,
    runStatus: activityRun?.status,
    latest: latestSnapshot,
    held: heldSnapshot,
  });
  const turnStarted = activityRun?.startedAt != null;
  const worktreeSetup = useMemo(
    () => resolveVisibleWorktreeSetup({ live: liveSetup, recorded: null, turnStarted, followUpSent: false }),
    [liveSetup, turnStarted],
  );
  const retryableKey = [
    ...workspacePreparationRetryRunIds(projection?.runs ?? [], projection?.turnItems ?? []),
  ].join("\n");
  const retryableRunIds = useMemo(
    () => (retryableKey === "" ? EMPTY_RUN_IDS : new Set(retryableKey.split("\n") as RunId[])),
    [retryableKey],
  );

  // ── Entries and rows ──────────────────────────────────────────────────────
  // Sent messages shown before the server has them (state/composer.ts, set by the composer's send).
  const optimisticMessages = useAtomValue(optimisticMessagesAtom(threadKey));
  const timelineEntries = useIncrementalTimelineEntries(threadKey, {
    visibleTurnItems,
    optimisticMessages: optimisticMessages,
    ...(projection === null ? {} : { attempts: projection.attempts, nodes: projection.nodes, plans: projection.plans }),
  });
  const remembered = rememberedFor(threadKey);
  const [expandedRunIds, setExpandedRunIds] = useState(remembered.runs);
  const [expandedWorkGroupIds, setExpandedWorkGroupIds] = useState(remembered.workGroups);
  const [expandedAttemptIds, setExpandedAttemptIds] = useState(remembered.attempts);
  const [changedFilesExpanded, setChangedFilesExpanded] = useState(remembered.changedFiles);
  remembered.runs = expandedRunIds;
  remembered.workGroups = expandedWorkGroupIds;
  remembered.attempts = expandedAttemptIds;
  remembered.changedFiles = changedFilesExpanded;

  // A new run collapses the previous run's fold again; an interrupted run opens (MessagesTimeline.tsx:516).
  const previousLatestRunRef = useRef(activityRun);
  useEffect(() => {
    const previous = previousLatestRunRef.current;
    previousLatestRunRef.current = activityRun;
    if (!activityRun || previous?.runId === undefined) return;
    if (activityRun.runId === previous.runId) {
      if (previous.status === "running" && activityRun.status === "interrupted") {
        setExpandedRunIds((existing) => new Set(existing).add(activityRun.runId));
      }
      return;
    }
    setExpandedRunIds((existing) => {
      if (!existing.has(previous.runId)) return existing;
      const next = new Set(existing);
      next.delete(previous.runId);
      return next;
    });
  }, [activityRun]);

  const rawRows = useIncrementalTimelineRows(`${threadKey}\0${workspaceRoot ?? ""}`, {
    timelineEntries,
    latestRun: activityRun,
    runningRunId: runtime?.activeRunId ?? null,
    expandedRunIds,
    expandedAttemptIds,
    expandedWorkGroupIds,
    isWorking,
    runlessWorkActive: runlessWorkStartedAt !== null,
    activeTurnStartedAt: activeWorkStartedAt,
    turnDiffSummaries: checkpointSummaries,
    supportsConversationRollback,
    threadStartCheckpointReady,
    availableRevertTurnCounts,
    worktreeSetup,
  });
  const rows = useStableRows(rawRows, threadKey);
  const runs = useStableHandoffRuns((projection?.runs ?? EMPTY_HANDOFF_RUNS) as ReadonlyArray<HandoffTimelineRun>);

  // ── Actions ───────────────────────────────────────────────────────────────
  const setLocalError = (error: string | null) => {
    const next = new Map(appAtomRegistry.get(timelineLocalErrorsAtom));
    if (error === null) next.delete(threadKey);
    else next.set(threadKey, error);
    appAtomRegistry.set(timelineLocalErrorsAtom, next);
  };
  const setRewinding = (active: boolean) => {
    const next = new Set(appAtomRegistry.get(rewindingThreadKeysAtom));
    if (active) next.add(threadKey);
    else next.delete(threadKey);
    appAtomRegistry.set(rewindingThreadKeysAtom, next);
  };

  const onRevertToTurnCount = useStableCallback((turnCount: number, messageId: MessageId) => {
    if (rewinding) return;
    if (!supportsConversationRollback) {
      setLocalError("This provider does not support reverting conversation history. Start a new thread instead.");
      return;
    }
    if (phase === "running") {
      setLocalError("Interrupt the current turn before reverting checkpoints.");
      return;
    }
    appAtomRegistry.set(revertConfirmAtom, { threadKey, turnCount, messageId });
  });

  const confirmRevert = useStableCallback(async (turnCount: number, messageId: MessageId, restoreFiles: boolean) => {
    const message = timelineEntries.flatMap((entry) => (entry.kind === "message" && entry.message.id === messageId ? [entry.message] : []))[0];
    if (!message || message.role !== "user") return;
    setRewinding(true);
    setLocalError(null);
    const checkpoint = findRevertCheckpoint(projection?.checkpoints ?? [], turnCount);
    const result = await runAtomCommand(appAtomRegistry, threadEnvironment.revertCheckpoint, {
      environmentId,
      input: {
        commandId: CommandId.make(crypto.randomUUID()),
        threadId,
        turnCount,
        restoreFiles,
        ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id, scopeId: checkpoint.scopeId }),
      },
    });
    setRewinding(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setLocalError(error instanceof Error ? error.message : "Failed to revert thread state.");
      }
      return;
    }
    const prompt = recallableComposerPrompt(message.text);
    if (prompt.length > 0) appAtomRegistry.set(restoredPromptAtom, { threadId, prompt, nonce: Date.now() });
  });

  const [pendingRollback, setPendingRollback] = useState<{ checkpointId: string; scopeId: string } | null>(null);
  const onRollbackCheckpoint = useStableCallback((input: { readonly checkpointId: string; readonly scopeId: string }) => {
    if (rewinding) return;
    if (phase === "running") {
      setLocalError("Interrupt the current turn before reverting checkpoints.");
      return;
    }
    setPendingRollback(input);
  });
  const confirmRollback = useStableCallback(async () => {
    const input = pendingRollback;
    setPendingRollback(null);
    if (!input) return;
    setRewinding(true);
    setLocalError(null);
    const result = await runAtomCommand(appAtomRegistry, threadEnvironment.revertCheckpoint, {
      environmentId,
      input: { commandId: CommandId.make(crypto.randomUUID()), threadId, ...input },
    });
    setRewinding(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setLocalError(error instanceof Error ? error.message : "Failed to revert thread state.");
    }
  });

  const onOpenThread = useStableCallback((target: ThreadId) => {
    appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId: target });
  });

  const onForkFromRun = useStableCallback(async (input: { readonly sourceThreadId: ThreadId; readonly runId: RunId }) => {
    const targetThreadId = ThreadId.make(crypto.randomUUID());
    const result = await runAtomCommand(appAtomRegistry, threadEnvironment.forkFromRun, {
      environmentId,
      input: {
        commandId: CommandId.make(crypto.randomUUID()),
        sourceThreadId: input.sourceThreadId,
        targetThreadId,
        runId: input.runId,
        title: `${shell?.title ?? projection?.thread.title ?? "Thread"} fork`,
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setLocalError(error instanceof Error ? error.message : "Failed to fork this response.");
      }
      return;
    }
    appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId: targetThreadId });
  });

  const onOpenTurnDiff = useStableCallback((runId: RunId, filePath?: string) => {
    appAtomRegistry.set(turnDiffRequestAtom, { environmentId, threadId, runId, filePath: filePath ?? null, nonce: Date.now() });
    openDiffSurface({ environmentId, threadId }, { turnId: runId, ...(filePath ? { filePath } : {}) });
  });

  const onCancelWorktreeSetup = useStableCallback(() => {
    if (!worktreeSetup || worktreeSetup.phase !== "running") return;
    void runAtomCommand(appAtomRegistry, timelineVcs.cancelWorktreeSetup, {
      environmentId,
      input: { threadId: worktreeSetup.threadId },
    });
  });
  const onRetryWorkspacePreparation = useStableCallback((runId: RunId) => {
    void runAtomCommand(appAtomRegistry, threadEnvironment.retryWorkspacePreparation, {
      environmentId,
      input: { threadId, runId },
    });
  });

  const onToggleTurnFold = useStableCallback((runId: RunId) => setExpandedRunIds((current) => toggleIn(current, runId)));
  const onToggleAttemptFold = useStableCallback((attemptId: RunAttemptId) =>
    setExpandedAttemptIds((current) => toggleIn(current, attemptId)),
  );
  const onToggleWorkGroup = useStableCallback((groupId: string) => setExpandedWorkGroupIds((current) => toggleIn(current, groupId)));
  const onToggleChangedFilesExpanded = useStableCallback((runId: RunId) =>
    setChangedFilesExpanded((current) => toggleIn(current, runId)),
  );

  const timestampFormat: TimestampFormat = useAtomValue(clientSettingAtom("timestampFormat"));
  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      timestampFormat,
      routeThreadKey: threadKey,
      threadRef,
      markdownCwd,
      skills,
      workflowOpening,
      workspaceRoot,
      runs,
      activeThreadEnvironmentId: environmentId,
      onRevertToTurnCount,
      onOpenTurnDiff,
      onOpenThread,
      onForkFromRun,
      onRollbackCheckpoint,
      onToggleTurnFold,
      onToggleAttemptFold,
      onToggleWorkGroup,
      onCancelWorktreeSetup,
      retryableWorkspacePreparationRunIds: retryableRunIds,
      onRetryWorkspacePreparation,
      onOpenWorktreeSetupTerminal: null,
      workGroupViewState: remembered.workGroupViewState,
      changedFilesExpandedRunIds: changedFilesExpanded,
      onToggleChangedFilesExpanded,
    }),
    // The callbacks are stable; only data the rows read invalidates the context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timestampFormat, threadKey, threadRef, markdownCwd, skills, workflowOpening, workspaceRoot, runs, environmentId, retryableRunIds, changedFilesExpanded],
  );

  const backgroundWorktreeSetup =
    worktreeSetup !== null &&
    worktreeSetup.phase === "running" &&
    worktreeSetupAgentStarted(worktreeSetup) &&
    activityRun?.startedAt != null
      ? worktreeSetup
      : null;
  const compactionAwaitingRow = isCompacting && !rows.some((row) => row.kind === "context-compaction" && row.active);
  const activityState = useMemo<TimelineRowActivityState>(
    () => ({
      isWorking,
      isCompacting: compactionAwaitingRow,
      isRevertingCheckpoint: rewinding,
      activeTurnInProgress: isWorking || !latestRunSettled,
      awaitingUser: false,
      isPreparingWorktree,
      latestRunId: activityRun?.runId ?? null,
      backgroundWorktreeSetup,
    }),
    [isWorking, compactionAwaitingRow, rewinding, latestRunSettled, isPreparingWorktree, activityRun?.runId, backgroundWorktreeSetup],
  );

  // ── Find in thread (ThreadFindProvider + useThreadFind) ───────────────────
  const findOpen = useAtomValue(findBarOpenAtom);
  const [find, setFind] = useState<ThreadFindState | null>(null);
  const onFindChange = useStableCallback((next: ThreadFindState) => {
    setFind(next);
    const entryId = next.match?.entryId;
    if (!entryId) return;
    // Reveal the match: open the turn fold and superseded attempt that hide it.
    const foldRunId = timelineTurnFoldRunIdsByEntryId({
      timelineEntries,
      latestRun: activityRun,
      runningRunId: runtime?.activeRunId ?? null,
      isWorking,
      runlessWorkActive: runlessWorkStartedAt !== null,
    }).get(entryId);
    if (foldRunId) setExpandedRunIds((current) => (current.has(foldRunId) ? current : new Set(current).add(foldRunId)));
    const attemptId = timelineEntries.find((entry) => entry.id === entryId)?.attempt?.id;
    if (attemptId) setExpandedAttemptIds((current) => (current.has(attemptId) ? current : new Set(current).add(attemptId)));
  });
  const closeFind = useStableCallback(() => {
    appAtomRegistry.set(findBarOpenAtom, false);
    setFind(null);
  });
  const activeFind = findOpen ? find : null;

  // ── History paging ────────────────────────────────────────────────────────
  const loadEarlier = useStableCallback(() => {
    if (!history.hasMoreHistory || history.loading) return;
    void runAtomCommand(appAtomRegistry, threadEnvironment.loadEarlierHistory, { environmentId, input: { threadId } });
  });

  const threadError = localErrors.get(threadKey) ?? runtime?.lastError ?? null;
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const visibleThreadError = threadError !== null && threadError !== dismissedError ? threadError : null;

  const syncing = projection === null && status !== "deleted";
  const showHistoryControl = history.hasMoreHistory || history.error !== null;
  const parentThreadLink = parentRef === null ? null : { threadId: parentRef.threadId, title: parentShell?.title ?? "Parent thread" };

  let body: ReactNode;
  if (rows.length === 0 && !isWorking && parentThreadLink === null && !showHistoryControl) {
    body = syncing ? (
      <div style={{ flexGrow: 1 }} />
    ) : (
      <EmptyTimeline />
    );
  } else {
    body = (
      <TimelineRowCtx value={sharedState}>
        <TimelineRowActivityCtx value={activityState}>
          <TimelineList
            threadRef={threadRef}
            rows={rows}
            find={activeFind}
            history={showHistoryControl ? history : null}
            onLoadEarlier={loadEarlier}
            parentThreadLink={parentThreadLink}
            onOpenThread={onOpenThread}
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>
    );
  }

  const pendingRevert = useAtomValue(revertConfirmAtom);
  const revertForThisThread = pendingRevert?.threadKey === threadKey ? pendingRevert : null;
  const closeRevert = () => appAtomRegistry.set(revertConfirmAtom, null);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, minWidth: 0, position: "relative", backgroundColor: theme.background }}>
      {visibleThreadError ? (
        <ThreadErrorBanner
          error={visibleThreadError}
          errorClass={localErrors.has(threadKey) ? null : (runtime?.lastErrorClass ?? null)}
          onDismiss={() => {
            setLocalError(null);
            setDismissedError(visibleThreadError);
          }}
        />
      ) : null}
      <TextMeasureHost />
      {body}
      <MarkdownOverlayHost />
      {findOpen ? (
        <div style={{ position: "absolute", top: 12, right: 12, width: 280, display: "flex", pointerEvents: "none" }}>
          <ThreadFindBar environmentId={environmentId} threadId={threadId} onChange={onFindChange} onClose={closeFind} />
        </div>
      ) : null}
      <Dialog
        open={revertForThisThread !== null}
        onOpenChange={(open) => {
          if (!open) closeRevert();
        }}
        title="Edit from here?"
        description="Rewind chat to before this message. Your prompt and attachments return to the composer. “Revert files too” also undoes your own edits."
        width={512}
        testId="revert-confirm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeRevert}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              testId="revert-files-too"
              style={{ borderColor: theme.input }}
              onClick={() => {
                const pending = revertForThisThread;
                closeRevert();
                if (pending) void confirmRevert(pending.turnCount, pending.messageId, true);
              }}
            >
              <Text size="sm" weight={500} color={theme.errorForeground}>
                Revert files too
              </Text>
            </Button>
            <Button
              size="sm"
              testId="revert-keep-changes"
              onClick={() => {
                const pending = revertForThisThread;
                closeRevert();
                if (pending) void confirmRevert(pending.turnCount, pending.messageId, false);
              }}
            >
              Revert and keep changes
            </Button>
          </>
        }
      />
      <Dialog
        open={pendingRollback !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRollback(null);
        }}
        title="Roll back this thread?"
        description="Roll back this thread to the selected checkpoint? This action cannot be undone."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setPendingRollback(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void confirmRollback()}>
              Roll back
            </Button>
          </>
        }
      />
    </div>
  );
}

const EMPTY_HANDOFF_RUNS: ReadonlyArray<HandoffTimelineRun> = [];

const NO_PROJECT_ATOM = Atom.make(null);
const EMPTY_SETUP_ATOM = Atom.make(AsyncResult.initial<WorktreeSetupSnapshot | null, never>(false));

function EmptyTimeline() {
  const theme = useTheme();
  const inset = useAtomValue(composerInsetAtom);
  return (
    <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", paddingBottom: inset }}>
      <Text size="sm" color={alpha(theme.mutedForeground, 0.3)}>
        Send a message to start the conversation.
      </Text>
    </div>
  );
}

// ── The list ────────────────────────────────────────────────────────────────

const TimelineList = memo(function TimelineList({
  threadRef,
  rows,
  find,
  history,
  onLoadEarlier,
  parentThreadLink,
  onOpenThread,
}: {
  threadRef: ScopedThreadRef;
  rows: ReadonlyArray<MessagesTimelineRow>;
  find: ThreadFindState | null;
  history: { readonly hasMoreHistory: boolean; readonly loading: boolean; readonly error: string | null } | null;
  onLoadEarlier: () => void;
  parentThreadLink: { readonly threadId: ThreadId; readonly title: string } | null;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const listRef = useRef<PublicInstance | null>(null);
  const composerInset = useAtomValue(composerInsetAtom);
  const cardInline = useDetailsCardInline();
  const [atEnd, setAtEnd] = useState(true);
  const leadingRows = (history ? 1 : 0) + (parentThreadLink ? 1 : 0) + 1;
  const rowCount = leadingRows + rows.length + 2;
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  // web TimelineListFooter: the composer inset, then `h-3 sm:h-4`.
  const small = useSmallViewport();
  const footerHeight = composerInset + (small ? 12 : 16);

  // Row heights by key, reported by each row frame's onLayout. They place the
  // minimap's lit strips and tell whether the whole thread fits on screen.
  const rowHeights = useRef(new Map<string, number>());
  const listKeys = [
    "timeline-header",
    ...(history ? ["timeline-history"] : []),
    ...(parentThreadLink ? ["timeline-parent"] : []),
    ...rows.map((row) => row.id),
    "timeline-status",
  ];
  const listKeysRef = useRef(listKeys);
  listKeysRef.current = listKeys;

  // A bottom-aligned list rests a short thread against the composer, while
  // web's list starts at the top. Once every row has been measured and they
  // fit, the footer takes up the slack so the first row sits under the header.
  const [topFill, setTopFill] = useState(0);
  const refreshTopFill = () => {
    if (viewport.height <= 0) return;
    let total = 0;
    for (const key of listKeysRef.current) {
      const height = rowHeights.current.get(key);
      if (height === undefined) return;
      total += height;
    }
    const next = Math.max(0, Math.floor(viewport.height - total - footerHeight));
    setTopFill((current) => (Math.abs(current - next) < 1 ? current : next));
  };

  // web resolveTimelineMinimapVisibleRange: the rows that intersect the viewport,
  // here from gpui's scroll anchor plus the measured row heights.
  const [visibleRange, setVisibleRange] = useState<{ start: number; end: number } | null>(null);
  const checkAtEnd = () => {
    const id = listRef.current?.id;
    if (id == null) return;
    const top = renderer.getListScrollTop?.(id);
    if (!top) return;
    const [anchor = 0, offset = 0, viewportHeight = 0] = top;
    // gpui reports item index === count when a bottom-aligned list rests at its end.
    const nextAtEnd = anchor >= rowCount - 1;
    setAtEnd((current) => (current === nextAtEnd ? current : nextAtEnd));
    const keys = [...listKeysRef.current, "timeline-footer"];
    const heightAt = (index: number) =>
      keys[index] === "timeline-footer" ? footerHeight + topFill : (rowHeights.current.get(keys[index]!) ?? 90);
    let start = -1;
    let end = -1;
    if (anchor >= keys.length) {
      let bottom = viewportHeight;
      for (let index = keys.length - 1; index >= 0 && bottom > 0; index -= 1) {
        end = end < 0 ? index : end;
        start = index;
        bottom -= heightAt(index);
      }
    } else {
      let y = -offset;
      for (let index = anchor; index < keys.length && y < viewportHeight; index += 1) {
        const height = heightAt(index);
        if (y + Math.max(1, height) > 0) {
          start = start < 0 ? index : start;
          end = index;
        }
        y += height;
      }
    }
    const next = start < 0 ? null : { start: start - leadingRows, end: end - leadingRows };
    setVisibleRange((current) => (current?.start === next?.start && current?.end === next?.end ? current : next));
  };

  const measureScheduled = useRef(false);
  const onRowLayout = (key: string, height: number) => {
    if (rowHeights.current.get(key) === height) return;
    rowHeights.current.set(key, height);
    if (measureScheduled.current) return;
    measureScheduled.current = true;
    queueMicrotask(() => {
      measureScheduled.current = false;
      refreshTopFill();
      checkAtEnd();
    });
  };
  useEffect(() => {
    refreshTopFill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.height, footerHeight, rows.length]);

  const minimapItems = useMemo(() => deriveTimelineMinimapItems(rows), [rows]);
  const minimapInView = useMemo(() => {
    const ids = new Set<string>();
    if (visibleRange) {
      for (const item of minimapItems) {
        if (item.rowIndex >= visibleRange.start && item.rowIndex <= visibleRange.end) ids.add(item.id);
      }
    }
    return ids;
  }, [minimapItems, visibleRange]);
  const minimapCurrentIndex = resolveTimelineMinimapCurrentIndex({
    visibleStart: visibleRange?.start,
    visibleEnd: visibleRange?.end,
    rowIndices: minimapItems.map((item) => item.rowIndex),
  });
  const laneWidth = Math.max(0, Math.min(LAYOUT.chatMaxWidth, viewport.width - chatLanePadding(small) * 2));
  const minimapHitStripWidth = resolveTimelineMinimapHitStripWidth(viewport.width, laneWidth);
  const selectMinimapItem = (item: TimelineMinimapItem) => {
    const id = listRef.current?.id;
    // web scrollToIndex viewOffset 24: the message lands 24px below the top edge.
    if (id != null) renderer.scrollToItem?.(id, leadingRows + item.rowIndex, -24);
    setTimeout(checkAtEnd, 50);
  };

  // Rows added or removed (a rewind, a load) move the end without a scroll event.
  useEffect(() => {
    const id = setTimeout(checkAtEnd, 120);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const scrollToEnd = () => {
    const id = listRef.current?.id;
    if (id != null) renderer.scrollToItem?.(id, rowCount - 1);
    setAtEnd(true);
  };

  // The row that holds the active match: its own id, or the work row that groups it.
  const findRowIndex =
    find?.match == null
      ? -1
      : rows.findIndex(
          (row) =>
            row.id === find.match!.entryId ||
            (row.kind === "work" && row.groupedEntries.some((entry) => entry.id === find.match!.entryId)) ||
            (row.kind === "work-toggle" && row.id === `work-toggle:${find.match!.entryId}`),
        );
  useEffect(() => {
    const id = listRef.current?.id;
    if (findRowIndex < 0 || id == null) return;
    renderer.scrollToItem?.(id, leadingRows + findRowIndex, -96);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findRowIndex, find?.navigationId, find?.match?.entryId]);
  const highlightColors = findHighlightColors(theme);
  const findQuery = find && find.query.length > 0 ? find.query : null;

  const frame = (key: string, children: ReactNode, rowIndex = -1) => (
    <div
      key={key}
      onLayout={(event) => onRowLayout(key, Math.round(event.height ?? 0))}
      {...(findQuery
        ? {
            highlight: {
              query: findQuery,
              ...highlightColors,
              ...(rowIndex >= 0 && rowIndex === findRowIndex && find?.match ? { activeIndex: find.match.occurrence } : {}),
            },
          }
        : {})}
    >
      <ChatLane cardInline={cardInline}>{children}</ChatLane>
    </div>
  );

  return (
    <div
      testId="timeline-list"
      style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, position: "relative" }}
      // The list itself takes no onScroll; wheel deltas reach this wrapper.
      onScroll={() => queueMicrotask(checkAtEnd)}
      onLayout={(event) => {
        const next = { width: Math.round(event.width ?? 0), height: Math.round(event.height ?? 0) };
        setViewport((current) => (current.width === next.width && current.height === next.height ? current : next));
      }}
    >
      <virtual-list
        ref={listRef}
        alignment="bottom"
        followTail
        estimatedItemHeight={90}
        overdraw={800}
        onVisibleRange={(event) => {
          if (history?.hasMoreHistory && !history.loading && Math.floor(event.startIndex ?? 1) === 0) onLoadEarlier();
          checkAtEnd();
        }}
        style={{ width: "100%", flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar }}
      >
        {/* web: the titlebar scroll-fade height, 1.5rem */}
        <div
          key="timeline-header"
          style={{ height: 24 }}
          onLayout={(event) => onRowLayout("timeline-header", Math.round(event.height ?? 0))}
        />
        {history ? frame("timeline-history", <TimelineHistoryControl {...history} onLoadEarlier={onLoadEarlier} />) : null}
        {parentThreadLink
          ? frame(
              "timeline-parent",
              <div style={{ paddingTop: 8 }}>
                <TimelineSystemDivider
                  label="Subagent of"
                  detail={parentThreadLink.title}
                  icon="bot"
                  actionLabel="Open parent thread"
                  onAction={() => onOpenThread(parentThreadLink.threadId)}
                />
              </div>,
            )
          : null}
        {rows.map((row, index) => frame(row.id, <TimelineRowContent row={row} />, index))}
        {frame(
          "timeline-status",
          <>
            <PendingHandoffRow threadRef={threadRef} />
            <ThreadStatusFooter threadRef={threadRef} />
          </>,
        )}
        <div key="timeline-footer" style={{ height: footerHeight + topFill }} />
      </virtual-list>
      <TimelineMinimap
        items={minimapItems}
        hitStripWidth={minimapHitStripWidth}
        persistentGutter={resolveTimelineMinimapHasPersistentGutter(viewport.width, laneWidth)}
        currentIndex={minimapCurrentIndex}
        inView={minimapInView}
        onSelect={selectMinimapItem}
      />
      {atEnd ? null : <ScrollToEndButton bottom={composerInset + 4} cardInline={cardInline} onScrollToEnd={scrollToEnd} />}
    </div>
  );
});

function TimelineHistoryControl(props: {
  readonly hasMoreHistory: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onLoadEarlier: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const line = <div style={{ height: 1, flexGrow: 1, backgroundColor: alpha(theme.border, 0.7) }} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8 }}>
      {props.hasMoreHistory ? (
        <div
          testId="load-earlier-turns"
          onClick={props.loading ? undefined : props.onLoadEarlier}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 6, paddingBottom: 6, cursor: props.loading ? "default" : "pointer" }}
        >
          {line}
          <Text size="xs" color={hovered && !props.loading ? theme.foreground : theme.mutedForeground} style={{ flexShrink: 0 }}>
            {props.loading ? "Loading earlier turns…" : "Load earlier turns"}
          </Text>
          {line}
        </div>
      ) : null}
      {props.error !== null ? (
        <Text size="xs" color={theme.mutedForeground} style={{ textAlign: "center" }}>
          {props.error}
        </Text>
      ) : null}
    </div>
  );
}

/** TimelineOverlays.tsx ScrollToEndButton: a glass pill 4px above the composer. */
function ScrollToEndButton({ bottom, cardInline, onScrollToEnd }: { bottom: number; cardInline: boolean; onScrollToEnd: () => void }) {
  const theme = useTheme();
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom, pointerEvents: "none" }}>
    <ChatLane cardInline={cardInline}>
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        paddingTop: 6,
        paddingBottom: 6,
        pointerEvents: "none",
      }}
    >
      <div
        testId="scroll-to-end"
        onClick={onScrollToEnd}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 24,
          paddingLeft: 9,
          paddingRight: 9,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.6),
          backgroundColor: theme.appearance === "dark" ? "#141414f2" : "#fffffff2",
          boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 3, spreadRadius: 0, color: "#0000001a" },
          cursor: "pointer",
          pointerEvents: "auto",
          hover: { borderColor: theme.border },
        }}
      >
        <Icon name="chevron-down" size={14} color={theme.mutedForeground} />
        <Text size="xs" weight={500}>
          Scroll to end
        </Text>
      </div>
    </div>
    </ChatLane>
    </div>
  );
}
