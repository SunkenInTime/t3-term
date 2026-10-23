// Subset of apps/web/src/components/ChatView.logic.ts that the timeline needs.
// The full module pulls in composer draft state, which belongs to the composer area.
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import { worktreeSetupAgentStarted } from "@t3tools/client-runtime/worktree-setup";
import type {
  OrchestrationV2ProviderTurn,
  RunAttemptId,
  ThreadId,
  WorktreeSetupSnapshot,
} from "@t3tools/contracts";

export function deriveAvailableRevertTurnCounts(projection: ThreadStructure | null) {
  const available = new Set<number>();
  const providerThread = projection?.providerThreads.find(
    (candidate) => candidate.id === projection.thread.activeProviderThreadId,
  );
  if (
    !providerThread?.providerSessionId ||
    providerThread.providerInstanceId !== projection?.thread.modelSelection.instanceId
  )
    return available;
  available.add(0);
  const attemptsById = new Map(projection.attempts.map((attempt) => [attempt.id, attempt]));
  const providerTurnsById = new Map<
    OrchestrationV2ProviderTurn["id"],
    OrchestrationV2ProviderTurn
  >();
  const latestTurnByAttempt = new Map<RunAttemptId, OrchestrationV2ProviderTurn>();
  for (const turn of projection.providerTurns) {
    providerTurnsById.set(turn.id, turn);
    if (turn.runAttemptId === null) continue;
    const latest = latestTurnByAttempt.get(turn.runAttemptId);
    if (latest === undefined || turn.ordinal > latest.ordinal) {
      latestTurnByAttempt.set(turn.runAttemptId, turn);
    }
  }
  for (const run of projection.runs) {
    if (run.activeAttemptId === null) continue;
    const attempt = attemptsById.get(run.activeAttemptId);
    const providerTurn =
      latestTurnByAttempt.get(run.activeAttemptId) ??
      (attempt?.providerTurnId == null ? undefined : providerTurnsById.get(attempt.providerTurnId));
    // A ready file checkpoint alone cannot restore the provider conversation.
    if (providerTurn?.providerThreadId === providerThread.id) available.add(run.ordinal);
  }
  return available;
}

export function resolveWorktreeSetupProgress(input: {
  threadId: ThreadId;
  localPreparing: boolean;
  runStatus: string | undefined;
  latest: WorktreeSetupSnapshot | null | undefined;
  held: WorktreeSetupSnapshot | null;
}) {
  const latest = input.latest?.threadId === input.threadId ? input.latest : null;
  const held = input.held?.threadId === input.threadId ? input.held : null;
  const snapshot = latest && (!held || latest.sequence >= held.sequence) ? latest : held;
  return {
    snapshot,
    isPreparingWorktree:
      input.localPreparing ||
      input.runStatus === "preparing" ||
      (snapshot?.phase === "running" && !worktreeSetupAgentStarted(snapshot)),
  };
}
