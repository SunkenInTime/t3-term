// The pull request rows under the branch row in the thread details card, after
// apps/web/src/components/chat/{ThreadDetailsPrRows.tsx,ThreadDetailsPrRow.tsx} and the
// displayed-PR derivation in BranchToolbarBranchSelector.tsx.
import { runPullRequestWrite } from "../../pullRequests/pullRequestWrites.ts";
import { runPullRequestCheckoutHandoff } from "../../pullRequests/pullRequestHandoffs.ts";
import { resolveDefaultPullRequestMergeMethodFor } from "../../pullRequests/pullRequestMergeDefaults.ts";
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type OrchestrationProjectShell,
  type PullRequestAction,
  type PullRequestRef,
  type ThreadId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import {
  pullRequestListLines,
  resolveThreadPullRequestChains,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { projectIndexAtom, threadEnvironment } from "../../state/environment.ts";
import { openPullRequestSurface, pullRequestEnvironment } from "../../state/gitPullRequests.ts";
import { lastPullRequestMergeMethodAtom } from "../../state/pullRequests.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Dialog, Tooltip } from "../../ui/overlay.tsx";
import { Button } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS } from "../../ui/theme.ts";
import { openExternalUrl } from "../../panels/pr/openExternal.ts";
import {
  ChecksPopover,
  resolvePullRequestState,
} from "../../panels/pr/pullRequestPresentation.tsx";
import {
  linkedPullRequestSnapshotStatus,
  pullRequestReferenceFor,
  useServerCapabilities,
  useThreadPullRequest,
  type ThreadPr,
} from "../../panels/pr/useThreadPullRequest.ts";
import {
  allowedPullRequestMergeMethods,
  classifyPullRequestChecks,
  isPullRequestConflicting,
  pullRequestChecksState,
  resolvePullRequestDetailChecks,
  resolveThreadPanelPullRequestAction,
} from "../../web/components/pullRequest/pullRequestSurface.logic.ts";
import {
  buildFixFindingsHandoff,
  buildResolveConflictsPrompt,
} from "../../web/components/pullRequest/pullRequestDetail.logic.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { readEnvironmentScope } from "../../web/state/session.ts";
import { DetailsLabel, DetailsRow, DetailsSplit, useDetailsTokens } from "./detailsControls.tsx";
import { GrowTooltip } from "./detailsTooltip.tsx";

interface PrRowProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly pr: ThreadPr;
  readonly number: number;
  readonly url: string;
  readonly reference: PullRequestRef | null;
  readonly label: string;
  readonly testId: string;
  readonly onStopWatching?: (() => void) | undefined;
  readonly onActed?: () => void;
}

function openPullRequest(props: Pick<PrRowProps, "environmentId" | "threadId" | "reference" | "url">, external: boolean) {
  if (external || props.reference === null) {
    openExternalUrl(props.url);
    return;
  }
  openPullRequestSurface({ environmentId: props.environmentId, threadId: props.threadId }, props.reference);
}

