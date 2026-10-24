// Port of apps/web/src/components/chat/ComposerFeedback.tsx: the composer notice for a
// /feedback upload to OpenAI (Codex threads), plus the per-thread submission list web
// keeps in ChatView state.
import { codexFeedbackNotice, type CodexFeedbackSubmission } from "@t3tools/client-runtime/state/threads";
import { Atom } from "effect/reactivity";

import { copyToClipboard } from "../../lib/clipboard.ts";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { Button } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import type { ComposerBannerStackItem } from "./ComposerBannerStack.tsx";
import { BannerGlyph } from "./useSystemComposerBanners.tsx";

const NO_SUBMISSIONS: ReadonlyArray<CodexFeedbackSubmission> = [];

/** web ChatView feedbackSubmissionsByThreadKey, one atom per thread key. */
export const feedbackSubmissionsAtom = Atom.family((_threadKey: string) =>
  Atom.make<ReadonlyArray<CodexFeedbackSubmission>>(NO_SUBMISSIONS).pipe(Atom.keepAlive),
);

/** Threads with a /feedback upload in flight; a second one waits (web feedbackUploadsInFlightRef). */
export const feedbackUploadsInFlight = new Set<string>();

export function upsertFeedbackSubmission(threadKey: string, submission: CodexFeedbackSubmission): void {
  const atom = feedbackSubmissionsAtom(threadKey);
  const existing = appAtomRegistry.get(atom);
  const found = existing.some((entry) => entry.id === submission.id);
  appAtomRegistry.set(
    atom,
    found ? existing.map((entry) => (entry.id === submission.id ? submission : entry)) : [...existing, submission],
  );
}

export function removeFeedbackSubmission(threadKey: string, id: string): void {
  const atom = feedbackSubmissionsAtom(threadKey);
  appAtomRegistry.set(
    atom,
    appAtomRegistry.get(atom).filter((entry) => entry.id !== id),
  );
}

export function feedbackBannerItem(
  submission: CodexFeedbackSubmission,
  onDismiss: () => void,
): ComposerBannerStackItem | null {
  const notice = codexFeedbackNotice(submission);
  if (!notice) return null;
  return {
    id: `feedback:${submission.id}`,
    variant: submission.status === "failed" ? "error" : submission.status === "sent" ? "success" : "info",
    priority: submission.status === "uploading" ? "activity" : "notice",
    icon: <BannerGlyph name="message-square" />,
    title: notice.title,
    ...(notice.description === undefined ? {} : { description: notice.description }),
    actions:
      submission.status === "sent" ? (
        <Button
          size="xs"
          variant="ghost"
          testId="feedback-copy-id"
          onClick={() => {
            void copyToClipboard(submission.feedbackId).then((copied) => {
              if (!copied) {
                toast({ type: "error", title: "Could not copy thread ID", description: "The clipboard is unavailable." });
              }
            });
          }}
        >
          Copy ID
        </Button>
      ) : undefined,
    ...(submission.status !== "uploading" ? { dismissLabel: "Dismiss feedback notice", onDismiss } : {}),
  };
}
