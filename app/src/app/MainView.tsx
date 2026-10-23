import { useAtom, useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";

import { environmentThreadShells, projectIndexAtom } from "../state/environment.ts";
import {
  detailsPanelOpenAtom,
  rightPanelOpenAtom,
  routeAtom,
  sidebarOpenAtom,
  terminalOpenAtom,
} from "../state/ui.ts";
import { ProjectGlyph } from "../sidebar/ProjectGlyph.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { LAYOUT, useTheme } from "../ui/theme.ts";
import { ChatView } from "../chat/ChatView.tsx";
import { DraftView } from "../chat/DraftView.tsx";
import { SettingsView } from "../settings/SettingsView.tsx";

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
      ) : (
        <>
          <MainHeader crumbs={<Text weight={500}>New thread</Text>} />
          <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
            <Text size="sm" color={theme.mutedForeground} style={{ opacity: 0.6 }}>
              Pick a thread to continue
            </Text>
          </div>
        </>
      )}
    </div>
  );
}

export function MainHeader({ crumbs }: { crumbs: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const [details, setDetails] = useAtom(detailsPanelOpenAtom);
  const [terminal, setTerminal] = useAtom(terminalOpenAtom);
  const [right, setRight] = useAtom(rightPanelOpenAtom);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: LAYOUT.topbar,
        paddingLeft: sidebarOpen ? 20 : 12,
        paddingRight: 12,
        gap: 12,
        flexShrink: 0,
      }}
    >
      {sidebarOpen ? null : <IconButton icon="panel-left" onClick={() => setSidebarOpen(true)} />}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1, minWidth: 0 }}>
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