/** ThreadDetailsPrRow: one PR, as a single row or as a title row plus a meta line. */
function ThreadDetailsPrRow(props: PrRowProps) {
  const { environmentId, pr, number, reference } = props;
  const { theme, separator } = useDetailsTokens();
  const capabilities = useServerCapabilities(environmentId);
  const detailQuery = useEnvironmentQuery(
    reference === null
      ? null
      : pullRequestEnvironment.detail({ environmentId, input: { ...reference, allowStale: false } }),
  );
  const checksQuery = useEnvironmentQuery(
    capabilities.pullRequestChecks && reference !== null && detailQuery.data !== null
      ? pullRequestEnvironment.checks({ environmentId, input: reference })
      : null,
  );
  const detail = resolvePullRequestDetailChecks(
    detailQuery.data,
    checksQuery.data,
    checksQuery.dataUpdatedAt >= detailQuery.dataUpdatedAt,
  );
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  // One hand-off at a time: Fix and Resolve both check the same pull request out.
  const [handoff, setHandoff] = useState<"conflicts" | "findings" | null>(null);

  const rowAction = resolveThreadPanelPullRequestAction(detail);
  if (confirmingMerge && rowAction !== "merge") setConfirmingMerge(false);
  const conflicting = isPullRequestConflicting(detail);
  const checksRollup = detail === null ? null : pullRequestChecksState(detail.checks);
  // web: the project's configured method, then the one last picked anywhere, then the first allowed.
  useAtomValue(lastPullRequestMergeMethodAtom);
  const allowedMergeMethods = allowedPullRequestMergeMethods(detail);
  const mergeMethod =
    reference === null || allowedMergeMethods.length === 0
      ? null
      : resolveDefaultPullRequestMergeMethodFor(environmentId, reference.projectId, allowedMergeMethods);

  const state = detail
    ? resolvePullRequestState(theme, { state: detail.state, isDraft: detail.isDraft })
    : pr
      ? resolvePullRequestState(theme, { state: pr.state, isDraft: pr.isDraft === true })
      : null;
  const icon = (
    <Icon name={state?.icon ?? "git-pull-request-arrow"} size={16} color={state?.color ?? theme.mutedForeground} />
  );
  const shortLabel = sourceControlClients.get(detail?.provider).changeRequest.shortLabel;
  const tooltip = detail
    ? `${shortLabel} #${number} - ${state?.label ?? ""}: ${detail.title} (${detail.baseBranch} ← ${detail.headBranch}, ${detail.changedFiles} ${detail.changedFiles === 1 ? "file" : "files"})`
    : pr && state
      ? `${shortLabel} #${number} - ${state.label}: ${pr.title}`
      : `Pull request #${number}`;

  const perform = async (action: PullRequestAction) => {
    if (reference === null || actionPending) return;
    if (!readEnvironmentScope(environmentId, AuthSourceControlWriteScope)) {
      toast({ type: "error", title: "Action unavailable", description: "This connection cannot change source control." });
      return;
    }
    setActionPending(true);
    // Through the pull request write gate, so a dry run stops this merge/ready too.
    const result = await runPullRequestWrite(pullRequestEnvironment.runAction, {
      environmentId,
      input: { ...reference, action, ...(action === "merge" && mergeMethod ? { mergeMethod } : {}) },
    });
    setActionPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toast({
          type: "error",
          title: action === "merge" ? "Merge failed" : "Pull request action failed",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      return;
    }
    detailQuery.refresh();
    checksQuery.refresh();
    props.onActed?.();
  };

  // web usePullRequestHandoffs.startHandoff: check the branch out in a new worktree and open a
  // thread on it with the task in the composer, for the reader to read over and send.
  const startHandoff = async (kind: "conflicts" | "findings", prompt: string) => {
    if (detail === null || handoff !== null) return;
    if (
      !readEnvironmentScope(environmentId, AuthSourceControlWriteScope) ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    ) {
      toast({ type: "error", title: "Action unavailable", description: "This connection cannot check out branches or start threads." });
      return;
    }
    setHandoff(kind);
    await runPullRequestCheckoutHandoff({
      environmentId,
      projectRef: scopeProjectRef(environmentId, detail.projectId),
      checkoutRoot: detail.workspaceRoot,
      url: detail.url,
      mode: "worktree",
      task: { prompt },
    });
    setHandoff(null);
  };
  const startResolveConflicts = () => {
    if (detail === null) return;
    void startHandoff(
      "conflicts",
      buildResolveConflictsPrompt({ number: detail.number, url: detail.url, headBranch: detail.headBranch, baseBranch: detail.baseBranch }),
    );
  };
  const startFixChecks = () => {
    if (detail === null) return;
    void startHandoff(
      "findings",
      buildFixFindingsHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        reviewThreads: [],
        comments: [],
        checks: detail.checks,
        commentsTruncated: false,
      }).prompt,
    );
  };

  const trailingAction =
    rowAction === "resolve"
      ? { label: handoff === "conflicts" ? "Preparing..." : "Resolve", destructive: true, external: true, tooltip: "Check the branch out and resolve the conflicts in a new thread" }
      : rowAction === "fix"
        ? { label: handoff === "findings" ? "Preparing..." : "Fix", destructive: true, external: true, tooltip: "Fix the failing checks in a new thread" }
        : rowAction === "ready"
          ? { label: actionPending ? "Marking..." : "Ready", destructive: false, external: false, tooltip: "Mark this pull request as ready for review" }
          : rowAction === "merge"
            ? { label: actionPending ? "Merging..." : "Merge", destructive: false, external: false, tooltip: `Merge this pull request (${mergeMethod ?? "merge"})` }
            : null;
  const busy = actionPending || handoff !== null;
  const runTrailing = () => {
    if (busy) return;
    if (rowAction === "resolve") startResolveConflicts();
    else if (rowAction === "fix") startFixChecks();
    else if (rowAction === "ready") void perform("ready");
    else if (rowAction === "merge") setConfirmingMerge(true);
  };

  const watching = props.onStopWatching !== undefined && (detail?.state ?? pr?.state ?? "open") === "open";
  const showChecks = detail !== null && checksRollup !== null && !conflicting && !detail.isDraft;
  const onClick = (event?: { modifiers?: { ctrl?: boolean; cmd?: boolean } }) =>
    openPullRequest(props, event?.modifiers?.ctrl === true || event?.modifiers?.cmd === true);

  const openRow = (text: string, split: boolean) => (
    <GrowTooltip content={tooltip} side="top">
      <div
        testId={split ? `${props.testId}-open` : props.testId}
        onClick={onClick as never}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          height: 32,
          paddingLeft: 10,
          paddingRight: 10,
          minWidth: 0,
          flexGrow: 1,
          flexShrink: 1,
          cursor: "pointer",
          borderRadius: RADIUS.lg,
          ...(split ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : {}),
          hover: { backgroundColor: theme.appearance === "dark" ? "#ffffff14" : "#00000009" },
        }}
      >
        {icon}
        <DetailsLabel>{text}</DetailsLabel>
      </div>
    </GrowTooltip>
  );

  const watchIcon = watching ? (
    <Tooltip content="Watching: the agent wakes when checks finish, someone comments, or the branch conflicts. Click to stop." side="top">
      <WatchControl onStop={props.onStopWatching!} />
    </Tooltip>
  ) : null;

  return (
    <>
      {detail !== null && (showChecks || trailingAction !== null || watching) ? (
        <div style={{ display: "flex", flexDirection: "column", paddingBottom: 8, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", width: "100%" }}>{openRow(detail.title, false)}</div>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 2,
              height: 24,
              marginTop: -4,
              paddingLeft: 36,
              paddingRight: 4,
              minWidth: 0,
            }}
          >
            <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, marginRight: 4, flexShrink: 0 }}>
              {`#${number}`}
            </text>
            {showChecks && checksRollup !== null ? (
              <ChecksPopover checksState={checksRollup} checks={detail.checks} variant="count" testId={`${props.testId}-checks`} />
            ) : null}
            {watchIcon}
            <div style={{ flexGrow: 1 }} />
            {trailingAction ? (
              <Tooltip content={trailingAction.tooltip} side="top">
                <div
                  testId={`${props.testId}-action`}
                  onClick={busy ? undefined : runTrailing}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    height: 24,
                    paddingLeft: 6,
                    paddingRight: 6,
                    borderRadius: RADIUS.sm,
                    cursor: "pointer",
                    opacity: busy ? 0.64 : 1,
                    hover: { backgroundColor: theme.appearance === "dark" ? "#ffffff14" : "#00000009" },
                  }}
                >
                  <text
                    style={{
                      color: trailingAction.destructive ? theme.errorForeground : theme.infoForeground,
                      fontSize: 12,
                      lineHeight: 16,
                      fontWeight: 500,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {trailingAction.label}
                  </text>
                  {trailingAction.external ? (
                    <Icon name="arrow-up-right" size={12} color={trailingAction.destructive ? theme.errorForeground : theme.infoForeground} />
                  ) : null}
                </div>
              </Tooltip>
            ) : null}
          </div>
        </div>
      ) : watching ? (
        <DetailsSplit
          testId={`${props.testId}-split`}
          primary={
            <>
              {icon}
              <DetailsLabel>{props.label}</DetailsLabel>
            </>
          }
          onPrimary={() => openPullRequest(props, false)}
          secondary={
            <>
              <div style={{ width: 1, height: 16, backgroundColor: separator, flexShrink: 0, alignSelf: "center" }} />
              <WatchControl onStop={props.onStopWatching!} square />
            </>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "row", width: "100%", flexShrink: 0 }}>{openRow(props.label, false)}</div>
      )}
      <Dialog
        open={confirmingMerge && rowAction === "merge"}
        onOpenChange={setConfirmingMerge}
        title="Merge pull request?"
        description={`This merges #${number} using ${mergeMethod ?? "merge"}.`}
        width={420}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmingMerge(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={actionPending}
              onClick={() => {
                setConfirmingMerge(false);
                void perform("merge");
              }}
            >
              Merge
            </Button>
          </>
        }
      />
    </>
  );
}

