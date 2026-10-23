import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import { createRuntimeCommand, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import { environmentCatalog } from "../state/environment.ts";
import { bearerRegistration, fetchDescriptor } from "./localServer.ts";

export interface Args {
  readonly url: string | undefined;
  readonly token: string | undefined;
  readonly pair: string | undefined;
  readonly terminal: boolean | undefined;
  readonly help: boolean;
}

export function parseArgs(argv: ReadonlyArray<string>): Args {
  let url: string | undefined;
  let token: string | undefined;
  let pair: string | undefined;
  let terminal: boolean | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") url = argv[++i];
    else if (arg === "--token") token = argv[++i];
    else if (arg === "--pair") pair = argv[++i];
    else if (arg === "--terminal") terminal = true;
    else if (arg === "--window") terminal = false;
    else if (arg === "--help" || arg === "-h") help = true;
  }
  return {
    url,
    token: token ?? process.env.T3TERM_TOKEN,
    pair,
    terminal,
    help,
  };
}

const registerPairing = createRuntimeCommand(connectionAtomRuntime, {
  label: "t3term:register-pairing",
  execute: (input: ConnectionOnboarding.PairingConnectionInput) =>
    ConnectionOnboarding.ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerPairing(input)),
    ),
});

export interface Boot {
  /** The environment the command line pointed at, if any. */
  readonly environmentId: EnvironmentId | null;
  readonly error: string | null;
}

/**
 * Registers the environment named on the command line. Saved environments
 * reconnect on their own once the catalog atom mounts.
 */
export async function bootstrapConnections(args: Args): Promise<Boot> {
  try {
    if (args.url && args.token) {
      const descriptor = await fetchDescriptor(args.url);
      const result = await runAtomCommand(
        appAtomRegistry,
        environmentCatalog.register,
        bearerRegistration({ descriptor, httpBaseUrl: args.url, token: args.token }),
      );
      if (result._tag === "Failure") throw new Error(String(result.cause));
      return { environmentId: descriptor.environmentId, error: null };
    }
    if (args.pair) {
      const input = /^https?:\/\//.test(args.pair) && args.pair.includes("#")
        ? { pairingUrl: args.pair }
        : { host: args.url ?? "", pairingCode: args.pair };
      const result = await runAtomCommand(appAtomRegistry, registerPairing, input);
      if (result._tag === "Failure") throw new Error(String(result.cause));
      return { environmentId: result.value, error: null };
    }
    return { environmentId: null, error: null };
  } catch (error) {
    return { environmentId: null, error: error instanceof Error ? error.message : String(error) };
  }
}
