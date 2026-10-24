// Composer state: per-target drafts persisted under $T3TERM_HOME, the settings the
// composer reads, and open requests that keybindings and the palette can fire.
// Draft shape after apps/web/src/composerDraftStore.ts (ComposerThreadDraftState),
// with attachments held as local file paths instead of browser File objects.
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import {
  DEFAULT_SERVER_SETTINGS,
  type ThreadContextRecord,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type ProviderOptionSelection,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { type UnifiedSettings } from "@t3tools/contracts/settings";
import { createAttachmentEnvironmentAtoms } from "@t3tools/client-runtime/state/attachments";
import { resolveModelPreferences } from "@t3tools/shared/serverSettings";
import { Atom } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import {
  appendInlineContextReference,
  collectInlineContextIds,
  formatInlineContextReference,
  removeInlineContextReference,
} from "../web/lib/composerContextReferences.ts";
import {
  reviewCommentContextId,
  reviewCommentContextReference,
  terminalContextReference,
  threadContextReference,
} from "../web/lib/composerContextRecords.ts";
import type { TerminalContextDraft } from "../web/lib/terminalContext.ts";
import type { ReviewCommentContext } from "../web/reviewCommentContext.ts";
import type { ChatMessage } from "../web/types.ts";
import { clientSettingsAtom } from "./clientSettings.ts";
import { termHome } from "../runtime/paths.ts";
import { serverEnvironment } from "./environment.ts";
import { modelPickerOpenAtom } from "./ui.ts";

/** Upload URL minting and pending-upload release (client-runtime state/attachments). */
export const composerAttachmentEnvironment = createAttachmentEnvironmentAtoms(connectionAtomRuntime);

// ── Targets ─────────────────────────────────────────────────────────────

export type ComposerTarget =
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  | {
      readonly kind: "draft";
      readonly environmentId: EnvironmentId | null;
      readonly projectId: ProjectId | null;
      /** Further drafts in the same project (web draftId); absent for the first. */
      readonly draftId?: string;
    };

/**
 * One draft per thread. New-thread drafts: the project's first draft, plus any number of
 * further ones (web useHandleNewThread keeps a draft that has content and opens another).
 */
export function composerTargetKey(target: ComposerTarget): string {
  if (target.kind === "thread") return `thread:${target.environmentId}:${target.threadId}`;
  const base = `draft:${target.environmentId ?? "-"}:${target.projectId ?? "-"}`;
  return target.draftId ? `${base}:${target.draftId}` : base;
}

/** The draft id in a new-thread draft key (`draft:<env>:<project>:<draftId>`), if any. */
export function draftIdOfKey(key: string): string | undefined {
  if (!key.startsWith("draft:")) return undefined;
  return key.split(":")[3] || undefined;
}

// ── Draft shape ─────────────────────────────────────────────────────────

export interface ComposerAttachmentDraft {
  readonly id: string;
  readonly type: "image" | "file";
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Local path the bytes are read from at send time. */
  readonly path: string;
  /** Set once the bytes are on a server, so a retry does not upload them again. */
  readonly uploadedAttachmentId?: string;
  readonly uploadEnvironmentId?: EnvironmentId;
}

export type DraftThreadEnvMode = "local" | "worktree";

export interface ComposerDraft {
  readonly prompt: string;
  readonly attachments: ReadonlyArray<ComposerAttachmentDraft>;
  readonly modelSelectionByProvider: Readonly<Partial<Record<ProviderInstanceId, ModelSelection>>>;
  readonly activeProvider: ProviderInstanceId | null;
  /** The user picked the model here (web modelSelectionExplicit); a carried-over model does not count. */
  readonly modelSelectionExplicit?: boolean;
  readonly runtimeMode: RuntimeMode | null;
  readonly interactionMode: ProviderInteractionMode | null;
  /** New-thread drafts only: where the thread runs. */
  readonly envMode?: DraftThreadEnvMode;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly startFromOrigin?: boolean;
  /**
   * Diff and file line comments (web ComposerThreadDraftState.reviewComments). Each one has
   * an inline `t3-context://` reference in the prompt and goes out as a message context record.
   */
  readonly reviewComments?: ReadonlyArray<ReviewCommentContext>;
  /**
   * Terminal selections added with "Add to chat" (web ComposerThreadDraftState.terminalContexts).
   * Shown as chips; each goes out as an inline reference in the message text plus a context record.
   */
  readonly terminalContexts?: ReadonlyArray<TerminalContextDraft>;
  /** Threads dropped on the composer (web ComposerThreadDraftState.threadContexts). */
  readonly threadContexts?: ReadonlyArray<ThreadContextRecord>;
  readonly updatedAt?: string;
}

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  prompt: "",
  attachments: [],
  modelSelectionByProvider: {},
  activeProvider: null,
  runtimeMode: null,
  interactionMode: null,
};

