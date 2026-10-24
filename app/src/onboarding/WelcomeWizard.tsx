// Port of apps/web/src/components/onboarding/WelcomeWizard.tsx: first-run setup
// in three steps. Connect picks the computers to set up (and pairs another),
// Agents gets Codex and Claude Code ready on each, Projects imports the projects
// and conversations Claude Code and Codex already have there.
//
// Differences from web:
//   - T3 Connect sign-in is out of scope, so the T3 Connect option is left out
//     (web shows it only when the build has cloud config).
//   - Codex's ChatGPT sign-in in the Agents step reuses Settings' CodexSetupSection
//     (settings presentation) inside the onboarding card once "Continue with
//     ChatGPT" switches the instance to a managed runtime; web restyles that flow
//     as an onboarding card. The ready / existing-CLI card is web's.
//   - Commands that change a provider (the Codex setup mode, the install and
//     sign-in terminal) go through settings/providers/dryRun.ts, so
//     T3TERM_DRY_RUN_PROVIDER_ACTIONS=1 proves the wiring without running them.
//   - No spinner (T3 forbids continuously repainting animations): a static loader
//     glyph stands in.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  defaultInstanceIdForDriver,
  type AgentSessionProjectCandidate,
  type EnvironmentId,
  type ProviderInstanceId,
  type ScopedProjectRef,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ProviderInstanceIcon } from "../chat/composer/ProviderInstanceIcon.tsx";
import { Checkbox } from "../chat/details/formControls.tsx";
import { registerPairing } from "../connect/bootstrap.ts";
import { CommandLine, ErrorAlert, TextField } from "../connect/StandalonePage.tsx";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { openExternal } from "../settings/openExternal.ts";
import { AddManagedCodexAccountDialog, ChatGptConnectionButton, CodexSetupSection, readCodexSetupMode } from "../settings/providers/CodexSetupSection.tsx";
import { useProviderActionCommand } from "../settings/providers/dryRun.ts";
import { RedactedText } from "../settings/RedactedText.tsx";
import { environmentProjects, projectEnvironment, serverEnvironment } from "../state/environment.ts";
import { agentSessionImport } from "../state/onboarding.ts";
import {
  readEnvironmentScope,
  useAtomCommand,
  useEnvironments,
  useEnvironmentScope,
  useEnvironmentsWithScope,
  usePrimaryEnvironment,
  type EnvironmentPresentation,
} from "../state/settings.ts";
import { terminalEnvironment } from "../state/terminal.ts";
import { TerminalView } from "../terminal/TerminalView.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Button, Text } from "../ui/primitives.tsx";
import { toast, dismissToast, updateToast } from "../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { getProviderSummary } from "../web/components/settings/providerStatus.ts";
import { buildProviderInstanceUpdatePatch } from "../web/components/settings/SettingsPanels.logic.ts";
import { completeOnboarding } from "../web/onboarding/firstRun.ts";
import {
  groupOnboardingProjects,
  onboardingProjectKey,
  partitionOnboardingProjects,
  resolveOnboardingLandingProject,
  resolveOnboardingProjectId,
  splitOnboardingProjectPath,
  type OnboardingProjectGroup,
} from "../web/onboarding/projectImport.logic.ts";
import {
  getOnboardingProviderState,
  resolveOnboardingProviderInstallCommand,
  resolveOnboardingProviderLoginCommand,
  selectOnboardingProvidersByDriver,
} from "../web/onboarding/providerReadiness.logic.ts";
import { resolveOnboardingSetup } from "../web/onboarding/targetEnvironment.logic.ts";
import { useProjectScans } from "../web/onboarding/useProjectScans.ts";
import { formatRelativeTime } from "../web/timestampFormat.ts";
import { WizardHeader, WizardPanel, WizardPopup, WizardSteps } from "./wizard.tsx";

type WizardStep = "connection" | "agents" | "import";
const NO_ENVIRONMENTS: readonly EnvironmentId[] = [];

const AGENT_ONBOARDING_THREAD_ID = ThreadId.make("onboarding-agent-setup");
const ONBOARDING_STAGES = ["Connect", "Agents", "Projects"] as const;
const SCAN_LIMIT_MESSAGE = "Scan limit reached. Some projects or conversations may be missing.";
const PRIVACY_POLICY_URL = "https://t3.codes/privacy";

