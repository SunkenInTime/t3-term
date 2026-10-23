// apps/web/src/components/sidebar/SidebarThreadHeader.tsx plus the project-scope
// combobox from Sidebar.tsx: thread search field, project filter, add project,
// new thread.
import { useAtomValue } from "@effect/atom-react";
import { DismissableLayer } from "@gpuix/react";
import { FloatingLayer } from "@gpuix/react/floating";
import { useEffect, useRef, useState, type ReactElement } from "react";

import {
  sidebarProjectGroupsAtom,
  sidebarProjectScopeAtom,
  setSidebarProjectScopeKey,
  type SidebarProjectGroup,
} from "../state/sidebar.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { surfaceStyle, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { filterSidebarProjectScopeItems } from "../web/components/Sidebar.logic.ts";
import { claimClick } from "./clickGuard.ts";
import { ProjectEnvironmentBadge, projectGroupsSpanEnvironments } from "./ProjectEnvironmentBadge.tsx";
import { ProjectFavicon } from "./ProjectFavicon.tsx";

export function SidebarHeaderIconButton({
  label,
  icon,
  iconNode,
  onClick,
  disabled,
  testId,
  pressed,
  tooltip,
}: {
  label: string;
  icon?: IconName;
  iconNode?: ReactElement;
  onClick: (event: { modifiers?: { shift?: boolean } }) => void;
  disabled?: boolean;
  testId?: string;
  pressed?: boolean;
  tooltip?: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const active = (hovered || pressed) && !disabled;
  const button = (
      <div
        testId={testId}
        onClick={disabled ? undefined : onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: RADIUS.md,
          flexShrink: 0,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.64 : 1,
          backgroundColor: active ? theme.sidebar.rowHover : "#00000000",
        }}
      >
        {iconNode ?? (icon ? <Icon name={icon} size={16} color={active ? theme.sidebar.foreground : theme.sidebar.icon} /> : null)}
      </div>
  );
  // An open popup replaces the tooltip.
  return pressed ? (
    button
  ) : (
    <Tooltip content={tooltip ?? label} side="top">
      {button}
    </Tooltip>
  );
}

function ProjectScopeItem({
  label,
  project,
  selected,
  highlighted,
  onHighlight,
  onSelect,
  onOpenSettings,
  showEnvironments,
  testId,
}: {
  showEnvironments: boolean;
  label: string;
  project: SidebarProjectGroup | null;
  selected: boolean;
  highlighted: boolean;
  onHighlight: () => void;
  onSelect: () => void;
  onOpenSettings: (() => void) | null;
  testId: string;
}) {
  const theme = useTheme();
  const [gearHovered, setGearHovered] = useState(false);
  return (
    <div
      testId={testId}
      onMouseMove={onHighlight}
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 28,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        cursor: "pointer",
        backgroundColor: highlighted ? theme.accent : selected ? alpha(theme.foreground, 0.08) : "#00000000",
      }}
    >
      {project ? <ProjectFavicon project={project} size={16} /> : <Icon name="folder" size={16} color={theme.mutedForeground} />}
      <Text truncate style={{ flexGrow: 1, flexShrink: 1 }}>
        {label}
      </Text>
      {project && showEnvironments ? <ProjectEnvironmentBadge group={project} /> : null}
      {onOpenSettings ? (
        <div
          onMouseDown={claimClick}
          onClick={onOpenSettings}
          onMouseEnter={() => setGearHovered(true)}
          onMouseLeave={() => setGearHovered(false)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: RADIUS.sm,
            flexShrink: 0,
            backgroundColor: gearHovered ? theme.accent : "#00000000",
          }}
        >
          <Icon name="settings" size={14} color={gearHovered ? theme.foreground : theme.mutedForeground} />
        </div>
      ) : null}
    </div>
  );
}

