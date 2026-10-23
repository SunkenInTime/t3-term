// Usage page state. The usage query wiring is ported from apps/web/src/state/usage.ts;
// the page-preference atoms let keyboard shortcuts drive the page from outside it.
import { useAtomValue } from "@effect/atom-react";
import {
  type AuthEnvironmentScope,
  type AuthSessionState,
  AuthDiagnosticsReadScope,
  AuthSettingsWriteScope,
  USAGE_CONTRACT_VERSION,
  sessionGrantsScope,
  type EnvironmentId,
  type UsageBucket,
  type UsageSummary,
  type UsageProviderKind,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { needsCursorKeychainAccess, refreshUsage } from "@t3tools/client-runtime/state/usage";
import { resolveUsageAccess } from "@t3tools/client-runtime/state/usage-access";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";

import { mergeUsage, type EnvironmentUsage, type MergedUsage } from "@t3tools/shared/usageMerge";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentSession, serverEnvironment } from "./environment.ts";
import { environmentPresentations } from "./navigation.ts";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsagePagePreferences,
} from "../web/components/usage/usagePagePreferences.ts";
import {
  METRIC_OPTIONS,
  WINDOW_OPTIONS,
  type UsageMetric,
} from "../web/components/usage/usageShortcuts.ts";
import type { UsagePriceTarget } from "../web/components/usage/usagePriceTargets.ts";

export { environmentPresentations };

// ── Session scopes (apps/web/src/state/session.ts) ─────────────────────

const EMPTY_SESSION_STATE_ATOM = Atom.make(AsyncResult.initial<AuthSessionState>());

function sessionHasScope(
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
  scope: AuthEnvironmentScope,
): boolean {
  const session = Option.getOrNull(AsyncResult.value(result));
  return result._tag !== "Failure" && session !== null && sessionGrantsScope(session, scope);
}

export function useEnvironmentScope(
  environmentId: EnvironmentId | null,
  scope: AuthEnvironmentScope,
): boolean {
  const result = useAtomValue(
    environmentId === null
      ? EMPTY_SESSION_STATE_ATOM
      : environmentSession.sessionStateAtom(environmentId),
  );
  return sessionHasScope(result, scope);
}

export function readEnvironmentScope(
  environmentId: EnvironmentId,
  scope: AuthEnvironmentScope,
): boolean {
  return sessionHasScope(
    appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId)),
    scope,
  );
}

// ── Usage per window (apps/web/src/state/usage.ts) ─────────────────────

export interface EnvironmentUsageStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  readonly canReadDiagnostics: boolean;
  readonly isConnected: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
  readonly needsCursorKeychainAccess: boolean;
}

const usageByWindowAtom = Atom.family((windowKey: string) =>
  Atom.make((get): readonly EnvironmentUsageStatus[] => {
    const input = JSON.parse(windowKey) as UsageSummaryInput;
    const presentations = get(environmentPresentations.presentationsAtom);

    const statuses: EnvironmentUsageStatus[] = [];
    for (const [environmentId, presentation] of presentations) {
      const isConnected = presentation.connection.phase === "connected";
      const sessionResult = get(environmentSession.sessionStateAtom(environmentId));
      const access = resolveUsageAccess({
        connectionPhase: presentation.connection.phase,
        session: Option.getOrNull(AsyncResult.value(sessionResult)),
        hasSessionError: sessionResult._tag === "Failure",
      });
      if (!access.canReadDiagnostics) {
        statuses.push({
          environmentId,
          label: presentation.entry.target.label,
          isConnected,
          ...access,
          summary: null,
          needsCursorKeychainAccess: false,
        });
        continue;
      }
      const result = get(serverEnvironment.usageSummary({ environmentId, input }));
      const summary = Option.getOrNull(AsyncResult.value(result));
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        isPending: result.waiting,
        canReadDiagnostics: true,
        isConnected,
        error: result._tag === "Failure" ? "This environment could not report usage." : null,
        summary,
        needsCursorKeychainAccess: needsCursorKeychainAccess(
          summary,
          get(serverEnvironment.providersValueAtom(environmentId)),
        ),
      });
    }
    return statuses;
  }).pipe(Atom.withLabel(`t3term-usage:window:${windowKey}`)),
);

export interface UsageView {
  readonly merged: MergedUsage;
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly isPending: boolean;
  readonly shown: { readonly window: UsageSummaryInput; readonly merged: MergedUsage } | null;
  readonly isPartial: boolean;
  readonly refresh: (input?: UsageSummaryInput) => Promise<void>;
}

