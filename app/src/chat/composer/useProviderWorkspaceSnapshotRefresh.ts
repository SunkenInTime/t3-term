// Port of apps/web/src/components/chat/useProviderWorkspaceSnapshotRefresh.ts: keeps the
// selected provider's workspace snapshot (its skills and slash commands for this cwd) fresh.
// A snapshot older than the TTL, or one the server dropped, is rescanned when the composer
// opens on it and again when the user types; a failed scan waits a cooldown before retrying.
import {
  hasCompleteProviderWorkspaceSnapshot,
  hasCurrentProviderWorkspaceSnapshot,
} from "@t3tools/client-runtime/providerSkills";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS, type ServerProvider } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { serverEnvironment } from "../../state/environment.ts";

const WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS = 10_000;

type Retry = { readonly key: string; readonly notBefore: number };

/** Returns a cheap check to run on every edit. */
export function useProviderWorkspaceSnapshotRefresh(input: {
  readonly environmentId: EnvironmentId;
  readonly gitCwd: string | null;
  readonly selectedInstanceId: string | null;
  readonly selectedProviderStatus: ServerProvider | null;
}): () => void {
  const { environmentId, gitCwd, selectedInstanceId, selectedProviderStatus } = input;
  // The last scan this composer asked for. A request inside the TTL is not repeated, so a
  // client clock ahead of the server's cannot loop rescans.
  const lastRequestRef = useRef<{ key: string; requestedAt: number } | null>(null);
  const [retry, setRetry] = useState<Retry | null>(null);
  const scopeKey = gitCwd && selectedInstanceId ? `${environmentId}:${selectedInstanceId}:${gitCwd}` : null;
  const slashCommandsPending =
    selectedProviderStatus?.workspaceSnapshots?.some((snapshot) => snapshot.cwd === gitCwd && snapshot.slashCommandsPending === true) ??
    false;
  useEffect(() => {
    if (!slashCommandsPending || !retry || retry.key !== scopeKey) return;
    const timeout = setTimeout(
      () => setRetry((current) => (current === retry ? null : current)),
      Math.max(0, retry.notBefore - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [retry, scopeKey, slashCommandsPending]);
  // Losing a snapshot (the server dropped it) lifts both the TTL and the retry cooldown.
  const hasSnapshot = hasCompleteProviderWorkspaceSnapshot(selectedProviderStatus, gitCwd);
  const [hadSnapshot, setHadSnapshot] = useState(hasSnapshot);
  const [lossCount, setLossCount] = useState(0);
  if (hadSnapshot !== hasSnapshot) {
    setHadSnapshot(hasSnapshot);
    if (!hasSnapshot) {
      setLossCount((count) => count + 1);
      setRetry(null);
    }
  }
  const lastLossRef = useRef(lossCount);
  const refreshIfStale = (now: number) => {
    if (lastLossRef.current !== lossCount) {
      lastLossRef.current = lossCount;
      lastRequestRef.current = null;
    }
    if (scopeKey === null || !gitCwd || !selectedInstanceId) return;
    const last = lastRequestRef.current;
    if (last?.key === scopeKey && now - last.requestedAt < PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS) return;
    if (hasCurrentProviderWorkspaceSnapshot(selectedProviderStatus, gitCwd, now)) return;
    if (retry?.key === scopeKey && now < retry.notBefore) return;
    const request = { key: scopeKey, requestedAt: now };
    lastRequestRef.current = request;
    const retryLater = () => {
      if (lastRequestRef.current !== request) return;
      lastRequestRef.current = null;
      setRetry({ key: request.key, notBefore: Date.now() + WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS });
    };
    void runAtomCommand(
      appAtomRegistry,
      serverEnvironment.refreshProviders,
      { environmentId, input: { instanceId: selectedInstanceId, cwd: gitCwd } } as never,
      { reportFailure: false },
    ).then((result) => {
      const providers = result._tag === "Success" ? (result.value as { providers?: ReadonlyArray<ServerProvider> }).providers : undefined;
      const refreshed = hasCompleteProviderWorkspaceSnapshot(
        providers?.find((provider) => provider.instanceId === selectedInstanceId),
        gitCwd,
      );
      if (!refreshed) retryLater();
    }, retryLater);
  };
  const refreshRef = useRef(refreshIfStale);
  refreshRef.current = refreshIfStale;
  useEffect(() => {
    refreshRef.current(Date.now());
  }, [scopeKey, retry, lossCount]);
  const stable = useRef(() => refreshRef.current(Date.now()));
  return stable.current;
}
