// Port of apps/web/src/components/settings/SettingsSidebarNav.tsx: brand row,
// settings search ("/" or Ctrl+F), section nav, and the Back footer.
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useGpuixRequired } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";

import { routeAtom, sidebarOpenAtom, type SettingsPage } from "../state/ui.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { IconButton, Kbd, Text } from "../ui/primitives.tsx";
import { FONTS, LAYOUT, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import {
  SETTINGS_SECTION_LABELS,
  isSettingsOverviewVisible,
  searchSettings,
  type SettingsPath,
  type SettingsSearchItem,
} from "../web/components/settings/settingsSearch.ts";
import { setTextEntryFocused } from "./controls.tsx";
import {
  SETTINGS_PATH_BY_PAGE,
  leaveSettings,
  openSettingsPage,
  pageForSettingsPath,
  settingsSearchFocusRequestAtom,
  settingsSearchQueryAtom,
} from "./navigation.ts";
import { settingsScopeSearchAtom } from "./scope.tsx";
import { useAvailableSettingsSearchItems } from "./searchItems.ts";

/** createLucideIcon("snap-shot") from SettingsSidebarNav.tsx. */
const SNAP_SHOT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H6a3 3 0 0 0-3 3v2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2"/><rect width="10" height="8" x="7" y="8" rx="2"/><circle cx="12" cy="12" r="1.5"/></svg>';

const SETTINGS_SECTION_ICONS: Readonly<Record<SettingsPath, IconName | "snap-shot">> = {
  "/settings/general": "settings-2",
  "/settings/diagnostics": "settings-2",
  "/settings/appearance": "palette",
  "/settings/projects": "panels-top-left",
  "/settings/keybindings": "keyboard",
  "/settings/snap-shot": "snap-shot",
  "/settings/providers": "bot",
  "/settings/integrations": "blocks",
  "/settings/scheduled-tasks": "calendar-clock",
  "/settings/source-control": "git-branch",
  "/settings/storage": "hard-drive",
  "/settings/connections": "link-2",
  "/settings/archived": "archive",
};

const SETTINGS_NAV_ITEMS = (Object.keys(SETTINGS_SECTION_LABELS) as SettingsPath[])
  .filter((to) => to !== "/settings/diagnostics")
  .map((to) => ({ to, label: SETTINGS_SECTION_LABELS[to], icon: SETTINGS_SECTION_ICONS[to] }));

function SectionIcon({ icon, size, color }: { icon: IconName | "snap-shot"; size: number; color: string }) {
  if (icon === "snap-shot") {
    return <svg source={SNAP_SHOT_ICON} style={{ width: size, height: size, flexShrink: 0, color, pointerEvents: "none" }} />;
  }
  return <Icon name={icon} size={size} color={color} />;
}

export function SettingsSidebarNav({ page }: { page: SettingsPage }) {
  const theme = useTheme();
  const scopeSearch = useAtomValue(settingsScopeSearchAtom);
  const navItems = SETTINGS_NAV_ITEMS.filter(
    (item) => item.to !== "/settings/projects" || isSettingsOverviewVisible(scopeSearch),
  );
  const pathname = SETTINGS_PATH_BY_PAGE[page];
  const [query, setQuery] = useAtom(settingsSearchQueryAtom);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchableItems = useAvailableSettingsSearchItems(scopeSearch);
  const results = searchSettings(query, searchableItems);
  const isSearching = query.trim().length > 0;
  const maxResultIndex = Math.max(results.length - 1, 0);
  if (activeResultIndex > maxResultIndex) setActiveResultIndex(maxResultIndex);

  const renderer = useGpuixRequired();
  const inputRef = useRef<{ id: number } | null>(null);
  const focusRequest = useAtomValue(settingsSearchFocusRequestAtom);
  useEffect(() => {
    if (focusRequest === 0 || !inputRef.current) return;
    renderer.focusElement?.(inputRef.current.id);
  }, [focusRequest, renderer]);

  const clearSearch = () => {
    setQuery("");
    setActiveResultIndex(0);
  };
  const handleSearchResultClick = (item: SettingsSearchItem) => {
    clearSearch();
    openSettingsPage(pageForSettingsPath(item.to), item.targetId ?? item.id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", padding: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              height: 32,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: RADIUS.md,
              hover: { backgroundColor: theme.sidebar.rowHover },
            }}
          >
            <Icon name="search" size={16} color={alpha(theme.sidebar.mutedForeground, 0.8)} />
            <input
              ref={inputRef as never}
              testId="settings-search"
              value={query}
              placeholder="Search"
              theme={{ caret: theme.sidebar.foreground, textMuted: theme.sidebar.mutedForeground, appearance: theme.appearance }}
              onFocus={() => setTextEntryFocused(true)}
              onBlur={() => setTextEntryFocused(false)}
              onChange={(event) => {
                setQuery(event.value ?? "");
                setActiveResultIndex(0);
              }}
              onSubmit={() => {
                const result = results[activeResultIndex];
                if (result) handleSearchResultClick(result);
              }}
              onKeyDown={(event) => {
                if (event.key === "escape" && isSearching) {
                  event.preventDefault();
                  event.stopPropagation();
                  clearSearch();
                  return;
                }
                if (results.length === 0) return;
                if (event.key === "down") {
                  event.preventDefault();
                  setActiveResultIndex((activeResultIndex + 1) % results.length);
                } else if (event.key === "up") {
                  event.preventDefault();
                  setActiveResultIndex((activeResultIndex - 1 + results.length) % results.length);
                }
              }}
              style={{
                flexGrow: 1,
                minWidth: 0,
                height: 20,
                fontSize: 14,
                lineHeight: 20,
                fontWeight: 500,
                color: theme.sidebar.foreground,
                fontFamily: FONTS.sans,
              }}
            />
            {isSearching ? (
              <IconButton icon="x" size={20} iconSize={12} color={theme.mutedForeground} onClick={clearSearch} testId="settings-search-clear" />
            ) : (
              <Kbd>/</Kbd>
            )}
          </div>
          {isSearching && results.length === 0 ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 24, paddingBottom: 24, paddingLeft: 8, paddingRight: 8 }}>
              <Text size="xs" color={theme.sidebar.mutedForeground}>
                No settings found
              </Text>
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {isSearching
              ? results.map((item, index) => (
                  <div
                    key={item.id}
                    testId={`settings-search-result-${item.id}`}
                    onMouseMove={() => {
                      if (index !== activeResultIndex) setActiveResultIndex(index);
                    }}
                    onClick={() => handleSearchResultClick(item)}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 8,
                      minHeight: 40,
                      paddingTop: 4,
                      paddingBottom: 4,
                      paddingLeft: 10,
                      paddingRight: 10,
                      borderRadius: RADIUS.md,
                      backgroundColor: index === activeResultIndex ? theme.sidebar.rowSelected : "#00000000",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", height: 20 }}>
                      <SectionIcon icon={SETTINGS_SECTION_ICONS[item.to]} size={14} color={alpha(theme.sidebar.mutedForeground, 0.6)} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                      <Text weight={500} color={theme.sidebar.foreground} truncate>
                        {item.title}
                      </Text>
                      <Text size="2xs" color={alpha(theme.sidebar.mutedForeground, 0.75)} truncate>
                        {SETTINGS_SECTION_LABELS[item.to]}
                      </Text>
                    </div>
                  </div>
                ))
              : navItems.map((item) => {
                  const isActive = pathname === item.to || (item.to === "/settings/general" && page === "open-source-licenses");
                  return (
                    <NavRow
                      key={item.to}
                      label={item.label}
                      icon={item.icon}
                      active={isActive}
                      testId={`settings-nav-${pageForSettingsPath(item.to)}`}
                      onClick={() => openSettingsPage(pageForSettingsPath(item.to))}
                    />
                  );
                })}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, padding: 8, flexShrink: 0 }}>
        <NavRow label="Back" icon="arrow-left" active={false} testId="settings-back" onClick={leaveSettings} />
      </div>
    </div>
  );
}

