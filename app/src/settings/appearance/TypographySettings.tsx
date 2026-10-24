// Port of apps/web/src/components/settings/TypographySettings.tsx.
//
// The family control becomes FontFamilyPicker once the OS font list has loaded
// (installedFonts.ts; web: once the browser grants font enumeration) and stays a
// text input until then or if listing fails. The web only commits a typed family
// the canvas probe can render; gpuix cannot probe a typed name, so any non-empty
// family is accepted and GPUI falls back to the platform font for unknown names.
import {
  DEFAULT_UNIFIED_SETTINGS,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "@t3tools/contracts/settings";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Switch } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, useTheme } from "../../ui/theme.ts";
import { localStore } from "../../web/lib/localStore.ts";
import { isMacPlatform, PLATFORM } from "../../web/lib/utils.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { SettingsSelect, TextField } from "../controls.tsx";
import { SettingResetButton, SettingsRow, SettingsSection } from "../layout.tsx";
import { useScopedSettings, useUpdateScopedSettings } from "../scope.tsx";
import { FontFamilyPicker } from "./FontFamilyPicker.tsx";
import { CodeFontPreview, PromptFontPreview, TerminalFontPreview } from "./FontPreviews.tsx";
import { useFontEnumeration } from "./installedFonts.ts";

/** apps/web/src/appearanceFonts.ts */
const TYPOGRAPHY_ADVANCED_STORAGE_KEY = "t3code:typography-advanced";

function readAdvanced(): boolean {
  return localStore.getItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY) === "true";
}

function useFontDefaultFamilies() {
  const settings = useScopedSettings();
  return {
    sans: FONTS.sans,
    code: FONTS.mono,
    interfaceFamily: settings.fontFamilySans.trim() || FONTS.sans,
  };
}

function InterfaceFontRow({ preview }: { preview?: ReactNode }) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("interface-font")}
      testKey="interface"
      description="Everything outside code blocks and the terminal."
      defaultFamily={defaults.sans}
      defaultValue={DEFAULT_UNIFIED_SETTINGS.fontFamilySans}
      value={settings.fontFamilySans}
      onValueChange={(fontFamilySans) => updateSettings({ fontFamilySans })}
      onReset={() =>
        updateSettings({
          fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
          fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
        })
      }
      size={{
        min: MIN_INTERFACE_FONT_SIZE,
        max: MAX_INTERFACE_FONT_SIZE,
        value: settings.fontSizeInterface,
        defaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
        onChange: (fontSizeInterface) => updateSettings({ fontSizeInterface }),
      }}
      preview={preview}
    />
  );
}

function PromptFontRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("prompt-font")}
      testKey="prompt"
      description="Only the box you write prompts in. Mono works well here."
      defaultFamily={defaults.interfaceFamily}
      defaultValue={DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer}
      value={settings.fontFamilyComposer}
      onValueChange={(fontFamilyComposer) => updateSettings({ fontFamilyComposer })}
      onReset={() =>
        updateSettings({
          fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
          fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
        })
      }
      size={{
        min: MIN_PROMPT_FONT_SIZE,
        max: MAX_PROMPT_FONT_SIZE,
        value: settings.fontSizePrompt,
        defaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
        onChange: (fontSizePrompt) => updateSettings({ fontSizePrompt }),
      }}
      preview={<PromptFontPreview />}
    />
  );
}

function CodeFontRow({
  title,
  description = "Code blocks, diffs, and file previews.",
  preview,
}: {
  title?: string;
  description?: string;
  preview?: ReactNode;
}) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const defaults = useFontDefaultFamilies();
  const searchable = searchableSetting("code-font");
  return (
    <FontFamilySettingsRow
      id={searchable.id}
      title={title ?? searchable.title}
      testKey="code"
      requireMonospace
      description={description}
      defaultFamily={defaults.code}
      defaultValue={DEFAULT_UNIFIED_SETTINGS.fontFamilyCode}
      value={settings.fontFamilyCode}
      onValueChange={(fontFamilyCode) => updateSettings({ fontFamilyCode })}
      onReset={() =>
        updateSettings({
          fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
          fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
        })
      }
      size={{
        min: MIN_CODE_FONT_SIZE,
        max: MAX_CODE_FONT_SIZE,
        value: settings.fontSizeCode,
        defaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
        onChange: (fontSizeCode) => updateSettings({ fontSizeCode }),
      }}
      preview={preview ?? <CodeFontPreview />}
    />
  );
}

function TerminalFontRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("terminal-font")}
      testKey="terminal"
      requireMonospace
      description="Terminal output, independent from code blocks and diffs."
      defaultFamily={defaults.code}
      defaultValue={DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal}
      value={settings.fontFamilyTerminal}
      onValueChange={(fontFamilyTerminal) => updateSettings({ fontFamilyTerminal })}
      onReset={() =>
        updateSettings({
          fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
          fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
        })
      }
      size={{
        min: MIN_TERMINAL_FONT_SIZE,
        max: MAX_TERMINAL_FONT_SIZE,
        value: settings.fontSizeTerminal,
        defaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
        onChange: (fontSizeTerminal) => updateSettings({ fontSizeTerminal }),
      }}
      preview={<TerminalFontPreview family={settings.fontFamilyTerminal} size={settings.fontSizeTerminal} />}
    />
  );
}

function FontSmoothingRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  if (!isMacPlatform(PLATFORM)) return null;
  return (
    <SettingsRow
      {...searchableSetting("font-smoothing")}
      description="Use thinner grayscale text smoothing instead of the macOS default."
      resetAction={
        settings.fontSmoothing !== DEFAULT_UNIFIED_SETTINGS.fontSmoothing ? (
          <SettingResetButton
            label="font smoothing"
            onClick={() => updateSettings({ fontSmoothing: DEFAULT_UNIFIED_SETTINGS.fontSmoothing })}
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.fontSmoothing}
          onChange={(checked) => updateSettings({ fontSmoothing: checked })}
          testId="font-smoothing-switch"
        />
      }
    />
  );
}

function WordWrapRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("word-wrap")}
      description="Wrap long lines in code blocks, tables, diffs, and file previews by default."
      resetAction={
        settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? (
          <SettingResetButton
            label="word wrapping"
            onClick={() => updateSettings({ wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap })}
          />
        ) : null
      }
      control={
        <Switch checked={settings.wordWrap} onChange={(checked) => updateSettings({ wordWrap: checked })} testId="word-wrap-switch" />
      }
    />
  );
}

function SimpleFontRows() {
  const settings = useScopedSettings();
  return (
    <>
      <InterfaceFontRow preview={<PromptFontPreview />} />
      <CodeFontRow
        title="Monospace font"
        description="Code blocks, diffs, file previews, and the terminal."
        preview={
          <>
            <CodeFontPreview />
            <TerminalFontPreview family={settings.fontFamilyCode} size={settings.fontSizeCode} />
          </>
        }
      />
    </>
  );
}

export function TypographySection() {
  const theme = useTheme();
  const [advanced, setAdvancedState] = useState(readAdvanced);
  const setAdvanced = (next: boolean) => {
    setAdvancedState(next);
    localStore.setItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY, next ? "true" : "false");
  };
  return (
    <SettingsSection
      id="typography"
      title="Typography"
      headerAction={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text size="xs" weight={500} color={theme.mutedForeground}>
            Advanced
          </Text>
          <Switch checked={advanced} onChange={setAdvanced} testId="typography-advanced" />
        </div>
      }
    >
      {advanced ? (
        <>
          <InterfaceFontRow />
          <PromptFontRow />
          <CodeFontRow />
          <TerminalFontRow />
          <FontSmoothingRow />
        </>
      ) : (
        <SimpleFontRows />
      )}
      <WordWrapRow />
    </SettingsSection>
  );
}

const SIZE_OPTIONS_CACHE = new Map<string, ReadonlyArray<{ value: string; label: string }>>();
function sizeOptions(min: number, max: number) {
  const key = `${min}-${max}`;
  let options = SIZE_OPTIONS_CACHE.get(key);
  if (!options) {
    options = Array.from({ length: max - min + 1 }, (_, index) => min + index).map((px) => ({
      value: String(px),
      label: `${px} px`,
    }));
    SIZE_OPTIONS_CACHE.set(key, options);
  }
  return options;
}