export function WelcomeWizard({
  onDone,
  resumeEnvironmentId,
}: {
  readonly resumeEnvironmentId?: EnvironmentId | undefined;
  readonly onDone: (projectRef?: ScopedProjectRef) => void | Promise<void>;
}) {
  const [step, setStep] = useState<WizardStep>(resumeEnvironmentId ? "agents" : "connection");
  const { environments } = useEnvironments();
  const [selection, setSelection] = useState<ReadonlySet<EnvironmentId> | null>(null);
  // One registry for the wizard's lifetime, so a computer is auto-selected once
  // even after the user unchecks it.
  const [autoSelectedComputers] = useState(() => new Set<EnvironmentId>());
  const [setupIds, setSetupIds] = useState<readonly EnvironmentId[]>(resumeEnvironmentId ? [resumeEnvironmentId] : []);
  const [isImporting, setIsImporting] = useState(false);
  const finishingPromiseRef = useRef<Promise<boolean> | null>(null);
  const completionErrorToastIdRef = useRef<number | null>(null);
  const primaryEnvironment = usePrimaryEnvironment();
  useEffect(() => {
    const newComputers = environments.filter((environment) => !autoSelectedComputers.has(environment.environmentId));
    if (newComputers.length === 0) return;
    for (const environment of newComputers) autoSelectedComputers.add(environment.environmentId);
    const enabledComputers = newComputers.filter((environment) => environment.entry.enabled);
    if (enabledComputers.length === 0) return;
    setSelection((current) => new Set([...(current ?? []), ...enabledComputers.map((environment) => environment.environmentId)]));
  }, [autoSelectedComputers, environments]);
  const selectedIds = selection ?? new Set(primaryEnvironment ? [primaryEnvironment.environmentId] : []);
  const scans = useProjectScans(step === "import" ? setupIds : NO_ENVIRONMENTS);
  const startSetup = (ids: readonly EnvironmentId[]) => {
    if (ids.length === 0) return;
    setSetupIds(ids);
    setStep("agents");
  };
  const stageIndex = step === "agents" ? 1 : step === "import" ? 2 : 0;
  const finish = (projectRef?: ScopedProjectRef, importWarning?: string, importedThreadCount = 0) => {
    if (finishingPromiseRef.current !== null) return finishingPromiseRef.current;
    if (completionErrorToastIdRef.current !== null) {
      dismissToast(completionErrorToastIdRef.current);
      completionErrorToastIdRef.current = null;
    }
    const completion = completeOnboarding()
      .then(async () => {
        if (completionErrorToastIdRef.current !== null) {
          dismissToast(completionErrorToastIdRef.current);
          completionErrorToastIdRef.current = null;
        }
        await onDone(projectRef);
        if (importWarning) {
          toast({ type: "warning", title: "Some history was not imported", description: importWarning, duration: 0 });
        } else if (importedThreadCount > 0) {
          toast({ type: "success", title: `Imported ${importedThreadCount} ${importedThreadCount === 1 ? "thread" : "threads"}` });
        }
        return true;
      })
      .catch(() => {
        const errorToast = {
          type: "error",
          title: "Could not finish setup",
          description: "Your settings could not be saved. Try again.",
        } as const;
        if (completionErrorToastIdRef.current === null) completionErrorToastIdRef.current = toast(errorToast);
        else updateToast(completionErrorToastIdRef.current, errorToast);
        return false;
      })
      .finally(() => {
        if (finishingPromiseRef.current === completion) finishingPromiseRef.current = null;
      });
    finishingPromiseRef.current = completion;
    return completion;
  };

  return (
    <WizardPopup testId="welcome-wizard" closeDisabled={isImporting} onClosePress={() => void finish()}>
      <WizardHeader>
        <WizardSteps
          steps={ONBOARDING_STAGES}
          currentStep={stageIndex}
          isStepDisabled={(index) => isImporting || index >= stageIndex}
          onStepChange={(index) => {
            if (isImporting || index > stageIndex) return;
            setStep(index === 0 ? "connection" : "agents");
          }}
        />
      </WizardHeader>
      <WizardPanel>
        {step === "connection" ? (
          <ConnectionStep
            selectedIds={selectedIds}
            onSelectionChange={setSelection}
            onContinue={() => startSetup(resolveOnboardingSetup(environments, selectedIds).environmentIds)}
            onPaired={(environmentId) => setSelection(new Set([...selectedIds, environmentId]))}
          />
        ) : step === "agents" ? (
          <AgentsStep environmentIds={setupIds} onContinue={() => setStep("import")} />
        ) : (
          <ImportStep scans={scans} isImporting={isImporting} setIsImporting={setIsImporting} onDone={finish} />
        )}
      </WizardPanel>
    </WizardPopup>
  );
}

// ── Connect ─────────────────────────────────────────────────────────────

/** cloudEnvironmentConnectionPresentation.ts presentSavedCloudEnvironmentConnection().buttonLabel */
function connectionLabel(phase: EnvironmentPresentation["connection"]["phase"]): string {
  switch (phase) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "unsupported":
      return "Client not supported";
    case "error":
      return "Connection failed";
    case "offline":
      return "Offline";
    default:
      return "Not connected";
  }
}

function ConnectionStep({
  selectedIds,
  onSelectionChange,
  onContinue,
  onPaired,
}: {
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId>) => void;
  readonly onContinue: () => void;
  readonly onPaired: (environmentId: EnvironmentId) => void;
}) {
  const theme = useTheme();
  const { environments } = useEnvironments();
  const [pairingOpen, setPairingOpen] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const { ready, skippedIds } = resolveOnboardingSetup(environments, selectedIds);
  const skippedLabels = environments
    .filter((environment) => skippedIds.includes(environment.environmentId))
    .map((environment) => environment.label);
  return (
    <>
      <StepTitle>Connect your computers</StepTitle>
      <StepDescription>Choose one or more computers. We’ll set up agents and projects on each.</StepDescription>
      {environments.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
          {environments.map((environment) => {
            const checked = selectedIds.has(environment.environmentId);
            const toggle = () => {
              const next = new Set(selectedIds);
              if (checked) next.delete(environment.environmentId);
              else next.add(environment.environmentId);
              onSelectionChange(next);
            };
            return (
              <div
                key={environment.environmentId}
                testId={`welcome-computer-${environment.environmentId}`}
                onClick={toggle}
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
                  backgroundColor: theme.background,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", pointerEvents: "none" }}>
                  <Checkbox checked={checked} onChange={() => undefined} />
                </div>
                <Icon name="monitor" size={16} color={theme.mutedForeground} />
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, pointerEvents: "none" }}>
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
                    <Text weight={500} style={{ minWidth: 0 }}>
                      {environment.label}
                    </Text>
                    <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
                      {!environment.entry.enabled && environment.connection.phase !== "unsupported"
                        ? "Off"
                        : connectionLabel(environment.connection.phase)}
                    </Text>
                  </div>
                  {environment.displayUrl ? (
                    <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 2 }}>
                      {environment.displayUrl}
                    </Text>
                  ) : null}
                  {environment.connection.phase === "unsupported" && environment.connection.error ? (
                    <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 2 }}>
                      {environment.connection.error}
                    </Text>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 16,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.background,
        }}
      >
        <div
          testId="welcome-add-computer"
          onClick={isPairing ? undefined : () => setPairingOpen((open) => !open)}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 28,
            paddingLeft: 8,
            paddingRight: 10,
            borderRadius: RADIUS.lg,
            cursor: isPairing ? "default" : "pointer",
            ...(isPairing ? {} : { hover: { backgroundColor: theme.accent } }),
          }}
        >
          <Icon name="link" size={16} color={theme.mutedForeground} />
          <Text weight={500} style={{ flexGrow: 1 }}>
            Add a computer
          </Text>
          <Icon name={pairingOpen ? "chevron-down" : "chevron-right"} size={16} color={theme.mutedForeground} />
        </div>
        {pairingOpen ? (
          <div style={{ display: "flex", flexDirection: "column", paddingLeft: 12, paddingRight: 12, paddingBottom: 12 }}>
            <PairingForm
              isPairing={isPairing}
              setIsPairing={setIsPairing}
              onPaired={(environmentId) => {
                setPairingOpen(false);
                onPaired(environmentId);
              }}
            />
          </div>
        ) : null}
      </div>
      {skippedLabels.length > 0 ? (
        <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 16 }}>
          {`Not connected, so setup skips ${skippedLabels.join(", ")}. You can set ${skippedLabels.length === 1 ? "it" : "them"} up later from Settings.`}
        </Text>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 24, marginTop: 24 }}>
        <PrivacyNotice />
        <Button
          testId="welcome-continue"
          disabled={!ready || isPairing}
          trailingIcon="arrow-right"
          onClick={onContinue}
          style={{ alignSelf: "flex-end" }}
        >
          Continue
        </Button>
      </div>
    </>
  );
}

