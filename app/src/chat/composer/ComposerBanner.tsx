// OWNER: composer agent (banners sub-task). STUB: replace with the port of
// apps/web/src/components/chat/ComposerBanner.tsx + ComposerBannerStack.tsx,
// ComposerPendingApprovalPanel.tsx + ComposerPendingApprovalActions.tsx,
// ComposerPendingUserInputPanel.tsx and ComposerPlanFollowUpBanner.tsx.
// Composer.tsx renders <ComposerTopBanners/> directly above the composer surface.
import type { ReactNode } from "react";

import type { PendingThreadRequestsState } from "./usePendingThreadRequests.ts";

export interface ComposerTopBannersProps {
  readonly requests: PendingThreadRequestsState;
  /** False when this connection cannot operate the thread. */
  readonly canOperateThread: boolean;
  /** Title of the latest actionable proposed plan when the plan follow-up prompt shows. */
  readonly planFollowUpTitle: string | null;
  /** Extra stacked banner content (queued runs control, activity) rendered above the drawer. */
  readonly attachedAbove?: ReactNode;
}

export function ComposerTopBanners(_props: ComposerTopBannersProps) {
  return null;
}
