// The Workspace section of the details card: run context (environment + local
// checkout / worktree, BranchToolbar.tsx RunContextSelector in panel mode), Open in
// editor (chat/OpenInPicker.tsx) and project scripts (ProjectScriptsControl.tsx).
import { useAtomValue } from "@effect/atom-react";
import { DismissableLayer } from "@gpuix/react";
import { FloatingLayer } from "@gpuix/react/floating";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  buildRemoteOpenUrl,
  EDITORS,
  REMOTE_CAPABLE_EDITOR_IDS,
  resolveEnvironmentMachineKind,
  type EditorId,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type OrchestrationProjectShell,
  type ProjectScript,
  type ProjectScriptIcon,
} from "@t3tools/contracts";
import { projectScriptMenuLabel, projectScriptTerminalInput, resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as Option from "effect/Option";
import { useState, type ReactNode } from "react";

import { resolveNewThreadEnvMode, resolveProjectSettings } from "@t3tools/shared/projectSettings";

import type { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerDraftAtom, setDraftWorkspace } from "../../state/composer.ts";
import { environmentCatalog, serverEnvironment, shellEnvironment } from "../../state/environment.ts";
import {
  lastInvokedScriptPref,
  pendingEnvModeAtom,
  preferredEditorPref,
  scriptTerminalEnvironment,
} from "../../state/git.ts";
import { terminalOpenAtom } from "../../state/ui.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Dialog, Switch, Tooltip, surfaceStyle } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, useTheme } from "../../ui/theme.ts";
import {
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveLockedWorkspaceLabel,
} from "../../web/components/BranchToolbar.logic.ts";
import { shortcutLabelForCommand } from "../../web/keybindings.ts";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
  releaseClaimedRoles,
} from "../../web/projectScripts.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../../web/state/session.ts";
import { ActionMenu } from "../header/ActionMenu.tsx";
import { copyTextToClipboard, openWithOs } from "../header/osActions.ts";
import { DetailsIcon, DetailsLabel, DetailsRow, DetailsSelectRow, DetailsSplit } from "./detailsControls.tsx";
import { FieldLabel, TextField } from "./formControls.tsx";

const MENU_WIDTH = 262;

const MACHINE_ICONS: Record<EnvironmentMachineKind, IconName> = {
  server: "server",
  cloud: "cloud",
  linux: "terminal",
  desktop: "monitor",
  laptop: "laptop",
  "mac-mini": "server",
  "mac-studio": "monitor",
};

/** A menu surface hung under a full-width row, like web's `w-(--anchor-width)` popups. */
function RowMenu({
  open,
  onClose,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  if (!open) return null;
  return (
    <DismissableLayer onEscapeKeyDown={onClose}>
      <FloatingLayer
        side="bottom"
        align="start"
        sideOffset={4}
        testId={testId}
        onMouseDownOutside={onClose}
        style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", padding: 4, width: MENU_WIDTH }}
      >
        {children}
      </FloatingLayer>
    </DismissableLayer>
  );
}

export function MenuRowItem({
  icon,
  label,
  onClick,
  disabled,
  selected,
  shortcut,
  trailing,
  testId,
  iconColor,
}: {
  icon?: IconName | null;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  shortcut?: string | null;
  trailing?: ReactNode;
  testId?: string;
  iconColor?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
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
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        backgroundColor: selected ? theme.accent : "#00000000",
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      {icon ? <Icon name={icon} size={16} color={iconColor ?? theme.mutedForeground} /> : null}
      <text
        style={{
          color: theme.foreground,
          fontSize: 14,
          lineHeight: 20,
          fontFamily: FONTS.sans,
          flexGrow: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
        }}
      >
        {label}
      </text>
      {trailing}
      {shortcut ? (
        <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, flexShrink: 0 }}>{shortcut}</text>
      ) : null}
    </div>
  );
}

function MenuGroupLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 4 }}>
      <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>{children}</text>
    </div>
  );
}

