// The branch row of the details card: port of BranchToolbarBranchSelector.tsx in
// its panel display mode plus BranchPicker.tsx. Switches refs (checking out a
// remote ref creates its local branch), reuses an existing worktree for a branch
// checked out elsewhere, and creates a new branch from the search text.
import { useAtomValue } from "@effect/atom-react";
import type { EventPayload } from "@gpuix/native";
import { DismissableLayer } from "@gpuix/react";
import { FloatingLayer } from "@gpuix/react/floating";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type VcsRef,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerDraftAtom, setDraftWorkspace } from "../../state/composer.ts";
import { threadEnvironment } from "../../state/environment.ts";
import { pendingEnvModeAtom, vcsEnvironment } from "../../state/git.ts";
import { surfaceStyle } from "../../ui/overlay.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
  resolveBranchToolbarValue,
  resolveBranchTriggerLabel,
  sanitizeNewRefName,
  shouldIncludeBranchPickerItem,
  resolveDraftEnvModeAfterBranchChange,
} from "../../web/components/BranchToolbar.logic.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../../web/state/session.ts";
import { copyTextToClipboard } from "../header/osActions.ts";
import { ActionMenu } from "../header/ActionMenu.tsx";
import { DetailsIcon, DetailsLabel, DetailsSelectRow } from "./detailsControls.tsx";

const PICKER_WIDTH = 262;
// BranchPicker.tsx max-h-56
const LIST_MAX_HEIGHT = 224;
const CREATE_PREFIX = "__create_new_branch__:";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