function WatchControl({ onStop, square }: { onStop: () => void; square?: boolean }) {
  const { theme, hover } = useDetailsTokens();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onStop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: square ? 32 : 24,
        height: square ? 32 : 24,
        flexShrink: 0,
        cursor: "pointer",
        borderRadius: square ? 0 : RADIUS.sm,
        ...(square ? { borderTopRightRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg } : {}),
        backgroundColor: hovered ? hover : "#00000000",
      }}
    >
      <Icon name={hovered ? "eye-off" : "eye"} size={square ? 16 : 14} color={theme.mutedForeground} />
    </div>
  );
}

function findProjectOnChangeRequestHost(
  projects: ReadonlyArray<OrchestrationProjectShell>,
  url: string,
): OrchestrationProjectShell | null {
  const parsed = parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const own = projects.find((project) => {
    const identity = project.repositoryIdentity;
    return (
      identity?.provider !== undefined &&
      sourceControlClients.get(identity.provider).isChangeRequestInRepository(identity, parsed)
    );
  });
  if (own) return own;
  return (
    projects.find((project) => {
      const identity = project.repositoryIdentity;
      return (
        identity?.provider !== undefined &&
        sourceControlClients.get(identity.provider).canReadChangeRequestOnHost(identity, parsed)
      );
    }) ?? null
  );
}

