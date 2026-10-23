// Port of apps/web/src/components/settings/AddProviderInstanceDialog.tsx with
// AddProviderInstanceWizardSteps, ui/wizard.tsx, AcpRegistrySearchStep.tsx and
// ProviderWizardAuthenticationStep.tsx. "Continue with ChatGPT" swaps the wizard for
// CodexSetupSection.tsx's AddManagedCodexAccountDialog, as web does. Registry agents draw
// their initials instead of the registry's remote icon.
import { useAtomValue } from "@effect/atom-react";
import * as DialogPrimitive from "@gpuix/react/dialog";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ACP_REGISTRY_MAX_AGENTS,
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  type AcpRegistryPrepareResult,
  type AcpRegistrySearchAgent,
  type EnvironmentId,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
} from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { EMPTY_SERVER_PROVIDERS, readEnvironmentScope, useAtomCommand, useEnvironmentScope } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip, dialogGlassShadow } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  ACP_REGISTRY_WIZARD_STEPS,
  ADD_PROVIDER_WIZARD_STEPS,
  LOCAL_ACP_WIZARD_STEPS,
  deriveAvailableInstanceId,
  isConfiguredAcpRegistryAgent,
  resolveAcpRegistryWizardNavigation,
  resolveWizardNavigation,
  updateProviderIdentityDraft,
  type ProviderIdentityDraft,
  type WizardNavigation,
} from "../../web/components/settings/AddProviderInstanceDialog.logic.ts";
import { Badge, TextField } from "../controls.tsx";
import { SettingsGroup, SettingsRow } from "../layout.tsx";
import { openExternal } from "../openExternal.ts";
import { ProviderSettingsForm, deriveProviderSettingsFields, type SettingsFormDefinition } from "../ProviderSettingsForm.tsx";
import { useEnvironmentQuery } from "../query.ts";
import { AccentColorPicker } from "./AccentColorPicker.tsx";
import { AddManagedCodexAccountDialog, ChatGptConnectionButton } from "./CodexSetupSection.tsx";
import { DriverIcon } from "./parts.tsx";
import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection.tsx";
import { ProviderEnvironmentSection } from "./ProviderInstanceCard.tsx";
import { providerClients } from "./providerDriverMeta.ts";
import { useEnvironmentSettings, usePersistProviderInstance } from "./state.ts";

/** Trimmed to 48 chars so the composed id stays under ProviderInstanceId's 64-char cap. */
function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function deriveInstanceId(driver: ProviderDriverKind, label: string): string {
  const slug = slugifyLabel(label);
  return slug ? `${driver}_${slug}` : "";
}

const INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const ACP_REGISTRY_DRIVER_KIND = ProviderDriverKind.make("acpRegistry");
const DEFAULT_DRIVER_OPTION = providerClients.definitions[0]!;
const EMPTY_CONFIG_DRAFT: Record<string, unknown> = {};

function validateInstanceId(id: string, existing: ReadonlySet<string>): string | null {
  if (id.length === 0) return "Instance ID is required.";
  if (id.length > 64) return "Instance ID must be 64 characters or fewer.";
  if (!INSTANCE_ID_PATTERN.test(id)) return "Instance ID must start with a letter and use only letters, digits, '-', or '_'.";
  if (existing.has(id)) return `An instance named '${id}' already exists.`;
  return null;
}

const asFormDefinition = (definition: (typeof providerClients.definitions)[number]) => definition as unknown as SettingsFormDefinition;

