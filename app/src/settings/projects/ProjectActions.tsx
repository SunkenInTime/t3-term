// Ports of apps/web/src/components/settings/{ProjectActionsSettings,ProjectActionsList}.tsx,
// useProjectScriptSettings.ts, apps/web/src/components/projectScriptEditor.tsx and
// apps/web/src/hooks/useT3ProjectFileScripts.ts: the project's actions, the
// add/edit dialog (shortcut, preview URL, automatic preview), shortcut upkeep
// when an action is saved or removed, and importing actions a checkout's
// t3.json declares.
import type { KeyEvent } from "@gpuix/react";
import { useGpuixRequired } from "@gpuix/react";
import { isAtomCommandInterrupted, mapAtomCommandResult, squashAtomCommandFailure, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
  T3_PROJECT_FILE_NAME,
  type ProjectId,
  type ProjectScript,
  type ProjectScriptIcon,
  type ResolvedKeybindingsConfig,
  type ServerSettings,
  type T3ProjectFile,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { clearProjectSettingsOverrides } from "@t3tools/shared/projectSettings";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { requestConfirmDialog } from "../../dialogs/confirmDialog.ts";
import { serverEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironments, useEnvironmentScope, useProjects } from "../../state/settings.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Dialog, Menu, MenuItem, MenuLabel, MenuSeparator, Popover, Switch } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { useProjectFileQuery } from "../../web/components/files/projectFilesQueryState.ts";
import { shortcutLabelForCommand } from "../../web/keybindings.ts";
import { decodeProjectScriptKeybindingRule, keybindingValueForCommand } from "../../web/lib/projectScriptKeybindings.ts";
import { buildProjectScript, commandForProjectScript, nextProjectScriptId, releaseClaimedRoles } from "../../web/projectScripts.ts";
import { fieldBackground, setTextEntryFocused, TextArea, TextField } from "../controls.tsx";
import { keybindingFromGpuixEvent } from "../keybindings/keyCapture.ts";
import { SettingsRow, SettingsSection } from "../layout.tsx";
import { useScopedSettingsWriteAllowed, useSettingsScope } from "../scope.tsx";

const SCRIPT_ICONS: ReadonlyArray<{ id: ProjectScriptIcon; label: string; icon: IconName }> = [
  { id: "play", label: "Play", icon: "play" },
  { id: "test", label: "Test", icon: "flask-conical" },
  { id: "lint", label: "Lint", icon: "list-checks" },
  { id: "configure", label: "Configure", icon: "wrench" },
  { id: "build", label: "Build", icon: "hammer" },
  { id: "debug", label: "Debug", icon: "bug" },
];

export function scriptIconName(icon: ProjectScriptIcon): IconName {
  return SCRIPT_ICONS.find((entry) => entry.id === icon)?.icon ?? "play";
}

// ── projectScriptEditor.tsx types ───────────────────────────────────────

export interface NewProjectScriptInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  runOnWorktreeCreate: boolean;
  waitForSetup: boolean;
  runOnSettle: boolean;
  /** Omit to preserve the current shortcut when the form did not edit it. */
  keybinding?: string | null;
  previewUrl: string | null;
  autoOpenPreview: boolean;
}

export const EMPTY_PROJECT_SCRIPT_INPUT: NewProjectScriptInput = {
  name: "",
  command: "",
  icon: "play",
  runOnWorktreeCreate: false,
  waitForSetup: false,
  runOnSettle: false,
  keybinding: null,
  previewUrl: null,
  autoOpenPreview: false,
};

export interface ProjectScriptEditorRequest {
  scriptId: string | null;
  initial: NewProjectScriptInput;
  error?: string;
}

export function editorRequestForScript(script: ProjectScript, keybindings: ResolvedKeybindingsConfig): ProjectScriptEditorRequest {
  return {
    scriptId: script.id,
    initial: {
      name: script.name,
      command: script.command,
      icon: script.icon,
      runOnWorktreeCreate: script.runOnWorktreeCreate,
      waitForSetup: script.runOnWorktreeCreate && script.async === false,
      runOnSettle: script.runOnSettle ?? false,
      keybinding: keybindingValueForCommand(keybindings, commandForProjectScript(script.id)),
      previewUrl: script.previewUrl ?? null,
      autoOpenPreview: script.autoOpenPreview ?? false,
    },
  };
}

