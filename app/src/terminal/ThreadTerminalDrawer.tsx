// Port of apps/web/src/components/ThreadTerminalDrawer.tsx (the drawer body):
// split panes, the terminal sidebar with groups, the floating action group,
// the resize strip, the empty state and the close confirmation. The same
// component renders the right panel's terminal surface (`mode: "panel"`).
import { useWindowSize } from "@gpuix/react";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { Dialog, Tooltip } from "../ui/overlay.tsx";
import { Button, Text } from "../ui/primitives.tsx";
import { alpha, RADIUS, useTheme } from "../ui/theme.ts";
import { MAX_TERMINALS_PER_GROUP, type ThreadTerminalGroup } from "../state/terminal.ts";
import { TerminalView, type TerminalShortcutCommand } from "./TerminalView.tsx";

const MIN_DRAWER_HEIGHT = 180;
const MAX_DRAWER_HEIGHT_RATIO = 0.75;
/** Header plus the composer overlay the drawer must not push into the header. */
const CHAT_COLUMN_RESERVED_HEIGHT = 52 + 176;

const isMac = process.platform === "darwin";

export function shortcutLabel(key: string, shift = false): string {
  return isMac ? `${shift ? "⇧" : ""}⌘${key.toUpperCase()}` : `Ctrl+${shift ? "Shift+" : ""}${key.toUpperCase()}`;
}

export interface TerminalLaunchLocation {
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly runtimeEnv: Record<string, string>;
}

export interface ThreadTerminalDrawerProps {
  readonly mode?: "drawer" | "panel";
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly runtimeEnv: Record<string, string>;
  readonly height: number;
  readonly terminalIds: readonly string[];
  readonly activeTerminalId: string;
  readonly terminalGroups: readonly ThreadTerminalGroup[];
  readonly activeTerminalGroupId: string;
  readonly focusRequestId: number;
  readonly canOperate: boolean;
  readonly terminalLabelsById?: ReadonlyMap<string, string>;
  readonly terminalLaunchLocationsById?: ReadonlyMap<string, TerminalLaunchLocation>;
  readonly onSplitTerminal: () => void;
  readonly onSplitTerminalVertical: () => void;
  readonly onNewTerminal: () => void;
  readonly onActiveTerminalChange: (terminalId: string) => void;
  readonly onCloseTerminal: (terminalId: string) => void;
  readonly onHeightChange: (height: number) => void;
  readonly testIdPrefix?: string;
}

function clampDrawerHeight(height: number, maxHeight: number): number {
  const safeHeight = Number.isFinite(height) ? height : 280;
  return Math.min(Math.max(Math.round(safeHeight), MIN_DRAWER_HEIGHT), maxHeight);
}

