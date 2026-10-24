// Port of apps/web/src/components/settings/ThemeImportDialog.tsx: add themes from
// Open VSX (ThemeSearchSection.tsx), from T3 Code or VS Code theme files, or from
// pasted JSON; installed ids that already exist ask to update or keep both.
//
// Differences from web, because t3-term has no DOM:
//   - "Choose files" is the OS file picker (renderer.promptForPaths) and files dropped
//     on the window's drop zone arrive as paths (onFileDrop); both read from disk.
//   - The JSON editor is a plain monospace textarea: web layers highlighted markup
//     under a transparent textarea, which gpuix can't overlay on editable text.
import { useGpuixRequired, useWindowSize } from "@gpuix/react";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { useRef, useState } from "react";

import { Dialog } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  getCustomThemes,
  installCustomTheme,
  parseThemeFile,
  removeCustomTheme,
  THEME_FILE_VERSION,
  updateCustomTheme,
  type ThemeDefinition,
} from "../../web/themePalette.ts";
import {
  humanizeThemeName,
  isVsCodeThemeFile,
  pairVsCodeThemes,
  parseVsCodeThemeFile,
  resolveThemeLabelCollisions,
} from "../../web/vscodeThemeImport.ts";
import { fieldBackground } from "../controls.tsx";
import { ThemeSearchSection } from "./ThemeSearchSection.tsx";

/** The size guard runs before the bytes are read; theme files are a few KB. */
const MAX_THEME_FILE_BYTES = 256 * 1024;

function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function describeOversizedThemeFile(bytes: number): string | null {
  if (bytes <= MAX_THEME_FILE_BYTES) return null;
  return `That file is ${formatByteSize(bytes)}. Theme files are only a few KB, so this one was not read (limit ${formatByteSize(MAX_THEME_FILE_BYTES)}).`;
}

type ImportableThemeFile = { name: string; size: number; text: () => Promise<string> };

function fileFromPath(path: string): ImportableThemeFile | null {
  try {
    const stat = NodeFS.statSync(path);
    if (!stat.isFile()) return null;
    return { name: NodePath.basename(path), size: stat.size, text: () => NodeFS.promises.readFile(path, "utf8") };
  } catch {
    return null;
  }
}

const JSON_PLACEHOLDER = '{\n  "version": 1,\n  "name": "Aurora",\n  "appearance": "light",\n  "colors": { ... }\n}';

