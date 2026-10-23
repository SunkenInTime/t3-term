// Port of apps/web/src/components/CommandPalette.tsx (+ CommandPaletteThreadItems,
// CommandPaletteProjectItems, CommandPaletteThemeItems, CommandPaletteLookups).
// The palette hosts three modes like web: command (actions, projects, threads,
// nested views, the add-project flow), files (Go to file) and content
// (Search project contents).
//
// gpuix differences: the <input> swallows Backspace, so Esc steps back out of a
// nested view (web: Backspace on an empty query) and the footer says so. There
// is no virtualized list; long result lists are capped by PaletteRows.
import { useAtomValue } from "@effect/atom-react";
import { useGpuixRequired, type KeyEvent } from "@gpuix/react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  addProjectRemoteSourceLabel,
  addProjectRemoteSourcePathHint,
  addProjectRemoteSourceProvider,
  canCreateProjectInEnvironment,
  getCloneDestinationBrowsePath,
  getCloneDestinationPath,
  getCloneDirectoryName,
  getDefaultCloneUrl,
  getNewProjectPathPreview,
  getNewProjectPublishTarget,
  getNewProjectPublishTargets,
  getNewProjectRepository,
  normalizePastedCloneUrl,
  sortAddProjectProviderSources,
  type AddProjectRemoteSource,
  type AddProjectRemoteSourceReadiness,
} from "@t3tools/client-runtime/operations/projects";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { getFilesystemBrowsePath, filterFilesystemBrowseEntries } from "@t3tools/client-runtime/state/filesystem";
import type { EnvironmentProject, EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  findProjectByPath,
  getBrowseDirectoryPath,
  hasTrailingPathSeparator,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "@t3tools/client-runtime/state/projects";
import {
  executeAtomQuery,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { getLatestThreadForProject } from "@t3tools/client-runtime/state/thread-sort";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { threadPullRequestLinkMode } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import {
  ProjectId,
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type FilesystemBrowseResult,
  type ServerConfig,
  type SourceControlProviderKind,
  type ThreadId,
} from "@t3tools/contracts";
import { BUILT_IN_THEMES, getThemeColorsForAppearance, type ThemeAppearance } from "@t3tools/shared/themePalettes";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";

import { openLinkPullRequestDialog } from "../dialogs/LinkPullRequestDialog.tsx";
import { activeKeybindingsAtom } from "../state/keybindings.ts";
import {
  appearanceModeAtom,
  resolvedAppearanceAtom,
  setAppearanceMode,
  setTheme,
  setThemeHalf,
  themeHalvesAtom,
  type AppearanceMode,
} from "../state/appearance.ts";
import {
  environmentProjects,
  environmentThreadShells,
  serverEnvironment,
  threadEnvironment,
  projectEnvironment,
} from "../state/environment.ts";
import { environmentPresentations } from "../state/navigation.ts";
import {
  commandPaletteDetailAtom,
  dispatchCommandPalette,
  filesystemEnvironment,
  sourceControlEnvironment,
} from "../state/palette.ts";
import {
  commandPaletteOpenAtom,
  findBarOpenAtom,
  rightPanelOpenAtom,
  rightPanelSurfaceAtom,
  routeAtom,
} from "../state/ui.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { ProjectGlyph } from "../sidebar/ProjectGlyph.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { alpha, useTheme } from "../ui/theme.ts";
import { toast } from "../ui/toast.tsx";
import {
  buildBrowseGroups,
  buildCommandPaletteRows,
  buildLinkedThreadActionItems,
  buildPaletteRemoteSourceReadiness,
  buildProjectActionItems,
  buildRootGroups,
  buildThreadActionItems,
  createCommandPaletteSearchState,
  enumerateCommandPaletteItems,
  errorMessage,
  filterCommandPaletteGroups,
  filterPinnedBrowseEntries,
  findHighlightedCommandPaletteItem,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  getEnvironmentBrowsePlatform,
  reduceCommandPaletteSearchState,
  remoteProjectInputPlaceholder,
  RECENT_THREAD_LIMIT,
  type AddProjectCloneFlow,
  type AddProjectEnvironmentOption,
  type CommandPaletteActionItem,
  type CommandPaletteOpenIntent,
  type CommandPaletteProject,
  type CommandPaletteReturnContext,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
} from "../web/components/CommandPalette.logic.ts";
import { HOST_PLATFORM, threadJumpIndexFromCommand } from "../web/keybindings.ts";
import { resolveKeyEventCommand } from "../keybindings/useGlobalKeybindings.ts";
import {
  copyActiveThreadReference,
  openThread,
  readActiveThreadReferenceCopyTarget,
  reportError,
  scratchEnvironmentId,
  sortProjectsByActivity,
  startNewThread,
  startScratchThread,
} from "./actions.ts";
import {
  ItemIcon,
  PaletteFooter,
  PaletteFrame,
  PaletteInput,
  PaletteNotice,
  PaletteRows,
  PaletteSubmitButton,
  type PaletteItem,
} from "./command.tsx";
import { useEnvironmentQuery, useFilesystemReadAccess, useThreadSearch } from "./hooks.ts";
import {
  machineIcon,
  ProjectLocationDescription,
  ThemePreviewDot,
  ThreadStatusPillView,
  ThreadSubtitle,
  type PaletteLocation,
} from "./items.tsx";
import { ProjectContentSearch } from "./ProjectContentSearch.tsx";
import { ProjectFilePicker } from "./ProjectFilePicker.tsx";
import { useRouteThreadShell } from "./projectTarget.ts";

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];

export function CommandPalette() {
  const open = useAtomValue(commandPaletteOpenAtom);
  const detail = useAtomValue(commandPaletteDetailAtom);
  if (!open) return null;
  const close = () => dispatchCommandPalette({ _tag: "SetOpen", open: false });
  const back = () => dispatchCommandPalette({ _tag: "BackToCommand" });
  if (detail.mode === "files") return <ProjectFilePicker onClose={close} onBack={back} />;
  if (detail.mode === "content") return <ProjectContentSearch onClose={close} onBack={back} />;
  return (
    <CommandModePalette
      openIntent={detail.openIntent}
      initialContext={detail.restoredSearch}
      onClose={close}
    />
  );
}

// ── Environment lookups (CommandPaletteLookups.useEnvironmentLookups) ────

interface PaletteEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPrimary: boolean;
  readonly phase: string;
  readonly connection: Parameters<typeof connectionStatusText>[0];
  readonly serverConfig: Omit<ServerConfig, "providers"> | null;
}

function usePaletteEnvironments(): ReadonlyArray<PaletteEnvironment> {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  // t3-term has no desktop-local primary; the first saved environment is the one
  // it was launched against and plays that role ("Local" in locations).
  return [...presentations].map(([environmentId, presentation], index) => ({
    environmentId,
    label: presentation.entry.target.label,
    isPrimary: index === 0,
    phase: presentation.connection.phase,
    connection: presentation.connection,
    serverConfig: presentation.serverConfig as Omit<ServerConfig, "providers"> | null,
  }));
}

function locationFor(environment: PaletteEnvironment): PaletteLocation {
  return {
    kind: environment.isPrimary ? "local" : "remote",
    label: environment.isPrimary ? "Local" : environment.label,
    machine: resolveEnvironmentMachineKind(environment.serverConfig as never),
  };
}


function remoteSourceIcon(source: AddProjectRemoteSource): IconName {
  if (source === "url") return "link";
  if (source === "github") return "github";
  if (source === "gitlab") return "gitlab";
  if (source === "azure-devops") return "cloud";
  return "git-branch";
}

function hostIcon(kind: SourceControlProviderKind): IconName {
  return kind === "github" ? "github" : kind === "gitlab" ? "gitlab" : "git-branch";
}

const STANDARD_PREVIEWS: ReadonlyArray<{ mode: ThemeAppearance; canvas: string; accent: string }> = [
  { mode: "light", canvas: "#fcfcfc", accent: "#d4d4d8" },
  { mode: "dark", canvas: "#0a0a0a", accent: "#2b3a5e" },
];

const APPEARANCE_OPTIONS: ReadonlyArray<{ mode: AppearanceMode; label: string; icon: IconName }> = [
  { mode: "system", label: "System", icon: "monitor" },
  { mode: "light", label: "Light", icon: "sun" },
  { mode: "dark", label: "Dark", icon: "moon" },
];

function notifyThemeSaveFailure(): void {
  toast({ type: "error", title: "Couldn't save theme selection", description: "Try again." });
}

function CurrentLabel() {
  const theme = useTheme();
  return (
    <Text size="xs" color={alpha(theme.mutedForeground, 0.7)}>
      Current
    </Text>
  );
}

function BoldTitle({ prefix, bold }: { prefix: string; bold: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minWidth: 0 }}>
      <Text color={theme.foreground} style={{ flexShrink: 0 }}>
        {prefix}
      </Text>
      <Text color={theme.foreground} weight={600} truncate>
        {bold}
      </Text>
    </div>
  );
}

