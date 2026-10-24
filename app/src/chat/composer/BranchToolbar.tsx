// Port of apps/web/src/components/BranchToolbar.tsx (layout "composer") for new-thread
// drafts: the ComposerSurface.ContextStrip under the composer with the run-context menu
// (workspace, and the machine when the project lives on more than one) and the branch
// selector. Workspace choices are stored on the draft with `setDraftWorkspace`.
//
// The composer is at most 736 wide, under web's @3xl (768) container breakpoint, so the
// strip always shows web's narrow layout: RunContextSelector, not the separate
// BranchToolbarEnvModeSelector / BranchToolbarEnvironmentSelector pair.
import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ProjectId,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Option from "effect/Option";
import { useEffect } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  composerDraftAtom,
  composerMenuOpenAtom,
  composerSettingsAtom,
  moveComposerDraftContent,
  setDraftWorkspace,
} from "../../state/composer.ts";
import { composerSendingAtom } from "./composerSend.ts";
import { openScratchProject } from "../../palette/actions.ts";
import { composerVcsEnvironment, useEnvironmentQuery } from "../../state/composerQueries.ts";
import {
  environmentCatalog,
  environmentProjects,
  environmentServerConfigsAtom,
  environmentThreadShells,
  serverEnvironment,
} from "../../state/environment.ts";
import { routeAtom } from "../../state/ui.ts";
import type { IconName } from "../../ui/Icon.tsx";
import { Popover } from "../../ui/overlay.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  resolveCurrentWorkspaceLabel,
  resolveEnvironmentOptionLabel,
  resolveEnvModeLabel,
  resolvePreviousWorktreeLabel,
  resolvePreviousWorktreeSeed,
  shouldShowEnvironmentIndicator,
  type EnvironmentOption,
  type EnvMode,
} from "../../web/components/BranchToolbar.logic.ts";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector.tsx";
import {
  BranchToolbarControl,
  BranchToolbarIcon,
  BranchToolbarMenuLabel,
  BranchToolbarMenuRow,
  BranchToolbarMenuText,
  type BranchToolbarControlIcon,
} from "./BranchToolbarControl.tsx";

export interface BranchToolbarProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly draftKey: string;
  readonly onComposerFocusRequest: () => void;
}

/** EnvironmentMachineIcon, mapped onto lucide (the Linux / Mac glyphs are web-local svgs). */
const MACHINE_ICON: Record<EnvironmentMachineKind, IconName> = {
  server: "server",
  cloud: "cloud",
  linux: "terminal",
  desktop: "monitor",
  laptop: "laptop",
  "mac-mini": "server",
  "mac-studio": "monitor",
};

