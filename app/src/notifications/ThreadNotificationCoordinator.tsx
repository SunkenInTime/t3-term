// apps/web/src/components/ThreadNotificationCoordinator.tsx: watches every
// thread for a finished run or a new request for the user (approval, input,
// failure, usage limit), then plays a sound, shows an in-app toast when the user
// is here on another thread, or raises a desktop notification when they're away.
// Desktop notifications are kept per thread tag: a new one for the same thread
// replaces the old, clicking one brings t3-term forward on that thread, and
// coming back to t3-term closes them all. The outstanding count goes in the
// window title (web's badge), which terminals show via OSC 2.
import { useAtomValue } from "@effect/atom-react";
import { useGpuixRequired } from "@gpuix/react";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { type PendingSubagentRequest, presentThreadShell } from "@t3tools/client-runtime/state/models";
import { pendingSubagentRequestsByThread } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useRef } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { getClientSettings, useClientSettings } from "../state/clientSettings.ts";
import { environmentCatalog, environmentShell } from "../state/environment.ts";
import { routeAtom } from "../state/ui.ts";
import { dismissToast, toast } from "../ui/toast.tsx";
import { useTheme } from "../ui/theme.ts";
import { resolveSidebarThreadStatus } from "../web/components/Sidebar.logic.ts";
import { onAppFocusChange } from "./focus.ts";
import { type DesktopNotificationHandle, playNotificationSound, showDesktopNotification, userIsPresent } from "./platform.ts";

type NotificationMode = ReturnType<typeof getClientSettings>["notificationMode"];

const hasSound = (mode: NotificationMode) => mode === "sound" || mode === "notifications-and-sound";
const hasDesktop = (mode: NotificationMode) => mode === "notifications" || mode === "notifications-and-sound";

const WINDOW_TITLE = "T3 Code";

/** web threadNotificationTag. */
function threadNotificationTag(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `${environmentId}:${threadId}`;
}

export interface ThreadNotificationEvent {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly kind: "completion" | "input";
  readonly status: string;
}

function notificationTitle(event: ThreadNotificationEvent): string {
  return event.kind === "completion"
    ? "Thread completed"
    : event.status === "approval"
      ? "Approval needed"
      : event.status === "limited"
        ? "Usage limit reached"
        : event.status === "failed"
          ? "Thread failed"
          : "Input needed";
}

export function ThreadNotificationCoordinator() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inApp = useClientSettings((settings) => settings.inAppNotificationsEnabled);
  const renderer = useGpuixRequired();
  const theme = useTheme();
  const pending = useRef(new Map<string, { environmentId: EnvironmentId; handle: DesktopNotificationHandle }>());
  const environmentIds = [...enabledEnvironmentIds(catalog)];
  const environmentKey = environmentIds.join("\n");

  const setBadge = () => {
    const count = pending.current.size;
    renderer.setWindowTitle?.(count > 0 ? `(${count > 9 ? "9+" : count}) ${WINDOW_TITLE}` : WINDOW_TITLE);
  };

  // web: a removed environment takes its notifications with it.
  useEffect(() => {
    const active = new Set(environmentIds);
    const before = pending.current.size;
    for (const [tag, entry] of pending.current) {
      if (active.has(entry.environmentId)) continue;
      entry.handle.close();
      pending.current.delete(tag);
    }
    if (before !== pending.current.size) setBadge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentKey]);

  // web: window focus closes every outstanding notification and clears the badge.
  useEffect(() => {
    const clear = () => {
      for (const { handle } of pending.current.values()) handle.close();
      pending.current.clear();
      setBadge();
    };
    clear();
    const unsubscribe = onAppFocusChange((focused) => {
      if (focused) clear();
    });
    return () => {
      unsubscribe();
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const openThread = (environmentId: EnvironmentId, threadId: ThreadId) =>
    appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId });

  const notify = (event: ThreadNotificationEvent) => {
    const { environmentId, threadId } = event;
    const title = notificationTitle(event);
    if (hasSound(mode)) playNotificationSound(event.kind);
    const route = appAtomRegistry.get(routeAtom);
    const viewingThread = route.kind === "thread" && route.environmentId === environmentId && route.threadId === threadId;
    if (inApp && userIsPresent() && !viewingThread) {
      const id = toast({
        type: event.kind === "completion" ? "success" : event.status === "failed" ? "error" : "warning",
        title,
        description: event.threadTitle,
        leadingIcon:
          event.kind === "completion"
            ? { name: "circle-check", color: theme.successForeground }
            : event.status === "approval"
              ? { name: "shield-question", color: theme.warningForeground }
              : event.status === "failed"
                ? { name: "circle-alert", color: theme.errorForeground }
                : { name: "message-circle-question", color: theme.infoForeground },
        actionLayout: "inline",
        action: {
          label: "Open thread",
          onClick: () => {
            dismissToast(id);
            openThread(environmentId, threadId);
          },
        },
      });
      return;
    }
    if (!hasDesktop(mode) || userIsPresent()) return;
    const tag = threadNotificationTag(environmentId, threadId);
    pending.current.get(tag)?.handle.close();
    pending.current.delete(tag);
    const handle = showDesktopNotification(title, event.threadTitle, {
      tag,
      onActivate: () => {
        // web: close the notification, focus the window, open the thread.
        if (pending.current.get(tag)?.handle === handle) pending.current.delete(tag);
        setBadge();
        renderer.activateWindow?.();
        openThread(environmentId, threadId);
      },
      onGone: () => {
        if (pending.current.get(tag)?.handle !== handle) return;
        pending.current.delete(tag);
        setBadge();
      },
    });
    if (!handle) return;
    pending.current.set(tag, { environmentId, handle });
    setBadge();
  };
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useDevNotificationTrigger(environmentIds, notifyRef);

  if (mode === "off" && !inApp) return null;
  return environmentIds.map((environmentId) => (
    <EnvironmentNotifications key={environmentId} environmentId={environmentId} onNotify={(event) => notifyRef.current(event)} />
  ));
}

