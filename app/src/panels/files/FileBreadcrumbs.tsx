// Port of apps/web/src/components/files/FileBreadcrumbs.tsx.
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { isHostPath } from "@t3tools/shared/path";
import { useState, type ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  breadcrumbPathOf,
  type FileBreadcrumb,
  fileBreadcrumbChildren,
  fileBreadcrumbParent,
  fileBreadcrumbs,
  isListableHostFolder,
} from "../../web/components/files/filePath.ts";
import { useProjectEntriesQuery } from "../../web/components/files/projectFilesQueryState.ts";
import { FileEntryIcon } from "./FileEntryIcon.tsx";
import { useWorkspaceMutationRefresh } from "./workspaceMutation.ts";

interface FileBreadcrumbsProps {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  /** Moves the browser to a folder crumb; `""` is the workspace root. */
  readonly onNavigateFolder: (relativePath: string) => void;
  readonly onOpenFile: (relativePath: string) => void;
  readonly projectName: string;
  /** The current path; `""` is the workspace root. */
  readonly relativePath: string;
  /** The deepest path to show: `relativePath`, or a path inside it the browser came up from. */
  readonly trail: string;
  readonly workspaceMutationId: string | null;
}

function pathLabel(path: string, projectName: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || projectName;
}

function crumbText(label: string, color: string, weight?: number) {
  return (
    <text
      style={{
        color,
        fontSize: 12,
        lineHeight: 16,
        fontFamily: FONTS.sans,
        ...(weight === undefined ? {} : { fontWeight: weight }),
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        overflow: "hidden",
        maxWidth: 156,
        pointerEvents: "none",
      }}
    >
      {label}
    </text>
  );
}

function BreadcrumbLabel(props: { readonly current?: boolean; readonly label: string; readonly pathLabel: string }) {
  const theme = useTheme();
  return (
    <Tooltip content={props.pathLabel} side="top">
      <div testId={props.current ? "files-crumb-current" : undefined} style={{ display: "flex", paddingLeft: 2, paddingRight: 2, borderRadius: 4 }}>
        {crumbText(props.label, props.current ? theme.foreground : theme.mutedForeground, props.current ? 500 : undefined)}
      </div>
    </Tooltip>
  );
}

function MenuRow(props: {
  readonly children: ReactNode;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={props.testId}
      onClick={props.disabled ? undefined : props.onPress}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 28,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        opacity: props.disabled ? 0.64 : 1,
        cursor: props.disabled ? "default" : "pointer",
        ...(props.disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      {props.children}
    </div>
  );
}

function MenuSeparatorLine() {
  const theme = useTheme();
  return <div style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: -4, marginRight: -4, backgroundColor: theme.border, flexShrink: 0 }} />;
}

