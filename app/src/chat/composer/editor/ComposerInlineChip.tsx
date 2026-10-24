// The composer's inline chips: web's node views for composer-mention, composer-skill,
// composer-citation and composer-context-reference (ComposerPromptEditorTiptap.tsx) with
// their chip parts (ContextChip.tsx, contextChipParts.tsx, AssistantCitationChip.tsx,
// TerminalContextInlineChip.tsx, ThreadContextChip.tsx, composerContextPresentation.tsx).
//
// Geometry is web's ContextChip at the composer's 14px: height 1.41em of a 0.86em font,
// padding 0.5em, gap 0.33em, radius 0.5em, 1px border, 1.17em icon, centred in the line.
//
// gpuix: the editor captures the pointer for text selection, so a chip acts on mouse down
// (a click's release never reaches it), and it is absolutely placed, which keeps the press
// from reaching the editor underneath.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AssistantCitation, EnvironmentId } from "@t3tools/contracts";
import { assistantCitationLabel, withAssistantCitationComment } from "@t3tools/shared/assistantCitations";
import { createContext, memo, use, useEffect, useRef, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../../runtime/runtime.ts";
import { FileEntryIcon } from "../../../panels/files/FileEntryIcon.tsx";
import { ProjectGlyph } from "../../../sidebar/ProjectGlyph.tsx";
import { environmentThreadShells, projectIndexAtom } from "../../../state/environment.ts";
import { routeAtom } from "../../../state/ui.ts";
import { Icon, type IconName } from "../../../ui/Icon.tsx";
import { Popover, Tooltip } from "../../../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../../ui/theme.ts";
import { chipColors, chipMetrics, type ChipKind } from "../../markdown/MarkdownChips.tsx";
import { SKILL_CHIP_ICON_SVG } from "../../markdown/chipIcons.ts";
import { isTerminalContextExpired, type TerminalContextDraft } from "../../../web/lib/terminalContext.ts";
import type { ReviewCommentContext } from "../../../web/reviewCommentContext.ts";
import type { Atom } from "./doc.ts";
import { atomLabel } from "./layout.ts";

/** What the chips need from the composer around the editor. */
export interface ComposerChipEnvironment {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  /** web ComposerContextActions.openMention: the file opens in the right panel. */
  readonly openMention: (path: string) => void;
  /** Records behind context references, by context id (web ComposerContextRecordsContext). */
  readonly terminalContexts: ReadonlyMap<string, TerminalContextDraft>;
  readonly reviewComments: ReadonlyMap<string, ReviewCommentContext>;
  readonly threadContexts: ReadonlyMap<string, { readonly environmentId: EnvironmentId; readonly threadId: string; readonly title: string }>;
}

export interface ComposerChipActions {
  /** A citation just added by "Cite": its chip opens the comment editor (web requestCitationComment). */
  readonly requestedCitationKey: string | null;
  readonly clearRequestedCitation: () => void;
  /** Replaces a citation chip's citation (its comment was edited). */
  readonly updateCitation: (key: string, citation: AssistantCitation) => void;
  /** Removes a citation chip (Cancel on a citation that was just added). */
  readonly removeCitation: (key: string) => void;
  readonly readOnly: boolean;
}

export const ComposerChipEnvironmentContext = createContext<ComposerChipEnvironment>({
  environmentId: null,
  cwd: null,
  openMention: () => {},
  terminalContexts: new Map(),
  reviewComments: new Map(),
  threadContexts: new Map(),
});

export const ComposerChipActionsContext = createContext<ComposerChipActions>({
  requestedCitationKey: null,
  clearRequestedCitation: () => {},
  updateCitation: () => {},
  removeCitation: () => {},
  readOnly: false,
});

/** Chrome's selection highlight over a chip (web shows the native selection, not a chip state). */
export const NATIVE_SELECTION = "#0337a1";

export const ComposerInlineChip = memo(function ComposerInlineChip({
  atom,
  width,
  fontSize,
  selected,
}: {
  atom: Atom;
  width: number;
  fontSize: number;
  selected: boolean;
}) {
  switch (atom.kind) {
    case "mention":
      return <MentionChip atom={atom} width={width} fontSize={fontSize} selected={selected} />;
    case "skill":
      return <SkillChip atom={atom} width={width} fontSize={fontSize} selected={selected} />;
    case "citation":
      return <CitationChip atom={atom} width={width} fontSize={fontSize} selected={selected} />;
    case "context":
      return <ContextReferenceChip atom={atom} width={width} fontSize={fontSize} selected={selected} />;
  }
});

interface ChipShellProps {
  kind: ChipKind;
  width: number;
  fontSize: number;
  selected: boolean;
  icon: ReactNode;
  label: string;
  invalid?: boolean;
  testId?: string;
  onPress?: (() => void) | undefined;
  trailing?: ReactNode;
}

/** web ContextChip: the box every composer chip is drawn in. */
function ChipShell(props: ChipShellProps) {
  const theme = useTheme();
  const metrics = chipMetrics(props.fontSize);
  const colors = chipColors(theme, props.kind);
  const [hovered, setHovered] = useState(false);
  const interactive = props.onPress !== undefined;
  const active = interactive && hovered;
  const border = props.invalid ? alpha(theme.error, 0.35) : active ? colors.borderHover : colors.border;
  const background = props.invalid ? alpha(theme.error, 0.08) : active ? colors.backgroundHover : colors.background;
  const foreground = props.invalid ? theme.errorForeground : colors.foreground;
  return (
    <div
      testId={props.testId}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={
        props.onPress
          ? (event) => {
              if ((event.button ?? 0) === 0) props.onPress?.();
            }
          : undefined
      }
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: metrics.gap,
        width: props.width,
        height: metrics.height,
        flexShrink: 0,
        paddingLeft: metrics.padX,
        paddingRight: metrics.padX,
        borderRadius: metrics.radius,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: background,
        cursor: interactive ? "pointer" : "default",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: metrics.icon, height: metrics.icon, flexShrink: 0, pointerEvents: "none" }}>
        {props.icon}
      </div>
      <text
        style={{
          fontFamily: FONTS.sans,
          fontSize: metrics.fontSize,
          fontWeight: 500,
          lineHeight: metrics.fontSize * 1.25,
          color: foreground,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          flexShrink: 1,
          minWidth: 0,
          pointerEvents: "none",
        }}
      >
        {props.label}
      </text>
      {props.trailing}
      {props.selected ? (
        // Chrome blends its selection colour over a selected inline box.
        <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: alpha(NATIVE_SELECTION, 0.55), pointerEvents: "none" }} />
      ) : null}
    </div>
  );
}

