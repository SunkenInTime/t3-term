// The thread title menu, after apps/web/src/hooks/useThreadActionMenu.ts and the
// parts of hooks/useThreadActions.ts it calls. Item building is the ported
// buildThreadActionMenuItems; this file runs the chosen action.
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { requestCustomSnooze } from "../../dialogs/CustomSnoozeDialog.tsx";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { threadRuntimeCanArchive, type EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  canSnooze,
  effectiveSnoozed,
  resolveSnoozePresets,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentServerConfigsAtom, threadEnvironment } from "../../state/environment.ts";
import { routeAtom } from "../../state/ui.ts";
import { toast } from "../../ui/toast.tsx";
import {
  buildThreadActionMenuItems,
  threadActionRequiresOperate,
  type ThreadActionMenuId,
} from "../../web/components/threadActionMenu.logic.ts";
import { readEnvironmentScope } from "../../web/state/session.ts";
import { copyTextToClipboard } from "./osActions.ts";
import { openProjectSettings } from "../../settings/navigation.ts";

function capabilities(environmentId: EnvironmentId) {
  return appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities;
}

function shortTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Sidebar.snooze.ts resolveSnoozePresets: shared presets with a local time label. */
function snoozePresets(now: Date): ReadonlyArray<SnoozePreset> {
  return resolveSnoozePresets(now).map((preset) => {
    const wake = new Date(preset.snoozedUntil);
    if (Number.isNaN(wake.getTime())) return preset;
    return {
      ...preset,
      whenLabel:
        preset.id === "next-week"
          ? `${wake.toLocaleDateString(undefined, { weekday: "short" })} ${shortTime(wake)}`
          : shortTime(wake),
    };
  });
}

export function buildTitleMenu(thread: EnvironmentThreadShell) {
  const now = new Date();
  const caps = capabilities(thread.environmentId);
  const supports = {
    settlement: caps?.threadSettlement === true,
    autoSettleOptOut: caps?.threadAutoSettleOptOut === true,
    snooze: caps?.threadSnooze === true,
    pinning: caps?.threadPinning === true,
    titleRegeneration: caps?.threadTitleRegeneration === true,
  };
  const presets = snoozePresets(now);
  const items = buildThreadActionMenuItems({
    canOperate: readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope),
    branch: thread.branch ?? null,
    projectFilter: null,
    isPinned: thread.pinnedAt != null,
    isSettled: supports.settlement && thread.settledOverride === "settled",
    autoSettleEnabled: thread.autoSettleDisabledAt == null,
    isSnoozed: supports.snooze && effectiveSnoozed(thread, { now: now.toISOString() }),
    canSnoozeNow: canSnooze(thread, { now: now.toISOString() }),
    isRegeneratingTitle: thread.titleRegeneration != null,
    isRunning: !threadRuntimeCanArchive(thread.runtime),
    supports,
    snoozePresets: presets,
  });
  return { items, presets };
}

function failureToast(title: string, error: unknown) {
  toast({ type: "error", title, description: error instanceof Error ? error.message : "An error occurred." });
}

async function reportFailure(title: string, run: () => Promise<AtomCommandResult<unknown, unknown>>) {
  const result = await run();
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    failureToast(title, squashAtomCommandFailure(result));
  }
  return result;
}

function command<I>(cmd: unknown, ref: ScopedThreadRef, input: I) {
  return runAtomCommand(appAtomRegistry, cmd as never, { environmentId: ref.environmentId, input } as never) as Promise<
    AtomCommandResult<unknown, unknown>
  >;
}

async function copy(label: string, value: string, successTitle: string) {
  try {
    await copyTextToClipboard(value);
    toast({ type: "success", title: successTitle, description: value });
  } catch (error) {
    failureToast(`Failed to copy ${label}`, error);
  }
}

export interface ThreadActionContext {
  readonly thread: EnvironmentThreadShell;
  readonly projectCwd: string | null;
  readonly presets: ReadonlyArray<SnoozePreset>;
  readonly onStartRename: () => void;
  /** Asks before archive/delete; resolves true to continue. */
  readonly confirm: (input: { title: string; description?: string; confirmLabel: string; destructive?: boolean }) => Promise<boolean>;
}

