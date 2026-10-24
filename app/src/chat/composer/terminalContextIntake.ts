// web ChatView addTerminalContextToDraft: a terminal selection's "Add to chat" lands in the
// thread's composer as an inline terminal chip at the caret (its excerpt kept as a record
// for the send), and the composer takes focus.
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { addComposerTerminalContext, composerTargetKey, focusComposer } from "../../state/composer.ts";
import type { TerminalContextSelection } from "../../web/lib/terminalContext.ts";
import { normalizeTerminalContextText } from "../../web/lib/terminalContext.ts";

export function addTerminalContextToThreadComposer(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  selection: TerminalContextSelection,
): boolean {
  const text = normalizeTerminalContextText(selection.text);
  if (text.length === 0 || selection.terminalLabel.trim().length === 0) return false;
  addComposerTerminalContext(composerTargetKey({ kind: "thread", environmentId, threadId }), {
    id: globalThis.crypto.randomUUID(),
    threadId,
    createdAt: new Date().toISOString(),
    terminalId: selection.terminalId,
    terminalLabel: selection.terminalLabel.trim(),
    lineStart: Math.max(1, Math.floor(selection.lineStart)),
    lineEnd: Math.max(Math.max(1, Math.floor(selection.lineStart)), Math.floor(selection.lineEnd)),
    text,
  });
  focusComposer();
  return true;
}