export function AddProviderDialog({
  environmentId,
  environmentLabel,
  onClose,
  onCreated,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  onClose: () => void;
  onCreated: (instanceId: ProviderInstanceId) => void;
}) {
  const theme = useTheme();
  const settings = useEnvironmentSettings(environmentId);
  const persistProviderInstance = usePersistProviderInstance(environmentId);
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const [wizardStep, setWizardStep] = useState(0);
  const [addingChatGptAccount, setAddingChatGptAccount] = useState(false);
  const [driver, setDriver] = useState<ProviderDriverKind>(DEFAULT_DRIVER_KIND);
  const [identityByDriver, setIdentityByDriver] = useState<Record<string, ProviderIdentityDraft>>({});
  const [selectedAcp, setSelectedAcp] = useState<AcpRegistrySearchAgent | null>(null);
  const [localEnvironment, setLocalEnvironment] = useState<ReadonlyArray<ProviderInstanceEnvironmentVariable>>([]);
  const [isManualAcpConfiguration, setIsManualAcpConfiguration] = useState(false);
  const [isPreparingRegistryAgent, setIsPreparingRegistryAgent] = useState(false);
  const [configByDriver, setConfigByDriver] = useState<Record<string, Record<string, unknown>>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [createdInstanceId, setCreatedInstanceId] = useState<ProviderInstanceId | null>(null);

  // Codex and Claude run at their default slots before they are configured, so those ids stay reserved.
  const existingIds = new Set(["codex", "claudeAgent", ...Object.keys(settings.providerInstances ?? {})]);
  const driverOption = providerClients.get(driver) ?? DEFAULT_DRIVER_OPTION;
  const isAcpRegistry = driver === ACP_REGISTRY_DRIVER_KIND;
  const defaultIdentity: ProviderIdentityDraft = { label: driverOption.label, accentColor: "", instanceIdOverride: null };
  const { label, accentColor, instanceIdOverride } = identityByDriver[driver] ?? defaultIdentity;
  const instanceId =
    instanceIdOverride ??
    deriveAvailableInstanceId(
      (candidateLabel) =>
        !candidateLabel.trim() || candidateLabel === driverOption.label
          ? isAcpRegistry
            ? `${driver}_custom`
            : driver
          : deriveInstanceId(driver, candidateLabel),
      label,
      existingIds,
    );
  const driverSettingsFields = deriveProviderSettingsFields(asFormDefinition(driverOption));
  const instanceIdError = validateInstanceId(instanceId, existingIds);
  const showInstanceIdError = hasAttemptedSubmit && instanceIdError !== null;
  const identityStep = 1;
  const configDraft = configByDriver[driver] ?? EMPTY_CONFIG_DRAFT;
  const isLocalAcp = isAcpRegistry && isManualAcpConfiguration && configDraft.source === "local";
  const localCommandPath = typeof configDraft.commandPath === "string" ? configDraft.commandPath.trim() : "";
  const manualAgentId = typeof configDraft.agentId === "string" ? configDraft.agentId.trim() : "";
  const acpSelectionError = isLocalAcp
    ? localCommandPath.length > 0
      ? null
      : "Executable is required."
    : selectedAcp !== null || (isManualAcpConfiguration && manualAgentId.length > 0)
      ? null
      : "Select an ACP or configure one manually.";
  const steps = isAcpRegistry ? (isLocalAcp ? LOCAL_ACP_WIZARD_STEPS : ACP_REGISTRY_WIZARD_STEPS) : ADD_PROVIDER_WIZARD_STEPS;

  const setConfigDraft = (config: Record<string, unknown> | undefined) =>
    setConfigByDriver((existing) => {
      const next = { ...existing };
      if (config === undefined || Object.keys(config).length === 0) delete next[driver];
      else next[driver] = config;
      return next;
    });
  const setIdentityDraft = (update: Partial<ProviderIdentityDraft>) =>
    setIdentityByDriver((existing) => ({ ...existing, [driver]: { ...(existing[driver] ?? defaultIdentity), ...update } }));

  const handleSave = async () => {
    if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    if (isSaving || createdInstanceId) return;
    setHasAttemptedSubmit(true);
    if (instanceIdError !== null || (isAcpRegistry && acpSelectionError !== null)) return;
    const config = driver === "codex" ? { ...configByDriver[driver], setupMode: "existing" } : (configByDriver[driver] ?? {});
    const normalizedAccentColor = normalizeProviderAccentColor(accentColor);
    const nextInstance: ProviderInstanceConfig = {
      driver,
      enabled: true,
      ...(label.trim().length > 0 ? { displayName: label.trim() } : {}),
      ...(normalizedAccentColor ? { accentColor: normalizedAccentColor } : {}),
      ...(Object.keys(config).length > 0 ? { config } : {}),
      ...(isLocalAcp && localEnvironment.length > 0 ? { environment: localEnvironment } : {}),
    };
    const brandedId = ProviderInstanceId.make(instanceId);
    setIsSaving(true);
    const result = await persistProviderInstance({ operation: "create", instanceId: brandedId, instance: nextInstance });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setIsSaving(false);
      toast({ type: "error", title: "Could not add provider instance", description: error instanceof Error ? error.message : "The settings update failed." });
      return;
    }
    onCreated(brandedId);
    if (isAcpRegistry && !isLocalAcp) {
      setCreatedInstanceId(brandedId);
      setIsSaving(false);
      setWizardStep(2);
      return;
    }
    toast({ type: "success", title: "Provider instance added", description: `${driverOption.label} instance '${instanceId}' was added.` });
    onClose();
  };

  const applyWizardNavigation = (navigation: WizardNavigation) => {
    if (isSaving || isPreparingRegistryAgent || createdInstanceId) return;
    if (navigation.kind === "blocked") setHasAttemptedSubmit(true);
    if (isAcpRegistry && !isLocalAcp && navigation.kind === "navigate" && navigation.step === 2) {
      void handleSave();
      return;
    }
    setWizardStep(navigation.step);
  };
  const navigateToStep = (requestedStep: number) =>
    applyWizardNavigation(
      isAcpRegistry
        ? isLocalAcp
          ? resolveWizardNavigation(wizardStep, requestedStep, LOCAL_ACP_WIZARD_STEPS.length, {
              instanceIdError,
              prerequisite: { step: 0, error: acpSelectionError },
            })
          : resolveAcpRegistryWizardNavigation(wizardStep, requestedStep, { instanceIdError, selectionError: acpSelectionError })
        : resolveWizardNavigation(wizardStep, requestedStep, ADD_PROVIDER_WIZARD_STEPS.length, { instanceIdError }),
    );

  const handleAcpPrepared = (agent: AcpRegistrySearchAgent) => {
    setDriver(ACP_REGISTRY_DRIVER_KIND);
    const nextInstanceId = deriveAvailableInstanceId((candidate) => deriveInstanceId(ACP_REGISTRY_DRIVER_KIND, candidate), agent.name, existingIds);
    setSelectedAcp(agent);
    setIsManualAcpConfiguration(false);
    setIdentityByDriver((existing) => updateProviderIdentityDraft(existing, ACP_REGISTRY_DRIVER_KIND, { label: agent.name, instanceIdOverride: nextInstanceId }));
    setConfigByDriver((existing) => ({ ...existing, [ACP_REGISTRY_DRIVER_KIND]: { agentId: agent.id, distribution: "auto" } }));
    setHasAttemptedSubmit(false);
    setWizardStep(1);
  };
  const handleManualAcpConfiguration = () => {
    setDriver(ACP_REGISTRY_DRIVER_KIND);
    setSelectedAcp(null);
    setIsManualAcpConfiguration(true);
    setConfigByDriver((existing) => {
      const next = { ...existing };
      delete next[ACP_REGISTRY_DRIVER_KIND];
      return next;
    });
    setIdentityByDriver((existing) => updateProviderIdentityDraft(existing, ACP_REGISTRY_DRIVER_KIND, { label: "", instanceIdOverride: null }));
    setHasAttemptedSubmit(false);
  };
  const handleLocalAcpConfiguration = () => {
    setDriver(ACP_REGISTRY_DRIVER_KIND);
    setSelectedAcp(null);
    setIsManualAcpConfiguration(true);
    setConfigByDriver((existing) => ({ ...existing, [ACP_REGISTRY_DRIVER_KIND]: { source: "local", commandArgs: [] } }));
    setIdentityByDriver((existing) => updateProviderIdentityDraft(existing, ACP_REGISTRY_DRIVER_KIND, { label: "Local ACP", instanceIdOverride: null }));
    setLocalEnvironment([]);
    setHasAttemptedSubmit(false);
  };

  if (addingChatGptAccount) return <AddManagedCodexAccountDialog environmentId={environmentId} onClose={onClose} />;

  const stepsDisabled = isSaving || isPreparingRegistryAgent || createdInstanceId !== null;
  let panel: ReactNode;
  let footer: ReactNode;
  if (createdInstanceId) {
    panel = <WizardAuthenticationStep environmentId={environmentId} environmentLabel={environmentLabel} instanceId={createdInstanceId} />;
    footer = (
      <Button size="sm" variant="outline" onClick={onClose} testId="add-provider-finish">
        Done
      </Button>
    );
  } else {
    panel = (
      <>
        {wizardStep === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Text weight={500}>Provider</Text>
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {providerClients.definitions
                .filter((option) => option.driverKind !== ACP_REGISTRY_DRIVER_KIND)
                .map((option) => (
                  <DriverRadio
                    key={option.driverKind}
                    label={option.label}
                    driverKind={option.driverKind}
                    badge={option.badgeLabel}
                    checked={driver === option.driverKind}
                    disabled={isPreparingRegistryAgent}
                    onSelect={() => {
                      setDriver(option.driverKind);
                      setIsManualAcpConfiguration(false);
                      setHasAttemptedSubmit(false);
                    }}
                  />
                ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 16 }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
                <div style={{ flexGrow: 1, height: 1, backgroundColor: alpha(theme.border, 0.7) }} />
                <Text size="xs" color={theme.mutedForeground}>
                  Or choose from ACP Registry
                </Text>
                <div style={{ flexGrow: 1, height: 1, backgroundColor: alpha(theme.border, 0.7) }} />
              </div>
              {isAcpRegistry && isManualAcpConfiguration ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <Text weight={500}>{isLocalAcp ? "Local ACP command" : "Enter manually"}</Text>
                      <Text size="xs" color={theme.mutedForeground}>
                        {isLocalAcp
                          ? `Run an installed ACP executable on ${environmentLabel}.`
                          : "Enter an official registry ID and any local executable or auth override."}
                      </Text>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setIsManualAcpConfiguration(false);
                        setHasAttemptedSubmit(false);
                      }}
                    >
                      Search registry
                    </Button>
                  </div>
                  <SettingsGroup variant="plain">
                    <ProviderSettingsForm
                      definition={asFormDefinition(driverOption)}
                      value={configDraft}
                      idPrefix="add-provider-acpRegistry-manual"
                      variant="settings"
                      onChange={setConfigDraft}
                    />
                    {isLocalAcp ? <ProviderEnvironmentSection environment={localEnvironment} onChange={setLocalEnvironment} /> : null}
                  </SettingsGroup>
                  {hasAttemptedSubmit && acpSelectionError ? (
                    <Text size="2xs" color={theme.errorForeground}>
                      {acpSelectionError}
                    </Text>
                  ) : null}
                </div>
              ) : (
                <>
                  <AcpRegistrySearch
                    environmentId={environmentId}
                    providerInstances={settings.providerInstances ?? {}}
                    onPrepared={handleAcpPrepared}
                    onManualConfiguration={handleManualAcpConfiguration}
                    onLocalConfiguration={handleLocalAcpConfiguration}
                    onPreparingChange={setIsPreparingRegistryAgent}
                  />
                  {isAcpRegistry && hasAttemptedSubmit && acpSelectionError ? (
                    <Text size="2xs" color={theme.errorForeground}>
                      {acpSelectionError}
                    </Text>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
        {isAcpRegistry && wizardStep === 1 && selectedAcp ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 16,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderColor: alpha(theme.border, 0.7),
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <Text weight={500} truncate>
                {selectedAcp.name}
              </Text>
              <Text size="xs" color={theme.mutedForeground}>{`v${selectedAcp.version} · ${selectedAcp.distribution}`}</Text>
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
              {selectedAcp.website ? <LinkText label="Docs" url={selectedAcp.website} /> : null}
              {selectedAcp.repository ? <LinkText label="Source" url={selectedAcp.repository} /> : null}
            </div>
          </div>
        ) : null}
        {wizardStep === identityStep ? (
          <SettingsGroup variant="plain">
            <SettingsRow
              title="Label"
              description="Shown in the provider list."
              control={
                <TextField testId="add-provider-label" size="sm" width={224} placeholder="e.g. Work" value={label} onChange={(next) => setIdentityDraft({ label: next })} />
              }
            />
            <SettingsRow
              title="Instance ID"
              description="Letters, digits, '-', or '_'."
              status={
                showInstanceIdError ? (
                  <Text size="xs" color={theme.errorForeground}>
                    {instanceIdError ?? ""}
                  </Text>
                ) : undefined
              }
              control={
                <TextField
                  testId="add-provider-instance-id"
                  size="sm"
                  width={224}
                  placeholder={`${driver}_work`}
                  value={instanceId}
                  onChange={(next) => setIdentityDraft({ instanceIdOverride: next })}
                />
              }
            />
            <SettingsRow
              title="Accent color"
              description="Optional marker shown in the picker."
              control={<AccentColorPicker testId="add-provider-accent" value={accentColor || undefined} onCommit={(value) => setIdentityDraft({ accentColor: value })} />}
            />
          </SettingsGroup>
        ) : null}
        {!isAcpRegistry && wizardStep === 2 ? (
          driverSettingsFields.length > 0 ? (
            <SettingsGroup variant="plain">
              <ProviderSettingsForm
                definition={asFormDefinition(driverOption)}
                value={configDraft}
                idPrefix={`add-provider-${driver}`}
                variant="settings"
                onChange={setConfigDraft}
              />
            </SettingsGroup>
          ) : (
            <Text color={theme.mutedForeground}>This driver has no required configuration. You can add the instance now.</Text>
          )
        ) : null}
      </>
    );
    footer = (
      <>
        <Button
          testId="add-provider-back"
          variant={wizardStep === 0 ? "ghost-muted" : "outline"}
          size="sm"
          disabled={isSaving || isPreparingRegistryAgent}
          onClick={() => (wizardStep === 0 ? onClose() : setWizardStep((step) => Math.max(0, step - 1)))}
        >
          {wizardStep === 0 ? "Cancel" : "Back"}
        </Button>
        {wizardStep === 0 && driver === "codex" ? (
          <>
            <Button variant="outline" size="sm" onClick={() => navigateToStep(1)} testId="add-provider-manual">
              Configure manually
            </Button>
            <ChatGptConnectionButton size="sm" testId="add-provider-chatgpt" onClick={() => setAddingChatGptAccount(true)} />
          </>
        ) : wizardStep < (isAcpRegistry ? 1 : 2) ? (
          <Button size="sm" disabled={isPreparingRegistryAgent} onClick={() => navigateToStep(wizardStep + 1)} testId="add-provider-next">
            Next
          </Button>
        ) : (
          <Button size="sm" disabled={isSaving || !canManageProviders} onClick={() => void handleSave()} testId="add-provider-save">
            {isSaving ? "Adding..." : isAcpRegistry && !isLocalAcp ? "Continue to sign-in" : "Add instance"}
          </Button>
        )}
      </>
    );
  }

  return (
    <WizardDialog
      onClose={onClose}
      title="Add provider"
      description={`Add an account or configure a provider on ${environmentLabel}.`}
      steps={<WizardSteps steps={steps} currentStep={wizardStep} disabled={stepsDisabled} onStepChange={navigateToStep} />}
      footer={footer}
    >
      {panel}
    </WizardDialog>
  );
}

// ── Wizard shell (ui/wizard.tsx) ────────────────────────────────────────

export function WizardDialog({
  onClose,
  title,
  description,
  steps,
  children,
  footer,
  testId = "add-provider-dialog",
}: {
  onClose: () => void;
  title: string;
  description: string;
  steps?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.overlay, pointerEvents: "auto" }} />
        <DialogPrimitive.Popup
          testId={testId}
          style={{
            display: "flex",
            flexDirection: "column",
            width: 768,
            maxWidth: "92%",
            borderRadius: RADIUS["2xl"],
            borderWidth: 1,
            borderColor: dark ? alpha("#ffffff", 0.08) : alpha(theme.foreground, 0.1),
            backgroundColor: dark ? theme.background : "#ffffff",
            boxShadow: dialogGlassShadow(theme),
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 24, paddingBottom: 16 }}>
            <Text size="xl" weight={600}>
              {title}
            </Text>
            <Text color={theme.mutedForeground}>{description}</Text>
            {steps ? <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>{steps}</div> : null}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              paddingLeft: 24,
              paddingRight: 24,
              paddingTop: 20,
              paddingBottom: 20,
              backgroundColor: dark ? alpha("#ffffff", 0.02) : alpha(theme.background, 0.8),
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: dark ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05),
            }}
          >
            {children}
          </div>
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8, paddingLeft: 24, paddingRight: 24, paddingTop: 16, paddingBottom: 16 }}>
            {footer}
          </div>
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex" }}>
            <IconButton testId="add-provider-close" icon="x" size={28} iconSize={16} onClick={onClose} />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function WizardSteps({
  steps,
  currentStep,
  disabled,
  onStepChange,
}: {
  steps: readonly string[];
  currentStep: number;
  disabled: boolean;
  onStepChange: (step: number) => void;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 4,
        padding: 4,
        borderRadius: RADIUS.xl,
        backgroundColor: dark ? alpha("#ffffff", 0.04) : theme.background,
        borderWidth: 1,
        borderColor: dark ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05),
      }}
    >
      {steps.map((step, index) => {
        const current = index === currentStep;
        const done = index < currentStep;
        return (
          <div
            key={step}
            testId={`add-provider-step-${index}`}
            onClick={disabled ? undefined : () => onStepChange(index)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 8,
              paddingBottom: 8,
              borderRadius: RADIUS.lg,
              cursor: disabled ? "default" : "pointer",
              ...(current
                ? { backgroundColor: theme.card, borderWidth: 1, borderColor: dark ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05) }
                : disabled
                  ? {}
                  : { hover: { backgroundColor: theme.card } }),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: done ? theme.primary : current ? alpha(theme.primary, 0.3) : dark ? alpha("#ffffff", 0.1) : alpha("#000000", 0.1),
                backgroundColor: done ? theme.primary : current ? alpha(theme.primary, 0.1) : dark ? alpha("#ffffff", 0.05) : theme.card,
                flexShrink: 0,
              }}
            >
              {done ? (
                <Icon name="check" size={16} color={theme.primaryForeground} />
              ) : (
                <text style={{ color: current ? theme.primary : theme.mutedForeground, fontSize: 14, lineHeight: 18, fontWeight: 500, fontFamily: FONTS.sans }}>
                  {String(index + 1)}
                </text>
              )}
            </div>
            <Text weight={500} color={current ? theme.foreground : theme.mutedForeground} truncate>
              {step}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

function DriverRadio({
  label,
  driverKind,
  badge,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  driverKind: ProviderDriverKind;
  badge: string | undefined;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  return (
    <div
      testId={`add-provider-driver-${driverKind}`}
      onClick={disabled ? undefined : onSelect}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        width: 347,
        flexGrow: 1,
        height: 44,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: RADIUS.lg,
        borderWidth: checked ? 2 : 1,
        borderColor: checked ? theme.primary : dark ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05),
        backgroundColor: checked ? alpha(theme.primary, dark ? 0.15 : 0.08) : dark ? alpha("#ffffff", 0.03) : theme.card,
        cursor: disabled ? "default" : "pointer",
        ...(checked ? {} : { hover: { backgroundColor: dark ? alpha("#ffffff", 0.05) : theme.muted } }),
      }}
    >
      <DriverIcon driver={driverKind} displayName={label} size={16} />
      <Text weight={500} truncate style={{ flexGrow: 1 }}>
        {label}
      </Text>
      {checked ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 10, backgroundColor: theme.primary }}>
          <Icon name="check" size={14} color={theme.primaryForeground} />
        </div>
      ) : null}
      {badge ? (
        <Badge tone="warning" size="sm">
          {badge}
        </Badge>
      ) : null}
    </div>
  );
}

