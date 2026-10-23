// The rows of apps/web/src/components/settings/KeybindingsSettings.tsx: an
// existing binding (KeybindingSettingsRow), the "New keybinding" draft row,
// and the shortcut recorder both use.
import { useGpuixRequired, type KeyEvent } from "@gpuix/react";
import type { KeybindingCommand, ServerRemoveKeybindingInput, ServerUpsertKeybindingInput } from "@t3tools/contracts";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";

import { Menu, MenuItem, Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  commandLabel,
  keybindingConflictLabels,
  whenAstToExpression,
  type KeybindingCommandOption,
  type KeybindingRow,
  type WhenVariableOption,
} from "../../web/components/settings/KeybindingsSettings.logic.ts";
import { Badge, fieldBackground, setTextEntryFocused } from "../controls.tsx";
import { SettingsRow } from "../layout.tsx";
import { keybindingFromGpuixEvent } from "./keyCapture.ts";
import { GhostIconButton, KeybindingPill, PickerSelect, WarningIcon } from "./parts.tsx";
import { WhenClauseControl } from "./WhenExpressionBuilder.tsx";
import type { KeybindingWhenNode } from "@t3tools/contracts";

/** A testId-safe slug of a row's command, key and condition. */
export function rowTestKey(row: Pick<KeybindingRow, "command" | "key" | "when">): string {
  return `${row.command}:${row.key}:${row.when}`.replace(/[^a-zA-Z0-9.:+-]+/g, "_");
}

// ── Recorder ────────────────────────────────────────────────────────────

/**
 * The web records into an `<Input>` whose keydown handler swallows every key.
 * A gpuix input runs its own actions (Backspace, arrows, Enter) before
 * onKeyDown, so this is a focusable div drawn like `<Input size="sm" font="mono">`.
 * While focused it claims every key so neither the global shortcut dispatcher
 * nor the settings page ("/", Escape) reacts to the shortcut being recorded.
 */
function KeyRecorder({
  value,
  recording,
  autoFocus,
  width = 176,
  onFocus,
  onBlur,
  onKeyDown,
  testId,
}: {
  value: string;
  recording: boolean;
  autoFocus: boolean;
  width?: number;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyEvent) => void;
  testId: string;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  useEffect(
    () => () => {
      // Unmounting while focused (Escape back to the keycaps) fires no blur.
      if (focusedRef.current) setTextEntryFocused(false);
    },
    [],
  );
  const text = recording ? "" : value;
  return (
    <div
      testId={testId}
      tabIndex={0}
      autoFocus={autoFocus}
      onFocus={() => {
        focusedRef.current = true;
        setFocused(true);
        setTextEntryFocused(true);
        onFocus();
      }}
      onBlur={() => {
        focusedRef.current = false;
        setFocused(false);
        setTextEntryFocused(false);
        onBlur();
      }}
      onMouseDownOutside={() => {
        if (focusedRef.current) renderer.blur?.();
      }}
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        width,
        height: 28,
        paddingLeft: 9,
        paddingRight: 9,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: focused ? theme.primary : theme.input,
        backgroundColor: fieldBackground(theme),
        cursor: "text",
        flexShrink: 0,
      }}
    >
      <text
        style={{
          color: text ? theme.foreground : alpha(theme.mutedForeground, 0.72),
          fontSize: 13,
          lineHeight: 18,
          fontFamily: FONTS.mono,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {text || (recording ? "Press shortcut" : "Unassigned")}
      </text>
    </div>
  );
}

// ── Drafts ──────────────────────────────────────────────────────────────

type KeybindingRowDraftState = {
  keyDraft: string;
  whenDraft: KeybindingWhenNode | undefined;
  isRecording: boolean;
  isWhenDraftValid: boolean;
};

function keybindingRowDraftReducer(
  state: KeybindingRowDraftState,
  patch: Partial<KeybindingRowDraftState>,
): KeybindingRowDraftState {
  return { ...state, ...patch };
}

export function rowKeybindingTarget(row: KeybindingRow): ServerRemoveKeybindingInput {
  return {
    command: row.command,
    key: row.key,
    ...(row.when.trim().length > 0 ? { when: row.when } : {}),
  };
}

/** captureKeybinding: Tab moves focus until recording starts; Escape restores `resetKey`. */
function captureKeybinding(
  event: KeyEvent,
  isRecording: boolean,
  resetKey: string,
  setDraft: (patch: Partial<KeybindingRowDraftState>) => void,
) {
  if (event.key === "tab" && !isRecording) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "escape" || event.key === "esc") {
    setDraft({ keyDraft: resetKey, isRecording: false });
    return;
  }
  const next = keybindingFromGpuixEvent(event);
  if (!next) return;
  setDraft({ keyDraft: next, isRecording: false });
}

