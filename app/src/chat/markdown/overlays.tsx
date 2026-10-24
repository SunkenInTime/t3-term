// Window-level overlays chat markdown opens: right-click menus on links and
// chips (web asks the desktop shell for a native menu), the expanded image
// viewer, and anything else that must paint above the timeline. Markdown
// renders inside virtualized rows, so the overlays live in one host the
// timeline mounts, fed through this small store.
import type { ContextMenuItem } from "@t3tools/contracts";
import { useSyncExternalStore, type ReactNode } from "react";

import { ContextMenu } from "../../sidebar/ContextMenu.tsx";

export type MarkdownOverlay =
  | {
      readonly kind: "menu";
      readonly items: ReadonlyArray<ContextMenuItem<string>>;
      readonly x: number;
      readonly y: number;
      readonly onSelect: (id: string) => void;
    }
  | { readonly kind: "custom"; readonly render: (close: () => void) => ReactNode };

let current: MarkdownOverlay | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openMarkdownOverlay(overlay: MarkdownOverlay | null) {
  current = overlay;
  emit();
}

export function closeMarkdownOverlay() {
  openMarkdownOverlay(null);
}

export function showMarkdownContextMenu<T extends string>(
  items: ReadonlyArray<ContextMenuItem<T>>,
  position: { x: number; y: number },
): Promise<T | null> {
  return new Promise((resolve) => {
    if (items.length === 0) {
      resolve(null);
      return;
    }
    let settled = false;
    openMarkdownOverlay({
      kind: "menu",
      items,
      x: position.x,
      y: position.y,
      onSelect: (id) => {
        settled = true;
        resolve(id as T);
      },
    });
    const stop = subscribe(() => {
      if (current?.kind !== "menu" || current.items !== items) {
        stop();
        if (!settled) resolve(null);
      }
    });
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read() {
  return current;
}

export function MarkdownOverlayHost() {
  const overlay = useSyncExternalStore(subscribe, read, read);
  if (!overlay) return null;
  if (overlay.kind === "menu") {
    return (
      <ContextMenu
        items={overlay.items}
        x={overlay.x}
        y={overlay.y}
        onSelect={(id) => overlay.onSelect(id)}
        onClose={closeMarkdownOverlay}
        testId="markdown-context-menu"
      />
    );
  }
  return <>{overlay.render(closeMarkdownOverlay)}</>;
}
