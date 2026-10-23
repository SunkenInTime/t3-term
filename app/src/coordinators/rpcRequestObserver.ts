// apps/web/src/connection/platform.ts layerRpcRequestObserver: every unary
// environment RPC is tracked until it answers, so the slow request toast
// (SlowRpcRequestToastCoordinator) can name the ones that have not.
// Merge this layer into the connection platform layer (runtime/platform.ts).
import { EnvironmentRpcRequestObserver } from "@t3tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { acknowledgeRpcRequest, trackRpcRequestSent } from "../web/rpc/requestLatencyState.ts";

let nextObservedRpcRequestId = 0;

export const layerRpcRequestObserver = Layer.succeed(
  EnvironmentRpcRequestObserver,
  EnvironmentRpcRequestObserver.of({
    observe: ({ environmentId, environmentLabel, method }) =>
      Effect.sync(() => {
        nextObservedRpcRequestId += 1;
        const requestId = `${environmentId}:${nextObservedRpcRequestId}`;
        trackRpcRequestSent(requestId, method, `${method} · ${environmentLabel}`);
        return Effect.sync(() => {
          acknowledgeRpcRequest(requestId);
        });
      }),
  }),
);
