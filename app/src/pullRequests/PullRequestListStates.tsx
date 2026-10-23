// Ports of apps/web/src/components/pullRequest/{PullRequestGhosts (list ghost),
// PullRequestListEmptyState, PullRequestsUnavailableState}.tsx and ui/empty.tsx.
// Web pulses the ghost (animate-skeleton); t3-term keeps it still.
import type { ReactNode } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { OutlineButton } from "./PullRequestMenus.tsx";
import { PullRequestGlyph } from "./pullRequestPresentation.tsx";

export function GhostBar({
  width,
  height = 12,
  radius = 4,
  style,
}: {
  width: number | string;
  height?: number;
  radius?: number;
  style?: Record<string, unknown>;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        flexShrink: 0,
        backgroundColor: alpha(theme.mutedForeground, 0.15),
        ...style,
      }}
    />
  );
}

const TITLE_WIDTHS = ["60%", "40%", "50%", "66.6667%", "40%", "60%", "50%"];
const META_WIDTHS = ["40%", "33.3333%", "40%", "25%", "33.3333%", "40%", "33.3333%"];

export function PullRequestListGhost({ rows = 7, caption }: { rows?: number; caption?: string }) {
  const theme = useTheme();
  return (
    <div testId="pr-list-ghost" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {caption ? (
        <div style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 4 }}>
          <Text size="xs" weight={500} color={alpha(theme.mutedForeground, 0.7)}>
            {caption}
          </Text>
        </div>
      ) : null}
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 10,
            paddingBottom: 10,
            borderRadius: RADIUS.md,
          }}
        >
          <GhostBar width={16} height={16} radius={8} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, minWidth: 0 }}>
            <GhostBar width={TITLE_WIDTHS[index % TITLE_WIDTHS.length]!} height={16} />
            <GhostBar width={META_WIDTHS[index % META_WIDTHS.length]!} height={14} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <GhostBar width={48} />
            <GhostBar width={64} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty ───────────────────────────────────────────────────────────────

function Empty({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      testId={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flexGrow: 1,
        minWidth: 0,
        gap: 24,
        padding: 48,
      }}
    >
      {children}
    </div>
  );
}

function EmptyHeader({ title, description }: { title: string; description: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 384, gap: 4 }}>
      <Text size="xl" weight={600} style={{ textAlign: "center" }}>
        {title}
      </Text>
      <Text color={theme.mutedForeground} style={{ textAlign: "center" }}>
        {description}
      </Text>
    </div>
  );
}

function SmallButton({
  icon,
  children,
  disabled,
  onClick,
  primary = false,
  testId,
}: {
  icon?: IconName;
  children: string;
  disabled?: boolean;
  onClick: () => void;
  primary?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  if (primary) {
    return (
      <div
        testId={testId}
        onClick={disabled ? undefined : onClick}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          height: 28,
          paddingLeft: 9,
          paddingRight: 9,
          borderRadius: RADIUS.md,
          backgroundColor: theme.primary,
          cursor: "pointer",
          hover: { backgroundColor: alpha(theme.primary, 0.9) },
        }}
      >
        {icon ? <Icon name={icon} size={14} color={theme.primaryForeground} /> : null}
        <Text weight={500} color={theme.primaryForeground}>
          {children}
        </Text>
      </div>
    );
  }
  return (
    <OutlineButton testId={testId} height={28} disabled={disabled} onClick={onClick}>
      {icon ? <Icon name={icon} size={14} color={theme.mutedForeground} /> : null}
      <Text weight={500}>{children}</Text>
    </OutlineButton>
  );
}

