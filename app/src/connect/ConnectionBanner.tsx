// The composer banner web shows when the active thread's machine is offline or
// reconnecting: apps/web/src/components/chat/useSystemComposerBanners.tsx (the
// "environment-unavailable" item), drawn the way ComposerBannerStack.tsx draws
// its front item over ComposerBanner.tsx.
//
// The composer owns where banners go. It can either feed
// `useEnvironmentConnectionBanners(environmentId)` into its own banner stack
// (items have web's ComposerBannerStackItem shape, with data instead of nodes),
// or render `<EnvironmentConnectionBanner environmentId />` directly above the
// composer surface, inside the composer's centered column.
//
// Left out on purpose:
//   - web's "Server update available" item. It compares the server's version
//     with the client's, and t3-term's version (runtime/platform.ts) is its own,
//     not a T3 Code release, so the comparison means nothing yet.
//   - web's "Update" action for outdated hosts. It asks the host to install
//     t3@<client version>, which would be t3-term's version.
//   - web hides this banner while its own server update runs; t3-term starts none.
import { useAtomValue } from "@effect/atom-react";
import {
  connectionRoutes,
  hasRelayRoute,
  presentConnectionDiagnosis,
} from "@t3tools/client-runtime/connection";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { APP_VERSION } from "../runtime/platform.ts";
import { environmentConnectionViewAtom, type EnvironmentConnectionView } from "../state/connect.ts";
import { environmentCatalog } from "../state/environment.ts";
import { routeAtom } from "../state/ui.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Button, Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme, type Palette } from "../ui/theme.ts";
import { toast } from "../ui/toast.tsx";
import { useEnvironmentDisconnectDelay } from "../web/hooks/useEnvironmentDisconnectDelay.ts";

export type ConnectionBannerVariant = "default" | "error" | "info" | "success" | "warning";

export interface ConnectionBannerAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly testId: string;
}

/** web ComposerBannerStackItem, with an icon name and plain-text title/description. */
export interface ConnectionBannerItem {
  readonly id: string;
  readonly variant: ConnectionBannerVariant;
  readonly icon: IconName;
  readonly title: string;
  readonly description?: string;
  readonly actions: ReadonlyArray<ConnectionBannerAction>;
}

// apps/web/src/components/ChatView.logic.ts ENVIRONMENT_RECONNECT_WARNING_GRACE_MS:
// a reconnect that settles within this window never shows a banner.
const ENVIRONMENT_RECONNECT_WARNING_GRACE_MS = 2_000;

const NO_ENVIRONMENT_VIEW_ATOM = Atom.make<EnvironmentConnectionView | null>(null);

export function useEnvironmentConnectionBanners(
  environmentId: EnvironmentId | null,
): ReadonlyArray<ConnectionBannerItem> {
  const environment = useAtomValue(
    environmentId === null ? NO_ENVIRONMENT_VIEW_ATOM : environmentConnectionViewAtom(environmentId),
  );
  const phase = environment?.connection.phase ?? "available";
  const unavailable = environment !== null && phase !== "connected";

  const reconnectingEnvironmentId =
    phase === "connecting" || phase === "reconnecting" ? (environment?.environmentId ?? null) : null;
  const [graceElapsedEnvironmentId, setGraceElapsedEnvironmentId] = useState<EnvironmentId | null>(null);
  // Each reconnect attempt gets its own grace period, including a later one to
  // the same environment.
  const [graceEnvironmentId, setGraceEnvironmentId] = useState(reconnectingEnvironmentId);
  if (graceEnvironmentId !== reconnectingEnvironmentId) {
    setGraceEnvironmentId(reconnectingEnvironmentId);
    setGraceElapsedEnvironmentId(null);
  }
  const graceElapsed =
    reconnectingEnvironmentId !== null && reconnectingEnvironmentId === graceElapsedEnvironmentId;
  useEffect(() => {
    if (reconnectingEnvironmentId === null) return;
    const timer = setTimeout(
      () => setGraceElapsedEnvironmentId(reconnectingEnvironmentId),
      ENVIRONMENT_RECONNECT_WARNING_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [reconnectingEnvironmentId]);

  const disconnectDelayElapsed = useEnvironmentDisconnectDelay(
    unavailable && environment ? environment.environmentId : null,
  );
  const [disconnecting, setDisconnecting] = useState(false);

  if (!unavailable || environment === null) return [];
  const reconnecting = phase === "connecting" || phase === "reconnecting";
  if (reconnecting && !graceElapsed) return [];

  const actions: ConnectionBannerAction[] = [];
  if (!reconnecting) {
    actions.push({
      label: "Reconnect",
      testId: "connection-banner-reconnect",
      onClick: () => void reconnect(environment.environmentId),
    });
  }
  if (disconnectDelayElapsed && environment.entry.target._tag !== "PrimaryConnectionTarget") {
    actions.push({
      label: "Disconnect server",
      testId: "connection-banner-disconnect",
      disabled: disconnecting,
      onClick: () => {
        setDisconnecting(true);
        void disconnect(environment.environmentId).finally(() => setDisconnecting(false));
      },
    });
  }

  const description = describe(environment);
  return [
    {
      id: `environment-unavailable:${environment.environmentId}`,
      variant: phase === "error" ? "error" : "warning",
      icon: "wifi-off",
      title: `${environment.label} is ${reconnecting ? "reconnecting" : "offline"}`,
      ...(description ? { description } : {}),
      actions,
    },
  ];
}

/**
 * web's ConnectionDiagnosisHeadline. For an unsupported host web shows no
 * description (the diagnosis skips that phase); t3-term shows the blocking
 * reason instead, e.g. "This client requires a newer server. Update T3 Code on
 * X to connect.", because this banner is the only place a client user sees it.
 */
function describe(environment: EnvironmentConnectionView): string | null {
  const phase = environment.connection.phase;
  if (phase === "unsupported") return environment.connection.error;
  if (!environment.entry.enabled || phase === "connected") return null;
  const relayOnly =
    connectionRoutes(environment.entry).length === 1 && hasRelayRoute(environment.entry);
  return (
    presentConnectionDiagnosis({
      hostLabel: environment.label,
      state: environment.state,
      via: relayOnly ? "relay" : "direct",
      relayStatus: null,
      clientVersion: APP_VERSION,
      serverVersion: environment.serverVersion,
    })?.headline ?? null
  );
}

async function reconnect(environmentId: EnvironmentId) {
  const result = await runAtomCommand(appAtomRegistry, environmentCatalog.retryNow, environmentId);
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toast({
      type: "error",
      title: "Could not reconnect environment",
      description: error instanceof Error ? error.message : "Failed to reconnect.",
    });
  }
}

async function disconnect(environmentId: EnvironmentId) {
  const result = await runAtomCommand(appAtomRegistry, environmentCatalog.setEnabled, {
    environmentId,
    enabled: false,
  });
  if (result._tag === "Failure") {
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toast({
        type: "error",
        title: "Could not disconnect server",
        description: error instanceof Error ? error.message : "Failed to disconnect.",
      });
    }
    return;
  }
  appAtomRegistry.set(routeAtom, { kind: "home" });
}

