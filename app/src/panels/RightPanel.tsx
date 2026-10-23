// The right panel beside the chat column: port of ChatRightPanel,
// RightPanelTabs and PreviewPanelShell (apps/web/src/components/chat/ChatRightPanel.tsx,
// RightPanelTabs.tsx, preview/PreviewPanelShell.tsx, hooks/usePreviewPanelInlineSize.ts).
// The header/git agent owns the Diff and Pull request surfaces it hosts.
import { useAtom, useAtomValue } from "@effect/atom-react";
import { useGpuixRequired, useWindowSize, type KeyEvent } from "@gpuix/react";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { getTerminalLabel, resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import {
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  type EnvironmentId,
  type ProjectId,
  type PullRequestRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { environmentThreadShells } from "../state/environment.ts";
import {
  lastSyncedSharedKind,
  RIGHT_PANEL_MAX_WIDTH_FRACTION,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_SIBLING_MIN_WIDTH,
  rightPanelActions,
  rightPanelAddMenuOpenAtom,
  rightPanelThreadStateAtom,
  rightPanelWidthAtom,
  setRightPanelWidth,
  sharedKindOf,
  threadKeyOf,
  type RightPanelSurface,
} from "../state/rightPanel.ts";
import { selectThreadSessions, useEnvironmentScope, useTerminalMetadata, useThreadTerminalContext } from "../state/terminal.ts";
import { rightPanelMaximizedAtom, rightPanelSurfaceAtom, sidebarOpenAtom } from "../state/ui.ts";
import { selectedPullRequestAtom } from "../state/gitPullRequests.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Menu, MenuItem, MenuSeparator, Tooltip } from "../ui/overlay.tsx";
import { IconButton, Kbd, Text } from "../ui/primitives.tsx";
import { alpha, LAYOUT, RADIUS, useTheme } from "../ui/theme.ts";
import { TabCloseButton } from "../terminal/ThreadTerminalDrawer.tsx";
import { DiffSurface } from "./diff/DiffSurface.tsx";
import { FileEntryIcon } from "./files/FileEntryIcon.tsx";
import { FilesSurface } from "./files/FilesSurface.tsx";
import { PullRequestSurface } from "./pr/PullRequestSurface.tsx";
import { addTerminalSurface, TerminalSurface } from "./terminal/TerminalSurface.tsx";

const SURFACE_DISABLED_REASONS = {
  browser: "Browser previews are only available in the T3 Code desktop app.",
  terminal: "Terminal surfaces are only available from a project thread.",
  files: "Files are only available when a project is open.",
  diff: "Diff is only available for server threads in Git repositories.",
  pullRequest: "This thread's branch has no pull request yet.",
  pullRequests: "No linked pull requests are available for this thread.",
  // The web client streams simulators through its device hub; t3-term has no video surface.
  device: "Device mirroring is not available in t3-term.",
} as const;

const SURFACE_UNAVAILABLE_HINTS = {
  browser: "Only available in the desktop app.",
  terminal: "Available when a project is open.",
  files: "Available when a project is open.",
  diff: "Available for Git repositories.",
  pullRequest: "No pull request on this branch yet.",
  pullRequests: "No linked pull requests available.",
  device: "Not available in t3-term.",
} as const;

interface SurfaceAction {
  readonly key: keyof typeof SURFACE_DISABLED_REASONS;
  readonly label: string;
  readonly icon: IconName;
  readonly shortcut: string;
  readonly available: boolean;
  readonly onClick: () => void;
}

/** Room for the pinned titlebar controls: three 28px toggles, gaps and the 12px inset. */
const TITLEBAR_CONTROLS_INSET = 140;

const STRETCH = { display: "flex", flexDirection: "column", alignItems: "stretch", alignSelf: "stretch" } as const;

function rightPanelMaxWidth(viewportWidth: number, rowWidth: number): number {
  const fractionCap = Math.floor(viewportWidth * RIGHT_PANEL_MAX_WIDTH_FRACTION);
  const rowCap = Math.floor(rowWidth) - RIGHT_PANEL_SIBLING_MIN_WIDTH;
  return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(fractionCap, rowCap));
}

function surfaceTitle(surface: RightPanelSurface, terminalLabels: ReadonlyMap<string, string>): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(Math.max(surface.relativePath.lastIndexOf("/"), surface.relativePath.lastIndexOf("\\")) + 1);
    case "terminal":
      return terminalLabels.get(surface.activeTerminalId) ?? getTerminalLabel(surface.activeTerminalId);
    case "pull-request":
      return `#${surface.number}`;
    case "pull-requests":
      return "Pull requests";
    case "device":
      return surface.title ?? "Device";
    case "preview":
      return "Browser";
  }
}

