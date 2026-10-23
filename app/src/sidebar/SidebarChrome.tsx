// apps/web/src/components/sidebar/SidebarChrome.tsx: brand header (with the
// environment identification artwork or pill), and the footer: undo notice,
// provider update pill, utility row (Settings, Pull Requests, Usage, update pill).
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";

import { environmentServerConfigsAtom } from "../state/environment.ts";
import {
  primaryEnvironmentIdAtom,
  primaryKeybindingsAtom,
  sidebarClientSettingsAtom,
} from "../state/sidebar.ts";
import { shortcutLabelForCommand } from "./shortcutLabel.ts";
import { routeAtom, setSidebarVisible, type Route } from "../state/ui.ts";
import { titlebarControlSize, useInSidebarSheet, useSmallViewport } from "../ui/viewport.tsx";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { FONTS, LAYOUT, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { getProviderUpdateSidebarPillView } from "../web/components/ProviderUpdateLaunchNotification.logic.ts";
import { resolveStageLabel, resolveStageBackdropVariant, type StageBackdropVariant } from "./StageBackdrop.tsx";
import { threadUndoNoticeAtom } from "./threadActions.ts";
import { SidebarUpdatePill } from "./SidebarUpdatePill.tsx";

const T3_WORDMARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="15.5309 37 94.3941 56.96"><path fill="black" d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"/></svg>';

// ── Header ──────────────────────────────────────────────────────────────

/** Which stage artwork (if any) the sidebar paints behind its header. */
export function useStageIdentification(): {
  readonly backdropVariant: StageBackdropVariant | null;
  readonly pillLabel: string | null;
} {
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const mode = useAtomValue(sidebarClientSettingsAtom).environmentIdentificationMode;
  const stageLabel = resolveStageLabel(
    primaryEnvironmentId === null ? null : (configs.get(primaryEnvironmentId)?.environment.serverVersion ?? null),
  );
  const normalized = stageLabel.trim().toLowerCase();
  return {
    backdropVariant: resolveStageBackdropVariant(stageLabel, mode === "artwork"),
    pillLabel: mode === "pill" ? (normalized === "dev" ? "Dev" : normalized === "nightly" ? "Nightly" : null) : null,
  };
}

export function SidebarChromeHeader() {
  const theme = useTheme();
  const setRoute = useAtomSet(routeAtom);
  const { backdropVariant, pillLabel } = useStageIdentification();
  const onBackdrop = backdropVariant !== null;
  // In the mobile sheet web shows only the sheet's own trigger (`md:hidden`); the
  // brand link is `hidden md:flex`. Below `sm` the trigger grows to 32.
  const inSheet = useInSidebarSheet();
  const small = useSmallViewport();
  const toggleSize = inSheet ? titlebarControlSize(small) : 28;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: LAYOUT.topbar,
        flexShrink: 0,
        paddingRight: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginLeft: 12, flexShrink: 0 }}>
        <IconButton
          icon="panel-left-close"
          testId="sidebar-toggle"
          size={toggleSize}
          color={onBackdrop ? "#ffffff" : theme.mutedForeground}
          hoverBg={onBackdrop ? alpha("#ffffff", 0.16) : theme.sidebar.rowHover}
          onClick={() => setSidebarVisible(false)}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 12, minWidth: 0, flexGrow: 1 }}>
        {inSheet ? null : (
          <div
            testId="sidebar-brand"
            onClick={() => setRoute({ kind: "home" })}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 28, cursor: "pointer", flexShrink: 0 }}
          >
            <svg source={T3_WORDMARK_SVG} style={{ width: 17, height: 10, color: onBackdrop ? "#ffffff" : theme.foreground }} />
            <Text size="sm" weight={500} color={onBackdrop ? alpha("#ffffff", 0.7) : theme.mutedForeground}>
              Code
            </Text>
          </div>
        )}
        {pillLabel ? (
          <div style={{ display: "flex", alignItems: "center", height: 18, paddingLeft: 6, paddingRight: 6, borderRadius: RADIUS.sm, backgroundColor: theme.secondary, borderWidth: 1, borderColor: theme.border, marginLeft: 4 }}>
            <Text size="xs" weight={500} color={theme.foreground}>
              {pillLabel}
            </Text>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────

/** web mainAppLocation.ts isSidebarUtilityPage: pages whose sidebar footer is a Back button. */
function isUtilityRoute(route: Route): boolean {
  return route.kind === "usage" || route.kind === "pull-requests" || route.kind === "settings";
}

// web MainAppLocationTracker: the last chat route, where Back returns to.
let mainAppRoute: Route | null = isUtilityRoute(appAtomRegistry.get(routeAtom)) ? null : appAtomRegistry.get(routeAtom);
appAtomRegistry.subscribe(routeAtom, (route) => {
  if (!isUtilityRoute(route)) mainAppRoute = route;
});

/** SidebarMenuButton with ArrowLeft + "Back" (web SidebarUtilityMenu on a utility page). */
function SidebarBackButton() {
  const theme = useTheme();
  const setRoute = useAtomSet(routeAtom);
  const [hovered, setHovered] = useState(false);
  // SidebarMenuButton: sidebar muted foreground at 80% until hovered.
  const color = hovered ? theme.sidebar.foreground : alpha(theme.sidebar.mutedForeground, 0.8);
  return (
    <div
      testId="sidebar-back"
      onClick={() => setRoute(mainAppRoute ?? { kind: "home" })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        flexGrow: 1,
        minWidth: 0,
        height: 32,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.md,
        cursor: "pointer",
        backgroundColor: hovered ? theme.sidebar.rowHover : "#00000000",
      }}
    >
      <Icon name="arrow-left" size={16} color={color} />
      <text style={{ fontSize: 14, lineHeight: 20, fontWeight: 500, fontFamily: FONTS.sans, color }}>Back</text>
    </div>
  );
}

function UtilityButton({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Tooltip content={label} side="top">
      <div
        testId={testId}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: RADIUS.md,
          flexShrink: 0,
          cursor: "pointer",
          backgroundColor: hovered ? theme.sidebar.rowHover : "#00000000",
        }}
      >
        <Icon name={icon} size={16} color={hovered ? theme.sidebar.foreground : theme.sidebar.icon} />
      </div>
    </Tooltip>
  );
}

