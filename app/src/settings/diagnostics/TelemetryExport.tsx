// Port of apps/web/src/components/settings/TelemetryExportSettings.tsx: the
// OpenTelemetry export endpoints at the bottom of Diagnostics. With more than
// one environment in scope it shows the scope notice instead, like the web
// (which nests a whole SettingsScopeNotice page there; t3-term draws the same
// content without a second scroller).
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OtlpEndpointCheckResult, OtlpSignal, ServerObservability } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { useAtomCommand, useEnvironments } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import { settingsScopeEnvironmentAddress, settingsScopeEnvironmentLabels } from "../../web/components/settings/settingsScopeAxis.ts";
import { TextField } from "../controls.tsx";
import { SettingsGroup, SettingsScopeSentence, SettingsSection, machineIcon } from "../layout.tsx";
import { useScopedSettings, useSettingsScope } from "../scope.tsx";

const SIGNALS = [
  { key: "otlpTracesUrl", sourceKey: "otlpTracesSource", variableKey: "otlpTracesVariable", label: "Traces", signal: "traces" },
  { key: "otlpMetricsUrl", sourceKey: "otlpMetricsSource", variableKey: "otlpMetricsVariable", label: "Metrics", signal: "metrics" },
  { key: "otlpLogsUrl", sourceKey: "otlpLogsSource", variableKey: "otlpLogsVariable", label: "Logs", signal: "logs" },
] as const;

type SignalDescriptor = (typeof SIGNALS)[number];
type SignalKey = SignalDescriptor["key"];
type DotTone = "muted" | "warning" | "success" | "danger";

const OVERRIDE_LABELS = { environment: "Set by environment", bootstrap: "Set by desktop" } as const;

function runningOverride(running: ServerObservability | undefined, { key, sourceKey, variableKey }: SignalDescriptor) {
  const url = running?.[key];
  const source = running?.[sourceKey];
  if (url === undefined || (source !== "environment" && source !== "bootstrap")) return undefined;
  return { url, label: OVERRIDE_LABELS[source], variable: running?.[variableKey] };
}

type EndpointCheck = { readonly url: string; readonly result: OtlpEndpointCheckResult | null };

const isHttpUrl = (url: string) => /^https?:\/\/./i.test(url);

function endpointStatus(url: string, check: EndpointCheck | undefined): { label: string; dot: DotTone } {
  if (url === "") return { label: "Off", dot: "muted" };
  if (check?.url !== url) return { label: "Not checked", dot: "muted" };
  const { result } = check;
  if (result === null) return { label: "Checking…", dot: "warning" };
  switch (result._tag) {
    case "Accepted":
      return { label: `Connected · ${Math.round(result.latencyMs)} ms`, dot: "success" };
    case "Rejected":
      return { label: `Rejected · HTTP ${result.status}`, dot: "danger" };
    case "Unreachable":
      return { label: result.timedOut ? "Timed out" : "Unreachable", dot: "danger" };
  }
}

export function TelemetryExportSettings() {
  const { environment, scope } = useSettingsScope();
  if (scope.kind !== "environment" || !environment) {
    return (
      <SettingsSection title="OpenTelemetry export" id="telemetry-export">
        <EnvironmentScopeNotice>Choose one environment to configure its telemetry exports.</EnvironmentScopeNotice>
      </SettingsSection>
    );
  }
  return <TelemetryExportForm key={environment.environmentId} />;
}

/**
 * SettingsScopeNotice target="environment" as it renders inside the section:
 * its own readable-width page column with the scope sentence, the message,
 * and one row per environment that switches the scope to it.
 */
