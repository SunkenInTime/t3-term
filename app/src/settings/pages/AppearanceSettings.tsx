// Port of apps/web/src/components/settings/AppearanceSettingsPanel.tsx.
// Theme state lives in state/clientSettings.ts; every row below is a client
// setting written through useUpdateScopedSettings, exactly as the web does.
import {
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  MAX_APPEARANCE_CONTRAST,
  MAX_GLASS_OPACITY,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_APPEARANCE_CONTRAST,
  MIN_GLASS_OPACITY,
  MIN_PANEL_ANIMATION_DURATION_MS,
  type ChatWidth,
  type EnvironmentIdentificationMode,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { useAtomValue } from "@effect/atom-react";

import { primaryEnvironmentIdAtom, useEnvironment } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Menu, MenuItem } from "../../ui/overlay.tsx";
import { Switch } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { diffColors } from "../appearance/FontPreviews.tsx";
import { PanelAnimationsPreview } from "../appearance/PanelAnimationsPreview.tsx";
import { ThemeLibrary } from "../appearance/ThemeLibrary.tsx";
import { TypographySection } from "../appearance/TypographySettings.tsx";
import { fieldBackground, SettingsSelect, Slider } from "../controls.tsx";
import { SettingResetButton, SettingsPageContainer, SettingsRow, SettingsSection } from "../layout.tsx";
import { useScopedSettings, useUpdateScopedSettings } from "../scope.tsx";

const ENVIRONMENT_IDENTIFICATION_LABELS: Record<EnvironmentIdentificationMode, string> = {
  artwork: "Artwork",
  pill: "Version pill",
  none: "None",
};

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  comfortable: "Comfortable",
  wide: "Wide",
  full: "Full",
};

// apps/web/src/branding.logic.ts
const NIGHTLY_SERVER_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;
/**
 * APP_STAGE_LABEL's fallback. The web build is "Dev" under Vite dev and
 * "Beta" otherwise; t3-term is not a staged build of the web app, so only a
 * nightly server makes the environment-identification row meaningful.
 */
const APP_STAGE_LABEL = "Beta";

/** SidebarStageBackdrop.tsx useEnvironmentStageLabel + resolveEnvironmentIdentificationPillLabel. */
function useShowEnvironmentIdentification(): boolean {
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const environment = useEnvironment(primaryEnvironmentId);
  const version = environment?.serverConfig?.environment.serverVersion ?? null;
  const stage = version && NIGHTLY_SERVER_VERSION_PATTERN.test(version) ? "Nightly" : APP_STAGE_LABEL;
  const normalized = stage.trim().toLowerCase();
  return normalized === "dev" || normalized === "nightly";
}

/** `<output className="min-w-12 rounded-md bg-muted px-2 py-1 font-mono text-xs font-medium">` */
function SliderValue({ children, minWidth = 48 }: { children: string; minWidth?: number }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 4,
        paddingBottom: 4,
        borderRadius: RADIUS.sm,
        backgroundColor: theme.muted,
        flexShrink: 0,
      }}
    >
      <Text size="xs" weight={500} mono>
        {children}
      </Text>
    </div>
  );
}

function SliderControl({
  testId,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  testId: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  // sm:w-52 with a 48px readout and gap 12.
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, width: 208 }}>
      <SliderValue>{`${value}${suffix}`}</SliderValue>
      <Slider testId={testId} width={148} value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}

type DiffColorScheme = UnifiedSettings["diffColorScheme"];

function DiffColorSelect({ value, onChange }: { value: DiffColorScheme; onChange: (value: DiffColorScheme) => void }) {
  const theme = useTheme();
  const colors = diffColors(value, theme.appearance, { add: theme.diffAdd, del: theme.diffDel });
  const dot = (color: string) => <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
  return (
    <Menu
      align="end"
      minWidth={160}
      testId="diff-colors-select-menu"
      trigger={({ toggle }) => (
        <div
          testId="diff-colors-select"
          onClick={toggle}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 28,
            width: 160,
            paddingLeft: 9,
            paddingRight: 8,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: fieldBackground(theme),
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", gap: 4, flexShrink: 0, pointerEvents: "none" }}>
            {value === "blue-orange" ? [dot(colors.add), dot(colors.del)] : [dot(colors.del), dot(colors.add)]}
          </div>
          <Text truncate style={{ flexGrow: 1 }}>
            {value === "blue-orange" ? "Blue & orange" : "Red & green"}
          </Text>
          <Icon name="chevron-down" size={12} color={alpha(theme.foreground, 0.5)} />
        </div>
      )}
    >
      <MenuItem checked={value === "red-green"} onSelect={() => onChange("red-green")}>
        Red & green (default)
      </MenuItem>
      <MenuItem checked={value === "blue-orange"} onSelect={() => onChange("blue-orange")}>
        Blue & orange
      </MenuItem>
    </Menu>
  );
}

