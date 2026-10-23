// Port of apps/web/src/components/pullRequest/LinkPullRequestDialog.tsx.
import { useAtomValue } from "@effect/atom-react";
import type { PublicInstance } from "@gpuix/react";
import {
  pullRequestLinkProject,
  resolveLinkPullRequestInput,
} from "@t3tools/client-runtime/pull-request-link-input";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentProjects, environmentThreadShells } from "../state/environment.ts";
import { Button, Text } from "../ui/primitives.tsx";
import { useTheme } from "../ui/theme.ts";
import {
  DIALOG_WIDTH,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogShell,
  ErrorLine,
  TextField,
} from "./dialogKit.tsx";
import { usePullRequestLinking } from "./usePullRequestLinking.ts";

/**
 * Which thread has the link dialog open, set by whichever entry point asked (command palette,
 * pull-requests surface, detail panel) and rendered once by the dialog host so the dialog outlives
 * a palette that closes the moment its command runs.
 */
const linkPullRequestDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("pull-requests:link-dialog-thread"),
);

/** Opens "Link pull request" for a thread. Does nothing visible when the thread's environment cannot link. */
export function openLinkPullRequestDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(linkPullRequestDialogThreadAtom, threadRef);
}

export function closeLinkPullRequestDialog(): void {
  appAtomRegistry.set(linkPullRequestDialogThreadAtom, null);
}

const EMPTY_THREAD_SHELL_ATOM = Atom.make(null);

export function LinkPullRequestDialogHost() {
  const threadRef = useAtomValue(linkPullRequestDialogThreadAtom);
  const thread = useAtomValue(
    threadRef === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.threadShellAtom(threadRef),
  );
  const linking = usePullRequestLinking(threadRef?.environmentId);
  if (threadRef === null || linking.mode === "unsupported") return null;
  return (
    <LinkPullRequestDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
      projectId={thread?.projectId ?? null}
      onClose={closeLinkPullRequestDialog}
    />
  );
}

function LinkPullRequestDialog({
  threadRef,
  projectId,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  projectId: string | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const inputRef = useRef<PublicInstance | null>(null);
  const [reference, setReference] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const ownProject = pullRequestLinkProject(
    projects.find(
      (project) => project.environmentId === threadRef.environmentId && project.id === projectId,
    )?.repositoryIdentity,
  );
  const linking = usePullRequestLinking(threadRef.environmentId);
  const [pending, setPending] = useState(false);

  const resolved = resolveLinkPullRequestInput({
    reference,
    project: ownProject,
    hasProject: (reference) => linking.canLink(reference.url),
  });

  const submit = async () => {
    setDirty(true);
    if (resolved === null || "error" in resolved) return;
    setSubmitError(null);
    setPending(true);
    const result = await settlePromise(() =>
      linking.changeLink(threadRef, resolved.link.url, true),
    );
    setPending(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setSubmitError(error instanceof Error ? error.message : "Could not link the pull request.");
      return;
    }
    onClose();
  };

  const validation = !dirty
    ? null
    : reference.trim().length === 0
      ? "Paste a pull request URL or enter 123 / #123."
      : resolved === null
        ? "Use a pull request URL, 123, or #123."
        : "error" in resolved
          ? resolved.error
          : null;
  const message = validation ?? submitError;

  return (
    <DialogShell
      width={DIALOG_WIDTH.xl}
      testId="link-pr-dialog"
      initialFocus={inputRef}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogHeader
        title="Link pull request"
        description="Attach a pull request to this thread by its URL, or by its number for this thread's repository."
        hasPanel
      />
      <DialogPanel>
        <TextField
          inputRef={inputRef}
          testId="link-pr-input"
          placeholder="Pull request URL or #42"
          value={reference}
          onChange={(value) => {
            setDirty(true);
            setReference(value);
          }}
          onSubmit={() => void submit()}
        />
        {resolved !== null && "link" in resolved ? (
          <Text size="xs" color={theme.mutedForeground} truncate>
            {`${resolved.link.host}/${resolved.link.repository} #${resolved.link.number}`}
          </Text>
        ) : null}
        {message ? <ErrorLine>{message}</ErrorLine> : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" size="sm" testId="link-pr-cancel" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          testId="link-pr-submit"
          disabled={pending || resolved === null || "error" in resolved}
          onClick={() => void submit()}
        >
          {pending ? "Linking..." : "Link"}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