function EnvironmentScopeNotice({ children }: { children: string }) {
  const theme = useTheme();
  const { selectScope } = useSettingsScope();
  const { environments } = useEnvironments();
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 32, width: "100%", maxWidth: 896, paddingTop: 24, paddingLeft: 24, paddingRight: 24, paddingBottom: 48 }}>
        <SettingsScopeSentence />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ paddingLeft: 16, paddingRight: 16 }}>
            <Text color={theme.mutedForeground}>{children}</Text>
          </div>
          <SettingsGroup>
            {environments.map((entry) => {
              const { primary, secondary } = settingsScopeEnvironmentLabels(entry, environments);
              return (
                <ScopeChoiceRow
                  key={entry.environmentId}
                  environmentId={entry.environmentId}
                  label={primary}
                  secondary={secondary || settingsScopeEnvironmentAddress(entry)}
                  icon={machineIcon(entry.serverConfig)}
                  onSelect={() => selectScope({ machine: entry.environmentId })}
                />
              );
            })}
          </SettingsGroup>
        </div>
      </div>
    </div>
  );
}

function ScopeChoiceRow({
  environmentId,
  label,
  secondary,
  icon,
  onSelect,
}: {
  environmentId: EnvironmentId;
  label: string;
  secondary: string;
  icon: ReturnType<typeof machineIcon>;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <div
      testId={`diagnostics-telemetry-scope-${environmentId}`}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: 12,
        cursor: "pointer",
        backgroundColor: hover ? alpha(theme.accent, 0.5) : "#00000000",
      }}
    >
      <Icon name={icon} size={16} color={theme.mutedForeground} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <Text weight={500}>{label}</Text>
        {secondary ? (
          <Text size="xs" color={theme.mutedForeground}>
            {secondary}
          </Text>
        ) : null}
      </div>
      <Icon name="chevron-right" size={16} color={theme.mutedForeground} />
    </div>
  );
}

function StatusDot({ tone }: { tone: DotTone }) {
  const theme = useTheme();
  const color =
    tone === "success" ? theme.success : tone === "warning" ? theme.warning : tone === "danger" ? theme.error : alpha(theme.mutedForeground, 0.4);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 12, height: 12, flexShrink: 0 }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </div>
  );
}

