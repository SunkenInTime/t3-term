// Ports of apps/web/src/components/settings/{GitHubTokenSettings,GitHubAccountSettings,
// SourceControlHostSettings}.tsx (+ GitHubAccountSettings.logic.ts).
import type { SourceControlClientDefinition } from "@t3tools/client-runtime/source-control-clients";
import { readGitHubSettings, type GitHubSettings } from "@t3tools/client-runtime/source-control-clients";
import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_SERVER_SETTINGS, type EnvironmentId, type SourceControlProviderAuth } from "@t3tools/contracts";
import { useState } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { useAtomCommand } from "../../state/settings.ts";
import { Switch } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { InlineButton, SettingsSelect, TextField } from "../controls.tsx";
import { openExternal } from "../openExternal.ts";
import { ProviderSettingsForm } from "../ProviderSettingsForm.tsx";
import { RedactedText } from "../RedactedText.tsx";

function useEnvironmentServerSettings(environmentId: EnvironmentId) {
  return useAtomValue(serverEnvironment.configValueAtom(environmentId))?.settings ?? DEFAULT_SERVER_SETTINGS;
}

/** `<code>` chip used inline in descriptions. */
export function InlineCode({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", paddingLeft: 4, paddingRight: 4, borderRadius: 4, backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.06) : theme.muted }}>
      <Text size="2xs" mono color={theme.mutedForeground}>
        {children}
      </Text>
    </div>
  );
}

const DEFAULT_HOST = "github.com";

export function GitHubTokenSettings({ environmentId, onSaved }: { environmentId: EnvironmentId; onSaved: () => void }) {
  const theme = useTheme();
  const { tokens } = readGitHubSettings(useEnvironmentServerSettings(environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { label: "save GitHub token" });
  const [host, setHost] = useState(DEFAULT_HOST);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const normalizedHost = host.trim().toLowerCase();
  const isSaved = (tokens[normalizedHost] ?? "").length > 0;
  const savedHosts = Object.entries(tokens)
    .filter(([, value]) => value.length > 0)
    .map(([saved]) => saved);
  const save = async (target: string, token: string) => {
    setSaving(true);
    const result = await updateSettings({
      environmentId,
      // The map travels whole: every other saved token as its redaction marker, which keeps it.
      input: { patch: { sourceControlHosts: { github: { tokens: { ...tokens, [target]: token } } } } },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setDraft("");
      onSaved();
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: saving ? 0.64 : 1 }}>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 4, rowGap: 2, maxWidth: 672 }}>
        <Text size="xs" color={theme.mutedForeground}>
          A token saved here is used before
        </Text>
        <InlineCode>GH_TOKEN</InlineCode>
        <Text size="xs" color={theme.mutedForeground}>
          and the
        </Text>
        <InlineCode>gh</InlineCode>
        <Text size="xs" color={theme.mutedForeground}>
          login, so GitHub works without the GitHub CLI. Give it read and write access to pull requests and contents.
        </Text>
        <InlineButton size="xs" trailingIcon="external-link" onClick={() => openExternal(`https://${normalizedHost || DEFAULT_HOST}/settings/personal-access-tokens/new`)}>
          Create a token
        </InlineButton>
      </div>
      <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 192 }}>
          <Text size="xs" weight={500}>
            Host
          </Text>
          <TextField size="sm" width="100%" value={host} placeholder={DEFAULT_HOST} onChange={setHost} testId={`github-token-host-${environmentId}`} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1 }}>
          <Text size="xs" weight={500}>
            Token
          </Text>
          <TextField
            size="sm"
            width="100%"
            secret
            value={draft}
            placeholder={isSaved ? "Stored secret, enter a new value to replace" : "Not set"}
            onChange={setDraft}
            onSubmit={() => {
              if (normalizedHost && draft.trim()) void save(normalizedHost, draft.trim());
            }}
            testId={`github-token-${environmentId}`}
          />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text size="xs" color={theme.mutedForeground}>
          {savedHosts.length === 0 ? "No token saved; the server uses GH_TOKEN or the gh login." : `Saved for ${savedHosts.join(", ")}.`}
        </Text>
        <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          {isSaved ? (
            <Button size="xs" variant="outline" disabled={saving} onClick={() => void save(normalizedHost, "")}>
              Remove
            </Button>
          ) : null}
          <Button size="xs" disabled={!normalizedHost || !draft.trim() || saving} onClick={() => void save(normalizedHost, draft.trim())}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// GitHubAccountSettings.logic.ts