function BreadcrumbMenuContent(props: {
  readonly cwd: string;
  readonly currentFilePath: string;
  readonly directoryPath: string;
  readonly environmentId: EnvironmentId;
  readonly onDirectoryChange: (path: string) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenFile: (path: string) => void;
  readonly projectName: string;
  readonly rootPath: string;
  readonly workspaceMutationId: string | null;
}) {
  const theme = useTheme();
  const entriesQuery = useProjectEntriesQuery(props.environmentId, props.cwd, props.directoryPath);
  useWorkspaceMutationRefresh({
    mutationId: props.workspaceMutationId,
    refresh: entriesQuery.refresh,
    resourceKey: `files:${props.environmentId}:${props.cwd}`,
  });
  const entries: readonly ProjectEntry[] = entriesQuery.data?.entries ?? [];
  const entriesTruncated = entriesQuery.data?.truncated ?? false;
  const children = fileBreadcrumbChildren(entries, props.directoryPath);
  const directoryAvailable = entriesQuery.data !== null;
  const parentPath = fileBreadcrumbParent(props.directoryPath);
  const canGoBack =
    props.directoryPath !== props.rootPath &&
    parentPath !== null &&
    (props.rootPath === "" || parentPath === props.rootPath || parentPath.startsWith(`${props.rootPath}/`));
  const label = (text: string, color = theme.foreground) => (
    <Text color={color} truncate style={{ flexGrow: 1 }}>
      {text}
    </Text>
  );

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "left" || !canGoBack || parentPath === null) return;
        event.preventDefault();
        event.stopPropagation();
        props.onDirectoryChange(parentPath);
      }}
      style={{ display: "flex", flexDirection: "column" }}
    >
      {canGoBack && parentPath !== null ? (
        <>
          <MenuRow testId="files-crumb-menu-back" onPress={() => props.onDirectoryChange(parentPath)}>
            <Icon name="arrow-left" size={16} color={theme.mutedForeground} />
            {label(`Back to ${pathLabel(parentPath, props.projectName)}`)}
          </MenuRow>
          <MenuSeparatorLine />
        </>
      ) : null}
      {entriesQuery.isPending && entriesQuery.data === null ? (
        <MenuRow disabled>
          <Icon name="loader-circle" size={16} color={theme.mutedForeground} />
          {label("Loading folder…")}
        </MenuRow>
      ) : entriesQuery.error && entriesQuery.data === null ? (
        <MenuRow onPress={entriesQuery.refresh}>
          <Icon name="refresh-cw" size={16} color={theme.mutedForeground} />
          {label("Retry loading folder")}
        </MenuRow>
      ) : !directoryAvailable && !entriesTruncated ? (
        <MenuRow disabled>{label("This folder is no longer available.")}</MenuRow>
      ) : children.length === 0 ? (
        <MenuRow disabled>
          {label(
            entriesTruncated
              ? "No entries from this folder are available in the partial workspace index."
              : "This folder is empty.",
          )}
        </MenuRow>
      ) : (
        children.map((entry) => {
          const isCurrentFile = entry.kind === "file" && entry.path === props.currentFilePath;
          return (
            <MenuRow
              key={entry.path}
              testId={`files-crumb-menu:${entry.path}`}
              onPress={() => {
                if (entry.kind === "directory") {
                  props.onDirectoryChange(entry.path);
                  return;
                }
                props.onOpenChange(false);
                props.onOpenFile(entry.path);
              }}
            >
              {entry.kind === "directory" ? (
                <Icon name="folder" size={16} color={theme.mutedForeground} />
              ) : (
                <FileEntryIcon pathValue={entry.path} kind="file" />
              )}
              {label(entry.label, entry.ignored ? theme.mutedForeground : theme.foreground)}
              {entry.kind === "directory" ? (
                <Icon name="chevron-right" size={16} color={theme.mutedForeground} />
              ) : isCurrentFile ? (
                <Icon name="check" size={16} color={theme.foreground} />
              ) : null}
            </MenuRow>
          );
        })
      )}
      {entriesQuery.error && entriesQuery.data !== null ? (
        <>
          <MenuSeparatorLine />
          <MenuRow onPress={entriesQuery.refresh}>
            <Icon name="refresh-cw" size={16} color={theme.mutedForeground} />
            {label("Refresh failed. Retry")}
          </MenuRow>
        </>
      ) : null}
      {entriesTruncated ? (
        <>
          <MenuSeparatorLine />
          <MenuRow disabled>{label("Some workspace entries are not shown.")}</MenuRow>
        </>
      ) : null}
    </div>
  );
}

