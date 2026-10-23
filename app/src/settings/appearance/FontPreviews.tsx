// Port of apps/web/src/components/settings/SettingsFontPreviews.tsx.
//
// The web mounts the real composer editor, a @pierre/diffs render and a
// Ghostty terminal. t3-term draws the same three samples statically: the
// prompt as wrapped words with inline context chips, the diff with the
// native <diff> element, and the terminal transcript as styled text lines.
// Each sample uses the font family and size being configured.
import { useClientSettings } from "../../state/clientSettings.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

// ── Prompt ──────────────────────────────────────────────────────────────

type PromptPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "chip"; readonly label: string; readonly tone: "skill" | "file"; readonly icon: "skill" | "ts" | "tsx" };

// "Use $frontend-design to fix the flaky test in [surface.test.ts](...) and
// align the header with [SettingsPanels.tsx](...) before shipping."
const PROMPT_PREVIEW_PARTS: ReadonlyArray<PromptPart> = [
  { kind: "text", text: "Use" },
  { kind: "chip", label: "Frontend Design", tone: "skill", icon: "skill" },
  { kind: "text", text: "to fix the flaky test in" },
  { kind: "chip", label: "surface.test.ts", tone: "file", icon: "ts" },
  { kind: "text", text: "and align the header with" },
  { kind: "chip", label: "SettingsPanels.tsx", tone: "file", icon: "tsx" },
  { kind: "text", text: "before shipping." },
];

const SKILL_TONE = "#c27aff";
const FILE_TONE = "#00d3f2";

function PromptChip({ part, fontFamily, lineHeight }: { part: Extract<PromptPart, { kind: "chip" }>; fontFamily: string; lineHeight: number }) {
  const theme = useTheme();
  const tone = part.tone === "skill" ? SKILL_TONE : FILE_TONE;
  const icon: IconName = part.icon === "skill" ? "box" : "atom";
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: lineHeight, marginRight: 4 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 18,
          paddingLeft: 5,
          paddingRight: 5,
          borderRadius: RADIUS.sm,
          borderWidth: 1,
          borderColor: alpha(tone, 0.35),
          backgroundColor: alpha(tone, 0.1),
        }}
      >
        {part.icon === "ts" ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 12,
              height: 12,
              borderRadius: 3,
              backgroundColor: alpha(tone, 0.25),
            }}
          >
            <text style={{ color: theme.foreground, fontSize: 7, lineHeight: 12, fontWeight: 700, fontFamily }}>TS</text>
          </div>
        ) : (
          <Icon name={icon} size={12} color={part.icon === "skill" ? theme.foreground : tone} />
        )}
        <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontWeight: 600, fontFamily }}>{part.label}</text>
      </div>
    </div>
  );
}

export function PromptFontPreview() {
  const theme = useTheme();
  const { family, size } = useClientSettings((settings) => ({
    family: settings.fontFamilyComposer.trim() || settings.fontFamilySans.trim() || FONTS.sans,
    size: settings.fontSizePrompt,
  }));
  const lineHeight = Math.round(size * 1.625);
  // flex-wrap needs one item per word; adjacent <text> nodes would merge
  // into a single unbreakable line.
  const words = PROMPT_PREVIEW_PARTS.flatMap((part, partIndex) =>
    part.kind === "chip"
      ? [<PromptChip key={partIndex} part={part} fontFamily={family} lineHeight={lineHeight} />]
      : part.text.split(" ").map((word, wordIndex) => (
          <div key={`${partIndex}-${wordIndex}`} style={{ marginRight: Math.round(size * 0.28) }}>
            <text style={{ color: theme.foreground, fontSize: size, lineHeight, fontFamily: family, whiteSpace: "nowrap" }}>{word}</text>
          </div>
        )),
  );
  return (
    <div
      testId="prompt-font-preview"
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        marginTop: 4,
        marginBottom: 8,
        minHeight: 56,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.background,
      }}
    >
      {words}
    </div>
  );
}

