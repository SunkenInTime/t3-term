// Port of apps/web/src/components/AddProjectToMachineDialog.tsx with
// apps/web/src/hooks/useAddProjectTargets.ts and the project-environment list
// from apps/web/src/hooks/useLogicalProjectEnvironments.ts (default repository
// grouping; t3-term has no client grouping settings yet). The clone itself is
// app/src/web/lib/addProjectToMachine.ts.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  canCreateProjectInEnvironment,
  getAddProjectInitialQuery,
  getCloneDestinationPath,
  getCloneDirectoryName,
} from "@t3tools/client-runtime/operations/projects";
import { deriveLogicalProjectKeyFromSettings } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type EnvironmentMachineKind,
  ProjectId,
  type ProjectIgnoredFile,
  type ScopedProjectRef,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import { type CloneProtocol, cloneUrlForProtocol, cloneUrlProtocol } from "@t3tools/shared/cloneUrl";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { useEnvironmentsWithScope } from "../state/dialogs.ts";
import { environmentProjects, projectEnvironment } from "../state/environment.ts";
import { environmentPresentations } from "../state/navigation.ts";
import { routeAtom } from "../state/ui.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Menu, MenuItem } from "../ui/overlay.tsx";
import { Button, Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { splitForMiddleTruncate } from "../web/components/ui/middleTruncate.ts";
import {
  COPYABLE_FILE_MAX_BYTES,
  addProjectToMachine,
  isDefaultCopiedFile,
} from "../web/lib/addProjectToMachine.ts";
import { formatBytes } from "../web/lib/formatBytes.ts";
import {
  DIALOG_WIDTH,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogShell,
  ErrorLine,
  FieldLabel,
  SegmentedToggle,
  TextField,
} from "./dialogKit.tsx";

export interface AddProjectToMachineRequest {
  readonly projectRef: ScopedProjectRef;
  /** Preselects this machine when it is a valid target; otherwise the first target wins. */
  readonly targetEnvironmentId: EnvironmentId | null;
}

const requestAtom = Atom.make<AddProjectToMachineRequest | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs:add-project-to-machine"),
);

/** Opens the dialog that clones a project onto another connected machine. */
export function openAddProjectToMachine(request: AddProjectToMachineRequest): void {
  appAtomRegistry.set(requestAtom, request);
}

const close = () => appAtomRegistry.set(requestAtom, null);

export function AddProjectToMachineDialogHost() {
  const request = useAtomValue(requestAtom);
  return request ? <AddProjectToMachineDialog request={request} /> : null;
}

/** lucide equivalents of apps/web/src/components/EnvironmentMachineIcon.tsx. */
const MACHINE_ICONS: Record<EnvironmentMachineKind, IconName> = {
  server: "server",
  cloud: "cloud",
  linux: "terminal",
  desktop: "monitor",
  laptop: "laptop",
  "mac-mini": "rectangle-horizontal",
  "mac-studio": "square",
};

interface AddProjectTarget {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: EnvironmentMachineKind;
}

const EMPTY_FILES_ATOM = Atom.make(
  AsyncResult.initial<{ readonly files: ReadonlyArray<ProjectIgnoredFile>; readonly truncated: boolean }, never>(false),
);
const DEFAULT_GROUPING = {
  sidebarProjectGroupingMode: "repository",
  sidebarProjectGroupingOverrides: {},
} as const;

/** The machines that already hold this project (useLogicalProjectEnvironments). */
function projectEnvironmentIds(
  project: EnvironmentProject | null,
  projects: ReadonlyArray<EnvironmentProject>,
): ReadonlySet<EnvironmentId> {
  if (!project) return new Set();
  const key = deriveLogicalProjectKeyFromSettings(project, DEFAULT_GROUPING);
  return new Set(
    projects
      .filter((candidate) => deriveLogicalProjectKeyFromSettings(candidate, DEFAULT_GROUPING) === key)
      .map((candidate) => candidate.environmentId),
  );
}

/**
 * A project can be rooted below its repository's top folder. The clone lands
 * at the top, so copied files keep the same path below it.
 */
function projectSubdirectory(repositoryRoot: string | undefined, workspaceRoot: string) {
  if (!repositoryRoot) return "";
  const prefix = repositoryRoot.replace(/[\\/]+$/, "");
  const rest = workspaceRoot.slice(prefix.length);
  return workspaceRoot.startsWith(prefix) && /^[\\/]/.test(rest)
    ? rest.slice(1).replaceAll("\\", "/")
    : "";
}