const PRIVACY_WORDS =
  "T3 Code collects anonymous usage data to help us improve it. To read more about how your data is used and how to opt out, see our".split(" ");

/** The usage-data sentence; one inline link, so its words wrap as separate runs. */
function PrivacyNotice() {
  const theme = useTheme();
  const word = { color: theme.mutedForeground, fontSize: 12, lineHeight: 19.5, fontFamily: FONTS.sans, marginRight: 3 } as const;
  return (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
      {PRIVACY_WORDS.map((text, index) => (
        <text key={index} style={word}>
          {text}
        </text>
      ))}
      <text
        testId="welcome-privacy-policy"
        onClick={() => openExternal(PRIVACY_POLICY_URL)}
        style={{ ...word, marginRight: 0, textDecoration: "underline", cursor: "pointer", hover: { color: theme.foreground } }}
      >
        privacy policy
      </text>
      <text style={word}>.</text>
    </div>
  );
}

function PairingForm({
  isPairing,
  setIsPairing,
  onPaired,
}: {
  readonly isPairing: boolean;
  readonly setIsPairing: (value: boolean) => void;
  readonly onPaired: (environmentId: EnvironmentId) => void;
}) {
  const theme = useTheme();
  const [pairingUrl, setPairingUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async () => {
    if (isPairing || pairingUrl.trim().length === 0) return;
    setIsPairing(true);
    setErrorMessage("");
    const result = await runAtomCommand(appAtomRegistry, registerPairing, { pairingUrl: pairingUrl.trim() });
    if (!mountedRef.current) return;
    setIsPairing(false);
    if (result._tag === "Success") {
      onPaired(result.value);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const cause = squashAtomCommandFailure(result);
    setErrorMessage(cause instanceof Error ? cause.message : "Pairing failed.");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <TextField
        label="Pairing link"
        testId="onboarding-pairing-url"
        autoFocus
        value={pairingUrl}
        placeholder="https://your-server:5230/pair#token=…"
        disabled={isPairing}
        onChange={setPairingUrl}
        onSubmit={() => void submit()}
      />
      {errorMessage ? <ErrorAlert>{errorMessage}</ErrorAlert> : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div
          testId="onboarding-pairing-help"
          onClick={() => setHelpOpen((open) => !open)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, cursor: "pointer" }}
        >
          <Icon name={helpOpen ? "chevron-down" : "chevron-right"} size={14} color={theme.mutedForeground} />
          <Text color={theme.mutedForeground}>Need a pairing link?</Text>
        </div>
        <Button testId="onboarding-pair" disabled={isPairing || pairingUrl.trim().length === 0} onClick={() => void submit()}>
          {isPairing ? "Pairing..." : "Pair"}
        </Button>
      </div>
      {helpOpen ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Text color={theme.mutedForeground}>Run this on the computer with your code.</Text>
          <CommandLine command="npx t3 pair" style={{ marginTop: 8 }} />
          <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 8, lineHeight: 19.5 }}>
            Start T3 Code first, or run npx t3 serve. Add --tailscale to use your tailnet.
          </Text>
        </div>
      ) : null}
    </div>
  );
}

// ── Agents ──────────────────────────────────────────────────────────────

const PRIMARY_AGENT_DRIVERS = ["codex", "claudeAgent"] as const;
type OnboardingAgentDriver = (typeof PRIMARY_AGENT_DRIVERS)[number];

interface AgentTerminalSession {
  readonly environmentId: EnvironmentId;
  readonly driver: OnboardingAgentDriver;
  readonly providerInstanceId: ServerProvider["instanceId"];
  readonly cwd: string;
  readonly command: string;
}

function AgentsStep({
  environmentIds,
  onContinue,
}: {
  readonly environmentIds: readonly EnvironmentId[];
  readonly onContinue: () => void;
}) {
  const { environments } = useEnvironments();
  return (
    <>
      <StepTitle>Connect your agents</StepTitle>
      <StepDescription>Choose an agent to start coding. You can add more later.</StepDescription>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 20, maxHeight: 512, overflowY: "scroll", paddingRight: 12 }}>
        {environmentIds.map((environmentId) => (
          <ConnectedAgentsStep
            key={environmentId}
            environmentId={environmentId}
            machineLabel={environments.find((environment) => environment.environmentId === environmentId)?.label ?? "Computer"}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", marginTop: 24 }}>
        <Button testId="welcome-continue" trailingIcon="arrow-right" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </>
  );
}

function ConnectedAgentsStep({ environmentId, machineLabel }: { readonly environmentId: EnvironmentId; readonly machineLabel: string }) {
  const theme = useTheme();
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const [terminalSession, setTerminalSession] = useState<AgentTerminalSession | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);

  useEffect(() => {
    void refreshProviders({ environmentId, input: {} });
  }, [environmentId]);

  const byDriver = selectOnboardingProvidersByDriver(providers);
  const primaryAgents = PRIMARY_AGENT_DRIVERS.flatMap((driver) => {
    const instances = driver === "codex" ? providers?.filter((provider) => provider.driver === driver) : undefined;
    return instances?.length
      ? instances.map((provider) => ({ driver, provider, instanceId: provider.instanceId }))
      : [{ driver, provider: byDriver.get(driver), instanceId: byDriver.get(driver)?.instanceId }];
  });
  const openTerminal = (driver: OnboardingAgentDriver, provider: ServerProvider | undefined) => {
    if (provider === undefined || serverConfig === null || !readEnvironmentScope(environmentId, AuthTerminalOperateScope)) return;
    setTerminalSession({
      environmentId,
      driver,
      providerInstanceId: provider.instanceId,
      cwd: serverConfig.cwd,
      command: provider.installed
        ? resolveOnboardingProviderLoginCommand(provider, serverConfig.settings, serverConfig.environment.platform.os)
        : resolveOnboardingProviderInstallCommand(driver, serverConfig.environment.platform.os),
    });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Text weight={500} style={{ marginBottom: 8 }}>
        {machineLabel}
      </Text>
      {!canOperateTerminal ? (
        <Text color={theme.mutedForeground} style={{ marginBottom: 8 }}>
          This connection cannot control terminals.
        </Text>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {primaryAgents.map(({ driver, provider, instanceId }) =>
          driver === "codex" && serverConfig !== null ? (
            <OnboardingCodexSetup
              key={instanceId ?? driver}
              environmentId={environmentId}
              provider={provider}
              serverConfig={serverConfig}
              terminalOpen={terminalSession?.driver === driver}
              onOpenTerminal={() => openTerminal(driver, provider)}
            />
          ) : (
            <AgentCard
              key={driver}
              driver={driver}
              provider={provider}
              terminalOpen={terminalSession?.driver === driver}
              terminalAvailable={serverConfig !== null && canOperateTerminal}
              onOpenTerminal={() => openTerminal(driver, provider)}
            />
          ),
        )}
      </div>
      {providers?.some((provider) => provider.driver === "codex" && getOnboardingProviderState(provider) === "ready") ? (
        <div style={{ display: "flex", flexDirection: "row", marginTop: 12 }}>
          <Button testId="welcome-add-chatgpt-account" size="xs" variant="ghost-muted" onClick={() => setAddingAccount(true)}>
            Connect another ChatGPT account
          </Button>
        </div>
      ) : null}
      {addingAccount ? <AddManagedCodexAccountDialog environmentId={environmentId} onClose={() => setAddingAccount(false)} /> : null}
      {terminalSession !== null ? (
        <AgentInstallTerminal
          key={`${terminalSession.environmentId}:${terminalSession.providerInstanceId}:${terminalSession.driver}`}
          session={terminalSession}
          onClose={() => {
            setTerminalSession(null);
            void refreshProviders({ environmentId, input: {} });
          }}
        />
      ) : null}
    </div>
  );
}

function ReadyBadge() {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name="check" size={14} color={theme.successForeground} />
      <Text size="xs" weight={500} color={theme.successForeground}>
        Ready
      </Text>
    </div>
  );
}

function AgentCardFrame({ icon, title, description, control }: { icon: ReactNode; title: string; description: ReactNode; control: ReactNode }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 16,
        paddingBottom: 16,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.background,
      }}
    >
      {icon}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <Text weight={500}>{title}</Text>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>{description}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function Muted({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 19.5 }}>
      {children}
    </Text>
  );
}

