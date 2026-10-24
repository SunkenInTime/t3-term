// apps/web/src/components/ProjectEnvironmentBadge.tsx: a machine glyph after a
// project's name in the project pickers (sidebar project filter, draft hero
// project picker) when its group has members on other environments. The
// tooltip names them: "On <machine>" or, when the group also lives here,
// "Also on <machine>". Shown only while the project groups span more than one
// environment (sidebarProjectGrouping.ts projectGroupsSpanEnvironments).
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { resolveEnvironmentMachineKind, type EnvironmentId, type EnvironmentMachineKind } from "@t3tools/contracts";

import { environmentServerConfigsAtom } from "../state/environment.ts";
import { environmentLabelByIdAtom, primaryEnvironmentIdAtom } from "../state/sidebar.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { useTheme } from "../ui/theme.ts";

/** EnvironmentMachineIcon on lucide (web's Linux and Mac glyphs are local svgs). */
export const ENVIRONMENT_MACHINE_ICON: Record<EnvironmentMachineKind, IconName> = {
  server: "server",
  cloud: "cloud",
  linux: "terminal",
  desktop: "monitor",
  laptop: "laptop",
  "mac-mini": "server",
  "mac-studio": "monitor",
};

/** sidebarProjectGrouping.ts */
export function projectGroupsSpanEnvironments(
  groups: ReadonlyArray<{ readonly memberProjects: ReadonlyArray<Pick<EnvironmentProject, "environmentId">> }>,
): boolean {
  const environmentIds = new Set<EnvironmentId>();
  for (const group of groups) {
    for (const member of group.memberProjects) {
      environmentIds.add(member.environmentId);
      if (environmentIds.size > 1) return true;
    }
  }
  return false;
}

export function ProjectEnvironmentBadge({
  group,
}: {
  readonly group: { readonly memberProjects: ReadonlyArray<Pick<EnvironmentProject, "environmentId">> };
}) {
  const theme = useTheme();
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const labels = useAtomValue(environmentLabelByIdAtom);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const remoteMembers = group.memberProjects
    .filter((member) => member.environmentId !== primaryEnvironmentId)
    .map((member) => ({ ...member, environmentLabel: labels.get(member.environmentId) ?? "Remote" }))
    .sort((a, b) => a.environmentLabel.localeCompare(b.environmentLabel));
  const first = remoteMembers[0];
  if (!first) return null;
  const names = remoteMembers
    .map((member) => member.environmentLabel)
    .filter((label, index, all) => all.indexOf(label) === index)
    .join(", ");
  const alsoHere = remoteMembers.length < group.memberProjects.length;
  const description = `${alsoHere ? "Also on" : "On"} ${names}`;
  const kind = resolveEnvironmentMachineKind(configs.get(first.environmentId) ?? null);
  return (
    <Tooltip content={description} side="top">
      <div testId="project-environment-badge" style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <Icon name={ENVIRONMENT_MACHINE_ICON[kind] ?? "server"} size={14} color={theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}
