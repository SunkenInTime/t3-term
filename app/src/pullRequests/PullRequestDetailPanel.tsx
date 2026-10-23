// Port of apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx as the pull requests page
// shows it: inside RightPanelTabs (apps/web/src/components/RightPanelTabs.tsx) with one tab per
// opened pull request, and as a thread's right-panel surface (`context: "thread"`). Header pieces
// come from PullRequestDetailCrumbs, PullRequestDetailLayout, PullRequestBaseBranch,
// PullRequestTitleEditor and PullRequestDetailActions; the data merge from usePullRequestDetail.ts.
//
// Every write (merge, close, ready, branch updates, edits, comments, reviews) goes through
// `runPullRequestWrite` (pullRequestWrites.ts), which a dry run stops before the server.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { sourceControlClients, UNKNOWN_SOURCE_CONTROL_CLIENT } from "@t3tools/client-runtime/source-control-clients";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  ThreadId,
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type PullRequestAction,
  type PullRequestDetail,
  type PullRequestListEntry,
  type PullRequestMergeMethod,
  type PullRequestRef,
  type PullRequestReviewGuideStop,
  type PullRequestUpdateMethod,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { changeRequestRepositoryUrl, parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useWindowSize } from "@gpuix/react";
import type * as Cause from "effect/Cause";
import { useEffect, useState, type ReactNode } from "react";

import { copyTextToClipboard } from "../chat/header/osActions.ts";
import { requestConfirmDialog } from "../dialogs/confirmDialog.ts";
import { registerShortcutHandler } from "../keybindings/useGlobalKeybindings.ts";
import { startNewThread } from "../palette/actions.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { composerTargetKey, setDraftWorkspace } from "../state/composer.ts";
import { environmentProjects } from "../state/environment.ts";
import { gitEnvironment, vcsEnvironment } from "../state/git.ts";
import { activeKeybindingsAtom } from "../state/keybindings.ts";
import {
  guideRunKey,
  guideRunStateAtom,
  guideRunStore,
  lastPullRequestMergeMethodAtom,
  pullRequestEnvironment,
  pullRequestEnvironmentConnectedAtom,
  pullRequestEnvironmentsAtom,
  pullRequestPanel,
  useEnvironmentQuery,
  usePullRequestStack,
  usePullRequestTurnRefresh,
  type PullRequestDetailTab,
  type PullRequestSurface,
} from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { toast, updateToast } from "../ui/toast.tsx";
import { FONTS, LAYOUT, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { openExternalUrl } from "../usage/openExternal.ts";
import { shortcutLabelForCommand } from "../web/keybindings.ts";
import { useEnvironmentScope } from "../web/state/session.ts";
import type { ReviewCommentContext } from "../web/components/pullRequest/pullRequestDetail.deps.ts";
import {
  PULL_REQUEST_MERGE_METHOD_LABELS,
  allowsSinglePullRequestMerge,
  buildAddSelectionToAgentHandoff,
  buildAskAboutGuideStopHandoff,
  buildAskAboutPullRequestHandoff,
  buildExplainPullRequestHandoff,
  buildFixFindingHandoff,
  buildFixFindingsHandoff,
  buildResolveConflictsPrompt,
  canDeletePullRequestBranch,
  checkoutFailureDescription,
  isPullRequestNotFound,
  isStackedPullRequestBase,
  latestPullRequestReviewOutcomes,
  loadingPullRequestCheckoutCommand,
  pullRequestActionNeedsHostRefresh,
  pullRequestCheckoutCommand,
  pullRequestFindingKey,
  pullRequestHandoffLabels,
  readableFailure,
  resolveBaseFreshness,
  resolveDisplayedPullRequestDetail,
  resolvePullRequestDetailChecks,
  resolvePullRequestMergeMethod,
  resolvePullRequestPrimaryControl,
  resolvePullRequestReferenceHost,
  shouldRefreshPullRequestActivity,
  type PullRequestFinding,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { resolvePickableEnvironments } from "../web/components/pullRequest/pullRequestProjectAssignment.logic.ts";
import { PrButton } from "./prControls.tsx";
import { PullRequestComposer } from "./PullRequestComposer.tsx";
import {
  PullRequestActionsMenu,
  PullRequestApproveWorkflowsButton,
  PullRequestCheckoutMenu,
  PullRequestPrimaryAction,
  PullRequestResolveConflictsButton,
} from "./PullRequestDetailActions.tsx";
import { PullRequestGuideTab } from "./guide/PullRequestGuideTab.tsx";
import { useReviewGuideWriter } from "./guide/useReviewGuideWriter.ts";
import {
  PullRequestBaseBranch,
  PullRequestChangeBreakdownStat,
  PullRequestCopyableCode,
  PullRequestTitleEditor,
} from "./PullRequestHeaderPieces.tsx";
import { startPullRequestAsk, writeTaskToComposer, type PullRequestThreadTask } from "./pullRequestHandoffs.ts";
import { PullRequestChecksPopover } from "./PullRequestList.tsx";
import { GhostBar, PullRequestsUnavailableState } from "./PullRequestListStates.tsx";
import {
  PullRequestActorAvatar,
  PullRequestDiffStat,
  PullRequestLabelChip,
  formatRelativeTimeLabel,
  pullRequestChecksState,
  pullRequestChecksStatePresentation,
  resolvePullRequestState,
  summarizePullRequestChecks,
} from "./pullRequestPresentation.tsx";
import { PullRequestStackMenu } from "./PullRequestStack.tsx";
import { PullRequestThreadLinks } from "./PullRequestThreadLinks.tsx";
import { PullRequestSummaryTab } from "./PullRequestSummaryTab.tsx";
import { PullRequestTimelineTab } from "./PullRequestTimelineTab.tsx";
import { PullRequestCodeTab } from "./PullRequestCodeTab.tsx";
import { guardPullRequestWrite, PullRequestDryRunError, runPullRequestWrite } from "./pullRequestWrites.ts";

const TABS: ReadonlyArray<{ value: PullRequestDetailTab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "guide", label: "Guide" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
];

export function pullRequestRefKey(reference: PullRequestRef) {
  return `${reference.projectId}:${reference.host ?? ""}:${reference.repository}#${reference.number}`;
}

export type PullRequestDetailView = NonNullable<ReturnType<typeof usePullRequestDetail>["detail"]>;

// ── Panel shell + tab strip ─────────────────────────────────────────────

export function PullRequestDetailPanel({
  surfaces,
  activeSurface,
  environmentId,
  maximized,
  onToggleMaximized,
  onTogglePanel,
  onActivateSurface,
  onCloseSurface,
  listEntry,
  refreshToken,
  onSelectPullRequest,
}: {
  surfaces: ReadonlyArray<PullRequestSurface>;
  activeSurface: PullRequestSurface;
  environmentId: EnvironmentId;
  maximized: boolean;
  onToggleMaximized: () => void;
  onTogglePanel: () => void;
  onActivateSurface: (surface: PullRequestSurface) => void;
  onCloseSurface: (surface: PullRequestSurface) => void;
  listEntry: PullRequestListEntry | null;
  refreshToken: number;
  onSelectPullRequest: (reference: PullRequestRef) => void;
}) {
  const theme = useTheme();
  const window = useWindowSize();
  const width = Math.floor(window.width / 2);
  return (
    <div
      testId="pr-detail-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        backgroundColor: theme.background,
        borderLeftWidth: 1,
        borderColor: theme.border,
        ...(maximized ? { flexGrow: 1, minWidth: 0 } : { width, flexShrink: 0 }),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: LAYOUT.topbar,
          flexShrink: 0,
          paddingLeft: 8,
          paddingRight: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
          {surfaces.map((surface) => (
            <PanelTab
              key={surface.id}
              surface={surface}
              environmentId={(surface.environmentId as EnvironmentId | undefined) ?? environmentId}
              active={surface.id === activeSurface.id}
              seed={surface.id === activeSurface.id ? listEntry : null}
              onActivate={() => onActivateSurface(surface)}
              onClose={() => onCloseSurface(surface)}
            />
          ))}
          {/* Web's add-surface menu offers nothing on this page: every surface is unavailable. */}
          <Tooltip content="Add panel surface">
            <div style={{ display: "flex" }}>
              <IconButton icon="plus" size={24} iconSize={14} testId="pr-panel-add" />
            </div>
          </Tooltip>
        </div>
        <Tooltip content={maximized ? "Restore panel size" : "Maximize panel"}>
          <div style={{ display: "flex" }}>
            <IconButton
              icon={maximized ? "minimize-2" : "maximize-2"}
              onClick={onToggleMaximized}
              testId="pr-panel-maximize"
            />
          </div>
        </Tooltip>
        <Tooltip content="Close right panel">
          <div style={{ display: "flex" }}>
            <IconButton icon="panel-right" pressed onClick={onTogglePanel} testId="pr-panel-toggle" />
          </div>
        </Tooltip>
      </div>
      <PullRequestDetailView
        key={activeSurface.id}
        environmentId={environmentId}
        surface={activeSurface}
        listEntry={listEntry}
        refreshToken={refreshToken}
        onSelectPullRequest={onSelectPullRequest}
      />
    </div>
  );
}

function PanelTab({
  surface,
  environmentId,
  active,
  seed,
  onActivate,
  onClose,
}: {
  surface: PullRequestSurface;
  environmentId: EnvironmentId;
  active: boolean;
  seed: PullRequestListEntry | null;
  onActivate: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  // Web seeds the tab glyph from the list row and then the cached detail.
  const detail = useEnvironmentQuery(
    pullRequestEnvironment.detail({
      environmentId,
      input: {
        projectId: surface.projectId as PullRequestRef["projectId"],
        repository: surface.repository,
        number: surface.number,
        ...(surface.host ? { host: surface.host } : {}),
      },
    }),
  ).data;
  const status = detail ?? seed;
  const presentation = status ? resolvePullRequestState({ state: status.state, isDraft: status.isDraft }) : null;
  return (
    <div
      testId={`pr-panel-tab-${surface.number}`}
      onClick={onActivate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        height: 24,
        maxWidth: 144,
        flexShrink: 0,
        paddingLeft: 6,
        paddingRight: 8,
        borderRadius: RADIUS.md,
        cursor: "pointer",
        backgroundColor: active ? theme.accent : hovered ? alpha(theme.accent, 0.6) : "#00000000",
      }}
    >
      <div
        onClick={hovered ? onClose : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: 4,
          flexShrink: 0,
          ...(hovered ? { hover: { backgroundColor: theme.muted } } : {}),
        }}
      >
        {hovered ? (
          <Icon name="x" size={12} color={theme.foreground} />
        ) : (
          <Icon
            name={presentation?.icon ?? "git-pull-request-arrow"}
            size={12}
            color={presentation ? presentation.tone(theme) : theme.mutedForeground}
          />
        )}
      </div>
      <Text size="xs" color={active || hovered ? theme.foreground : theme.mutedForeground} truncate>
        {`#${surface.number}`}
      </Text>
    </div>
  );
}

// ── Data (apps/web/src/components/pullRequest/usePullRequestDetail.ts) ─

function usePullRequestDetail(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
  listEntry: PullRequestListEntry | null,
  supportsChecks: boolean,
) {
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({ environmentId, input: { ...reference, allowStale: false } }),
  );
  const activityQuery = useEnvironmentQuery(
    pullRequestEnvironment.activity({ environmentId, input: reference }),
  );
  const checksQuery = useEnvironmentQuery(
    supportsChecks && detailQuery.data !== null
      ? pullRequestEnvironment.checks({ environmentId, input: reference })
      : null,
  );
  // Without the timestamps web compares, a checks answer is taken as the newer one: it is only
  // read after the detail arrives.
  const liveDetail = resolvePullRequestDetailChecks(detailQuery.data, checksQuery.data, true);
  const [cachedDetail, setCachedDetail] = useState<PullRequestDetail | null>(null);
  if (detailQuery.data !== null && detailQuery.data !== cachedDetail) setCachedDetail(detailQuery.data);
  const activity = activityQuery.data;
  const coreDetail = resolveDisplayedPullRequestDetail({ live: liveDetail, cached: cachedDetail, reference });
  const sharedSummary =
    coreDetail ??
    (listEntry === null
      ? null
      : {
          ...listEntry,
          changedFiles: undefined as number | undefined,
        });
  const detail =
    coreDetail === null
      ? null
      : {
          ...coreDetail,
          author: activity?.author ?? coreDetail.author,
          reviewers: activity?.reviewers ?? coreDetail.reviewers,
          comments: activity?.comments ?? [],
          commentCount: Math.max(
            activity?.commentCount ?? 0,
            new Set([
              ...(activity?.comments.map((comment) => comment.id) ?? []),
              ...(activity?.reviewThreads.flatMap((thread) => thread.comments.map((comment) => comment.id)) ?? []),
            ]).size,
          ),
          commentsTruncated: activity?.commentsTruncated ?? false,
          reviewThreads: activity?.reviewThreads ?? [],
          commits: activity?.commits ?? [],
          reactions: activity?.reactions ?? [],
        };
  return { detailQuery, activityQuery, activity, sharedSummary, coreDetail, detail };
}