/**
 * OnboardingCodexSetup with web CodexSetupSection's `presentation="onboarding"`
 * card for an instance on its existing CLI: Ready, Checking, or the two ways to
 * set it up. A managed instance (after "Continue with ChatGPT") shows Settings'
 * ChatGPT sign-in inside the card.
 */
function OnboardingCodexSetup({
  environmentId,
  provider,
  serverConfig,
  terminalOpen,
  onOpenTerminal,
}: {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider | undefined;
  readonly serverConfig: ServerConfig;
  readonly terminalOpen: boolean;
  readonly onOpenTerminal: () => void;
}) {
  const theme = useTheme();
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const update = useProviderActionCommand(serverEnvironment.updateSettings, "Codex setup mode", { reportFailure: false });
  const instanceId = provider?.instanceId ?? defaultInstanceIdForDriver(ProviderDriverKind.make("codex"));
  const settings = serverConfig.settings;
  const instance = settings.providerInstances[instanceId] ?? { driver: ProviderDriverKind.make("codex"), config: {} };
  const mode = readCodexSetupMode(instance.config);
  const existingChosen =
    mode === "existing" &&
    instance.config !== null &&
    typeof instance.config === "object" &&
    "setupMode" in instance.config &&
    instance.config.setupMode === "existing";
  const changeMode = (setupMode: "managed" | "existing") => {
    void update({
      environmentId,
      input: {
        patch: buildProviderInstanceUpdatePatch({
          settings,
          instanceId: instanceId as ProviderInstanceId,
          instance: {
            ...instance,
            enabled: true,
            config: {
              ...(instance.config !== null && typeof instance.config === "object" ? instance.config : {}),
              enabled: true,
              setupMode,
            },
          },
        }),
      },
    });
  };
  if (existingChosen) {
    return (
      <AgentCard driver="codex" provider={provider} terminalOpen={terminalOpen} terminalAvailable={canOperateTerminal} onOpenTerminal={onOpenTerminal} />
    );
  }
  const title = provider?.displayName || "Codex";
  const icon = <ProviderInstanceIcon driverKind={ProviderDriverKind.make("codex")} displayName={title} size={20} />;
  if (mode === "managed") {
    return (
      <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background, paddingLeft: 4, paddingRight: 4 }}>
        <CodexSetupSection environmentId={environmentId} instanceId={instanceId} provider={provider} enabled={provider?.enabled ?? true} readOnly={false} />
      </div>
    );
  }
  const state = getOnboardingProviderState(provider);
  const ready = (provider?.enabled ?? true) && state === "ready";
  const authenticated = provider?.auth.status === "authenticated";
  const checking = state === "checking";
  const summary = getProviderSummary(provider);
  const email = provider?.auth.email?.trim();
  return (
    <AgentCardFrame
      icon={icon}
      title={title}
      description={
        ready ? (
          email ? (
            <>
              <Muted>Signed in as</Muted>
              <div style={{ display: "flex", marginLeft: 4, marginRight: 1 }}>
                <RedactedText value={email} revealTooltip="Click to reveal email" hideTooltip="Click to hide email" />
              </div>
              <Muted>.</Muted>
            </>
          ) : (
            <Muted>Connected with your Codex CLI.</Muted>
          )
        ) : checking ? (
          <Muted>Checking your Codex CLI...</Muted>
        ) : provider?.installed ? (
          <Muted>{summary.headline}</Muted>
        ) : (
          <Muted>Code with your ChatGPT subscription.</Muted>
        )
      }
      control={
        ready ? (
          <ReadyBadge />
        ) : checking ? (
          <Muted>Checking...</Muted>
        ) : authenticated ? (
          <Muted>{summary.headline}</Muted>
        ) : (
          <>
            <Button testId="welcome-codex-existing" size="sm" variant="ghost-muted" onClick={() => changeMode("existing")}>
              Use existing CLI
            </Button>
            <ChatGptConnectionButton testId="welcome-codex-chatgpt" size="sm" onClick={() => changeMode("managed")}>
              Continue with ChatGPT
            </ChatGptConnectionButton>
          </>
        )
      }
    />
  );
}

