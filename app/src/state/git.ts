// Source control, review and diff atoms for the chat header, the thread details
// card and the Diff / Pull request right-panel surfaces. Factories are wired the
// way apps/web/src/state/{vcs,git,review,sourceControl,orchestration}.ts wire them.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { createGitEnvironmentAtoms } from "@t3tools/client-runtime/state/git";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import { createReviewEnvironmentAtoms } from "@t3tools/client-runtime/state/review";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime/state/source-control";
import { createTerminalEnvironmentAtoms } from "@t3tools/client-runtime/state/terminal";
import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
} from "@t3tools/client-runtime/state/vcs";
import type { EditorId, RunId, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import { composerDraftAtom, setDraftWorkspace } from "./composer.ts";
import { termHome } from "../runtime/paths.ts";
import { rightPanelOpenAtom, rightPanelSurfaceAtom, rightPanelSurfaceRequestAtom, type RightPanelSurface } from "./ui.ts";

export const vcsEnvironment = createVcsEnvironmentAtoms(connectionAtomRuntime);
export const vcsActionManager = createVcsActionManager(connectionAtomRuntime);
export const gitEnvironment = createGitEnvironmentAtoms(connectionAtomRuntime);
export const reviewEnvironment = createReviewEnvironmentAtoms(connectionAtomRuntime);
export const sourceControlEnvironment = createSourceControlEnvironmentAtoms(connectionAtomRuntime);
export const orchestrationEnvironment = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);
/** Project scripts run in a fresh server terminal; the terminal drawer shows it. */
export const scriptTerminalEnvironment = createTerminalEnvironmentAtoms(connectionAtomRuntime);

// ── Client preferences (persisted next to the connection catalog) ─────────

interface GitPrefs {
  preferredEditor?: EditorId | null;
  lastInvokedScriptByProjectId?: Record<string, string>;
  diffFileTreeOpen?: boolean;
  diffIgnoreWhitespace?: boolean;
  diffFilesCollapsed?: boolean;
}

const prefsPath = () => NodePath.join(termHome(), "git-prefs.json");

function readPrefs(): GitPrefs {
  try {
    return JSON.parse(NodeFS.readFileSync(prefsPath(), "utf8")) as GitPrefs;
  } catch {
    return {};
  }
}

function writePrefs(patch: Partial<GitPrefs>): void {
  try {
    const next = { ...readPrefs(), ...patch };
    NodeFS.mkdirSync(termHome(), { recursive: true });
    NodeFS.writeFileSync(prefsPath(), JSON.stringify(next, null, 2));
  } catch (error) {
    console.warn("Could not save git preferences.", error);
  }
}

function persistedAtom<K extends keyof GitPrefs>(key: K, fallback: NonNullable<GitPrefs[K]>) {
  const atom = Atom.make<NonNullable<GitPrefs[K]>>(
    (readPrefs()[key] ?? fallback) as NonNullable<GitPrefs[K]>,
  ).pipe(Atom.keepAlive);
  const set = (value: NonNullable<GitPrefs[K]>) => {
    appAtomRegistry.set(atom, value);
    writePrefs({ [key]: value } as Partial<GitPrefs>);
  };
  return { atom, set };
}

/** Last editor picked in the Open in menu (web keeps this in localStorage `t3code:last-editor`). */
export const preferredEditorPref = persistedAtom("preferredEditor", "" as EditorId);
export const lastInvokedScriptPref = persistedAtom("lastInvokedScriptByProjectId", {});
export const diffFileTreeOpenPref = persistedAtom("diffFileTreeOpen", false);
export const diffIgnoreWhitespacePref = persistedAtom("diffIgnoreWhitespace", false);
export const diffFilesCollapsedPref = persistedAtom("diffFilesCollapsed", false);

// ── Diff panel selection (apps/web/src/diffPanelStore.ts) ─────────────────

export type DiffPanelSelection =
  | { readonly kind: "branch"; readonly baseRef: string | null }
  | { readonly kind: "unstaged" }
  | {
      readonly kind: "turn";
      readonly turnId: RunId;
      readonly filePath: string | null;
      readonly revealRequestId: number;
    };

const DEFAULT_DIFF_SELECTION: DiffPanelSelection = { kind: "branch", baseRef: null };

export const diffSelectionAtom = Atom.family((_threadKey: string) =>
  Atom.make<DiffPanelSelection>(DEFAULT_DIFF_SELECTION).pipe(Atom.keepAlive),
);
const branchBaseRefAtom = Atom.family((_threadKey: string) =>
  Atom.make<string | null>(null).pipe(Atom.keepAlive),
);

