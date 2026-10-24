// apps/web/src/components/pullRequest/PullRequestMarkdown.tsx `PullRequestMarkdownContext`: the
// open pull request's repository (for `#123` and SHA autolinks) and where its links open (the
// thread whose panel shows it, or the Pull requests page).
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { createContext } from "react";

export const PullRequestMarkdownContext = createContext<{
  readonly repositoryUrl: string | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly environmentId: EnvironmentId | null;
} | null>(null);
