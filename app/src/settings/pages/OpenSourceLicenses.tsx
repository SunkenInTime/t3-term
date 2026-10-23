// Port of apps/web/src/components/settings/OpenSourceLicenses.tsx: the
// third-party notices list with search and one expandable notice at a time.
// Reached from General > Diagnostics > "View licenses". The manifest is
// t3-term's own (settings/licenses/manifest.ts). A few hundred rows, so it is
// a SettingsVirtualPage with each notice row as its own list item.
import {
  filterThirdPartyLicenseEntries,
  formatLicenseBundles,
  thirdPartyLicenseEntryKey,
  type ThirdPartyLicenseEntry,
  type ThirdPartyLicenseManifest,
} from "@t3tools/shared/thirdPartyLicenses";
import { useEffect, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { fieldBackground, setTextEntryFocused } from "../controls.tsx";
import { CardSlice, SectionHeading, clip, mutedSurface } from "../diagnostics/parts.tsx";
import { SettingsVirtualPage, type SettingsVirtualItem } from "../layout.tsx";
import { loadLicenseManifest } from "../licenses/manifest.ts";
import { openExternal } from "../openExternal.ts";

type LicenseManifestState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly manifest: ThirdPartyLicenseManifest };

function LicenseNoticeRow({
  entry,
  open,
  onOpenChange,
  testId,
}: {
  readonly entry: ThirdPartyLicenseEntry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly testId: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          minHeight: 36,
          backgroundColor: hover ? alpha(mutedSurface(theme), 0.35) : "#00000000",
        }}
      >
        <div
          testId={testId}
          onClick={() => onOpenChange(!open)}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            minHeight: 36,
            flexGrow: 1,
            flexShrink: 1,
            minWidth: 0,
            paddingLeft: 16,
            paddingRight: 16,
            cursor: "pointer",
          }}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={theme.mutedForeground} />
          <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            <Text weight={500} style={{ whiteSpace: "nowrap" }}>
              {clip(entry.name, 64)}
            </Text>
            {entry.version ? (
              <Text size="xs" mono color={theme.mutedForeground} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                {entry.version}
              </Text>
            ) : null}
          </div>
          <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
            {clip(`${entry.license} · ${formatLicenseBundles(entry.bundles)}`, 56)}
          </Text>
        </div>
        {entry.sourceUrl ? (
          <Tooltip content="Project source" side="top">
            <IconButton
              icon="external-link"
              size={20}
              iconSize={12}
              testId={`${testId}-source`}
              onClick={() => openExternal(entry.sourceUrl!)}
              style={{ marginRight: 16 }}
            />
          </Tooltip>
        ) : null}
      </div>
      {open ? (
        // `pre whitespace-pre-wrap`: gpuix wraps a <text> without newlines, so each notice line is its own.
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 40, paddingRight: 40, paddingTop: 4, paddingBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 76 * 7.2 }}>
            {entry.noticeText.split("\n").map((line, index) => (
              <Text key={index} size="xs" mono color={alpha(theme.foreground, 0.8)} style={{ lineHeight: 20, minHeight: 20 }}>
                {line === "" ? " " : line}
              </Text>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LicenseCount({ filteredCount, totalCount }: { filteredCount: number; totalCount: number }) {
  const theme = useTheme();
  return (
    <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
      {filteredCount === totalCount ? `${String(totalCount)} notices` : `${String(filteredCount)} of ${String(totalCount)}`}
    </Text>
  );
}

function LicenseSearchInput({
  query,
  onQueryChange,
  onSearchOpenChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSearchOpenChange: (open: boolean) => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(true);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        width: 176,
        height: 28,
        paddingLeft: 9,
        paddingRight: 9,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: focused ? theme.primary : theme.input,
        backgroundColor: fieldBackground(theme),
        flexShrink: 0,
      }}
    >
      <Icon name="search" size={12} color={theme.mutedForeground} />
      <input
        testId="licenses-search-input"
        autoFocus
        value={query}
        placeholder="Search licenses"
        theme={{ caret: theme.foreground, textMuted: theme.mutedForeground, appearance: theme.appearance }}
        onChange={(event) => onQueryChange(event.value ?? "")}
        onFocus={() => {
          setFocused(true);
          setTextEntryFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setTextEntryFocused(false);
          if (query.length === 0) onSearchOpenChange(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "escape") return;
          event.preventDefault();
          event.stopPropagation();
          setTextEntryFocused(false);
          onQueryChange("");
          onSearchOpenChange(false);
        }}
        style={{ flexGrow: 1, minWidth: 0, height: 26, fontSize: 14, lineHeight: 26, color: theme.foreground, fontFamily: FONTS.sans }}
      />
    </div>
  );
}

function LicenseHeaderAction({
  query,
  onQueryChange,
  searchOpen,
  onSearchOpenChange,
  filteredCount,
  totalCount,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  filteredCount: number;
  totalCount: number;
}) {
  if (!searchOpen) {
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
        <LicenseCount filteredCount={filteredCount} totalCount={totalCount} />
        <Tooltip content="Search licenses" side="top">
          <IconButton icon="search" size={20} iconSize={12} testId="licenses-search" onClick={() => onSearchOpenChange(true)} />
        </Tooltip>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
      <LicenseCount filteredCount={filteredCount} totalCount={totalCount} />
      <LicenseSearchInput query={query} onQueryChange={onQueryChange} onSearchOpenChange={onSearchOpenChange} />
    </div>
  );
}

function LicenseManifestError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 20, paddingBottom: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Text weight={500}>Open-source notices are unavailable</Text>
        <Text size="xs" color={alpha(theme.mutedForeground, 0.8)} style={{ maxWidth: 70 * 6.5, lineHeight: 18 }}>
          {message}
        </Text>
      </div>
      <Button size="xs" variant="outline" onClick={onRetry} testId="licenses-retry">
        Try again
      </Button>
    </div>
  );
}