function KeybindingConflictWarning({ labels, testId }: { labels: ReadonlyArray<string>; testId?: string }) {
  if (labels.length === 0) return null;
  const description =
    labels.length === 1
      ? `Conflicts with ${labels[0]}.`
      : `Conflicts with ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ", and more" : ""}.`;
  return (
    <WarningIcon testId={testId} label={`${description} The most recent matching binding wins when both conditions can apply.`} />
  );
}

function WhenLine({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 24, minWidth: 0 }}>
      <Text size="xs" color={alpha(theme.mutedForeground, 0.7)} style={{ flexShrink: 0 }}>
        When
      </Text>
      {children}
    </div>
  );
}

// ── Existing binding ────────────────────────────────────────────────────

export interface KeybindingRowActions {
  allRows: ReadonlyArray<KeybindingRow>;
  variables: ReadonlyArray<WhenVariableOption>;
  onSave: (input: ServerUpsertKeybindingInput) => void;
  onReset: (row: KeybindingRow) => void;
  onRemove: (row: KeybindingRow) => void;
}

function KeybindingRowMenu({
  row,
  isSaving,
  visible,
  onOpenChange,
  onReset,
  onRemove,
}: {
  row: KeybindingRow;
  isSaving: boolean;
  visible: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: (row: KeybindingRow) => void;
  onRemove: (row: KeybindingRow) => void;
}) {
  const canReset = row.source === "Custom" && row.defaultKey !== null;
  const canRemove = row.source !== "Default";
  if (!canReset && !canRemove) return null;
  const testKey = rowTestKey(row);
  return (
    <Menu
      align="end"
      onOpenChange={onOpenChange}
      testId={`keybinding-actions-${testKey}-menu`}
      rootStyle={{ opacity: visible ? 1 : 0 }}
      trigger={({ toggle }) => (
        <GhostIconButton
          testId={`keybinding-actions-${testKey}`}
          icon="ellipsis"
          disabled={isSaving}
          onClick={toggle}
        />
      )}
    >
      {canReset ? (
        <MenuItem testId={`keybinding-reset-${testKey}`} disabled={isSaving} onSelect={() => onReset(row)}>
          Reset to default
        </MenuItem>
      ) : null}
      {canRemove ? (
        <MenuItem testId={`keybinding-remove-${testKey}`} destructive disabled={isSaving} onSelect={() => onRemove(row)}>
          Remove
        </MenuItem>
      ) : null}
    </Menu>
  );
}

function KeybindingRowTitle({ row }: { row: KeybindingRow }) {
  return (
    <Tooltip content={row.command} side="top">
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text weight={500}>{commandLabel(row.command)}</Text>
        {row.source === "Default" ? null : <Badge>{row.source}</Badge>}
      </div>
    </Tooltip>
  );
}

/** The keycaps as a button that starts recording (h-7 px-1.5, hover border + accent). */
function KeycapButton({ row, onClick, testId }: { row: KeybindingRow; onClick: () => void; testId: string }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: 28,
        paddingLeft: 6,
        paddingRight: 6,
        marginRight: -6,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: hover ? alpha(theme.border, 0.7) : "#00000000",
        backgroundColor: hover ? theme.accent : "#00000000",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <KeybindingPill value={row.key} />
    </div>
  );
}

export function KeybindingSettingsRow({
  row,
  isSaving,
  anchorId,
  allRows,
  variables,
  onSave,
  onReset,
  onRemove,
}: KeybindingRowActions & { row: KeybindingRow; isSaving: boolean; anchorId?: string | undefined }) {
  const [draft, setDraft] = useReducer(keybindingRowDraftReducer, row, (initial) => ({
    keyDraft: initial.key,
    whenDraft: initial.binding.whenAst,
    isRecording: false,
    isWhenDraftValid: true,
  }));
  const { keyDraft, whenDraft, isRecording, isWhenDraftValid } = draft;
  const whenDraftExpression = whenAstToExpression(whenDraft);
  const isDirty = keyDraft !== row.key || whenDraftExpression !== row.when;
  const conflictLabels = keybindingConflictLabels(allRows, { rowId: row.id, key: keyDraft, when: whenDraftExpression });
  const showPill = !isRecording && keyDraft === row.key && row.key.length > 0 && !isDirty;
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const testKey = rowTestKey(row);

  const save = () =>
    onSave({
      command: row.command,
      key: keyDraft,
      when: whenDraftExpression.trim().length > 0 ? whenDraftExpression : undefined,
      replace: rowKeybindingTarget(row),
    });

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ display: "flex", flexDirection: "column" }}>
      <SettingsRow
        id={anchorId}
        testId={`keybinding-row-${testKey}`}
        title={<KeybindingRowTitle row={row} />}
        description={
          <WhenLine>
            <WhenClauseControl
              testId={`keybinding-when-${testKey}`}
              label={commandLabel(row.command)}
              expression={whenDraftExpression}
              value={whenDraft}
              variables={variables}
              onChange={(next) => setDraft({ whenDraft: next })}
              onValidityChange={(valid) => setDraft({ isWhenDraftValid: valid })}
            />
          </WhenLine>
        }
        control={
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
            <KeybindingConflictWarning testId={`keybinding-conflict-${testKey}`} labels={conflictLabels} />
            <KeybindingRowMenu
              row={row}
              isSaving={isSaving}
              visible={hover || menuOpen}
              onOpenChange={setMenuOpen}
              onReset={onReset}
              onRemove={onRemove}
            />
            {isDirty ? (
              <Button
                size="sm"
                testId={`keybinding-save-${testKey}`}
                disabled={isSaving || keyDraft.trim().length === 0 || !isWhenDraftValid}
                onClick={save}
              >
                {isSaving ? "Saving" : "Save"}
              </Button>
            ) : null}
            {showPill ? (
              <KeycapButton row={row} testId={`keybinding-keys-${testKey}`} onClick={() => setDraft({ isRecording: true })} />
            ) : (
              <KeyRecorder
                testId={`keybinding-recorder-${testKey}`}
                value={keyDraft}
                recording={isRecording}
                autoFocus={isRecording}
                onFocus={() => setDraft({ isRecording: true })}
                onBlur={() => setDraft({ isRecording: false })}
                onKeyDown={(event) => captureKeybinding(event, isRecording, row.key, setDraft)}
              />
            )}
          </div>
        }
      />
    </div>
  );
}