export function BranchToolbar({ environmentId, projectId, draftKey, onComposerFocusRequest }: BranchToolbarProps) {
  const theme = useTheme();
  const projectRef = { environmentId, projectId };
  const project = useAtomValue(environmentProjects.projectAtom(projectRef));
  const draft = useAtomValue(composerDraftAtom(draftKey));
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const settings = useAtomValue(composerSettingsAtom(environmentId));
  const projectThreads = useAtomValue(environmentThreadShells.threadShellsForProjectRefsAtom([projectRef]));
  const [menuOpen, setMenuOpen] = useAtom(composerMenuOpenAtom);
  const environments = useLogicalProjectEnvironments(project);

  const projectCwd = project?.workspaceRoot ?? null;
  const activeWorktreePath = draft.worktreePath ?? null;
  const branchCwd = activeWorktreePath ?? projectCwd;
  const status = useEnvironmentQuery(
    branchCwd === null ? null : composerVcsEnvironment.status({ environmentId, input: { cwd: branchCwd } }),
  );
  // Unknown until the first status lands; web assumes a repo meanwhile so the strip does not pop in.
  const showGitControls = status.data?.isRepo ?? true;
  const currentGitBranch = status.data?.refName ?? null;

  // The default the web app stamps on a new draft (useHandleNewThread resolveDefaultEnvMode).
  // The .t3 project file is not read here, so a project-file default does not apply.
  const projectSettings =
    serverConfig && project ? resolveProjectSettings(serverConfig.settings, project.id, project, null) : null;
  const defaultEnvMode: EnvMode | null =
    projectSettings && project
      ? resolveNewThreadEnvMode({
          projectSettings,
          workspaceRoot: project.workspaceRoot,
          newProjectsRoot: serverConfig?.newProjectsRoot,
          projectHasThreads: projectThreads.length > 0,
        })
      : null;
  const newWorktreesStartFromOrigin = projectSettings?.settings.newWorktreesStartFromOrigin ?? false;
  useEffect(() => {
    if (draft.envMode !== undefined || defaultEnvMode === null) return;
    setDraftWorkspace(draftKey, {
      envMode: defaultEnvMode,
      startFromOrigin: defaultEnvMode === "worktree" && newWorktreesStartFromOrigin,
    });
  }, [defaultEnvMode, draft.envMode, draftKey, newWorktreesStartFromOrigin]);

  const effectiveEnvMode: EnvMode = activeWorktreePath ? "local" : (draft.envMode ?? defaultEnvMode ?? "local");
  const startFromOrigin = draft.startFromOrigin ?? false;

  const previousWorktreeSeed = resolvePreviousWorktreeSeed({
    threads: projectThreads,
    currentWorktreePath: activeWorktreePath,
  });
  const previousWorktreeLabel = previousWorktreeSeed ? resolvePreviousWorktreeLabel(previousWorktreeSeed) : null;

  const activeEnvironment = environments.find((env) => env.environmentId === environmentId) ?? null;
  const canPickEnvironment = environments.length > 1;
  const showEnvironmentIndicator = shouldShowEnvironmentIndicator({ activeEnvironment, canPickEnvironment });

  if (!project || projectCwd === null) return null;
  if (!showGitControls && !showEnvironmentIndicator) return null;

  const onEnvModeChange = (mode: EnvMode) => {
    setDraftWorkspace(draftKey, {
      envMode: mode,
      startFromOrigin: mode === "worktree" && newWorktreesStartFromOrigin,
      ...(mode === "worktree" && activeWorktreePath ? { worktreePath: null } : {}),
    });
    onComposerFocusRequest();
  };
  const onUsePreviousWorktree = () => {
    if (!previousWorktreeSeed) return;
    setDraftWorkspace(draftKey, {
      branch: previousWorktreeSeed.branch,
      worktreePath: previousWorktreeSeed.worktreePath,
      envMode: "worktree",
    });
    onComposerFocusRequest();
  };
  const onEnvironmentChange = (option: EnvironmentOption) => {
    if (option.environmentId === environmentId) return;
    // The draft goes along to the other machine (web retargets it rather than opening another).
    if (appAtomRegistry.get(composerSendingAtom(draftKey))) return;
    const retarget = (projectId: ProjectId) => {
      // A send that started meanwhile owns the draft.
      if (appAtomRegistry.get(composerSendingAtom(draftKey))) return;
      const draftId = moveComposerDraftContent(draftKey, { environmentId: option.environmentId, projectId });
      appAtomRegistry.set(routeAtom, {
        kind: "draft",
        environmentId: option.environmentId,
        projectId,
        ...(draftId ? { draftId } : {}),
      });
    };
    if (option.projectId !== null) {
      retarget(option.projectId);
      return;
    }
    // web: a machine without this project gets the draft in its scratch project.
    void openScratchProject(option.environmentId, "Could not switch machine").then((project) => {
      if (project) retarget(project.id);
    });
  };

  const runContextOpen = menuOpen === "env-mode" || menuOpen === "environment";
  const setRunContextOpen = (open: boolean) => {
    if (open) setMenuOpen("env-mode");
    else if (runContextOpen) setMenuOpen(null);
  };
  const branchOpen = menuOpen === "branch";

  return (
    // ComposerSurface.ContextStrip. Composer.tsx places it (inset 22 a side, its top 16px
    // behind the surface), so this renders only the box. Web draws the outline on a
    // ::before over the padding; here the 1px borders come out of the padding instead.
    <div
      testId="composer-context-strip"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 4,
        width: "100%",
        minWidth: 0,
        paddingTop: 19,
        paddingBottom: 3,
        paddingLeft: 7,
        paddingRight: 7,
        backgroundColor: theme.card,
        borderWidth: 1,
        borderColor: theme.appearance === "dark" ? alpha("#ffffff", 0.07) : alpha("#000000", 0.08),
        borderBottomLeftRadius: RADIUS["2xl"],
        borderBottomRightRadius: RADIUS["2xl"],
      }}
    >
        {showGitControls || showEnvironmentIndicator ? (
          <RunContextSelector
            open={runContextOpen}
            onOpenChange={setRunContextOpen}
            effectiveEnvMode={effectiveEnvMode}
            activeWorktreePath={activeWorktreePath}
            showGitControls={showGitControls}
            environments={environments}
            environmentId={environmentId}
            showEnvironmentIndicator={showEnvironmentIndicator}
            canPickEnvironment={canPickEnvironment}
            previousWorktreeLabel={previousWorktreeLabel}
            onEnvModeChange={onEnvModeChange}
            onUsePreviousWorktree={onUsePreviousWorktree}
            onEnvironmentChange={onEnvironmentChange}
          />
        ) : null}
        {showGitControls ? (
          <BranchToolbarBranchSelector
            environmentId={environmentId}
            draftKey={draftKey}
            projectCwd={projectCwd}
            draftBranch={draft.branch ?? null}
            worktreePath={activeWorktreePath}
            effectiveEnvMode={effectiveEnvMode}
            currentGitBranch={currentGitBranch}
            startFromOrigin={startFromOrigin}
            onStartFromOriginChange={(next) => setDraftWorkspace(draftKey, { startFromOrigin: next })}
            open={branchOpen}
            onOpenChange={(open) => {
              if (open) setMenuOpen("branch");
              else if (branchOpen) setMenuOpen(null);
            }}
            onComposerFocusRequest={onComposerFocusRequest}
            onRefsChanged={status.refresh}
          />
        ) : null}
    </div>
  );
}

