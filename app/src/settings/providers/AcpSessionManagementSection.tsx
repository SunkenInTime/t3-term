// Port of apps/web/src/components/settings/AcpSessionManagementSection.tsx: for an ACP
// registry agent, list the agent's own ("native") sessions per project and import them
// as T3 threads, delete them, log out of the agent, and configure the agent's upstream
// model providers (non-secret routing; headers are write-only).
import { isAtomCommandInterrupted, squashAtomCommandFailure, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthProvidersManageScope,
  type AcpRegistryConfigurableProvider,
  type AcpRegistrySession,
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useState } from "react";

import { requestConfirmDialog } from "../../dialogs/confirmDialog.ts";
import { serverEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironmentScope } from "../../state/settings.ts";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import { SettingsSelect, TextField } from "../controls.tsx";
import { useProviderActionCommand } from "./dryRun.ts";
import { StackedRow } from "./parts.tsx";

export interface AcpSessionProject {
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toast({ type: "error", title, description: error instanceof Error ? error.message : "The ACP operation failed." });
}

function parseProviderHeaders(
  text: string,
): { readonly ok: true; readonly headers: Record<string, string> | undefined } | { readonly ok: false; readonly error: string } {
  if (text.trim().length === 0) return { ok: true, headers: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Headers must be valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !Object.values(parsed).every((value) => typeof value === "string")) {
    return { ok: false, error: "Headers must be a JSON object with string values." };
  }
  return { ok: true, headers: parsed as Record<string, string> };
}

/** `divide-y divide-border/60 border-y border-border/60` */
function RuleList({ children }: { children: ReadonlyArray<React.ReactNode> }) {
  const theme = useTheme();
  const color = alpha(theme.border, 0.6);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", borderTopWidth: 1, borderBottomWidth: 1, borderColor: color }}>
      {children.map((child, index) => (
        <div key={index} style={{ display: "flex", flexDirection: "column", width: "100%", ...(index > 0 ? { borderTopWidth: 1, borderColor: color } : {}) }}>
          {child}
        </div>
      ))}
    </div>
  );
}

