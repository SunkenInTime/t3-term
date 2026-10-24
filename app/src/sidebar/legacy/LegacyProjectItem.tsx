// LegacySidebar.tsx SidebarProjectItem + SidebarProjectThreadList: a project's
// header row (chevron or status dot, favicon, name, grouped count, remote
// badge, hover new-thread button) and its thread list with "No threads yet",
// "Show more" and "Show less".
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import { memo, useState } from "react";

import {
  legacyContextMenuAtom,
  projectExpansionPreferenceKeys,
  resolveLegacyProjectThreadPanel,
  setLegacyProjectExpanded,
  setLegacyThreadListExpanded,
  type LegacyProjectThreads,
} from "../../state/legacySidebar.ts";
import {
  clearThreadSelection,
  projectFaviconUrlAtom,
  readThreadSelection,
  sidebarClientSettingsAtom,
} from "../../state/sidebar.ts";
import { startNewThread } from "../../palette/actions.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import type { SidebarProjectSnapshot } from "../../web/sidebarProjectGrouping.ts";
import { ProjectFavicon } from "../ProjectFavicon.tsx";
import {
  consumeProjectClick,
  projectMouseDown,
  projectMouseMove,
  projectMouseUp,
} from "./legacyProjectGesture.ts";
import { LegacyThreadRow } from "./LegacyThreadRow.tsx";
import { StatusDot, ThreadStatusLabel, legacyTones, PassiveTooltip } from "./legacyStatus.tsx";

export interface LegacyProjectItemProps {
  readonly project: SidebarProjectSnapshot;
  readonly projectThreads: LegacyProjectThreads;
  readonly projectExpanded: boolean;
  readonly isThreadListExpanded: boolean;
  readonly activeRouteThreadKey: string | null;
  readonly threadJumpLabelByKey: ReadonlyMap<string, string>;
  readonly newThreadShortcutLabel: string | null;
  readonly primaryEnvironmentId: string | null;
  readonly isManualProjectSorting: boolean;
  /** The drop target ring while another project is dragged over this one. */
  readonly isDropTarget: boolean;
}