/** The chevron after a folder crumb lists that folder's entries. */
function FolderContentsMenu(props: FileBreadcrumbsProps & { readonly crumb: FileBreadcrumb }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [directoryPath, setDirectoryPath] = useState(props.crumb.path);
  // Opening another file or moving the crumb closes the menu and returns it to the crumb's folder.
  const [shownFor, setShownFor] = useState({ crumbPath: props.crumb.path, relativePath: props.relativePath });
  if (shownFor.crumbPath !== props.crumb.path || shownFor.relativePath !== props.relativePath) {
    setShownFor({ crumbPath: props.crumb.path, relativePath: props.relativePath });
    setOpen(false);
    setDirectoryPath(props.crumb.path);
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setDirectoryPath(props.crumb.path);
  };

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      side="bottom"
      align="start"
      testId={`files-crumb-menu-popup:${props.crumb.path}`}
      style={{ padding: 4, minWidth: 192, maxWidth: 320, maxHeight: 360, overflowY: "scroll" }}
      rootStyle={{ flexShrink: 0 }}
      trigger={
        <div
          testId={`files-crumb-chevron:${props.crumb.path}`}
          role="button"
          aria-label={`Browse ${props.crumb.label}`}
          onClick={() => handleOpenChange(!open)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 20,
            marginLeft: 2,
            marginRight: 2,
            borderRadius: 4,
            flexShrink: 0,
            cursor: "pointer",
            backgroundColor: open ? theme.accent : "#00000000",
            hover: { backgroundColor: theme.accent },
          }}
        >
          <Icon name="chevron-right" size={14} color={open ? theme.foreground : alpha(theme.mutedForeground, 0.6)} />
        </div>
      }
    >
      {open ? (
        <BreadcrumbMenuContent
          cwd={props.cwd}
          currentFilePath={props.relativePath}
          directoryPath={directoryPath}
          environmentId={props.environmentId}
          onDirectoryChange={setDirectoryPath}
          onOpenChange={handleOpenChange}
          onOpenFile={props.onOpenFile}
          projectName={props.projectName}
          rootPath={props.crumb.path}
          workspaceMutationId={props.workspaceMutationId}
        />
      ) : null}
    </Popover>
  );
}

function FolderBreadcrumb(props: {
  readonly crumb: FileBreadcrumb;
  /** Below the current folder, kept from where the browser came from. */
  readonly descendant: boolean;
  readonly onNavigate: (path: string) => void;
  readonly projectName: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const color = hovered
    ? theme.foreground
    : props.descendant
      ? alpha(theme.mutedForeground, 0.7)
      : theme.mutedForeground;
  return (
    <Tooltip content={props.crumb.path || props.projectName} side="top">
      <div
        testId={`files-crumb:${props.crumb.path || "project"}`}
        role="button"
        onClick={() => props.onNavigate(props.crumb.path)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          paddingLeft: 2,
          paddingRight: 2,
          borderRadius: 4,
          cursor: "pointer",
          hover: { backgroundColor: theme.accent },
        }}
      >
        {crumbText(props.crumb.label, color)}
      </div>
    </Tooltip>
  );
}

/**
 * Each folder crumb moves the browser to that folder, and the chevron after it
 * lists the folder's entries. A host path outside the workspace has no contents
 * menu: the browser below already lists the folder it moves to.
 */
export function FileBreadcrumbs(props: FileBreadcrumbsProps) {
  const theme = useTheme();
  const hostPath = isHostPath(props.relativePath);
  const breadcrumbs = fileBreadcrumbs(props.projectName, props.trail);
  const currentPath = breadcrumbPathOf(props.relativePath);
  const currentIndex = breadcrumbs.findIndex((crumb) => crumb.path === currentPath);

  return (
    <div role="navigation" aria-label="File path" style={{ display: "flex", flexDirection: "row", alignItems: "center", height: "100%" }}>
      {breadcrumbs.map((crumb, index) => {
        const current = index === currentIndex;
        return (
          <div key={crumb.path || "project"} style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
            {current ? (
              <BreadcrumbLabel current label={crumb.label} pathLabel={crumb.path || props.projectName} />
            ) : hostPath && !isListableHostFolder(crumb.path) ? (
              <BreadcrumbLabel label={crumb.label} pathLabel={crumb.path} />
            ) : (
              <FolderBreadcrumb
                crumb={crumb}
                descendant={index > currentIndex}
                onNavigate={props.onNavigateFolder}
                projectName={props.projectName}
              />
            )}
            {index === breadcrumbs.length - 1 ? null : hostPath ? (
              <div style={{ marginLeft: 4, marginRight: 4, display: "flex" }}>
                <Icon name="chevron-right" size={14} color={alpha(theme.mutedForeground, 0.6)} />
              </div>
            ) : (
              <FolderContentsMenu {...props} crumb={crumb} />
            )}
          </div>
        );
      })}
    </div>
  );
}
