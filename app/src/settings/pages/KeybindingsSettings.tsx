// Port of apps/web/src/components/settings/KeybindingsSettings.tsx
// (KeybindingsSettingsPanel). Rows, the recorder and the "When" editor live in
// ../keybindings/. Bindings are the scope environment's server keybindings
// merged with the defaults; writes go to every connected environment.
import { useAtom } from "@effect/atom-react";
import { useGpuixRequired } from "@gpuix/react";
import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  type KeybindingCommand,
  type ServerUpsertKeybindingInput,
} from "@t3tools/contracts";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { useEffect, useRef, useState } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironmentScope, useEnvironmentsWithScope } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  buildKeybindingCommandOptions,
  buildKeybindingRows,
  buildWhenVariableOptions,
  filterKeybindingRows,
  groupKeybindingRows,
  type KeybindingRow,
} from "../../web/components/settings/KeybindingsSettings.logic.ts";
import { keybindingSearchAnchorId, searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { fieldBackground, setTextEntryFocused } from "../controls.tsx";
import { useOpenInPreferredEditor } from "../keybindings/openInEditor.ts";
import { GhostIconButton } from "../keybindings/parts.tsx";
import { KeybindingSettingsRow, NewKeybindingSettingsRow, rowKeybindingTarget, type KeybindingRowActions } from "../keybindings/rows.tsx";
import {
  GroupedItem,
  SettingsGroup,
  SettingsSection,
  SettingsSectionTitle,
  SettingsVirtualPage,
  settingsSearchTargetAtom,
  type SettingsVirtualItem,
} from "../layout.tsx";
import { useSettingsScope } from "../scope.tsx";

const WHEN_VARIABLES = buildWhenVariableOptions();

/** InputGroup with a search addon, h-8; Escape clears, then blurs. */
function KeybindingsSearchInput({ query, onChange }: { query: string; onChange: (next: string) => void }) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 32,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: focused ? theme.primary : theme.input,
        backgroundColor: fieldBackground(theme),
      }}
    >
      <Icon name="search" size={14} color={theme.mutedForeground} />
      <input
        testId="keybindings-search"
        value={query}
        placeholder="Search keybindings"
        theme={{ caret: theme.foreground, textMuted: theme.mutedForeground, appearance: theme.appearance }}
        onChange={(event) => onChange(event.value ?? "")}
        onFocus={() => {
          setFocused(true);
          setTextEntryFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setTextEntryFocused(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (query.length > 0) onChange("");
          else renderer.blur?.();
        }}
        style={{ flexGrow: 1, minWidth: 0, height: 30, fontSize: 14, lineHeight: 30, color: theme.foreground, fontFamily: FONTS.sans }}
      />
    </div>
  );
}

/** Button variant="outline" size="icon": the keybindings.json opener. */
function OpenFileButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const theme = useTheme();
  return (
    <Tooltip content="Open keybindings.json" side="top">
      <div
        testId="keybindings-open-file"
        onClick={disabled ? undefined : onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: theme.input,
          backgroundColor: fieldBackground(theme),
          opacity: disabled ? 0.64 : 1,
          cursor: disabled ? "default" : "pointer",
          flexShrink: 0,
          ...(disabled ? {} : { hover: { backgroundColor: alpha(theme.input, 0.64) } }),
        }}
      >
        <Icon name="file-json" size={16} color={theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}

function keybindingAnchorIds(rows: ReadonlyArray<KeybindingRow>) {
  const ids = new Map<string, string>();
  const seen = new Set<KeybindingCommand>();
  for (const row of rows) {
    if (seen.has(row.command)) continue;
    seen.add(row.command);
    ids.set(row.id, keybindingSearchAnchorId(row.command));
  }
  return ids;
}