export function AcpSessionManagementSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider;
  readonly projects: ReadonlyArray<AcpSessionProject>;
  readonly readOnly: boolean;
}) {
  const theme = useTheme();
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const canRead = useEnvironmentScope(props.environmentId, AuthOrchestrationReadScope);
  const [projectId, setProjectId] = useState<ProjectId | null>(props.projects[0]?.id ?? null);
  const [sessions, setSessions] = useState<ReadonlyArray<AcpRegistrySession>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importingSessionId, setImportingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [providers, setProviders] = useState<ReadonlyArray<AcpRegistryConfigurableProvider>>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<Readonly<Record<string, { apiType: string; baseUrl: string; headers: string }>>>({});
  const listSessions = useAtomCommand(serverEnvironment.listAcpRegistrySessions, { reportFailure: false });
  const importSession = useAtomCommand(serverEnvironment.importAcpRegistrySession, { reportFailure: false });
  const deleteSession = useAtomCommand(serverEnvironment.deleteAcpRegistrySession, { reportFailure: false });
  const listProviders = useAtomCommand(serverEnvironment.listAcpRegistryProviders, { reportFailure: false });
  const setProvider = useAtomCommand(serverEnvironment.setAcpRegistryProvider, { reportFailure: false });
  const disableProvider = useAtomCommand(serverEnvironment.disableAcpRegistryProvider, { reportFailure: false });
  const logout = useProviderActionCommand(serverEnvironment.logoutAcpRegistry, "Log out of ACP agent", { reportFailure: false });
  const canList = props.provider.nativeSessions?.canList === true;
  const canImport = props.provider.nativeSessions?.canLoad === true || props.provider.nativeSessions?.canResume === true;
  const canLogout = props.provider.auth.canLogout === true && !props.provider.setup?.canAuthenticate;
  const canDelete = props.provider.nativeSessions?.canDelete === true;
  const canConfigureProviders = props.provider.configurableProviders === true;
  const projectOperationPending = loading || importingSessionId !== null || deletingSessionId !== null || loadingProviders || savingProviderId !== null;

  if (!canList && !canLogout && !canConfigureProviders) return null;

  const projectOptions = props.projects.map((project) => ({ value: project.id as string, label: project.title }));

  const loadSessions = async (cursor?: string) => {
    if (projectId === null || loading) return;
    setLoading(true);
    const result = await listSessions({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, projectId, ...(cursor === undefined ? {} : { cursor }) },
    });
    setLoading(false);
    if (result._tag === "Success") {
      setSessions((current) => (cursor === undefined ? result.value.sessions : [...current, ...result.value.sessions]));
      setNextCursor(result.value.nextCursor);
      return;
    }
    reportFailure("Could not list ACP sessions", result);
  };

  const importNativeSession = async (session: AcpRegistrySession) => {
    if (!readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope) || projectId === null || importingSessionId !== null) return;
    setImportingSessionId(session.sessionId);
    const result = await importSession({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, projectId, sessionId: session.sessionId, title: session.title, updatedAt: session.updatedAt },
    });
    setImportingSessionId(null);
    if (result._tag === "Success") {
      setSessions((current) =>
        current.map((candidate) => (candidate.sessionId === session.sessionId ? { ...candidate, importedThreadId: result.value.threadId } : candidate)),
      );
      toast({ type: "success", title: result.value.imported ? "ACP session imported" : "ACP session already imported" });
      return;
    }
    reportFailure("Could not import ACP session", result);
  };

  const deleteNativeSession = async (session: AcpRegistrySession) => {
    if (projectId === null || deletingSessionId !== null || session.importedThreadId !== null) return;
    const confirmed = await requestConfirmDialog(`Permanently delete native ACP session "${session.title ?? session.sessionId}"?`, { variant: "destructive" });
    if (!confirmed || !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)) return;
    setDeletingSessionId(session.sessionId);
    const result = await deleteSession({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, projectId, sessionId: session.sessionId },
    });
    setDeletingSessionId(null);
    if (result._tag === "Success") {
      setSessions((current) => current.filter((candidate) => candidate.sessionId !== session.sessionId));
      toast({ type: "success", title: "ACP session deleted" });
      return;
    }
    reportFailure("Could not delete ACP session", result);
  };

  const loadProviders = async () => {
    if (projectId === null || loadingProviders) return;
    setLoadingProviders(true);
    const result = await listProviders({ environmentId: props.environmentId, input: { instanceId: props.instanceId, projectId } });
    setLoadingProviders(false);
    if (result._tag === "Success") {
      setProviders(result.value.providers);
      setProviderDrafts(
        Object.fromEntries(
          result.value.providers.map((provider) => [
            provider.providerId,
            { apiType: provider.current?.apiType ?? provider.supported[0] ?? "", baseUrl: provider.current?.baseUrl ?? "", headers: "" },
          ]),
        ),
      );
      return;
    }
    reportFailure("Could not list ACP providers", result);
  };

  const saveProvider = async (provider: AcpRegistryConfigurableProvider) => {
    if (!readEnvironmentScope(props.environmentId, AuthProvidersManageScope) || projectId === null || savingProviderId !== null) return;
    const draft = providerDrafts[provider.providerId];
    if (draft === undefined || draft.apiType.length === 0 || draft.baseUrl.length === 0) return;
    const parsedHeaders = parseProviderHeaders(draft.headers);
    if (!parsedHeaders.ok) {
      toast({ type: "error", title: "Invalid provider headers", description: parsedHeaders.error });
      return;
    }
    const headers = parsedHeaders.headers;
    setSavingProviderId(provider.providerId);
    const result = await setProvider({
      environmentId: props.environmentId,
      input: {
        instanceId: props.instanceId,
        projectId,
        providerId: provider.providerId,
        apiType: draft.apiType,
        baseUrl: draft.baseUrl,
        ...(headers === undefined ? {} : { headers }),
      },
    });
    setSavingProviderId(null);
    if (result._tag === "Success") {
      toast({ type: "success", title: "ACP provider configured" });
      await loadProviders();
      return;
    }
    reportFailure("Could not configure ACP provider", result);
  };

  const disableConfiguredProvider = async (provider: AcpRegistryConfigurableProvider) => {
    if (projectId === null || savingProviderId !== null || provider.required) return;
    const confirmed = await requestConfirmDialog(`Disable ACP provider "${provider.providerId}"?`, { variant: "destructive" });
    if (!confirmed || !readEnvironmentScope(props.environmentId, AuthProvidersManageScope)) return;
    setSavingProviderId(provider.providerId);
    const result = await disableProvider({ environmentId: props.environmentId, input: { instanceId: props.instanceId, projectId, providerId: provider.providerId } });
    setSavingProviderId(null);
    if (result._tag === "Success") {
      toast({ type: "success", title: "ACP provider disabled" });
      await loadProviders();
      return;
    }
    reportFailure("Could not disable ACP provider", result);
  };

  const logoutProvider = async () => {
    if (loggingOut || !readEnvironmentScope(props.environmentId, AuthProvidersManageScope)) return;
    setLoggingOut(true);
    const result = await logout({ environmentId: props.environmentId, input: { instanceId: props.instanceId } });
    setLoggingOut(false);
    if (result._tag === "Success") {
      setSessions([]);
      setNextCursor(null);
      toast({ type: "success", title: "Logged out of ACP agent" });
      return;
    }
    reportFailure("Could not log out of ACP agent", result);
  };

  const selectProject = (value: string, resetSessions: boolean) => {
    setProjectId(value as ProjectId);
    if (resetSessions) {
      setSessions([]);
      setNextCursor(null);
    }
    setProviders([]);
    setProviderDrafts({});
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: 12 }}>
      <StackedRow
        testId="acp-native-sessions"
        title="Native sessions"
        description="Resume agent-owned conversations as T3 threads."
        status={
          canList && props.projects.length === 0 ? (
            <Text size="xs" color={theme.mutedForeground}>
              Add a project before importing sessions.
            </Text>
          ) : undefined
        }
        control={
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {canLogout ? (
              <Button size="sm" variant="outline" disabled={props.readOnly || loggingOut} onClick={() => void logoutProvider()} testId="acp-logout">
                {loggingOut ? "Logging out" : "Log out"}
              </Button>
            ) : null}
            {canList && props.projects.length > 0 ? (
              <>
                <SettingsSelect
                  testId="acp-sessions-project"
                  width={160}
                  value={projectId ?? ""}
                  disabled={!canRead || projectOperationPending}
                  options={projectOptions}
                  onChange={(value) => selectProject(value, true)}
                />
                <Button size="sm" variant="outline" disabled={!canRead || loading || projectId === null} onClick={() => void loadSessions()} testId="acp-list-sessions">
                  {loading ? "Loading" : sessions.length === 0 ? "List sessions" : "Refresh"}
                </Button>
              </>
            ) : null}
          </div>
        }
      >
        {canList && (sessions.length > 0 || nextCursor !== null) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, paddingBottom: 8 }}>
            {sessions.length > 0 ? (
              <RuleList>
                {sessions.map((session) => (
                  <div key={session.sessionId} style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 8, paddingBottom: 8 }}>
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexShrink: 1 }}>
                      <Text size="xs" truncate>
                        {session.title ?? session.sessionId}
                      </Text>
                      <Text size="3xs" mono color={theme.mutedForeground} truncate>
                        {session.sessionId}
                      </Text>
                    </div>
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        disabled={!canOperate || !canImport || session.importedThreadId !== null || importingSessionId !== null}
                        onClick={() => void importNativeSession(session)}
                      >
                        {session.importedThreadId !== null ? "Imported" : importingSessionId === session.sessionId ? "Importing" : "Import"}
                      </Button>
                      {canDelete ? (
                        <Button
                          size="xs"
                          variant="ghost-muted"
                          disabled={!canOperate || session.importedThreadId !== null || deletingSessionId !== null}
                          onClick={() => void deleteNativeSession(session)}
                        >
                          {deletingSessionId === session.sessionId ? "Deleting" : "Delete"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </RuleList>
            ) : null}
            {nextCursor !== null ? (
              <div style={{ display: "flex", flexDirection: "row" }}>
                <Button size="xs" variant="ghost-muted" disabled={!canRead || loading} onClick={() => void loadSessions(nextCursor)}>
                  {loading ? "Loading" : "Load more"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </StackedRow>

      {canConfigureProviders ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 12,
            paddingBottom: 12,
            borderTopWidth: 1,
            borderColor: alpha(theme.border, 0.6),
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <Text size="xs" weight={500}>
                Agent providers
              </Text>
              <Text size="xs" color={theme.mutedForeground}>
                Configure non-secret routing. Headers are write-only.
              </Text>
            </div>
            <Button size="xs" variant="outline" disabled={!canRead || loadingProviders || projectId === null} onClick={() => void loadProviders()} testId="acp-list-providers">
              {loadingProviders ? "Loading" : providers.length === 0 ? "List providers" : "Refresh"}
            </Button>
          </div>
          {!canList && props.projects.length > 1 ? (
            <SettingsSelect
              size="xs"
              width={192}
              value={projectId ?? ""}
              disabled={!canRead || projectOperationPending}
              options={projectOptions}
              onChange={(value) => selectProject(value, false)}
            />
          ) : null}
          {providers.length > 0 ? (
            <RuleList>
              {providers.map((provider) => {
                const draft = providerDrafts[provider.providerId] ?? {
                  apiType: provider.current?.apiType ?? provider.supported[0] ?? "",
                  baseUrl: provider.current?.baseUrl ?? "",
                  headers: "",
                };
                const updateDraft = (update: Partial<typeof draft>) =>
                  setProviderDrafts((current) => ({ ...current, [provider.providerId]: { ...draft, ...update } }));
                const busy = props.readOnly || savingProviderId !== null;
                return (
                  <div key={provider.providerId} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, paddingBottom: 12 }}>
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <Text size="xs" weight={500} truncate>
                          {provider.providerId}
                        </Text>
                        <Text size="3xs" color={theme.mutedForeground}>
                          {`${provider.current === null ? "Disabled" : "Configured"}${provider.required ? " · Required" : ""}`}
                        </Text>
                      </div>
                      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Button size="xs" variant="outline" disabled={busy || draft.apiType.length === 0 || draft.baseUrl.length === 0} onClick={() => void saveProvider(provider)}>
                          {savingProviderId === provider.providerId ? "Saving" : "Save"}
                        </Button>
                        {!provider.required && provider.current !== null ? (
                          <Button size="xs" variant="ghost-muted" disabled={busy} onClick={() => void disableConfiguredProvider(provider)}>
                            Disable
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
                      <SettingsSelect
                        width={144}
                        value={draft.apiType}
                        disabled={busy}
                        options={provider.supported.map((protocol) => ({ value: protocol, label: protocol }))}
                        onChange={(value) => updateDraft({ apiType: value })}
                      />
                      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                        <TextField width="100%" size="sm" value={draft.baseUrl} placeholder="https://api.example.com" disabled={busy} onChange={(value) => updateDraft({ baseUrl: value })} />
                      </div>
                    </div>
                    <TextField
                      width="100%"
                      size="sm"
                      value={draft.headers}
                      placeholder={'Write-only headers JSON, e.g. {"Authorization":"Bearer …"}'}
                      disabled={busy}
                      onChange={(value) => updateDraft({ headers: value })}
                    />
                  </div>
                );
              })}
            </RuleList>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