function branchMarkSvg(joined: boolean): string {
  const arcs = joined
    ? `<path d="M30 58c0-18 8-26 24-26h12c16 0 24 8 24 26"/>`
    : `<path d="M30 58c0-18 8-26 24-26h4"/><path d="M90 58c0-18-8-26-24-26h-4" stroke-dasharray="2 7" stroke-opacity="0.83"/>`;
  const knot = joined
    ? `<circle cx="60" cy="32" r="5" fill="currentColor" fill-opacity="0.25"/>`
    : `<circle cx="60" cy="32" r="4" stroke-opacity="0.75"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 72" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 58h100" stroke-opacity="0.5"/><circle cx="10" cy="58" r="5" fill="currentColor" fill-opacity="0.25"/><circle cx="110" cy="58" r="5" fill="currentColor" fill-opacity="0.25"/>${arcs}${knot}</svg>`;
}

function BranchMark({ joined }: { joined: boolean }) {
  const theme = useTheme();
  return (
    <svg
      source={branchMarkSvg(joined)}
      style={{ width: 128, height: 80, color: alpha(theme.mutedForeground, 0.6), flexShrink: 0 }}
    />
  );
}

function truncateQuery(query: string): string {
  return query.length > 48 ? `${query.slice(0, 48)}…` : query;
}

export function PullRequestListEmptyState({
  query,
  filtered,
  searching,
  hasProjects,
  canLoadMore,
  loadingMore,
  refreshing,
  onClearQuery,
  onLoadMore,
  onRefresh,
  onAddProject,
}: {
  query: string;
  filtered: boolean;
  searching: boolean;
  hasProjects: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  onClearQuery: () => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  onAddProject: () => void;
}) {
  if (!hasProjects) {
    return (
      <Empty testId="pr-empty">
        <BranchMark joined={false} />
        <EmptyHeader
          title="No projects in this workspace"
          description="Add a project, and the pull requests from its repository appear here."
        />
        <SmallButton primary icon="plus" onClick={onAddProject}>
          Add project
        </SmallButton>
      </Empty>
    );
  }

  if (searching) {
    return (
      <PullRequestListGhost rows={5} caption={`Searching every host for “${truncateQuery(query)}”`} />
    );
  }

  if (query.length > 0) {
    return (
      <Empty testId="pr-empty">
        <BranchMark joined={false} />
        <EmptyHeader
          title={`Nothing matches “${truncateQuery(query)}”`}
          description="The hosts were searched for it. Try fewer words, or search by number, author or branch."
        />
        <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          <SmallButton icon="search" onClick={onClearQuery} testId="pr-clear-search">
            Clear search
          </SmallButton>
          <SmallButton icon="refresh-cw" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "Checking..." : "Check again"}
          </SmallButton>
        </div>
      </Empty>
    );
  }

  return (
    <Empty testId="pr-empty">
      <BranchMark joined={false} />
      <EmptyHeader
        title={filtered ? "Nothing under these filters" : "No pull requests"}
        description={
          filtered
            ? "Widen the state, involvement or project filter to see more."
            : "Pull requests from every project in this workspace appear here."
        }
      />
      <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
        {canLoadMore ? (
          <SmallButton disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading..." : "Load more pull requests"}
          </SmallButton>
        ) : null}
        <SmallButton icon="refresh-cw" disabled={refreshing} onClick={onRefresh} testId="pr-check-again">
          {refreshing ? "Checking..." : "Check again"}
        </SmallButton>
      </div>
    </Empty>
  );
}

/** EmptyMedia variant="icon": a 36px card with two tilted cards behind it. */
function EmptyIconMedia({ icon }: { icon: IconName }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.card,
        marginBottom: 0,
      }}
    >
      <Icon name={icon} size={18} color={theme.foreground} />
    </div>
  );
}

export function PullRequestsUnavailableState({
  title = "Could not load pull requests",
  error,
  onRetry,
  refreshing = false,
}: {
  title?: string;
  error: string;
  onRetry?: () => void;
  refreshing?: boolean;
}) {
  return (
    <Empty testId="pr-unavailable">
      <EmptyIconMedia icon={PullRequestGlyph.pullRequest} />
      <EmptyHeader title={title} description={error} />
      {onRetry ? (
        <SmallButton icon="refresh-cw" disabled={refreshing} onClick={onRetry}>
          Retry
        </SmallButton>
      ) : null}
    </Empty>
  );
}