export function composerDraftHasUserContent(draft: ComposerDraft | null | undefined): boolean {
  return Boolean(
    draft &&
      (draft.prompt.trim().length > 0 ||
        draft.attachments.length > 0 ||
        (draft.reviewComments?.length ?? 0) > 0 ||
        (draft.terminalContexts?.length ?? 0) > 0),
  );
}

/** The last model the user picked; new drafts start from it (web: sticky model selection). */
export interface StickyModelState {
  readonly activeProvider: ProviderInstanceId | null;
  readonly modelSelectionByProvider: Readonly<Partial<Record<ProviderInstanceId, ModelSelection>>>;
}

interface PersistedDrafts {
  readonly version: 1;
  readonly drafts: Record<string, ComposerDraft>;
  readonly sticky: StickyModelState;
}

// ── Persistence ─────────────────────────────────────────────────────────

const DRAFTS_FILE = "composer-drafts.json";
const PERSIST_DEBOUNCE_MS = 300;

function draftsPath(): string {
  return NodePath.join(termHome(), DRAFTS_FILE);
}

function loadPersisted(): PersistedDrafts {
  const empty: PersistedDrafts = {
    version: 1,
    drafts: {},
    sticky: { activeProvider: null, modelSelectionByProvider: {} },
  };
  try {
    const parsed = JSON.parse(NodeFs.readFileSync(draftsPath(), "utf8")) as Partial<PersistedDrafts>;
    if (parsed.version !== 1 || typeof parsed.drafts !== "object" || parsed.drafts === null) {
      return empty;
    }
    const drafts: Record<string, ComposerDraft> = {};
    for (const [key, draft] of Object.entries(parsed.drafts)) {
      if (!draft || typeof draft.prompt !== "string") continue;
      drafts[key] = {
        ...EMPTY_COMPOSER_DRAFT,
        ...draft,
        // Paths can vanish between runs; a missing file would fail the send later.
        attachments: (draft.attachments ?? []).filter((attachment) =>
          NodeFs.existsSync(attachment.path),
        ),
      };
    }
    return { version: 1, drafts, sticky: parsed.sticky ?? empty.sticky };
  } catch {
    return empty;
  }
}

const initial = loadPersisted();

export const composerDraftsAtom = Atom.make<Readonly<Record<string, ComposerDraft>>>(
  initial.drafts,
).pipe(Atom.keepAlive);

export const stickyModelAtom = Atom.make<StickyModelState>(initial.sticky).pipe(Atom.keepAlive);

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushComposerDrafts();
  }, PERSIST_DEBOUNCE_MS);
}

export function flushComposerDrafts(): void {
  const drafts: Record<string, ComposerDraft> = {};
  for (const [key, draft] of Object.entries(appAtomRegistry.get(composerDraftsAtom))) {
    // Empty drafts carry only model choices; keep them so a thread remembers its picker state.
    drafts[key] = draft;
  }
  const document: PersistedDrafts = {
    version: 1,
    drafts,
    sticky: appAtomRegistry.get(stickyModelAtom),
  };
  try {
    NodeFs.mkdirSync(termHome(), { recursive: true });
    const path = draftsPath();
    const temp = `${path}.tmp`;
    NodeFs.writeFileSync(temp, JSON.stringify(document));
    NodeFs.renameSync(temp, path);
  } catch (error) {
    console.error("[composer] could not save drafts", error);
  }
}

