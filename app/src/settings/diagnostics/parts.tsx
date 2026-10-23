// View pieces shared by the Diagnostics page and its resource telemetry
// sections: ports of the small components inside
// apps/web/src/components/settings/{DiagnosticsSettings,ResourceTelemetryDiagnostics,
// ProcessSignalActions,ExpandableText}.tsx, plus the table and card slices the
// page uses to virtualize its long tables.
import type { ServerProcessSignal } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useState, type ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { IconButton, Text, type Style } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme, type Palette } from "../../ui/theme.ts";
import { copyText } from "../openExternal.ts";
import { useRelativeTimeState } from "./useRelativeTimeState.ts";

/**
 * Tailwind's `tracking-widest` (0.1em) on the uppercase labels. gpuix has no
 * letter-spacing, so a hair space between letters stands in for it.
 */
export function tracked(text: string): string {
  return [...text.toUpperCase()].join(" ");
}

/**
 * The web's `--muted`: white at 3% in dark (ui/theme.ts approximates it as
 * opaque #111111, which vanishes on cards), zinc-50 in light.
 */
export function mutedSurface(theme: Palette): string {
  return theme.appearance === "dark" ? "#ffffff08" : theme.muted;
}

/** `text-destructive`, `text-warning-foreground` and the default foreground for a stat tone. */
export function toneColor(theme: Palette, tone: "default" | "warning" | "danger"): string {
  return tone === "danger" ? theme.error : tone === "warning" ? theme.warningForeground : theme.foreground;
}

// ── Relative times ──────────────────────────────────────────────────────

/** RelativeTimeNoWrap: "5m ago" with a non-breaking space, or nothing. */
export function useRelativeTimeNoWrap(value: DateTime.Utc): string {
  const relative = useRelativeTimeState(DateTime.formatIso(value));
  if (relative.status !== "relative") return "";
  return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
}

export function RelativeTimeText({ value, color }: { value: DateTime.Utc; color: string }) {
  const label = useRelativeTimeNoWrap(value);
  return (
    <Text size="xs" mono color={color} style={{ whiteSpace: "nowrap" }}>
      {label}
    </Text>
  );
}

/** DiagnosticsLastChecked: "Checked 5m ago" next to a section's refresh button. */
export function DiagnosticsLastChecked({ checkedAt }: { checkedAt: DateTime.Utc | null }) {
  const theme = useTheme();
  const relative = useRelativeTimeState(checkedAt ? DateTime.formatIso(checkedAt) : null);
  if (relative.status === "missing") {
    return (
      <Text size="2xs" color={alpha(theme.mutedForeground, 0.5)}>
        Checking
      </Text>
    );
  }
  if (relative.status === "invalid") {
    return (
      <Text size="2xs" color={alpha(theme.mutedForeground, 0.5)}>
        Checked unavailable
      </Text>
    );
  }
  const color = alpha(theme.mutedForeground, 0.6);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", flexShrink: 0 }}>
      <Text size="2xs" color={color}>
        {"Checked "}
      </Text>
      {relative.suffix ? (
        <>
          <Text size="2xs" mono color={color}>
            {relative.value}
          </Text>
          <Text size="2xs" color={color}>
            {` ${relative.suffix}`}
          </Text>
        </>
      ) : (
        <Text size="2xs" color={color}>
          {relative.value}
        </Text>
      )}
    </div>
  );
}

/**
 * RefreshIcon in an icon button. The web spins the icon while a refresh is in
 * flight; t3-term never runs a repainting animation, so it only disables.
 */
export function RefreshButton({
  isPending,
  label,
  onClick,
  size = "xs",
  testId,
}: {
  isPending: boolean;
  label: string;
  onClick: () => void;
  /** `icon-xs` ghost-muted (24, 14px glyph) or `icon-micro` ghost (20, 12px glyph). */
  size?: "xs" | "micro";
  testId: string;
}) {
  return (
    <Tooltip content={label} side="top">
      <IconButton
        icon="refresh-cw"
        size={size === "xs" ? 24 : 20}
        iconSize={size === "xs" ? 14 : 12}
        disabled={isPending}
        onClick={onClick}
        testId={testId}
      />
    </Tooltip>
  );
}

// ── Stats ───────────────────────────────────────────────────────────────

