// Small pieces the Providers page shares: the stacked settings row the detail pane uses,
// the pane's section title and split card, provider icons, the number stepper and the
// version advisory popover.
import type { ProviderDriverKind } from "@t3tools/contracts";
import {
  normalizeProviderAccentColor,
  providerAccentForegroundColor,
  providerInstanceInitials,
} from "@t3tools/client-runtime/state/provider-instance-display";
import { useState, type ReactNode } from "react";

import { ProviderInstanceIcon } from "../../chat/composer/ProviderInstanceIcon.tsx";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { LUCIDE } from "../../ui/lucide.gen.ts";
import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text, type Style } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { getProviderVersionLabel } from "../../web/components/settings/providerStatus.ts";
import { fieldBackground } from "../controls.tsx";
import { copyText } from "../openExternal.ts";
import { ANTIGRAVITY_ICON_DATA_URL } from "./antigravityIcon.ts";
import { providerClients, type ProviderIcon } from "./providerDriverMeta.ts";

// ── Layout ──────────────────────────────────────────────────────────────

/**
 * SettingsRow below its 32rem container breakpoint: title, description and status
 * stacked, the control on its own full-width line (gap 12). The detail pane is
 * always narrower than that, so its rows always stack.
 */
export function StackedRow({
  title,
  titleTail,
  description,
  status,
  control,
  children,
  testId,
}: {
  title: ReactNode;
  titleTail?: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      style={{ display: "flex", flexDirection: "column", paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: children ? 4 : 12 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 }}>
            {typeof title === "string" ? <Text weight={500}>{title}</Text> : title}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0 }}>{titleTail}</div>
          </div>
          {description ? (
            typeof description === "string" ? (
              <Text size="xs" color={alpha(theme.mutedForeground, 0.8)} style={{ lineHeight: 18 }}>
                {description}
              </Text>
            ) : (
              description
            )
          ) : null}
          {status ? <div style={{ display: "flex", flexDirection: "column", paddingTop: 2 }}>{status}</div> : null}
        </div>
        {control ? <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>{control}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** SettingsSection's title row (min-h 28, px 16, 14px at 70%) with an optional icon and right side. */
export function PaneSectionTitle({ title, icon, right }: { title: string; icon?: ReactNode; right?: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, width: "100%", minHeight: 28, paddingLeft: 16, paddingRight: 16 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexGrow: 1 }}>
        {icon}
        <Text color={alpha(theme.foreground, 0.7)}>{title}</Text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>{right}</div>
    </div>
  );
}

export type CardPosition = "single" | "first" | "middle" | "last";

/**
 * One slice of a SettingsGroup card, so a long card can be split into
 * virtual-list items. `divided` draws the border/50 line above non-first slices.
 */
