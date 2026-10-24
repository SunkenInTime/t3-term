// Whether any gpuix dismiss layer (menu, popover, select, dialog, tooltip) is
// open. gpuix closes the top layer on Escape only in its default action, which
// runs after element handlers and the window handler (@gpuix/native
// renderer-state.ts `runDefault`). App-level Escape handlers (go back, leave
// settings) must step aside while a layer is open, or Escape navigates away
// instead of closing the menu. gpuix exposes no query for its private layer
// stack, so this counts layers by wrapping the renderer state's pushLayer,
// which every DismissableLayer goes through.
import { useGpuixRequired } from "@gpuix/react";
import { createRendererState } from "@gpuix/native/host";
import { useLayoutEffect } from "react";

const open = new Set<object>();
const patched = new WeakSet<object>();

export function hasOpenDismissLayer(): boolean {
  return open.size > 0;
}

function track(renderer: Parameters<typeof createRendererState>[0]): void {
  const state = createRendererState(renderer);
  if (patched.has(state)) return;
  patched.add(state);
  const push = state.pushLayer.bind(state);
  state.pushLayer = (layer, options) => {
    const token = {};
    open.add(token);
    const close = push(layer, options);
    return () => {
      open.delete(token);
      close();
    };
  };
}

/** Mount once near the root, before any overlay can open. */
export function useDismissLayerTracking(): void {
  const renderer = useGpuixRequired();
  useLayoutEffect(() => {
    track(renderer as unknown as Parameters<typeof createRendererState>[0]);
  }, [renderer]);
}
