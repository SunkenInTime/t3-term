// apps/web/src/components/ThreadNotificationCoordinator.tsx: watches every
// thread for a finished run or a new request for the user (approval, input,
// failure, usage limit), then plays a sound, shows an in-app toast when the user
// is here on another thread, or raises a desktop notification when they're away.
// The unread count goes in the window title, which terminals show via OSC 2.
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
import { toast } from "../ui/toast.tsx";
import { resolveSidebarThreadStatus } from "../web/components/Sidebar.logic.ts";
import { playNotificationSound, showDesktopNotification, userIsPresent } from "./platform.ts";

type NotificationMode = ReturnType<typeof getClientSettings>["notificationMode"];

const hasSound = (mode: NotificationMode) => mode === "sound" || mode === "notifications-and-sound";
const hasDesktop = (mode: NotificationMode) => mode === "notifications" || mode === "notifications-and-sound";

const WINDOW_TITLE = "T3 Code";

export function ThreadNotificationCoordinator() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inApp = useClientSettings((settings) => settings.inAppNotificationsEnabled);
  const renderer = useGpuixRequired();
  const unread = useRef(new Set<string>());

  const setBadge = () => {
    const count = unread.current.size;
    renderer.setWindowTitle?.(count > 0 ? `(${count > 9 ? "9+" : count}) ${WINDOW_TITLE}` : WINDOW_TITLE);
  };

  useEffect(() => {
    // Coming back to t3-term reads the alerts, the way window focus clears them on web.
    const timer = setInterval(() => {
      if (unread.current.size > 0 && userIsPresent()) {
        unread.current.clear();
        setBadge();
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (mode === "off" && !inApp) return null;
  return [...enabledEnvironmentIds(catalog)].map((environmentId) => (
    <EnvironmentNotifications
      key={environmentId}
      environmentId={environmentId}
      onDesktopNotification={(tag) => {
        unread.current.add(tag);
        setBadge();
      }}
    />
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
  onDesktopNotification,
}: {
  environmentId: EnvironmentId;
  onDesktopNotification: (tag: string) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const threads = shell.status === "live" && Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : null;
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inApp = useClientSettings((settings) => settings.inAppNotificationsEnabled);
  const previous = useRef(new Map<ThreadId, NotificationState>());

  useEffect(() => {
    if (threads === null) {
      previous.current.clear();
      return;
    }
    const route = appAtomRegistry.get(routeAtom);
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
      const title =
        kind === "completion"
          ? "Thread completed"
          : status === "approval"
            ? "Approval needed"
            : status === "limited"
              ? "Usage limit reached"
              : status === "failed"
                ? "Thread failed"
                : "Input needed";
      if (hasSound(mode)) playNotificationSound(kind);
      const viewingThread = route.kind === "thread" && route.environmentId === environmentId && route.threadId === thread.id;
      if (inApp && userIsPresent() && !viewingThread) {
        const id = toast({
          type: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
          title,
          description: thread.title,
          action: {
            label: "Open thread",
            onClick: () => appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId: thread.id }),
          },
        });
        void id;
        continue;
      }
      if (!hasDesktop(mode) || userIsPresent()) continue;
      showDesktopNotification(title, thread.title);
      onDesktopNotification(`${environmentId}:${thread.id}`);
    }
    previous.current = next;
  }, [environmentId, inApp, mode, onDesktopNotification, threads]);

  return null;
}