// ── Detail view ─────────────────────────────────────────────────────────

const ACTION_FAILURE_LABELS: Record<PullRequestAction, string> = {
  merge: "Could not merge this pull request",
  ready: "Could not mark this ready for review",
  draft: "Could not convert this to a draft",
  close: "Could not close this pull request",
  reopen: "Could not reopen this pull request",
  "update-branch": "Could not update this branch",
  "enable-auto-merge": "Could not turn on auto-merge",
  "disable-auto-merge": "Could not turn off auto-merge",
  revert: "Could not open a revert pull request",
  "delete-branch": "Could not delete this branch",
  "approve-workflows": "Could not approve workflows",
};

const ACTION_FAILURE_HINTS: Record<PullRequestAction, string> = {
  merge:
    "The host refused the merge. Check that you have write access, that the checks it requires have passed, and that the branch is not conflicting.",
  ready: "The host refused it. Check that you have write access to this repository.",
  draft: "The host refused it. Check that you have write access to this repository.",
  close: "The host refused it. Check that you have write access, or that you opened it.",
  reopen: "The host refused it. Check that you have write access, and that the branch still exists.",
  "update-branch":
    "The host refused it. Check that you have write access to the branch (a fork branch also needs its author to allow edits from maintainers), and that it does not conflict with the base.",
  "enable-auto-merge":
    "The host refused it. Check that this repository allows auto-merge, that you have write access, and that there is something left for it to wait on.",
  "disable-auto-merge":
    "The host refused it. Check that you have write access, and that the merge has not already happened.",
  revert:
    "The host refused it. Check that you have write access and that this pull request was merged on the host.",
  "delete-branch":
    "The host refused it. Check that you have write access to the source repository and that the branch has not moved since this page loaded.",
  "approve-workflows":
    "The host refused it. Check that you have Actions write access and that these workflow runs are still awaiting approval.",
};

const UPDATE_BRANCH_REBASE_FAILURE_HINT =
  "The host refused it. A rebase stops at the first commit that does not apply cleanly; updating with a merge commit may still work.";

const OFF_HEAD_PULL_REQUEST_CHECKOUT_TOAST = {
  type: "warning",
  title: "Checked out, but not confirmed on the latest commit",
  description:
    "This checkout could not be confirmed at the pull request's latest commit, so its code may differ. Local commits or uncommitted work keep a checkout where it is.",
} as const;

export interface PullRequestDetailViewProps {
  environmentId: EnvironmentId;
  surface: PullRequestSurface;
  listEntry: PullRequestListEntry | null;
  refreshToken: number;
  onSelectPullRequest: (reference: PullRequestRef) => void;
  /** "thread": inside a thread's right panel (no checkout menu, hand-offs go to its composer). */
  context?: "page" | "thread";
  /** The composer a hand-off writes into, instead of opening a new thread. */
  attachTarget?: string | null;
  threadRef?: ScopedThreadRef | null;
  /** Where the selected tab lives; the page keeps it on the panel surface. */
  onTabChange?: (tab: PullRequestDetailTab) => void;
}

