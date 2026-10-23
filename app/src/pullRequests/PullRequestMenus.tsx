// Port of apps/web/src/components/pullRequest/{PullRequestListFilters,PullRequestCompactFilterMenu}.tsx
// over a small menu with submenus (web's base-ui Menu/MenuSub from components/ui/menu.tsx). The
// overlay kit's Menu has no submenus, so this builds them on its Popover.
import type {
  EnvironmentId,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
} from "@t3tools/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ProjectGlyph } from "../sidebar/ProjectGlyph.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Popover, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import {
  pullRequestLabelColor,
  type PullRequestAuthorFacet,
  type PullRequestLabelFacet,
} from "../web/components/pullRequest/pullRequestList.logic.ts";
import {
  ALL_HOSTS_VALUE,
  ALL_PROJECTS_VALUE,
  ALL_SERVERS_VALUE,
  CHECKS_OPTIONS,
  DRAFT_OPTIONS,
  REVIEW_OPTIONS,
  UNFILTERED_VALUE,
  pullRequestProjectKey,
  type PullRequestFilterOption,
} from "./pullRequestListOptions.ts";
import { PullRequestActorAvatar, SourceControlIcon } from "./pullRequestPresentation.tsx";

// ── Menu with submenus ──────────────────────────────────────────────────

interface PrMenuContextValue {
  readonly close: () => void;
  /** Called from inside a submenu: its popup sits outside the root's bounds. */
  readonly keepOpen: () => void;
  readonly activeSub: string | null;
  readonly setActiveSub: (key: string | null) => void;
}

const PrMenuContext = createContext<PrMenuContextValue>({
  close: () => {},
  keepOpen: () => {},
  activeSub: null,
  setActiveSub: () => {},
});

export function PrMenu({
  trigger,
  children,
  align = "start",
  minWidth = 160,
  onOpenChange,
  testId,
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  minWidth?: number;
  onOpenChange?: (open: boolean) => void;
  testId?: string;
}) {
  const [open, setOpenState] = useState(false);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const keep = useRef(false);
  // A press on the trigger also lands outside the popup; without this the outside press would
  // close it and the click would open it again.
  const closedAt = useRef(0);
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next) setActiveSub(null);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const requestOutsideClose = useCallback(() => {
    setTimeout(() => {
      if (keep.current) {
        keep.current = false;
        return;
      }
      closedAt.current = Date.now();
      setOpen(false);
    }, 0);
  }, [setOpen]);
  const context = useMemo<PrMenuContextValue>(
    () => ({
      close: () => setOpen(false),
      keepOpen: () => {
        keep.current = true;
      },
      activeSub,
      setActiveSub,
    }),
    [activeSub, setOpen],
  );
  const toggle = () => {
    if (open) return setOpen(false);
    if (Date.now() - closedAt.current < 250) return;
    setOpen(true);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : requestOutsideClose())}
      align={align}
      sideOffset={4}
      testId={testId}
      style={{ padding: 4, minWidth }}
      trigger={trigger({ open, toggle })}
    >
      <PrMenuContext.Provider value={context}>{children}</PrMenuContext.Provider>
    </Popover>
  );
}

function menuRowStyle(highlighted: boolean, checked: boolean, theme: ReturnType<typeof useTheme>) {
  return {
    display: "flex" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    minHeight: 28,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 8,
    paddingRight: 8,
    borderRadius: RADIUS.sm,
    flexShrink: 0,
    cursor: "pointer" as const,
    backgroundColor: highlighted ? theme.accent : checked ? alpha(theme.foreground, 0.08) : "#00000000",
    hover: { backgroundColor: theme.accent },
  };
}

export function OptionIcon<Value extends string>({ option }: { option: PullRequestFilterOption<Value> }) {
  const theme = useTheme();
  if (option.project) return <ProjectGlyph project={option.project} size={14} />;
  if (option.sourceControlKind) {
    return <SourceControlIcon kind={option.sourceControlKind} size={14} color={theme.mutedForeground} />;
  }
  return <Icon name={option.icon} size={14} color={theme.mutedForeground} opacity={0.8} />;
}

