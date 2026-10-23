// Port of apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx as the pull requests page
// shows it: inside RightPanelTabs (apps/web/src/components/RightPanelTabs.tsx) with one tab per
// opened pull request. Header pieces come from PullRequestDetailCrumbs, PullRequestDetailLayout,
// PullRequestBaseBranch and PullRequestDetailActions; the data merge from usePullRequestDetail.ts.
//
// Writes are not wired: checkout, resolve conflicts, merge/close/ready, title and description
// edits, reviewer and label pickers, reactions and the comment composer all write to the host or
// start agent threads. Their controls render where web puts them, disabled.
import { useAtomValue } from "@effect/atom-react";
import { sourceControlClients, UNKNOWN_SOURCE_CONTROL_CLIENT } from "@t3tools/client-runtime/source-control-clients";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestDetail,
  PullRequestListEntry,
  PullRequestRef,
} from "@t3tools/contracts";
import { changeRequestRepositoryUrl } from "@t3tools/shared/changeRequestUrl";
import { useWindowSize } from "@gpuix/react";
import { useState, type ReactNode } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentProjects } from "../state/environment.ts";
import {
  pullRequestEnvironment,
  pullRequestEnvironmentsAtom,
  pullRequestPanel,
  useEnvironmentQuery,
  type PullRequestDetailTab,
  type PullRequestSurface,
} from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem, MenuSeparator, Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { FONTS, LAYOUT, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { openExternalUrl } from "../usage/openExternal.ts";
import {
  loadingPullRequestCheckoutCommand,
  pullRequestCheckoutCommand,
  resolveBaseFreshness,
  resolveDisplayedPullRequestDetail,
  resolvePullRequestDetailChecks,
  resolvePullRequestReferenceHost,
  isPullRequestNotFound,
  latestPullRequestReviewOutcomes,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { PullRequestChecksPopover } from "./PullRequestList.tsx";
import { GhostBar, PullRequestsUnavailableState } from "./PullRequestListStates.tsx";
import { OutlineButton } from "./PullRequestMenus.tsx";
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
import { PullRequestSummaryTab } from "./PullRequestSummaryTab.tsx";
import { PullRequestTimelineTab } from "./PullRequestTimelineTab.tsx";
import { PullRequestCodeTab } from "./PullRequestCodeTab.tsx";

const TABS: ReadonlyArray<{ value: PullRequestDetailTab; label: string }> = [
  { value: "summary", label: "Summary" },
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
  return { detailQuery, activityQuery, activity, sharedSummary, detail };
}

// ── Detail view ─────────────────────────────────────────────────────────

function PullRequestDetailView({
  environmentId,
  surface,
  listEntry,
  refreshToken,
  onSelectPullRequest: _onSelectPullRequest,
}: {
  environmentId: EnvironmentId;
  surface: PullRequestSurface;
  listEntry: PullRequestListEntry | null;
  refreshToken: number;
  onSelectPullRequest: (reference: PullRequestRef) => void;
}) {
  const theme = useTheme();
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const environments = useAtomValue(pullRequestEnvironmentsAtom);
  const project = projects.find(
    (candidate) => candidate.id === surface.projectId && candidate.environmentId === environmentId,
  );
  const repositoryIdentity = project?.repositoryIdentity;
  const capabilities = environments.find((environment) => environment.environmentId === environmentId)
    ?.serverConfig?.environment.capabilities;
  const requestedReference: PullRequestRef = {
    projectId: surface.projectId as PullRequestRef["projectId"],
    repository: surface.repository,
    number: surface.number,
    ...(surface.host ? { host: surface.host } : {}),
  };
  const reference =
    capabilities?.threadPullRequests === true
      ? resolvePullRequestReferenceHost(requestedReference, repositoryIdentity)
      : { projectId: requestedReference.projectId, repository: requestedReference.repository, number: requestedReference.number };
  const matchingListEntry =
    listEntry?.projectId === reference.projectId &&
    listEntry.repository.toLowerCase() === reference.repository.toLowerCase() &&
    (reference.host === undefined || listEntry.host.toLowerCase() === reference.host.toLowerCase()) &&
    listEntry.number === reference.number
      ? listEntry
      : null;
  const tab: PullRequestDetailTab = surface.detailTab ?? "summary";
  const selectTab = (next: PullRequestDetailTab) => pullRequestPanel.setDetailTab(surface.id, next);
  const { detailQuery, activityQuery, activity, sharedSummary, detail } = usePullRequestDetail(
    environmentId,
    reference,
    matchingListEntry,
    capabilities?.pullRequestChecks === true,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [appliedRefreshToken, setAppliedRefreshToken] = useState(refreshToken);
  const refreshDetail = () => {
    detailQuery.refresh();
    activityQuery.refresh();
  };
  if (appliedRefreshToken !== refreshToken) {
    setAppliedRefreshToken(refreshToken);
    refreshDetail();
  }
  const refreshFromHost = async () => {
    setRefreshing(true);
    // Drops the server's cached host reads for this pull request; it writes nothing to the host.
    await runAtomCommand(appAtomRegistry, pullRequestEnvironment.invalidate, {
      environmentId,
      input: { reference },
    });
    setRefreshing(false);
    refreshDetail();
  };
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

  const hostClient = sourceControlClients.get(detail?.provider);
  const openOnHostText =
    hostClient === UNKNOWN_SOURCE_CONTROL_CLIENT ? "Open on host" : `Open on ${hostClient.label}`;
  const repositoryUrl = detail === null ? null : changeRequestRepositoryUrl(detail.url);
  const handoffSummary = detail ?? sharedSummary;
  const checkoutCommand = handoffSummary
    ? pullRequestCheckoutCommand(
        handoffSummary.provider,
        handoffSummary.number,
        handoffSummary.headBranch,
        detail?.headRepositoryNameWithOwner,
        changeRequestRepositoryUrl(handoffSummary.url),
      )
    : loadingPullRequestCheckoutCommand(reference, repositoryIdentity);
  const statePresentation = detail ? resolvePullRequestState({ state: detail.state, isDraft: detail.isDraft }) : null;
  const visibleTabs = TABS.filter((item) => item.value !== "code" || detail === null || detail.capabilities.diff);
  const activityPending = activityQuery.isPending && activity === null;
  const activityError = activity === null ? activityQuery.error : null;
  const detailChecksState = detail ? pullRequestChecksState(detail.checks) : null;
  const checksState =
    detailChecksState !== "failing" && detail?.checks.some((check) => check.status === "action-required")
      ? "pending"
      : detailChecksState;
  const checksSummary = detail ? summarizePullRequestChecks(detail.checks) : "";
  const freshness = detail === null ? null : resolveBaseFreshness(detail);
  const conflicting = handoffSummary?.state === "open" && handoffSummary.mergeability === "conflicting";

  const actions = handoffSummary ? (
    <>
      {conflicting ? <ResolveConflictsButton /> : null}
      <CheckoutMenu />
    </>
  ) : null;

  if (detailQuery.isPending && !detail) {
    return (
      <PullRequestDetailGhost
        seed={matchingListEntry}
        number={reference.number}
        checkoutCommand={checkoutCommand}
        tabs={visibleTabs}
        activeTab={tab}
        actions={actions}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          ...(detail ? { borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6) } : {}),
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 28, gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexGrow: 1, minWidth: 0, paddingLeft: 16 }}>
            {detail && statePresentation ? (
              condensed ? (
                <>
                  <NumberLink number={detail.number} url={detail.url} tone={statePresentation.tone(theme)} label={openOnHostText} />
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
                  <Tooltip content={repositoryUrl ? `Open ${detail.repository} repository` : detail.repository} side="top">
                    <div
                      onClick={repositoryUrl ? () => openExternalUrl(repositoryUrl) : undefined}
                      style={{ display: "flex", minWidth: 0, flexShrink: 1, cursor: repositoryUrl ? "pointer" : "default" }}
                    >
                      <Text size="xs" weight={500} color={theme.mutedForeground} truncate>
                        {detail.repository}
                      </Text>
                    </div>
                  </Tooltip>
                  <NumberLink number={detail.number} url={detail.url} tone={statePresentation.tone(theme)} label={openOnHostText} />
                </>
              )
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, marginRight: 16 }}>
            {detail ? (
              <>
                {actions}
                <ActionsMenu
                  refreshing={refreshing}
                  onRefresh={() => void refreshFromHost()}
                  openOnHostText={openOnHostText}
                  url={detail.url}
                />
              </>
            ) : null}
          </div>
        </div>
        {detail && condensed ? (
          <CondensedMeta detail={detail} freshness={freshness !== null} />
        ) : detail ? (
          <HeaderBody detail={detail} checkoutCommand={checkoutCommand} freshness={freshness} />
        ) : null}
        {detail ? (
          <TabBar tabs={visibleTabs} value={tab} onChange={selectTab}>
            {tab === "summary" ? (
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
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
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
              detail={detail}
              activityPending={activityPending}
              activityError={activityError}
              onRefresh={refreshDetail}
              onScrollTop={onScrollTop}
            />
          ) : tab === "timeline" ? (
            <PullRequestTimelineTab
              detail={detail}
              order={timelineOrder}
              activityPending={activityPending}
              activityError={activityError}
              onRetry={activityQuery.refresh}
              onScrollTop={onScrollTop}
            />
          ) : (
            <PullRequestCodeTab environmentId={environmentId} reference={reference} detail={detail} />
          )
        ) : null}
      </div>
    </div>
  );
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
  checkoutCommand,
  freshness,
}: {
  detail: PullRequestDetailView;
  checkoutCommand: string | null;
  freshness: ReturnType<typeof resolveBaseFreshness>;
}) {
  const theme = useTheme();
  const muted = theme.mutedForeground;
  const mono = { fontFamily: FONTS.mono, fontSize: 12, lineHeight: 16, whiteSpace: "nowrap" as const };
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 4, paddingLeft: 16, paddingRight: 16, paddingBottom: 16, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minHeight: 24, minWidth: 0 }}>
        <Text size="base" weight={600} truncate testId="pr-detail-title" style={{ lineHeight: 22 }}>
          {detail.title}
        </Text>
      </div>
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
        {checkoutCommand ? (
          <div style={{ display: "flex", paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, borderRadius: 4, minWidth: 0 }}>
            <text style={{ ...mono, color: muted, textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>{checkoutCommand}</text>
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, minHeight: 20, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }}>
          <Tooltip
            content={
              freshness
                ? `This branch is out-of-date with ${detail.baseBranch}${
                    freshness.behindBy === null
                      ? ""
                      : ` by ${freshness.behindBy.toLocaleString()} ${freshness.behindBy === 1 ? "commit" : "commits"}`
                  }.`
                : detail.baseBranch
            }
            side="top"
          >
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <text style={{ ...mono, color: freshness ? theme.warningForeground : alpha(muted, 0.7) }}>
                {detail.baseBranch}
              </text>
              {freshness ? <Icon name="triangle-alert" size={14} color={theme.warningForeground} /> : null}
            </div>
          </Tooltip>
          <Icon name="arrow-left" size={14} color={alpha(muted, 0.42)} />
          <div style={{ display: "flex", minWidth: 0, flexShrink: 1, paddingLeft: 4, paddingRight: 4 }}>
            <text style={{ ...mono, color: alpha(muted, 0.7), textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
              {detail.headBranch}
            </text>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, minWidth: 64 }}>
            <Icon name="file-diff" size={14} color={muted} />
            <Text size="xs" color={muted}>
              {`${detail.changedFiles.toLocaleString()} ${detail.changedFiles === 1 ? "file" : "files"}`}
            </Text>
          </div>
          <PullRequestDiffStat additions={detail.additions} deletions={detail.deletions} fontSize={12} />
        </div>
      </div>
    </div>
  );
}