export function diffSelectionFor(ref: ScopedThreadRef) {
  return diffSelectionAtom(scopedThreadKey(ref));
}

export function selectDiffGitScope(ref: ScopedThreadRef, scope: "branch" | "unstaged"): void {
  const key = scopedThreadKey(ref);
  const previous = appAtomRegistry.get(diffSelectionAtom(key));
  if (previous.kind === "branch") appAtomRegistry.set(branchBaseRefAtom(key), previous.baseRef);
  appAtomRegistry.set(
    diffSelectionAtom(key),
    scope === "branch"
      ? { kind: "branch", baseRef: appAtomRegistry.get(branchBaseRefAtom(key)) }
      : { kind: "unstaged" },
  );
}

export function selectDiffBaseRef(ref: ScopedThreadRef, baseRef: string | null): void {
  const key = scopedThreadKey(ref);
  const normalized = baseRef?.trim() ? baseRef.trim() : null;
  appAtomRegistry.set(branchBaseRefAtom(key), normalized);
  appAtomRegistry.set(diffSelectionAtom(key), { kind: "branch", baseRef: normalized });
}

export function selectDiffTurn(ref: ScopedThreadRef, turnId: RunId, filePath?: string): void {
  const key = scopedThreadKey(ref);
  const previous = appAtomRegistry.get(diffSelectionAtom(key));
  appAtomRegistry.set(diffSelectionAtom(key), {
    kind: "turn",
    turnId,
    filePath: filePath?.trim() || null,
    revealRequestId: previous.kind === "turn" ? previous.revealRequestId + 1 : 1,
  });
}

/** Session-only folds, keyed by thread + review section (web's useDiffPanelSessionStore). */
export const diffCollapsedFilesAtom = Atom.family((_scopeKey: string) =>
  Atom.make<ReadonlySet<string> | null>(null).pipe(Atom.keepAlive),
);

/** The file the file list focused, per thread + section. Null shows every file. */
export const diffFocusedFileAtom = Atom.family((_scopeKey: string) =>
  Atom.make<string | null>(null).pipe(Atom.keepAlive),
);

// ── Right panel ───────────────────────────────────────────────────────────

export function openRightPanelSurface(surface: RightPanelSurface): void {
  appAtomRegistry.set(rightPanelSurfaceAtom, surface);
  appAtomRegistry.update(rightPanelSurfaceRequestAtom, (count) => count + 1);
  appAtomRegistry.set(rightPanelOpenAtom, true);
}

/** Opens the Diff surface on a turn (from the timeline's "Open diff") or on the branch changes. */
export function openDiffSurface(
  ref: ScopedThreadRef,
  target?: { readonly turnId: RunId; readonly filePath?: string },
): void {
  if (target) selectDiffTurn(ref, target.turnId, target.filePath);
  openRightPanelSurface("diff");
}

// ── Pending workspace mode for server threads that have not started ──────

/**
 * The Local / New worktree choice for a server thread that has not started.
 * It lives on the thread's composer draft, which sends it with the first
 * message, so the details card and the composer's context strip agree.
 * `threadKey` is `${environmentId}:${threadId}`.
 */
export const pendingEnvModeAtom = Atom.family((threadKey: string) =>
  Atom.writable(
    (get) => get(composerDraftAtom(`thread:${threadKey}`)).envMode ?? null,
    (_ctx, mode: "local" | "worktree" | null) => {
      if (mode !== null) setDraftWorkspace(`thread:${threadKey}`, { envMode: mode });
    },
  ),
);

// ── Thread details card presentation ──────────────────────────────────────

/**
 * "inline" floats the card in the chat canvas; "popover" hangs it under the header
 * toggle when the canvas is too narrow (web's ThreadPanelPresentation).
 */
export const detailsPresentationAtom = Atom.make<"inline" | "popover">("inline").pipe(Atom.keepAlive);
export const detailsPopoverOpenAtom = Atom.make(false).pipe(Atom.keepAlive);

/**
 * The inline card's rectangle in canvas coordinates while it is open, or null.
 * Web narrows the chat lane so it clears the card (DETAILS_CARD_CLEARANCE 32);
 * the timeline and composer can read this to do the same.
 */
export const detailsCardRectAtom = Atom.make<{ readonly left: number; readonly right: number; readonly bottom: number } | null>(
  null,
).pipe(Atom.keepAlive);
