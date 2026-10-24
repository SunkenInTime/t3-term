// Ports of apps/web/src/components/pullRequest/guide/{GuideTour,GuideStop}.tsx: a review guide as a
// tour, one stop at a time, with the rail of stops beside it when the panel is wide enough
// (web's @min-[56rem]/guide) and the stop's notes beside the stop when wider still (90rem).
// J and K step through the stops while the tour has focus.
import { letterStopNotes, stepTourPosition, stopFilePaths } from "@t3tools/client-runtime/review-guide-tour";
import type {
  EnvironmentId,
  PullRequestRef,
  PullRequestReviewGuide,
  PullRequestReviewGuideAttention,
  PullRequestReviewGuideStop,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import type { DiffFileModel } from "../../panels/diff/diffModel.ts";
import { guideProgressKey, guideRunKey, guideRunStore, useGuideProgress, type GuideProgress } from "../../state/pullRequests.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Kbd, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { PrButton } from "../prControls.tsx";
import { PullRequestDiffStat } from "../pullRequestPresentation.tsx";
import { FileEntryIcon } from "../../panels/files/FileEntryIcon.tsx";
import {
  GuideExcerpt,
  GuideFileDiff,
  GuideNotes,
  GuideProse,
  GuideRail,
  type ExcerptCommenting,
} from "./GuideParts.tsx";
import { useGuideDiffFiles } from "./guideDiff.ts";

const ATTENTION_LABELS = {
  tradeoff: "A tradeoff to weigh",
  contract: "A contract to check",
  product: "A product call",
  risk: "A risk to judge",
  accessibility: "An accessibility call",
} as const satisfies Record<PullRequestReviewGuideAttention["kind"], string>;

/** 56rem and 90rem at a 16px root. */
const RAIL_WIDTH = 896;
const NOTES_WIDTH = 1440;

function SquareButton({ icon, label, disabled, onClick, testId }: { icon: "chevron-up" | "chevron-down"; label: string; disabled: boolean; onClick: () => void; testId: string }) {
  const theme = useTheme();
  return (
    <Tooltip content={label}>
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: alpha(theme.input, 0.32),
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: alpha(theme.input, 0.64) } }),
      }}
    >
      <Icon name={icon} size={14} color={theme.mutedForeground} />
    </div>
    </Tooltip>
  );
}

function OtherFileRow({ path, note, diff, loading }: { path: string; note: string | undefined; diff: DiffFileModel | undefined; loading: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        testId={`guide-file-${path}`}
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 8,
          paddingBottom: 8,
          cursor: "pointer",
          hover: { backgroundColor: alpha(theme.accent, 0.5) },
        }}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={theme.mutedForeground} />
        <FileEntryIcon pathValue={path} kind="file" size={14} />
        <Text size="xs" mono truncate style={{ flexShrink: 1 }}>
          {path}
        </Text>
        <div style={{ flexGrow: 1 }} />
        {note !== undefined && note.trim() !== "" ? (
          <Text size="xs" color={theme.mutedForeground} truncate style={{ flexShrink: 1 }}>
            {note}
          </Text>
        ) : null}
        {diff !== undefined ? <PullRequestDiffStat additions={diff.additions} deletions={diff.deletions} /> : null}
      </div>
      {open ? (
        diff !== undefined ? (
          <GuideFileDiff file={diff} />
        ) : (
          <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
            <Text size="xs" color={theme.mutedForeground}>
              {loading ? "Loading the diff..." : "This file is not in the loaded diff."}
            </Text>
          </div>
        )
      ) : null}
    </div>
  );
}

