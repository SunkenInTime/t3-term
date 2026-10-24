// Ports of apps/web/src/components/settings/{ProjectIconPickerDialog,ProjectFaviconPickerDialog}.tsx
// (+ projectIconOptions.ts). The favicon picker lists the checkout's image
// files through the server's path search, like the web command dialog.
import type { EnvironmentId, ProjectIconColor, ProjectIconOverride } from "@t3tools/contracts";
import { ProjectMonogramText } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { ProjectMonogram, projectIconColorHex } from "../../sidebar/ProjectFavicon.tsx";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { LUCIDE } from "../../ui/lucide.gen.ts";
import { Dialog } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { alpha, RADIUS, useTheme } from "../../ui/theme.ts";
import { getProjectFilePickerMatches, PROJECT_FILE_PICKER_RESULT_LIMIT } from "../../web/components/files/ProjectFilePicker.logic.ts";
import { useProjectFilePickerQuery } from "../../web/components/files/projectFilesQueryState.ts";
import { PROJECT_ICON_COLORS } from "../../web/projectIconColors.ts";
import { deriveProjectIdentity } from "../../web/projectIdentity.ts";
import { SegmentedControl, TextField } from "../controls.tsx";

const POPULAR_PROJECT_ICONS: ReadonlyArray<string> = [
  "folder-code", "code-2", "terminal", "globe-2", "server", "database", "bot", "sparkles", "smartphone", "monitor", "cloud-cog", "package",
  "book-open", "flask-conical", "shield-check", "rocket", "gamepad-2", "music", "image", "shopping-bag", "git-branch", "workflow", "wrench", "layers-3",
];

const PROJECT_EMOJIS: ReadonlyArray<{ emoji: string; label: string }> = [
  { emoji: "💻", label: "Computer" }, { emoji: "🛠️", label: "Tools" }, { emoji: "🚀", label: "Rocket" }, { emoji: "🤖", label: "Robot" },
  { emoji: "✨", label: "Sparkles" }, { emoji: "⚡", label: "Lightning" }, { emoji: "🌐", label: "Web" }, { emoji: "📱", label: "Mobile" },
  { emoji: "🖥️", label: "Desktop" }, { emoji: "⌨️", label: "Keyboard" }, { emoji: "⚙️", label: "Gear" }, { emoji: "🗄️", label: "Database" },
  { emoji: "☁️", label: "Cloud" }, { emoji: "📦", label: "Package" }, { emoji: "📚", label: "Books" }, { emoji: "🧪", label: "Test tube" },
  { emoji: "🔒", label: "Lock" }, { emoji: "🎮", label: "Game" }, { emoji: "🎵", label: "Music" }, { emoji: "🎬", label: "Movie" },
  { emoji: "🖼️", label: "Picture" }, { emoji: "🛍️", label: "Shopping" }, { emoji: "🔥", label: "Fire" }, { emoji: "💡", label: "Idea" },
  { emoji: "🧩", label: "Puzzle" }, { emoji: "📊", label: "Chart" }, { emoji: "🧠", label: "Brain" }, { emoji: "🦄", label: "Unicorn" },
  { emoji: "🐙", label: "Octopus" }, { emoji: "🌱", label: "Seedling" },
];

const LUCIDE_NAMES = Object.keys(LUCIDE);

/** apps/web/src/projectIconOptions.ts firstEmoji: the first grapheme, if it is an emoji, flag or keycap. */
function firstEmoji(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed);
  const segment = segments[Symbol.iterator]().next().value?.segment;
  const isFlag = /^\p{Regional_Indicator}{2}$/u.test(segment ?? "");
  const isKeycap = /^[#*0-9]\uFE0F?\u20E3$/u.test(segment ?? "");
  if (!segment || (!/\p{Extended_Pictographic}/u.test(segment) && !isFlag && !isKeycap)) {
    return null;
  }
  return segment;
}

function filterProjectIconNames(query: string): ReadonlyArray<string> {
  const normalized = query.trim().toLowerCase().replaceAll(/\s+/g, "-");
  const names = normalized ? LUCIDE_NAMES.filter((name) => name.includes(normalized)).slice(0, 60) : POPULAR_PROJECT_ICONS;
  return names.filter((name) => name in LUCIDE);
}

const isMonogramText = Schema.is(ProjectMonogramText);
const DEFAULT_ICON = "folder-code";