export function PullRequestDetailView({
  environmentId,
  surface,
  listEntry,
  refreshToken,
  onSelectPullRequest,
  context = "page",
  attachTarget = null,
  threadRef = null,
  onTabChange,
}: PullRequestDetailViewProps) {
  const theme = useTheme();
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const environments = useAtomValue(pullRequestEnvironmentsAtom);
  const keybindings = useAtomValue(activeKeybindingsAtom);
  const project = projects.find(
    (candidate) => candidate.id === surface.projectId && candidate.environmentId === environmentId,
  );
  const repositoryIdentity = project?.repositoryIdentity;
  const serverConfig =
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig ?? null;
  const capabilities = serverConfig?.environment.capabilities;
  const supportsThreadPullRequests = capabilities?.threadPullRequests === true;
  const requestedReference: PullRequestRef = {
    projectId: surface.projectId as PullRequestRef["projectId"],
    repository: surface.repository,
    number: surface.number,
    ...(surface.host ? { host: surface.host } : {}),
  };
  const reference = supportsThreadPullRequests
    ? resolvePullRequestReferenceHost(requestedReference, repositoryIdentity)
    : {
        projectId: requestedReference.projectId,
        repository: requestedReference.repository,
        number: requestedReference.number,
      };
  const pullRequestKey = pullRequestRefKey(reference);
  const matchingListEntry =
    listEntry?.projectId === reference.projectId &&
    listEntry.repository.toLowerCase() === reference.repository.toLowerCase() &&
    (reference.host === undefined || listEntry.host.toLowerCase() === reference.host.toLowerCase()) &&
    listEntry.number === reference.number
      ? listEntry
      : null;
  const reviewGuidesEnabled = serverConfig?.settings.reviewGuidesEnabled === true;
  const requestedTab: PullRequestDetailTab = surface.detailTab ?? "summary";
  const selectTab = (next: PullRequestDetailTab) => {
    if (onTabChange) onTabChange(next);
    else pullRequestPanel.setDetailTab(surface.id, next);
  };
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const canOperateThread = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const { detailQuery, activityQuery, activity, sharedSummary, coreDetail, detail } = usePullRequestDetail(
    environmentId,
    reference,
    matchingListEntry,
    capabilities?.pullRequestChecks === true,
  );
  const handoffSummary = detail ?? sharedSummary;
  const [openReviewRequest, setOpenReviewRequest] = useState(0);
  const [codeCommitScope, setCodeCommitScope] = useState<{ readonly key: string; readonly oid: string | null }>(
    () => ({ key: pullRequestKey, oid: null }),
  );
  const selectedCodeCommitOid = codeCommitScope.key === pullRequestKey ? codeCommitScope.oid : null;
  const selectCodeCommit = (oid: string | null) => setCodeCommitScope({ key: pullRequestKey, oid });
  const openCommit = (oid: string) => {
    selectCodeCommit(oid);
    selectTab("code");
  };
  const [codeRevealRequest, setCodeRevealRequest] = useState<{ readonly path: string; readonly nonce: number } | null>(
    null,
  );
  const openFileInCode = (path: string) => {
    selectCodeCommit(null);
    setCodeRevealRequest((previous) => ({ path, nonce: (previous?.nonce ?? 0) + 1 }));
    selectTab("code");
  };
  const guideOpenRequested =
    useAtomValue(guideRunStateAtom).openRequestKey === guideRunKey(environmentId, reference);
  useEffect(() => {
    if (!guideOpenRequested) return;
    guideRunStore.requestOpen(null);
    selectTab("guide");
    // oxlint-disable-next-line react/exhaustive-deps -- answers one open request
  }, [guideOpenRequested]);

  // ── Stack ──
  const stackReference =
    detail === null || detail.capabilities.stacks !== true || !supportsThreadPullRequests
      ? null
      : { ...reference, host: reference.host ?? parseChangeRequestUrl(detail.url)?.host };
  const nativeStackQuery = usePullRequestStack(environmentId, stackReference);
  const nativeStack = nativeStackQuery.data;
  const supportsStackActions =
    supportsThreadPullRequests &&
    detail?.capabilities.stacks === true &&
    detail.capabilities.stackActions === true &&
    capabilities?.pullRequestStackActions === true;
  const canMergeSinglePullRequest = allowsSinglePullRequestMerge({
    supportsStackActions,
    hasStack: nativeStack !== null,
    stackPending: !nativeStackQuery.isFresh,
    stackError: nativeStackQuery.error,
  });

  // ── Refresh ──
  const refreshDetail = () => {
    detailQuery.refresh();
    activityQuery.refresh();
    nativeStackQuery.refresh();
  };
  const [codeRefreshToken, setCodeRefreshToken] = useState(0);
  const [activityRevision, setActivityRevision] = useState<{ readonly key: string; readonly updatedAt: string } | null>(
    null,
  );
  const coreUpdatedAt = coreDetail?.updatedAt ?? null;
  if (
    coreUpdatedAt !== null &&
    (activityRevision?.key !== pullRequestKey || activityRevision.updatedAt !== coreUpdatedAt)
  ) {
    const next = { key: pullRequestKey, updatedAt: coreUpdatedAt };
    if (!shouldRefreshPullRequestActivity(activityRevision, next)) {
      setActivityRevision(next);
    } else if (!activityQuery.isPending) {
      // Let an existing read settle before revalidating the new revision: interrupting a write's
      // activity refresh can leave the previous value showing.
      setActivityRevision(next);
      setCodeRefreshToken((token) => token + 1);
      queueMicrotask(activityQuery.refresh);
    }
  }
  const [isInvalidating, setIsInvalidating] = useState(false);
  const refreshing = isInvalidating || detailQuery.isPending;
  const refreshFromHost = async () => {
    setIsInvalidating(true);
    // Drops the server's cached host reads for this pull request; it writes nothing to the host.
    await runAtomCommand(appAtomRegistry, pullRequestEnvironment.invalidate, {
      environmentId,
      input: { reference },
    });
    refreshDetail();
    setCodeRefreshToken((token) => token + 1);
    setIsInvalidating(false);
  };
  const [appliedRefreshToken, setAppliedRefreshToken] = useState(refreshToken);
  if (appliedRefreshToken !== refreshToken) {
    setAppliedRefreshToken(refreshToken);
    queueMicrotask(() => void refreshFromHost());
  }
  const turnRefresh = usePullRequestTurnRefresh(environmentId);

  // ── Writes ──
  const [pendingAction, setPendingAction] = useState<PullRequestAction | null>(null);
  const actionPending = pendingAction !== null;
  const finishAction = async (
    action: PullRequestAction,
    method?: PullRequestMergeMethod,
    updateMethod?: PullRequestUpdateMethod,
  ) => {
    const result = await runPullRequestWrite(pullRequestEnvironment.runAction, {
      environmentId,
      input: {
        ...reference,
        action,
        ...(method ? { mergeMethod: method } : {}),
        ...(updateMethod ? { updateMethod } : {}),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      // A merge strategy a branch policy forbids is refused at completion and nowhere earlier, so
      // "action failed" would leave the reader pressing the same button again.
      toast({
        type: "error",
        title: ACTION_FAILURE_LABELS[action],
        description: readableFailure(
          squashAtomCommandFailure(result),
          updateMethod === "rebase" ? UPDATE_BRANCH_REBASE_FAILURE_HINT : ACTION_FAILURE_HINTS[action],
        ),
      });
      return false;
    }
    if (action === "revert") toast({ type: "success", title: "Revert pull request opened" });
    if (action === "delete-branch") toast({ type: "success", title: "Branch deleted" });
    if (pullRequestActionNeedsHostRefresh(action)) void refreshFromHost();
    else refreshDetail();
    return true;
  };
  const perform = async (
    action: PullRequestAction,
    method?: PullRequestMergeMethod,
    updateMethod?: PullRequestUpdateMethod,
  ) => {
    if (!canWriteSourceControl || pendingAction !== null) return false;
    setPendingAction(action);
    return finishAction(action, method, updateMethod);
  };
  const performCommentAction = async (body: string, action: "close" | "reopen") => {
    if (!canWriteSourceControl || pendingAction !== null) return { commentPosted: false };
    setPendingAction(action);
    const commentResult = await runPullRequestWrite(pullRequestEnvironment.comment, {
      environmentId,
      input: { ...reference, body },
    });
    if (commentResult._tag === "Failure") {
      setPendingAction(null);
      toast({ type: "error", title: "Could not post the comment", ...dryRunDescription(commentResult) });
      return { commentPosted: false };
    }
    const actionSucceeded = await finishAction(action);
    // The comment is durable even if the state change was refused, so show it while the action's
    // failure explains why the pull request stayed where it was.
    if (!actionSucceeded) refreshDetail();
    return { commentPosted: true };
  };

  // ── Merge method ──
  const lastSelectedMergeMethod = useAtomValue(lastPullRequestMergeMethodAtom);
  const projectDefaultMergeMethod =
    serverConfig === null
      ? undefined
      : (resolveProjectSettings(serverConfig.settings, reference.projectId, project).settings.pullRequestMergeMethod ??
        undefined);
  const [mergeMethodSelection, setMergeMethodSelection] = useState<{
    readonly key: string;
    readonly method: PullRequestMergeMethod;
  } | null>(null);
  const autoMergeKey = `${pullRequestKey}:${detail?.autoMergeMethod ?? ""}`;
  const [seenAutoMergeKey, setSeenAutoMergeKey] = useState<string | null>(null);
  if (seenAutoMergeKey !== autoMergeKey) {
    setSeenAutoMergeKey(autoMergeKey);
    if (detail?.autoMergeMethod !== undefined) {
      setMergeMethodSelection({ key: pullRequestKey, method: detail.autoMergeMethod });
    }
  }
  const selectMergeMethod = (method: PullRequestMergeMethod) => {
    setMergeMethodSelection({ key: pullRequestKey, method });
    appAtomRegistry.set(lastPullRequestMergeMethodAtom, method);
  };
  const allowedMergeMethods = detail
    ? detail.capabilities.mergeMethods.filter((method) => detail.mergeCapabilities[method])
    : [];
  const selectedMergeMethod = resolvePullRequestMergeMethod(
    allowedMergeMethods,
    mergeMethodSelection?.key === pullRequestKey ? mergeMethodSelection.method : null,
    projectDefaultMergeMethod,
    lastSelectedMergeMethod ?? "merge",
  );
  const selectedMergeMethodLabel = PULL_REQUEST_MERGE_METHOD_LABELS[selectedMergeMethod];
  const pendingAutoMergeLabel = `Auto-merge (${selectedMergeMethodLabel.toLowerCase()})`;
  const conflicting = detail?.state === "open" && detail.mergeability === "conflicting";
  const autoMergeArmed = detail?.state === "open" && detail.autoMergeEnabled === true;
  const armedAutoMergeLabel = detail?.autoMergeMethod
    ? `Auto-merge (${PULL_REQUEST_MERGE_METHOD_LABELS[detail.autoMergeMethod].toLowerCase()})`
    : "Auto-merge";
  const workflowApprovalsRequired = detail?.state === "open" ? (detail.workflowApprovalsRequired ?? 0) : 0;
  const freshness = detail === null ? null : resolveBaseFreshness(detail);

  // ── Hand-offs ──
  const [handoff, setHandoff] = useState<string | null>(null);
  const handoffLabels = pullRequestHandoffLabels(attachTarget !== null);
  const pickableEnvironments =
    context === "page"
      ? resolvePickableEnvironments(
          { environmentId, projectId: reference.projectId },
          projects,
          environments.map((environment) => ({
            environmentId: environment.environmentId,
            label: environment.label,
            ...(environment.serverConfig ? { machine: resolveEnvironmentMachineKind(environment.serverConfig) } : {}),
          })),
        )
      : [];
  const [actingScope, setActingScope] = useState<{ readonly key: string; readonly environmentId: EnvironmentId } | null>(
    null,
  );
  const chosenEnvironmentId = actingScope?.key === pullRequestKey ? actingScope.environmentId : environmentId;
  const acting = pickableEnvironments.find((entry) => entry.environmentId === chosenEnvironmentId) ?? null;
  const actingEnvironmentId = acting?.environmentId ?? environmentId;
  const checkoutRoot = acting?.workspaceRoot ?? detail?.workspaceRoot ?? project?.workspaceRoot ?? null;
  const canPrepareWorktree = canWriteSourceControl && canOperateThread;
  const canFixFindings = attachTarget !== null || canPrepareWorktree;
  const actingProjectRef = (projectId: PullRequestRef["projectId"]) =>
    scopeProjectRef(actingEnvironmentId, acting?.projectId ?? projectId);
  const startAsk = (task: PullRequestThreadTask) => {
    if (!detail || handoff !== null) return;
    startPullRequestAsk(actingProjectRef(detail.projectId), task, attachTarget);
  };
  const startHandoff = async (
    kind: string,
    task: PullRequestThreadTask | null,
    mode: "worktree" | "local" = "worktree",
  ) => {
    if (!handoffSummary || handoff !== null) return;
    if (attachTarget !== null && task !== null) {
      writeTaskToComposer(attachTarget, task);
      toast({
        type: "success",
        title: "Added to the composer",
        description: "The task is in the composer. Read it over, then send.",
      });
      return;
    }
    if (checkoutRoot === null || !canWriteSourceControl || (mode === "worktree" && !canOperateThread)) return;
    setHandoff(kind);
    const toastId = toast({ type: "loading", title: "Preparing the pull request checkout..." });
    const projectRef = actingProjectRef(handoffSummary.projectId);
    // The thread id is chosen before the checkout: a worktree's setup script runs for the thread
    // it was made for.
    const threadId = ThreadId.make(globalThis.crypto.randomUUID());
    const input = {
      cwd: checkoutRoot,
      reference: handoffSummary.url,
      mode,
      ...(mode === "worktree" ? { threadId } : {}),
    };
    const prepared = await guardPullRequestWrite(
      gitEnvironment.preparePullRequestThread.label,
      { environmentId: actingEnvironmentId, input },
      () =>
        runAtomCommand(
          appAtomRegistry,
          gitEnvironment.preparePullRequestThread,
          { environmentId: actingEnvironmentId, input },
          { reportFailure: false },
        ),
    );
    setHandoff(null);
    if (prepared instanceof PullRequestDryRunError || prepared._tag === "Failure") {
      updateToast(toastId, {
        type: "error",
        title: "Could not prepare the pull request checkout",
        description:
          prepared instanceof PullRequestDryRunError
            ? prepared.message
            : checkoutFailureDescription(
                isAtomCommandInterrupted(prepared) ? undefined : squashAtomCommandFailure(prepared),
              ),
      });
      return;
    }
    startNewThread(projectRef);
    const draftKey = composerTargetKey({
      kind: "draft",
      environmentId: projectRef.environmentId,
      projectId: projectRef.projectId,
    });
    setDraftWorkspace(draftKey, {
      envMode: prepared.value.worktreePath === null ? "local" : "worktree",
      branch: prepared.value.branch,
      worktreePath: prepared.value.worktreePath,
    });
    if (task !== null) writeTaskToComposer(draftKey, task);
    updateToast(
      toastId,
      !prepared.value.isOnPullRequestHead
        ? OFF_HEAD_PULL_REQUEST_CHECKOUT_TOAST
        : task !== null
          ? { type: "success", title: "Checkout ready", description: "The task is in the composer. Read it over, then send." }
          : {
              type: "success",
              title: mode === "local" ? "Checked out here" : "Checked out",
              description:
                mode === "local"
                  ? "This repository is on the pull request's branch, with a thread open on it."
                  : "The pull request is in its own worktree, with a thread open on it.",
            },
    );
  };
  const handoffBase = detail
    ? {
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        state: detail.state,
        isDraft: detail.isDraft,
      }
    : null;
  const askAboutPullRequest = () => {
    if (handoffBase) startAsk(buildAskAboutPullRequestHandoff(handoffBase));
  };
  const explainPullRequest = () => {
    if (handoffBase) startAsk(buildExplainPullRequestHandoff(handoffBase));
  };
  const askAboutGuideStop = (stop: PullRequestReviewGuideStop, index: number, question: string) => {
    if (!handoffBase) return;
    startAsk(
      buildAskAboutGuideStopHandoff({
        ...handoffBase,
        stop: {
          index,
          title: stop.title,
          summary: stop.summary,
          attention: stop.attention?.note ?? null,
          excerpts: stop.excerpts,
        },
        question,
      }),
    );
  };
  const addSelectionToAgent = (selection: { readonly comment: ReviewCommentContext; readonly request: string }) => {
    if (!handoffBase) return;
    startAsk(buildAddSelectionToAgentHandoff({ ...handoffBase, comment: selection.comment, request: selection.request }));
  };
  const startFixFinding = (finding: PullRequestFinding) => {
    if (!detail) return;
    void startHandoff(
      pullRequestFindingKey(finding),
      buildFixFindingHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        finding,
      }),
    );
  };
  const visibleTabs = TABS.filter(
    (item) =>
      (item.value !== "code" || detail === null || detail.capabilities.diff) &&
      (item.value !== "guide" || reviewGuidesEnabled),
  );
  // Keep unavailable-tab fallbacks out of the saved selection.
  const tab = visibleTabs.some((item) => item.value === requestedTab) ? requestedTab : "summary";
  const can = (action: PullRequestAction) =>
    detail?.capabilities.actions.includes(action) === true && detail.viewerPermissions.actions.includes(action);
  const detailChecksState = detail ? pullRequestChecksState(detail.checks) : null;
  const sharedChecksState =
    sharedSummary !== null && "checksState" in sharedSummary ? sharedSummary.checksState : undefined;
  const latestChecksState = sharedChecksState === undefined ? detailChecksState : sharedChecksState;
  // List rollups can omit workflows awaiting approval. Only refreshed detail can clear those.
  const checksState =
    latestChecksState !== "failing" && detail?.checks.some((check) => check.status === "action-required")
      ? "pending"
      : latestChecksState;
  const checksStale = checksState !== detailChecksState;
  const startFixFindings = () => {
    if (!detail) return;
    void startHandoff(
      "findings",
      buildFixFindingsHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        reviewThreads: detail.reviewThreads,
        comments: detail.comments,
        checks: checksStale ? [] : detail.checks,
        commentsTruncated: detail.commentsTruncated,
      }),
    );
  };
  const startResolveConflicts = () => {
    if (!handoffSummary) return;
    void startHandoff("conflicts", {
      prompt: buildResolveConflictsPrompt({
        number: handoffSummary.number,
        url: handoffSummary.url,
        headBranch: handoffSummary.headBranch,
        baseBranch: handoffSummary.baseBranch,
      }),
    });
  };
  const primaryAction = detail
    ? resolvePullRequestPrimaryControl({
        state: detail.state,
        isDraft: detail.isDraft,
        mergeability: detail.mergeability,
        checksState,
        autoMergeEnabled: detail.autoMergeEnabled,
        hasMergeMethod: allowedMergeMethods.length > 0,
        canMerge: canMergeSinglePullRequest && can("merge"),
        canMarkReady: can("ready"),
        canEnableAutoMerge: canMergeSinglePullRequest && can("enable-auto-merge"),
      })
    : null;
  const showsDraftToggle =
    detail?.state === "open" &&
    can(detail.isDraft ? "ready" : "draft") &&
    !(detail.isDraft && primaryAction === "ready");
  const showsAutoMerge =
    canMergeSinglePullRequest &&
    detail?.state === "open" &&
    ((autoMergeArmed && can("disable-auto-merge")) ||
      (!autoMergeArmed &&
        primaryAction !== "enable-auto-merge" &&
        !detail.isDraft &&
        !conflicting &&
        can("enable-auto-merge") &&
        allowedMergeMethods.length > 0));
  const showsMergeNow =
    canMergeSinglePullRequest &&
    detail?.state === "open" &&
    (primaryAction === "enable-auto-merge" || primaryAction === "auto-merge-armed") &&
    can("merge") &&
    !detail.isDraft &&
    !conflicting &&
    allowedMergeMethods.length > 0;
  const showsMergeMethods =
    detail?.state === "open" && can("merge") && !detail.isDraft && !conflicting && allowedMergeMethods.length > 1;
  const statePresentation = detail ? resolvePullRequestState({ state: detail.state, isDraft: detail.isDraft }) : null;
  const showsDeleteBranch = detail !== null && canDeletePullRequestBranch(detail);
  const environmentConnected = useAtomValue(pullRequestEnvironmentConnectedAtom(environmentId));
  const confirmDeleteBranch = () => {
    if (detail === null) return;
    void requestConfirmDialog(
      [
        `Delete branch ${detail.headBranch}?`,
        `This deletes ${detail.headBranch} from ${detail.headRepositoryNameWithOwner ?? detail.repository}. Local branches and worktrees are not changed.`,
      ].join("\n"),
      { variant: "destructive" },
    ).then((confirmed) => {
      if (confirmed) void perform("delete-branch");
    });
  };
  const showsApproveWorkflows = workflowApprovalsRequired > 0 && !checksStale && can("approve-workflows");
  const checksSummary = checksStale
    ? checksState === null
      ? "No checks reported"
      : pullRequestChecksStatePresentation(checksState, theme).label
    : detail
      ? summarizePullRequestChecks(detail.checks)
      : "";
  const copyReference = (value: string, label: string) => {
    void copyTextToClipboard(value).then(
      () => toast({ type: "success", title: `${label} copied` }),
      (error: unknown) =>
        toast({
          type: "error",
          title: `Failed to copy ${label}`,
          ...(error instanceof Error ? { description: error.message } : {}),
        }),
    );
  };
  useEffect(
    () =>
      registerShortcutHandler("pullRequest.copyNumber", () => {
        copyReference(`#${reference.number}`, "PR number");
        return true;
      }),
    // oxlint-disable-next-line react/exhaustive-deps -- one registration per pull request
    [reference.number],
  );
  const guideWriter = useReviewGuideWriter({ environmentId, reference, title: detail?.title ?? null });
  const writeGuide = () => {
    void guideWriter.write();
    if (guideWriter.data?.guide == null) selectTab("guide");
  };

  const hostClient = sourceControlClients.get(detail?.provider);
  const openOnHostText =
    hostClient === UNKNOWN_SOURCE_CONTROL_CLIENT ? "Open on host" : `Open on ${hostClient.label}`;
  const repositoryUrl = detail === null ? null : changeRequestRepositoryUrl(detail.url);
  const checkoutCommand = handoffSummary
    ? pullRequestCheckoutCommand(
        handoffSummary.provider,
        handoffSummary.number,
        handoffSummary.headBranch,
        detail?.headRepositoryNameWithOwner,
        changeRequestRepositoryUrl(handoffSummary.url),
      )
    : loadingPullRequestCheckoutCommand(reference, repositoryIdentity);
  const branchRefsQuery = useEnvironmentQuery(
    detail === null
      ? null
      : vcsEnvironment.listRefs({
          environmentId,
          input: { cwd: detail.workspaceRoot, includeMatchingRemoteRefs: true, limit: 2 },
        }),
  );
  const isStackedPullRequest =
    detail !== null && isStackedPullRequestBase(detail.baseBranch, branchRefsQuery.data?.refs ?? []);
  const activityPending = activityQuery.isPending && activity === null;
  const activityError = activity === null ? activityQuery.error : null;
  const [timelineOrder, setTimelineOrder] = useState<"newest" | "oldest">("newest");
  const [condensedByTab, setCondensedByTab] = useState<Partial<Record<PullRequestDetailTab, boolean>>>({});
  const condensed = condensedByTab[tab] ?? false;
  const onScrollTop = (top: number) => {
    const previous = condensedByTab[tab] ?? false;
    let next = previous;
    if (previous) {
      if (top < 4) next = false;
    } else if (top > FOLD_HEIGHT + 32) {
      next = true;
    }
    if (next !== previous) setCondensedByTab({ ...condensedByTab, [tab]: next });
  };
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const [headerWidth, setHeaderWidth] = useState(0);

  const resolveConflictsControl = (
    <PullRequestResolveConflictsButton
      handoff={handoff}
      unavailable={attachTarget === null && checkoutRoot === null}
      onResolve={startResolveConflicts}
    />
  );
  const checkoutControl =
    context === "page" ? (
      <PullRequestCheckoutMenu
        handoff={handoff}
        checkoutRoot={checkoutRoot}
        canPrepareWorktree={canPrepareWorktree}
        canCheckoutHere={canWriteSourceControl}
        onCheckout={(mode) => void startHandoff(`checkout:${mode}`, null, mode)}
        pickableEnvironments={pickableEnvironments}
        actingEnvironmentId={actingEnvironmentId}
        onActingEnvironmentChange={(next) => setActingScope({ key: pullRequestKey, environmentId: next })}
        compact={headerWidth > 0 && headerWidth < 560}
      />
    ) : null;

  if (detailQuery.isPending && !detail) {
    return (
      <PullRequestDetailGhost
        seed={matchingListEntry}
        number={reference.number}
        checkoutCommand={checkoutCommand}
        tabs={visibleTabs}
        activeTab={tab}
        actions={
          handoffSummary ? (
            <>
              {handoffSummary.state === "open" && handoffSummary.mergeability === "conflicting"
                ? resolveConflictsControl
                : null}
              {checkoutControl}
            </>
          ) : null
        }
      />
    );
  }

  const changeBreakdown = (fontSize: number) =>
    detail ? (
      <PullRequestChangeBreakdownStat
        environmentId={environmentId}
        reference={reference}
        additions={detail.additions}
        deletions={detail.deletions}
        fontSize={fontSize}
        eager
      />
    ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
      {threadPickerOpen && detail ? (
        <PullRequestThreadLinks
          display="picker"
          environmentId={environmentId}
          reference={reference}
          url={detail.url}
          threadRef={null}
          onPickerOpenChange={setThreadPickerOpen}
        />
      ) : null}
      <div
        onLayout={(event) => {
          const next = Math.round(Number(event.width ?? 0));
          if (next !== headerWidth) setHeaderWidth(next);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          ...(detail ? { borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6) } : {}),
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 28, gap: 8 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              flexGrow: 1,
              minWidth: 0,
              paddingLeft: 16,
            }}
          >
            {detail && statePresentation ? (
              condensed ? (
                <>
                  <NumberLink
                    number={detail.number}
                    url={detail.url}
                    tone={statePresentation.tone(theme)}
                    label={openOnHostText}
                  />
                  <Tooltip content={detail.title} side="top">
                    <div style={{ display: "flex", minWidth: 0, flexShrink: 1 }}>
                      <Text size="xs" weight={500} truncate>
                        {detail.title}
                      </Text>
                    </div>
                  </Tooltip>
                </>
              ) : (
                <>
                  <Tooltip
                    content={repositoryUrl ? `Open ${detail.repository} repository` : detail.repository}
                    side="top"
                  >
                    <div
                      onClick={repositoryUrl ? () => openExternalUrl(repositoryUrl) : undefined}
                      style={{
                        display: "flex",
                        minWidth: 0,
                        flexShrink: 1,
                        cursor: repositoryUrl ? "pointer" : "default",
                      }}
                    >
                      <Text size="xs" weight={500} color={theme.mutedForeground} truncate>
                        {detail.repository}
                      </Text>
                    </div>
                  </Tooltip>
                  <NumberLink
                    number={detail.number}
                    url={detail.url}
                    tone={statePresentation.tone(theme)}
                    label={openOnHostText}
                  />
                </>
              )
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              marginRight: 16,
            }}
          >
            {detail ? (
              <>
                {!nativeStack && supportsStackActions && nativeStackQuery.error ? (
                  <PrButton variant="ghost" onClick={nativeStackQuery.refresh}>
                    Retry stack lookup
                  </PrButton>
                ) : null}
                {nativeStack ? (
                  <PullRequestStackMenu
                    hostLabel={hostClient.label}
                    stack={nativeStack}
                    notice={nativeStackQuery.notice}
                    onRetry={nativeStackQuery.error ? nativeStackQuery.refresh : undefined}
                    reference={reference}
                    environmentId={environmentId}
                    onSelect={onSelectPullRequest}
                    mergeMethod={selectedMergeMethod}
                    canMerge={
                      nativeStackQuery.isFresh && supportsStackActions && can("merge") && allowedMergeMethods.length > 0
                    }
                    canRebase={
                      nativeStackQuery.isFresh && supportsStackActions && detail.viewerPermissions.stackRebase === true
                    }
                    onActed={refreshDetail}
                  />
                ) : null}
                {context === "page" ? (
                  <PullRequestThreadLinks
                    display="count"
                    environmentId={environmentId}
                    reference={reference}
                    url={detail.url}
                    threadRef={null}
                  />
                ) : null}
                <PullRequestPrimaryAction
                  pullRequestKey={pullRequestKey}
                  primaryAction={primaryAction}
                  autoMergeArmed={autoMergeArmed}
                  armedAutoMergeLabel={armedAutoMergeLabel}
                  pendingAutoMergeLabel={pendingAutoMergeLabel}
                  selectedMergeMethod={selectedMergeMethod}
                  selectedMergeMethodLabel={selectedMergeMethodLabel}
                  statePresentation={statePresentation}
                  pendingAction={pendingAction}
                  perform={perform}
                  resolveConflicts={resolveConflictsControl}
                />
                {checkoutControl}
                <PullRequestActionsMenu
                  pullRequestKey={pullRequestKey}
                  detail={detail}
                  number={reference.number}
                  threadLinkItem={
                    <PullRequestThreadLinks
                      display="menu-item"
                      environmentId={environmentId}
                      reference={reference}
                      url={detail.url}
                      threadRef={threadRef}
                      onPickerOpenChange={setThreadPickerOpen}
                    />
                  }
                  refreshing={refreshing}
                  refreshFromHost={() => void refreshFromHost()}
                  handoff={handoff}
                  attachesToComposer={attachTarget !== null}
                  askAboutPullRequest={askAboutPullRequest}
                  explainPullRequest={explainPullRequest}
                  canFixFindings={canFixFindings}
                  startFixFindings={startFixFindings}
                  fixFindingsLabel={handoffLabels.fixFindings}
                  canWriteGuide={reviewGuidesEnabled && guideWriter.canWrite}
                  guideRunning={guideWriter.running}
                  guideWritten={guideWriter.data?.guide != null}
                  writeGuide={writeGuide}
                  pickableEnvironments={pickableEnvironments}
                  actingEnvironmentId={actingEnvironmentId}
                  onActingEnvironmentChange={(next) => setActingScope({ key: pullRequestKey, environmentId: next })}
                  can={can}
                  autoMergeArmed={autoMergeArmed}
                  showsDraftToggle={showsDraftToggle}
                  showsMergeNow={showsMergeNow}
                  showsAutoMerge={showsAutoMerge}
                  showsMergeMethods={showsMergeMethods}
                  allowedMergeMethods={allowedMergeMethods}
                  selectedMergeMethod={selectedMergeMethod}
                  onSelectMergeMethod={selectMergeMethod}
                  showsDeleteBranch={showsDeleteBranch}
                  environmentConnected={environmentConnected}
                  confirmDeleteBranch={confirmDeleteBranch}
                  pendingAction={pendingAction}
                  perform={perform}
                  openOnHostText={openOnHostText}
                  copyReference={copyReference}
                  copyLinkShortcut={shortcutLabelForCommand(keybindings, "thread.copyReference")}
                  copyNumberShortcut={shortcutLabelForCommand(keybindings, "pullRequest.copyNumber")}
                />
              </>
            ) : null}
          </div>
        </div>
        {detail && condensed ? (
          <CondensedMeta
            detail={detail}
            base={
              <PullRequestBaseBranch
                baseBranch={detail.baseBranch}
                freshness={freshness}
                stacked={isStackedPullRequest}
                pending={actionPending}
                onUpdate={(method) => void perform("update-branch", undefined, method)}
                fontSize={11}
                iconSize={12}
                color={alpha(theme.mutedForeground, 0.65)}
              />
            }
            diffStat={changeBreakdown(11)}
          />
        ) : detail ? (
          <HeaderBody
            detail={detail}
            title={
              <PullRequestTitleEditor
                environmentId={environmentId}
                reference={reference}
                pullRequestKey={pullRequestKey}
                detail={detail}
                canWriteSourceControl={canWriteSourceControl}
                onSaved={refreshDetail}
              />
            }
            checkout={
              checkoutCommand ? (
                <PullRequestCopyableCode
                  key={checkoutCommand}
                  value={checkoutCommand}
                  copyLabel="Copy checkout command"
                  copiedLabel="Checkout command copied"
                  tooltipSide="bottom"
                  testId="pr-copy-checkout"
                />
              ) : null
            }
            base={
              <PullRequestBaseBranch
                baseBranch={detail.baseBranch}
                freshness={freshness}
                stacked={isStackedPullRequest}
                pending={actionPending}
                onUpdate={(method) => void perform("update-branch", undefined, method)}
                color={alpha(theme.mutedForeground, 0.7)}
              />
            }
            head={
              <PullRequestCopyableCode
                key={detail.headBranch}
                value={detail.headBranch}
                copyLabel="Copy pull request branch"
                copiedLabel="Branch name copied"
                color={alpha(theme.mutedForeground, 0.7)}
                testId="pr-copy-head"
              />
            }
            diffStat={changeBreakdown(12)}
          />
        ) : null}
        {detail ? (
          <TabBar tabs={visibleTabs} value={tab} onChange={selectTab}>
            {tab === "summary" ? (
              showsApproveWorkflows ? (
                <PullRequestApproveWorkflowsButton
                  pullRequestKey={pullRequestKey}
                  pendingAction={pendingAction}
                  perform={perform}
                />
              ) : (
                <ChecksStatusLine
                  icon={
                    checksState !== null ? (
                      <PullRequestChecksPopover
                        checksState={checksState}
                        environmentId={environmentId}
                        reference={reference}
                        checks={detail.checks}
                      />
                    ) : (
                      <Icon name="circle-dot" size={14} color={theme.mutedForeground} />
                    )
                  }
                  label={checksSummary}
                />
              )
            ) : tab === "timeline" ? (
              <TimelineMeta
                detail={detail}
                pending={activityPending}
                error={activityError !== null}
                order={timelineOrder}
                onToggleOrder={() => setTimelineOrder(timelineOrder === "newest" ? "oldest" : "newest")}
              />
            ) : null}
          </TabBar>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, position: "relative" }}>
        {detailQuery.error && !detail ? (
          <PullRequestsUnavailableState
            {...(isPullRequestNotFound(detailQuery.failure)
              ? {
                  title: `Pull request #${reference.number} not found`,
                  error: "It may be an issue rather than a pull request, or this account can't see it.",
                }
              : { error: detailQuery.error })}
            refreshing={detailQuery.isPending}
            onRetry={refreshDetail}
          />
        ) : detail ? (
          tab === "summary" ? (
            <PullRequestSummaryTab
              environmentId={environmentId}
              reference={reference}
              detail={detail}
              activityPending={activityPending}
              activityError={activityError}
              checksStale={checksStale}
              pendingFinding={handoff}
              fixFindingLabel={handoffLabels.fixFinding}
              fixCheckLabel={handoffLabels.fixCheck}
              {...(canFixFindings ? { onFixFinding: startFixFinding } : {})}
              onRefresh={refreshDetail}
              onRefreshChecks={() => void refreshFromHost()}
              onScrollTop={onScrollTop}
            />
          ) : tab === "guide" ? (
            <PullRequestGuideTab
              environmentId={environmentId}
              reference={reference}
              title={detail.title}
              workspaceRoot={detail.workspaceRoot}
              canComment={detail.capabilities.review.inlineComment && detail.viewerPermissions.comment}
              onAskAboutLines={(comment, request) => addSelectionToAgent({ comment, request })}
              onAskAboutStop={askAboutGuideStop}
              onFinishReview={
                detail.capabilities.review.verdicts.some((verdict) =>
                  detail.viewerPermissions.verdicts.includes(verdict),
                )
                  ? () => setOpenReviewRequest((count) => count + 1)
                  : null
              }
              onOpenFile={openFileInCode}
            />
          ) : tab === "timeline" ? (
            <PullRequestTimelineTab
              detail={detail}
              environmentId={environmentId}
              reference={reference}
              order={timelineOrder}
              activityPending={activityPending}
              activityError={activityError}
              onRetry={activityQuery.refresh}
              onRefresh={refreshDetail}
              onOpenCommit={openCommit}
              onScrollTop={onScrollTop}
            />
          ) : (
            <PullRequestCodeTab
              environmentId={environmentId}
              reference={reference}
              detail={detail}
              selectedCommitOid={selectedCodeCommitOid}
              onSelectedCommitChange={selectCodeCommit}
              pendingFinding={handoff}
              fixFindingLabel={handoffLabels.fixFinding}
              {...(canFixFindings ? { onFixFinding: startFixFinding } : {})}
              onAddToAgentSelection={addSelectionToAgent}
              onRefresh={refreshDetail}
              refreshToken={codeRefreshToken}
              backgroundRefreshToken={turnRefresh ?? 0}
              revealRequest={codeRevealRequest}
            />
          )
        ) : null}
        {detail ? (
          <PullRequestComposer
            key={pullRequestKey}
            environmentId={environmentId}
            reference={reference}
            detail={detail}
            actionPending={actionPending}
            onCommentAction={performCommentAction}
            onCommented={refreshDetail}
            onReviewSubmitted={refreshDetail}
            openReviewRequest={openReviewRequest}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A dry run's refusal, as a toast description; other failures keep web's bare title. */
function dryRunDescription(result: { readonly cause: Cause.Cause<unknown> }): { description?: string } {
  const failure = squashAtomCommandFailure(result);
  return failure instanceof PullRequestDryRunError ? { description: failure.message } : {};
}

/** Height of the title, meta and branch rows that fold away once the reader scrolls. */
const FOLD_HEIGHT = 108;

function NumberLink({ number, url, tone, label }: { number: number; url: string; tone: string; label: string }) {
  return (
    <Tooltip content={label} side="top">
      <div
        testId="pr-detail-number"
        onClick={() => openExternalUrl(url)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0, cursor: "pointer" }}
      >
        <Text size="xs" weight={500} color={tone}>
          {`#${number}`}
        </Text>
        <Icon name="external-link" size={10} color={tone} />
      </div>
    </Tooltip>
  );
}

function metaSeparator(color: string) {
  return (
    <text style={{ color, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, flexShrink: 0 }}>·</text>
  );
}

function HeaderBody({
  detail,
  title,
  checkout,
  base,
  head,
  diffStat,
}: {
  detail: PullRequestDetailView;
  title: ReactNode;
  checkout: ReactNode;
  base: ReactNode;
  head: ReactNode;
  diffStat: ReactNode;
}) {
  const theme = useTheme();
  const muted = theme.mutedForeground;
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 4, paddingLeft: 16, paddingRight: 16, paddingBottom: 16, minWidth: 0 }}>
      {title}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, minHeight: 20, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
            <PullRequestActorAvatar actor={detail.author} />
            <Text size="xs" weight={500} truncate>
              {detail.author?.login ?? "ghost"}
            </Text>
          </div>
          {metaSeparator(alpha(muted, 0.5))}
          <Text size="xs" color={muted} style={{ whiteSpace: "nowrap" }}>
            {`updated ${formatRelativeTimeLabel(detail.updatedAt)}`}
          </Text>
        </div>
        <div style={{ flexGrow: 1 }} />
        {checkout}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, minHeight: 20, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }}>
          {base}
          <Icon name="arrow-left" size={14} color={alpha(muted, 0.42)} />
          {head}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, minWidth: 64 }}>
            <Icon name="file-diff" size={14} color={muted} />
            <Text size="xs" color={muted}>
              {`${detail.changedFiles.toLocaleString()} ${detail.changedFiles === 1 ? "file" : "files"}`}
            </Text>
          </div>
          {diffStat}
        </div>
      </div>
    </div>
  );
}

