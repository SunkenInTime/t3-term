// Ports of apps/web/src/components/pullRequest/guide/{GuideProse,GuideNotes,GuideRail,GuideExcerpt,
// GuideFileDiff}.tsx: the pieces a review guide's stop is made of. Excerpts and file diffs draw
// with t3-term's diff renderer (panels/diff/DiffView.tsx) laid out inline, inside the tour's one
// scroller.
import { excerptRows, rowsToPatch, stopSubline } from "@t3tools/client-runtime/review-guide-tour";
import type {
  PullRequestReviewGuideExcerpt,
  PullRequestReviewGuideNote,
  PullRequestReviewGuideStop,
  PullRequestReviewPosition,
} from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { parseDiffFiles, type DiffFileModel } from "../../panels/diff/diffModel.ts";
import { DiffView, type DiffExternalAnnotation } from "../../panels/diff/DiffView.tsx";
import type { PendingReviewComment } from "../../state/pullRequests.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import type { ReviewCommentContext } from "../../web/components/pullRequest/pullRequestDetail.deps.ts";
import { PrButton } from "../prControls.tsx";
import { DiffCommentDraft, PendingReviewCommentCard } from "../PullRequestReviewAnnotation.tsx";
import {
  buildLineReviewComment,
  findDiffLine,
  getReviewPositionAnchor,
  reviewPositionForLine,
  toViewerSide,
} from "../pullRequestReviewPosition.ts";
import { PrMarkdown } from "../PullRequestSummaryTab.tsx";
import { modelTourRows } from "./guideDiff.ts";

/** GuideProse: guide text is markdown, except where it sits inside a single line of UI. */
export function GuideProse({ text, plain = false, size = 14, color }: { text: string; plain?: boolean; size?: number; color?: string }) {
  const theme = useTheme();
  if (plain) {
    return (
      <text style={{ color: color ?? theme.foreground, fontSize: size, lineHeight: Math.round(size * 1.5), fontFamily: FONTS.sans }}>
        {text}
      </text>
    );
  }
  return <PrMarkdown source={text} size={size} />;
}

export function GuideNoteMarker({ marker }: { marker: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: 9,
        flexShrink: 0,
        backgroundColor: alpha(theme.info, 0.16),
      }}
    >
      <text style={{ color: theme.infoForeground, fontSize: 9, lineHeight: 12, fontWeight: 500, fontFamily: FONTS.sans }}>{marker}</text>
    </div>
  );
}

