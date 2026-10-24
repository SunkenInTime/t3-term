// Find-in-diff matching: collectMatches from T3's @pierre/diffs patch
// (dist/components/CodeViewSearch.js). It searches the diff's line data rather
// than painted rows, so matches in rows outside the virtual list's window and in
// folded files are found; navigating to one unfolds and scrolls to it.
import type { DiffFileModel, DiffLine } from "./diffModel.ts";

const MAX_SEARCH_MATCHES = 1e5;
const WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

export interface DiffSearchParams {
  readonly text: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export interface DiffSearchMatch {
  readonly file: DiffFileModel;
  readonly line: DiffLine;
  /** Character range in the painted (tab-expanded) line text. */
  readonly start: number;
  readonly end: number;
}

/** Matches across files in render order: removed, added and context lines, folded files included. */
export function collectDiffMatches(files: ReadonlyArray<DiffFileModel>, params: DiffSearchParams): DiffSearchMatch[] {
  if (params.text === "" || params.text.includes("\n")) return [];
  let pattern: RegExp;
  try {
    pattern = new RegExp(params.regex ? params.text : escapeRegExp(params.text), params.caseSensitive ? "g" : "gi");
  } catch {
    return [];
  }
  const matches: DiffSearchMatch[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const text = line.text;
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          const length = match[0].length;
          if (length === 0) {
            pattern.lastIndex += 1;
            continue;
          }
          if (params.wholeWord && !isWholeWord(text, match.index, length)) continue;
          matches.push({ file, line, start: match.index, end: match.index + length });
          if (matches.length >= MAX_SEARCH_MATCHES) return matches;
        }
      }
    }
  }
  return matches;
}

/** The match at the same place as `previous`, so a refresh keeps the current one. */
export function findSameMatch(matches: ReadonlyArray<DiffSearchMatch>, previous: DiffSearchMatch): number {
  return matches.findIndex(
    (match) =>
      match.file.path === previous.file.path &&
      match.line.kind === previous.line.kind &&
      match.line.oldLine === previous.line.oldLine &&
      match.line.newLine === previous.line.newLine &&
      match.start === previous.start,
  );
}

function isWholeWord(text: string, start: number, length: number): boolean {
  return isSeparator(text, start - 1) && isSeparator(text, start + length);
}

function isSeparator(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return true;
  const code = text.charCodeAt(index);
  return code <= 32 || code === 127 || WORD_SEPARATORS.includes(text[index]!);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