function CondensedMeta({ detail, base, diffStat }: { detail: PullRequestDetailView; base: ReactNode; diffStat: ReactNode }) {
  const theme = useTheme();
  const muted = theme.mutedForeground;
  const mono = { fontFamily: FONTS.mono, fontSize: 11, lineHeight: 16, whiteSpace: "nowrap" as const };
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 8, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 }}>
        <PullRequestActorAvatar actor={detail.author} />
        <Text size="xs" color={muted} style={{ whiteSpace: "nowrap" }}>
          {formatRelativeTimeLabel(detail.updatedAt)}
        </Text>
      </div>
      <div style={{ width: 1, height: 12, backgroundColor: alpha(theme.border, 0.7), flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }}>
        {base}
        <Icon name="arrow-left" size={12} color={alpha(muted, 0.4)} />
        <Tooltip content={detail.headBranch} side="top">
          <div style={{ display: "flex", minWidth: 0, flexShrink: 1 }}>
            <text style={{ ...mono, color: alpha(muted, 0.65), textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>{detail.headBranch}</text>
          </div>
        </Tooltip>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="file-diff" size={12} color={muted} />
          <Text size="2xs" color={muted}>
            {detail.changedFiles.toLocaleString()}
          </Text>
        </div>
        {diffStat}
      </div>
    </div>
  );
}

