// Port of apps/web/src/components/pullRequest/{pullRequestIcons,pullRequestPresentation}.tsx
// and the GitHub mark from components/Icons.tsx. Tailwind tones are resolved to hex here.
import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import type {
  PullRequestActor,
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestChecksState,
  PullRequestLabel,
  PullRequestMergeability,
  PullRequestReviewDecision,
  PullRequestState,
} from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { FONTS, alpha, useTheme, type Palette } from "../ui/theme.ts";
import { pullRequestLabelColor } from "../web/components/pullRequest/pullRequestList.logic.ts";

/** Tailwind v4 palette entries the pull request views use. */
export const TW = {
  emerald300: "#5ee9b5",
  emerald400: "#00d492",
  emerald600: "#009966",
  zinc400: "#9f9fa9",
  zinc500: "#71717b",
  red300: "#ffa2a2",
  red600: "#e7000b",
  violet300: "#c4b4ff",
  violet600: "#7f22fe",
  amber400: "#ffb900",
  amber500: "#fe9a00",
  amber600: "#e17100",
} as const;

export const PullRequestGlyph = {
  pullRequest: "git-pull-request-arrow",
  reopen: "git-pull-request-arrow",
  draft: "git-pull-request-draft",
  closed: "git-pull-request-closed",
  merged: "git-merge",
  conflicting: "triangle-alert",
  stack: "layers",
  link: "link-2",
  unlink: "unlink-2",
} as const satisfies Record<string, IconName>;

export interface PullRequestStatePresentation {
  readonly label: string;
  readonly icon: IconName;
  readonly tone: (theme: Palette) => string;
}

const dark = (theme: Palette) => theme.appearance === "dark";

export const PULL_REQUEST_STATE_PRESENTATION = {
  open: {
    label: "Open",
    icon: PullRequestGlyph.pullRequest,
    tone: (theme) => (dark(theme) ? alpha(TW.emerald300, 0.9) : TW.emerald600),
  },
  draft: {
    label: "Draft",
    icon: PullRequestGlyph.draft,
    tone: (theme) => (dark(theme) ? alpha(TW.zinc400, 0.8) : TW.zinc500),
  },
  closed: {
    label: "Closed",
    icon: PullRequestGlyph.closed,
    tone: (theme) => (dark(theme) ? alpha(TW.red300, 0.9) : TW.red600),
  },
  merged: {
    label: "Merged",
    icon: PullRequestGlyph.merged,
    tone: (theme) => (dark(theme) ? alpha(TW.violet300, 0.9) : TW.violet600),
  },
} as const satisfies Record<PullRequestState | "draft", PullRequestStatePresentation>;

export function resolvePullRequestState(input: {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
}): PullRequestStatePresentation {
  const key = input.state === "open" && input.isDraft ? "draft" : input.state;
  return PULL_REQUEST_STATE_PRESENTATION[key];
}

/** A tooltip needs a hit target; this one carries no fill so the row under it still paints hover. */
function TooltipSpan({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip content={label} side="top">
      <div style={{ display: "flex", flexShrink: 0 }}>{children}</div>
    </Tooltip>
  );
}

export function PullRequestStateGlyph({
  state,
  isDraft,
  size = 16,
}: {
  state: PullRequestState;
  isDraft: boolean;
  size?: number;
}) {
  const theme = useTheme();
  const presentation = resolvePullRequestState({ state, isDraft });
  return (
    <TooltipSpan label={presentation.label}>
      <Icon name={presentation.icon} size={size} color={presentation.tone(theme)} />
    </TooltipSpan>
  );
}

export function resolvePullRequestConflict(input: {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly mergeability?: PullRequestMergeability | undefined;
  readonly baseBranch?: string | undefined;
}): { readonly label: string } | null {
  if (input.state !== "open" || input.isDraft || input.mergeability !== "conflicting") {
    return null;
  }
  return { label: input.baseBranch ? `Conflicts with ${input.baseBranch}` : "Has conflicts" };
}

