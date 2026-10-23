// Connections page wiring: the auth access subscription (apps/web/src/state/auth.ts),
// the primary environment's auth HTTP endpoints (apps/web/src/environments/primary/auth.ts),
// and pairing a new environment (ConnectionOnboarding.registerPairing, the same
// command app/src/connect/bootstrap.ts uses).
import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import { createAuthEnvironmentAtoms } from "@t3tools/client-runtime/state/auth";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  AuthGrantScope,
  AuthPairingCredentialResult,
  AuthSessionId,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { appAtomRegistry, connectionAtomRuntime } from "../../runtime/runtime.ts";
import { environmentSession } from "../../state/environment.ts";

export const authEnvironment = createAuthEnvironmentAtoms(connectionAtomRuntime);

export const registerPairing = createRuntimeCommand(connectionAtomRuntime, {
  label: "t3term:settings:register-pairing",
  execute: (input: ConnectionOnboarding.PairingConnectionInput) =>
    ConnectionOnboarding.ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.registerPairing(input))),
});

class EnvironmentRequestError extends Error {}

/** POST to an environment's HTTP API with the connection's own bearer token. */
async function postEnvironment<A>(environmentId: EnvironmentId, path: string, payload?: unknown): Promise<A> {
  const prepared = Option.getOrNull(appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)));
  if (!prepared) throw new EnvironmentRequestError("Reconnect this environment and try again.");
  const authorization = prepared.httpAuthorization;
  if (authorization?._tag !== "Bearer") {
    throw new EnvironmentRequestError("This connection's credentials can't be used for access management.");
  }
  const response = await fetch(new URL(path, prepared.httpBaseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${authorization.token}`, "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = `The server answered ${response.status}.`;
    try {
      const body = JSON.parse(text) as { message?: unknown };
      if (typeof body.message === "string" && body.message.trim()) message = body.message;
    } catch {}
    throw new EnvironmentRequestError(message);
  }
  return (text ? JSON.parse(text) : undefined) as A;
}

export function createPairingCredential(
  environmentId: EnvironmentId,
  input: { readonly label?: string; readonly scopes?: ReadonlyArray<AuthGrantScope> },
): Promise<AuthPairingCredentialResult> {
  const label = input.label?.trim();
  return postEnvironment(environmentId, "/api/auth/pairing-token", {
    ...(label ? { label } : {}),
    ...(input.scopes ? { scopes: input.scopes } : {}),
  });
}

export function revokePairingLink(environmentId: EnvironmentId, id: string): Promise<void> {
  return postEnvironment(environmentId, "/api/auth/pairing-links/revoke", { id });
}

export function revokeClientSession(environmentId: EnvironmentId, sessionId: AuthSessionId): Promise<void> {
  return postEnvironment(environmentId, "/api/auth/clients/revoke", { sessionId });
}

export async function revokeOtherClientSessions(environmentId: EnvironmentId): Promise<number> {
  const result = await postEnvironment<{ revokedCount: number }>(environmentId, "/api/auth/clients/revoke-others");
  return result.revokedCount;
}