/** PullRequestDetailTabBar: a segmented toggle, then whatever the tab adds on the right. */
export function TabBar({
  tabs,
  value,
  onChange,
  children,
}: {
  tabs: ReadonlyArray<{ value: PullRequestDetailTab; label: string }>;
  value: PullRequestDetailTab;
  onChange?: (tab: PullRequestDetailTab) => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 8,
        paddingBottom: 8,
        borderTopWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 2,
          padding: 2,
          borderRadius: RADIUS.lg,
          backgroundColor: alpha(theme.input, 0.4),
          flexShrink: 0,
        }}
      >
        {tabs.map((tab) => {
          const pressed = tab.value === value;
          return (
            <div
              key={tab.value}
              testId={`pr-detail-tab-${tab.value}`}
              onClick={onChange ? () => onChange(tab.value) : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                height: 24,
                paddingLeft: 10,
                paddingRight: 10,
                borderRadius: RADIUS.md,
                cursor: "pointer",
                backgroundColor: pressed ? alpha(theme.input, 0.72) : "#00000000",
                ...(pressed ? {} : { hover: { backgroundColor: alpha(theme.input, 0.32) } }),
              }}
            >
              <Text weight={500} color={pressed ? theme.foreground : theme.mutedForeground}>
                {tab.label}
              </Text>
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}

function ChecksStatusLine({ icon, label }: { icon: ReactNode; label: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, flexGrow: 1, minWidth: 0, height: 16, overflow: "hidden" }}>
      {icon}
      {typeof label === "string" ? (
        <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
          {label}
        </Text>
      ) : (
        label
      )}
    </div>
  );
}