/** apps/web/src/components/pullRequest/PullRequestListRow.tsx PullRequestRowGlyph. */
export function PullRequestRowGlyph({
  state,
  isDraft,
  mergeability,
  baseBranch,
}: {
  state: PullRequestState;
  isDraft: boolean;
  mergeability?: PullRequestMergeability | undefined;
  baseBranch?: string | undefined;
}) {
  const theme = useTheme();
  const conflict = resolvePullRequestConflict({ state, isDraft, mergeability, baseBranch });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 16,
        flexShrink: 0,
        marginTop: 3,
        alignSelf: "flex-start",
      }}
    >
      <div style={{ position: "relative", display: "flex" }}>
        <PullRequestStateGlyph state={state} isDraft={isDraft} />
        {conflict ? (
          <div style={{ position: "absolute", right: -4, bottom: -4, display: "flex" }}>
            <TooltipSpan label={conflict.label}>
              {/* The web glyph fills with the background to cut it out of the state icon. */}
              <svg
                source={CONFLICT_SVG}
                style={{ width: 12, height: 12, color: theme.error, pointerEvents: "none" }}
              />
            </TooltipSpan>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// lucide triangle-alert, stroke 2.5, with its body filled in the page background.
const CONFLICT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

function reviewDecisionPresentation(decision: PullRequestReviewDecision, theme: Palette) {
  switch (decision) {
    case "approved":
      return {
        icon: "user-check" as const,
        label: "Approved",
        tone: dark(theme) ? alpha(TW.emerald300, 0.9) : TW.emerald600,
      };
    case "changes-requested":
      return {
        icon: "user-round-x" as const,
        label: "Changes requested",
        tone: dark(theme) ? alpha(TW.amber400, 0.8) : alpha(TW.amber600, 0.9),
      };
    case "review-required":
      return {
        icon: "user-round" as const,
        label: "Awaiting review",
        tone: alpha(theme.mutedForeground, 0.6),
      };
  }
}

export function PullRequestReviewDecisionGlyph({ decision }: { decision: PullRequestReviewDecision }) {
  const theme = useTheme();
  const presentation = reviewDecisionPresentation(decision, theme);
  return (
    <TooltipSpan label={presentation.label}>
      <Icon name={presentation.icon} size={14} color={presentation.tone} />
    </TooltipSpan>
  );
}

// ── Checks ──────────────────────────────────────────────────────────────

export function checkStatusPresentation(status: PullRequestCheckStatus, theme: Palette) {
  const amber = dark(theme) ? alpha(TW.amber400, 0.9) : TW.amber600;
  const success = dark(theme) ? alpha(TW.emerald300, 0.9) : TW.emerald600;
  const muted70 = alpha(theme.mutedForeground, 0.7);
  switch (status) {
    case "pending":
      // Web spins a Spinner here; t3-term draws no repainting animations, so it holds still.
      return { label: "Running", icon: "loader-circle" as IconName, tone: TW.amber500 };
    case "action-required":
      return { label: "Awaiting action", icon: "circle-dot" as IconName, tone: amber };
    case "success":
      return { label: "Passed", icon: "circle-check" as IconName, tone: success };
    case "failure":
      return { label: "Failed", icon: "circle-x" as IconName, tone: theme.error };
    case "cancelled":
      return { label: "Cancelled", icon: "circle-x" as IconName, tone: theme.error };
    case "skipped":
      return { label: "Skipped", icon: "circle-slash" as IconName, tone: muted70 };
    case "neutral":
      return { label: "Neutral", icon: "circle-dashed" as IconName, tone: muted70 };
  }
}

function isWorkflowApprovalCheck(check: Pick<PullRequestCheck, "status" | "url">): boolean {
  return (
    check.status === "action-required" &&
    check.url !== null &&
    /\/actions\/runs\/\d+(?:\/|$)/u.test(check.url)
  );
}

export function pullRequestCheckStatusLabel(
  check: Pick<PullRequestCheck, "status" | "url">,
  theme: Palette,
): string {
  return isWorkflowApprovalCheck(check)
    ? "Awaiting approval"
    : checkStatusPresentation(check.status, theme).label;
}

export function pullRequestChecksStatePresentation(state: PullRequestChecksState, theme: Palette) {
  switch (state) {
    case "passing":
      return {
        label: "All checks have passed",
        icon: "circle-check" as IconName,
        tone: dark(theme) ? alpha(TW.emerald300, 0.9) : TW.emerald600,
      };
    case "failing":
      return {
        label: "Some checks were not successful",
        icon: "circle-x" as IconName,
        tone: theme.error,
      };
    case "pending":
      return {
        label: "Some checks haven't completed yet",
        icon: "circle-dot" as IconName,
        tone: dark(theme) ? alpha(TW.amber400, 0.9) : TW.amber600,
      };
  }
}

export function pullRequestChecksState(
  checks: ReadonlyArray<PullRequestCheck>,
): PullRequestChecksState | null {
  if (checks.length === 0) return null;
  const statuses = new Set(checks.map((check) => check.status));
  if (statuses.has("failure") || statuses.has("cancelled")) return "failing";
  if (statuses.has("pending") || statuses.has("action-required")) return "pending";
  return statuses.has("success") ? "passing" : null;
}

export function summarizePullRequestChecks(checks: ReadonlyArray<PullRequestCheck>): string {
  if (checks.length === 0) return "No checks reported";
  const actionRequired = checks.filter((check) => check.status === "action-required");
  const workflowApprovalRequired = actionRequired.filter(isWorkflowApprovalCheck).length;
  const otherActionRequired = actionRequired.length - workflowApprovalRequired;
  const failed = checks.filter(
    (check) => check.status === "failure" || check.status === "cancelled",
  ).length;
  const pending = checks.filter((check) => check.status === "pending").length;
  const passed = checks.filter((check) => check.status === "success").length;
  if (failed > 0) return `${failed} of ${checks.length} failing`;
  if (workflowApprovalRequired > 0 && otherActionRequired > 0) {
    return `${workflowApprovalRequired} ${workflowApprovalRequired === 1 ? "workflow" : "workflows"} and ${otherActionRequired} ${otherActionRequired === 1 ? "check" : "checks"} awaiting action`;
  }
  if (workflowApprovalRequired > 0) {
    return `${workflowApprovalRequired} ${workflowApprovalRequired === 1 ? "workflow" : "workflows"} awaiting approval`;
  }
  if (otherActionRequired > 0) {
    return `${otherActionRequired} ${otherActionRequired === 1 ? "check" : "checks"} awaiting action`;
  }
  if (pending > 0) return `${pending} of ${checks.length} running`;
  return passed === checks.length ? "All checks passed" : `${passed} of ${checks.length} passing`;
}

// ── Labels, actors, diff stats ──────────────────────────────────────────

function parseHex(color: string): [number, number, number] {
  const hex = color.replace(/^#/, "");
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/** CSS `color-mix(in srgb, a amount, b)` for opaque hex colors. */
export function mixColors(a: string, amount: number, b: string): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const mix = (x: number, y: number) =>
    Math.round(x * amount + y * (1 - amount))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

/** Badge `variant="label"` (apps/web/src/components/ui/badge.tsx) with the label's own color. */
export function pullRequestLabelChipColors(
  label: Pick<PullRequestLabel, "color">,
  theme: Palette,
): { readonly background: string; readonly foreground: string } {
  const color = pullRequestLabelColor(label.color);
  if (color === null) return { background: theme.secondary, foreground: theme.foreground };
  return dark(theme)
    ? { background: alpha(color, 0.12), foreground: mixColors(color, 0.45, theme.foreground) }
    : { background: alpha(color, 0.08), foreground: mixColors(color, 0.3, theme.foreground) };
}

export function PullRequestLabelChip({
  label,
  size = "sm",
  maxWidth = 160,
  children,
}: {
  label: Pick<PullRequestLabel, "name" | "color">;
  size?: "sm" | "default";
  maxWidth?: number;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const colors = pullRequestLabelChipColors(label, theme);
  const fontSize = size === "sm" ? 10 : 12;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: size === "sm" ? 16 : 18,
        minWidth: size === "sm" ? 16 : 18,
        maxWidth,
        flexShrink: 1,
        paddingLeft: 3,
        paddingRight: 3,
        borderRadius: size === "sm" ? 4 : 6,
        backgroundColor: colors.background,
        overflow: "hidden",
      }}
    >
      <text
        style={{
          color: colors.foreground,
          fontSize,
          lineHeight: fontSize + 2,
          fontWeight: 500,
          fontFamily: FONTS.sans,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {label.name}
      </text>
      {children}
    </div>
  );
}

export function PullRequestActorAvatar({
  actor,
  size = 16,
}: {
  actor: PullRequestActor | null;
  size?: number;
}) {
  const theme = useTheme();
  const login = actor?.login ?? "ghost";
  const avatarUrl = actor?.avatarUrl ?? null;
  // gpuix <img> reports no load failure, so a broken avatar stays an empty circle.
  if (avatarUrl !== null) {
    return (
      <img
        src={avatarUrl}
        objectFit="cover"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          flexShrink: 0,
          backgroundColor: theme.muted,
        }}
      />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size / 2,
        flexShrink: 0,
        backgroundColor: theme.muted,
      }}
    >
      <text
        style={{
          color: theme.mutedForeground,
          fontSize: 10,
          lineHeight: 12,
          fontWeight: 500,
          fontFamily: FONTS.sans,
        }}
      >
        {login.slice(0, 1).toUpperCase()}
      </text>
    </div>
  );
}

export function PullRequestDiffStat({
  additions,
  deletions,
  fontSize = 11,
  lineHeight = 16,
}: {
  additions: number;
  deletions: number;
  fontSize?: number;
  lineHeight?: number;
}) {
  const theme = useTheme();
  if (additions === 0 && deletions === 0) return null;
  const style = { fontSize, lineHeight, fontFamily: FONTS.mono, whiteSpace: "nowrap" as const };
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <text style={{ ...style, color: theme.diffAdd }}>{`+${formatDiffCount(additions)}`}</text>
      <text style={{ ...style, color: theme.diffDel }}>{`-${formatDiffCount(deletions)}`}</text>
    </div>
  );
}

/** The GitHub mark from apps/web/src/components/Icons.tsx. */
export const GITHUB_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"/></svg>`;

/** Source control provider mark: GitHub gets its own glyph, the rest the pull request icon. */
export function SourceControlIcon({ kind, size = 16, color }: { kind: string; size?: number; color: string }) {
  if (kind === "github") {
    return <svg source={GITHUB_MARK_SVG} style={{ width: size, height: size, color, flexShrink: 0, pointerEvents: "none" }} />;
  }
  return <Icon name={PullRequestGlyph.pullRequest} size={size} color={color} />;
}

/** apps/web/src/timestampFormat.ts formatRelativeTimeLabel: "just now", "5m ago", "2h ago", "3d ago". */
export function formatRelativeTimeLabel(isoDate: string, nowMs: number = Date.now()): string {
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return "";
  const seconds = Math.floor(Math.max(0, nowMs - time) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