/** StatBlock: an uppercase label (optional info tooltip) over a mono figure. */
export function StatBlock({
  label,
  value,
  tooltip,
  tone = "default",
}: {
  label: string;
  value: string;
  tooltip?: string;
  tone?: "default" | "warning" | "danger";
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, paddingLeft: 20, paddingRight: 20, paddingTop: 12, paddingBottom: 12 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Text size="2xs" weight={500} color={alpha(theme.mutedForeground, 0.7)} style={{ whiteSpace: "nowrap" }}>
          {tracked(label)}
        </Text>
        {tooltip ? <InfoTooltip label={label} content={tooltip} /> : null}
      </div>
      <Text mono weight={600} color={toneColor(theme, tone)} style={{ marginTop: 4, fontSize: 18, lineHeight: 28, whiteSpace: "nowrap" }}>
        {value}
      </Text>
    </div>
  );
}

function InfoTooltip({ label, content }: { label: string; content: string }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Tooltip content={content} side="top">
      <div
        testId={`diagnostics-info-${label.toLowerCase().replace(/\s+/g, "-")}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: 4, cursor: "pointer", flexShrink: 0 }}
      >
        <Icon name="info" size={12} color={hover ? theme.foreground : alpha(theme.mutedForeground, 0.6)} />
      </div>
    </Tooltip>
  );
}

/** StatsGrid: four equal cells split by border/60 rules. */
export function StatsGrid({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const cells = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "row" }}>
      {cells.map((cell, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
            ...(index > 0 ? { borderLeftWidth: 1, borderColor: alpha(theme.border, 0.6) } : {}),
          }}
        >
          {cell}
        </div>
      ))}
    </div>
  );
}

/** The `space-y-2 border-t px-5 py-3` block of AlertTriangle lines under a stats grid. */
export function ErrorLines({ lines }: { lines: ReadonlyArray<{ readonly text: string; readonly tone?: "danger" | "warning" }> }) {
  const theme = useTheme();
  if (lines.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        borderTopWidth: 1,
        borderColor: alpha(theme.border, 0.6),
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 12,
        paddingBottom: 12,
      }}
    >
      {lines.map((line, index) => (
        <AlertLine key={index} text={line.text} color={line.tone === "warning" ? theme.warningForeground : theme.error} />
      ))}
    </div>
  );
}

export function AlertLine({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", height: 16, flexShrink: 0 }}>
        <Icon name="triangle-alert" size={14} color={color} />
      </div>
      <Text size="xs" color={color} style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        {text}
      </Text>
    </div>
  );
}

/** EmptyRows: `px-5 py-4 text-xs text-muted-foreground`. */
export function EmptyRows({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 16 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {label}
      </Text>
    </div>
  );
}

// ── Tables ──────────────────────────────────────────────────────────────

export interface DiagnosticsColumn {
  readonly label: string;
  /** Share of the table width (the web's `<col className="w-[NN%]">`). */
  readonly width: number;
  readonly align?: "left" | "right";
  readonly paddingLeft?: number;
  readonly paddingRight?: number;
  /** Let wide content spill past the cell, as table cells do (the Kill buttons). */
  readonly overflowVisible?: boolean;
}

/** A `<table className="table-fixed">` row: cells sized by their column share. */
export function TableRow({
  columns,
  children,
  paddingY,
  alignItems = "center",
  hoverColor,
  style,
}: {
  columns: ReadonlyArray<DiagnosticsColumn>;
  children: ReadonlyArray<ReactNode>;
  paddingY: number;
  alignItems?: "center" | "flex-start";
  hoverColor?: string;
  style?: Style;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        ...(hoverColor ? { hover: { backgroundColor: hoverColor } } : {}),
        ...style,
      }}
    >
      {columns.map((column, index) => (
        // The outer box takes the column share (padding would skew flex-basis 0 shares); the inner one pads.
        <div
          key={`${column.label}:${index}`}
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: column.width,
            flexShrink: 1,
            flexBasis: 0,
            minWidth: 0,
            ...(column.overflowVisible ? {} : { overflow: "hidden" }),
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems,
              justifyContent: column.align === "right" ? "flex-end" : "flex-start",
              flexGrow: 1,
              minWidth: 0,
              paddingLeft: column.paddingLeft ?? 16,
              paddingRight: column.paddingRight ?? 16,
              paddingTop: paddingY,
              paddingBottom: paddingY,
            }}
          >
            {children[index]}
          </div>
        </div>
      ))}
    </div>
  );
}

/** `<thead>`: uppercase, tracked, muted/70 headers over a border/60 rule. */
export function TableHeader({
  columns,
  size = "2xs",
  paddingY = 10,
  color,
}: {
  columns: ReadonlyArray<DiagnosticsColumn>;
  size?: "2xs" | "3xs";
  paddingY?: number;
  color?: string;
}) {
  const theme = useTheme();
  const headerColor = color ?? alpha(theme.mutedForeground, 0.7);
  return (
    <TableRow
      columns={columns}
      paddingY={paddingY}
      style={{ borderBottomWidth: 1, borderColor: alpha(theme.border, 0.6) }}
    >
      {columns.map((column) => (
        <Text key={column.label} size={size} weight={600} color={headerColor} style={{ whiteSpace: "nowrap" }}>
          {tracked(column.label)}
        </Text>
      ))}
    </TableRow>
  );
}

/** A `td` figure: `font-mono tabular-nums`. */
export function MonoCell({ children, color }: { children: string; color?: string }) {
  const theme = useTheme();
  return (
    <Text size="xs" mono color={color ?? theme.foreground} style={{ whiteSpace: "nowrap" }}>
      {children}
    </Text>
  );
}

/** Truncated single-line text. Callers shorten long strings in JS first so layout stays cheap. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

// ── Card slices for the virtual page ────────────────────────────────────

/**
 * One slice of a `SettingsGroup` card (rounded-xl, border/60, bg-card/40)
 * drawn as its own virtual-list item, so a long table only builds the rows on
 * screen. `divider` draws the row rule (`divide-y`) above a middle/last slice.
 */
export function CardSlice({
  position,
  divider,
  children,
}: {
  position: "single" | "first" | "middle" | "last";
  divider?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const top = position === "single" || position === "first";
  const bottom = position === "single" || position === "last";
  const edge = alpha(theme.border, 0.6);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: top ? 1 : 0,
        borderBottomWidth: bottom ? 1 : 0,
        borderColor: edge,
        backgroundColor: alpha(theme.card, 0.4),
        overflow: "hidden",
        ...(top ? { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl } : {}),
        ...(bottom ? { borderBottomLeftRadius: RADIUS.xl, borderBottomRightRadius: RADIUS.xl } : {}),
      }}
    >
      {!top && divider ? <div style={{ height: 1, flexShrink: 0, backgroundColor: divider }} /> : null}
      {children}
    </div>
  );
}

/** A section heading drawn as its own list item (SettingsSection's header, with icon support). */
export function SectionHeading({ title, icon, headerAction }: { title: string; icon?: IconName; headerAction?: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16, minHeight: 28, paddingLeft: 16, paddingRight: 16 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28, minWidth: 0 }}>
        {icon ? <Icon name={icon} size={16} color={theme.mutedForeground} /> : null}
        <Text color={alpha(theme.foreground, 0.7)}>{title}</Text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", minHeight: 28, minWidth: 28 }}>{headerAction}</div>
    </div>
  );
}

// ── ExpandableText ──────────────────────────────────────────────────────

/**
 * The logical lines of `text` that fit in `budget` wrapped lines of about
 * `charsPerLine` characters, the last one clamped to what is left: CSS
 * `line-clamp-N` over `whitespace-pre-wrap`. gpuix's lineClamp only clamps a
 * <text> without newlines, so each logical line is its own <text>.
 */
function clampLogicalLines(text: string, budget: number, charsPerLine: number) {
  const logical = text.split("\n");
  const shown: { text: string; clamp?: number }[] = [];
  let remaining = budget;
  for (const line of logical) {
    if (remaining <= 0) {
      const last = shown.at(-1);
      if (last && last.clamp === undefined) last.text = `${last.text}…`;
      break;
    }
    const needed = Math.max(1, Math.ceil(line.length / charsPerLine));
    if (needed > remaining) {
      shown.push({ text: line, clamp: remaining });
      break;
    }
    shown.push({ text: line });
    remaining -= needed;
  }
  return shown;
}

/**
 * ExpandableText: pre-wrapped text clamped to a few lines with a "Show full
 * error" toggle. Leading spaces survive in gpuix text, so stack frames keep
 * their indent.
 */
export function ExpandableText({
  text,
  lines = 3,
  charsPerLine,
  expandLabel = "Show full error",
  testId,
}: {
  text: string;
  lines?: number;
  /** Roughly how many 12px characters fit on one line of the column. */
  charsPerLine: number;
  expandLabel?: string;
  testId: string;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.length > 180 || text.includes("\n");
  const shown = expanded || !canExpand ? text.split("\n").map((line) => ({ text: line, clamp: undefined })) : clampLogicalLines(text, lines, charsPerLine);
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1, flexShrink: 1 }}>
      {shown.map((line, index) => (
        <Text
          key={index}
          size="xs"
          color={theme.mutedForeground}
          {...(line.clamp === undefined ? {} : { lineClamp: line.clamp })}
          style={{ minWidth: 0, ...(line.clamp === undefined ? {} : { textOverflow: "ellipsis" }) }}
        >
          {line.text === "" ? " " : line.text}
        </Text>
      ))}
      {canExpand ? (
        <TextButton testId={testId} tone="muted" onClick={() => setExpanded((value) => !value)} style={{ marginTop: 4 }}>
          {expanded ? "Show less" : expandLabel}
        </TextButton>
      ) : null}
    </div>
  );
}

/** ui/button.tsx InlineButton (tone muted / destructive): text that underlines on hover. */
export function TextButton({
  children,
  onClick,
  tone = "muted",
  disabled,
  testId,
  style,
}: {
  children: string;
  onClick: () => void;
  tone?: "muted" | "destructive";
  disabled?: boolean;
  testId: string;
  style?: Style;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const active = hover && !disabled;
  const color =
    tone === "destructive"
      ? active
        ? theme.error
        : alpha(theme.error, 0.8)
      : active
        ? theme.foreground
        : theme.mutedForeground;
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        flexShrink: 0,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.64 : 1,
        ...style,
      }}
    >
      <Text size="xs" weight={500} color={color} style={{ whiteSpace: "nowrap", ...(active ? { textDecoration: "underline" } : {}) }}>
        {children}
      </Text>
    </div>
  );
}

// ── Trace IDs ───────────────────────────────────────────────────────────

function shortenTraceId(traceId: string): string {
  if (traceId.length <= 32) return traceId;
  return `${traceId.slice(0, 18)}...${traceId.slice(-10)}`;
}

/** TraceIdCell: the (shortened) trace ID and a copy button that confirms for 1.2s. */
export function TraceIdCell({ traceId, testId }: { traceId: string; testId: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, minWidth: 0 }}>
      <Tooltip content={traceId} side="top" rootStyle={{ display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <Text size="2xs" mono color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
            {shortenTraceId(traceId)}
          </Text>
        </div>
      </Tooltip>
      <Tooltip content={copied ? "Copied" : "Copy full trace ID"} side="top">
        <IconButton
          icon={copied ? "check" : "copy"}
          size={20}
          iconSize={12}
          testId={testId}
          onClick={() => {
            if (!copyText(traceId)) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1_200);
          }}
        />
      </Tooltip>
    </div>
  );
}

// ── Process signals ─────────────────────────────────────────────────────

/** ProcessSignalActions: INT (muted) and KILL (destructive) inline buttons. */
export function ProcessSignalActions({
  disabled,
  onSignal,
  testId,
}: {
  disabled: boolean;
  onSignal: (signal: ServerProcessSignal) => void;
  testId: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, flexGrow: 1 }}>
      <Tooltip content="Send SIGINT" side="top">
        <TextButton testId={`${testId}-sigint`} tone="muted" disabled={disabled} onClick={() => onSignal("SIGINT")}>
          INT
        </TextButton>
      </Tooltip>
      <Tooltip content="Send SIGKILL" side="top">
        <TextButton testId={`${testId}-sigkill`} tone="destructive" disabled={disabled} onClick={() => onSignal("SIGKILL")}>
          KILL
        </TextButton>
      </Tooltip>
    </div>
  );
}

// ── Process name cells ──────────────────────────────────────────────────

/**
 * The `grid-cols-[1.25rem_0.375rem_1fr]` name cell of the process tables: an
 * expand toggle (or its 20px gap), a status dot, and the name.
 */
export function ProcessNameCell({
  name,
  tooltip,
  depth,
  dotColor,
  toggle,
}: {
  name: string;
  tooltip: string;
  depth: number;
  dotColor: string;
  toggle?: { readonly expanded: boolean; readonly onToggle: () => void; readonly testId: string } | undefined;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexGrow: 1, paddingLeft: depth * 10 }}>
      {toggle ? (
        <IconButton
          icon={toggle.expanded ? "chevron-down" : "chevron-right"}
          size={20}
          iconSize={14}
          testId={toggle.testId}
          onClick={toggle.onToggle}
        />
      ) : (
        <div style={{ width: 20, height: 20, flexShrink: 0 }} />
      )}
      <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor, flexShrink: 0 }} />
      <Tooltip content={tooltip} side="top">
        <div style={{ display: "flex", flexShrink: 1, minWidth: 0 }}>
          <Text size="xs" weight={500} color={theme.foreground} style={{ whiteSpace: "nowrap" }}>
            {name}
          </Text>
        </div>
      </Tooltip>
    </div>
  );
}

/** A muted command cell with the full command in a tooltip. */
export function CommandCell({ command, max }: { command: string; max: number }) {
  const theme = useTheme();
  return (
    <Tooltip content={clip(command, 600)} side="top">
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
        <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
          {clip(command.replace(/\s+/g, " "), max)}
        </Text>
      </div>
    </Tooltip>
  );
}

