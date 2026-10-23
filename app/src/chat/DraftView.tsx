// OWNER: palette/navigation agent (layout) with the composer agent (composer).
// The new-thread draft: header crumbs, then the hero headline above the composer,
// centered in the page (apps/web/src/components/ChatView.tsx draft hero layout,
// chat/DraftHeroHeadline.tsx). The "/" route (routes/_chat.index.tsx) opens a
// draft in the most recently active project, or shows NoProjectsHero.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useEffect } from "react";

import { MainHeader } from "../app/MainView.tsx";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentCatalog, environmentProjects, environmentThreadShells } from "../state/environment.ts";
import { routeAtom } from "../state/ui.ts";
import { sortProjectsByActivity, startNewThread } from "../palette/actions.ts";
import { ProjectGlyph } from "../sidebar/ProjectGlyph.tsx";
import { Text } from "../ui/primitives.tsx";
import { LAYOUT, useTheme } from "../ui/theme.ts";
import { Composer } from "./composer/Composer.tsx";
import { DraftHeroHeadline } from "./draft/DraftHeroHeadline.tsx";
import { NoActiveThreadState, NoProjectsHero } from "./draft/EmptyStates.tsx";

/**
 * Space the composer takes. The composer positions itself at the bottom of its
 * container (thread layout), so the draft gives it a box of its own height.
 */
const COMPOSER_SLOT_HEIGHT = 176;

export function DraftView({ environmentId, projectId }: { environmentId: EnvironmentId | null; projectId: ProjectId | null }) {
  const theme = useTheme();
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const project =
    environmentId !== null && projectId !== null
      ? (projects.find((candidate) => candidate.environmentId === environmentId && candidate.id === projectId) ?? null)
      : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
      <MainHeader
        crumbs={
          <>
            {project && project.isScratch !== true ? (
              <>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 }}>
                  <ProjectGlyph project={project} size={14} />
                  <Text weight={500} color={theme.mutedForeground} truncate>
                    {project.title}
                  </Text>
                </div>
                <Text weight={500} color={theme.mutedForeground} style={{ opacity: 0.7 }}>
                  /
                </Text>
              </>
            ) : null}
            <Text weight={500} truncate>
              New thread
            </Text>
          </>
        }
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flexGrow: 1,
          minHeight: 0,
          paddingLeft: LAYOUT.chatLanePadding,
          paddingRight: LAYOUT.chatLanePadding,
          // Lift the group a little above center, like web's hero.
          paddingBottom: 72,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", paddingBottom: 16 }}>
          <DraftHeroHeadline environmentId={environmentId} projectId={projectId} />
        </div>
        <div style={{ position: "relative", width: "100%", height: COMPOSER_SLOT_HEIGHT, flexShrink: 0 }}>
          <Composer target={{ kind: "draft", environmentId, projectId }} />
        </div>
      </div>
    </div>
  );
}

/** routes/_chat.index.tsx: start a draft in the most recent project, else the empty hero. */
export function HomeView() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const configsReady = useAtomValue(environmentProjects.projectConfigsReadyAtom);
  const mostRecent = sortProjectsByActivity(
    projects.filter((project) => project.isScratch !== true),
    threads,
  )[0];
  useEffect(() => {
    if (!mostRecent) return;
    // Only while still on "/": the user may have navigated meanwhile.
    if (appAtomRegistry.get(routeAtom).kind !== "home") return;
    startNewThread(scopeProjectRef(mostRecent.environmentId, mostRecent.id));
  }, [mostRecent?.environmentId, mostRecent?.id]);
  if (mostRecent) return null;
  // A pending environment cannot prove the workspace is empty.
  if (!catalog.isReady || !configsReady) return null;
  const primaryEnvironmentId = ([...catalog.entries.keys()][0] ?? null) as EnvironmentId | null;
  if (primaryEnvironmentId === null) return <NoActiveThreadState />;
  return <NoProjectsHero primaryEnvironmentId={primaryEnvironmentId} />;
}
