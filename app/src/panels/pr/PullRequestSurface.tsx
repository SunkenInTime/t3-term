// Right-panel Pull request surface (apps/web/src/components/pullRequest/ThreadPullRequestsPanel.tsx):
// the thread's pull requests as a list when it has several and none is picked, otherwise one pull
// request drawn by the shared detail view (pullRequests/PullRequestDetailPanel.tsx) in its thread
// context, with every write flow the pull requests page has.
import { useAtom, useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, PullRequestRef, ThreadId, ThreadPullRequestLink } from "@t3tools/contracts";
import {
  pullRequestListLines,
  resolveThreadPullRequestChains,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";

import { PullRequestDetailView } from "../../pullRequests/PullRequestDetailPanel.tsx";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerTargetKey } from "../../state/composer.ts";
import { projectIndexAtom } from "../../state/environment.ts";
import { openPullRequestSurface, pullRequestDetailTabAtom, selectedPullRequestAtom } from "../../state/gitPullRequests.ts";
import type { PullRequestSurface as PullRequestSurfaceTarget } from "../../state/pullRequests.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import { resolvePullRequestState } from "./pullRequestPresentation.tsx";
import { pullRequestReferenceFor, useServerCapabilities, useThreadPullRequest, useThreadShell } from "./useThreadPullRequest.ts";

function hoverWash(theme: Palette) {
  return theme.appearance === "dark" ? alpha("#ffffff", 0.08) : alpha("#000000", 0.035);
}

function CenteredNote({ title, detail }: { title: string; detail?: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingLeft: 24, paddingRight: 24 }}>
      <Text weight={500}>{title}</Text>
      {detail ? (
        <Text size="xs" color={alpha(theme.mutedForeground, 0.8)} style={{ textAlign: "center" }}>
          {detail}
        </Text>
      ) : null}
    </div>
  );
}

function SkeletonBar({ width, height = 12 }: { width: number | "100%"; height?: number }) {
  const theme = useTheme();
  return <div style={{ width, height, borderRadius: height / 2, backgroundColor: alpha(theme.foreground, 0.06), flexShrink: 0 }} />;
}

/** The thread's pull requests, when it has several and none is picked (ThreadPullRequestsPanel). */
function PullRequestList({
  environmentId,
  threadId,
  links,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  links: ReadonlyArray<ThreadPullRequestLink>;
}) {
  const theme = useTheme();
  const projectIndex = useAtomValue(projectIndexAtom);
  const lines = pullRequestListLines(resolveThreadPullRequestChains(visibleThreadPullRequests(links)));
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar, padding: 8 }}>
      <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 8 }}>
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          {`Pull requests (${lines.length})`}
        </Text>
      </div>
      {lines.map(({ link }) => {
        const snapshot = link.snapshot;
        const state = snapshot ? resolvePullRequestState(theme, { state: snapshot.state, isDraft: snapshot.isDraft }) : null;
        const project = [...projectIndex.entries()].find(
          ([key, candidate]) => key.startsWith(`${environmentId}:`) && candidate.repositoryIdentity?.name !== undefined && link.repository.toLowerCase().endsWith(`/${candidate.repositoryIdentity.name.toLowerCase()}`),
        )?.[1];
        return (
          <div
            key={threadPullRequestKeyOf(link)}
            testId={`pr-list-${link.number}`}
            onClick={() => openPullRequestSurface({ environmentId, threadId }, pullRequestReferenceFor(project ?? null, link.number, link))}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: RADIUS.lg, cursor: "pointer", flexShrink: 0, hover: { backgroundColor: hoverWash(theme) } }}
          >
            <Icon name={state?.icon ?? "git-pull-request-arrow"} size={16} color={state?.color ?? theme.mutedForeground} />
            <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>{`#${link.number}`}</Text>
            <Text truncate style={{ flexGrow: 1 }}>
              {snapshot?.title ?? link.url}
            </Text>
            <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
              {link.repository}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

export function PullRequestSurface({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const threadKey = scopedThreadKey({ environmentId, threadId });
  const shell = useThreadShell(environmentId, threadId);
  const projectIndex = useAtomValue(projectIndexAtom);
  const project = shell ? (projectIndex.get(`${environmentId}:${shell.projectId}`) ?? null) : null;
  const gitCwd = shell?.worktreePath ?? project?.workspaceRoot ?? null;
  const resolved = useThreadPullRequest({ environmentId, threadId, gitCwd });
  const selected = useAtomValue(selectedPullRequestAtom(threadKey));
  const capabilities = useServerCapabilities(environmentId);
  const visibleLinks = visibleThreadPullRequests(resolved.links);

  if (!capabilities.known) return <PullRequestDetailGhost />;
  if (!capabilities.pullRequests) {
    return <CenteredNote title="Pull requests unavailable" detail="Update this environment's T3 Code server to browse pull requests." />;
  }
  if (selected === null && visibleLinks.length > 1) {
    return <PullRequestList environmentId={environmentId} threadId={threadId} links={resolved.links} />;
  }
  const reference = selected ?? resolved.reference;
  if (reference === null) {
    return <CenteredNote title="No pull request" detail="This thread is not linked to a pull request yet." />;
  }
  return (
    <ThreadPullRequestDetail
      key={`${threadKey}:${reference.repository}#${reference.number}`}
      environmentId={environmentId}
      threadId={threadId}
      reference={reference}
      onBack={visibleLinks.length > 1 ? () => appAtomRegistry.set(selectedPullRequestAtom(threadKey), null) : undefined}
    />
  );
}

function PullRequestDetailGhost() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <SkeletonBar width={180} />
      <SkeletonBar width={"100%"} height={16} />
      <SkeletonBar width={240} />
      <div style={{ height: 12 }} />
      <SkeletonBar width={"100%"} />
      <SkeletonBar width={"100%"} />
      <SkeletonBar width={320} />
    </div>
  );
}

/**
 * The thread's pull request, drawn by the pull requests page's detail view in its thread context
 * (web renders the same PullRequestDetailPanel with `context: "thread"`): no checkout menu, and
 * hand-offs go to this thread's composer.
 */
function ThreadPullRequestDetail({
  environmentId,
  threadId,
  reference,
  onBack,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  reference: PullRequestRef;
  onBack: (() => void) | undefined;
}) {
  const threadKey = scopedThreadKey({ environmentId, threadId });
  const [tab, setTab] = useAtom(pullRequestDetailTabAtom(threadKey));
  const surface: PullRequestSurfaceTarget = {
    id: `${threadKey}:${reference.projectId}:${reference.repository}#${reference.number}`,
    projectId: reference.projectId,
    repository: reference.repository,
    number: reference.number,
    ...(reference.host ? { host: reference.host } : {}),
    detailTab: tab,
  };
  return (
    <PullRequestDetailView
      environmentId={environmentId}
      surface={surface}
      listEntry={null}
      refreshToken={0}
      context="thread"
      threadRef={{ environmentId, threadId }}
      attachTarget={composerTargetKey({ kind: "thread", environmentId, threadId })}
      onTabChange={setTab}
      {...(onBack ? { onBack } : {})}
      onSelectPullRequest={(next) => openPullRequestSurface({ environmentId, threadId }, next)}
    />
  );
}
