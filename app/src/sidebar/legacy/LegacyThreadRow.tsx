// LegacySidebar.tsx SidebarThreadRow: one 32px row of a project's thread list.
// Status pill and title on the left; worktree and terminal indicators, then the
// relative time (or the jump hint) on the right. Hovering a row that can be
// archived swaps the time for an archive button; with "Confirm thread archive"
// on, the first press shows an inline Confirm instead.
//
// gpuix delivers a click to every handler under the pointer, so the controls
// inside the row claim their press (clickGuard.ts) and the row skips it.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { threadRuntimeCanArchive, type EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { AuthTerminalReadScope, type ScopedThreadRef } from "@t3tools/contracts";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/shared/threadPullRequests";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { memo, useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentServerConfigsAtom, environmentThreadShells } from "../../state/environment.ts";
import {
  legacyConfirmingArchiveThreadKeyAtom,
  legacyContextMenuAtom,
} from "../../state/legacySidebar.ts";
import {
  canOperateEnvironmentAtom,
  clearThreadSelection,
  rangeSelectThreadsTo,
  readThreadSelection,
  setThreadSelectionAnchor,
  sidebarClientSettingsAtom,
  sidebarRenameAtom,
  threadSelectedAtom,
  toggleThreadSelection,
} from "../../state/sidebar.ts";
import { terminalUiActions, useEnvironmentScope, useTerminalMetadata } from "../../state/terminal.ts";
import { rightPanelOpenAtom, rightPanelSurfaceAtom } from "../../state/ui.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { formatRelativeTimeLabel } from "../../web/timestampFormat.ts";
import type { ThreadStatusPill } from "../../web/components/LegacySidebar.logic.ts";
import { claimClick, consumeClaimedClick } from "../clickGuard.ts";
import { useNowMinute } from "../clock.ts";
import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequestBadge.ts";
import { archiveThread, navigateToThread, renameThread, reportResult } from "../threadActions.ts";
import { ThreadStatusLabel, legacyTones } from "./legacyStatus.tsx";

export interface LegacyThreadRowProps {
  readonly thread: EnvironmentThreadShell;
  readonly status: ThreadStatusPill | null;
  readonly orderedProjectThreadKeys: ReadonlyArray<string>;
  readonly projectKey: string;
  readonly isActive: boolean;
  readonly jumpLabel: string | null;
  readonly isRemote: boolean;
}

/** Reads the live shell, so a streaming thread re-renders only its own row. */
export const LegacyThreadRow = memo(function LegacyThreadRow(props: LegacyThreadRowProps) {
  const ref = scopeThreadRef(props.thread.environmentId, props.thread.id);
  const live = useAtomValue(environmentThreadShells.threadShellAtom(ref));
  return <LegacyThreadRowView {...props} thread={live ?? props.thread} />;
});