export function mergeAnsweredUsage(
  environments: readonly EnvironmentUsageStatus[],
  keepBucket?: (bucket: UsageBucket) => boolean,
): MergedUsage {
  const answered: EnvironmentUsage[] = environments.flatMap(({ environmentId, label, summary }) =>
    summary === null
      ? []
      : [
          {
            environmentId,
            label,
            summary:
              keepBucket === undefined
                ? summary
                : { ...summary, buckets: summary.buckets.filter(keepBucket) },
          },
        ],
  );
  return mergeUsage(answered, USAGE_CONTRACT_VERSION);
}

const NO_HIDDEN_PROVIDERS: ReadonlySet<UsageProviderKind> = new Set();

function withoutProviders(
  environments: readonly EnvironmentUsageStatus[],
  hiddenProviders: ReadonlySet<UsageProviderKind>,
): readonly EnvironmentUsageStatus[] {
  if (hiddenProviders.size === 0) return environments;
  return environments.map((environment) =>
    environment.summary === null
      ? environment
      : {
          ...environment,
          summary: {
            ...environment.summary,
            buckets: environment.summary.buckets.filter(
              (bucket) => !hiddenProviders.has(bucket.provider),
            ),
            sources: environment.summary.sources.filter(
              (source) => !hiddenProviders.has(source.fingerprint.provider),
            ),
          },
        },
  );
}

function deriveSelection(
  environments: readonly EnvironmentUsageStatus[],
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null,
  hiddenProviders: ReadonlySet<UsageProviderKind>,
) {
  const selectedEnvironments =
    selectedEnvironmentIds === null
      ? environments
      : environments.filter((environment) => selectedEnvironmentIds.has(environment.environmentId));
  return {
    environments,
    selectedEnvironmentIds,
    hiddenProviders,
    selectedEnvironments,
    merged: mergeAnsweredUsage(withoutProviders(selectedEnvironments, hiddenProviders)),
  };
}

export function useUsage(
  input: UsageSummaryInput,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null = null,
  hiddenProviders: ReadonlySet<UsageProviderKind> = NO_HIDDEN_PROVIDERS,
): UsageView {
  const windowKey = JSON.stringify({
    sinceDay: input.sinceDay,
    untilDay: input.untilDay,
    timeZone: input.timeZone,
    resolution: input.resolution,
    sinceTime: input.sinceTime,
    untilTime: input.untilTime,
  });
  const atom = usageByWindowAtom(windowKey);
  const environments = useAtomValue(atom);
  // The render-time sync below compares merged by identity, so the derivation is
  // held in state keyed on its inputs rather than rebuilt every render.
  const [derived, setDerived] = useState(() =>
    deriveSelection(environments, selectedEnvironmentIds, hiddenProviders),
  );
  let current = derived;
  if (
    derived.environments !== environments ||
    derived.selectedEnvironmentIds !== selectedEnvironmentIds ||
    derived.hiddenProviders !== hiddenProviders
  ) {
    current = deriveSelection(environments, selectedEnvironmentIds, hiddenProviders);
    setDerived(current);
  }
  const { selectedEnvironments, merged } = current;

  const refresh = (nextInput?: UsageSummaryInput) =>
    refreshUsage({
      registry: appAtomRegistry,
      server: serverEnvironment,
      presentations: environmentPresentations,
      environmentIds: selectedEnvironments
        .filter(
          (environment) =>
            environment.canReadDiagnostics &&
            readEnvironmentScope(environment.environmentId, AuthDiagnosticsReadScope),
        )
        .map(({ environmentId }) => environmentId),
      input: nextInput ?? (JSON.parse(windowKey) as UsageSummaryInput),
    });

  const answeredCount = selectedEnvironments.filter(
    (environment) => environment.summary !== null,
  ).length;
  const stillReporting = selectedEnvironments.filter(
    (environment) => environment.summary === null && environment.error === null,
  ).length;
  const isPending = answeredCount === 0 && stillReporting > 0;

  const [lastAnswered, setLastAnswered] = useState<
    | (NonNullable<UsageView["shown"]> & {
        readonly selection: typeof selectedEnvironmentIds;
        readonly hidden: typeof hiddenProviders;
      })
    | null
  >(null);
  if (
    answeredCount > 0 &&
    (lastAnswered?.merged !== merged ||
      lastAnswered.window !== input ||
      lastAnswered.selection !== selectedEnvironmentIds ||
      lastAnswered.hidden !== hiddenProviders)
  ) {
    setLastAnswered({
      window: input,
      merged,
      selection: selectedEnvironmentIds,
      hidden: hiddenProviders,
    });
  }
  const kept =
    lastAnswered?.selection === selectedEnvironmentIds && lastAnswered.hidden === hiddenProviders
      ? lastAnswered
      : null;
  const shown =
    answeredCount > 0
      ? { window: input, merged }
      : (kept ?? (isPending ? null : { window: input, merged }));

  return {
    merged,
    environments,
    selectedEnvironments,
    isPending,
    shown,
    isPartial: answeredCount > 0 && stillReporting > 0,
    refresh,
  };
}