process.once("beforeExit", () => {
  if (persistTimer !== null) flushComposerDrafts();
});

// ── Reads and writes ────────────────────────────────────────────────────

export const composerDraftAtom = Atom.family((key: string) =>
  Atom.make((get) => get(composerDraftsAtom)[key] ?? EMPTY_COMPOSER_DRAFT),
);

export function readComposerDraft(key: string): ComposerDraft {
  return appAtomRegistry.get(composerDraftsAtom)[key] ?? EMPTY_COMPOSER_DRAFT;
}

export function updateComposerDraft(key: string, update: (draft: ComposerDraft) => ComposerDraft): void {
  const drafts = appAtomRegistry.get(composerDraftsAtom);
  const current = drafts[key] ?? EMPTY_COMPOSER_DRAFT;
  const next = update(current);
  if (next === current) return;
  appAtomRegistry.set(composerDraftsAtom, {
    ...drafts,
    [key]: { ...next, updatedAt: new Date().toISOString() },
  });
  schedulePersist();
}

export function setComposerPrompt(key: string, prompt: string): void {
  updateComposerDraft(key, (draft) => (draft.prompt === prompt ? draft : { ...draft, prompt }));
}

export function addComposerAttachments(
  key: string,
  attachments: ReadonlyArray<ComposerAttachmentDraft>,
): void {
  if (attachments.length === 0) return;
  updateComposerDraft(key, (draft) => ({
    ...draft,
    attachments: [
      ...draft.attachments,
      ...attachments.filter(
        (attachment) => !draft.attachments.some((existing) => existing.path === attachment.path),
      ),
    ],
  }));
}

export function removeComposerAttachment(key: string, attachmentId: string): void {
  updateComposerDraft(key, (draft) => ({
    ...draft,
    attachments: draft.attachments.filter((attachment) => attachment.id !== attachmentId),
  }));
}

/** Clears what a send dispatched; model, mode and workspace choices stay. */
export function clearComposerContent(key: string): void {
  updateComposerDraft(key, (draft) =>
    draft.prompt === "" &&
    draft.attachments.length === 0 &&
    (draft.reviewComments?.length ?? 0) === 0 &&
    (draft.terminalContexts?.length ?? 0) === 0 &&
    (draft.threadContexts?.length ?? 0) === 0
      ? draft
      : { ...draft, prompt: "", attachments: [], reviewComments: [], terminalContexts: [], threadContexts: [] },
  );
}

/** Puts a failed send's prompt and attachments back. */
export function restoreComposerContent(
  key: string,
  content: {
    prompt: string;
    attachments: ReadonlyArray<ComposerAttachmentDraft>;
    reviewComments?: ReadonlyArray<ReviewCommentContext>;
    terminalContexts?: ReadonlyArray<TerminalContextDraft>;
  },
): void {
  updateComposerDraft(key, (draft) => ({
    ...draft,
    prompt: draft.prompt.trim().length > 0 ? `${content.prompt}\n${draft.prompt}` : content.prompt,
    attachments: [...content.attachments, ...draft.attachments],
    reviewComments: [
      ...(content.reviewComments ?? []),
      ...(draft.reviewComments ?? []).filter(
        (comment) => !content.reviewComments?.some((restored) => restored.id === comment.id),
      ),
    ],
    terminalContexts: [
      ...(content.terminalContexts ?? []),
      ...(draft.terminalContexts ?? []).filter(
        (context) => !content.terminalContexts?.some((restored) => restored.id === context.id),
      ),
    ],
  }));
}

/**
 * Adds context records (a restored stash entry's) to a draft, keeping any the draft already
 * has with the same id.
 */
