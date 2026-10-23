// Ports of apps/web/src/components/settings/{ProjectActionsSettings,ProjectActionsList}.tsx
// and useProjectScriptSettings.ts, with a compact port of projectScriptEditor.tsx.
// Shortcut editing for actions lives on the Keybindings page here; saving an
// action keeps its existing shortcut.
import { isAtomCommandInterrupted, mapAtomCommandResult, squashAtomCommandFailure, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectId,
  type ProjectScript,
  type ProjectScriptIcon,
  type ResolvedKeybindingsConfig,
  type ServerSettings,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { clearProjectSettingsOverrides } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironments, useProjects } from "../../state/settings.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Dialog, Switch } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { alpha, RADIUS, useTheme } from "../../ui/theme.ts";
import { shortcutLabelForCommand } from "../../web/keybindings.ts";
import { buildProjectScript, commandForProjectScript, nextProjectScriptId, releaseClaimedRoles } from "../../web/projectScripts.ts";
import { SettingsSelect, TextArea, TextField } from "../controls.tsx";
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

interface ScriptDraft {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  runOnWorktreeCreate: boolean;
  waitForSetup: boolean;
  runOnSettle: boolean;
  previewUrl: string | null;
  autoOpenPreview: boolean;
}

const EMPTY_DRAFT: ScriptDraft = {
  name: "",
  command: "",
  icon: "play",
  runOnWorktreeCreate: false,
  waitForSetup: false,
  runOnSettle: false,
  previewUrl: null,
  autoOpenPreview: false,
};

function draftForScript(script: ProjectScript): ScriptDraft {
  return {
    name: script.name,
    command: script.command,
    icon: script.icon,
    runOnWorktreeCreate: script.runOnWorktreeCreate,
    waitForSetup: script.runOnWorktreeCreate && script.async === false,
    runOnSettle: script.runOnSettle ?? false,
    previewUrl: script.previewUrl ?? null,
    autoOpenPreview: script.autoOpenPreview ?? false,
  };
}

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

/** useProjectScriptSettings.ts without shortcut writes. */
function useProjectScriptSettings(targets: readonly ScriptTarget[]) {
  const projects = useProjects();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "project actions update");

  async function persist(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[] | null,
  ): Promise<AtomCommandResult<void, unknown>> {
    if (savingRef.current || targets.length === 0) {
      const message = "No available machine, or another action change is saving.";
      toast({ type: "error", title: "Actions not saved", description: message });
      return AsyncResult.failure(Cause.fail(new Error(message)));
    }
    if (targets.some(({ environmentId }) => !readEnvironmentScope(environmentId, AuthSettingsWriteScope))) {
      return reportScriptFailure(AsyncResult.failure(Cause.fail(new Error("This connection cannot change environment settings."))));
    }
    savingRef.current = true;
    setSaving(true);
    try {
      for (const { environmentId, settings, project } of targets) {
        const current = project ? resolveProjectScripts(settings, project) : settings.defaultProjectScripts;
        const nextScripts = transform(current);
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
      }
      return AsyncResult.success(undefined);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function submit(scriptId: string | null, input: ScriptDraft) {
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
    return persist((current) => {
      const updated = current.map((script) => (script.id === id ? next : releaseClaimedRoles(script, input)));
      return scriptId === null ? [...updated, next] : updated;
    });
  }

  return { saving, persist, submit };
}

function SwitchLine({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Text weight={500}>{label}</Text>
        {description ? (
          <Text size="xs" color={theme.mutedForeground}>
            {description}
          </Text>
        ) : null}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function ScriptEditorDialog({
  request,
  onClose,
  onSubmit,
  onDelete,
}: {
  request: { scriptId: string | null; initial: ScriptDraft } | null;
  onClose: () => void;
  onSubmit: (scriptId: string | null, draft: ScriptDraft) => Promise<AtomCommandResult<void, unknown>>;
  onDelete: (scriptId: string) => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<ScriptDraft>(request?.initial ?? EMPTY_DRAFT);
  const [openedFor, setOpenedFor] = useState(request);
  if (openedFor !== request) {
    setOpenedFor(request);
    setDraft(request?.initial ?? EMPTY_DRAFT);
  }
  const valid = draft.name.trim().length > 0 && draft.command.trim().length > 0;
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={512}
      testId="project-action-dialog"
      title={request?.scriptId ? "Edit action" : "Add action"}
      description="Actions are project-scoped commands you can run from the top bar or keybindings."
      footer={
        <>
          <div style={{ display: "flex", flexDirection: "row", flexGrow: 1 }}>
            {request?.scriptId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onDelete(request.scriptId!);
                  onClose();
                }}
              >
                Delete
              </Button>
            ) : null}
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            testId="project-action-save"
            onClick={() => {
              void onSubmit(request?.scriptId ?? null, { ...draft, name: draft.name.trim(), command: draft.command.trim() }).then((result) => {
                if (result._tag === "Success") onClose();
              });
            }}
          >
            {request?.scriptId ? "Save changes" : "Save action"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Text size="xs" weight={500}>
              Icon
            </Text>
            <SettingsSelect
              value={draft.icon}
              width={132}
              size="default"
              align="start"
              options={SCRIPT_ICONS.map((entry) => ({ value: entry.id, label: entry.label, icon: entry.icon }))}
              onChange={(icon) => setDraft({ ...draft, icon })}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1 }}>
            <Text size="xs" weight={500}>
              Name
            </Text>
            <TextField testId="project-action-name" width="100%" value={draft.name} placeholder="Test" onChange={(name) => setDraft({ ...draft, name })} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Text size="xs" weight={500}>
            Command
          </Text>
          <TextArea testId="project-action-command" value={draft.command} mono minRows={2} placeholder="bun test" onChange={(command) => setDraft({ ...draft, command })} />
        </div>
        <SwitchLine
          label="Run automatically on worktree creation"
          checked={draft.runOnWorktreeCreate}
          onChange={(runOnWorktreeCreate) => setDraft({ ...draft, runOnWorktreeCreate, waitForSetup: runOnWorktreeCreate && draft.waitForSetup })}
        />
        {draft.runOnWorktreeCreate ? (
          <SwitchLine
            label="Wait for setup before starting"
            description="New threads in the worktree start after this action finishes."
            checked={draft.waitForSetup}
            onChange={(waitForSetup) => setDraft({ ...draft, waitForSetup })}
          />
        ) : null}
        <SwitchLine label="Run when a thread settles" checked={draft.runOnSettle} onChange={(runOnSettle) => setDraft({ ...draft, runOnSettle })} />
        <div style={{ height: 1, backgroundColor: alpha(theme.border, 0.6) }} />
        <Text size="xs" color={theme.mutedForeground}>
          Shortcuts for actions are edited on the Keybindings page.
        </Text>
      </div>
    </Dialog>
  );
}

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
  const [request, setRequest] = useState<{ scriptId: string | null; initial: ScriptDraft } | null>(null);
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
          <Button
            size="xs"
            variant="outline"
            icon="plus"
            testId="project-action-add"
            disabled={saving || !canWriteSettings || targets.length === 0}
            onClick={() => setRequest({ scriptId: null, initial: EMPTY_DRAFT })}
          >
            Add action
          </Button>
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
            onEdit={() => setRequest({ scriptId: script.id, initial: draftForScript(script) })}
          />
        ))
      )}
      {target ? (
        <ScriptEditorDialog
          request={request}
          onClose={() => setRequest(null)}
          onSubmit={submit}
          onDelete={(id) => void persist((current) => current.filter((script) => script.id !== id))}
        />
      ) : null}
    </SettingsSection>
  );
}