function SidebarThreadUndoNotice() {
  const notice = useAtomValue(threadUndoNoticeAtom);
  const keybindings = useAtomValue(primaryKeybindingsAtom);
  if (!notice) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "thread.undo");
  const noun = `${notice.action === "Discarded" ? "draft" : "thread"}${notice.count === 1 ? "" : "s"}`;
  return (
    <UndoNoticeView
      text={`${notice.action} ${notice.count} ${noun}, `}
      action={shortcut ? `${shortcut} to undo` : "Undo"}
      onUndo={() => void notice.undo()}
    />
  );
}

/** Mounted only with a notice, so its hover state starts fresh for each one. */
function UndoNoticeView({ text, action, onUndo }: { text: string; action: string; onUndo: () => void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const textStyle = { fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans };
  return (
    <div
      testId="sidebar-undo-notice"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.sidebar.border,
        backgroundColor: theme.muted,
      }}
    >
      <text style={{ ...textStyle, color: theme.sidebar.mutedForeground }}>{text}</text>
      <div
        testId="sidebar-undo-button"
        onClick={onUndo}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ display: "flex", cursor: "pointer" }}
      >
        <text style={{ ...textStyle, fontWeight: 500, color: theme.foreground, ...(hovered ? { textDecoration: "underline" } : {}) }}>
          {action}
        </text>
      </div>
    </div>
  );
}

function SidebarProviderUpdatePill() {
  const theme = useTheme();
  const setRoute = useAtomSet(routeAtom);
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const providers = primaryEnvironmentId === null ? [] : (configs.get(primaryEnvironmentId)?.providers ?? []);
  const [visibleAfterIso] = useState(() =>
    providers.reduce<string | undefined>(
      (latest, provider) => (latest === undefined || provider.checkedAt > latest ? provider.checkedAt : latest),
      undefined,
    ),
  );
  const view = getProviderUpdateSidebarPillView(providers, {
    ...(visibleAfterIso !== undefined ? { visibleAfterIso } : {}),
    dismissedKeys,
  });
  if (!view) return null;
  const tone =
    view.tone === "warning"
      ? { bg: alpha(theme.warning, 0.12), fg: theme.warning }
      : view.tone === "error"
        ? { bg: alpha(theme.error, 0.12), fg: theme.error }
        : { bg: theme.muted, fg: theme.sidebar.foreground };
  const icon: IconName =
    view.tone === "loading" ? "loader-circle" : view.tone === "success" ? "circle-check" : view.tone === "error" ? "triangle-alert" : "download";
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minHeight: 28, borderRadius: RADIUS.lg, backgroundColor: tone.bg }}>
      <Tooltip content={view.description} side="top">
        <div
          onClick={() => setRoute({ kind: "settings", page: "providers" })}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, cursor: "pointer" }}
        >
          <Icon name={icon} size={14} color={tone.fg} />
          <text style={{ fontSize: 11, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans, color: tone.fg }}>{view.title}</text>
        </div>
      </Tooltip>
      {view.dismissible ? (
        <Tooltip content="Dismiss until provider status changes" side="top">
          <div
            onClick={() => setDismissedKeys((previous) => new Set(previous).add(view.key))}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, marginRight: 4, borderRadius: RADIUS.sm, opacity: 0.7, cursor: "pointer" }}
          >
            <Icon name="x" size={14} color={tone.fg} />
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function SidebarChromeFooter({ children }: { children?: ReactNode }) {
  const setRoute = useAtomSet(routeAtom);
  const onUtilityPage = isUtilityRoute(useAtomValue(routeAtom));
  const configs = useAtomValue(environmentServerConfigsAtom);
  const pullRequestsSupported = [...configs.values()].some(
    (config) => config.environment.capabilities.pullRequests === true,
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, flexShrink: 0 }}>
      <SidebarThreadUndoNotice />
      <SidebarProviderUpdatePill />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
        {onUtilityPage ? (
          <SidebarBackButton />
        ) : (
          <>
            <UtilityButton icon="settings" label="Settings" testId="open-settings" onClick={() => setRoute({ kind: "settings", page: "general" })} />
            {pullRequestsSupported ? (
              <UtilityButton icon="git-pull-request-arrow" label="Pull Requests" testId="open-pull-requests" onClick={() => setRoute({ kind: "pull-requests" })} />
            ) : null}
            <UtilityButton icon="chart-no-axes-column" label="Usage" testId="open-usage" onClick={() => setRoute({ kind: "usage" })} />
          </>
        )}
        <SidebarUpdatePill />
        {children}
      </div>
    </div>
  );
}
