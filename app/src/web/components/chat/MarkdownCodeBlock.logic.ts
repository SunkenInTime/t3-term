// Ported from apps/web/src/components/chat/MarkdownCodeBlock.logic.ts:
// isClosedCodeFence only. The node is typed structurally (a hast element's
// position) instead of react-markdown's ExtraProps; the body is unchanged.

interface PositionedNode {
  readonly position?: {
    readonly start: { readonly offset?: number | undefined };
    readonly end: { readonly offset?: number | undefined };
  } | undefined;
}

export function isClosedCodeFence(node: PositionedNode | undefined, text: string, code: string): boolean {
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  if (start === undefined || end === undefined) return false;
  const source = text.slice(start, end);
  const opening = /^(?:`{3,}|~{3,})/.exec(source)?.[0];
  // One class for the blockquote prefix: nested quantifiers here backtrack
  // exponentially on code lines that start with many `> ` markers.
  const closing = /(?:^|\n)[ \t>]*(`{3,}|~{3,})[ \t\r]*$/.exec(source)?.[1];
  return (
    opening !== undefined &&
    closing !== undefined &&
    opening[0] === closing[0] &&
    closing.length >= opening.length &&
    // Only a real closer is omitted from parsed code. A CRLF stream cut after
    // CR must not count as an extra source line.
    source.replace(/\r$/, "").split(/\r\n|\r|\n/).length > code.split(/\r\n|\r|\n/).length
  );
}
