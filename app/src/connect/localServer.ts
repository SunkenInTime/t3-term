import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
} from "@t3tools/client-runtime/connection";
import { BearerConnectionTarget } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";

export interface EnvironmentDescriptor {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export async function fetchDescriptor(httpBaseUrl: string): Promise<EnvironmentDescriptor> {
  const response = await fetch(new URL("/.well-known/t3/environment", httpBaseUrl));
  if (!response.ok) throw new Error(`${httpBaseUrl} answered ${response.status} for its descriptor`);
  return (await response.json()) as EnvironmentDescriptor;
}

export function wsBaseUrlFor(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

/** A saved bearer route to one server, the same record pairing produces. */
export function bearerRegistration(input: {
  readonly descriptor: EnvironmentDescriptor;
  readonly httpBaseUrl: string;
  readonly token: string;
}): BearerConnectionRegistration {
  const origin = new URL(input.httpBaseUrl).origin;
  const connectionId = `bearer:${input.descriptor.environmentId}:${origin}`;
  return new BearerConnectionRegistration({
    target: new BearerConnectionTarget({
      environmentId: input.descriptor.environmentId,
      label: input.descriptor.label,
      connectionId,
    }),
    profile: new BearerConnectionProfile({
      connectionId,
      environmentId: input.descriptor.environmentId,
      label: input.descriptor.label,
      httpBaseUrl: origin,
      wsBaseUrl: wsBaseUrlFor(origin),
    }),
    credential: new BearerConnectionCredential({ token: input.token }),
  });
}
