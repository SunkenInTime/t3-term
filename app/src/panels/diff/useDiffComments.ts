// Line comments on the Diff surface: apps/web/src/components/diffs/AnnotatableCodeView.tsx
// with pierre's line selection and gutter utility (InteractionManager) done by hand.
//
// Click a line number to select it, shift-click or drag over numbers to extend the
// selection, then press the gutter's "+" to open a comment form under the selection's
// last line. A sent comment goes into the thread's composer draft (prompt reference +
// review comment record), and every comment in that draft for this section shows back
// under its lines, as on the web.
import { useAtomValue } from "@effect/atom-react";
import { useMemo, useRef, useState } from "react";

import {
  addComposerReviewComment,
  composerDraftAtom,
  removeComposerReviewComment,
} from "../../state/composer.ts";
import { nextFileCommentId } from "../../web/components/files/fileCommentAnnotations.ts";
import {
  buildDiffReviewComment,
  findDiffReviewLineIndex,
  restoreDiffReviewCommentRange,
  type ReviewCommentContext,
  type SelectedLineRange,
  type SelectionSide,
} from "../../web/reviewCommentContext.ts";
import {
  diffFileLines,
  diffReviewLines,
  type DiffCommentEntry,
  type DiffFileModel,
  type DiffLine,
  type DiffLineAnnotation,
} from "./diffModel.ts";

export interface DiffCommentsConfig {
  readonly sectionId: string;
  readonly sectionTitle: string;
  /** composerTargetKey of the thread whose composer receives the comments. */
  readonly draftKey: string;
}

export interface LinePoint {
  readonly lineNumber: number;
  readonly side: SelectionSide;
}

/** Where a painted cell sits for selection: deletions by old number, the rest by new. */
export function linePoint(line: DiffLine, cellSide: "old" | "new" | "any"): LinePoint | null {
  if (cellSide === "old" || (cellSide === "any" && line.kind === "deletion")) {
    return line.oldLine === null ? null : { lineNumber: line.oldLine, side: "deletions" };
  }
  return line.newLine === null ? null : { lineNumber: line.newLine, side: "additions" };
}

function annotationSide(range: SelectedLineRange): SelectionSide {
  return (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions";
}

const EMPTY_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];
const EMPTY_SELECTED: ReadonlySet<DiffLine> = new Set();

interface DraftState {
  readonly path: string;
  readonly id: string;
  readonly range: SelectedLineRange;
  readonly rangeLabel: string;
}

function appendEntry(
  annotations: DiffLineAnnotation[],
  side: SelectionSide,
  lineNumber: number,
  entry: DiffCommentEntry,
): DiffLineAnnotation[] {
  const index = annotations.findIndex((annotation) => annotation.side === side && annotation.lineNumber === lineNumber);
  if (index < 0) return [...annotations, { side, lineNumber, entries: [entry] }];
  return annotations.map((annotation, candidate) =>
    candidate === index ? { ...annotation, entries: [...annotation.entries, entry] } : annotation,
  );
}

