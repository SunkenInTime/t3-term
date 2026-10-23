// Port of apps/web/src/components/chat/DraftHeroHeadline.tsx + DraftHeroProjectHeading.tsx.
//   h1 30/36 normal: "What should we build in [project]?" (project: medium, dotted underline picker)
//   p mt 8 h 24 14px: "or start without a project" (muted inline button, tooltip = shortcut)
// The picker opens a 288px combobox: search field, projects, then "Add project".
// The heading sits on one line only from `lg` up and when it fits
// (DraftHeroProjectHeading measures a hidden one-line copy); otherwise it stacks:
// "What should we build?" (24px, 30 from `sm`) over the project picker at 16px.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState } from "react";

import { activeKeybindingsAtom } from "../../state/keybindings.ts";
import { environmentProjects, environmentThreadShells } from "../../state/environment.ts";
import { environmentPresentations } from "../../state/navigation.ts";
import { openCommandPalette } from "../../state/palette.ts";
import {
  openScratchProject,
  scratchEnvironmentId,
  scratchWorkspaceRootFor,
  sortProjectsByActivity,
  startNewThread,
} from "../../palette/actions.ts";
import { ProjectGlyph } from "../../sidebar/ProjectGlyph.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { largeViewportAtom, useSmallViewport } from "../../ui/viewport.tsx";
import { normalizeSearchText } from "../../web/components/CommandPalette.logic.ts";
import { shortcutLabelForCommand } from "../../web/keybindings.ts";

const ADD_PROJECT_VALUE = "add-project";

interface PickerItem {
  readonly value: string;
  readonly label: string;
  readonly project: EnvironmentProject | null;
}

function projectKey(project: Pick<EnvironmentProject, "environmentId" | "id">): string {
  return `${project.environmentId}:${project.id}`;
}

/** The dotted-underline trigger (InlineButton tone="picker"), at heading size. */
/** heading: the one-line heading's 30px; base: the stacked heading's `text-base`; small: 14px. */
type PickerTriggerSize = "heading" | "base" | "small";
const PICKER_TRIGGER_METRICS: Record<PickerTriggerSize, { fontSize: number; lineHeight: number; underlineTop: number; underline: number }> = {
  heading: { fontSize: 30, lineHeight: 36, underlineTop: 33, underline: 2 },
  base: { fontSize: 16, lineHeight: 24, underlineTop: 21, underline: 1 },
  small: { fontSize: 14, lineHeight: 20, underlineTop: 19, underline: 1 },
};