// ── Code ────────────────────────────────────────────────────────────────

const DIFF_PREVIEW_PATCH = [
  "diff --git a/src/formatUser.ts b/src/formatUser.ts",
  "--- a/src/formatUser.ts",
  "+++ b/src/formatUser.ts",
  "@@ -1,3 +1,3 @@",
  " export function formatUser(user: User) {",
  "-  return user.name.toUpperCase();",
  "+  return `${user.name} <${user.email}>`; // 0O 1lI",
  " }",
  "",
].join("\n");

/** --diff-addition / --diff-deletion for the chosen diff color scheme. */
export function diffColors(scheme: "red-green" | "blue-orange", appearance: "light" | "dark", fallback: { add: string; del: string }) {
  if (scheme === "blue-orange") {
    return appearance === "dark" ? { add: "#51a2ff", del: "#ff8904" } : { add: "#155dfc", del: "#f54900" };
  }
  return fallback;
}

export function CodeFontPreview() {
  const theme = useTheme();
  const { family, size, scheme } = useClientSettings((settings) => ({
    family: settings.fontFamilyCode.trim() || FONTS.mono,
    size: settings.fontSizeCode,
    scheme: settings.diffColorScheme,
  }));
  const colors = diffColors(scheme, theme.appearance, { add: theme.diffAdd, del: theme.diffDel });
  return (
    <div
      testId="code-font-preview"
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 4,
        marginBottom: 8,
        borderRadius: RADIUS.md,
        overflow: "hidden",
        backgroundColor: theme.codeBackground,
      }}
    >
      <diff
        patch={DIFF_PREVIEW_PATCH}
        wordDiff
        theme={{
          appearance: theme.appearance,
          bg: theme.codeBackground,
          border: theme.border,
          text: theme.foreground,
          textMuted: theme.mutedForeground,
          accent: theme.primary,
          diffAdd: colors.add,
          diffDel: colors.del,
          fontSans: FONTS.sans,
          fontMono: family,
          metrics: { diffTextSize: size, diffLineHeight: Math.round(size * 1.54) },
        }}
      />
    </div>
  );
}

// ── Terminal ────────────────────────────────────────────────────────────

// TERMINAL_PALETTES in ThreadTerminalDrawer.tsx (normal, then bright).
const ANSI = {
  dark: ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5", "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5"],
  light: ["#000000", "#cd3131", "#107c10", "#949800", "#0451a5", "#bc05bc", "#0598bc", "#555555", "#666666", "#cd3131", "#14ce14", "#b5ba00", "#0451a5", "#bc05bc", "#0598bc", "#a5a5a5"],
} as const;

const TERMINAL_PROMPT =
  "\x1b[1;32m→\x1b[0m \x1b[1;36mt3code\x1b[0m \x1b[1;34mgit:(\x1b[1;31mmain\x1b[1;34m)\x1b[0m \x1b[1;33m✗\x1b[0m ";
// The transcript minus its first line ("… vpr dev"): the web terminal is
// shorter than the transcript and shows it scrolled to the bottom.
const TERMINAL_PREVIEW_TRANSCRIPT =
  "\r\n" +
  "  \x1b[1;32mVITE\x1b[0m \x1b[32mv7.1.1\x1b[0m  \x1b[2mready in\x1b[0m \x1b[1m1.24s\x1b[0m\r\n" +
  "\r\n" +
  "  \x1b[32m→\x1b[0m  \x1b[2mLocal:\x1b[0m    \x1b[4;36mhttp://127.0.0.1:5173/\x1b[0m\r\n" +
  "  \x1b[32m→\x1b[0m  \x1b[2mNetwork:\x1b[0m  \x1b[4;36mhttp://192.168.1.24:5173/\x1b[0m\r\n" +
  "\r\n" +
  "  \x1b[32m✓ 85 passed\x1b[0m   \x1b[33m△ 2 warnings\x1b[0m   \x1b[31m✗ 0 failed\x1b[0m\r\n" +
  "\r\n" +
  "  \x1b[42;30m READY \x1b[0m \x1b[2mwatching for changes, press\x1b[0m \x1b[1mq\x1b[0m \x1b[2mto quit\x1b[0m\r\n" +
  "\r\n" +
  TERMINAL_PROMPT;

