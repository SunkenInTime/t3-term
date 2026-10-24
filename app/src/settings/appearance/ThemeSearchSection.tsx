// Port of apps/web/src/components/settings/ThemeSearchSection.tsx: search Open VSX for
// open-source color theme extensions and install one as a theme collection
// (web/openVsxThemes.ts downloads the package, checks its SHA-256 and converts its
// VS Code themes; web/themePalette.ts replaceCustomThemeCollection stores them).
// No spinners: T3 forbids continuously repainting indicators, so "Searching
// themes..." and "Installing..." are static text.
import { useEffect, useRef, useState } from "react";

import { Dialog } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  importOpenVsxThemeExtension,
  searchOpenVsxThemes,
  type OpenVsxThemeExtension,
  type OpenVsxThemeSort,
} from "../../web/openVsxThemes.ts";
import { getCustomThemes, getStoredCustomThemeCollection, replaceCustomThemeCollection, type ThemeDefinition } from "../../web/themePalette.ts";
import { BrandIcon } from "../brandIcons.tsx";
import { SettingsSelect, fieldBackground } from "../controls.tsx";
import { openExternal } from "../openExternal.ts";

const DOWNLOAD_FORMAT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const SUGGESTED_SEARCHES = ["Dracula", "Catppuccin", "Nord", "Tokyo Night"];
const SORT_OPTIONS: ReadonlyArray<{ value: OpenVsxThemeSort; label: string }> = [
  { value: "downloadCount", label: "Most downloaded" },
  { value: "rating", label: "Best rated" },
  { value: "timestamp", label: "Newest" },
  { value: "relevance", label: "Most relevant" },
];
const SEARCH_DEBOUNCE_MS = 350;

function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function ThemeExtensionIcon({ extension }: { extension: OpenVsxThemeExtension }) {
  const theme = useTheme();
  // gpuix's <img> reports no load error, so a broken icon URL shows an empty tile
  // instead of web's palette fallback.
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 40,
        height: 40,
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: RADIUS.lg,
        backgroundColor: theme.muted,
      }}
    >
      {extension.iconUrl ? (
        <img src={extension.iconUrl} objectFit="cover" style={{ width: 40, height: 40, borderRadius: RADIUS.lg }} />
      ) : (
        <Icon name="palette" size={16} color={theme.mutedForeground} />
      )}
    </div>
  );
}