export const LegacyProjectItem = memo(function LegacyProjectItem(props: LegacyProjectItemProps) {
  const { project, projectThreads, projectExpanded, isThreadListExpanded, activeRouteThreadKey } = props;
  const theme = useTheme();
  const previewCount = useAtomValue(sidebarClientSettingsAtom).sidebarThreadPreviewCount;
  const panel = resolveLegacyProjectThreadPanel({
    projectThreads,
    activeRouteThreadKey,
    projectExpanded,
    isThreadListExpanded,
    sidebarThreadPreviewCount: previewCount,
  });
  const showList =
    (panel.shouldShowThreadPanel && (panel.showEmptyThreadState || panel.renderedThreads.length > 0)) ||
    (projectExpanded && panel.hasOverflowingThreads);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        borderRadius: RADIUS.md,
        ...(props.isDropTarget ? { borderWidth: 1, borderColor: alpha(theme.primary, 0.4) } : {}),
      }}
    >
      <LegacyProjectHeader {...props} projectStatus={projectThreads.projectStatus} />
      {showList ? (
        // SidebarMenuSub with LegacySidebar's `mx-0.5 sm:mx-1 w-full`: a 1px rule, 10px inset rows.
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginLeft: 4,
            paddingLeft: 10,
            paddingRight: 6,
            paddingTop: 2,
            paddingBottom: 2,
            borderLeftWidth: 1,
            borderColor: theme.sidebar.border,
            overflow: "hidden",
          }}
        >
          {panel.shouldShowThreadPanel && panel.showEmptyThreadState ? (
            <div style={{ display: "flex", alignItems: "center", height: 32, paddingLeft: 8, paddingRight: 8 }}>
              <Text size="xs" color={alpha(theme.sidebar.mutedForeground, 0.75)}>
                No threads yet
              </Text>
            </div>
          ) : null}
          {panel.shouldShowThreadPanel
            ? panel.renderedThreads.map((thread) => {
                const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
                return (
                  <LegacyThreadRow
                    key={threadKey}
                    thread={thread}
                    status={projectThreads.statusByThreadKey.get(threadKey) ?? null}
                    orderedProjectThreadKeys={projectThreads.orderedThreadKeys}
                    projectKey={project.projectKey}
                    isActive={activeRouteThreadKey === threadKey}
                    jumpLabel={props.threadJumpLabelByKey.get(threadKey) ?? null}
                    isRemote={props.primaryEnvironmentId !== null && thread.environmentId !== props.primaryEnvironmentId}
                  />
                );
              })
            : null}
          {projectExpanded && panel.hasOverflowingThreads ? (
            <ShowMoreButton
              label={isThreadListExpanded ? "Show less" : "Show more"}
              status={isThreadListExpanded ? null : panel.hiddenThreadStatus}
              testId={`legacy-show-${isThreadListExpanded ? "less" : "more"}-${project.projectKey}`}
              onClick={() => setLegacyThreadListExpanded(project.projectKey, !isThreadListExpanded)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

function LegacyProjectHeader(props: LegacyProjectItemProps & { projectStatus: LegacyProjectThreads["projectStatus"] }) {
  const { project, projectExpanded, projectStatus } = props;
  const theme = useTheme();
  const tones = legacyTones(theme);
  const setContextMenu = useAtomSet(legacyContextMenuAtom);
  const [hovered, setHovered] = useState(false);
  const toggle = () => {
    if (readThreadSelection().selectedThreadKeys.size > 0) clearThreadSelection();
    setLegacyProjectExpanded(projectExpansionPreferenceKeys(project), !projectExpanded);
  };
  const createThread = (position: { x: number; y: number }) => {
    if (project.memberProjects.length === 1) {
      const member = project.memberProjects[0]!;
      startNewThread(scopeProjectRef(member.environmentId, member.id));
      return;
    }
    setContextMenu({ kind: "new-thread", projectKey: project.projectKey, ...position });
  };
  const remoteOnly = project.environmentPresence === "remote-only";
  return (
    <div
      testId={`legacy-project-${project.projectKey}`}
      onMouseDown={(event) => projectMouseDown(project.projectKey, event)}
      onMouseMove={projectMouseMove}
      onMouseUp={projectMouseUp}
      onClick={() => {
        if (!consumeProjectClick(project.projectKey)) return;
        toggle();
      }}
      onAuxClick={(event) => {
        if (event.isRightClick === false) return;
        setContextMenu({ kind: "project", projectKey: project.projectKey, x: event.x ?? 0, y: event.y ?? 0 });
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 32,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        flexShrink: 0,
        overflow: "hidden",
        cursor: props.isManualProjectSorting ? "grab" : "pointer",
        backgroundColor: hovered ? theme.sidebar.rowHover : "#00000000",
      }}
    >
      {!projectExpanded && projectStatus ? (
        // The wrapper takes the box's size itself: it measured 0 wide around a negative margin.
        <PassiveTooltip content={projectStatus.label} side="top" rootStyle={{ flexShrink: 0, width: 14, height: 14, marginLeft: -2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, flexShrink: 0 }}>
            {hovered ? (
              <Icon name="chevron-right" size={14} color={tones.iconMuted} />
            ) : (
              <StatusDot status={projectStatus} size={9} />
            )}
          </div>
        </PassiveTooltip>
      ) : (
        <div style={{ display: "flex", marginLeft: -2, flexShrink: 0 }}>
          <Icon
            name={projectExpanded ? "chevron-down" : "chevron-right"}
            size={14}
            color={alpha(theme.mutedForeground, 0.7)}
          />
        </div>
      )}
      <LegacyProjectFavicon project={project} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <Text size="sm" weight={500} color={alpha(theme.sidebar.foreground, 0.9)} truncate>
          {project.displayName}
        </Text>
        {project.groupedProjectCount > 1 ? (
          <Text size="3xs" color={tones.secondaryLabel} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
            {`${project.groupedProjectCount} projects`}
          </Text>
        ) : null}
      </div>
      <div style={{ width: 16, flexShrink: 0 }} />
      {remoteOnly && !hovered ? (
        <PassiveTooltip content={`Remote environment: ${project.remoteEnvironmentLabels.join(", ")}`} side="top">
          <div style={{ position: "absolute", top: 6, right: 6, display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20 }}>
            <Icon name="cloud" size={12} color={tones.iconMuted} />
          </div>
        </PassiveTooltip>
      ) : null}
      {hovered ? (
        <div style={{ position: "absolute", top: 5, right: 2, display: "flex" }}>
          <PassiveTooltip
            content={props.newThreadShortcutLabel ? `New thread (${props.newThreadShortcutLabel})` : "New thread"}
            side="top"
          >
            <NewThreadButton projectKey={project.projectKey} onCreate={createThread} />
          </PassiveTooltip>
        </div>
      ) : null}
    </div>
  );
}

function NewThreadButton({ projectKey, onCreate }: { projectKey: string; onCreate: (position: { x: number; y: number }) => void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={`legacy-new-thread-${projectKey}`}
      // Its absolutely positioned wrapper keeps the press from the row (gpuix), so a plain click works.
      onClick={(event) => onCreate({ x: event.x ?? 0, y: event.y ?? 0 })}
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
      <Icon name="square-pen" size={14} color={hovered ? theme.foreground : theme.mutedForeground} />
    </div>
  );
}

/** Web's ProjectFavicon: a favicon image is 14px, a monogram tile 16px. */
function LegacyProjectFavicon({ project }: { project: SidebarProjectSnapshot }) {
  const src = useAtomValue(
    projectFaviconUrlAtom({
      environmentId: project.environmentId,
      cwd: project.workspaceRoot,
      faviconPath: project.faviconPath,
    }),
  );
  const isImage = !project.projectIcon && src !== null && src !== undefined && !isProjectFaviconFallbackUrl(src);
  const size = isImage || project.projectIcon?.kind === "lucide" || project.projectIcon?.kind === "emoji" ? 14 : 16;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: 16, flexShrink: 0 }}>
      <ProjectFavicon project={project} size={size} />
    </div>
  );
}

/** SidebarMenuSubButton size="sm": 28px, 12px text, `-translate-x-px`. */
function ShowMoreButton({
  label,
  status,
  testId,
  onClick,
}: {
  label: string;
  status: LegacyProjectThreads["projectStatus"];
  testId: string;
  onClick: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 8,
        height: 28,
        marginLeft: -1,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.lg,
        flexShrink: 0,
        cursor: "pointer",
        backgroundColor: hovered ? theme.sidebar.rowHover : "#00000000",
      }}
    >
      {status ? <ThreadStatusLabel status={status} compact /> : null}
      <Text size="xs" color={theme.sidebar.foreground} style={{ whiteSpace: "nowrap" }}>
        {label}
      </Text>
    </div>
  );
}