interface Run {
  readonly text: string;
  readonly fg: number | null;
  readonly bg: number | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly underline: boolean;
}

function parseAnsiLines(transcript: string): Run[][] {
  return transcript.split("\r\n").map((line) => {
    const runs: Run[] = [];
    let state = { fg: null as number | null, bg: null as number | null, bold: false, dim: false, underline: false };
    const pattern = /\x1b\[([\d;]*)m/g;
    let last = 0;
    for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
      if (match.index > last) runs.push({ text: line.slice(last, match.index), ...state });
      for (const code of (match[1] || "0").split(";").map(Number)) {
        if (code === 0) state = { fg: null, bg: null, bold: false, dim: false, underline: false };
        else if (code === 1) state = { ...state, bold: true };
        else if (code === 2) state = { ...state, dim: true };
        else if (code === 4) state = { ...state, underline: true };
        else if (code >= 30 && code <= 37) state = { ...state, fg: code - 30 };
        else if (code >= 40 && code <= 47) state = { ...state, bg: code - 40 };
      }
      last = pattern.lastIndex;
    }
    if (last < line.length) runs.push({ text: line.slice(last), ...state });
    return runs;
  });
}

const TERMINAL_LINES = parseAnsiLines(TERMINAL_PREVIEW_TRANSCRIPT);

export function TerminalFontPreview({ family, size }: { family: string; size: number }) {
  const theme = useTheme();
  const palette = ANSI[theme.appearance];
  const fontFamily = family.trim() || FONTS.mono;
  // Ghostty's cell height for Consolas-like metrics (13px -> 18px rows).
  const lineHeight = Math.round(size * 1.385);
  const runColor = (run: Run) => {
    if (run.fg === null) return run.dim ? alpha(theme.foreground, 0.5) : theme.foreground;
    const color = palette[run.bold ? run.fg + 8 : run.fg]!;
    return run.dim ? alpha(color, 0.5) : color;
  };
  return (
    <div
      testId="terminal-font-preview"
      style={{
        display: "flex",
        flexDirection: "column",
        height: 208,
        marginTop: 4,
        marginBottom: 8,
        paddingTop: 3,
        paddingLeft: 5,
        paddingRight: 5,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.background,
        overflow: "hidden",
      }}
    >
      {TERMINAL_LINES.map((runs, lineIndex) => (
        <div key={lineIndex} style={{ display: "flex", flexDirection: "row", alignItems: "center", height: lineHeight, flexShrink: 0 }}>
          {runs.map((run, runIndex) => {
            const text = (
              <text
                style={{
                  color: run.bg !== null ? palette[run.fg ?? 0]! : runColor(run),
                  fontSize: size,
                  lineHeight,
                  fontFamily,
                  whiteSpace: "nowrap",
                  ...(run.bold ? { fontWeight: 700 } : {}),
                  ...(run.underline ? { textDecoration: "underline" } : {}),
                }}
              >
                {run.text}
              </text>
            );
            // A background needs its own box; plain runs stay as adjacent
            // <text> siblings so they shape as one line.
            return run.bg !== null ? (
              <div key={runIndex} style={{ backgroundColor: palette[run.bg]!, height: lineHeight }}>
                {text}
              </div>
            ) : (
              <div key={runIndex} style={{ flexShrink: 0 }}>
                {text}
              </div>
            );
          })}
          {lineIndex === TERMINAL_LINES.length - 1 ? (
            <div style={{ width: Math.round(size * 0.6), height: lineHeight - 2, borderWidth: 1, borderColor: theme.foreground }} />
          ) : null}
        </div>
      ))}
    </div>
  );
}
