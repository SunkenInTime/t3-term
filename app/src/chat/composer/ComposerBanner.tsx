// The banner dock above the composer surface, after the ComposerBanner.Dock block in
// apps/web/src/components/chat/ChatComposer.tsx (~3500-3610): the notice stack, the
// surfaces passed in above it (queued runs), and the top drawer, which shows the
// pending approval, else the pending question, else the plan follow-up.
//
// Pieces: ComposerBannerParts.tsx (ComposerBanner.tsx primitives), ComposerBannerStack.tsx,
// ComposerPendingApprovalPanel.tsx, ComposerPendingUserInputPanel.tsx. ComposerPlanFollowUpBanner
// is inline below.
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";

import { alpha, useTheme } from "../../ui/theme.ts";
import {
  BannerActions,
  BannerAttachment,
  BannerChainContext,
  BannerContent,
  BannerIcon,
  BannerRoot,
  BannerRow,
  BannerText,
  COMPOSER_DRAWER_INSET,
} from "./ComposerBannerParts.tsx";
import { ComposerBannerStack, type ComposerBannerStackEntry } from "./ComposerBannerStack.tsx";
import { ComposerPendingApprovalActions, ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel.tsx";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel.tsx";
import type { PendingThreadRequestsState } from "./usePendingThreadRequests.ts";
import {
  ComposerActivityRow,
  ComposerTasksBadge,
  ComposerTasksContent,
  ComposerTasksDrawer,
  type ComposerTaskStep,
  type ComposerTasksProgress,
  type ThreadSyncPhase,
} from "./ComposerTasksBadge.tsx";

export type { ComposerBannerStackEntry } from "./ComposerBannerStack.tsx";

export interface ComposerTopBannersProps {
  readonly requests: PendingThreadRequestsState;
  /** False when this connection cannot operate the thread. */
  readonly canOperateThread: boolean;
  /** Title of the latest actionable proposed plan when the plan follow-up prompt shows. */
  readonly planFollowUpTitle: string | null;
  /**
   * Whether the plan follow-up banner shows. Defaults to `planFollowUpTitle !== null`;
   * pass true to show "Plan ready" for an untitled plan.
   */
  readonly showPlanFollowUp?: boolean;
  /** Extra stacked banner content (queued runs control, activity) rendered above the drawer. */
  readonly attachedAbove?: ReactNode;
  /** ChatView's notices (errors, provider status); the most urgent one docks, the rest stack. */
  readonly bannerItems?: ReadonlyArray<ComposerBannerStackEntry>;
  /** web ComposerBanner.Dock's shoulder tab after the column (the stash badge), bottom-aligned on the right. */
  readonly trailing?: ReactNode;
  /** The agent's todo list (web activeTasksProgress / activeTaskSteps). */
  readonly tasks?: { readonly progress: ComposerTasksProgress; readonly steps: readonly ComposerTaskStep[] } | null;
  /** "Loading/Syncing messages..." after web's useDelayedStatus. */
  readonly syncPhase?: ThreadSyncPhase | null;
  /** The composer surface width, for the tasks segment bar (`@min-[560px]`). */
  readonly surfaceWidth?: number | null;
}

const NO_BANNER_ITEMS: ReadonlyArray<ComposerBannerStackEntry> = [];

export function ComposerTopBanners({
  requests,
  canOperateThread,
  planFollowUpTitle,
  showPlanFollowUp = planFollowUpTitle !== null,
  attachedAbove,
  bannerItems = NO_BANNER_ITEMS,
  trailing,
  tasks = null,
  syncPhase = null,
  surfaceWidth = null,
}: ComposerTopBannersProps) {
  const {
    activePendingApproval,
    pendingApprovals,
    pendingUserInputs,
    activePendingUserInput,
    activePendingIsResponding,
    respondingRequestIds,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
  } = requests;

  // Count of surfaces passed in through `attachedAbove` that actually rendered.
  const [externalAttachments, setExternalAttachments] = useState(0);
  const registerAttachment = useCallback(() => {
    setExternalAttachments((count) => count + 1);
    return () => setExternalAttachments((count) => count - 1);
  }, []);
  const chain = useMemo(() => ({ registerAttachment }), [registerAttachment]);

  const showTopDrawer = activePendingApproval !== null || pendingUserInputs.length > 0 || showPlanFollowUp;

  // ── Tasks and sync activity (web ChatComposer ~2322-2625) ─────────────
  const [isTasksDrawerOpen, setIsTasksDrawerOpen] = useState(false);
  const toggleTasksDrawer = () => setIsTasksDrawerOpen((open) => !open);
  const hasBannerItems = bannerItems.length > 0;
  const hasBlockingTopDrawer = activePendingApproval !== null || pendingUserInputs.length > 0;
  const showInlineTasksBadge =
    tasks !== null && !isTasksDrawerOpen && !hasBlockingTopDrawer && (hasBannerItems || showTopDrawer);
  const inlineTasksBadge =
    showInlineTasksBadge && tasks ? (
      <ComposerTasksBadge
        expanded={false}
        onToggle={toggleTasksDrawer}
        placement="inline"
        progress={tasks.progress}
        steps={tasks.steps}
        surfaceWidth={surfaceWidth}
      />
    ) : null;
  const showTasksTab =
    !hasBannerItems && !showTopDrawer && !isTasksDrawerOpen && tasks !== null && tasks.progress.totalSteps > 0;
  // With notices on screen, the activity joins the stack instead of docking on its own.
  const activityStackContent = hasBannerItems ? (
    syncPhase ? (
      <ComposerActivityRow phase={syncPhase} />
    ) : !hasBlockingTopDrawer && tasks ? (
      <ComposerTasksContent
        expanded={isTasksDrawerOpen}
        onToggle={toggleTasksDrawer}
        progress={tasks.progress}
        steps={tasks.steps}
        surfaceWidth={surfaceWidth}
      />
    ) : null
  ) : null;
  const stackItems: ReadonlyArray<ComposerBannerStackEntry> = activityStackContent
    ? [...bannerItems, { id: "composer-activity", variant: "default", priority: "activity", content: activityStackContent }]
    : bannerItems;
  const showActivityStrip = activityStackContent === null && (syncPhase !== null || inlineTasksBadge !== null);
  const hasFrontNotice = stackItems.length > 0;
  const stripJoinedAbove = externalAttachments > 0 || hasFrontNotice;
  const drawerJoinedAbove = stripJoinedAbove || showActivityStrip;
  const showTasksDrawer = activityStackContent === null && isTasksDrawerOpen && !hasBlockingTopDrawer && tasks !== null;

  const userInputRespondingIds =
    activePendingIsResponding && activePendingUserInput
      ? [...respondingRequestIds, activePendingUserInput.requestId]
      : respondingRequestIds;

  return (
    <BannerChainContext.Provider value={chain}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 4,
          marginLeft: COMPOSER_DRAWER_INSET,
          marginRight: COMPOSER_DRAWER_INSET,
          minWidth: 0,
        }}
      >
      <div
        testId="composer-banner-dock"
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
        }}
      >
        <ComposerBannerStack
          items={stackItems}
          attachedAbove={attachedAbove}
          frontJoinedAbove={externalAttachments > 0}
        />
        {showActivityStrip ? (
          <BannerAttachment testId="composer-activity-strip">
            <BannerRoot joinedAbove={stripJoinedAbove}>
              {syncPhase ? <ComposerActivityRow phase={syncPhase} /> : inlineTasksBadge}
            </BannerRoot>
          </BannerAttachment>
        ) : null}
        {showTopDrawer && (!isTasksDrawerOpen || hasBlockingTopDrawer) ? (
          <BannerAttachment testId="composer-top-drawer">
            {activePendingApproval ? (
              <BannerRoot
                variant="warning"
                density="spacious"
                joinedAbove={drawerJoinedAbove}
                testId="approval-banner"
              >
                <BannerRow layout="approval">
                  <BannerIcon name="shield" approval />
                  <BannerContent>
                    <ComposerPendingApprovalPanel
                      approval={activePendingApproval}
                      pendingCount={pendingApprovals.length}
                    />
                  </BannerContent>
                  <BannerActions approval>
                    <ComposerPendingApprovalActions
                      requestId={activePendingApproval.requestId}
                      disabled={!canOperateThread}
                      isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                      options={activePendingApproval.options}
                      canRespond={activePendingApproval.responseCapability === "live"}
                      onRespondToApproval={requests.onRespondToApproval}
                    />
                  </BannerActions>
                </BannerRow>
              </BannerRoot>
            ) : pendingUserInputs.length > 0 ? (
              <BannerRoot variant="info" joinedAbove={drawerJoinedAbove} testId="user-input-banner">
                <ComposerPendingUserInputPanel
                  pendingUserInputs={pendingUserInputs}
                  disabled={!canOperateThread}
                  respondingRequestIds={userInputRespondingIds}
                  answers={activePendingDraftAnswers}
                  questionIndex={activePendingQuestionIndex}
                  onToggleOption={requests.onSelectActivePendingUserInputOption}
                  onAdvance={requests.onAdvanceActivePendingUserInput}
                  onDismiss={requests.onDismissUserInput}
                />
              </BannerRoot>
            ) : (
              <BannerRoot variant="info" joinedAbove={drawerJoinedAbove} testId="plan-follow-up-banner">
                <ComposerPlanFollowUpBanner planTitle={planFollowUpTitle} />
              </BannerRoot>
            )}
          </BannerAttachment>
        ) : null}
        {showTasksDrawer && tasks ? (
          <ComposerTasksDrawer
            onCollapse={toggleTasksDrawer}
            joinedAbove={drawerJoinedAbove}
            progress={tasks.progress}
            steps={tasks.steps}
            surfaceWidth={surfaceWidth}
          />
        ) : null}
        {showTasksTab && tasks ? (
          <BannerAttachment>
            <ComposerTasksBadge
              expanded={false}
              onToggle={toggleTasksDrawer}
              progress={tasks.progress}
              steps={tasks.steps}
              surfaceWidth={surfaceWidth}
            />
          </BannerAttachment>
        ) : null}
      </div>
      {trailing}
      </div>
    </BannerChainContext.Provider>
  );
}

/** apps/web/src/components/chat/ComposerPlanFollowUpBanner.tsx */
const ComposerPlanFollowUpBanner = memo(function ComposerPlanFollowUpBanner({
  planTitle,
}: {
  planTitle: string | null;
}) {
  const theme = useTheme();
  return (
    <BannerRow>
      <BannerIcon />
      <BannerContent>
        <BannerText weight={500} color={theme.mutedForeground}>
          Plan ready
        </BannerText>
        {planTitle ? (
          <BannerText truncate grow color={alpha(theme.foreground, 0.85)}>
            {planTitle}
          </BannerText>
        ) : null}
      </BannerContent>
    </BannerRow>
  );
});