export function OpenSourceLicenses() {
  const theme = useTheme();
  const [state, setState] = useState<LicenseManifestState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [openEntryKey, setOpenEntryKey] = useState<string | null>(null);
  const loading = state.status === "loading";

  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    void loadLicenseManifest().then(
      (manifest) => {
        if (!cancelled) setState({ status: "ready", manifest });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "The license manifest could not load." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loading]);

  const entries = state.status === "ready" ? state.manifest.entries : [];
  const filteredEntries = filterThirdPartyLicenseEntries(entries, query);
  const retry = () => setState({ status: "loading" });

  const items: SettingsVirtualItem[] = [
    {
      key: "title",
      node: (
        <SectionHeading
          title="Third-party notices"
          headerAction={
            state.status === "ready" ? (
              <LicenseHeaderAction
                query={query}
                onQueryChange={setQuery}
                searchOpen={searchOpen}
                onSearchOpenChange={setSearchOpen}
                filteredCount={filteredEntries.length}
                totalCount={entries.length}
              />
            ) : null
          }
        />
      ),
    },
  ];
  const message = (key: string, text: string, centered: boolean) =>
    items.push({
      key,
      gapBefore: 10,
      node: (
        <CardSlice position="single">
          <div style={{ display: "flex", flexDirection: "row", justifyContent: centered ? "center" : "flex-start", paddingLeft: 16, paddingRight: 16, paddingTop: centered ? 32 : 20, paddingBottom: centered ? 32 : 20 }}>
            <Text color={theme.mutedForeground} style={{ lineHeight: 24 }}>
              {text}
            </Text>
          </div>
        </CardSlice>
      ),
    });
  if (state.status === "loading") {
    message("loading", "Loading open-source notices…", false);
  } else if (state.status === "error") {
    items.push({
      key: "error",
      gapBefore: 10,
      node: (
        <CardSlice position="single">
          <LicenseManifestError message={state.message} onRetry={retry} />
        </CardSlice>
      ),
    });
  } else if (filteredEntries.length === 0) {
    message("empty", "No licenses match that search.", true);
  } else {
    filteredEntries.forEach((entry, index) => {
      const entryKey = thirdPartyLicenseEntryKey(entry);
      const position =
        filteredEntries.length === 1 ? "single" : index === 0 ? "first" : index === filteredEntries.length - 1 ? "last" : "middle";
      items.push({
        key: entryKey,
        gapBefore: index === 0 ? 10 : 0,
        node: (
          <CardSlice position={position}>
            <LicenseNoticeRow
              entry={entry}
              open={openEntryKey === entryKey}
              onOpenChange={(open) => setOpenEntryKey(open ? entryKey : null)}
              testId={`license-row-${index}`}
            />
          </CardSlice>
        ),
      });
    });
  }

  return <SettingsVirtualPage items={items} />;
}
