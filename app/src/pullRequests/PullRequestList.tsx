// Ports of apps/web/src/components/pullRequest/{PullRequestRow,PullRequestListRow,
// PullRequestListGroups,PullRequestChecksPopover}.tsx.
//
// Not ported: the drag-to-close sweep across rows. The Shift-held quick actions are in
// PullRequestSpeedActions.tsx.
import type {
  EnvironmentId,
  PullRequestAction,
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestRef,
} from "@t3tools/contracts";
import { memo, useState } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { Popover, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { pullRequestEnvironment, useEnvironmentQuery } from "../state/pullRequests.ts";
import { PullRequestSpeedActions } from "./PullRequestSpeedActions.tsx";
import { PullRequestStackPopover, wasStackClick } from "./PullRequestStack.tsx";
import {
  pullRequestEntryKey,
  scorePullRequestMatch,
  type EnvironmentPullRequestEntry,
  type PullRequestGroup,
} from "../web/components/pullRequest/pullRequestList.logic.ts";
import {
  PullRequestActorAvatar,
  PullRequestDiffStat,
  PullRequestLabelChip,
  PullRequestReviewDecisionGlyph,
  PullRequestRowGlyph,
  SourceControlIcon,
  checkStatusPresentation,
  formatRelativeTimeLabel,
  pullRequestCheckStatusLabel,
  pullRequestChecksStatePresentation,
  summarizePullRequestChecks,
} from "./pullRequestPresentation.tsx";

export type PullRequestRowTarget = Pick<
  EnvironmentPullRequestEntry,
  "environmentId" | "projectId" | "host" | "repository" | "number"
>;

// Container-query breakpoints of the row's meta line (@xs, @xl, @3xl).
const META_XS = 320;
const META_XL = 576;
const META_3XL = 768;

// ── Checks popover ──────────────────────────────────────────────────────

function groupPullRequestChecks(checks: ReadonlyArray<PullRequestCheck>) {
  return {
    attention: checks.filter((check) =>
      ["failure", "cancelled", "action-required"].includes(check.status),
    ),
    running: checks.filter((check) => check.status === "pending"),
    completed: checks.filter((check) => ["success", "skipped", "neutral"].includes(check.status)),
  };
}

export function ChecksBody({ checks }: { checks: ReadonlyArray<PullRequestCheck> }) {
  const theme = useTheme();
  const [showAll, setShowAll] = useState(false);
  const { attention, running, completed } = groupPullRequestChecks(checks);
  const canCollapse = attention.length + running.length > 0 && completed.length > 0;
  const visibleChecks = [...attention, ...running, ...(showAll || !canCollapse ? completed : [])];
  if (checks.length === 0) {
    return (
      <Text size="xs" color={theme.mutedForeground}>
        No checks reported
      </Text>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 256, overflowY: "scroll", scrollbarColor: theme.scrollbar }}>
        {visibleChecks.map((check, index) => {
          const presentation = checkStatusPresentation(check.status, theme);
          return (
            <div
              key={`${index}:${check.name}`}
              style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}
            >
              <Icon name={presentation.icon} size={14} color={presentation.tone} />
              <Text size="xs" truncate style={{ flexGrow: 1 }}>
                {check.name}
              </Text>
              <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
                {pullRequestCheckStatusLabel(check, theme)}
              </Text>
            </div>
          );
        })}
      </div>
      {canCollapse ? (
        <div
          onClick={() => setShowAll(!showAll)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 24,
            borderRadius: RADIUS.md,
            cursor: "pointer",
            hover: { backgroundColor: theme.accent },
          }}
        >
          <Text size="xs" weight={500}>
            {showAll ? "Show less" : "Show all"}
          </Text>
        </div>
      ) : null}
    </div>
  );
}