function chipIcon(name: IconName, size: number, color: string): ReactNode {
  return <Icon name={name} size={size} color={color} />;
}

// ── Mention (web ComposerMentionNodeView + FileTagChipContent) ───────────

function MentionChip({ atom, width, fontSize, selected }: { atom: Extract<Atom, { kind: "mention" }>; width: number; fontSize: number; selected: boolean }) {
  const env = use(ComposerChipEnvironmentContext);
  const metrics = chipMetrics(fontSize);
  const name = atom.path.replace(/[\\/]+$/, "");
  const directory = /[\\/]$/.test(atom.path);
  const label = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1) || name;
  const theme = useTheme();
  return (
    <Tooltip content={atom.path} side="top">
      <ChipShell
        kind="mention"
        testId="composer-chip-mention"
        width={width}
        fontSize={fontSize}
        selected={selected}
        icon={
          directory ? (
            chipIcon("folder", metrics.icon, theme.mutedForeground)
          ) : (
            <FileEntryIcon pathValue={atom.path} kind="file" size={metrics.icon} />
          )
        }
        label={label}
        onPress={() => env.openMention(atom.path)}
      />
    </Tooltip>
  );
}

// ── Skill (web ComposerSkillNodeView: a popover with the description) ────

function SkillChip({ atom, width, fontSize, selected }: { atom: Extract<Atom, { kind: "skill" }>; width: number; fontSize: number; selected: boolean }) {
  const theme = useTheme();
  const metrics = chipMetrics(fontSize);
  const colors = chipColors(theme, "skill");
  const [open, setOpen] = usePressToggle();
  return (
    <Popover
      open={open.value}
      onOpenChange={open.set}
      side="top"
      align="start"
      testId="composer-chip-skill-popover"
      style={{ width: 288, padding: 8 }}
      trigger={
        <ChipShell
          kind="skill"
          testId="composer-chip-skill"
          width={width}
          fontSize={fontSize}
          selected={selected}
          icon={<svg source={SKILL_CHIP_ICON_SVG} style={{ width: metrics.icon, height: metrics.icon, color: colors.foreground }} />}
          label={atomLabel(atom)}
          onPress={setOpen}
        />
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 8 }}>
        <text style={{ fontFamily: FONTS.sans, fontSize: 14, lineHeight: 20, fontWeight: 500, color: theme.foreground }}>{atom.label || atom.name}</text>
        <text style={{ fontFamily: FONTS.sans, fontSize: 14, lineHeight: 20, color: theme.foreground }}>
          {atom.description || "No description is available for this skill."}
        </text>
      </div>
    </Popover>
  );
}

