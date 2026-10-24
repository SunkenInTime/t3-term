// apps/web/src/components/pullRequest/pullRequestMarkdown.logic.ts `remarkPullRequestAutolinks`,
// as a source rewrite: gpuix's native <markdown> takes a string, not an mdast tree. Issue and
// pull request references (`#123`) and full commit SHAs in prose become links into the
// repository, with web's boundary rules. Web skips text already inside a link; here that means
// code (fenced, indented, inline), markdown links and images, angle-bracket autolinks, raw HTML
// tags and bare URLs, which GFM turns into links.

const AUTOLINK_CANDIDATE_PATTERN = /#[1-9]\d*|[0-9a-f]{40}/giu;
const AUTOLINK_WORD_CHARACTER_PATTERN = /[A-Za-z0-9_]/u;
const AUTOLINK_COMMIT_PREFIX_PATTERN = /[\s([{]/u;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})(.*)$/u;
const INDENTED_CODE_PATTERN = /^(?: {4}|\t)/u;
/** Spans the rewrite leaves alone, in the order they are tried at each position. */
const PROTECTED_SPAN_PATTERN =
  /(`+)[\s\S]*?\1|!?\[(?:[^\]\\]|\\.)*\]\([^)]*\)|!?\[(?:[^\]\\]|\\.)*\]\[[^\]]*\]|<[^>\s]+>|<\/?[A-Za-z][^>]*>|(?:https?:\/\/|www\.)[^\s<]+/gu;

function autolinkText(text: string, repositoryUrl: string): string {
  return text.replace(AUTOLINK_CANDIDATE_PATTERN, (matched: string, offset: number) => {
    const reference = matched.startsWith("#");
    const before = text[offset - 1];
    const after = text[offset + matched.length];
    if (
      (before !== undefined &&
        (reference ? AUTOLINK_WORD_CHARACTER_PATTERN.test(before) : !AUTOLINK_COMMIT_PREFIX_PATTERN.test(before))) ||
      (after !== undefined && AUTOLINK_WORD_CHARACTER_PATTERN.test(after))
    ) {
      return matched;
    }
    return reference
      ? `[${matched}](${repositoryUrl}/issues/${matched.slice(1)})`
      : `[${matched.slice(0, 7)}](${repositoryUrl}/commit/${matched})`;
  });
}

function autolinkLine(line: string, repositoryUrl: string): string {
  let result = "";
  let cursor = 0;
  for (const match of line.matchAll(PROTECTED_SPAN_PATTERN)) {
    const start = match.index ?? 0;
    result += autolinkText(line.slice(cursor, start), repositoryUrl) + match[0];
    cursor = start + match[0].length;
  }
  return result + autolinkText(line.slice(cursor), repositoryUrl);
}

export function autolinkPullRequestMarkdown(source: string, repositoryUrl: string | null): string {
  if (repositoryUrl === null) return source;
  const base = repositoryUrl.replace(/\/+$/u, "");
  let openFence: string | null = null;
  return source
    .split("\n")
    .map((line) => {
      const fence = FENCE_PATTERN.exec(line);
      if (fence !== null) {
        const marker = fence[1]!;
        if (openFence === null) openFence = marker;
        else if (marker[0] === openFence[0] && marker.length >= openFence.length && fence[2]!.trim() === "") openFence = null;
        return line;
      }
      if (openFence !== null || INDENTED_CODE_PATTERN.test(line)) return line;
      return autolinkLine(line, base);
    })
    .join("\n");
}
