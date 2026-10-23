// Ports of apps/web/src/components/settings/{ProjectsSettings,ProjectSettingsPanel}.tsx
// (+ ProjectSettingsPanel.logic.ts). Without a project scope the page lists the
// projects to choose from; with one it manages the project's name, icon,
// new-thread defaults, actions, checkouts and removal.
import { isAtomCommandInterrupted, mapAtomCommandResult, squashAtomCommandFailure, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { planProjectRemoval } from "@t3tools/client-runtime/state/projects";
import { AuthOrchestrationOperateScope, EnvironmentId, type ProjectIconOverride } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { environmentThreadShells, projectEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironments, useEnvironmentsWithScope } from "../../state/settings.ts";
import { ProjectFavicon } from "../../sidebar/ProjectFavicon.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Dialog } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { alpha, RADIUS, useTheme } from "../../ui/theme.ts";
import { ALL_ENVIRONMENTS_VALUE, selectEnvironmentAxis, settingsScopeEnvironmentLabels } from "../../web/components/settings/settingsScopeAxis.ts";
import type { SidebarProjectGroupMember, SidebarProjectSnapshot } from "../../web/sidebarProjectGrouping.ts";
import { DraftTextField } from "../controls.tsx";
import { SettingResetButton, SettingsMessage, SettingsPageContainer, SettingsRow, SettingsSection } from "../layout.tsx";
import { ProjectDefaultsSettings } from "../ProjectDefaultsSettings.tsx";
import { ProjectActionsSettings } from "../projects/ProjectActions.tsx";
import { ProjectFaviconPickerDialog, ProjectIconPickerDialog } from "../projects/IconPickers.tsx";
import { SettingsScopeNotice } from "../ScopeNotice.tsx";
import { useSettingsProjectGroups, useSettingsScope } from "../scope.tsx";

/** ProjectSettingsPanel.logic.ts */
function projectGroupTitleNeedsUpdate(memberTitles: ReadonlyArray<string>, nextTitle: string, wasEdited: boolean): boolean {
  return wasEdited && memberTitles.some((title) => title !== nextTitle);
}

export function ProjectsSettings() {
  const { search: value, scope, selectScope } = useSettingsScope();
  const unavailable =
    scope.kind === "unavailable" ? (
      <SettingsPageContainer>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
          <SettingsMessage>{scope.message}</SettingsMessage>
          {value.machine || value.checkout ? (
            <Button variant="outline" size="xs" icon="layers" onClick={() => selectScope(selectEnvironmentAxis(value, ALL_ENVIRONMENTS_VALUE))}>
              Show all environments
            </Button>
          ) : null}
        </div>
      </SettingsPageContainer>
    ) : null;
  const projectScope =
    scope.kind === "project" ||
    scope.kind === "checkout" ||
    (scope.kind === "unavailable" && (scope.reason === "project-missing" || scope.reason === "checkout-missing"));
  if (value.project && projectScope) {
    return (
      <ProjectSettingsPanel
        projectKey={value.project}
        environmentId={value.machine ? EnvironmentId.make(value.machine) : null}
        checkoutKey={value.checkout ?? null}
        unavailable={unavailable}
      />
    );
  }
  if (unavailable) return unavailable;
  return <SettingsScopeNotice target="project">Choose a project to manage its name, icon, checkouts and actions.</SettingsScopeNotice>;
}

function ProjectSettingsPanel({
  projectKey,
  environmentId,
  checkoutKey,
  unavailable,
}: {
  projectKey: string;
  environmentId: EnvironmentId | null;
  checkoutKey: string | null;
  unavailable: React.ReactNode;
}) {
  const groups = useSettingsProjectGroups();
  const selected = groups.find((group) => group.projectKey === projectKey) ?? null;
  const members =
    selected?.memberProjects.filter(
      (member) => (environmentId === null || member.environmentId === environmentId) && (checkoutKey === null || member.physicalProjectKey === checkoutKey),
    ) ?? [];
  if ((!selected || members.length === 0) && unavailable != null) return <>{unavailable}</>;
  if (!selected) {
    return (
      <SettingsPageContainer>
        <SettingsMessage>{groups.length === 0 ? "Add a project from the sidebar to configure it here." : "This project is no longer available."}</SettingsMessage>
      </SettingsPageContainer>
    );
  }
  if (members.length === 0) {
    return (
      <SettingsPageContainer>
        <SettingsMessage>This checkout is no longer available in the selected project and environment.</SettingsMessage>
      </SettingsPageContainer>
    );
  }
  const scopedGroup: SidebarProjectSnapshot = { ...selected, memberProjects: members, environmentId: members[0]!.environmentId, id: members[0]!.id };
  return (
    <ProjectDetail
      key={`${selected.projectKey}:${environmentId ?? "all"}:${checkoutKey ?? "all"}`}
      group={scopedGroup}
      hasOtherMembers={members.length < selected.memberProjects.length}
    />
  );
}

function InfoAlert({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 10,
        paddingBottom: 10,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: alpha(theme.info, 0.32),
        backgroundColor: alpha(theme.info, 0.08),
      }}
    >
      <Icon name="info" size={16} color={theme.infoForeground} />
      <Text color={theme.foreground}>{children}</Text>
    </div>
  );
}

