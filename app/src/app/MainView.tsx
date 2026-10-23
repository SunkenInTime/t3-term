import { useAtom, useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";

import { environmentThreadShells, projectIndexAtom } from "../state/environment.ts";
import {
  detailsPanelOpenAtom,
  rightPanelOpenAtom,
  routeAtom,
  sidebarOpenAtom,
  terminalOpenAtom,
  toggleSidebar,
} from "../state/ui.ts";
import { Tooltip } from "../ui/overlay.tsx";
import {
  titlebarContentLeft,
  titlebarControlSize,
  useMobileViewport,
  useSmallViewport,
  workspaceGutter,
} from "../ui/viewport.tsx";
import { ProjectGlyph } from "../sidebar/ProjectGlyph.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { LAYOUT, alpha, useTheme } from "../ui/theme.ts";
import { ChatView } from "../chat/ChatView.tsx";
import { DraftView, HomeView } from "../chat/DraftView.tsx";
import { SettingsView } from "../settings/SettingsView.tsx";
import { UsagePage } from "../usage/UsagePage.tsx";
import { PullRequestsPage } from "../pullRequests/PullRequestsPage.tsx";

export function MainView() {
  const theme = useTheme();
  const route = useAtomValue(routeAtom);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        height: "100%",
        backgroundColor: theme.background,
      }}
    >
      {route.kind === "thread" ? (
        <ChatView environmentId={route.environmentId} threadId={route.threadId} />
      ) : route.kind === "draft" ? (
        <DraftView environmentId={route.environmentId} projectId={route.projectId} />
      ) : route.kind === "settings" ? (
        <SettingsView page={route.page} />
      ) : route.kind === "usage" ? (
        <UsagePage />
      ) : route.kind === "pull-requests" ? (
        <PullRequestsPage />
      ) : (
        <HomeView />
      )}
    </div>
  );
}

/**
 * Where a page header starts its content. Web pads headers by --workspace-gutter (12,
 * 20 from `sm`) while the sidebar is docked; when it is collapsed, and always below
 * `md` where it is a sheet, the sidebar toggle floats at the window's left
 * (AppSidebarLayout SidebarControl, `position: fixed`) and headers start after it
 * (COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS).
 */
export function useHeaderInset(): {
  readonly paddingLeft: number;
  readonly gutter: number;
  /** ChatHeader / WorkspaceBreadcrumb `gap-2 sm:gap-3`. */
  readonly crumbGap: number;
  readonly toggle: ReactNode;
} {
  const sidebarOpen = useAtomValue(sidebarOpenAtom);
  const mobile = useMobileViewport();
  const small = useSmallViewport();
  const docked = sidebarOpen && !mobile;
  return {
    paddingLeft: docked ? workspaceGutter(small) : titlebarContentLeft(small),
    gutter: workspaceGutter(small),
    crumbGap: small ? 8 : 12,
    toggle: docked ? null : <HeaderSidebarToggle size={titlebarControlSize(small)} />,
  };
}

/** The floating SidebarTrigger. Its header must be `position: relative`. */
function HeaderSidebarToggle({ size }: { size: number }) {
  const theme = useTheme();
  return (
    <div style={{ position: "absolute", left: 12, top: (LAYOUT.topbar - size) / 2, display: "flex" }}>
      <Tooltip content="Toggle main sidebar">
        <IconButton icon="panel-left" size={size} color={alpha(theme.foreground, 0.8)} onClick={toggleSidebar} testId="sidebar-open" />
      </Tooltip>
    </div>
  );
}

export function MainHeader({ crumbs }: { crumbs: ReactNode }) {
  const [details, setDetails] = useAtom(detailsPanelOpenAtom);
  const [terminal, setTerminal] = useAtom(terminalOpenAtom);
  const [right, setRight] = useAtom(rightPanelOpenAtom);
  const inset = useHeaderInset();
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: LAYOUT.topbar,
        paddingLeft: inset.paddingLeft,
        paddingRight: 12,
        gap: 12,
        flexShrink: 0,
      }}
    >
      {inset.toggle}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: inset.crumbGap, flexGrow: 1, minWidth: 0 }}>
        {crumbs}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
        <IconButton icon="square-menu" pressed={details} onClick={() => setDetails(!details)} testId="toggle-details" />
        <IconButton icon="panel-bottom" pressed={terminal} onClick={() => setTerminal(!terminal)} testId="toggle-terminal" />
        <IconButton icon="panel-right" pressed={right} onClick={() => setRight(!right)} testId="toggle-right-panel" />
      </div>
    </div>
  );
}

export function ThreadCrumbs({ environmentId, threadId }: { environmentId: string; threadId: string }) {
  const theme = useTheme();
  const projects = useAtomValue(projectIndexAtom);
  const shell = useAtomValue(
    environmentThreadShells.threadShellAtom({ environmentId, threadId } as never),
  );
  const project = shell ? projects.get(`${environmentId}:${shell.projectId}`) : undefined;
  return (
    <>
      {project ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 }}>
          <ProjectGlyph project={project} size={14} />
          <Text weight={500} color={theme.mutedForeground} truncate>
            {project.title}
          </Text>
        </div>
      ) : null}
      {project ? (
        <Text weight={500} color={theme.mutedForeground} style={{ opacity: 0.7 }}>
          /
        </Text>
      ) : null}
      <Text weight={500} truncate>
        {shell?.title ?? ""}
      </Text>
    </>
  );
}