export function ThemeImportDialog({
  open,
  onOpenChange,
  onImported,
  onImportedMany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (theme: ThemeDefinition) => boolean;
  onImportedMany: (themes: ReadonlyArray<ThemeDefinition>, context: { updated: boolean }) => void;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const windowSize = useWindowSize();
  const [json, setJson] = useState("");
  // gpuix textareas keep their own text while focused; remount when a file fills it.
  const [editorKey, setEditorKey] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [conflicts, setConflicts] = useState<ReadonlyArray<ThemeDefinition> | null>(null);
  const importRequestRef = useRef(0);

  const [renderedOpen, setRenderedOpen] = useState(open);
  if (renderedOpen !== open) {
    setRenderedOpen(open);
    importRequestRef.current += 1;
    if (open) {
      setJson("");
      setFileName(null);
      setError(null);
      setIsReading(false);
      setConflicts(null);
    }
  }

  const readThemeFile = async (file: ImportableThemeFile) => {
    const oversized = describeOversizedThemeFile(file.size);
    if (oversized) {
      setError(oversized);
      return;
    }
    const requestId = ++importRequestRef.current;
    setIsReading(true);
    let text: string;
    try {
      text = await file.text();
    } catch {
      if (requestId !== importRequestRef.current) return;
      setIsReading(false);
      setError("Could not read that file. Paste the JSON below instead.");
      return;
    }
    if (requestId !== importRequestRef.current) return;
    setIsReading(false);
    setJson(text);
    setEditorKey((key) => key + 1);
    setFileName(file.name);
    setError(null);
  };

  const installThemeBatch = async (files: ReadonlyArray<ImportableThemeFile>, requestId: number) => {
    const failures: string[] = [];
    const parsed: Array<{ theme: ThemeDefinition; sourceName: string }> = [];
    for (const file of files) {
      const oversized = describeOversizedThemeFile(file.size);
      if (oversized) {
        failures.push(`${file.name}: too large`);
        continue;
      }
      try {
        const value: unknown = JSON.parse(await file.text());
        parsed.push({ sourceName: file.name, theme: isVsCodeThemeFile(value) ? parseVsCodeThemeFile(value) : parseThemeFile(value) });
      } catch (cause) {
        failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "not a theme file"}`);
      }
    }
    if (requestId !== importRequestRef.current) return;
    const installed: ThemeDefinition[] = [];
    const conflicting: ThemeDefinition[] = [];
    for (const candidate of pairVsCodeThemes(resolveThemeLabelCollisions(parsed))) {
      if (getCustomThemes().some((existing) => existing.id === candidate.id)) {
        conflicting.push(candidate);
        continue;
      }
      try {
        installed.push(installCustomTheme(candidate));
      } catch (cause) {
        failures.push(`${candidate.label}: ${cause instanceof Error ? cause.message : "could not install"}`);
      }
    }
    if (installed.length > 0) onImportedMany(installed, { updated: false });
    if (failures.length > 0) setError(failures.join("; "));
    else if (conflicting.length > 0) setConflicts(conflicting);
    else if (installed.length > 0) onOpenChange(false);
  };

  const readThemeFiles = (files: ReadonlyArray<ImportableThemeFile>) => {
    if (files.length === 0) return;
    if (files.length === 1) {
      void readThemeFile(files[0]!);
      return;
    }
    const requestId = ++importRequestRef.current;
    setIsReading(true);
    void installThemeBatch(files, requestId).finally(() => {
      if (requestId === importRequestRef.current) setIsReading(false);
    });
  };

  const readThemePaths = (paths: ReadonlyArray<string>) =>
    readThemeFiles(paths.flatMap((path) => fileFromPath(path) ?? []).filter((file) => /\.json$/i.test(file.name) || paths.length === 1));

  const openFilePicker = () => {
    void renderer.promptForPaths?.({ files: true, directories: false, multiple: true, prompt: "Import" }).then((paths) => {
      if (paths && paths.length > 0) readThemePaths(paths);
    });
  };

  const versionedCopy = (candidate: ThemeDefinition, preferredName?: string | null): ThemeDefinition => {
    const base = {
      version: THEME_FILE_VERSION,
      appearance: candidate.appearance,
      colors: candidate.colors,
      ...(candidate.variants ? { variants: candidate.variants } : {}),
      ...(candidate.managed ? { managed: true } : {}),
    };
    if (preferredName && preferredName.toLowerCase() !== candidate.label.toLowerCase()) {
      const preferred = parseThemeFile({ ...base, name: preferredName.slice(0, 48) });
      if (!getCustomThemes().some((existing) => existing.id === preferred.id)) return preferred;
    }
    for (let copy = 1; copy < 100; copy += 1) {
      const next = parseThemeFile({ ...base, name: `${candidate.label.slice(0, 48 - ` (${copy})`.length)} (${copy})` });
      if (getCustomThemes().some((existing) => existing.id === next.id)) continue;
      return next;
    }
    throw new Error(`Too many copies of "${candidate.label}".`);
  };

  const resolveConflicts = (mode: "update" | "copy") => {
    if (!conflicts) return;
    const resolved: ThemeDefinition[] = [];
    const failures: string[] = [];
    const preferredName = conflicts.length === 1 && fileName ? humanizeThemeName(fileName.replace(/\.[^.]+$/, "")) : null;
    for (const candidate of conflicts) {
      try {
        const existingTheme = mode === "update" ? getCustomThemes().find((existing) => existing.id === candidate.id) : undefined;
        const themeToUpdate = existingTheme?.collection ? { ...candidate, collection: existingTheme.collection } : candidate;
        resolved.push(mode === "update" ? updateCustomTheme(themeToUpdate) : installCustomTheme(versionedCopy(candidate, preferredName)));
      } catch (cause) {
        failures.push(`${candidate.label}: ${cause instanceof Error ? cause.message : "failed"}`);
      }
    }
    if (resolved.length > 0) onImportedMany(resolved, { updated: mode === "update" });
    setConflicts(null);
    if (failures.length > 0) setError(failures.join("; "));
    else onOpenChange(false);
  };

  const handleSubmit = () => {
    const oversized = describeOversizedThemeFile(json.length);
    if (oversized) {
      setError(oversized);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(json);
      const candidate = isVsCodeThemeFile(parsed) ? parseVsCodeThemeFile(parsed) : parseThemeFile(parsed);
      if (getCustomThemes().some((existing) => existing.id === candidate.id)) {
        setError(null);
        setConflicts([candidate]);
        return;
      }
      const installedTheme = installCustomTheme(candidate);
      if (!onImported(installedTheme)) {
        try {
          removeCustomTheme(installedTheme.id);
        } catch {}
        setError("Theme added, but it could not be selected. Try again.");
        return;
      }
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That theme file is invalid.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setError(null);
        onOpenChange(nextOpen);
      }}
      width={768}
      title="Add a theme"
      testId="theme-import-dialog"
      showCloseButton
    >
      {/* DialogPanel scrolls once results outgrow the window: viewport padding, header and the panel's own padding. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxHeight: Math.max(240, (windowSize?.height ?? 900) - 32 - 96),
          overflowY: "scroll",
          // A gutter for the scrollbar, outside the content column.
          paddingRight: 10,
          marginRight: -10,
          scrollbarWidth: 6,
          scrollbarColor: theme.scrollbar,
        }}
      >
        <ThemeSearchSection
          open={open}
          onInstalled={(themes, context) => {
            onImportedMany(themes, context);
            onOpenChange(false);
          }}
        />

        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
          <div style={{ flexGrow: 1, height: 1, backgroundColor: theme.border }} />
          <Text size="2xs" color={theme.mutedForeground}>
            OR IMPORT A FILE
          </Text>
          <div style={{ flexGrow: 1, height: 1, backgroundColor: theme.border }} />
        </div>

        {conflicts ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 12, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: alpha(theme.border, 0.7), backgroundColor: alpha(theme.muted, 0.2) }}>
              <Text weight={500}>Already installed</Text>
              <Text size="xs" color={theme.mutedForeground}>
                {conflicts.map((candidate) => candidate.label).join(", ")}
              </Text>
            </div>
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Button size="sm" onClick={() => resolveConflicts("update")} testId="theme-import-update-existing">
                Update existing
              </Button>
              <Button size="sm" variant="outline" onClick={() => resolveConflicts("copy")} testId="theme-import-keep-both">
                Keep both
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConflicts(null)}>
                Back
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              testId="theme-import-drop"
              // gpuix reports no drag-over, so web's drop-target highlight has no trigger.
              onFileDrop={(event: { paths?: ReadonlyArray<string> }) => readThemePaths(event.paths ?? [])}
              style={{
                display: "flex",
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 12,
                paddingBottom: 12,
                borderRadius: RADIUS.xl,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: alpha(theme.border, 0.8),
                backgroundColor: alpha(theme.muted, 0.2),
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexShrink: 1 }}>
                <Text weight={500}>Theme file</Text>
                <Text size="xs" color={theme.mutedForeground} truncate>
                  {fileName ?? "Drop T3 Code or VS Code .json files"}
                </Text>
              </div>
              <Button size="sm" variant="outline" icon="download" disabled={isReading} onClick={openFilePicker} testId="theme-import-choose">
                {isReading ? "Reading…" : "Choose files"}
              </Button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Text weight={500}>Theme JSON</Text>
              <div style={{ display: "flex", borderRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.input, backgroundColor: fieldBackground(theme), padding: 12 }}>
                <textarea
                  key={editorKey}
                  testId="theme-import-json"
                  value={json}
                  placeholder={JSON_PLACEHOLDER}
                  minRows={8}
                  maxRows={14}
                  theme={{ caret: theme.foreground }}
                  onChange={(event) => setJson(event.value ?? "")}
                  style={{ width: "100%", fontFamily: FONTS.mono, fontSize: 12, lineHeight: 20, color: theme.foreground }}
                />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" onClick={() => onOpenChange(false)} testId="theme-import-cancel">
                Cancel
              </Button>
              <Button icon="plus" disabled={!json.trim() || isReading} onClick={handleSubmit} testId="theme-import-add">
                Add theme
              </Button>
            </div>
          </div>
        )}

        {error ? (
          <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: alpha(theme.error, 0.32), backgroundColor: alpha(theme.error, 0.04) }}>
            <Text size="xs" color={theme.errorForeground}>
              {error}
            </Text>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
