// The prompt stash: prompts set aside with mod+S, newest first, restored or deleted
// from the stash menu above the composer. After apps/web/src/promptStashStore.ts.
// Web encodes images into localStorage; t3-term attachments are files on disk, so an
// entry keeps their paths and the stash is a JSON file under $T3TERM_HOME.
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { termHome } from "../runtime/paths.ts";
import type { ComposerAttachmentDraft } from "./composer.ts";

export const MAX_STASH_ENTRIES = 20;

export interface PromptStashEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<ComposerAttachmentDraft>;
}

const STORAGE_VERSION = 1;

function stashPath(): string {
  return NodePath.join(termHome(), "prompt-stash.json");
}

function readPersistedEntries(): ReadonlyArray<PromptStashEntry> {
  try {
    const parsed = JSON.parse(NodeFs.readFileSync(stashPath(), "utf8")) as {
      version?: number;
      entries?: ReadonlyArray<PromptStashEntry>;
    };
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(
      (entry) => typeof entry?.id === "string" && typeof entry.prompt === "string" && Array.isArray(entry.attachments),
    );
  } catch {
    return [];
  }
}

/**
 * Written at once rather than debounced, like web: stashing is a deliberate keystroke and
 * the composer clears only once the write has landed.
 */
function persistEntries(entries: ReadonlyArray<PromptStashEntry>): boolean {
  try {
    NodeFs.mkdirSync(termHome(), { recursive: true });
    const path = stashPath();
    const temp = `${path}.tmp`;
    NodeFs.writeFileSync(temp, JSON.stringify({ version: STORAGE_VERSION, entries }));
    NodeFs.renameSync(temp, path);
    return true;
  } catch (error) {
    console.error("[PROMPT-STASH] Could not persist stash.", error);
    return false;
  }
}

export const promptStashEntriesAtom = Atom.make<ReadonlyArray<PromptStashEntry>>(readPersistedEntries()).pipe(
  Atom.keepAlive,
);

export function readPromptStashEntries(): ReadonlyArray<PromptStashEntry> {
  return appAtomRegistry.get(promptStashEntriesAtom);
}

/** Adds an entry at the front. A failed write keeps nothing, so the caller leaves the composer as it is. */
export function stashPromptEntry(entry: PromptStashEntry): { written: boolean; evicted: PromptStashEntry | null } {
  const next = [entry, ...readPromptStashEntries()];
  const evicted = next.length > MAX_STASH_ENTRIES ? (next.pop() ?? null) : null;
  if (!persistEntries(next)) return { written: false, evicted: null };
  appAtomRegistry.set(promptStashEntriesAtom, next);
  return { written: true, evicted };
}

/** Removes an entry and returns it; `durable` is false when the removal could not be saved. */
export function takePromptStashEntry(entryId: string): { entry: PromptStashEntry | null; durable: boolean } {
  const entries = readPromptStashEntries();
  const entry = entries.find((candidate) => candidate.id === entryId) ?? null;
  if (!entry) return { entry: null, durable: true };
  const next = entries.filter((candidate) => candidate.id !== entryId);
  const durable = persistEntries(next);
  appAtomRegistry.set(promptStashEntriesAtom, next);
  return { entry, durable };
}