/** ThreadDetailsPrLinkRow: one of the thread's other linked PRs, from its snapshot. */
function ThreadDetailsPrLinkRow({
  environmentId,
  threadId,
  link,
  onStopWatching,
  onActed,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  link: ThreadPullRequestLink;
  onStopWatching?: (() => void) | undefined;
  onActed?: () => void;
}) {
  const projectIndex = useAtomValue(projectIndexAtom);
  const capabilities = useServerCapabilities(environmentId);
  const projects = [...projectIndex.entries()]
    .filter(([key]) => key.startsWith(`${environmentId}:`))
    .map(([, project]) => project);
  const project = findProjectOnChangeRequestHost(projects, link.url);
  const linked = linkedPullRequestSnapshotStatus(link);
  return (
    <ThreadDetailsPrRow
      environmentId={environmentId}
      threadId={threadId}
      pr={linked?.pr ?? null}
      number={link.number}
      url={link.url}
      reference={capabilities.pullRequests ? pullRequestReferenceFor(project, link.number, link) : null}
      label={`#${link.number}${link.snapshot === null ? "" : `: ${link.snapshot.title}`}`}
      testId={`details-pr-${link.number}`}
      onStopWatching={onStopWatching}
      {...(onActed ? { onActed } : {})}
    />
  );
}

/**
 * The thread's PR rows: the current PR, then (folded behind "Show N more") the
 * thread's other linked PRs. Renders nothing when the thread has no PR.
 */
export function ThreadDetailsPrSection({
  environmentId,
  threadId,
  gitCwd,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  gitCwd: string | null;
}) {
  const { theme } = useDetailsTokens();
  const resolved = useThreadPullRequest({ environmentId, threadId, gitCwd });
  const [expanded, setExpanded] = useState(false);
  const { number, url, currentLink, displayedPr, links } = resolved;
  if (number === undefined || url === undefined) return null;

  const stopWatching = (link: ThreadPullRequestLink | null) =>
    link?.watch === undefined
      ? undefined
      : () => {
          void runAtomCommand(appAtomRegistry, threadEnvironment.watchPullRequest, {
            environmentId,
            input: { threadId, host: link.host, repository: link.repository, number: link.number, watching: false },
          }).then((result) => {
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toast({ type: "error", title: "Could not stop watching", description: error instanceof Error ? error.message : "An error occurred." });
            }
          });
        };
  const label = `#${number}${displayedPr?.title.trim() ? `: ${displayedPr.title}` : ""}`;
  const currentRow = (
    <ThreadDetailsPrRow
      environmentId={environmentId}
      threadId={threadId}
      pr={displayedPr}
      number={number}
      url={url}
      reference={resolved.reference}
      label={label}
      testId="details-pr"
      onStopWatching={stopWatching(currentLink)}
      onActed={resolved.refreshStatus}
    />
  );
  const rest =
    currentLink === null
      ? []
      : pullRequestListLines(resolveThreadPullRequestChains(visibleThreadPullRequests(links)))
          .map((line) => line.link)
          .filter((link) => threadPullRequestKeyOf(link) !== threadPullRequestKeyOf(currentLink));
  if (rest.length === 0) return currentRow;
  return (
    <>
      {currentRow}
      {expanded
        ? rest.map((link) => (
            <ThreadDetailsPrLinkRow
              key={threadPullRequestKeyOf(link)}
              environmentId={environmentId}
              threadId={threadId}
              link={link}
              onStopWatching={stopWatching(link)}
              onActed={resolved.refreshStatus}
            />
          ))
        : null}
      <DetailsRow testId="details-pr-more" onClick={() => setExpanded(!expanded)}>
        <Icon name={expanded ? "minus" : "plus"} size={16} color={theme.mutedForeground} />
        <DetailsLabel color={theme.mutedForeground}>{expanded ? "Show less" : `Show ${rest.length} more`}</DetailsLabel>
      </DetailsRow>
    </>
  );
}
