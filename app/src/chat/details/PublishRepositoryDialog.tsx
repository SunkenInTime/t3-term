// Port of PublishRepositoryDialog in apps/web/src/components/GitActionsControl.tsx:
// a three-step wizard (Provider, Repository, Summary) that creates a hosted
// repository and pushes the current branch.
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  SourceControlCloneProtocol,
  SourceControlProviderDiscoveryItem,
  SourceControlProviderKind,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryVisibility,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { sourceControlEnvironment, vcsActionManager } from "../../state/git.ts";
import { routeAtom } from "../../state/ui.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Dialog } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { openWithOs } from "../header/osActions.ts";
import { TextField } from "./formControls.tsx";

const PROVIDER_OPTIONS = sourceControlClients.definitions.map((definition) => ({
  value: definition.kind as SourceControlProviderKind,
  label: definition.pickerLabel,
  pathPlaceholder: definition.repositoryPathHint,
  definition,
  icon: (definition.icon === "github" ? "brand-github" : definition.icon === "gitlab" ? "gitlab" : "git-pull-request") as IconName,
}));

function readiness(provider: SourceControlProviderKind, discovered: ReadonlyArray<SourceControlProviderDiscoveryItem>) {
  const item = discovered.find((candidate) => candidate.kind === provider);
  if (!item) return { ready: false, hint: "Provider status unavailable. Open Settings -> Source Control and rescan." };
  if (item.status !== "available") return { ready: false, hint: item.installHint };
  if (item.auth.status === "unauthenticated") {
    return {
      ready: false,
      hint: Option.getOrNull(item.auth.detail) ?? `${item.label} is not authenticated. Open Settings -> Source Control for setup guidance.`,
    };
  }
  return { ready: true, hint: null as string | null };
}

function Card({
  selected,
  disabled,
  onClick,
  children,
  testId,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 12,
        paddingBottom: 12,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: selected ? alpha(theme.primary, 0.3) : "#00000000",
        backgroundColor: selected ? alpha(theme.primary, 0.1) : alpha("#ffffff", 0.035),
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled || selected ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      {children}
    </div>
  );
}

