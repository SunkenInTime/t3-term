// First-pass sidebar modeled on apps/web/src/components/Sidebar.tsx (the default
// "new" sidebar): brand header, search row, active card rows, settled shelf, footer.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { OrchestrationProjectShell } from "@t3tools/contracts";
import { memo, useMemo, useState } from "react";

import { environmentThreadShells, projectIndexAtom } from "../state/environment.ts";
import { routeAtom, sidebarOpenAtom } from "../state/ui.ts";
import { Icon } from "../ui/Icon.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { LAYOUT, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { formatRelativeTime } from "../lib/time.ts";
import { ProjectGlyph } from "./ProjectGlyph.tsx";

function isSettled(thread: EnvironmentThreadShell): boolean {
  if (thread.settledOverride === "settled") return true;
  if (thread.settledOverride === "active") return false;
  return thread.settledAt !== null;
}

function isSnoozed(thread: EnvironmentThreadShell, now: number): boolean {
  return thread.snoozedUntil !== null && Date.parse(thread.snoozedUntil) > now;
}

export function Sidebar() {
  const theme = useTheme();
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const route = useAtomValue(routeAtom);
  const [settledOpen, setSettledOpen] = useState(false);

  const projects = useAtomValue(projectIndexAtom);
  const now = Date.now();
  const sections = useMemo(() => {
    const active: EnvironmentThreadShell[] = [];
    const snoozed: EnvironmentThreadShell[] = [];
    const settled: EnvironmentThreadShell[] = [];
    for (const thread of threads) {
      if (thread.deletedAt !== null) continue;
      if (isSnoozed(thread, now)) snoozed.push(thread);
      else if (isSettled(thread)) settled.push(thread);
      else active.push(thread);
    }
    const byRecent = (a: EnvironmentThreadShell, b: EnvironmentThreadShell) =>
      Date.parse(b.latestUserMessageAt ?? b.updatedAt) - Date.parse(a.latestUserMessageAt ?? a.updatedAt);
    active.sort(byRecent);
    settled.sort((a, b) => Date.parse(b.settledAt ?? b.updatedAt) - Date.parse(a.settledAt ?? a.updatedAt));
    return { active, snoozed, settled };
  }, [threads, now]);

  const activeThreadId = route.kind === "thread" ? route.threadId : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: LAYOUT.sidebarWidth,
        height: "100%",
        flexShrink: 0,
        backgroundColor: theme.sidebar.background,
        borderRightWidth: 1,
        borderColor: theme.sidebar.border,
      }}
    >
      <SidebarHeader />
      <SearchRow />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}>
        {sections.active.map((thread) => (
          <ThreadCardRow
            key={`${thread.environmentId}:${thread.id}`}
            thread={thread}
            project={projects.get(`${thread.environmentId}:${thread.projectId}`)}
            active={thread.id === activeThreadId}
          />
        ))}
        <div style={{ flexGrow: 1, minHeight: 8 }} />
        {sections.snoozed.length > 0 ? (
          <ShelfHeader label={`Snoozed (${sections.snoozed.length})`} tone="snoozed" open={false} onToggle={() => {}} />
        ) : null}
        <ShelfHeader
          label={settledOpen ? "Settled" : `Settled (${sections.settled.length})`}
          tone="muted"
          open={settledOpen}
          onToggle={() => setSettledOpen((v) => !v)}
        />
        {settledOpen
          ? sections.settled.slice(0, 30).map((thread) => (
              <ThreadSlimRow
                key={`${thread.environmentId}:${thread.id}`}
                thread={thread}
                project={projects.get(`${thread.environmentId}:${thread.projectId}`)}
                active={thread.id === activeThreadId}
              />
            ))
          : null}
      </div>
      <SidebarFooter />
    </div>
  );
}

function SidebarHeader() {
  const theme = useTheme();
  const setOpen = useAtomSet(sidebarOpenAtom);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: LAYOUT.topbar, paddingLeft: 12, paddingRight: 12, gap: 12, flexShrink: 0 }}>
      <IconButton icon="panel-left-close" color={theme.mutedForeground} onClick={() => setOpen(false)} testId="sidebar-toggle" />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text size="sm" weight={700} color={theme.sidebar.foreground}>
          T3
        </Text>
        <Text size="sm" weight={500} color={theme.sidebar.mutedForeground}>
          Code
        </Text>
      </div>
    </div>
  );
}

function SearchRow() {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, padding: 8, flexShrink: 0 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flexGrow: 1,
          height: 32,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: RADIUS.md,
          cursor: "text",
          hover: { backgroundColor: theme.sidebar.rowHover },
        }}
      >
        <Icon name="search" size={16} color={theme.sidebar.icon} />
        <Text size="sm" weight={500} color={theme.sidebar.mutedForeground}>
          Search
        </Text>
      </div>
      <IconButton icon="list-filter" color={theme.sidebar.icon} hoverBg={theme.sidebar.rowHover} />
      <IconButton icon="folder-plus" color={theme.sidebar.icon} hoverBg={theme.sidebar.rowHover} />
      <IconButton icon="square-pen" color={theme.sidebar.icon} hoverBg={theme.sidebar.rowHover} />
    </div>
  );
}

