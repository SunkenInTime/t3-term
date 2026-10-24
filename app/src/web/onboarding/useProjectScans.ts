// Ported from vendor/t3code/apps/web/src/onboarding/useProjectScans.ts, with
// t3-term's atom families (state/onboarding.ts, state/settings.ts).
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useContext } from "react";

import { agentSessionScan } from "../../state/onboarding.ts";
import { environmentAtomList, environmentIdsKey } from "../../state/settings.ts";

/** web state/query.ts formatEnvironmentQueryError */
function formatEnvironmentQueryError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "The environment request failed.";
}

const scanAtom = (environmentId: EnvironmentId) => agentSessionScan({ environmentId, input: {} });
const projectScansAtom = environmentAtomList("t3term-project-scans", scanAtom);

export function useProjectScans(environmentIds: readonly EnvironmentId[]) {
  const registry = useContext(RegistryContext);
  const results = useAtomValue(projectScansAtom(environmentIdsKey(environmentIds)));
  return environmentIds.map((environmentId, index) => {
    const result = results[index]!;
    return {
      environmentId,
      data: Option.getOrNull(AsyncResult.value(result)),
      error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
      isPending: result.waiting || result._tag === "Initial",
      refresh: () => registry.refresh(scanAtom(environmentId)),
    };
  });
}
