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
}

const NO_BANNER_ITEMS: ReadonlyArray<ComposerBannerStackEntry> = [];

export function ComposerTopBanners({
  requests,
  canOperateThread,
  planFollowUpTitle,
  showPlanFollowUp = planFollowUpTitle !== null,
  attachedAbove,
  bannerItems = NO_BANNER_ITEMS,
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
  const hasFrontNotice = bannerItems.length > 0;
  const drawerJoinedAbove = externalAttachments > 0 || hasFrontNotice;

  const userInputRespondingIds =
    activePendingIsResponding && activePendingUserInput
      ? [...respondingRequestIds, activePendingUserInput.requestId]
      : respondingRequestIds;

  return (
    <BannerChainContext.Provider value={chain}>
      <div
        testId="composer-banner-dock"
        style={{
          display: "flex",
          flexDirection: "column",
          marginLeft: COMPOSER_DRAWER_INSET,
          marginRight: COMPOSER_DRAWER_INSET,
          minWidth: 0,
        }}
      >
        <ComposerBannerStack
          items={bannerItems}
          attachedAbove={attachedAbove}
          frontJoinedAbove={externalAttachments > 0}
        />
        {showTopDrawer ? (
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
