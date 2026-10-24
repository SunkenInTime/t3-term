// What holds keyboard focus, for the `when` clause flags web reads from the DOM:
//   editableFocus  lib/editableFocus.ts  (an input, textarea or contenteditable is focused)
//   previewFocus   lib/previewFocus.ts   (focus is inside the preview panel)
//   composerFocus  ChatView getShortcutContext (the composer editor is document.activeElement)
// gpuix exposes only the focused element's id, so the element's type and ancestors come
// from the renderer's automation tree. Element ids are never reused and React never moves
// a host element to another parent, so the answer for an id holds for its lifetime and
// the tree is read once per newly focused element, not per keystroke.

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
function computeFacts(id: number): FocusFacts | null {
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
 * the element is not in the last painted tree). GPUI keeps the id of a focused element
 * after it unmounts, so an element with no bounds counts as no focus.
 */
export function readFocusFacts(): FocusFacts | null {
  if (host === null) return null;
  const id = host.getFocusedElementId?.();
  if (id === null || id === undefined) return NO_FOCUS;
  if (host.getElementBounds && host.getElementBounds(id) == null) return NO_FOCUS;
  const cached = factsById.get(id);
  if (cached !== undefined) return cached;
  const facts = computeFacts(id);
  if (facts === null) {
    const misses = (missesById.get(id) ?? 0) + 1;
    missesById.set(id, misses);
    if (misses >= MAX_MISSES) factsById.set(id, NO_FOCUS);
    return null;
  }
  factsById.set(id, facts);
  return facts;
}
