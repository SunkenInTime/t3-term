// Port of apps/web/src/components/settings/ConnectionDiagnosisDetails.tsx: why a saved
// environment is not connecting, as a one-line summary under its row and an
// expandable panel (hops, what to try, facts, actions).
// t3-term has no T3 Connect relay discovery, so relay health is always unknown (null),
// as web passes when an environment also has a direct route.
import { useAtomValue } from "@effect/atom-react";
import {
  AVAILABLE_CONNECTION_STATE,
  type ConnectionDiagnosis,
  connectionDiagnosisText,
  connectionRoutes,
  hasRelayRoute,
  presentConnectionDiagnosis,
} from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";

import { APP_VERSION } from "../../runtime/platform.ts";
import { environmentCatalog } from "../../state/environment.ts";
import type { EnvironmentPresentation } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import { copyText, openExternal } from "../openExternal.ts";

/**
 * What failed on the way to an environment, or null while it is connected, off,
 * or has not failed.
 */
export function useConnectionDiagnosis(environment: EnvironmentPresentation) {
  const state = Option.getOrElse(AsyncResult.value(useAtomValue(environmentCatalog.stateAtom(environment.environmentId))), () => AVAILABLE_CONNECTION_STATE);
  const routes = connectionRoutes(environment.entry);
  const relayOnly = routes.length === 1 && hasRelayRoute(environment.entry);
  const phase = environment.connection.phase;
  const diagnosis =
    environment.entry.enabled && phase !== "connected" && phase !== "unsupported"
      ? presentConnectionDiagnosis({
          hostLabel: environment.label,
          state,
          via: relayOnly ? "relay" : "direct",
          relayStatus: null,
          clientVersion: APP_VERSION,
          serverVersion: environment.serverConfig?.environment.serverVersion,
        })
      : null;
  return { diagnosis, state, relayOnly };
}

const HOP_MARK = { ok: "✓", failed: "✕", unchecked: "–" } as const;
const HOP_NOTE = { ok: "", failed: "Failed", unchecked: "Not checked" } as const;

/** Ticks once per second, and only while a retry is scheduled. */
function RetryCountdown({ retryAt }: { readonly retryAt: number }) {
  const theme = useTheme();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const seconds = Math.ceil((retryAt - now) / 1_000);
  return (
    <Text size="xs" color={theme.mutedForeground}>
      {seconds > 0 ? `retrying in ${seconds}s` : "retrying"}
    </Text>
  );
}

/** The collapsed failure: the full headline, then the retry state and a Details toggle. */
export function ConnectionDiagnosisSummary({
  diagnosis,
  retryAt,
  attempt,
  expanded,
  onToggle,
  testId,
}: {
  readonly diagnosis: ConnectionDiagnosis;
  readonly retryAt: number | null;
  readonly attempt: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly testId?: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const dot = (
    <Text size="xs" color={theme.mutedForeground}>
      ·
    </Text>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Text size="xs" color={theme.errorForeground}>
        {diagnosis.headline}
      </Text>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        {retryAt !== null ? <RetryCountdown retryAt={retryAt} /> : null}
        {retryAt !== null && attempt > 0 ? dot : null}
        {attempt > 0 ? (
          <Text size="xs" color={theme.mutedForeground}>
            {`attempt ${attempt}`}
          </Text>
        ) : null}
        {retryAt !== null || attempt > 0 ? dot : null}
        <div
          testId={testId}
          onClick={onToggle}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, cursor: "pointer" }}
        >
          <Text size="xs" color={hover ? theme.foreground : theme.mutedForeground}>
            Details
          </Text>
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} color={hover ? theme.foreground : theme.mutedForeground} />
        </div>
      </div>
    </div>
  );
}

/** Hops in order, what to try, the facts, and the actions. */
export function ConnectionDiagnosisPanel({
  hostLabel,
  diagnosis,
  onRetry,
  onAddRoute,
}: {
  readonly hostLabel: string;
  readonly diagnosis: ConnectionDiagnosis;
  readonly onRetry: () => void;
  readonly onAddRoute: (() => void) | null;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {diagnosis.hops.map((hop) => {
          const color = hop.result === "failed" ? theme.errorForeground : theme.mutedForeground;
          return (
            <div key={hop.hop} style={{ display: "flex", flexDirection: "row", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "center", width: 12 }}>
                <Text size="xs" color={color}>
                  {HOP_MARK[hop.result]}
                </Text>
              </div>
              <Text size="xs" color={hop.result === "ok" ? theme.foreground : color}>
                {hop.label}
              </Text>
              {HOP_NOTE[hop.result] ? (
                <Text size="xs" color={color}>
                  {HOP_NOTE[hop.result]}
                </Text>
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Text size="xs" weight={500}>
          What to try
        </Text>
        {diagnosis.steps.map((step, index) => (
          <div key={step} style={{ display: "flex", flexDirection: "row", gap: 4, paddingLeft: 4 }}>
            <Text size="xs" color={theme.mutedForeground} style={{ width: 12, flexShrink: 0 }}>
              {`${index + 1}.`}
            </Text>
            <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 1, minWidth: 0 }}>
              {step}
            </Text>
          </div>
        ))}
        {diagnosis.moreInfoUrl ? (
          <div style={{ display: "flex", flexDirection: "row" }}>
            <MoreInfoLink url={diagnosis.moreInfoUrl} />
          </div>
        ) : null}
      </div>
      {/* dl grid-cols-[auto_minmax(0,1fr)] font-mono: labels sized to the longest. */}
      <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {diagnosis.facts.map(([label]) => (
            <Text key={label} size="xs" mono color={theme.mutedForeground}>
              {label}
            </Text>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          {diagnosis.facts.map(([label, value]) => (
            <Text key={label} size="xs" mono truncate>
              {value}
            </Text>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button size="xs" variant="outline" onClick={onRetry} testId="connection-diagnosis-retry">
          Retry now
        </Button>
        <Button
          size="xs"
          variant="outline"
          testId="connection-diagnosis-copy"
          onClick={() =>
            copyText(connectionDiagnosisText(hostLabel, diagnosis))
              ? toast({ type: "success", title: "Diagnostics copied" })
              : toast({ type: "error", title: "Could not copy diagnostics" })
          }
        >
          Copy diagnostics
        </Button>
        {onAddRoute ? (
          <Button size="xs" variant="outline" onClick={onAddRoute}>
            Add direct route
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function MoreInfoLink({ url }: { readonly url: string }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <div onClick={() => openExternal(url)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ cursor: "pointer" }}>
      <Text size="xs" color={hover ? theme.foreground : theme.mutedForeground} style={{ textDecoration: "underline" }}>
        More info
      </Text>
    </div>
  );
}