function resolveGroups(terminalIds: readonly string[], terminalGroups: readonly ThreadTerminalGroup[]) {
  if (terminalIds.length === 0) return [];
  const valid = new Set(terminalIds);
  const assigned = new Set<string>();
  const used = new Set<string>();
  const unique = (groupId: string) => {
    let candidate = groupId;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${groupId}-${suffix++}`;
    used.add(candidate);
    return candidate;
  };
  const groups: ThreadTerminalGroup[] = [];
  for (const group of terminalGroups) {
    const ids = [...new Set(group.terminalIds.map((id) => id.trim()))].filter(
      (id) => id.length > 0 && valid.has(id) && !assigned.has(id),
    );
    if (ids.length === 0) continue;
    for (const id of ids) assigned.add(id);
    groups.push({
      id: unique(group.id.trim() || `group-${ids[0]}`),
      terminalIds: ids,
      ...(group.splitDirection === "vertical" ? { splitDirection: "vertical" as const } : {}),
    });
  }
  for (const id of terminalIds) {
    if (!assigned.has(id)) groups.push({ id: unique(`group-${id}`), terminalIds: [id] });
  }
  const order = new Map(terminalIds.map((id, index) => [id, index] as const));
  const rank = (ids: readonly string[]) => Math.min(...ids.map((id) => order.get(id) ?? Number.POSITIVE_INFINITY));
  return groups.toSorted((left, right) => rank(left.terminalIds) - rank(right.terminalIds));
}

export function ThreadTerminalDrawer(props: ThreadTerminalDrawerProps) {
  const theme = useTheme();
  const isPanel = props.mode === "panel";
  const window = useWindowSize();
  const maxHeight = Math.max(
    MIN_DRAWER_HEIGHT,
    Math.min(Math.floor(window.height * MAX_DRAWER_HEIGHT_RATIO), window.height - CHAT_COLUMN_RESERVED_HEIGHT),
  );
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const drawerHeight = clampDrawerHeight(dragHeight ?? props.height, maxHeight);
  const [closeRequest, setCloseRequest] = useState<string | null>(null);

  const terminalIds = [...new Set(props.terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  const groups = resolveGroups(terminalIds, props.terminalGroups);
  const labelOf = (terminalId: string) => props.terminalLabelsById?.get(terminalId) ?? getTerminalLabel(terminalId);
  const activeTerminalId = terminalIds.includes(props.activeTerminalId) ? props.activeTerminalId : (terminalIds[0] ?? "");
  const groupIndexById = groups.findIndex((group) => group.id === props.activeTerminalGroupId);
  const activeGroupIndex =
    groupIndexById >= 0 ? groupIndexById : Math.max(0, groups.findIndex((group) => group.terminalIds.includes(activeTerminalId)));
  const visibleTerminalIds = groups[activeGroupIndex]?.terminalIds ?? (terminalIds.length > 0 ? [activeTerminalId] : []);
  const splitDirection = groups[activeGroupIndex]?.splitDirection ?? "horizontal";
  const hasSidebar = terminalIds.length > 1;
  const showGroupHeaders = groups.length > 1 || groups.some((group) => group.terminalIds.length > 1);
  const atSplitLimit = visibleTerminalIds.length >= MAX_TERMINALS_PER_GROUP;
  const launchOf = (terminalId: string): TerminalLaunchLocation =>
    props.terminalLaunchLocationsById?.get(terminalId) ?? {
      cwd: props.cwd,
      worktreePath: props.worktreePath,
      runtimeEnv: props.runtimeEnv,
    };

  const labels = {
    split: atSplitLimit
      ? `Split Terminal Horizontally (max ${MAX_TERMINALS_PER_GROUP} per group)`
      : `Split Terminal Horizontally (${shortcutLabel("d")})`,
    splitVertical: atSplitLimit
      ? `Split Terminal Vertically (max ${MAX_TERMINALS_PER_GROUP} per group)`
      : `Split Terminal Vertically (${shortcutLabel("d", true)})`,
    new: `New Terminal (${shortcutLabel("n")})`,
    close: `Close Terminal (${shortcutLabel("w")})`,
  };
  const split = () => {
    if (props.canOperate && !atSplitLimit) props.onSplitTerminal();
  };
  const splitVertical = () => {
    if (props.canOperate && !atSplitLimit) props.onSplitTerminalVertical();
  };
  const newTerminal = () => {
    if (props.canOperate) props.onNewTerminal();
  };
  const requestClose = (terminalId: string) => {
    if (props.canOperate && terminalId) setCloseRequest(terminalId);
  };
  const onShortcut = (command: TerminalShortcutCommand) => {
    if (command === "split") split();
    else if (command === "splitVertical") splitVertical();
    else if (command === "new") newTerminal();
    else requestClose(activeTerminalId);
  };

  const testId = props.testIdPrefix ?? (isPanel ? "panel-terminal" : "terminal-drawer");
  const resizeStrip = isPanel ? null : (
    <div
      testId={`${testId}-resize`}
      onMouseDown={(event) => {
        drag.current = { startY: event.y ?? 0, startHeight: drawerHeight };
      }}
      onMouseMove={(event) => {
        const state = drag.current;
        if (!state) return;
        const next = clampDrawerHeight(state.startHeight + (state.startY - (event.y ?? state.startY)), maxHeight);
        setDragHeight(next);
      }}
      onMouseUp={() => {
        const state = drag.current;
        drag.current = null;
        if (!state) return;
        setDragHeight((current) => {
          if (current !== null && current !== state.startHeight) props.onHeightChange(current);
          return null;
        });
      }}
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, cursor: "row-resize" }}
    />
  );

  const shellStyle = {
    position: "relative" as const,
    display: "flex",
    flexDirection: "column" as const,
    minWidth: 0,
    overflow: "hidden" as const,
    backgroundColor: theme.background,
    ...(isPanel
      ? { flexGrow: 1, height: "100%" as const }
      : { flexShrink: 0, height: drawerHeight, borderTopWidth: 1, borderColor: alpha(theme.border, 0.8) }),
  };

  const confirm = closeRequest ? (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setCloseRequest(null);
      }}
      title={`Close terminal "${labelOf(closeRequest)}"?`}
      description="This stops the running process and clears its history."
      testId="terminal-close-confirm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => setCloseRequest(null)} testId="terminal-close-cancel">
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            testId="terminal-close-confirm-button"
            onClick={() => {
              const terminalId = closeRequest;
              setCloseRequest(null);
              props.onCloseTerminal(terminalId);
            }}
          >
            Confirm
          </Button>
        </>
      }
    />
  ) : null;

  if (terminalIds.length === 0) {
    return (
      <div testId={testId} style={shellStyle}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            minHeight: 0,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 24,
            paddingBottom: 24,
          }}
        >
          <Text color={theme.mutedForeground}>No terminal sessions for this thread yet.</Text>
          <Button size="xs" variant="outline" onClick={newTerminal} disabled={!props.canOperate} testId={`${testId}-new-empty`}>
            {labels.new}
          </Button>
        </div>
        {resizeStrip}
        {confirm}
      </div>
    );
  }

  const panes = (
    <div
      style={{
        display: "flex",
        flexDirection: splitDirection === "vertical" ? "column" : "row",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {visibleTerminalIds.map((terminalId, index) => {
        const launch = launchOf(terminalId);
        return (
          <div
            key={terminalId}
            onMouseDown={() => {
              if (terminalId !== activeTerminalId) props.onActiveTerminalChange(terminalId);
            }}
            style={{
              display: "flex",
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              minHeight: 0,
              ...(index > 0
                ? {
                    [splitDirection === "vertical" ? "borderTopWidth" : "borderLeftWidth"]: 1,
                    borderColor: terminalId === activeTerminalId ? theme.border : alpha(theme.border, 0.7),
                  }
                : {}),
            }}
          >
            <TerminalView
              environmentId={props.environmentId}
              threadId={props.threadId}
              terminalId={terminalId}
              cwd={launch.cwd}
              worktreePath={launch.worktreePath}
              runtimeEnv={launch.runtimeEnv}
              autoFocus={terminalId === activeTerminalId}
              focusRequestId={props.focusRequestId}
              onSessionExited={() => props.onCloseTerminal(terminalId)}
              onShortcut={onShortcut}
              onFocused={() => {
                if (terminalId !== activeTerminalId) props.onActiveTerminalChange(terminalId);
              }}
              testId={`${testId}-view-${terminalId}`}
            />
          </div>
        );
      })}
    </div>
  );

  return (
    <div testId={testId} style={shellStyle}>
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, gap: hasSidebar ? 6 : 0 }}>
        {panes}
        {hasSidebar ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 144,
              minWidth: 144,
              flexShrink: 0,
              borderWidth: 1,
              borderColor: alpha(theme.border, 0.7),
              backgroundColor: alpha(theme.muted, 0.1),
              userSelect: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "flex-end",
                height: 22,
                flexShrink: 0,
                borderBottomWidth: 1,
                borderColor: alpha(theme.border, 0.7),
              }}
            >
              <SidebarAction label={labels.split} icon="square-split-horizontal" disabled={!props.canOperate || atSplitLimit} onClick={split} testId={`${testId}-split`} />
              <SidebarAction label={labels.splitVertical} icon="square-split-vertical" disabled={!props.canOperate || atSplitLimit} onClick={splitVertical} divider testId={`${testId}-split-vertical`} />
              <SidebarAction label={labels.new} icon="plus" disabled={!props.canOperate} onClick={newTerminal} divider testId={`${testId}-new`} />
              <SidebarAction label={labels.close} icon="trash-2" disabled={!props.canOperate} onClick={() => requestClose(activeTerminalId)} divider testId={`${testId}-close`} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", padding: 4 }}>
              {groups.map((group) => (
                <SidebarGroup
                  key={group.id}
                  group={group}
                  activeTerminalId={activeTerminalId}
                  showHeader={showGroupHeaders}
                  labelOf={labelOf}
                  canOperate={props.canOperate}
                  onActivate={props.onActiveTerminalChange}
                  onClose={requestClose}
                  testId={testId}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {hasSidebar ? null : (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            overflow: "hidden",
            borderRadius: RADIUS.sm,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.8),
            backgroundColor: theme.background,
            userSelect: "none",
          }}
        >
          <FloatingAction label={labels.split} icon="square-split-horizontal" disabled={!props.canOperate || atSplitLimit} onClick={split} testId={`${testId}-split`} />
          <ActionDivider />
          <FloatingAction label={labels.splitVertical} icon="square-split-vertical" disabled={!props.canOperate || atSplitLimit} onClick={splitVertical} testId={`${testId}-split-vertical`} />
          <ActionDivider />
          <FloatingAction label={labels.new} icon="plus" disabled={!props.canOperate} onClick={newTerminal} testId={`${testId}-new`} />
          <ActionDivider />
          <FloatingAction label={labels.close} icon="trash-2" disabled={!props.canOperate} onClick={() => requestClose(activeTerminalId)} testId={`${testId}-close`} />
        </div>
      )}
      {resizeStrip}
      {confirm}
    </div>
  );
}

function ActionDivider() {
  const theme = useTheme();
  return <div style={{ width: 1, height: 16, flexShrink: 0, backgroundColor: alpha(theme.border, 0.8) }} />;
}

/** TerminalActionButton: a 13px icon in p-1, tooltip on hover. */
function FloatingAction(props: { label: string; icon: IconName; disabled: boolean; onClick: () => void; testId: string }) {
  const theme = useTheme();
  return (
    <Tooltip content={props.label}>
      <div
        testId={props.testId}
        onClick={props.disabled ? undefined : props.onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 4,
          opacity: props.disabled ? 0.64 : 1,
          cursor: props.disabled ? "not-allowed" : "pointer",
          ...(props.disabled ? {} : { hover: { backgroundColor: theme.accent } }),
        }}
      >
        <Icon name={props.icon} size={13} color={alpha(theme.foreground, 0.9)} />
      </div>
    </Tooltip>
  );
}

function SidebarAction(props: {
  label: string;
  icon: IconName;
  disabled: boolean;
  onClick: () => void;
  divider?: boolean;
  testId: string;
}) {
  const theme = useTheme();
  return (
    <Tooltip content={props.label}>
      <div
        testId={props.testId}
        onClick={props.disabled ? undefined : props.onClick}
        style={{
          display: "flex",
          alignItems: "center",
          height: "100%",
          paddingLeft: 4,
          paddingRight: 4,
          ...(props.divider ? { borderLeftWidth: 1, borderColor: alpha(theme.border, 0.7) } : {}),
          opacity: props.disabled ? 0.64 : 1,
          cursor: props.disabled ? "not-allowed" : "pointer",
          ...(props.disabled ? {} : { hover: { backgroundColor: alpha(theme.accent, 0.7) } }),
        }}
      >
        <Icon name={props.icon} size={13} color={alpha(theme.foreground, 0.9)} />
      </div>
    </Tooltip>
  );
}

function SidebarGroup(props: {
  group: ThreadTerminalGroup;
  activeTerminalId: string;
  showHeader: boolean;
  labelOf: (terminalId: string) => string;
  canOperate: boolean;
  onActivate: (terminalId: string) => void;
  onClose: (terminalId: string) => void;
  testId: string;
}) {
  const theme = useTheme();
  const { group } = props;
  const isGroupActive = group.terminalIds.includes(props.activeTerminalId);
  const groupActiveTerminalId = isGroupActive ? props.activeTerminalId : (group.terminalIds[0] ?? props.activeTerminalId);
  const isSplit = group.terminalIds.length > 1;
  const groupLabel = !isSplit ? "Single" : group.splitDirection === "vertical" ? "Stacked" : "Side by side";
  const groupIcon: IconName = !isSplit ? "square" : group.splitDirection === "vertical" ? "square-split-vertical" : "square-split-horizontal";
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 2, flexShrink: 0 }}>
      {props.showHeader ? (
        <div
          onClick={() => props.onActivate(groupActiveTerminalId)}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            height: 22,
            paddingLeft: 6,
            paddingRight: 6,
            borderRadius: 4,
            cursor: "pointer",
            backgroundColor: isGroupActive ? alpha(theme.accent, 0.5) : "#00000000",
            ...(isGroupActive ? {} : { hover: { backgroundColor: alpha(theme.accent, 0.4) } }),
          }}
        >
          <Icon name={groupIcon} size={12} color={isGroupActive ? theme.foreground : theme.mutedForeground} />
          <Text size="2xs" color={isGroupActive ? theme.foreground : theme.mutedForeground} truncate style={{ flexGrow: 1 }}>
            {groupLabel}
          </Text>
          <Text size="3xs" color={alpha(theme.mutedForeground, 0.7)}>
            {String(group.terminalIds.length)}
          </Text>
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {group.terminalIds.map((terminalId) => (
          <SidebarTerminalRow
            key={terminalId}
            label={props.labelOf(terminalId)}
            active={terminalId === props.activeTerminalId}
            canOperate={props.canOperate}
            onActivate={() => props.onActivate(terminalId)}
            onClose={() => props.onClose(terminalId)}
            testId={`${props.testId}-tab-${terminalId}`}
          />
        ))}
      </div>
    </div>
  );
}

function SidebarTerminalRow(props: {
  label: string;
  active: boolean;
  canOperate: boolean;
  onActivate: () => void;
  onClose: () => void;
  testId: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={props.testId}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={props.onActivate}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        height: 24,
        paddingLeft: 6,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        cursor: "pointer",
        backgroundColor: props.active ? theme.accent : hovered ? alpha(theme.accent, 0.6) : "#00000000",
        flexShrink: 0,
      }}
    >
      <TabCloseButton
        visible={props.canOperate && hovered}
        label={`Close ${props.label}`}
        onClose={props.onClose}
        icon={<Icon name="square-terminal" size={12} color={props.active || hovered ? theme.foreground : theme.mutedForeground} />}
      />
      <Text size="xs" color={props.active || hovered ? theme.foreground : theme.mutedForeground} truncate style={{ flexGrow: 1 }}>
        {props.label}
      </Text>
    </div>
  );
}

/** apps/web/src/components/ui/panel-tab-close-button.tsx: the icon turns into an X while the tab is hovered. */
export function TabCloseButton(props: { visible: boolean; label: string; onClose: () => void; icon: ReactNode; testId?: string }) {
  const theme = useTheme();
  return (
    <div
      testId={props.testId}
      onClick={(event) => {
        void event;
        if (props.visible) props.onClose();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: 4,
        cursor: "pointer",
        ...(props.visible ? { hover: { backgroundColor: theme.muted } } : {}),
      }}
    >
      {props.visible ? <Icon name="x" size={12} color={theme.foreground} /> : props.icon}
    </div>
  );
}