export function PaneCard({ position, divided = true, children, style }: { position: CardPosition; divided?: boolean; children: ReactNode; style?: Style }) {
  const theme = useTheme();
  const top = position === "single" || position === "first";
  const bottom = position === "single" || position === "last";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: top || divided ? 1 : 0,
        borderBottomWidth: bottom ? 1 : 0,
        borderColor: top ? alpha(theme.border, 0.6) : alpha(theme.border, 0.5),
        backgroundColor: alpha(theme.card, 0.4),
        ...(top ? { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl } : {}),
        ...(bottom ? { borderBottomLeftRadius: RADIUS.xl, borderBottomRightRadius: RADIUS.xl } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Icons ───────────────────────────────────────────────────────────────

function iconLayers(icon: ProviderIcon, dark: boolean) {
  const base = dark ? icon.fill.dark : icon.fill.light;
  return icon.paths.map((path) => ({
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}"><path fill="#000"${path.fillRule ? ` fill-rule="${path.fillRule}"` : ""} d="${path.d}"/></svg>`,
    // gpuix tints an <svg> as one mask, so each path is its own layer; a gradient keeps its first stop.
    color: path.gradient?.stops[0]?.color ?? (path.fill ? (dark ? path.fill.dark : path.fill.light) : base),
  }));
}

/**
 * ProviderInstanceIcon for any driver: Codex and Claude marks come from the composer's
 * icon, the other drivers draw the mark their client definition carries.
 */
export function DriverIcon({
  driver,
  displayName,
  accentColor,
  size = 16,
  boxSize = size,
  showBadge = false,
  color,
}: {
  driver: ProviderDriverKind | string;
  displayName: string;
  accentColor?: string | undefined;
  size?: number;
  boxSize?: number;
  showBadge?: boolean;
  color?: string;
}) {
  const theme = useTheme();
  const icon = providerClients.get(driver as ProviderDriverKind)?.icon;
  if (driver === "antigravity") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: boxSize, height: boxSize, flexShrink: 0, pointerEvents: "none" }}>
        <img src={ANTIGRAVITY_ICON_DATA_URL} style={{ width: size, height: size }} />
      </div>
    );
  }
  if (!icon || driver === "codex" || driver === "claudeAgent") {
    return (
      <ProviderInstanceIcon
        driverKind={driver as ProviderDriverKind}
        displayName={displayName}
        accentColor={accentColor}
        size={size}
        boxSize={boxSize}
        showBadge={showBadge}
        {...(color ? { color } : {})}
      />
    );
  }
  const accent = normalizeProviderAccentColor(accentColor);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: boxSize, height: boxSize, flexShrink: 0, pointerEvents: "none" }}>
      {iconLayers(icon, theme.appearance === "dark").map((layer, index) => (
        <svg
          key={index}
          source={layer.source}
          style={{ position: "absolute", left: (boxSize - size) / 2, top: (boxSize - size) / 2, width: size, height: size, color: layer.color }}
        />
      ))}
      {showBadge ? (
        <div
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 14,
            minWidth: 14,
            paddingLeft: 2,
            paddingRight: 2,
            borderRadius: 7,
            borderWidth: 1,
            borderColor: theme.card,
            backgroundColor: accent ?? theme.card,
          }}
        >
          <text style={{ color: accent ? providerAccentForegroundColor(accent) : theme.mutedForeground, fontSize: 7, lineHeight: 7, fontWeight: 600, fontFamily: FONTS.sans }}>
            {providerInstanceInitials(displayName)}
          </text>
        </div>
      ) : null}
    </div>
  );
}

const FILLED_STAR = LUCIDE.star.replace('fill="none"', 'fill="#000"');

export function StarIcon({ filled, size = 12, color }: { filled: boolean; size?: number; color: string }) {
  if (!filled) return <Icon name="star" size={size} color={color} />;
  return <svg source={FILLED_STAR} style={{ width: size, height: size, flexShrink: 0, color, pointerEvents: "none" }} />;
}

// ── Controls ────────────────────────────────────────────────────────────

/** ui/number-field.tsx size sm: [−][value][+] in one bordered group (w-32). */
export function NumberStepper({
  value,
  min,
  step,
  onCommit,
  disabled,
  testId,
}: {
  value: number;
  min: number;
  step: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(String(value));
  const [source, setSource] = useState(value);
  if (source !== value) {
    setSource(value);
    setDraft(String(value));
  }
  const commit = (next: number) => {
    const clamped = Math.max(min, Math.round(next));
    if (clamped !== value) onCommit(clamped);
    setDraft(String(clamped));
  };
  const commitDraft = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) setDraft(String(value));
    else commit(parsed);
  };
  const stepButton = (icon: IconName, delta: number, id: string) => (
    <div
      testId={testId ? `${testId}-${id}` : undefined}
      onClick={disabled ? undefined : () => commit(value + delta)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 26,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      <Icon name={icon} size={16} color={theme.foreground} />
    </div>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        width: 128,
        height: 28,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: fieldBackground(theme),
        overflow: "hidden",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      {stepButton("minus", -step, "decrement")}
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", flexGrow: 1, minWidth: 0 }}>
      <input
        testId={testId}
        value={draft}
        readOnly={disabled}
        theme={{ caret: theme.foreground, textMuted: theme.mutedForeground, appearance: theme.appearance }}
        onChange={(event) => setDraft(event.value ?? "")}
        onSubmit={commitDraft}
        onBlur={commitDraft}
        style={{ width: Math.max(12, draft.length * 8 + 4), height: 26, fontSize: 14, lineHeight: 26, color: theme.foreground, fontFamily: FONTS.sans }}
      />
      </div>
      {stepButton("plus", step, "increment")}
    </div>
  );
}