function defaultSelection(files: readonly ProjectIgnoredFile[]): ReadonlySet<string> {
  return new Set(
    files
      .filter((file) => file.byteLength <= COPYABLE_FILE_MAX_BYTES && isDefaultCopiedFile(file.path))
      .map((file) => file.path),
  );
}

function AddProjectToMachineDialog({ request }: { request: AddProjectToMachineRequest }) {
  const theme = useTheme();
  const project = useAtomValue(environmentProjects.projectAtom(request.projectRef));
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const environmentIds = [...presentations.keys()];
  const canClone = useEnvironmentsWithScope(environmentIds, AuthSourceControlWriteScope);

  // useAddProjectTargets: connected machines without the project that can clone it.
  const hasProject = projectEnvironmentIds(project, projects);
  const targets: AddProjectTarget[] = !project?.repositoryIdentity?.locator.remoteUrl
    ? []
    : [...presentations.entries()]
        .filter(
          ([environmentId, presentation]) =>
            environmentId !== project.environmentId &&
            !hasProject.has(environmentId) &&
            canClone.has(environmentId) &&
            canCreateProjectInEnvironment(presentation.connection.phase) &&
            presentation.serverConfig?.environment.capabilities.projectCloneTracking === true,
        )
        .map(([environmentId, presentation]) => ({
          environmentId,
          label: presentation.entry.target.label,
          machine: resolveEnvironmentMachineKind(presentation.serverConfig),
        }))
        .toSorted((a, b) => a.label.localeCompare(b.label));

  const [targetId, setTargetId] = useState(request.targetEnvironmentId);
  const target = targets.find((t) => t.environmentId === targetId) ?? targets[0] ?? null;
  const source = presentations.get(request.projectRef.environmentId) ?? null;
  const sourceUrl =
    project?.repositoryIdentity?.origin?.remoteUrl ?? project?.repositoryIdentity?.locator.remoteUrl ?? "";
  const [protocol, setProtocol] = useState<CloneProtocol | null>(() => cloneUrlProtocol(sourceUrl));
  const sshUrl = cloneUrlForProtocol(sourceUrl, "ssh");
  const httpsUrl = cloneUrlForProtocol(sourceUrl, "https");
  const remoteUrl = (protocol === "ssh" ? sshUrl : protocol === "https" ? httpsUrl : null) ?? sourceUrl;

  const targetEnvironment = target ? presentations.get(target.environmentId) : undefined;
  const defaultPath = getCloneDestinationPath(
    getAddProjectInitialQuery(targetEnvironment?.serverConfig?.settings.addProjectBaseDirectory),
    getCloneDirectoryName(sourceUrl),
  );
  const [pathOverride, setPathOverride] = useState<string | null>(null);
  const destinationPath = pathOverride ?? defaultPath;

  const canListFiles = source?.serverConfig?.environment.capabilities.ignoredFileListing === true;
  const ignoredFilesResult = useAtomValue(
    project && canListFiles
      ? projectEnvironment.listIgnoredFiles({
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot },
        })
      : EMPTY_FILES_ATOM,
  );
  const ignoredFilesData = Option.getOrNull(AsyncResult.value(ignoredFilesResult));
  const ignoredFilesError =
    ignoredFilesResult._tag === "Failure"
      ? (() => {
          const error = Cause.squash(ignoredFilesResult.cause);
          return error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The environment request failed.";
        })()
      : null;
  const files = ignoredFilesData?.files ?? [];
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const selectedFiles = selected ?? defaultSelection(files);
  const copyable = files.filter((file) => file.byteLength <= COPYABLE_FILE_MAX_BYTES);
  const selectedBytes = files
    .filter((file) => selectedFiles.has(file.path))
    .reduce((total, file) => total + file.byteLength, 0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The project or every target can vanish while the dialog is open. Submitting
  // before the file list loads would silently skip the default .env copies.
  const unavailable =
    project === null ||
    target === null ||
    (canListFiles && ignoredFilesData === null && ignoredFilesError === null);
  useEffect(() => {
    if (project === null && projects.length > 0) close();
  }, [project, projects.length]);

  const toggleFile = (path: string, checked: boolean) => {
    const next = new Set(selectedFiles);
    if (checked) next.add(path);
    else next.delete(path);
    setSelected(next);
  };

  // Lands the user on the new machine right away; its composer shows the clone
  // and holds sends until it finishes.
  const openClonedProject = (targetRef: ScopedProjectRef) => {
    appAtomRegistry.set(routeAtom, {
      kind: "draft",
      environmentId: targetRef.environmentId,
      projectId: targetRef.projectId,
    });
  };

  const submit = async () => {
    if (!project || !target || submitting || unavailable) return;
    if (destinationPath.trim().length === 0) {
      setError("Choose a folder on the other machine.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const projectId = ProjectId.make(crypto.randomUUID());
    try {
      await addProjectToMachine({
        source: { environmentId: project.environmentId, cwd: project.workspaceRoot },
        subdirectory: projectSubdirectory(project.repositoryIdentity?.rootPath, project.workspaceRoot),
        target: { environmentId: target.environmentId, label: target.label },
        projectId,
        title: project.title,
        remoteUrl,
        destinationPath: destinationPath.trim(),
        files: files.filter((file) => selectedFiles.has(file.path)).map((file) => file.path),
      });
      close();
      openClonedProject(scopeProjectRef(target.environmentId, projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the clone.");
      setSubmitting(false);
    }
  };

  const fileCountLabel =
    selectedFiles.size === 0
      ? "no files"
      : `+ ${selectedFiles.size} ${selectedFiles.size === 1 ? "file" : "files"}`;

  return (
    <DialogShell
      width={DIALOG_WIDTH.xl}
      testId="add-to-machine-dialog"
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogHeader
        title="Add to another machine"
        description={`Clone ${project?.repositoryIdentity?.displayName ?? project?.title ?? ""} and bring the local files git does not track.`}
        hasPanel
      />
      <DialogPanel>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
            <MachineLabel
              machine={resolveEnvironmentMachineKind(source?.serverConfig ?? null)}
              label={source?.entry.target.label ?? "This machine"}
            />
            <MiddleTruncate value={project?.workspaceRoot ?? ""} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: 112, flexShrink: 0 }}>
            <Text size="xs" color={theme.mutedForeground}>
              git clone
            </Text>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", alignSelf: "stretch" }}>
              <div style={{ height: 1, flexGrow: 1, backgroundColor: theme.border }} />
              <div style={{ marginLeft: -4 }}>
                <Icon name="arrow-right" size={14} color={theme.mutedForeground} />
              </div>
            </div>
            <Text size="xs" color={theme.mutedForeground}>
              {fileCountLabel}
            </Text>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
            {targets.length > 1 && target ? (
              <TargetSelect targets={targets} target={target} onChange={setTargetId} />
            ) : (
              <MachineLabel machine={target?.machine ?? null} label={target?.label ?? "No machine available"} />
            )}
            <MiddleTruncate value={destinationPath} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldLabel>Clone over</FieldLabel>
          {sshUrl && httpsUrl ? (
            <div style={{ paddingTop: 2 }}>
              <SegmentedToggle
                testId="clone-protocol"
                value={protocol}
                options={[
                  { value: "ssh", label: "SSH" },
                  { value: "https", label: "HTTPS" },
                ]}
                onChange={setProtocol}
              />
            </div>
          ) : null}
          <Text size="xs" mono color={theme.mutedForeground} truncate>
            {remoteUrl}
          </Text>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldLabel>{`Folder on ${target?.label ?? "the other machine"}`}</FieldLabel>
          <TextField
            testId="add-to-machine-path"
            value={destinationPath}
            onChange={setPathOverride}
            onSubmit={() => void submit()}
          />
        </div>

        {canListFiles ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}>
              <FieldLabel style={{ flexGrow: 1 }}>Copy ignored files</FieldLabel>
              {copyable.length > 0 ? (
                <>
                  <Text size="xs" color={theme.mutedForeground}>
                    {`${selectedFiles.size} of ${files.length}${selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ""}`}
                  </Text>
                  <Button
                    variant="ghost"
                    size="xs"
                    testId="add-to-machine-toggle-all"
                    onClick={() =>
                      setSelected(
                        selectedFiles.size === copyable.length
                          ? new Set()
                          : new Set(copyable.map((file) => file.path)),
                      )
                    }
                  >
                    {selectedFiles.size === copyable.length ? "None" : "All"}
                  </Button>
                </>
              ) : null}
            </div>
            {ignoredFilesError ? (
              <ErrorLine color={theme.errorForeground}>{ignoredFilesError}</ErrorLine>
            ) : files.length === 0 ? (
              <Text size="xs" color={theme.mutedForeground}>
                {ignoredFilesResult._tag === "Success" ? "No ignored files to copy." : "Finding ignored files…"}
              </Text>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  maxHeight: 208,
                  overflowY: "scroll",
                  scrollbarColor: theme.scrollbar,
                  borderRadius: RADIUS.md,
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                {files.map((file, index) => (
                  <IgnoredFileRow
                    key={file.path}
                    file={file}
                    last={index === files.length - 1}
                    checked={selectedFiles.has(file.path)}
                    onCheckedChange={(checked) => toggleFile(file.path, checked)}
                  />
                ))}
              </div>
            )}
            {ignoredFilesData?.truncated ? (
              <Text size="xs" color={theme.mutedForeground}>
                {`Showing the first ${files.length} files.`}
              </Text>
            ) : null}
            <Text size="xs" color={theme.mutedForeground}>
              Files are copied after the clone finishes. Folders git ignores whole, like node_modules, are left out.
            </Text>
          </div>
        ) : null}

        {error ? <ErrorLine size="sm" color={theme.errorForeground}>{error}</ErrorLine> : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" testId="add-to-machine-cancel" onClick={close}>
          Cancel
        </Button>
        <Button testId="add-to-machine-submit" disabled={unavailable || submitting} onClick={() => void submit()}>
          {submitting ? "Starting…" : `Clone to ${target?.label ?? "machine"}`}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}

function MachineLabel({ machine, label }: { machine: EnvironmentMachineKind | null; label: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
      {machine ? <Icon name={MACHINE_ICONS[machine]} size={14} color={theme.foreground} /> : null}
      <Text weight={500} truncate>
        {label}
      </Text>
    </div>
  );
}

/** apps/web/src/components/ui/middle-truncate.tsx: truncated head, kept tail. */
function MiddleTruncate({ value }: { value: string }) {
  const theme = useTheme();
  const split = splitForMiddleTruncate(value);
  const style = { color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.mono } as const;
  return (
    <div style={{ display: "flex", flexDirection: "row", minWidth: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", minWidth: 0, flexShrink: 1 }}>
        <text style={{ ...style, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
          {split ? split.head : value}
        </text>
      </div>
      {split ? (
        <div style={{ display: "flex", flexShrink: 0 }}>
          <text style={{ ...style, whiteSpace: "nowrap" }}>{split.tail}</text>
        </div>
      ) : null}
    </div>
  );
}

function TargetSelect({
  targets,
  target,
  onChange,
}: {
  targets: ReadonlyArray<AddProjectTarget>;
  target: AddProjectTarget;
  onChange: (environmentId: EnvironmentId) => void;
}) {
  const theme = useTheme();
  return (
    <Menu
      align="start"
      minWidth={160}
      testId="add-to-machine-target-menu"
      trigger={({ toggle }) => (
        <div
          testId="add-to-machine-target"
          onClick={toggle}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minHeight: 28,
            paddingLeft: 9,
            paddingRight: 9,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: alpha(theme.input, 0.32),
            cursor: "pointer",
          }}
        >
          <Icon name={MACHINE_ICONS[target.machine]} size={14} color={theme.mutedForeground} />
          <Text truncate style={{ flexGrow: 1 }}>
            {target.label}
          </Text>
          <Icon name="chevron-down" size={12} color={alpha(theme.mutedForeground, 0.5)} />
        </div>
      )}
    >
      {targets.map((t) => (
        <MenuItem key={t.environmentId} checked={t.environmentId === target.environmentId} onSelect={() => onChange(t.environmentId)}>
          {t.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

function IgnoredFileRow({
  file,
  last,
  checked,
  onCheckedChange,
}: {
  file: ProjectIgnoredFile;
  last: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const theme = useTheme();
  const tooLarge = file.byteLength > COPYABLE_FILE_MAX_BYTES;
  return (
    <div
      onClick={tooLarge ? undefined : () => onCheckedChange(!checked)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        borderBottomWidth: last ? 0 : 1,
        borderColor: theme.border,
        opacity: tooLarge ? 0.64 : 1,
        cursor: tooLarge ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: 4,
          borderWidth: checked ? 0 : 1,
          borderColor: theme.input,
          backgroundColor: checked ? theme.primary : alpha(theme.input, 0.32),
          flexShrink: 0,
          pointerEvents: "none",
        }}
      >
        {checked ? <Icon name="check" size={12} color={theme.primaryForeground} /> : null}
      </div>
      <Text size="xs" mono truncate style={{ flexGrow: 1 }}>
        {file.path}
      </Text>
      <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
        {tooLarge ? "Over 1 MB" : formatBytes(file.byteLength)}
      </Text>
    </div>
  );
}
