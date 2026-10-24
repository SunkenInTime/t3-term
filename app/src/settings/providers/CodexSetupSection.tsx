// Port of apps/web/src/components/settings/CodexSetupSection.tsx (the settings
// presentation; the onboarding card belongs to the welcome wizard t3-term doesn't have),
// with ChatGptConnectionButton, ChatGptUsageButton, ChatGptAccountPicker and
// AddCodexAccountDialog: a Codex instance whose runtime T3 Code manages and whose
// account is a ChatGPT sign-in.
//
// Differences from web, because t3-term is not a browser page:
//   - There is no page URL to come back to, so sign-in sends no `returnUrl` and the
//     "Use T3 desktop for automatic return" handoff link (built from that URL) is left out.
//   - Web's desktop app receives the OAuth callback itself; t3-term can't, so it behaves
//     like the hosted web app: a loopback server takes the callback (callbackMode
//     "server"), a remote one asks for the redirect URL to be pasted.
//   - Like a browser on the primary machine, a remote environment hands the sign-in to
//     a connected loopback primary environment (the ChatGPT handoff).
// Install, sign-in, reconnect, import and sign-out go through dryRun.ts.
import { useAtomValue } from "@effect/atom-react";
import { isAtomCommandInterrupted, squashAtomCommandFailure, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  type ChatGptHandoffInput,
  type ChatGptTransferredProfile,
  type EnvironmentId,
  type ProviderAuthMethod,
  type ServerProvider,
} from "@t3tools/contracts";
import { isLoopbackHost } from "@t3tools/shared/preview";
import { CHATGPT_USAGE_URL, usesChatGptSharing } from "@t3tools/shared/usageLimits";
import * as Option from "effect/Option";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { environmentSession, serverEnvironment } from "../../state/environment.ts";
import { readEnvironmentScope, useAtomCommand, useEnvironment, useEnvironmentScope, usePrimaryEnvironmentId } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Dialog } from "../../ui/overlay.tsx";
import { Button, Text, type ButtonSize, type ButtonVariant } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { BrandIcon } from "../brandIcons.tsx";
import { TextField } from "../controls.tsx";
import { openExternal } from "../openExternal.ts";
import { useEnvironmentQuery } from "../query.ts";
import { RedactedText } from "../RedactedText.tsx";
import { WizardDialog } from "./AddProviderDialog.tsx";
import { useProviderActionCommand } from "./dryRun.ts";
import { StackedRow } from "./parts.tsx";
import { DividedRows } from "./ProviderSetupSection.tsx";
import { useEnvironmentSettings } from "./state.ts";

export function readCodexSetupMode(config: unknown): "managed" | "existing" {
  return config !== null && typeof config === "object" && "setupMode" in config && config.setupMode === "managed" ? "managed" : "existing";
}

function useEnvironmentHttpBaseUrl(environmentId: EnvironmentId | null): string | null {
  const prepared = useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId ?? ("" as EnvironmentId)));
  return environmentId !== null && Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
}