export function addComposerContextRecords(
  key: string,
  records: {
    readonly terminalContexts?: ReadonlyArray<TerminalContextDraft>;
    readonly reviewComments?: ReadonlyArray<ReviewCommentContext>;
    readonly threadContexts?: ReadonlyArray<ThreadContextRecord>;
  },
): void {
  const terminals = records.terminalContexts ?? [];
  const reviews = records.reviewComments ?? [];
  const threads = records.threadContexts ?? [];
  if (terminals.length === 0 && reviews.length === 0 && threads.length === 0) return;
  updateComposerDraft(key, (draft) => ({
    ...draft,
    terminalContexts: [
      ...(draft.terminalContexts ?? []),
      ...terminals.filter((context) => !draft.terminalContexts?.some((existing) => existing.id === context.id)),
    ],
    reviewComments: [
      ...(draft.reviewComments ?? []),
      ...reviews.filter((comment) => !draft.reviewComments?.some((existing) => existing.id === comment.id)),
    ],
    threadContexts: [
      ...(draft.threadContexts ?? []),
      ...threads.filter((record) => !draft.threadContexts?.some((existing) => existing.contextId === record.contextId)),
    ],
  }));
}

// ── Inline context references ──────────────────────────────────────────

/**
 * The mounted composer's "insert at the caret" (web composerDraftStore
 * setContextInsertionHandler), by draft key. Producers outside the composer (the terminal's
 * "Add to chat") hand it a reference; with no composer mounted the reference goes on the end.
 */
const insertionHandlers = new Map<string, (text: string) => boolean>();

export function registerComposerInsertionHandler(key: string, handler: (text: string) => boolean): () => void {
  insertionHandlers.set(key, handler);
  return () => {
    if (insertionHandlers.get(key) === handler) insertionHandlers.delete(key);
  };
}

/** Inserts an inline reference at the composer's caret, or at the end when none is mounted. */
export function insertComposerReference(key: string, reference: string): void {
  const handler = insertionHandlers.get(key);
  if (handler?.(`${reference} `)) return;
  updateComposerDraft(key, (draft) => ({
    ...draft,
    prompt:
      draft.prompt.length === 0 || /\s$/.test(draft.prompt) ? `${draft.prompt}${reference} ` : `${draft.prompt} ${reference} `,
  }));
}

/**
 * web requestCitationComment: after "Cite" inserts a citation, its chip opens the comment
 * editor; Cancel there removes the citation again.
 */
export const citationCommentRequestAtom = Atom.make<{ readonly key: string; readonly source: string; readonly nonce: number } | null>(
  null,
).pipe(Atom.keepAlive);

/** web ChatComposer cite: the citation lands at the caret and asks for a comment. */
export function citeInComposer(key: string, reference: string): void {
  const source = reference.trim();
  insertComposerReference(key, source);
  const previous = appAtomRegistry.get(citationCommentRequestAtom);
  appAtomRegistry.set(citationCommentRequestAtom, { key, source, nonce: (previous?.nonce ?? 0) + 1 });
}

/**
 * web ChatComposer addTerminalContext: the selection's chip lands at the caret, and the
 * excerpt is kept as a record for the send to attach.
 */
export function addComposerTerminalContext(key: string, context: TerminalContextDraft): void {
  updateComposerDraft(key, (draft) => ({
    ...draft,
    terminalContexts: [...(draft.terminalContexts ?? []), context],
  }));
  insertComposerReference(key, formatInlineContextReference(terminalContextReference(context)));
}

/** Terminal excerpts whose chip is still in the prompt; deleting the chip leaves its record out. */
export function referencedTerminalContexts(draft: ComposerDraft, prompt = draft.prompt): ReadonlyArray<TerminalContextDraft> {
  const contexts = draft.terminalContexts ?? [];
  if (contexts.length === 0) return contexts;
  const ids = new Set(collectInlineContextIds(prompt));
  return contexts.filter((context) => ids.has(terminalContextReference(context).contextId));
}

/**
 * web composerDraftStore.addThreadContexts: a thread dropped on the composer. Its chip goes on
 * the end of the prompt (once), its record into the draft.
 */
