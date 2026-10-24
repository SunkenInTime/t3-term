// Port of apps/web/src/components/promptLinks/NewThreadLinkView.tsx, the landing for a `/new?...`
// prompt link: find the linked repository's project (or a pull request's thread), open a
// new-thread draft there and put the prompt in its composer. Web's pieces map to:
//   useNewThreadHandler      palette/actions.ts startNewThread (a draft is the draft route)
//   useScratchProject        palette/actions.ts scratchEnvironmentId / openScratchProject
//   sortScopedProjectsForSidebar(..., "updated_at")   palette/actions.ts sortProjectsByActivity
//   usePullRequestHandoffs   startPullRequestCheckout below (startHandoff, worktree mode)
// The clone and the checkout write to the server's disk; both go through runPullRequestWrite,
// so T3TERM_PR_DRY_RUN and screenshot automation record them instead of sending.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { getCloneDestinationPath } from "@t3tools/client-runtime/operations/projects";
import {
  findPromptLinkProject,
  findPromptLinkPullRequestThread,
  resolvePromptLinkModelSelection,
} from "@t3tools/client-runtime/prompt-links";
import type { EnvironmentProject, EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, ProjectId, type ScopedProjectRef } from "@t3tools/contracts";
import {
  type NewThreadLink,
  type PromptLinkRepository,
  promptLinkPullRequestUrl,
} from "@t3tools/shared/promptLinks";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  openScratchProject,
  openThread,
  readEnvironmentIds,
  readServerConfig,
  scratchEnvironmentId,
  sortProjectsByActivity,
  startNewThread,
} from "../palette/actions.ts";
import { runPullRequestWrite } from "../pullRequests/pullRequestWrites.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  composerTargetKey,
  readComposerDraft,
  setComposerModelSelection,
  setComposerPrompt,
  setDraftWorkspace,
} from "../state/composer.ts";
import { gitEnvironment, sourceControlEnvironment } from "../state/dialogs.ts";
import { environmentProjects, environmentThreadShells } from "../state/environment.ts";
import { environmentPresentations } from "../state/navigation.ts";
import { allReachableShellsLiveAtom } from "../state/promptLinks.ts";
import { Button } from "../ui/primitives.tsx";
import { toast, updateToast } from "../ui/toast.tsx";
import { checkoutFailureDescription, handoffPrompt } from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { LinkPage } from "./LinkPage.tsx";
import { placeLinkedPrompt, warnAboutHiddenCharacters } from "./linkedPrompt.ts";

type LinkState =
  | { readonly status: "opening" }
  | { readonly status: "opened" }
  | { readonly status: "failed"; readonly message: string; readonly title?: string }
  | { readonly status: "missing-repository"; readonly repository: PromptLinkRepository }
  | { readonly status: "pull-request-checkout"; readonly project: EnvironmentProject };

type LinkLaunch =
  | { readonly kind: "thread"; readonly thread: EnvironmentThreadShell }
  | { readonly kind: "draft"; readonly project: EnvironmentProject }
  | { readonly kind: "scratch" }
  | { readonly kind: "settled" };

const openedLinkKeys = new Set<number>();

const draftKeyOf = (ref: ScopedProjectRef) =>
  composerTargetKey({ kind: "draft", environmentId: ref.environmentId, projectId: ref.projectId });

/**
 * T3TERM_PROMPT_LINK_PROJECT=<project id> stands in for a repository no project matches, for
 * screenshots and automation: the t3term-sandbox project has no GitHub remote, so no link can
 * name it, and agents may only open drafts there.
 */
function screenshotLinkProject(projects: ReadonlyArray<EnvironmentProject>): EnvironmentProject | undefined {
  const id = process.env.T3TERM_PROMPT_LINK_PROJECT?.trim();
  return id ? projects.find((project) => project.id === id) : undefined;
}

