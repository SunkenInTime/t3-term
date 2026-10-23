// Connect screen gate and per-environment connection presentation.
import {
  AVAILABLE_CONNECTION_STATE,
  type ConnectionCatalogEntry,
  type EnvironmentConnectionPresentation,
  presentEnvironmentConnection,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog, serverEnvironment } from "./environment.ts";

/**
 * "connect" when the saved catalog has loaded and is empty. Web's hosted client
 * shows its empty state on the same condition (`_chat.index.tsx`:
 * `isReady && environments.length === 0`).
 */
export type ConnectGate = "pending" | "connect" | "app";

export const connectGateAtom = Atom.make((get): ConnectGate => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  if (!catalog.isReady) return "pending";
  return catalog.entries.size === 0 ? "connect" : "app";
}).pipe(Atom.withLabel("t3term-connect-gate"));

/** The pieces of web's `EnvironmentPresentation` the connection banners read. */
export interface EnvironmentConnectionView {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly entry: ConnectionCatalogEntry;
  readonly state: SupervisorConnectionState;
  readonly connection: EnvironmentConnectionPresentation;
  readonly serverVersion: string | null;
}

/** Mirrors apps/web/src/state/server.ts `environmentConnectionsAtom` for one environment. */
export const environmentConnectionViewAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): EnvironmentConnectionView | null => {
    const entry = get(environmentCatalog.catalogValueAtom).entries.get(environmentId);
    if (entry === undefined) return null;
    const state = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    return {
      environmentId,
      label: entry.target.label,
      entry,
      state,
      connection:
        entry.unsupportedReason === undefined
          ? presentEnvironmentConnection(state)
          : { phase: "unsupported", error: entry.unsupportedReason, traceId: null },
      serverVersion:
        get(serverEnvironment.configValueAtom(environmentId))?.environment.serverVersion ?? null,
    };
  }).pipe(Atom.withLabel(`t3term-environment-connection:${environmentId}`)),
);