function SetupRequiredBadge() {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 20,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: alpha(theme.warning, 0.32),
        backgroundColor: alpha(theme.warning, 0.08),
      }}
    >
      <Text size="2xs" weight={500} color={theme.warningForeground}>
        Setup Required
      </Text>
    </div>
  );
}

function SummaryRow({ icon, title, description, heading }: { icon: IconName; title: string; description: string; heading?: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingTop: 8, paddingLeft: 8, paddingRight: 8, flexShrink: 0 }}>
      {heading ? (
        <div style={{ paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8 }}>
          <Text size="xs" weight={500} color={theme.mutedForeground}>
            {heading}
          </Text>
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8 }}>
        <ItemIcon name={icon} />
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          <Text truncate>{title}</Text>
          <Text size="xs" color={alpha(theme.mutedForeground, 0.85)} truncate>
            {description}
          </Text>
        </div>
      </div>
    </div>
  );
}

// ── Command mode ─────────────────────────────────────────────────────────

function CommandModePalette({
  openIntent,
  initialContext,
  onClose,
}: {
  openIntent: CommandPaletteOpenIntent | null;
  initialContext: CommandPaletteReturnContext | undefined;
  onClose: () => void;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const inputRef = useRef<{ id: number } | null>(null);
  const initialSearch = initialContext ?? {
    query: openIntent?.kind === "search" ? openIntent.query : "",
    linkedThreadSearch: openIntent?.kind === "search" ? openIntent : null,
  };
  const [searchState, dispatchSearch] = useReducer(
    reduceCommandPaletteSearchState,
    initialSearch.query,
    createCommandPaletteSearchState,
  );
  const { query, views: viewStack } = searchState;
  const setQuery = (next: string) => dispatchSearch({ type: "query", query: next });
  const [linkedThreadSearch, setLinkedThreadSearch] = useState(initialSearch.linkedThreadSearch);
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const [highlightCleared, setHighlightCleared] = useState(false);
  const [scrollNonce, setScrollNonce] = useState(0);
  const isActionsOnly = query.startsWith(">");

  const keybindings = useAtomValue(activeKeybindingsAtom);
  const route = useAtomValue(routeAtom);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const environments = usePaletteEnvironments();
  const activeThread = useRouteThreadShell();
  const appearanceMode = useAtomValue(appearanceModeAtom);
  const resolvedAppearance = useAtomValue(resolvedAppearanceAtom);
  const themeHalves = useAtomValue(themeHalvesAtom);

  // Add-project flow state.
  const [addProjectEnvironmentId, setAddProjectEnvironmentId] = useState<EnvironmentId | null>(null);
  const [addProjectCloneFlow, setAddProjectCloneFlow] = useState<AddProjectCloneFlow | null>(null);
  const [newProjectFlow, setNewProjectFlow] = useState<{
    readonly environmentId: EnvironmentId;
    readonly sourcesEnvironmentId: EnvironmentId | null;
  } | null>(null);
  const [newProjectPublishes, setNewProjectPublishes] = useState(false);
  const [newProjectPublishKind] = useState<SourceControlProviderKind | null>(null);
  const [isCreatingNewProject, setIsCreatingNewProject] = useState(false);
  const newProjectSubmittingRef = useRef(false);
  const [isRemoteProjectLookingUp, setIsRemoteProjectLookingUp] = useState(false);
  const [isRemoteProjectCloning, setIsRemoteProjectCloning] = useState(false);
  const cloneLookupGeneration = useRef(0);
  const [isPickingProjectFolder, setIsPickingProjectFolder] = useState(false);

  const environmentById = new Map(environments.map((environment) => [environment.environmentId, environment]));
  const locationByEnvironmentId = new Map(environments.map((environment) => [environment.environmentId, locationFor(environment)]));
  const primaryEnvironmentId = environments[0]?.environmentId ?? null;

  // Route context: the thread or draft the user is on.
  const currentProjectEnvironmentId =
    route.kind === "thread" ? route.environmentId : route.kind === "draft" ? route.environmentId : null;
  const currentProjectId =
    route.kind === "thread" ? (activeThread?.projectId ?? null) : route.kind === "draft" ? route.projectId : null;
  const activeThreadId = activeThread?.id;
  const projectByKey = new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project]));
  const projectTitleById = new Map(projects.map((project) => [project.id, project.title] as const));
  const currentProject =
    currentProjectEnvironmentId !== null && currentProjectId !== null
      ? (projectByKey.get(`${currentProjectEnvironmentId}:${currentProjectId}`) ?? null)
      : null;
  const currentProjectCwd = currentProject?.workspaceRoot ?? null;

  const scratchTargetEnvironmentId = scratchEnvironmentId(currentProjectEnvironmentId ?? primaryEnvironmentId);

  // Projects in picker order: the contextual one first, then by activity.
  const sortedProjects = sortProjectsByActivity(
    projects.filter((project) => project.isScratch !== true),
    threads,
  );
  const contextualProject =
    currentProject && currentProject.isScratch !== true ? currentProject : (sortedProjects[0] ?? null);
  const pickerProjects: CommandPaletteProject[] = [
    ...(contextualProject ? [contextualProject] : []),
    ...sortedProjects.filter((project) => project !== contextualProject),
  ].map((project) => ({ ...(project as never as CommandPaletteProject), displayName: project.title }));

  const runThread = async (thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId }) => {
    openThread({ environmentId: thread.environmentId, threadId: thread.id });
  };

  const openProjectFromSearch = async (project: CommandPaletteProject) => {
    const latestThread = getLatestThreadForProject(
      threads.filter((thread) => thread.environmentId === project.environmentId),
      project.id,
      "updated_at",
    );
    if (latestThread) {
      openThread({ environmentId: latestThread.environmentId, threadId: latestThread.id });
      return;
    }
    startNewThread(scopeProjectRef(project.environmentId, project.id));
  };

  const projectDescription = (project: CommandPaletteProject) => (
    <ProjectLocationDescription
      location={locationByEnvironmentId.get(project.environmentId)}
      workspaceRoot={project.workspaceRoot}
    />
  );
  const projectIcon = (project: CommandPaletteProject) => (
    <ProjectGlyph project={project as never as EnvironmentProject} size={16} />
  );

  const projectSearchItems = buildProjectActionItems({
    projects: pickerProjects,
    valuePrefix: "project",
    searchTerms: (project) => [locationByEnvironmentId.get(project.environmentId)?.label ?? "Remote"],
    renderDescription: projectDescription,
    icon: projectIcon,
    runProject: openProjectFromSearch,
  });

  const projectThreadItems = (() => {
    const items = enumerateCommandPaletteItems(
      buildProjectActionItems({
        projects: pickerProjects,
        valuePrefix: "new-thread-in",
        searchTerms: (project) => [locationByEnvironmentId.get(project.environmentId)?.label ?? ""],
        renderDescription: projectDescription,
        icon: projectIcon,
        runProject: async (project) => startNewThread(scopeProjectRef(project.environmentId, project.id)),
      }),
    );
    if (scratchTargetEnvironmentId === null) return items;
    return [
      ...items.slice(0, 1),
      {
        kind: "action" as const,
        value: "new-thread-in:no-project",
        searchTerms: ["no project", "without project", "none"],
        title: "No project",
        icon: <ItemIcon name="message-square-dashed" />,
        shortcutCommand: "chat.newWithoutProject" as const,
        run: () => startScratchThread(scratchTargetEnvironmentId),
      },
      ...items.slice(1),
    ];
  })();

  // Threads, with message matches for a non-empty root query.
  const currentView = viewStack.at(-1)?.view ?? null;
  const threadSearchQuery = currentView === null && !isActionsOnly ? query : "";
  const connectedEnvironmentIds = environments
    .filter((environment) => environment.phase === "connected")
    .map((environment) => environment.environmentId);
  const threadSearch = useThreadSearch(connectedEnvironmentIds, threadSearchQuery);
  const contentMatchByKey = new Map(
    threadSearch.matches.flatMap((match) =>
      match.source === "user" || match.source === "assistant" ? [[threadSearchMatchKey(match), match] as const] : [],
    ),
  );
  const allThreadItems = buildThreadActionItems({
    threads,
    ...(activeThreadId ? { activeThreadId } : {}),
    projectTitleById,
    sortOrder: "updated_at",
    icon: <ItemIcon name="message-square" />,
    renderLeadingContent: (thread) =>
      thread.hasPendingApprovals ||
      thread.hasPendingUserInput ||
      thread.runtime !== null ||
      thread.latestRun !== null ? (
        <ThreadStatusPillView thread={thread as EnvironmentThreadShell} />
      ) : null,
    renderDescription: (thread) => (
      <ThreadSubtitle
        project={projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null}
        environmentLabel={locationByEnvironmentId.get(thread.environmentId)?.label ?? "Remote"}
        branch={thread.branch}
        worktreePath={thread.worktreePath}
        isCurrent={thread.id === activeThreadId}
      />
    ),
    getContentMatch: (thread) => {
      const match = contentMatchByKey.get(threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }));
      return match && (match.source === "user" || match.source === "assistant")
        ? { source: match.source, snippet: match.snippet, query: threadSearch.query }
        : undefined;
    },
    runThread,
  });
  const recentThreadItems = allThreadItems.slice(0, RECENT_THREAD_LIMIT);

  function resetHighlight(): void {
    setHighlightedItemValue(null);
    setHighlightCleared(false);
  }

  function pushPaletteView(view: CommandPaletteView): void {
    dispatchSearch({ type: "push", view });
    resetHighlight();
  }

  function popView(): void {
    setAddProjectCloneFlow(null);
    setNewProjectFlow(null);
    if (viewStack.length <= 1) {
      setAddProjectEnvironmentId(null);
    } else if (newProjectFlow?.sourcesEnvironmentId) {
      setAddProjectEnvironmentId(newProjectFlow.sourcesEnvironmentId);
    }
    dispatchSearch({ type: "back" });
    resetHighlight();
  }

  function handleQueryChange(nextQuery: string): void {
    setHighlightedItemValue(null);
    setHighlightCleared(true);
    setQuery(nextQuery);
    if (nextQuery === "" && currentView?.initialQuery) popView();
  }

  // ── Add project ──────────────────────────────────────────────────────

  const addProjectEnvironmentOptions: AddProjectEnvironmentOption[] = environments
    .filter((environment) => canCreateProjectInEnvironment(environment.phase as never))
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      isPrimary: environment.isPrimary,
      machine: resolveEnvironmentMachineKind(environment.serverConfig as never),
      isConnected: canCreateProjectInEnvironment(environment.phase as never),
      status: connectionStatusText(environment.connection),
    }))
    .sort((left, right) =>
      left.isPrimary !== right.isPrimary ? (left.isPrimary ? -1 : 1) : left.label.localeCompare(right.label),
    );
  const defaultAddProjectEnvironmentId =
    addProjectEnvironmentOptions.find((option) => option.isConnected)?.environmentId ?? null;
  const browseEnvironmentId = addProjectEnvironmentId ?? defaultAddProjectEnvironmentId;
  const browseEnvironment = browseEnvironmentId === null ? null : (environmentById.get(browseEnvironmentId) ?? null);
  const sourceControlDiscovery = useEnvironmentQuery(
    browseEnvironmentId === null
      ? null
      : sourceControlEnvironment.discovery({ environmentId: browseEnvironmentId, input: {} }),
  );
  const browseEnvironmentPlatform = getEnvironmentBrowsePlatform(browseEnvironment?.serverConfig?.environment.platform.os);
  const isRemoteProjectCloneFlow = addProjectCloneFlow !== null;
  const isRemoteProjectRepositoryStep = addProjectCloneFlow?.step === "repository";
  const pinnedCloneDirectoryName =
    addProjectCloneFlow?.step === "confirm"
      ? getCloneDirectoryName(addProjectCloneFlow.repository?.nameWithOwner ?? addProjectCloneFlow.remoteUrl)
      : "";
  const browsePath = getFilesystemBrowsePath(
    query,
    browseEnvironmentPlatform,
    browseEnvironmentId !== null && !isRemoteProjectRepositoryStep && newProjectFlow === null,
  );
  const isBrowsing = browsePath.isBrowsing;
  const paletteMode = getCommandPaletteMode({ currentView, isBrowsing });
  const getAddProjectInitialQueryForEnvironment = (environmentId: EnvironmentId | null): string => {
    const baseDirectory =
      (environmentId === null ? null : environmentById.get(environmentId))?.serverConfig?.settings
        ?.addProjectBaseDirectory?.trim() ?? "";
    return baseDirectory.length === 0 ? "~/" : ensureBrowseDirectoryPath(baseDirectory);
  };
  const currentProjectCwdForBrowse =
    browseEnvironmentId && currentProjectEnvironmentId === browseEnvironmentId ? currentProjectCwd : null;
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) && currentProjectCwdForBrowse === null;
  const browseAccess = useFilesystemReadAccess(browseEnvironmentId);
  const hasBrowseTarget =
    isBrowsing && browsePath.directoryPath.length > 0 && browseEnvironmentId !== null && !relativePathNeedsActiveProject;
  const browseQuery = useEnvironmentQuery(
    browseAccess.canReadFiles && hasBrowseTarget && browseEnvironmentId !== null
      ? filesystemEnvironment.browse({
          environmentId: browseEnvironmentId,
          input: {
            partialPath: browsePath.directoryPath,
            ...(currentProjectCwdForBrowse ? { cwd: currentProjectCwdForBrowse } : {}),
          },
        })
      : null,
  );
  const browseResult = browseQuery.data;
  const isBrowsePending = hasBrowseTarget && (browseAccess.isPending || browseQuery.isPending);
  const browseAccessError =
    hasBrowseTarget && !browseAccess.isPending && !browseAccess.canReadFiles
      ? (browseAccess.error ?? "This connection cannot browse host folders.")
      : null;
  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const { visibleEntries: visibleBrowseEntries, exactEntry: exactBrowseEntry } = pinnedCloneDirectoryName
    ? filterPinnedBrowseEntries({
        browseEntries,
        filterQuery: browsePath.filterQuery,
        pinnedDirectoryName: pinnedCloneDirectoryName,
        caseSensitive: browseEnvironmentPlatform !== "Win32",
      })
    : filterFilesystemBrowseEntries(browseEntries, browsePath.filterQuery);

  const newProjectsRootFor = (environmentId: EnvironmentId | null): string | null =>
    (environmentId === null ? null : environmentById.get(environmentId))?.serverConfig?.newProjectsRoot ?? null;

  const startAddProjectBrowse = (environmentId: EnvironmentId): void => {
    setAddProjectEnvironmentId(environmentId);
    setAddProjectCloneFlow(null);
    pushPaletteView({ addonIcon: null, groups: [], initialQuery: getAddProjectInitialQueryForEnvironment(environmentId) });
  };

  const startAddProjectClone = (environmentId: EnvironmentId, source: AddProjectRemoteSource): void => {
    setAddProjectEnvironmentId(environmentId);
    setAddProjectCloneFlow({ step: "repository", environmentId, source });
    pushPaletteView({ addonIcon: null, groups: [], initialQuery: "" });
  };

  const startNewProject = (environmentId: EnvironmentId, sourcesEnvironmentId: EnvironmentId | null): void => {
    setAddProjectEnvironmentId(environmentId);
    setAddProjectCloneFlow(null);
    setNewProjectFlow({ environmentId, sourcesEnvironmentId });
    setNewProjectPublishes(false);
    pushPaletteView({ addonIcon: null, groups: [] });
  };

  const openSourceControlSettings = () => {
    onClose();
    appAtomRegistry.set(routeAtom, { kind: "settings", page: "source-control" });
  };

  const buildAddProjectSourceGroups = (
    environmentId: EnvironmentId,
    readinessBySource: AddProjectRemoteSourceReadiness,
  ): CommandPaletteView["groups"] => {
    const sourceItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [
      {
        kind: "action",
        value: `action:add-project:${environmentId}:local`,
        searchTerms: ["local", "folder", "directory", "browse"],
        title: "Local folder",
        description: "Browse a folder on disk",
        icon: <ItemIcon name="folder-plus" />,
        keepOpen: true,
        run: async () => startAddProjectBrowse(environmentId),
      },
    ];
    if (newProjectsRootFor(environmentId) !== null) {
      sourceItems.unshift({
        kind: "action",
        value: `action:add-project:${environmentId}:new`,
        searchTerms: ["new project", "create", "empty", "repository", "git init"],
        title: "New project",
        description: "Start a new Git repository from a name",
        icon: <ItemIcon name="folder-git-2" />,
        keepOpen: true,
        run: async () => startNewProject(environmentId, environmentId),
      });
    }
    const orderedSources: ReadonlyArray<AddProjectRemoteSource> = ["url", ...sortAddProjectProviderSources(readinessBySource)];
    for (const source of orderedSources) {
      const label = addProjectRemoteSourceLabel(source);
      const title = source === "url" ? "Git URL" : `${label} repository`;
      const description =
        source === "url" ? "Clone from a remote URL" : `Clone ${label} ${addProjectRemoteSourcePathHint(source)}`;
      const readiness = readinessBySource(source);
      if (!readiness.ready) {
        sourceItems.push({
          kind: "action",
          value: `action:add-project:${environmentId}:${source}:not-ready`,
          searchTerms: ["clone", "remote", "repository", "repo", "git", label, "setup required"],
          title,
          description,
          disabled: true,
          icon: <ItemIcon name={remoteSourceIcon(source)} />,
          titleTrailingContent: (
            <div onClick={openSourceControlSettings} style={{ display: "flex", cursor: "pointer" }}>
              <SetupRequiredBadge />
            </div>
          ),
          run: async () => {},
        });
        continue;
      }
      sourceItems.push({
        kind: "action",
        value: `action:add-project:${environmentId}:${source}`,
        searchTerms: ["clone", "remote", "repository", "repo", "git", label],
        title,
        description,
        icon: <ItemIcon name={remoteSourceIcon(source)} />,
        keepOpen: true,
        run: async () => startAddProjectClone(environmentId, source),
      });
    }
    return [{ value: `sources:${environmentId}`, label: "Sources", items: sourceItems }];
  };

  const startAddProjectSourceSelection = (environmentId: EnvironmentId): void => {
    const environment = environmentById.get(environmentId);
    if (!canCreateProjectInEnvironment(environment?.phase as never)) {
      toast({
        type: "error",
        title: "Environment unavailable",
        description: `${environment?.label ?? "The selected environment"} is not connected.`,
      });
      return;
    }
    setAddProjectEnvironmentId(environmentId);
    setAddProjectCloneFlow(null);
    pushPaletteView({
      addonIcon: null,
      groups: buildAddProjectSourceGroups(
        environmentId,
        buildPaletteRemoteSourceReadiness(browseEnvironmentId === environmentId ? sourceControlDiscovery.data : null),
      ),
    });
  };

  const buildEnvironmentItem = (
    option: AddProjectEnvironmentOption,
    value: string,
    run: (environmentId: EnvironmentId) => void,
  ): CommandPaletteActionItem => ({
    kind: "action",
    value,
    searchTerms: [option.label, option.environmentId, option.isPrimary ? "this device" : ""],
    title: option.label,
    description: option.isConnected ? (option.isPrimary ? "This device" : option.environmentId) : option.status,
    disabled: !option.isConnected,
    icon: <ItemIcon name={machineIcon(option.machine)} />,
    keepOpen: true,
    run: async () => run(option.environmentId),
  });

  const openAddProjectFlow = () => {
    if (addProjectEnvironmentOptions.length === 0) {
      onClose();
      appAtomRegistry.set(routeAtom, { kind: "settings", page: "connections" });
      return;
    }
    if (addProjectEnvironmentOptions.length > 1 || defaultAddProjectEnvironmentId === null) {
      pushPaletteView({
        addonIcon: null,
        groups: [
          {
            value: "environments",
            label: "Environments",
            items: addProjectEnvironmentOptions.map((option) =>
              buildEnvironmentItem(option, `action:add-project:environment:${option.environmentId}`, startAddProjectSourceSelection),
            ),
          },
        ],
      });
      return;
    }
    startAddProjectSourceSelection(defaultAddProjectEnvironmentId);
  };

  const newProjectEnvironmentOptions = addProjectEnvironmentOptions.filter(
    (option) => option.isConnected && newProjectsRootFor(option.environmentId) !== null,
  );

  // ── Theme items (CommandPaletteThemeItems) ───────────────────────────

  const themeCards = [
    { id: null as string | null, label: "T3 Code", previews: STANDARD_PREVIEWS },
    ...BUILT_IN_THEMES.map((definition) => ({
      id: definition.id as string | null,
      label: definition.label,
      previews: (["light", "dark"] as const).flatMap((mode) => {
        const colors = getThemeColorsForAppearance(definition, mode);
        return colors ? [{ mode, canvas: colors.canvas, accent: colors.accent }] : [];
      }),
    })),
  ];
  const changeThemeItem: CommandPaletteSubmenuItem = {
    kind: "submenu",
    value: "action:change-theme",
    searchTerms: ["change theme", "appearance", "colors", "palette"],
    title: "Change theme",
    icon: <ItemIcon name="palette" />,
    addonIcon: null,
    shortcutCommand: "theme.select",
    groups: [
      {
        value: "themes",
        label: "Change theme",
        items: themeCards.map(({ id, label, previews }) => ({
          kind: "action" as const,
          value: id === null ? "theme:standard" : `theme:palette:${id}`,
          title: label,
          ...(previews.length === 1 ? { description: `For ${previews[0]!.mode} mode` } : {}),
          searchTerms: [label, "theme", "appearance"],
          icon: <ItemIcon name="palette" />,
          titleTrailingContent: (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
              {(themeHalves[resolvedAppearance] ?? null) === id ? <CurrentLabel /> : null}
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                {previews.map((preview) => (
                  <ThemePreviewDot key={preview.mode} canvas={preview.canvas} accent={preview.accent} />
                ))}
              </div>
            </div>
          ),
          run: async () => {
            const saved =
              previews.length === 1 && id !== null ? setThemeHalf(previews[0]!.mode, id) : setTheme(id ?? appearanceMode);
            if (!saved) notifyThemeSaveFailure();
          },
        })),
      },
    ],
  };
  const changeAppearanceItem: CommandPaletteSubmenuItem = {
    kind: "submenu",
    value: "action:change-appearance",
    searchTerms: ["change appearance", "light", "dark", "system", "mode", "toggle"],
    title: "Change appearance",
    icon: <ItemIcon name="monitor" />,
    addonIcon: null,
    shortcutCommand: "appearance.cycle",
    groups: [
      {
        value: "appearance",
        label: "Change appearance",
        items: APPEARANCE_OPTIONS.map(({ mode, label, icon }) => ({
          kind: "action" as const,
          value: `appearance:${mode}`,
          title: label,
          searchTerms: [label, "appearance", "mode"],
          icon: <ItemIcon name={icon} />,
          ...(appearanceMode === mode ? { titleTrailingContent: <CurrentLabel /> } : {}),
          run: async () => {
            if (!setAppearanceMode(mode)) notifyThemeSaveFailure();
          },
        })),
      },
    ],
  };

  // ── Actions ───────────────────────────────────────────────────────────

  const activeEnvironmentConfig =
    activeThread === null ? null : (environmentById.get(activeThread.environmentId)?.serverConfig ?? null);
  const supportsThreadFind = activeEnvironmentConfig?.threadFind === true;
  const copyTarget = activeThread ? readActiveThreadReferenceCopyTarget() : null;

  const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];
  if (projects.length > 0) {
    const activeProjectTitle = contextualProject?.title ?? null;
    if (activeProjectTitle) {
      actionItems.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: <BoldTitle prefix="New thread in " bold={activeProjectTitle} />,
        icon: <ItemIcon name="square-pen" />,
        shortcutCommand: "chat.newLocal",
        run: async () => {
          if (contextualProject) startNewThread(scopeProjectRef(contextualProject.environmentId, contextualProject.id));
        },
      });
    }
    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "New thread in...",
      icon: <ItemIcon name="square-pen" />,
      addonIcon: null,
      groups: [{ value: "projects", label: "Projects", items: projectThreadItems }],
    });
  }
  if (scratchTargetEnvironmentId !== null) {
    actionItems.push({
      kind: "action",
      value: "action:new-thread-without-project",
      searchTerms: ["new thread", "no project", "without project", "none", "chat"],
      title: "New thread without a project",
      icon: <ItemIcon name="message-square-dashed" />,
      shortcutCommand: "chat.newWithoutProject",
      run: () => startScratchThread(scratchTargetEnvironmentId),
    });
  }
  if (activeThreadId && supportsThreadFind) {
    actionItems.push({
      kind: "action",
      value: "find-current-thread",
      title: "Find in current thread",
      searchTerms: ["find", "search", "messages", "plans"],
      icon: <ItemIcon name="text-search" />,
      shortcutCommand: "chat.find",
      run: async () => appAtomRegistry.set(findBarOpenAtom, true),
    });
  }
  if (copyTarget !== null) {
    actionItems.push({
      kind: "action",
      value: "action:copy-thread-reference",
      searchTerms: ["copy", "pull request", "pr link", "thread id", "reference"],
      title: copyTarget.kind === "pull-request" ? "Copy PR link" : "Copy thread ID",
      description: copyTarget.value,
      icon: <ItemIcon name="link" />,
      shortcutCommand: "thread.copyReference",
      run: copyActiveThreadReference,
    });
  }
  if (activeThread !== null && threadPullRequestLinkMode(activeEnvironmentConfig?.environment.capabilities) !== "unsupported") {
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    actionItems.push({
      kind: "action",
      value: "action:link-pull-request",
      searchTerms: ["link", "pull request", "pr", "attach", "stack"],
      title: "Link pull request to thread",
      icon: <ItemIcon name="link-2" />,
      run: async () => openLinkPullRequestDialog(threadRef),
    });
    if (activeEnvironmentConfig?.environment.capabilities.threadPullRequests === true) {
      actionItems.push({
        kind: "action",
        value: "action:open-thread-pull-requests",
        searchTerms: ["pull requests", "linked", "stack", "prs"],
        title: "Show linked pull requests",
        disabled: visibleThreadPullRequests(activeThread.pullRequests).length === 0,
        icon: <ItemIcon name="link-2" />,
        run: async () => {
          appAtomRegistry.set(rightPanelSurfaceAtom, "pull-request");
          appAtomRegistry.set(rightPanelOpenAtom, true);
        },
      });
    }
  }
  if (activeThread !== null) {
    const thread = activeThread;
    actionItems.push({
      kind: "action",
      value: "action:restart-agent-session",
      searchTerms: ["restart", "reset", "reload", "agent", "session", "skills", "plugins", "mcp"],
      title: "Restart agent session",
      icon: <ItemIcon name="rotate-ccw" />,
      run: async () => {
        const { environmentId } = thread;
        if (thread.runtime !== null) {
          const stopped = await runAtomCommand(appAtomRegistry, threadEnvironment.stopSession, {
            environmentId,
            input: { threadId: thread.id },
          });
          if (stopped._tag === "Failure") throw squashAtomCommandFailure(stopped);
        }
        toast({
          type: "success",
          title: "Agent session will restart",
          description: "Your next message starts a fresh session.",
        });
        const project = projectByKey.get(`${environmentId}:${thread.projectId}`);
        if (!project) return;
        const refreshed = await runAtomCommand(appAtomRegistry, serverEnvironment.refreshProviders, {
          environmentId,
          input: {
            instanceId: thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId,
            cwd: thread.worktreePath ?? project.workspaceRoot,
            fresh: true,
          },
        });
        if (refreshed._tag === "Failure") throw squashAtomCommandFailure(refreshed);
      },
    });
  }
  const returnContext: CommandPaletteReturnContext = { query, linkedThreadSearch };
  actionItems.push({
    kind: "action",
    value: "action:open-file-picker",
    searchTerms: ["go to file", "open file", "file picker", "find file", "quick open"],
    title: "Go to file",
    icon: <ItemIcon name="file-search" />,
    keepOpen: true,
    shortcutCommand: "filePicker.toggle",
    run: async () => dispatchCommandPalette({ _tag: "OpenChildSearch", mode: "files", context: returnContext }),
  });
  actionItems.push({
    kind: "action",
    value: "action:search-project-contents",
    searchTerms: ["search project", "find in files", "grep", "content search", "text search"],
    title: "Search project contents",
    icon: <ItemIcon name="text-search" />,
    keepOpen: true,
    shortcutCommand: "projectSearch.toggle",
    run: async () => dispatchCommandPalette({ _tag: "OpenChildSearch", mode: "content", context: returnContext }),
  });
  if (newProjectEnvironmentOptions.length > 0) {
    actionItems.push({
      kind: "action",
      value: "action:new-project",
      searchTerms: ["new project", "create project", "empty", "repository", "repo", "git init"],
      title: "New project",
      icon: <ItemIcon name="folder-git-2" />,
      keepOpen: true,
      run: async () => {
        const firstOption = newProjectEnvironmentOptions[0];
        if (firstOption) startNewProject(firstOption.environmentId, null);
      },
    });
  }
  actionItems.push({
    kind: "action",
    value: "action:add-project",
    searchTerms: [
      "add project",
      "folder",
      "directory",
      "browse",
      "clone",
      "remote",
      "repository",
      "repo",
      "git",
      ...sourceControlClients.definitions.flatMap((definition) =>
        definition.pickerLabel.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean),
      ),
      "url",
      "environment",
    ],
    title: "Add project",
    icon: <ItemIcon name="folder-plus" />,
    keepOpen: true,
    run: async () => openAddProjectFlow(),
  });
  actionItems.push(changeThemeItem);
  actionItems.push(changeAppearanceItem);
  if (environments.some((environment) => environment.serverConfig?.environment.capabilities.pullRequests === true)) {
    actionItems.push({
      kind: "action",
      value: "action:pull-requests",
      searchTerms: ["pull requests", "prs", "pr", "github", "review", "merge", "branch"],
      title: "Open pull requests",
      icon: <ItemIcon name="git-pull-request-arrow" />,
      run: async () => appAtomRegistry.set(routeAtom, { kind: "pull-requests" }),
    });
  }
  actionItems.push({
    kind: "action",
    value: "action:usage",
    searchTerms: ["usage", "use", "tokens", "cost", "spend", "limits", "stats", "analytics"],
    title: "Open usage",
    icon: <ItemIcon name="chart-no-axes-column" />,
    shortcutCommand: "usage.open",
    run: async () => appAtomRegistry.set(routeAtom, { kind: "usage" }),
  });
  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "Open settings",
    icon: <ItemIcon name="settings" />,
    run: async () => appAtomRegistry.set(routeAtom, { kind: "settings", page: "general" }),
  });
  if (contextualProject) {
    actionItems.push({
      kind: "action",
      value: "action:project-settings",
      searchTerms: ["project", "settings", "name", "icon", "scripts", "model", "workspace", "grouping", "checkout", "remove", "t3.json"],
      title: "Project settings",
      description: contextualProject.title,
      icon: <ItemIcon name="folder" />,
      // Web opens /projects/$projectKey; t3-term's settings has no per-project page yet.
      run: async () => appAtomRegistry.set(routeAtom, { kind: "settings", page: "general" }),
    });
  }

  // Apply an open intent (web's applyOpenIntent effect). Clearing it keeps this
  // component mounted, so the pushed view survives.
  useEffect(() => {
    if (openIntent === null) return;
    if (openIntent.kind === "new-thread-in" && projectThreadItems.length === 0) return;
    dispatchCommandPalette({ _tag: "ClearOpenIntent" });
    setAddProjectEnvironmentId(null);
    setAddProjectCloneFlow(null);
    setNewProjectFlow(null);
    setLinkedThreadSearch(openIntent.kind === "search" ? openIntent : null);
    dispatchSearch({ type: "reset", query: openIntent.kind === "search" ? openIntent.query : "" });
    resetHighlight();
    switch (openIntent.kind) {
      case "search":
        return;
      case "add-project":
        openAddProjectFlow();
        return;
      case "new-thread-in":
        pushPaletteView({ addonIcon: null, groups: [{ value: "projects", label: "Projects", items: projectThreadItems }] });
        return;
      case "change-theme":
        pushPaletteView({ addonIcon: null, groups: [{ value: "themes", label: "Change theme", items: [] }] });
        return;
    }
  }, [openIntent, projectThreadItems.length]);

  // ── Groups ────────────────────────────────────────────────────────────

  const rootGroups = buildRootGroups({ actionItems, recentThreadItems });
  const sourceSelectionViewValue = addProjectEnvironmentId === null ? null : `sources:${addProjectEnvironmentId}`;
  const activeGroups =
    addProjectEnvironmentId !== null && currentView !== null && currentView.groups[0]?.value === sourceSelectionViewValue
      ? buildAddProjectSourceGroups(addProjectEnvironmentId, buildPaletteRemoteSourceReadiness(sourceControlDiscovery.data))
      : currentView?.groups[0]?.value === "themes"
        ? changeThemeItem.groups
        : currentView?.groups[0]?.value === "appearance"
          ? changeAppearanceItem.groups
          : currentView?.groups[0]?.value === "projects"
            ? [{ value: "projects", label: "Projects", items: projectThreadItems }]
            : (currentView?.groups ?? rootGroups);
  const filteredGroups = filterCommandPaletteGroups({
    activeGroups,
    query,
    isInSubmenu: currentView !== null,
    projectSearchItems,
    threadSearchItems:
      linkedThreadSearch?.linkedThreads && query === linkedThreadSearch.query
        ? buildLinkedThreadActionItems({
            ...linkedThreadSearch.linkedThreads,
            query: linkedThreadSearch.query,
            icon: <ItemIcon name="message-square" />,
            runThread: async (thread) => openThread({ environmentId: thread.environmentId, threadId: thread.id }),
          })
        : allThreadItems,
  });

  // ── Add-project submit paths ─────────────────────────────────────────

  const handleAddProjectForEnvironment = async (input: {
    readonly environmentId: EnvironmentId;
    readonly rawCwd: string;
    readonly platform: string;
    readonly currentProjectCwd: string | null;
  }) => {
    const environment = environmentById.get(input.environmentId);
    if (!canCreateProjectInEnvironment(environment?.phase as never)) {
      toast({ type: "error", title: "Environment unavailable", description: `${environment?.label ?? "The selected environment"} is not connected.` });
      return;
    }
    const rawCwd = input.rawCwd;
    if (isUnsupportedWindowsProjectPath(rawCwd.trim(), input.platform)) {
      toast({ type: "error", title: "Failed to add project", description: "Windows-style paths are only supported on Windows." });
      return;
    }
    if (isExplicitRelativeProjectPath(rawCwd.trim()) && !input.currentProjectCwd) {
      toast({ type: "error", title: "Failed to add project", description: "Relative paths require an active project." });
      return;
    }
    const cwd = resolveProjectPathForDispatch(rawCwd, input.currentProjectCwd);
    if (cwd.length === 0) return;
    const existing = findProjectByPath(
      projects.filter((project) => project.environmentId === input.environmentId),
      cwd,
    );
    if (existing) {
      const latestThread = getLatestThreadForProject(
        threads.filter((thread) => thread.environmentId === existing.environmentId),
        existing.id,
        "updated_at",
      );
      if (latestThread && latestThread.settledOverride !== "settled") {
        openThread({ environmentId: latestThread.environmentId, threadId: latestThread.id });
      } else {
        startNewThread(scopeProjectRef(existing.environmentId, existing.id));
      }
      onClose();
      return;
    }
    const projectId = ProjectId.make(crypto.randomUUID());
    const createResult = await runAtomCommand(appAtomRegistry, projectEnvironment.create, {
      environmentId: input.environmentId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(cwd),
        workspaceRoot: cwd,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: null,
      },
    });
    if (createResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(createResult)) reportError("Failed to add project", squashAtomCommandFailure(createResult));
      return;
    }
    startNewThread(scopeProjectRef(input.environmentId, projectId));
    onClose();
  };

  const handleAddProject = async (rawCwd: string) => {
    if (!browseEnvironmentId) return;
    await handleAddProjectForEnvironment({
      environmentId: browseEnvironmentId,
      rawCwd,
      platform: browseEnvironmentPlatform,
      currentProjectCwd: currentProjectCwdForBrowse,
    });
  };

  const newProjectPublishTargets =
    newProjectFlow === null ? [] : getNewProjectPublishTargets(sourceControlDiscovery.data ?? null);
  const newProjectPublishTarget = getNewProjectPublishTarget(newProjectPublishTargets, newProjectPublishKind);
  const newProjectName = query.trim();
  const canSubmitNewProject =
    newProjectFlow !== null &&
    newProjectName.length > 0 &&
    !isCreatingNewProject &&
    canCreateProjectInEnvironment(browseEnvironment?.phase as never);

  async function submitNewProject(): Promise<void> {
    if (newProjectFlow === null || !canSubmitNewProject || newProjectSubmittingRef.current) return;
    newProjectSubmittingRef.current = true;
    setIsCreatingNewProject(true);
    const result = await runAtomCommand(appAtomRegistry, projectEnvironment.createNew, {
      environmentId: newProjectFlow.environmentId,
      input: { name: newProjectName },
    });
    newProjectSubmittingRef.current = false;
    setIsCreatingNewProject(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) reportError("Could not create the project", squashAtomCommandFailure(result));
      return;
    }
    const { projectId, workspaceRoot, commitError } = result.value;
    toast(
      commitError === undefined
        ? { type: "success", title: `Created ${newProjectName}`, description: workspaceRoot }
        : {
            type: "warning",
            title: `Created ${newProjectName} without a first commit`,
            description: `${commitError} The project is in ${workspaceRoot}.`,
          },
    );
    if (newProjectPublishes && newProjectPublishTarget) {
      const target = newProjectPublishTarget;
      void runAtomCommand(appAtomRegistry, sourceControlEnvironment.publishRepository, {
        environmentId: newProjectFlow.environmentId,
        input: {
          cwd: workspaceRoot,
          provider: target.definition.kind,
          repository: getNewProjectRepository(target, workspaceRoot),
          visibility: "private",
        },
      }).then((published) => {
        if (published._tag === "Failure") {
          if (!isAtomCommandInterrupted(published)) {
            toast({
              type: "error",
              title: `Could not create the ${target.definition.label} repository`,
              description: `${errorMessage(squashAtomCommandFailure(published))} Use Publish Repository in the Git menu to try again.`,
            });
          }
          return;
        }
        toast({ type: "success", title: `Published to ${target.definition.label}`, description: published.value.repository.nameWithOwner });
      });
    }
    startNewThread(scopeProjectRef(newProjectFlow.environmentId, projectId));
    onClose();
  }

  async function submitAddProjectCloneFlow(destinationPathInput?: string): Promise<void> {
    if (!addProjectCloneFlow) return;
    if (!canCreateProjectInEnvironment(browseEnvironment?.phase as never)) {
      toast({ type: "error", title: "Environment unavailable", description: `${browseEnvironment?.label ?? "The selected environment"} is not connected.` });
      return;
    }
    if (addProjectCloneFlow.step === "repository") {
      const rawRepository = query.trim();
      if (rawRepository.length === 0 || isRemoteProjectLookingUp) return;
      const provider = addProjectRemoteSourceProvider(addProjectCloneFlow.source);
      if (!provider) {
        const destinationPath = getCloneDestinationPath(
          getAddProjectInitialQueryForEnvironment(addProjectCloneFlow.environmentId),
          getCloneDirectoryName(rawRepository),
        );
        setAddProjectCloneFlow({
          step: "confirm",
          environmentId: addProjectCloneFlow.environmentId,
          source: addProjectCloneFlow.source,
          repositoryInput: rawRepository,
          repository: null,
          remoteUrl: normalizePastedCloneUrl(rawRepository),
        });
        resetHighlight();
        setQuery(destinationPath);
        return;
      }
      setIsRemoteProjectLookingUp(true);
      const lookupGeneration = ++cloneLookupGeneration.current;
      const lookupResult = await executeAtomQuery(
        appAtomRegistry,
        sourceControlEnvironment.repository({
          environmentId: addProjectCloneFlow.environmentId,
          input: { provider, repository: rawRepository },
        }),
        { label: "palette:repository-lookup", reportFailure: false },
      );
      if (lookupGeneration !== cloneLookupGeneration.current) return;
      setIsRemoteProjectLookingUp(false);
      if (lookupResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(lookupResult)) {
          toast({ type: "error", title: "Repository lookup failed", description: errorMessage(squashAtomCommandFailure(lookupResult)) });
        }
        return;
      }
      const repository = lookupResult.value;
      setAddProjectCloneFlow({
        step: "confirm",
        environmentId: addProjectCloneFlow.environmentId,
        source: addProjectCloneFlow.source,
        repositoryInput: rawRepository,
        repository,
        remoteUrl: getDefaultCloneUrl(repository),
      });
      resetHighlight();
      setQuery(
        getCloneDestinationPath(
          getAddProjectInitialQueryForEnvironment(addProjectCloneFlow.environmentId),
          getCloneDirectoryName(repository.nameWithOwner),
        ),
      );
      return;
    }
    const rawDestination = (destinationPathInput ?? query).trim();
    if (rawDestination.length === 0 || isRemoteProjectCloning) return;
    if (isUnsupportedWindowsProjectPath(rawDestination, browseEnvironmentPlatform)) {
      toast({ type: "error", title: "Clone failed", description: "Windows-style paths are only supported on Windows." });
      return;
    }
    if (isExplicitRelativeProjectPath(rawDestination) && !currentProjectCwdForBrowse) {
      toast({ type: "error", title: "Clone failed", description: "Relative paths require an active project." });
      return;
    }
    const destinationPath = resolveProjectPathForDispatch(rawDestination, currentProjectCwdForBrowse);
    if (destinationPath.length === 0) return;
    if (browseEnvironment?.serverConfig?.environment.capabilities.projectCloneTracking !== true) {
      setIsRemoteProjectCloning(true);
      const cloneResult = await runAtomCommand(appAtomRegistry, sourceControlEnvironment.cloneRepository, {
        environmentId: addProjectCloneFlow.environmentId,
        input: { remoteUrl: addProjectCloneFlow.remoteUrl, destinationPath },
      });
      setIsRemoteProjectCloning(false);
      if (cloneResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(cloneResult)) {
          toast({ type: "error", title: "Clone failed", description: errorMessage(squashAtomCommandFailure(cloneResult)) });
        }
        return;
      }
      await handleAddProject(cloneResult.value.cwd);
      return;
    }
    const projectId = ProjectId.make(crypto.randomUUID());
    setIsRemoteProjectCloning(true);
    const startResult = await runAtomCommand(appAtomRegistry, sourceControlEnvironment.startProjectClone, {
      environmentId: addProjectCloneFlow.environmentId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(destinationPath),
        createdAt: new Date().toISOString(),
        remoteUrl: addProjectCloneFlow.remoteUrl,
        destinationPath,
      },
    });
    setIsRemoteProjectCloning(false);
    if (startResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(startResult)) {
        toast({ type: "error", title: "Clone failed", description: errorMessage(squashAtomCommandFailure(startResult)) });
      }
      return;
    }
    onClose();
    startNewThread(scopeProjectRef(addProjectCloneFlow.environmentId, projectId));
  }

  const browseTo = (name: string): void => {
    const nextQuery = pinnedCloneDirectoryName
      ? getCloneDestinationBrowsePath({
          browseDirectoryPath: browsePath.directoryPath,
          selectedDirectoryName: name,
          cloneDirectoryName: pinnedCloneDirectoryName,
          caseSensitive: browseEnvironmentPlatform !== "Win32",
        })
      : appendBrowsePathSegment(query, name);
    resetHighlight();
    setQuery(nextQuery);
  };

  const browseUp = (): void => {
    const parentPath = browsePath.parentPath;
    if (parentPath === null) return;
    resetHighlight();
    setQuery(getCloneDestinationPath(parentPath, pinnedCloneDirectoryName));
  };

  const resolvedAddProjectPath = hasTrailingPathSeparator(query)
    ? (browseResult?.parentPath ?? query.trim())
    : (exactBrowseEntry?.fullPath ?? query.trim());
  const canBrowseUp = !relativePathNeedsActiveProject && browsePath.canBrowseUp;
  const browseGroups = buildBrowseGroups({
    browseEntries: visibleBrowseEntries,
    browseQuery: query,
    canBrowseUp,
    upIcon: <ItemIcon name="corner-left-up" />,
    directoryIcon: <ItemIcon name="folder" />,
    browseUp,
    browseTo,
  });
  const cloneDestinationBrowseGroups = browseGroups.map((group) =>
    group.value === "directories" ? { ...group, label: "Select where to clone" } : group,
  );

  const newProjectsRoot = newProjectFlow ? newProjectsRootFor(newProjectFlow.environmentId) : null;
  const newProjectPathPreview = newProjectsRoot === null ? null : getNewProjectPathPreview(newProjectsRoot, newProjectName);
  const newProjectPublishToggleValue = "new-project:publish";
  const showExistingProjectSources = (environmentId: EnvironmentId) => {
    const sourcesEnvironmentId = newProjectFlow?.sourcesEnvironmentId ?? null;
    if (sourcesEnvironmentId === environmentId) {
      popView();
      return;
    }
    if (sourcesEnvironmentId !== null) dispatchSearch({ type: "back" });
    popView();
    startAddProjectSourceSelection(environmentId);
  };
  const showNewProjectMachines =
    newProjectFlow !== null &&
    (newProjectEnvironmentOptions.length > 1 ||
      (newProjectEnvironmentOptions.every((option) => option.environmentId !== newProjectFlow.environmentId) &&
        newProjectEnvironmentOptions.length > 0));
  const newProjectEnvironmentLabel = showNewProjectMachines
    ? (environmentById.get(newProjectFlow!.environmentId)?.label ?? null)
    : null;

  let displayedGroups: CommandPaletteView["groups"] = filteredGroups;
  if (newProjectFlow !== null) {
    displayedGroups = [
      ...(showNewProjectMachines
        ? [
            {
              value: "new-project-machines",
              label: "Environments",
              items: newProjectEnvironmentOptions.map((option) => ({
                ...buildEnvironmentItem(option, `new-project:environment:${option.environmentId}`, (environmentId) => {
                  setNewProjectFlow((flow) => (flow === null ? flow : { ...flow, environmentId }));
                  setAddProjectEnvironmentId(environmentId);
                }),
                ...(isCreatingNewProject ? { disabled: true } : {}),
                ...(option.environmentId === newProjectFlow.environmentId
                  ? { titleTrailingContent: <Icon name="check" size={16} color={alpha(theme.mutedForeground, 0.7)} /> }
                  : {}),
              })),
            },
          ]
        : []),
      ...(newProjectPublishTarget === null || newProjectPathPreview === null
        ? []
        : [
            {
              value: "new-project-options",
              label: "Options",
              items: [
                {
                  kind: "action" as const,
                  value: newProjectPublishToggleValue,
                  searchTerms: [],
                  title:
                    newProjectPublishTargets.length > 1
                      ? "Create private repository"
                      : `Create private repository on ${newProjectPublishTarget.definition.label}`,
                  description:
                    newProjectName.length > 0
                      ? getNewProjectRepository(newProjectPublishTarget, newProjectPathPreview)
                      : (newProjectPublishTarget.owner ?? `Your ${newProjectPublishTarget.definition.label} account`),
                  icon: <ItemIcon name={hostIcon(newProjectPublishTarget.definition.kind)} />,
                  titleTrailingContent: (
                    <Icon
                      name={newProjectPublishes ? "square-check" : "square"}
                      size={16}
                      color={newProjectPublishes ? theme.primary : theme.mutedForeground}
                    />
                  ),
                  ...(isCreatingNewProject ? { disabled: true } : {}),
                  keepOpen: true,
                  run: async () => setNewProjectPublishes((publishes) => !publishes),
                },
              ],
            },
          ]),
      {
        value: "new-project-existing",
        label: "",
        items: [
          {
            kind: "action" as const,
            value: "new-project:existing",
            searchTerms: [],
            title: "Add existing project",
            description: "Open a folder or clone a repository",
            icon: <ItemIcon name="folder-plus" />,
            titleTrailingContent: <Icon name="chevron-right" size={16} color={alpha(theme.mutedForeground, 0.7)} />,
            keepOpen: true,
            run: async () => showExistingProjectSources(newProjectFlow.environmentId),
          },
        ],
      },
    ];
  } else if (addProjectCloneFlow?.step === "repository") {
    displayedGroups = [];
  } else if (addProjectCloneFlow?.step === "confirm") {
    displayedGroups = relativePathNeedsActiveProject ? [] : cloneDestinationBrowseGroups;
  } else if (isBrowsing) {
    displayedGroups = relativePathNeedsActiveProject ? [] : browseGroups;
  }
  const resultRows = buildCommandPaletteRows(displayedGroups);
  const autoHighlightsFirstRow = !isBrowsing && !isRemoteProjectCloneFlow && newProjectFlow === null;
  const firstItemValue = autoHighlightsFirstRow ? (resultRows.itemValues[0] ?? null) : null;
  // keepHighlight: a highlighted row that left the list falls back to the first.
  const effectiveHighlight =
    highlightedItemValue !== null && resultRows.itemValues.includes(highlightedItemValue)
      ? highlightedItemValue
      : highlightCleared
        ? null
        : firstItemValue;

  const isSubmenu = paletteMode === "submenu" || paletteMode === "submenu-browse";
  const hasHighlightedBrowseItem = effectiveHighlight?.startsWith("browse:") ?? false;
  const canCreateProject = browseEnvironmentId !== null;
  const isCloneDestinationStep = addProjectCloneFlow?.step === "confirm";
  const canSubmitBrowsePath =
    isBrowsing &&
    !relativePathNeedsActiveProject &&
    canCreateProject &&
    canCreateProjectInEnvironment(browseEnvironment?.phase as never);
  const willCreateProjectPath =
    canSubmitBrowsePath &&
    !isBrowsePending &&
    browseAccessError === null &&
    query.trim().length > 0 &&
    !hasHighlightedBrowseItem &&
    (hasTrailingPathSeparator(query) ? !browseResult : exactBrowseEntry === null);
  const submitModifierLabel = HOST_PLATFORM === "MacIntel" ? "⌘" : "Ctrl";
  const submitActionLabel = isCloneDestinationStep
    ? willCreateProjectPath
      ? "Create & Clone"
      : "Clone"
    : willCreateProjectPath
      ? "Create & Add"
      : "Add";
  const addShortcutLabel = hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter";
  const hasHighlightedNewProjectItem = newProjectFlow !== null && effectiveHighlight !== null;
  const createShortcutLabel = hasHighlightedNewProjectItem ? `${submitModifierLabel} Enter` : "Enter";
  const remoteProjectButtonLabel = addProjectCloneFlow ? (addProjectCloneFlow.source === "url" ? "Continue" : "Lookup") : null;
  const isRemoteProjectPending = isRemoteProjectLookingUp || isRemoteProjectCloning;
  const canSubmitRemoteProjectFlow =
    addProjectCloneFlow?.step === "repository" &&
    query.trim().length > 0 &&
    canCreateProjectInEnvironment(browseEnvironment?.phase as never) &&
    !isRemoteProjectPending;

  // promptForPaths picks a folder on this machine, so it only makes sense for
  // the environment t3-term treats as local.
  const canOpenProjectFromFileManager =
    isBrowsing && browseEnvironmentId !== null && browseEnvironmentId === primaryEnvironmentId && typeof renderer.promptForPaths === "function";
  const fileManagerName =
    HOST_PLATFORM === "MacIntel" ? "Finder" : HOST_PLATFORM === "Win32" ? "File Explorer" : "Files";

  function executeItem(item: PaletteItem): void {
    if (item.disabled) return;
    if (item.kind === "submenu") {
      pushPaletteView(item);
      return;
    }
    if (!item.keepOpen) onClose();
    void item.run().catch((error: unknown) => {
      toast({
        type: "error",
        title: "Unable to run command",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    });
  }

  function moveHighlight(delta: 1 | -1): void {
    const values = resultRows.itemValues;
    if (values.length === 0) return;
    const index = effectiveHighlight === null ? -1 : values.indexOf(effectiveHighlight);
    const next =
      index === -1 ? (delta === 1 ? values[0]! : values[values.length - 1]!) : values[(index + delta + values.length) % values.length]!;
    setHighlightedItemValue(next);
    setHighlightCleared(false);
    setScrollNonce((nonce) => nonce + 1);
  }

  function submitBrowsePath(): void {
    if (isCloneDestinationStep) void submitAddProjectCloneFlow(resolvedAddProjectPath);
    else void handleAddProject(resolvedAddProjectPath);
  }

  function handleSubmit(): void {
    if (addProjectCloneFlow?.step === "repository") {
      void submitAddProjectCloneFlow();
      return;
    }
    if (newProjectFlow !== null && !hasHighlightedNewProjectItem) {
      void submitNewProject();
      return;
    }
    if (canSubmitBrowsePath && !hasHighlightedBrowseItem) {
      submitBrowsePath();
      return;
    }
    const item = findHighlightedCommandPaletteItem(displayedGroups, effectiveHighlight ?? firstItemValue);
    if (item) executeItem(item);
  }

  function handleKeyDown(event: KeyEvent): void {
    const key = event.key;
    const modifiers = event.modifiers;
    const primaryModifier = HOST_PLATFORM === "MacIntel" ? modifiers?.cmd === true : modifiers?.ctrl === true;
    if (key === "escape") {
      if (viewStack.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        popView();
      }
      return;
    }
    if (key === "enter" && primaryModifier) {
      event.preventDefault();
      event.stopPropagation();
      if (newProjectFlow !== null) void submitNewProject();
      else if (canSubmitBrowsePath) submitBrowsePath();
      return;
    }
    if (!modifiers?.ctrl && !modifiers?.cmd && !modifiers?.alt && !modifiers?.shift) {
      if (key === "down" || key === "up") {
        event.preventDefault();
        event.stopPropagation();
        moveHighlight(key === "down" ? 1 : -1);
      }
      return;
    }
    const command = resolveKeyEventCommand(event, { modelPickerOpen: false, editableFocus: true });
    if (command === null) return;
    // Global new-thread and jump shortcuts run the matching visible item.
    const isJump = threadJumpIndexFromCommand(command) !== null;
    const isNewThread = command === "chat.new" || command === "chat.newLocal" || command === "chat.newWithoutProject";
    if (isJump || isNewThread) {
      const matchingItem = displayedGroups.flatMap((group) => group.items).find((item) => item.shortcutCommand === command);
      if (isJump || matchingItem) {
        event.preventDefault();
        event.stopPropagation();
        if (matchingItem) executeItem(matchingItem);
      }
      return;
    }
    if (command === "thread.copyReference") {
      event.preventDefault();
      event.stopPropagation();
      if (copyTarget === null) return;
      onClose();
      void copyActiveThreadReference();
      return;
    }
    if (command === "chat.find" && activeThreadId) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      appAtomRegistry.set(findBarOpenAtom, true);
    }
    // Palette toggles, usage and theme shortcuts bubble to the window handler.
  }

  const handleOpenProjectFromFileManager = async () => {
    if (!canOpenProjectFromFileManager || isPickingProjectFolder) return;
    setIsPickingProjectFolder(true);
    let picked: string[] | null = null;
    try {
      picked = (await renderer.promptForPaths?.({ directories: true, files: false, multiple: false })) ?? null;
    } catch {
      picked = null;
    }
    setIsPickingProjectFolder(false);
    const pickedPath = picked?.[0];
    if (pickedPath) await handleAddProject(pickedPath);
  };

  const inputAccessory =
    newProjectFlow !== null ? (
      <PaletteSubmitButton
        label={isCreatingNewProject ? "Creating" : "Create"}
        shortcutLabel={createShortcutLabel}
        disabled={!canSubmitNewProject}
        onSubmit={() => void submitNewProject()}
      />
    ) : addProjectCloneFlow?.step === "repository" ? (
      <PaletteSubmitButton
        label={isRemoteProjectPending ? "Working" : (remoteProjectButtonLabel ?? "Continue")}
        shortcutLabel="Enter"
        disabled={!canSubmitRemoteProjectFlow}
        onSubmit={() => void submitAddProjectCloneFlow()}
      />
    ) : isBrowsing ? (
      <PaletteSubmitButton
        label={isCloneDestinationStep && isRemoteProjectPending ? "Cloning" : submitActionLabel}
        shortcutLabel={addShortcutLabel}
        disabled={
          !canCreateProject ||
          !canCreateProjectInEnvironment(browseEnvironment?.phase as never) ||
          relativePathNeedsActiveProject ||
          (isCloneDestinationStep && isRemoteProjectPending)
        }
        onSubmit={() => {
          if (!relativePathNeedsActiveProject) submitBrowsePath();
        }}
      />
    ) : null;

  const footerActionLabel =
    newProjectFlow !== null
      ? effectiveHighlight === null
        ? "Create"
        : effectiveHighlight === newProjectPublishToggleValue
          ? "Toggle"
          : "Select"
      : addProjectCloneFlow?.step === "repository"
        ? (remoteProjectButtonLabel ?? "Continue")
        : !canSubmitBrowsePath || hasHighlightedBrowseItem
          ? "Select"
          : null;

  const inputPlaceholder =
    newProjectFlow !== null
      ? "Project name"
      : (remoteProjectInputPlaceholder(addProjectCloneFlow) ?? getCommandPaletteInputPlaceholder(paletteMode));

  const emptyStateMessage =
    addProjectCloneFlow?.step === "repository"
      ? addProjectCloneFlow.source === "url"
        ? "Enter a Git clone URL and press Enter to continue."
        : "Enter a repository path and press Enter to look it up."
      : addProjectCloneFlow?.step === "confirm"
        ? "Choose a destination path and press Enter to clone."
        : relativePathNeedsActiveProject
          ? "Relative paths require an active project."
          : willCreateProjectPath
            ? "Press Enter to create this folder and add it as a project."
            : threadSearch.isPending
              ? "Searching thread messages…"
              : isActionsOnly
                ? "No matching actions."
                : "No matching commands, projects, or threads.";

  const footerTrailing: ReactNode = canOpenProjectFromFileManager ? (
    <div
      testId="command-palette-open-file-manager"
      onClick={isPickingProjectFolder ? undefined : () => void handleOpenProjectFromFileManager()}
      style={{ display: "flex", alignItems: "center", paddingLeft: 8, paddingRight: 8, cursor: isPickingProjectFolder ? "default" : "pointer", opacity: isPickingProjectFolder ? 0.64 : 1 }}
    >
      <Text size="xs" weight={500} color={theme.mutedForeground}>
        {`Open in ${fileManagerName}`}
      </Text>
    </div>
  ) : null;

  return (
    <PaletteFrame onClose={onClose} initialFocus={inputRef}>
      <PaletteInput
        inputRef={inputRef}
        value={query}
        placeholder={inputPlaceholder}
        onChange={handleQueryChange}
        onKeyDown={handleKeyDown}
        onSubmit={handleSubmit}
        leading={isSubmenu ? "back" : isBrowsing ? "folder-plus" : "search"}
        onBack={popView}
        accessory={inputAccessory}
      />
      {newProjectPathPreview !== null ? (
        <SummaryRow
          icon="folder-git-2"
          title={newProjectName.length > 0 ? newProjectName : "New project"}
          description={`${newProjectName.length > 0 ? `Creates ${newProjectPathPreview}` : `Goes in ${newProjectsRoot}`}${
            newProjectEnvironmentLabel === null ? "" : ` on ${newProjectEnvironmentLabel}`
          }`}
        />
      ) : null}
      {addProjectCloneFlow?.step === "confirm" ? (
        <SummaryRow
          heading="Repository"
          icon={remoteSourceIcon(addProjectCloneFlow.source)}
          title={addProjectCloneFlow.repository?.nameWithOwner ?? addProjectCloneFlow.repositoryInput}
          description={addProjectCloneFlow.repository?.url ?? addProjectCloneFlow.remoteUrl}
        />
      ) : null}
      {browseAccessError ? (
        <PaletteNotice message={browseAccessError} />
      ) : isBrowsePending && browseResult === null ? (
        <PaletteNotice message="Loading folders..." />
      ) : null}
      <PaletteRows
        rows={resultRows.rows}
        highlightedValue={effectiveHighlight}
        keybindings={keybindings}
        onExecute={executeItem}
        onHighlight={(value) => {
          setHighlightedItemValue(value);
          setHighlightCleared(false);
        }}
        scrollToHighlight={scrollNonce}
        emptyMessage={emptyStateMessage}
      />
      <PaletteFooter actionLabel={footerActionLabel} backHint={isSubmenu ? "Back" : null} trailing={footerTrailing} />
    </PaletteFrame>
  );
}