// ── useProjectScriptSettings.ts ─────────────────────────────────────────

interface ScriptTarget {
  environmentId: EnvironmentId;
  settings: ServerSettings;
  keybindings: ResolvedKeybindingsConfig;
  project?: { id: ProjectId; scripts: readonly ProjectScript[] };
}

function reportScriptFailure(result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toast({ type: "error", title: "Failed to save project actions", description: error instanceof Error ? error.message : "An error occurred." });
  }
  return mapAtomCommandResult(result, () => undefined);
}

function useProjectScriptSettings(targets: readonly ScriptTarget[]) {
  const projects = useProjects();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "project actions update");
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, "action shortcut update");
  const removeKeybinding = useAtomCommand(serverEnvironment.removeKeybinding, "action shortcut removal");

  async function persist(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[] | null,
    scriptId?: string,
    keybinding?: string | null,
  ): Promise<AtomCommandResult<void, unknown>> {
    if (savingRef.current || targets.length === 0) {
      const message = "No available machine, or another action change is saving.";
      toast({ type: "error", title: "Actions not saved", description: message });
      return AsyncResult.failure(Cause.fail(new Error(message)));
    }
    if (targets.some(({ environmentId }) => !readEnvironmentScope(environmentId, AuthSettingsWriteScope))) {
      return reportScriptFailure(
        AsyncResult.failure(
          Cause.fail(
            new EnvironmentAuthorizationError({
              requiredScope: AuthSettingsWriteScope,
              message: "This connection cannot change environment settings.",
            }),
          ),
        ),
      );
    }
    savingRef.current = true;
    setSaving(true);
    return writeTargets(transform, scriptId, keybinding).finally(() => {
      savingRef.current = false;
      setSaving(false);
    });
  }

  async function writeTargets(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[] | null,
    scriptId: string | undefined,
    keybinding: string | null | undefined,
  ): Promise<AtomCommandResult<void, unknown>> {
    for (const { environmentId, settings, keybindings, project } of targets) {
      const current = project ? resolveProjectScripts(settings, project) : settings.defaultProjectScripts;
      const nextScripts = transform(current);
      const effectiveScripts = nextScripts ?? settings.defaultProjectScripts;
      const result = await updateSettings({
        environmentId,
        input: {
          patch: project
            ? {
                projectSettingsOverrides: {
                  [project.id]:
                    nextScripts === null
                      ? clearProjectSettingsOverrides(settings, project.id, ["defaultProjectScripts"])
                      : { ...settings.projectSettingsOverrides[project.id], defaultProjectScripts: nextScripts },
                },
              }
            : { defaultProjectScripts: nextScripts ?? [] },
        },
      });
      if (result._tag === "Failure") return reportScriptFailure(result);
      // The edited action's shortcut, or every action the change removed.
      const changedIds = scriptId
        ? [scriptId]
        : current.filter((script) => !effectiveScripts.some((next) => next.id === script.id)).map((script) => script.id);
      for (const id of changedIds) {
        if (keybinding === undefined && effectiveScripts.some((script) => script.id === id)) continue;
        const command = commandForProjectScript(id);
        const previousValue = keybindingValueForCommand(keybindings, command);
        const previous = previousValue ? decodeProjectScriptKeybindingRule({ keybinding: previousValue, command }) : null;
        const next = decodeProjectScriptKeybindingRule({ keybinding, command });
        // Shortcuts are environment-wide: a removed action keeps its binding while
        // the defaults, another project's override or another project still use it.
        const retainedElsewhere =
          !nextScripts?.some((script) => script.id === id) &&
          ((project && settings.defaultProjectScripts.some((script) => script.id === id)) ||
            Object.entries(settings.projectSettingsOverrides).some(
              ([projectId, entry]) => projectId !== project?.id && entry.defaultProjectScripts?.some((script) => script.id === id),
            ) ||
            projects.some(
              (other) =>
                other.environmentId === environmentId &&
                other.id !== project?.id &&
                (project ? resolveProjectScripts(settings, other) : other.scripts).some((script) => script.id === id),
            ));
        const bindingResult = next
          ? await upsertKeybinding({
              environmentId,
              input: previous && previous.key !== next.key ? { ...next, replace: previous } : next,
            })
          : previous && !retainedElsewhere
            ? await removeKeybinding({ environmentId, input: previous })
            : null;
        if (bindingResult?._tag === "Failure") return reportScriptFailure(bindingResult);
      }
    }
    return AsyncResult.success(undefined);
  }

  function submit(scriptId: string | null, input: NewProjectScriptInput) {
    const existingIds = [
      ...projects.flatMap((project) => project.scripts.map((script) => script.id)),
      ...targets.flatMap(({ settings, project }) =>
        [
          ...settings.defaultProjectScripts,
          ...Object.values(settings.projectSettingsOverrides).flatMap((entry) => entry.defaultProjectScripts ?? []),
          ...(project?.scripts ?? []),
        ].map((script) => script.id),
      ),
    ];
    const id = scriptId ?? nextProjectScriptId(input.name, existingIds);
    const next = buildProjectScript(id, input);
    return persist(
      (current) => {
        const updated = current.map((script) => (script.id === id ? next : releaseClaimedRoles(script, input)));
        return scriptId === null ? [...updated, next] : updated;
      },
      id,
      input.keybinding,
    );
  }

  return { saving, persist, submit };
}