type GitHubDiscoveredAccount = NonNullable<SourceControlProviderAuth["accounts"]>[number];

interface GitHubHostGroup {
  readonly host: string;
  readonly activeAccount: string | null;
  readonly selectable: ReadonlyArray<string>;
  readonly broken: ReadonlyArray<GitHubDiscoveredAccount>;
  readonly environmentVariable: string | null;
}

function groupGitHubAccounts(accounts: ReadonlyArray<GitHubDiscoveredAccount>): ReadonlyArray<GitHubHostGroup> {
  const hosts = [...new Set(accounts.map((entry) => entry.host))];
  return hosts.map((host) => {
    const entries = accounts.filter((entry) => entry.host === host);
    const stored = entries.filter((entry) => entry.environmentVariable === undefined);
    const selectable = stored.filter((entry) => entry.authenticated);
    return {
      host,
      activeAccount: (selectable.find((entry) => entry.active) ?? selectable[0])?.account ?? null,
      selectable: selectable.map((entry) => entry.account),
      broken: stored.filter((entry) => !entry.authenticated),
      environmentVariable: entries.find((entry) => entry.environmentVariable)?.environmentVariable ?? null,
    };
  });
}

function nextGitHubHosts(
  current: GitHubSettings["hosts"],
  host: string,
  change: { readonly enabled?: boolean; readonly account?: string | null },
): GitHubSettings["hosts"] {
  const previous = current[host];
  const enabled = change.enabled ?? previous?.enabled ?? true;
  const account = change.account === undefined ? previous?.account : (change.account ?? undefined);
  const { [host]: _replaced, ...rest } = current;
  if (enabled && account === undefined) return rest;
  return { ...rest, [host]: { enabled, ...(account === undefined ? {} : { account }) } };
}

const ACTIVE_ACCOUNT = "active gh account";

