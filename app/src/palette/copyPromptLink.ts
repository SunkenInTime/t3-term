// Prompt links to share the composer's prompt, after
// apps/web/src/components/promptLinks/copyPromptLink.ts. The draft comes from the
// composer draft atoms instead of web's zustand store.
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { type ModelSelection, repositoryGroupingKeyOf, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import {
  buildNewThreadLink,
  parsePromptLinkRepository,
  PROMPT_LINK_MAX_PROMPT_LENGTH,
  type PromptLinkRepository,
} from "@t3tools/shared/promptLinks";

import { readComposerDraft } from "../state/composer.ts";
import { toast } from "../ui/toast.tsx";
import { writeTextToClipboard } from "./clipboard.ts";

/**
 * web configuredHostedAppUrl: VITE_HOSTED_APP_URL, else the public hosted app. t3-term
 * reads the same name from its environment.
 */
function configuredHostedAppUrl(): string {
  return process.env.VITE_HOSTED_APP_URL?.trim() || DEFAULT_HOSTED_APP_URL;
}

/** A shareable link to a prompt on the hosted app, or null when the prompt cannot fit in one. */
export function promptLinkFor(
  prompt: string,
  context?: {
    readonly repository: PromptLinkRepository | null;
    readonly provider: string | null;
    readonly model: string | null;
  },
): string | null {
  const trimmed = prompt.trim();
  if (trimmed.length === 0 || trimmed.length > PROMPT_LINK_MAX_PROMPT_LENGTH) return null;
  return buildNewThreadLink({ prompt: trimmed, ...context, origin: configuredHostedAppUrl() });
}

export function promptLinkRepositoryOf(
  project: Pick<EnvironmentProject, "repositoryIdentity"> | undefined,
): PromptLinkRepository | null {
  const identity = project?.repositoryIdentity;
  if (identity == null) return null;
  const key = repositoryGroupingKeyOf(identity);
  return key.startsWith("github.com/") ? parsePromptLinkRepository(key.slice("github.com/".length)) : null;
}

export function composerPromptLink(input: {
  /** The composer draft key (state/composer.ts composerTargetKey) of the route's thread or draft. */
  readonly draftKey: string;
  readonly project: EnvironmentProject | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly threadModelSelection: ModelSelection | null;
  readonly withContext: boolean;
}): string | null {
  const draft = readComposerDraft(input.draftKey);
  if (!input.withContext) return promptLinkFor(draft.prompt);
  const selection =
    (draft.activeProvider ? draft.modelSelectionByProvider[draft.activeProvider] : undefined) ??
    input.threadModelSelection;
  const provider = selection
    ? (input.providers.find((candidate) => candidate.instanceId === selection.instanceId)?.driver ?? null)
    : null;
  return promptLinkFor(draft.prompt, {
    repository: promptLinkRepositoryOf(input.project),
    provider,
    model: provider === null ? null : (selection?.model ?? null),
  });
}

export async function copyPromptLink(link: string): Promise<void> {
  try {
    if (!(await writeTextToClipboard(link))) {
      toast({ type: "error", title: "Could not copy the prompt link", description: "The system clipboard is unavailable." });
      return;
    }
    toast({ type: "success", title: "Prompt link copied" });
  } catch (error) {
    toast({
      type: "error",
      title: "Could not copy the prompt link",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
}
