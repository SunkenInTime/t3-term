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
import { useSmallViewport } from "../ui/viewport.tsx";
import { composerTargetKey } from "../state/composer.ts";
import { ChatLane, useDetailsCardInline } from "./chatLane.tsx";
import { Composer } from "./composer/Composer.tsx";
import { ChatBannerLane } from "./ChatBannerLane.tsx";
import { DraftDetailsCard } from "./details/ThreadDetailsCard.tsx";
import { DraftHeroHeadline } from "./draft/DraftHeroHeadline.tsx";
import { NoActiveThreadState, NoProjectsHero } from "./draft/EmptyStates.tsx";

export function DraftView({ environmentId, projectId }: { environmentId: EnvironmentId | null; projectId: ProjectId | null }) {
  const theme = useTheme();
  const cardInline = useDetailsCardInline();
  const small = useSmallViewport();
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
                  {/* web ChatHeader BreadcrumbText: the project name stops at 160px. */}
                  <Text weight={500} color={theme.mutedForeground} truncate style={{ maxWidth: 160 }}>
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
      {/* The chat canvas: the hero and composer share the thread view's lane, so they
          clear the details card the same way (web renders drafts through ChatView). */}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, position: "relative" }}>
        {/* web draft hero: the composer stack (with its `h-4 sm:h-5` spacer) is centered in
            the canvas (`absolute inset-0 flex items-center`) and the headline hangs above it
            (`absolute inset-x-0 bottom-full pb-4`). Two equal flex spacers center the stack;
            the top one ends with the headline and lets it overflow upward. */}
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }}>
            <ChatLane cardInline={cardInline}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", paddingBottom: 16 }}>
                <DraftHeroHeadline environmentId={environmentId} projectId={projectId} />
              </div>
            </ChatLane>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <ChatLane cardInline={cardInline}>
              <Composer target={{ kind: "draft", environmentId, projectId }} layout="lane" />
              <div style={{ height: small ? 16 : 20, flexShrink: 0 }} />
            </ChatLane>
          </div>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }} />
        </div>
        {environmentId !== null && projectId !== null ? (
          <ChatBannerLane composerTargetKey={composerTargetKey({ kind: "draft", environmentId, projectId })} overlay />
        ) : null}
        {project && environmentId !== null && projectId !== null ? (
          <DraftDetailsCard
            environmentId={environmentId}
            projectId={projectId}
            draftKey={composerTargetKey({ kind: "draft", environmentId, projectId })}
          />
        ) : null}
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