// ── New binding ─────────────────────────────────────────────────────────

export function NewKeybindingSettingsRow({
  commandOptions,
  allRows,
  variables,
  isSaving,
  onSave,
  onCancel,
}: {
  commandOptions: ReadonlyArray<KeybindingCommandOption>;
  allRows: ReadonlyArray<KeybindingRow>;
  variables: ReadonlyArray<WhenVariableOption>;
  isSaving: boolean;
  onSave: (input: ServerUpsertKeybindingInput) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [commandDraft, setCommandDraft] = useState<KeybindingCommand | "">("");
  const [draft, setDraft] = useReducer(keybindingRowDraftReducer, {
    keyDraft: "",
    whenDraft: undefined,
    isRecording: false,
    isWhenDraftValid: true,
  });
  const { keyDraft, whenDraft, isRecording, isWhenDraftValid } = draft;
  const whenDraftExpression = whenAstToExpression(whenDraft);
  const conflictLabels = keybindingConflictLabels(allRows, { rowId: "new", key: keyDraft, when: whenDraftExpression });
  const commandLabelText = commandDraft ? commandLabel(commandDraft) : "new keybinding";
  const canSave = Boolean(commandDraft) && keyDraft.trim().length > 0 && isWhenDraftValid;

  const save = () => {
    if (!commandDraft) return;
    onSave({
      command: commandDraft,
      key: keyDraft,
      ...(whenDraftExpression.trim().length > 0 ? { when: whenDraftExpression } : {}),
    });
  };

  return (
    // className="bg-muted/15" on the only row of its group.
    <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.xl - 1, backgroundColor: alpha(theme.muted, 0.15) }}>
      <SettingsRow
        testId="keybinding-new-row"
        title="New keybinding"
        description={
          <WhenLine>
            <WhenClauseControl
              testId="keybinding-new-when"
              label={commandLabelText}
              expression={whenDraftExpression}
              value={whenDraft}
              variables={variables}
              onChange={(next) => setDraft({ whenDraft: next })}
              onValidityChange={(valid) => setDraft({ isWhenDraftValid: valid })}
            />
          </WhenLine>
        }
        control={
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <PickerSelect
              testId="keybinding-new-command"
              width={224}
              placeholder="Command"
              value={commandDraft}
              options={commandOptions.map((command) => ({ value: command, label: commandLabel(command) }))}
              onChange={setCommandDraft}
              maxHeight={288}
            />
            <KeybindingConflictWarning testId="keybinding-new-conflict" labels={conflictLabels} />
            <KeyRecorder
              testId="keybinding-new-recorder"
              value={keyDraft}
              recording={isRecording}
              autoFocus={false}
              onFocus={() => setDraft({ isRecording: true })}
              onBlur={() => setDraft({ isRecording: false })}
              onKeyDown={(event) => captureKeybinding(event, isRecording, "", setDraft)}
            />
            <Button size="sm" testId="keybinding-new-save" disabled={isSaving || !canSave} onClick={save}>
              {isSaving ? "Saving" : "Save"}
            </Button>
            <GhostIconButton testId="keybinding-new-cancel" icon="x" label="Cancel" disabled={isSaving} onClick={onCancel} />
          </div>
        }
      />
    </div>
  );
}
