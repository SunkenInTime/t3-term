// The one door every pull request write goes through: merge, close, reopen, ready/draft, branch
// updates, title and description edits, comments, reviews, replies, thread resolution,
// reactions, labels, reviewers, viewed marks, guide runs and checkouts. Web calls these commands
// straight from each component (`useAtomCommand(pullRequestEnvironment.<write>)`); here they all
// pass through `runPullRequestWrite` so a dry run can stop every one of them in one place.
//
// Dry run (`T3TERM_PR_DRY_RUN=1`, and always under gpuix automation, where `GPUIX_BACKGROUND=1`)
// appends the exact command and payload to `$T3TERM_HOME/pr-writes-dry-run.jsonl` and settles as
// a failure without contacting the server. A screenshot run can then open and fill every form,
// press its submit button, and prove the request it would have sent, while nothing reaches the
// host: these writes are public and most cannot be taken back.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  runAtomCommand,
  type AtomCommand,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { termHome } from "../runtime/paths.ts";

export const PULL_REQUEST_WRITES_DRY_RUN =
  process.env.T3TERM_PR_DRY_RUN === "1" || process.env.GPUIX_BACKGROUND === "1";

export class PullRequestDryRunError extends Error {
  constructor(label: string) {
    super(`Dry run: the ${label} request was recorded and not sent.`);
    this.name = "PullRequestDryRunError";
  }
}

const DRY_RUN_LOG = NodePath.join(termHome(), "pr-writes-dry-run.jsonl");

function recordDryRun(label: string, input: unknown): void {
  try {
    NodeFS.mkdirSync(NodePath.dirname(DRY_RUN_LOG), { recursive: true });
    NodeFS.appendFileSync(
      DRY_RUN_LOG,
      `${JSON.stringify({ at: new Date().toISOString(), command: label, input }, (_key, value) =>
        typeof value === "function" ? "[function]" : value,
      )}\n`,
    );
  } catch {}
}

/**
 * Runs a write command, or records it and refuses in a dry run. Failures are not reported to the
 * console: every caller turns them into its own toast, as web's `reportFailure: false` does.
 */
export async function runPullRequestWrite<W, A, E>(
  command: AtomCommand<W, A, E>,
  input: W,
): Promise<AtomCommandResult<A, E | PullRequestDryRunError>> {
  if (PULL_REQUEST_WRITES_DRY_RUN) {
    recordDryRun(command.label, input);
    // A beat of latency, so the pending labels ("Merging...", "Posting...") are seen as they are.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return AsyncResult.failure(Cause.fail(new PullRequestDryRunError(command.label)));
  }
  return runAtomCommand(appAtomRegistry, command, input, { reportFailure: false });
}

/** For writes that do not go through an atom command (a checkout's thread preparation). */
export async function guardPullRequestWrite<A>(
  label: string,
  input: unknown,
  run: () => Promise<A>,
): Promise<A | PullRequestDryRunError> {
  if (PULL_REQUEST_WRITES_DRY_RUN) {
    recordDryRun(label, input);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return new PullRequestDryRunError(label);
  }
  return run();
}