export function PublishRepositoryDialog({
  open,
  onOpenChange,
  environmentId,
  gitCwd,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId;
  gitCwd: string;
  onPublished: () => void;
}) {
  const theme = useTheme();
  const discovery = useEnvironmentQuery(open ? sourceControlEnvironment.discovery({ environmentId, input: {} }) : null);
  const discovered = discovery.data?.sourceControlProviders ?? [];
  const [selected, setSelected] = useState<SourceControlProviderKind | null>(null);
  const [repositoryOverride, setRepositoryOverride] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<SourceControlRepositoryVisibility>("private");
  const [remoteName, setRemoteName] = useState("origin");
  const [protocol, setProtocol] = useState<SourceControlCloneProtocol>("ssh");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SourceControlPublishRepositoryResult | null>(null);

  const sorted = PROVIDER_OPTIONS.toSorted((left, right) => {
    const l = readiness(left.value, discovered).ready;
    const r = readiness(right.value, discovered).ready;
    if (l !== r) return l ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
  const firstReady = sorted.find((option) => readiness(option.value, discovered).ready)?.value;
  const provider =
    selected !== null && readiness(selected, discovered).ready
      ? selected
      : (firstReady ?? selected ?? (sourceControlClients.get(undefined).kind as SourceControlProviderKind));
  const providerReady = readiness(provider, discovered).ready;
  const current = PROVIDER_OPTIONS.find((option) => option.value === provider) ?? PROVIDER_OPTIONS[0]!;
  const discoveredProvider = discovered.find((item) => item.kind === provider);
  const account = discoveredProvider ? Option.getOrNull(discoveredProvider.auth.account) : null;
  const repository = repositoryOverride ?? (account ? `${account}/` : "");
  const host = current.definition.publishHost(discoveredProvider ? Option.getOrNull(discoveredProvider.auth.host) : null);
  const parts = repository.trim().split("/");
  const owner = parts[0]?.trim() ?? "";
  const name = parts.slice(1).join("/").trim();
  const canSubmit = providerReady && !pending && owner.length > 0 && name.length > 0;

  const reset = () => {
    setRemoteName("origin");
    setRepositoryOverride(null);
    setStep(0);
    setAdvancedOpen(false);
    setError(null);
    setResult(null);
  };
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setPending(true);
    const scope = { environmentId, cwd: gitCwd };
    const outcome = await vcsActionManager.track(appAtomRegistry, scope, { operation: "publish_repository", label: "Publishing repository" }, () =>
      runAtomCommand(
        appAtomRegistry,
        sourceControlEnvironment.publishRepository,
        {
          environmentId,
          input: { cwd: gitCwd, provider, repository: repository.trim(), visibility, remoteName: remoteName.trim() || "origin", protocol },
        } as never,
        { reportFailure: false },
      ),
    );
    setPending(false);
    if (outcome._tag === "Failure") {
      if (!isAtomCommandInterrupted(outcome)) {
        const failure = squashAtomCommandFailure(outcome);
        setError(failure instanceof Error ? failure.message : "An error occurred.");
      }
      return;
    }
    setResult(outcome.value as SourceControlPublishRepositoryResult);
    setStep(2);
    onPublished();
  };

  const steps = ["Provider", "Repository", "Summary"] as const;
  const summaries = [current.label, result?.repository.nameWithOwner ?? null, null];

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Publish repository"
      description="Pick where to host it, then point us at a repo to push to."
      testId="publish-dialog"
      showCloseButton
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          {steps.map((label, index) => (
            <div
              key={label}
              onClick={index < step && step !== 2 ? () => setStep(index) : undefined}
              style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 0 }}
            >
              <div style={{ height: 2, borderRadius: 1, backgroundColor: index <= step ? theme.primary : theme.input }} />
              <Text size="xs" weight={500} color={index === step ? theme.foreground : theme.mutedForeground}>
                {`${index + 1}. ${label}`}
              </Text>
              {summaries[index] && index < step ? (
                <Text size="xs" color={theme.mutedForeground} truncate>
                  {summaries[index]!}
                </Text>
              ) : null}
            </div>
          ))}
        </div>

        {step === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Text size="xs" weight={500}>
              Provider
            </Text>
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {sorted.map((option) => {
                const ready = readiness(option.value, discovered);
                return (
                  <div key={option.value} style={{ display: "flex", width: "48%" }}>
                    <Card
                      selected={ready.ready && provider === option.value}
                      disabled={!ready.ready}
                      onClick={() => {
                        setSelected(option.value);
                        setRepositoryOverride(null);
                      }}
                      testId={`publish-provider-${option.value}`}
                    >
                      <Icon name={option.icon} size={20} color={ready.ready ? theme.foreground : theme.mutedForeground} />
                      <Text weight={500} truncate style={{ flexGrow: 1 }}>
                        {option.label}
                      </Text>
                      {!ready.ready ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            close(false);
                            appAtomRegistry.set(routeAtom, { kind: "settings", page: "source-control" });
                          }}
                        >
                          Setup Required
                        </Button>
                      ) : null}
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Text size="xs" weight={500}>
                Repository
              </Text>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 0 }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    height: 32,
                    paddingLeft: 10,
                    paddingRight: 10,
                    borderWidth: 1,
                    borderColor: theme.input,
                    borderTopLeftRadius: RADIUS.sm,
                    borderBottomLeftRadius: RADIUS.sm,
                    backgroundColor: alpha(theme.muted, 0.5),
                  }}
                >
                  <Icon name={current.icon} size={14} color={theme.mutedForeground} />
                  <text style={{ color: theme.mutedForeground, fontSize: 12, fontFamily: FONTS.mono }}>{`${host}/`}</text>
                </div>
                <TextField
                  testId="publish-repository"
                  mono
                  value={repository}
                  onChange={setRepositoryOverride}
                  placeholder={current.pathPlaceholder}
                  style={{ flexGrow: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeftWidth: 0 }}
                />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Text size="xs" weight={500}>
                Visibility
              </Text>
              <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
                {(
                  [
                    { value: "private", label: "Private", description: "Only invited people", icon: "lock" },
                    { value: "public", label: "Public", description: "Anyone on the web", icon: "globe" },
                  ] as const
                ).map((option) => (
                  <Card key={option.value} selected={visibility === option.value} onClick={() => setVisibility(option.value)}>
                    <Icon name={option.icon} size={16} color={theme.mutedForeground} />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <Text weight={500}>{option.label}</Text>
                      <Text size="xs" color={theme.mutedForeground}>
                        {option.description}
                      </Text>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                onClick={() => setAdvancedOpen(!advancedOpen)}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, cursor: "pointer" }}
              >
                <Icon name={advancedOpen ? "chevron-down" : "chevron-right"} size={14} color={theme.mutedForeground} />
                <Text size="xs" weight={500} color={theme.mutedForeground}>
                  Advanced
                </Text>
              </div>
              {advancedOpen ? (
                <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0 }}>
                    <Text size="xs" weight={500}>
                      Remote
                    </Text>
                    <TextField value={remoteName} onChange={setRemoteName} placeholder="origin" />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0 }}>
                    <Text size="xs" weight={500}>
                      Protocol
                    </Text>
                    <div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
                      {(["ssh", "https"] as const).map((value) => (
                        <Button key={value} size="sm" variant={protocol === value ? "default" : "outline"} onClick={() => setProtocol(value)}>
                          {value.toUpperCase()}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            {pending ? (
              <Text size="xs" color={theme.mutedForeground}>
                {`Publishing repository to ${current.label}...`}
              </Text>
            ) : null}
            {error && !pending ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: 10,
                  borderRadius: RADIUS.sm,
                  borderWidth: 1,
                  borderColor: alpha(theme.error, 0.4),
                  backgroundColor: alpha(theme.error, 0.1),
                }}
              >
                <Text size="xs" weight={500} color={theme.errorForeground}>
                  Publish failed
                </Text>
                <Text size="xs" color={theme.errorForeground}>
                  {error}
                </Text>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          result ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <Icon name="circle-check" size={24} color={theme.successForeground} />
              <Text weight={600}>{result.status === "pushed" ? "Repository published" : "Repository created"}</Text>
              <Text size="xs" color={theme.mutedForeground}>
                {result.status === "pushed"
                  ? `${result.branch} is now live on ${current.label}.`
                  : `Remote "${result.remoteName}" is set up. Make a commit and push it to share your code.`}
              </Text>
              <Button variant="outline" size="sm" onClick={() => openWithOs(result.repository.url)}>
                {`Open on ${current.label}`}
              </Button>
            </div>
          ) : (
            <Text size="xs" color={theme.mutedForeground}>
              Publish result unavailable.
            </Text>
          )
        ) : null}

        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          {step === 2 ? (
            <Button size="sm" onClick={() => close(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => (step === 0 ? close(false) : setStep(step - 1))}>
                {step === 0 ? "Cancel" : "Back"}
              </Button>
              {step < 1 ? (
                <Button size="sm" testId="publish-next" disabled={!providerReady} onClick={() => setStep(1)}>
                  Next
                </Button>
              ) : (
                <Button size="sm" testId="publish-submit" disabled={!canSubmit} onClick={() => void submit()}>
                  {pending ? "Publishing..." : "Publish"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
