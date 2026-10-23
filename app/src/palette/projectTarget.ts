// Port of apps/web/src/hooks/useActiveProjectTarget.ts: the project (and checkout)
// the route's thread works in. Drafts have no thread yet, so like web they have
// no target until the thread exists.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentProjects, environmentThreadShells } from "../state/environment.ts";
import { routeAtom } from "../state/ui.ts";

export interface ActiveProjectTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly threadId: ThreadId;
}

const NO_THREAD_ATOM = Atom.make<EnvironmentThreadShell | null>(null);

export function useRouteThreadShell(): EnvironmentThreadShell | null {
  const route = useAtomValue(routeAtom);
  return useAtomValue(
    route.kind === "thread"
      ? environmentThreadShells.threadShellAtom(scopeThreadRef(route.environmentId, route.threadId))
      : NO_THREAD_ATOM,
  );
}

export function useActiveProjectTarget(): ActiveProjectTarget | null {
  const thread = useRouteThreadShell();
  const projects = useAtomValue(environmentProjects.projectsAtom);
  if (!thread) return null;
  const project = projects.find(
    (candidate) => candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
  );
  const cwd = thread.worktreePath ?? project?.workspaceRoot;
  if (!project || !cwd) return null;
  return { environmentId: project.environmentId, cwd, projectName: project.title, threadId: thread.id };
}
