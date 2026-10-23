// Port of apps/web/src/components/device/DeviceToolsPanel.tsx: app, settings,
// accessibility, location, permissions, push and event-log tools for the open
// device. The web Collapsible event log is a header that folds its list.
import type { DeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import type { DevicePermission, DeviceSummary, DeviceTextSize } from "@t3tools/contracts";
import { useEffect, useState, type ReactNode } from "react";

import { SegmentedToggle } from "../../dialogs/dialogKit.tsx";
import { SettingsSelect, TextField } from "../../settings/controls.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Switch } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { alpha, FONTS, useTheme } from "../../ui/theme.ts";
import { type DeviceEventLogEntry, subscribeDeviceEventLog } from "../../web/components/device/deviceHubApi.ts";
import type { DeviceControls } from "./useDeviceControls.ts";

/** web: `w-72`. */
export const TOOLS_PANEL_WIDTH = 288;

const TEXT_SIZES: ReadonlyArray<{ value: DeviceTextSize; label: string }> = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
  { value: "extra-large", label: "Extra large" },
];

const COLOR_FILTERS = [
  { value: "none", label: "None" },
  { value: "grayscale", label: "Grayscale" },
  { value: "red-green", label: "Red / green (protanopia)" },
  { value: "green-red", label: "Green / red (deuteranopia)" },
  { value: "blue-yellow", label: "Blue / yellow (tritanopia)" },
] as const;

const ORIENTATIONS = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape_left", label: "Landscape left" },
  { value: "portrait_upside_down", label: "Upside down" },
  { value: "landscape_right", label: "Landscape right" },
] as const;

const IOS_PERMISSIONS: ReadonlyArray<{ value: DevicePermission; label: string }> = [
  { value: "camera", label: "Camera" },
  { value: "microphone", label: "Microphone" },
  { value: "photos", label: "Photos" },
  { value: "contacts", label: "Contacts" },
  { value: "calendar", label: "Calendar" },
  { value: "reminders", label: "Reminders" },
  { value: "location", label: "Location" },
  { value: "notifications", label: "Notifications" },
  { value: "motion", label: "Motion" },
  { value: "media-library", label: "Media library" },
  { value: "faceid", label: "Face ID" },
];

const ANDROID_PERMISSIONS: ReadonlyArray<{ value: DevicePermission; label: string }> = [
  { value: "camera", label: "Camera" },
  { value: "microphone", label: "Microphone" },
  { value: "photos", label: "Photos" },
  { value: "contacts", label: "Contacts" },
  { value: "calendar", label: "Calendar" },
  { value: "location", label: "Location" },
  { value: "notifications", label: "Notifications" },
  { value: "motion", label: "Physical activity" },
];

