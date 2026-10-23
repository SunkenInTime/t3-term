// Port of apps/web/src/components/PullRequestThreadDialog.tsx with its host
// (apps/web/src/components/chat/ChatOverlayHosts.tsx) and the onPrepared step
// ChatView wires in apps/web/src/components/chat/usePullRequestDraftThread.ts.
//
// Web hands the prepared branch/worktree to its client-side draft store. t3-term
// has no draft store yet, so the default onPrepared moves the thread itself onto
// the checkout with threadEnvironment.updateMetadata, guarded by expectedEmpty
// (the server refuses once the thread has messages, matching web's rule that only
// a fresh draft is checked out into). Every result is also published on
// preparedPullRequestCheckoutAtom for a draft owner to pick up. Callers that
// own a draft pass their own onPrepared.
import { useAtomValue } from "@effect/atom-react";
import type { PublicInstance } from "@gpuix/react";
import { parsePullRequestReference } from "@t3tools/client-runtime/pull-request-link-input";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  gitEnvironment,
  readEnvironmentScope,
  useEnvironmentScope,
  vcsEnvironment,
} from "../state/dialogs.ts";
import { environmentThreadShells, threadEnvironment } from "../state/environment.ts";
import { Button, Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { toast } from "../ui/toast.tsx";
import {
  DIALOG_WIDTH,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogShell,
  ErrorLine,
  TextField,
  TitleIcon,
} from "./dialogKit.tsx";

export interface PreparedPullRequestCheckout {
  readonly branch: string;
  readonly worktreePath: string | null;
}

export interface PullRequestThreadDialogRequest {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The project's workspace root; the PR is resolved and checked out from here. */
  readonly cwd: string | null;
  readonly initialReference?: string | null;
  /** Puts the thread or draft on the checkout. Defaults to updating the server thread's metadata. */
  readonly onPrepared?: (input: PreparedPullRequestCheckout) => Promise<void> | void;
}

/** apps/web/src/components/pullRequest/pullRequestCheckoutToast.ts */
const OFF_HEAD_PULL_REQUEST_CHECKOUT_TOAST = {
  type: "warning",
  title: "Checked out, but not confirmed on the latest commit",
  description:
    "This checkout could not be confirmed at the pull request's latest commit, so its code may differ. Local commits or uncommitted work keep a checkout where it is.",
} as const;

const requestAtom = Atom.make<(PullRequestThreadDialogRequest & { readonly key: number }) | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("dialogs:pull-request-thread"));

/** The last checkout the dialog prepared, per thread, for whichever view owns that thread's draft. */
export const preparedPullRequestCheckoutAtom = Atom.make<
  | (PreparedPullRequestCheckout & { readonly environmentId: EnvironmentId; readonly threadId: ThreadId })
  | null
>(null).pipe(Atom.keepAlive, Atom.withLabel("dialogs:prepared-pull-request-checkout"));

/** Opens "Checkout pull request" (checkout a PR locally or into a worktree for a thread). */
export function openPullRequestThreadDialog(request: PullRequestThreadDialogRequest): void {
  appAtomRegistry.set(requestAtom, { ...request, key: Date.now() });
}

export function closePullRequestThreadDialog(): void {
  appAtomRegistry.set(requestAtom, null);
}

async function putThreadOnCheckout(
  request: PullRequestThreadDialogRequest,
  prepared: PreparedPullRequestCheckout,
): Promise<void> {
  const ref = { environmentId: request.environmentId, threadId: request.threadId };
  // A thread only the client knows about (a draft) has nothing to update on the server.
  if (appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref)) === null) return;
  const result = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.updateMetadata,
    {
      environmentId: request.environmentId,
      input: {
        threadId: request.threadId,
        branch: prepared.branch,
        worktreePath: prepared.worktreePath,
        expectedEmpty: true,
      },
    },
    { label: "Move thread onto pull request checkout", reportFailure: false },
  );
  if (result._tag === "Failure") {
    const error = squashAtomCommandFailure(result);
    throw error instanceof Error ? error : new Error("Could not move the thread onto the checkout.");
  }
}

export function PullRequestThreadDialogHost() {
  const request = useAtomValue(requestAtom);
  if (request === null) return null;
  return <PullRequestThreadDialog key={request.key} request={request} onClose={closePullRequestThreadDialog} />;
}

