// Port of apps/web/src/components/promptLinks/linkedPrompt.ts. Web's composer draft store and
// toastManager are t3-term's composer atoms (state/composer.ts) and ui/toast.tsx.
import type { LinkedPrompt } from "@t3tools/shared/promptLinks";

import {
  type ComposerTarget,
  composerTargetKey,
  readComposerDraft,
  setComposerPrompt,
} from "../state/composer.ts";
import { dismissToast, toast } from "../ui/toast.tsx";

export function warnAboutHiddenCharacters(prompt: LinkedPrompt): void {
  if (prompt.hiddenCharacters === 0) return;
  toast({
    type: "warning",
    title: "This prompt had hidden characters, it may be malicious",
    description: `T3 Code removed ${prompt.hiddenCharacters} hidden character${prompt.hiddenCharacters === 1 ? "" : "s"}. Read the prompt before you send it.`,
    duration: 0,
  });
}

export function placeLinkedPrompt(
  target: ComposerTarget,
  prompt: LinkedPrompt,
  notes: ReadonlyArray<string> = [],
): void {
  warnAboutHiddenCharacters(prompt);
  const key = composerTargetKey(target);
  const place = () => {
    setComposerPrompt(key, prompt.text);
    toast({
      type: "info",
      title: "Prompt added from a link",
      description: ["Read it before you send.", ...notes].join(" "),
    });
  };
  const existing = readComposerDraft(key).prompt;
  if (existing.trim().length === 0 || existing === prompt.text) {
    place();
    return;
  }
  const id = toast({
    type: "info",
    title: "Linked prompt ready",
    description: "This thread already has a draft. Replace it with the linked prompt?",
    duration: 0,
    action: {
      label: "Replace draft",
      onClick: () => {
        dismissToast(id);
        place();
      },
    },
  });
}