function TimelineMeta({
  detail,
  pending,
  error,
  order,
  onToggleOrder,
}: {
  detail: PullRequestDetailView;
  pending: boolean;
  error: boolean;
  order: "newest" | "oldest";
  onToggleOrder: () => void;
}) {
  const theme = useTheme();
  const muted = theme.mutedForeground;
  const approvals = detail.commentsTruncated
    ? 0
    : latestPullRequestReviewOutcomes(detail.comments, detail.commits).filter(
        (entry) => entry.outcome === "approved" && !entry.stale,
      ).length;
  const count = (value: number) => (error ? "-" : pending ? "…" : value.toLocaleString());
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, justifyContent: "flex-end" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, opacity: pending || error ? 0.35 : 1 }}>
        <Icon name="message-square" size={12} color={muted} />
        <Text size="2xs" color={muted}>
          {count(detail.commentCount)}
        </Text>
        {metaSeparator(alpha(muted, 0.5))}
        <Icon name="git-commit-horizontal" size={12} color={muted} />
        <Text size="2xs" color={muted}>
          {count(detail.commits.length)}
        </Text>
        {approvals > 0 ? (
          <>
            {metaSeparator(alpha(muted, 0.5))}
            <Icon name="circle-check" size={12} color={pullRequestChecksStatePresentation("passing", theme).tone} />
            <Text size="2xs" color={pullRequestChecksStatePresentation("passing", theme).tone}>
              {approvals.toLocaleString()}
            </Text>
          </>
        ) : null}
      </div>
      <div
        testId="pr-timeline-order"
        onClick={onToggleOrder}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 24,
          paddingLeft: 7,
          paddingRight: 7,
          borderRadius: RADIUS.md,
          cursor: "pointer",
          hover: { backgroundColor: theme.accent },
        }}
      >
        <Icon name="arrow-down-up" size={12} color={muted} />
        <Text size="xs" weight={500} color={muted}>
          {order === "newest" ? "Newest first" : "Oldest first"}
        </Text>
      </div>
    </div>
  );
}

