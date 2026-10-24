// Port of apps/web/src/components/pullRequest/PullRequestGuideTab.tsx: the Guide tab. With no guide
// it offers to write one (an agent run on the server, through the write gate); with one it shows
// the tour, under a banner when the guide is stale, failed or being rewritten.
import type { EnvironmentId, PullRequestRef, PullRequestReviewGuideStop } from "@t3tools/contracts";
import { useEffect } from "react";

import {
  guideRunKey,
  guideRunStore,
  nextPendingReviewCommentId,
  pullRequestReviewKey,
  pullRequestReviewStore,
  usePendingReviewComments,
} from "../../state/pullRequests.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import type { ReviewCommentContext } from "../../web/components/pullRequest/pullRequestDetail.deps.ts";
import { PrButton } from "../prControls.tsx";
import type { ExcerptCommenting } from "./GuideParts.tsx";
import { GuideTour } from "./GuideTour.tsx";
import { useReviewGuideWriter } from "./useReviewGuideWriter.ts";

export function PullRequestGuideTab({
  environmentId,
  reference,
  title,
  canComment,
  onAskAboutLines,
  onAskAboutStop,
  onFinishReview,
  onOpenFile,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  title: string | null;
  workspaceRoot: string;
  canComment: boolean;
  onAskAboutLines: ((comment: ReviewCommentContext, request: string) => void) | null;
  onAskAboutStop: ((stop: PullRequestReviewGuideStop, index: number, question: string) => void) | null;
  onFinishReview: (() => void) | null;
  onOpenFile: (path: string) => void;
}) {
  const theme = useTheme();
  const { query, data, running, canWrite, write } = useReviewGuideWriter({ environmentId, reference, title });
  const runKey = guideRunKey(environmentId, reference);
  const reviewKey = pullRequestReviewKey(reference);
  const pending = usePendingReviewComments(reference);
  const commenting: ExcerptCommenting | null =
    !canComment && onAskAboutLines === null
      ? null
      : {
          canComment,
          pending,
          onComment: ({ path, oldPath, position, body }) =>
            pullRequestReviewStore.addComment(reviewKey, {
              id: nextPendingReviewCommentId(),
              path,
              ...(oldPath === null ? {} : { oldPath }),
              position,
              body,
            }),
          onRemove: (commentId) => pullRequestReviewStore.removeComments(reviewKey, [commentId]),
          onAskAgent: onAskAboutLines,
        };
  // The tab on screen tells the run coordinator not to announce a guide the reader is looking at.
  useEffect(() => {
    guideRunStore.setShown(runKey);
    return () => {
      if (guideRunStore.read().shownKey === runKey) guideRunStore.setShown(null);
    };
  }, [runKey]);

  const guide = data?.guide ?? null;
  const runState = data?.run ?? null;
  const currentHeadSha = data?.currentHeadSha ?? null;
  const stale = guide !== null && currentHeadSha !== null && currentHeadSha !== guide.headSha;
  const failure = runState?._tag === "Failed" && runState.headSha === currentHeadSha ? runState.detail : null;
  const writeButton = (label: string, size: "sm" | "xs") =>
    canWrite ? (
      <PrButton size={size} icon={running ? "loader" : "sparkles"} disabled={running} onClick={() => void write()} testId="guide-write">
        {running ? "Reading the change..." : label}
      </PrButton>
    ) : null;

  if (guide === null) {
    if (query.isPending && data === null) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 192 }}>
          <Text size="xs" color={theme.mutedForeground}>
            Loading the review guide...
          </Text>
        </div>
      );
    }
    return (
      <div
        testId="guide-empty"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 192, paddingLeft: 16, paddingRight: 16, paddingTop: 40, paddingBottom: 40 }}
      >
        <Text weight={500}>{running ? "Writing a review guide" : "No review guide yet"}</Text>
        <Text size="xs" color={theme.mutedForeground} style={{ textAlign: "center", maxWidth: 448 }}>
          {failure ??
            query.error ??
            (running
              ? "An agent is reading the change. A large one takes a few minutes. You can leave; you will be told when it is ready."
              : "A guide is a tour of the change: stops through the code in reading order, with the calls only a maintainer can make.")}
        </Text>
        {writeButton(failure === null ? "Write guide" : "Try again", "sm")}
      </div>
    );
  }

  const banner =
    stale || failure !== null || running ? (
      <div
        testId="guide-banner"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 14,
          paddingRight: 10,
          paddingTop: 8,
          paddingBottom: 8,
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: alpha(running ? theme.info : theme.warning, 0.32),
          backgroundColor: alpha(running ? theme.info : theme.warning, 0.08),
        }}
      >
        <Icon name={running ? "loader" : "triangle-alert"} size={16} color={running ? theme.infoForeground : theme.warningForeground} />
        <Text style={{ flexGrow: 1 }}>
          {running ? "Rewriting this guide. You will be told when the new one is ready." : (failure ?? "Written before the latest push.")}
        </Text>
        {!running && canWrite ? writeButton("Rewrite", "xs") : null}
      </div>
    ) : null;

  return (
    <GuideTour
      environmentId={environmentId}
      reference={reference}
      guide={guide}
      banner={banner}
      commenting={commenting}
      onAsk={
        onAskAboutStop === null
          ? null
          : (index, question) => {
              const stop = guide.stops[index];
              if (stop !== undefined) onAskAboutStop(stop, index, question);
            }
      }
      onFinish={onFinishReview}
      onOpenFile={onOpenFile}
    />
  );
}
