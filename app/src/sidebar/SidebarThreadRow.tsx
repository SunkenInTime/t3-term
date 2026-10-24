// apps/web/src/components/sidebar/SidebarThreadRow.tsx: the card row (pinned,
// active, working), the slim row (snoozed, settled), and the search result row.
// Hover reveal (web's group-hover) is row state from onMouseEnter/onMouseLeave.
import { useAtomValue, useAtomSet } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  formatWorkingDurationLabel,
  resolveThreadProviderStack,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import { resolveSettledThreadTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import * as TooltipPrimitive from "@gpuix/react/tooltip";
import { resolveEnvironmentMachineKind, type ScopedThreadRef } from "@t3tools/contracts";
import { memo, useEffect, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentServerConfigsAtom, environmentThreadShells } from "../state/environment.ts";
import {
  canOperateEnvironmentAtom,
  environmentLabelByIdAtom,
  sidebarClientSettingsAtom,
  sidebarContextMenuAtom,
  sidebarDraftDiscardAtom,
  clearThreadSelection,
  rangeSelectThreadsTo,
  setThreadSelectionAnchor,
  sidebarRenameAtom,
  sidebarThreadListAtom,
  threadKeysWithUnsentDraftAtom,
  threadLocalLastVisitedAtAtom,
  threadSelectedAtom,
  threadSelectionAtom,
  toggleThreadSelection,
  type SidebarProviderEntry,
} from "../state/sidebar.ts";
import { rightPanelOpenAtom, rightPanelSurfaceAtom } from "../state/ui.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Menu, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../ui/theme.ts";
import {
  type SidebarDropVerb,
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
  resolveWorkingStartedAt,
  shouldRecedeSidebarThread,
} from "../web/components/Sidebar.logic.ts";
import { resolveSnoozePresets, type SnoozePreset } from "../web/components/Sidebar.snooze.ts";
import {
  claimRowPress,
  consumeRowClick,
  rowMouseDown,
  rowMouseMove,
  rowMouseUp,
} from "./sidebarGesture.ts";
import { requestCustomSnooze } from "../dialogs/CustomSnoozeDialog.tsx";
import { ProjectFavicon } from "./ProjectFavicon.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";
import { resolvePullRequestBadge } from "./pullRequestBadge.ts";
import {
  acknowledgeThreadWoke,
  attemptSettle,
  attemptSnooze,
  attemptUnpin,
  attemptUnsettle,
  attemptUnsnooze,
  navigateToThread,
  renameThread,
} from "./threadActions.ts";
import { useNowMinute, useNowSecond } from "./clock.ts";

export type SidebarSweepAction = "settle" | "unsettle" | "unsnooze";

/**
 * A control inside a row acts through the row's captured press (sidebarGesture.ts):
 * the row runs it on release unless the press became a drag or sweep.
 */
function pressControl(
  event: { button?: number },
  run: () => void,
  sweep: SidebarSweepAction | null = null,
): void {
  if ((event.button ?? 0) === 0) claimRowPress(run, sweep);
}

const dropVerbBadge: Record<SidebarDropVerb, { icon: IconName; label: string }> = {
  pin: { icon: "pin", label: "Pin" },
  unpin: { icon: "pin-off", label: "Unpin" },
  settle: { icon: "circle-check", label: "Settle" },
  unsettle: { icon: "undo-2", label: "Un-settle" },
  wake: { icon: "alarm-clock-off", label: "Wake" },
};

/** The verb a drop or sweep would apply, as a primary-tinted badge where the row's status sits. */
function DragDestination({ verb }: { verb: SidebarDropVerb }) {
  const theme = useTheme();
  const { icon, label } = dropVerbBadge[verb];
  return (
    <div
      testId="sidebar-drag-destination"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 20,
        paddingLeft: 6,
        paddingRight: 6,
        flexShrink: 0,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: alpha(theme.primary, 0.4),
        backgroundColor: alpha(theme.primary, 0.1),
        pointerEvents: "none",
      }}
    >
      <Icon name={icon} size={12} color={theme.primary} />
      <Text size="2xs" weight={500} color={theme.primary} style={{ whiteSpace: "nowrap" }}>
        {label}
      </Text>
    </div>
  );
}

