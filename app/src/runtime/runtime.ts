import { Connection } from "@t3tools/client-runtime/connection";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { ShellSnapshotLoader } from "@t3tools/client-runtime/state/shell";
import { PullRequestDiffLoader } from "@t3tools/client-runtime/state/pull-requests";
import {
  BoundedThreadSnapshotLoader,
  ThreadHistoryController,
} from "@t3tools/client-runtime/state/threads";
import { RelayWebClientId } from "@t3tools/contracts/relay";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Socket from "effect/socket/Socket";

import * as Platform from "./platform.ts";

export const appAtomRegistry = AtomRegistry.make();

const layerHttpClient = layerRemoteHttpClient(globalThis.fetch);

const layerCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.promise(async () => {
        const input = new Uint8Array(data.length);
        input.set(data);
        return new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, input));
      }),
  }),
);

// Relay routes need a DPoP key and a T3 Connect session; t3-term connects
// directly, so the signer refuses and the relay client points nowhere.
const layerRelaySigner = Layer.succeed(
  ManagedRelay.ManagedRelayDpopSigner,
  ManagedRelay.ManagedRelayDpopSigner.of({
    thumbprint: Effect.fail(
      new ManagedRelay.ManagedRelayDpopKeyLoadError({ keyStore: "indexed-db", cause: "t3-term has no relay key store" }),
    ),
    createProof: (input) =>
      Effect.fail(
        new ManagedRelay.ManagedRelayDpopProofCreationError({
          method: input.method,
          url: input.url,
          cause: "unsupported",
        }),
      ),
  }),
);

const layerRuntime = Layer.mergeAll(
  layerHttpClient,
  layerCrypto,
  Socket.layerWebSocketConstructorGlobal,
  ManagedRelay.layer({ relayUrl: "http://relay.invalid", clientId: RelayWebClientId }).pipe(
    Layer.provide(Layer.mergeAll(layerHttpClient, layerCrypto, layerRelaySigner)),
  ),
  layerRelaySigner,
);

const layerSnapshotLoader = Layer.mergeAll(
  BoundedThreadSnapshotLoader.layer,
  ShellSnapshotLoader.layer,
  ThreadHistoryController.layer,
  PullRequestDiffLoader.layer,
);

const layerConnection = layerSnapshotLoader.pipe(
  Layer.provideMerge(
    Connection.layerWithOptions({ usageLimitSources: true, usageLimitsCommand: true }),
  ),
  Layer.provideMerge(Layer.mergeAll(layerRuntime, Platform.layer.pipe(Layer.provide(layerRuntime)))),
);

export const connectionAtomRuntime = Atom.runtime(layerConnection);