/** Mounted by the popup, so the detail read starts when somebody opens it. */
function LazyChecksBody({
  environmentId,
  reference,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
}) {
  const theme = useTheme();
  const detail = useEnvironmentQuery(pullRequestEnvironment.detail({ environmentId, input: reference }));
  if (detail.error !== null) {
    return (
      <Text size="xs" color={theme.mutedForeground}>
        {detail.error}
      </Text>
    );
  }
  if (detail.data === null) {
    return (
      <Text size="xs" color={theme.mutedForeground}>
        {detail.isPending ? "Loading checks…" : "No checks reported"}
      </Text>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {summarizePullRequestChecks(detail.data.checks)}
      </Text>
      <ChecksBody checks={detail.data.checks} />
    </div>
  );
}

export function PullRequestChecksPopover({
  checksState,
  environmentId,
  reference,
  checks,
  trigger,
}: {
  checksState: PullRequestChecksState;
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  checks?: ReadonlyArray<PullRequestCheck>;
  trigger?: (toggle: () => void) => React.ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const presentation = pullRequestChecksStatePresentation(checksState, theme);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="bottom"
      style={{ width: 320, padding: 16, gap: 8 }}
      trigger={
        trigger ? (
          trigger(() => setOpen(!open))
        ) : (
          <div
            onClick={() => setOpen(!open)}
            style={{ display: "flex", flexShrink: 0, cursor: "pointer" }}
          >
            <Icon name={presentation.icon} size={14} color={presentation.tone} />
          </div>
        )
      }
    >
      <Text weight={500}>{presentation.label}</Text>
      {open ? (
        checks !== undefined ? (
          <>
            <Text size="xs" color={theme.mutedForeground}>
              {summarizePullRequestChecks(checks)}
            </Text>
            <ChecksBody checks={checks} />
          </>
        ) : (
          <LazyChecksBody environmentId={environmentId} reference={reference} />
        )
      ) : null}
    </Popover>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────

function RowLabels({
  labels,
  metaWidth,
}: {
  labels: EnvironmentPullRequestEntry["labels"];
  metaWidth: number;
}) {
  const theme = useTheme();
  if (labels.length === 0) return null;
  const slots = metaWidth >= META_3XL ? 3 : metaWidth >= META_XL ? 2 : 1;
  const shown = labels.slice(0, slots);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 1 }}>
      {shown.map((label, index) => {
        const remaining = labels.length - index - 1;
        const isLast = index === shown.length - 1;
        return (
          <PullRequestLabelChip key={label.name} label={label}>
            {isLast && remaining > 0 ? (
              <text
                style={{
                  color: theme.foreground,
                  fontSize: 10,
                  lineHeight: 12,
                  fontWeight: 500,
                  fontFamily: FONTS.sans,
                  flexShrink: 0,
                  opacity: 0.85,
                }}
              >
                {`+${remaining}`}
              </text>
            ) : null}
          </PullRequestLabelChip>
        );
      })}
    </div>
  );
}

function PullRequestRowImpl({
  entry,
  selected,
  showProvider,
  environmentLabel,
  matchedElsewhere,
  metaWidth,
  onSelect,
  hostActions,
  onSpeedAction,
}: {
  entry: EnvironmentPullRequestEntry;
  hostActions?: ReadonlySet<PullRequestAction>;
  onSpeedAction?: (action: PullRequestAction) => void;
  selected: boolean;
  showProvider: boolean;
  environmentLabel?: string;
  matchedElsewhere: boolean;
  metaWidth: number;
  onSelect: (entry: PullRequestRowTarget) => void;
}) {
  const theme = useTheme();
  const muted = theme.mutedForeground;
  const metaText = { fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans, color: muted } as const;
  const reference = {
    projectId: entry.projectId,
    host: entry.host,
    repository: entry.repository,
    number: entry.number,
  };
  return (
    <div
      testId={`pr-row-${entry.number}`}
      onClick={(event) => {
        if (!wasStackClick(event)) onSelect(entry);
      }}
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
        cursor: "pointer",
        flexShrink: 0,
        backgroundColor: selected ? theme.accent : "#00000000",
        ...(selected ? {} : { hover: { backgroundColor: alpha(theme.accent, 0.6) } }),
      }}
    >
      <PullRequestRowGlyph
        state={entry.state}
        isDraft={entry.isDraft}
        mergeability={entry.mergeability}
        baseBranch={entry.baseBranch}
      />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, height: 20 }}>
          <text
            style={{
              color: muted,
              fontSize: 12,
              lineHeight: 16,
              fontFamily: FONTS.mono,
              flexShrink: 0,
            }}
          >
            {`#${entry.number}`}
          </text>
          <Text truncate style={{ flexShrink: 1 }}>
            {entry.title}
          </Text>
          {entry.checksState !== undefined || entry.reviewDecision !== undefined ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {entry.checksState === undefined ? null : (
                <PullRequestChecksPopover
                  checksState={entry.checksState}
                  environmentId={entry.environmentId}
                  reference={reference}
                />
              )}
              {entry.reviewDecision === undefined ? null : (
                <PullRequestReviewDecisionGlyph decision={entry.reviewDecision} />
              )}
            </div>
          ) : null}
          <div style={{ flexGrow: 1, minWidth: 0 }} />
          {entry.stack ? (
            <PullRequestStackPopover
              environmentId={entry.environmentId}
              reference={reference}
              membership={entry.stack}
              onSelect={(target) =>
                onSelect({ ...entry, number: target.number, host: entry.host, environmentId: entry.environmentId })
              }
            />
          ) : null}
          <PullRequestDiffStat additions={entry.additions} deletions={entry.deletions} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            height: 16,
            overflow: "hidden",
          }}
        >
          {matchedElsewhere ? (
            <Tooltip content="Matched in the description" side="top">
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  minWidth: 24,
                  paddingLeft: 4,
                  paddingRight: 4,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: alpha(theme.border, 0.6),
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <Icon name="search" size={12} color={muted} />
                {metaWidth >= META_XS ? (
                  <text style={{ ...metaText, fontSize: 10, lineHeight: 14 }}>matched in the description</text>
                ) : null}
              </div>
            </Tooltip>
          ) : null}
          {showProvider ? <SourceControlIcon kind={entry.provider} size={12} color={muted} /> : null}
          <Tooltip
            content={
              entry.author?.name && entry.author.name !== entry.author.login
                ? `${entry.author.name} (@${entry.author.login})`
                : (entry.author?.login ?? "ghost")
            }
            side="top"
          >
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 14, maxWidth: 160, flexShrink: 0 }}>
              <PullRequestActorAvatar actor={entry.author} size={14} />
              {metaWidth >= META_XS ? (
                <text style={{ ...metaText, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
                  {entry.author?.login ?? "ghost"}
                </text>
              ) : null}
            </div>
          </Tooltip>
          <text style={{ ...metaText, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>
            {entry.repository}
          </text>
          {environmentLabel ? (
            <text style={{ ...metaText, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, maxWidth: 128 }}>
              {environmentLabel}
            </text>
          ) : null}
          <RowLabels labels={entry.labels} metaWidth={metaWidth} />
          <div style={{ flexGrow: 1, minWidth: 0 }} />
          <text style={{ ...metaText, whiteSpace: "nowrap", flexShrink: 0 }}>
            {formatRelativeTimeLabel(entry.updatedAt)}
          </text>
        </div>
      </div>
      {hostActions && hostActions.size > 0 ? (
        <PullRequestSpeedActions entry={entry} hostActions={hostActions} {...(onSpeedAction ? { onActed: onSpeedAction } : {})} />
      ) : null}
    </div>
  );
}

export const PullRequestRow = memo(PullRequestRowImpl);

// ── Groups ──────────────────────────────────────────────────────────────

const GROUP_ICONS: Record<string, IconName> = {
  authored: "pen-line",
  reviewRequested: "eye",
  others: "users",
};

const MATCHED_ELSEWHERE_SCORE = 10;

function PullRequestGroupHeader({ group }: { group: { key: string; label: string; entries: ReadonlyArray<unknown> } }) {
  const theme = useTheme();
  const color = alpha(theme.mutedForeground, 0.7);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 12,
        paddingRight: 12,
        paddingBottom: 4,
        flexShrink: 0,
      }}
    >
      <Icon name={GROUP_ICONS[group.key] ?? "layers"} size={14} color={color} />
      <Text size="xs" weight={500} color={color}>
        {group.label}
      </Text>
      <Text size="xs" weight={500} color={alpha(theme.mutedForeground, 0.5)}>
        {String(group.entries.length)}
      </Text>
      <div style={{ flexGrow: 1, minWidth: 8, height: 1, backgroundColor: theme.border }} />
    </div>
  );
}

