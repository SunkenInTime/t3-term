// Subset of apps/web/src/session-logic.ts the composer reads: session phase and the
// latest proposed plan. Functions are copied verbatim.
import type { ThreadStructure, ThreadStructureRuntime } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2PlanArtifact, PlanId, RunId } from "@t3tools/contracts";
import type {
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import * as DateTime from "effect/DateTime";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";

export type PendingApproval = ThreadPendingApproval;
export type PendingUserInput = ThreadPendingUserInput;

export interface LatestProposedPlanState {
  readonly id: PlanId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runId: RunId | null;
  readonly planMarkdown: string;
  readonly status: OrchestrationV2PlanArtifact["status"];
}


function planItemTime(
  projection: ThreadStructure,
  plan: Pick<OrchestrationV2PlanArtifact, "id" | "runId">,
): string {
  const item = projection.turnItems.findLast(
    (candidate) =>
      (candidate.type === "proposed_plan" || candidate.type === "todo_list") &&
      candidate.planId === plan.id,
  );
  if (item?.type === "proposed_plan" || item?.type === "todo_list") {
    return DateTime.formatIso(item.updatedAt);
  }
  // Without a plan item, the plan's run dates it; the thread's own timestamps move while a reply streams.
  const run = projection.runs.find((candidate) => candidate.id === plan.runId);
  return DateTime.formatIso(
    run?.completedAt ?? run?.startedAt ?? run?.requestedAt ?? projection.thread.createdAt,
  );
}

function toLatestProposedPlanState(
  projection: ThreadStructure,
  plan: Extract<OrchestrationV2PlanArtifact, { readonly kind: "proposed_plan" }>,
): LatestProposedPlanState {
  const updatedAt = planItemTime(projection, plan);
  return {
    id: plan.id,
    createdAt: updatedAt,
    updatedAt,
    runId: plan.runId,
    planMarkdown: plan.markdown,
    status: plan.status,
  };
}

export function findLatestProposedPlan(
  projection: ThreadStructure | null,
  latestRunId: RunId | string | null | undefined,
): LatestProposedPlanState | null {
  if (projection === null) return null;
  const plans = projection.plans.filter((plan) => plan.kind === "proposed_plan");
  const candidates = latestRunId ? plans.filter((plan) => plan.runId === latestRunId) : plans;
  const plan = [...(candidates.length > 0 ? candidates : plans)]
    .toSorted(
      (left, right) =>
        planItemTime(projection, left).localeCompare(planItemTime(projection, right)) ||
        left.id.localeCompare(right.id),
    )
    .at(-1);
  return plan === undefined ? null : toLatestProposedPlanState(projection, plan);
}

export function hasActionableProposedPlan(plan: LatestProposedPlanState | null): boolean {
  return plan?.status === "active";
}

export function derivePhase(runtime: ThreadStructureRuntime | null): SessionPhase {
  if (runtime === null) return "disconnected";
  if (
    runtime.status === "preparing" ||
    runtime.status === "starting" ||
    runtime.status === "queued"
  )
    return "connecting";
  if (runtime.status === "running" || runtime.status === "waiting") return "running";
  return "ready";
}

export function derivePendingApprovals(
  approvals: ReadonlyArray<ThreadPendingApproval>,
): ThreadPendingApproval[] {
  return [...approvals].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function derivePendingUserInputs(
  inputs: ReadonlyArray<ThreadPendingUserInput>,
): ThreadPendingUserInput[] {
  return [...inputs].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}