// ── useT3ProjectFileScripts.ts ──────────────────────────────────────────

const NO_FILE_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

interface T3ProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: T3ProjectFile | null;
  scripts: ReadonlyArray<T3ProjectFileScript>;
}

function useT3ProjectFileState(environmentId: EnvironmentId, cwd: string | null): T3ProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", T3_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  if (contents === null) return { status: query.isPending ? "loading" : "missing", file: null, scripts: NO_FILE_SCRIPTS };
  const file = parseT3ProjectFile(contents);
  if (file === null) return { status: "invalid", file: null, scripts: NO_FILE_SCRIPTS };
  return { status: "valid", file, scripts: file.scripts ?? NO_FILE_SCRIPTS };
}

// ── projectScriptEditor.tsx ─────────────────────────────────────────────

const FIELD_HEIGHT = 32;

function FieldLabel({ children }: { children: string }) {
  return (
    <Text size="sm" weight={500}>
      {children}
    </Text>
  );
}

function FieldHint({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text size="xs" color={theme.mutedForeground}>
      {children}
    </Text>
  );
}

/** `<label className="flex … rounded-md border px-3 py-2 dark:bg-white/[0.035]">` with a Switch. */
function SwitchBox({
  label,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
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
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: dark ? "#00000000" : alpha(theme.border, 0.7),
        backgroundColor: dark ? "#ffffff09" : "#00000000",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text size="sm">{label}</Text>
      <Switch checked={checked} disabled={disabled} onChange={onChange} {...(testId ? { testId } : {})} />
    </div>
  );
}

/**
 * The web records into a read-only <Input> whose keydown handler takes every key.
 * A gpuix input runs its own actions before onKeyDown, so this is a focusable
 * div drawn like the input (settings/keybindings/rows.tsx KeyRecorder).
 */
function ShortcutField({
  value,
  disabled,
  onChange,
  testId,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  testId?: string;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  useEffect(
    () => () => {
      if (focusedRef.current) setTextEntryFocused(false);
    },
    [],
  );
  const capture = (event: KeyEvent) => {
    if (disabled || event.key === "tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "backspace" || event.key === "delete") {
      onChange("");
      return;
    }
    const next = keybindingFromGpuixEvent(event);
    if (next) onChange(next);
  };
  return (
    <div
      {...(testId ? { testId } : {})}
      tabIndex={disabled ? -1 : 0}
      onFocus={() => {
        focusedRef.current = true;
        setFocused(true);
        setTextEntryFocused(true);
      }}
      onBlur={() => {
        focusedRef.current = false;
        setFocused(false);
        setTextEntryFocused(false);
      }}
      onMouseDownOutside={() => {
        if (focusedRef.current) renderer.blur?.();
      }}
      onKeyDown={capture}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: FIELD_HEIGHT,
        paddingLeft: 11,
        paddingRight: 11,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: focused ? theme.primary : theme.input,
        backgroundColor: fieldBackground(theme),
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "text",
      }}
    >
      <text style={{ color: value ? theme.foreground : theme.mutedForeground, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans, whiteSpace: "nowrap" }}>
        {value || "Press shortcut"}
      </text>
    </div>
  );
}

