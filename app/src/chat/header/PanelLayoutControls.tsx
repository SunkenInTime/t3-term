// Port of apps/web/src/components/chat/PanelLayoutControls.tsx: the details,
// terminal and right-panel toggles, and the maximize toggle that joins them while
// the right panel is open.
//
// Web pins these to the window's top-right corner (`position: fixed`) so that, with
// the right panel open, they sit over the panel's header and the chat header keeps
// only the details toggle. A deferred window-filling <anchored> layer is gpuix's
// equivalent; the right panel's header leaves room for them at its right end.
import { useAtom, useAtomValue } from "@effect/atom-react";
import { DismissableLayer, useWindowSize } from "@gpuix/react";
import { FloatingLayer } from "@gpuix/react/floating";
import type { ReactElement, ReactNode } from "react";

import { cardSurfaceStyle } from "../details/ThreadDetailsCard.tsx";

import {
  detailsPanelOpenAtom,
  rightPanelMaximizedAtom,
  rightPanelOpenAtom,
  terminalOpenAtom,
} from "../../state/ui.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { LAYOUT, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { detailsPopoverOpenAtom, detailsPresentationAtom } from "../../state/git.ts";

/** Width the right panel's header should keep clear at its right end while these sit over it. */
export const TITLEBAR_CONTROLS_RESERVED_WIDTH = 12 + 4 * 28 + 3 * 4 + 8;

export interface PanelShortcutLabels {
  readonly details: string | null;
  readonly terminal: string | null;
  readonly rightPanel: string | null;
}

/** Toggle variant="ghost" size="sm": 28×28, radius 10, pressed fill, icon at 80%. */
export function PanelToggle({
  icon,
  pressed,
  onToggle,
  disabled,
  tooltip,
  testId,
}: {
  icon: IconName;
  pressed: boolean;
  onToggle: () => void;
  disabled?: boolean;
  tooltip: string;
  testId: string;
}) {
  const theme = useTheme();
  const pressedBg = theme.accent;
  const button: ReactElement = (
    <div
      testId={testId}
      onClick={disabled ? undefined : onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: RADIUS.lg,
        flexShrink: 0,
        backgroundColor: pressed ? pressedBg : "#00000000",
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: pressed ? pressedBg : theme.accent } }),
      }}
    >
      <Icon name={icon} size={16} color={disabled ? theme.mutedForeground : alpha(theme.foreground, 0.8)} />
    </div>
  );
  return <Tooltip content={tooltip}>{button}</Tooltip>;
}

function withShortcut(label: string, shortcut: string | null): string {
  return shortcut ? `${label} (${shortcut})` : label;
}

export function PanelLayoutControls({
  showDetails = true,
  showTerminal = true,
  showRightPanel = true,
  available,
  shortcuts,
  detailsPopover,
}: {
  /** The details card content, shown under the toggle when the canvas is too narrow for it. */
  detailsPopover?: ReactNode;
  showDetails?: boolean;
  showTerminal?: boolean;
  showRightPanel?: boolean;
  /** Terminal and right panel need a project, like web. */
  available: boolean;
  shortcuts: PanelShortcutLabels;
}) {
  const [detailsOpen, setDetailsOpen] = useAtom(detailsPanelOpenAtom);
  const [popoverOpen, setPopoverOpen] = useAtom(detailsPopoverOpenAtom);
  const presentation = useAtomValue(detailsPresentationAtom);
  const [terminalOpen, setTerminalOpen] = useAtom(terminalOpenAtom);
  const [rightOpen, setRightOpen] = useAtom(rightPanelOpenAtom);
  const detailsPressed = presentation === "popover" ? popoverOpen : detailsOpen;
  const theme = useTheme();
  const windowHeight = useWindowSize().height;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, height: "100%" }}>
      {showDetails ? (
        <div style={{ display: "flex", position: "relative", alignItems: "center" }}>
          <PanelToggle
            icon="square-menu"
            pressed={detailsPressed}
            onToggle={() =>
              presentation === "popover" ? setPopoverOpen(!popoverOpen) : setDetailsOpen(!detailsOpen)
            }
            tooltip={withShortcut("Toggle thread details", shortcuts.details)}
            testId="toggle-details"
          />
          {presentation === "popover" && popoverOpen && detailsPopover ? (
            <DismissableLayer onEscapeKeyDown={() => setPopoverOpen(false)}>
              <FloatingLayer
                side="bottom"
                align="end"
                sideOffset={12}
                alignOffset={4}
                testId="thread-details-popover"
                onMouseDownOutside={() => setPopoverOpen(false)}
                style={{
                  ...cardSurfaceStyle(theme),
                  backgroundColor: theme.appearance === "dark" ? "#121212" : theme.popover,
                  display: "flex",
                  flexDirection: "column",
                  width: LAYOUT.detailsCardWidth,
                  maxHeight: Math.max(200, windowHeight - 104),
                  overflowY: "scroll",
                  scrollbarColor: theme.scrollbar,
                  boxShadow: { offsetX: 0, offsetY: 16, blurRadius: 40, spreadRadius: -18, color: "#0000008c" },
                }}
              >
                {detailsPopover}
              </FloatingLayer>
            </DismissableLayer>
          ) : null}
        </div>
      ) : null}
      {showTerminal ? (
        <PanelToggle
          icon="panel-bottom"
          pressed={terminalOpen}
          disabled={!available}
          onToggle={() => setTerminalOpen(!terminalOpen)}
          tooltip={available ? withShortcut("Toggle terminal drawer", shortcuts.terminal) : "Terminal drawer is unavailable"}
          testId="toggle-terminal"
        />
      ) : null}
      {showRightPanel ? (
        <PanelToggle
          icon="panel-right"
          pressed={rightOpen}
          disabled={!available}
          onToggle={() => setRightOpen(!rightOpen)}
          tooltip={available ? withShortcut("Toggle right panel", shortcuts.rightPanel) : "Right panel is unavailable"}
          testId="toggle-right-panel"
        />
      ) : null}
    </div>
  );
}

/** RightPanelMaximizeControl. */
export function RightPanelMaximizeControl() {
  const [maximized, setMaximized] = useAtom(rightPanelMaximizedAtom);
  const label = maximized ? "Restore panel size" : "Maximize panel";
  return (
    <PanelToggle
      icon={maximized ? "minimize-2" : "maximize-2"}
      pressed={maximized}
      onToggle={() => setMaximized(!maximized)}
      tooltip={label}
      testId="toggle-right-panel-maximize"
    />
  );
}

/**
 * WorkspaceTitlebarControls while the right panel is open: maximize, terminal and
 * right-panel toggles pinned to the window's top-right, over the panel header.
 */
export function WorkspaceTitlebarControls({
  available,
  shortcuts,
}: {
  available: boolean;
  shortcuts: PanelShortcutLabels;
}) {
  return (
    <anchored fill="window" deferred priority={0} occlude={false} style={{ backgroundColor: "#00000000", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 12,
          height: LAYOUT.topbar,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          pointerEvents: "auto",
        }}
      >
        <RightPanelMaximizeControl />
        <PanelLayoutControls available={available} shortcuts={shortcuts} showDetails={false} />
      </div>
    </anchored>
  );
}