export function KeybindingsSettings() {
  const theme = useTheme();
  const { environment: primaryEnvironment, connectedEnvironments } = useSettingsScope();
  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  const canOpenKeybindingsFile = useEnvironmentScope(primaryEnvironmentId, AuthOrchestrationOperateScope);
  const writableIds = useEnvironmentsWithScope(connectedEnvironments, AuthSettingsWriteScope);
  const canWriteSettings =
    connectedEnvironments.length > 0 && connectedEnvironments.every((target) => writableIds.has(target.environmentId));
  const keybindingsConfigPath = primaryEnvironment?.serverConfig?.keybindingsConfigPath ?? null;
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, { reportFailure: false });
  const removeKeybindingCommand = useAtomCommand(serverEnvironment.removeKeybinding, { reportFailure: false });
  const openInPreferredEditor = useOpenInPreferredEditor(primaryEnvironmentId);
  const [query, setQuery] = useState("");
  const [savingCommand, setSavingCommand] = useState<KeybindingCommand | null>(null);
  const [isAddingBinding, setIsAddingBinding] = useState(false);

  // A settings search result for one binding clears the filter so its row can show.
  const [searchTarget] = useAtom(settingsSearchTargetAtom);
  const handledTarget = useRef(searchTarget?.nonce ?? -1);
  useEffect(() => {
    if (!searchTarget || searchTarget.nonce === handledTarget.current) return;
    handledTarget.current = searchTarget.nonce;
    if (searchTarget.id.startsWith("keybinding-")) setQuery("");
  }, [searchTarget]);

  const serverKeybindings = primaryEnvironment?.serverConfig?.keybindings;
  const merged = mergeWithDefaultKeybindings(serverKeybindings ?? []);
  const commandOptions = buildKeybindingCommandOptions(merged);
  const allRows = buildKeybindingRows(merged);
  const rows = filterKeybindingRows(allRows, query);
  const groups = groupKeybindingRows(rows);
  const anchorIds = keybindingAnchorIds(rows);

  const openKeybindingsFile = () => {
    if (!keybindingsConfigPath || !primaryEnvironmentId || !readEnvironmentScope(primaryEnvironmentId, AuthOrchestrationOperateScope))
      return;
    void (async () => {
      const opened = await openInPreferredEditor(keybindingsConfigPath);
      if (!opened.ok) {
        toast({ type: "error", title: "Unable to open keybindings file", description: opened.message });
        return;
      }
      const result = opened.result;
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toast({
        type: "error",
        title: "Unable to open keybindings file",
        description: error instanceof Error ? error.message : "The keybindings file was not opened.",
      });
    })();
  };

  const canWriteNow = () =>
    primaryEnvironment !== null &&
    connectedEnvironments.every((target) => readEnvironmentScope(target.environmentId, AuthSettingsWriteScope));

  const saveKeybinding = (input: ServerUpsertKeybindingInput) => {
    if (!canWriteNow()) return;
    setSavingCommand(input.command);
    const payload: ServerUpsertKeybindingInput = {
      command: input.command,
      key: input.key.trim(),
      ...(input.when?.trim() ? { when: input.when.trim() } : {}),
      ...(input.replace ? { replace: input.replace } : {}),
    };
    void (async () => {
      const results = await Promise.all(
        connectedEnvironments.map((target) => upsertKeybinding({ environmentId: target.environmentId, input: payload })),
      );
      setSavingCommand(null);
      const failed = results.find((result) => result._tag === "Failure");
      if (!failed) {
        setIsAddingBinding(false);
        return;
      }
      if (!isAtomCommandInterrupted(failed)) {
        const error = squashAtomCommandFailure(failed);
        toast({
          type: "error",
          title: "Unable to save keybinding",
          description: error instanceof Error ? error.message : "The keybinding was not saved.",
        });
      }
    })();
  };

  const removeKeybinding = (row: KeybindingRow) => {
    if (!canWriteNow()) return;
    setSavingCommand(row.command);
    void (async () => {
      const results = await Promise.all(
        connectedEnvironments.map((target) =>
          removeKeybindingCommand({ environmentId: target.environmentId, input: rowKeybindingTarget(row) }),
        ),
      );
      setSavingCommand(null);
      const result = results.find((entry) => entry._tag === "Failure") ?? results[0];
      if (result?._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toast({
          type: "error",
          title: "Unable to remove keybinding",
          description: error instanceof Error ? error.message : "The keybinding was not removed.",
        });
      }
    })();
  };

  const resetKeybinding = (row: KeybindingRow) => {
    if (!row.defaultKey) return;
    saveKeybinding({
      command: row.command,
      key: row.defaultKey,
      when: row.defaultWhen.trim().length > 0 ? row.defaultWhen : undefined,
      replace: rowKeybindingTarget(row),
    });
  };

  const rowActions: KeybindingRowActions = {
    allRows,
    variables: WHEN_VARIABLES,
    onSave: saveKeybinding,
    onReset: resetKeybinding,
    onRemove: removeKeybinding,
  };

  const browserNotice = "The browser may claim some shortcuts first. The desktop app receives them all.";
  const section = searchableSetting("keybindings");

  const items: SettingsVirtualItem[] = [
    {
      key: "header",
      node: (
        <SettingsSection
          id={section.id}
          title={section.title}
          headerAction={
            <GhostIconButton
              testId="keybindings-browser-notice"
              icon="triangle-alert"
              label={browserNotice}
              size={20}
              iconSize={14}
              color={theme.warning}
            />
          }
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 12,
              paddingBottom: 12,
            }}
          >
            <KeybindingsSearchInput query={query} onChange={setQuery} />
            <Button
              variant="outline"
              icon="plus"
              testId="keybindings-add"
              disabled={isAddingBinding || !canWriteSettings}
              onClick={() => setIsAddingBinding(true)}
            >
              Add keybinding
            </Button>
            <OpenFileButton disabled={!keybindingsConfigPath || !canOpenKeybindingsFile} onClick={openKeybindingsFile} />
          </div>
        </SettingsSection>
      ),
    },
  ];
  if (!canWriteSettings) {
    items.push({
      key: "readonly",
      node: (
        <Text size="xs" color={theme.mutedForeground}>
          {connectedEnvironments.length === 0
            ? "Connect an environment to change keybindings."
            : "This connection can view keybindings but cannot change them."}
        </Text>
      ),
    });
  }
  if (isAddingBinding) {
    items.push({
      key: "new",
      node: (
        <SettingsGroup>
          <NewKeybindingSettingsRow
            commandOptions={commandOptions}
            allRows={allRows}
            variables={WHEN_VARIABLES}
            isSaving={savingCommand !== null}
            onSave={saveKeybinding}
            onCancel={() => setIsAddingBinding(false)}
          />
        </SettingsGroup>
      ),
    });
  }
  // Each row is its own list item so only visible rows are built and laid out.
  for (const group of groups) {
    items.push({ key: `title:${group.id}`, node: <SettingsSectionTitle title={group.title} /> });
    group.rows.forEach((row, index) => {
      const position =
        group.rows.length === 1 ? "single" : index === 0 ? "first" : index === group.rows.length - 1 ? "last" : "middle";
      items.push({
        key: row.id,
        gapBefore: index === 0 ? 10 : 0,
        node: (
          <div style={{ display: "flex", flexDirection: "column", ...(canWriteSettings ? {} : { pointerEvents: "none" }) }}>
            <GroupedItem position={position}>
              <KeybindingSettingsRow
                row={row}
                anchorId={anchorIds.get(row.id)}
                isSaving={savingCommand === row.command}
                {...rowActions}
              />
            </GroupedItem>
          </div>
        ),
      });
    });
  }
  if (groups.length === 0) {
    items.push({
      key: "empty",
      node: (
        <SettingsGroup>
          <div style={{ display: "flex", justifyContent: "center", paddingLeft: 16, paddingRight: 16, paddingTop: 48, paddingBottom: 48 }}>
            <Text color={theme.mutedForeground}>No keybindings match your search.</Text>
          </div>
        </SettingsGroup>
      ),
    });
  }

  return <SettingsVirtualPage items={items} />;
}