function useEnvironmentLabel(environmentId: EnvironmentId): string {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return catalog.entries.get(environmentId)?.target.label ?? config?.environment.label ?? environmentId;
}

// ── Run context ───────────────────────────────────────────────────────────

export function RunContextRow({
  environmentId,
  thread,
  draftKey = "",
  project,
  envLocked,
}: {
  environmentId: EnvironmentId;
  /** Null for a new-thread draft, whose workspace lives on the composer draft (`draftKey`). */
  thread: EnvironmentThreadShell | null;
  draftKey?: string;
  project: OrchestrationProjectShell;
  envLocked: boolean;
}) {
  const theme = useTheme();
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const environmentLabel = useEnvironmentLabel(environmentId);
  const threadKey = thread ? `${environmentId}:${thread.id}` : "";
  const pendingEnvMode = useAtomValue(pendingEnvModeAtom(threadKey));
  const draft = useAtomValue(composerDraftAtom(draftKey));
  const [open, setOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const activeWorktreePath = thread ? thread.worktreePath : (draft.worktreePath ?? null);
  // A draft that reuses an existing worktree counts as its current checkout (composer BranchToolbar).
  const effectiveEnvMode = thread
    ? activeWorktreePath
      ? "worktree"
      : (pendingEnvMode ?? "local")
    : activeWorktreePath
      ? "local"
      : (draft.envMode ?? "local");
  const envModeLocked = thread ? envLocked || activeWorktreePath !== null : false;
  const workspaceIcon: IconName = effectiveEnvMode === "worktree" ? "folder-git-2" : activeWorktreePath ? "folder-git" : "folder";
  const workspaceLabel = envModeLocked
    ? resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode)
    : effectiveEnvMode === "worktree"
      ? resolveEnvModeLabel("worktree")
      : resolveCurrentWorkspaceLabel(activeWorktreePath);
  const workspacePath = effectiveEnvMode === "worktree" && !activeWorktreePath ? null : (activeWorktreePath ?? project.workspaceRoot);
  const machine = MACHINE_ICONS[resolveEnvironmentMachineKind(config ?? null)] ?? "server";

  const content = (
    <>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <Tooltip content={environmentLabel}>
          <div style={{ display: "flex" }}>
            <DetailsIcon name={machine} />
          </div>
        </Tooltip>
        <Tooltip content={workspacePath ?? workspaceLabel}>
          <div style={{ display: "flex" }}>
            <DetailsIcon name={workspaceIcon} />
          </div>
        </Tooltip>
      </div>
      <DetailsLabel>{environmentLabel}</DetailsLabel>
    </>
  );
  const copyPath = () => {
    if (!workspacePath) return;
    void copyTextToClipboard(workspacePath).then(
      () => toast({ type: "success", title: "Path copied", description: workspacePath }),
      (error) => toast({ type: "error", title: "Failed to copy path", description: error instanceof Error ? error.message : "An error occurred." }),
    );
  };
  const row = envModeLocked ? (
    <DetailsRow testId="run-context" onRightClick={() => setContextOpen(true)}>
      {content}
    </DetailsRow>
  ) : (
    <DetailsSelectRow testId="run-context" open={open} onToggle={() => setOpen(!open)} onRightClick={() => setContextOpen(true)}>
      {content}
    </DetailsSelectRow>
  );
  const choose = (mode: "local" | "worktree") => {
    setOpen(false);
    if (thread) {
      appAtomRegistry.set(pendingEnvModeAtom(threadKey), mode);
      return;
    }
    const projectSettings = config ? resolveProjectSettings(config.settings, project.id, project, null) : null;
    setDraftWorkspace(draftKey, {
      envMode: mode,
      startFromOrigin: mode === "worktree" && (projectSettings?.settings.newWorktreesStartFromOrigin ?? false),
      ...(mode === "worktree" && activeWorktreePath ? { worktreePath: null } : {}),
    });
  };
  return (
    <div style={{ display: "flex", position: "relative", width: "100%", flexDirection: "column" }}>
      <ActionMenu<"copy-path">
        open={contextOpen}
        onOpenChange={setContextOpen}
        items={[{ id: "copy-path", label: "Copy full path", icon: "copy", disabled: workspacePath === null }]}
        onSelect={copyPath}
        rootStyle={{ width: "100%" }}
        trigger={row}
      />
      <RowMenu open={open} onClose={() => setOpen(false)} testId="run-context-menu">
        <MenuGroupLabel>Workspace</MenuGroupLabel>
        <MenuRowItem
          testId="run-context-local"
          icon={activeWorktreePath ? "folder-git" : "folder"}
          label={resolveCurrentWorkspaceLabel(activeWorktreePath)}
          selected={effectiveEnvMode === "local"}
          onClick={() => choose("local")}
        />
        <MenuRowItem
          testId="run-context-worktree"
          icon="folder-git-2"
          label={resolveEnvModeLabel("worktree")}
          selected={effectiveEnvMode === "worktree"}
          onClick={() => choose("worktree")}
        />
      </RowMenu>
    </div>
  );
}

