// The detail header's interactive pieces: the title the reader can rename
// (apps/web/src/components/pullRequest/PullRequestTitleEditor.tsx), the base branch with its
// out-of-date warning and "Update branch" (PullRequestBaseBranch.tsx), the copy-on-click checkout
// command and head branch (PullRequestCopyableCode.tsx), and the diff stat whose hover splits it
// into code, tests, mocks, generated and docs (PullRequestChangeBreakdownStat.tsx).
import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestChangeBreakdown,
  PullRequestDetail,
  PullRequestRef,
  PullRequestUpdateMethod,
} from "@t3tools/contracts";
import { FloatingLayer } from "@gpuix/react/floating";
import * as TooltipPrimitive from "@gpuix/react/tooltip";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import { copyTextToClipboard } from "../chat/header/osActions.ts";
import { pullRequestEnvironment, useEnvironmentQuery } from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { surfaceStyle, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast } from "../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { readableFailure } from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { canEditPullRequestChangeRequest } from "../web/components/pullRequest/pullRequestEditing.logic.ts";
import { PrButton, PrEditButton, PrInput } from "./prControls.tsx";
import { PullRequestDiffStat, PullRequestGlyph } from "./pullRequestPresentation.tsx";
import { runPullRequestWrite } from "./pullRequestWrites.ts";

/** A tooltip whose body is more than one line of text (the overlay kit's Tooltip takes a string). */
export function RichTooltip({
  content,
  side = "bottom",
  children,
  onOpen,
}: {
  content: ReactNode | null;
  side?: "top" | "bottom";
  children: ReactElement;
  onOpen?: () => void;
}) {
  const theme = useTheme();
  return (
    <TooltipPrimitive.Root onOpenChange={(open: boolean) => (open ? onOpen?.() : undefined)}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      {content === null ? null : (
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          style={{
            display: "flex",
            flexDirection: "column",
            paddingTop: 4,
            paddingBottom: 4,
            paddingLeft: 8,
            paddingRight: 8,
            maxWidth: 360,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.appearance === "dark" ? "#141414" : "#ffffff",
          }}
        >
          {typeof content === "string" ? (
            <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>{content}</text>
          ) : (
            content
          )}
        </TooltipPrimitive.Content>
      )}
    </TooltipPrimitive.Root>
  );
}

// ── Title ───────────────────────────────────────────────────────────────