function LegacyThreadRowView(props: LegacyThreadRowProps) {
  const { thread, isActive } = props;
  const theme = useTheme();
  const tones = legacyTones(theme);
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const canOperate = useAtomValue(canOperateEnvironmentAtom(thread.environmentId));
  const isSelected = useAtomValue(threadSelectedAtom(threadKey));
  const confirmThreadArchive = useAtomValue(sidebarClientSettingsAtom).confirmThreadArchive;
  const [confirmingKey, setConfirmingKey] = useAtomStateSetter();
  const rename = useAtomValue(sidebarRenameAtom);
  const setRename = useAtomSet(sidebarRenameAtom);
  const setContextMenu = useAtomSet(legacyContextMenuAtom);
  // The row and its Confirm button share one hover: Confirm has a fill, so
  // entering it ends the row's own hover in gpuix.
  const [rowHovered, setRowHovered] = useState(false);
  const [confirmHovered, setConfirmHovered] = useState(false);
  const hovered = rowHovered || confirmHovered;
  const hoverZone = useRef({ row: false, confirm: false });
  const isRenaming = canOperate && rename !== null && rename.threadKey === threadKey;
  const isThreadRunning = !threadRuntimeCanArchive(thread.runtime);
  const isConfirmingArchive = canOperate && confirmingKey === threadKey && !isThreadRunning;
  const canArchive = canOperate && !isThreadRunning;
  const isHighlighted = isActive || isSelected;

  const clearConfirming = () => {
    if (appAtomRegistry.get(legacyConfirmingArchiveThreadKeyAtom) === threadKey) setConfirmingKey(null);
  };

  const handleClick = (event: {
    clickCount?: number;
    modifiers?: { shift?: boolean; ctrl?: boolean; cmd?: boolean; alt?: boolean };
  }) => {
    if (consumeClaimedClick()) return;
    if (isRenaming) return;
    const modifiers = event.modifiers;
    // handleThreadClick: mod-click toggles, shift-click extends within the project.
    if (process.platform === "darwin" ? modifiers?.cmd : modifiers?.ctrl) {
      toggleThreadSelection(threadKey);
      return;
    }
    if (modifiers?.shift) {
      rangeSelectThreadsTo(threadKey, props.orderedProjectThreadKeys);
      return;
    }
    // handleRowDoubleClick: a plain double-click renames inline; its trailing
    // click must not navigate (isTrailingDoubleClick).
    if ((event.clickCount ?? 1) === 2) {
      if (canOperate && !modifiers?.alt) setRename({ threadKey, title: thread.title });
      return;
    }
    if ((event.clickCount ?? 1) > 2) return;
    if (readThreadSelection().selectedThreadKeys.size > 0) clearThreadSelection();
    setThreadSelectionAnchor(threadKey);
    navigateToThread(threadRef);
  };

  const handleAuxClick = (event: { x?: number; y?: number; isRightClick?: boolean }) => {
    if (event.isRightClick === false) return;
    const selection = readThreadSelection();
    const position = { x: event.x ?? 0, y: event.y ?? 0 };
    if (selection.selectedThreadKeys.size > 0 && isSelected) {
      setContextMenu({ kind: "selection", ...position });
      return;
    }
    if (selection.selectedThreadKeys.size > 0) clearThreadSelection();
    setContextMenu({ kind: "thread", threadKey, projectKey: props.projectKey, ...position });
  };

  // handleMouseLeave: leaving the row drops a pending confirmation. The check
  // waits a tick so moving between the row and Confirm does not count.
  const leaveHoverZone = () => {
    setTimeout(() => {
      if (!hoverZone.current.row && !hoverZone.current.confirm) clearConfirming();
    }, 30);
  };

  const archiveNow = () => {
    clearConfirming();
    void archiveThread(threadRef).then((result) => reportResult(result, "Failed to archive thread"));
  };

  const background = isActive
    ? theme.sidebar.rowActive
    : isSelected
      ? hovered
        ? theme.sidebar.rowActive
        : theme.sidebar.rowSelected
      : hovered
        ? theme.sidebar.rowHover
        : "#00000000";
  const titleColor = isActive || isSelected || hovered ? theme.sidebar.foreground : alpha(theme.sidebar.mutedForeground, 0.8);
  // threadMetaClassName: the time hides under the archive control on hover.
  const hideMeta = isConfirmingArchive || (canArchive && hovered);

  return (
    <div
      testId={`legacy-thread-row-${thread.id}`}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      onMouseEnter={() => {
        hoverZone.current.row = true;
        setRowHovered(true);
      }}
      onMouseLeave={() => {
        hoverZone.current.row = false;
        setRowHovered(false);
        leaveHoverZone();
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 32,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.md,
        flexShrink: 0,
        overflow: "hidden",
        cursor: "pointer",
        backgroundColor: background,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <ThreadPullRequestIcon thread={thread} isActive={isActive} />
        {props.status ? <ThreadStatusLabel status={props.status} /> : null}
        {isRenaming ? (
          <RenameInput
            title={rename.title}
            onChange={(title) => setRename({ threadKey, title })}
            onCommit={(title) => {
              if (appAtomRegistry.get(sidebarRenameAtom)?.threadKey !== threadKey) return;
              setRename(null);
              void renameThread(threadRef, title, thread.title);
            }}
            onCancel={() => setRename(null)}
          />
        ) : (
          <Tooltip content={thread.title} side="top" rootStyle={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
              <Text size="sm" weight={isActive ? 500 : 400} color={titleColor} truncate testId={`legacy-thread-title-${thread.id}`}>
                {thread.title}
              </Text>
            </div>
          </Tooltip>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <WorktreeIndicator thread={thread} />
        <TerminalStatusButton threadRef={threadRef} />
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "flex-end",
            minWidth: 48,
            gap: 4,
            pointerEvents: "none",
            ...(hideMeta ? { opacity: 0 } : {}),
          }}
        >
          {props.isRemote ? <Icon name="cloud" size={12} color={alpha(theme.mutedForeground, 0.4)} /> : null}
          {props.jumpLabel ? (
            <JumpLabel label={props.jumpLabel} />
          ) : (
            <RelativeTime
              timestamp={thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt}
              color={isHighlighted ? theme.foreground : tones.secondaryLabel}
            />
          )}
        </div>
      </div>
      {isConfirmingArchive ? (
        <div style={{ position: "absolute", top: 6, right: 4, display: "flex" }}>
          <ConfirmArchiveButton
            threadId={thread.id}
            onConfirm={archiveNow}
            onHoverChange={(value) => {
              hoverZone.current.confirm = value;
              setConfirmHovered(value);
              if (!value) leaveHoverZone();
            }}
          />
        </div>
      ) : canArchive && hovered ? (
        <div style={{ position: "absolute", top: 4, right: 2, display: "flex" }}>
          {confirmThreadArchive ? (
            <ArchiveButton threadId={thread.id} onActivate={() => setConfirmingKey(threadKey)} />
          ) : (
            <Tooltip content="Archive" side="top">
              <ArchiveButton threadId={thread.id} onActivate={archiveNow} />
            </Tooltip>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The inline rename field. autoFocus does not reach a gpuix input mounted into
 * an existing tree, so it is focused on mount.
 */
function RenameInput({
  title,
  onChange,
  onCommit,
  onCancel,
}: {
  title: string;
  onChange: (title: string) => void;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const inputRef = useRef<PublicInstance | null>(null);
  const latestTitle = useRef(title);
  latestTitle.current = title;
  useEffect(() => {
    if (inputRef.current) renderer.focusElement?.(inputRef.current.id);
  }, [renderer]);
  return (
    <input
      ref={inputRef}
      testId="legacy-rename-input"
      value={title}
      theme={{ caret: theme.foreground }}
      onMouseDown={claimClick}
      onChange={(event) => onChange(String(event.value ?? ""))}
      onSubmit={(event) => onCommit(String(event.value ?? latestTitle.current))}
      onKeyDown={(event) => {
        if (event.key === "escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
      onBlur={() => onCommit(latestTitle.current)}
      style={{
        flexGrow: 1,
        minWidth: 0,
        height: 20,
        paddingLeft: 2,
        paddingRight: 2,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.primary,
        color: theme.foreground,
        fontSize: 14,
        fontFamily: FONTS.sans,
      }}
    />
  );
}

function useAtomStateSetter(): [string | null, (key: string | null) => void] {
  return [useAtomValue(legacyConfirmingArchiveThreadKeyAtom), useAtomSet(legacyConfirmingArchiveThreadKeyAtom)];
}

function RelativeTime({ timestamp, color }: { timestamp: string; color: string }) {
  const nowMinute = useNowMinute();
  return (
    <Text size="3xs" color={color} style={{ whiteSpace: "nowrap" }}>
      {formatRelativeTimeLabel(timestamp, Math.max(nowMinute, Date.now()))}
    </Text>
  );
}

/** The `mod+N` hint: a 20px pill, border/80 over background/90, mono 10px. */
function JumpLabel({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 20,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.8),
        backgroundColor: alpha(theme.background, 0.9),
        boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#0000000d" },
      }}
    >
      <text style={{ color: theme.foreground, fontSize: 10, lineHeight: 14, fontWeight: 500, fontFamily: FONTS.mono }}>{label}</text>
    </div>
  );
}

/** SIDEBAR_ICON_ACTION_BUTTON_CLASS: 24px, icon-muted until hovered. */
function ArchiveButton({ threadId, onActivate }: { threadId: string; onActivate: () => void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={`legacy-thread-archive-${threadId}`}
      onMouseDown={claimClick}
      onClick={onActivate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 24,
        minWidth: 24,
        paddingLeft: 3,
        paddingRight: 3,
        borderRadius: RADIUS.md,
        cursor: "pointer",
      }}
    >
      <Icon name="archive" size={14} color={hovered ? theme.foreground : theme.mutedForeground} />
    </div>
  );
}

function ConfirmArchiveButton({
  threadId,
  onConfirm,
  onHoverChange,
}: {
  threadId: string;
  onConfirm: () => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={`legacy-thread-archive-confirm-${threadId}`}
      onMouseDown={claimClick}
      onClick={onConfirm}
      onMouseEnter={() => {
        setHovered(true);
        onHoverChange(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHoverChange(false);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        height: 20,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.md,
        cursor: "pointer",
        backgroundColor: alpha(theme.error, hovered ? 0.18 : 0.12),
      }}
    >
      <text style={{ color: theme.errorForeground, fontSize: 10, lineHeight: 14, fontWeight: 500, fontFamily: FONTS.sans }}>Confirm</text>
    </div>
  );
}

/**
 * The PR glyph left of the title (prStatusIndicator / ChangeRequestStatusIcon):
 * tinted by the linked PR's state; muted while its status is still unknown.
 * Pressing it opens the PR in the thread's right panel (pullRequestLinksOpenInApp).
 */
function ThreadPullRequestIcon({ thread, isActive }: { thread: EnvironmentThreadShell; isActive: boolean }) {
  const theme = useTheme();
  const supportsMultiple =
    useAtomValue(environmentServerConfigsAtom).get(thread.environmentId)?.environment.capabilities.threadPullRequests ===
    true;
  const setRightPanelOpen = useAtomSet(rightPanelOpenAtom);
  const setRightPanelSurface = useAtomSet(rightPanelSurfaceAtom);
  const current = supportsMultiple ? resolveThreadCurrentPullRequestLink(thread.pullRequests) : null;
  if (current === null) return null;
  const snapshot = current.snapshot;
  const state =
    snapshot === null
      ? null
      : PULL_REQUEST_STATE_PRESENTATION[snapshot.state === "open" && snapshot.isDraft ? "draft" : snapshot.state];
  const label = state && snapshot ? `PR #${current.number} - ${state.label}: ${snapshot.title}` : `PR #${current.number}, status pending`;
  return (
    <Tooltip content={label} side="top" rootStyle={{ flexShrink: 0 }}>
      <div
        onMouseDown={claimClick}
        onClick={() => {
          setRightPanelSurface("pull-request");
          setRightPanelOpen(true);
          if (!isActive) navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
        }}
        style={{ display: "flex", flexShrink: 0, cursor: "pointer" }}
      >
        <Icon name={state?.icon ?? "git-pull-request-arrow"} size={12} color={state?.color ?? theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}

/** ThreadWorktreeIndicator. */
function WorktreeIndicator({ thread }: { thread: EnvironmentThreadShell }) {
  const theme = useTheme();
  const worktreePath = thread.worktreePath?.trim();
  if (!worktreePath) return null;
  const tooltip = thread.branch ? `Worktree: ${worktreePath} (${thread.branch})` : `Worktree: ${worktreePath}`;
  return (
    <Tooltip content={tooltip} side="top" rootStyle={{ flexShrink: 0 }}>
      <div style={{ display: "flex", flexShrink: 0 }}>
        <Icon name="folder-git-2" size={12} color={alpha(theme.mutedForeground, 0.4)} />
      </div>
    </Tooltip>
  );
}

/**
 * ThreadTerminalStatusButton: a teal terminal glyph while one of the thread's
 * terminals runs a process; pressing it opens that terminal. Web pulses it;
 * t3-term draws it still (no continuous animations).
 */
function TerminalStatusButton({ threadRef }: { threadRef: ScopedThreadRef }) {
  const theme = useTheme();
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthTerminalReadScope);
  const metadata = useTerminalMetadata(threadRef.environmentId, canRead);
  const terminalIds = (metadata ?? [])
    .filter((summary) => summary.threadId === threadRef.threadId && summary.hasRunningSubprocess)
    .map((summary) => summary.terminalId)
    .toSorted(new Intl.Collator(undefined, { numeric: true }).compare);
  const terminalId = terminalIds[0];
  if (terminalId === undefined) return null;
  const label =
    terminalIds.length === 1
      ? "1 terminal process running. Open terminal"
      : `${terminalIds.length} terminal processes running. Open terminal`;
  return (
    <Tooltip content={label} side="top" rootStyle={{ flexShrink: 0 }}>
      <div
        testId={`legacy-terminal-status-${threadRef.threadId}`}
        onMouseDown={claimClick}
        onClick={() => {
          const threadKey = scopedThreadKey(threadRef);
          terminalUiActions.setActive(threadKey, terminalId);
          terminalUiActions.setOpen(threadKey, true);
          navigateToThread(threadRef);
        }}
        style={{ display: "flex", flexShrink: 0, cursor: "pointer" }}
      >
        <Icon name="terminal" size={14} color={theme.appearance === "dark" ? "#46ecd5e6" : "#009689"} />
      </div>
    </Tooltip>
  );
}
