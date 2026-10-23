// Port of apps/web/src/lib/resourceTelemetryState.ts: the live resource
// telemetry subscription, its history query, and the monitor retry command,
// all from the client-runtime server atoms.
import { AuthDiagnosticsReadScope, AuthEnvironmentMaintainScope } from "@t3tools/contracts";
import type { EnvironmentId, ResourceTelemetryHistoryInput, ResourceTelemetrySnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";

import { serverEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironmentScope, usePrimaryEnvironmentId } from "../../state/settings.ts";
import { useEnvironmentQuery } from "../query.ts";

export interface ResourceTelemetryState {
  readonly data: ResourceTelemetrySnapshot | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
  readonly retry: () => Promise<ResourceTelemetrySnapshot>;
}

export function useResourceTelemetry(targetEnvironmentId?: EnvironmentId | null): ResourceTelemetryState {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = targetEnvironmentId === undefined ? primaryEnvironmentId : targetEnvironmentId;
  const canReadDiagnostics = useEnvironmentScope(environmentId, AuthDiagnosticsReadScope);
  const query = useEnvironmentQuery(
    environmentId === null || !canReadDiagnostics ? null : serverEnvironment.resourceTelemetry({ environmentId, input: {} }),
  );
  const retryCommand = useAtomCommand(serverEnvironment.retryResourceTelemetry, { reportFailure: false });
  const retry = async () => {
    if (environmentId === null) {
      throw new Error("No environment is selected.");
    }
    if (
      !readEnvironmentScope(environmentId, AuthEnvironmentMaintainScope) ||
      !readEnvironmentScope(environmentId, AuthDiagnosticsReadScope)
    ) {
      throw new Error("This connection cannot restart the resource monitor.");
    }
    const result = await retryCommand({ environmentId, input: {} });
    if (result._tag === "Failure") {
      throw Cause.squash(result.cause);
    }
    return result.value.snapshot;
  };
  return { data: query.data, error: query.error, isPending: query.isPending, refresh: query.refresh, retry };
}

export function useResourceTelemetryHistory(input: ResourceTelemetryHistoryInput, targetEnvironmentId?: EnvironmentId | null) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = targetEnvironmentId === undefined ? primaryEnvironmentId : targetEnvironmentId;
  const canReadDiagnostics = useEnvironmentScope(environmentId, AuthDiagnosticsReadScope);
  return useEnvironmentQuery(
    environmentId === null || !canReadDiagnostics
      ? null
      : serverEnvironment.resourceTelemetryHistory({ environmentId, input }),
  );
}