export function PullRequestTitleEditor({
  environmentId,
  reference,
  pullRequestKey,
  detail,
  canWriteSourceControl,
  onSaved,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  pullRequestKey: string;
  detail: PullRequestDetail;
  canWriteSourceControl: boolean;
  onSaved: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [titleScope, setTitleScope] = useState<{ readonly pullRequestKey: string; readonly text: string } | null>(null);
  const titleDraft = titleScope?.pullRequestKey === pullRequestKey ? titleScope.text : null;
  const [titleSaving, setTitleSaving] = useState(false);

  const saveTitle = async (next: string) => {
    const title = next.trim();
    if (!canWriteSourceControl || titleSaving) return;
    if (title.length === 0 || title === detail.title) {
      setTitleScope(null);
      return;
    }
    setTitleSaving(true);
    const result = await runPullRequestWrite(pullRequestEnvironment.update, {
      environmentId,
      input: { ...reference, title },
    });
    setTitleSaving(false);
    if (result._tag === "Failure") {
      toast({
        type: "error",
        title: "The title could not be saved",
        description: readableFailure(squashAtomCommandFailure(result), "The host refused the new title."),
      });
      return;
    }
    setTitleScope(null);
    onSaved();
  };

  if (titleDraft === null) {
    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 24, minWidth: 0 }}
      >
        <Tooltip content={detail.title} side="top">
          <div style={{ display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            <Text size="base" weight={600} truncate testId="pr-detail-title" style={{ lineHeight: 22 }}>
              {detail.title}
            </Text>
          </div>
        </Tooltip>
        {canEditPullRequestChangeRequest(detail) ? (
          <PrEditButton
            visible={hovered}
            label="Edit title"
            testId="pr-edit-title"
            onClick={() => setTitleScope({ pullRequestKey, text: detail.title })}
          />
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <PrInput
        autoFocus
        disabled={titleSaving}
        value={titleDraft}
        testId="pr-title-input"
        onChange={(text) => setTitleScope({ pullRequestKey, text })}
        onSubmit={() => void saveTitle(titleDraft)}
        onKeyDown={(event) => {
          if (event.key === "escape") {
            setTitleScope(null);
          }
        }}
      />
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <PrButton variant="ghost" disabled={titleSaving} onClick={() => setTitleScope(null)} testId="pr-title-cancel">
          Cancel
        </PrButton>
        <PrButton
          variant="outline"
          disabled={!canWriteSourceControl || titleSaving || titleDraft.trim().length === 0}
          onClick={() => void saveTitle(titleDraft)}
          testId="pr-title-save"
        >
          {titleSaving ? "Saving..." : "Save"}
        </PrButton>
      </div>
    </div>
  );
}

// ── Copyable code ───────────────────────────────────────────────────────

export function PullRequestCopyableCode({
  value,
  copyLabel,
  copiedLabel,
  tooltipSide = "top",
  fontSize = 12,
  color,
  testId,
  grow = false,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
  tooltipSide?: "top" | "bottom";
  fontSize?: number;
  color?: string;
  testId?: string;
  grow?: boolean;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = () => {
    void copyTextToClipboard(value).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      },
      (error: unknown) =>
        toast({
          type: "error",
          title: `Could not copy ${copyLabel.replace(/^Copy /u, "")}`,
          description: error instanceof Error ? error.message : undefined,
        }),
    );
  };
  return (
    <Tooltip content={`${copied ? "Copied" : copyLabel}: ${value}`} side={tooltipSide}>
      <div
        testId={testId}
        onClick={copy}
        style={{
          display: "flex",
          position: "relative",
          minWidth: 0,
          flexShrink: 1,
          ...(grow ? { flexGrow: 1 } : {}),
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 2,
          paddingBottom: 2,
          borderRadius: 4,
          cursor: "pointer",
          hover: { backgroundColor: alpha(theme.accent, 0.45) },
        }}
      >
        <text
          style={{
            color: copied ? "#00000000" : (color ?? theme.mutedForeground),
            fontSize,
            lineHeight: 16,
            fontFamily: FONTS.mono,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {value}
        </text>
        {copied ? (
          <div style={{ display: "flex", position: "absolute", left: 0, right: 0, top: 2, bottom: 2, justifyContent: "center", pointerEvents: "none" }}>
            <Text size="xs" color={theme.foreground}>
              Copied
            </Text>
          </div>
        ) : null}
      </div>
    </Tooltip>
  );
}

// ── Base branch ─────────────────────────────────────────────────────────

interface BaseFreshness {
  readonly behindBy: number | null;
  readonly methods: ReadonlyArray<PullRequestUpdateMethod>;
}

export function PullRequestBaseBranch({
  baseBranch,
  freshness,
  stacked,
  pending,
  onUpdate,
  fontSize = 12,
  iconSize = 14,
  color,
}: {
  baseBranch: string;
  freshness: BaseFreshness | null;
  stacked: boolean;
  pending: boolean;
  onUpdate: (method: PullRequestUpdateMethod) => void;
  fontSize?: number;
  iconSize?: number;
  color: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const label = (tone: string) => (
    <>
      {stacked ? <Icon name={PullRequestGlyph.stack} size={12} color={tone} /> : null}
      <text style={{ color: tone, fontSize, lineHeight: 16, fontFamily: FONTS.mono, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
        {baseBranch}
      </text>
    </>
  );
  if (!freshness) {
    return (
      <Tooltip content={stacked ? `Stacked on ${baseBranch}` : baseBranch} side="top">
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 0, maxWidth: "40%" }}>
          {label(color)}
        </div>
      </Tooltip>
    );
  }
  const behind =
    freshness.behindBy === null
      ? ""
      : ` by ${freshness.behindBy.toLocaleString()} ${freshness.behindBy === 1 ? "commit" : "commits"}`;
  const summary = `This branch is out-of-date with ${baseBranch}${behind}.`;
  const holdOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setOpen(true);
  };
  const letClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  return (
    <div
      testId="pr-base-freshness"
      onMouseEnter={holdOpen}
      onMouseLeave={letClose}
      onClick={() => setOpen(!open)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 0, maxWidth: "40%", position: "relative", cursor: "default" }}
    >
      {label(theme.warningForeground)}
      <Icon name="triangle-alert" size={iconSize} color={theme.warningForeground} />
      {open ? (
        <FloatingLayer side="bottom" align="start" sideOffset={4} onMouseDownOutside={() => setOpen(false)}>
          <div
            onMouseEnter={holdOpen}
            onMouseLeave={letClose}
            style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", maxWidth: 320, padding: 8, pointerEvents: "auto" }}
          >
            <Text size="xs">{summary}</Text>
            <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 2 }}>
              Changes can be cleanly merged.
            </Text>
            {freshness.methods.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8 }}>
                {freshness.methods.map((method) => (
                  <PrButton
                    key={method}
                    icon={PullRequestGlyph.merged}
                    disabled={pending}
                    onClick={() => onUpdate(method)}
                    testId={`pr-update-branch-${method}`}
                  >
                    {method === "rebase" ? "Update with rebase" : "Update branch"}
                  </PrButton>
                ))}
              </div>
            ) : null}
          </div>
        </FloatingLayer>
      ) : null}
    </div>
  );
}