/** The project filter popup; anchors under the whole search row like web's `anchor={headerSearchRef}`. */
function ProjectScopePopup({
  onClose,
  onOpenProjectSettings,
}: {
  onClose: () => void;
  onOpenProjectSettings: (project: SidebarProjectGroup) => void;
}) {
  const theme = useTheme();
  const groups = useAtomValue(sidebarProjectGroupsAtom);
  const scope = useAtomValue(sidebarProjectScopeAtom);
  const [query, setQuery] = useState("");
  const items = [
    { value: "all", label: "All projects", project: null as SidebarProjectGroup | null },
    ...groups.map((group) => ({ value: group.projectKey, label: group.displayName, project: group })),
  ];
  const filtered = filterSidebarProjectScopeItems({
    items,
    query,
    matches: (item, value) => item.label.toLowerCase().includes(value.toLowerCase()),
  });
  const selectedValue = scope?.projectKey ?? "all";
  const showProjectEnvironments = projectGroupsSpanEnvironments(groups);
  const [highlight, setHighlight] = useState(() =>
    Math.max(0, filtered.findIndex((item) => item.value === selectedValue)),
  );
  useEffect(() => setHighlight(0), [query]);
  const select = (value: string) => {
    setSidebarProjectScopeKey(value === "all" ? null : value);
    onClose();
  };
  const [focused, setFocused] = useState(true);
  return (
    <DismissableLayer onEscapeKeyDown={onClose}>
      <FloatingLayer
        side="bottom"
        align="start"
        sideOffset={4}
        testId="sidebar-project-filter-popup"
        onMouseDownOutside={onClose}
        style={{
          ...surfaceStyle(theme),
          display: "flex",
          flexDirection: "column",
          width: 288,
          maxHeight: 368,
          overflow: "hidden",
        }}
      >
        <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 10, flexShrink: 0 }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingBottom: 6,
              borderBottomWidth: 1,
              borderColor: focused ? theme.primary : alpha(theme.border, 0.7),
            }}
          >
            <Icon name="search" size={16} color={alpha(theme.mutedForeground, 0.55)} />
            <input
              autoFocus
              testId="sidebar-project-filter-input"
              value={query}
              placeholder="Search projects..."
              onChange={(event) => setQuery(event.value ?? "")}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onSubmit={() => {
                const item = filtered[highlight];
                if (item) select(item.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "down") {
                  event.preventDefault();
                  setHighlight((index) => Math.min(filtered.length - 1, index + 1));
                } else if (event.key === "up") {
                  event.preventDefault();
                  setHighlight((index) => Math.max(0, index - 1));
                } else if (event.key === "escape") {
                  onClose();
                }
              }}
              style={{ flexGrow: 1, minWidth: 0, height: 26, fontSize: 14, fontFamily: FONTS.sans, color: theme.foreground }}
            />
          </div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 8, display: "flex", justifyContent: "center" }}>
            <Text color={theme.mutedForeground}>No matching projects.</Text>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", padding: 4, overflowY: "scroll", minHeight: 0, flexShrink: 1 }}>
            {filtered.map((item, index) => (
              <ProjectScopeItem
                key={item.value}
                testId={`sidebar-project-filter-item-${index}`}
                showEnvironments={showProjectEnvironments}
                label={item.label}
                project={item.project}
                selected={item.value === selectedValue}
                highlighted={index === highlight}
                onHighlight={() => setHighlight(index)}
                onSelect={() => select(item.value)}
                onOpenSettings={
                  item.project
                    ? () => {
                        const project = item.project!;
                        onClose();
                        onOpenProjectSettings(project);
                      }
                    : null
                }
              />
            ))}
          </div>
        )}
      </FloatingLayer>
    </DismissableLayer>
  );
}