function RunContextSelector(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  showGitControls: boolean;
  environments: ReadonlyArray<EnvironmentOption>;
  environmentId: EnvironmentId;
  showEnvironmentIndicator: boolean;
  canPickEnvironment: boolean;
  previousWorktreeLabel: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  onUsePreviousWorktree: () => void;
  onEnvironmentChange: (option: EnvironmentOption) => void;
}) {
  const theme = useTheme();
  const activeEnvironment = props.environments.find((env) => env.environmentId === props.environmentId) ?? null;
  const workspaceIcon: IconName =
    props.effectiveEnvMode === "worktree" ? "folder-git-2" : props.activeWorktreePath ? "folder-git" : "folder";
  const workspaceLabel =
    props.effectiveEnvMode === "worktree"
      ? resolveEnvModeLabel("worktree")
      : resolveCurrentWorkspaceLabel(props.activeWorktreePath);
  const icons: BranchToolbarControlIcon[] = props.showEnvironmentIndicator
    ? [{ name: MACHINE_ICON[activeEnvironment?.machine ?? "server"] }, { name: workspaceIcon }]
    : [{ name: workspaceIcon }];
  const label = props.showEnvironmentIndicator ? (activeEnvironment?.label ?? "Run on") : workspaceLabel;
  const close = () => props.onOpenChange(false);

  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      side="top"
      align="start"
      testId="run-context-menu"
      rootStyle={{ flexShrink: 0, maxWidth: "48%" }}
      style={{ padding: 4, minWidth: 160, ...(props.previousWorktreeLabel ? { width: 336 } : {}) }}
      trigger={
        <BranchToolbarControl
          testId="branch-toolbar-run-context"
          icons={icons}
          label={label}
          pressed={props.open}
          onClick={() => props.onOpenChange(!props.open)}
        />
      }
    >
      {props.canPickEnvironment ? (
        <>
          <BranchToolbarMenuLabel>Run on</BranchToolbarMenuLabel>
          {props.environments.map((env) => (
            <BranchToolbarMenuRow
              key={env.environmentId}
              testId={`run-context-environment-${env.environmentId}`}
              highlighted={env.environmentId === props.environmentId}
              onSelect={() => {
                close();
                props.onEnvironmentChange(env);
              }}
            >
              <BranchToolbarIcon name={MACHINE_ICON[env.machine]} color={theme.foreground} />
              <BranchToolbarMenuText>{env.label}</BranchToolbarMenuText>
            </BranchToolbarMenuRow>
          ))}
          <div
            style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: -4, marginRight: -4, backgroundColor: theme.border, flexShrink: 0 }}
          />
        </>
      ) : null}
      {props.showGitControls ? (
        <>
          <BranchToolbarMenuLabel>Workspace</BranchToolbarMenuLabel>
          <BranchToolbarMenuRow
            testId="run-context-local"
            highlighted={props.effectiveEnvMode === "local"}
            onSelect={() => {
              close();
              props.onEnvModeChange("local");
            }}
          >
            <BranchToolbarIcon name={props.activeWorktreePath ? "folder-git" : "folder"} color={theme.foreground} />
            <BranchToolbarMenuText>{resolveCurrentWorkspaceLabel(props.activeWorktreePath)}</BranchToolbarMenuText>
          </BranchToolbarMenuRow>
          <BranchToolbarMenuRow
            testId="run-context-worktree"
            highlighted={props.effectiveEnvMode === "worktree" && !props.activeWorktreePath}
            onSelect={() => {
              close();
              props.onEnvModeChange("worktree");
            }}
          >
            <BranchToolbarIcon name="folder-git-2" color={theme.foreground} />
            <BranchToolbarMenuText>{resolveEnvModeLabel("worktree")}</BranchToolbarMenuText>
          </BranchToolbarMenuRow>
          {props.previousWorktreeLabel ? (
            <BranchToolbarMenuRow
              testId="run-context-previous-worktree"
              onSelect={() => {
                close();
                props.onUsePreviousWorktree();
              }}
            >
              <BranchToolbarIcon name="folder-git" color={theme.foreground} />
              <BranchToolbarMenuText>{props.previousWorktreeLabel}</BranchToolbarMenuText>
            </BranchToolbarMenuRow>
          ) : null}
        </>
      ) : null}
    </Popover>
  );
}