function ScriptIconPicker({ icon, disabled, onChange }: { icon: ProjectScriptIcon; disabled: boolean; onChange: (icon: ProjectScriptIcon) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={setOpen}
      align="start"
      testId="project-action-icon-menu"
      style={{ padding: 12 }}
      trigger={
        <div
          testId="project-action-icon"
          onClick={() => !disabled && setOpen(!open)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: fieldBackground(theme),
            cursor: disabled ? "default" : "pointer",
            hover: { backgroundColor: theme.accent },
          }}
        >
          <Icon name={scriptIconName(icon)} size={18} color={theme.foreground} />
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: 3, gap: 8, width: 252 }}>
        {SCRIPT_ICONS.map((entry) => {
          const selected = entry.id === icon;
          return (
            <div
              key={entry.id}
              testId={`project-action-icon-${entry.id}`}
              onClick={() => {
                onChange(entry.id);
                setOpen(false);
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                paddingTop: 8,
                paddingBottom: 8,
                borderRadius: RADIUS.md,
                borderWidth: selected ? 1 : 0,
                borderColor: alpha(theme.primary, 0.3),
                backgroundColor: selected ? alpha(theme.primary, 0.1) : theme.appearance === "dark" ? "#ffffff09" : "#00000000",
                cursor: "pointer",
                hover: selected ? {} : { backgroundColor: alpha(theme.accent, 0.6) },
              }}
            >
              <Icon name={entry.icon} size={16} color={theme.foreground} />
              <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, pointerEvents: "none" }}>{entry.label}</text>
            </div>
          );
        })}
      </div>
    </Popover>
  );
}