export function PrMenuRadioItem({
  checked,
  disabled,
  onSelect,
  children,
  indicator = false,
  keepOpen = false,
  testId,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
  indicator?: boolean;
  keepOpen?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  const menu = useContext(PrMenuContext);
  return (
    <div
      testId={testId}
      onMouseDown={menu.keepOpen}
      onClick={
        disabled
          ? undefined
          : () => {
              onSelect();
              if (!keepOpen) menu.close();
            }
      }
      style={{ ...menuRowStyle(false, checked, theme), opacity: disabled ? 0.64 : 1 }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, minWidth: 0 }}>
        {children}
      </div>
      {indicator && checked ? <Icon name="check" size={14} color={theme.foreground} /> : null}
    </div>
  );
}

export function PrMenuGroupLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, flexShrink: 0 }}>
      <Text size="xs" weight={500} color={theme.mutedForeground}>
        {children}
      </Text>
    </div>
  );
}

export function PrMenuSeparator() {
  const theme = useTheme();
  return (
    <div
      style={{
        height: 1,
        marginTop: 4,
        marginBottom: 4,
        marginLeft: 8,
        marginRight: 8,
        backgroundColor: theme.border,
        flexShrink: 0,
      }}
    />
  );
}

export function PrMenuSub({
  id,
  trigger,
  children,
  minWidth = 160,
  testId,
}: {
  id: string;
  trigger: ReactNode;
  children: ReactNode;
  minWidth?: number;
  testId?: string;
}) {
  const theme = useTheme();
  const menu = useContext(PrMenuContext);
  const open = menu.activeSub === id;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && menu.activeSub === id) menu.setActiveSub(null);
      }}
      side="right"
      align="start"
      sideOffset={0}
      alignOffset={-5}
      style={{ minWidth }}
      rootStyle={{ flexShrink: 0 }}
      trigger={
        <div
          testId={testId}
          onMouseEnter={() => menu.setActiveSub(id)}
          onClick={() => menu.setActiveSub(id)}
          style={{ ...menuRowStyle(open, false, theme), flexGrow: 1 }}
        >
          {trigger}
          <Icon name="chevron-right" size={16} color={theme.mutedForeground} opacity={0.8} />
        </div>
      }
    >
      <div
        onMouseDown={menu.keepOpen}
        style={{ display: "flex", flexDirection: "column", padding: 4 }}
      >
        {children}
      </div>
    </Popover>
  );
}

// ── Filter option lists ─────────────────────────────────────────────────

function OptionRow<Value extends string>({
  option,
  checked,
  indicator,
  onSelect,
}: {
  option: PullRequestFilterOption<Value>;
  checked: boolean;
  indicator: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const item = (
    <PrMenuRadioItem
      checked={checked}
      disabled={option.unavailable !== undefined}
      indicator={indicator}
      onSelect={onSelect}
      testId={`pr-option-${option.value || "all"}`}
    >
      <OptionIcon option={option} />
      <Text truncate style={{ flexGrow: 1 }}>
        {option.label}
      </Text>
      {indicator && option.unavailable ? <Text color={theme.mutedForeground}>· Unavailable</Text> : null}
    </PrMenuRadioItem>
  );
  return option.unavailable === undefined ? (
    item
  ) : (
    <Tooltip content={option.unavailable} side="right">
      <div style={{ display: "flex", flexDirection: "column" }}>{item}</div>
    </Tooltip>
  );
}

function FilterRadioSubmenu<Value extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  const theme = useTheme();
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  return (
    <PrMenuSub
      id={id}
      testId={`pr-filter-${id}`}
      trigger={
        <>
          <OptionIcon option={current} />
          <Text style={{ flexGrow: 1 }}>{label}</Text>
          <Text size="xs" color={theme.mutedForeground} truncate style={{ maxWidth: 128 }}>
            {current.label}
          </Text>
        </>
      }
    >
      <PrMenuGroupLabel>{label}</PrMenuGroupLabel>
      {options.map((option) => (
        <OptionRow
          key={option.value}
          option={option}
          checked={option.value === value}
          indicator
          onSelect={() => {
            if (option.value !== value) onChange(option.value);
          }}
        />
      ))}
    </PrMenuSub>
  );
}