/** apps/web/src/hooks/useLogicalProjectEnvironments.ts: the machines this project lives on. */
function useLogicalProjectEnvironments(
  activeProject: EnvironmentProject | null,
): ReadonlyArray<EnvironmentOption> {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const allProjects = useAtomValue(environmentProjects.projectsAtom);
  const settings = useAtomValue(composerSettingsAtom(activeProject?.environmentId ?? null));
  const configs = useAtomValue(environmentServerConfigsAtom);
  if (!activeProject) return [];
  const groupingSettings = selectProjectGroupingSettings(settings);
  const logicalKey = deriveLogicalProjectKeyFromSettings(activeProject, groupingSettings);
  const enabledIds = [...catalog.entries.entries()]
    .filter(([, entry]) => entry.enabled && entry.unsupportedReason === undefined)
    .map(([id]) => id);
  // t3-term has no local desktop server; the first connection plays the primary's part.
  const primaryEnvironmentId = enabledIds[0] ?? null;
  const seen = new Set<string>();
  const envs: EnvironmentOption[] = [];
  for (const project of allProjects) {
    if (seen.has(project.environmentId)) continue;
    if (deriveLogicalProjectKeyFromSettings(project, groupingSettings) !== logicalKey) continue;
    seen.add(project.environmentId);
    const entry = catalog.entries.get(project.environmentId);
    const config = configs.get(project.environmentId) ?? null;
    const isPrimary = project.environmentId === primaryEnvironmentId;
    envs.push({
      environmentId: project.environmentId,
      projectId: project.id,
      label: resolveEnvironmentOptionLabel({
        isPrimary,
        environmentId: project.environmentId,
        runtimeLabel: config?.environment.label ?? null,
        savedLabel: entry ? (Option.getOrNull(entry.profile)?.label ?? null) : null,
      }),
      isPrimary,
      machine: resolveEnvironmentMachineKind(config),
    });
  }
  envs.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return envs;
}