function PickerTrigger({
  label,
  open,
  onClick,
  size = "heading",
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  size?: PickerTriggerSize;
}) {
  const theme = useTheme();
  const metrics = PICKER_TRIGGER_METRICS[size];
  const [hovered, setHovered] = useState(false);
  const solid = open || hovered;
  return (
    <div
      testId="draft-project-trigger"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", display: "flex", flexDirection: "row", minWidth: 0, flexShrink: 1, cursor: "pointer" }}
    >
      <text
        style={{
          color: theme.foreground,
          fontSize: metrics.fontSize,
          lineHeight: metrics.lineHeight,
          fontWeight: 500,
          fontFamily: FONTS.sans,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {label}
      </text>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: metrics.underlineTop,
          height: metrics.underline,
          borderTopWidth: metrics.underline,
          // GPUI paints no dashes on a 1px border, so the thin underline is a faint solid
          // line standing in for web's `border-dotted`.
          borderStyle: solid || metrics.underline < 2 ? "solid" : "dashed",
          borderColor: solid ? theme.foreground : alpha(theme.foreground, metrics.underline < 2 ? 0.18 : 0.3),
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function ProjectPicker({
  items,
  activeKey,
  open,
  onOpenChange,
  onSelect,
  trigger,
}: {
  items: ReadonlyArray<PickerItem>;
  activeKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: PickerItem) => void;
  trigger: React.ReactNode;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const search = normalizeSearchText(query);
  const filtered =
    search.length === 0
      ? items
      : items.filter((item) => item.value !== ADD_PROJECT_VALUE && normalizeSearchText(item.label).includes(search));
  const effective =
    highlighted !== null && filtered.some((item) => item.value === highlighted)
      ? highlighted
      : (filtered.find((item) => item.value === activeKey)?.value ?? filtered[0]?.value ?? null);
  const close = () => {
    setQuery("");
    setHighlighted(null);
    onOpenChange(false);
  };
  const move = (delta: 1 | -1) => {
    if (filtered.length === 0) return;
    const index = filtered.findIndex((item) => item.value === effective);
    setHighlighted(filtered[(index + delta + filtered.length) % filtered.length]!.value);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      side="bottom"
      align="center"
      sideOffset={4}
      testId="draft-project-picker"
      rootStyle={{ minWidth: 0, flexShrink: 1 }}
      style={{ width: 288, padding: 0, overflow: "hidden" }}
      trigger={trigger}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 40, paddingLeft: 12, paddingRight: 12, borderBottomWidth: 1, borderColor: theme.border }}>
        <Icon name="search" size={16} color={alpha(theme.mutedForeground, 0.8)} />
        <input
          testId="draft-project-search"
          autoFocus
          value={query}
          placeholder="Search projects..."
          theme={{ caret: theme.foreground }}
          onChange={(event) => {
            setQuery(event.value ?? "");
            setHighlighted(null);
          }}
          onSubmit={() => {
            const item = filtered.find((candidate) => candidate.value === effective);
            if (item) {
              close();
              onSelect(item);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "down" || event.key === "up") {
              event.preventDefault();
              event.stopPropagation();
              move(event.key === "down" ? 1 : -1);
            }
          }}
          style={{ flexGrow: 1, height: 24, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans, color: theme.foreground }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: 4, maxHeight: 320, overflowY: "scroll" }}>
        {filtered.length === 0 ? (
          <div style={{ paddingTop: 8, paddingBottom: 8, display: "flex", justifyContent: "center" }}>
            <Text color={theme.mutedForeground}>No matching projects.</Text>
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.value}
              testId={`draft-project-option-${item.value}`}
              onClick={() => {
                close();
                onSelect(item);
              }}
              onMouseEnter={() => setHighlighted(item.value)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                minHeight: 28,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: RADIUS.sm,
                backgroundColor: item.value === effective ? theme.accent : "#00000000",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {item.project ? (
                <ProjectGlyph project={item.project} size={16} />
              ) : (
                <Icon name={item.value === ADD_PROJECT_VALUE ? "folder-plus" : "message-square-dashed"} size={16} color={theme.foreground} />
              )}
              <Text truncate style={{ flexGrow: 1 }}>
                {item.label}
              </Text>
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}

export function DraftHeroHeadline({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
}) {
  const theme = useTheme();
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const keybindings = useAtomValue(activeKeybindingsAtom);
  // The scratch helpers read connection state from the registry; subscribing
  // here re-renders when an environment connects or its config arrives.
  useAtomValue(environmentPresentations.presentationsAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noProjectHovered, setNoProjectHovered] = useState(false);
  const small = useSmallViewport();
  const large = useAtomValue(largeViewportAtom);
  // DraftHeroProjectHeading fitsInline: the one-line heading's natural width against the box.
  const [containerWidth, setContainerWidth] = useState(0);
  const [inlineWidth, setInlineWidth] = useState(0);

  const activeProject =
    environmentId !== null && projectId !== null
      ? (projects.find((project) => project.environmentId === environmentId && project.id === projectId) ?? null)
      : null;
  const scratchTargetEnvironmentId = scratchEnvironmentId(environmentId ?? projects[0]?.environmentId ?? null);
  const scratchWorkspaceRoot = scratchWorkspaceRootFor(scratchTargetEnvironmentId);
  const isScratchDraft = activeProject?.isScratch === true;
  const sorted = sortProjectsByActivity(
    projects.filter((project) => project.isScratch !== true),
    threads,
  );
  // buildSidebarProjectPickerEntries: the active project first.
  const menuProjects = activeProject && !isScratchDraft
    ? [activeProject, ...sorted.filter((project) => project !== activeProject)]
    : sorted;
  const pickerItems: PickerItem[] = [
    ...menuProjects.map((project) => ({ value: projectKey(project), label: project.title, project })),
    { value: ADD_PROJECT_VALUE, label: "Add project", project: null },
  ];
  const canChooseProject = menuProjects.length > 0;
  const activeKey = activeProject ? projectKey(activeProject) : "";
  const hasResolvedProject = activeProject !== null;

  const selectItem = (item: PickerItem) => {
    if (item.value === ADD_PROJECT_VALUE) {
      openCommandPalette({ open: "add-project" });
      return;
    }
    if (!item.project || item.value === activeKey) return;
    startNewThread(scopeProjectRef(item.project.environmentId, item.project.id));
  };

  const startScratch = async () => {
    if (scratchTargetEnvironmentId === null || isScratchDraft) return;
    const project = await openScratchProject(scratchTargetEnvironmentId);
    if (project) startNewThread(scopeProjectRef(project.environmentId, project.id));
  };

  const pickerLabel = isScratchDraft ? "No project" : (activeProject?.title ?? "Choose a project");
  const headingInline = large && inlineWidth > 0 && containerWidth > 0 && inlineWidth <= containerWidth;
  // `text-2xl sm:text-3xl` for the stacked heading.
  const headingSize = headingInline || !small ? { fontSize: 30, lineHeight: 36 } : { fontSize: 24, lineHeight: 32 };
  const projectSelector = canChooseProject ? (
    <ProjectPicker
      items={pickerItems}
      activeKey={activeKey}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      onSelect={selectItem}
      trigger={
        <PickerTrigger
          label={pickerLabel}
          open={pickerOpen}
          size={isScratchDraft ? "small" : headingInline ? "heading" : "base"}
          onClick={() => setPickerOpen(!pickerOpen)}
        />
      }
    />
  ) : (
    <div testId="draft-add-project" onClick={() => openCommandPalette({ open: "add-project" })} style={{ display: "flex", cursor: "pointer", borderBottomWidth: 1, borderStyle: "dashed", borderColor: alpha(theme.mutedForeground, 0.35) }}>
      <text style={{ color: alpha(theme.mutedForeground, 0.6), fontSize: 30, lineHeight: 36, fontFamily: FONTS.sans }}>
        {activeProject?.title ?? "Add a project"}
      </text>
    </div>
  );

  const headingText = (value: string) => (
    <text style={{ color: theme.foreground, ...headingSize, fontFamily: FONTS.sans, whiteSpace: "nowrap", flexShrink: 0 }}>{value}</text>
  );

  const noProjectShortcut = shortcutLabelForCommand(keybindings, "chat.newWithoutProject");
  const orStartWithoutProject =
    scratchWorkspaceRoot !== null && !isScratchDraft && (hasResolvedProject || canChooseProject) ? (
      <Tooltip content={noProjectShortcut ?? "Start without a project"} side="bottom">
        <div
          testId="draft-start-without-project"
          onClick={() => void startScratch()}
          onMouseEnter={() => setNoProjectHovered(true)}
          onMouseLeave={() => setNoProjectHovered(false)}
          style={{ display: "flex", cursor: "pointer" }}
        >
          <Text weight={500} color={noProjectHovered ? theme.foreground : theme.mutedForeground} style={noProjectHovered ? { textDecoration: "underline" } : {}}>
            or start without a project
          </Text>
        </div>
      </Tooltip>
    ) : null;

  const projectHeading = hasResolvedProject && !isScratchDraft;
  return (
    <div
      style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 1024 }}
      onLayout={(event) => {
        const width = Math.round(event.width ?? 0);
        if (width !== containerWidth) setContainerWidth(width);
      }}
    >
      {projectHeading ? (
        // The hidden one-line copy DraftHeroProjectHeading measures (`invisible absolute h-0`).
        <div style={{ position: "absolute", top: 0, left: 0, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
          <div
            style={{ display: "flex", flexDirection: "row", gap: 8 }}
            onLayout={(event) => {
              const width = Math.ceil(event.width ?? 0);
              if (width !== inlineWidth) setInlineWidth(width);
            }}
          >
            <text style={{ color: theme.foreground, fontSize: 30, lineHeight: 36, fontFamily: FONTS.sans, whiteSpace: "nowrap" }}>
              What should we build in
            </text>
            <text style={{ color: theme.foreground, fontSize: 30, lineHeight: 36, fontWeight: 500, fontFamily: FONTS.sans, whiteSpace: "nowrap" }}>
              {`${pickerLabel}?`}
            </text>
          </div>
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: projectHeading && !headingInline ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          maxWidth: "100%",
          minWidth: 0,
        }}
      >
        {projectHeading && headingInline ? (
          <>
            {headingText("What should we build in")}
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minWidth: 0, flexShrink: 1 }}>
              {projectSelector}
              {headingText("?")}
            </div>
          </>
        ) : projectHeading ? (
          <>
            {headingText("What should we build?")}
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", minWidth: 0, maxWidth: "100%" }}>
              {projectSelector}
            </div>
          </>
        ) : isScratchDraft ? (
          headingText("What should we work on?")
        ) : canChooseProject ? (
          <>
            {projectSelector}
            {headingText("to start")}
          </>
        ) : (
          headingText("Add a project to start")
        )}
      </div>
      {scratchWorkspaceRoot === null ? null : (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", height: 24, marginTop: 8, width: "100%" }}>
          {isScratchDraft ? projectSelector : orStartWithoutProject}
        </div>
      )}
    </div>
  );
}