function AuthorFilter({
  value,
  options,
  onChange,
}: {
  value: string | undefined;
  options: ReadonlyArray<PullRequestAuthorFacet>;
  onChange: (author: string | undefined) => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const login = value?.toLowerCase() ?? "";
  const selected = options.find((option) => option.actor.login.toLowerCase() === login);
  const visible = [
    ...(selected ? [selected] : []),
    ...options.filter(
      (option) =>
        option !== selected &&
        (needle.length === 0 ||
          option.actor.login.toLowerCase().includes(needle) ||
          option.actor.name?.toLowerCase().includes(needle)),
    ),
  ].slice(0, 10);
  const select = (next: string) => {
    if (next.toLowerCase() !== login) onChange(next || undefined);
  };
  const selectedValue = selected?.actor.login ?? value ?? "";
  return (
    <PrMenuSub
      id="author"
      testId="pr-filter-author"
      minWidth={240}
      trigger={
        <>
          <Icon name="user-round" size={14} color={theme.mutedForeground} opacity={0.8} />
          <Text style={{ flexGrow: 1 }}>Author</Text>
          <Text size="xs" color={theme.mutedForeground} truncate style={{ maxWidth: 128 }}>
            {value ?? "Anyone"}
          </Text>
        </>
      }
    >
      <div style={{ padding: 4, paddingBottom: 8 }}>
        <SearchField value={query} onChange={setQuery} placeholder="Search authors" height={28} autoFocus />
      </div>
      <PrMenuRadioItem checked={selectedValue === ""} onSelect={() => select("")}>
        <Icon name="layers" size={14} color={theme.mutedForeground} opacity={0.8} />
        <Text>Anyone</Text>
      </PrMenuRadioItem>
      {visible.map((option) => (
        <PrMenuRadioItem
          key={option.actor.login.toLowerCase()}
          checked={selectedValue === option.actor.login}
          onSelect={() => select(option.actor.login)}
        >
          <PullRequestActorAvatar actor={option.actor} />
          <Text truncate style={{ flexGrow: 1 }}>
            {option.actor.login}
          </Text>
          <Text size="xs" color={theme.mutedForeground}>
            {`${option.mergedCount} merges loaded`}
          </Text>
        </PrMenuRadioItem>
      ))}
      {visible.length === 0 ? (
        <div style={{ ...menuRowStyle(false, false, theme), opacity: 0.64, cursor: "default" }}>
          <Text>No authors found</Text>
        </div>
      ) : null}
    </PrMenuSub>
  );
}

function LabelFilter({
  value,
  options,
  onChange,
}: {
  value: ReadonlyArray<string>;
  options: ReadonlyArray<PullRequestLabelFacet>;
  onChange: (labels: ReadonlyArray<string>) => void;
}) {
  const theme = useTheme();
  const selected = new Set(value.map((name) => name.toLowerCase()));
  const visible = [
    ...value
      .filter((name) => !options.some((option) => option.name.toLowerCase() === name.toLowerCase()))
      .map((name) => ({ name, color: null, count: 0 })),
    ...options,
  ];
  return (
    <PrMenuSub
      id="labels"
      testId="pr-filter-labels"
      minWidth={200}
      trigger={
        <>
          <Icon name="tag" size={14} color={theme.mutedForeground} opacity={0.8} />
          <Text style={{ flexGrow: 1 }}>Labels</Text>
          <Text size="xs" color={theme.mutedForeground}>
            {value.length === 0 ? "Any" : `${value.length} selected`}
          </Text>
        </>
      }
    >
      {visible.length === 0 ? (
        <div style={{ ...menuRowStyle(false, false, theme), opacity: 0.64, cursor: "default" }}>
          <Text>No labels in this view</Text>
        </div>
      ) : (
        visible.map((option) => {
          const key = option.name.toLowerCase();
          const checked = selected.has(key);
          const dot = pullRequestLabelColor(option.color);
          return (
            <PrMenuRadioItem
              key={key}
              checked={false}
              keepOpen
              onSelect={() =>
                onChange(
                  !checked
                    ? [...value, option.name]
                    : value.filter((name) => name.toLowerCase() !== option.name.toLowerCase()),
                )
              }
            >
              <MenuCheckbox checked={checked} />
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  flexShrink: 0,
                  backgroundColor: dot ?? theme.mutedForeground,
                }}
              />
              <Text truncate style={{ flexGrow: 1 }}>
                {option.name}
              </Text>
              <Text size="xs" color={theme.mutedForeground}>
                {String(option.count)}
              </Text>
            </PrMenuRadioItem>
          );
        })
      )}
    </PrMenuSub>
  );
}