export function SidebarThreadHeader({
  hasProjects,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadLabel,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  onSearchSubmit,
  isSearching,
  onClearSearch,
  onOpenProjectSettings,
}: {
  hasProjects: boolean;
  onNewProject: () => void;
  onNewThread: (shiftKey: boolean) => void;
  newThreadDisabled: boolean;
  newThreadLabel: string;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (key: string, preventDefault: () => void) => void;
  onSearchSubmit: () => void;
  isSearching: boolean;
  onClearSearch: () => void;
  onOpenProjectSettings: (project: SidebarProjectGroup) => void;
}) {
  const theme = useTheme();
  const scope = useAtomValue(sidebarProjectScopeAtom);
  const [filterOpen, setFilterOpenState] = useState(false);
  // Pressing the trigger while open closes the popup on mouse down (outside
  // it); the click that follows must not reopen it.
  const filterClosedAt = useRef(Number.NEGATIVE_INFINITY);
  const setFilterOpen = (open: boolean) => {
    if (!open) filterClosedAt.current = performance.now();
    setFilterOpenState(open);
  };
  const [searchHovered, setSearchHovered] = useState(false);
  const [clearHovered, setClearHovered] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
        <div
          onMouseEnter={() => setSearchHovered(true)}
          onMouseLeave={() => setSearchHovered(false)}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            flexGrow: 1,
            minWidth: 0,
            height: 32,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: RADIUS.md,
            backgroundColor: searchHovered ? theme.sidebar.rowHover : "#00000000",
          }}
        >
          <Icon name="search" size={16} color={theme.sidebar.icon} />
          <div style={{ position: "relative", display: "flex", flexGrow: 1, minWidth: 0, height: 20 }}>
            <input
              testId="sidebar-search-input"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.value ?? "")}
              onSubmit={onSearchSubmit}
              onKeyDown={(event) => onSearchKeyDown(event.key ?? "", () => event.preventDefault())}
              style={{
                flexGrow: 1,
                minWidth: 0,
                height: 20,
                fontSize: 14,
                fontWeight: 500,
                fontFamily: FONTS.sans,
                color: theme.sidebar.foreground,
              }}
            />
            {searchQuery.length === 0 ? (
              // gpuix paints placeholders in a fixed grey; web's is the sidebar muted tone.
              <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, display: "flex", alignItems: "center", pointerEvents: "none" }}>
                <Text size="sm" weight={500} color={searchHovered ? theme.sidebar.foreground : theme.sidebar.mutedForeground}>
                  Search
                </Text>
              </div>
            ) : null}
          </div>
          {isSearching ? (
            <div
              testId="sidebar-search-clear"
              onClick={onClearSearch}
              onMouseEnter={() => setClearHovered(true)}
              onMouseLeave={() => setClearHovered(false)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: RADIUS.sm,
                flexShrink: 0,
                cursor: "pointer",
                backgroundColor: clearHovered ? theme.accent : "#00000000",
              }}
            >
              <Icon name="x" size={12} color={clearHovered ? theme.foreground : theme.mutedForeground} />
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
          {hasProjects ? (
            <>
              <SidebarHeaderIconButton
                testId="sidebar-project-filter"
                label={scope ? `Filter threads by project: ${scope.displayName}` : "Filter threads by project"}
                pressed={filterOpen}
                icon="list-filter"
                iconNode={scope ? <ProjectFavicon project={scope} size={16} /> : undefined}
                onClick={() => {
                  if (filterOpen) setFilterOpen(false);
                  else if (performance.now() - filterClosedAt.current > 250) setFilterOpen(true);
                }}
              />
              <SidebarHeaderIconButton testId="sidebar-add-project" label="Add project" icon="folder-plus" onClick={onNewProject} />
            </>
          ) : null}
          <SidebarHeaderIconButton
            testId="sidebar-new-thread"
            label="New thread"
            tooltip={newThreadLabel}
            icon="square-pen"
            disabled={newThreadDisabled}
            onClick={(event) => onNewThread(event.modifiers?.shift === true)}
          />
        </div>
      </div>
      {filterOpen ? (
        <ProjectScopePopup onClose={() => setFilterOpen(false)} onOpenProjectSettings={onOpenProjectSettings} />
      ) : null}
    </div>
  );
}