function GuideStop({
  stop,
  index,
  stopCount,
  wide,
  notesBeside,
  railOpen,
  onRailOpenChange,
  stopList,
  nextTitle,
  files,
  diffLoading,
  commenting,
  onStep,
  onAsk,
  onFinish,
  onOpenFile,
}: {
  stop: PullRequestReviewGuideStop;
  index: number;
  stopCount: number;
  wide: boolean;
  notesBeside: boolean;
  railOpen: boolean;
  onRailOpenChange: (open: boolean) => void;
  stopList: ReactNode;
  nextTitle: string | null;
  files: ReadonlyMap<string, DiffFileModel>;
  diffLoading: boolean;
  commenting: ExcerptCommenting | null;
  onStep: (delta: 1 | -1) => void;
  onAsk: ((question: string) => void) | null;
  onFinish: (() => void) | null;
  onOpenFile: (path: string) => void;
}) {
  const theme = useTheme();
  const { lettered, byExcerpt } = letterStopNotes(stop);
  const excerptPaths = new Set(stop.excerpts.map((excerpt) => excerpt.path));
  const otherFiles = stop.files.filter((file) => !excerptPaths.has(file.path));
  const hasNotes = lettered.length > 0;
  const article = (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0, flexGrow: 1 }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {wide ? (
            <Text size="xs" color={theme.mutedForeground}>{`Stop ${index + 1} of ${stopCount}`}</Text>
          ) : (
            <PrButton
              variant="ghost-muted"
              onClick={() => onRailOpenChange(!railOpen)}
              trailingIcon={railOpen ? "chevron-up" : "chevron-down"}
              testId="guide-stop-list"
            >
              {`Stop ${index + 1} of ${stopCount}`}
            </PrButton>
          )}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
            <SquareButton icon="chevron-up" label="Previous stop" disabled={index === 0} onClick={() => onStep(-1)} testId="guide-prev" />
            <SquareButton icon="chevron-down" label="Next stop" disabled={index === stopCount - 1} onClick={() => onStep(1)} testId="guide-next" />
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 4 }}>
              <Kbd>J</Kbd>
              <Kbd>K</Kbd>
            </div>
          </div>
        </div>
        {!wide && railOpen ? <div style={{ display: "flex", paddingTop: 12 }}>{stopList}</div> : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 960 }}>
        <Text size="lg" weight={600}>
          {stop.title}
        </Text>
        {stop.summary.trim() !== "" ? <GuideProse text={stop.summary} /> : null}
      </div>

      {stop.attention !== null ? (
        <div
          testId="guide-attention"
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 10,
            paddingLeft: 14,
            paddingRight: 14,
            paddingTop: 12,
            paddingBottom: 12,
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.card,
          }}
        >
          <div style={{ display: "flex", marginTop: 2 }}>
            <Icon name="eye" size={16} color={theme.foreground} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flexGrow: 1 }}>
            <Text weight={500}>{ATTENTION_LABELS[stop.attention.kind]}</Text>
            <GuideProse text={stop.attention.note} />
          </div>
        </div>
      ) : null}

      {stop.excerpts.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {stop.excerpts.map((excerpt, excerptIndex) => (
            <GuideExcerpt
              key={`${excerpt.path}:${excerpt.side}:${excerpt.start}-${excerpt.end}`}
              excerpt={excerpt}
              file={files.get(excerpt.path) ?? null}
              loading={diffLoading}
              notes={byExcerpt[excerptIndex] ?? []}
              commenting={commenting}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
      {notesBeside ? null : <GuideNotes notes={lettered} />}

      {otherFiles.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Text size="xs" weight={500} color={theme.mutedForeground}>
            {stop.excerpts.length > 0 ? "Also in this stop" : "Files in this stop"}
          </Text>
          <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.lg, borderWidth: 1, borderColor: alpha(theme.border, 0.6), overflow: "hidden" }}>
            {otherFiles.map((file, fileIndex) => (
              <div key={file.path} style={{ display: "flex", flexDirection: "column", ...(fileIndex > 0 ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) } : {}) }}>
                <OtherFileRow path={file.path} note={file.note} diff={files.get(file.path)} loading={diffLoading} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {stop.questions.length > 0 || onAsk !== null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {stop.questions.length > 0 ? (
            <Text size="xs" weight={500} color={theme.mutedForeground}>
              Questions to consider
            </Text>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            {stop.questions.map((question) =>
              onAsk === null ? (
                <GuideProse key={question} text={question} />
              ) : (
                <div
                  key={question}
                  testId="guide-question"
                  onClick={() => onAsk(question)}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 8,
                    minWidth: 0,
                    paddingLeft: 12,
                    paddingRight: 12,
                    paddingTop: 6,
                    paddingBottom: 6,
                    borderRadius: RADIUS.lg,
                    borderWidth: 1,
                    borderColor: alpha(theme.border, 0.6),
                    cursor: "pointer",
                    hover: { backgroundColor: alpha(theme.accent, 0.5) },
                  }}
                >
                  <div style={{ display: "flex", marginTop: 3 }}>
                    <Icon name="message-circle-question" size={14} color={theme.mutedForeground} />
                  </div>
                  <GuideProse text={question} plain />
                </div>
              ),
            )}
            {onAsk !== null ? (
              <PrButton size="sm" variant="ghost-muted" icon="message-circle-question" onClick={() => onAsk("")} testId="guide-ask">
                Ask about this stop
              </PrButton>
            ) : null}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 12, paddingTop: 16, borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
        {nextTitle !== null ? (
          <PrButton size="sm" variant="default" trailingIcon="arrow-right" onClick={() => onStep(1)} testId="guide-next-stop" style={{ maxWidth: "100%" }}>
            <Text weight={500} color={theme.primaryForeground} truncate>{`Next: ${nextTitle}`}</Text>
          </PrButton>
        ) : onFinish !== null ? (
          <PrButton size="sm" variant="default" icon="message-square" onClick={onFinish} testId="guide-finish">
            Finish review
          </PrButton>
        ) : null}
      </div>
    </div>
  );
  if (!hasNotes || !notesBeside) return article;
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 32, alignItems: "flex-start" }}>
      {article}
      <div style={{ display: "flex", width: 320, flexShrink: 0 }}>
        <GuideNotes notes={lettered} />
      </div>
    </div>
  );
}

