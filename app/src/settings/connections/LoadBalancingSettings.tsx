// Port of apps/web/src/components/settings/LoadBalancingSettings.tsx and
// GitHubRoutingSettings.tsx: two folded sections under Environments, shown once this
// client has two or more machines.
import { useAtomValue } from "@effect/atom-react";
import {
  gitHubRoutingConnectionKey,
  gitHubRoutingPermissionFor,
  type GitHubRoutingPermission,
} from "@t3tools/client-runtime/connection";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { useState } from "react";

import { updateClientSettings, useClientSettings } from "../../state/clientSettings.ts";
import { environmentCatalog } from "../../state/environment.ts";
import { useAtomCommand, type EnvironmentPresentation } from "../../state/settings.ts";
import { Switch } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { useTheme } from "../../ui/theme.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { SettingsSelect } from "../controls.tsx";
import { FoldedSettingsSection } from "../FoldedSettingsSection.tsx";
import { useSettingsInset } from "../layout.tsx";
import { EnvironmentRow, environmentTransportLabel } from "./EnvironmentRow.tsx";

function Explanation({ children }: { children: string }) {
  const theme = useTheme();
  const inset = useSettingsInset();
  return (
    <div style={{ paddingLeft: inset, paddingRight: inset, paddingTop: 10, paddingBottom: 10 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {children}
      </Text>
    </div>
  );
}

// ── LoadBalancingSettings.tsx ────────────────────────────────────────────

const preferences = [
  { value: "100", label: "Prefer" },
  { value: "50", label: "Normal" },
  { value: "25", label: "Less often" },
  { value: "0", label: "Manual only" },
] as const;

type LoadPreference = 100 | 50 | 25 | 0;

function loadPreferenceForWeight(weight: number | undefined): LoadPreference {
  if (weight === undefined || weight === 50) return 50;
  if (weight === 0) return 0;
  return weight < 50 ? 25 : 100;
}

function preferenceLabel(preference: LoadPreference): string {
  return preferences.find((entry) => entry.value === String(preference))!.label;
}

function summarizeLoadPreferences(
  environments: ReadonlyArray<Pick<EnvironmentPresentation, "environmentId" | "label">>,
  weights: Readonly<Record<string, number>>,
): string | null {
  const parts = environments.flatMap((environment) => {
    const preference = loadPreferenceForWeight(weights[environment.environmentId]);
    return preference === 50 ? [] : [`${environment.label} ${preferenceLabel(preference).toLowerCase()}`];
  });
  return parts.length === 0 ? null : parts.join(" · ");
}

export function LoadBalancingSettings({ environments }: { environments: ReadonlyArray<EnvironmentPresentation> }) {
  const enabled = useClientSettings((current) => current.loadBalancingEnabled);
  const weights = useClientSettings((current) => current.loadBalancingWeights);
  if (environments.length < 2) return null;
  const { id, title } = searchableSetting("load-balancing");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={enabled ? summarizeLoadPreferences(environments, weights) : "Off"}
      control={<Switch testId="load-balancing-switch" checked={enabled} onChange={(loadBalancingEnabled) => updateClientSettings({ loadBalancingEnabled })} />}
    >
      <Explanation>
        New threads in shared projects start on the machine with the most free CPU and memory, weighted by each machine's preference.
      </Explanation>
      {environments.map((environment) => (
        <EnvironmentRow
          key={environment.environmentId}
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          label={environment.label}
          subtitle={environmentTransportLabel(environment)}
        >
          <SettingsSelect
            size="xs"
            width={144}
            testId={`load-preference-${environment.environmentId}`}
            disabled={!enabled}
            value={String(loadPreferenceForWeight(weights[environment.environmentId]))}
            options={preferences}
            onChange={(value) => updateClientSettings({ loadBalancingWeights: { ...weights, [environment.environmentId]: Number(value) } })}
          />
        </EnvironmentRow>
      ))}
    </FoldedSettingsSection>
  );
}

// ── GitHubRoutingSettings.tsx ────────────────────────────────────────────

const routingOptions: ReadonlyArray<{ value: GitHubRoutingPermission; label: string }> = [
  { value: "off", label: "Off" },
  { value: "read", label: "Read PRs" },
  { value: "read-write", label: "Read and act" },
];

const summaryLabels = { "read-write": "read and act", read: "read PRs" } as const;

function summarizeGitHubRouting(entries: ReadonlyArray<{ readonly label: string; readonly permission: GitHubRoutingPermission }>): string | null {
  const groups = (["read-write", "read"] as const).flatMap((permission) => {
    const labels = entries.filter((entry) => entry.permission === permission);
    return labels.length === 0 ? [] : [`${labels.map((entry) => entry.label).join(", ")} ${summaryLabels[permission]}`];
  });
  return groups.length === 0 ? null : groups.join(" · ");
}

export function GitHubRoutingSettings({ environments }: { readonly environments: ReadonlyArray<EnvironmentPresentation> }) {
  const permissions = useAtomValue(environmentCatalog.githubRoutingPermissionsValueAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const update = useAtomCommand(environmentCatalog.setGitHubRoutingPermission, { reportFailure: false });
  const [saving, setSaving] = useState(false);
  if (environments.length < 2) return null;
  const { id, title } = searchableSetting("github-routing");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={
        summarizeGitHubRouting(
          environments.map((environment) => ({ label: environment.label, permission: gitHubRoutingPermissionFor(environment.entry, permissions) })),
        ) ?? "Off"
      }
    >
      <Explanation>
        Machines you trust here can read PR data through each other's GitHub access. Enable both machines. Read and act may use broader permissions than the
        machine that owns them. This applies only to this device.
      </Explanation>
      {environments.map((environment) => (
        <EnvironmentRow
          key={environment.environmentId}
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          label={environment.label}
          subtitle={environmentTransportLabel(environment)}
        >
          <SettingsSelect
            size="xs"
            width={144}
            testId={`github-routing-${environment.environmentId}`}
            value={gitHubRoutingPermissionFor(environment.entry, permissions)}
            disabled={!catalog.isReady || saving || gitHubRoutingConnectionKey(environment.entry) === null}
            options={routingOptions}
            onChange={(permission) => {
              setSaving(true);
              void update({ environmentId: environment.environmentId, permission }).then((result) => {
                setSaving(false);
                if (result._tag === "Failure") toast({ type: "error", title: "Could not save GitHub routing permission" });
              });
            }}
          />
        </EnvironmentRow>
      ))}
    </FoldedSettingsSection>
  );
}
