// LegacySidebar.tsx ProjectSortMenu: the "Sidebar options" menu behind the
// arrow-up-down button. Project sort, thread sort (radio rows: the checked one
// takes a foreground/8% fill, no indicator) and the visible-thread count.
import { useAtomValue } from "@effect/atom-react";
import {
  MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
  MIN_SIDEBAR_THREAD_PREVIEW_COUNT,
  type SidebarProjectSortOrder,
  type SidebarThreadPreviewCount,
  type SidebarThreadSortOrder,
} from "@t3tools/contracts/settings";
import { useEffect, useState, type ReactNode } from "react";

import { sidebarClientSettingsAtom } from "../../state/sidebar.ts";
import { updateClientSettings } from "../../state/clientSettings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Menu, Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};

function clampSidebarThreadPreviewCount(value: number): SidebarThreadPreviewCount {
  return Math.min(
    MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
    Math.max(MIN_SIDEBAR_THREAD_PREVIEW_COUNT, value),
  ) as SidebarThreadPreviewCount;
}

export function LegacySortMenu() {
  const settings = useAtomValue(sidebarClientSettingsAtom);
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      side="bottom"
      minWidth={160}
      testId="legacy-sort-menu"
      trigger={({ toggle }) => {
        const button = <HeaderIconButton icon="arrow-up-down" testId="legacy-sort-trigger" active={open} onClick={toggle} />;
        return open ? button : (
          <Tooltip content="Sidebar options" side="right">
            {button}
          </Tooltip>
        );
      }}
    >
      <GroupLabel first>Sort projects</GroupLabel>
      {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(([value, label]) => (
        <RadioItem
          key={value}
          testId={`legacy-sort-projects-${value}`}
          checked={settings.sidebarProjectSortOrder === value}
          onSelect={() => updateClientSettings({ sidebarProjectSortOrder: value })}
        >
          {label}
        </RadioItem>
      ))}
      <GroupLabel>Sort threads</GroupLabel>
      {(Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarThreadSortOrder, string]>).map(([value, label]) => (
        <RadioItem
          key={value}
          testId={`legacy-sort-threads-${value}`}
          checked={settings.sidebarThreadSortOrder === value}
          onSelect={() => updateClientSettings({ sidebarThreadSortOrder: value })}
        >
          {label}
        </RadioItem>
      ))}
      <GroupLabel>Visible threads</GroupLabel>
      <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, flexShrink: 0 }}>
        <PreviewCountField
          value={settings.sidebarThreadPreviewCount}
          onChange={(next) => {
            const clamped = clampSidebarThreadPreviewCount(next);
            if (clamped !== settings.sidebarThreadPreviewCount) {
              updateClientSettings({ sidebarThreadPreviewCount: clamped });
            }
          }}
        />
      </div>
    </Menu>
  );
}

function GroupLabel({ children, first = false }: { children: string; first?: boolean }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: first ? 4 : 8, paddingBottom: 4, flexShrink: 0 }}>
      <Text size="xs" weight={500} color={theme.mutedForeground}>
        {children}
      </Text>
    </div>
  );
}

function RadioItem({
  children,
  checked,
  onSelect,
  testId,
}: {
  children: ReactNode;
  checked: boolean;
  onSelect: () => void;
  testId: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        minHeight: 28,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 4,
        paddingBottom: 4,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        cursor: "pointer",
        backgroundColor: checked ? alpha(theme.foreground, 0.08) : "#00000000",
        hover: { backgroundColor: theme.accent },
      }}
    >
      <Text size="sm" color={theme.foreground} style={{ whiteSpace: "nowrap" }}>
        {children}
      </Text>
    </div>
  );
}

/** NumberField size="sm" at w-28: a decrement button, the value, an increment button. */
function PreviewCountField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const theme = useTheme();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) setDraft(String(value));
    else onChange(parsed);
  };
  const stepButton = (icon: "minus" | "plus", next: number, disabled: boolean, testId: string) => (
    <div
      testId={testId}
      onClick={disabled ? undefined : () => onChange(next)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        alignSelf: "stretch",
        flexShrink: 0,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      <Icon name={icon} size={14} color={theme.foreground} />
    </div>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        width: 112,
        height: 28,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.026) : theme.background,
        overflow: "hidden",
      }}
    >
      {stepButton("minus", value - 1, value <= MIN_SIDEBAR_THREAD_PREVIEW_COUNT, "legacy-preview-count-decrement")}
      <input
        testId="legacy-preview-count"
        value={draft}
        theme={{ caret: theme.foreground }}
        onChange={(event) => setDraft(String(event.value ?? ""))}
        onSubmit={commit}
        onBlur={commit}
        style={{
          // gpuix inputs align left: pad the value into the middle of web's centred field.
          width: 42,
          flexShrink: 0,
          paddingLeft: Math.max(0, Math.round((42 - draft.length * 8) / 2)),
          fontSize: 14,
          color: theme.foreground,
          fontFamily: FONTS.sans,
        }}
      />
      {stepButton("plus", value + 1, value >= MAX_SIDEBAR_THREAD_PREVIEW_COUNT, "legacy-preview-count-increment")}
    </div>
  );
}

/** Button size="icon-xs" variant="ghost-muted": 24px, muted icon, accent on hover. */
export function HeaderIconButton({
  icon,
  testId,
  active = false,
  onClick,
}: {
  icon: "arrow-up-down" | "folder-plus";
  testId: string;
  active?: boolean;
  onClick: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: RADIUS.md,
        flexShrink: 0,
        cursor: "pointer",
        backgroundColor: hovered || active ? theme.accent : "#00000000",
      }}
    >
      <Icon name={icon} size={14} color={hovered || active ? theme.foreground : theme.mutedForeground} />
    </div>
  );
}