function isLoopbackUrl(url: string | null): boolean {
  if (url === null) return false;
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

// ── ChatGptConnectionButton.tsx / ChatGptUsageButton.tsx ────────────────

export function ChatGptConnectionButton({
  children,
  size = "default",
  variant = "default",
  disabled,
  onClick,
  testId,
}: {
  children?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const color = variant === "default" ? theme.primaryForeground : theme.foreground;
  return (
    <Button size={size} variant={variant} disabled={disabled} onClick={onClick} testId={testId} leading={<BrandIcon name="openai" size={16} color={color} />}>
      {children ?? "Continue with ChatGPT"}
    </Button>
  );
}

export function ChatGptUsageButton({ size = "sm", variant = "ghost-muted", testId }: { size?: ButtonSize; variant?: ButtonVariant; testId?: string }) {
  return (
    <Button size={size} variant={variant} trailingIcon="external-link" onClick={() => openExternal(CHATGPT_USAGE_URL)} testId={testId ?? "chatgpt-usage"}>
      Manage usage
    </Button>
  );
}

// ── ChatGptAccountPicker.tsx ─────────────────────────────────────────────

export function ChatGptAccountPicker({
  open,
  methods,
  onClose,
  onSelect,
}: {
  open: boolean;
  methods: readonly ProviderAuthMethod[];
  onClose: () => void;
  onSelect: (methodId: string) => void;
}) {
  const theme = useTheme();
  const profiles = methods.filter((method) => method.id.startsWith("chatgpt-profile:"));
  const [selection, setSelection] = useState<string | null>(null);
  const selectedMethodId =
    selection === "chatgpt-change-account"
      ? selection
      : (profiles.find((profile) => profile.id === selection)?.id ?? profiles[0]?.id ?? "chatgpt-change-account");
  const option = (value: string, label: string) => {
    const checked = selectedMethodId === value;
    return (
      <div
        key={value}
        testId={`chatgpt-account-${value}`}
        onClick={() => setSelection(value)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 12,
          paddingBottom: 12,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: theme.border,
          cursor: "pointer",
        }}
      >
        {/* radio-group.tsx: a 16px ring, filled primary with a dot when checked. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            borderRadius: 8,
            borderWidth: checked ? 0 : 1,
            borderColor: theme.input,
            backgroundColor: checked ? theme.primary : "#00000000",
            flexShrink: 0,
          }}
        >
          {checked ? <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.primaryForeground }} /> : null}
        </div>
        <Text weight={500} style={{ flexShrink: 1, minWidth: 0 }}>
          {label}
        </Text>
      </div>
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      testId="chatgpt-account-picker"
      title="Reconnect ChatGPT"
      description="On OpenAI, sign in with the account you choose here."
      footer={<ChatGptConnectionButton testId="chatgpt-account-picker-continue" onClick={() => onSelect(selectedMethodId)} />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {profiles.map((profile) => option(profile.id, profile.name))}
        {option("chatgpt-change-account", "Use a different account")}
      </div>
    </Dialog>
  );
}

// ── AddCodexAccountDialog.tsx ────────────────────────────────────────────

/** web randomUUID (lib/utils.ts) */
function randomUUID(): string {
  return crypto.randomUUID();
}

export function AddCodexAccountDialog({
  environmentId,
  onClose,
  renderSetup,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly renderSetup: (instanceId: ProviderInstanceId, provider: ServerProvider) => ReactNode;
}) {
  const theme = useTheme();
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const settings = useEnvironmentSettings(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.updateSettings, { label: "Add ChatGPT account" });
  const [name, setName] = useState("Personal");
  const displayName = `ChatGPT - ${name.trim()}`;
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const [pending, setPending] = useState(false);
  const provider = providers?.find((candidate) => candidate.instanceId === instanceId);
  const connected = usesChatGptSharing(provider);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (connected) closeRef.current();
  }, [connected]);

  const createAccount = async () => {
    if (pending || !name.trim() || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setPending(true);
    // The ID is routing identity; the name is editable and need not be unique.
    const id = ProviderInstanceId.make(`codex_${randomUUID()}`);
    const result = await update({
      environmentId,
      input: {
        patch: {
          providerInstances: {
            ...settings.providerInstances,
            [id]: { driver: ProviderDriverKind.make("codex"), displayName, enabled: true, config: { enabled: true, setupMode: "managed" } },
          },
        },
      },
    });
    if (result._tag === "Success") setInstanceId(id);
    setPending(false);
  };

  return (
    <WizardDialog
      testId="add-codex-account-dialog"
      onClose={onClose}
      title={instanceId ? displayName : "Add ChatGPT account"}
      description="Each account has its own Codex instance and sign-in. Choose the other account on the sign-in page."
      footer={
        instanceId ? (
          <Button variant="outline" onClick={onClose} testId="add-codex-account-finish-later">
            Finish later
          </Button>
        ) : (
          <>
            <Button variant="outline" disabled={pending} onClick={onClose} testId="add-codex-account-cancel">
              Cancel
            </Button>
            <Button disabled={pending || !name.trim() || !canManageProviders} onClick={() => void createAccount()} testId="add-codex-account-continue">
              {pending ? "Adding account…" : "Continue"}
            </Button>
          </>
        )
      }
    >
      {instanceId ? (
        provider?.setup ? (
          renderSetup(instanceId, provider)
        ) : (
          <StackedRow title="Codex runtime" description="Preparing managed setup." />
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16, paddingTop: 4, paddingBottom: 4 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 }}>
            <Text weight={500}>Account name</Text>
            <Text size="xs" color={alpha(theme.mutedForeground, 0.8)}>
              Shown in the provider list and model picker.
            </Text>
          </div>
          <TextField
            width={240}
            value={name}
            placeholder="e.g. Personal or Work"
            onChange={setName}
            onSubmit={() => void createAccount()}
            testId="add-codex-account-name"
          />
        </div>
      )}
    </WizardDialog>
  );
}

/** CodexSetupSection.tsx AddManagedCodexAccountDialog: the dialog with the sign-in it starts. */
export function AddManagedCodexAccountDialog({ environmentId, onClose }: { readonly environmentId: EnvironmentId; readonly onClose: () => void }) {
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  return (
    <AddCodexAccountDialog
      environmentId={environmentId}
      onClose={onClose}
      renderSetup={(instanceId, provider) => (
        <ManagedCodexSetup
          key={instanceId}
          environmentId={environmentId}
          instanceId={instanceId}
          provider={provider}
          enabled
          readOnly={!canManageProviders}
          autoStart
          onAutoStartConsumed={() => undefined}
          onSignInCancelled={onClose}
        />
      )}
    />
  );
}

// ── CodexSetupSection / ManagedCodexSetup ────────────────────────────────

export function CodexSetupSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly enabled: boolean;
  readonly readOnly: boolean;
}) {
  if (!props.provider?.setup?.canAuthenticate) {
    return <StackedRow title="ChatGPT account" description="Preparing sign-in." />;
  }
  return (
    <ManagedCodexSetup
      key={`${props.environmentId}:${props.instanceId}`}
      {...props}
      autoStart={false}
      onAutoStartConsumed={() => undefined}
    />
  );
}

function ManagedCodexSetup({
  environmentId,
  instanceId,
  provider,
  enabled,
  readOnly,
  autoStart,
  onAutoStartConsumed,
  onSignInCancelled,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly autoStart: boolean;
  readonly onAutoStartConsumed: () => void;
  readonly onSignInCancelled?: () => void;
}) {
  const theme = useTheme();
  const target = useMemo(() => ({ environmentId, input: { instanceId } }), [environmentId, instanceId]);
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const installQuery = useEnvironmentQuery(serverEnvironment.providerInstallState(target));
  const [handoff, setHandoff] = useState<{ environmentId: EnvironmentId; input: ChatGptHandoffInput } | null>(null);
  const handoffQuery = useEnvironmentQuery(handoff ? serverEnvironment.chatGptHandoffState(handoff) : null);
  const auth = handoffQuery.data?.phase === "auth" ? handoffQuery.data.state : authQuery.data;
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [requestedMethodId, setRequestedMethodId] = useState("chatgpt");
  const reconnectEmail = auth?.methods?.find((method) => method.id === "chatgpt")?.accountEmail;
  const requestedAccountEmail = auth?.methods?.find((method) => method.id === requestedMethodId)?.accountEmail;
  const hasSavedAccount = auth?.methods?.some((method) => method.id.startsWith("chatgpt-profile:"));
  const url = auth?.interaction?.type === "browser" ? auth.interaction.url : auth?.authorizationUrl;
  const installation = installQuery.data;
  const local = isLoopbackUrl(useEnvironmentHttpBaseUrl(environmentId));
  const options = { reportFailure: false, reportDefect: false };
  const startAuth = useProviderActionCommand(serverEnvironment.startProviderAuth, "Start ChatGPT sign-in", options);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, options);
  const completeAuth = useProviderActionCommand(serverEnvironment.completeProviderAuth, "Complete ChatGPT sign-in", options);
  const cancelAuth = useProviderActionCommand(serverEnvironment.cancelProviderAuth, "Cancel ChatGPT sign-in", options);
  const logoutAuth = useProviderActionCommand(serverEnvironment.logoutProviderAuth, "Disconnect ChatGPT", options);
  const startInstall = useProviderActionCommand(serverEnvironment.startProviderInstall, "Install Codex runtime", options);
  const cancelInstall = useProviderActionCommand(serverEnvironment.cancelProviderInstall, "Cancel Codex install", options);
  const reconnectProfile = useProviderActionCommand(serverEnvironment.chatGptReconnectProfile, "Reconnect ChatGPT profile", options);
  const importProfile = useProviderActionCommand(serverEnvironment.chatGptImportProfile, "Import ChatGPT profile", options);
  // No desktop bridge receives the callback, so a remote server needs the redirect pasted.
  const clientCallback = !handoff && !local;
  const remoteWeb = clientCallback;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryEnvironment = useEnvironment(primaryEnvironmentId);
  const primaryHttpBaseUrl = useEnvironmentHttpBaseUrl(primaryEnvironmentId);
  const primaryAuthEnvironmentId =
    !local && primaryEnvironmentId && primaryEnvironment?.connection.phase === "connected" && isLoopbackUrl(primaryHttpBaseUrl) ? primaryEnvironmentId : null;
  const needsManualCallback = remoteWeb;
  const [callbackHelpOpen, setCallbackHelpOpen] = useState(false);
  const [callbackDraft, setCallbackDraft] = useState({ flowId: "", value: "" });
  const callbackUrl = callbackDraft.flowId === auth?.flowId ? callbackDraft.value : "";
  const [pending, setPending] = useState(false);
  const [awaitingProvider, setAwaitingProvider] = useState<"sign-in" | "handoff" | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const continueWithSignIn = useRef<string | null>(null);
  const openRequested = useRef(false);
  const openedFlow = useRef<string | null>(null);
  const [autoStartHandled, setAutoStartHandled] = useState(false);
  const installed = installation?.installedVersion != null;
  const authenticated = provider?.auth.status === "authenticated";
  const updateAvailable =
    installed && installation?.source !== "local" && installation?.version != null && installation.version !== installation.installedVersion;
  const finishingSignIn = awaitingProvider !== null && !authenticated && (auth?.phase === "succeeded" || awaitingProvider === "handoff");
  if (awaitingProvider !== null && (authenticated || auth?.phase === "failed" || auth?.phase === "cancelled")) {
    setAwaitingProvider(null);
  }
  useEffect(() => {
    if (awaitingProvider && auth?.phase === "succeeded") void refreshProviders({ environmentId, input: { instanceId } });
  }, [awaitingProvider, auth?.phase, environmentId, instanceId]);
  const startingAutomatically = autoStart && !autoStartHandled;
  const waitingForAuthState = awaitingProvider === "sign-in" && !authenticated && (auth === null || auth.phase === "idle");
  const authInProgress =
    finishingSignIn || waitingForAuthState || handoff !== null || auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const installActive = installation?.phase === "downloading" || installation?.phase === "extracting" || installation?.phase === "verifying";
  const authActive = startingAutomatically || authInProgress || (pending && !installActive);
  const unavailable = readOnly || !enabled || pending || authQuery.error !== null || installQuery.error !== null;
  const busy = pending || authInProgress || installActive;

  const run = async <A, E>(request: () => Promise<AtomCommandResult<A, E>>, onSuccess?: (value: A) => void) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    let succeeded = false;
    try {
      const result = await request();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          setError(failure instanceof Error ? failure.message : "Codex setup failed. Try again.");
        }
      } else {
        succeeded = true;
        onSuccess?.(result.value);
      }
    } catch {
      setError("Codex setup failed. Try again.");
    }
    pendingRef.current = false;
    setPending(false);
    return succeeded;
  };

  const handoffSequence = useRef(0);
  const importedAttempt = useRef<string | null>(null);
  const [transferFailed, setTransferFailed] = useState(false);
  const transferProfile = async (profile: ChatGptTransferredProfile) => {
    const succeeded = await run(() => importProfile({ environmentId, input: { instanceId, profile } }));
    if (succeeded) {
      setAwaitingProvider("handoff");
      setHandoff(null);
    }
    setTransferFailed(!succeeded);
  };
  const transferRef = useRef(transferProfile);
  transferRef.current = transferProfile;
  useEffect(() => {
    if (!handoff || handoffQuery.data?.phase !== "finished") return;
    const attemptId = handoff.input.attemptId;
    if (importedAttempt.current === attemptId) return;
    importedAttempt.current = attemptId;
    void transferRef.current(handoffQuery.data.profile);
  }, [handoff, handoffQuery.data]);
  if (handoff && (handoffQuery.error || (handoffQuery.data?.phase === "auth" && ["failed", "cancelled"].includes(handoffQuery.data.state.phase)))) {
    setError(
      handoffQuery.data?.phase === "auth"
        ? (handoffQuery.data.state.message ?? "ChatGPT sign-in could not finish. Try again.")
        : "ChatGPT sign-in on the primary environment was interrupted. Try again.",
    );
    setHandoff(null);
  }
  const cancelSignIn = () => {
    setAwaitingProvider(null);
    if (handoff) {
      setHandoff(null);
      return Promise.resolve();
    }
    return run(() => cancelAuth({ environmentId, input: { instanceId, flowId: auth!.flowId! } }));
  };

  const signIn = async (methodId = "chatgpt") => {
    if (pendingRef.current) return;
    openRequested.current = true;
    setTransferFailed(false);
    setRequestedMethodId(methodId);
    if (primaryAuthEnvironmentId) {
      const attemptId = `${instanceId}:${++handoffSequence.current}`;
      const succeeded = await run(
        () => reconnectProfile({ environmentId, input: { instanceId, methodId } }),
        (profile) => setHandoff({ environmentId: primaryAuthEnvironmentId, input: { instanceId, environmentId, attemptId, returnUrl: "", profile } }),
      );
      if (!succeeded) openRequested.current = false;
      return;
    }
    if (
      !(await run(
        () => startAuth({ environmentId, input: { instanceId, methodId, callbackMode: clientCallback ? "client" : "server" } }),
        () => setAwaitingProvider("sign-in"),
      ))
    ) {
      openRequested.current = false;
    }
  };

  const setup = async (methodId = "chatgpt") => {
    if (unavailable || busy) return;
    if (installed && !updateAvailable) {
      await signIn(methodId);
    } else {
      continueWithSignIn.current = methodId;
      if (!(await run(() => startInstall({ environmentId, input: { instanceId } })))) continueWithSignIn.current = null;
    }
  };

  if (autoStart && !autoStartHandled && !unavailable && !busy && installation !== null && provider?.setup?.canInstall) {
    setAutoStartHandled(true);
  }
  const setupRef = useRef(setup);
  setupRef.current = setup;
  useEffect(() => {
    if (!autoStartHandled) return;
    onAutoStartConsumed();
    void setupRef.current();
  }, [autoStartHandled]);

  const signInRef = useRef(signIn);
  signInRef.current = signIn;
  useEffect(() => {
    if (!continueWithSignIn.current || pending || installActive) return;
    if (installation?.phase === "failed" || installation?.phase === "cancelled") {
      continueWithSignIn.current = null;
    } else if (installed) {
      const methodId = continueWithSignIn.current;
      continueWithSignIn.current = null;
      void signInRef.current(methodId);
    }
  }, [pending, installActive, installation?.phase, installed]);

  const openPage = (authorizationUrl: string) => openExternal(authorizationUrl);
  useEffect(() => {
    if (!openRequested.current || auth?.phase !== "waiting" || !auth.flowId || !url || openedFlow.current === auth.flowId) return;
    openedFlow.current = auth.flowId;
    openRequested.current = false;
    if (!remoteWeb) openPage(url);
  }, [auth?.phase, auth?.flowId, url, remoteWeb]);

  const runtimeDescription =
    installation?.phase === "downloading"
      ? `Downloading ${(installation.downloadedBytes / 1_000_000).toFixed(1)}${installation.totalBytes === null ? "" : ` of ${(installation.totalBytes / 1_000_000).toFixed(1)}`} MB.`
      : installation?.phase === "extracting"
        ? "Installing Codex."
        : installation?.phase === "verifying"
          ? "Checking Codex."
          : installed
            ? `${installation?.source === "local" ? "Using your installed Codex" : "Managed by T3 Code"}${installation?.installedVersion ? ` · v${installation.installedVersion}` : ""}.`
            : (installation?.message ?? "T3 Code downloads and manages Codex for you.");
  const email = provider?.auth.email?.trim();
  const accountDescription: ReactNode = finishingSignIn ? (
    "Finishing sign-in..."
  ) : installActive ? (
    runtimeDescription
  ) : authActive || auth?.phase === "failed" || auth?.phase === "cancelled" ? (
    auth?.phase === "waiting" && requestedAccountEmail ? (
      `Continue as ${requestedAccountEmail} on OpenAI.`
    ) : (
      (auth?.message ?? "Finish signing in in your browser.")
    )
  ) : authenticated ? (
    email ? (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text size="xs" color={alpha(theme.mutedForeground, 0.8)}>
          Signed in as
        </Text>
        <RedactedText value={email} revealTooltip="Click to reveal email" hideTooltip="Click to hide email" />
      </div>
    ) : (
      "Signed in with ChatGPT."
    )
  ) : (
    (reconnectEmail ?? "Use your ChatGPT subscription.")
  );

  const waitingControl = (
    <Button
      size="sm"
      variant={remoteWeb ? "default" : "outline"}
      testId="chatgpt-open-sign-in"
      disabled={handoffQuery.data?.phase === "finished" ? pending || !transferFailed : !url || auth?.phase !== "waiting"}
      onClick={() => {
        if (handoffQuery.data?.phase === "finished") void transferProfile(handoffQuery.data.profile);
        else if (url) openPage(url);
      }}
    >
      {finishingSignIn
        ? "Finishing sign-in..."
        : handoffQuery.data?.phase === "finished"
          ? transferFailed
            ? "Retry connection"
            : "Finishing sign-in..."
          : auth?.phase === "waiting"
            ? remoteWeb
              ? "Open ChatGPT sign-in"
              : "Open sign-in page"
            : "Signing in..."}
    </Button>
  );
  const callbackCompletion =
    !handoff && auth?.phase === "waiting" && url ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
        <Text size="xs" color={theme.mutedForeground}>
          If sign-in doesn't return to T3 Code, paste the URL from the final localhost page.
        </Text>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
            <TextField
              width="100%"
              secret
              value={callbackUrl}
              placeholder="Paste the URL from the sign-in tab"
              onChange={(value) => setCallbackDraft({ flowId: auth.flowId ?? "", value })}
              testId="chatgpt-callback-url"
            />
          </div>
          <Button
            variant="outline"
            disabled={pending || readOnly || !callbackUrl.trim()}
            onClick={() => {
              if (!auth.flowId || !callbackUrl.trim()) return;
              const value = callbackUrl.trim();
              const submittedFlowId = auth.flowId;
              void run(() => completeAuth({ environmentId, input: { instanceId, flowId: submittedFlowId, callbackUrl: value } })).then((connected) => {
                if (connected) setCallbackDraft({ flowId: submittedFlowId, value: "" });
              });
            }}
          >
            Connect
          </Button>
        </div>
        {!remoteWeb ? (
          <div style={{ display: "flex", flexDirection: "row" }}>
            <Button size="xs" variant="ghost-muted" trailingIcon="external-link" onClick={() => openExternal(url)}>
              Try sign-in in your browser
            </Button>
          </div>
        ) : null}
      </div>
    ) : null;
  const callbackFallback = needsManualCallback ? (
    callbackCompletion
  ) : callbackCompletion ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        testId="chatgpt-sign-in-help"
        onClick={() => setCallbackHelpOpen(!callbackHelpOpen)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, cursor: "pointer" }}
      >
        <Text size="xs" color={theme.mutedForeground}>
          Having trouble signing in?
        </Text>
        <Icon name={callbackHelpOpen ? "chevron-down" : "chevron-right"} size={12} color={theme.mutedForeground} />
      </div>
      {callbackHelpOpen ? (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", paddingTop: 12, borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) }}>
          {callbackCompletion}
        </div>
      ) : null}
    </div>
  ) : null;

  const logoutWarning = auth?.phase === "idle" && auth.message?.startsWith("Signed out locally.") ? auth.message : null;
  const errorText =
    error || authQuery.error || installQuery.error || installation?.phase === "failed"
      ? (error ?? (installation?.phase === "failed" ? installation.message : "Could not read Codex setup status. Reconnect and try again."))
      : null;

  return (
    <>
      <ChatGptAccountPicker
        open={accountPickerOpen}
        methods={auth?.methods ?? []}
        onClose={() => setAccountPickerOpen(false)}
        onSelect={(methodId) => {
          setAccountPickerOpen(false);
          void setup(auth?.methods?.some((method) => method.id === methodId) ? methodId : "chatgpt-change-account");
        }}
      />
      <DividedRows>
        {[
          <StackedRow
            key="account"
            testId="chatgpt-account-row"
            title="ChatGPT account"
            description={
              typeof accountDescription === "string" ? (
                <Text size="xs" color={alpha(theme.mutedForeground, 0.8)} style={{ lineHeight: 18 }}>
                  {accountDescription}
                </Text>
              ) : (
                accountDescription
              )
            }
            control={
              <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                {authActive ? (
                  <>
                    {waitingControl}
                    {!finishingSignIn ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending || readOnly}
                        testId="chatgpt-cancel-sign-in"
                        onClick={() => {
                          if (!handoff && !auth?.flowId) return;
                          openRequested.current = false;
                          void cancelSignIn();
                          onSignInCancelled?.();
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </>
                ) : installActive ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || readOnly}
                    onClick={() => {
                      if (!installation?.operationId) return;
                      continueWithSignIn.current = null;
                      void run(() => cancelInstall({ environmentId, input: { instanceId, operationId: installation.operationId! } }));
                    }}
                  >
                    Cancel
                  </Button>
                ) : authenticated ? (
                  <>
                    <Button size="sm" variant="outline" disabled={unavailable || busy} onClick={() => setAccountPickerOpen(true)} testId="chatgpt-change-account">
                      Change account
                    </Button>
                    <Button size="sm" variant="ghost" disabled={unavailable || busy} onClick={() => void run(() => logoutAuth(target))} testId="chatgpt-disconnect">
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <>
                    <ChatGptConnectionButton
                      size="sm"
                      testId="chatgpt-connect"
                      disabled={unavailable || busy || (!installed ? !provider?.setup?.canInstall : !provider?.setup?.canAuthenticate)}
                      onClick={() => {
                        if (hasSavedAccount) setAccountPickerOpen(true);
                        else void setup();
                      }}
                    >
                      {pending ? "Setting up..." : hasSavedAccount ? "Reconnect account" : "Continue with ChatGPT"}
                    </ChatGptConnectionButton>
                    {hasSavedAccount ? (
                      <Button size="sm" variant="ghost" disabled={unavailable || busy} onClick={() => void setup("chatgpt-change-account")}>
                        Use a different account
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            }
          />,
          authenticated ? (
            <div key="usage" style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 4 }}>
              <ChatGptUsageButton />
            </div>
          ) : null,
          logoutWarning ? (
            <div key="logout" style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
              <Text size="xs" color={theme.mutedForeground}>
                {logoutWarning}
              </Text>
            </div>
          ) : null,
          callbackFallback ? (
            <div key="callback" style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
              {callbackFallback}
            </div>
          ) : null,
          errorText ? (
            <div key="error" style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
              <Text size="xs" color={theme.errorForeground}>
                {errorText}
              </Text>
            </div>
          ) : null,
        ]}
      </DividedRows>
    </>
  );
}

// ── CodexManagedRuntimeFields ────────────────────────────────────────────

export function CodexManagedRuntimeFields({
  environmentId,
  instanceId,
  provider,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
}) {
  const target = useMemo(() => ({ environmentId, input: { instanceId } }), [environmentId, instanceId]);
  const installation = useEnvironmentQuery(serverEnvironment.providerInstallState(target));
  const executablePath = installation.data?.executablePath ?? "";
  const field = (value: string, placeholder: string) => <TextField width="100%" size="sm" value={value} placeholder={placeholder} disabled onChange={() => undefined} />;
  return (
    <DividedRows>
      {[
        <StackedRow key="binary" title="Binary path" description="Selected by T3 Code." control={field(executablePath, installation.error ? "Could not read runtime path" : "Not installed")} />,
        <StackedRow
          key="home"
          title="CODEX_HOME path"
          description="Shared Codex config, sessions, and state."
          control={field(provider?.runtimePaths?.homePath ?? "", "Unavailable")}
        />,
        <StackedRow
          key="shadow"
          title="Shadow home path"
          description={provider?.runtimePaths?.shadowHomePath ? "Account-specific home sharing the Codex state above." : "This instance uses the shared Codex home directly."}
          control={field(provider?.runtimePaths?.shadowHomePath ?? "", provider?.runtimePaths ? "Not used" : "Unavailable")}
        />,
      ]}
    </DividedRows>
  );
}