function ProjectScriptEditorDialog({
  environmentId,
  request,
  scripts,
  onSubmit,
  onDelete,
  onClose,
}: {
  environmentId: EnvironmentId;
  request: ProjectScriptEditorRequest | null;
  scripts: ReadonlyArray<ProjectScript>;
  onSubmit: (scriptId: string | null, input: NewProjectScriptInput) => Promise<AtomCommandResult<void, unknown>>;
  onDelete: (scriptId: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  // Settings edit actions through the settings write scope (web editScope={AuthSettingsWriteScope}).
  const canEditActions = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [waitForSetup, setWaitForSetup] = useState(false);
  const [runOnSettle, setRunOnSettle] = useState(false);
  const [keybinding, setKeybinding] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [autoOpenPreview, setAutoOpenPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  // Keyed by the request it belongs to, so a late save from the previous request can't overwrite it.
  const [errorState, setErrorState] = useState<{ readonly request: ProjectScriptEditorRequest; readonly message: string | null } | null>(null);
  const pendingRef = useRef<ProjectScriptEditorRequest | null>(null);
  const [formRequest, setFormRequest] = useState<ProjectScriptEditorRequest | null>(null);
  if (request !== formRequest) {
    setFormRequest(request);
    if (request) {
      setName(request.initial.name);
      setCommand(request.initial.command);
      setIcon(request.initial.icon);
      setRunOnWorktreeCreate(request.initial.runOnWorktreeCreate);
      setWaitForSetup(request.initial.waitForSetup);
      setRunOnSettle(request.initial.runOnSettle);
      setKeybinding(request.initial.keybinding ?? "");
      setPreviewUrl(request.initial.previewUrl ?? "");
      setAutoOpenPreview(request.initial.autoOpenPreview);
      setSaving(false);
    }
  }
  const validationError = request === null ? null : errorState?.request === request ? errorState.message : (request.error ?? null);
  const setValidationError = (message: string | null) => {
    if (request !== null) setErrorState({ request, message });
  };
  const isEditing = request?.scriptId != null;
  const close = () => {
    pendingRef.current = null;
    setSaving(false);
    onClose();
  };

  const submit = async () => {
    if (!request || pendingRef.current !== null) return;
    if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) {
      setValidationError("This connection cannot change project actions.");
      return;
    }
    const changesKeybinding = (keybinding.trim() || null) !== (request.initial.keybinding?.trim() || null);
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }
    if (trimmedCommand.length === 0) {
      setValidationError("Command is required.");
      return;
    }
    setValidationError(null);
    let payload: NewProjectScriptInput;
    try {
      const scriptIdForValidation = request.scriptId ?? nextProjectScriptId(trimmedName, scripts.map((script) => script.id));
      const keybindingRule = decodeProjectScriptKeybindingRule({ keybinding, command: commandForProjectScript(scriptIdForValidation) });
      const trimmedPreviewUrl = previewUrl.trim();
      payload = {
        name: trimmedName,
        command: trimmedCommand,
        icon,
        runOnWorktreeCreate,
        waitForSetup: runOnWorktreeCreate && waitForSetup,
        runOnSettle,
        ...(request.scriptId === null || changesKeybinding ? { keybinding: keybindingRule?.key ?? null } : {}),
        previewUrl: trimmedPreviewUrl.length > 0 ? trimmedPreviewUrl : null,
        autoOpenPreview: trimmedPreviewUrl.length > 0 ? autoOpenPreview : false,
      };
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save action.");
      return;
    }
    pendingRef.current = request;
    setSaving(true);
    const result = await onSubmit(request.scriptId, payload);
    if (pendingRef.current !== request) return;
    pendingRef.current = null;
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setValidationError(error instanceof Error ? error.message : "Failed to save action.");
      }
      return;
    }
    close();
  };

  const requestDelete = () => {
    const scriptId = request?.scriptId;
    if (!scriptId) return;
    void requestConfirmDialog(`Delete action "${name}"?\nThis action cannot be undone.`, { variant: "destructive" }).then((confirmed) => {
      if (!confirmed) return;
      if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) {
        setValidationError("This connection cannot change project actions.");
        return;
      }
      close();
      onDelete(scriptId);
    });
  };

  const locked = saving || !canEditActions;
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      width={512}
      showCloseButton
      testId="project-action-dialog"
      title={isEditing ? "Edit Action" : "Add Action"}
      description="Actions are project-scoped commands you can run from the top bar or keybindings."
      footer={
        <>
          {isEditing ? (
            <div style={{ display: "flex", flexGrow: 1 }}>
              <Button variant="destructive-outline" disabled={locked} onClick={requestDelete} testId="project-action-delete">
                Delete
              </Button>
            </div>
          ) : null}
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={locked} testId="project-action-save" onClick={() => void submit()}>
            {saving ? "Saving…" : isEditing ? "Save changes" : "Save action"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, opacity: canEditActions ? 1 : 0.64 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldLabel>Name</FieldLabel>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ScriptIconPicker icon={icon} disabled={locked} onChange={setIcon} />
            <TextField testId="project-action-name" value={name} placeholder="Test" readOnly={locked} onChange={setName} onSubmit={() => void submit()} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldLabel>Keybinding</FieldLabel>
          <ShortcutField testId="project-action-keybinding" value={keybinding} disabled={locked} onChange={setKeybinding} />
          <FieldHint>Press a shortcut. Use Backspace to clear. Shortcuts are environment-wide. Projects using the same action share its shortcut.</FieldHint>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldLabel>Command</FieldLabel>
          <TextArea testId="project-action-command" value={command} minRows={3} placeholder="bun test" onChange={(next) => !locked && setCommand(next)} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldLabel>Preview URL (optional)</FieldLabel>
          <TextField testId="project-action-preview-url" value={previewUrl} placeholder="http://localhost:5173" readOnly={locked} onChange={setPreviewUrl} onSubmit={() => void submit()} />
          <FieldHint>Open this URL in the in-app preview when this action runs.</FieldHint>
        </div>
        <SwitchBox
          label="Run automatically on worktree creation"
          checked={runOnWorktreeCreate}
          disabled={locked}
          onChange={setRunOnWorktreeCreate}
        />
        <SwitchBox label="Wait for it to finish before the agent starts" checked={waitForSetup} disabled={locked || !runOnWorktreeCreate} onChange={setWaitForSetup} />
        <SwitchBox label="Run in the thread's worktree when the thread settles" checked={runOnSettle} disabled={locked} onChange={setRunOnSettle} />
        <SwitchBox
          label="Open preview automatically when this action runs"
          checked={autoOpenPreview}
          disabled={locked || previewUrl.trim().length === 0}
          onChange={setAutoOpenPreview}
          testId="project-action-auto-preview"
        />
        {validationError ? (
          <Text size="sm" color={theme.errorForeground}>
            {validationError}
          </Text>
        ) : null}
      </div>
    </Dialog>
  );
}

