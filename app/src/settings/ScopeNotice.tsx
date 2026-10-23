// Port of apps/web/src/components/settings/SettingsScopeNotice.tsx: a message
// plus the scopes that make the page (or a search target) available, as rows
// that switch the settings scope when clicked.
import { useState, type ReactNode } from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironments, type EnvironmentPresentation } from "../state/settings.ts";
import { ProjectFavicon } from "../sidebar/ProjectFavicon.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { alpha, useTheme } from "../ui/theme.ts";
import type { SidebarProjectSnapshot } from "../web/sidebarProjectGrouping.ts";
import type { SettingsScopeSearch } from "../web/components/settings/settingsScope.ts";
import {
  settingsScopeEnvironmentAddress,
  settingsScopeEnvironmentLabels,
  settingsScopeProjectMachines,
} from "../web/components/settings/settingsScopeAxis.ts";
import { SettingsGroup, SettingsPageContainer, SettingsSection, machineIcon, settingsSearchTargetAtom } from "./layout.tsx";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { useSettingsScope } from "./scope.tsx";

interface ScopeChoice {
  label: string;
  secondary?: string;
  icon: ReactNode;
  search: SettingsScopeSearch;
}

function ChoiceRow({ choice, onSelect }: { choice: ScopeChoice; onSelect: () => void }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <div
      testId={`scope-choice-${choice.label}`}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: 12,
        cursor: "pointer",
        backgroundColor: hover ? alpha(theme.accent, 0.5) : "#00000000",
      }}
    >
      {choice.icon}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <Text weight={500}>{choice.label}</Text>
        {choice.secondary ? (
          <Text size="xs" color={theme.mutedForeground}>
            {choice.secondary}
          </Text>
        ) : null}
      </div>
      <Icon name="chevron-right" size={16} color={theme.mutedForeground} />
    </div>
  );
}

export function SettingsScopeNotice({
  children,
  target,
  targetId,
  eligibleEnvironmentIds,
}: {
  children: string;
  target: "environment" | "all" | "project" | "checkout";
  /** A search target to keep after switching scope. */
  targetId?: string;
  eligibleEnvironmentIds?: readonly EnvironmentId[];
}) {
  const theme = useTheme();
  const { selectScope, search, groups } = useSettingsScope();
  const { environments } = useEnvironments();
  const environmentIcon = (environment: EnvironmentPresentation | undefined) =>
    environment ? <Icon name={machineIcon(environment.serverConfig)} size={16} color={theme.mutedForeground} /> : null;
  const choiceGroups = target === "checkout" ? groups.filter((group) => !search.project || group.projectKey === search.project) : [null];
  const select = (next: SettingsScopeSearch) => {
    selectScope(next);
    if (targetId) {
      const previous = appAtomRegistry.get(settingsSearchTargetAtom);
      appAtomRegistry.set(settingsSearchTargetAtom, { id: targetId, nonce: (previous?.nonce ?? 0) + 1 });
    }
  };
  const choicesFor = (group: SidebarProjectSnapshot | null): ScopeChoice[] =>
    group
      ? group.memberProjects.map((member) => {
          const environment = environments.find((entry) => entry.environmentId === member.environmentId);
          const { primary, secondary } = environment
            ? settingsScopeEnvironmentLabels(environment, environments)
            : { primary: member.environmentLabel ?? "Environment", secondary: member.environmentId };
          return {
            label: primary,
            secondary: [secondary, member.workspaceRoot].filter(Boolean).join(" · "),
            icon: environmentIcon(environment),
            search: { project: group.projectKey, machine: member.environmentId, checkout: member.physicalProjectKey },
          };
        })
      : target === "project"
        ? groups.map((candidate) => ({
            label: candidate.displayName,
            secondary: [
              ...(groups.some((other) => other.projectKey !== candidate.projectKey && other.displayName === candidate.displayName)
                ? settingsScopeProjectMachines(candidate, environments)
                : []),
              candidate.workspaceRoot,
            ].join(" · "),
            icon: <ProjectFavicon project={{ ...candidate, title: candidate.displayName }} size={16} />,
            search: { project: candidate.projectKey },
          }))
        : target === "environment"
          ? environments
              .filter((entry) => eligibleEnvironmentIds === undefined || eligibleEnvironmentIds.includes(entry.environmentId))
              .map((entry) => {
                const { primary, secondary } = settingsScopeEnvironmentLabels(entry, environments);
                return {
                  label: primary,
                  secondary: secondary || settingsScopeEnvironmentAddress(entry),
                  icon: environmentIcon(entry),
                  search: { machine: entry.environmentId },
                };
              })
          : [{ label: "Open all environments", icon: <Icon name="layers" size={16} color={theme.mutedForeground} />, search: {} }];
  return (
    <SettingsPageContainer>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ paddingLeft: 16, paddingRight: 16 }}>
          <Text color={theme.mutedForeground}>{children}</Text>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {choiceGroups.map((group) => {
            const rows = choicesFor(group).map((choice) => (
              <ChoiceRow key={JSON.stringify(choice.search)} choice={choice} onSelect={() => select(choice.search)} />
            ));
            return group?.displayName ? (
              <SettingsSection key={group.projectKey} title={group.displayName}>
                {rows}
              </SettingsSection>
            ) : (
              <SettingsGroup key={group?.projectKey ?? target}>{rows}</SettingsGroup>
            );
          })}
        </div>
      </div>
    </SettingsPageContainer>
  );
}