export function addComposerThreadContext(
  key: string,
  record: ThreadContextRecord,
  options?: { readonly appendReference?: boolean },
): void {
  updateComposerDraft(key, (draft) => {
    const present = options?.appendReference === false || collectInlineContextIds(draft.prompt).includes(record.contextId);
    return {
      ...draft,
      prompt: present ? draft.prompt : appendInlineContextReference(draft.prompt, threadContextReference(record)),
      threadContexts: [...(draft.threadContexts ?? []).filter((entry) => entry.contextId !== record.contextId), record],
    };
  });
  focusComposer();
}

export function referencedThreadContexts(draft: ComposerDraft, prompt = draft.prompt): ReadonlyArray<ThreadContextRecord> {
  const contexts = draft.threadContexts ?? [];
  if (contexts.length === 0) return contexts;
  const ids = new Set(collectInlineContextIds(prompt));
  return contexts.filter((context) => ids.has(context.contextId));
}

/**
 * web composerDraftStore.addReviewComment: stores the comment (replacing one with the same
 * id) and appends its inline reference to the prompt the first time it is added.
 */
export function addComposerReviewComment(key: string, comment: ReviewCommentContext): void {
  updateComposerDraft(key, (draft) => {
    const existing = draft.reviewComments ?? [];
    const alreadyPresent = existing.some((entry) => entry.id === comment.id);
    return {
      ...draft,
      prompt: alreadyPresent
        ? draft.prompt
        : appendInlineContextReference(draft.prompt, reviewCommentContextReference(comment)),
      reviewComments: [...existing.filter((entry) => entry.id !== comment.id), { ...comment }],
    };
  });
}

/** web composerDraftStore.removeReviewComment: drops the comment and its inline reference. */
export function removeComposerReviewComment(key: string, commentId: string): void {
  updateComposerDraft(key, (draft) => {
    const existing = draft.reviewComments ?? [];
    if (!existing.some((entry) => entry.id === commentId)) return draft;
    return {
      ...draft,
      prompt: removeInlineContextReference(draft.prompt, reviewCommentContextId(commentId)).prompt,
      reviewComments: existing.filter((entry) => entry.id !== commentId),
    };
  });
}

/**
 * Review comments whose inline reference is still in the prompt. The composer here is a
 * plain text field, so deleting a reference's text is how a comment is removed from it;
 * web's editor removes the record together with its chip.
 */
export function referencedReviewComments(draft: ComposerDraft, prompt = draft.prompt): ReadonlyArray<ReviewCommentContext> {
  const comments = draft.reviewComments ?? [];
  if (comments.length === 0) return comments;
  return comments.filter((comment) => prompt.includes(`/review-comment/${reviewCommentContextId(comment.id)})`));
}

export function setComposerModelSelection(
  key: string,
  selection: ModelSelection,
  options?: {
    readonly sticky?: boolean;
    /** False for a model carried into a new draft rather than picked by the user. */
    readonly explicit?: boolean;
    /** Take the selection's options as they are (web setModelSelection replaceOptions). */
    readonly replaceOptions?: boolean;
  },
): void {
  updateComposerDraft(key, (draft) => ({
    ...draft,
    activeProvider: selection.instanceId,
    modelSelectionExplicit: options?.explicit ?? true,
    modelSelectionByProvider: {
      ...draft.modelSelectionByProvider,
      [selection.instanceId]: options?.replaceOptions
        ? selection
        : {
            ...selection,
            // A model switch keeps the options the user chose for that instance.
            options: selection.options ?? draft.modelSelectionByProvider[selection.instanceId]?.options,
          },
    },
  }));
  if (options?.sticky !== false) {
    const sticky = appAtomRegistry.get(stickyModelAtom);
    appAtomRegistry.set(stickyModelAtom, {
      activeProvider: selection.instanceId,
      modelSelectionByProvider: { ...sticky.modelSelectionByProvider, [selection.instanceId]: selection },
    });
    schedulePersist();
  }
}