const LOCATION_PRESETS = [
  { label: "San Francisco", latitude: 37.7749, longitude: -122.4194 },
  { label: "New York", latitude: 40.7128, longitude: -74.006 },
  { label: "London", latitude: 51.5074, longitude: -0.1278 },
  { label: "Stockholm", latitude: 59.3293, longitude: 18.0686 },
  { label: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
] as const;

export function DeviceToolsPanel(props: {
  readonly controls: DeviceControls;
  readonly hostDiagnostics: string | undefined;
  readonly device: DeviceSummary;
  readonly access: DeviceHubAccess | null;
  readonly axOverlay: boolean;
  readonly onAxOverlayChange: (enabled: boolean) => void;
  readonly onClose: () => void;
  /** Over the stream (narrow panel) rather than beside it: web adds a shadow. */
  readonly overlay: boolean;
}) {
  const theme = useTheme();
  const { device, controls } = props;
  const { detail, pending, error, foregroundApp, disabled, act } = controls;
  const settings = detail?.settings;
  const isIos = device.platform === "ios";

  return (
    <div
      testId="device-tools-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
        borderLeftWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.background,
        ...(props.overlay
          ? { boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 8, spreadRadius: -3, color: "#0000001a" } }
          : {}),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 36,
          flexShrink: 0,
          paddingLeft: 12,
          paddingRight: 12,
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Text weight={500}>Tools</Text>
        {pending ? <Icon name="loader-circle" size={16} color={theme.mutedForeground} /> : null}
        <div style={{ flexGrow: 1 }} />
        <IconButton testId="device-tools-close" icon="x" size={24} iconSize={14} onClick={props.onClose} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar }}>
        {error ? (
          <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderColor: theme.border, backgroundColor: alpha(theme.error, 0.1) }}>
            <Text size="xs" color={theme.errorForeground}>
              {error}
            </Text>
          </div>
        ) : null}
        {detail === null && !error ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12 }}>
            <Icon name="loader-circle" size={16} color={theme.mutedForeground} />
            <Text size="xs" color={theme.mutedForeground}>
              Reading device settings…
            </Text>
          </div>
        ) : null}

        {props.hostDiagnostics ? (
          <Section title="Host diagnostics">
            <Text size="xs" color={theme.mutedForeground}>
              {props.hostDiagnostics}
            </Text>
          </Section>
        ) : null}

        <Section title="App">
          <Row label="Foreground">
            <Text size="xs" mono truncate>
              {foregroundApp?.id ?? "-"}
            </Text>
          </Row>
          {foregroundApp ? (
            <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
              <Button size="xs" variant="outline" disabled={disabled} onClick={() => void act({ type: "terminateApp", appId: foregroundApp.id })}>
                Terminate
              </Button>
              <Button size="xs" variant="outline" disabled={disabled} onClick={() => void act({ type: "launchApp", appId: foregroundApp.id })}>
                Relaunch
              </Button>
            </div>
          ) : null}
          <SubmitRow testId="device-tools-open-url" placeholder="https://… or myapp://" action="Open" disabled={disabled} onSubmit={(url) => act({ type: "openUrl", url })} />
          <SubmitRow
            testId="device-tools-launch"
            placeholder={isIos ? "Bundle ID to launch" : "Package name to launch"}
            action="Launch"
            disabled={disabled}
            onSubmit={(appId) => act({ type: "launchApp", appId })}
          />
        </Section>

        <Section title={isIos ? "Simulator" : "Emulator"}>
          <Row label="Appearance">
            <Disabled disabled={disabled}>
              <SegmentedToggle
                testId="device-tools-appearance"
                value={settings?.appearance ?? null}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                onChange={(next) => {
                  if (next !== settings?.appearance) void act({ type: "setAppearance", value: next });
                }}
              />
            </Disabled>
          </Row>
          <Row label="Text size">
            <ChoiceSelect value={settings?.textSize ?? null} options={TEXT_SIZES} disabled={disabled} onChange={(value) => act({ type: "setTextSize", value })} />
          </Row>
          {isIos ? (
            <>
              <Row label="Liquid Glass">
                <Disabled disabled={disabled || settings?.liquidGlass === undefined}>
                  <SegmentedToggle
                    value={settings?.liquidGlass ?? null}
                    options={[
                      { value: "clear", label: "Clear" },
                      { value: "tinted", label: "Tinted" },
                    ]}
                    onChange={(next) => {
                      if (next !== settings?.liquidGlass) void act({ type: "setLiquidGlass", value: next });
                    }}
                  />
                </Disabled>
              </Row>
              <Row label="Color filter">
                <ChoiceSelect value={settings?.colorFilter ?? null} options={COLOR_FILTERS} disabled={disabled} onChange={(value) => act({ type: "setColorFilter", value })} />
              </Row>
            </>
          ) : (
            <Row label="Orientation">
              <ChoiceSelect
                testId="device-tools-orientation"
                value={null}
                placeholder="Rotate to…"
                options={ORIENTATIONS}
                disabled={disabled}
                onChange={(value) => act({ type: "setOrientation", value })}
              />
            </Row>
          )}
          <SwitchRow label="Reduce Motion" checked={settings?.reduceMotion} disabled={disabled} onChange={(value) => act({ type: "setToggle", setting: "reduceMotion", value })} />
          {isIos ? (
            <>
              <SwitchRow
                label="Increase Contrast"
                checked={settings?.increaseContrast}
                disabled={disabled}
                onChange={(value) => act({ type: "setToggle", setting: "increaseContrast", value })}
              />
              <SwitchRow
                label="Reduce Transparency"
                checked={settings?.reduceTransparency}
                disabled={disabled}
                onChange={(value) => act({ type: "setToggle", setting: "reduceTransparency", value })}
              />
              <SwitchRow label="Show Borders" checked={settings?.showBorders} disabled={disabled} onChange={(value) => act({ type: "setToggle", setting: "showBorders", value })} />
              <SwitchRow label="VoiceOver" checked={settings?.voiceOver} disabled={disabled} onChange={(value) => act({ type: "setToggle", setting: "voiceOver", value })} />
            </>
          ) : (
            <SwitchRow
              label="Network"
              checked={settings?.networkEnabled}
              disabled={disabled}
              onChange={(value) => act({ type: "setToggle", setting: "networkEnabled", value })}
            />
          )}
        </Section>

        <Section title="Accessibility">
          <SwitchRow
            label="Overlay element frames"
            testId="device-tools-ax-overlay"
            checked={props.axOverlay}
            disabled={props.access === null}
            onChange={(value) => {
              props.onAxOverlayChange(value);
              return Promise.resolve();
            }}
          />
        </Section>

        <LocationSection
          disabled={disabled}
          canClear={isIos}
          onSet={(latitude, longitude) => act({ type: "setLocation", latitude, longitude })}
          onClear={() => act({ type: "clearLocation" })}
        />

        <PermissionsSection
          permissions={isIos ? IOS_PERMISSIONS : ANDROID_PERMISSIONS}
          canReset={isIos}
          defaultAppId={foregroundApp?.id ?? ""}
          disabled={disabled}
          onDecide={(appId, permission, decision) => act({ type: "setPermission", appId, permission, decision })}
        />

        {isIos ? (
          <Section title="Push notification">
            <SubmitRow
              placeholder="Alert text"
              action="Send"
              disabled={disabled || !foregroundApp}
              onSubmit={(payload) => (foregroundApp ? act({ type: "sendPush", appId: foregroundApp.id, payload }) : Promise.resolve())}
            />
            {!foregroundApp ? (
              <Text size="xs" color={theme.mutedForeground}>
                Open an app first.
              </Text>
            ) : null}
          </Section>
        ) : null}

        {isIos && props.access ? <EventLogSection access={props.access} device={device} /> : null}
      </div>
    </div>
  );
}