/** apps/web/src/state/entities.ts waitForProject */
function waitForProject(ref: ScopedProjectRef, timeoutMs: number): Promise<EnvironmentProject | null> {
  const atom = environmentProjects.projectAtom(ref);
  const current = appAtomRegistry.get(atom);
  if (current !== null) return Promise.resolve(current);
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      resolve(null);
    }, timeoutMs);
    unsubscribe = appAtomRegistry.subscribe(atom, (project) => {
      if (project === null) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(project);
    });
  });
}

export function NewThreadLinkView({ link, linkKey }: { readonly link: NewThreadLink; readonly linkKey: number }) {
  const ready = useAtomValue(allReachableShellsLiveAtom);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const [state, setState] = useState<LinkState>(() =>
    openedLinkKeys.has(linkKey) ? { status: "opened" } : { status: "opening" },
  );
  const [started, setStarted] = useState(false);
  const [launch, setLaunch] = useState<LinkLaunch | null>(null);
  const launchedRef = useRef<LinkLaunch | null>(null);

  const recentProjects = () =>
    sortProjectsByActivity(
      projects.filter((project) => project.isScratch !== true),
      threads,
    );

  // Web falls back to its primary environment; t3-term's first catalog entry plays that part.
  const lastActiveEnvironmentId = (): EnvironmentId | null => {
    let latest: EnvironmentThreadShell | undefined;
    for (const thread of threads) {
      if (latest === undefined || thread.updatedAt > latest.updatedAt) latest = thread;
    }
    return latest?.environmentId ?? readEnvironmentIds()[0] ?? null;
  };

  const openDraft = (project: EnvironmentProject, extraPrompt?: string) => {
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    startNewThread(projectRef);
    setState({ status: "opened" });
    const key = draftKeyOf(projectRef);
    const notes: Array<string> = [];
    if (link.kind === "new" && link.provider !== null) {
      const providers =
        appAtomRegistry.get(environmentPresentations.providersByEnvironmentAtom).get(project.environmentId) ?? [];
      const resolved = resolvePromptLinkModelSelection(providers, {
        provider: link.provider,
        model: link.model,
      });
      if (resolved !== null) {
        // Web's setModelSelection leaves the sticky (last picked) model alone.
        setComposerModelSelection(key, resolved.selection, { sticky: false, explicit: true, replaceOptions: true });
      }
      if (resolved === null || !resolved.exact) {
        notes.push(
          resolved === null
            ? `The link asked for ${link.provider}, which is not set up here, so your default model is used.`
            : `The link asked for ${link.model}, which ${link.provider} does not offer here, so its default model is used.`,
        );
      }
    }
    const text = [link.prompt?.text, extraPrompt].filter(Boolean).join("\n\n");
    if (text.length === 0) return;
    placeLinkedPrompt(
      { kind: "draft", environmentId: project.environmentId, projectId: project.id },
      { text, hiddenCharacters: link.prompt?.hiddenCharacters ?? 0 },
      notes,
    );
  };

  const openScratchDraft = async () => {
    const environmentId = scratchEnvironmentId(lastActiveEnvironmentId()) ?? scratchEnvironmentId(null);
    const project = environmentId === null ? null : await openScratchProject(environmentId);
    if (project === null) {
      setState({
        status: "failed",
        message: "None of your machines can start a thread without a project right now.",
      });
      return;
    }
    openDraft(project, link.kind === "pull-request" ? promptLinkPullRequestUrl(link.pullRequest) : undefined);
  };

  const openWithoutProject = () => {
    setState({ status: "opening" });
    void openScratchDraft();
  };

  const cloneRepository = async (repository: PromptLinkRepository) => {
    const environmentId = lastActiveEnvironmentId();
    const serverConfig = readServerConfig(environmentId);
    const newProjectsRoot = serverConfig?.newProjectsRoot ?? null;
    if (
      environmentId === null ||
      newProjectsRoot === null ||
      serverConfig?.environment.capabilities.projectCloneTracking !== true
    ) {
      setState({
        status: "failed",
        message:
          "This machine cannot clone from a link. Update T3 Code on it, or clone the repository from the command palette.",
      });
      return;
    }
    setState({ status: "opening" });
    const projectId = ProjectId.make(crypto.randomUUID());
    const result = await runPullRequestWrite(sourceControlEnvironment.startProjectClone, {
      environmentId,
      input: {
        projectId,
        title: repository.name,
        createdAt: new Date().toISOString(),
        remoteUrl: `https://github.com/${repository.owner}/${repository.name}.git`,
        destinationPath: getCloneDestinationPath(newProjectsRoot, repository.name),
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toast({
          type: "error",
          title: "Clone failed",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      setState({ status: "missing-repository", repository });
      return;
    }
    const project = await waitForProject(scopeProjectRef(environmentId, projectId), 5_000);
    if (project === null) {
      setState({ status: "failed", message: "The clone started, but its project did not appear." });
      return;
    }
    if (link.kind === "pull-request") {
      setState({
        status: "failed",
        title: `Cloning ${repository.owner}/${repository.name}`,
        message: "Open this link again when the clone finishes.",
      });
      return;
    }
    openDraft(project);
  };

  if (ready && state.status === "opening" && !started) {
    setStarted(true);
    const pullRequestThread =
      link.kind === "pull-request" ? findPromptLinkPullRequestThread(threads, link.pullRequest) : undefined;
    const repository = link.kind === "new" ? link.repository : link.pullRequest;
    const project =
      repository === null
        ? undefined
        : (findPromptLinkProject(recentProjects(), repository) ?? screenshotLinkProject(projects));
    if (pullRequestThread !== undefined) {
      setState({ status: "opened" });
      setLaunch({ kind: "thread", thread: pullRequestThread });
    } else if (repository === null) {
      setLaunch({ kind: "scratch" });
    } else if (project === undefined) {
      setState({ status: "missing-repository", repository });
      setLaunch({ kind: "settled" });
    } else if (link.kind === "pull-request") {
      setState({ status: "pull-request-checkout", project });
      setLaunch({ kind: "settled" });
    } else {
      setLaunch({ kind: "draft", project });
    }
  }

  const runLaunch = useEffectEvent((next: LinkLaunch) => {
    openedLinkKeys.add(linkKey);
    switch (next.kind) {
      case "thread": {
        const { environmentId, id: threadId } = next.thread;
        if (link.prompt !== null) placeLinkedPrompt({ kind: "thread", environmentId, threadId }, link.prompt);
        openThread({ environmentId, threadId });
        return;
      }
      case "scratch":
        void openScratchDraft();
        return;
      case "draft":
        openDraft(next.project);
        return;
      case "settled":
    }
  });

  useEffect(() => {
    if (launch === null || launchedRef.current === launch) return;
    launchedRef.current = launch;
    runLaunch(launch);
  }, [launch]);

  switch (state.status) {
    case "opening":
      return <LinkPage title="Opening the link..." />;
    case "opened":
      return (
        <LinkPage title="This link is open">
          <Button
            size="sm"
            variant="outline"
            testId="prompt-link-open-again"
            onClick={() => {
              openedLinkKeys.delete(linkKey);
              setStarted(false);
              setState({ status: "opening" });
            }}
          >
            Open it again
          </Button>
        </LinkPage>
      );
    case "failed":
      return <LinkPage title={state.title ?? "Could not open the link"} description={state.message} />;
    case "missing-repository": {
      const name = `${state.repository.owner}/${state.repository.name}`;
      return (
        <LinkPage title={`You don't have ${name}`} description="Clone it to work on it here, or start without a project.">
          <Button size="sm" testId="prompt-link-clone" onClick={() => void cloneRepository(state.repository)}>
            {`Clone ${name}`}
          </Button>
          <Button size="sm" variant="outline" testId="prompt-link-without-project" onClick={openWithoutProject}>
            Use without project
          </Button>
        </LinkPage>
      );
    }
    case "pull-request-checkout":
      return link.kind === "pull-request" ? <PullRequestLinkCheckout link={link} project={state.project} /> : null;
  }
}

/** apps/web/src/components/pullRequest/pullRequestCheckoutToast.ts */
const OFF_HEAD_PULL_REQUEST_CHECKOUT_TOAST = {
  type: "warning",
  title: "Checked out, but not confirmed on the latest commit",
  description:
    "This checkout could not be confirmed at the pull request's latest commit, so its code may differ. Local commits or uncommitted work keep a checkout where it is.",
} as const;

/**
 * usePullRequestHandoffs().startHandoff("prompt-link", task) in worktree mode. Web opens the
 * draft first and passes its thread id, so the checkout runs the project's setup script for that
 * thread; a t3-term draft has no thread id until it launches, so the worktree is prepared on its
 * own and the draft is pointed at it afterwards, as web does in its second step.
 */
async function startPullRequestCheckout(
  project: EnvironmentProject,
  url: string,
  task: { readonly prompt: string } | null,
): Promise<boolean> {
  const toastId = toast({ type: "loading", title: "Preparing the pull request checkout..." });
  const projectRef = scopeProjectRef(project.environmentId, project.id);
  const prepared = await runPullRequestWrite(gitEnvironment.preparePullRequestThread, {
    environmentId: project.environmentId,
    input: { cwd: project.workspaceRoot, reference: url, mode: "worktree" },
  });
  if (prepared._tag === "Failure") {
    updateToast(toastId, {
      type: "error",
      title: "Could not prepare the pull request checkout",
      description: checkoutFailureDescription(
        isAtomCommandInterrupted(prepared) ? undefined : squashAtomCommandFailure(prepared),
      ),
    });
    return false;
  }
  const { branch, worktreePath, isOnPullRequestHead } = prepared.value;
  startNewThread(projectRef);
  const key = draftKeyOf(projectRef);
  setDraftWorkspace(key, { envMode: worktreePath === null ? "local" : "worktree", branch, worktreePath });
  if (task === null) {
    updateToast(
      toastId,
      isOnPullRequestHead
        ? {
            type: "success",
            title: "Checked out",
            description: "The pull request is in its own worktree, with a thread open on it.",
          }
        : OFF_HEAD_PULL_REQUEST_CHECKOUT_TOAST,
    );
    return true;
  }
  setComposerPrompt(key, handoffPrompt({ prompt: readComposerDraft(key).prompt, lastHandoffPrompt: undefined }, task.prompt));
  updateToast(
    toastId,
    isOnPullRequestHead
      ? {
          type: "success",
          title: "Checkout ready",
          description: "The task is in the composer. Read it over, then send.",
        }
      : OFF_HEAD_PULL_REQUEST_CHECKOUT_TOAST,
  );
  return true;
}

/**
 * The checkout runs the project's setup script on code from the pull request, so a link alone
 * never starts it.
 */
function PullRequestLinkCheckout({
  link,
  project,
}: {
  readonly link: Extract<NewThreadLink, { kind: "pull-request" }>;
  readonly project: EnvironmentProject;
}) {
  const [checkingOut, setCheckingOut] = useState(false);
  const warnedRef = useRef(false);
  useEffect(() => {
    if (warnedRef.current || link.prompt === null) return;
    warnedRef.current = true;
    warnAboutHiddenCharacters(link.prompt);
  }, [link.prompt]);
  const { owner, name, number } = link.pullRequest;
  return (
    <LinkPage
      title={`Check out ${owner}/${name}#${number}?`}
      description="This puts the pull request's code in a new worktree and runs your project's setup script on it."
    >
      <Button
        size="sm"
        disabled={checkingOut}
        testId="prompt-link-checkout"
        onClick={() => {
          setCheckingOut(true);
          void startPullRequestCheckout(
            project,
            promptLinkPullRequestUrl(link.pullRequest),
            link.prompt === null ? null : { prompt: link.prompt.text },
          ).then((done) => {
            if (!done) setCheckingOut(false);
          });
        }}
      >
        {checkingOut ? "Checking out..." : "Check out"}
      </Button>
    </LinkPage>
  );
}