function CondensedMeta({ detail, freshness }: { detail: PullRequestDetailView; freshness: boolean }) {
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
        <text style={{ ...mono, color: freshness ? theme.warningForeground : alpha(muted, 0.65), flexShrink: 0 }}>{detail.baseBranch}</text>
        {freshness ? <Icon name="triangle-alert" size={12} color={theme.warningForeground} /> : null}
        <Icon name="arrow-left" size={12} color={alpha(muted, 0.4)} />
        <text style={{ ...mono, color: alpha(muted, 0.65), textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>{detail.headBranch}</text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="file-diff" size={12} color={muted} />
          <Text size="2xs" color={muted}>
            {detail.changedFiles.toLocaleString()}
          </Text>
        </div>
        <PullRequestDiffStat additions={detail.additions} deletions={detail.deletions} />
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

// ── Header actions ──────────────────────────────────────────────────────

function ResolveConflictsButton() {
  const theme = useTheme();
  return (
    <Tooltip content="Resolving conflicts starts an agent thread, which t3-term does not do yet">
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 24,
          paddingLeft: 7,
          paddingRight: 7,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: alpha(theme.error, 0.32),
          opacity: 0.64,
        }}
      >
        <Icon name="triangle-alert" size={14} color={theme.errorForeground} />
        <Text size="xs" weight={500} color={theme.errorForeground}>
          Resolve conflicts
        </Text>
      </div>
    </Tooltip>
  );
}

function CheckoutMenu() {
  const theme = useTheme();
  return (
    <Menu
      align="end"
      minWidth={260}
      trigger={({ toggle }) => (
        <Tooltip content="Check out this pull request">
          <div style={{ display: "flex" }}>
            <OutlineButton height={24} onClick={toggle} testId="pr-checkout" gap={2} paddingLeft={5} paddingRight={5}>
              <Icon name="git-branch" size={14} color={theme.mutedForeground} />
              <Text size="xs" weight={500}>
                Check out
              </Text>
              <Icon name="chevron-down" size={14} color={theme.mutedForeground} />
            </OutlineButton>
          </div>
        </Tooltip>
      )}
    >
      <MenuItem icon="git-branch" disabled description="Its own folder and thread. Nothing you have open moves.">
        In a separate worktree
      </MenuItem>
      <MenuItem icon="folder-git-2" disabled description="Switches the branch you are working in, like `gh pr checkout`.">
        In this repository
      </MenuItem>
    </Menu>
  );
}

function ActionsMenu({
  refreshing,
  onRefresh,
  openOnHostText,
  url,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  openOnHostText: string;
  url: string;
}) {
  return (
    <Menu
      align="end"
      minWidth={200}
      trigger={({ toggle }) => (
        <Tooltip content={refreshing ? "Refreshing pull request" : "More pull request actions"}>
          <div style={{ display: "flex" }}>
            <IconButton icon={refreshing ? "refresh-cw" : "ellipsis"} size={24} onClick={toggle} testId="pr-actions" />
          </div>
        </Tooltip>
      )}
    >
      <MenuItem icon="refresh-cw" disabled={refreshing} onSelect={onRefresh}>
        Refresh
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="external-link" onSelect={() => openExternalUrl(url)}>
        {openOnHostText}
      </MenuItem>
    </Menu>
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
