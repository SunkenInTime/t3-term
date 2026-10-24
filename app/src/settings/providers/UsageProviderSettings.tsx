// Port of apps/web/src/components/settings/UsageProviderSettings.tsx and
// AddUsageLimitSourceDialog.tsx: the "Usage providers" section (CLIProxyAPI hubs and,
// on macOS hosts, Cursor account usage). gpuix inputs have no password mode, so the
// management key is visible while it is typed; it is never read back afterwards.
import { useAtomValue } from "@effect/atom-react";
import { UsageLimitSourceId, type EnvironmentId, type UnifiedSettings } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { useAtomCommand } from "../../state/settings.ts";
import { Dialog, Switch } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { TextField } from "../controls.tsx";
import { SettingsRow, SettingsSection } from "../layout.tsx";
import { useUpdateEnvironmentSettings } from "./state.ts";

/** Dots and dashes in the host are kept so foo-bar.com and foo.bar.com do not collide. */
function sourceIdFromUrl(url: string): UsageLimitSourceId {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {}
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return UsageLimitSourceId.make(`cliproxy-${slug || "hub"}`);
}

export function UsageProviderSettings({
  environmentId,
  environmentLabel,
  sources,
  cursorKeychainUsageEnabled,
  readOnly,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  sources: UnifiedSettings["usageLimitSources"];
  cursorKeychainUsageEnabled: boolean;
  readOnly: boolean;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const updateCursorSettings = useAtomCommand(serverEnvironment.updateSettings, { label: "update Cursor account usage" });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const platform = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment.platform;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);
  const [updatingCursor, setUpdatingCursor] = useState(false);
  const entries = Object.entries(sources);

  const setCursorUsageEnabled = async (enabled: boolean) => {
    setUpdatingCursor(true);
    const result = await updateCursorSettings({ environmentId, input: { patch: { cursorKeychainUsageEnabled: enabled } } });
    if (result._tag === "Success") await refreshProviders({ environmentId, input: {} });
    setUpdatingCursor(false);
  };

  const { id: searchId, title } = searchableSetting("usage-providers");
  return (
    <>
      <SettingsSection
        id={searchId}
        title={title}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="outline" icon="plus" onClick={() => setAdding(true)} testId="usage-providers-add" style={{ gap: 4 }}>
              Add hub
            </Button>
          ) : null
        }
      >
        {platform?.os === "darwin" ? (
          <SettingsRow
            id="cursor-keychain-usage"
            title="Cursor account usage"
            description="Read your existing Cursor CLI login from macOS Keychain to show account history and monthly limits. macOS may ask you to allow access."
            control={
              <Switch checked={cursorKeychainUsageEnabled} disabled={readOnly || updatingCursor} onChange={(enabled) => void setCursorUsageEnabled(enabled)} />
            }
          />
        ) : null}
        {entries.length === 0 ? (
          <SettingsRow title="No hubs configured." />
        ) : (
          entries.map(([id, source]) => {
            const label = source.label?.trim() || source.url;
            return (
              <SettingsRow
                key={id}
                title={label}
                description={`CLI Proxy${source.enabled ? "" : " · Disabled"}${label !== source.url ? ` · ${source.url}` : ""}`}
                control={
                  !readOnly ? (
                    <Button size="xs" variant="ghost" onClick={() => setRemoving({ id, label })}>
                      Remove
                    </Button>
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {adding && !readOnly ? (
        <AddUsageLimitSourceDialog
          environmentLabel={environmentLabel}
          onClose={() => setAdding(false)}
          onSave={(id, source) => updateSettings({ usageLimitSources: { [id]: source } })}
        />
      ) : null}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.label ?? ""}?`}
        description="The hub's management key is deleted from this server. Its accounts leave the Limits view; the hub itself is untouched. Add it again with the URL and key to bring them back."
        footer={
          <>
            <Button size="sm" variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (removing) updateSettings({ usageLimitSources: { [removing.id]: null } });
                setRemoving(null);
              }}
            >
              Remove hub
            </Button>
          </>
        }
      />
    </>
  );
}

function AddUsageLimitSourceDialog({
  environmentLabel,
  onClose,
  onSave,
}: {
  environmentLabel: string;
  onClose: () => void;
  onSave: (
    id: UsageLimitSourceId,
    source: { kind: "cliproxy"; label?: string; url: string; managementKey: string; enabled: boolean },
  ) => void;
}) {
  const theme = useTheme();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [managementKey, setManagementKey] = useState("");
  const trimmedUrl = url.trim();
  const canSave = trimmedUrl.length > 0 && managementKey.trim().length > 0;
  const save = () => {
    if (!canSave) return;
    onSave(sourceIdFromUrl(trimmedUrl), {
      kind: "cliproxy",
      ...(label.trim() ? { label: label.trim() } : {}),
      url: trimmedUrl,
      managementKey: managementKey.trim(),
      enabled: true,
    });
    onClose();
  };
  const field = (title: string, node: ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Text weight={500} color={theme.foreground}>
        {title}
      </Text>
      {node}
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      width={448}
      testId="usage-source-dialog"
      title="Add a CLIProxyAPI hub"
      description={`Show the quota of every account the hub pools, next to the providers on ${environmentLabel}. The key stays on that server.`}
      footer={
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSave} onClick={save} testId="usage-source-save">
            Add hub
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {field("Hub URL", <TextField testId="usage-source-url" width="100%" placeholder="https://hub.example.ts.net:8318" value={url} onChange={setUrl} />)}
        {field("Management key", <TextField testId="usage-source-key" width="100%" secret value={managementKey} onChange={setManagementKey} />)}
        {field(
          "Label (optional)",
          <TextField testId="usage-source-label" width="100%" placeholder="Defaults to the hub's host name" value={label} onChange={setLabel} />,
        )}
      </div>
    </Dialog>
  );
}
