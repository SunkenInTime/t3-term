// Row content for palette items, after apps/web/src/components/ThreadCommandSubtitle.tsx,
// ThreadStatusIndicators.tsx (status pill), CommandPaletteProjectItems.tsx
// (ProjectLocationDescription) and CommandPaletteThemeItems.tsx (preview dots).
import type { EnvironmentProject, EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentMachineKind } from "@t3tools/contracts";

import { ProjectGlyph } from "../sidebar/ProjectGlyph.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { alpha, useTheme } from "../ui/theme.ts";

export interface PaletteLocation {
  readonly kind: "local" | "remote";
  readonly label: string;
  readonly machine: EnvironmentMachineKind;
}

const MACHINE_ICONS: Record<EnvironmentMachineKind, IconName> = {
  server: "server",
  cloud: "cloud",
  linux: "terminal",
  desktop: "monitor",
  laptop: "laptop",
  "mac-mini": "monitor",
  "mac-studio": "monitor",
};

export function machineIcon(kind: EnvironmentMachineKind): IconName {
  return MACHINE_ICONS[kind] ?? "server";
}

function MetaDot() {
  const theme = useTheme();
  return (
    <Text size="xs" color={alpha(theme.mutedForeground, 0.5)} style={{ flexShrink: 0 }}>
      ·
    </Text>
  );
}

/** CommandPaletteProjectItems ProjectLocationDescription: [machine] label · path. */
export function ProjectLocationDescription({
  location,
  workspaceRoot,
}: {
  location: PaletteLocation | undefined;
  workspaceRoot: string;
}) {
  const theme = useTheme();
  const muted = alpha(theme.mutedForeground, 0.7);
  const resolved = location ?? { kind: "remote" as const, label: "Remote", machine: "server" as const };
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
      {resolved.kind === "remote" ? <Icon name={machineIcon(resolved.machine)} size={12} color={muted} /> : null}
      <Text size="xs" color={muted} style={{ flexShrink: 0 }}>
        {resolved.label}
      </Text>
      <MetaDot />
      <Text size="xs" color={muted} truncate>
        {workspaceRoot}
      </Text>
    </div>
  );
}

/** ThreadCommandSubtitle ("favicon-workspace-harness"). */
export function ThreadSubtitle({
  project,
  environmentLabel,
  branch,
  worktreePath,
  isCurrent,
}: {
  project: EnvironmentProject | null;
  environmentLabel: string | null;
  branch: string | null;
  worktreePath: string | null;
  isCurrent: boolean;
}) {
  const theme = useTheme();
  const muted = alpha(theme.mutedForeground, 0.7);
  const projectLabel = project?.title.trim() || null;
  const branchLabel = branch?.trim() || null;
  const isWorktree = worktreePath != null && worktreePath.trim().length > 0;
  if (!projectLabel && !branchLabel && !isCurrent) return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
      {projectLabel ? (
        <>
          {project ? <ProjectGlyph project={project} size={12} /> : null}
          <Text size="xs" color={muted} truncate style={{ flexShrink: 1 }}>
            {projectLabel}
          </Text>
          {environmentLabel ? (
            <>
              <MetaDot />
              <Text size="xs" color={muted} style={{ flexShrink: 0 }}>
                {environmentLabel}
              </Text>
            </>
          ) : null}
        </>
      ) : null}
      {branchLabel ? (
        <>
          {projectLabel ? <MetaDot /> : null}
          <Icon name={isWorktree ? "folder-git-2" : "folder"} size={12} color={muted} />
          <Text size="xs" color={muted} truncate style={{ flexShrink: 1 }}>
            {branchLabel}
          </Text>
        </>
      ) : null}
      {isCurrent ? (
        <>
          {projectLabel || branchLabel ? <MetaDot /> : null}
          <Text size="xs" color={muted} style={{ flexShrink: 0 }}>
            Current thread
          </Text>
        </>
      ) : null}
    </div>
  );
}

interface StatusPill {
  readonly label: string;
  readonly color: string;
}

function isAfterVisit(at: string | null | undefined, lastVisitedAt: string | null | undefined): boolean {
  if (!at) return false;
  if (!lastVisitedAt) return true;
  const atMs = Date.parse(at);
  const visitedMs = Date.parse(lastVisitedAt);
  if (Number.isNaN(atMs) || Number.isNaN(visitedMs)) return true;
  return atMs > visitedMs;
}

/** Sidebar.logic.ts resolveThreadStatusPill, for the states a palette row shows. */
export function resolveThreadStatusPill(thread: EnvironmentThreadShell): StatusPill | null {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") {
    return { label: "Pending Approval", color: "#fcd34de6" };
  }
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") {
    return { label: "Awaiting Input", color: "#a5b4fce6" };
  }
  const status = thread.runtime?.status;
  if ((status === "running" && thread.blockedOnThreadWait !== true) || status === "waiting") {
    return { label: "Working", color: "#7dd3fccc" };
  }
  if (status === "preparing" || status === "starting" || status === "queued") {
    return { label: "Connecting", color: "#7dd3fccc" };
  }
  const latestRun = thread.latestRun;
  if (latestRun?.status === "failed" && isAfterVisit(latestRun.completedAt, thread.lastVisitedAt)) {
    return { label: "Failed", color: "#fca5a5e6" };
  }
  // Past the running states above, the latest run has settled (isLatestRunSettled).
  if (!thread.hasPendingUserInput && thread.interactionMode === "plan" && thread.hasActionableProposedPlan) {
    return { label: "Plan Ready", color: "#c4b5fde6" };
  }
  if (latestRun?.status === "completed" && isAfterVisit(latestRun.completedAt, thread.lastVisitedAt)) {
    return { label: "Completed", color: "#6ee7b7e6" };
  }
  return null;
}

/** ThreadStatusLabel: a 6px dot and a 10px label. */
export function ThreadStatusPillView({ thread }: { thread: EnvironmentThreadShell }) {
  const pill = resolveThreadStatusPill(thread);
  if (!pill) return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pill.color }} />
      <Text size="3xs" weight={500} color={pill.color}>
        {pill.label}
      </Text>
    </div>
  );
}

/** ThemePreviewCircle at size-3: a 12px dot split by the theme's canvas and accent. */
export function ThemePreviewDot({ canvas, accent }: { canvas: string; accent: string }) {
  return (
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: 6,
        background: { type: "linear-gradient", angle: 135, stops: [{ color: accent, position: 0.5 }, { color: canvas, position: 0.5 }] },
        flexShrink: 0,
      }}
    />
  );
}
