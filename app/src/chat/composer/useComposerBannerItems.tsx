// The composer's notice stack, assembled in web ChatView's `composerBannerItems`
// order (apps/web/src/components/ChatView.tsx ~2573-2639): feedback, usage-limit
// recovery, usage limits, project clone, system (machine), background work
// (child input, goal, background tasks), then the branch-mismatch notice.
// ComposerBannerStack sorts by urgency; this order breaks ties.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2ThreadProjection,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentCatalog, threadEnvironment } from "../../state/environment.ts";
import { feedbackBannerItem, feedbackSubmissionsAtom, removeFeedbackSubmission } from "./ComposerFeedback.tsx";
import type { ComposerBannerStackItem } from "./ComposerBannerStack.tsx";
import { usageLimitRecoveryBannerItem } from "./UsageLimitRecoveryBanner.tsx";
import { useSystemComposerBanners } from "./useSystemComposerBanners.tsx";
import { type StandaloneSendContext, useThreadLifecycleBanners } from "./useThreadLifecycleBanners.tsx";
import { useUsageLimitsPanel } from "./useUsageLimitsPanel.ts";

const NO_AUTO_UPDATE_ENVIRONMENTS: never[] = [];
const EMPTY_USAGE_LIMIT_SOURCES: UsageLimitSourceSnapshots = [];

type ThreadRuntime = {
  readonly status: string;
  readonly lastErrorClass?: string | null;
  readonly usageLimitResetAt?: string | null;
} | null;

export interface ComposerBannerItemsInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly draftKey: string;
  readonly shell: EnvironmentThreadShell | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly runtime: ThreadRuntime;
  readonly projectCwd: string | null;
  readonly isWorking: boolean;
  readonly activePendingRequestId: string | null;
  readonly composerHasDraftContent: boolean;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providerDriver: ServerProvider["driver"] | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly usageLimitSources: UsageLimitSourceSnapshots | undefined;
  readonly getSendContext: () => StandaloneSendContext;
  /** web useProjectCloneBanner's item for the active project, when one is cloning. */
  readonly projectCloneBannerItem?: ComposerBannerStackItem | null;
}

export function useComposerBannerItems(input: ComposerBannerItemsInput) {
  const { environmentId, threadId, draftKey, shell, runtime } = input;
  const routeThreadKey = threadId ? `${environmentId}:${threadId}` : draftKey;
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);

  // ── Usage limits (/usage-limits) ──────────────────────────────────────
  // A pending approval or question is part of the key: once it is answered,
  // from this client or any other, the agent resumes and spends quota.
  const usageLimitsKey =
    input.providerInstanceId === null || (threadId !== null && shell === null)
      ? null
      : [routeThreadKey, input.providerInstanceId, shell?.latestRun?.runId ?? "", input.activePendingRequestId ?? ""].join(":");
  const usageLimits = useUsageLimitsPanel({
    environmentId,
    threadKey: routeThreadKey,
    panelKey: usageLimitsKey,
    providerInstanceId: input.providerInstanceId,
    providerDriver: input.providerDriver,
    providers: input.providers,
    sources: input.usageLimitSources ?? EMPTY_USAGE_LIMIT_SOURCES,
  });

  // ── Thread lifecycle ──────────────────────────────────────────────────
  const lifecycle = useThreadLifecycleBanners({
    environmentId,
    threadId,
    draftKey,
    shell,
    projection: input.projection,
    projectCwd: input.projectCwd,
    canOperateThread: true,
    isWorking: input.isWorking,
    parentAwaitingUser: input.activePendingRequestId !== null,
    composerHasDraftContent: input.composerHasDraftContent,
    getSendContext: input.getSendContext,
    onTurnStarted: () => usageLimits.clearFor(routeThreadKey),
  });

  // ── System (machine) ──────────────────────────────────────────────────
  const systemItems = useSystemComposerBanners({
    environmentId,
    hasMultipleRegisteredEnvironments: catalog.entries.size > 1,
    // t3-term has no load-balanced drafts (see useSystemComposerBanners.tsx).
    automaticEnvironment: false,
    autoUpdateEnvironments: NO_AUTO_UPDATE_ENVIRONMENTS,
  });

  // ── Feedback (/feedback) ──────────────────────────────────────────────
  const feedbackSubmissions = useAtomValue(feedbackSubmissionsAtom(routeThreadKey));
  const feedbackItems = feedbackSubmissions.flatMap((submission) => {
    const item = feedbackBannerItem(submission, () => removeFeedbackSubmission(routeThreadKey, submission.id));
    return item ? [item] : [];
  });
  const feedbackUploading = feedbackSubmissions.some((submission) => submission.status === "uploading");

  // ── Usage-limit recovery ──────────────────────────────────────────────
  const latestRun = shell?.latestRun ?? null;
  const limitRecoveryBanner =
    runtime?.status === "failed" && runtime.lastErrorClass === "usage_limit" && shell && latestRun
      ? usageLimitRecoveryBannerItem({
          runId: latestRun.runId,
          resetAt: runtime.usageLimitResetAt ?? null,
          stoppedAt: latestRun.completedAt ?? shell.updatedAt,
          recovery: shell.limitRecovery ?? null,
          snoozedUntil: shell.snoozedUntil,
          onChange: async (limitRecovery) => {
            const result = await runAtomCommand(
              appAtomRegistry,
              threadEnvironment.updateMetadata,
              { environmentId, input: { threadId: shell.id, limitRecovery } } as never,
              { reportFailure: false },
            );
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          },
        })
      : null;

  const items: ComposerBannerStackItem[] = [
    ...feedbackItems,
    ...(limitRecoveryBanner ? [limitRecoveryBanner] : []),
    ...(usageLimits.banner ? [usageLimits.banner] : []),
    ...(input.projectCloneBannerItem ? [input.projectCloneBannerItem] : []),
    ...systemItems,
    ...[lifecycle.childInputBanner, lifecycle.goalBanner, lifecycle.backgroundWorkBanner].filter(
      (item): item is ComposerBannerStackItem => item !== null,
    ),
    ...(lifecycle.branchMismatchBanner ? [lifecycle.branchMismatchBanner] : []),
  ];

  return {
    items,
    routeThreadKey,
    feedbackUploading,
    usageLimitsOffered: usageLimits.offered && usageLimitsKey !== null,
    openUsageLimits: usageLimits.open,
    clearUsageLimits: () => usageLimits.clearFor(routeThreadKey),
  };
}