export async function runThreadAction(action: ThreadActionMenuId, context: ThreadActionContext): Promise<void> {
  const { thread } = context;
  const ref: ScopedThreadRef = { environmentId: thread.environmentId, threadId: thread.id };
  if (threadActionRequiresOperate(action) && !readEnvironmentScope(ref.environmentId, AuthOrchestrationOperateScope)) {
    failureToast("Thread action unavailable", new Error("This connection cannot change threads."));
    return;
  }
  if (action.startsWith("snooze:")) {
    const preset = context.presets.find((candidate) => `snooze:${candidate.id}` === action);
    // "snooze:custom" asks for a time in CustomSnoozeDialog, like web.
    const snoozedUntil = preset ? preset.snoozedUntil : (await requestCustomSnooze())?.snoozedUntil;
    if (!snoozedUntil) return;
    await reportFailure("Failed to snooze thread", () =>
      command(threadEnvironment.snooze, ref, { threadId: ref.threadId, snoozedUntil }),
    );
    return;
  }
  switch (action) {
    case "new-thread-on-branch":
      // The draft opens in the thread's project; the composer owns branch/worktree seeding.
      appAtomRegistry.set(routeAtom, { kind: "draft", environmentId: ref.environmentId, projectId: thread.projectId });
      return;
    case "project-settings":
      openProjectSettings({ environmentId: ref.environmentId, projectId: thread.projectId });
      return;
    case "settle":
      await reportFailure("Failed to settle thread", () => command(threadEnvironment.settle, ref, { threadId: ref.threadId }));
      return;
    case "unsettle":
      await reportFailure("Failed to un-settle thread", () =>
        command(threadEnvironment.unsettle, ref, { threadId: ref.threadId, reason: "user" }),
      );
      return;
    case "unsnooze":
      await reportFailure("Failed to wake thread", () =>
        command(threadEnvironment.unsnooze, ref, { threadId: ref.threadId, reason: "user" }),
      );
      return;
    case "pin":
      await reportFailure("Failed to pin thread", () => command(threadEnvironment.pin, ref, { threadId: ref.threadId }));
      return;
    case "unpin":
      await reportFailure("Failed to unpin thread", () => command(threadEnvironment.unpin, ref, { threadId: ref.threadId }));
      return;
    case "auto-settle:enabled":
    case "auto-settle:disabled":
      await reportFailure("Failed to update auto-settle", () =>
        command(threadEnvironment.setAutoSettle, ref, { threadId: ref.threadId, enabled: action === "auto-settle:enabled" }),
      );
      return;
    case "rename":
      context.onStartRename();
      return;
    case "regenerate-title":
      if (thread.titleRegeneration != null) return;
      await reportFailure("Failed to regenerate thread title", () =>
        command(threadEnvironment.updateMetadata, ref, { threadId: ref.threadId, regenerateTitle: true }),
      );
      return;
    case "mark-unread":
      await reportFailure("Failed to mark thread unread", () =>
        command(threadEnvironment.markUnread, ref, { threadId: ref.threadId }),
      );
      return;
    case "copy-path": {
      const path = thread.worktreePath ?? context.projectCwd;
      if (!path) {
        toast({ type: "error", title: "Path unavailable", description: "This thread does not have a workspace path to copy." });
        return;
      }
      await copy("path", path, "Path copied");
      return;
    }
    case "copy-branch":
      if (thread.branch) await copy("branch", thread.branch, "Branch copied");
      return;
    case "copy-thread-id":
      await copy("thread ID", thread.id, "Thread ID copied");
      return;
    case "archive": {
      const confirmed = await context.confirm({
        title: `Archive thread "${thread.title}"?`,
        confirmLabel: "Archive",
      });
      if (!confirmed) return;
      const result = await reportFailure("Failed to archive thread", () =>
        command(threadEnvironment.archive, ref, { threadId: ref.threadId }),
      );
      if (result._tag === "Success") {
        appAtomRegistry.set(routeAtom, { kind: "draft", environmentId: ref.environmentId, projectId: thread.projectId });
        toast({
          type: "success",
          title: "Archived",
          description: thread.title,
          action: {
            label: "Undo",
            onClick: () => {
              void reportFailure("Failed to undo archive", () =>
                command(threadEnvironment.unarchive, ref, { threadId: ref.threadId }),
              ).then((undo) => {
                if (undo._tag === "Success") {
                  appAtomRegistry.set(routeAtom, { kind: "thread", environmentId: ref.environmentId, threadId: ref.threadId });
                }
              });
            },
          },
        });
      }
      return;
    }
    case "delete": {
      const confirmed = await context.confirm({
        title: `Delete thread "${thread.title}"?`,
        description: "This permanently clears conversation history for this thread.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) return;
      const result = await reportFailure("Failed to delete thread", () =>
        command(threadEnvironment.delete, ref, { threadId: ref.threadId }),
      );
      if (result._tag === "Success") {
        const route = appAtomRegistry.get(routeAtom);
        if (route.kind === "thread" && scopedThreadKey(route) === scopedThreadKey(ref)) {
          appAtomRegistry.set(routeAtom, { kind: "home" });
        }
      }
      return;
    }
    default:
      return;
  }
}
