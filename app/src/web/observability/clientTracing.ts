// Ported from vendor/t3code/apps/web/src/observability/clientTracing.ts.
// Web exports to its primary environment, the server that served the page, and
// authenticates with that page's cookie or the desktop bearer token. t3-term has
// no page origin, so the caller names the environment (runtime/clientTracingTarget.ts)
// and each export carries that connection's bearer token, read when the request
// is made. The resource names t3-term instead of the web client.
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import { HttpClient, HttpClientRequest } from "effect/http";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/observability";

import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import { settleAsyncResult, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import * as ClientTracer from "./clientTracer.ts";
import { APP_VERSION } from "../../runtime/platform.ts";

const DEFAULT_EXPORT_INTERVAL_MS = 1_000;
const OTLP_TRACES_PATH = "/api/observability/v1/traces";

function clientTracingResource(mode: "terminal" | "window") {
  return {
    serviceName: "t3-term",
    attributes: {
      "service.namespace": "t3code",
      "service.runtime": "t3-term",
      "service.mode": mode,
      "service.version": APP_VERSION,
    },
  } as const;
}

export interface ClientTracingTarget {
  readonly httpBaseUrl: string;
  /** Read for every export, so a replaced credential is picked up without reconfiguring. */
  readonly bearerToken: () => string | null;
}

function layerDelegateRuntime(target: ClientTracingTarget) {
  const layerBearerClient = Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      client.pipe(
        HttpClient.mapRequestEffect((request) =>
          Effect.sync(() => {
            const token = target.bearerToken();
            return token ? HttpClientRequest.bearerToken(request, token) : request;
          }),
        ),
      ),
    ),
  ).pipe(Layer.provide(layerRemoteHttpClient(globalThis.fetch)));
  return Layer.mergeAll(
    layerBearerClient,
    OtlpExporter.layerFlusher,
    OtlpSerialization.layerJson,
    // Export requests must not become spans of their own.
    Layer.succeed(HttpClient.TracerDisabledWhen, () => true),
  );
}

let activeRuntime: ManagedRuntime.ManagedRuntime<never, never> | null = null;
let activeScope: Scope.Closeable | null = null;
let activeConfigKey: string | null = null;
let configurationGeneration = 0;
let pendingConfiguration = Promise.resolve();

export interface ClientTracingConfig {
  readonly target: ClientTracingTarget | null;
  readonly mode: "terminal" | "window";
  readonly exportIntervalMs?: number;
}

export function configureClientTracing(config: ClientTracingConfig): Promise<void> {
  pendingConfiguration = pendingConfiguration.finally(() => applyClientTracingConfig(config));
  return pendingConfiguration;
}

async function applyClientTracingConfig(config: ClientTracingConfig): Promise<void> {
  const otlpTracesUrl = config.target ? new URL(OTLP_TRACES_PATH, config.target.httpBaseUrl).toString() : null;
  const exportIntervalMs = Math.max(10, config.exportIntervalMs ?? DEFAULT_EXPORT_INTERVAL_MS);
  const nextConfigKey = otlpTracesUrl === null ? null : `${otlpTracesUrl}|${exportIntervalMs}`;

  if (activeConfigKey === nextConfigKey && (nextConfigKey === null || ClientTracer.hasDelegate())) {
    return;
  }

  activeConfigKey = nextConfigKey;
  const generation = ++configurationGeneration;

  const previousRuntime = activeRuntime;
  const previousScope = activeScope;

  ClientTracer.setDelegate(null);
  activeRuntime = null;
  activeScope = null;

  await disposeTracerRuntime(previousRuntime, previousScope);

  // No environment to export to: spans stay local until one connects.
  if (config.target === null || otlpTracesUrl === null) return;

  const runtime = ManagedRuntime.make(layerDelegateRuntime(config.target));
  const scope = runtime.runSync(Scope.make());

  const delegateResult = await settleAsyncResult(() =>
    runtime.runPromiseExit(
      Scope.provide(scope)(
        OtlpTracer.make({
          url: otlpTracesUrl,
          exportInterval: `${exportIntervalMs} millis`,
          resource: clientTracingResource(config.mode),
        }),
      ),
    ),
  );
  if (delegateResult._tag === "Failure") {
    await disposeTracerRuntime(runtime, scope);

    if (generation === configurationGeneration) {
      const error = squashAtomCommandFailure(delegateResult);
      const tracesUrl = new URL(otlpTracesUrl);
      console.warn("Failed to configure client tracing exporter", {
        scheme: tracesUrl.protocol.replace(/:$/, ""),
        host: tracesUrl.hostname,
        port: tracesUrl.port || undefined,
        exportIntervalMs,
        ...safeErrorLogAttributes(error),
      });
    }
    return;
  }

  if (generation !== configurationGeneration) {
    await disposeTracerRuntime(runtime, scope);
    return;
  }

  ClientTracer.setDelegate(delegateResult.value);
  activeRuntime = runtime;
  activeScope = scope;
}

async function disposeTracerRuntime(
  runtime: ManagedRuntime.ManagedRuntime<never, never> | null,
  scope: Scope.Closeable | null,
): Promise<void> {
  if (runtime === null || scope === null) {
    return;
  }

  await settleAsyncResult(() => runtime.runPromiseExit(Scope.close(scope, Exit.void)));
  runtime.dispose();
}