// ── Ghost (apps/web/src/components/pullRequest/PullRequestGhosts.tsx PullRequestDetailGhost) ─

function PullRequestDetailGhost({
  seed,
  number,
  checkoutCommand,
  tabs,
  activeTab,
  actions,
}: {
  seed: PullRequestListEntry | null;
  number: number;
  checkoutCommand: string | null;
  tabs: ReadonlyArray<{ value: PullRequestDetailTab; label: string }>;
  activeTab: PullRequestDetailTab;
  actions: ReactNode;
}) {
  const theme = useTheme();
  const muted = theme.mutedForeground;
  const statePresentation = seed ? resolvePullRequestState({ state: seed.state, isDraft: seed.isDraft }) : null;
  const checks =
    seed?.checksState === "failing" || seed?.checksState === "pending"
      ? pullRequestChecksStatePresentation(seed.checksState, theme)
      : null;
  const mono = { fontFamily: FONTS.mono, fontSize: 12, lineHeight: 16, whiteSpace: "nowrap" as const };
  return (
    <div testId="pr-detail-ghost" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 28, gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexGrow: 1, minWidth: 0, paddingLeft: 16 }}>
            {seed && statePresentation ? (
              <>
                <Text size="xs" weight={500} color={muted} truncate>
                  {seed.repository}
                </Text>
                <Text size="xs" weight={500} color={statePresentation.tone(theme)}>
                  {`#${seed.number}`}
                </Text>
                <Icon name="external-link" size={10} color={statePresentation.tone(theme)} />
              </>
            ) : (
              <>
                <GhostBar width={96} />
                <Text size="xs" color={muted}>{`#${number}`}</Text>
              </>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, marginRight: 16 }}>
            {actions ?? <GhostBar width={64} height={24} radius={RADIUS.md} />}
            <IconButton icon="ellipsis" size={24} disabled />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 4, paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minHeight: 24 }}>
            {seed ? (
              <Text size="base" weight={600} truncate style={{ lineHeight: 22 }}>
                {seed.title}
              </Text>
            ) : (
              <GhostBar width="80%" height={20} />
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, minHeight: 20 }}>
            {seed ? (
              <>
                <PullRequestActorAvatar actor={seed.author} />
                <Text size="xs" weight={500}>
                  {seed.author?.login ?? "ghost"}
                </Text>
                {metaSeparator(alpha(muted, 0.5))}
                <Text size="xs" color={muted}>{`updated ${formatRelativeTimeLabel(seed.updatedAt)}`}</Text>
              </>
            ) : (
              <>
                <GhostBar width={16} height={16} radius={8} />
                <GhostBar width={56} />
                <GhostBar width={64} />
              </>
            )}
            <div style={{ flexGrow: 1 }} />
            {checkoutCommand ? <text style={{ ...mono, color: muted }}>{checkoutCommand}</text> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, minHeight: 20 }}>
            {seed ? (
              <>
                <text style={{ ...mono, color: alpha(muted, 0.7) }}>{seed.baseBranch}</text>
                <Icon name="arrow-left" size={14} color={alpha(muted, 0.42)} />
                <text style={{ ...mono, color: alpha(muted, 0.7), textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>
                  {seed.headBranch}
                </text>
              </>
            ) : (
              <>
                <GhostBar width={48} />
                <GhostBar width={128} />
              </>
            )}
            <div style={{ flexGrow: 1 }} />
            <Icon name="file-diff" size={14} color={muted} />
            <GhostBar width={40} />
            {seed ? <PullRequestDiffStat additions={seed.additions} deletions={seed.deletions} fontSize={12} /> : <GhostBar width={80} />}
          </div>
        </div>
        <TabBar tabs={tabs} value={activeTab}>
          <ChecksStatusLine
            icon={
              checks ? (
                <Icon name={checks.icon} size={14} color={checks.tone} />
              ) : (
                <GhostBar width={14} height={14} radius={7} />
              )
            }
            label={checks ? checks.label : <GhostBar width={112} />}
          />
        </TabBar>
      </div>
      <div style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 4, gap: 8 }}>
        <GhostMetaRow icon="users" label="Reviewers">
          <GhostBar width={40} />
        </GhostMetaRow>
        <GhostMetaRow icon="tag" label="Labels">
          {seed ? (
            seed.labels.length > 0 ? (
              seed.labels.map((label) => <PullRequestLabelChip key={label.name} label={label} size="default" maxWidth={192} />)
            ) : (
              <Text size="xs" color={muted}>
                None
              </Text>
            )
          ) : (
            <>
              <GhostBar width={96} height={18} />
              <GhostBar width={80} height={18} />
            </>
          )}
        </GhostMetaRow>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
        <Text size="xs" weight={500} color={muted}>
          Description
        </Text>
        <Icon name="chevron-down" size={14} color={alpha(muted, 0.6)} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingLeft: 16, paddingRight: 16 }}>
        <GhostBar width={160} height={20} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <GhostBar width="100%" height={16} />
          <GhostBar width="91.6667%" height={16} />
          <GhostBar width="80%" height={16} />
          <GhostBar width="66.6667%" height={16} />
        </div>
      </div>
    </div>
  );
}

function GhostMetaRow({ icon, label, children }: { icon: "users" | "tag"; label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: 96, flexShrink: 0 }}>
        <Icon name={icon} size={14} color={theme.mutedForeground} />
        <Text size="xs" color={theme.mutedForeground}>
          {label}
        </Text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>{children}</div>
    </div>
  );
}
