// The diff's find panel: pierre's SearchPanelWidget in find mode (T3's
// @pierre/diffs patch, dist/editor/searchPanel.js + editor.css), themed by
// web's `--diffs-search-panel-*` (popover colours, primary accent, sans font):
// a 200px input with Match Case / Whole Word / Regexp toggles inside it, the
// "N of M" count, previous / next, and a round close badge on the corner.
import type { EventPayload } from "@gpuix/native";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import type { DiffSearchParams } from "./diffSearch.ts";

export type DiffFindOption = "caseSensitive" | "wholeWord" | "regex";

export function DiffFindBar({
  params,
  matchCount,
  current,
  onQueryChange,
  onToggle,
  onNavigate,
  onClose,
}: {
  params: DiffSearchParams;
  matchCount: number;
  /** Index of the current match, or null before one is chosen. */
  current: number | null;
  onQueryChange: (text: string) => void;
  onToggle: (option: DiffFindOption) => void;
  onNavigate: (previous: boolean) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const muted = alpha(theme.foreground, 0.65);
  const noMatches = matchCount === 0;
  const label = noMatches ? "No results" : `${(current ?? 0) + 1} of ${matchCount}`;

  const toggle = (option: DiffFindOption, icon: IconName, title: string) => {
    const pressed = params[option];
    return (
      <Tooltip content={title}>
        <div
          testId={`diff-find-${option}`}
          onClick={() => onToggle(option)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            borderRadius: 4,
            flexShrink: 0,
            cursor: "pointer",
            backgroundColor: pressed ? alpha(theme.primary, 0.25) : "#00000000",
            hover: { backgroundColor: pressed ? alpha(theme.primary, 0.3) : alpha(theme.foreground, 0.08) },
          }}
        >
          <Icon name={icon} size={14} color={pressed ? theme.foreground : muted} />
        </div>
      </Tooltip>
    );
  };
  const navButton = (icon: IconName, previous: boolean, title: string) => (
    <Tooltip content={title}>
      <div
        testId={previous ? "diff-find-previous" : "diff-find-next"}
        onClick={noMatches ? undefined : () => onNavigate(previous)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: 4,
          flexShrink: 0,
          opacity: noMatches ? 0.4 : 1,
          cursor: noMatches ? "default" : "pointer",
          ...(noMatches ? {} : { hover: { backgroundColor: alpha(theme.foreground, 0.08) } }),
        }}
      >
        <Icon name={icon} size={16} color={muted} />
      </div>
    </Tooltip>
  );

  return (
    <div
      testId="diff-find-bar"
      style={{
        position: "relative",
        display: "flex",
        borderRadius: 9,
        borderWidth: 1,
        borderColor: alpha(theme.foreground, 0.2),
        backgroundColor: theme.popover,
        boxShadow: [
          { offsetX: 0, offsetY: 4, blurRadius: 4, spreadRadius: 0, color: "#00000013" },
          { offsetX: 0, offsetY: 6, blurRadius: 9, spreadRadius: 0, color: "#00000013" },
        ],
        pointerEvents: "auto",
      }}
    >
      {/* --diffs-widget-bg: the popover with a 4% wash of its foreground. */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          padding: 4,
          borderRadius: 8,
          backgroundColor: alpha(theme.foreground, 0.04),
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            width: 200,
            height: 26,
            paddingLeft: 6,
            paddingRight: 3,
            gap: 1,
            borderRadius: 6,
            borderWidth: 1,
            // The input is focused while the panel is open: the accent ring.
            borderColor: theme.primary,
            backgroundColor: theme.popover,
          }}
        >
          <input
            testId="diff-find-input"
            autoFocus
            value={params.text}
            placeholder="Search"
            onChange={(event: EventPayload) => onQueryChange(String(event.value ?? ""))}
            onSubmit={() => onNavigate(false)}
            onKeyDown={(event) => {
              const key = event.key ?? "";
              if (key === "escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              } else if (key === "f3" || (key === "enter" && event.modifiers?.shift)) {
                event.preventDefault();
                event.stopPropagation();
                onNavigate(key === "enter" || event.modifiers?.shift === true);
              } else if (key === "f" && (event.modifiers?.ctrl || event.modifiers?.cmd)) {
                // Find again from inside the panel only refocuses it, like pierre's open().
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            theme={{ caret: theme.foreground }}
            style={{
              flexGrow: 1,
              minWidth: 0,
              height: 24,
              lineHeight: 24,
              fontSize: 13,
              fontFamily: FONTS.sans,
              color: theme.foreground,
              backgroundColor: "#00000000",
            }}
          />
          {toggle("caseSensitive", "case-sensitive", "Match Case")}
          {toggle("wholeWord", "whole-word", "Whole Word")}
          {toggle("regex", "regex", "Regexp")}
        </div>
        <div style={{ display: "flex", flexShrink: 0, minWidth: 40 }}>
          <text
            style={{
              color: noMatches && params.text.length > 0 ? theme.errorForeground : muted,
              fontSize: 13,
              lineHeight: 20,
              fontFamily: FONTS.sans,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </text>
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
          {navButton("arrow-up", true, "Previous Match")}
          {navButton("arrow-down", false, "Next Match")}
        </div>
      </div>
      {/* [data-search-close]: a 20px round badge centred on the top-right corner. */}
      <div
        testId="diff-find-close"
        onClick={onClose}
        style={{
          position: "absolute",
          top: -10,
          right: -10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: 10,
          cursor: "pointer",
          backgroundColor: alpha(theme.foreground, 0.5),
          hover: { backgroundColor: theme.foreground },
        }}
      >
        <Icon name="x" size={12} color={theme.popover} strokeWidth={2.5} />
      </div>
    </div>
  );
}