/** web MenuCheckboxItem's check column. */
function MenuCheckbox({ checked }: { checked: boolean }) {
  const theme = useTheme();
  return (
    <div style={{ width: 14, height: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {checked ? <Icon name="check" size={14} color={theme.foreground} /> : null}
    </div>
  );
}

export function PullRequestFiltersMenu({
  onOpenChange,
  state,
  stateOptions,
  onState,
  involvement,
  involvementOptions,
  onInvolvement,
  filters,
  onFilters,
  authorOptions = [],
  labelOptions = [],
  host,
  hostOptions,
  onHost,
  server,
  serverOptions,
  onServer,
  projects,
  projectId,
  projectEnvironmentId,
  unavailable,
  onProject,
}: {
  onOpenChange?: (open: boolean) => void;
  state: PullRequestListState;
  stateOptions: ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;
  onState: (state: PullRequestListState) => void;
  involvement: PullRequestInvolvement;
  involvementOptions: ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;
  onInvolvement: (involvement: PullRequestInvolvement) => void;
  filters: PullRequestListFilters;
  onFilters: (filters: PullRequestListFilters) => void;
  authorOptions?: ReadonlyArray<PullRequestAuthorFacet>;
  labelOptions?: ReadonlyArray<PullRequestLabelFacet>;
  host: string | undefined;
  hostOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onHost: (host: string | undefined) => void;
  server: EnvironmentId | undefined;
  serverOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onServer: (server: EnvironmentId | undefined) => void;
  projects: ReadonlyArray<NonNullable<PullRequestFilterOption<string>["project"]>>;
  projectId: ProjectId | undefined;
  projectEnvironmentId: EnvironmentId | undefined;
  unavailable: ReadonlyMap<string, string>;
  onProject: (projectId: ProjectId | undefined, environmentId: EnvironmentId | undefined) => void;
}) {
  const theme = useTheme();
  const selectedLabels = (filters.labels ?? []).flatMap((group) => group);
  const filterCount = [
    state !== "open",
    involvement !== "all",
    host,
    server,
    projectId,
    filters.draft,
    filters.review,
    filters.checks,
    filters.author,
    ...selectedLabels,
  ].filter(Boolean).length;
  const updateFilters = (next: Partial<PullRequestListFilters>) =>
    onFilters(
      Object.fromEntries(
        Object.entries({ ...filters, ...next }).filter(([, value]) => value !== undefined),
      ) as PullRequestListFilters,
    );
  const updateFilter = (key: keyof PullRequestListFilters, value: string) =>
    updateFilters({
      [key]: value === UNFILTERED_VALUE ? undefined : value,
    } as Partial<PullRequestListFilters>);
  const projectValue =
    projectId === undefined || projectEnvironmentId === undefined
      ? ALL_PROJECTS_VALUE
      : pullRequestProjectKey({ id: projectId, environmentId: projectEnvironmentId });
  const projectOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: ALL_PROJECTS_VALUE, label: "All projects", icon: "layers" },
    ...projects
      .toSorted(
        (left, right) =>
          Number(unavailable.has(pullRequestProjectKey(left))) -
          Number(unavailable.has(pullRequestProjectKey(right))),
      )
      .map((project) => ({
        value: pullRequestProjectKey(project),
        label: project.title,
        icon: "folder-git-2" as const,
        project,
        ...(unavailable.has(pullRequestProjectKey(project))
          ? { unavailable: unavailable.get(pullRequestProjectKey(project)) }
          : {}),
      })),
  ];
  return (
    <PrMenu
      align="end"
      onOpenChange={onOpenChange}
      testId="pr-filters-menu"
      trigger={({ toggle }) => (
        <OutlineButton onClick={toggle} testId="pr-filters" paddingLeft={9} gap={6}>
          <Icon name="list-filter" size={16} color={theme.mutedForeground} />
          <Text weight={500}>Filters</Text>
          {filterCount > 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: 16,
                paddingLeft: 6,
                paddingRight: 6,
                borderRadius: 8,
                backgroundColor: theme.appearance === "dark" ? "#1f1f1f" : theme.muted,
              }}
            >
              <Text size="xs" color={theme.mutedForeground}>
                {String(filterCount)}
              </Text>
            </div>
          ) : null}
        </OutlineButton>
      )}
    >
      <FilterRadioSubmenu id="state" label="State" value={state} options={stateOptions} onChange={onState} />
      <FilterRadioSubmenu
        id="involvement"
        label="Involvement"
        value={involvement}
        options={involvementOptions}
        onChange={onInvolvement}
      />
      <PrMenuSeparator />
      <AuthorFilter value={filters.author} options={authorOptions} onChange={(author) => updateFilters({ author })} />
      <LabelFilter
        value={selectedLabels}
        options={labelOptions}
        onChange={(labels) =>
          updateFilters({
            labels: labels.length === 0 ? undefined : labels.slice(0, 10).map((label) => [label]),
          })
        }
      />
      <FilterRadioSubmenu
        id="draft"
        label="Draft"
        value={filters.draft ?? UNFILTERED_VALUE}
        options={DRAFT_OPTIONS}
        onChange={(draft) => updateFilter("draft", draft)}
      />
      <FilterRadioSubmenu
        id="review"
        label="Review"
        value={filters.review ?? UNFILTERED_VALUE}
        options={REVIEW_OPTIONS}
        onChange={(review) => updateFilter("review", review)}
      />
      <FilterRadioSubmenu
        id="checks"
        label="Checks"
        value={filters.checks ?? UNFILTERED_VALUE}
        options={CHECKS_OPTIONS}
        onChange={(checks) => updateFilter("checks", checks)}
      />
      {hostOptions.length > 2 ? (
        <>
          <PrMenuSeparator />
          <FilterRadioSubmenu
            id="host"
            label="Host"
            value={host ?? ALL_HOSTS_VALUE}
            options={hostOptions}
            onChange={(next) => onHost(next === ALL_HOSTS_VALUE ? undefined : next)}
          />
        </>
      ) : null}
      {serverOptions.length > 2 ? (
        <>
          <PrMenuSeparator />
          <FilterRadioSubmenu
            id="server"
            label="Server"
            value={server ?? ALL_SERVERS_VALUE}
            options={serverOptions}
            onChange={(next) => onServer(next === ALL_SERVERS_VALUE ? undefined : (next as EnvironmentId))}
          />
        </>
      ) : null}
      <PrMenuSeparator />
      <FilterRadioSubmenu
        id="project"
        label="Project"
        value={projectValue}
        options={projectOptions}
        onChange={(next) => {
          const project = projects.find((candidate) => pullRequestProjectKey(candidate) === next);
          if (project) onProject(project.id, project.environmentId);
          else if (projectId !== undefined) onProject(undefined, undefined);
        }}
      />
    </PrMenu>
  );
}