export function GuideTour({
  environmentId,
  reference,
  guide,
  banner,
  commenting,
  onAsk,
  onFinish,
  onOpenFile,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  guide: PullRequestReviewGuide;
  banner: ReactNode;
  commenting: ExcerptCommenting | null;
  onAsk: ((stop: number, question: string) => void) | null;
  onFinish: (() => void) | null;
  onOpenFile: (path: string) => void;
}) {
  const theme = useTheme();
  const key = guideProgressKey(guideRunKey(environmentId, reference), guide.headSha);
  const tour = useGuideProgress(key);
  const update = (change: (current: GuideProgress) => Partial<GuideProgress>) =>
    guideRunStore.setProgress(key, (current) => ({ ...current, ...change(current) }));
  const [railOpen, setRailOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const [scrollNonce, setScrollNonce] = useState(0);
  const stopCount = guide.stops.length;
  const position = Math.max(Math.min(tour.position, stopCount - 1), 0);
  const stop = guide.stops[position] ?? null;
  const diff = useGuideDiffFiles({
    environmentId,
    reference,
    headSha: guide.headSha,
    wantedPaths: stop === null ? [] : stopFilePaths(stop),
  });
  const goTo = (next: number) => {
    update((current) => ({
      position: next,
      seen: next > position ? new Set(current.seen).add(position) : current.seen,
    }));
    setRailOpen(false);
    setScrollNonce((value) => value + 1);
  };
  const step = (delta: 1 | -1) => goTo(stepTourPosition(position, delta, stopCount));
  const wide = width >= RAIL_WIDTH;
  const rail = (showCount: boolean) => (
    <GuideRail stops={guide.stops} position={position} seen={tour.seen} onSelect={goTo} showCount={showCount} />
  );
  return (
    <div
      testId="guide-tour"
      key={scrollNonce}
      tabIndex={0}
      onKeyDown={(event) => {
        const modifiers = (event.modifiers ?? {}) as { ctrl?: boolean; cmd?: boolean; alt?: boolean; shift?: boolean };
        if (modifiers.ctrl || modifiers.cmd || modifiers.alt || modifiers.shift) return;
        if (event.key !== "j" && event.key !== "k") return;
        step(event.key === "j" ? 1 : -1);
      }}
      onLayout={(event) => {
        const next = Math.round(Number(event.width ?? 0));
        if (next !== width) setWidth(next);
      }}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: width >= NOTES_WIDTH ? 32 : 24,
          paddingLeft: width >= NOTES_WIDTH ? 24 : 16,
          paddingRight: width >= NOTES_WIDTH ? 24 : 16,
          paddingTop: 16,
          paddingBottom: 64,
          maxWidth: 1600,
          width: "100%",
          alignSelf: "center",
          flexShrink: 0,
        }}
      >
        {wide ? <div style={{ display: "flex", width: 256, flexShrink: 0 }}>{rail(true)}</div> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, flexGrow: 1, minWidth: 0 }}>
          {banner}
          {diff.error !== null ? (
            <Text size="xs" color={theme.mutedForeground}>{`The diff could not be loaded, so excerpts are missing: ${diff.error}`}</Text>
          ) : null}
          {stop === null ? (
            <Text color={theme.mutedForeground}>This change has no files to tour.</Text>
          ) : (
            <GuideStop
              key={position}
              stop={stop}
              index={position}
              stopCount={stopCount}
              wide={wide}
              notesBeside={width >= NOTES_WIDTH}
              railOpen={railOpen}
              onRailOpenChange={setRailOpen}
              stopList={rail(false)}
              nextTitle={guide.stops[position + 1]?.title ?? null}
              files={diff.files}
              diffLoading={diff.loading}
              commenting={commenting}
              onStep={step}
              onAsk={onAsk === null ? null : (question) => onAsk(position, question)}
              onFinish={
                onFinish === null
                  ? null
                  : () => {
                      update((current) => ({ seen: new Set(current.seen).add(position) }));
                      onFinish();
                    }
              }
              onOpenFile={onOpenFile}
            />
          )}
        </div>
      </div>
    </div>
  );
}
