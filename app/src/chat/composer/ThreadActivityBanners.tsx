// Port of apps/web/src/components/chat/ThreadActivityBanners.tsx: the composer notices
// for subagents waiting on the user, the provider goal, background work the provider
// still runs, and a local checkout that moved off the thread's branch.
//
// The background-work dot pulses on web while the work waits (motion-safe:animate-status-pulse);
// t3-term draws it static, since continuous animations are off-limits.
import type { OrchestrationV2PendingBackgroundTask, OrchestrationV2ProviderGoal, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { presentPendingBackgroundWork, presentProviderGoal } from "@t3tools/client-runtime/state/thread-execution";
import { childThreadInputsTitle } from "@t3tools/client-runtime/state/threads";

import { Tooltip } from "../../ui/overlay.tsx";
import { Button } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { BannerText, InlineButton, useBannerIconColumn } from "./ComposerBannerParts.tsx";
import type { ComposerBannerStackItem } from "./ComposerBannerStack.tsx";
import { BannerGlyph } from "./useSystemComposerBanners.tsx";

/** A description made of inline pieces: plain text runs and inline buttons, wrapping as one line would. */
function InlineList({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 4,
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

function MutedText({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <BannerText color={theme.mutedForeground}>{children}</BannerText>;
}

/** Subagents waiting on the user, unless the parent is itself waiting on them. */
export function childInputBannerItem(input: {
  readonly childThreadInputs: ReadonlyArray<EnvironmentThreadShell>;
  readonly parentAwaitingUser: boolean;
  readonly onOpenThread: (threadId: ThreadId) => void;
}): ComposerBannerStackItem | null {
  const { childThreadInputs, onOpenThread } = input;
  const first = childThreadInputs[0];
  if (!first || input.parentAwaitingUser) return null;
  return {
    id: `child-input:${first.id}`,
    variant: "info",
    priority: "activity",
    icon: <BannerGlyph name={first.hasPendingApprovals ? "shield-question" : "message-circle"} />,
    title: childThreadInputsTitle(childThreadInputs),
    description: (
      <InlineList>
        {childThreadInputs.map((child, index) => (
          <div key={child.id} style={{ display: "flex", flexDirection: "row", minWidth: 0 }}>
            <InlineButton tone="muted" truncate onClick={() => onOpenThread(child.id)} testId={`child-input-open-${index}`}>
              {child.title}
            </InlineButton>
            {index < childThreadInputs.length - 1 ? <MutedText>,</MutedText> : null}
          </div>
        ))}
      </InlineList>
    ),
    actions: (
      <Button size="xs" variant="ghost" testId="child-input-open" onClick={() => onOpenThread(first.id)}>
        {first.hasPendingApprovals ? "Open approval" : "Open question"}
      </Button>
    ),
  };
}

export function goalBannerItem(input: {
  readonly threadId: ThreadId;
  readonly goal: OrchestrationV2ProviderGoal;
  readonly isWorking: boolean;
  readonly onSendCommand: (text: string, failureMessage: string) => Promise<void>;
}): ComposerBannerStackItem {
  const { isWorking, onSendCommand } = input;
  const presentation = presentProviderGoal(input.goal, isWorking);
  return {
    id: `goal:${input.threadId}`,
    variant: "default",
    priority: "activity",
    icon: <BannerGlyph name="target" />,
    title: presentation.usage === null ? presentation.title : `${presentation.title} · ${presentation.usage}`,
    description: presentation.objective,
    actions: isWorking ? undefined : (
      <>
        {presentation.canResume ? (
          <Button
            size="xs"
            variant="ghost"
            testId="goal-resume"
            onClick={() => void onSendCommand("/goal resume", "Failed to resume goal.")}
          >
            Resume
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          testId="goal-clear"
          onClick={() => void onSendCommand("/goal clear", "Failed to clear goal.")}
        >
          Clear
        </Button>
      </>
    ),
  };
}

function StatusDot() {
  const theme = useTheme();
  return <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.foreground }} />;
}

export function backgroundWorkBannerItem(input: {
  readonly threadId: ThreadId;
  readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
  readonly stopDisabled: boolean;
  readonly stopping: boolean;
  readonly onStop: () => Promise<void>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}): ComposerBannerStackItem | null {
  const { onOpenThread } = input;
  const presentation = presentPendingBackgroundWork(input.tasks);
  if (presentation === null) return null;
  const single = presentation.items.length === 1;
  return {
    id: `background-work:${input.threadId}`,
    variant: "default",
    priority: "activity",
    icon: <StatusDot />,
    title: presentation.title,
    description:
      single && presentation.items[0]?.childThreadId === undefined ? undefined : (
        <InlineList>
          {presentation.items.map((item, index) => {
            const childThreadId = item.childThreadId;
            const separator = index < presentation.items.length - 1 ? <MutedText>,</MutedText> : null;
            return (
              <div key={item.taskId} style={{ display: "flex", flexDirection: "row", minWidth: 0 }}>
                {childThreadId === undefined ? (
                  <MutedText>{item.label}</MutedText>
                ) : (
                  <InlineButton
                    tone="muted"
                    truncate
                    testId={`background-work-open-${index}`}
                    onClick={() => onOpenThread(childThreadId)}
                  >
                    {single ? "Show" : item.label}
                  </InlineButton>
                )}
                {separator}
              </div>
            );
          })}
        </InlineList>
      ),
    actions: (
      <Button
        size="xs"
        variant="ghost"
        testId="background-work-stop"
        disabled={input.stopDisabled}
        onClick={() => void input.onStop()}
      >
        {input.stopping ? "Stopping..." : "Stop"}
      </Button>
    ),
  };
}

function BranchChangedTitle({ mismatch }: { readonly mismatch: { readonly threadBranch: string; readonly currentBranch: string } }) {
  const theme = useTheme();
  const lineHeight = useBannerIconColumn();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>
      <BannerText color={theme.mutedForeground} style={{ lineHeight }}>
        Branch changed from
      </BannerText>
      <Tooltip
        content={`This thread last ran on ${mismatch.threadBranch}. Sending will continue on ${mismatch.currentBranch}.`}
        side="top"
      >
        <div testId="branch-mismatch-branch" style={{ display: "flex", minWidth: 0, flexShrink: 1 }}>
          <BannerText mono weight={500} truncate style={{ lineHeight }}>
            {mismatch.threadBranch}
          </BannerText>
        </div>
      </Tooltip>
    </div>
  );
}

/** The local checkout moved off the branch this thread last ran on. */
export function branchMismatchBannerItem(input: {
  readonly mismatchKey: string;
  readonly mismatch: { readonly threadBranch: string; readonly currentBranch: string };
  readonly restoreDisabled: boolean;
  readonly restoring: boolean;
  readonly onRestore: () => void;
  readonly onDismiss: () => void;
}): ComposerBannerStackItem {
  return {
    id: `branch-mismatch:${input.mismatchKey}`,
    variant: "info",
    icon: <BannerGlyph name="git-branch" />,
    title: <BranchChangedTitle mismatch={input.mismatch} />,
    actions: (
      <Button size="xs" variant="ghost" testId="branch-mismatch-restore" disabled={input.restoreDisabled} onClick={input.onRestore}>
        {input.restoring ? "Restoring..." : "Restore branch"}
      </Button>
    ),
    dismissLabel: "Dismiss branch change notice",
    onDismiss: input.onDismiss,
  };
}