const FAMILY_COMMIT_DELAY_MS = 400;

function FontFamilySettingsRow({
  id,
  title,
  testKey,
  description,
  defaultFamily,
  defaultValue,
  preview,
  value,
  onValueChange,
  onReset,
  size,
  requireMonospace = false,
}: {
  requireMonospace?: boolean;
  id?: string;
  title: string;
  testKey: string;
  description: string;
  defaultFamily: string;
  defaultValue: string;
  preview?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  onReset: () => void;
  size: { min: number; max: number; value: number; defaultValue: number; onChange: (value: number) => void };
}) {
  const [draft, setDraft] = useState(value);
  // A pending commit remembers the value it was typed against, so one that
  // outlives an external change (reset, another window) drops its stale draft.
  const commitTimer = useRef<{ readonly id: ReturnType<typeof setTimeout>; readonly value: string } | null>(null);
  const latestValue = useRef(value);
  latestValue.current = value;
  const [adopted, setAdopted] = useState(value);
  if (adopted !== value) {
    setAdopted(value);
    setDraft(value);
  }
  const cancelPendingCommit = () => {
    if (commitTimer.current !== null) clearTimeout(commitTimer.current.id);
    commitTimer.current = null;
  };
  useEffect(() => () => cancelPendingCommit(), []);
  const commitDraft = (next: string) => {
    if (next !== value) onValueChange(next);
  };
  const flushDraft = () => {
    const pending = commitTimer.current;
    cancelPendingCommit();
    if (pending !== null && pending.value === value) commitDraft(draft);
  };
  const resetToDefault = () => {
    cancelPendingCommit();
    setDraft(defaultValue);
    onReset();
  };
  const resetAction =
    value !== defaultValue || size.value !== size.defaultValue ? (
      <SettingResetButton label={title.toLowerCase()} onClick={resetToDefault} />
    ) : null;
  const fontEnumeration = useFontEnumeration();
  const control = (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
      {fontEnumeration.status === "granted" ? (
        <FontFamilyPicker
          testId={`font-family-${testKey}`}
          families={fontEnumeration.families}
          defaultFamily={defaultFamily}
          selectedFamily={value.trim()}
          requireMonospace={requireMonospace}
          onSelect={(family) => {
            cancelPendingCommit();
            setDraft(family);
            if (family !== value) onValueChange(family);
          }}
        />
      ) : (
      <div
        onKeyDown={(event) => {
          // Discard uncommitted typing without leaving the settings page,
          // which is what an unhandled Escape does.
          if (event.key !== "escape") return;
          event.preventDefault?.();
          event.stopPropagation?.();
          cancelPendingCommit();
          setDraft(value);
        }}
      >
        <TextField
          testId={`font-family-${testKey}`}
          size="sm"
          width={176}
          value={draft}
          placeholder={defaultFamily}
          onChange={(next) => {
            setDraft(next);
            cancelPendingCommit();
            const typedAgainst = value;
            commitTimer.current = {
              id: setTimeout(() => {
                commitTimer.current = null;
                if (latestValue.current === typedAgainst && next !== typedAgainst) onValueChange(next);
              }, FAMILY_COMMIT_DELAY_MS),
              value: typedAgainst,
            };
          }}
          onSubmit={flushDraft}
          onBlur={flushDraft}
        />
      </div>
      )}
      <SettingsSelect
        testId={`font-size-${testKey}`}
        width={144}
        value={String(size.value)}
        options={sizeOptions(size.min, size.max)}
        label={`${size.value} px`}
        onChange={(next) => {
          const parsed = Number(next);
          if (Number.isInteger(parsed) && parsed >= size.min && parsed <= size.max) size.onChange(parsed);
        }}
      />
    </div>
  );
  return (
    <SettingsRow
      {...(id !== undefined ? { id } : {})}
      title={title}
      description={description}
      resetAction={resetAction}
      control={control}
    >
      {preview}
    </SettingsRow>
  );
}
