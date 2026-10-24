// Port of apps/web/src/components/settings/ProviderAuthenticationSection.tsx: the "Account"
// row of a provider's Setup section (sign in, change account, sign out, and the
// browser / device code / credentials / callback steps of a sign-in flow).
// The terminal interaction is ProviderAuthTerminal.tsx: a live terminal you can type into.
// Sign-in commands go through dryRun.ts so screenshots can click them safely.
import { isAtomCommandInterrupted, squashAtomCommandFailure, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderAuthRespondInput, ProviderAuthResponse, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { useMemo, useRef, useState } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { Dialog, Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { SettingsSelect, TextField } from "../controls.tsx";
import { copyText, openExternal } from "../openExternal.ts";
import { useEnvironmentQuery } from "../query.ts";
import { RedactedText } from "../RedactedText.tsx";
import { useDryRunAuthTerminal, useProviderActionCommand } from "./dryRun.ts";
import { StackedRow } from "./parts.tsx";
import { ProviderAuthTerminal } from "./ProviderAuthTerminal.tsx";

const DEFAULT_METHOD = "__default__";

export function ProviderAuthenticationSection({
  environmentId,
  environmentLabel,
  instanceId,
  provider,
  readOnly,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  instanceId: ProviderInstanceId;
  provider: ServerProvider;
  readOnly: boolean;
}) {
  const theme = useTheme();
  const target = useMemo(() => ({ environmentId, input: { instanceId } }), [environmentId, instanceId]);
  const query = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const commands = { reportFailure: false, reportDefect: false };
  const startCommand = useProviderActionCommand(serverEnvironment.startProviderAuth, "Start sign-in", commands);
  const respond = useProviderActionCommand(serverEnvironment.respondProviderAuth, "Respond to sign-in", commands, true);
  const complete = useProviderActionCommand(serverEnvironment.completeProviderAuth, "Complete sign-in", commands);
  const cancelCommand = useProviderActionCommand(serverEnvironment.cancelProviderAuth, "Cancel sign-in", commands);
  const logout = useProviderActionCommand(serverEnvironment.logoutProviderAuth, "Sign out", commands);
  const dryRunTerminal = useDryRunAuthTerminal(instanceId);
  const start: typeof startCommand = (value) => {
    dryRunTerminal?.open();
    return startCommand(value);
  };
  const cancel: typeof cancelCommand = (value) => {
    dryRunTerminal?.close();
    return cancelCommand(value);
  };
  const terminalQueue = useRef<ProviderAuthRespondInput[]>([]);
  const terminalSending = useRef(false);
  const [methodId, setMethodId] = useState("");
  const [draft, setDraft] = useState({ id: "", values: {} as Record<string, string> });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const pendingRef = useRef(false);
  const auth = dryRunTerminal?.auth ?? query.data;
  const interaction = auth?.interaction;
  const active = auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const signedIn = provider.auth.status === "authenticated" || (provider.auth.status === "unknown" && auth?.phase === "succeeded");
  const isDiscovering = provider.driver === "acpRegistry" && !active && !signedIn && !query.error && auth?.methods === undefined;
  const needsExternalSetup =
    !active && !signedIn && (provider.setup?.canAuthenticate === false || (provider.driver === "acpRegistry" && auth?.methods?.length === 0));
  const accountDescription = active
    ? auth?.phase === "starting"
      ? "Starting sign-in…"
      : auth?.phase === "verifying"
        ? "Checking your account…"
        : interaction?.type === "terminal"
          ? "Complete sign-in in the terminal below."
          : interaction?.type === "credentials"
            ? "Enter your credentials below."
            : "Finish signing in in your browser."
    : signedIn
      ? "Signed in."
      : isDiscovering
        ? "Discovering sign-in methods…"
        : needsExternalSetup
          ? "No in-app sign-in advertised. Follow the provider's docs to finish setup."
          : `Sign in on ${environmentLabel}.`;
  const statusMessage = auth?.phase === "failed" ? auth.message : null;
  const disabled = readOnly || pending || query.error !== null || isDiscovering;
  const draftId = `${auth?.flowId ?? ""}:${interaction?.id ?? ""}`;
  const values = draft.id === draftId ? draft.values : {};
  const url = interaction?.type === "browser" || interaction?.type === "deviceCode" ? interaction.url : auth?.authorizationUrl;

  async function run(command: () => Promise<AtomCommandResult<unknown, unknown>>) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    let succeeded = false;
    try {
      const result = await command();
      if (result._tag === "Success") succeeded = true;
      else if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Provider sign-in failed. Try again.");
      }
    } catch {
      setError("Provider sign-in failed. Try again.");
    }
    pendingRef.current = false;
    setPending(false);
    return succeeded;
  }

  async function send(response: ProviderAuthResponse) {
    if (!auth?.flowId || !interaction) return false;
    return run(() => respond({ environmentId, input: { instanceId, flowId: auth.flowId!, interactionId: interaction.id, response } }));
  }

  async function openBrowser() {
    if (!url || readOnly) return;
    const requiresConsent = interaction?.type === "browser" && interaction.requiresConsent;
    if (requiresConsent && !(await send({ type: "browser", action: "accept" }))) return;
    openExternal(url);
    setError(null);
  }

  const updateDraft = (name: string, value: string) => setDraft({ id: draftId, values: { ...values, [name]: value } });
  const methods = auth?.methods ?? [];
  const email = provider.auth.email?.trim();

  const control = (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {!active && methods.length > 1 ? (
        <SettingsSelect
          testId="provider-auth-method"
          value={methods.some((method) => method.id === methodId) ? methodId : DEFAULT_METHOD}
          width={176}
          disabled={disabled}
          options={[{ value: DEFAULT_METHOD, label: "Provider default" }, ...methods.map((method) => ({ value: method.id, label: method.name }))]}
          onChange={(value) => setMethodId(value === DEFAULT_METHOD ? "" : value)}
        />
      ) : null}
      {url ? (
        <>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => void openBrowser()} testId="provider-auth-open-browser">
            Open browser
          </Button>
          <Tooltip content="Copy sign-in link" side="top">
            <IconButton
              icon="copy"
              size={28}
              iconSize={16}
              disabled={disabled}
              onClick={() => {
                if (!copyText(url)) return setError("Could not copy the sign-in link.");
                if (interaction?.type === "browser" && interaction.requiresConsent) void send({ type: "browser", action: "accept" });
              }}
            />
          </Tooltip>
        </>
      ) : null}
      {needsExternalSetup && provider.setup?.documentationUrl ? (
        <Button size="sm" variant="outline" onClick={() => openExternal(provider.setup!.documentationUrl!)}>
          Open docs
        </Button>
      ) : active && auth?.flowId ? (
        <Button
          size="sm"
          variant="ghost-muted"
          disabled={disabled}
          testId="provider-auth-cancel"
          onClick={() => void run(() => cancel({ environmentId, input: { instanceId, flowId: auth.flowId! } }))}
        >
          Cancel
        </Button>
      ) : !active && !needsExternalSetup && provider.setup?.canAuthenticate !== false ? (
        <Button
          size="sm"
          variant="outline"
          testId="provider-auth-start"
          disabled={disabled || !provider.enabled || !provider.installed || !auth}
          onClick={() =>
            void run(() =>
              start({
                environmentId,
                input: { instanceId, ...(methodId && methods.some((method) => method.id === methodId) ? { methodId } : {}) },
              }),
            )
          }
        >
          {signedIn ? "Change account" : auth?.phase === "failed" || auth?.phase === "cancelled" ? "Retry sign-in" : "Sign in"}
        </Button>
      ) : null}
      {!active && signedIn && (provider.auth.canLogout ?? provider.setup?.canAuthenticate) ? (
        <Button size="sm" variant="ghost" disabled={disabled || !auth} onClick={() => setConfirmingLogout(true)} testId="provider-auth-logout">
          Sign out
        </Button>
      ) : null}
    </div>
  );

  const hasBody =
    interaction?.type === "terminal" ||
    interaction?.type === "credentials" ||
    interaction?.type === "deviceCode" ||
    (url && (interaction?.type === "browser" ? interaction.acceptsCallback : !interaction)) ||
    error ||
    query.error;

  return (
    <>
      <StackedRow
        testId="provider-auth-row"
        title="Account"
        description={
          signedIn && !active && email ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text size="xs" color={alpha(theme.mutedForeground, 0.8)}>
                Signed in as
              </Text>
              <RedactedText value={email} revealTooltip="Click to reveal email" hideTooltip="Click to hide email" />
            </div>
          ) : (
            <Text size="xs" color={alpha(theme.mutedForeground, 0.8)} style={{ lineHeight: 18 }}>
              {accountDescription}
            </Text>
          )
        }
        status={
          statusMessage ? (
            <Text size="xs" color={theme.mutedForeground}>
              {statusMessage}
            </Text>
          ) : undefined
        }
        control={control}
      >
        {hasBody ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {interaction?.type === "deviceCode" ? (
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 8, paddingBottom: 8 }}>
                <Text color={theme.mutedForeground}>Enter code</Text>
                <Text mono>{interaction.userCode}</Text>
                <Text color={theme.mutedForeground}>in your browser.</Text>
              </div>
            ) : null}
            {interaction?.type === "terminal" ? (
              <div style={{ display: "flex", flexDirection: "column", paddingTop: 8, paddingBottom: 8 }}>
                <ProviderAuthTerminal
                  key={`${auth?.flowId}:${interaction.id}`}
                  testId="provider-auth-terminal"
                  output={interaction.output}
                  outputOffset={interaction.outputOffset}
                  onResponse={(response) => {
                    if (readOnly || !auth?.flowId) return;
                    if (response.data.length > 0) dryRunTerminal?.echo(response.data);
                    // The server takes at most 4096 characters per response, in order.
                    for (let offset = 0; offset < Math.max(1, response.data.length); offset += 4_096) {
                      terminalQueue.current.push({
                        instanceId,
                        flowId: auth.flowId,
                        interactionId: interaction.id,
                        response: { ...response, data: response.data.slice(offset, offset + 4_096) },
                      });
                    }
                    if (terminalSending.current) return;
                    terminalSending.current = true;
                    void (async () => {
                      while (terminalQueue.current.length > 0) {
                        const input = terminalQueue.current.shift()!;
                        const result = await respond({ environmentId, input });
                        if (result._tag !== "Success") {
                          terminalQueue.current = [];
                          if (!isAtomCommandInterrupted(result)) setError("The provider sign-in terminal is no longer available.");
                          break;
                        }
                      }
                    })()
                      .catch(() => {
                        terminalQueue.current = [];
                        setError("Could not send input to the provider sign-in terminal.");
                      })
                      .finally(() => {
                        terminalSending.current = false;
                      });
                  }}
                />
              </div>
            ) : null}
            {interaction?.type === "credentials" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, paddingBottom: 8 }}>
                {interaction.fields.map((field) => (
                  <div key={field.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <Text>{field.label}</Text>
                    <TextField size="sm" value={values[field.name] ?? ""} disabled={disabled} onChange={(value) => updateDraft(field.name, value)} />
                  </div>
                ))}
                <div style={{ display: "flex", flexDirection: "row" }}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void send({ type: "credentials", values }).then((sent) => {
                        if (sent) setDraft({ id: "", values: {} });
                      })
                    }
                  >
                    Connect
                  </Button>
                </div>
              </div>
            ) : null}
            {url && (interaction?.type === "browser" ? interaction.acceptsCallback : !interaction) ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, paddingBottom: 8 }}>
                <Text>If the final localhost page does not load, paste its full URL here.</Text>
                <TextField size="sm" value={values.callback ?? ""} disabled={disabled} onChange={(value) => updateDraft("callback", value)} />
                <div style={{ display: "flex", flexDirection: "row" }}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || !values.callback?.trim()}
                    onClick={() => {
                      if (!auth?.flowId || !values.callback?.trim()) return;
                      void run(() => complete({ environmentId, input: { instanceId, flowId: auth.flowId!, callbackUrl: values.callback! } })).then(
                        (sent) => {
                          if (sent) setDraft({ id: "", values: {} });
                        },
                      );
                    }}
                  >
                    Continue
                  </Button>
                </div>
              </div>
            ) : null}
            {error || query.error ? (
              <Text size="xs" color={theme.errorForeground} style={{ paddingTop: 8, paddingBottom: 8 }}>
                {error ?? query.error ?? ""}
              </Text>
            ) : null}
          </div>
        ) : null}
      </StackedRow>
      <Dialog
        open={confirmingLogout}
        onOpenChange={setConfirmingLogout}
        title={`Sign out of ${provider.displayName ?? provider.driver}?`}
        description={`This stops running threads on ${environmentLabel} that share this sign-in. Thread history is kept.`}
        footer={
          <>
            <Button size="sm" variant="outline" onClick={() => setConfirmingLogout(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setConfirmingLogout(false);
                void run(() => logout(target));
              }}
            >
              Sign out
            </Button>
          </>
        }
      />
    </>
  );
}
