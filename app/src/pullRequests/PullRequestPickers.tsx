// Port of apps/web/src/components/pullRequest/{PullRequestCandidatePicker,PullRequestLabelPicker,
// PullRequestReviewerPicker}.tsx: the tag and user-plus buttons beside Labels and Reviewers. Each
// opens a search box over the repository's candidates; choosing one toggles it on the host.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestLabelCandidate,
  PullRequestRef,
  PullRequestReviewerCandidate,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { pullRequestEnvironment, useEnvironmentQuery } from "../state/pullRequests.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Popover, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast } from "../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { readableFailure } from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { pullRequestLabelColor } from "../web/components/pullRequest/pullRequestList.logic.ts";
import { GhostBar } from "./PullRequestListStates.tsx";
import { PullRequestActorAvatar } from "./pullRequestPresentation.tsx";
import { runPullRequestWrite } from "./pullRequestWrites.ts";

/**
 * A combobox (search box over a list) rather than a menu, as web's: a menu's typeahead would
 * claim every keypress the search box needs.
 */
function PullRequestCandidatePicker<T>({
  icon,
  label,
  allowed,
  disabledReason,
  open,
  onOpenChange,
  query,
  onQueryChange,
  searchLabel,
  isPending,
  error,
  candidates,
  emptyLabel,
  noMatchLabel,
  errorLabel,
  truncated,
  truncatedLabel,
  candidateKey,
  disabled,
  onSelect,
  children,
  testId,
}: {
  icon: IconName;
  label: string;
  allowed: boolean;
  disabledReason: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchLabel: string;
  isPending: boolean;
  error: string | null;
  candidates: ReadonlyArray<T>;
  emptyLabel: string;
  noMatchLabel: string;
  errorLabel: string;
  truncated: boolean;
  truncatedLabel: string;
  candidateKey: (candidate: T) => string;
  disabled: boolean;
  onSelect: (candidate: T) => void;
  children: (candidate: T) => ReactNode;
  testId: string;
}) {
  const theme = useTheme();
  const [highlighted, setHighlighted] = useState(0);
  const trigger = (onClick?: () => void) => (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: RADIUS.md,
        cursor: onClick ? "pointer" : "default",
        opacity: allowed ? 1 : 0.64,
        ...(onClick ? { hover: { backgroundColor: theme.accent } } : {}),
      }}
    >
      <Icon name={icon} size={14} color={theme.mutedForeground} />
    </div>
  );
  if (!allowed) {
    return (
      <Tooltip content={disabledReason}>
        <div style={{ display: "flex" }}>{trigger()}</div>
      </Tooltip>
    );
  }
  const active = Math.min(highlighted, Math.max(0, candidates.length - 1));
  const muted = (text: string) => (
    <div style={{ padding: 8 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {text}
      </Text>
    </div>
  );
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      align="start"
      testId={`${testId}-popup`}
      style={{ width: 288, padding: 0 }}
      trigger={<Tooltip content={label}>{trigger(() => onOpenChange(!open))}</Tooltip>}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 36,
          paddingLeft: 10,
          paddingRight: 10,
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Icon name="search" size={14} color={alpha(theme.mutedForeground, 0.8)} />
        <input
          testId={`${testId}-search`}
          autoFocus
          value={query}
          placeholder={searchLabel}
          onChange={(event) => {
            onQueryChange(String(event.value ?? ""));
            setHighlighted(0);
          }}
          onSubmit={() => {
            const candidate = candidates[active];
            if (candidate !== undefined && !disabled) onSelect(candidate);
          }}
          onKeyDown={(event) => {
            if (event.key === "down") setHighlighted(Math.min(active + 1, candidates.length - 1));
            else if (event.key === "up") setHighlighted(Math.max(active - 1, 0));
          }}
          theme={{ caret: theme.foreground }}
          style={{ flexGrow: 1, minWidth: 0, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans, color: theme.foreground }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 288, overflowY: "scroll", padding: 4 }}>
        {isPending ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 8 }}>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <GhostBar width={16} height={16} radius={8} />
                <GhostBar width={row % 2 === 0 ? "60%" : "45%"} />
              </div>
            ))}
          </div>
        ) : error !== null ? (
          muted(`${errorLabel} ${error}`)
        ) : candidates.length === 0 ? (
          muted(query.length > 0 ? noMatchLabel : emptyLabel)
        ) : (
          candidates.map((candidate, index) => (
            <div
              key={candidateKey(candidate)}
              testId={`${testId}-item-${index}`}
              onMouseEnter={() => setHighlighted(index)}
              onClick={disabled ? undefined : () => onSelect(candidate)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                minHeight: 28,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: RADIUS.sm,
                flexShrink: 0,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.64 : 1,
                backgroundColor: index === active ? theme.accent : "#00000000",
              }}
            >
              {children(candidate)}
            </div>
          ))
        )}
        {truncated ? (
          <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}>
            <Text size="xs" color={theme.mutedForeground}>
              {truncatedLabel}
            </Text>
          </div>
        ) : null}
      </div>
    </Popover>
  );
}

function matchesLabel(candidate: PullRequestLabelCandidate, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return candidate.name.toLowerCase().includes(needle) || (candidate.description ?? "").toLowerCase().includes(needle);
}