function surfaceIcon(surface: RightPanelSurface): IconName {
  switch (surface.kind) {
    case "diff":
      return "file-diff";
    case "files":
      return "files";
    case "file":
      return "file";
    case "terminal":
      return "square-terminal";
    case "pull-request":
      return "git-pull-request";
    case "pull-requests":
      return "link-2";
    case "device":
      return "smartphone";
    case "preview":
      return "globe";
  }
}

export function RightPanel({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const theme = useTheme();
  const threadKey = threadKeyOf(environmentId, threadId);
  const state = useAtomValue(rightPanelThreadStateAtom(threadKey));
  const storedWidth = useAtomValue(rightPanelWidthAtom(threadKey));
  const maximized = useAtomValue(rightPanelMaximizedAtom);
  const selectedPullRequest = useAtomValue(selectedPullRequestAtom(threadKey));
  const requestedKind = useAtomValue(rightPanelSurfaceAtom);
  const sidebarOpen = useAtomValue(sidebarOpenAtom);
  const shell = useAtomValue(environmentThreadShells.threadShellAtom({ environmentId, threadId } as never));
  const terminalContext = useThreadTerminalContext(environmentId, threadId);
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const canReadTerminal = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  const metadata = useTerminalMetadata(environmentId, canReadTerminal);
  const window = useWindowSize();
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useAtom(rightPanelAddMenuOpenAtom);
  const renderer = useGpuixRequired();
  const tabElements = useRef(new Map<string, number>());
  /** SortableTabList: a dragged tab takes the slot whose center the pointer passed. */
  const dragTabTo = (surfaceId: string, pointerX: number) => {
    // The slot after removal: how many other tabs sit left of the pointer.
    let toIndex = 0;
    for (const surface of state.surfaces) {
      if (surface.id === surfaceId) continue;
      const elementId = tabElements.current.get(surface.id);
      const bounds = elementId === undefined ? null : renderer.getElementBounds?.(elementId);
      if (bounds && pointerX > bounds.x + bounds.width / 2) toIndex += 1;
    }
    const fromIndex = state.surfaces.findIndex((surface) => surface.id === surfaceId);
    if (fromIndex >= 0 && toIndex !== fromIndex) rightPanelActions.move(threadKey, surfaceId, toIndex);
  };

  const rowWidth = window.width - (sidebarOpen ? LAYOUT.sidebarWidth : 0);
  const maxWidth = rightPanelMaxWidth(window.width, rowWidth);
  const width = Math.min(Math.max(dragWidth ?? storedWidth, RIGHT_PANEL_MIN_WIDTH), maxWidth);

  // Requests other areas write to the shared kind atom ("Open diff", a PR link).
  useEffect(() => {
    if (requestedKind === lastSyncedSharedKind.current) return;
    lastSyncedSharedKind.current = requestedKind;
    const active = state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
    if (sharedKindOf(active) === requestedKind) return;
    if (requestedKind === "files" || requestedKind === "diff") {
      rightPanelActions.open(threadKey, requestedKind);
    } else if (requestedKind === "terminal") {
      const existing = state.surfaces.find((surface) => surface.kind === "terminal");
      if (existing) rightPanelActions.activate(threadKey, existing.id);
      else if (terminalContext) addTerminalSurface(terminalContext, sessionsIds());
    } else if (requestedKind === "pull-request") {
      openSelectedPullRequest();
    }
  }, [requestedKind]);

  // openPullRequestSurface names the PR in selectedPullRequestAtom; it gets its own "#N" tab.
  function openSelectedPullRequest() {
    const reference = appAtomRegistry.get(selectedPullRequestAtom(threadKey));
    if (reference) {
      rightPanelActions.openPullRequest(threadKey, {
        projectId: reference.projectId,
        ...(reference.host ? { host: reference.host } : {}),
        repository: reference.repository,
        number: reference.number,
      });
      return;
    }
    const existing = state.surfaces.find((surface) => surface.kind === "pull-request" || surface.kind === "pull-requests");
    if (existing) rightPanelActions.activate(threadKey, existing.id);
    else rightPanelActions.open(threadKey, "pull-requests");
  }
  useEffect(() => {
    if (selectedPullRequest !== null && lastSyncedSharedKind.current === "pull-request") openSelectedPullRequest();
  }, [selectedPullRequest?.number, selectedPullRequest?.repository]);

  // Switching threads shows that thread's own active kind.
  useEffect(() => {
    const kind = sharedKindOf(state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null);
    if (kind !== null) lastSyncedSharedKind.current = kind;
  }, [threadKey]);

  const sessions = selectThreadSessions(metadata, environmentId, threadId);
  function sessionsIds() {
    return sessions?.map((session) => session.target.terminalId) ?? null;
  }
  const terminalLabels = new Map<string, string>();
  for (const session of sessions ?? []) {
    terminalLabels.set(session.target.terminalId, resolveTerminalSessionLabel(session.target.terminalId, session.state.summary));
  }

  const visiblePullRequests = shell ? visibleThreadPullRequests(shell.pullRequests) : [];
  const hasProject = terminalContext !== null;
  const actions: SurfaceAction[] = [
    { key: "browser", label: "Browser", icon: "globe", shortcut: "B", available: false, onClick: () => undefined },
    {
      key: "terminal",
      label: "Terminal",
      icon: "square-terminal",
      shortcut: "T",
      available: hasProject && canOperateTerminal,
      onClick: () => {
        if (terminalContext) addTerminalSurface(terminalContext, sessionsIds());
      },
    },
    { key: "files", label: "Files", icon: "files", shortcut: "F", available: hasProject, onClick: () => rightPanelActions.open(threadKey, "files") },
    { key: "diff", label: "Diff", icon: "file-diff", shortcut: "D", available: shell !== null, onClick: () => rightPanelActions.open(threadKey, "diff") },
    {
      key: "pullRequest",
      label: "Pull request",
      icon: "git-pull-request",
      shortcut: "P",
      available: Boolean(shell?.branchPullRequest ?? shell?.linkedPullRequest),
      onClick: () => rightPanelActions.open(threadKey, "pull-requests"),
    },
    {
      key: "pullRequests",
      label: "Linked pull requests",
      icon: "link-2",
      shortcut: "L",
      available: visiblePullRequests.length > 0,
      onClick: () => rightPanelActions.open(threadKey, "pull-requests"),
    },
    { key: "device", label: "Device", icon: "smartphone", shortcut: "M", available: false, onClick: () => undefined },
  ];

  const active = state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;

  return (
    <div
      testId="right-panel"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        backgroundColor: theme.background,
        ...(maximized
          ? { width: "100%", flexShrink: 0 }
          : { width, flexShrink: 0, borderLeftWidth: 1, borderColor: theme.border }),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: LAYOUT.topbar,
          minHeight: LAYOUT.topbar,
          flexShrink: 0,
          paddingLeft: 8,
          // The chat header pins maximize, terminal and right-panel toggles over
          // this corner (web: pr-28 beside WorkspaceTitlebarControls).
          paddingRight: TITLEBAR_CONTROLS_INSET,
          userSelect: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            flexGrow: 1,
            minWidth: 0,
            height: "100%",
            overflowX: "scroll",
            scrollbarWidth: 0,
          }}
        >
          {state.surfaces.map((surface, index) => (
            <RightPanelTab
              key={surface.id}
              surface={surface}
              title={surfaceTitle(surface, terminalLabels)}
              active={surface.id === state.activeSurfaceId}
              isLast={index === state.surfaces.length - 1}
              isOnly={state.surfaces.length === 1}
              onActivate={() => {
                if (surface.kind === "pull-request") {
                  appAtomRegistry.set(selectedPullRequestAtom(threadKey), {
                    projectId: surface.projectId as ProjectId,
                    ...(surface.host ? { host: surface.host } : {}),
                    repository: surface.repository,
                    number: surface.number,
                  } as PullRequestRef);
                }
                rightPanelActions.activate(threadKey, surface.id);
              }}
              onClose={() => rightPanelActions.close(threadKey, surface.id)}
              onCloseOthers={() => rightPanelActions.closeOthers(threadKey, surface.id)}
              onCloseToRight={() => rightPanelActions.closeToRight(threadKey, surface.id)}
              onCloseAll={() => rightPanelActions.closeAll(threadKey)}
              onElement={(elementId) => {
                if (elementId === null) tabElements.current.delete(surface.id);
                else tabElements.current.set(surface.id, elementId);
              }}
              onDragTo={(pointerX) => dragTabTo(surface.id, pointerX)}
            />
          ))}
          <Menu
            open={addMenuOpen}
            onOpenChange={setAddMenuOpen}
            align="start"
            sideOffset={6}
            minWidth={0}
            testId="right-panel-add-menu"
            trigger={({ toggle }) => (
              <Tooltip content="Add panel surface">
                <IconButton
                  icon="plus"
                  size={24}
                  iconSize={14}
                  onClick={toggle}
                  pressed={addMenuOpen}
                  testId="right-panel-add"
                />
              </Tooltip>
            )}
          >
            <AddSurfaceMenuItems actions={actions} />
          </Menu>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
        {active === null ? (
          <SurfaceLauncher actions={actions} />
        ) : (
          <SurfaceContent environmentId={environmentId} threadId={threadId} surface={active} />
        )}
      </div>
      {maximized ? null : (
        <ResizeHandle
          onDragStart={(x) => {
            drag.current = { startX: x, startWidth: width };
          }}
          onDrag={(x) => {
            const state = drag.current;
            if (!state) return;
            setDragWidth(Math.min(Math.max(state.startWidth + (state.startX - x), RIGHT_PANEL_MIN_WIDTH), maxWidth));
          }}
          onDragEnd={() => {
            drag.current = null;
            setDragWidth((current) => {
              if (current !== null) setRightPanelWidth(threadKey, current);
              return null;
            });
          }}
        />
      )}
    </div>
  );
}