/**
 * The front banner, attached to the top of the composer: inset 22px on each
 * side (--chat-composer-drawer-inset) and tucked 17px under the composer's top
 * edge. Render it immediately before the composer surface so the surface
 * paints over the tucked part.
 */
export function EnvironmentConnectionBanner({
  environmentId,
}: {
  readonly environmentId: EnvironmentId | null;
}) {
  const items = useEnvironmentConnectionBanners(environmentId);
  const front = items[0];
  if (!front) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", marginLeft: 22, marginRight: 22, marginBottom: -17 }}>
      <ConnectionBanner item={front} attached />
    </div>
  );
}

const ATTACHMENT_OVERLAP = 17;

/** ComposerBannerStackAlert: density "comfortable", layout "wrap-actions". */
export function ConnectionBanner({
  item,
  attached,
}: {
  readonly item: ConnectionBannerItem;
  readonly attached: boolean;
}) {
  const theme = useTheme();
  const colors = bannerColors(theme, item.variant);
  return (
    <div
      testId={`connection-banner:${item.id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 5,
        paddingBottom: 5 + (attached ? ATTACHMENT_OVERLAP : 0),
        borderWidth: 1,
        borderColor: colors.outline,
        backgroundColor: colors.surface,
        borderTopLeftRadius: RADIUS["2xl"],
        borderTopRightRadius: RADIUS["2xl"],
        borderBottomLeftRadius: attached ? 0 : RADIUS["2xl"],
        borderBottomRightRadius: attached ? 0 : RADIUS["2xl"],
        boxShadow: { offsetX: 0, offsetY: 14, blurRadius: 32, spreadRadius: -18, color: "#000000bf" },
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          minHeight: 24,
          columnGap: 4,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            flexShrink: 0,
            alignSelf: "flex-start",
          }}
        >
          <Icon name={item.icon} size={12} color={theme.mutedForeground} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
          }}
        >
          <Text size="xs" weight={500} truncate style={{ lineHeight: 24, flexShrink: 1 }}>
            {item.title}
          </Text>
          {item.description ? (
            <Text
              size="xs"
              color={theme.mutedForeground}
              truncate
              style={{ flexGrow: 1, flexBasis: 0, flexShrink: 1 }}
            >
              {item.description}
            </Text>
          ) : null}
        </div>
        {item.actions.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 4,
            }}
          >
            {item.actions.map((action, index) => (
              <Button
                key={action.label}
                size="xs"
                variant="ghost"
                disabled={action.disabled}
                onClick={action.onClick}
                testId={action.testId}
                style={
                  index === item.actions.length - 1 ? { borderTopRightRadius: RADIUS.xl } : undefined
                }
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The surface is the dark theme's surface-raised (card), opaque because GPUI has
 * no backdrop blur, with web's 8% variant tint folded in.
 */
function bannerColors(theme: Palette, variant: ConnectionBannerVariant) {
  const neutralOutline =
    theme.appearance === "dark" ? alpha("#ffffff", 0.05) : alpha(theme.foreground, 0.08);
  switch (variant) {
    case "error":
      return { outline: alpha(theme.error, 0.32), surface: mix(theme.card, theme.error, 0.08) };
    case "warning":
      return { outline: alpha(theme.warning, 0.28), surface: mix(theme.card, theme.warning, 0.08) };
    default:
      return { outline: neutralOutline, surface: theme.card };
  }
}

function mix(base: string, tint: string, amount: number): string {
  const channel = (offset: number) => {
    const a = Number.parseInt(base.slice(offset, offset + 2), 16);
    const b = Number.parseInt(tint.slice(offset, offset + 2), 16);
    return Math.round(a * (1 - amount) + b * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}