function AgentCard({
  driver,
  provider,
  terminalOpen,
  terminalAvailable,
  onOpenTerminal,
}: {
  readonly driver: OnboardingAgentDriver;
  readonly provider: ServerProvider | undefined;
  readonly terminalOpen: boolean;
  readonly terminalAvailable: boolean;
  readonly onOpenTerminal: () => void;
}) {
  const displayName = provider?.displayName || (driver === "claudeAgent" ? "Claude Code" : "Codex");
  const summary = getProviderSummary(provider);
  const providerState = getOnboardingProviderState(provider);
  return (
    <AgentCardFrame
      icon={<ProviderInstanceIcon driverKind={ProviderDriverKind.make(driver)} displayName={displayName} size={20} />}
      title={displayName}
      description={
        <Muted>{`${providerState === "ready" ? "Ready to code." : summary.headline}${providerState !== "ready" && summary.detail ? ` · ${summary.detail}` : ""}`}</Muted>
      }
      control={
        providerState === "ready" ? (
          <ReadyBadge />
        ) : providerState === "checking" ? (
          <Muted>Checking...</Muted>
        ) : providerState === "disabled" ? (
          <Muted>Disabled</Muted>
        ) : providerState === "attention" ? (
          <Muted>{summary.headline}</Muted>
        ) : (
          <Button
            testId={`welcome-agent-${driver}-${providerState === "signIn" ? "sign-in" : "install"}`}
            size="xs"
            variant="ghost"
            icon="terminal"
            disabled={terminalOpen || !terminalAvailable}
            onClick={onOpenTerminal}
          >
            {providerState === "signIn" ? "Sign in" : "Install"}
          </Button>
        )
      }
    />
  );
}

/**
 * A terminal on the server with the install or login command typed in but not
 * run: the user reviews it and presses Enter. Closing it closes the PTY.
 */
function AgentInstallTerminal({ session, onClose }: { readonly session: AgentTerminalSession; readonly onClose: () => void }) {
  const theme = useTheme();
  const { command, cwd, driver, environmentId, providerInstanceId } = session;
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const openTerminal = useProviderActionCommand(terminalEnvironment.open, `Open ${driver} setup terminal`, { reportFailure: false });
  const writeTerminal = useProviderActionCommand(terminalEnvironment.write, `Type ${driver} setup command`, { reportFailure: false }, true);
  const closeTerminal = useProviderActionCommand(terminalEnvironment.close, `Close ${driver} setup terminal`, { reportFailure: false }, true);
  const setupQueueRef = useRef(Promise.resolve());
  const setupGenerationRef = useRef(0);
  const activeSetupGenerationRef = useRef<number | null>(null);
  const [terminalId] = useState(() => `onboarding-${driver}-${crypto.randomUUID()}`);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [setupState, setSetupState] = useState<"preparing" | "ready" | "openFailed" | "writeFailed">("preparing");
  const terminalReady = setupState === "ready" || setupState === "writeFailed";

  // A canceled open can finish after the replacement setup starts; it must not
  // close or pre-type into the replacement session that shares this terminal id.
  useEffect(() => {
    const generation = setupGenerationRef.current + 1;
    setupGenerationRef.current = generation;
    activeSetupGenerationRef.current = generation;
    setSetupState("preparing");
    setupQueueRef.current = setupQueueRef.current.then(async () => {
      if (activeSetupGenerationRef.current !== generation) return;
      if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        setSetupState("openFailed");
        return;
      }
      const opened = await openTerminal({
        environmentId,
        input: { threadId: AGENT_ONBOARDING_THREAD_ID, terminalId, cwd, providerInstanceId },
      });
      if (opened._tag !== "Success") {
        if (activeSetupGenerationRef.current === generation) setSetupState("openFailed");
        return;
      }
      if (activeSetupGenerationRef.current !== generation) return;
      if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        setSetupState("writeFailed");
        return;
      }
      const wrote = await writeTerminal({
        environmentId,
        input: { threadId: AGENT_ONBOARDING_THREAD_ID, terminalId, data: command },
      });
      if (activeSetupGenerationRef.current !== generation) return;
      setSetupState(wrote._tag === "Success" ? "ready" : "writeFailed");
    });
    // Close the PTY only while this connection still has terminal access;
    // revocation leaves it running.
    return () => {
      if (activeSetupGenerationRef.current === generation) activeSetupGenerationRef.current = null;
      setupQueueRef.current = setupQueueRef.current.then(async () => {
        if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) return;
        await closeTerminal({
          environmentId,
          input: { threadId: AGENT_ONBOARDING_THREAD_ID, terminalId, deleteHistory: true },
        });
      });
    };
  }, [command, cwd, environmentId, providerInstanceId, setupAttempt, terminalId]);

  const status = !canOperateTerminal
    ? "This connection cannot control terminals."
    : setupState === "writeFailed"
      ? `Run ${command} in this terminal.`
      : setupState === "ready"
        ? "Review the command, then press Enter to run it."
        : setupState === "openFailed"
          ? "Could not open the setup terminal."
          : "Preparing command...";
  return (
    <div
      testId="welcome-agent-terminal"
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 16,
        overflow: "hidden",
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.7),
        backgroundColor: theme.background,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 6,
          paddingBottom: 6,
          borderBottomWidth: 1,
          borderColor: alpha(theme.border, 0.6),
          backgroundColor: alpha(theme.background, 0.6),
        }}
      >
        <Text size="2xs" weight={500} color={theme.mutedForeground}>
          {status}
        </Text>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          {setupState === "openFailed" ? (
            <Button
              testId="welcome-agent-terminal-retry"
              size="xs"
              variant="ghost"
              disabled={!canOperateTerminal}
              onClick={() => {
                if (readEnvironmentScope(environmentId, AuthTerminalOperateScope)) setSetupAttempt((value) => value + 1);
              }}
            >
              Retry
            </Button>
          ) : null}
          <Button testId="welcome-agent-terminal-close" size="xs" variant="ghost-muted" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", height: 256 }}>
        {terminalReady ? (
          <TerminalView
            environmentId={environmentId}
            threadId={AGENT_ONBOARDING_THREAD_ID}
            terminalId={terminalId}
            cwd={cwd}
            autoFocus
            focusRequestId={1}
            onSessionExited={onClose}
          />
        ) : null}
      </div>
    </div>
  );
}

// ── Projects ────────────────────────────────────────────────────────────

const IMPORT_PERMISSION_MESSAGE = "This connection cannot import projects or thread history.";

type ImportCandidate = AgentSessionProjectCandidate & {
  readonly environmentId: EnvironmentId;
  readonly key: string;
};

