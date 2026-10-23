// Port of apps/web/src/components/chat/ComposerTasksBadge.tsx and ComposerActivityStatus.tsx:
// the agent's todo list docked above the composer (a "Tasks · current · 2/5" tab that
// opens a drawer of steps), and the "Loading/Syncing messages..." activity row.
//
// The activity row's spinner is a static loader icon (no repainting animations).
import { memo } from "react";

import { alpha, useTheme } from "../../ui/theme.ts";
import { Icon } from "../../ui/Icon.tsx";
import { formatDuration } from "../../web/session-logic.ts";
import {
  BannerActions,
  BannerAttachment,
  BannerContent,
  BannerCount,
  BannerIcon,
  BannerRoot,
  BannerRow,
  BannerText,
  BannerToggleIcon,
} from "./ComposerBannerParts.tsx";

export interface ComposerTasksProgress {
  readonly step: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly live: boolean;
}

export interface ComposerTaskStep {
  readonly durationMs?: number;
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
}

export type { ThreadSyncPhase } from "../../web/threadSync.ts";
import { threadSyncLabel, type ThreadSyncPhase } from "../../web/threadSync.ts";

const MAX_TASK_SEGMENTS = 10;
/** `@min-[560px]` on the composer: the segment bar only shows on a wide surface. */
const SEGMENTS_MIN_SURFACE_WIDTH = 560;

function keyedTaskSteps(steps: readonly ComposerTaskStep[]) {
  const occurrences = new Map<string, number>();
  return steps.map((step) => {
    const occurrence = occurrences.get(step.step) ?? 0;
    occurrences.set(step.step, occurrence + 1);
    return { key: `${step.step}:${occurrence}`, step };
  });
}

/** One 3px pill per step (2px gaps, w-20), green done, primary running, faint pending. */
function TaskSegments({ steps }: { readonly steps: readonly ComposerTaskStep[] }) {
  const theme = useTheme();
  if (steps.length <= 1 || steps.length > MAX_TASK_SEGMENTS) return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, width: 80, flexShrink: 0 }}>
      {keyedTaskSteps(steps).map(({ key, step }) => (
        <div
          key={key}
          style={{
            height: 3,
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
            borderRadius: 2,
            backgroundColor:
              step.status === "completed"
                ? theme.success
                : step.status === "inProgress"
                  ? theme.primary
                  : alpha(theme.mutedForeground, 0.25),
          }}
        />
      ))}
    </div>
  );
}

function TaskSummary({
  expanded,
  progress,
  steps,
  surfaceWidth,
}: {
  readonly expanded: boolean;
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
  readonly surfaceWidth: number | null;
}) {
  const theme = useTheme();
  return (
    <>
      <BannerIcon name="list-todo" style={{ pointerEvents: "none" }} />
      <BannerContent style={{ pointerEvents: "none" }}>
        <BannerText color={theme.mutedForeground}>Tasks</BannerText>
        <BannerText weight={500} truncate grow color={alpha(theme.foreground, 0.8)} testId="composer-task-current">
          {progress.step}
        </BannerText>
      </BannerContent>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, pointerEvents: "none" }}>
        <BannerCountTone done={progress.completedSteps >= progress.totalSteps}>
          {`${progress.completedSteps}/${progress.totalSteps}`}
        </BannerCountTone>
        {surfaceWidth !== null && surfaceWidth >= SEGMENTS_MIN_SURFACE_WIDTH ? <TaskSegments steps={steps} /> : null}
        <BannerToggleIcon expanded={expanded} />
      </div>
    </>
  );
}

/** ComposerBanner.Count, green once every step is done. */
function BannerCountTone({ done, children }: { readonly done: boolean; readonly children: string }) {
  const theme = useTheme();
  if (!done) return <BannerCount>{children}</BannerCount>;
  return (
    <div style={{ display: "flex", justifyContent: "center", minWidth: 24, flexShrink: 0 }}>
      <BannerText weight={500} color={theme.success}>
        {children}
      </BannerText>
    </div>
  );
}

