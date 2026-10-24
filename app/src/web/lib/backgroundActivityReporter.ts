// Ported from vendor/t3code/apps/web/src/lib/backgroundActivityReporter.ts.
// The scope bookkeeping and report loop are web's. The browser signals are swapped
// for runtime/windowActivity.ts: window focus and minimized state from the OS where
// it can tell, user input from the gpuix event stream, the client id from a file.
// The contract has no terminal client kind, so t3-term reports "unknown".
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  EnvironmentRpcSubscriptionObserver,
  request,
  type EnvironmentRpcSubscriptionObservation,
} from "@t3tools/client-runtime/rpc";
import {
  type BackgroundScope,
  type ClientActivityReportInput,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  backgroundActivityClientId,
  onWindowActivityChange,
  onWindowInput,
  readWindowActivity,
} from "../../runtime/windowActivity.ts";

const REPORT_INTERVAL_MS = 25_000;
const LEASE_TTL_MS = 45_000;
const RECENT_INTERACTION_WINDOW_MS = LEASE_TTL_MS;
const BASELINE_SCOPES: ReadonlyArray<BackgroundScope> = [{ type: "provider-status" }];

interface RetainedScope {
  readonly environmentId: EnvironmentId;
  readonly scope: BackgroundScope;
  refCount: number;
}

const retainedScopes = new Map<string, RetainedScope>();
const retainedScopeListeners = new Set<() => void>();

function notifyRetainedScopesChanged(): void {
  for (const listener of retainedScopeListeners) {
    try {
      listener();
    } catch {}
  }
}

function stableScopeKey(environmentId: EnvironmentId, scope: BackgroundScope): string {
  switch (scope.type) {
    case "server-config":
    case "diagnostics":
      return JSON.stringify([environmentId, scope.type]);
    case "provider-status":
      return JSON.stringify([environmentId, scope.type, scope.instanceId ?? null]);
    case "vcs-status":
    case "git-refs":
      return JSON.stringify([environmentId, scope.type, scope.cwd]);
    case "thread":
      return JSON.stringify([environmentId, scope.type, scope.threadId]);
  }
}

function wasRecentlyInteracted(lastInteractionAtMs: number, observedAtMs: number): boolean {
  return (
    lastInteractionAtMs <= observedAtMs &&
    observedAtMs - lastInteractionAtMs <= RECENT_INTERACTION_WINDOW_MS
  );
}

function createActivityReport(
  environmentId: EnvironmentId,
  lastInteractionAtMs: number,
  observedAtMs: number,
): ClientActivityReportInput {
  const scopes = [...BASELINE_SCOPES];
  for (const entry of retainedScopes.values()) {
    if (entry.environmentId === environmentId) {
      scopes.push(entry.scope);
    }
  }
  const window = readWindowActivity();
  return {
    environmentId,
    clientId: backgroundActivityClientId(),
    clientKind: "unknown",
    visible: window.visible,
    focused: window.focused,
    recentlyInteracted: wasRecentlyInteracted(lastInteractionAtMs, observedAtMs),
    appState: window.visible ? "active" : "background",
    scopes,
    ttlMs: LEASE_TTL_MS,
    observedAt: DateTime.makeUnsafe(observedAtMs),
  };
}

function scopeForSubscription(
  observation: EnvironmentRpcSubscriptionObservation,
): BackgroundScope | null {
  if (observation.method === WS_METHODS.subscribeResourceTelemetry) {
    return { type: "diagnostics" };
  }
  if (observation.method !== WS_METHODS.subscribeVcsStatus) {
    return null;
  }
  const input = observation.input as { readonly cwd?: unknown; readonly includeRemote?: unknown };
  if (input.includeRemote === false) return null;
  return typeof input.cwd === "string" ? { type: "vcs-status", cwd: input.cwd } : null;
}

function retainBackgroundScope(environmentId: EnvironmentId, scope: BackgroundScope): () => void {
  const key = stableScopeKey(environmentId, scope);
  const existing = retainedScopes.get(key);
  if (existing) {
    existing.refCount += 1;
  } else {
    retainedScopes.set(key, { environmentId, scope, refCount: 1 });
    notifyRetainedScopesChanged();
  }

  return () => {
    const current = retainedScopes.get(key);
    if (!current) return;
    current.refCount -= 1;
    if (current.refCount <= 0) {
      retainedScopes.delete(key);
      notifyRetainedScopesChanged();
    }
  };
}

export function observeBackgroundActivitySubscription(
  observation: EnvironmentRpcSubscriptionObservation,
): Effect.Effect<Effect.Effect<void>> {
  const scope = scopeForSubscription(observation);
  if (scope === null) {
    return Effect.succeed(Effect.void);
  }
  return Effect.sync(() => {
    const release = retainBackgroundScope(observation.environmentId as EnvironmentId, scope);
    return Effect.sync(release);
  });
}

export function retainedBackgroundScopes(
  environmentId: EnvironmentId,
): ReadonlyArray<BackgroundScope> {
  return Array.from(retainedScopes.values(), (entry) =>
    entry.environmentId === environmentId ? entry.scope : null,
  ).filter((scope): scope is BackgroundScope => scope !== null);
}

export const layerObserver = Layer.succeed(
  EnvironmentRpcSubscriptionObserver,
  EnvironmentRpcSubscriptionObserver.of({
    observe: observeBackgroundActivitySubscription,
  }),
);

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const clock = yield* Clock.Clock;
    const reportRequests = yield* Queue.sliding<void>(1);
    const requestReport = () => Queue.offerUnsafe(reportRequests, undefined);
    let lastInteractionAtMs = clock.currentTimeMillisUnsafe();
    const recordInteraction = () => {
      const observedAtMs = clock.currentTimeMillisUnsafe();
      const wasRecent = wasRecentlyInteracted(lastInteractionAtMs, observedAtMs);
      lastInteractionAtMs = observedAtMs;
      if (!wasRecent) {
        requestReport();
      }
    };

    const report = Effect.gen(function* () {
      const observedAtMs = yield* Clock.currentTimeMillis;
      const entries = yield* SubscriptionRef.get(registry.entries);
      yield* Effect.forEach(
        entries.keys(),
        (environmentId) =>
          registry
            .run(
              environmentId,
              request(
                WS_METHODS.serverReportClientActivity,
                createActivityReport(environmentId, lastInteractionAtMs, observedAtMs),
              ),
            )
            // Not `ignore`: tearing down an environment mid-request interrupts its report,
            // and an interrupt leaking out here would end the reporting loop for good.
            .pipe(Effect.ignoreCause),
        { concurrency: "unbounded", discard: true },
      );
    }).pipe(Effect.withSpan("t3term.backgroundActivity.report"));

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        retainedScopeListeners.add(requestReport);
        return [onWindowActivityChange(requestReport), onWindowInput(recordInteraction)] as const;
      }),
      (unsubscribers) =>
        Effect.sync(() => {
          retainedScopeListeners.delete(requestReport);
          for (const unsubscribe of unsubscribers) unsubscribe();
        }),
    );

    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.runForEach(() => Effect.sync(requestReport)),
      Effect.forkScoped,
    );
    yield* Stream.fromQueue(reportRequests).pipe(
      Stream.debounce("250 millis"),
      Stream.runForEach(() => report),
      Effect.forkScoped,
    );
    yield* Effect.sync(requestReport).pipe(
      Effect.repeat(Schedule.spaced(`${REPORT_INTERVAL_MS} millis`)),
      Effect.forkScoped,
    );
  }),
);