function ImportStep({
  scans,
  isImporting,
  setIsImporting,
  onDone,
}: {
  readonly scans: ReturnType<typeof useProjectScans>;
  readonly isImporting: boolean;
  readonly setIsImporting: (value: boolean) => void;
  readonly onDone: (projectRef?: ScopedProjectRef, importWarning?: string, importedThreadCount?: number) => Promise<boolean>;
}) {
  const theme = useTheme();
  const { environments } = useEnvironments();
  const writableEnvironments = useEnvironmentsWithScope(scans, AuthOrchestrationOperateScope);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const importThreads = useAtomCommand(agentSessionImport, { reportFailure: false });
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string> | null>(null);
  const importWarningRef = useRef("");
  const importedThreadCountRef = useRef(0);
  const [landingProject, setLandingProject] = useState<ScopedProjectRef | null>(null);
  const importedProjectsRef = useRef(new Map<string, ScopedProjectRef>());
  const projectsWithImportedHistoryRef = useRef(new Map<string, ScopedProjectRef>());
  const lastImportSelectionRef = useRef<ReadonlyArray<string>>([]);
  const projectAttemptsRef = useRef(new Map<string, { readonly projectId: ProjectId; readonly commandId: CommandId }>());
  const importGenerationRef = useRef(0);

  useEffect(() => {
    importGenerationRef.current += 1;
    return () => {
      importGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (
      landingProject !== null &&
      projects.some((project) => project.id === landingProject.projectId && project.environmentId === landingProject.environmentId)
    ) {
      setLandingProject(null);
      void onDone(landingProject, importWarningRef.current, importedThreadCountRef.current).then((completed) => {
        if (!completed) setIsImporting(false);
      });
    }
  }, [landingProject, projects]);

  const { available: candidates, recent } = partitionOnboardingProjects(
    scans.flatMap((scan) =>
      (scan.data?.candidates ?? []).map((candidate) => ({
        ...candidate,
        environmentId: scan.environmentId,
        key: onboardingProjectKey(scan.environmentId, candidate.path),
      })),
    ),
  );
  const selectedKeys = selectedPaths ?? new Set(recent.map((candidate) => candidate.key));
  const selected = candidates.filter((candidate) => selectedKeys.has(candidate.key));
  const canImport = selected.every((candidate) => writableEnvironments.has(candidate.environmentId));
  const [importError, setImportError] = useState("");
  const visibleImportError = !canImport ? IMPORT_PERMISSION_MESSAGE : importError === IMPORT_PERMISSION_MESSAGE ? "" : importError;

  const finishAfterImport = () => {
    const projectRef = resolveOnboardingLandingProject(
      lastImportSelectionRef.current,
      projectsWithImportedHistoryRef.current,
      importedProjectsRef.current,
    );
    if (projectRef === undefined) {
      void onDone(undefined, importWarningRef.current, importedThreadCountRef.current);
      return;
    }
    setIsImporting(true);
    setLandingProject(projectRef);
  };

  const runImport = async (selection: typeof candidates) => {
    if (isImporting) return;
    const hasAccess = () =>
      selection.every((candidate) => readEnvironmentScope(candidate.environmentId, AuthOrchestrationOperateScope));
    const stopForDeniedAccess = () => {
      setIsImporting(false);
      setImportError(IMPORT_PERMISSION_MESSAGE);
    };
    if (!hasAccess()) {
      stopForDeniedAccess();
      return;
    }
    if (selection.length === 0) {
      void onDone();
      return;
    }
    setIsImporting(true);
    importWarningRef.current = "";
    importedThreadCountRef.current = 0;
    lastImportSelectionRef.current = selection.map((candidate) => candidate.key);
    const importGeneration = importGenerationRef.current;
    const importedProjects = importedProjectsRef.current;
    const projectAttempts = projectAttemptsRef.current;
    let importedProjectsCount =
      importedProjects.size > 0 ? selection.filter((candidate) => importedProjects.has(candidate.key)).length : 0;
    let importedThreadCount = 0;
    let skippedThreadCount = 0;
    const refreshEnvironments = new Set<EnvironmentId>();
    for (const candidate of selection) {
      const { environmentId } = candidate;
      if (importGeneration !== importGenerationRef.current || importedProjects !== importedProjectsRef.current) return;
      if (!hasAccess()) {
        stopForDeniedAccess();
        return;
      }
      if (importedProjects.has(candidate.key)) continue;
      let projectId = resolveOnboardingProjectId(appAtomRegistry.get(environmentProjects.projectsAtom), environmentId, candidate);
      if (projectId === null) {
        let attempt = projectAttempts.get(candidate.key);
        if (attempt === undefined) {
          const nextProjectId = ProjectId.make(crypto.randomUUID());
          attempt = { projectId: nextProjectId, commandId: CommandId.make(`onboarding:project:create:${nextProjectId}`) };
          projectAttempts.set(candidate.key, attempt);
        }
        projectId = attempt.projectId;
        const result = await createProject({
          environmentId,
          input: {
            projectId,
            commandId: attempt.commandId,
            title: candidate.title,
            workspaceRoot: candidate.path,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (importGeneration !== importGenerationRef.current || importedProjects !== importedProjectsRef.current) return;
        if (result._tag !== "Success") {
          if (!isAtomCommandInterrupted(result)) {
            projectAttempts.delete(candidate.key);
            refreshEnvironments.add(environmentId);
          }
          continue;
        }
      }
      if (!hasAccess()) {
        stopForDeniedAccess();
        return;
      }
      const threadImportResult = await importThreads({
        environmentId,
        input: { projectId, expectedWorkspaceRoot: candidate.path },
      });
      if (importGeneration !== importGenerationRef.current || importedProjects !== importedProjectsRef.current) return;
      if (threadImportResult._tag === "Success") {
        importedThreadCount += threadImportResult.value.importedCount;
        skippedThreadCount += threadImportResult.value.skippedCount;
        if (threadImportResult.value.importedCount > 0) {
          projectsWithImportedHistoryRef.current.set(candidate.key, scopeProjectRef(environmentId, projectId));
        }
        if (threadImportResult.value.skippedCount === 0) {
          importedProjectsCount += 1;
          importedProjects.set(candidate.key, scopeProjectRef(environmentId, projectId));
        }
      } else if (!isAtomCommandInterrupted(threadImportResult)) {
        projectAttempts.delete(candidate.key);
        refreshEnvironments.add(environmentId);
      }
    }
    for (const scan of scans) {
      if (refreshEnvironments.has(scan.environmentId)) scan.refresh();
    }
    setIsImporting(false);
    importedThreadCountRef.current = importedThreadCount;
    if (importedProjectsCount < selection.length) {
      if (importedThreadCount > 0 && skippedThreadCount > 0) {
        importWarningRef.current = `Imported ${importedThreadCount} ${importedThreadCount === 1 ? "thread" : "threads"}. ${skippedThreadCount} ${skippedThreadCount === 1 ? "thread" : "threads"} could not be imported.`;
      } else if (skippedThreadCount > 0) {
        importWarningRef.current = `${skippedThreadCount} ${skippedThreadCount === 1 ? "thread could" : "threads could"} not be imported.`;
      } else if (importedThreadCount > 0) {
        importWarningRef.current = `Imported ${importedThreadCount} ${importedThreadCount === 1 ? "thread" : "threads"}. Some thread history could not be imported.`;
      } else {
        importWarningRef.current = "Could not import thread history.";
      }
    }
    finishAfterImport();
  };

  if (scans.every((scan) => scan.data === null) && scans.some((scan) => scan.isPending)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: 300 }}>
        <StepTitle>Your projects</StepTitle>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, flexGrow: 1, paddingTop: 24, paddingBottom: 24 }}>
          <Icon name="loader-circle" size={20} color={theme.mutedForeground} />
          <Text color={theme.mutedForeground} style={{ textAlign: "center" }}>
            Looking for projects from Claude Code and Codex…
          </Text>
        </div>
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end" }}>
          <Button testId="welcome-skip-import" variant="ghost-muted" onClick={() => void onDone()}>
            Do not import projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <StepTitle>Import your projects</StepTitle>
      <StepDescription>Import projects and conversations from Claude Code and Codex on your selected computers.</StepDescription>
      {candidates.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 20 }}>
          <Text size="xs" color={theme.mutedForeground} testId="welcome-import-count">
            {`${selected.length} of ${candidates.length} selected`}
          </Text>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Button
              testId="welcome-select-all"
              variant="ghost"
              size="xs"
              disabled={isImporting || selected.length === candidates.length}
              onClick={() => setSelectedPaths(new Set(candidates.map((item) => item.key)))}
            >
              Select all
            </Button>
            <Button
              testId="welcome-select-none"
              variant="ghost"
              size="xs"
              disabled={isImporting || selected.length === 0}
              onClick={() => setSelectedPaths(new Set())}
            >
              Select none
            </Button>
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 8, maxHeight: 320, overflowY: "scroll", paddingRight: 12 }}>
        {scans.map((scan) => {
          const scanCandidates = candidates.filter((candidate) => candidate.environmentId === scan.environmentId);
          const label = environments.find((environment) => environment.environmentId === scan.environmentId)?.label ?? "Computer";
          return (
            <div key={scan.environmentId} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, opacity: isImporting ? 0.64 : 1 }}>
              {scans.length > 1 ? (
                <Text weight={500} style={{ marginBottom: 8 }}>
                  {label}
                </Text>
              ) : null}
              {scan.isPending && scan.data === null ? (
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 12, paddingBottom: 12 }}>
                  <Icon name="loader-circle" size={16} color={theme.mutedForeground} />
                  <Text color={theme.mutedForeground}>Looking for projects…</Text>
                </div>
              ) : scan.error !== null ? (
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <Text color={theme.mutedForeground} style={{ flexShrink: 1 }}>{`Could not check projects. ${scan.error}`}</Text>
                  <Button variant="ghost" size="sm" onClick={scan.refresh}>
                    Retry
                  </Button>
                </div>
              ) : scanCandidates.length === 0 ? (
                <Text color={theme.mutedForeground} style={{ paddingTop: 8, paddingBottom: 8 }}>
                  No existing Claude Code or Codex projects found.
                </Text>
              ) : null}
              {scan.data?.truncated ? (
                <Text size="xs" color={theme.mutedForeground}>
                  {SCAN_LIMIT_MESSAGE}
                </Text>
              ) : null}
              <ImportCandidateList
                candidates={scanCandidates}
                selectedKeys={selectedKeys}
                disabled={isImporting}
                onSelectionChange={setSelectedPaths}
              />
            </div>
          );
        })}
      </div>
      {visibleImportError ? (
        <Text color={theme.errorForeground} style={{ marginTop: 12 }}>
          {visibleImportError}
        </Text>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
        <Button testId="welcome-skip-import" variant="ghost-muted" disabled={isImporting} onClick={finishAfterImport}>
          Do not import projects
        </Button>
        <Button
          testId="welcome-import"
          disabled={!canImport || isImporting || selected.length === 0}
          onClick={() => void runImport(selected)}
        >
          {isImporting ? "Importing…" : `Import ${selected.length} ${selected.length === 1 ? "project" : "projects"}`}
        </Button>
      </div>
    </>
  );
}