function NavRow({
  label,
  icon,
  active,
  onClick,
  testId,
}: {
  label: string;
  icon: IconName | "snap-shot";
  active: boolean;
  onClick: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const strong = active || hover;
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 32,
        flexGrow: 1,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        backgroundColor: active ? theme.sidebar.rowSelected : hover ? theme.sidebar.rowHover : "#00000000",
        cursor: "pointer",
      }}
    >
      <SectionIcon icon={icon} size={16} color={strong ? theme.sidebar.foreground : theme.sidebar.icon} />
      <Text weight={500} color={strong ? theme.sidebar.foreground : alpha(theme.sidebar.mutedForeground, 0.8)} truncate>
        {label}
      </Text>
    </div>
  );
}

/** The settings sidebar App renders in place of the thread sidebar. */
export function SettingsSidebar() {
  const theme = useTheme();
  const route = useAtomValue(routeAtom);
  const setSidebarOpen = useAtomSet(sidebarOpenAtom);
  const page = route.kind === "settings" ? route.page : "general";
  return (
    <div
      testId="settings-sidebar"
      style={{
        display: "flex",
        flexDirection: "column",
        width: LAYOUT.sidebarWidth,
        height: "100%",
        flexShrink: 0,
        backgroundColor: theme.sidebar.background,
        borderRightWidth: 1,
        borderColor: theme.sidebar.border,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: LAYOUT.topbar, paddingLeft: 12, paddingRight: 12, gap: 12, flexShrink: 0 }}>
        <IconButton icon="panel-left-close" color={theme.sidebar.foreground} hoverBg={theme.sidebar.rowHover} onClick={() => setSidebarOpen(false)} testId="settings-sidebar-toggle" />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text weight={700} color={theme.sidebar.foreground}>
            T3
          </Text>
          <Text weight={500} color={theme.sidebar.mutedForeground}>
            Code
          </Text>
        </div>
      </div>
      <SettingsSidebarNav page={page} />
    </div>
  );
}