// ── Open in editor ────────────────────────────────────────────────────────

export type RemoteOpenState =
  | { readonly mode: "local-exec" }
  | { readonly mode: "remote-links"; readonly host: { readonly host: string; readonly username?: string } }
  | { readonly mode: "remote-unavailable" };

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || host.startsWith("127.") || host.endsWith(".localhost");
}

/**
 * Where "Open in" runs (web's remoteOpen.ts resolveRemoteOpenState). t3-term is a native
 * process on the viewer's machine:
 * - a loopback server is this machine, so the server launches the editor (local-exec);
 * - an SSH connection or a server advertising remoteOpenTargets gets editor deep links
 *   (vscode-remote, zed ssh, JetBrains Gateway) handed to this machine's OS (remote-links);
 * - anything else cannot reach the files from here (remote-unavailable).
 */
function useRemoteOpenState(environmentId: EnvironmentId): RemoteOpenState {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return resolveRemoteOpenState(catalog, config, environmentId);
}

/** useRemoteOpenState for callers outside render (markdown link menus read it at click time). */
export function readRemoteOpenState(environmentId: EnvironmentId): RemoteOpenState {
  return resolveRemoteOpenState(
    appAtomRegistry.get(environmentCatalog.catalogValueAtom),
    appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId)),
    environmentId,
  );
}

function resolveRemoteOpenState(
  catalog: Atom.Type<typeof environmentCatalog.catalogValueAtom>,
  config: Atom.Type<ReturnType<typeof serverEnvironment.configValueAtom>>,
  environmentId: EnvironmentId,
): RemoteOpenState {
  const entry = catalog.entries.get(environmentId);
  if (!entry) return { mode: "local-exec" };
  const profile = Option.getOrNull(entry.profile);
  const target = entry.target as { _tag: string; httpBaseUrl?: string };
  const baseUrl =
    target._tag === "PrimaryConnectionTarget"
      ? target.httpBaseUrl
      : profile !== null && profile._tag === "BearerConnectionProfile"
        ? profile.httpBaseUrl
        : undefined;
  if (baseUrl) {
    try {
      if (isLoopbackHostname(new URL(baseUrl).hostname)) return { mode: "local-exec" };
    } catch {}
  }
  if (profile !== null && profile._tag === "SshConnectionProfile" && profile.target.alias.length > 0) {
    const alias = profile.target.alias;
    const at = alias.lastIndexOf("@");
    const username = profile.target.username?.trim() || (at === -1 ? null : alias.slice(0, at));
    return { mode: "remote-links", host: { host: at === -1 ? alias : alias.slice(at + 1), ...(username ? { username } : {}) } };
  }
  const advertised = config?.remoteOpenTargets?.[0];
  if (advertised) return { mode: "remote-links", host: advertised };
  return { mode: "remote-unavailable" };
}

function editorLabel(editorId: EditorId): string {
  if (editorId === "file-manager") {
    return process.platform === "darwin" ? "Finder" : process.platform === "win32" ? "File Explorer" : "Files";
  }
  return EDITORS.find((editor) => editor.id === editorId)?.label ?? "Editor";
}

