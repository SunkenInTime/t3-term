// View helpers shared by the details card PR rows and the Pull request surface, after
// apps/web/src/components/pullRequest/{pullRequestIcons.tsx,pullRequestPresentation.tsx,PullRequestChecksPopover.tsx}.
import type { PullRequestActor, PullRequestCheck, PullRequestState } from "@t3tools/contracts";
import { useState } from "react";

import {
  groupPullRequestChecks,
  pullRequestCheckStatusLabel,
  summarizePullRequestChecks,
  type PullRequestChecksState,
} from "../../web/components/pullRequest/pullRequestSurface.logic.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Popover } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import { openExternalUrl } from "./openExternal.ts";

export interface PullRequestStatePresentation {
  readonly label: string;
  readonly color: string;
  readonly icon: IconName;
}

/** PULL_REQUEST_STATE_PRESENTATION: emerald open, zinc draft, red closed, violet merged. */
export function resolvePullRequestState(
  theme: Palette,
  input: { readonly state: PullRequestState; readonly isDraft: boolean },
): PullRequestStatePresentation {
  const dark = theme.appearance === "dark";
  const key = input.state === "open" && input.isDraft ? "draft" : input.state;
  switch (key) {
    case "open":
      return { label: "Open", color: dark ? "#6ee7b7e6" : "#059669", icon: "git-pull-request-arrow" };
    case "draft":
      return { label: "Draft", color: dark ? "#9f9fa9cc" : "#71717b", icon: "git-pull-request-draft" };
    case "closed":
      return { label: "Closed", color: dark ? "#fca5a5e6" : "#dc2626", icon: "git-pull-request-closed" };
    case "merged":
      return { label: "Merged", color: dark ? "#c4b5fde6" : "#7c3aed", icon: "git-merge" };
  }
}

export function checkStatusPresentation(
  theme: Palette,
  status: PullRequestCheck["status"],
): { icon: IconName; color: string } {
  const dark = theme.appearance === "dark";
  switch (status) {
    // Web spins a loader here; T3 rules out repainting animations, so it stays still.
    case "pending":
      return { icon: "loader-circle", color: "#f59e0b" };
    case "action-required":
      return { icon: "circle-dot", color: dark ? "#fbbf24e6" : "#d97706" };
    case "success":
      return { icon: "circle-check", color: dark ? "#6ee7b7e6" : "#059669" };
    case "failure":
    case "cancelled":
      return { icon: "circle-x", color: theme.errorForeground };
    case "skipped":
      return { icon: "circle-slash", color: alpha(theme.mutedForeground, 0.7) };
    case "neutral":
      return { icon: "circle-dashed", color: alpha(theme.mutedForeground, 0.7) };
  }
}

export function checksStatePresentation(theme: Palette, state: PullRequestChecksState) {
  const dark = theme.appearance === "dark";
  switch (state) {
    case "passing":
      return { label: "All checks have passed", icon: "circle-check" as IconName, color: dark ? "#6ee7b7e6" : "#059669" };
    case "failing":
      return { label: "Some checks were not successful", icon: "circle-x" as IconName, color: theme.errorForeground };
    case "pending":
      return { label: "Some checks haven't completed yet", icon: "circle-dot" as IconName, color: dark ? "#fbbf24e6" : "#d97706" };
  }
}

export function CheckStatusIcon({ status, size = 14 }: { status: PullRequestCheck["status"]; size?: number }) {
  const theme = useTheme();
  const presentation = checkStatusPresentation(theme, status);
  return <Icon name={presentation.icon} size={size} color={presentation.color} />;
}

/** "17h ago" style label, like web's RelativeTime. */
export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function ActorAvatar({ actor, size = 16 }: { actor: PullRequestActor | null; size?: number }) {
  const theme = useTheme();
  if (actor?.avatarUrl) {
    return (
      <img
        src={actor.avatarUrl}
        objectFit="cover"
        style={{ width: size, height: size, borderRadius: size / 2, flexShrink: 0 }}
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
        backgroundColor: theme.accent,
      }}
    >
      <text style={{ color: theme.mutedForeground, fontSize: Math.max(8, size * 0.55), lineHeight: size, fontFamily: FONTS.sans }}>
        {(actor?.login ?? "?").slice(0, 1).toUpperCase()}
      </text>
    </div>
  );
}

/** "+N −M" in the diff colors, mono. */
export function DiffStatText({ additions, deletions, size = 11 }: { additions: number; deletions: number; size?: number }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <text style={{ color: theme.diffAdd, fontSize: size, lineHeight: 16, fontFamily: FONTS.mono }}>{`+${additions.toLocaleString()}`}</text>
      <text style={{ color: theme.diffDel, fontSize: size, lineHeight: 16, fontFamily: FONTS.mono }}>{`-${deletions.toLocaleString()}`}</text>
    </div>
  );
}

