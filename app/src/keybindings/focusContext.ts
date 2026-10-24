// What holds keyboard focus, for the `when` clause flags web reads from the DOM:
//   editableFocus  lib/editableFocus.ts  (an input, textarea or contenteditable is focused)
//   previewFocus   lib/previewFocus.ts   (focus is inside the preview panel)
//   composerFocus  ChatView getShortcutContext (the composer editor is document.activeElement)
// gpuix exposes only the focused element's id. Its type and ancestors come from a mirror
// of the host tree kept from the mutation batches React sends to the native renderer
// (parent links, input/textarea ids, the two test ids below). Reading the renderer's
// automation tree instead costs a full JSON parse of the window (~39 ms on a long
// thread) the first time a shortcut key arrives after focus moves; the mirror answers
// in microseconds and costs a regex pass over each batch string.
import { GpuixRenderer } from "@gpuix/native";

/** The preview surface's root (panels/browser/PreviewView.tsx), web's `[data-preview-panel-mode]`. */
const PREVIEW_ROOT_TEST_ID = "preview-view";
/**
 * The composer's rich editor (chat/composer/editor/ComposerEditor.tsx): a focusable div,
 * web's contenteditable `composer-editor`.
 */
const COMPOSER_EDITOR_TEST_ID = "composer";

interface FocusHost {
  readonly getFocusedElementId?: () => number | null;
  readonly getElementBounds?: (id: number) => unknown;
  readonly getAutomationTree?: () => string;
}

interface TreeNode {
  readonly id?: number;
  readonly type?: string;
  readonly testId?: string;
  readonly children?: ReadonlyArray<TreeNode>;
}

export interface FocusFacts {
  readonly editable: boolean;
  readonly preview: boolean;
  readonly composer: boolean;
}

const NO_FOCUS: FocusFacts = { editable: false, preview: false, composer: false };

// ── Host tree mirror ────────────────────────────────────────────────────

const parentById = new Map<number, number>();
const editableIds = new Set<number>();
const previewRootIds = new Set<number>();
const composerIds = new Set<number>();
let mirrorInstalled = false;

