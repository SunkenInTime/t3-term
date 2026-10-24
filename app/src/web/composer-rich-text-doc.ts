// Ported from apps/web/src/composer-rich-text-doc.ts: the fence grammar only. The rest of
// that file maps ProseMirror documents and has no counterpart here (chat/composer/editor/doc.ts
// holds the composer document).

export function parseOpeningFence(line: string): { fence: string; language: string } | null {
  // `[^\n]` rather than `.`, here and in the block rules: a CRLF draft's lines
  // end in `\r`, which `.` refuses, and the `\r` stays in the stored text.
  const match = /^(`{3,}|~{3,})([^\n]*)$/.exec(line);
  if (!match) return null;
  const fence = match[1]!;
  const language = match[2]!;
  if (fence.startsWith("`") && language.includes("`")) return null;
  return { fence, language };
}

export function isClosingFence(line: string, fence: string): boolean {
  const match = /^(`{3,}|~{3,})[ \t]*\r?$/.exec(line);
  if (!match) return false;
  const run = match[1]!;
  return run[0] === fence[0] && run.length >= fence.length;
}
