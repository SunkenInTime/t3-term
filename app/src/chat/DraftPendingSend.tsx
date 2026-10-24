// A new-thread draft's first send, while the server creates the thread (web promotes the
// draft at once: ChatView switches to the thread layout with the optimistic message and the
// working row, the composer docked at the bottom). The thread's own timeline cannot be shown
// yet: subscribing to a thread the server does not have marks it deleted for good
// (client-runtime threads.ts "missing"), so this lays the same rows out without it.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { clientSettingAtom } from "../state/clientSettings.ts";
import type { DraftPendingSend } from "../state/composer.ts";
import { useTheme } from "../ui/theme.ts";
import { deriveMessagesTimelineRows } from "../web/components/chat/MessagesTimeline.logic.ts";
import { deriveTimelineEntriesFromVisibleTurnItems } from "../web/session-logic.ts";
import { ChatLane, useDetailsCardInline } from "./chatLane.tsx";
import {
  TimelineRowActivityCtx,
  type TimelineRowActivityState,
  TimelineRowCtx,
  type TimelineRowSharedState,
} from "./timeline/rowContext.ts";
import { TimelineRowContent } from "./timeline/TimelineRows.tsx";

const NO_SKILLS: TimelineRowSharedState["skills"] = [];
const NO_RUNS: TimelineRowSharedState["runs"] = [];
const NO_RUN_IDS: TimelineRowSharedState["retryableWorkspacePreparationRunIds"] = new Set();
const noop = () => {};

export function DraftPendingSendTimeline({
  environmentId,
  pending,
}: {
  environmentId: EnvironmentId;
  pending: DraftPendingSend;
}) {
  const theme = useTheme();
  const cardInline = useDetailsCardInline();
  const timestampFormat = useAtomValue(clientSettingAtom("timestampFormat"));
  const rows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries: deriveTimelineEntriesFromVisibleTurnItems({ visibleTurnItems: [], optimisticMessages: [pending.message] }),
        isWorking: true,
        activeTurnStartedAt: pending.message.createdAt,
        turnDiffSummaries: [],
        supportsConversationRollback: false,
      }),
    [pending.message],
  );
  const threadRef = useMemo(() => scopeThreadRef(environmentId, pending.threadId), [environmentId, pending.threadId]);
  const shared = useMemo<TimelineRowSharedState>(
    () => ({
      timestampFormat,
      routeThreadKey: scopedThreadKey(threadRef),
      threadRef,
      markdownCwd: undefined,
      skills: NO_SKILLS,
      workflowOpening: null,
      workspaceRoot: undefined,
      runs: NO_RUNS,
      activeThreadEnvironmentId: environmentId,
      onRevertToTurnCount: noop,
      onOpenTurnDiff: noop,
      onOpenThread: noop,
      onForkFromRun: async () => {},
      onRollbackCheckpoint: noop,
      onToggleTurnFold: noop,
      onToggleAttemptFold: noop,
      onToggleWorkGroup: noop,
      onCancelWorktreeSetup: null,
      retryableWorkspacePreparationRunIds: NO_RUN_IDS,
      onRetryWorkspacePreparation: null,
      onOpenWorktreeSetupTerminal: null,
      workGroupViewState: { expandedEntries: new Set() },
      changedFilesExpandedRunIds: NO_RUN_IDS,
      onToggleChangedFilesExpanded: noop,
    }),
    [timestampFormat, threadRef, environmentId],
  );
  const activity = useMemo<TimelineRowActivityState>(
    () => ({
      isWorking: true,
      isCompacting: false,
      isRevertingCheckpoint: false,
      activeTurnInProgress: true,
      awaitingUser: false,
      isPreparingWorktree: false,
      latestRunId: null,
      backgroundWorktreeSetup: null,
    }),
    [],
  );
  return (
    <div
      testId="draft-pending-send"
      style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, backgroundColor: theme.background }}
    >
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={activity}>
          {/* web: the titlebar scroll-fade height, then the rows from the top. */}
          <div style={{ height: 24, flexShrink: 0 }} />
          {rows.map((row) => (
            <div key={row.id} style={{ flexShrink: 0 }}>
              <ChatLane cardInline={cardInline}>
                <TimelineRowContent row={row} />
              </ChatLane>
            </div>
          ))}
        </TimelineRowActivityCtx>
      </TimelineRowCtx>
    </div>
  );
}