export function AppearanceSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const showEnvironmentIdentification = useShowEnvironmentIdentification();

  return (
    <SettingsPageContainer showScope={false} virtual>
      <SettingsSection id="appearance" title="Colors & themes" variant="plain" hideTitle>
        <ThemeLibrary />
      </SettingsSection>

      <SettingsSection id="appearance-interface" title="Interface">
        <SettingsRow
          {...searchableSetting("setting-appearance-contrast")}
          description="Adjust the contrast of colors and borders across the interface."
          resetAction={
            settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast ? (
              <SettingResetButton
                label="contrast"
                onClick={() => updateSettings({ appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast })}
              />
            ) : null
          }
          control={
            <SliderControl
              testId="appearance-contrast"
              value={settings.appearanceContrast}
              min={MIN_APPEARANCE_CONTRAST}
              max={MAX_APPEARANCE_CONTRAST}
              step={5}
              suffix="%"
              onChange={(appearanceContrast) => updateSettings({ appearanceContrast })}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("setting-glass-opacity")}
          description="Higher values make menus, dialogs, and the composer more solid."
          resetAction={
            settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
              <SettingResetButton
                label="glass opacity"
                onClick={() => updateSettings({ glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity })}
              />
            ) : null
          }
          control={
            <SliderControl
              testId="glass-opacity"
              value={settings.glassOpacity}
              min={MIN_GLASS_OPACITY}
              max={MAX_GLASS_OPACITY}
              step={5}
              suffix="%"
              onChange={(glassOpacity) => updateSettings({ glassOpacity })}
            />
          }
        />

        {showEnvironmentIdentification ? (
          <SettingsRow
            {...searchableSetting("environment-identification")}
            description="Choose how Dev and Nightly environments are identified."
            resetAction={
              settings.environmentIdentificationMode !== DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE ? (
                <SettingResetButton
                  label="environment identification"
                  onClick={() => updateSettings({ environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE })}
                />
              ) : null
            }
            control={
              <SettingsSelect
                testId="environment-identification-select"
                value={settings.environmentIdentificationMode}
                options={(Object.entries(ENVIRONMENT_IDENTIFICATION_LABELS) as [EnvironmentIdentificationMode, string][]).map(
                  ([value, label]) => ({ value, label }),
                )}
                onChange={(environmentIdentificationMode) => updateSettings({ environmentIdentificationMode })}
              />
            }
          />
        ) : null}

        <SettingsRow
          {...searchableSetting("diff-color-scheme")}
          description="Choose colors for additions and deletions, including change counts."
          resetAction={
            settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme ? (
              <SettingResetButton
                label="diff colors"
                onClick={() => updateSettings({ diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme })}
              />
            ) : null
          }
          control={
            <DiffColorSelect value={settings.diffColorScheme} onChange={(diffColorScheme) => updateSettings({ diffColorScheme })} />
          }
        />

        <SettingsRow
          {...searchableSetting("composer-context")}
          description="Keep branch and worktree controls below the composer after a thread starts."
          resetAction={
            settings.persistComposerContextStrip !== DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip ? (
              <SettingResetButton
                label="composer context"
                onClick={() =>
                  updateSettings({ persistComposerContextStrip: DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip })
                }
              />
            ) : null
          }
          control={
            <Switch
              testId="composer-context-switch"
              checked={settings.persistComposerContextStrip}
              onChange={(checked) => updateSettings({ persistComposerContextStrip: checked })}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("chat-width")}
          description="Set how wide messages and the composer can grow on large screens."
          resetAction={
            settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? (
              <SettingResetButton
                label="chat width"
                onClick={() => updateSettings({ chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth })}
              />
            ) : null
          }
          control={
            <SettingsSelect
              testId="chat-width-select"
              value={settings.chatWidth}
              label={CHAT_WIDTH_LABELS[settings.chatWidth]}
              options={[
                { value: "comfortable", label: "Comfortable (default)" },
                { value: "wide", label: "Wide" },
                { value: "full", label: "Full" },
              ]}
              onChange={(chatWidth) => updateSettings({ chatWidth })}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("math-rendering")}
          description="Typeset LaTeX math, such as $x^2$ or \[x^2\], in messages and Markdown previews. The composer keeps TeX source editable."
          resetAction={
            settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled ? (
              <SettingResetButton
                label="math rendering"
                onClick={() => updateSettings({ mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled })}
              />
            ) : null
          }
          control={
            <Switch
              testId="math-rendering-switch"
              checked={settings.mathRenderingEnabled}
              onChange={(checked) => updateSettings({ mathRenderingEnabled: checked })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="motion" title="Motion">
        <SettingsRow
          {...searchableSetting("panel-animations")}
          description="Set how fast panels open and close."
          resetAction={
            settings.panelAnimationDurationMs !== DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs ? (
              <SettingResetButton
                label="panel animations"
                onClick={() =>
                  updateSettings({ panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs })
                }
              />
            ) : null
          }
          control={
            // sm:grid-cols-[7rem_13rem] sm:gap-4
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16 }}>
              <PanelAnimationsPreview durationMs={settings.panelAnimationDurationMs} />
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, width: 208 }}>
                <SliderValue minWidth={64}>{`${settings.panelAnimationDurationMs} ms`}</SliderValue>
                <Slider
                  testId="panel-animation-duration"
                  width={132}
                  value={settings.panelAnimationDurationMs}
                  min={MIN_PANEL_ANIMATION_DURATION_MS}
                  max={MAX_PANEL_ANIMATION_DURATION_MS}
                  step={25}
                  onChange={(panelAnimationDurationMs) => updateSettings({ panelAnimationDurationMs })}
                />
              </div>
            </div>
          }
        />
      </SettingsSection>

      <TypographySection />
    </SettingsPageContainer>
  );
}