/** switch.tsx size="sm": 26×16 track, 12px thumb. */
export function SmallSwitch({ checked, disabled, onChange, testId }: { checked: boolean; disabled: boolean; onChange: (next: boolean) => void; testId?: string }) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : () => onChange(!checked)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        width: 26,
        height: 16,
        padding: 2,
        borderRadius: 8,
        backgroundColor: checked ? theme.primary : theme.input,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: checked || theme.appearance === "light" ? "#ffffff" : theme.mutedForeground,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ── Version advisory ────────────────────────────────────────────────────

export interface VersionAdvisoryView {
  readonly title: string;
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
  readonly targetVersion: string | null;
}

/** The ArrowUpCircle / AlertTriangle button next to a provider version, with its details popover. */
export function VersionAdvisoryButton({
  advisory,
  compact,
  warning,
  displayName,
  updateProgress,
  updateProblem,
  isUpdating,
  onRunAction,
  testId,
}: {
  advisory: VersionAdvisoryView;
  compact: boolean;
  warning: boolean;
  displayName: string;
  updateProgress: string | null;
  updateProblem: string | null;
  isUpdating: boolean;
  onRunAction: (() => void) | undefined;
  testId?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const size = compact ? 20 : 24;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      testId={testId ? `${testId}-popover` : undefined}
      style={{ width: 320, padding: 16, gap: 12 }}
      trigger={
        <Tooltip content={updateProgress ? "Updating" : advisory.title} side="top">
          <IconButton
            testId={testId}
            icon={updateProgress ? "loader" : warning ? "triangle-alert" : "circle-arrow-up"}
            size={size}
            iconSize={14}
            color={warning ? theme.warning : theme.mutedForeground}
            onClick={() => setOpen(!open)}
          />
        </Tooltip>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Text weight={600}>{advisory.title}</Text>
        <Text size="xs" color={advisory.emphasis === "strong" ? theme.warning : theme.mutedForeground}>
          {advisory.detail}
        </Text>
      </div>
      {onRunAction ? (
        <Button size="xs" variant="outline" icon="download" disabled={isUpdating} onClick={onRunAction} style={{ width: "100%" }} testId={testId ? `${testId}-run` : undefined}>
          {isUpdating ? "Updating" : advisory.targetVersion ? `Install ${getProviderVersionLabel(advisory.targetVersion)}` : "Update now"}
        </Button>
      ) : null}
      {updateProgress || updateProblem ? (
        <Text size="xs" color={updateProblem ? theme.warning : theme.mutedForeground}>
          {updateProgress ?? updateProblem}
        </Text>
      ) : null}
      {onRunAction && advisory.updateCommand ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <div style={{ flexGrow: 1, height: 1, backgroundColor: theme.border }} />
          <Text size="3xs" weight={500} color={theme.mutedForeground}>
            OR, UPDATE MANUALLY USING
          </Text>
          <div style={{ flexGrow: 1, height: 1, backgroundColor: theme.border }} />
        </div>
      ) : null}
      {advisory.updateCommand ? (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingTop: 2,
            paddingBottom: 2,
            paddingRight: 2,
            paddingLeft: 8,
            borderRadius: RADIUS.sm,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.7),
            backgroundColor: alpha(theme.muted, 0.4),
          }}
        >
          <Text size="2xs" mono truncate style={{ flexGrow: 1 }}>
            {advisory.updateCommand}
          </Text>
          <Tooltip content="Copy command" side="top">
            <IconButton
              icon="copy"
              size={24}
              iconSize={12}
              onClick={() => {
                const copied = copyText(advisory.updateCommand ?? "");
                toast(
                  copied
                    ? { type: "success", title: `${displayName} update command copied`, description: "Run it in a terminal when you are ready to update." }
                    : { type: "error", title: `Could not copy ${displayName} update command` },
                );
              }}
            />
          </Tooltip>
        </div>
      ) : null}
    </Popover>
  );
}