function Disabled({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return <div style={{ display: "flex", opacity: disabled ? 0.64 : 1, pointerEvents: disabled ? "none" : "auto" }}>{children}</div>;
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flexShrink: 0,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Text size="xs" weight={500} color={theme.mutedForeground}>
        {props.title}
      </Text>
      {props.children}
    </div>
  );
}

function Row(props: { readonly label: string; readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 28 }}>
      <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
        {props.label}
      </Text>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", minWidth: 0 }}>{props.children}</div>
    </div>
  );
}

function SwitchRow(props: {
  readonly label: string;
  readonly checked: boolean | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: boolean) => Promise<void>;
  readonly testId?: string;
}) {
  return (
    <Row label={props.label}>
      <Switch
        testId={props.testId}
        checked={props.checked ?? false}
        disabled={props.disabled || props.checked === undefined}
        onChange={(checked) => void props.onChange(checked)}
      />
    </Row>
  );
}

function ChoiceSelect<V extends string>(props: {
  readonly value: V | null;
  readonly options: ReadonlyArray<{ readonly value: V; readonly label: string }>;
  readonly disabled: boolean;
  readonly placeholder?: string;
  readonly onChange: (value: V) => Promise<void>;
  readonly testId?: string;
}) {
  const current = props.options.find((option) => option.value === props.value);
  return (
    <SettingsSelect<V>
      testId={props.testId}
      size="sm"
      width={160}
      value={props.value}
      label={current?.label ?? props.placeholder ?? "Unknown"}
      options={props.options}
      disabled={props.disabled}
      onChange={(value) => {
        if (value !== props.value) void props.onChange(value);
      }}
    />
  );
}

function SubmitRow(props: {
  readonly placeholder: string;
  readonly action: string;
  readonly disabled: boolean;
  readonly onSubmit: (value: string) => Promise<void>;
  readonly testId?: string;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    void props.onSubmit(trimmed).then(() => setValue(""));
  };
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
      <TextField
        testId={props.testId}
        size="sm"
        mono
        value={value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={setValue}
        onSubmit={submit}
      />
      <Button size="xs" variant="outline" disabled={props.disabled || value.trim().length === 0} onClick={submit} style={{ height: 28 }}>
        {props.action}
      </Button>
    </div>
  );
}