// ── Compact single-choice menu ──────────────────────────────────────────

export function PullRequestCompactFilterMenu<Value extends string>({
  label,
  triggerIcon,
  triggerLabel,
  outlined = false,
  iconOnly = false,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  triggerIcon?: Parameters<typeof Icon>[0]["name"];
  triggerLabel?: string;
  outlined?: boolean;
  iconOnly?: boolean;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
  testId?: string;
}) {
  const theme = useTheme();
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  const tooltip = iconOnly ? `${label}: ${current.label}` : undefined;
  return (
    <PrMenu
      testId={testId ? `${testId}-menu` : undefined}
      trigger={({ toggle }) => {
        const button = outlined ? (
          iconOnly ? (
            <div
              testId={testId}
              onClick={toggle}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: theme.input,
                backgroundColor: alpha(theme.input, 0.32),
                cursor: "pointer",
                flexShrink: 0,
                hover: { backgroundColor: alpha(theme.input, 0.64) },
              }}
            >
              <OptionIcon option={current} />
            </div>
          ) : (
            <OutlineButton testId={testId} onClick={toggle} paddingLeft={triggerIcon ? 9 : 11} gap={6}>
              {triggerIcon ? <Icon name={triggerIcon} size={16} color={theme.mutedForeground} /> : null}
              <Text weight={500}>{triggerLabel ?? current.label}</Text>
            </OutlineButton>
          )
        ) : (
          <div
            testId={testId}
            onClick={toggle}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              height: 28,
              minWidth: 0,
              paddingLeft: 9,
              paddingRight: 9,
              borderRadius: RADIUS.md,
              cursor: "pointer",
              hover: { backgroundColor: theme.accent },
            }}
          >
            <Text weight={500} color={theme.mutedForeground} truncate>
              {current.label}
            </Text>
            <Icon name="chevron-down" size={12} color={alpha(theme.mutedForeground, 0.7)} />
          </div>
        );
        return tooltip ? (
          <Tooltip content={tooltip}>
            <div style={{ display: "flex" }}>{button}</div>
          </Tooltip>
        ) : (
          button
        );
      }}
    >
      {options.map((option) => (
        <OptionRow
          key={option.value}
          option={option}
          checked={option.value === value}
          indicator={false}
          onSelect={() => onChange(option.value)}
        />
      ))}
    </PrMenu>
  );
}

