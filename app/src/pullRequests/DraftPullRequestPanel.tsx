// The pull request an Ask from its review guide keeps open beside the new draft. Web reopens it
// in the draft's right panel (PullRequestDetailPanel `startAsk` with `keepGuide`); t3-term drafts
// have no right panel, so this is a one-surface panel with web's tab strip look: the "#N" tab,
// then maximize and close. Further Asks from it write into this draft's composer, as they would
// from a thread's panel.
import { useAtomValue } from "@effect/atom-react";
import { useWindowSize } from "@gpuix/react";
import { useRef, useState } from "react";

import { ResizeHandle } from "../panels/RightPanel.tsx";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { draftPullRequestPaneAtom, type PullRequestSurface } from "../state/pullRequests.ts";
import {
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH_FRACTION,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_SIBLING_MIN_WIDTH,
} from "../state/rightPanel.ts";
import { sidebarOpenAtom } from "../state/ui.ts";
import { Icon } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { LAYOUT, RADIUS, useTheme } from "../ui/theme.ts";
import { sidebarWidthAtom } from "../ui/viewport.tsx";
import { PullRequestDetailView } from "./PullRequestDetailPanel.tsx";
import { MarkdownOverlayHost } from "../chat/markdown/overlays.tsx";

export function DraftPullRequestPanel({ draftKey }: { draftKey: string }) {
  const theme = useTheme();
  const pane = useAtomValue(draftPullRequestPaneAtom);
  const window = useWindowSize();
  const sidebarOpen = useAtomValue(sidebarOpenAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const [width, setWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [maximized, setMaximized] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  if (pane === null || pane.draftKey !== draftKey) return null;
  const rowWidth = window.width - (sidebarOpen ? sidebarWidth : 0);
  const maxWidth = Math.max(
    RIGHT_PANEL_MIN_WIDTH,
    Math.min(Math.floor(window.width * RIGHT_PANEL_MAX_WIDTH_FRACTION), Math.floor(rowWidth) - RIGHT_PANEL_SIBLING_MIN_WIDTH),
  );
  const shownWidth = Math.min(Math.max(width, RIGHT_PANEL_MIN_WIDTH), maxWidth);
  const { environmentId, reference } = pane;
  const surface: PullRequestSurface = {
    id: `draft:${draftKey}:${reference.projectId}:${reference.repository}#${reference.number}`,
    environmentId,
    projectId: reference.projectId,
    repository: reference.repository,
    number: reference.number,
    ...(reference.host ? { host: reference.host } : {}),
    detailTab: pane.tab,
  };
  const close = () => appAtomRegistry.set(draftPullRequestPaneAtom, null);
  return (
    <div
      testId="draft-pr-panel"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        backgroundColor: theme.background,
        borderLeftWidth: 1,
        borderColor: theme.border,
        ...(maximized ? { flexGrow: 1, minWidth: 0 } : { width: shownWidth, flexShrink: 0 }),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: LAYOUT.topbar,
          flexShrink: 0,
          paddingLeft: 8,
          paddingRight: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexGrow: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              height: 24,
              paddingLeft: 6,
              paddingRight: 8,
              borderRadius: RADIUS.sm,
              backgroundColor: theme.accent,
            }}
          >
            <Icon name="git-pull-request" size={12} color={theme.foreground} />
            <Text size="xs">{`#${reference.number}`}</Text>
          </div>
        </div>
        <Tooltip content={maximized ? "Restore panel size" : "Maximize panel"}>
          <div style={{ display: "flex" }}>
            <IconButton
              icon={maximized ? "minimize-2" : "maximize-2"}
              onClick={() => setMaximized((value) => !value)}
              testId="draft-pr-panel-maximize"
            />
          </div>
        </Tooltip>
        <Tooltip content="Close right panel">
          <div style={{ display: "flex" }}>
            <IconButton icon="panel-right" pressed onClick={close} testId="draft-pr-panel-close" />
          </div>
        </Tooltip>
      </div>
      <PullRequestDetailView
        key={surface.id}
        environmentId={environmentId}
        surface={surface}
        listEntry={null}
        refreshToken={0}
        context="thread"
        attachTarget={draftKey}
        onTabChange={(tab) => appAtomRegistry.set(draftPullRequestPaneAtom, { ...pane, tab })}
        onSelectPullRequest={(next) => appAtomRegistry.set(draftPullRequestPaneAtom, { ...pane, reference: next, tab: "summary" })}
      />
      {maximized ? null : (
        <ResizeHandle
          onDragStart={(x) => {
            drag.current = { startX: x, startWidth: shownWidth };
          }}
          onDrag={(x) => {
            const state = drag.current;
            if (!state) return;
            setWidth(Math.min(Math.max(state.startWidth + (state.startX - x), RIGHT_PANEL_MIN_WIDTH), maxWidth));
          }}
          onDragEnd={() => {
            drag.current = null;
          }}
        />
      )}
      {/* A draft has no timeline, whose host would show markdown's menus and image viewer. */}
      <MarkdownOverlayHost />
    </div>
  );
}