// ── Page preferences (web keeps these in UsagePage component state) ─────

/** Metric, period and hidden providers; persisted like web's localStorage entry. */
export const usagePagePreferencesAtom = Atom.make<UsagePagePreferences>(
  readUsagePagePreferences(),
).pipe(Atom.keepAlive, Atom.withLabel("usage:page-preferences"));

export function updateUsagePagePreferences(patch: Partial<UsagePagePreferences>): void {
  const next = { ...appAtomRegistry.get(usagePagePreferencesAtom), ...patch };
  appAtomRegistry.set(usagePagePreferencesAtom, next);
  saveUsagePagePreferences(next);
}

export function selectUsageMetric(metric: UsageMetric): void {
  updateUsagePagePreferences({ metric });
}

function isUsageWindowDays(value: number): value is UsagePagePreferences["windowDays"] {
  return WINDOW_OPTIONS.some((option) => option.days === value);
}

export function selectUsageWindow(days: number): void {
  if (!isUsageWindowDays(days)) return;
  updateUsagePagePreferences({ windowDays: days });
}

/**
 * Applies a `usage.*` keybinding command the way web's page-level keydown
 * listener does. A period command while Limits shows is consumed but ignored.
 */
export function applyUsageShortcutCommand(command: string): boolean {
  const metricOption = METRIC_OPTIONS.find((option) => option.command === command);
  const periodOption = WINDOW_OPTIONS.find((option) => option.command === command);
  if (!metricOption && !periodOption) return false;
  const showingLimits = appAtomRegistry.get(usagePagePreferencesAtom).metric === "limits";
  if (metricOption) selectUsageMetric(metricOption.value);
  if (periodOption && !showingLimits) selectUsageWindow(periodOption.days);
  return true;
}

/**
 * The model whose detail dialog is open. It lives outside UsagePage so opening
 * or closing the dialog renders only its host, not the whole usage page.
 */
export const selectedUsageModelKeyAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("usage:selected-model-key"),
);

export function selectUsageModel(key: string | null): void {
  appAtomRegistry.set(selectedUsageModelKeyAtom, key);
}

// ── Price override destinations (apps/web/src/components/usage/UsagePriceOverrides.tsx) ──

export const usagePriceTargetsAtom = Atom.make((get): readonly UsagePriceTarget[] =>
  [...get(environmentPresentations.presentationsAtom)].map(([environmentId, environment]) => {
    const settings = get(serverEnvironment.settingsValueAtom(environmentId));
    const session = get(environmentSession.sessionStateAtom(environmentId));
    const sessionData = Option.getOrNull(AsyncResult.value(session));
    const access =
      session._tag === "Failure"
        ? "denied"
        : sessionData === null
          ? session.waiting
            ? "pending"
            : "denied"
          : sessionGrantsScope(sessionData, AuthSettingsWriteScope)
            ? "granted"
            : "denied";
    return {
      environmentId,
      label: environment.entry.target.label,
      prices: settings?.usagePriceOverrides ?? null,
      aliases:
        environment.serverConfig?.environment.capabilities.usageModelAliases === true
          ? (settings?.usageModelAliases ?? null)
          : null,
      unavailable:
        environment.connection.phase !== "connected"
          ? "Offline"
          : settings === null
            ? "Prices not loaded"
            : environment.serverConfig?.environment.capabilities.usagePriceOverrides !== true
              ? "Update server to edit prices"
              : access === "pending"
                ? "Checking permissions…"
                : access === "denied"
                  ? "Read-only access"
                  : null,
    };
  }),
).pipe(Atom.withLabel("usage:price-targets"));