export function ProjectIconPickerDialog({
  current,
  projectName,
  open,
  onOpenChange,
  onSelect,
}: {
  current: ProjectIconOverride | null;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (icon: ProjectIconOverride) => void;
}) {
  const theme = useTheme();
  const automatic = deriveProjectIdentity(projectName);
  const initial = () => ({
    mode: current?.kind ?? ("lucide" as ProjectIconOverride["kind"]),
    iconName: current?.kind === "lucide" ? current.name : DEFAULT_ICON,
    color: current && current.kind !== "emoji" ? current.color : automatic.color,
    letters: current?.kind === "monogram" ? current.text : automatic.monogram,
    emoji: current?.kind === "emoji" ? current.emoji : "💻",
  });
  const [state, setState] = useState(initial);
  const [query, setQuery] = useState("");
  const [customEmoji, setCustomEmoji] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setState(initial());
      setQuery("");
      setCustomEmoji("");
    }
  }
  const icons = filterProjectIconNames(query);
  const monogram = state.letters.normalize("NFKC").trim().toUpperCase();
  const validMonogram = isMonogramText(monogram);
  const save = () => {
    if (state.mode === "monogram" && !validMonogram) return;
    onSelect(
      state.mode === "monogram"
        ? { kind: "monogram", text: monogram, color: state.color }
        : state.mode === "lucide"
          ? { kind: "lucide", name: state.iconName, color: state.color }
          : { kind: "emoji", emoji: state.emoji },
    );
    onOpenChange(false);
  };
  const cell = (key: string, selected: boolean, onClick: () => void, child: React.ReactNode) => (
    <div
      key={key}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 40,
        height: 40,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: selected ? theme.border : "#00000000",
        backgroundColor: selected ? theme.accent : "#00000000",
        cursor: "pointer",
        hover: { backgroundColor: theme.accent },
      }}
    >
      {child}
    </div>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={512}
      testId="project-icon-picker"
      title="Choose project icon"
      description="Choose an icon, emoji, or monogram."
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={state.mode === "monogram" && !validMonogram} onClick={save} testId="project-icon-save">
            Save icon
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <SegmentedControl
          value={state.mode}
          options={[
            { value: "lucide", label: "Icons" },
            { value: "emoji", label: "Emoji" },
            { value: "monogram", label: "Monogram" },
          ]}
          onChange={(mode) => setState({ ...state, mode })}
        />
        {state.mode !== "emoji" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Text size="xs" weight={500} color={theme.mutedForeground}>
              Color
            </Text>
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {PROJECT_ICON_COLORS.map((option) => (
                <div
                  key={option.value}
                  onClick={() => setState({ ...state, color: option.value as ProjectIconColor })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: state.color === option.value ? alpha(theme.foreground, 0.64) : "#00000000",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: projectIconColorHex(option.value as ProjectIconColor), pointerEvents: "none" }} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {state.mode === "lucide" ? (
          <>
            <TextField width="100%" value={query} placeholder="Search all Lucide icons" onChange={setQuery} testId="project-icon-search" />
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 4, maxHeight: 256, overflowY: "scroll" }}>
              {icons.map((name) =>
                cell(name, state.iconName === name, () => setState({ ...state, iconName: name }), (
                  <Icon name={name as IconName} size={20} color={projectIconColorHex(state.color)} />
                )),
              )}
            </div>
            {icons.length === 0 ? (
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 32, paddingBottom: 32 }}>
                <Text color={theme.mutedForeground}>No icons found.</Text>
              </div>
            ) : null}
          </>
        ) : state.mode === "monogram" ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16, paddingTop: 8, paddingBottom: 8 }}>
            <ProjectMonogram text={validMonogram ? monogram : automatic.monogram} color={state.color} size={48} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flexGrow: 1 }}>
              <Text weight={500}>Letters</Text>
              <TextField width="100%" value={state.letters} onChange={(letters) => setState({ ...state, letters })} testId="project-icon-letters" />
              <Text size="xs" color={validMonogram ? theme.mutedForeground : theme.errorForeground}>
                One or two letters or numbers.
              </Text>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              {PROJECT_EMOJIS.map((option) =>
                cell(option.emoji, state.emoji === option.emoji, () => setState({ ...state, emoji: option.emoji }), (
                  <text style={{ fontSize: 20, lineHeight: 24, color: theme.foreground }}>{option.emoji}</text>
                )),
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Text size="xs" weight={500} color={theme.mutedForeground}>
                Or paste any emoji
              </Text>
              <TextField
                width="100%"
                value={customEmoji}
                placeholder="Paste an emoji"
                testId="project-icon-custom-emoji"
                onChange={(value) => {
                  setCustomEmoji(value);
                  // Only a real emoji replaces the selection; other text just sits in the field, as on web.
                  const next = firstEmoji(value);
                  if (next) setState((current) => ({ ...current, emoji: next }));
                }}
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function ProjectFaviconPickerDialog({
  cwd,
  environmentId,
  open,
  onOpenChange,
  onSelect,
  projectName,
}: {
  cwd: string;
  environmentId: EnvironmentId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  projectName: string;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const result = useProjectFilePickerQuery(environmentId, cwd, open ? query : "", PROJECT_FILE_PICKER_RESULT_LIMIT, { imageOnly: true });
  const matches = open ? getProjectFilePickerMatches(result.entries, result.matchedQuery) : [];
  const empty = result.error
    ? result.error
    : result.isPending
      ? query.trim()
        ? "Searching project files…"
        : "Indexing project files…"
      : query.trim()
        ? "No matching image files."
        : "No image files found.";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={576} testId="project-favicon-picker" title="Choose project icon" description={projectName}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <TextField width="100%" value={query} placeholder="Search image files…" onChange={setQuery} testId="project-favicon-search" />
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 360, overflowY: "scroll" }}>
          {matches.length === 0 ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 24, paddingBottom: 24 }}>
              <Text color={theme.mutedForeground}>{empty}</Text>
            </div>
          ) : (
            matches.slice(0, 60).map((match) => (
              <div
                key={match.path}
                onClick={() => {
                  onOpenChange(false);
                  onSelect(match.path);
                }}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 36,
                  paddingLeft: 8,
                  paddingRight: 8,
                  borderRadius: RADIUS.sm,
                  cursor: "pointer",
                  hover: { backgroundColor: theme.accent },
                }}
              >
                <Icon name="image" size={16} color={theme.mutedForeground} />
                <Text weight={500}>{match.name}</Text>
                <Text size="xs" color={theme.mutedForeground}>
                  {match.path}
                </Text>
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