function editorIcon(editorId: EditorId): IconName {
  if (editorId === "file-manager") return "folder";
  if (editorId === "zed") return "square-code";
  // Web draws each editor's brand mark (OpenInPicker.tsx); Cursor's is bundled here.
  if (editorId === "cursor") return "brand-cursor";
  return "code";
}

export function OpenInRow({
  environmentId,
  openInCwd,
}: {
  environmentId: EnvironmentId;
  openInCwd: string | null;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const remote = useRemoteOpenState(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const preferred = useAtomValue(preferredEditorPref.atom) as EditorId | "";
  const environmentLabel = useEnvironmentLabel(environmentId);
  const [open, setOpen] = useState(false);
  const denied = remote.mode === "local-exec" && !canOperate;
  const canOpen = remote.mode !== "remote-unavailable" && !denied;
  const available = remote.mode === "local-exec" ? (config?.availableEditors ?? []) : REMOTE_CAPABLE_EDITOR_IDS;
  const effective: EditorId | null =
    preferred && available.includes(preferred)
      ? preferred
      : (EDITORS.find((editor) => available.includes(editor.id))?.id ?? null);
  const options = EDITORS.map((editor) => editor.id).filter((id) => available.includes(id));
  if (available.includes("file-manager") && !options.includes("file-manager")) options.push("file-manager");
  const shortcut = shortcutLabelForCommand(config?.keybindings ?? [], "editor.openFavorite");

  const openIn = async (editor: EditorId | null) => {
    if (!openInCwd || !editor) return;
    if (remote.mode === "remote-unavailable") return;
    if (remote.mode === "remote-links") {
      const url = buildRemoteOpenUrl({ editor, ...remote.host, absolutePath: openInCwd });
      if (url && openWithOs(url)) preferredEditorPref.set(editor);
      return;
    }
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    preferredEditorPref.set(editor);
    const result = (await runAtomCommand(
      appAtomRegistry,
      shellEnvironment.openInEditor,
      { environmentId, input: { cwd: openInCwd, editor } } as never,
      { reportFailure: false },
    )) as AtomCommandResult<unknown, unknown>;
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toast({ type: "error", title: "Unable to open in editor", description: error instanceof Error ? error.message : "An error occurred." });
    }
  };

  return (
    <div style={{ display: "flex", position: "relative", width: "100%", flexDirection: "column" }}>
      <DetailsSplit
        testId="open-in"
        primary={
          <>
            <DetailsIcon name={effective ? editorIcon(effective) : "square-arrow-out-up-right"} />
            <DetailsLabel>{`Open in ${effective ? editorLabel(effective) : "editor"}`}</DetailsLabel>
          </>
        }
        onPrimary={() => void openIn(effective)}
        primaryDisabled={!effective || !openInCwd || !canOpen}
        menuOpen={open}
        onToggleMenu={() => setOpen(!open)}
        secondaryDisabled={denied}
      />
      <RowMenu open={open} onClose={() => setOpen(false)} testId="open-in-menu">
        {remote.mode === "remote-unavailable" ? (
          <MenuRowItem label={`No SSH route to ${environmentLabel}`} disabled />
        ) : (
          <>
            {options.length === 0 ? <MenuRowItem label="No installed editors found" disabled /> : null}
            {options.map((editor) => (
              <MenuRowItem
                key={editor}
                testId={`open-in-${editor}`}
                icon={editorIcon(editor)}
                label={editorLabel(editor)}
                disabled={!openInCwd || !canOpen}
                shortcut={editor === effective ? shortcut : null}
                onClick={() => {
                  setOpen(false);
                  preferredEditorPref.set(editor);
                }}
              />
            ))}
            {remote.mode === "remote-links" ? <MenuRowItem label={`Opens over SSH. Needs your key on ${environmentLabel}`} disabled /> : null}
          </>
        )}
      </RowMenu>
    </div>
  );
}

// ── Project scripts ───────────────────────────────────────────────────────

const SCRIPT_ICONS: ReadonlyArray<{ id: ProjectScriptIcon; label: string; icon: IconName }> = [
  { id: "play", label: "Play", icon: "play" },
  { id: "test", label: "Test", icon: "flask-conical" },
  { id: "lint", label: "Lint", icon: "list-checks" },
  { id: "configure", label: "Configure", icon: "wrench" },
  { id: "build", label: "Build", icon: "hammer" },
  { id: "debug", label: "Debug", icon: "bug" },
];

function scriptIcon(icon: ProjectScriptIcon): IconName {
  return SCRIPT_ICONS.find((entry) => entry.id === icon)?.icon ?? "play";
}

interface ScriptDraft {
  readonly scriptId: string | null;
  readonly name: string;
  readonly command: string;
  readonly icon: ProjectScriptIcon;
  readonly runOnWorktreeCreate: boolean;
  readonly runOnSettle: boolean;
  readonly previewUrl: string;
  readonly error?: string;
}

const EMPTY_DRAFT: ScriptDraft = {
  scriptId: null,
  name: "",
  command: "",
  icon: "play",
  runOnWorktreeCreate: false,
  runOnSettle: false,
  previewUrl: "",
};

export function ProjectScriptsRow({
  environmentId,
  thread,
  project,
  gitCwd,
}: {
  environmentId: EnvironmentId;
  /** Null for a draft: scripts open in a thread's terminal, so they run once the thread exists. */
  thread: EnvironmentThreadShell | null;
  project: OrchestrationProjectShell;
  gitCwd: string | null;
}) {
  const theme = useTheme();
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const lastInvoked = useAtomValue(lastInvokedScriptPref.atom);
  const canRunTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<ScriptDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const settings = config?.settings;
  const scripts: ReadonlyArray<ProjectScript> = settings ? resolveProjectScripts(settings, project) : project.scripts;
  const preferredId = lastInvoked[project.id] ?? null;
  const primary = (preferredId ? scripts.find((script) => script.id === preferredId) : undefined) ?? primaryProjectScript(scripts);

  const runScript = async (script: ProjectScript) => {
    setMenuOpen(false);
    if (!thread) {
      toast({ type: "info", title: `Send a message first to run "${script.name}"`, description: "Scripts run in the thread's terminal." });
      return;
    }
    if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
      toast({ type: "error", title: "Cannot run scripts", description: "Pair this client again with permission to run terminal commands." });
      return;
    }
    lastInvokedScriptPref.set({ ...lastInvoked, [project.id]: script.id });
    const terminalId = `script-${script.id}-${Date.now().toString(36)}`;
    const cwd = gitCwd ?? project.workspaceRoot;
    const opened = (await runAtomCommand(
      appAtomRegistry,
      scriptTerminalEnvironment.open,
      {
        environmentId,
        input: { threadId: thread.id, terminalId, cwd, worktreePath: thread.worktreePath ?? null, cols: 120, rows: 30 },
      } as never,
      { reportFailure: false },
    )) as AtomCommandResult<unknown, unknown>;
    if (opened._tag === "Failure") {
      if (!isAtomCommandInterrupted(opened)) {
        const error = squashAtomCommandFailure(opened);
        toast({ type: "error", title: `Failed to run script "${script.name}"`, description: error instanceof Error ? error.message : "" });
      }
      return;
    }
    const written = (await runAtomCommand(
      appAtomRegistry,
      scriptTerminalEnvironment.write,
      { environmentId, input: { threadId: thread.id, terminalId, data: projectScriptTerminalInput(script.command) } } as never,
      { reportFailure: false },
    )) as AtomCommandResult<unknown, unknown>;
    if (written._tag === "Failure" && !isAtomCommandInterrupted(written)) {
      const error = squashAtomCommandFailure(written);
      toast({ type: "error", title: `Failed to run script "${script.name}"`, description: error instanceof Error ? error.message : "" });
      return;
    }
    appAtomRegistry.set(terminalOpenAtom, true);
  };

  const persist = async (nextScripts: ReadonlyArray<ProjectScript>) => {
    const projectOverrides = config?.environment.capabilities.projectSettingsOverrides === true;
    const patch = projectOverrides
      ? {
          projectSettingsOverrides: {
            [project.id]: { ...settings?.projectSettingsOverrides[project.id], defaultProjectScripts: nextScripts },
          },
        }
      : { projectScriptOverrides: { [project.id]: nextScripts } };
    return (await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.updateSettings,
      { environmentId, input: { patch } } as never,
      { reportFailure: false },
    )) as AtomCommandResult<unknown, unknown>;
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const command = draft.command.trim();
    if (!name || !command) {
      setDraft({ ...draft, error: "Name and command are required." });
      return;
    }
    const input = {
      name,
      command,
      icon: draft.icon,
      runOnWorktreeCreate: draft.runOnWorktreeCreate,
      waitForSetup: false,
      runOnSettle: draft.runOnSettle,
      previewUrl: draft.previewUrl.trim() || null,
      autoOpenPreview: false,
    };
    const nextScripts =
      draft.scriptId === null
        ? [
            ...scripts.map((script) => releaseClaimedRoles(script, input)),
            buildProjectScript(nextProjectScriptId(name, scripts.map((script) => script.id)), input),
          ]
        : scripts.map((script) =>
            script.id === draft.scriptId ? buildProjectScript(script.id, input) : releaseClaimedRoles(script, input),
          );
    setSaving(true);
    const result = await persist(nextScripts);
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setDraft({ ...draft, error: error instanceof Error ? error.message : "Failed to save action." });
      }
      return;
    }
    setDraft(null);
  };

  const remove = async () => {
    if (!draft?.scriptId) return;
    const deletedName = scripts.find((script) => script.id === draft.scriptId)?.name;
    const result = await persist(scripts.filter((script) => script.id !== draft.scriptId));
    if (result._tag === "Success") {
      toast({ type: "success", title: `Deleted action "${deletedName ?? "Unknown"}"` });
      setDraft(null);
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toast({ type: "error", title: "Could not delete action", description: error instanceof Error ? error.message : "" });
    }
  };

  const keybindings = config?.keybindings ?? [];
  const items = (
    <>
      {scripts.map((script) => (
        <ScriptMenuItem
          key={script.id}
          script={script}
          shortcut={shortcutLabelForCommand(keybindings, commandForProjectScript(script.id))}
          disabled={!canRunTerminal}
          onRun={() => void runScript(script)}
          onEdit={() => {
            setMenuOpen(false);
            setDraft({
              scriptId: script.id,
              name: script.name,
              command: script.command,
              icon: script.icon,
              runOnWorktreeCreate: script.runOnWorktreeCreate,
              runOnSettle: script.runOnSettle === true,
              previewUrl: script.previewUrl ?? "",
            });
          }}
        />
      ))}
      <MenuRowItem
        testId="script-add"
        icon="plus"
        label="Add project script"
        onClick={() => {
          setMenuOpen(false);
          setDraft(EMPTY_DRAFT);
        }}
      />
    </>
  );

  return (
    <div style={{ display: "flex", position: "relative", width: "100%", flexDirection: "column" }}>
      {primary ? (
        <>
          <DetailsSplit
            testId="project-script"
            primary={
              <Tooltip content={canRunTerminal ? `Run ${primary.name}` : "Pair this client again with permission to run terminal commands."}>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexGrow: 1, minWidth: 0 }}>
                  <DetailsIcon name={scriptIcon(primary.icon)} />
                  <DetailsLabel>{primary.name}</DetailsLabel>
                </div>
              </Tooltip>
            }
            onPrimary={() => void runScript(primary)}
            primaryDisabled={!canRunTerminal}
            menuOpen={menuOpen}
            onToggleMenu={() => setMenuOpen(!menuOpen)}
          />
          <RowMenu open={menuOpen} onClose={() => setMenuOpen(false)} testId="project-script-menu">
            {items}
          </RowMenu>
        </>
      ) : (
        <Tooltip content="Add project script">
          <DetailsRow testId="script-add-row" onClick={() => setDraft(EMPTY_DRAFT)}>
            <DetailsIcon name="plus" />
            <DetailsLabel>Add project script</DetailsLabel>
          </DetailsRow>
        </Tooltip>
      )}
      <Dialog
        open={draft !== null}
        onOpenChange={(next) => {
          if (!next) setDraft(null);
        }}
        title={draft?.scriptId ? "Edit Action" : "Add Action"}
        description="Actions are project-scoped commands you can run from the top bar or keybindings."
        testId="script-dialog"
        showCloseButton
      >
        {draft ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <FieldLabel>Name</FieldLabel>
              <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center" }}>
                <IconPicker value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} />
                <TextField testId="script-name" value={draft.name} placeholder="Test" autoFocus onChange={(name) => setDraft({ ...draft, name })} style={{ flexGrow: 1 }} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <FieldLabel>Command</FieldLabel>
              <TextField testId="script-command" mono value={draft.command} placeholder="bun test" onChange={(command) => setDraft({ ...draft, command })} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <FieldLabel>Preview URL (optional)</FieldLabel>
              <TextField value={draft.previewUrl} placeholder="http://localhost:5173" onChange={(previewUrl) => setDraft({ ...draft, previewUrl })} />
            </div>
            <SwitchRow
              label="Run automatically on worktree creation"
              checked={draft.runOnWorktreeCreate}
              onChange={(runOnWorktreeCreate) => setDraft({ ...draft, runOnWorktreeCreate })}
            />
            <SwitchRow
              label="Run in the thread's worktree when the thread settles"
              checked={draft.runOnSettle}
              onChange={(runOnSettle) => setDraft({ ...draft, runOnSettle })}
            />
            {draft.error ? (
              <Text size="xs" color={theme.errorForeground}>
                {draft.error}
              </Text>
            ) : null}
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
              {draft.scriptId ? (
                <Button variant="ghost" size="sm" onClick={() => void remove()}>
                  Delete
                </Button>
              ) : null}
              <div style={{ flexGrow: 1 }} />
              <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" testId="script-save" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving..." : draft.scriptId ? "Save changes" : "Save action"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function ScriptMenuItem({
  script,
  shortcut,
  disabled,
  onRun,
  onEdit,
}: {
  script: ProjectScript;
  shortcut: string | null;
  disabled: boolean;
  onRun: () => void;
  onEdit: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ display: "flex", flexDirection: "column" }}>
      <MenuRowItem
        icon={scriptIcon(script.icon)}
        label={projectScriptMenuLabel(script)}
        disabled={disabled}
        onClick={onRun}
        trailing={
          hovered ? (
            <div
              onClick={onEdit}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: RADIUS.sm, hover: { backgroundColor: theme.accent } }}
            >
              <Icon name="settings" size={14} color={theme.mutedForeground} />
            </div>
          ) : null
        }
        shortcut={hovered ? null : shortcut}
      />
    </div>
  );
}

function IconPicker({ value, onChange }: { value: ProjectScriptIcon; onChange: (icon: ProjectScriptIcon) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <ActionMenu<ProjectScriptIcon>
      open={open}
      onOpenChange={setOpen}
      items={SCRIPT_ICONS.map((entry) => ({ id: entry.id, label: entry.label, icon: entry.icon, ...(entry.id === value ? { checked: true } : {}) }))}
      onSelect={onChange}
      trigger={
        <div
          onClick={() => setOpen(!open)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: theme.input,
            cursor: "pointer",
            hover: { backgroundColor: theme.accent },
          }}
        >
          <Icon name={scriptIcon(value)} size={18} color={theme.foreground} />
        </div>
      }
    />
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: RADIUS.sm,
        backgroundColor: theme.appearance === "dark" ? "#ffffff09" : "#00000000",
      }}
    >
      <Text>{label}</Text>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}
