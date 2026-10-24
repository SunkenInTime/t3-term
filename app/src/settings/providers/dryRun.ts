// Dev hook for screenshots and manual checks of provider setup flows.
//
// T3TERM_DRY_RUN_PROVIDER_ACTIONS=1 swaps every command that installs, updates,
// removes or signs in a provider runtime (and the ChatGPT account commands) for a
// stub: it writes `[provider dry run] <label> <input>` to stderr, shows a
// "Dry run: <label>" toast, and settles as an interrupted command, which every
// caller treats as "nothing happened". The click proves the wiring; nothing
// reaches the server. Without the variable the real command runs.
import type { AtomCommand, AtomCommandOptions, AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { ProviderAuthState, ProviderInstanceId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useState } from "react";

import { useAtomCommand } from "../../state/settings.ts";
import { toast } from "../../ui/toast.tsx";

export const PROVIDER_ACTIONS_DRY_RUN = process.env.T3TERM_DRY_RUN_PROVIDER_ACTIONS === "1";

export function useProviderActionCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  label: string,
  options?: AtomCommandOptions,
  /** Log without a toast (terminal keystrokes). */
  quiet = false,
): (value: W) => Promise<AtomCommandResult<A, E>> {
  const run = useAtomCommand(command, options);
  if (!PROVIDER_ACTIONS_DRY_RUN) return run;
  return async (value: W) => {
    process.stderr.write(`[provider dry run] ${label} ${JSON.stringify(value)}\n`);
    if (!quiet) toast({ type: "info", title: `Dry run: ${label}`, description: "T3TERM_DRY_RUN_PROVIDER_ACTIONS is set; nothing was sent." });
    return { _tag: "Failure", cause: Cause.interrupt() } as unknown as AtomCommandResult<A, E>;
  };
}

/**
 * With the dry run on, "Sign in" also opens a stand-in terminal interaction so the
 * sign-in terminal can be seen and typed into. It is local only: typed keys echo
 * into its output (a real CLI would echo them) and every response still goes
 * through the dry-run respond stub, which logs it. T3TERM_DRY_RUN_AUTH_TERMINAL=1 opens
 * it as soon as an Account row mounts, for providers whose Sign in is disabled.
 */
const DRY_RUN_TERMINAL_BANNER =
  "\x1b[1mDry run\x1b[0m: a stand-in for the provider's sign-in program. Nothing was started.\r\n" +
  "Visit https://example.com to continue, then type below.\r\n\r\n> ";

export function useDryRunAuthTerminal(instanceId: ProviderInstanceId) {
  const [state, setState] = useState<{ output: string } | null>(() =>
    PROVIDER_ACTIONS_DRY_RUN && process.env.T3TERM_DRY_RUN_AUTH_TERMINAL === "1" ? { output: DRY_RUN_TERMINAL_BANNER } : null,
  );
  if (!PROVIDER_ACTIONS_DRY_RUN) return null;
  const auth: ProviderAuthState | null =
    state === null
      ? null
      : {
          instanceId,
          phase: "waiting",
          flowId: "dry-run-flow" as ProviderAuthState["flowId"],
          authorizationUrl: null,
          expiresAt: null,
          message: null,
          interaction: { type: "terminal", id: "dry-run-terminal" as never, output: state.output, outputOffset: state.output.length },
        };
  return {
    auth,
    open: () => setState({ output: DRY_RUN_TERMINAL_BANNER }),
    close: () => setState(null),
    echo: (data: string) =>
      setState((current) =>
        current === null ? current : { output: current.output + data.replace(/\r/g, "\r\n> ").replace(/\x7f/g, "\b \b") },
      ),
  };
}
