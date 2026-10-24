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
  type AssistantCitation,
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
  citationRequestAtom,
  composerInsetAtom,
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
import { prepareRevertedMessageAttachments } from "./rewindAttachments.ts";
import { ensureDrawerTerminal } from "../markdown/runInTerminal.ts";
import { composerTargetKey, focusComposer, restoreComposerContent } from "../../state/composer.ts";
import { ThreadErrorBanner } from "./ThreadErrorBanner.tsx";
import { findHighlightColors, ThreadFindBar, type ThreadFindState } from "./ThreadFindBar.tsx";
import type { ThreadFindPositionReader } from "../../web/components/chat/threadFind.ts";
import { locateFindMatch, locateQuote, readRowText } from "./findOccurrence.ts";
import { revealFindFolds } from "./findReveal.ts";
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
/** The virtual list's guess for a row it has not measured; the top fill uses it too. */
const TIMELINE_ESTIMATED_ROW_HEIGHT = 90;

/** Disclosure state per thread, so returning to a thread reopens what the reader opened. */
interface RememberedDisclosures {
  runs: ReadonlySet<RunId>;
  workGroups: ReadonlySet<string>;
  attempts: ReadonlySet<RunAttemptId>;
  changedFiles: ReadonlySet<RunId>;
  workGroupViewState: WorkGroupViewState;
  /**
   * web rememberTimelinePosition: the row under the viewport top and how far
   * into it the reader had scrolled, or null while they follow the end.
   */
  position: {
    readonly rowKey: string;
    readonly offset: number;
    /** The list's own scroll offset, for when the row is gone (web's scrollOffset fallback). */
    readonly scroll: readonly [number, number] | null;
  } | null;
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
      position: null,
    };
    rememberedDisclosures.set(threadKey, remembered);
  }
  // Most recently used last, capped at 100 threads like web.
  rememberedDisclosures.delete(threadKey);
  rememberedDisclosures.set(threadKey, remembered);
  if (rememberedDisclosures.size > 100) {
    const oldest = rememberedDisclosures.keys().next().value;
    if (oldest !== undefined) rememberedDisclosures.delete(oldest);
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
    const draftKey = composerTargetKey({ kind: "thread", environmentId, threadId });
    // web revertToTurn: fetch the attachments first, so a failure leaves the thread as it was.
    let attachments: Awaited<ReturnType<typeof prepareRevertedMessageAttachments>>;
    try {
      attachments = await prepareRevertedMessageAttachments({ message, environmentId, draftKey });
    } catch (error) {
      setRewinding(false);
      setLocalError(error instanceof Error ? error.message : "Failed to revert thread state.");
      return;
    }
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
    // The prompt and its attachments go back into the thread's draft together.
    const prompt = recallableComposerPrompt(message.text);
    if (prompt.length > 0 || attachments.length > 0) {
      restoreComposerContent(draftKey, { prompt, attachments });
      focusComposer();
    }
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
  // useWorktreeSetup openSetupTerminal: the setup script's terminal opens in this thread's drawer.
  const onOpenWorktreeSetupTerminal = useStableCallback((terminalId: string) => {
    if (worktreeSetup?.threadId !== threadId) return;
    ensureDrawerTerminal(threadKey, terminalId);
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
      onOpenWorktreeSetupTerminal,
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
  const onFindChange = useStableCallback((next: ThreadFindState) => setFind(next));
  const findMatchEntryId = findOpen ? (find?.match?.entryId ?? null) : null;
  useEffect(() => {
    const entryId = findMatchEntryId;
    if (!entryId || !timelineEntries.some((entry) => entry.id === entryId)) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findMatchEntryId, find?.navigationId, timelineEntries]);
  // useThreadFindNavigation: a match in history the client has not loaded yet
  // pages through to it, one request per page cursor.
  const requestedFindPages = useRef<{ key: string | null; pages: Set<string> }>({ key: null, pages: new Set() });
  useEffect(() => {
    const match = findOpen ? find?.match : null;
    const key = match ? `${find?.navigationId}:${find?.query}:${match.entryId}:${match.occurrence}` : null;
    if (requestedFindPages.current.key !== key) requestedFindPages.current = { key, pages: new Set() };
    if (!match || timelineEntries.some((entry) => entry.id === match.entryId)) return;
    if (!history.hasMoreHistory || history.loading || history.error) return;
    const cursor = timelineEntries[0]?.id ?? "first";
    if (requestedFindPages.current.pages.has(cursor)) return;
    requestedFindPages.current.pages.add(cursor);
    void runAtomCommand(appAtomRegistry, threadEnvironment.loadEarlierHistory, {
      environmentId,
      input: { threadId, throughEntryId: match.entryId },
    });
  }, [findOpen, find, timelineEntries, history.hasMoreHistory, history.loading, history.error, environmentId, threadId]);
  // useThreadFindPositionReader: a new query starts at the first message or
  // plan at or below the viewport top, so find begins where the reader is.
  const findViewport = useRef({ start: -1 });
  const findPositionReader = useRef<ThreadFindPositionReader | null>(null);
  findPositionReader.current = () => {
    const entryById = new Map(timelineEntries.map((entry) => [entry.id, entry]));
    for (const row of rows.slice(Math.max(0, findViewport.current.start))) {
      if (row.kind === "turn-fold" || row.kind === "attempt-fold") continue;
      const entry = entryById.get(row.kind === "assistant-meta" ? row.message.id : row.id);
      if (entry && (entry.kind === "message" || entry.kind === "proposed-plan")) return { entryId: entry.id, occurrence: 0 };
    }
    return undefined;
  };
  const closeFind = useStableCallback(() => {
    appAtomRegistry.set(findBarOpenAtom, false);
    setFind(null);
  });
  const activeFind = findOpen ? find : null;

  // ── Citation source (useAssistantCitationTarget) ──────────────────────────
  const citationRequest = useAtomValue(citationRequestAtom);
  const citation =
    citationRequest !== null && citationRequest.citation.environmentId === environmentId && citationRequest.citation.threadId === threadId
      ? citationRequest
      : null;
  const [citationTarget, setCitationTarget] = useState<CitationTarget | null>(null);
  const citationPages = useRef<{ key: number | null; pages: Set<string> }>({ key: null, pages: new Set() });
  const finishCitation = useStableCallback((key: number) => {
    if (appAtomRegistry.get(citationRequestAtom)?.key === key) appAtomRegistry.set(citationRequestAtom, null);
    setCitationTarget((current) => (current?.key === key ? null : current));
  });
  useEffect(() => {
    if (!citation) return;
    if (citationPages.current.key !== citation.key) citationPages.current = { key: citation.key, pages: new Set() };
    if (history.loading) return;
    const fail = (title: string, description: string) => {
      toast({ type: "warning", title, description });
      finishCitation(citation.key);
    };
    const messageId = citation.citation.messageId;
    const source = timelineEntries.find((entry) => entry.kind === "message" && entry.message.id === messageId);
    if (!source) {
      if (history.hasMoreHistory && !history.error) {
        const cursor = timelineEntries[0]?.id ?? "first";
        const pages = citationPages.current.pages;
        if (pages.has(cursor) || pages.size >= 20) {
          fail("Could not load the cited response", "Load earlier turns, then click the citation to try again. Your saved quote is unchanged.");
          return;
        }
        pages.add(cursor);
        void runAtomCommand(appAtomRegistry, threadEnvironment.loadEarlierHistory, {
          environmentId,
          input: { threadId, throughEntryId: messageId },
        });
        return;
      }
      fail("The cited response is unavailable", "It may have been removed. The selected text is still saved in your citation.");
      return;
    }
    if (source.kind !== "message" || source.message.role !== "assistant") {
      fail("The citation does not refer to an assistant response", "The selected text is still saved in your citation.");
      return;
    }
    const row = rows.find((candidate) => candidate.kind === "message" && candidate.message.id === messageId);
    if (!row) {
      const foldRunId = timelineTurnFoldRunIdsByEntryId({
        timelineEntries,
        latestRun: activityRun,
        runningRunId: runtime?.activeRunId ?? null,
        isWorking,
        runlessWorkActive: runlessWorkStartedAt !== null,
      }).get(source.id);
      if (foldRunId) setExpandedRunIds((current) => (current.has(foldRunId) ? current : new Set(current).add(foldRunId)));
      return;
    }
    setCitationTarget((current) => (current?.key === citation.key ? current : { key: citation.key, rowId: row.id, citation: citation.citation }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citation, timelineEntries, rows, history.loading, history.hasMoreHistory, history.error]);

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
            findViewport={findViewport}
            citation={citationTarget}
            citationPending={citation !== null}
            onCitationDone={finishCitation}
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
          <ThreadFindBar threadRef={threadRef} skills={skills} positionReader={findPositionReader} onChange={onFindChange} onClose={closeFind} />
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

/** The cited reply's row, once its thread has loaded and unfolded it. */
interface CitationTarget {
  readonly key: number;
  readonly rowId: string;
  readonly citation: AssistantCitation;
}

type HighlightSpec = {
  readonly query?: string;
  readonly ranges?: Array<[number, number]>;
  readonly color?: string;
  readonly activeColor?: string;
  readonly activeIndex?: number;
};
/** The active row's find washes, once its text has been located (findOccurrence.ts). */
interface FindPaint {
  readonly rowKey: string;
  /** The navigation they belong to. */
  readonly navKey: string;
  readonly queryOrdinal: number | null;
  readonly activeRange: [number, number] | null;
  readonly extraRanges: ReadonlyArray<[number, number]>;
}
/** web FIND_MATCH_VIEW_MARGIN: a revealed match keeps this much room from the viewport edges. */
const FIND_MATCH_VIEW_MARGIN = 96;

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
  findViewport,
  citation,
  citationPending,
  onCitationDone,
  history,
  onLoadEarlier,
  parentThreadLink,
  onOpenThread,
}: {
  threadRef: ScopedThreadRef;
  rows: ReadonlyArray<MessagesTimelineRow>;
  find: ThreadFindState | null;
  /** Where the viewport top is, for the find bar's position reader. */
  findViewport: { current: { start: number } };
  /** A cited passage to reveal and pulse (AssistantCitationSource). */
  citation: CitationTarget | null;
  /** A citation request is on its way: it owns the scroll, so no position restore. */
  citationPending: boolean;
  onCitationDone: (key: number) => void;
  history: { readonly hasMoreHistory: boolean; readonly loading: boolean; readonly error: string | null } | null;
  onLoadEarlier: () => void;
  parentThreadLink: { readonly threadId: ThreadId; readonly title: string } | null;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const listRef = useRef<PublicInstance | null>(null);
  const remembered = rememberedFor(scopedThreadKey(threadRef));
  // useTimelinePositionRestore: a thread reopens where the reader left it. The
  // list mounts at its end; the saved anchor is applied once it has painted.
  const pendingRestore = useRef(citationPending ? null : remembered.position);
  const composerInset = useAtomValue(composerInsetAtom);
  const cardInline = useDetailsCardInline();
  const [atEnd, setAtEnd] = useState(remembered.position === null);
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
  // web's list starts at the top. When the rows fit, the footer takes up the
  // slack so the first row sits under the header. A row not measured yet counts
  // at the list's estimated height: the list never lays out rows above its
  // viewport, so waiting for one that a stale fill pushed off the top (a working
  // row that appears above a growing worktree setup card) left the thread's
  // first rows hidden until the row count changed again.
  const [topFill, setTopFill] = useState(0);
  const refreshTopFill = () => {
    if (viewport.height <= 0) return;
    let total = 0;
    for (const key of listKeysRef.current) {
      total += rowHeights.current.get(key) ?? TIMELINE_ESTIMATED_ROW_HEIGHT;
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
    if (pendingRestore.current === null) {
      const rowKey = keys[anchor];
      const scroll = renderer.getScrollOffset?.(id) ?? null;
      remembered.position =
        nextAtEnd || rowKey === undefined || rowKey === "timeline-footer"
          ? null
          : { rowKey, offset, scroll: scroll ? [scroll[0] ?? 0, scroll[1] ?? 0] : null };
    }
    const heightAt = (index: number) =>
      keys[index] === "timeline-footer" ? footerHeight + topFill : (rowHeights.current.get(keys[index]!) ?? TIMELINE_ESTIMATED_ROW_HEIGHT);
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
    findViewport.current.start = next?.start ?? -1;
    setVisibleRange((current) => (current?.start === next?.start && current?.end === next?.end ? current : next));
  };

  // gpuix reports no visible range for the first paint, so the saved anchor is
  // applied once rows report their layout: the list exists by then.
  // web reconciles the saved row for two settled layout frames; here the
  // jump is re-applied until gpui reports the saved anchor twice in a row.
  // A wheel or press on the list hands the position back to the reader.
  const restoring = useRef<{ index: number; offset: number; stable: number; tries: number } | null>(null);
  const applyPendingRestore = () => {
    const restore = pendingRestore.current;
    const id = listRef.current?.id;
    if (restore === null || id == null) return;
    pendingRestore.current = null;
    const index = listKeysRef.current.indexOf(restore.rowKey);
    if (index < 0) {
      // A row that is gone (rewound, paged out) falls back to the saved scroll offset, like web.
      if (restore.scroll === null) {
        remembered.position = null;
        setAtEnd(true);
        return;
      }
      renderer.scrollTo?.(id, restore.scroll[0], restore.scroll[1]);
      setAtEnd(false);
      setTimeout(checkAtEnd, 50);
      return;
    }
    restoring.current = { index, offset: restore.offset, stable: 0, tries: 0 };
    renderer.scrollToItem?.(id, index, restore.offset);
    setTimeout(checkAtEnd, 50);
    for (const ms of [60, 160, 320, 640]) setTimeout(reconcileRestore, ms);
  };
  const reconcileRestore = () => {
    const target = restoring.current;
    const id = listRef.current?.id;
    if (!target || id == null) return;
    const top = renderer.getListScrollTop?.(id);
    if (!top) return;
    const [anchor = -1, offset = 0] = top;
    if (anchor === target.index && Math.abs(offset - target.offset) <= 1) {
      target.stable += 1;
      if (target.stable >= 2) restoring.current = null;
      return;
    }
    target.stable = 0;
    target.tries += 1;
    if (target.tries > 8) {
      restoring.current = null;
      return;
    }
    renderer.scrollToItem?.(id, target.index, target.offset);
  };
  const cancelRestore = () => {
    restoring.current = null;
  };

  const measureScheduled = useRef(false);
  const onRowLayout = (key: string, height: number) => {
    if (rowHeights.current.get(key) === height) return;
    rowHeights.current.set(key, height);
    if (measureScheduled.current) return;
    measureScheduled.current = true;
    queueMicrotask(() => {
      measureScheduled.current = false;
      applyPendingRestore();
      reconcileRestore();
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
  // useThreadFindNavigation reveal: the row comes in 96px below the top, then
  // the active occurrence is located in the row's rendered text
  // (findOccurrence.ts) and scrolled into view when it falls outside the
  // margins, so a match deep in a long message is shown rather than the
  // message's first lines. Folded or clipped text that holds it opens first
  // (findReveal.ts), and a code block pans sideways to it.
  const revealGeneration = useRef(0);
  const listBounds = useRef({ y: 0, height: 0 });
  const activeFindFrame = useRef<PublicInstance | null>(null);
  const [findPaint, setFindPaint] = useState<FindPaint | null>(null);
  const [findRevealTick, setFindRevealTick] = useState(0);
  useEffect(() => {
    const id = listRef.current?.id;
    const match = find?.match;
    if (findRowIndex < 0 || id == null || !match || !find) return;
    const generation = ++revealGeneration.current;
    const index = leadingRows + findRowIndex;
    const query = find.query;
    const navKey = `${find.navigationId}:${query}:${match.entryId}:${match.occurrence}`;
    const rowKey = rows[findRowIndex]?.id ?? null;
    if (revealFindFolds(match.entryId, "hidden")) {
      // The fold's body mounts on the next render; this effect runs again for it.
      setFindRevealTick((tick) => tick + 1);
      return;
    }
    renderer.scrollToItem?.(id, index, -FIND_MATCH_VIEW_MARGIN);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const locate = (attempt: number) => {
      if (generation !== revealGeneration.current) return;
      const frameId = activeFindFrame.current?.id;
      const bounds = listBounds.current;
      const tree = (renderer as { getAutomationTree?: () => string }).getAutomationTree?.();
      if (frameId == null || !tree || bounds.height <= 0) return;
      const rowText = readRowText(tree, frameId);
      const line = rowText ? locateFindMatch(rowText, query, match.occurrence) : null;
      if (!line) return;
      // A match below a collapsed message's clip opens it, then is located again.
      if (attempt === 0 && revealFindFolds(match.entryId, "clipped", line.rowTop + line.top + line.height)) {
        timers.push(setTimeout(() => locate(1), 64));
        return;
      }
      if (rowKey !== null) {
        setFindPaint({ rowKey, navKey, queryOrdinal: line.queryOrdinal, activeRange: line.activeRange, extraRanges: line.extraRanges });
      }
      if (line.pan) {
        // gpui scroll offsets are 0 at the start and negative as content scrolls.
        const [scrollX = 0, scrollY = 0] = renderer.getScrollOffset?.(line.pan.scrollerId) ?? [];
        renderer.scrollTo?.(line.pan.scrollerId, Math.min(0, scrollX - line.pan.deltaX), scrollY);
      }
      const usable = bounds.height - composerInset;
      const margin = Math.min(FIND_MATCH_VIEW_MARGIN, Math.max(0, (usable - line.height) / 2));
      // Like web, move only as far as needed: a match below lands at the bottom margin.
      const rowTop = line.rowTop - bounds.y;
      const top = rowTop + line.top;
      const delta = top < margin ? top - margin : top + line.height > usable - margin ? top + line.height - (usable - margin) : 0;
      if (Math.abs(delta) < 1) return;
      renderer.scrollToItem?.(id, index, -rowTop + delta);
    };
    timers.push(setTimeout(() => locate(0), 64));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findRowIndex, find?.navigationId, find?.match?.entryId, find?.match?.occurrence, findRevealTick]);
  // AssistantCitationSource: scroll the cited reply in, locate the quote in it,
  // bring its first line into view and pulse it. web animates the wash's
  // opacity for 3 s (two pulses, a hold, a fade); gpuix cannot animate a
  // colour, so the wash steps on, off, on and off on timers.
  const citationFrame = useRef<PublicInstance | null>(null);
  const [citationWash, setCitationWash] = useState<{ readonly rowId: string; readonly range: [number, number] } | null>(null);
  useEffect(() => {
    const id = listRef.current?.id;
    if (!citation || id == null) return;
    const index = listKeysRef.current.indexOf(citation.rowId);
    if (index < 0) return;
    renderer.scrollToItem?.(id, index, -FIND_MATCH_VIEW_MARGIN);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, run: () => void) => timers.push(setTimeout(run, ms));
    at(64, () => {
      const frameId = citationFrame.current?.id;
      const tree = (renderer as { getAutomationTree?: () => string }).getAutomationTree?.();
      const bounds = listBounds.current;
      const located = frameId != null && tree ? locateQuote(tree, frameId, citation.citation) : null;
      if (!located) {
        // web: the source reply stays in view and the saved quote is kept.
        toast({ type: "warning", title: "The quoted text has changed", description: "Showing the source response. The saved quote is unchanged." });
        onCitationDone(citation.key);
        return;
      }
      // web scrolls the passage to min(120px, a third of the viewport) below the top.
      const usable = bounds.height - composerInset;
      const rowTop = located.rowTop - bounds.y;
      const top = rowTop + located.top;
      const target = Math.min(120, usable / 3);
      if (Math.abs(top - target) >= 1) renderer.scrollToItem?.(id, index, -rowTop + (top - target));
      const wash = { rowId: citation.rowId, range: located.range };
      setCitationWash(wash);
      at(64 + 650, () => setCitationWash(null));
      at(64 + 975, () => setCitationWash(wash));
      at(64 + 3000, () => {
        setCitationWash(null);
        onCitationDone(citation.key);
      });
    });
    return () => {
      for (const timer of timers) clearTimeout(timer);
      setCitationWash(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citation?.key]);
  const highlightColors = findHighlightColors(theme);
  const findQuery = find && find.query.length > 0 ? find.query : null;

  const frame = (key: string, children: ReactNode, rowIndex = -1) => {
    const isFindRow = rowIndex >= 0 && rowIndex === findRowIndex;
    const isCitationRow = citation !== null && key === citation.rowId;
    const specs: HighlightSpec[] = [];
    if (findQuery) {
      const navKey = find?.match ? `${find.navigationId}:${find.query}:${find.match.entryId}:${find.match.occurrence}` : null;
      const paint = isFindRow && findPaint?.rowKey === key && findPaint.navKey === navKey ? findPaint : null;
      // Until the row's text is located, gpuix's own numbering stands in.
      const activeIndex = isFindRow && find?.match ? (paint ? paint.queryOrdinal : find.match.occurrence) : null;
      specs.push({ query: findQuery, ...highlightColors, ...(activeIndex !== null ? { activeIndex } : {}) });
      if (paint && paint.extraRanges.length > 0) specs.push({ ranges: [...paint.extraRanges], color: highlightColors.color });
      if (paint?.activeRange) specs.push({ ranges: [paint.activeRange], color: highlightColors.activeColor });
    }
    // ::highlight(t3-assistant-citation): the primary colour at the pulse's 45% peak.
    if (citationWash && citationWash.rowId === key) specs.push({ ranges: [citationWash.range], color: alpha(theme.primary, 0.45) });
    return (
      <div
        key={key}
        {...(isFindRow || isCitationRow
          ? {
              ref: (instance: PublicInstance | null) => {
                if (isFindRow) activeFindFrame.current = instance;
                if (isCitationRow) citationFrame.current = instance;
              },
            }
          : {})}
        onLayout={(event) => onRowLayout(key, Math.round(event.height ?? 0))}
        {...(specs.length > 0 ? { highlight: specs.length === 1 ? specs[0]! : specs } : {})}
      >
        <ChatLane cardInline={cardInline}>{children}</ChatLane>
      </div>
    );
  };

  return (
    <div
      testId="timeline-list"
      style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, position: "relative" }}
      // The list itself takes no onScroll; wheel deltas reach this wrapper.
      onScroll={() => {
        cancelRestore();
        queueMicrotask(checkAtEnd);
      }}
      onMouseDown={cancelRestore}
      onLayout={(event) => {
        const next = { width: Math.round(event.width ?? 0), height: Math.round(event.height ?? 0) };
        listBounds.current = { y: event.y ?? 0, height: event.height ?? 0 };
        setViewport((current) => (current.width === next.width && current.height === next.height ? current : next));
      }}
    >
      <virtual-list
        ref={listRef}
        alignment="bottom"
        followTail
        estimatedItemHeight={TIMELINE_ESTIMATED_ROW_HEIGHT}
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
