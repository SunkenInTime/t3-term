// Dev-only states for composer notices that a test server cannot produce safely
// (a provider goal, a subagent asking, a usage limit, a /feedback upload to OpenAI,
// a checkout on another branch). Inert unless set:
//
//   T3TERM_DEV_COMPOSER_BANNERS=goal,child-input,background,branch,limit,feedback-sent,feedback-failed,feedback-uploading
//
// Each flag only replaces the data the banner reads in the open thread; buttons on the
// banners still run their real commands, so don't click them against a real thread.
import type { CodexFeedbackSubmission } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { MessageId } from "@t3tools/contracts";

const flags = new Set(
  (process.env.T3TERM_DEV_COMPOSER_BANNERS ?? "")
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean),
);

export function devComposerBanner(flag: string): boolean {
  return flags.has(flag);
}

export function withDevGoal(shell: EnvironmentThreadShell | null): EnvironmentThreadShell | null {
  if (!shell || !flags.has("goal")) return shell;
  return {
    ...shell,
    goal: {
      objective: "Keep the sandbox README in sync with the scripts folder",
      status: "paused",
      tokensUsed: 12_400,
      timeUsedSeconds: 380,
      checks: 3,
    },
  } as EnvironmentThreadShell;
}

export function devChildInputs(
  shell: EnvironmentThreadShell | null,
  real: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  if (!shell || !flags.has("child-input") || real.length > 0) return real;
  return [
    { ...shell, title: "Audit the scripts folder", hasPendingApprovals: true } as EnvironmentThreadShell,
    { ...shell, title: "Draft README changes", hasPendingApprovals: false } as EnvironmentThreadShell,
  ];
}

export function devCurrentGitBranch(real: string | null): string | null {
  return flags.has("branch") && real !== null ? "dev/other-branch" : real;
}

export function withDevUsageLimitRuntime<T extends { readonly status: string } | null>(runtime: T): T {
  if (!flags.has("limit")) return runtime;
  return {
    ...(runtime ?? {}),
    status: "failed",
    lastErrorClass: "usage_limit",
    usageLimitResetAt: new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 7_200_000).toISOString(),
  } as unknown as T;
}

const DEV_FEEDBACK_ID = MessageId.make("dev-feedback");

export function devFeedbackSubmissions(
  real: ReadonlyArray<CodexFeedbackSubmission>,
): ReadonlyArray<CodexFeedbackSubmission> {
  const base = { id: DEV_FEEDBACK_ID, command: "/feedback", createdAt: new Date(0).toISOString() };
  if (flags.has("feedback-sent")) return [...real, { ...base, status: "sent", feedbackId: "019a2f4c-7d1e-7c3b-9e55-0f3c8a7b1d42" }];
  if (flags.has("feedback-failed")) return [...real, { ...base, status: "failed", errorMessage: "Upload rejected: the session has no rollout yet." }];
  if (flags.has("feedback-uploading")) return [...real, { ...base, status: "uploading" }];
  return real;
}

/** `background`: a subagent and a command still running after the latest run ended. */
export function devBackgroundTasks<T>(threadId: string | null, real: ReadonlyArray<T>): ReadonlyArray<T> {
  if (!flags.has("background") || real.length > 0 || threadId === null) return real;
  return [
    { taskId: "dev-task-1", kind: "subagent", description: "Audit the scripts folder", childThreadId: threadId },
    { taskId: "dev-task-2", kind: "command", description: "sleep 75" },
  ] as unknown as ReadonlyArray<T>;
}