function ChecksBody({ checks }: { checks: ReadonlyArray<PullRequestCheck> }) {
  const theme = useTheme();
  const [showAll, setShowAll] = useState(false);
  const { attention, running, completed } = groupPullRequestChecks(checks);
  const canCollapse = attention.length + running.length > 0 && completed.length > 0;
  const visible = [...attention, ...running, ...(showAll || !canCollapse ? completed : [])];
  if (checks.length === 0) {
    return (
      <Text size="xs" color={theme.mutedForeground}>
        No checks reported
      </Text>
    );
  }
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 256, overflowY: "scroll", scrollbarColor: theme.scrollbar }}>
        {visible.map((check, index) => (
          <div key={`${index}:${check.name}`} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 18, flexShrink: 0 }}>
            <CheckStatusIcon status={check.status} />
            <Text size="xs" truncate style={{ flexGrow: 1 }}>
              {check.name}
            </Text>
            <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
              {pullRequestCheckStatusLabel(check)}
            </Text>
            {check.url === null ? null : (
              <div onClick={() => check.url && openExternalUrl(check.url)} style={{ cursor: "pointer", flexShrink: 0, hover: { opacity: 0.8 } }}>
                <Text size="xs" color={theme.primary === "#346bf1" ? theme.infoForeground : theme.primary}>
                  Details
                </Text>
              </div>
            )}
          </div>
        ))}
      </div>
      {canCollapse ? (
        <div style={{ display: "flex", flexDirection: "row", marginTop: 4 }}>
          <Button variant="ghost" size="xs" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show less" : "Show all"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * PullRequestChecksPopover. `count` renders "✓ 21/30" (or "2 failed") as the trigger;
 * `icon` renders only the rollup icon. The popup lists the checks.
 */
export function ChecksPopover({
  checksState,
  checks,
  variant = "icon",
  label,
  testId,
}: {
  checksState: PullRequestChecksState;
  checks: ReadonlyArray<PullRequestCheck>;
  variant?: "icon" | "count" | "summary";
  /** For `summary`: text after the icon. */
  label?: string;
  testId?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const presentation = checksStatePresentation(theme, checksState);
  const incomplete = checks.filter((check) => check.status === "pending" || check.status === "action-required").length;
  const failed = checks.filter((check) => check.status === "failure" || check.status === "cancelled").length;
  const countText =
    variant === "summary"
      ? (label ?? summarizePullRequestChecks(checks))
      : variant === "count"
        ? incomplete > 0
          ? `${checks.length - incomplete}/${checks.length}`
          : failed > 0
            ? `${failed} failed`
            : null
        : null;
  const hover = theme.appearance === "dark" ? alpha("#ffffff", 0.08) : alpha("#000000", 0.035);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      style={{ padding: 12, width: 320 }}
      trigger={
        <div
          testId={testId}
          onClick={() => setOpen(!open)}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            height: 24,
            paddingLeft: variant === "icon" ? 2 : 6,
            paddingRight: variant === "icon" ? 2 : 6,
            borderRadius: RADIUS.sm,
            cursor: "pointer",
            flexShrink: 0,
            backgroundColor: open ? hover : "#00000000",
            hover: { backgroundColor: hover },
          }}
        >
          <Icon name={presentation.icon} size={14} color={presentation.color} />
          {countText ? (
            <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, whiteSpace: "nowrap" }}>
              {countText}
            </text>
          ) : null}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Text weight={500}>{presentation.label}</Text>
        <Text size="xs" color={theme.mutedForeground}>
          {summarizePullRequestChecks(checks)}
        </Text>
        <ChecksBody checks={checks} />
      </div>
    </Popover>
  );
}

/**
 * Host markdown carries raw HTML (bot comments, <details> blocks) that web renders through a
 * sanitizer. gpuix's <markdown> shows tags as text, so the common ones become markdown here
 * and the rest are dropped. Fenced code is left alone.
 */
export function hostMarkdownToGpuix(body: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, "");
  for (const line of withoutComments.split("\n")) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]!;
      else if (fenceMatch[1]!.startsWith(fence[0]!)) fence = null;
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      continue;
    }
    const converted = line
      .replace(/<picture\b[\s\S]*?<\/picture>/gi, "")
      .replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*>/gi, "$1")
      .replace(/<img\b[^>]*>/gi, "")
      .replace(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) =>
        text.trim().length > 0 ? `[${text.trim()}](${href.replaceAll("&amp;", "&")})` : "",
      )
      .replace(/<\/?(strong|b)>/gi, "**")
      .replace(/<\/?(em|i)>/gi, "_")
      .replace(/<\/?code>/gi, "`")
      .replace(/<br\s*\/?>/gi, "  ")
      .replace(/<summary>([\s\S]*?)<\/summary>/gi, "$1")
      .replace(/<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>/gi, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    out.push(converted);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
