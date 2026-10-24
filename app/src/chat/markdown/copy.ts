// Copying chat markdown. gpuix joins a selection's text runs with a newline
// unless they are adjacent bare strings of one element, so a paragraph that
// paints as rows of runs would copy with a line break at every wrap and around
// every inline code pill. The renderer ends each run that continues the same
// line of prose with JOIN (U+2060 WORD JOINER: zero width, never painted);
// the copy handler drops the newline after it and the marker itself.
import type { GpuixRenderer } from "@gpuix/native";
import type { KeyEvent } from "@gpuix/react";

import { copyToClipboard } from "../../lib/clipboard.ts";

export const JOIN = "⁠";

export function cleanMarkdownSelection(text: string): string {
  return text.replaceAll(`${JOIN}\n`, "").replaceAll(JOIN, "");
}

function renderer(): GpuixRenderer | null {
  const slot = Reflect.get(globalThis, "__gpuixRenderHost") as { renderer?: GpuixRenderer } | undefined;
  return slot?.renderer ?? null;
}

/**
 * Window-level Ctrl/Cmd+C: when the selection runs through chat markdown,
 * copy the joined text instead of gpuix's run-per-line text. Returns true when
 * it took the key.
 */
export function handleMarkdownCopy(event: KeyEvent): boolean {
  const modifiers = event.modifiers;
  const chord = process.platform === "darwin" ? modifiers?.cmd && !modifiers.ctrl : modifiers?.ctrl && !modifiers.cmd;
  if (!chord || modifiers?.shift || modifiers?.alt || event.key !== "c") return false;
  const selected = renderer()?.getSelectedText() ?? null;
  if (!selected || !selected.includes(JOIN)) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  void copyToClipboard(cleanMarkdownSelection(selected));
  return true;
}