export function setComposerModelOptions(
  key: string,
  instanceId: ProviderInstanceId,
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
): void {
  const selection: ModelSelection = {
    instanceId,
    model,
    ...(options && options.length > 0 ? { options: [...options] } : {}),
  };
  updateComposerDraft(key, (draft) => ({
    ...draft,
    modelSelectionByProvider: { ...draft.modelSelectionByProvider, [instanceId]: selection },
  }));
  const sticky = appAtomRegistry.get(stickyModelAtom);
  appAtomRegistry.set(stickyModelAtom, {
    activeProvider: sticky.activeProvider ?? instanceId,
    modelSelectionByProvider: { ...sticky.modelSelectionByProvider, [instanceId]: selection },
  });
  schedulePersist();
}

export function setComposerRuntimeMode(key: string, runtimeMode: RuntimeMode): void {
  updateComposerDraft(key, (draft) =>
    draft.runtimeMode === runtimeMode ? draft : { ...draft, runtimeMode },
  );
}

export function setComposerInteractionMode(key: string, interactionMode: ProviderInteractionMode): void {
  updateComposerDraft(key, (draft) =>
    draft.interactionMode === interactionMode ? draft : { ...draft, interactionMode },
  );
}

export function setDraftWorkspace(
  key: string,
  workspace: {
    readonly envMode?: DraftThreadEnvMode;
    readonly branch?: string | null;
    readonly worktreePath?: string | null;
    readonly startFromOrigin?: boolean;
  },
): void {
  updateComposerDraft(key, (draft) => ({ ...draft, ...workspace }));
}

/**
 * web useHandleNewThread: New thread reuses a draft of the project that holds nothing yet,
 * the first draft before the others. `null` when every one of them has content.
 */
export function reusableProjectDraftId(environmentId: EnvironmentId, projectId: ProjectId): string | undefined | null {
  const base = composerTargetKey({ kind: "draft", environmentId, projectId });
  const drafts = appAtomRegistry.get(composerDraftsAtom);
  if (!composerDraftHasUserContent(drafts[base])) return undefined;
  for (const [key, draft] of Object.entries(drafts)) {
    if (key.startsWith(`${base}:`) && !composerDraftHasUserContent(draft)) return draftIdOfKey(key);
  }
  return null;
}

/**
 * web useDraftEnvironmentRouting.onEnvironmentChange retargets the draft itself to the
 * other machine's project, so what the user wrote goes along. Drafts here are keyed by
 * project, so the content moves: prompt, attachments (local files, uploaded at send),
 * context records and the Build/Plan mode. Model and workspace choices stay behind; they
 * name the old machine's providers and checkouts. Returns the draft id to open there (a
 * fresh one when that project's draft already has content of its own).
 */
export function moveComposerDraftContent(
  fromKey: string,
  to: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
): string | undefined {
  const source = readComposerDraft(fromKey);
  const reusable = reusableProjectDraftId(to.environmentId, to.projectId);
  const draftId = reusable === null ? globalThis.crypto.randomUUID() : reusable;
  if (!composerDraftHasUserContent(source) && (source.threadContexts?.length ?? 0) === 0) return draftId;
  const toKey = composerTargetKey({ kind: "draft", ...to, ...(draftId ? { draftId } : {}) });
  updateComposerDraft(toKey, (draft) => ({
    ...draft,
    prompt: source.prompt,
    attachments: source.attachments,
    reviewComments: source.reviewComments ?? [],
    terminalContexts: source.terminalContexts ?? [],
    threadContexts: source.threadContexts ?? [],
    ...(source.interactionMode ? { interactionMode: source.interactionMode } : {}),
  }));
  clearComposerContent(fromKey);
  return draftId;
}

/** Drops a draft entry: a further draft is done once its thread exists. */
export function deleteComposerDraft(key: string): void {
  const drafts = appAtomRegistry.get(composerDraftsAtom);
  if (!(key in drafts)) return;
  const { [key]: _removed, ...rest } = drafts;
  appAtomRegistry.set(composerDraftsAtom, rest);
  schedulePersist();
}

// ── Optimistic sent messages ────────────────────────────────────────────

const NO_OPTIMISTIC_MESSAGES: ReadonlyArray<ChatMessage> = [];