const ThreadCardRow = memo(function ThreadCardRow({
  thread,
  project,
  active,
}: {
  thread: EnvironmentThreadShell;
  project: OrchestrationProjectShell | undefined;
  active: boolean;
}) {
  const theme = useTheme();
  const setRoute = useAtomSet(routeAtom);
  return (
    <div style={{ paddingTop: 2, paddingBottom: 2 }}>
      <div
        testId={`thread-row-${thread.id}`}
        onClick={() => setRoute({ kind: "thread", environmentId: thread.environmentId, threadId: thread.id })}
        style={{
          display: "flex",
          flexDirection: "column",
          height: 78,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: RADIUS.md,
          backgroundColor: active ? theme.sidebar.rowActive : "#00000000",
          cursor: "pointer",
          hover: { backgroundColor: active ? theme.sidebar.rowActive : theme.sidebar.rowHover },
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 20 }}>
          <ProjectGlyph project={project} size={16} />
          <Text size="xs" weight={500} color={theme.mutedForeground} truncate style={{ flexGrow: 1 }}>
            {project?.title ?? "No project"}
          </Text>
          <Text size="xs" color={theme.mutedForeground}>
            {formatRelativeTime(thread.latestUserMessageAt ?? thread.updatedAt)}
          </Text>
        </div>
        <Text
          size="sm"
          weight={500}
          color={alpha(theme.sidebar.foreground, active ? 1 : 0.9)}
          truncate
          style={{ marginTop: 4 }}
        >
          {thread.title}
        </Text>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2, height: 16 }}>
          {thread.branch ? (
            <>
              {thread.worktreePath ? <Icon name="folder-git-2" size={12} color={alpha(theme.mutedForeground, 0.6)} /> : null}
              <Text size="xs" color={alpha(theme.mutedForeground, 0.6)} truncate style={{ flexShrink: 1 }}>
                {thread.branch}
              </Text>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
});

const ThreadSlimRow = memo(function ThreadSlimRow({
  thread,
  project,
  active,
}: {
  thread: EnvironmentThreadShell;
  project: OrchestrationProjectShell | undefined;
  active: boolean;
}) {
  const theme = useTheme();
  const setRoute = useAtomSet(routeAtom);
  return (
    <div
      onClick={() => setRoute({ kind: "thread", environmentId: thread.environmentId, threadId: thread.id })}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: 36,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        flexShrink: 0,
        backgroundColor: active ? theme.sidebar.rowActive : "#00000000",
        cursor: "pointer",
        hover: { backgroundColor: theme.sidebar.rowHover },
      }}
    >
      <div style={{ opacity: active ? 1 : 0.4 }}>
        <ProjectGlyph project={project} size={16} />
      </div>
      <Text size="sm" color={alpha(theme.mutedForeground, active ? 1 : 0.85)} truncate style={{ flexGrow: 1 }}>
        {thread.title}
      </Text>
      <Text size="xs" color={theme.mutedForeground}>
        {formatRelativeTime(thread.settledAt ?? thread.updatedAt)}
      </Text>
    </div>
  );
});

function ShelfHeader({
  label,
  tone,
  open,
  onToggle,
}: {
  label: string;
  tone: "muted" | "snoozed";
  open: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const color = tone === "snoozed" ? "#51a2ff" : alpha(theme.sidebar.mutedForeground, 0.6);
  const line = tone === "snoozed" ? alpha("#2b7fff", 0.2) : alpha(theme.sidebar.border, 0.6);
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 32,
        paddingLeft: 8,
        paddingRight: 8,
        marginLeft: 2,
        marginRight: 2,
        borderRadius: RADIUS.md,
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      <Text size="xs" weight={500} color={color}>
        {label}
      </Text>
      <div style={{ flexGrow: 1, height: 1, backgroundColor: line }} />
      <Icon name={open ? "chevron-down" : "chevron-up"} size={12} color={color} />
    </div>
  );
}

function SidebarFooter() {
  const theme = useTheme();
  const setRoute = useAtomSet(routeAtom);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8, height: 40, flexShrink: 0 }}>
      <IconButton icon="settings" size={32} color={theme.sidebar.icon} hoverBg={theme.sidebar.rowHover} onClick={() => setRoute({ kind: "settings", page: "general" })} testId="open-settings" />
      <IconButton icon="git-pull-request-arrow" size={32} color={theme.sidebar.icon} hoverBg={theme.sidebar.rowHover} />
      <IconButton icon="chart-no-axes-column" size={32} color={theme.sidebar.icon} hoverBg={theme.sidebar.rowHover} />
    </div>
  );
}