export const ComposerTasksBadge = memo(function ComposerTasksBadge({
  expanded,
  onToggle,
  placement = "tab",
  progress,
  steps,
  surfaceWidth,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly placement?: "inline" | "tab";
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
  readonly surfaceWidth: number | null;
}) {
  if (progress.totalSteps <= 0) return null;
  const row = (
    <BannerRow onClick={onToggle} testId="composer-tasks-badge" style={{ hover: { opacity: 0.9 } }}>
      <TaskSummary expanded={expanded} progress={progress} steps={steps} surfaceWidth={surfaceWidth} />
    </BannerRow>
  );
  return placement === "inline" ? (
    row
  ) : (
    <BannerRoot density="comfortable" testId="composer-tasks-tab">
      {row}
    </BannerRoot>
  );
});

export const ComposerTasksContent = memo(function ComposerTasksContent({
  expanded,
  onToggle,
  progress,
  steps,
  surfaceWidth,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
  readonly surfaceWidth: number | null;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <ComposerTasksBadge
        expanded={expanded}
        onToggle={onToggle}
        placement="inline"
        progress={progress}
        steps={steps}
        surfaceWidth={surfaceWidth}
      />
      {expanded ? (
        // ComposerBanner.Scroll (max 24rem) around ComposerBanner.Children.
        <div testId="composer-tasks-list" style={{ display: "flex", flexDirection: "column", maxHeight: 384, overflowY: "scroll", minWidth: 0 }}>
          {keyedTaskSteps(steps).map(({ key, step }) => {
            const tone =
              step.status === "completed"
                ? theme.success
                : step.status === "inProgress"
                  ? theme.primary
                  : alpha(theme.mutedForeground, 0.4);
            const textColor =
              step.status === "completed"
                ? alpha(theme.mutedForeground, 0.55)
                : step.status === "inProgress"
                  ? alpha(theme.foreground, 0.9)
                  : alpha(theme.mutedForeground, 0.7);
            return (
              <BannerRow key={key} style={{ alignItems: "flex-start", paddingTop: 4, paddingBottom: 4, paddingRight: 8 }}>
                <BannerIcon style={{ height: 16, minHeight: 16 }}>
                  <Icon
                    name={step.status === "completed" ? "check" : step.status === "inProgress" ? "circle-dot" : "circle"}
                    size={12}
                    color={tone}
                  />
                </BannerIcon>
                <BannerContent>
                  <text style={{ color: textColor, fontSize: 12, lineHeight: 16, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
                    {step.step}
                  </text>
                </BannerContent>
                <BannerActions>
                  <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", width: 48 }}>
                    <BannerText size="3xs" color={alpha(theme.mutedForeground, 0.45)} style={{ lineHeight: 16 }}>
                      {step.durationMs !== undefined
                        ? formatDuration(step.durationMs)
                        : step.status === "inProgress" && progress.live
                          ? "now"
                          : ""}
                    </BannerText>
                  </div>
                </BannerActions>
              </BannerRow>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

export const ComposerTasksDrawer = memo(function ComposerTasksDrawer({
  onCollapse,
  joinedAbove,
  ...props
}: {
  readonly onCollapse: () => void;
  readonly joinedAbove: boolean;
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
  readonly surfaceWidth: number | null;
}) {
  return (
    <BannerAttachment testId="composer-tasks-drawer">
      <BannerRoot joinedAbove={joinedAbove}>
        <ComposerTasksContent {...props} expanded onToggle={onCollapse} />
      </BannerRoot>
    </BannerAttachment>
  );
});

/** web ComposerActivityStatus.tsx ComposerActivityRow + threadSync.ts threadSyncLabel. */
export function ComposerActivityRow({ phase }: { readonly phase: ThreadSyncPhase }) {
  const theme = useTheme();
  return (
    <BannerRow testId={`composer-sync-status-${phase}`}>
      <BannerIcon name="loader-circle" />
      <BannerContent>
        <BannerText color={theme.mutedForeground}>{threadSyncLabel(phase)}</BannerText>
      </BannerContent>
    </BannerRow>
  );
}
