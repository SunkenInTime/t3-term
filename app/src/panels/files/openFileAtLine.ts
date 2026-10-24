// The one way other areas open a file in a thread's Files surface at a line (web
// rightPanelStore.openFile + FilePreviewPanel's useFileLineReveal). Markdown file links,
// timeline file chips and the palette call this.
//
// `path` is workspace-relative or absolute (absolute paths outside the workspace open
// as host files). A `path:line[:column]` or `#L12` suffix is read when `line` is not
// given, so a link target can be passed through as is. The panel opens if it is
// closed; the file's tab is reused and its line is centered and tinted, once per call.
import type { ScopedThreadRef } from "@t3tools/contracts";
import { splitFilePathPosition } from "@t3tools/shared/fileLinks";

import { rightPanelActions, threadKeyOf } from "../../state/rightPanel.ts";

export function openFileAtLine(threadRef: ScopedThreadRef, path: string, line?: number | null): void {
  const hashIndex = path.indexOf("#");
  const position =
    line === undefined || line === null
      ? splitFilePathPosition(hashIndex >= 0 ? path.slice(0, hashIndex) : path, hashIndex >= 0 ? path.slice(hashIndex) : "")
      : { path, line };
  const target = position.line !== undefined && position.line > 0 ? Math.floor(position.line) : undefined;
  rightPanelActions.openFile(threadKeyOf(threadRef.environmentId, threadRef.threadId), position.path, target);
}
