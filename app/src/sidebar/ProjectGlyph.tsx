// Kept for existing callers (the main header breadcrumb). Prefer ProjectFavicon,
// which needs the project's environment to resolve the server favicon.
import type { EnvironmentId, OrchestrationProjectShell } from "@t3tools/contracts";

import { useTheme } from "../ui/theme.ts";
import { Icon } from "../ui/Icon.tsx";
import { deriveProjectIdentity } from "../web/projectIdentity.ts";
import { ProjectFavicon, ProjectMonogram } from "./ProjectFavicon.tsx";

export function ProjectGlyph({
  project,
  size = 16,
  environmentId,
}: {
  project: (OrchestrationProjectShell & { readonly environmentId?: EnvironmentId }) | undefined;
  size?: number;
  environmentId?: EnvironmentId;
}) {
  const theme = useTheme();
  if (!project) return <Icon name="folder-code" size={size} color={theme.mutedForeground} />;
  const resolvedEnvironmentId = environmentId ?? project.environmentId;
  if (resolvedEnvironmentId !== undefined) {
    return <ProjectFavicon project={{ ...project, environmentId: resolvedEnvironmentId }} size={size} />;
  }
  const identity = deriveProjectIdentity(project.title);
  return <ProjectMonogram text={identity.monogram} color={identity.color} size={size} />;
}