function LinkText({ label, url }: { label: string; url: string }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <div onClick={() => openExternal(url)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ cursor: "pointer" }}>
      <Text size="2xs" color={hover ? theme.foreground : theme.mutedForeground}>
        {label}
      </Text>
    </div>
  );
}

// ── ACP Registry search (AcpRegistrySearchStep.tsx) ─────────────────────

function applyAcpRegistryPrepareResult(agent: AcpRegistrySearchAgent, prepared: AcpRegistryPrepareResult): AcpRegistrySearchAgent {
  return { ...agent, id: prepared.agentId, version: prepared.version, distribution: prepared.distribution };
}

function AcpRegistrySearch({
  environmentId,
  providerInstances,
  onPrepared,
  onManualConfiguration,
  onLocalConfiguration,
  onPreparingChange,
}: {
  environmentId: EnvironmentId;
  providerInstances: Readonly<Record<string, ProviderInstanceConfig>>;
  onPrepared: (agent: AcpRegistrySearchAgent) => void;
  onManualConfiguration: () => void;
  onLocalConfiguration: () => void;
  onPreparingChange: (preparing: boolean) => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const prepareGeneration = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTarget = useMemo(
    () => ({ environmentId, input: submittedQuery ? { query: submittedQuery } : { query: "", limit: ACP_REGISTRY_MAX_AGENTS } }),
    [environmentId, submittedQuery],
  );
  const search = useEnvironmentQuery(serverEnvironment.searchAcpRegistry(searchTarget));
  const prepareAgent = useAtomCommand(serverEnvironment.prepareAcpRegistryAgent, { reportFailure: false });

  useEffect(
    () => () => {
      prepareGeneration.current += 1;
      if (searchTimer.current !== null) clearTimeout(searchTimer.current);
      onPreparingChange(false);
    },
    [onPreparingChange],
  );

  const handlePrepare = async (agent: AcpRegistrySearchAgent) => {
    if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    const generation = ++prepareGeneration.current;
    setPrepareError(null);
    setPreparingId(agent.id);
    onPreparingChange(true);
    const result = await prepareAgent({ environmentId, input: { agentId: agent.id } });
    if (prepareGeneration.current !== generation) return;
    setPreparingId(null);
    onPreparingChange(false);
    if (result._tag === "Success") {
      onPrepared(applyAcpRegistryPrepareResult(agent, result.value));
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setPrepareError(error instanceof Error && error.message.trim() ? error.message : "The ACP could not be prepared.");
    }
  };

  const results = search.data?.agents ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextField
          testId="acp-registry-search"
          size="sm"
          placeholder="Search agents…"
          value={query}
          disabled={preparingId !== null}
          leading={<Icon name="search" size={16} color={theme.mutedForeground} />}
          onChange={(next) => {
            setQuery(next);
            setPrepareError(null);
            if (searchTimer.current !== null) clearTimeout(searchTimer.current);
            searchTimer.current = setTimeout(() => {
              searchTimer.current = null;
              setSubmittedQuery(next.trim());
            }, 300);
          }}
          onSubmit={(next) => {
            if (searchTimer.current !== null) clearTimeout(searchTimer.current);
            const trimmed = next.trim();
            setQuery(trimmed);
            setPrepareError(null);
            if (trimmed === submittedQuery) search.refresh();
            else setSubmittedQuery(trimmed);
          }}
        />
        <Button size="sm" variant="ghost-muted" disabled={preparingId !== null} onClick={onManualConfiguration} testId="acp-enter-manually">
          Enter manually
        </Button>
        <Button size="sm" variant="outline" disabled={preparingId !== null} onClick={onLocalConfiguration} testId="acp-local-command">
          Local ACP command
        </Button>
      </div>
      {search.error || prepareError ? (
        <Text size="xs" color={theme.errorForeground}>
          {prepareError ?? search.error ?? ""}
        </Text>
      ) : null}
      {search.isPending && results === null ? (
        <div style={{ display: "flex", minHeight: 80, alignItems: "center", justifyContent: "center" }}>
          <Text color={theme.mutedForeground}>Searching the registry...</Text>
        </div>
      ) : null}
      {results ? (
        results.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 112,
              borderRadius: RADIUS["2xl"],
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: theme.border,
            }}
          >
            <Text weight={500}>No compatible agents found</Text>
            <Text size="xs" color={theme.mutedForeground}>
              Try a broader search.
            </Text>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", maxHeight: 256, overflowY: "scroll", scrollbarColor: theme.scrollbar, scrollbarWidth: 6, paddingRight: 10 }}>
            {results.map((agent) => (
              <AcpRegistryAgentRow
                key={agent.id}
                agent={agent}
                alreadyAdded={isConfiguredAcpRegistryAgent(providerInstances, agent.id)}
                canAdd={canManageProviders && preparingId === null}
                isPreparing={preparingId === agent.id}
                onAdd={(next) => void handlePrepare(next)}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function AcpRegistryAgentRow({
  agent,
  alreadyAdded,
  canAdd,
  isPreparing,
  onAdd,
}: {
  agent: AcpRegistrySearchAgent;
  alreadyAdded: boolean;
  canAdd: boolean;
  isPreparing: boolean;
  onAdd: (agent: AcpRegistrySearchAgent) => void;
}) {
  const theme = useTheme();
  const progressLabel = agent.distribution === "binary" ? "Downloading" : "Preparing";
  const aboutUrl = agent.website || agent.repository;
  const description = agent.description ? (agent.description.length > 110 ? `${agent.description.slice(0, 107)}...` : agent.description) : null;
  return (
    <div testId={`acp-agent-${agent.id}`} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10, paddingBottom: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: RADIUS.sm,
          borderWidth: 1,
          borderColor: theme.border,
          flexShrink: 0,
        }}
      >
        <Text size="3xs" weight={600} color={theme.mutedForeground}>
          {agent.name.slice(0, 2).toUpperCase()}
        </Text>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 }}>
        <Text weight={500}>{agent.name}</Text>
        {description ? (
          <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
            {description}
          </Text>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {aboutUrl ? (
          <Tooltip content={`About ${agent.name}`} side="top">
            <IconButton icon="external-link" size={24} iconSize={14} onClick={() => openExternal(aboutUrl)} />
          </Tooltip>
        ) : null}
        <Button size="xs" variant="outline" disabled={!canAdd || alreadyAdded} onClick={() => onAdd(agent)}>
          {alreadyAdded ? "Added" : isPreparing ? progressLabel : "Add"}
        </Button>
      </div>
    </div>
  );
}

// ── Sign-in step (ProviderWizardAuthenticationStep.tsx) ─────────────────

function WizardAuthenticationStep({
  environmentId,
  environmentLabel,
  instanceId,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  instanceId: ProviderInstanceId;
}) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const provider = providers.find((candidate) => candidate.instanceId === instanceId);
  const target = useMemo(() => ({ environmentId, input: { instanceId } }), [environmentId, instanceId]);
  const query = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const auth = query.data;
  const signedIn = provider?.auth.status === "authenticated" || (provider?.auth.status === "unknown" && auth?.phase === "succeeded");
  const isDiscovering = !signedIn && !query.error && auth?.methods === undefined;
  const canAuthenticate = (auth?.methods?.length ?? 0) > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 288 }}>
      <SettingsGroup variant="plain">
        {provider && (canAuthenticate || signedIn) ? (
          <ProviderAuthenticationSection
            environmentId={environmentId}
            environmentLabel={environmentLabel}
            instanceId={instanceId}
            provider={{ ...provider, setup: { ...provider.setup, canInstall: provider.setup?.canInstall ?? false, canAuthenticate } }}
            readOnly={false}
          />
        ) : (
          <SettingsRow
            title="Account"
            description={
              isDiscovering
                ? "Discovering sign-in methods…"
                : (query.error ?? auth?.message ?? "No in-app sign-in advertised. Follow the provider's docs to finish setup.")
            }
            control={
              provider?.setup?.documentationUrl ? (
                <Button size="sm" variant="outline" onClick={() => openExternal(provider.setup!.documentationUrl!)}>
                  Open docs
                </Button>
              ) : undefined
            }
          />
        )}
      </SettingsGroup>
    </div>
  );
}