export function GitHubAccountSettings({
  environmentId,
  auth,
  onSaved,
}: {
  environmentId: EnvironmentId;
  auth: SourceControlProviderAuth;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const hosts = readGitHubSettings(useEnvironmentServerSettings(environmentId)).hosts;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { label: "save GitHub account settings" });
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const groups = groupGitHubAccounts(auth.accounts ?? []);
  const save = async (host: string, change: { readonly enabled?: boolean; readonly account?: string | null }) => {
    setSaving(true);
    const result = await updateSettings({
      environmentId,
      input: { patch: { sourceControlHosts: { github: { hosts: nextGitHubHosts(hosts, host, change) } } } },
    });
    setSaving(false);
    if (result._tag === "Success") onSaved();
  };
  if (groups.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <Text size="xs" color={theme.mutedForeground}>
          Sign in with
        </Text>
        <InlineCode>gh auth login</InlineCode>
        <Text size="xs" color={theme.mutedForeground}>
          on the server host, then rescan to choose accounts here.
        </Text>
      </div>
    );
  }
  const loginLabel = (account: string) => (revealed ? account : null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text size="xs" color={theme.mutedForeground}>
            Choose which
          </Text>
          <InlineCode>gh</InlineCode>
          <Text size="xs" color={theme.mutedForeground}>
            login each GitHub host uses, or turn a host off.
          </Text>
        </div>
        <IconButton icon={revealed ? "eye-off" : "eye"} size={24} iconSize={14} onClick={() => setRevealed(!revealed)} testId="github-accounts-reveal" />
      </div>
      {groups.map((group) => {
        const choice = hosts[group.host];
        const enabled = choice?.enabled ?? true;
        const stalePin = choice?.account !== undefined && !group.selectable.includes(choice.account);
        const pinned = choice?.account !== undefined && !stalePin ? choice.account : ACTIVE_ACCOUNT;
        return (
          <div key={group.host} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <Text size="xs" weight={500}>
                  {group.host}
                </Text>
                {group.selectable.length === 1 && group.selectable[0] !== undefined ? (
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Text size="xs" color={theme.mutedForeground}>
                      Signed in as
                    </Text>
                    <RedactedText value={group.selectable[0]} revealed={revealed} />
                  </div>
                ) : null}
              </div>
              <Switch checked={enabled} disabled={saving} onChange={(checked) => void save(group.host, { enabled: checked })} />
            </div>
            {group.selectable.length > 1 ? (
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <Text size="xs" color={theme.mutedForeground}>
                  Account
                </Text>
                <SettingsSelect
                  width={256}
                  value={pinned}
                  disabled={saving || !enabled}
                  options={[
                    {
                      value: ACTIVE_ACCOUNT,
                      label: `Active gh account${group.activeAccount ? ` (${loginLabel(group.activeAccount) ?? "hidden"})` : ""}`,
                    },
                    ...group.selectable.map((account, index) => ({ value: account, label: loginLabel(account) ?? `Account ${index + 1}` })),
                  ]}
                  onChange={(value) => void save(group.host, { account: value === ACTIVE_ACCOUNT ? null : value })}
                />
              </div>
            ) : null}
            {stalePin ? (
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <Text size="xs" color={theme.warningForeground}>
                  The chosen login is no longer signed in, so the active gh login is used.
                </Text>
                <Button size="xs" variant="outline" disabled={saving} onClick={() => void save(group.host, { account: null })}>
                  Use active login
                </Button>
              </div>
            ) : null}
            {group.broken.map((entry) => (
              <div key={entry.account} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <RedactedText value={entry.account} revealed={revealed} />
                <Text size="xs" color={alpha(theme.mutedForeground, 0.7)}>
                  {`can't be used: ${entry.error ?? "gh reports this login as invalid."}`}
                </Text>
              </div>
            ))}
            {group.environmentVariable ? (
              <Text size="xs" color={theme.warningForeground}>
                {`${group.environmentVariable} is set on the server, so it overrides the account chosen here until it is unset.`}
              </Text>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function SourceControlHostSettings({
  environmentId,
  definition,
  onSaved,
}: {
  environmentId: EnvironmentId;
  definition: SourceControlClientDefinition & { readonly settings: NonNullable<SourceControlClientDefinition["settings"]> };
  onSaved: () => void;
}) {
  const settings = useEnvironmentServerSettings(environmentId);
  const saved = settings.sourceControlHosts[definition.kind] as Record<string, unknown> | undefined;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { label: `save ${definition.label} settings` });
  const [saving, setSaving] = useState(false);
  const hasSaved = Object.values(saved ?? {}).some((value) => value !== "");
  const save = async (fields: Record<string, unknown>) => {
    setSaving(true);
    const result = await updateSettings({ environmentId, input: { patch: { sourceControlHosts: { [definition.kind]: fields } } } });
    setSaving(false);
    if (result._tag === "Success") onSaved();
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", opacity: saving ? 0.64 : 1, ...(saving ? { pointerEvents: "none" } : {}) }}>
      <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.lg }}>
        <ProviderSettingsForm
          definition={{ settingsSchema: definition.settings as never }}
          value={saved ?? {}}
          idPrefix={`source-control-${definition.kind}`}
          variant="settings"
          onChange={(next) => {
            const fields = next ?? {};
            const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => saved?.[key] !== value));
            const cleared = Object.keys(saved ?? {}).filter((key) => !(key in fields));
            void save({ ...changed, ...Object.fromEntries(cleared.map((key) => [key, ""])) });
          }}
        />
      </div>
      {hasSaved ? (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", paddingTop: 8 }}>
          <Button size="xs" variant="outline" onClick={() => void save(Object.fromEntries(Object.keys(saved ?? {}).map((key) => [key, ""])))}>
            Remove
          </Button>
        </div>
      ) : null}
    </div>
  );
}