function LocationSection(props: {
  readonly disabled: boolean;
  readonly canClear: boolean;
  readonly onSet: (latitude: number, longitude: number) => Promise<void>;
  readonly onClear: () => Promise<void>;
}) {
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const parsed = { latitude: Number(latitude), longitude: Number(longitude) };
  const valid =
    latitude.trim() !== "" && longitude.trim() !== "" && Math.abs(parsed.latitude) <= 90 && Math.abs(parsed.longitude) <= 180;
  return (
    <Section title="Location">
      <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
        <TextField size="sm" mono placeholder="Latitude" value={latitude} disabled={props.disabled} onChange={setLatitude} />
        <TextField size="sm" mono placeholder="Longitude" value={longitude} disabled={props.disabled} onChange={setLongitude} />
      </div>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <SettingsSelect<string>
          size="sm"
          width={128}
          align="start"
          value={null}
          label="Preset…"
          disabled={props.disabled}
          options={LOCATION_PRESETS.map((preset) => ({ value: preset.label, label: preset.label }))}
          onChange={(value) => {
            const preset = LOCATION_PRESETS.find((candidate) => candidate.label === value);
            if (!preset) return;
            setLatitude(String(preset.latitude));
            setLongitude(String(preset.longitude));
            void props.onSet(preset.latitude, preset.longitude);
          }}
        />
        <Button size="xs" variant="outline" disabled={props.disabled || !valid} onClick={() => void props.onSet(parsed.latitude, parsed.longitude)}>
          Set
        </Button>
        {props.canClear ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={props.disabled}
            onClick={() => {
              setLatitude("");
              setLongitude("");
              void props.onClear();
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

function PermissionsSection(props: {
  readonly permissions: ReadonlyArray<{ value: DevicePermission; label: string }>;
  readonly canReset: boolean;
  readonly defaultAppId: string;
  readonly disabled: boolean;
  readonly onDecide: (appId: string, permission: DevicePermission, decision: "grant" | "revoke" | "reset") => Promise<void>;
}) {
  const [appId, setAppId] = useState("");
  const [permission, setPermission] = useState<DevicePermission>("camera");
  const resolvedAppId = appId.trim() || props.defaultAppId;
  const decide = (decision: "grant" | "revoke" | "reset") => void props.onDecide(resolvedAppId, permission, decision);
  return (
    <Section title="Permissions">
      <TextField size="sm" mono placeholder={props.defaultAppId || "App ID"} value={appId} disabled={props.disabled} onChange={setAppId} />
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <ChoiceSelect
          value={permission}
          options={props.permissions}
          disabled={props.disabled}
          onChange={(value) => {
            setPermission(value);
            return Promise.resolve();
          }}
        />
        <Button size="xs" variant="outline" disabled={props.disabled || !resolvedAppId} onClick={() => decide("grant")}>
          Grant
        </Button>
        <Button size="xs" variant="outline" disabled={props.disabled || !resolvedAppId} onClick={() => decide("revoke")}>
          Revoke
        </Button>
        {props.canReset ? (
          <Button size="xs" variant="ghost" disabled={props.disabled || !resolvedAppId} onClick={() => decide("reset")}>
            Reset
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

const EVENT_LOG_LIMIT = 100;

function EventLogSection(props: { readonly access: DeviceHubAccess; readonly device: DeviceSummary }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ReadonlyArray<DeviceEventLogEntry>>([]);

  useEffect(() => {
    if (!open) return;
    const unsubscribe = subscribeDeviceEventLog(
      { access: props.access, platform: props.device.platform, deviceId: props.device.id },
      (incoming, reset) => {
        setEntries((current) => {
          const merged = reset ? [...incoming] : [...current, ...incoming];
          return merged.length > EVENT_LOG_LIMIT ? merged.slice(-EVENT_LOG_LIMIT) : merged;
        });
      },
    );
    return () => {
      unsubscribe();
      setEntries([]);
    };
  }, [open, props.access, props.device.id, props.device.platform]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 10,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderColor: theme.border,
          cursor: "pointer",
        }}
      >
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          Event log
        </Text>
        <div style={{ flexGrow: 1 }} />
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
      </div>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
          {entries.length === 0 ? (
            <Text size="2xs" mono color={theme.mutedForeground}>
              No events yet.
            </Text>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} style={{ display: "flex", flexDirection: "row", gap: 8 }}>
                <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 18, fontFamily: FONTS.mono, flexShrink: 0 }}>
                  {entry.timestamp.slice(11, 19)}
                </text>
                <text style={{ color: theme.foreground, fontSize: 11, lineHeight: 18, fontFamily: FONTS.mono, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
                  {entry.summary}
                </text>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