function ImportCandidateList({
  candidates,
  selectedKeys,
  disabled,
  onSelectionChange,
}: {
  readonly candidates: ReadonlyArray<ImportCandidate>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onSelectionChange: (next: ReadonlySet<string>) => void;
}) {
  const theme = useTheme();
  const { repositories, other } = groupOnboardingProjects(candidates);
  const [otherOpen, setOtherOpen] = useState(false);
  const setKeys = (keys: ReadonlyArray<string>, checked: boolean) => {
    if (disabled) return;
    const next = new Set(selectedKeys);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    onSelectionChange(next);
  };
  const otherSelected = other.filter((candidate) => selectedKeys.has(candidate.key)).length;
  return (
    <>
      {repositories.map((group) => (
        <ImportRepositoryGroup key={group.key} group={group} selectedKeys={selectedKeys} onToggle={setKeys} />
      ))}
      {other.length > 0 ? (
        <>
          <GroupHeaderRow
            checked={otherSelected === other.length}
            indeterminate={otherSelected > 0 && otherSelected < other.length}
            onCheck={() => setKeys(other.map((candidate) => candidate.key), otherSelected !== other.length)}
            open={otherOpen}
            onToggleOpen={() => setOtherOpen((open) => !open)}
          >
            <Text color={theme.mutedForeground} truncate style={{ flexGrow: 1, flexShrink: 1 }}>
              Other folders
            </Text>
            <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
              {`${other.length} ${other.length === 1 ? "folder" : "folders"}`}
            </Text>
          </GroupHeaderRow>
          {otherOpen
            ? other.map((candidate) => (
                <ImportCandidateRow
                  key={candidate.key}
                  candidate={candidate}
                  path={candidate.path}
                  nested
                  checked={selectedKeys.has(candidate.key)}
                  onCheckedChange={(checked) => setKeys([candidate.key], checked)}
                />
              ))
            : null}
        </>
      ) : null}
    </>
  );
}

