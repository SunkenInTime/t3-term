// Port of apps/web/src/components/chat/ComposerPendingTerminalContexts.tsx and
// TerminalContextInlineChip.tsx: a terminal selection attached to the composer, shown as a
// green "terminal" context chip whose popover holds the captured lines.
//
// Web draws the chip inline, in place of its reference, inside its rich editor. t3-term's
// composer is a plain text field with no caret access, where a typed-over reference would
// silently drop the excerpt, so the chips sit in a row above the prompt (each with a remove
// button standing in for deleting the inline chip) and the references join the message text
// at send.
import { useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  formatTerminalContextLabel,
  isTerminalContextExpired,
  type TerminalContextDraft,
} from "../../web/lib/terminalContext.ts";

/** web ContextChip kind "terminal": --context-chip-accent oklch(0.62 0.134 163). */
const TERMINAL_ACCENT = "#009e6f";

/** color-mix(in oklab, a p%, b), approximated in sRGB for the chip's border and text. */
function mixHex(a: string, b: string, amount: number): string {
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  return `#${[0, 1, 2]
    .map((index) => Math.round(channel(a, index) * amount + channel(b, index) * (1 - amount)).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function ComposerPendingTerminalContexts({
  contexts,
  onRemove,
}: {
  readonly contexts: ReadonlyArray<TerminalContextDraft>;
  readonly onRemove: (contextId: string) => void;
}) {
  if (contexts.length === 0) return null;
  return (
    <div
      testId="composer-terminal-contexts"
      style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 8, minWidth: 0 }}
    >
      {contexts.map((context) => (
        <ComposerPendingTerminalContextChip key={context.id} context={context} onRemove={() => onRemove(context.id)} />
      ))}
    </div>
  );
}

function ComposerPendingTerminalContextChip({
  context,
  onRemove,
}: {
  readonly context: TerminalContextDraft;
  readonly onRemove: () => void;
}) {
  const label = formatTerminalContextLabel(context);
  return (
    <TerminalContextInlineChip
      label={label}
      terminalLabel={context.terminalLabel}
      lineStart={context.lineStart}
      lineEnd={context.lineEnd}
      text={context.text}
      expired={isTerminalContextExpired(context)}
      onRemove={onRemove}
    />
  );
}

export function TerminalContextInlineChip(props: {
  readonly label: string;
  readonly terminalLabel: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly text: string;
  readonly expired?: boolean;
  readonly onRemove?: () => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expired = props.expired ?? false;
  const border = theme.appearance === "dark" ? "#ffffff26" : "#0000001f";
  const chipBorder = expired ? alpha(theme.error, 0.35) : mixHex(TERMINAL_ACCENT, border.slice(0, 7), 0.34);
  const chipColor = expired ? theme.errorForeground : mixHex(TERMINAL_ACCENT, theme.foreground.slice(0, 7), 0.22);
  const chipBackground = expired
    ? alpha(theme.error, 0.08)
    : alpha(TERMINAL_ACCENT, hovered ? 0.17 : 0.11);
  const chip = (
    <div
      testId="composer-terminal-context-chip"
      onClick={expired ? undefined : () => setOpen(!open)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 22,
        maxWidth: 280,
        paddingLeft: 7,
        paddingRight: props.onRemove ? 3 : 7,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: chipBorder,
        backgroundColor: chipBackground,
        cursor: expired ? "default" : "pointer",
      }}
    >
      <Icon name="terminal" size={14} color={chipColor} />
      <text
        style={{
          color: chipColor,
          fontSize: 12,
          lineHeight: 16,
          fontWeight: 500,
          fontFamily: FONTS.sans,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {props.label}
      </text>
      {props.onRemove ? (
        <div
          testId="composer-terminal-context-remove"
          onClick={props.onRemove}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            borderRadius: 4,
            flexShrink: 0,
            hover: { backgroundColor: alpha(chipColor, 0.15) },
          }}
        >
          <Icon name="x" size={11} color={chipColor} />
        </div>
      ) : null}
    </div>
  );
  if (expired) {
    return (
      <Tooltip content={`Terminal context expired. Remove and re-add ${props.label} to include it in your message.`} side="top">
        {chip}
      </Tooltip>
    );
  }
  const lines = props.text.split("\n");
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      testId="composer-terminal-context-popover"
      style={{ width: 420, padding: 8 }}
      trigger={chip}
    >
      {/* web: a bordered card, the terminal and line range over the captured output. */}
      <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.md, borderWidth: 1, borderColor: alpha(theme.border, 0.7), overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderColor: alpha(theme.border, 0.7),
          }}
        >
          <Icon name="terminal" size={16} color={theme.success} />
          <text style={{ color: theme.foreground, fontSize: 14, lineHeight: 20, fontWeight: 500, fontFamily: FONTS.sans, flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
            {props.terminalLabel}
          </text>
          <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, flexShrink: 0 }}>
            {props.lineStart === props.lineEnd ? `Line ${props.lineStart}` : `Lines ${props.lineStart}–${props.lineEnd}`}
          </text>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "scroll", padding: 12, backgroundColor: theme.muted }}>
          {lines.map((line, index) => (
            <text key={index} style={{ color: theme.foreground, fontSize: 12, lineHeight: 19, fontFamily: FONTS.mono, whiteSpace: "nowrap" }}>
              {line.length === 0 ? " " : line}
            </text>
          ))}
        </div>
      </div>
    </Popover>
  );
}