// ── ProjectActionsList.tsx ──────────────────────────────────────────────

function ActionRow({ script, keybindings, disabled, onEdit }: { script: ProjectScript; keybindings: ResolvedKeybindingsConfig; disabled: boolean; onEdit: () => void }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const shortcutLabel = shortcutLabelForCommand(keybindings, commandForProjectScript(script.id));
  const tag = (label: string) => (
    <div style={{ display: "flex", paddingLeft: 6, paddingRight: 6, borderRadius: 4, borderWidth: 1, borderColor: alpha(theme.border, 0.6), flexShrink: 0 }}>
      <Text size="2xs" color={theme.mutedForeground}>
        {label}
      </Text>
    </div>
  );
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ display: "flex", flexDirection: "column" }}>
      <SettingsRow
        title={
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Icon name={scriptIconName(script.icon)} size={16} color={theme.mutedForeground} />
            <Text weight={500}>{script.name}</Text>
            {script.runOnWorktreeCreate ? tag("setup") : null}
            {script.runOnSettle ? tag("on settle") : null}
            {script.previewUrl ? tag("preview · desktop only") : null}
          </div>
        }
        description={
          <Text size="xs" mono color={alpha(theme.mutedForeground, 0.8)}>
            {script.command.length > 96 ? `${script.command.slice(0, 95)}…` : script.command}
          </Text>
        }
        control={
          <>
            {shortcutLabel ? (
              <Text size="xs" color={theme.mutedForeground}>
                {shortcutLabel}
              </Text>
            ) : null}
            <div style={{ display: "flex", opacity: hover ? 1 : 0 }}>
              <IconButton icon="settings" size={24} iconSize={14} disabled={disabled} onClick={onEdit} testId={`project-action-edit-${script.id}`} />
            </div>
          </>
        }
      />
    </div>
  );
}

// ── ProjectActionsSettings.tsx ──────────────────────────────────────────

const NO_ENVIRONMENT = EnvironmentId.make("none");