function SurfaceContent({
  environmentId,
  threadId,
  surface,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  surface: RightPanelSurface;
}) {
  switch (surface.kind) {
    case "terminal":
      return <TerminalSurface key={surface.id} environmentId={environmentId} threadId={threadId} surface={surface} />;
    case "files":
    case "file":
      return <FilesSurface environmentId={environmentId} threadId={threadId} surfaceId={surface.id} />;
    case "diff":
      return <DiffSurface environmentId={environmentId} threadId={threadId} />;
    case "pull-request":
    case "pull-requests":
      return <PullRequestSurface environmentId={environmentId} threadId={threadId} />;
    case "preview":
      return <UnavailableSurface icon="globe" title="Browser" description={SURFACE_DISABLED_REASONS.browser} />;
    case "device":
      return <UnavailableSurface icon="smartphone" title="Device" description={SURFACE_DISABLED_REASONS.device} />;
  }
}

function UnavailableSurface({ icon, title, description }: { icon: IconName; title: string; description: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }}>
      <Icon name={icon} size={20} color={theme.mutedForeground} />
      <Text weight={500}>{title}</Text>
      <Text size="xs" color={theme.mutedForeground} style={{ textAlign: "center", maxWidth: 320 }}>
        {description}
      </Text>
    </div>
  );
}

