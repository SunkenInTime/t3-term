// apps/web/src/components/chat/useComposerStash.ts: setting the draft aside (mod+S),
// restoring or deleting an entry, the badge pulse and the menu's open state.
// Attachments are file paths here, so there is no image re-encoding and no upload
// verification; a stashed path that has since vanished is dropped on restore.
import * as NodeFs from "node:fs";

import { useAtomValue } from "@effect/atom-react";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { addComposerAttachments, readComposerDraft, setComposerPrompt, clearComposerContent } from "../../state/composer.ts";
import {
  MAX_STASH_ENTRIES,
  type PromptStashEntry,
  promptStashEntriesAtom,
  readPromptStashEntries,
  stashPromptEntry,
  takePromptStashEntry,
} from "../../state/promptStash.ts";
import { toast } from "../../ui/toast.tsx";

export function useComposerStash(input: {
  readonly draftKey: string;
  /** The editor's current text; the menu closes when it changes (web). */
  readonly prompt: string;
  /** The slash/mention menu is open; the stash menu gives way to it. */
  readonly commandMenuOpen: boolean;
  readonly onPromptRestored: () => void;
}) {
  const { draftKey, prompt, commandMenuOpen, onPromptRestored } = input;
  const entries = useAtomValue(promptStashEntriesAtom);
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pulsing, setPulsing] = useState(false);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
  }, []);

  const [closesOn, setClosesOn] = useState({ prompt, commandMenuOpen });
  if (closesOn.prompt !== prompt || closesOn.commandMenuOpen !== commandMenuOpen) {
    setClosesOn({ prompt, commandMenuOpen });
    if (closesOn.prompt !== prompt || commandMenuOpen) setMenuOpen(false);
  }

  const pulse = () => {
    setPulsing(true);
    if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => {
      pulseTimerRef.current = null;
      setPulsing(false);
    }, 1200);
  };

  const restore = (menuEntry: PromptStashEntry) => {
    setMenuOpen(false);
    const { entry, durable } = takePromptStashEntry(menuEntry.id);
    if (!entry) return;
    if (!durable) {
      toast({
        type: "warning",
        title: "Restored prompt may reappear in the stash",
        description: "The stash file could not be updated, so this entry could still be there after a restart.",
      });
    }
    const current = readComposerDraft(draftKey);
    const nextPrompt =
      entry.prompt.length === 0
        ? current.prompt
        : current.prompt.trim().length > 0
          ? `${current.prompt.replace(/\s+$/, "")}\n\n${entry.prompt}`
          : entry.prompt;
    if (nextPrompt !== current.prompt) setComposerPrompt(draftKey, nextPrompt);
    const existing = new Set(current.attachments.map((attachment) => attachment.path));
    const missing: string[] = [];
    const pending = entry.attachments.filter((attachment) => {
      if (existing.has(attachment.path)) return false;
      if (NodeFs.existsSync(attachment.path)) return true;
      missing.push(attachment.name);
      return false;
    });
    const capacity = Math.max(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS - current.attachments.length);
    const skipped = pending.slice(capacity).map((attachment) => attachment.name);
    addComposerAttachments(draftKey, pending.slice(0, capacity));
    const reasons: string[] = [];
    if (missing.length > 0) reasons.push(`${missing.join(", ")} no longer exist on disk.`);
    if (skipped.length > 0) {
      reasons.push(
        `${skipped.join(", ")} could not be restored: the composer is at its ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}-attachment limit.`,
      );
    }
    if (reasons.length > 0) {
      toast({ type: "warning", title: "Some attachments were not restored", description: reasons.join(" ") });
    }
    onPromptRestored();
  };

  const remove = (entry: PromptStashEntry) => {
    const { durable } = takePromptStashEntry(entry.id);
    if (!readPromptStashEntries().length) setMenuOpen(false);
    if (!durable) {
      toast({
        type: "warning",
        title: "Stash entry may come back",
        description: "The stash file could not be updated, so this prompt could reappear after a restart.",
      });
    }
  };

  /** web stashCurrentPrompt: an empty composer restores the only entry or toggles the menu instead. */
  const stashCurrent = () => {
    const draft = readComposerDraft(draftKey);
    const trimmed = draft.prompt.trim();
    if (trimmed.length === 0 && draft.attachments.length === 0) {
      const all = readPromptStashEntries();
      if (all.length === 1 && all[0]) restore(all[0]);
      else setMenuOpen((open) => !open);
      return;
    }
    const { written, evicted } = stashPromptEntry({
      id: globalThis.crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      prompt: trimmed,
      attachments: draft.attachments,
    });
    if (!written) {
      toast({
        type: "error",
        title: "Could not stash this prompt",
        description: "The stash file could not be written, so the composer was left as-is.",
      });
      return;
    }
    clearComposerContent(draftKey);
    pulse();
    if (evicted) {
      toast({
        type: "warning",
        title: "Oldest stashed prompt discarded",
        description: `The stash holds ${MAX_STASH_ENTRIES} prompts; the oldest was removed to make room.`,
      });
    }
  };

  const highlighted = entries.find((entry) => entry.id === highlightedId) ?? entries[0] ?? null;
  const nudge = (direction: 1 | -1) => {
    if (entries.length === 0) return;
    const index = highlighted ? entries.indexOf(highlighted) : -1;
    const normalized = index >= 0 ? index : direction > 0 ? -1 : 0;
    setHighlightedId(entries[(normalized + direction + entries.length) % entries.length]?.id ?? null);
  };

  return {
    entries,
    menuOpen,
    pulsing,
    highlightedId: highlighted?.id ?? null,
    setHighlightedId,
    toggleMenu: () => setMenuOpen((open) => !open),
    close: () => setMenuOpen(false),
    nudge,
    restore,
    restoreHighlighted: () => {
      if (highlighted) restore(highlighted);
    },
    remove,
    stashCurrent,
  };
}
