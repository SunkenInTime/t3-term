// apps/web/src/components/chat/timelineRowContext.ts, minus the DOM-only pieces
// (LegendList ref, citations, artifact templates, app frames).
import type {
  EnvironmentId,
  MessageId,
  RunAttemptId,
  RunId,
  ScopedThreadRef,
  ThreadId,
  WorktreeSetupSnapshot,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { HandoffTimelineRun } from "@t3tools/client-runtime/handoff";
import { createContext } from "react";

import type { MessagesTimelineRow } from "../../web/components/chat/MessagesTimeline.logic.ts";

export type TimelineRow = MessagesTimelineRow;
export type TimelineWorkEntry = Extract<TimelineRow, { kind: "work" }>["groupedEntries"][number];

export interface WorkGroupViewState {
  /** Work entries the reader opened, kept across row remounts in the virtual list. */
  expandedEntries: Set<string>;
}

export interface TimelineRowSharedState {
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  threadRef: ScopedThreadRef;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  runs: ReadonlyArray<HandoffTimelineRun>;
  activeThreadEnvironmentId: EnvironmentId;
  onRevertToTurnCount: (targetTurnCount: number, messageId: MessageId) => void;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  onOpenThread: (threadId: ThreadId) => void;
  onForkFromRun: (input: { readonly sourceThreadId: ThreadId; readonly runId: RunId }) => Promise<void>;
  onRollbackCheckpoint: (input: { readonly checkpointId: string; readonly scopeId: string }) => void;
  onToggleTurnFold: (runId: RunId) => void;
  onToggleAttemptFold: (attemptId: RunAttemptId) => void;
  onToggleWorkGroup: (groupId: string) => void;
  onCancelWorktreeSetup: (() => void) | null;
  retryableWorkspacePreparationRunIds: ReadonlySet<RunId>;
  onRetryWorkspacePreparation: ((runId: RunId) => void) | null;
  onOpenWorktreeSetupTerminal: ((terminalId: string) => void) | null;
  workGroupViewState: WorkGroupViewState;
  /** Changed-files cards with every folder open, by run (web keeps this in uiStateStore). */
  changedFilesExpandedRunIds: ReadonlySet<RunId>;
  onToggleChangedFilesExpanded: (runId: RunId) => void;
}

export interface TimelineRowActivityState {
  isWorking: boolean;
  isCompacting: boolean;
  isRevertingCheckpoint: boolean;
  activeTurnInProgress: boolean;
  awaitingUser: boolean;
  isPreparingWorktree: boolean;
  latestRunId: RunId | null;
  backgroundWorktreeSetup: WorktreeSetupSnapshot | null;
}

export const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);
export const TimelineRowActivityCtx = createContext<TimelineRowActivityState>(null!);