/** RightPanelEmptyState: "Open a surface", letter shortcuts and arrow keys. */
function SurfaceLauncher({ actions }: { actions: readonly SurfaceAction[] }) {
  const theme = useTheme();
  const [highlight, setHighlight] = useState(-1);
  const available = actions.filter((action) => action.available);
  const highlightIndex = available.length === 0 ? -1 : Math.min(highlight, available.length - 1);
  const onKeyDown = (event: KeyEvent) => {
    const mods = event.modifiers;
    if (mods?.ctrl || mods?.cmd || mods?.alt) return;
    const key = (event.key ?? "").toLowerCase();
    const byShortcut = available.find((action) => action.shortcut.toLowerCase() === key);
    if (byShortcut) {
      event.preventDefault();
      event.stopPropagation();
      byShortcut.onClick();
      return;
    }
    if (available.length === 0) return;
    if (key === "down" || key === "right") {
      event.preventDefault();
      setHighlight((highlightIndex + 1) % available.length);
    } else if (key === "up" || key === "left") {
      event.preventDefault();
      setHighlight(highlightIndex === -1 ? available.length - 1 : (highlightIndex - 1 + available.length) % available.length);
    } else if (key === "enter") {
      const action = available[highlightIndex];
      if (action) {
        event.preventDefault();
        action.onClick();
      }
    }
  };
  return (
    <div
      testId="right-panel-launcher"
      tabIndex={0}
      autoFocus
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: 24,
        paddingRight: 24,
        paddingBottom: LAYOUT.topbar,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 320, paddingTop: 24, paddingBottom: 24 }}>
        <Text weight={500} style={{ textAlign: "center", marginBottom: 12 }}>
          Open a surface
        </Text>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {actions.map((action) => {
            const index = available.indexOf(action);
            const highlighted = index !== -1 && index === highlightIndex;
            const row = (
              <div
                key={action.label}
                testId={`right-panel-launcher-${action.key}`}
                onClick={action.available ? action.onClick : undefined}
                onMouseEnter={() => {
                  if (action.available) setHighlight(index);
                }}
                onMouseLeave={() => setHighlight((current) => (current === index ? -1 : current))}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  height: 32,
                  paddingLeft: 10,
                  paddingRight: 10,
                  borderRadius: RADIUS.md,
                  cursor: action.available ? "pointer" : "default",
                  opacity: action.available ? 1 : 0.5,
                  backgroundColor: highlighted ? alpha(theme.accent, 0.6) : "#00000000",
                  flexShrink: 0,
                }}
              >
                <Icon name={action.icon} size={16} color={theme.foreground} />
                <Text truncate style={{ flexGrow: 1 }}>
                  {action.label}
                </Text>
                <Kbd>{action.shortcut}</Kbd>
              </div>
            );
            return action.available ? (
              row
            ) : (
              <Tooltip key={action.label} content={SURFACE_UNAVAILABLE_HINTS[action.key]} side="top" rootStyle={STRETCH}>
                {row}
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AddSurfaceMenuItems({ actions }: { actions: readonly SurfaceAction[] }) {
  const theme = useTheme();
  return (
    <>
      {actions.map((action) => {
        const item = (
          <MenuItem
            key={action.label}
            icon={action.icon}
            disabled={!action.available}
            onSelect={action.onClick}
            testId={`right-panel-add-${action.key}`}
            trailing={
              <Text size="xs" color={alpha(theme.mutedForeground, 0.72)} style={{ marginLeft: 16 }}>
                {action.shortcut}
              </Text>
            }
          >
            {action.label}
          </MenuItem>
        );
        return action.available ? (
          item
        ) : (
          <Tooltip key={action.label} content={SURFACE_DISABLED_REASONS[action.key]} side="right" rootStyle={STRETCH}>
            <div style={{ display: "flex", flexDirection: "column" }}>{item}</div>
          </Tooltip>
        );
      })}
    </>
  );
}

function RightPanelTab(props: {
  surface: RightPanelSurface;
  title: string;
  active: boolean;
  isLast: boolean;
  isOnly: boolean;
  onActivate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseAll: () => void;
  onElement: (elementId: number | null) => void;
  onDragTo: (pointerX: number) => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const drag = useRef<{ startX: number; dragging: boolean } | null>(null);
  const color = props.active || hovered ? theme.foreground : theme.mutedForeground;
  const tab = (
    <div
      ref={(instance: { id: number } | null) => props.onElement(instance?.id ?? null)}
      testId={`right-panel-tab-${props.surface.id}`}
      onMouseDown={(event) => {
        if (event.button === 0) drag.current = { startX: event.x ?? 0, dragging: false };
      }}
      onMouseMove={(event) => {
        const state = drag.current;
        if (!state) return;
        // PointerSensor activationConstraint: { distance: 6 }.
        if (!state.dragging && Math.abs((event.x ?? 0) - state.startX) < 6) return;
        state.dragging = true;
        props.onDragTo(event.x ?? 0);
      }}
      onMouseUp={() => {
        drag.current = null;
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={props.onActivate}
      onAuxClick={(event) => {
        if (event.isRightClick) setMenuOpen(true);
        else props.onClose();
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        height: 24,
        maxWidth: 144,
        flexShrink: 0,
        paddingLeft: 6,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        cursor: "pointer",
        backgroundColor: props.active ? theme.accent : hovered ? alpha(theme.accent, 0.6) : "#00000000",
      }}
    >
      <TabCloseButton
        visible={hovered}
        label={`Close ${props.title}`}
        onClose={props.onClose}
        icon={
          props.surface.kind === "file" ? (
            <FileEntryIcon pathValue={props.surface.relativePath} kind="file" size={12} />
          ) : (
            <Icon name={surfaceIcon(props.surface)} size={12} color={color} />
          )
        }
        testId={`right-panel-tab-close-${props.surface.id}`}
      />
      <Text size="xs" color={color} truncate>
        {props.title}
      </Text>
    </div>
  );
  return (
    <Menu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      align="start"
      trigger={() => <Tooltip content={props.title}>{tab}</Tooltip>}
    >
      <MenuItem onSelect={props.onClose}>Close</MenuItem>
      <MenuItem onSelect={props.onCloseOthers} disabled={props.isOnly}>
        Close others
      </MenuItem>
      <MenuItem onSelect={props.onCloseToRight} disabled={props.isLast}>
        Close to the right
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={props.onCloseAll}>Close all</MenuItem>
    </Menu>
  );
}

/** RightPanelResizeHandle: an 8px grab strip over the left border. */
function ResizeHandle(props: { onDragStart: (x: number) => void; onDrag: (x: number) => void; onDragEnd: () => void }) {
  const theme = useTheme();
  const [state, setState] = useState<"idle" | "hover" | "drag">("idle");
  return (
    <div
      testId="right-panel-resize"
      onMouseEnter={() => setState((current) => (current === "drag" ? current : "hover"))}
      onMouseLeave={() => setState((current) => (current === "drag" ? current : "idle"))}
      onMouseDown={(event) => {
        setState("drag");
        props.onDragStart(event.x ?? 0);
      }}
      onMouseMove={(event) => {
        if (state === "drag") props.onDrag(event.x ?? 0);
      }}
      onMouseUp={() => {
        setState("idle");
        props.onDragEnd();
      }}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: -4,
        width: 8,
        cursor: "col-resize",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 1,
          height: "100%",
          pointerEvents: "none",
          backgroundColor: state === "drag" ? alpha(theme.primary, 0.6) : state === "hover" ? theme.border : "#00000000",
        }}
      />
    </div>
  );
}