function GroupHeaderRow({
  checked,
  indeterminate,
  onCheck,
  open,
  onToggleOpen,
  children,
}: {
  checked: boolean;
  indeterminate: boolean;
  onCheck: () => void;
  open: boolean;
  onToggleOpen: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: RADIUS.md,
        hover: { backgroundColor: alpha(theme.muted, 0.4) },
      }}
    >
      <Checkbox checked={checked} indeterminate={indeterminate} onChange={onCheck} />
      <div
        onClick={onToggleOpen}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0, cursor: "pointer" }}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={theme.mutedForeground} />
        {children}
      </div>
    </div>
  );
}

function ImportRepositoryGroup({
  group,
  selectedKeys,
  onToggle,
}: {
  readonly group: OnboardingProjectGroup<ImportCandidate>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onToggle: (keys: ReadonlyArray<string>, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const keys = group.candidates.map((candidate) => candidate.key);
  const selectedCount = keys.filter((key) => selectedKeys.has(key)).length;
  const only = group.candidates[0];
  if (group.candidates.length === 1 && only !== undefined) {
    return (
      <ImportCandidateRow
        candidate={only}
        label={group.label}
        path={only.path}
        checked={selectedKeys.has(only.key)}
        onCheckedChange={(checked) => onToggle([only.key], checked)}
      />
    );
  }
  return (
    <>
      <GroupHeaderRow
        checked={selectedCount === keys.length}
        indeterminate={selectedCount > 0 && selectedCount < keys.length}
        onCheck={() => onToggle(keys, selectedCount !== keys.length)}
        open={open}
        onToggleOpen={() => setOpen((value) => !value)}
      >
        <Text weight={500} truncate style={{ flexGrow: 1, flexShrink: 1 }}>
          {group.label}
        </Text>
        <ImportRowMeta
          sources={[...new Set(group.candidates.flatMap((candidate) => candidate.sources))]}
          threadCount={group.threadCount}
          lastActiveAt={group.lastActiveAt}
        />
      </GroupHeaderRow>
      {open
        ? group.candidates.map((candidate) => (
            <ImportCandidateRow
              key={candidate.key}
              candidate={candidate}
              path={candidate.path}
              nested
              checked={selectedKeys.has(candidate.key)}
              onCheckedChange={(checked) => onToggle([candidate.key], checked)}
            />
          ))
        : null}
    </>
  );
}

function ProjectPathText({ path, small, muted }: { readonly path: string; readonly small: boolean; readonly muted: boolean }) {
  const theme = useTheme();
  const { name, parent } = splitOnboardingProjectPath(path);
  const size = small ? 11 : 12;
  const style = {
    color: muted ? theme.mutedForeground : theme.foreground,
    fontSize: size,
    lineHeight: size + 4,
    fontFamily: FONTS.mono,
    whiteSpace: "nowrap",
  } as const;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", minWidth: 0, flexShrink: 1 }}>
      {parent.length > 0 ? (
        <text style={{ ...style, textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>{parent}</text>
      ) : null}
      <text style={{ ...style, flexShrink: 0, textOverflow: "ellipsis", overflow: "hidden" }}>{name}</text>
    </div>
  );
}

function ImportCandidateRow({
  candidate,
  label,
  path,
  nested = false,
  checked,
  onCheckedChange,
}: {
  readonly candidate: ImportCandidate;
  readonly label?: string;
  readonly path?: string;
  readonly nested?: boolean;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <div
      testId={`welcome-import-row-${splitOnboardingProjectPath(candidate.path).name}`}
      onClick={() => onCheckedChange(!checked)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: nested ? 32 : 8,
        paddingRight: 8,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: RADIUS.md,
        cursor: "pointer",
        hover: { backgroundColor: alpha(theme.muted, 0.4) },
      }}
    >
      <div style={{ display: "flex", pointerEvents: "none" }}>
        <Checkbox checked={checked} onChange={() => undefined} />
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0, pointerEvents: "none" }}>
        {label !== undefined ? (
          <Text weight={500} truncate style={{ flexShrink: 0, maxWidth: 240 }}>
            {label}
          </Text>
        ) : null}
        {path !== undefined ? <ProjectPathText path={path} small={label !== undefined} muted={label !== undefined} /> : null}
      </div>
      <ImportRowMeta sources={nested ? null : candidate.sources} threadCount={candidate.threadCount} lastActiveAt={candidate.lastActiveAt} />
    </div>
  );
}

/** `grid-cols-[1rem_1rem_2.5rem_2.25rem]`: Claude, Codex, thread count, age. */
function ImportRowMeta({
  sources,
  threadCount,
  lastActiveAt,
}: {
  readonly sources: ReadonlyArray<"claudeAgent" | "codex"> | null;
  readonly threadCount: number;
  readonly lastActiveAt: string | null;
}) {
  const theme = useTheme();
  const relative = lastActiveAt === null ? null : formatRelativeTime(lastActiveAt);
  const age = relative === null ? "" : relative.suffix === null ? "now" : relative.value;
  const cell = (width: number, child: ReactNode) => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", width, flexShrink: 0 }}>{child}</div>
  );
  const mark = (driver: "claudeAgent" | "codex", name: string) =>
    sources?.includes(driver) ? (
      <ProviderInstanceIcon driverKind={ProviderDriverKind.make(driver)} displayName={name} size={12} boxSize={16} color={theme.mutedForeground} />
    ) : null;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, pointerEvents: "none" }}>
      {cell(16, mark("claudeAgent", "Claude Code"))}
      {cell(16, mark("codex", "Codex"))}
      {cell(40, <Text size="xs" color={theme.mutedForeground}>{String(threadCount)}</Text>)}
      {cell(36, <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>{age}</Text>)}
    </div>
  );
}

// ── Shared ──────────────────────────────────────────────────────────────

function StepTitle({ children }: { readonly children: string }) {
  return (
    <Text size="2xl" weight={600}>
      {children}
    </Text>
  );
}

function StepDescription({ children }: { readonly children: string }) {
  const theme = useTheme();
  return (
    <Text color={theme.mutedForeground} style={{ marginTop: 10, lineHeight: 23 }}>
      {children}
    </Text>
  );
}