/**
 * A sent message shown in its thread's timeline from the moment of the send until the
 * server's copy arrives (web ChatView optimisticUserMessages), by scoped thread key.
 * The timeline drops one whose id is already committed, so a late removal only costs memory.
 */
export const optimisticMessagesAtom = Atom.family((_threadKey: string) =>
  Atom.make<ReadonlyArray<ChatMessage>>(NO_OPTIMISTIC_MESSAGES).pipe(Atom.keepAlive),
);

export function addOptimisticMessage(threadKey: string, message: ChatMessage): void {
  const atom = optimisticMessagesAtom(threadKey);
  appAtomRegistry.set(atom, [...appAtomRegistry.get(atom), message]);
}

export function removeOptimisticMessages(threadKey: string, remove: (message: ChatMessage) => boolean): void {
  const atom = optimisticMessagesAtom(threadKey);
  const current = appAtomRegistry.get(atom);
  const next = current.filter((message) => !remove(message));
  if (next.length !== current.length) appAtomRegistry.set(atom, next.length === 0 ? NO_OPTIMISTIC_MESSAGES : next);
}

// ── Settings the composer reads ─────────────────────────────────────────

/**
 * Server settings merged over the client settings store (state/clientSettings.ts),
 * the way apps/web/src/hooks/useSettings.ts merges them.
 */
export const composerSettingsAtom = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make((get): UnifiedSettings => {
    const config = environmentId ? get(serverEnvironment.configValueAtom(environmentId)) : null;
    const serverSettings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
    const clientSettings = get(clientSettingsAtom);
    return {
      ...clientSettings,
      ...serverSettings,
      ...resolveModelPreferences(serverSettings, clientSettings),
    } as UnifiedSettings;
  }),
);

// ── Open requests ───────────────────────────────────────────────────────

/**
 * Which composer menu is open. The model picker uses `modelPickerOpenAtom` in state/ui.ts.
 * "overflow" is the footer's ⋯ menu; "traits" and "mode" open it while their blocks are in it.
 */
export type ComposerMenu = "traits" | "mode" | "env-mode" | "branch" | "environment" | "implement" | "overflow";
export const composerMenuOpenAtom = Atom.make<ComposerMenu | null>(null).pipe(Atom.keepAlive);

/** Bumped to ask the mounted composer to focus its editor. */
export const composerFocusRequestAtom = Atom.make(0).pipe(Atom.keepAlive);

export function focusComposer(): void {
  appAtomRegistry.set(composerFocusRequestAtom, appAtomRegistry.get(composerFocusRequestAtom) + 1);
}

/** Bumped to ask the mounted composer to step the reasoning effort (+1 / -1). */
export const composerEffortStepAtom = Atom.make<{ readonly direction: 1 | -1; readonly nonce: number } | null>(
  null,
).pipe(Atom.keepAlive);

/**
 * Opens a composer control the way apps/web's `ChatComposerHandle.openControl` does for
 * the keybinding commands `modelPicker.toggle`, `composer.effort`, `composer.mode`,
 * `composer.workspace` and `composer.branch`.
 */
export function openComposerControl(
  command: "model" | "effort" | "mode" | "workspace" | "branch" | "environment",
): void {
  switch (command) {
    case "model":
      appAtomRegistry.set(modelPickerOpenAtom, !appAtomRegistry.get(modelPickerOpenAtom));
      return;
    case "effort":
      appAtomRegistry.set(composerMenuOpenAtom, "traits");
      return;
    case "mode":
      appAtomRegistry.set(composerMenuOpenAtom, "mode");
      return;
    case "workspace":
      appAtomRegistry.set(composerMenuOpenAtom, "env-mode");
      return;
    case "branch":
      appAtomRegistry.set(composerMenuOpenAtom, "branch");
      return;
    case "environment":
      appAtomRegistry.set(composerMenuOpenAtom, "environment");
      return;
  }
}

export function stepComposerEffort(direction: 1 | -1): void {
  const previous = appAtomRegistry.get(composerEffortStepAtom);
  appAtomRegistry.set(composerEffortStepAtom, { direction, nonce: (previous?.nonce ?? 0) + 1 });
}