export function ProjectActionsSettings() {
  const theme = useTheme();
  const { scope, targets, target } = useSettingsScope();
  const { environments } = useEnvironments();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const representativeConfig = target ? environments.find((environment) => environment.environmentId === target.environmentId)?.serverConfig : undefined;
  const scripts = target?.settings.defaultProjectScripts ?? [];
  const keybindings = representativeConfig?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const mixed = targets.some((candidate) => JSON.stringify(candidate.settings.defaultProjectScripts) !== JSON.stringify(scripts));
  const canWriteSettings = useScopedSettingsWriteAllowed();
  const [request, setRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const memberById = new Map(isProjectScope ? scope.members.map((member) => [member.id, member]) : []);
  const { saving, persist, submit } = useProjectScriptSettings(
    targets.flatMap((candidate) => {
      const environment = environments.find((entry) => entry.environmentId === candidate.environmentId);
      if (!environment?.serverConfig) return [];
      const member = candidate.projectId ? memberById.get(candidate.projectId) : undefined;
      // An older server ignores the override record, so a project edit there
      // would report success and vanish.
      if (member && environment.serverConfig.environment?.capabilities.projectSettingsOverrides !== true) return [];
      return [
        {
          environmentId: candidate.environmentId,
          settings: environment.serverConfig.settings,
          keybindings: environment.serverConfig.keybindings,
          ...(member ? { project: member } : {}),
        },
      ];
    }),
  );

  const representativeMember = target?.projectId ? memberById.get(target.projectId) : undefined;
  const t3File = useT3ProjectFileState(representativeMember?.environmentId ?? NO_ENVIRONMENT, representativeMember?.workspaceRoot ?? null);
  // A file action already present (same command, or same name) is not offered again.
  const importableScripts = t3File.scripts.filter(
    (fileScript) => !scripts.some((script) => script.command === fileScript.command || script.name.toLowerCase() === fileScript.name.toLowerCase()),
  );
  const importFileScript = async (fileScript: T3ProjectFileScript) => {
    const payload: NewProjectScriptInput = {
      name: fileScript.name,
      command: fileScript.command,
      icon: fileScript.icon ?? "play",
      runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
      waitForSetup: fileScript.runOnWorktreeCreate === true && fileScript.async === false,
      runOnSettle: fileScript.runOnSettle ?? false,
      keybinding: null,
      previewUrl: fileScript.previewUrl ?? null,
      autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
    };
    const result = await submit(null, payload);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      // web: a failed import reopens as a prefilled Add Action with the error.
      setRequest({ scriptId: null, initial: payload, error: error instanceof Error ? error.message : "Failed to import action." });
    }
  };

  return (
    <SettingsSection id="project-actions" title="Actions">
      <SettingsRow
        serverScoped
        settingKeys={["defaultProjectScripts"]}
        mixed={mixed}
        title="Actions"
        description="Commands that run in this project's checkout or its worktree, with optional shortcuts."
        onResetOverride={() => void persist(() => null)}
        control={
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            {importableScripts.length > 0 ? (
              <Menu
                open={importOpen}
                onOpenChange={setImportOpen}
                align="end"
                minWidth={288}
                testId="project-action-import-menu"
                trigger={() => (
                  <Button
                    size="xs"
                    variant="ghost"
                    trailingIcon="chevron-down"
                    disabled={saving || !canWriteSettings}
                    testId="project-action-import"
                    onClick={() => setImportOpen(!importOpen)}
                  >
                    Import scripts
                  </Button>
                )}
              >
                <MenuLabel>Import from t3.json</MenuLabel>
                <div style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}>
                  <Text size="sm" color={theme.mutedForeground}>
                    Add actions declared by this checkout without editing them first.
                  </Text>
                </div>
                <MenuSeparator />
                {importableScripts.map((fileScript) => (
                  <MenuItem key={`${fileScript.name} ${fileScript.command}`} icon={scriptIconName(fileScript.icon ?? "play")} onSelect={() => void importFileScript(fileScript)}>
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, pointerEvents: "none" }}>
                      <Text weight={500} truncate>
                        {fileScript.name}
                      </Text>
                      <Text mono color={theme.mutedForeground} truncate>
                        {fileScript.command}
                      </Text>
                    </div>
                  </MenuItem>
                ))}
              </Menu>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              icon="plus"
              testId="project-action-add"
              disabled={saving || !canWriteSettings || targets.length === 0}
              onClick={() => setRequest({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT })}
            >
              Add action
            </Button>
          </div>
        }
      />
      {mixed ? (
        <SettingsRow
          title="Different actions across environments"
          description="Choose one environment to edit its list. Adding an action here adds it on every selected environment."
        />
      ) : scripts.length === 0 ? (
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.md }}>
          <Text color={theme.mutedForeground}>No actions configured.</Text>
        </div>
      ) : (
        scripts.map((script) => (
          <ActionRow
            key={script.id}
            script={script}
            keybindings={keybindings}
            disabled={saving || !canWriteSettings}
            onEdit={() => setRequest(editorRequestForScript(script, keybindings))}
          />
        ))
      )}
      {t3File.status === "invalid" ? (
        <SettingsRow
          title={<Text weight={500} color={theme.warningForeground}>t3.json is invalid</Text>}
          description={
            <Text size="xs" color={theme.warningForeground}>
              A t3.json exists in this checkout but fails to parse, so every action and icon it declares is ignored. Check the JSON syntax and icon values.
            </Text>
          }
        />
      ) : null}
      {target ? (
        <ProjectScriptEditorDialog
          environmentId={target.environmentId}
          request={request}
          scripts={scripts}
          onSubmit={submit}
          onDelete={(id) => void persist((current) => current.filter((script) => script.id !== id), id, null)}
          onClose={() => setRequest(null)}
        />
      ) : null}
    </SettingsSection>
  );
}