export function useDiffComments(files: ReadonlyArray<DiffFileModel>, config: DiffCommentsConfig | null) {
  const draft = useAtomValue(composerDraftAtom(config?.draftKey ?? ""));
  const reviewComments = config ? (draft.reviewComments ?? EMPTY_COMMENTS) : EMPTY_COMMENTS;
  const [selection, setSelection] = useState<{ path: string; anchor: LinePoint; focus: LinePoint } | null>(null);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [draftText, setDraftText] = useState("");
  const selectingRef = useRef(false);

  const filesByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  // AnnotatableCodeView: a draft whose file left the diff goes with it.
  if (draftState !== null && !filesByPath.has(draftState.path)) {
    setDraftState(null);
    setDraftText("");
    setSelection(null);
  }

  const annotations = useMemo(() => {
    const byPath = new Map<string, DiffLineAnnotation[]>();
    if (!config) return byPath;
    for (const comment of reviewComments) {
      if (comment.sectionId !== config.sectionId || (comment.fenceLanguage ?? "diff") !== "diff") continue;
      const file = filesByPath.get(comment.filePath);
      if (!file) continue;
      const range = restoreDiffReviewCommentRange(diffReviewLines(file), comment);
      if (!range) continue;
      byPath.set(
        file.path,
        appendEntry(byPath.get(file.path) ?? [], annotationSide(range), range.end, {
          id: comment.id,
          kind: "comment",
          rangeLabel: comment.rangeLabel,
          text: comment.text,
        }),
      );
    }
    if (draftState) {
      byPath.set(
        draftState.path,
        appendEntry(byPath.get(draftState.path) ?? [], annotationSide(draftState.range), draftState.range.end, {
          id: draftState.id,
          kind: "draft",
          rangeLabel: draftState.rangeLabel,
          text: "",
        }),
      );
    }
    return byPath;
  }, [config?.sectionId, reviewComments, filesByPath, draftState]);

  const selectedLines = useMemo(() => {
    if (selection === null) return EMPTY_SELECTED;
    const file = filesByPath.get(selection.path);
    if (!file) return EMPTY_SELECTED;
    const reviewLines = diffReviewLines(file);
    const from = findDiffReviewLineIndex(reviewLines, selection.anchor.lineNumber, selection.anchor.side);
    const to = findDiffReviewLineIndex(reviewLines, selection.focus.lineNumber, selection.focus.side);
    if (from < 0 || to < 0) return EMPTY_SELECTED;
    const lines = diffFileLines(file);
    return new Set(lines.slice(Math.min(from, to), Math.max(from, to) + 1));
  }, [selection, filesByPath]);

  /** The selection as pierre reports it: top first, in patch order. */
  const selectedRange = (path: string): SelectedLineRange | null => {
    if (selection === null || selection.path !== path) return null;
    const file = filesByPath.get(path);
    if (!file) return null;
    const reviewLines = diffReviewLines(file);
    const anchorIndex = findDiffReviewLineIndex(reviewLines, selection.anchor.lineNumber, selection.anchor.side);
    const focusIndex = findDiffReviewLineIndex(reviewLines, selection.focus.lineNumber, selection.focus.side);
    const [top, bottom] = anchorIndex <= focusIndex ? [selection.anchor, selection.focus] : [selection.focus, selection.anchor];
    return { start: top.lineNumber, side: top.side, end: bottom.lineNumber, endSide: bottom.side };
  };

  const beginComment = (path: string, range: SelectedLineRange) => {
    const file = filesByPath.get(path);
    if (!config || !file) return;
    const id = nextFileCommentId();
    const comment = buildDiffReviewComment({
      id,
      sectionId: config.sectionId,
      sectionTitle: config.sectionTitle,
      filePath: file.path,
      lines: diffReviewLines(file),
      range,
      text: "",
    });
    if (!comment) return;
    setDraftText("");
    setDraftState({ path, id, range, rangeLabel: comment.rangeLabel });
  };

  const enabled = config !== null && draftState === null;

  return {
    enabled,
    annotations,
    selectedLines,
    draftText,
    setDraftText,
    /** pierre line-number press: select, shift-extend, or unselect a lone selected line. */
    numberDown(path: string, point: LinePoint, shift: boolean) {
      if (!enabled) return;
      selectingRef.current = true;
      if (shift && selection !== null && selection.path === path) {
        setSelection({ ...selection, focus: point });
        return;
      }
      const lone =
        selection !== null &&
        selection.path === path &&
        selection.anchor.lineNumber === selection.focus.lineNumber &&
        selection.anchor.side === selection.focus.side &&
        selection.anchor.lineNumber === point.lineNumber &&
        selection.anchor.side === point.side;
      setSelection(lone ? null : { path, anchor: point, focus: point });
    },
    numberEnter(path: string, point: LinePoint) {
      if (!enabled || !selectingRef.current || selection === null || selection.path !== path) return;
      if (selection.focus.lineNumber === point.lineNumber && selection.focus.side === point.side) return;
      setSelection({ ...selection, focus: point });
    },
    pointerUp() {
      selectingRef.current = false;
    },
    /** The gutter "+": comment on the selection when there is one in this file, else this line. */
    utility(path: string, point: LinePoint) {
      if (!enabled) return;
      selectingRef.current = false;
      const range = selectedRange(path) ?? {
        start: point.lineNumber,
        side: point.side,
        end: point.lineNumber,
        endSide: point.side,
      };
      // pierre's gutter selection leaves the range selected while the form is open.
      setSelection({
        path,
        anchor: { lineNumber: range.start, side: range.side ?? "additions" },
        focus: { lineNumber: range.end, side: range.endSide ?? range.side ?? "additions" },
      });
      beginComment(path, range);
    },
    submit(entryId: string, text: string) {
      if (!config || !draftState || draftState.id !== entryId) return;
      const file = filesByPath.get(draftState.path);
      if (!file) return;
      const comment = buildDiffReviewComment({
        id: draftState.id,
        sectionId: config.sectionId,
        sectionTitle: config.sectionTitle,
        filePath: file.path,
        lines: diffReviewLines(file),
        range: draftState.range,
        text,
      });
      if (comment) addComposerReviewComment(config.draftKey, comment);
      setSelection(null);
      setDraftState(null);
      setDraftText("");
    },
    remove(entryId: string) {
      setSelection(null);
      if (draftState?.id === entryId) {
        setDraftState(null);
        setDraftText("");
      } else if (config) {
        removeComposerReviewComment(config.draftKey, entryId);
      }
    },
  };
}

export type DiffComments = ReturnType<typeof useDiffComments>;