function pullRequestStatusTone(state: string | undefined, fallback: string): string {
  switch (state) {
    case "merged":
      return alpha("#c4b4ff", 0.9); // violet-300/90
    case "closed":
      return alpha("#9f9fa9", 0.8); // zinc-400/80
    case "open":
      return alpha("#5ee9b5", 0.9); // emerald-300/90
    default:
      return fallback;
  }
}

function useDebouncedValue<T>(value: T, wait: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), wait);
    return () => clearTimeout(timer);
  }, [value, wait]);
  return debounced;
}

const EMPTY_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false));

function queryError(result: AsyncResult.AsyncResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure") return null;
  const error = Cause.squash(result.cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The environment request failed.";
}

const GITHUB_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"/></svg>';

function PullRequestThreadDialog({
  request,
  onClose,
}: {
  request: PullRequestThreadDialogRequest;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { environmentId, threadId, cwd } = request;
  const referenceInputRef = useRef<PublicInstance | null>(null);
  const [reference, setReference] = useState(request.initialReference ?? "");
  const [referenceDirty, setReferenceDirty] = useState(false);
  const [preparingMode, setPreparingMode] = useState<"local" | "worktree" | null>(null);
  const [prepareErrorMessage, setPrepareErrorMessage] = useState<string | null>(null);
  const debouncedReference = useDebouncedValue(reference, 450);

  const statusResult = useAtomValue(
    cwd === null ? EMPTY_RESULT_ATOM : vcsEnvironment.status({ environmentId, input: { cwd } }),
  );
  const sourceControlProvider = Option.getOrNull(AsyncResult.value(statusResult))?.sourceControlProvider;
  const definition = sourceControlClients.get(sourceControlProvider?.kind);
  const providerName = sourceControlProvider?.name || definition.label;
  const terminology = definition.changeRequest;

  const parsedReference = parsePullRequestReference(reference);
  const parsedDebouncedReference = parsePullRequestReference(debouncedReference);
  const resolutionResult = useAtomValue(
    cwd !== null && parsedDebouncedReference !== null
      ? gitEnvironment.pullRequestResolution({
          environmentId,
          input: { cwd, reference: parsedDebouncedReference },
        })
      : EMPTY_RESULT_ATOM,
  );
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const canOperateThread = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const preparing = preparingMode !== null;

  const resolvedPullRequest =
    parsedReference !== null && parsedReference === parsedDebouncedReference
      ? (Option.getOrNull(AsyncResult.value(resolutionResult))?.pullRequest ?? null)
      : null;
  const resolutionPending =
    cwd !== null &&
    parsedDebouncedReference !== null &&
    (resolutionResult.waiting || resolutionResult._tag === "Initial");
  const isResolving =
    parsedReference !== null &&
    resolvedPullRequest === null &&
    (parsedReference !== parsedDebouncedReference || resolutionPending);
  const statusTone = pullRequestStatusTone(resolvedPullRequest?.state, theme.mutedForeground);

  const handleConfirm = async (mode: "local" | "worktree") => {
    if (!canWriteSourceControl) return;
    if (mode === "worktree" && !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      return;
    }
    if (!parsedReference) {
      setReferenceDirty(true);
      return;
    }
    if (!resolvedPullRequest || !cwd) return;
    setPrepareErrorMessage(null);
    setPreparingMode(mode);
    const result = await runAtomCommand(
      appAtomRegistry,
      gitEnvironment.preparePullRequestThread,
      {
        environmentId,
        input: { cwd, reference: parsedReference, mode, ...(mode === "worktree" ? { threadId } : {}) },
      },
      { label: "Preparing pull request thread", reportFailure: false },
    );
    if (result._tag === "Failure") {
      setPreparingMode(null);
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setPrepareErrorMessage(
          error instanceof Error ? error.message : `Failed to prepare ${terminology.singular} thread.`,
        );
      }
      return;
    }
    const prepared = { branch: result.value.branch, worktreePath: result.value.worktreePath };
    appAtomRegistry.set(preparedPullRequestCheckoutAtom, { ...prepared, environmentId, threadId });
    try {
      await (request.onPrepared ?? ((input) => putThreadOnCheckout(request, input)))(prepared);
    } catch (cause) {
      setPreparingMode(null);
      setPrepareErrorMessage(cause instanceof Error ? cause.message : "Could not use the checkout.");
      return;
    }
    if (!result.value.isOnPullRequestHead) toast(OFF_HEAD_PULL_REQUEST_CHECKOUT_TOAST);
    onClose();
  };

  const validationMessage = !referenceDirty
    ? null
    : reference.trim().length === 0
      ? `Paste a ${terminology.singular} URL, checkout command, or enter 123 / #123.`
      : parsedReference === null
        ? `Use a ${terminology.singular} URL, checkout command, 123, or #123.`
        : null;
  const errorMessage =
    validationMessage ??
    prepareErrorMessage ??
    (resolvedPullRequest === null && parsedReference === parsedDebouncedReference
      ? queryError(resolutionResult)
      : null);
  const capitalizedSingular = terminology.singular.replace(/\b\w/g, (letter) => letter.toUpperCase());

  return (
    <DialogShell
      width={DIALOG_WIDTH.xl}
      testId="checkout-pr-dialog"
      initialFocus={referenceInputRef}
      onOpenChange={(next) => {
        if (!next && !preparing) onClose();
      }}
    >
      <DialogHeader
        title={`Checkout ${terminology.singular}`}
        icon={
          definition.icon === "github" ? (
            <TitleIcon svgSource={GITHUB_MARK} />
          ) : (
            <TitleIcon name={definition.icon === "gitlab" ? "gitlab" : "git-pull-request"} />
          )
        }
        description={`Resolve a ${providerName} ${terminology.singular}, then create the draft thread in the main repo or in a dedicated worktree.`}
        hasPanel
      />
      <DialogPanel>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Text size="xs" weight={500}>
            {capitalizedSingular}
          </Text>
          <TextField
            inputRef={referenceInputRef}
            testId="checkout-pr-input"
            placeholder={`${terminology.shortLabel} URL, checkout command, or #42`}
            value={reference}
            onChange={(value) => {
              setReferenceDirty(true);
              setReference(value);
            }}
            onSubmit={() => {
              if (!isResolving && !preparing) void handleConfirm("worktree");
            }}
          />
        </div>

        {resolvedPullRequest ? (
          <div
            testId="checkout-pr-resolved"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              padding: 12,
              borderRadius: RADIUS.xl,
              borderWidth: 1,
              borderColor: alpha(theme.border, 0.7),
              backgroundColor: alpha(theme.muted, 0.24),
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexShrink: 1 }}>
              <Text weight={500} truncate>
                {resolvedPullRequest.title}
              </Text>
              <Text size="xs" color={theme.mutedForeground} truncate>
                {`#${resolvedPullRequest.number} · ${resolvedPullRequest.headBranch} to ${resolvedPullRequest.baseBranch}`}
              </Text>
            </div>
            <Text size="xs" color={statusTone} style={{ flexShrink: 0 }}>
              {resolvedPullRequest.state.charAt(0).toUpperCase() + resolvedPullRequest.state.slice(1)}
            </Text>
          </div>
        ) : null}

        {isResolving ? (
          // Web shows a spinner here; T3 forbids continuously repainting ones, so the text stands alone.
          <Text size="xs" color={theme.mutedForeground}>
            {`Resolving ${terminology.singular}...`}
          </Text>
        ) : null}

        {errorMessage ? <ErrorLine>{errorMessage}</ErrorLine> : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" size="sm" testId="checkout-pr-cancel" disabled={preparing} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          testId="checkout-pr-local"
          disabled={!canWriteSourceControl || !cwd || !resolvedPullRequest || isResolving || preparing}
          onClick={() => void handleConfirm("local")}
        >
          {preparingMode === "local" ? "Preparing local..." : "Local"}
        </Button>
        <Button
          size="sm"
          testId="checkout-pr-worktree"
          disabled={
            !canWriteSourceControl || !canOperateThread || !cwd || !resolvedPullRequest || isResolving || preparing
          }
          onClick={() => void handleConfirm("worktree")}
        >
          {preparingMode === "worktree" ? "Preparing worktree..." : "Worktree"}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