// ── Citation (web AssistantCitationChip, composer variant) ───────────────

function CitationChip({ atom, width, fontSize, selected }: { atom: Extract<Atom, { kind: "citation" }>; width: number; fontSize: number; selected: boolean }) {
  const theme = useTheme();
  const metrics = chipMetrics(fontSize);
  const colors = chipColors(theme, "citation");
  const actions = use(ComposerChipActionsContext);
  const [open, setOpen] = usePressToggle();
  const [actionHovered, setActionHovered] = useState(false);
  // Opened right after "Cite": Cancel takes the citation out again (web removeOnCancel).
  const removeOnCancel = useRef(false);
  useEffect(() => {
    if (actions.requestedCitationKey !== atom.key) return;
    actions.clearRequestedCitation();
    removeOnCancel.current = true;
    open.set(true);
  });
  const goToSource = () => {
    const citation = atom.citation;
    appAtomRegistry.set(routeAtom, { kind: "thread", environmentId: citation.environmentId, threadId: citation.threadId } as never);
  };
  const actionSize = metrics.icon;
  const action = (
    <div
      testId="composer-chip-citation-comment"
      onMouseEnter={() => setActionHovered(true)}
      onMouseLeave={() => setActionHovered(false)}
      onMouseDown={(event) => {
        if ((event.button ?? 0) !== 0 || actions.readOnly) return;
        setOpen();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: actionSize,
        height: actionSize,
        marginLeft: metrics.fontSize * 0.17,
        flexShrink: 0,
        borderRadius: RADIUS.sm,
        cursor: "pointer",
        backgroundColor: actionHovered ? alpha(cssAccentForeground(colors.foreground), 0.17) : "#00000000",
      }}
    >
      <Icon name="pencil" size={metrics.fontSize * 0.85} color={colors.foreground} />
    </div>
  );
  return (
    <Popover
      open={open.value}
      onOpenChange={open.set}
      side="top"
      align="end"
      testId="composer-citation-comment-popover"
      style={{ width: 320, padding: 12 }}
      trigger={
        <Tooltip content={`View cited assistant text: ${assistantCitationLabel(atom.citation)}`} side="top">
          <ChipShell
            kind="citation"
            testId="composer-chip-citation"
            width={width}
            fontSize={fontSize}
            selected={selected}
            icon={chipIcon("quote", metrics.icon, colors.foreground)}
            label={atomLabel(atom)}
            onPress={goToSource}
            trailing={action}
          />
        </Tooltip>
      }
    >
      <CitationCommentEditor
        citation={atom.citation}
        onCancel={() => {
          open.set(false);
          if (removeOnCancel.current) actions.removeCitation(atom.key);
          removeOnCancel.current = false;
        }}
        onSave={(comment) => {
          removeOnCancel.current = false;
          actions.updateCitation(atom.key, withAssistantCitationComment(atom.citation, comment));
          open.set(false);
        }}
      />
    </Popover>
  );
}

function cssAccentForeground(color: string): string {
  return color.length >= 7 ? color.slice(0, 7) : color;
}