// Batches are `JSON.stringify` of `[name, ...args]` tuples (@gpuix/native mutations.js).
// Inside a JSON string every `"` is escaped, so `["appendChild",` can only be the start
// of a mutation, never text or style content, and a scan needs no full parse.
const MUTATION_PATTERN =
  /\["(?:createElement",(\d+),"(?:input|textarea)"|appendChild",(\d+),(\d+)|insertBefore",(\d+),(\d+)|setCustomProp",(\d+),"testId",(null|"(?:[^"\\]|\\.)*"))/g;

function setTestId(id: number, value: string): void {
  const testId = value === "null" ? null : (JSON.parse(value) as string);
  if (testId === PREVIEW_ROOT_TEST_ID) previewRootIds.add(id);
  else previewRootIds.delete(id);
  if (testId === COMPOSER_EDITOR_TEST_ID) composerIds.add(id);
  else composerIds.delete(id);
}

/** Applies one batch string to the mirror. Exported for tests. */
export function mirrorBatch(json: string): void {
  MUTATION_PATTERN.lastIndex = 0;
  for (let match = MUTATION_PATTERN.exec(json); match !== null; match = MUTATION_PATTERN.exec(json)) {
    if (match[1] !== undefined) editableIds.add(Number(match[1]));
    else if (match[2] !== undefined) parentById.set(Number(match[3]), Number(match[2]));
    else if (match[4] !== undefined) parentById.set(Number(match[5]), Number(match[4]));
    else if (match[6] !== undefined) setTestId(Number(match[6]), match[7]!);
  }
}

/** Drops the elements the renderer destroyed (applyBatch returns every id in each removed subtree). */
export function mirrorDestroyed(ids: ReadonlyArray<number>): void {
  for (const id of ids) {
    parentById.delete(id);
    editableIds.delete(id);
    previewRootIds.delete(id);
    composerIds.delete(id);
  }
}

/**
 * Wraps the native renderer's batch entry point. It has to run before the first
 * commit, which is why it runs when this module loads: main.tsx imports the key
 * dispatcher, and with it this module, before it calls render().
 */
function installMirror(): void {
  const proto = GpuixRenderer?.prototype as { applyBatch?: (json: string) => number[] } | undefined;
  const applyBatch = proto?.applyBatch;
  if (!proto || typeof applyBatch !== "function") return;
  proto.applyBatch = function (this: unknown, json: string) {
    const destroyed = applyBatch.call(this, json);
    try {
      mirrorBatch(json);
      if (destroyed.length > 0) mirrorDestroyed(destroyed);
    } catch {
      // The mirror is advisory: lookups fall back to the automation tree.
    }
    return destroyed;
  };
  mirrorInstalled = true;
}
installMirror();

/** Null when the mirror never saw the element (it predates the mirror). */
function mirrorFacts(id: number): FocusFacts | null {
  if (!mirrorInstalled || !parentById.has(id)) return null;
  const composer = composerIds.has(id);
  let preview = false;
  // Bounded walk: a cycle would mean a corrupt mirror, not a deep tree.
  for (let node: number | undefined = id, depth = 0; node !== undefined && depth < 4096; node = parentById.get(node), depth++) {
    if (previewRootIds.has(node)) {
      preview = true;
      break;
    }
  }
  return { editable: composer || editableIds.has(id), preview, composer };
}

// ── Automation tree fallback ────────────────────────────────────────────

let host: FocusHost | null = null;
const factsById = new Map<number, FocusFacts>();
/** Misses per id: an element that never shows up in the tree stops costing a parse per key. */
const missesById = new Map<number, number>();
const MAX_MISSES = 3;

/** The window's renderer, from the window key handler (one renderer, one window). */
export function noteFocusHost(renderer: unknown): void {
  if (renderer && typeof renderer === "object") host = renderer as FocusHost;
}

function findPath(node: TreeNode, id: number, path: TreeNode[]): boolean {
  path.push(node);
  if (node.id === id) return true;
  for (const child of node.children ?? []) {
    if (findPath(child, id, path)) return true;
  }
  path.pop();
  return false;
}

/** Null when the element is not in the last painted tree yet: ask again next time. */
function treeFacts(id: number): FocusFacts | null {
  const tree = host?.getAutomationTree?.();
  if (!tree) return null;
  try {
    const path: TreeNode[] = [];
    if (!findPath(JSON.parse(tree) as TreeNode, id, path)) return null;
    const focused = path.at(-1);
    const composer = focused?.testId === COMPOSER_EDITOR_TEST_ID;
    return {
      editable: composer || focused?.type === "input" || focused?.type === "textarea",
      preview: path.some((node) => node.testId === PREVIEW_ROOT_TEST_ID),
      composer,
    };
  } catch {
    return null;
  }
}

/**
 * The focused element's facts, or null when they are not known yet (no renderer seen, or
 * the element is in neither the mirror nor the last painted tree). GPUI keeps the id of a
 * focused element after it unmounts, so an element with no bounds counts as no focus.
 */
export function readFocusFacts(): FocusFacts | null {
  if (host === null) return null;
  const id = host.getFocusedElementId?.();
  if (id === null || id === undefined) return NO_FOCUS;
  if (host.getElementBounds && host.getElementBounds(id) == null) return NO_FOCUS;
  // Not cached: a test id can move onto or off an element while it keeps focus.
  const mirrored = mirrorFacts(id);
  if (mirrored !== null) return mirrored;
  const cached = factsById.get(id);
  if (cached !== undefined) return cached;
  const facts = treeFacts(id);
  if (facts === null) {
    const misses = (missesById.get(id) ?? 0) + 1;
    missesById.set(id, misses);
    if (misses >= MAX_MISSES) factsById.set(id, NO_FOCUS);
    return null;
  }
  factsById.set(id, facts);
  return facts;
}