export function PullRequestLabelPicker({
  environmentId,
  reference,
  allowed,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  allowed: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.labelCandidates({ environmentId, input: reference }) : null,
  );
  const candidates = (candidatesQuery.data?.candidates ?? []).filter((entry) => matchesLabel(entry, query));
  const toggle = async (candidate: PullRequestLabelCandidate) => {
    if (pending !== null) return;
    setPending(candidate.name);
    const result = await runPullRequestWrite(pullRequestEnvironment.setLabels, {
      environmentId,
      input: { ...reference, labels: [candidate.name], applied: !candidate.isApplied },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toast({
        type: "error",
        title: candidate.isApplied ? `Could not take ${candidate.name} off` : `Could not put ${candidate.name} on`,
        description: readableFailure(
          squashAtomCommandFailure(result),
          "The host refused it. Check that you have triage access on this repository.",
        ),
      });
    }
  };
  return (
    <PullRequestCandidatePicker
      icon="tag"
      label="Change labels"
      allowed={allowed}
      disabledReason="Changing labels needs triage access on this repository"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      searchLabel="Search labels"
      isPending={candidatesQuery.isPending && candidatesQuery.data === null}
      error={candidatesQuery.data === null ? candidatesQuery.error : null}
      candidates={candidates}
      emptyLabel="This repository has no labels."
      noMatchLabel="No label matches that."
      errorLabel="The labels could not be read."
      truncated={candidatesQuery.data?.truncated === true}
      truncatedLabel="This repository has more labels than are listed here. Apply the rest on the host."
      candidateKey={(candidate) => candidate.name}
      disabled={pending !== null}
      onSelect={(candidate) => void toggle(candidate)}
      testId="pr-label-picker"
    >
      {(candidate) => {
        const dot = pullRequestLabelColor(candidate.color);
        return (
          <>
            <div style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, backgroundColor: dot ?? theme.mutedForeground }} />
            <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minWidth: 0 }}>
              <text style={{ color: theme.foreground, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans, whiteSpace: "nowrap", flexShrink: 0 }}>
                {candidate.name}
              </text>
              {candidate.description ? (
                <text
                  style={{
                    color: theme.mutedForeground,
                    fontSize: 14,
                    lineHeight: 20,
                    fontFamily: FONTS.sans,
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    minWidth: 0,
                  }}
                >
                  {` · ${candidate.description}`}
                </text>
              ) : null}
            </div>
            {candidate.isApplied ? <Icon name="check" size={14} color={theme.foreground} /> : null}
          </>
        );
      }}
    </PullRequestCandidatePicker>
  );
}

function matchesReviewer(candidate: PullRequestReviewerCandidate, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return candidate.login.toLowerCase().includes(needle) || (candidate.name ?? "").toLowerCase().includes(needle);
}

export function PullRequestReviewerPicker({
  environmentId,
  reference,
  allowed,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  allowed: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.reviewerCandidates({ environmentId, input: reference }) : null,
  );
  const candidates = (candidatesQuery.data?.candidates ?? []).filter((entry) => matchesReviewer(entry, query));
  const toggle = async (candidate: PullRequestReviewerCandidate) => {
    if (pending !== null) return;
    setPending(candidate.id);
    const result = await runPullRequestWrite(pullRequestEnvironment.requestReviewers, {
      environmentId,
      input: {
        ...reference,
        reviewers: [{ id: candidate.id, kind: candidate.kind }],
        requested: !candidate.isRequested,
      },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toast({
        type: "error",
        title: candidate.isRequested
          ? `Could not take back the review request to ${candidate.login}`
          : `Could not ask ${candidate.login} for a review`,
        description: readableFailure(
          squashAtomCommandFailure(result),
          "The host refused it. Check that you have write access on this repository, and that they still have access to it.",
        ),
      });
      return;
    }
    toast({
      type: "success",
      title: candidate.isRequested
        ? `Review request to ${candidate.login} taken back`
        : `Review requested from ${candidate.login}`,
    });
  };
  return (
    <PullRequestCandidatePicker
      icon="user-plus"
      label="Request a review"
      allowed={allowed}
      disabledReason="Asking someone to review needs write access on this repository"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      searchLabel="Search people with access"
      isPending={candidatesQuery.isPending && candidatesQuery.data === null}
      error={candidatesQuery.data === null ? candidatesQuery.error : null}
      candidates={candidates}
      emptyLabel="Nobody else has access to this repository."
      noMatchLabel="Nobody with access matches that."
      errorLabel="The people with access could not be read."
      truncated={candidatesQuery.data?.truncated === true}
      truncatedLabel="This repository has more people with access than are listed here. Ask for the rest on the host."
      candidateKey={(candidate) => `${candidate.kind}:${candidate.id}`}
      disabled={pending !== null}
      onSelect={(candidate) => void toggle(candidate)}
      testId="pr-reviewer-picker"
    >
      {(candidate) => (
        <>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }}>
            <PullRequestActorAvatar actor={candidate} />
            <Text truncate>{candidate.login}</Text>
          </div>
          {candidate.kind === "team" ? (
            <Text size="xs" color={theme.mutedForeground}>
              team
            </Text>
          ) : null}
          {candidate.isRequested ? <Icon name="check" size={14} color={theme.foreground} /> : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}
