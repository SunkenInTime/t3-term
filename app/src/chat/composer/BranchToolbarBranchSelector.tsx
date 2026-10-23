// Port of apps/web/src/components/BranchToolbarBranchSelector.tsx + BranchPicker.tsx for a
// new-thread draft: the GitBranch trigger and the searchable ref list above it. Server
// threads, pull-request badges and the PR checkout item are not part of the draft strip.
import type { KeyEvent, PublicInstance } from "@gpuix/react";
import { runAtomCommand, isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, VcsRef } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { setDraftWorkspace } from "../../state/composer.ts";
import { composerVcsEnvironment, usePaginatedBranches } from "../../state/composerQueries.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Popover, Switch } from "../../ui/overlay.tsx";
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import {
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
  resolveBranchToolbarValue,
  resolveBranchTriggerLabel,
  resolveDraftEnvModeAfterBranchChange,
  sanitizeNewRefName,
  shouldIncludeBranchPickerItem,
  type EnvMode,
} from "../../web/components/BranchToolbar.logic.ts";
import {
  BranchToolbarControl,
  BranchToolbarMenuRow,
  BranchToolbarMenuText,
} from "./BranchToolbarControl.tsx";

export interface BranchToolbarBranchSelectorProps {
  readonly environmentId: EnvironmentId;
  readonly draftKey: string;
  readonly projectCwd: string;
  readonly draftBranch: string | null;
  readonly worktreePath: string | null;
  readonly effectiveEnvMode: EnvMode;
  readonly currentGitBranch: string | null;
  readonly startFromOrigin: boolean;
  readonly onStartFromOriginChange: (startFromOrigin: boolean) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onComposerFocusRequest: () => void;
  readonly onRefsChanged: () => void;
}

/** w-80 combobox popup; the list is max-h-56. */
const POPUP_WIDTH = 320;
const LIST_MAX_HEIGHT = 224;
const NEXT_PAGE_DISTANCE_PX = 96;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

