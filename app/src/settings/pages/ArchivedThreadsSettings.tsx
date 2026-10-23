// Port of apps/web/src/components/settings/ArchivedThreadsPanel.tsx. Threads
// group by project (logical project groups across environments); each row
// unarchives from its button, and right-click opens Unarchive / Delete (the
// web shows the same two actions in a native context menu).
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { useClientSettings } from "../../state/clientSettings.ts";
import { threadEnvironment } from "../../state/environment.ts";
import { useAtomCommand } from "../../state/settings.ts";
import { ProjectGlyph } from "../../sidebar/ProjectGlyph.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Dialog, Menu, MenuItem } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { useTheme } from "../../ui/theme.ts";
import { settingsScopeEnvironmentLabels } from "../../web/components/settings/settingsScopeAxis.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { useArchivedThreadSnapshots, refreshArchivedThreadsForEnvironment } from "../archive/state.ts";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../layout.tsx";
import { useRelativeTimeLabel } from "../RelativeTime.tsx";
import { useSettingsScope } from "../scope.tsx";

interface ArchivedThreadRow {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly environmentLabel: string;
}

function failureMessage(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
}

export function ArchivedThreadsSettings() {
  const theme = useTheme();
  const { scope, groups: projectGroups, environments } = useSettingsScope();
  const { snapshots, error: archiveError, isLoading, refresh } = useArchivedThreadSnapshots(scope.environmentIds);
  const unarchive = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const [pendingDelete, setPendingDelete] = useState<ArchivedThreadRow | null>(null);

  const selectedProjectKeys =
    scope.kind === "project" || scope.kind === "checkout"
      ? new Set(scope.members.map((member) => `${member.environmentId}:${member.id}`))
      : null;
  const projectsByKey = new Map(
    snapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.projects
        .filter((project) => selectedProjectKeys === null || selectedProjectKeys.has(`${environmentId}:${project.id}`))
        .map((project) => [`${environmentId}:${project.id}`, { ...project, environmentId }] as const),
    ),
  );
  const environmentLabels = new Map(
    environments.map((environment) => {
      const { primary, secondary } = settingsScopeEnvironmentLabels(environment, environments);
      return [environment.environmentId, secondary ? `${primary} (${secondary})` : primary];
    }),
  );
  const threads = snapshots.flatMap(({ environmentId, snapshot }) =>
    snapshot.threads.map((thread) => ({
      ...presentThreadShell(environmentId, thread),
      environmentLabel: environmentLabels.get(environmentId) ?? environmentId,
    })),
  );
  const hasMultipleEnvironments =
    new Set(
      threads
        .filter((thread) => projectsByKey.has(`${thread.environmentId}:${thread.projectId}`))
        .map((thread) => thread.environmentId),
    ).size > 1;
  const logicalGroupsByProjectKey = new Map(
    projectGroups.flatMap((group) =>
      group.memberProjectRefs.map((member) => [`${member.environmentId}:${member.projectId}`, group] as const),
    ),
  );
  const grouped = new Map<string, { project: (typeof projectsByKey extends Map<string, infer P> ? P : never); title: string; threads: typeof threads }>();
  for (const project of projectsByKey.values()) {
    const projectThreads = threads.filter(
      (thread) => thread.projectId === project.id && thread.environmentId === project.environmentId,
    );
    if (projectThreads.length === 0) continue;
    const physicalKey = `${project.environmentId}:${project.id}`;
    const logicalGroup = hasMultipleEnvironments ? logicalGroupsByProjectKey.get(physicalKey as never) : undefined;
    const groupKey = logicalGroup?.projectKey ?? physicalKey;
    const existing = grouped.get(groupKey);
    if (existing) existing.threads.push(...projectThreads);
    else grouped.set(groupKey, { project, title: logicalGroup?.displayName ?? project.title, threads: [...projectThreads] });
  }
  const archivedGroups = [...grouped].map(([key, group]) => ({
    ...group,
    key,
    threads: group.threads.toSorted((left, right) => {
      const leftKey = left.archivedAt ?? left.createdAt;
      const rightKey = right.archivedAt ?? right.createdAt;
      return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
    }),
  }));

  const runUnarchive = async (thread: ArchivedThreadRow) => {
    const result = await unarchive({ environmentId: thread.environmentId, input: { threadId: thread.id } });
    if (result._tag === "Success") {
      refreshArchivedThreadsForEnvironment(thread.environmentId);
      refresh();
    } else if (!isAtomCommandInterrupted(result)) {
      toast({ type: "error", title: "Failed to unarchive thread", description: failureMessage(result) });
    }
  };
  const runDelete = async (thread: ArchivedThreadRow) => {
    const result = await deleteThread({ environmentId: thread.environmentId, input: { threadId: thread.id } });
    if (result._tag === "Success") {
      refreshArchivedThreadsForEnvironment(thread.environmentId);
      refresh();
    } else if (!isAtomCommandInterrupted(result)) {
      toast({ type: "error", title: "Failed to delete thread", description: failureMessage(result) });
    }
  };

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection id={isLoading ? undefined : searchableSetting("archive").id} title={searchableSetting("archive").title}>
          <SettingsRow
            title={
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name={isLoading ? "loader-circle" : "archive"} size={14} color={theme.mutedForeground} />
                <Text weight={500}>
                  {isLoading ? "Loading archived threads" : archiveError ? "Could not load archived threads" : "No archived threads"}
                </Text>
              </div>
            }
            description={isLoading ? "Checking connected environments." : (archiveError ?? "Archived threads will appear here.")}
          />
        </SettingsSection>
      ) : (
        archivedGroups.map(({ key, project, title, threads: projectThreads }, index) => (
          <SettingsSection
            key={key}
            id={index === 0 ? searchableSetting("archive").id : undefined}
            title={title}
            icon={<ProjectGlyph project={project} size={16} />}
          >
            {projectThreads.map((thread) => (
              <ArchivedRow
                key={`${thread.environmentId}:${thread.id}`}
                thread={thread}
                showEnvironment={hasMultipleEnvironments}
                onUnarchive={() => void runUnarchive(thread)}
                onDelete={() => (confirmThreadDelete ? setPendingDelete(thread) : void runDelete(thread))}
              />
            ))}
          </SettingsSection>
        ))
      )}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete thread "${pendingDelete?.title ?? ""}"?`}
        description="This permanently clears conversation history for this thread."
        testId="archived-delete-dialog"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              testId="archived-delete-confirm"
              onClick={() => {
                const thread = pendingDelete;
                setPendingDelete(null);
                if (thread) void runDelete(thread);
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </SettingsPageContainer>
  );
}

function ArchivedRow({
  thread,
  showEnvironment,
  onUnarchive,
  onDelete,
}: {
  thread: ArchivedThreadRow;
  showEnvironment: boolean;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const archived = useRelativeTimeLabel(thread.archivedAt ?? thread.createdAt);
  const created = useRelativeTimeLabel(thread.createdAt);
  return (
    <Menu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      align="start"
      side="bottom"
      testId={`archived-thread-menu-${thread.id}`}
      rootStyle={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}
      trigger={() => (
        <div
          onAuxClick={(event) => {
            if (event.isRightClick) setMenuOpen(true);
          }}
          style={{ display: "flex", flexDirection: "column", width: "100%" }}
        >
          <SettingsRow
            testId={`archived-thread-${thread.id}`}
            title={thread.title}
            description={
              <Text size="xs" color={theme.mutedForeground} truncate={showEnvironment} style={{ lineHeight: 18 }}>
                {`${showEnvironment ? `${thread.environmentLabel} · ` : ""}Archived ${archived} · Created ${created}`}
              </Text>
            }
            control={
              <Button variant="outline" size="sm" icon="archive-x" onClick={onUnarchive} testId={`archived-unarchive-${thread.id}`}>
                Unarchive
              </Button>
            }
          />
        </div>
      )}
    >
      <MenuItem onSelect={onUnarchive}>Unarchive</MenuItem>
      <MenuItem destructive onSelect={onDelete}>
        Delete
      </MenuItem>
    </Menu>
  );
}
