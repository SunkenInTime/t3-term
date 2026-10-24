// Picks the environment that receives t3-term's client traces and keeps the
// exporter pointed at it (web/observability/clientTracing.ts). Web sends them to
// its primary environment once authenticated (routes/__root.tsx,
// AuthenticatedTracingBootstrap). t3-term's nearest equivalent is the environment
// named on the command line, else the first saved one, once its connection is
// prepared with a bearer token: the traces route takes the same credential.
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { configureClientTracing } from "../web/observability/clientTracing.ts";
import { environmentCatalog, environmentSession } from "../state/environment.ts";
import { appAtomRegistry } from "./runtime.ts";

// The last token each environment's connection carried. A reconnect clears the
// prepared connection for a moment, and an export then must not go out unsigned.
const lastBearerTokens = new Map<EnvironmentId, string>();

function bearerTokenOf(environmentId: EnvironmentId): string | null {
  const prepared = Option.getOrNull(appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)));
  if (prepared?.httpAuthorization?._tag === "Bearer") lastBearerTokens.set(environmentId, prepared.httpAuthorization.token);
  return lastBearerTokens.get(environmentId) ?? null;
}

export function startClientTracing(options: {
  readonly preferredEnvironmentId: EnvironmentId | null;
  readonly mode: "terminal" | "window";
}): () => void {
  let selected: EnvironmentId | null = null;
  let unsubscribePrepared: (() => void) | null = null;

  const configureFor = (environmentId: EnvironmentId | null) => {
    if (environmentId === null) {
      void configureClientTracing({ target: null, mode: options.mode });
      return;
    }
    const prepared = Option.getOrNull(appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)));
    // Same reason: while reconnecting, the exporter keeps its target (and retries)
    // rather than dropping the spans it holds.
    if (prepared === null || bearerTokenOf(environmentId) === null) return;
    void configureClientTracing({
      target: { httpBaseUrl: prepared.httpBaseUrl, bearerToken: () => bearerTokenOf(environmentId) },
      mode: options.mode,
    });
  };

  const select = () => {
    const ids = [...appAtomRegistry.get(environmentCatalog.catalogValueAtom).entries.keys()];
    const next =
      options.preferredEnvironmentId !== null && ids.includes(options.preferredEnvironmentId)
        ? options.preferredEnvironmentId
        : (ids[0] ?? null);
    if (next === selected) return;
    selected = next;
    unsubscribePrepared?.();
    unsubscribePrepared =
      next === null
        ? null
        : appAtomRegistry.subscribe(environmentSession.preparedConnectionValueAtom(next), () => configureFor(next));
    configureFor(next);
  };

  const unsubscribeCatalog = appAtomRegistry.subscribe(environmentCatalog.catalogValueAtom, select);
  select();
  return () => {
    unsubscribeCatalog();
    unsubscribePrepared?.();
    void configureClientTracing({ target: null, mode: options.mode });
  };
}