/** `bg-sidebar` under a translucent `sidebar-row-active` wash, flattened to one colour. */
function overSidebar(theme: Palette, wash: string): string {
  const parse = (hex: string) => {
    const value = hex.replace("#", "");
    const channel = (index: number) => parseInt(value.slice(index, index + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: value.length >= 8 ? channel(6) / 255 : 1 };
  };
  const base = parse(theme.sidebar.background);
  const top = parse(wash);
  const mix = (under: number, over: number) => Math.round(under * (1 - top.a) + over * top.a);
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${hex(mix(base.r, top.r))}${hex(mix(base.g, top.g))}${hex(mix(base.b, top.b))}`;
}

/** sidebar text tokens that web reads through `text-secondary-label` & co. */
export function sidebarTones(theme: Palette) {
  return {
    secondaryLabel: theme.mutedForeground,
    muted: theme.sidebar.mutedForeground,
    foreground: theme.sidebar.foreground,
  };
}

// ── Time labels ─────────────────────────────────────────────────────────

/** formatRelativeTimeLabel + compactSidebarTimeLabel ("just now" → "now", drop " ago"). */
export function compactRelativeTime(timestamp: string, nowMs: number): string {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return "";
  const seconds = Math.floor(Math.max(0, nowMs - time) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function RelativeTimeLabel({ timestamp, color }: { timestamp: string | null; color: string }) {
  const nowMinute = useNowMinute();
  if (timestamp === null) return null;
  return (
    <Text size="xs" color={color} style={{ whiteSpace: "nowrap" }}>
      {compactRelativeTime(timestamp, nowMinute)}
    </Text>
  );
}

function threadTimeTimestamp(thread: EnvironmentThreadShell): string {
  return thread.latestUserMessageAt ?? thread.updatedAt;
}

/** Self-ticking, so only this label re-renders each second while a thread works. */
function WorkingDuration({ startedAt, color }: { startedAt: string | null; color: string }) {
  const startedMs = startedAt !== null ? Date.parse(startedAt) : Number.NaN;
  if (Number.isNaN(startedMs)) return null;
  return <WorkingDurationLabel startedMs={startedMs} color={color} />;
}

function WorkingDurationLabel({ startedMs, color }: { startedMs: number; color: string }) {
  const nowMs = useNowSecond();
  return (
    <Text size="xs" weight={500} color={color}>
      {formatWorkingDurationLabel(nowMs - startedMs)}
    </Text>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────

/** MiddleTruncate: keep the last path segment (or 10 chars) visible. */
export function splitForMiddleTruncate(value: string): { head: string; tail: string } | null {
  const chars = Array.from(value);
  let keep = 10;
  const slash = chars.lastIndexOf("/");
  if (slash > 0 && slash < chars.length - 1) {
    const segment = chars.length - slash - 1;
    keep = segment <= 16 ? segment : 10;
  }
  if (keep <= 0 || chars.length <= keep + 4) return null;
  const cut = chars.length - keep;
  return { head: chars.slice(0, cut).join(""), tail: chars.slice(cut).join("") };
}

export function MiddleTruncate({ value, color, size = "xs" }: { value: string; color: string; size?: "xs" | "sm" }) {
  const split = splitForMiddleTruncate(value);
  if (!split) {
    return (
      <Text size={size} color={color} truncate style={{ flexShrink: 1 }}>
        {value}
      </Text>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "row", minWidth: 0, flexShrink: 1, overflow: "hidden" }}>
      <div style={{ display: "flex", minWidth: 0, flexShrink: 1 }}>
        <Text size={size} color={color} truncate>
          {split.head}
        </Text>
      </div>
      <div style={{ display: "flex", flexShrink: 0 }}>
        <Text size={size} color={color} style={{ whiteSpace: "nowrap" }}>
          {split.tail}
        </Text>
      </div>
    </div>
  );
}

const MACHINE_ICON: Record<string, IconName> = {
  server: "server",
  cloud: "cloud",
  linux: "terminal",
  desktop: "monitor",
  laptop: "laptop",
  "mac-mini": "server",
  "mac-studio": "monitor",
};

function useEnvironmentMachine(environmentId: string): IconName {
  const config = useAtomValue(environmentServerConfigsAtom).get(environmentId as never) ?? null;
  return MACHINE_ICON[resolveEnvironmentMachineKind(config)] ?? "server";
}

function SidebarProviderStack({
  thread,
  providerEntryByInstanceId,
}: {
  thread: EnvironmentThreadShell;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
}) {
  const theme = useTheme();
  const stack = resolveThreadProviderStack(thread);
  const currentEntry = providerEntryByInstanceId.get(stack[stack.length - 1]!) ?? null;
  if (currentEntry === null) return null;
  const current = (
    <ProviderIcon
      driverKind={currentEntry.driverKind}
      displayName={currentEntry.displayName}
      size={14}
      opacity={0.6}
      color={sidebarTones(theme).secondaryLabel}
    />
  );
  if (stack.length === 1) return current;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
      {stack.slice(0, -1).map((instanceId) => {
        const entry = providerEntryByInstanceId.get(instanceId);
        if (entry === undefined) return null;
        return (
          <ProviderIcon
            key={instanceId}
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            size={12}
            opacity={0.35}
            grayscale
            color={sidebarTones(theme).secondaryLabel}
          />
        );
      })}
      {current}
    </div>
  );
}

function PullRequestBadge({
  thread,
  isRouteThread,
  muted,
}: {
  thread: EnvironmentThreadShell;
  isRouteThread: boolean;
  /** Settled rows grey every descendant until hovered. */
  muted: string | null;
}) {
  const theme = useTheme();
  const supportsMultiple =
    useAtomValue(environmentServerConfigsAtom).get(thread.environmentId)?.environment.capabilities
      .threadPullRequests === true;
  const setRightPanelOpen = useAtomSet(rightPanelOpenAtom);
  const setRightPanelSurface = useAtomSet(rightPanelSurfaceAtom);
  const badge = resolvePullRequestBadge(thread, supportsMultiple);
  if (badge === null) return null;
  const color = muted ?? badge.color ?? theme.mutedForeground;
  return (
    <Tooltip content={badge.label} side="top">
      <div
        onMouseDown={(event) =>
          pressControl(event, () => {
            // pullRequestLinksOpenInApp (default on): the thread's PR opens in its right panel.
            setRightPanelSurface("pull-request");
            setRightPanelOpen(true);
            if (!isRouteThread) navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
          })
        }
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          flexShrink: 0,
          cursor: "pointer",
        }}
      >
        <Icon name={badge.icon} size={12} color={color} />
        <Text size="xs" color={color} style={{ whiteSpace: "nowrap" }}>
          {badge.text}
        </Text>
      </div>
    </Tooltip>
  );
}

function JumpHintBadge({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        position: "absolute",
        right: 6,
        top: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 20,
          paddingLeft: 6,
          paddingRight: 6,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.8),
          backgroundColor: alpha(theme.background, 0.95),
          pointerEvents: "none",
        }}
      >
        <text style={{ color: theme.foreground, fontSize: 10, fontWeight: 500, fontFamily: FONTS.mono }}>{label}</text>
      </div>
    </div>
  );
}

// ── Hover card (web: SidebarThreadTooltip / ThreadHoverCard) ────────────

function HoverCardLine({
  icon,
  iconNode,
  children,
  color,
  iconColor,
}: {
  icon?: IconName;
  iconNode?: ReactNode;
  children: ReactNode;
  color?: string;
  iconColor?: string;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
      {iconNode ?? (icon ? <Icon name={icon} size={12} color={iconColor ?? theme.mutedForeground} /> : null)}
      <Text size="xs" color={color ?? alpha(theme.foreground, 0.75)} truncate>
        {children}
      </Text>
    </div>
  );
}

function SidebarThreadHoverCard({
  thread,
  project,
  projectDisplayName,
  providerEntryByInstanceId,
}: {
  thread: EnvironmentThreadShell;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
}) {
  const theme = useTheme();
  const environmentLabel = useAtomValue(environmentLabelByIdAtom).get(thread.environmentId) ?? null;
  const machineIcon = useEnvironmentMachine(thread.environmentId);
  const modelInstanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const selectedModel = providerEntry?.models.find((model) => model.slug === thread.modelSelection.model);
  const modelLabel = selectedModel ? (selectedModel.shortName ?? selectedModel.name) : thread.modelSelection.model;
  const previousProviderNames = thread.providerInstanceHistory
    .filter((instanceId) => instanceId !== modelInstanceId)
    .map((instanceId) => providerEntryByInstanceId.get(instanceId)?.displayName ?? instanceId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, maxWidth: 320, paddingTop: 8, paddingBottom: 8, paddingLeft: 4, paddingRight: 4 }}>
      <Text size="xs" weight={500} color={theme.foreground} truncate>
        {thread.title}
      </Text>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 2 }}>
        {projectDisplayName ? (
          <HoverCardLine iconNode={project ? <ProjectFavicon project={project} size={12} /> : undefined}>
            {projectDisplayName}
          </HoverCardLine>
        ) : null}
        {environmentLabel ? <HoverCardLine icon={machineIcon}>{environmentLabel}</HoverCardLine> : null}
        {thread.branch ? (
          // Web's branch line is a bare MiddleTruncate: it keeps the grid's muted tone.
          <HoverCardLine icon="git-branch" color={theme.mutedForeground}>
            {thread.branch}
          </HoverCardLine>
        ) : null}
        {providerEntry ? (
          <HoverCardLine
            iconNode={
              <ProviderIcon driverKind={providerEntry.driverKind} displayName={providerEntry.displayName} size={12} opacity={0.6} grayscale color={theme.mutedForeground} />
            }
          >
            {modelLabel}
          </HoverCardLine>
        ) : null}
        {previousProviderNames.length > 0 ? (
          <HoverCardLine icon="arrow-right-left">Handed off from {previousProviderNames.join(", ")}</HoverCardLine>
        ) : null}
        {thread.runtime?.lastError ? (
          <HoverCardLine
            icon="circle-alert"
            color={thread.runtime.lastErrorClass === "usage_limit" ? theme.warning : theme.error}
            iconColor={thread.runtime.lastErrorClass === "usage_limit" ? theme.warning : theme.error}
          >
            {thread.runtime.lastErrorClass === "usage_limit" ? "Usage limit reached" : "Error occurred"}
          </HoverCardLine>
        ) : null}
      </div>
    </div>
  );
}

function HoverCard({
  disabled,
  card,
  children,
}: {
  disabled: boolean;
  card: ReactNode;
  children: React.ReactElement;
}) {
  const theme = useTheme();
  return (
    <TooltipPrimitive.Root delayDuration={150} disableHoverableContent style={{ flexDirection: "column", alignItems: "stretch" }}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      {disabled ? null : (
        <TooltipPrimitive.Content
          side="right"
          align="start"
          sideOffset={4}
          style={{
            display: "flex",
            flexDirection: "column",
            paddingTop: 4,
            paddingBottom: 4,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha(theme.foreground, 0.1),
            backgroundColor: "#141414",
            boxShadow: { offsetX: 0, offsetY: 16, blurRadius: 40, spreadRadius: -18, color: "#0000008c" },
            pointerEvents: "none",
          }}
        >
          {card}
        </TooltipPrimitive.Content>
      )}
    </TooltipPrimitive.Root>
  );
}

// ── Snooze menu (hover control on card rows) ────────────────────────────

function SnoozeMenuButton({
  open,
  onOpenChange,
  onSnooze,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (preset: Pick<SnoozePreset, "snoozedUntil">) => void;
}) {
  const theme = useTheme();
  const timestampFormat = useAtomValue(sidebarClientSettingsAtom).timestampFormat;
  const presets = open ? resolveSnoozePresets(new Date(), timestampFormat) : [];
  const [hovered, setHovered] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={onOpenChange}
      // Web asks for "end"; in a 256px sidebar that collides with the window
      // edge and Base UI flips it to "start".
      align="start"
      minWidth={160}
      testId="sidebar-snooze-menu"
      trigger={({ toggle }) => {
        const button = (
          <div
            testId="sidebar-snooze-button"
            onMouseDown={(event) => pressControl(event, toggle)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ display: "flex", alignItems: "center", height: 20, paddingLeft: 6, paddingRight: 6, borderRadius: RADIUS.sm, cursor: "pointer" }}
          >
            <Icon name="clock" size={12} color={hovered || open ? theme.foreground : theme.sidebar.mutedForeground} />
          </div>
        );
        return open ? button : (
          <Tooltip content="Snooze thread" side="top">
            {button}
          </Tooltip>
        );
      }}
    >
      {presets.map((preset) => (
        <SnoozePresetItem key={preset.id} label={preset.label} when={preset.whenLabel} onSelect={() => { onOpenChange(false); onSnooze(preset); }} />
      ))}
      <div style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: 8, marginRight: 8, backgroundColor: theme.border, flexShrink: 0 }} />
      <SnoozePresetItem
        label="Custom…"
        when={null}
        onSelect={() => {
          onOpenChange(false);
          void requestCustomSnooze().then((choice) => {
            if (choice) onSnooze(choice);
          });
        }}
      />
    </Menu>
  );
}

function SnoozePresetItem({ label, when, onSelect }: { label: string; when: string | null; onSelect: () => void }) {
  const theme = useTheme();
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        minHeight: 28,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        cursor: "pointer",
        flexShrink: 0,
        hover: { backgroundColor: theme.accent },
      }}
    >
      <Text color={theme.foreground} style={{ flexGrow: 1, whiteSpace: "nowrap" }}>
        {label}
      </Text>
      {when ? (
        <Text size="xs" color={alpha(theme.mutedForeground, 0.8)} style={{ whiteSpace: "nowrap" }}>
          {when}
        </Text>
      ) : null}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────

export interface SidebarThreadRowProps {
  readonly thread: EnvironmentThreadShell;
  readonly variant: "card" | "slim";
  readonly variantAction: SidebarSweepAction;
  readonly settlementSupported: boolean;
  readonly snoozeSupported: boolean;
  readonly pinningSupported: boolean;
  readonly snoozeWakeLabelText: string | null;
  readonly wokeAt: string | null;
  readonly isActive: boolean;
  readonly isRouteThread: boolean;
  readonly jumpLabel: string | null;
  readonly isRemote: boolean;
  readonly project: EnvironmentProject | null;
  readonly projectDisplayName: string | null;
  readonly providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  /** The verb a drop would apply to this row while it is dragged. */
  readonly dropVerb?: SidebarDropVerb | null;
  /** The dragged pin is over the pinned section: keep its pin glyph. */
  readonly dragOverPinned?: boolean;
  /** This row is in an action sweep: highlighted, its status replaced by the verb. */
  readonly sweepAction?: SidebarSweepAction | null;
  /** The copy that follows the pointer during a drag: no events, lifted surface. */
  readonly dragGhost?: boolean;
}

/** Reads the live shell, so streaming updates re-render only this row. */
export const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  const ref = scopeThreadRef(props.thread.environmentId, props.thread.id);
  const live = useAtomValue(environmentThreadShells.threadShellAtom(ref));
  return <SidebarThreadRowView key={props.variant} {...props} thread={live ?? props.thread} />;
});

function SidebarThreadRowView(props: SidebarThreadRowProps) {
  const theme = useTheme();
  const tones = sidebarTones(theme);
  const { thread, variant, variantAction } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const canOperate = useAtomValue(canOperateEnvironmentAtom(thread.environmentId));
  const localLastVisitedAt = useAtomValue(threadLocalLastVisitedAtAtom).get(threadKey);
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const hasUnsentDraft = useAtomValue(threadKeysWithUnsentDraftAtom).has(threadKey) && !props.isRouteThread;
  const draftDiscard = useAtomValue(sidebarDraftDiscardAtom);
  const rename = useAtomValue(sidebarRenameAtom);
  const setRename = useAtomSet(sidebarRenameAtom);
  const setContextMenu = useAtomSet(sidebarContextMenuAtom);
  const isRenaming = rename !== null && rename.threadKey === threadKey && canOperate;
  const isSelected = useAtomValue(threadSelectedAtom(threadKey));
  const ghost = props.dragGhost === true;
  const sweepAction = props.sweepAction ?? null;
  const destinationVerb: SidebarDropVerb | null = ghost
    ? (props.dropVerb ?? null)
    : sweepAction === "unsnooze"
      ? "wake"
      : sweepAction;
  const dragDestination = destinationVerb !== null ? <DragDestination verb={destinationVerb} /> : null;
  const [hoveredRaw, setHovered] = useState(false);
  // The dragged row is under the pointer in web, so its copy keeps hover styling.
  const hovered = ghost || hoveredRaw;
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  const isRegeneratingTitle = thread.titleRegeneration != null;

  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarThreadStatus(thread);
  const wokeAtMs = props.wokeAt === null ? Number.NaN : Date.parse(props.wokeAt);
  const lastVisitedMs = lastVisitedAt === undefined ? Number.NaN : Date.parse(lastVisitedAt);
  const isWoke =
    !Number.isNaN(wokeAtMs) &&
    (Number.isNaN(lastVisitedMs) || lastVisitedMs < wokeAtMs) &&
    thread.settledOverride !== "settled";
  const shouldRecede = shouldRecedeSidebarThread({
    status,
    isUnread,
    isWoke,
    isActive: props.isActive,
    isSelected,
  });
  const topStatus: { label: string; icon: IconName; color: string } | null =
    status === "working"
      ? { label: thread.goal?.status === "active" ? "Goal" : "Working", icon: "circle-dashed", color: theme.info }
      : status === "waiting"
        ? { label: "Waiting", icon: "circle-dot-dashed", color: theme.mutedForeground }
        : status === "approval"
          ? { label: "Approval", icon: "shield-question", color: theme.warningForeground }
          : status === "input"
            ? { label: "Input", icon: "message-circle-question", color: theme.indigo }
            : status === "limited"
              ? { label: "Limited", icon: "circle-alert", color: theme.warning }
              : status === "failed"
                ? { label: "Failed", icon: "circle-alert", color: theme.error }
                : isWoke
                  ? { label: "Woke", icon: "alarm-clock", color: theme.warning }
                  : isUnread
                    ? { label: "Done", icon: "circle-check", color: theme.success }
                    : null;

  // The queued-turn gate reopens on its own after the grace window; the minute
  // tick re-evaluates it.
  useNowMinute();
  const showSnoozeButton =
    canOperate && props.snoozeSupported && canSnooze(thread, { now: new Date().toISOString() });
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  useEffect(() => {
    if (snoozeMenuOpenRaw && !showSnoozeButton) setSnoozeMenuOpen(false);
  }, [snoozeMenuOpenRaw, showSnoozeButton]);

  const revealed = hovered || snoozeMenuOpen;
  const settledMuted = variantAction === "unsettle" && !hovered ? alpha(tones.secondaryLabel, 0.7) : null;

  const handleClick = (event: { clickCount?: number; modifiers?: { shift?: boolean; ctrl?: boolean; cmd?: boolean; alt?: boolean } }) => {
    if (consumeRowClick(threadKey) !== "row") return;
    if (isRenaming) return;
    const modifiers = event.modifiers;
    // Sidebar.tsx handleThreadClick: mod-click toggles, shift-click extends from the anchor.
    if (process.platform === "darwin" ? modifiers?.cmd : modifiers?.ctrl) {
      toggleThreadSelection(threadKey);
      return;
    }
    if (modifiers?.shift) {
      rangeSelectThreadsTo(threadKey, appAtomRegistry.get(sidebarThreadListAtom).orderedThreadKeys);
      return;
    }
    if ((event.clickCount ?? 1) === 2) {
      if (canOperate && !modifiers?.alt) {
        setRename({ threadKey, title: thread.title });
      }
      return;
    }
    if ((event.clickCount ?? 1) > 2) return;
    clearThreadSelection();
    setThreadSelectionAnchor(threadKey);
    navigateToThread(threadRef);
  };
  const gestureHandlers = ghost
    ? {}
    : {
        onClick: handleClick,
        onMouseDown: (event: { x?: number; y?: number; button?: number }) => rowMouseDown(threadKey, event),
        onMouseMove: rowMouseMove,
        onMouseUp: rowMouseUp,
      };
  const handleAuxClick = (event: { x?: number; y?: number; isRightClick?: boolean }) => {
    if (event.isRightClick === false) return;
    const selection = appAtomRegistry.get(threadSelectionAtom).selectedThreadKeys;
    setContextMenu(
      selection.size > 0 && selection.has(threadKey)
        ? { kind: "selection", x: event.x ?? 0, y: event.y ?? 0 }
        : { kind: "thread", threadKey, x: event.x ?? 0, y: event.y ?? 0 },
    );
  };

  const rowBackground = ghost
    ? overSidebar(theme, theme.sidebar.rowActive)
    : props.isActive
    ? theme.sidebar.rowActive
    : isSelected || sweepAction !== null
      ? theme.sidebar.rowSelected
      : hasUnsentDraft
      ? hovered
        ? alpha(theme.warning, 0.08)
        : alpha(theme.warning, 0.04)
      : hovered
        ? theme.sidebar.rowHover
        : "#00000000";
  const workingRecede = shouldRecede && status === "working" && !hovered;

  const titleColor =
    variant === "card"
      ? shouldRecede
        ? tones.secondaryLabel
        : isUnread || isWoke || status === "input"
          ? theme.foreground
          : status === "failed"
            ? alpha(theme.foreground, 0.95)
            : alpha(theme.foreground, 0.9)
      : hovered
        ? theme.foreground
        : shouldRecede
          ? alpha(tones.secondaryLabel, 0.7)
          : props.isActive || isWoke || status === "input"
            ? theme.foreground
            : isUnread
              ? theme.mutedForeground
              : alpha(tones.secondaryLabel, 0.7);

  const title = isRenaming ? (
    <input
      autoFocus
      testId="sidebar-rename-input"
      value={rename.title}
      onChange={(event) => setRename({ threadKey, title: event.value ?? "" })}
      onSubmit={(event) => {
        setRename(null);
        void renameThread(threadRef, event.value ?? rename.title, thread.title);
      }}
      onKeyDown={(event) => {
        if (event.key === "escape") {
          event.stopPropagation();
          setRename(null);
        }
      }}
      onBlur={() => {
        const current = rename;
        setRename(null);
        if (current) void renameThread(threadRef, current.title, thread.title);
      }}
      style={{
        flexGrow: 1,
        minWidth: 0,
        height: 20,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.foreground,
        backgroundColor: theme.card,
        color: theme.foreground,
        fontSize: 14,
        fontWeight: 500,
        fontFamily: FONTS.sans,
      }}
    />
  ) : (
    <Text
      size="sm"
      weight={shouldRecede ? 400 : 500}
      color={titleColor}
      truncate
      style={{ flexGrow: 1, flexShrink: 1, ...(isRegeneratingTitle ? { opacity: 0.55 } : {}) }}
    >
      {thread.title}
    </Text>
  );

  const showPin = thread.pinnedAt != null && (!ghost || (props.dragOverPinned === true && props.dropVerb == null));
  const pinIndicator =
    showPin ? (
      props.pinningSupported && canOperate && !ghost ? (
        <Tooltip content="Unpin thread" side="top">
          <PinButton threadRef={threadRef} />
        </Tooltip>
      ) : (
        <Icon name="pin" size={12} color={alpha(theme.mutedForeground, 0.65)} />
      )
    ) : null;
  const draftIndicator = hasUnsentDraft ? (
    <Tooltip content="Unsent draft" side="top">
      <div style={{ display: "flex", flexShrink: 0 }}>
        <Icon name="square-pen" size={12} color={theme.warningForeground} />
      </div>
    </Tooltip>
  ) : null;
  const prBadge = <PullRequestBadge thread={thread} isRouteThread={props.isRouteThread} muted={settledMuted} />;
  const hoverCard = (
    <SidebarThreadHoverCard
      thread={thread}
      project={props.project}
      projectDisplayName={props.projectDisplayName}
      providerEntryByInstanceId={props.providerEntryByInstanceId}
    />
  );

  if (variant === "slim") {
    const actionIcon: { icon: IconName; size: number; tooltip: string; run: () => void } | null =
      variantAction === "unsnooze"
        ? props.snoozeSupported
          ? { icon: "alarm-clock-off", size: 12, tooltip: "Wake thread now", run: () => attemptUnsnooze(threadRef) }
          : null
        : !props.settlementSupported
          ? null
          : variantAction === "unsettle"
            ? { icon: "undo-2", size: 14, tooltip: "Un-settle thread", run: () => attemptUnsettle(threadRef) }
            : { icon: "check", size: 12, tooltip: "Settle thread", run: () => attemptSettle(threadRef) };
    const slimRow = (
        <div
          testId={ghost ? "sidebar-drag-ghost" : `sidebar-row-slim-${thread.id}`}
          {...gestureHandlers}
          {...(ghost ? {} : { onAuxClick: handleAuxClick })}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            width: "100%",
            height: 36,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: RADIUS.md,
            flexShrink: 0,
            backgroundColor: rowBackground,
            cursor: "pointer",
            overflow: "hidden",
            ...(ghost ? { boxShadow: DRAG_GHOST_SHADOW } : {}),
          }}
        >
          {props.project ? (
            <ProjectFavicon
              project={props.project}
              size={16}
              opacity={!hovered && (!props.isActive || variantAction === "unsettle") ? 0.4 : 1}
              grayscale={!hovered && (!props.isActive || variantAction === "unsettle")}
            />
          ) : null}
          {draftIndicator}
          {title}
          {pinIndicator}
          {prBadge}
          {ghost ? dragDestination : sweepAction !== null ? null : (
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              height: 24,
              minWidth: 32,
              flexShrink: 0,
            }}
          >
            {isWoke ? (
              <WokeButton threadRef={threadRef} wokeAt={props.wokeAt} size={12} />
            ) : hovered && actionIcon ? null : variantAction === "unsnooze" && props.snoozeWakeLabelText !== null ? (
              <Text size="xs" color={theme.infoForeground} style={{ whiteSpace: "nowrap" }}>
                {props.snoozeWakeLabelText}
              </Text>
            ) : (
              <RelativeTimeLabel
                timestamp={variantAction === "unsettle" ? resolveSettledThreadTimestamp(thread) : threadTimeTimestamp(thread)}
                color={settledMuted ?? tones.secondaryLabel}
              />
            )}
            {hovered && actionIcon ? (
              <Tooltip content={actionIcon.tooltip} side="top">
                <RowIconAction
                  icon={actionIcon.icon}
                  size={actionIcon.size}
                  testId="sidebar-row-action"
                  onActivate={actionIcon.run}
                  sweep={variantAction}
                />
              </Tooltip>
            ) : null}
          </div>
          )}
          {sweepAction !== null ? dragDestination : null}
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </div>
    );
    return ghost ? (
      slimRow
    ) : (
      <HoverCard disabled={isRenaming} card={hoverCard}>
        {slimRow}
      </HoverCard>
    );
  }

  const isRemoteMachine = props.isRemote;
  const cardRow = (
        <div
          testId={ghost ? "sidebar-drag-ghost" : `sidebar-row-card-${thread.id}`}
          {...gestureHandlers}
          {...(ghost ? {} : { onAuxClick: handleAuxClick })}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: 78,
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: RADIUS.md,
            backgroundColor: rowBackground,
            cursor: "pointer",
            overflow: "hidden",
            ...(workingRecede && !ghost ? { opacity: 0.7 } : {}),
            ...(ghost ? { boxShadow: DRAG_GHOST_SHADOW } : {}),
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: "100%", height: 20, minWidth: 0 }}>
            {draftIndicator}
            {props.project ? <ProjectFavicon project={props.project} size={16} /> : null}
            {pinIndicator}
            {props.projectDisplayName ? (
              <Text
                size="xs"
                weight={shouldRecede ? 400 : 500}
                color={tones.secondaryLabel}
                truncate
                style={{ flexGrow: 1, flexShrink: 1 }}
              >
                {props.projectDisplayName}
              </Text>
            ) : (
              <div style={{ flexGrow: 1 }} />
            )}
            {ghost ? dragDestination : sweepAction !== null ? null : (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "stretch", justifyContent: "flex-end", height: 20, minWidth: 32, flexShrink: 0 }}>
              {revealed && !(topStatus?.icon === "alarm-clock") && (props.settlementSupported || showSnoozeButton || hasUnsentDraft) ? (
                <div style={{ display: "flex", flexDirection: "row", alignItems: "stretch" }}>
                  {hasUnsentDraft && draftDiscard ? (
                    <Tooltip content="Discard draft" side="top">
                      <RowIconAction icon="x" size={14} onActivate={() => draftDiscard.discardThreadDraft(threadRef)} />
                    </Tooltip>
                  ) : null}
                  {showSnoozeButton ? (
                    <SnoozeMenuButton
                      open={snoozeMenuOpen}
                      onOpenChange={setSnoozeMenuOpen}
                      onSnooze={(preset) => attemptSnooze(threadRef, preset.snoozedUntil)}
                    />
                  ) : null}
                  {props.settlementSupported ? (
                    <Tooltip content="Settle thread" side="top">
                      <SettleButton testId="sidebar-settle-button" onActivate={() => attemptSettle(threadRef)} />
                    </Tooltip>
                  ) : null}
                </div>
              ) : topStatus ? (
                topStatus.icon === "alarm-clock" ? (
                  <WokeButton threadRef={threadRef} wokeAt={props.wokeAt} size={16} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Icon name={topStatus.icon} size={16} color={topStatus.color} />
                    <Text size="xs" weight={500} color={topStatus.color} style={{ whiteSpace: "nowrap" }}>
                      {topStatus.label}
                    </Text>
                    {status === "working" ? (
                      <WorkingDuration startedAt={resolveWorkingStartedAt(thread)} color={topStatus.color} />
                    ) : status === "waiting" ? (
                      <WorkingDuration startedAt={thread.latestRun?.completedAt ?? null} color={topStatus.color} />
                    ) : null}
                  </div>
                )
              ) : (
                <div style={{ display: "flex", alignItems: "center" }}>
                  <RelativeTimeLabel timestamp={threadTimeTimestamp(thread)} color={tones.secondaryLabel} />
                </div>
              )}
            </div>
            )}
            {sweepAction !== null ? dragDestination : null}
          </div>
          <div style={{ display: "flex", flexDirection: "row", width: "100%", marginTop: 4, minWidth: 0 }}>{title}</div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: "100%", marginTop: 2, minWidth: 0, height: 16 }}>
            {thread.branch ? (
              <>
                {thread.worktreePath?.trim() ? (
                  <Tooltip content={`Worktree: ${thread.worktreePath} (${thread.branch})`} side="top">
                    <div style={{ display: "flex", flexShrink: 0 }}>
                      <Icon name="folder-git-2" size={12} color={alpha(tones.muted, 0.4)} />
                    </div>
                  </Tooltip>
                ) : null}
                <div style={{ display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                  <MiddleTruncate value={thread.branch} color={alpha(tones.muted, 0.4)} />
                </div>
              </>
            ) : (
              <div style={{ flexGrow: 1 }} />
            )}
            {prBadge}
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, pointerEvents: "none" }}>
              {isRemoteMachine ? <RemoteMachineIcon environmentId={thread.environmentId} /> : null}
              <SidebarProviderStack thread={thread} providerEntryByInstanceId={props.providerEntryByInstanceId} />
            </div>
          </div>
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </div>
  );
  return (
    <div style={{ width: "100%", paddingTop: 2, paddingBottom: 2, flexShrink: 0 }}>
      {ghost ? (
        cardRow
      ) : (
        <HoverCard disabled={snoozeMenuOpen || isRenaming} card={hoverCard}>
          {cardRow}
        </HoverCard>
      )}
    </div>
  );
}

/** shadow-lg (0 10px 15px -3px, 0 4px 6px -4px, black/10), blur halved for GPUI. */
const DRAG_GHOST_SHADOW = [
  { offsetX: 0, offsetY: 10, blurRadius: 7.5, spreadRadius: -3, color: "#0000001a" },
  { offsetX: 0, offsetY: 4, blurRadius: 3, spreadRadius: -4, color: "#0000001a" },
];

function RemoteMachineIcon({ environmentId }: { environmentId: string }) {
  const theme = useTheme();
  const icon = useEnvironmentMachine(environmentId);
  return <Icon name={icon} size={14} color={alpha(theme.sidebar.mutedForeground, 0.7)} />;
}

function PinButton({ threadRef }: { threadRef: ScopedThreadRef }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={(event) => pressControl(event, () => attemptUnpin(threadRef))}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", flexShrink: 0, cursor: "pointer" }}
    >
      <Icon name={hovered ? "pin-off" : "pin"} size={12} color={hovered ? theme.foreground : alpha(theme.mutedForeground, 0.65)} />
    </div>
  );
}

function WokeButton({ threadRef, wokeAt, size }: { threadRef: ScopedThreadRef; wokeAt: string | null; size: number }) {
  const theme = useTheme();
  return (
    <Tooltip content="Dismiss Woke notification" side="top">
      <div
        onMouseDown={(event) =>
          pressControl(event, () => {
            if (wokeAt !== null) acknowledgeThreadWoke(threadRef, wokeAt);
          })
        }
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, cursor: "pointer" }}
      >
        <Icon name="alarm-clock" size={size} color={theme.warning} />
        <Text size="xs" weight={500} color={theme.warning}>
          Woke
        </Text>
      </div>
    </Tooltip>
  );
}

function RowIconAction({
  icon,
  size,
  onActivate,
  sweep = null,
  testId,
}: {
  icon: IconName;
  size: number;
  onActivate: () => void;
  /** Dragging from this control sweeps the action across rows. */
  sweep?: SidebarSweepAction | null;
  testId?: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={testId}
      onMouseDown={(event) => pressControl(event, onActivate, sweep)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", alignItems: "center", height: "100%", paddingLeft: 6, paddingRight: 6, borderRadius: RADIUS.sm, cursor: "pointer" }}
    >
      <Icon name={icon} size={size} color={hovered ? theme.foreground : theme.sidebar.mutedForeground} />
    </div>
  );
}

function SettleButton({ onActivate, testId }: { onActivate: () => void; testId?: string }) {
  const sweep: SidebarSweepAction = "settle";
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const color = hovered ? theme.foreground : theme.sidebar.mutedForeground;
  return (
    <div
      testId={testId}
      onMouseDown={(event) => pressControl(event, onActivate, sweep)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 20,
        paddingLeft: 6,
        paddingRight: 6,
        marginRight: -4,
        borderRadius: RADIUS.sm,
        cursor: "pointer",
      }}
    >
      <Icon name="check" size={14} color={color} />
      <Text size="xs" color={color}>
        Settle
      </Text>
    </div>
  );
}

// ── Search result row ───────────────────────────────────────────────────

function SearchMatchExcerpt({ match, query }: { match: EnvironmentThreadSearchMatch; query: string }) {
  const theme = useTheme();
  const isUser = match.source === "user";
  // gpuix has no inline runs: sibling <text> nodes are separate flex items,
  // so the snippet is one truncating line and the query is not bolded.
  void query;
  const base = { fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, whiteSpace: "nowrap" as const };
  return (
    <div style={{ display: "flex", flexDirection: "row", minWidth: 0, overflow: "hidden", height: 16 }}>
      <text style={{ ...base, flexShrink: 0, color: isUser ? theme.infoForeground : theme.successForeground }}>
        {isUser ? "You:" : "Agent:"}
      </text>
      <text
        style={{
          ...base,
          paddingLeft: 3,
          flexShrink: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: alpha(theme.mutedForeground, 0.85),
        }}
      >
        {match.snippet}
      </text>
    </div>
  );
}

export const SidebarSearchResultRow = memo(function SidebarSearchResultRow(props: {
  readonly isSettled: boolean;
  readonly thread: EnvironmentThreadShell;
  readonly project: EnvironmentProject | null;
  readonly projectDisplayName: string | null;
  readonly providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  readonly isHighlighted: boolean;
  readonly isRouteActive: boolean;
  readonly searchMatch: EnvironmentThreadSearchMatch | null;
  readonly searchQuery: string;
  readonly index: number;
  readonly onHighlight: (index: number) => void;
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
}) {
  const theme = useTheme();
  const tones = sidebarTones(theme);
  const ref = scopeThreadRef(props.thread.environmentId, props.thread.id);
  const thread = useAtomValue(environmentThreadShells.threadShellAtom(ref)) ?? props.thread;
  const [hovered, setHovered] = useState(false);
  const emphasized = props.isHighlighted || props.isRouteActive;
  return (
    <HoverCard
      disabled={false}
      card={
        <SidebarThreadHoverCard
          thread={thread}
          project={props.project}
          projectDisplayName={props.projectDisplayName}
          providerEntryByInstanceId={props.providerEntryByInstanceId}
        />
      }
    >
      <div
        testId={`sidebar-search-result-${props.index}`}
        onMouseMove={() => props.onHighlight(props.index)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => props.onSelect(thread)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          minHeight: 36,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: RADIUS.md,
          flexShrink: 0,
          backgroundColor: emphasized ? theme.sidebar.rowActive : hovered ? theme.sidebar.rowHover : "#00000000",
          cursor: "pointer",
        }}
      >
        {props.project ? (
          <ProjectFavicon
            project={props.project}
            size={16}
            opacity={props.isSettled && !emphasized && !hovered ? 0.4 : 1}
            grayscale={props.isSettled && !emphasized && !hovered}
          />
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
            <Text
              size="sm"
              weight={props.isSettled ? 400 : 500}
              color={
                emphasized || hovered || !props.isSettled ? theme.foreground : alpha(tones.secondaryLabel, 0.7)
              }
              truncate
              style={{ flexGrow: 1, flexShrink: 1, ...(thread.titleRegeneration != null ? { opacity: 0.55 } : {}) }}
            >
              {thread.title}
            </Text>
            <div style={{ display: "flex", justifyContent: "flex-end", width: 32, flexShrink: 0 }}>
              <RelativeTimeLabel timestamp={threadTimeTimestamp(thread)} color={alpha(theme.mutedForeground, 0.55)} />
            </div>
          </div>
          {props.searchMatch ? <SearchMatchExcerpt match={props.searchMatch} query={props.searchQuery} /> : null}
        </div>
      </div>
    </HoverCard>
  );
});
