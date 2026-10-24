// Port of apps/web/src/components/settings/TypographySettings.tsx.
//
// The family control becomes FontFamilyPicker once the OS font list has loaded
// (installedFonts.ts; web: once the browser grants font enumeration) and stays a
// text input until then or if listing fails. Like web, the text input only
// commits a family that renders (FamilyProbe; web: appearanceFonts.ts
// isFontFamilyAvailable) and, for code and terminal, is fixed-width; anything
// else stays in the field, marked invalid.
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
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import { localStore } from "../../web/lib/localStore.ts";
import { isMacPlatform, PLATFORM } from "../../web/lib/utils.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { SettingsSelect, TextField } from "../controls.tsx";
import { SettingResetButton, SettingsRow, SettingsSection } from "../layout.tsx";
import { useScopedSettings, useUpdateScopedSettings } from "../scope.tsx";
import { FontFamilyPicker, MonospaceProbe } from "./FontFamilyPicker.tsx";
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

/** appearanceFonts.ts: generic families always render. */
const GENERIC_FAMILY = /^(system-ui|sans-serif|serif|monospace|ui-monospace)$/i;
/** No machine has this family, so GPUI draws it in its fallback face. */
const MISSING_FAMILY = "t3term-missing-font-probe";
const FAMILY_PROBE_TEXT = "mmmmmmmmmmwwwwwlli";

/**
 * web isFontFamilyAvailable measures text in the family against generic
 * fallbacks on a canvas. GPUI substitutes its fallback face for a family it
 * cannot find, so the family renders exactly when its run lays out at a
 * different width than the same run in a family that cannot exist. The
 * platform UI and code faces may be that fallback themselves, so they are
 * accepted without measuring (knownRenderableFamily).
 */
function FamilyProbe({ family, onResult }: { family: string; onResult: (available: boolean) => void }) {
  const theme = useTheme();
  const widths = useRef<{ candidate?: number; missing?: number }>({});
  const done = useRef(false);
  const settle = (key: "candidate" | "missing", width: number | undefined) => {
    if (done.current || !width) return;
    widths.current[key] = width;
    const { candidate, missing } = widths.current;
    if (candidate === undefined || missing === undefined) return;
    done.current = true;
    onResult(candidate !== missing);
  };
  const probeStyle = { position: "absolute" as const, top: 0, left: 0, whiteSpace: "nowrap" as const, fontSize: 48, color: theme.foreground };
  return (
    <div style={{ position: "absolute", top: 0, left: 0, opacity: 0, pointerEvents: "none" }}>
      <text style={{ ...probeStyle, fontFamily: family }} onLayout={(event) => settle("candidate", event.width)}>
        {FAMILY_PROBE_TEXT}
      </text>
      <text style={{ ...probeStyle, fontFamily: MISSING_FAMILY }} onLayout={(event) => settle("missing", event.width)}>
        {FAMILY_PROBE_TEXT}
      </text>
    </div>
  );
}

function knownRenderableFamily(family: string): boolean {
  const normalized = family.trim().toLowerCase();
  return GENERIC_FAMILY.test(normalized) || normalized === FONTS.sans.toLowerCase() || normalized === FONTS.mono.toLowerCase();
}

/** A typed family under test: it must render, and code and terminal families must be fixed-width. */
function FamilyCheck({
  family,
  requireMonospace,
  onResult,
}: {
  family: string;
  requireMonospace: boolean;
  onResult: (accepted: boolean) => void;
}) {
  const [renders, setRenders] = useState<boolean | null>(knownRenderableFamily(family) ? true : null);
  const needsMonospaceProbe = requireMonospace && !GENERIC_FAMILY.test(family);
  useEffect(() => {
    if (renders === false) onResult(false);
    else if (renders === true && !needsMonospaceProbe) onResult(true);
  }, [renders]);
  if (renders === null) return <FamilyProbe family={family} onResult={setRenders} />;
  if (renders && needsMonospaceProbe) return <MonospaceProbe family={family} onResult={onResult} />;
  return null;
}

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
  const theme = useTheme();
  const [draft, setDraft] = useState(value);
  // False while typing; a draft that has settled yet differs from the value was rejected.
  const [draftSettled, setDraftSettled] = useState(true);
  const [checking, setChecking] = useState<{ readonly family: string; readonly typedAgainst: string; readonly key: number } | null>(null);
  const checkKey = useRef(0);
  // A pending commit remembers the value it was typed against, so one that
  // outlives an external change (reset, another window) drops its stale draft.
  const commitTimer = useRef<{ readonly id: ReturnType<typeof setTimeout>; readonly value: string } | null>(null);
  const latestValue = useRef(value);
  latestValue.current = value;
  const [adopted, setAdopted] = useState(value);
  if (adopted !== value) {
    setAdopted(value);
    setDraft(value);
    setDraftSettled(true);
    setChecking(null);
  }
  const cancelPendingCommit = () => {
    if (commitTimer.current !== null) clearTimeout(commitTimer.current.id);
    commitTimer.current = null;
  };
  useEffect(() => () => cancelPendingCommit(), []);
  // web commitDraft: an empty field restores the default; a family commits only once it checks out.
  const commitDraft = (next: string, typedAgainst: string) => {
    if (next.trim().length === 0) {
      setDraftSettled(true);
      if (next !== typedAgainst) onValueChange(next);
      return;
    }
    checkKey.current += 1;
    setChecking({ family: next, typedAgainst, key: checkKey.current });
  };
  const finishCheck = (accepted: boolean) => {
    const check = checking;
    setChecking(null);
    setDraftSettled(true);
    if (check && accepted && latestValue.current === check.typedAgainst && check.family !== check.typedAgainst) onValueChange(check.family);
  };
  const flushDraft = () => {
    const pending = commitTimer.current;
    cancelPendingCommit();
    if (pending !== null && pending.value === value) commitDraft(draft, value);
  };
  const resetToDefault = () => {
    cancelPendingCommit();
    setChecking(null);
    setDraft(defaultValue);
    setDraftSettled(true);
    onReset();
  };
  const draftTrimmed = draft.trim();
  const draftRejected = draftSettled && checking === null && draftTrimmed.length > 0 && draftTrimmed !== value.trim();
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
          setChecking(null);
          setDraft(value);
          setDraftSettled(true);
        }}
        style={{ position: "relative" }}
      >
        {checking ? <FamilyCheck key={checking.key} family={checking.family.trim()} requireMonospace={requireMonospace} onResult={finishCheck} /> : null}
        <TextField
          testId={`font-family-${testKey}`}
          size="sm"
          width={176}
          value={draft}
          placeholder={defaultFamily}
          {...(draftRejected ? { style: { borderColor: alpha(theme.error, 0.36) } } : {})}
          onChange={(next) => {
            setDraft(next);
            setDraftSettled(false);
            setChecking(null);
            cancelPendingCommit();
            const typedAgainst = value;
            commitTimer.current = {
              id: setTimeout(() => {
                commitTimer.current = null;
                if (latestValue.current === typedAgainst) commitDraft(next, typedAgainst);
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