/** Button variant="outline" (apps/web/src/components/ui/button.tsx), 32 tall. */
export function OutlineButton({
  children,
  onClick,
  disabled,
  testId,
  square = false,
  height = 32,
  gap = 8,
  paddingLeft = 11,
  paddingRight = 11,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  square?: boolean;
  height?: number;
  /**
   * Web's button pulls its svgs in by 2px on each side (`[&_svg]:-mx-0.5`), so a leading icon
   * sits 2px nearer the edge and the label 2px nearer the icon than the padding and gap say.
   */
  gap?: number;
  paddingLeft?: number;
  paddingRight?: number;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap,
        height,
        ...(square ? { width: height } : { paddingLeft, paddingRight }),
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: alpha(theme.input, 0.32),
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled ? {} : { hover: { backgroundColor: alpha(theme.input, 0.64) } }),
      }}
    >
      {children}
    </div>
  );
}

// ── Search ──────────────────────────────────────────────────────────────

export function SearchField({
  value,
  onChange,
  placeholder,
  height = 32,
  autoFocus,
  busy = false,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  height?: number;
  autoFocus?: boolean;
  busy?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: height + 2,
        minWidth: 0,
        flexGrow: 1,
        paddingLeft: 9,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: alpha(theme.input, 0.32),
      }}
    >
      {/* Web swaps in a spinner while searching; a static loader keeps the frame still. */}
      <Icon name={busy ? "loader-circle" : "search"} size={16} color={theme.mutedForeground} opacity={0.8} />
      <input
        testId={testId}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        theme={{ caret: theme.foreground }}
        onChange={(event) => onChange(event.value ?? "")}
        style={{
          flexGrow: 1,
          minWidth: 0,
          height,
          paddingRight: 8,
          fontSize: 14,
          lineHeight: 20,
          fontFamily: FONTS.sans,
          color: theme.foreground,
        }}
      />
    </div>
  );
}

export function PullRequestSearchInput({
  value,
  busy,
  onChange,
}: {
  value: string;
  busy?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <SearchField
      testId="pr-search"
      value={value}
      busy={busy ?? false}
      onChange={onChange}
      placeholder="Search pull requests, or label:bug"
    />
  );
}
