// A composer draft for ComposerBody that doesn't re-render it for every keystroke.
//
// ComposerBody draws the whole composer around the prompt editor (toolbar, model picker,
// banners, attachments): about 2.5 ms of React per render in a production build, against
// under 0.3 ms for the editor, which draws its own text. GPUI can't draw the keystroke until
// that commit lands, so typing paid for ComposerBody on every key. A draft change that is
// only prompt text the editor itself just reported now reaches ComposerBody once typing
// pauses. Everything else (another field, the prompt becoming empty or non-empty, text set
// from outside the editor) re-renders at once.
//
// The store is always current: readComposerDraft and any render ComposerBody does for
// another reason see the latest prompt. Only the re-render is late, so nothing that reads
// the draft imperatively (send, history, stash) can see a stale value.
import { useCallback, useSyncExternalStore } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { type ComposerDraft, composerDraftAtom } from "../../state/composer.ts";

// Longer than the gap between keys in steady typing, so the deferred render lands in a pause
// instead of on the next keystroke.
const TYPING_RENDER_DELAY_MS = 300;

// The last prompt the editor reported per draft key. The atom registry may notify a derived
// draft atom after the write returns, so this outlives the write; a later write of other text
// (send clearing it, history recall) no longer matches.
const editorTyped = new Map<string, string>();

/** Runs a draft write the prompt editor caused, marking it as typing. */
export function writeTypedPrompt(key: string, prompt: string, write: () => void): void {
  editorTyped.set(key, prompt);
  write();
}

function isTypingOnly(key: string, previous: ComposerDraft, next: ComposerDraft): boolean {
  if (editorTyped.get(key) !== next.prompt || previous.prompt === next.prompt) return false;
  if ((previous.prompt.trim().length === 0) !== (next.prompt.trim().length === 0)) return false;
  const previousKeys = Object.keys(previous) as Array<keyof ComposerDraft>;
  const nextKeys = Object.keys(next) as Array<keyof ComposerDraft>;
  if (previousKeys.length !== nextKeys.length) return false;
  // A prompt write also stamps updatedAt, which nothing in the composer draws.
  return nextKeys.every((field) => field === "prompt" || field === "updatedAt" || next[field] === previous[field]);
}

export function useTypingDeferredDraft(key: string): ComposerDraft {
  const atom = composerDraftAtom(key);
  const subscribe = useCallback(
    (notify: () => void) => {
      let last = appAtomRegistry.get(atom);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const unsubscribe = appAtomRegistry.subscribe(atom, (next) => {
        const deferred = isTypingOnly(key, last, next);
        last = next;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (!deferred) return notify();
        timer = setTimeout(() => {
          timer = null;
          notify();
        }, TYPING_RENDER_DELAY_MS);
      });
      return () => {
        if (timer !== null) clearTimeout(timer);
        unsubscribe();
      };
    },
    [atom, key],
  );
  return useSyncExternalStore(subscribe, () => appAtomRegistry.get(atom));
}