// ── Diff stat with its breakdown ────────────────────────────────────────

const KIND_LABELS = {
  code: "Code",
  tests: "Tests",
  mocks: "Mocks",
  generated: "Generated",
  docs: "Docs",
} satisfies Record<keyof NonNullable<PullRequestChangeBreakdown>, string>;

function BreakdownGrid({
  breakdown,
  total,
}: {
  breakdown: NonNullable<PullRequestChangeBreakdown>;
  total?: { additions: number; deletions: number };
}) {
  const theme = useTheme();
  const rows = (Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>)
    .filter((kind) => breakdown[kind].additions !== 0 || breakdown[kind].deletions !== 0)
    .map((kind) => ({ label: KIND_LABELS[kind], ...breakdown[kind] }));
  const all = total ? [...rows, { label: "Total", ...total }] : rows;
  const mono = { fontFamily: FONTS.mono, fontSize: 12, lineHeight: 16 } as const;
  const column = (render: (row: (typeof all)[number], index: number) => ReactNode, alignEnd: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: alignEnd ? "flex-end" : "flex-start" }}>
      {all.map((row, index) => (
        <div key={row.label} style={{ display: "flex", flexDirection: "column" }}>
          {total && index === all.length - 1 ? <div style={{ height: 1, marginBottom: 4, backgroundColor: theme.border }} /> : null}
          {render(row, index)}
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 16, paddingTop: 2, paddingBottom: 2 }}>
      {column((row) => <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>{row.label}</text>, false)}
      {column((row) => <text style={{ ...mono, color: theme.diffAdd }}>{`+${formatDiffCount(row.additions)}`}</text>, true)}
      {column((row) => <text style={{ ...mono, color: theme.diffDel }}>{`-${formatDiffCount(row.deletions)}`}</text>, true)}
    </div>
  );
}

export function PullRequestChangeBreakdownStat({
  environmentId,
  reference,
  additions,
  deletions,
  fontSize = 11,
  eager = false,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  additions: number;
  deletions: number;
  fontSize?: number;
  eager?: boolean;
}) {
  const [requested, setRequested] = useState(eager);
  const query = useEnvironmentQuery(
    requested ? pullRequestEnvironment.changeBreakdown({ environmentId, input: reference }) : null,
  );
  if (additions === 0 && deletions === 0) return null;
  const breakdown = query.data;
  return (
    <RichTooltip
      side="bottom"
      onOpen={() => setRequested(true)}
      content={
        breakdown ? (
          <BreakdownGrid breakdown={breakdown} total={{ additions, deletions }} />
        ) : query.isPending ? (
          "Loading breakdown"
        ) : null
      }
    >
      <div testId="pr-diffstat" onMouseEnter={() => setRequested(true)} style={{ display: "flex", flexShrink: 0 }}>
        <PullRequestDiffStat additions={additions} deletions={deletions} fontSize={fontSize} />
      </div>
    </RichTooltip>
  );
}