/** web AssistantCitationCommentEditor: an optional comment, Cancel and Save. */
function CitationCommentEditor({
  citation,
  onCancel,
  onSave,
}: {
  citation: AssistantCitation;
  onCancel: () => void;
  onSave: (comment: string) => void;
}) {
  const theme = useTheme();
  const [comment, setComment] = useState(citation.comment ?? "");
  const button = (label: string, primary: boolean, onPress: () => void, testId: string) => (
    <div
      testId={testId}
      onClick={onPress}
      style={{
        display: "flex",
        alignItems: "center",
        height: 24,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: primary ? theme.primary : alpha("#ffffff", 0.08),
        backgroundColor: primary ? theme.primary : alpha("#ffffff", 0.03),
        cursor: "pointer",
      }}
    >
      <text style={{ fontFamily: FONTS.sans, fontSize: 12, fontWeight: 500, lineHeight: 16, color: primary ? theme.primaryForeground : theme.foreground }}>
        {label}
      </text>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        testId="composer-citation-comment-input"
        autoFocus
        value={comment}
        placeholder="Add an optional comment..."
        minRows={3}
        maxRows={8}
        theme={{ caret: theme.foreground }}
        style={{ fontFamily: FONTS.sans, fontSize: 14, lineHeight: 20, color: theme.foreground, paddingLeft: 4, paddingRight: 4, paddingTop: 6, paddingBottom: 6 }}
        onChange={(event) => setComment(event.value ?? "")}
        onKeyDown={(event) => {
          if (event.key === "escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
          if (event.key === "enter" && (event.modifiers?.ctrl || event.modifiers?.cmd)) {
            event.preventDefault();
            event.stopPropagation();
            onSave(comment);
          }
        }}
      />
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 6 }}>
        {button("Cancel", false, onCancel, "composer-citation-comment-cancel")}
        {button("Save", true, () => onSave(comment), "composer-citation-comment-save")}
      </div>
    </div>
  );
}

// ── Context references (web composerContextPresentation registry) ────────

function ContextReferenceChip({ atom, width, fontSize, selected }: { atom: Extract<Atom, { kind: "context" }>; width: number; fontSize: number; selected: boolean }) {
  const env = use(ComposerChipEnvironmentContext);
  if (atom.contextKind === "terminal") {
    const record = env.terminalContexts.get(atom.contextId);
    if (!record) return <UnresolvedChip label={atom.label} width={width} fontSize={fontSize} selected={selected} />;
    return <TerminalChip record={record} label={atom.label} width={width} fontSize={fontSize} selected={selected} />;
  }
  if (atom.contextKind === "thread") {
    const record = env.threadContexts.get(atom.contextId);
    if (!record) return <UnresolvedChip label={atom.label} width={width} fontSize={fontSize} selected={selected} />;
    return <ThreadChip record={record} label={atom.label} width={width} fontSize={fontSize} selected={selected} />;
  }
  if (atom.contextKind === "review-comment") {
    const record = env.reviewComments.get(atom.contextId);
    if (!record) return <UnresolvedChip label={atom.label} width={width} fontSize={fontSize} selected={selected} />;
    return <ReviewCommentChip record={record} label={atom.label} width={width} fontSize={fontSize} selected={selected} />;
  }
  return <UnresolvedChip label={atom.label} width={width} fontSize={fontSize} selected={selected} />;
}

/** web UnresolvedChip: a reference whose record is gone. */
function UnresolvedChip({ label, width, fontSize, selected }: { label: string; width: number; fontSize: number; selected: boolean }) {
  const theme = useTheme();
  const metrics = chipMetrics(fontSize);
  return (
    <Tooltip content="This context is no longer available. Remove it or attach it again." side="top">
      <ChipShell
        kind="neutral"
        width={width}
        fontSize={fontSize}
        selected={selected}
        invalid
        icon={chipIcon("circle-alert", metrics.icon, theme.errorForeground)}
        label={label}
      />
    </Tooltip>
  );
}

