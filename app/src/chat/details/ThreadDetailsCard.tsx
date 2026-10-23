// Port of apps/web/src/components/chat/ThreadDetailsPanel.tsx + ThreadDetailsCard.tsx:
// the 280-wide card floating at the top-right of the chat canvas. It falls back
// to a popover under the header toggle when the canvas cannot fit it beside a
// 640px chat lane, and drops rows (full → compact → essential) when it is too short.
import { useAtomValue } from "@effect/atom-react";
import type { EventPayload } from "@gpuix/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useEffect, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerDraftAtom } from "../../state/composer.ts";
import { environmentThreadShells, projectIndexAtom } from "../../state/environment.ts";
import {
  detailsCardRectAtom,
  detailsPopoverOpenAtom,
  detailsPresentationAtom,
  vcsEnvironment,
} from "../../state/git.ts";
import { detailsPanelOpenAtom } from "../../state/ui.ts";
import { LAYOUT, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { BranchRow } from "./BranchRow.tsx";
import { DetailsSection } from "./detailsControls.tsx";
import { GitActionsControl } from "./GitActionsControl.tsx";
import { ThreadAutomationsSection } from "./ThreadAutomationsSection.tsx";
import { ThreadDetailsPrSection } from "./ThreadDetailsPrSection.tsx";
import { ThreadRelationshipsSection } from "./ThreadRelationshipsSection.tsx";
import { OpenInRow, ProjectScriptsRow, RunContextRow } from "./WorkspaceRows.tsx";

export type DetailsDensity = "full" | "compact" | "essential";

const CARD_GAP = 12;
const CARD_WIDTH = LAYOUT.detailsCardWidth;
const DETAILS_CARD_CLEARANCE = 32;
const MIN_CHAT_WIDTH = 640;

/** threadDetailsCardLayout.ts resolveThreadDetailsCardLayout without the preview mini player. */
function resolvePlacement(container: { width: number; height: number }) {
  const x = container.width - CARD_WIDTH - CARD_GAP;
  if (x - DETAILS_CARD_CLEARANCE - LAYOUT.chatLanePadding < MIN_CHAT_WIDTH) return null;
  const height = container.height - CARD_GAP * 2;
  if (height < 160) return null;
  return { x, y: CARD_GAP, width: CARD_WIDTH, height };
}

function resolveDensity(height: number, content: { full: number; compact: number }): DetailsDensity {
  if (content.full === 0 || content.full <= height) return "full";
  if (content.compact === 0 || content.compact <= height) return "compact";
  return "essential";
}

export function cardSurfaceStyle(theme: ReturnType<typeof useTheme>) {
  return {
    // dropdown-glass: popover at ~84% over a 16px blur. GPUI has no backdrop blur.
    backgroundColor: theme.appearance === "dark" ? alpha(theme.popover, 0.84) : alpha(theme.popover, 0.92),
    borderWidth: 1,
    borderColor: alpha(theme.foreground, 0.1),
    borderRadius: RADIUS["3xl"],
  } as const;
}

export function ThreadDetailsCard({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  return (
    <DetailsCardFrame contentKey={`${environmentId}:${threadId}`}>
      {(density) => <ThreadDetailsContent environmentId={environmentId} threadId={threadId} density={density} />}
    </DetailsCardFrame>
  );
}

/** The details card of a new-thread draft (web ThreadDetailsPanel with a draftId). */
export function DraftDetailsCard({
  environmentId,
  projectId,
  draftKey,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  draftKey: string;
}) {
  return (
    <DetailsCardFrame contentKey={`draft:${draftKey}`}>
      {(density) => (
        <DraftDetailsContent environmentId={environmentId} projectId={projectId} draftKey={draftKey} density={density} />
      )}
    </DetailsCardFrame>
  );
}

/**
 * Measures the chat canvas it is mounted in, publishes whether the card fits
 * inline, and floats the card at the canvas's top-right with the density that
 * fits its height.
 */
function DetailsCardFrame({
  contentKey,
  children,
}: {
  contentKey: string;
  children: (density: DetailsDensity) => ReactNode;
}) {
  const theme = useTheme();
  const open = useAtomValue(detailsPanelOpenAtom);
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [heights, setHeights] = useState({ key: "", full: 0, compact: 0 });
  const placement = container.width > 0 ? resolvePlacement(container) : null;
  const key = contentKey;
  const measured = heights.key === key ? heights : { full: 0, compact: 0 };
  const density = placement ? resolveDensity(placement.height, measured) : "full";

  useEffect(() => {
    if (container.width === 0) return;
    appAtomRegistry.set(detailsPresentationAtom, placement ? "inline" : "popover");
    if (placement) appAtomRegistry.set(detailsPopoverOpenAtom, false);
  }, [container.width, container.height, placement !== null]);

  const cardBottom = placement && measured.full > 0 ? placement.y + Math.min(measured.full, placement.height) : null;
  useEffect(() => {
    appAtomRegistry.set(
      detailsCardRectAtom,
      open && placement && cardBottom !== null
        ? { left: placement.x, right: placement.x + placement.width, bottom: cardBottom }
        : null,
    );
  }, [open, placement?.x, cardBottom]);
  useEffect(() => () => appAtomRegistry.set(detailsCardRectAtom, null), []);

  return (
    <>
      {/* Measures the chat canvas; paints nothing and takes no input. */}
      <div
        onLayout={(event: EventPayload) => {
          const width = Math.round(event.width ?? 0);
          const height = Math.round(event.height ?? 0);
          if (width !== container.width || height !== container.height) setContainer({ width, height });
        }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" }}
      />
      {placement && open ? (
        <div
          testId="thread-details-card"
          style={{
            position: "absolute",
            top: placement.y,
            right: CARD_GAP,
            width: placement.width,
            maxHeight: placement.height,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            pointerEvents: "auto",
            ...cardSurfaceStyle(theme),
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", overflowY: "scroll", scrollbarColor: theme.scrollbar, minHeight: 0 }}>
            <div
              onLayout={(event: EventPayload) => {
                if (density === "essential") return;
                const height = Math.round((event.height ?? 0) + 2);
                setHeights((current) => {
                  const base = current.key === key ? current : { key, full: 0, compact: 0 };
                  return base[density] === height ? current : { ...base, key, [density]: height };
                });
              }}
              style={{ display: "flex", flexDirection: "column" }}
            >
              {children(density)}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * A draft has no thread yet: its workspace and branch live on the composer
 * draft, scripts wait for the thread's terminal, and there is no PR, automation
 * or relationship to show (web hides those sections for drafts).
 */
function DraftDetailsContent({
  environmentId,
  projectId,
  draftKey,
  density,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  draftKey: string;
  density: DetailsDensity;
}) {
  const projects = useAtomValue(projectIndexAtom);
  const draft = useAtomValue(composerDraftAtom(draftKey));
  const project = projects.get(`${environmentId}:${projectId}`);
  const gitCwd = project ? (draft.worktreePath ?? project.workspaceRoot) : null;
  const status = useEnvironmentQuery(gitCwd ? vcsEnvironment.status({ environmentId, input: { cwd: gitCwd } }) : null);
  if (!project) return null;
  const isGitRepo = status.data?.isRepo ?? true;
  return (
    <>
      <DetailsSection separated={false} testId="details-workspace">
        {density === "full" ? (
          <RunContextRow environmentId={environmentId} thread={null} draftKey={draftKey} project={project} envLocked={false} />
        ) : null}
        {density !== "essential" ? <OpenInRow environmentId={environmentId} openInCwd={gitCwd} /> : null}
        <ProjectScriptsRow environmentId={environmentId} thread={null} project={project} gitCwd={gitCwd} />
      </DetailsSection>
      {gitCwd ? (
        <DetailsSection separated={density === "full"} testId="details-version-control">
          {isGitRepo ? (
            <BranchRow environmentId={environmentId} thread={null} draftKey={draftKey} projectCwd={project.workspaceRoot} />
          ) : null}
          <GitActionsControl
            environmentId={environmentId}
            thread={null}
            draftKey={draftKey}
            gitCwd={gitCwd}
            compact={density !== "full"}
          />
        </DetailsSection>
      ) : null}
    </>
  );
}

export function ThreadDetailsContent({
  environmentId,
  threadId,
  density,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  density: DetailsDensity;
}) {
  const projects = useAtomValue(projectIndexAtom);
  const thread = useAtomValue(environmentThreadShells.threadShellAtom({ environmentId, threadId } as never)) as
    | EnvironmentThreadShell
    | null
    | undefined;
  const project = thread ? projects.get(`${environmentId}:${thread.projectId}`) : undefined;
  const gitCwd = thread ? (thread.worktreePath ?? project?.workspaceRoot ?? null) : null;
  const status = useEnvironmentQuery(gitCwd ? vcsEnvironment.status({ environmentId, input: { cwd: gitCwd } }) : null);
  if (!thread || !project) return null;
  const isGitRepo = status.data?.isRepo ?? true;
  const envLocked = thread.latestUserMessageAt != null || thread.runtime !== null;
  return (
    <>
      <DetailsSection separated={false} testId="details-workspace">
        {density === "full" ? <RunContextRow environmentId={environmentId} thread={thread} project={project} envLocked={envLocked} /> : null}
        {density !== "essential" ? <OpenInRow environmentId={environmentId} openInCwd={gitCwd} /> : null}
        <ProjectScriptsRow environmentId={environmentId} thread={thread} project={project} gitCwd={gitCwd} />
      </DetailsSection>
      {gitCwd ? (
        <DetailsSection separated={density === "full"} testId="details-version-control">
          {isGitRepo ? <BranchRow environmentId={environmentId} thread={thread} projectCwd={project.workspaceRoot} /> : null}
          {isGitRepo ? <ThreadDetailsPrSection environmentId={environmentId} threadId={threadId} gitCwd={gitCwd} /> : null}
          <GitActionsControl environmentId={environmentId} thread={thread} gitCwd={gitCwd} compact={density !== "full"} />
        </DetailsSection>
      ) : null}
      {density === "full" ? <ThreadAutomationsSection environmentId={environmentId} threadId={threadId} /> : null}
      {density === "full" ? <ThreadRelationshipsSection environmentId={environmentId} threadId={threadId} /> : null}
    </>
  );
}