export function BranchToolbarBranchSelector(props: BranchToolbarBranchSelectorProps) {
  const theme = useTheme();
  const {
    environmentId,
    draftKey,
    projectCwd,
    draftBranch,
    worktreePath: activeWorktreePath,
    effectiveEnvMode,
    currentGitBranch,
  } = props;
  const branchCwd = activeWorktreePath ?? projectCwd;
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // The search input autofocuses when the popup opens; GPUI does not report that as a focus event.
  const [searchFocused, setSearchFocused] = useState(true);
  const [pending, setPending] = useState(false);
  const [optimisticBranch, setOptimisticBranch] = useState<string | null | undefined>(undefined);
  const rowRefs = useRef(new Map<string, PublicInstance>());

  const branchRefState = usePaginatedBranches({
    environmentId,
    cwd: branchCwd,
    // The server filters refs by substring, so it gets the sanitized name too (ref names
    // have no spaces), keeping an existing new-branch in the response for the collision check.
    query: sanitizeNewRefName(query.trim()),
  });
  const refs = branchRefState.refs;
  const branchByName = new Map(refs.map((ref) => [ref.name, ref] as const));
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const isSelectingWorktreeBase = effectiveEnvMode === "worktree" && !activeWorktreePath;
  const canCreateBranch = !isSelectingWorktreeBase && trimmedQuery.length > 0;
  const newRefName = sanitizeNewRefName(trimmedQuery);
  const createBranchItemValue =
    canCreateBranch && !branchByName.has(newRefName) ? `__create_new_branch__:${trimmedQuery}` : null;
  const pickerItems = [...refs.map((ref) => ref.name), ...(createBranchItemValue ? [createBranchItemValue] : [])];
  const filteredItems =
    normalizedQuery.length === 0
      ? pickerItems
      : pickerItems.filter((itemValue) =>
          shouldIncludeBranchPickerItem({
            itemValue,
            normalizedQuery,
            createBranchItemValue,
            checkoutPullRequestItemValue: null,
          }),
        );
  const isInitialLoadPending = branchRefState.isPending && branchRefState.data === null;
  const hasNextPage = branchRefState.data?.nextCursor !== null && branchRefState.data?.nextCursor !== undefined;
  const statusText = isInitialLoadPending
    ? "Loading refs..."
    : branchRefState.isFetchingNextPage
      ? "Loading more refs..."
      : hasNextPage
        ? `Showing ${refs.length} of ${branchRefState.data?.totalCount ?? 0} refs`
        : null;

  const canonicalActiveBranch = resolveBranchToolbarValue({
    envMode: effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch: draftBranch,
    currentGitBranch,
  });
  const resolvedActiveBranch = optimisticBranch !== undefined ? optimisticBranch : canonicalActiveBranch;
  const listedActiveBranch = resolvedActiveBranch === null ? null : (branchByName.get(resolvedActiveBranch) ?? null);
  const triggerLabel = resolveBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
    resolvedActiveBranchIsRemote: listedActiveBranch === null ? null : listedActiveBranch.isRemote === true,
    startFromOrigin: props.startFromOrigin,
  });

  // Reset the highlight to the top whenever the result set changes.
  const resultsKey = `${trimmedQuery}\u0000${filteredItems.length}`;
  const [highlightResetKey, setHighlightResetKey] = useState(resultsKey);
  if (highlightResetKey !== resultsKey) {
    setHighlightResetKey(resultsKey);
    setHighlightedIndex(0);
  }

  const setDraftBranch = (branch: string | null, worktreePath: string | null) => {
    setDraftWorkspace(draftKey, {
      branch,
      worktreePath,
      envMode: resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      }),
    });
  };

  // A new worktree starts from the default branch until the user picks another base.
  const defaultBranchName = refs.find((ref) => ref.isDefault)?.name ?? null;
  const worktreeBaseCandidate = isInitialLoadPending ? null : (defaultBranchName ?? currentGitBranch);
  useEffect(() => {
    if (effectiveEnvMode !== "worktree" || activeWorktreePath || draftBranch || !worktreeBaseCandidate) return;
    setDraftWorkspace(draftKey, { branch: worktreeBaseCandidate, worktreePath: null });
  }, [activeWorktreePath, draftBranch, draftKey, effectiveEnvMode, worktreeBaseCandidate]);

  const close = () => {
    props.onOpenChange(false);
    setQuery("");
    setSearchFocused(true);
  };

  const runBranchAction = (action: () => Promise<void>) => {
    setPending(true);
    void action().finally(() => {
      setPending(false);
      setOptimisticBranch(undefined);
      branchRefState.refresh();
      props.onRefsChanged();
    });
  };

  const selectBranch = (ref: VcsRef) => {
    if (pending) return;
    if (isSelectingWorktreeBase) {
      setDraftBranch(ref.name, null);
      close();
      props.onComposerFocusRequest();
      return;
    }
    const selectionTarget = resolveBranchSelectionTarget({
      activeProjectCwd: projectCwd,
      activeWorktreePath,
      refName: ref,
    });
    if (selectionTarget.reuseExistingWorktree) {
      setDraftBranch(ref.name, selectionTarget.nextWorktreePath);
      close();
      props.onComposerFocusRequest();
      return;
    }
    const selectedBranchName = ref.isRemote ? deriveLocalBranchNameFromRemoteRef(ref.name) : ref.name;
    close();
    props.onComposerFocusRequest();
    runBranchAction(async () => {
      setOptimisticBranch(selectedBranchName);
      const result = await runAtomCommand(appAtomRegistry, composerVcsEnvironment.switchRef, {
        environmentId,
        input: { cwd: selectionTarget.checkoutCwd, refName: ref.name },
      });
      if (result._tag === "Success") {
        const nextBranchName = ref.isRemote ? (result.value.refName ?? selectedBranchName) : selectedBranchName;
        setDraftBranch(nextBranchName, selectionTarget.nextWorktreePath);
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        toast({ type: "error", title: "Failed to switch ref.", description: errorMessage(squashAtomCommandFailure(result)) });
      }
    });
  };

  const createRef = (rawName: string) => {
    const name = sanitizeNewRefName(rawName);
    if (!name || pending) return;
    close();
    props.onComposerFocusRequest();
    runBranchAction(async () => {
      setOptimisticBranch(name);
      const result = await runAtomCommand(appAtomRegistry, composerVcsEnvironment.createRef, {
        environmentId,
        input: { cwd: branchCwd, refName: name, switchRef: true },
      });
      if (result._tag === "Success") {
        setDraftBranch(result.value.refName, activeWorktreePath);
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        toast({
          type: "error",
          title: "Failed to create and switch ref.",
          description: errorMessage(squashAtomCommandFailure(result)),
        });
      }
    });
  };

  const selectItem = (itemValue: string | undefined) => {
    if (itemValue === undefined) return;
    if (itemValue === createBranchItemValue) {
      createRef(trimmedQuery);
      return;
    }
    const ref = branchByName.get(itemValue);
    if (ref) selectBranch(ref);
  };

  const moveHighlight = (direction: 1 | -1) => {
    if (filteredItems.length === 0) return;
    const next = Math.min(filteredItems.length - 1, Math.max(0, highlightedIndex + direction));
    setHighlightedIndex(next);
    rowRefs.current.get(filteredItems[next]!)?.scrollIntoView?.();
  };

  const onSearchKeyDown = (event: KeyEvent) => {
    if (event.key === "up" || event.key === "down") {
      event.preventDefault();
      event.stopPropagation();
      moveHighlight(event.key === "down" ? 1 : -1);
    }
  };

  const disabled = isInitialLoadPending || pending;
  const muted = alpha(theme.mutedForeground, 0.7);

  return (
    <Popover
      open={props.open && !disabled}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
      side="top"
      align="end"
      testId="branch-picker"
      rootStyle={{ flexShrink: 0, maxWidth: "52%" }}
      style={{ width: POPUP_WIDTH }}
      trigger={
        <BranchToolbarControl
          testId="branch-toolbar-branch"
          icons={[{ name: "git-branch", opacity: 0.7 }]}
          label={triggerLabel}
          pressed={props.open}
          disabled={disabled}
          onClick={() => (props.open ? close() : props.onOpenChange(true))}
        />
      }
    >
      <div style={{ flexShrink: 0, paddingTop: 10, paddingLeft: 12, paddingRight: 12 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingBottom: 6,
            borderBottomWidth: 1,
            borderColor: searchFocused ? theme.primary : alpha(theme.border, 0.7),
          }}
        >
          <Icon name="search" size={16} color={alpha(theme.mutedForeground, 0.55)} />
          <input
            testId="branch-picker-search"
            autoFocus
            value={query}
            placeholder="Search refs..."
            theme={{ caret: theme.foreground }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onChange={(event) => setQuery(event.value ?? "")}
            onSubmit={() => selectItem(filteredItems[highlightedIndex])}
            onKeyDown={onSearchKeyDown}
            style={{
              flexGrow: 1,
              minWidth: 0,
              height: 26,
              fontSize: 14,
              lineHeight: 26,
              color: theme.foreground,
              fontFamily: FONTS.sans,
            }}
          />
        </div>
      </div>
      {filteredItems.length === 0 && !isInitialLoadPending ? (
        <div style={{ paddingTop: 24, paddingBottom: 24, display: "flex", justifyContent: "center" }}>
          <BranchToolbarMenuText color={theme.mutedForeground}>No refs found.</BranchToolbarMenuText>
        </div>
      ) : (
        <div
          onScrollChange={(event) => {
            const { scrollTop, scrollHeight, clientHeight } = event as unknown as {
              scrollTop?: number;
              scrollHeight?: number;
              clientHeight?: number;
            };
            if (
              hasNextPage &&
              !branchRefState.isFetchingNextPage &&
              scrollTop !== undefined &&
              scrollHeight !== undefined &&
              clientHeight !== undefined &&
              scrollHeight - scrollTop - clientHeight <= NEXT_PAGE_DISTANCE_PX
            ) {
              branchRefState.loadNext();
            }
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: LIST_MAX_HEIGHT,
            overflowY: "scroll",
            paddingTop: 12,
            paddingBottom: 12,
            // ps-1 inside the list's p-1, plus the stable scrollbar gutter on the right.
            paddingLeft: 8,
            paddingRight: 10,
            scrollbarWidth: 6,
            scrollbarColor: "#00000000",
            hover: { scrollbarColor: theme.scrollbar },
          }}
        >
          {filteredItems.map((itemValue, index) => {
            const isCreate = itemValue === createBranchItemValue;
            const ref = branchByName.get(itemValue);
            const hasSecondaryWorktree = ref?.worktreePath && ref.worktreePath !== projectCwd;
            const badge = !ref
              ? null
              : ref.current
                ? "current"
                : hasSecondaryWorktree
                  ? "worktree"
                  : ref.isRemote
                    ? "remote"
                    : ref.isDefault
                      ? "default"
                      : null;
            return (
              <div
                key={itemValue}
                ref={(instance: PublicInstance | null) => {
                  if (instance) rowRefs.current.set(itemValue, instance);
                  else rowRefs.current.delete(itemValue);
                }}
                style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}
              >
                <BranchToolbarMenuRow
                  testId={`branch-picker-item-${index}`}
                  highlighted={index === highlightedIndex}
                  highlightAlpha={0.04}
                  onHover={() => setHighlightedIndex(index)}
                  onSelect={() => selectItem(itemValue)}
                >
                  {isCreate ? (
                    <BranchToolbarMenuText grow>{`Create new ref "${newRefName}"`}</BranchToolbarMenuText>
                  ) : (
                    <>
                      <BranchToolbarMenuText grow>{itemValue}</BranchToolbarMenuText>
                      {badge ? (
                        <BranchToolbarMenuText size={10} color={alpha(theme.mutedForeground, 0.45)}>
                          {badge}
                        </BranchToolbarMenuText>
                      ) : null}
                    </>
                  )}
                </BranchToolbarMenuRow>
              </div>
            );
          })}
        </div>
      )}
      {isSelectingWorktreeBase ? (
        <div
          testId="branch-picker-start-from-origin"
          onClick={() => props.onStartFromOriginChange(!props.startFromOrigin)}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 12,
            paddingRight: 12,
            borderTopWidth: 1,
            borderColor: alpha(theme.border, 0.6),
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, pointerEvents: "none" }}>
            <Icon name="refresh-cw" size={12} color={theme.mutedForeground} />
            <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>
              Start from remote
            </text>
          </div>
          <Switch checked={props.startFromOrigin} onChange={props.onStartFromOriginChange} />
        </div>
      ) : null}
      {statusText ? (
        <div style={{ paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
          <text style={{ color: muted, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>{statusText}</text>
        </div>
      ) : null}
    </Popover>
  );
}
