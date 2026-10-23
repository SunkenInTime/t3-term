// The non-React parts of apps/web/src/components/ServerUpdateAction.tsx: the
// update target and outcome types, the stage labels and the maintain-scope
// check. The hook that runs updates is in app/src/sidebar/serverUpdates.ts.
import {
  AuthEnvironmentMaintainScope,
  sessionGrantsScope,
  type AuthSessionState,
  type EnvironmentId,
  type ServerInstallation,
  type ServerSelfUpdateCapability,
} from "@t3tools/contracts";
import type { ServerUpdateStage } from "@t3tools/client-runtime/state/server";
import type { AsyncResult } from "effect/reactivity";

const UPDATE_STAGE_LABELS: Record<ServerUpdateStage, string> = {
  downloading: "Downloading…",
  installing: "Downloading…",
  resuming: "Restarting…",
};

export function serverUpdateStageLabel(stage: ServerUpdateStage): string {
  return UPDATE_STAGE_LABELS[stage];
}

export function updateFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Server update failed.";
}

export interface ServerUpdateTarget {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly installation?: ServerInstallation | undefined;
  readonly desktopAppUpdate?: boolean;
  readonly threadContinuation?: boolean;
  readonly targetVersion: string;
  readonly continueThreadsAfterServerUpdate?: boolean;
}

export type ServerUpdateOutcome =
  | { readonly status: "updated" | "skipped" }
  | { readonly status: "failed"; readonly message: string };

export function canUpdateServer(result: AsyncResult.AsyncResult<AuthSessionState, unknown>): boolean {
  if (result._tag !== "Success" || !result.value.authenticated) return false;
  return sessionGrantsScope(result.value, AuthEnvironmentMaintainScope);
}