export function GuideNotes({
  notes,
}: {
  notes: ReadonlyArray<{ readonly marker: string; readonly note: PullRequestReviewGuideNote }>;
}) {
  const theme = useTheme();
  if (notes.length === 0) return null;
  return (
    <div testId="guide-notes" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <Text size="xs" weight={500}>
          Notes on this stop
        </Text>
        <Text size="xs" color={theme.mutedForeground}>
          {notes.length === 1 ? "1 note" : `${notes.length} notes`}
        </Text>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {notes.map(({ marker, note }) => (
          <div key={marker} style={{ display: "flex", flexDirection: "row", gap: 8, minWidth: 0 }}>
            <GuideNoteMarker marker={marker} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flexGrow: 1 }}>
              <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
                <Text size="xs" weight={500}>
                  {note.title}
                </Text>
                <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono }}>
                  {`${note.path.split("/").at(-1)}:${note.line}`}
                </text>
              </div>
              {note.body.trim() !== "" ? <GuideProse text={note.body} size={12} /> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GuideRail({
  stops,
  position,
  seen,
  onSelect,
  showCount = true,
}: {
  stops: ReadonlyArray<PullRequestReviewGuideStop>;
  position: number;
  seen: ReadonlySet<number>;
  onSelect: (position: number) => void;
  showCount?: boolean;
}) {
  const theme = useTheme();
  return (
    <div testId="guide-rail" style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      {showCount ? (
        <Text size="xs" color={theme.mutedForeground}>
          {`${seen.size} of ${stops.length} read`}
        </Text>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {stops.map((stop, index) => {
          const active = index === position;
          const read = seen.has(index);
          return (
            <div
              key={index}
              testId={`guide-rail-stop-${index}`}
              onClick={() => onSelect(index)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 8,
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: 6,
                paddingBottom: 6,
                borderRadius: RADIUS.md,
                cursor: "pointer",
                backgroundColor: active ? theme.accent : "#00000000",
                ...(active ? {} : { hover: { backgroundColor: alpha(theme.accent, 0.5) } }),
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  flexShrink: 0,
                  borderWidth: 1,
                  borderColor: read ? alpha(theme.success, 0.4) : theme.border,
                }}
              >
                {read ? (
                  <Icon name="check" size={12} color={theme.successForeground} />
                ) : (
                  <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontFamily: FONTS.sans }}>{String(index + 1)}</text>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <Text>{stop.title}</Text>
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  {stop.attention !== null ? (
                    <div style={{ display: "flex", paddingLeft: 5, paddingRight: 5, borderRadius: 4, backgroundColor: alpha(theme.warning, 0.16) }}>
                      <text style={{ color: theme.warningForeground, fontSize: 11, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>Look closely</text>
                    </div>
                  ) : null}
                  <Text size="xs" color={theme.mutedForeground}>
                    {stopSubline(stop)}
                  </Text>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface ExcerptNoteMarker {
  readonly line: number;
  readonly markers: ReadonlyArray<{ readonly marker: string; readonly title: string }>;
}

export interface ExcerptCommenting {
  readonly canComment: boolean;
  readonly pending: ReadonlyArray<PendingReviewComment>;
  readonly onComment: (comment: {
    readonly path: string;
    readonly oldPath: string | null;
    readonly position: PullRequestReviewPosition;
    readonly body: string;
  }) => void;
  readonly onRemove: (commentId: string) => void;
  readonly onAskAgent: ((comment: ReviewCommentContext, request: string) => void) | null;
}

interface ExcerptDraft {
  readonly side: "additions" | "deletions";
  readonly line: number;
  readonly position: PullRequestReviewPosition;
  readonly comment: ReviewCommentContext;
}

function excerptSlice(file: DiffFileModel | null, excerpt: PullRequestReviewGuideExcerpt) {
  if (file === null) return null;
  const rows = modelTourRows(file);
  const shown = excerptRows(rows, excerpt);
  if (shown.length === 0) return null;
  const model = parseDiffFiles(rowsToPatch(excerpt.path, file.previousPath ?? excerpt.path, shown))[0];
  if (model === undefined) return null;
  const drawn = {
    additions: new Set(shown.flatMap((row) => (row.newLine === null ? [] : [row.newLine]))),
    deletions: new Set(shown.flatMap((row) => (row.oldLine === null ? [] : [row.oldLine]))),
  };
  return { model, shown: shown.length, total: rows.length, drawn };
}

export function GuideExcerpt({
  excerpt,
  file,
  loading,
  notes,
  commenting,
  onOpenFile,
}: {
  excerpt: PullRequestReviewGuideExcerpt;
  file: DiffFileModel | null;
  loading: boolean;
  notes: ReadonlyArray<ExcerptNoteMarker>;
  commenting: ExcerptCommenting | null;
  onOpenFile: (path: string) => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<ExcerptDraft | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const slice = useMemo(() => excerptSlice(file, excerpt), [file, excerpt]);
  const noteSide = excerpt.side === "new" ? "additions" : "deletions";
  const groups = new Map<string, { side: "additions" | "deletions"; line: number; markers: ExcerptNoteMarker["markers"]; pending: PendingReviewComment[]; draft: boolean }>();
  const groupAt = (side: "additions" | "deletions", line: number) => {
    const key = `${side}:${line}`;
    let group = groups.get(key);
    if (!group) {
      group = { side, line, markers: [], pending: [], draft: false };
      groups.set(key, group);
    }
    return group;
  };
  if (slice !== null) {
    for (const note of notes) {
      const group = groupAt(noteSide, note.line);
      group.markers = [...group.markers, ...note.markers];
    }
    for (const comment of commenting?.pending ?? []) {
      if (comment.path !== excerpt.path) continue;
      const anchor = getReviewPositionAnchor(comment.position);
      const side = toViewerSide(anchor.side);
      if (!slice.drawn[side].has(anchor.line)) continue;
      groupAt(side, anchor.line).pending.push(comment);
    }
    if (draft !== null) groupAt(draft.side, draft.line).draft = true;
  }
  const annotations: ReadonlyMap<string, ReadonlyArray<DiffExternalAnnotation>> | undefined =
    slice === null
      ? undefined
      : new Map([
          [
            slice.model.path,
            [...groups.values()].map((group) => ({
              key: `${group.side}:${group.line}:${group.markers.length}:${group.pending.map((comment) => comment.id).join(",")}:${group.draft ? "d" : ""}`,
              side: group.side,
              lineNumber: group.line,
            })),
          ],
        ]);
  const onAskAgent = commenting?.onAskAgent ?? null;
  const askAgent = (request: string) => {
    if (draft === null || onAskAgent === null) return;
    const comment = { ...draft.comment, text: request };
    setDraft(null);
    onAskAgent(comment, request);
  };
  const beginComment = (model: DiffFileModel, side: "additions" | "deletions", line: number) => {
    const found = findDiffLine(model, side, line);
    if (found === null) return;
    const position = reviewPositionForLine(found.line, side);
    if (position === null) return;
    setDraft({
      side: found.line.kind === "deletion" ? "deletions" : side,
      line,
      position,
      comment: buildLineReviewComment({
        id: `pull-request-guide:${excerpt.path}:${side}:${line}`,
        sectionId: `pull-request-guide:${excerpt.path}`,
        sectionTitle: "Review guide",
        filePath: excerpt.path,
        line: found.line,
        index: found.index,
        side,
        text: "",
      }),
    });
  };

  return (
    <div testId={`guide-excerpt-${excerpt.path}`} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {excerpt.caption.trim() !== "" ? <GuideProse text={excerpt.caption} plain size={12} color={theme.mutedForeground} /> : null}
      {slice !== null ? (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: alpha(theme.border, 0.6), overflow: "hidden" }}>
          <DiffView
            inline
            files={[slice.model]}
            layout="stacked"
            wrap={false}
            collapsed={collapsed ? new Set([slice.model.path]) : new Set()}
            onToggleFile={() => setCollapsed(!collapsed)}
            onOpenFile={() => onOpenFile(excerpt.path)}
            resetKey={`${excerpt.path}:${excerpt.side}:${excerpt.start}-${excerpt.end}`}
            {...(annotations ? { annotations } : {})}
            renderAnnotation={(_file, annotation) => {
              const group = groups.get(`${annotation.side}:${annotation.lineNumber}`);
              if (!group) return null;
              return (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {group.markers.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4 }}>
                      {group.markers.map((entry) => (
                        <div key={entry.marker} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <GuideNoteMarker marker={entry.marker} />
                          <Text size="xs">{entry.title}</Text>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {group.pending.map((comment) => (
                    <PendingReviewCommentCard key={comment.id} comment={comment} onRemove={() => commenting?.onRemove(comment.id)} />
                  ))}
                  {group.draft && draft !== null && commenting !== null ? (
                    <DiffCommentDraft
                      rangeLabel={`${excerpt.path}:${getReviewPositionAnchor(draft.position).line}`}
                      placeholder={commenting.canComment ? "Add a comment…" : "Ask the agent about these lines…"}
                      submitLabel={commenting.canComment ? "Add to review" : "Ask agent"}
                      {...(commenting.canComment && onAskAgent !== null
                        ? { secondaryAction: { label: "Ask agent", onAction: (text: string) => askAgent(text) } }
                        : {})}
                      onCancel={() => setDraft(null)}
                      onComment={(body) => {
                        if (!commenting.canComment) {
                          askAgent(body);
                          return;
                        }
                        commenting.onComment({
                          path: excerpt.path,
                          oldPath: file?.previousPath && file.previousPath !== excerpt.path ? file.previousPath : null,
                          position: draft.position,
                          body,
                        });
                        setDraft(null);
                      }}
                    />
                  ) : null}
                </div>
              );
            }}
            {...(commenting !== null && draft === null ? { onLineNumberClick: beginComment } : {})}
            renderHeaderExtras={() => (
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text size="xs" color={theme.mutedForeground}>
                  {`${excerpt.side === "old" ? "removed code, " : ""}showing ${slice.shown} of ${slice.total} diff lines`}
                </Text>
                <Tooltip content={`Open ${excerpt.path} in Code`}>
                  <div
                    testId="guide-excerpt-open"
                    onClick={() => onOpenFile(excerpt.path)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: RADIUS.md, cursor: "pointer", hover: { backgroundColor: theme.accent } }}
                  >
                    <Icon name="arrow-up-right" size={14} color={theme.mutedForeground} />
                  </div>
                </Tooltip>
              </div>
            )}
          />
        </div>
      ) : loading ? (
        <div style={{ display: "flex", paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
          <Text size="xs" color={theme.mutedForeground}>{`Loading ${excerpt.path}...`}</Text>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.6),
          }}
        >
          <Text size="xs" color={theme.mutedForeground} truncate>
            {`${excerpt.path} lines ${excerpt.start}-${excerpt.end} are not in the loaded diff.`}
          </Text>
          <PrButton onClick={() => onOpenFile(excerpt.path)}>Open in Code</PrButton>
        </div>
      )}
    </div>
  );
}

/** GuideFileDiff: one whole file's diff under its row in "Also in this stop". */
export function GuideFileDiff({ file }: { file: DiffFileModel }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
      <DiffView
        inline
        files={[file]}
        layout="stacked"
        wrap={false}
        collapsed={new Set()}
        onToggleFile={() => {}}
        onOpenFile={() => {}}
        resetKey={file.path}
        hideFileHeaders
      />
    </div>
  );
}