function ProjectDetail({ group, hasOtherMembers }: { group: SidebarProjectSnapshot; hasOtherMembers: boolean }) {
  const theme = useTheme();
  const { selectScope, search } = useSettingsScope();
  const { environments } = useEnvironments();
  const environmentById = new Map(environments.map((environment) => [environment.environmentId, environment]));
  const editableIds = useEnvironmentsWithScope(group.memberProjects, AuthOrchestrationOperateScope);
  const canEditGroup = group.memberProjects.every((member) => editableIds.has(member.environmentId));
  const representative =
    group.memberProjects.find((member) => environmentById.get(member.environmentId)?.serverConfig != null) ?? group.memberProjects[0]!;
  const threads = useAtomValue(environmentThreadShells.threadShellsAtom);
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const faviconPath = representative.faviconPath ?? null;
  const projectIcon = representative.projectIcon ?? null;
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [faviconPickerOpen, setFaviconPickerOpen] = useState(false);
  const [isSavingFavicon, setIsSavingFavicon] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<{ members: ReadonlyArray<SidebarProjectGroupMember>; message: string } | null>(null);

  const reportFailure = (title: string, result: AtomCommandResult<void, unknown>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toast({ type: "error", title, description: error instanceof Error ? error.message : "An error occurred." });
  };
  const deniedMember = (members: ReadonlyArray<SidebarProjectGroupMember>) =>
    members.find((member) => !readEnvironmentScope(member.environmentId, AuthOrchestrationOperateScope));

  const updateAllMembers = async (
    input: Partial<{ title: string; faviconPath: string | null; projectIcon: ProjectIconOverride | null }>,
    failureTitle: string,
  ) => {
    const denied = deniedMember(group.memberProjects);
    if (denied) {
      toast({ type: "error", title: failureTitle, description: `This connection cannot change projects in ${denied.environmentLabel ?? "this environment"}.` });
      return;
    }
    const offline = group.memberProjects.find((member) => {
      const environment = environmentById.get(member.environmentId);
      return environment?.connection.phase !== "connected" || !environment.serverConfig;
    });
    if (offline) {
      toast({ type: "error", title: failureTitle, description: `Connect ${offline.environmentLabel ?? "the selected environment"} and try again.` });
      return;
    }
    for (const member of group.memberProjects) {
      const result = mapAtomCommandResult(
        await updateProject({ environmentId: member.environmentId, input: { projectId: member.id, ...input } }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        reportFailure(group.memberProjects.length > 1 ? `${failureTitle} on ${member.environmentLabel ?? "the current environment"}` : failureTitle, result);
        return;
      }
    }
  };

  const renameGroup = (nextTitle: string) => {
    const title = nextTitle.trim();
    if (!title) {
      toast({ type: "warning", title: "Project title cannot be empty" });
      return;
    }
    if (!projectGroupTitleNeedsUpdate(group.memberProjects.map((member) => member.title), title, true)) return;
    void updateAllMembers({ title }, "Failed to rename project");
  };

  const setProjectIcon = async (input: { faviconPath: string | null; projectIcon: ProjectIconOverride | null }) => {
    if (isSavingFavicon) return;
    setIsSavingFavicon(true);
    await updateAllMembers(input, "Failed to update project icon");
    setIsSavingFavicon(false);
  };

  const askRemoval = (members: ReadonlyArray<SidebarProjectGroupMember>) => {
    const denied = deniedMember(members);
    if (denied) {
      toast({ type: "error", title: "Failed to remove project", description: `This connection cannot change projects in ${denied.environmentLabel ?? "this environment"}.` });
      return;
    }
    const { confirmationMessage } = planProjectRemoval({
      members,
      groupMemberCount: group.memberProjects.length,
      hasOtherMembers,
      displayName: group.displayName,
      threads,
    });
    setPendingRemoval({ members, message: confirmationMessage });
  };

  const removeMembers = async (members: ReadonlyArray<SidebarProjectGroupMember>) => {
    const { isWholeGroup } = planProjectRemoval({ members, groupMemberCount: group.memberProjects.length, hasOtherMembers, displayName: group.displayName, threads });
    for (const member of members) {
      const result = mapAtomCommandResult(
        await deleteProject({ environmentId: member.environmentId, input: { projectId: member.id, force: true } }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        reportFailure(`Failed to remove "${member.title}"`, result);
        return;
      }
    }
    if (isWholeGroup && !hasOtherMembers) selectScope({ ...(search.machine ? { machine: search.machine } : {}) });
  };

  const hasMultipleCheckouts = group.memberProjects.length > 1;
  const checkoutsByEnvironment = new Map<EnvironmentId, SidebarProjectGroupMember[]>();
  for (const member of group.memberProjects) {
    const list = checkoutsByEnvironment.get(member.environmentId);
    if (list) list.push(member);
    else checkoutsByEnvironment.set(member.environmentId, [member]);
  }
  const removeButton = (member: SidebarProjectGroupMember) => (
    <Button size="sm" variant="outline" disabled={!editableIds.has(member.environmentId)} onClick={() => askRemoval([member])}>
      Remove
    </Button>
  );
  const iconDescription =
    projectIcon?.kind === "lucide"
      ? `${projectIcon.name} · ${projectIcon.color}`
      : projectIcon?.kind === "monogram"
        ? `${projectIcon.text} · ${projectIcon.color}`
        : projectIcon?.kind === "emoji"
          ? projectIcon.emoji
          : (faviconPath ?? "Automatic");

  return (
    <>
      <SettingsPageContainer gap={24}>
        <InfoAlert>Can't find a setting? Keep this project picked above and hop to any other settings page.</InfoAlert>
        <SettingsSection id="project-overview" title="Project" hideTitle>
          {!canEditGroup ? (
            <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
              <Text color={theme.mutedForeground}>
                {group.memberProjects.length > 1
                  ? "Shared settings require permission to change every checkout in this group."
                  : "This connection cannot change this project."}
              </Text>
            </div>
          ) : null}
          <SettingsRow
            title="Name"
            description="The shared name for this project group in the sidebar and thread lists."
            control={
              <DraftTextField
                testId="project-name"
                size="sm"
                width={256}
                disabled={!canEditGroup}
                value={group.displayName}
                onCommit={renameGroup}
              />
            }
          />
          <SettingsRow
            title="Project icon"
            description={iconDescription}
            resetAction={
              group.memberProjects.some((member) => member.faviconPath != null || member.projectIcon != null) ? (
                <SettingResetButton
                  label="project icon"
                  disabled={isSavingFavicon || !canEditGroup}
                  onClick={() => void setProjectIcon({ faviconPath: null, projectIcon: null })}
                />
              ) : null
            }
            control={
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ProjectFavicon project={representative} size={24} />
                <Button size="sm" variant="outline" disabled={isSavingFavicon || !canEditGroup} onClick={() => setIconPickerOpen(true)} testId="project-choose-icon">
                  Choose icon
                </Button>
                <Button size="sm" variant="outline" disabled={isSavingFavicon || !canEditGroup} onClick={() => setFaviconPickerOpen(true)} testId="project-choose-file">
                  Choose file
                </Button>
              </div>
            }
          />
        </SettingsSection>
        <ProjectDefaultsSettings category="project" />
        <ProjectActionsSettings />
        {hasMultipleCheckouts ? (
          <SettingsSection title="Checkouts">
            {Array.from(checkoutsByEnvironment, ([environmentId, members]) => {
              if (checkoutsByEnvironment.size === 1) {
                return members.map((member) => (
                  <SettingsRow key={member.physicalProjectKey} title={member.environmentLabel ?? "Environment"} description={member.workspaceRoot} control={removeButton(member)} />
                ));
              }
              const first = members[0]!;
              const environment = environmentById.get(environmentId);
              const labels = environment
                ? settingsScopeEnvironmentLabels(environment, environments)
                : { primary: first.environmentLabel ?? "Environment", secondary: environmentId };
              const multiple = members.length > 1;
              return (
                <SettingsRow
                  key={environmentId}
                  title={labels.primary}
                  description={[labels.secondary, multiple ? null : first.workspaceRoot].filter(Boolean).join("\n") || undefined}
                  control={multiple ? undefined : removeButton(first)}
                >
                  {multiple ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 8, paddingTop: 4 }}>
                      {members.map((member) => (
                        <div key={member.physicalProjectKey} style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                          <Text size="xs" color={alpha(theme.mutedForeground, 0.8)}>
                            {member.workspaceRoot}
                          </Text>
                          {removeButton(member)}
                        </div>
                      ))}
                    </div>
                  ) : undefined}
                </SettingsRow>
              );
            })}
          </SettingsSection>
        ) : null}
        <SettingsSection title="Danger">
          <SettingsRow
            title={hasOtherMembers ? "Remove checkout" : group.memberProjects.length > 1 ? "Remove this project everywhere" : "Remove project"}
            description={
              hasOtherMembers
                ? "Deletes the selected machine's checkout entries and their threads. Other machines and files on disk are not touched."
                : group.memberProjects.length > 1
                  ? `Deletes all ${group.memberProjects.length} checkout entries and their threads on every machine. Files on disk are not touched.`
                  : "Deletes the project entry and its threads. Files on disk are not touched."
            }
            control={
              <Button
                size="sm"
                variant="destructive-outline"
                icon="trash-2"
                testId="project-remove"
                disabled={!canEditGroup}
                onClick={() => askRemoval(group.memberProjects)}
              >
                {hasOtherMembers ? "Remove checkout" : group.memberProjects.length > 1 ? "Remove all entries" : "Remove project"}
              </Button>
            }
          />
        </SettingsSection>
      </SettingsPageContainer>
      <ProjectIconPickerDialog
        current={projectIcon}
        projectName={representative.title}
        open={iconPickerOpen && canEditGroup}
        onOpenChange={setIconPickerOpen}
        onSelect={(icon) => void setProjectIcon({ faviconPath: null, projectIcon: icon })}
      />
      <ProjectFaviconPickerDialog
        cwd={representative.workspaceRoot}
        environmentId={representative.environmentId}
        open={faviconPickerOpen && canEditGroup}
        onOpenChange={setFaviconPickerOpen}
        projectName={group.displayName}
        onSelect={(path) => void setProjectIcon({ faviconPath: path, projectIcon: null })}
      />
      <Dialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
        title="Remove project?"
        testId="project-remove-dialog"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setPendingRemoval(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              testId="project-remove-confirm"
              onClick={() => {
                const removal = pendingRemoval;
                setPendingRemoval(null);
                if (removal) void removeMembers(removal.members);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(pendingRemoval?.message ?? "").split("\n").map((line, index) => (
            <Text key={index} color={index === 0 ? theme.foreground : theme.mutedForeground}>
              {line}
            </Text>
          ))}
        </div>
      </Dialog>
    </>
  );
}
