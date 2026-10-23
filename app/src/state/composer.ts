// Composer state: per-target drafts persisted under $T3TERM_HOME, the settings the
// composer reads, and open requests that keybindings and the palette can fire.
// Draft shape after apps/web/src/composerDraftStore.ts (ComposerThreadDraftState),
// with attachments held as local file paths instead of browser File objects.
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import {
  DEFAULT_SERVER_SETTINGS,
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
    };

/** One draft per thread, and one new-thread draft per project. */
export function composerTargetKey(target: ComposerTarget): string {
  return target.kind === "thread"
    ? `thread:${target.environmentId}:${target.threadId}`
    : `draft:${target.environmentId ?? "-"}:${target.projectId ?? "-"}`;
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
  readonly runtimeMode: RuntimeMode | null;
  readonly interactionMode: ProviderInteractionMode | null;
  /** New-thread drafts only: where the thread runs. */
  readonly envMode?: DraftThreadEnvMode;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly startFromOrigin?: boolean;
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
  return Boolean(draft && (draft.prompt.trim().length > 0 || draft.attachments.length > 0));
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
    draft.prompt === "" && draft.attachments.length === 0
      ? draft
      : { ...draft, prompt: "", attachments: [] },
  );
}

/** Puts a failed send's prompt and attachments back. */
export function restoreComposerContent(
  key: string,
  content: { prompt: string; attachments: ReadonlyArray<ComposerAttachmentDraft> },
): void {
  updateComposerDraft(key, (draft) => ({
    ...draft,
    prompt: draft.prompt.trim().length > 0 ? `${content.prompt}\n${draft.prompt}` : content.prompt,
    attachments: [...content.attachments, ...draft.attachments],
  }));
}

export function setComposerModelSelection(
  key: string,
  selection: ModelSelection,
  options?: { readonly sticky?: boolean },
): void {
  updateComposerDraft(key, (draft) => ({
    ...draft,
    activeProvider: selection.instanceId,
    modelSelectionByProvider: {
      ...draft.modelSelectionByProvider,
      [selection.instanceId]: {
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

/** Which composer menu is open. The model picker uses `modelPickerOpenAtom` in state/ui.ts. */
export type ComposerMenu = "traits" | "mode" | "env-mode" | "branch" | "environment" | "implement";
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