export function ThemeSearchSection({
  open,
  onInstalled,
}: {
  open: boolean;
  onInstalled: (themes: ReadonlyArray<ThemeDefinition>, context: { updated: boolean }) => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  // gpuix inputs keep their own text while focused: remount to show a suggestion.
  const [inputKey, setInputKey] = useState(0);
  const [sortBy, setSortBy] = useState<OpenVsxThemeSort>("downloadCount");
  const [results, setResults] = useState<ReadonlyArray<OpenVsxThemeExtension> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<OpenVsxThemeExtension | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [lastSearchKey, setLastSearchKey] = useState<string | null>(null);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      requestRef.current = null;
    },
    [],
  );

  const startRequest = () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    return controller;
  };

  const runSearch = (searchText: string, sort: OpenVsxThemeSort) => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    const key = `${trimmed}\u0000${sort}`;
    const controller = startRequest();
    setError(null);
    setIsSearching(true);
    void searchOpenVsxThemes(trimmed, { signal: controller.signal, sortBy: sort })
      .then(
        (nextResults) => {
          if (controller.signal.aborted) return;
          setResults(nextResults);
          setLastSearchKey(key);
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          setResults(null);
          setLastSearchKey(null);
          setError(cause instanceof Error ? cause.message : "Open VSX search failed.");
        },
      )
      .then(() => {
        if (requestRef.current !== controller) return;
        requestRef.current = null;
        setIsSearching(false);
      });
  };

  // Search once the typing settles, unless that query and sort are already shown.
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (!open || installingId !== null) return;
    if (debouncedQuery === "") {
      requestRef.current?.abort();
      requestRef.current = null;
      setResults(null);
      setError(null);
      setIsSearching(false);
      setLastSearchKey(null);
      return;
    }
    if (debouncedQuery !== query.trim()) return;
    if (lastSearchKey === `${debouncedQuery}\u0000${sortBy}`) return;
    runSearch(debouncedQuery, sortBy);
  }, [debouncedQuery, sortBy, open, installingId]);

  const handleInstall = async (extension: OpenVsxThemeExtension, allowUpdate: boolean) => {
    setError(null);
    let installedCollection: ReadonlyArray<ThemeDefinition>;
    try {
      installedCollection = getStoredCustomThemeCollection(extension.collectionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Installed themes could not be read.");
      return;
    }
    const updated = installedCollection.length > 0;
    if (updated && !allowUpdate) {
      setPendingUpdate(extension);
      return;
    }
    const controller = startRequest();
    setIsSearching(false);
    setInstallingId(extension.id);
    try {
      const themes = await importOpenVsxThemeExtension(extension, controller.signal);
      if (!controller.signal.aborted) {
        const imported = replaceCustomThemeCollection(extension.collectionId, themes, { expectedCollection: installedCollection });
        onInstalled(imported, { updated });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "That theme could not be added.");
    }
    if (requestRef.current === controller) {
      requestRef.current = null;
      setInstallingId(null);
    }
  };

  const customThemes = getCustomThemes();
  // Two columns (`sm:grid-cols-2`); gpuix grids are track counts, so rows of two.
  const rows: Array<ReadonlyArray<OpenVsxThemeExtension>> = [];
  for (let index = 0; index < (results?.length ?? 0); index += 2) rows.push(results!.slice(index, index + 2));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Text weight={500}>Search community themes</Text>
        <Text size="xs" color={theme.mutedForeground}>
          Find open-source themes from Open VSX.
        </Text>
      </div>
      {/* InputGroup size="lg": 36 tall (measured on web), search icon addon. */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 36,
          paddingLeft: 12,
          paddingRight: 12,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: theme.input,
          backgroundColor: fieldBackground(theme),
        }}
      >
        <Icon name="search" size={16} color={alpha(theme.mutedForeground, 0.8)} />
        <input
          key={inputKey}
          testId="theme-search-input"
          autoFocus
          value={query}
          placeholder="Search themes..."
          theme={{ caret: theme.foreground }}
          onChange={(event) => setQuery(event.value ?? "")}
          onSubmit={() => {
            if (!isSearching && installingId === null) runSearch(query, sortBy);
          }}
          style={{ flexGrow: 1, minWidth: 0, height: 28, fontSize: 14, lineHeight: 28, color: theme.foreground, fontFamily: FONTS.sans }}
        />
      </div>

      {!isSearching || results !== null ? (
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, minWidth: 0 }}>
            <Text size="xs" color={theme.mutedForeground}>
              Popular
            </Text>
            {SUGGESTED_SEARCHES.map((suggestion) => (
              <Button
                key={suggestion}
                size="xs"
                variant="ghost"
                disabled={installingId !== null}
                testId={`theme-search-suggestion-${suggestion.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => {
                  if (query.trim() === suggestion) runSearch(suggestion, sortBy);
                  else {
                    setQuery(suggestion);
                    setInputKey((key) => key + 1);
                  }
                }}
              >
                {suggestion}
              </Button>
            ))}
          </div>
          {results && results.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Text size="xs" color={theme.mutedForeground}>
                Sort
              </Text>
              <SettingsSelect
                testId="theme-search-sort"
                width={160}
                value={sortBy}
                disabled={installingId !== null}
                options={SORT_OPTIONS}
                onChange={(value) => setSortBy(value)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: alpha(theme.error, 0.32), backgroundColor: alpha(theme.error, 0.04) }}>
          <Text size="xs" color={theme.errorForeground}>
            {error}
          </Text>
        </div>
      ) : null}

      {isSearching && results === null ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 80 }}>
          <Text color={theme.mutedForeground}>Searching themes...</Text>
        </div>
      ) : null}

      {results ? (
        results.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 160,
              borderRadius: RADIUS["2xl"],
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: theme.border,
            }}
          >
            <Text weight={500}>No supported open-source themes found</Text>
            <Text size="xs" color={theme.mutedForeground}>
              Try a broader search.
            </Text>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((row, rowIndex) => (
              <div key={rowIndex} style={{ display: "flex", flexDirection: "row", gap: 8 }}>
                {row.map((extension) => {
                  const isInstalling = installingId === extension.id;
                  const isInstalled = customThemes.some((candidate) => candidate.collection?.id === extension.collectionId);
                  const action = isInstalled ? "Update" : "Install";
                  const host = extension.sourceUrl ? sourceHost(extension.sourceUrl) : null;
                  return (
                    <div
                      key={extension.id}
                      testId={`theme-search-result-${extension.id}`}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        flexGrow: 1,
                        flexBasis: 0,
                        minWidth: 0,
                        padding: 12,
                        borderRadius: RADIUS.xl,
                        borderWidth: 1,
                        borderColor: alpha(theme.border, 0.7),
                        backgroundColor: alpha(theme.card, 0.6),
                        hover: { backgroundColor: alpha(theme.accent, 0.2) },
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "row", gap: 12, minWidth: 0 }}>
                        <ThemeExtensionIcon key={extension.iconUrl} extension={extension} />
                        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                          <Text weight={500} truncate>
                            {extension.name}
                          </Text>
                          <Text size="xs" color={theme.mutedForeground} truncate>
                            {`${extension.publisher} · ${DOWNLOAD_FORMAT.format(extension.downloadCount)} downloads`}
                          </Text>
                        </div>
                      </div>
                      <Text size="xs" color={theme.mutedForeground} lineClamp={2} style={{ minHeight: 32, lineHeight: 16 }}>
                        {extension.description || "A community color theme for your editor."}
                      </Text>
                      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                          {extension.sourceUrl ? (
                            host === "github.com" || host?.endsWith(".github.com") ? (
                              <div onClick={() => openExternal(extension.sourceUrl!)} style={{ display: "flex", padding: 3, borderRadius: RADIUS.sm, cursor: "pointer", hover: { backgroundColor: theme.accent } }}>
                                <BrandIcon name="github" size={14} color={theme.mutedForeground} />
                              </div>
                            ) : (
                              <IconButton icon="external-link" size={20} iconSize={14} onClick={() => openExternal(extension.sourceUrl!)} />
                            )
                          ) : null}
                        </div>
                        <Button
                          size="xs"
                          variant="outline"
                          icon={isInstalling ? undefined : isInstalled ? "refresh-cw" : "package-plus"}
                          disabled={installingId !== null}
                          testId={`theme-search-install-${extension.id}`}
                          onClick={() => void handleInstall(extension, false)}
                        >
                          {isInstalling ? `${isInstalled ? "Updating" : "Installing"}...` : action}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {row.length === 1 ? <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }} /> : null}
              </div>
            ))}
          </div>
        )
      ) : null}

      <Dialog
        open={pendingUpdate !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingUpdate(null);
        }}
        title={`Update “${pendingUpdate?.name ?? ""}”?`}
        description="This replaces its installed variants, including any local edits. Variants no longer in the extension will be removed."
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingUpdate(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const extension = pendingUpdate;
                setPendingUpdate(null);
                if (extension) void handleInstall(extension, true);
              }}
            >
              Update theme
            </Button>
          </>
        }
      />
    </div>
  );
}