export function BranchRow({
  environmentId,
  thread,
  draftKey = "",
  projectCwd,
}: {
  environmentId: EnvironmentId;
  /** Null for a new-thread draft: the branch is stored on the composer draft (`draftKey`). */
  thread: EnvironmentThreadShell | null;
  draftKey?: string;
  projectCwd: string;
}) {
  const theme = useTheme();
  const canWrite = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const threadKey = thread ? `${environmentId}:${thread.id}` : "";
  const pendingEnvMode = useAtomValue(pendingEnvModeAtom(threadKey));
  const draft = useAtomValue(composerDraftAtom(draftKey));
  const activeWorktreePath = thread ? thread.worktreePath : (draft.worktreePath ?? null);
  const effectiveEnvMode = thread
    ? activeWorktreePath
      ? "worktree"
      : (pendingEnvMode ?? "local")
    : activeWorktreePath
      ? "local"
      : (draft.envMode ?? "local");
  const branchCwd = activeWorktreePath ?? projectCwd;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(true);
  const [listScroll, setListScroll] = useState(0);
  const [pending, setPending] = useState(false);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);

  const status = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd: branchCwd } }));
  const trimmed = query.trim();
  const refsQuery = useEnvironmentQuery(
    vcsEnvironment.listRefs({
      environmentId,
      input: {
        cwd: branchCwd,
        // The server filters by substring, so it gets the sanitized name: ref names
        // cannot contain a space, and the raw text would hide an exact match.
        ...(trimmed.length > 0 ? { query: sanitizeNewRefName(trimmed) } : {}),
        limit: 100,
      },
    }),
  );
  const refs = refsQuery.data?.refs ?? [];
  const byName = new Map(refs.map((ref) => [ref.name, ref] as const));
  const currentGitBranch = status.data?.refName ?? refs.find((ref) => ref.current)?.name ?? null;
  const canonical = resolveBranchToolbarValue({
    envMode: effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch: thread ? thread.branch : (draft.branch ?? null),
    currentGitBranch,
  });
  const resolvedActiveBranch = pending && optimistic !== null ? optimistic : canonical;
  const activeRef = resolvedActiveBranch ? byName.get(resolvedActiveBranch) : undefined;
  const label = resolveBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
    resolvedActiveBranchIsRemote: activeRef ? activeRef.isRemote === true : null,
    startFromOrigin: false,
  });
  const isSelectingWorktreeBase = effectiveEnvMode === "worktree" && !activeWorktreePath;
  const canChangeBranch = canWrite && canOperate;
  const newRefName = sanitizeNewRefName(trimmed);
  const createValue =
    canChangeBranch && !isSelectingWorktreeBase && trimmed.length > 0 && !byName.has(newRefName)
      ? `${CREATE_PREFIX}${trimmed}`
      : null;
  const normalized = trimmed.toLowerCase();
  const items = [...refs.map((ref) => ref.name), ...(createValue ? [createValue] : [])].filter(
    (value) =>
      normalized.length === 0 ||
      shouldIncludeBranchPickerItem({
        itemValue: value,
        normalizedQuery: normalized,
        createBranchItemValue: createValue,
        checkoutPullRequestItemValue: null,
      }),
  );
  // Rows are 28 tall inside 12px of list padding (ComboboxListVirtualized py-1 + list py-2).
  const listContentHeight = items.length * 28 + 24;
  const listScrolls = listContentHeight > LIST_MAX_HEIGHT;
  const fadeColor = String(surfaceStyle(theme).backgroundColor);
  const total = refsQuery.data?.totalCount ?? 0;
  const statusText =
    refsQuery.isPending && refsQuery.data === null
      ? "Loading refs..."
      : refsQuery.data?.nextCursor != null
        ? `Showing ${refs.length} of ${total} refs`
        : null;

  const setThreadBranch = (branch: string | null, worktreePath: string | null) => {
    if (!thread) {
      // composer BranchToolbarBranchSelector setDraftBranch
      setDraftWorkspace(draftKey, {
        branch,
        worktreePath,
        envMode: resolveDraftEnvModeAfterBranchChange({
          nextWorktreePath: worktreePath,
          currentWorktreePath: activeWorktreePath,
          effectiveEnvMode,
        }),
      });
      return;
    }
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    if (thread.runtime && worktreePath !== activeWorktreePath) {
      void runAtomCommand(appAtomRegistry, threadEnvironment.stopSession, { environmentId, input: { threadId: thread.id } } as never);
    }
    void runAtomCommand(appAtomRegistry, threadEnvironment.updateMetadata, {
      environmentId,
      input: { threadId: thread.id, branch, worktreePath },
    } as never);
  };

  const runBranchAction = (action: () => Promise<void>) => {
    if (!readEnvironmentScope(environmentId, AuthSourceControlWriteScope) || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      toast({ type: "error", title: "Action unavailable", description: "This connection cannot change the thread's branch." });
      return;
    }
    setPending(true);
    void action().finally(() => {
      setPending(false);
      setOptimistic(null);
      refsQuery.refresh();
      status.refresh();
    });
  };

  const selectRef = (ref: VcsRef) => {
    if (pending) return;
    setOpen(false);
    setQuery("");
    if (isSelectingWorktreeBase) {
      setThreadBranch(ref.name, null);
      return;
    }
    const target = resolveBranchSelectionTarget({ activeProjectCwd: projectCwd, activeWorktreePath, refName: ref });
    if (target.reuseExistingWorktree) {
      setThreadBranch(ref.name, target.nextWorktreePath);
      return;
    }
    const selectedName = ref.isRemote ? deriveLocalBranchNameFromRemoteRef(ref.name) : ref.name;
    runBranchAction(async () => {
      setOptimistic(selectedName);
      const result = (await runAtomCommand(
        appAtomRegistry,
        vcsEnvironment.switchRef,
        { environmentId, input: { cwd: target.checkoutCwd, refName: ref.name } } as never,
        { reportFailure: false },
      )) as AtomCommandResult<{ refName?: string | null }, unknown>;
      if (result._tag === "Success") {
        setThreadBranch(ref.isRemote ? (result.value.refName ?? selectedName) : selectedName, target.nextWorktreePath);
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        toast({ type: "error", title: "Failed to switch ref.", description: errorMessage(squashAtomCommandFailure(result)) });
      }
    });
  };

  const createRef = (raw: string) => {
    const name = sanitizeNewRefName(raw);
    if (!name || pending) return;
    setOpen(false);
    setQuery("");
    runBranchAction(async () => {
      setOptimistic(name);
      const result = (await runAtomCommand(
        appAtomRegistry,
        vcsEnvironment.createRef,
        { environmentId, input: { cwd: branchCwd, refName: name, switchRef: true } } as never,
        { reportFailure: false },
      )) as AtomCommandResult<{ refName: string }, unknown>;
      if (result._tag === "Success") {
        setThreadBranch(result.value.refName, activeWorktreePath);
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        toast({ type: "error", title: "Failed to create and switch ref.", description: errorMessage(squashAtomCommandFailure(result)) });
      }
    });
  };

  const select = (value: string) => {
    if (createValue && value === createValue) {
      createRef(trimmed);
      return;
    }
    const ref = byName.get(value);
    if (ref) selectRef(ref);
  };

  const loading = refsQuery.isPending && refsQuery.data === null;

  return (
    <div style={{ display: "flex", position: "relative", width: "100%", flexDirection: "column" }}>
      <ActionMenu<"copy-branch-name">
        open={contextMenuOpen}
        onOpenChange={setContextMenuOpen}
        items={[{ id: "copy-branch-name", label: "Copy branch name", icon: "copy" }]}
        onSelect={() => {
          if (!resolvedActiveBranch) return;
          void copyTextToClipboard(resolvedActiveBranch).then(
            () => toast({ type: "success", title: "Branch name copied", description: resolvedActiveBranch }),
            (error) => toast({ type: "error", title: "Failed to copy branch name", description: errorMessage(error) }),
          );
        }}
        rootStyle={{ width: "100%" }}
        trigger={
          <DetailsSelectRow
            testId="branch-row"
            open={open}
            disabled={loading || pending}
            onToggle={() => {
              setOpen(!open);
              if (open) setQuery("");
              // autoFocus takes focus when the input mounts, without an onFocus event.
              else setSearchFocused(true);
            }}
            onRightClick={() => setContextMenuOpen(true)}
          >
            <DetailsIcon name="git-branch" />
            <DetailsLabel>{label}</DetailsLabel>
          </DetailsSelectRow>
        }
      />
      {open ? (
        <DismissableLayer
          onEscapeKeyDown={() => {
            setOpen(false);
            setQuery("");
          }}
        >
          <FloatingLayer
            side="bottom"
            align="start"
            sideOffset={4}
            testId="branch-picker"
            onMouseDownOutside={() => {
              setOpen(false);
              setQuery("");
            }}
            style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", width: PICKER_WIDTH }}
          >
            {/* ComboboxSearchInput: px-3 pt-2.5, a 1px rule that turns ring-blue while focused. */}
            <div style={{ flexShrink: 0, paddingTop: 9, paddingLeft: 12, paddingRight: 12 }}>
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
                  testId="branch-search"
                  autoFocus
                  value={query}
                  placeholder="Search refs..."
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  onChange={(event: EventPayload) => setQuery(String(event.value ?? ""))}
                  onSubmit={() => {
                    const first = items[0];
                    if (first) select(first);
                  }}
                  theme={{ caret: theme.foreground }}
                  style={{
                    flexGrow: 1,
                    minWidth: 0,
                    height: 26,
                    lineHeight: 26,
                    color: theme.foreground,
                    fontSize: 14,
                    fontFamily: FONTS.sans,
                    backgroundColor: "#00000000",
                  }}
                />
              </div>
            </div>
            <div style={{ position: "relative", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div
              onScrollChange={(event: EventPayload) => setListScroll(-(event.scrollY ?? 0))}
              style={{
                display: "flex",
                flexDirection: "column",
                maxHeight: LIST_MAX_HEIGHT,
                ...(listScrolls ? { overflowY: "scroll" as const } : {}),
                paddingTop: items.length === 0 ? 0 : 12,
                paddingBottom: items.length === 0 ? 0 : 12,
                paddingLeft: 8,
                paddingRight: 4,
                scrollbarColor: theme.scrollbar,
                pointerEvents: "auto",
              }}
            >
              {items.length === 0 ? (
                <div style={{ paddingTop: 16, paddingBottom: 16, display: "flex", justifyContent: "center" }}>
                  <Text color={theme.mutedForeground}>{loading ? "Loading refs..." : "No refs found."}</Text>
                </div>
              ) : (
                items.map((value) => {
                  if (createValue && value === createValue) {
                    return (
                      <PickerItem key={value} testId="branch-create" onClick={() => select(value)}>
                        <Text truncate style={{ flexGrow: 1 }}>{`Create new ref "${newRefName}"`}</Text>
                      </PickerItem>
                    );
                  }
                  const ref = byName.get(value)!;
                  const secondaryWorktree = ref.worktreePath && ref.worktreePath !== projectCwd;
                  const badge = ref.current
                    ? "current"
                    : secondaryWorktree
                      ? "worktree"
                      : ref.isRemote
                        ? "remote"
                        : ref.isDefault
                          ? "default"
                          : null;
                  return (
                    <PickerItem
                      key={value}
                      testId={`branch-item-${value}`}
                      selected={value === resolvedActiveBranch}
                      disabled={!canOperate}
                      onClick={() => select(value)}
                    >
                      <text
                        style={{
                          color: theme.foreground,
                          fontSize: 14,
                          lineHeight: 20,
                          fontFamily: FONTS.sans,
                          flexGrow: 1,
                          minWidth: 0,
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                        }}
                      >
                        {value}
                      </text>
                      {badge ? (
                        <text style={{ color: alpha(theme.mutedForeground, 0.45), fontSize: 10, lineHeight: 14, fontFamily: FONTS.sans, flexShrink: 0 }}>
                          {badge}
                        </text>
                      ) : null}
                    </PickerItem>
                  );
                })
              )}
            </div>
            {/* getVirtualizedScrollFadeClassName: 24px fades where more refs are scrolled away. */}
            {listScrolls && listScroll > 0 ? <ListFade edge="top" color={fadeColor} /> : null}
            {listScrolls && listScroll < listContentHeight - LIST_MAX_HEIGHT - 1 ? <ListFade edge="bottom" color={fadeColor} /> : null}
            </div>
            {statusText ? (
              <div style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderTopWidth: 1, borderColor: theme.border }}>
                <Text size="xs" color={theme.mutedForeground}>
                  {statusText}
                </Text>
              </div>
            ) : null}
          </FloatingLayer>
        </DismissableLayer>
      ) : null}
    </div>
  );
}

function ListFade({ edge, color }: { edge: "top" | "bottom"; color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        [edge]: 0,
        height: 24,
        pointerEvents: "none",
        background: {
          type: "linear-gradient",
          // angle 0 runs bottom to top
          angle: 0,
          stops:
            edge === "bottom"
              ? [
                  { color, position: 0 },
                  { color: alpha(color, 0), position: 1 },
                ]
              : [
                  { color: alpha(color, 0), position: 0 },
                  { color, position: 1 },
                ],
        },
      }}
    />
  );
}

function PickerItem({
  children,
  onClick,
  selected,
  disabled,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  selected?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
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
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        backgroundColor: selected ? theme.accent : "#00000000",
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      {children}
    </div>
  );
}