/** web TerminalContextInlineChip: the captured lines in a popover. */
function TerminalChip({ record, label, width, fontSize, selected }: { record: TerminalContextDraft; label: string; width: number; fontSize: number; selected: boolean }) {
  const theme = useTheme();
  const metrics = chipMetrics(fontSize);
  const colors = chipColors(theme, "terminal");
  const [open, setOpen] = usePressToggle();
  if (isTerminalContextExpired(record)) {
    return (
      <Tooltip content={`Terminal context expired. Remove and re-add ${label} to include it in your message.`} side="top">
        <ChipShell kind="terminal" width={width} fontSize={fontSize} selected={selected} invalid icon={chipIcon("terminal", metrics.icon, theme.errorForeground)} label={label} />
      </Tooltip>
    );
  }
  const lines = record.text.split("\n");
  return (
    <Popover
      open={open.value}
      onOpenChange={open.set}
      side="top"
      align="start"
      testId="composer-terminal-context-popover"
      style={{ width: 420, padding: 8 }}
      trigger={
        <ChipShell
          kind="terminal"
          testId="composer-chip-terminal"
          width={width}
          fontSize={fontSize}
          selected={selected}
          icon={chipIcon("terminal", metrics.icon, colors.foreground)}
          label={label}
          onPress={setOpen}
        />
      }
    >
      <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.md, borderWidth: 1, borderColor: alpha(theme.border, 0.7), overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderColor: alpha(theme.border, 0.7),
          }}
        >
          <Icon name="terminal" size={16} color={theme.success} />
          <text style={{ color: theme.foreground, fontSize: 14, lineHeight: 20, fontWeight: 500, fontFamily: FONTS.sans, flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
            {record.terminalLabel}
          </text>
          <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, flexShrink: 0 }}>
            {record.lineStart === record.lineEnd ? `Line ${record.lineStart}` : `Lines ${record.lineStart}–${record.lineEnd}`}
          </text>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "scroll", padding: 12, backgroundColor: theme.muted }}>
          {lines.map((line, index) => (
            <text key={index} style={{ color: theme.foreground, fontSize: 12, lineHeight: 19, fontFamily: FONTS.mono, whiteSpace: "nowrap" }}>
              {line.length === 0 ? " " : line}
            </text>
          ))}
        </div>
      </div>
    </Popover>
  );
}

/** web ThreadContextChip: the project's badge and the thread's current title. */
function ThreadChip({
  record,
  label,
  width,
  fontSize,
  selected,
}: {
  record: { readonly environmentId: EnvironmentId; readonly threadId: string; readonly title: string };
  label: string;
  width: number;
  fontSize: number;
  selected: boolean;
}) {
  const theme = useTheme();
  const metrics = chipMetrics(fontSize);
  const colors = chipColors(theme, "thread");
  const shell = useAtomValue(
    environmentThreadShells.threadShellAtom(scopeThreadRef(record.environmentId, record.threadId as never)) as never,
  ) as { title?: string; projectId?: string } | null;
  const projects = useAtomValue(projectIndexAtom);
  const project = shell?.projectId ? projects.get(`${record.environmentId}:${shell.projectId}`) : undefined;

  return (
    <Tooltip content={shell ? "Open thread" : "Thread no longer available"} side="top">
      <ChipShell
        kind="thread"
        testId="composer-chip-thread"
        width={width}
        fontSize={fontSize}
        selected={selected}
        icon={project ? <ProjectGlyph project={project as never} size={metrics.icon} /> : chipIcon("messages-square", metrics.icon, colors.foreground)}
        label={label}
        onPress={() => appAtomRegistry.set(routeAtom, { kind: "thread", environmentId: record.environmentId, threadId: record.threadId } as never)}
      />
    </Tooltip>
  );
}

function ReviewCommentChip({ record, label, width, fontSize, selected }: { record: ReviewCommentContext; label: string; width: number; fontSize: number; selected: boolean }) {
  const theme = useTheme();
  const metrics = chipMetrics(fontSize);
  const colors = chipColors(theme, "review-comment");
  const details = [record.filePath, record.text.trim()].filter(Boolean).join("\n");
  return (
    <Tooltip content={details || "Review comment"} side="top">
      <ChipShell
        kind="review-comment"
        width={width}
        fontSize={fontSize}
        selected={selected}
        icon={chipIcon("message-circle", metrics.icon, colors.foreground)}
        label={label}
      />
    </Tooltip>
  );
}

/**
 * Open state for a chip popover opened by a press on its chip. The popover's own
 * outside-press closes it in the same press that would reopen it, so a press within a few
 * milliseconds of that close is taken as the close.
 */
function usePressToggle(): [{ value: boolean; set: (open: boolean) => void }, () => void] {
  const [value, setValue] = useState(false);
  const closedAt = useRef(0);
  const set = (open: boolean) => {
    if (!open) closedAt.current = Date.now();
    setValue(open);
  };
  const toggle = () => {
    if (Date.now() - closedAt.current < 120) return;
    setValue((current) => !current);
  };
  return [{ value, set }, toggle];
}
