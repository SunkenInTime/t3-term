import * as NodeOS from "node:os";

import {
  ClientCapabilities,
  PlatformConnectionSource,
} from "@t3tools/client-runtime/platform";
import {
  ConnectionBlockedError,
  Connectivity,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ConnectionStorage from "./storage.ts";
import * as EnvironmentCache from "./environmentCache.ts";
// Imports runtime.ts back through requestLatencyState; safe, it only reads the registry inside functions.
import { layerRpcRequestObserver } from "../coordinators/rpcRequestObserver.ts";

export const APP_VERSION = "0.1.0";

function osLabel(): string {
  switch (process.platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return process.platform;
  }
}

// A terminal client has no network-change or app-foreground signals; the
// connection supervisor's own retry loop covers reconnects.
const layerConnectivity = Connectivity.layer({
  status: Effect.succeed("online" as const),
  changes: Stream.never,
});

const layerWakeups = Wakeups.layer({ changes: Stream.never });

const unsupported = (detail: string) =>
  new ConnectionBlockedError({ reason: "unsupported", detail });

const layerCapabilities = Layer.succeedContext(
  Context.make(
    ClientCapabilities.CloudSession,
    ClientCapabilities.CloudSession.of({
      identity: Effect.succeedNone,
      clerkToken: Effect.fail(
        new ConnectionBlockedError({
          reason: "authentication",
          detail: "T3 Connect sign-in is not available in t3-term yet.",
        }),
      ),
    }),
  ).pipe(
    Context.add(
      ClientCapabilities.PrimaryEnvironmentAuth,
      ClientCapabilities.PrimaryEnvironmentAuth.of({ bearerToken: Effect.succeed(Option.none()) }),
    ),
    Context.add(
      ClientCapabilities.RelayDeviceIdentity,
      ClientCapabilities.RelayDeviceIdentity.of({ deviceId: Effect.succeedNone }),
    ),
    Context.add(
      ClientCapabilities.ClientPresentation,
      ClientCapabilities.ClientPresentation.of({
        metadata: {
          label: `t3-term on ${NodeOS.hostname()}`,
          deviceType: "desktop",
          os: osLabel(),
          surface: "cli",
          appVersion: APP_VERSION,
        },
      }),
    ),
    Context.add(
      ClientCapabilities.SshEnvironmentGateway,
      ClientCapabilities.SshEnvironmentGateway.of({
        provision: () => Effect.fail(unsupported("SSH environments are not available in t3-term.")),
        prepare: () => Effect.fail(unsupported("SSH environments are not available in t3-term.")),
        disconnect: () => Effect.void,
      }),
    ),
  ),
);

const layerPlatformConnectionSource = Layer.succeed(
  PlatformConnectionSource.PlatformConnectionSource,
  PlatformConnectionSource.PlatformConnectionSource.of({ registrations: Stream.empty }),
);

export const layer = Layer.mergeAll(
  ConnectionStorage.layer,
  layerConnectivity,
  layerWakeups,
  layerCapabilities,
  layerPlatformConnectionSource,
  // Restores the last loaded shell and threads when a restart finds the server unreachable.
  EnvironmentCache.layer,
  // Tracks unanswered RPCs for the slow-request toast (coordinators/SlowRpcRequestToastCoordinator).
  layerRpcRequestObserver,
);