function TelemetryExportForm() {
  const theme = useTheme();
  const { environment } = useSettingsScope();
  const saved = useScopedSettings((settings) => settings.observability);
  const [draft, setDraft] = useState<Partial<typeof saved>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const environmentId = environment?.environmentId;
  const canEdit = useAtomValue(serverEnvironment.checkOtlpEndpoint.permissionAtom(environmentId ?? null));
  const canCheck = canEdit && environment?.serverConfig?.environment.capabilities.otlpEndpointCheck === true;
  const running = environment?.serverConfig?.observability;
  const [checks, setChecks] = useState<Partial<Record<SignalKey, EndpointCheck>>>(() =>
    Object.fromEntries(
      SIGNALS.flatMap((descriptor) => {
        const url = runningOverride(running, descriptor)?.url ?? saved[descriptor.key];
        return isHttpUrl(url) ? [[descriptor.key, { url, result: null }]] : [];
      }),
    ),
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: true });
  const checkOtlpEndpoint = useAtomCommand(serverEnvironment.checkOtlpEndpoint);
  const values = { ...saved, ...draft };
  const changedSignals = SIGNALS.filter(({ key }) => values[key].trim() !== saved[key]);
  const changed = changedSignals.length > 0;

  const sendCheck = async (key: SignalKey, signal: OtlpSignal, url: string) => {
    if (!environmentId) return;
    const response = await checkOtlpEndpoint({ environmentId, input: { signal, url } });
    setChecks((previous) => {
      if (previous[key]?.url !== url || previous[key].result !== null) return previous;
      const next = { ...previous };
      if (response._tag === "Success") next[key] = { url, result: response.value };
      else delete next[key];
      return next;
    });
  };

  const checkEndpoint = (key: SignalKey, signal: OtlpSignal, url: string) => {
    if (!isHttpUrl(url)) return;
    setChecks((previous) => ({ ...previous, [key]: { url, result: null } }));
    void sendCheck(key, signal, url);
  };

  // useEffectEvent: the effect runs when checking becomes possible and reads the latest checks.
  const sendPendingChecksRef = useRef<() => void>(() => {});
  sendPendingChecksRef.current = () => {
    for (const { key, signal } of SIGNALS) {
      const check = checks[key];
      if (check?.result === null) void sendCheck(key, signal, check.url);
    }
  };
  useEffect(() => {
    if (canCheck) sendPendingChecksRef.current();
  }, [canCheck]);

  const save = async () => {
    if (!environment || saving || !changed || !canEdit) return;
    // The web form's `pattern` check blocks submit with this message as its title.
    if (changedSignals.some(({ key }) => values[key].trim() !== "" && !isHttpUrl(values[key].trim()))) {
      setMessage("Enter an HTTP or HTTPS endpoint, or leave empty to disable export.");
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await updateSettings({
      environmentId: environment.environmentId,
      input: { patch: { observability: Object.fromEntries(changedSignals.map(({ key }) => [key, values[key]])) } },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setDraft({});
      setMessage("Saved. Restart the server to apply.");
    }
  };

  return (
    <SettingsSection title="OpenTelemetry export" id="telemetry-export">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 16 }}>
        <Text size="xs" color={theme.mutedForeground}>
          Send traces, metrics, and logs to an OTLP HTTP receiver. Restart the server to apply. Environment variables override these settings.
        </Text>
        {!canEdit ? (
          <Text size="xs" color={theme.mutedForeground}>
            {`This connection lacks permission to change settings on ${environment?.label ?? "the selected environment"}.`}
          </Text>
        ) : null}
        {SIGNALS.map((descriptor) => {
          const { key, label, signal } = descriptor;
          const override = runningOverride(running, descriptor);
          const url = override?.url ?? values[key].trim();
          const check = canCheck ? endpointStatus(url, checks[key]) : null;
          const status = override
            ? { label: check ? `${override.label} · ${check.label}` : override.label, dot: check?.dot ?? ("muted" as const) }
            : check;
          const testDisabled = !isHttpUrl(url) || checks[key]?.result === null;
          return (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {status ? <StatusDot tone={status.dot} /> : null}
                  <Text weight={500} style={{ lineHeight: 16 }}>{`${label} endpoint`}</Text>
                </div>
                {status ? (
                  <Text size="xs" color={theme.mutedForeground}>
                    {status.label}
                  </Text>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
                <TextField
                  testId={`diagnostics-otlp-${signal}`}
                  size="sm"
                  value={values[key]}
                  placeholder={`http://localhost:4318/v1/${signal}`}
                  disabled={saving || !canEdit}
                  onChange={(value) => {
                    // Restoring the saved value drops the draft, so a later save can't resend it over another client's change.
                    setDraft((previous) => {
                      const next = { ...previous, [key]: value };
                      if (value.trim() === saved[key]) delete next[key];
                      return next;
                    });
                    setMessage(null);
                  }}
                  onSubmit={() => void save()}
                />
                {canCheck ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={testDisabled}
                    onClick={() => checkEndpoint(key, signal, url)}
                    testId={`diagnostics-otlp-${signal}-test`}
                  >
                    Test
                  </Button>
                ) : null}
              </div>
              {saved[key] !== (running?.[key] ?? "") || override?.variable ? (
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "baseline" }}>
                  <Text size="xs" color={theme.mutedForeground}>
                    {`Running: ${running?.[key] || "Disabled"}`}
                  </Text>
                  {override?.variable ? (
                    <>
                      <Text size="xs" color={theme.mutedForeground}>
                        {" from "}
                      </Text>
                      <Text size="xs" mono color={theme.mutedForeground}>
                        {override.variable}
                      </Text>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text size="xs" color={theme.mutedForeground}>
            {message ?? ""}
          </Text>
          <div style={{ display: "flex", flexDirection: "row", gap: 8, flexShrink: 0 }}>
            <Button
              size="xs"
              variant="outline"
              disabled={!changed || saving || !canEdit}
              testId="diagnostics-otlp-discard"
              onClick={() => {
                setDraft({});
                setMessage(null);
                if (!canCheck) return;
                for (const descriptor of SIGNALS) {
                  const { key, signal } = descriptor;
                  if (runningOverride(running, descriptor)) continue;
                  if (checks[key]?.url !== saved[key]) checkEndpoint(key, signal, saved[key]);
                }
              }}
            >
              Discard
            </Button>
            <Button size="xs" disabled={!changed || saving || !canEdit} testId="diagnostics-otlp-save" onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
