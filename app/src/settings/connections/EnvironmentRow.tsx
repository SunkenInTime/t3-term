// Port of apps/web/src/components/settings/EnvironmentRow.tsx: one machine in a
// Connections list (icon, label, subtitle, trailing controls, an optional detail
// block under the text column).
import {
  type ConnectionTarget,
  connectionRouteId,
  connectionRouteLabel,
  connectionRoutes,
} from "@t3tools/client-runtime/connection";
import type { DesktopSshEnvironmentTarget, EnvironmentMachineKind } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useState, type ReactNode } from "react";

import type { EnvironmentPresentation } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { machineKindIcon, useSettingsInset } from "../layout.tsx";

export function formatDesktopSshTarget(target: DesktopSshEnvironmentTarget): string {
  const authority = target.username ? `${target.username}@${target.hostname}` : target.hostname;
  return target.port ? `${authority}:${target.port}` : authority;
}

/** apps/web/src/connection/desktopLocal.ts: desktop-launched local backends (WSL). */
function isDesktopLocalConnectionTarget(target: ConnectionTarget): boolean {
  return target._tag === "BearerConnectionTarget" && target.connectionId.startsWith("local:");
}

export function environmentTransportLabel(environment: EnvironmentPresentation, activeTarget: ConnectionTarget | null = null): string {
  const { entry } = environment;
  if (entry.target._tag === "PrimaryConnectionTarget") return "This machine";
  const routes = connectionRoutes(entry);
  if (routes.length > 1) {
    const active =
      activeTarget === null ? undefined : routes.find((route) => connectionRouteId(route.target) === connectionRouteId(activeTarget));
    return active === undefined ? connectionRouteLabel(routes[0]!) : `via ${connectionRouteLabel(active)}`;
  }
  if (environment.relayManaged) return "T3 Connect";
  if (isDesktopLocalConnectionTarget(entry.target)) return "WSL";
  if (entry.target._tag === "SshConnectionTarget" && Option.isSome(entry.profile) && entry.profile.value._tag === "SshConnectionProfile") {
    return `SSH ${formatDesktopSshTarget(entry.profile.value.target)}`;
  }
  return environment.displayUrl ?? "Remote link";
}

/** `grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 sm:px-4` */
export function EnvironmentRow({
  kind,
  label,
  subtitle,
  below,
  detail,
  dimmed = false,
  testId,
  children,
}: {
  readonly kind: EnvironmentMachineKind;
  readonly label: string;
  readonly subtitle: ReactNode;
  readonly below?: ReactNode;
  readonly detail?: ReactNode;
  readonly dimmed?: boolean;
  readonly testId?: string;
  readonly children?: ReactNode;
}) {
  const theme = useTheme();
  const inset = useSettingsInset();
  const hasDetail = detail !== undefined && detail !== null && detail !== false;
  return (
    <div testId={testId} style={{ display: "flex", flexDirection: "column", width: "100%", paddingLeft: inset, paddingRight: inset, paddingTop: 10, paddingBottom: 10 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, width: "100%" }}>
        {/* Dim only the identity so a switched-off row's controls stay readable and distinct from disabled ones. */}
        <Icon name={machineKindIcon(kind)} size={16} color={theme.mutedForeground} opacity={dimmed ? 0.6 : undefined} />
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, opacity: dimmed ? 0.6 : 1 }}>
          <Text weight={500} truncate>
            {label}
          </Text>
          {typeof subtitle === "string" ? (
            <Text size="xs" color={theme.mutedForeground} truncate>
              {subtitle}
            </Text>
          ) : (
            subtitle
          )}
          {below}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>{children}</div>
      </div>
      {/* col-span-2 col-start-2: the detail lines up under the text column. */}
      {hasDetail ? <div style={{ display: "flex", flexDirection: "column", paddingLeft: 28, minWidth: 0 }}>{detail}</div> : null}
    </div>
  );
}

/** The subtitle's inline disclosure buttons ("Routes ›", "Permissions ›"): muted, hover foreground. */
export function SubtitleToggle({ label, open, onToggle, testId }: { label: string; open: boolean; onToggle: () => void; testId?: string }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const color = hover ? theme.foreground : theme.mutedForeground;
  return (
    <div
      testId={testId}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0, cursor: "pointer" }}
    >
      <Text size="xs" color={color}>
        {label}
      </Text>
      <Icon name={open ? "chevron-down" : "chevron-right"} size={12} color={color} />
    </div>
  );
}