export interface PullRequestSelection {
  readonly environmentId: string | undefined;
  readonly repository: string;
  readonly host: string | undefined;
  readonly number: number;
}

export function PullRequestListGroups({
  groups,
  environmentLabels,
  query,
  selected,
  showProvider,
  metaWidth,
  onSelect,
  hostActionsOf,
  onSpeedAction,
}: {
  groups: ReadonlyArray<PullRequestGroup<EnvironmentPullRequestEntry>>;
  /** Only when rows come from more than one server, so each says which. */
  environmentLabels: ReadonlyMap<EnvironmentId, string> | null;
  query: string;
  selected: PullRequestSelection | null;
  showProvider: boolean;
  metaWidth: number;
  onSelect: (entry: PullRequestRowTarget) => void;
  hostActionsOf?: (entry: EnvironmentPullRequestEntry) => ReadonlySet<PullRequestAction>;
  onSpeedAction?: (action: PullRequestAction) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {groups.map((group) => (
        <div key={group.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {group.label ? <PullRequestGroupHeader group={group} /> : null}
          {group.entries.map((entry) => {
            const entryKey = pullRequestEntryKey(entry);
            const environmentLabel = environmentLabels?.get(entry.environmentId);
            return (
              <PullRequestRow
                key={entryKey}
                entry={entry}
                showProvider={showProvider}
                {...(environmentLabel !== undefined ? { environmentLabel } : {})}
                matchedElsewhere={
                  query.length > 0 && scorePullRequestMatch(entry, query) <= MATCHED_ELSEWHERE_SCORE
                }
                selected={
                  selected?.environmentId === entry.environmentId &&
                  selected.repository === entry.repository &&
                  selected.host?.toLowerCase() === entry.host.toLowerCase() &&
                  selected.number === entry.number
                }
                metaWidth={metaWidth}
                onSelect={onSelect}
                {...(hostActionsOf ? { hostActions: hostActionsOf(entry) } : {})}
                {...(onSpeedAction ? { onSpeedAction } : {})}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Rows and group headers have fixed heights, which lets the page find the rows on screen. */
export const PULL_REQUEST_ROW_HEIGHT = 56;
export const PULL_REQUEST_ROW_GAP = 2;
export const PULL_REQUEST_GROUP_HEADER_HEIGHT = 20;
export const PULL_REQUEST_GROUP_GAP = 12;