interface NotificationState {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly attention: string | null;
  readonly completion: number | null;
}

function EnvironmentNotifications({
  environmentId,
  onNotify,
}: {
  environmentId: EnvironmentId;
  onNotify: (event: ThreadNotificationEvent) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const threads = shell.status === "live" && Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : null;
  const previous = useRef(new Map<ThreadId, NotificationState>());
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  useEffect(() => {
    if (threads === null) {
      previous.current.clear();
      return;
    }
    const next = new Map<ThreadId, NotificationState>();
    const subagentRequests = pendingSubagentRequestsByThread(threads);
    for (const rawThread of threads) {
      if (rawThread.lineage.relationshipToParent === "subagent") continue;
      const prior = previous.current.get(rawThread.id);
      const subagentRequest = subagentRequests.get(rawThread.id) ?? null;
      if (prior?.raw === rawThread && prior.subagentRequest === subagentRequest) {
        next.set(rawThread.id, prior);
        continue;
      }
      const thread = presentThreadShell(environmentId, rawThread, subagentRequest);
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestRun?.status === "failed") status = "failed";
      const attention =
        status === "input" || status === "approval" || status === "failed" || status === "limited"
          ? `${thread.latestRun?.runId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
      const completion =
        status === "ready" && thread.latestRun?.status === "completed" && Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { raw: rawThread, subagentRequest, attention, completion });
      if (!prior || thread.archivedAt !== null) continue;
      const kind =
        attention && attention !== prior.attention
          ? "input"
          : !rawThread.latestRunStopRequested &&
              completion !== null &&
              (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (!kind) continue;
      onNotifyRef.current({ environmentId, threadId: thread.id, threadTitle: thread.title, kind, status });
    }
    previous.current = next;
  }, [environmentId, threads]);

  return null;
}

/**
 * Dev only, inert unless T3TERM_DEV_NOTIFY=<seconds> is set: that many seconds
 * after launch, raise a "Thread completed" notification through the real path
 * above (presence check, in-app toast or desktop notification) for
 * T3TERM_DEV_NOTIFY_THREAD, or else the first thread that is not open. It lets
 * click-to-reopen be tested without starting an agent run.
 */
function useDevNotificationTrigger(environmentIds: ReadonlyArray<EnvironmentId>, notifyRef: { current: (event: ThreadNotificationEvent) => void }) {
  const delaySeconds = Number(process.env.T3TERM_DEV_NOTIFY ?? "");
  const firstEnvironment = environmentIds[0] ?? null;
  useEffect(() => {
    if (!Number.isFinite(delaySeconds) || delaySeconds <= 0 || firstEnvironment === null) return;
    const timer = setTimeout(() => {
      const route = appAtomRegistry.get(routeAtom);
      const wanted = process.env.T3TERM_DEV_NOTIFY_THREAD?.trim();
      for (const environmentId of environmentIds) {
        const shell = appAtomRegistry.get(environmentShell.stateValueAtom(environmentId));
        if (shell.status !== "live" || Option.isNone(shell.snapshot)) continue;
        const thread = shell.snapshot.value.threads.find((candidate) =>
          wanted
            ? candidate.id === wanted
            : candidate.archivedAt === null &&
              candidate.lineage.relationshipToParent !== "subagent" &&
              !(route.kind === "thread" && route.threadId === candidate.id),
        );
        if (!thread) continue;
        notifyRef.current({ environmentId, threadId: thread.id, threadTitle: thread.title, kind: "completion", status: "ready" });
        return;
      }
    }, delaySeconds * 1000);
    return () => clearTimeout(timer);
    // Fires once per launch, as soon as an environment is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstEnvironment]);
}
