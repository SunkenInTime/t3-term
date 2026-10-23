// Ports apps/web/src/components/settings/{settingsLayout.tsx, SettingsGroup.tsx,
// SettingInheritance.tsx, SettingsScopeSentence.tsx}.
import { useAtom } from "@effect/atom-react";
import { useGpuixRequired } from "@gpuix/react";
import {
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  PROJECT_FILE_BACKED_SETTINGS,
  resolveEnvironmentMachineKind,
  type EnvironmentMachineKind,
  type ProjectFileBackedSettingKey,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import {
  useEnvironments,
  useEnvironmentsWithScope,
  usePrimaryEnvironment,
  usePrimaryEnvironmentId,
  useEnvironmentScope,
} from "../state/settings.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Menu, MenuItem, MenuSeparator, Popover, Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text, type Style } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import {
  isProjectScopedSettingKey,
  listProjectOverrides,
  scopedSettingsAreMixed,
  scopedSettingsSource,
  type ProjectOverrideEntry,
  type ScopedSettingsTarget,
} from "../web/components/settings/scopedSettings.ts";
import { resolveSettingsScope } from "../web/components/settings/settingsScope.ts";
import {
  ALL_ENVIRONMENTS_VALUE,
  ALL_PROJECTS_VALUE,
  environmentAxisValue,
  projectAxisValue,
  projectScopeMenuGroups,
  selectEnvironmentAxis,
  selectProjectAxis,
  settingsScopeEnvironmentAddress,
  settingsScopeEnvironmentLabel,
  settingsScopeEnvironmentLabels,
  settingsScopeProjectMachines,
} from "../web/components/settings/settingsScopeAxis.ts";
import { useClearProjectOverrides, useClearScopedSettings, useOptionalSettingsScope } from "./scope.tsx";
import { ProjectFavicon } from "../sidebar/ProjectFavicon.tsx";

// ── Search targets ──────────────────────────────────────────────────────

/** The row or section a settings search result points at (web: the URL hash). */
export const settingsSearchTargetAtom = Atom.make<{ readonly id: string; readonly nonce: number } | null>(null).pipe(
  Atom.keepAlive,
);

interface ScrollHandle {
  readonly id?: number;
  scrollIntoView?: (options?: unknown) => void;
}

/** The page scroller, so a search target can center itself in it. */
const PageScrollerContext = createContext<{ current: { id: number } | null } | null>(null);

/**
 * Returns a ref and a highlight flag for an element with a settings search id.
 * When a search result targets it, it scrolls into view and is highlighted
 * until the next interaction (the web app pulses it once).
 */
export function useSettingsSearchTarget(id: string | undefined) {
  const [target, setTarget] = useAtom(settingsSearchTargetAtom);
  const ref = useRef<ScrollHandle | null>(null);
  const scroller = useContext(PageScrollerContext);
  const renderer = useGpuixRequired();
  const [highlighted, setHighlighted] = useState(false);
  const isTarget = id !== undefined && target?.id === id;
  useEffect(() => {
    if (!isTarget) return;
    // Rows mount a frame before their layout is final.
    const timer = setTimeout(() => {
      // gpuix's scrollIntoView only brings the scroller's direct child into
      // view (the whole page column here), so center the row by its bounds.
      const scrollerId = scroller?.current?.id;
      const targetId = ref.current?.id;
      const scrollerBounds = scrollerId === undefined ? null : renderer.getElementBounds?.(scrollerId);
      const targetBounds = targetId === undefined ? null : renderer.getElementBounds?.(targetId);
      const offset = scrollerId === undefined ? null : renderer.getScrollOffset?.(scrollerId);
      if (scrollerId !== undefined && scrollerBounds && targetBounds && offset) {
        const contentTop = targetBounds.y - scrollerBounds.y - (offset[1] ?? 0);
        const top = Math.max(0, contentTop - (scrollerBounds.height - targetBounds.height) / 2);
        renderer.scrollTo?.(scrollerId, 0, -top);
      } else {
        ref.current?.scrollIntoView?.({ block: "center" });
      }
      setHighlighted(true);
      setTarget(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [isTarget, target?.nonce, setTarget, scroller, renderer]);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(false), 1600);
    return () => clearTimeout(timer);
  }, [highlighted]);
  return { ref, highlighted };
}

// ── Page container ──────────────────────────────────────────────────────

const PageScopeSentenceContext = createContext(true);

/** WorkspacePageContainer width="readable": max-w 896, padding 24/24/48, gap 32. */
export function SettingsPageContainer({
  children,
  showScope = true,
  maxWidth = 896,
  gap = 32,
  scroll = true,
}: {
  children: ReactNode;
  showScope?: boolean;
  maxWidth?: number;
  gap?: number;
  /** Pages with their own inner scroller (Providers) turn the page scroll off. */
  scroll?: boolean;
}) {
  const theme = useTheme();
  const scrollerRef = useRef<{ id: number } | null>(null);
  return (
    <PageScopeSentenceContext.Provider value={showScope}>
      <PageScrollerContext.Provider value={scroll ? scrollerRef : null}>
        <div
          ref={scrollerRef as never}
          testId="settings-page-scroll"
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            minHeight: 0,
            ...(scroll ? { overflowY: "scroll" } : { overflow: "hidden" }),
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 6,
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", width: "100%", ...(scroll ? {} : { flexGrow: 1, minHeight: 0 }) }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                maxWidth,
                gap,
                paddingTop: 24,
                paddingLeft: 24,
                paddingRight: 24,
                paddingBottom: 48,
                ...(scroll ? {} : { minHeight: 0 }),
              }}
            >
              {showScope ? <SettingsScopeSentence /> : null}
              {children}
            </div>
          </div>
        </div>
      </PageScrollerContext.Provider>
    </PageScopeSentenceContext.Provider>
  );
}

export interface SettingsVirtualItem {
  readonly key: string;
  readonly node: ReactNode;
  /** Space above this item (the page's 32px section gap, 10px under a section title). */
  readonly gapBefore?: number;
}

/**
 * A settings page laid out as a <virtual-list>. gpuix builds and lays out every
 * child of a plain scroll container on every frame, so a page with many rows
 * (Keybindings, Diagnostics) must virtualize: only visible items are built.
 * Items are centered in the same 896px column as SettingsPageContainer.
 */
export function SettingsVirtualPage({
  items,
  showScope = true,
  maxWidth = 896,
}: {
  items: ReadonlyArray<SettingsVirtualItem>;
  showScope?: boolean;
  maxWidth?: number;
}) {
  const column = (key: string, node: ReactNode, paddingTop: number, paddingBottom = 0) => (
    <div key={key} style={{ display: "flex", flexDirection: "row", justifyContent: "center", width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth, paddingLeft: 24, paddingRight: 24, paddingTop, paddingBottom }}>
        {node}
      </div>
    </div>
  );
  return (
    <PageScopeSentenceContext.Provider value={showScope}>
      <div testId="settings-page-scroll" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
        <virtual-list overdraw={900} style={{ flexGrow: 1, minHeight: 0 }}>
          {[
            ...(showScope ? [column("scope", <SettingsScopeSentence />, 24)] : []),
            ...items.map((item, index) =>
              column(
                item.key,
                item.node,
                index === 0 && !showScope ? 24 : (item.gapBefore ?? 32),
                index === items.length - 1 ? 48 : 0,
              ),
            ),
          ]}
        </virtual-list>
      </div>
    </PageScopeSentenceContext.Provider>
  );
}

/** One row of a grouped card drawn as its own list item (SettingsGroup split per row). */
export function GroupedItem({ position, children }: { position: "single" | "first" | "middle" | "last"; children: ReactNode }) {
  const theme = useTheme();
  const top = position === "single" || position === "first";
  const bottom = position === "single" || position === "last";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: 1,
        borderBottomWidth: bottom ? 1 : 0,
        borderColor: top ? alpha(theme.border, 0.6) : alpha(theme.border, 0.5),
        backgroundColor: alpha(theme.card, 0.4),
        ...(top ? { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl } : {}),
        ...(bottom ? { borderBottomLeftRadius: RADIUS.xl, borderBottomRightRadius: RADIUS.xl } : {}),
      }}
    >
      {children}
    </div>
  );
}

/** A section title row on its own (SettingsSection's header without the group). */
export function SettingsSectionTitle({ title, headerAction }: { title: string; headerAction?: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 28, paddingLeft: 16, paddingRight: 16 }}>
      <Text color={alpha(theme.foreground, 0.7)}>{title}</Text>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>{headerAction}</div>
    </div>
  );
}

/** A plain message where a page has nothing to show (web: `<p className="text-sm text-muted-foreground">`). */
export function SettingsMessage({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text color={theme.mutedForeground}>{children}</Text>;
}

// ── Section, group, row ─────────────────────────────────────────────────

export function SettingsSection({
  id,
  title,
  hideTitle = false,
  icon,
  titleAction,
  headerAction,
  variant = "grouped",
  divided = true,
  children,
}: {
  id?: string;
  title: string;
  hideTitle?: boolean;
  icon?: ReactNode;
  titleAction?: ReactNode;
  headerAction?: ReactNode;
  variant?: "grouped" | "plain";
  divided?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const { ref, highlighted } = useSettingsSearchTarget(id);
  return (
    <div ref={ref as never} testId={id ? `settings-section-${id}` : undefined} style={{ display: "flex", flexDirection: "column", gap: hideTitle ? 0 : 10 }}>
      {hideTitle ? null : (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            minHeight: 28,
            paddingLeft: 16,
            paddingRight: 16,
            borderRadius: RADIUS.md,
            backgroundColor: highlighted ? alpha(theme.primary, 0.12) : "#00000000",
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 }}>
              {icon}
              <Text color={alpha(theme.foreground, 0.7)}>{title}</Text>
            </div>
            {titleAction}
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", minHeight: 28, minWidth: 28, gap: 4 }}>
            {headerAction}
          </div>
        </div>
      )}
      <SettingsGroup variant={variant} divided={divided}>
        {children}
      </SettingsGroup>
    </div>
  );
}

const GroupContext = createContext<{ divided: boolean; grouped: boolean }>({ divided: false, grouped: false });

/** rounded-xl border border-border/60 bg-card/40; rows divided by border/50. */
export function SettingsGroup({
  variant = "grouped",
  divided = true,
  children,
  style,
}: {
  variant?: "grouped" | "plain";
  divided?: boolean;
  children: ReactNode;
  style?: Style;
}) {
  const theme = useTheme();
  const grouped = variant === "grouped";
  return (
    <GroupContext.Provider value={{ divided: grouped && divided, grouped }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          ...(grouped
            ? {
                borderRadius: RADIUS.xl,
                borderWidth: 1,
                borderColor: alpha(theme.border, 0.6),
                backgroundColor: alpha(theme.card, 0.4),
              }
            : { gap: 4 }),
          ...style,
        }}
      >
        {dividedChildren(children, grouped && divided, alpha(theme.border, 0.5))}
      </div>
    </GroupContext.Provider>
  );
}

function dividedChildren(children: ReactNode, divided: boolean, color: string): ReactNode {
  if (!divided) return children;
  const items = (Array.isArray(children) ? children.flat(4) : [children]).filter(
    (child) => child !== null && child !== undefined && child !== false && child !== "",
  );
  return items.map((child, index) => (
    <div key={(child as { key?: string | null })?.key ?? index} style={{ display: "flex", flexDirection: "column", ...(index > 0 ? { borderTopWidth: 1, paddingTop: 1, borderColor: color } : {}) }}>
      {child as ReactNode}
    </div>
  ));
}

export function SettingsRow({
  id,
  title,
  description,
  status,
  resetAction,
  onResetOverride,
  control,
  serverScoped = false,
  settingKeys = [],
  mixed: mixedOverride,
  children,
  disabled,
  controlWidth,
  testId,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  resetAction?: ReactNode;
  onResetOverride?: () => void;
  control?: ReactNode;
  serverScoped?: boolean;
  settingKeys?: readonly (keyof ServerSettings)[];
  mixed?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  /** Stretch the control column instead of sizing it to content. */
  controlWidth?: number;
  testId?: string;
}) {
  const theme = useTheme();
  const { ref, highlighted } = useSettingsSearchTarget(id);
  const context = useOptionalSettingsScope();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryEnvironment = usePrimaryEnvironment();
  const primaryCanWrite = useEnvironmentScope(primaryEnvironmentId, AuthSettingsWriteScope);
  const writableIds = useEnvironmentsWithScope(context?.connectedEnvironments ?? [], AuthSettingsWriteScope);
  const canWriteSettings = context
    ? context.connectedEnvironments.length > 0 &&
      context.connectedEnvironments.every((target) => writableIds.has(target.environmentId))
    : primaryCanWrite;
  const clearOverrides = useClearScopedSettings();
  const clearProjectOverrides = useClearProjectOverrides();
  const isProjectScope = context !== null && (context.scope.kind === "project" || context.scope.kind === "checkout");
  const scopedKeys = settingKeys.filter(isProjectScopedSettingKey);
  const environmentWide = isProjectScope && serverScoped && scopedKeys.length === 0;
  const mixed = mixedOverride ?? (context !== null && scopedSettingsAreMixed(context.targets, settingKeys));
  const source = context && isProjectScope ? scopedSettingsSource(context.targets, scopedKeys) : null;
  const unavailable =
    serverScoped && (!canWriteSettings || !(context ? context.connectedEnvironments.length > 0 : primaryEnvironmentId !== null));
  const inheritedFrom =
    source === "environment" && context?.scope.environmentIds.length === 1
      ? (context.environments.find((environment) => environment.environmentId === context.scope.environmentIds[0])
          ?.label ?? "environment")
      : "environment";
  const environmentSettingsById = new Map(
    (context?.connectedEnvironments ?? []).flatMap((environment) =>
      environment.serverConfig ? [[environment.environmentId, environment.serverConfig.settings] as const] : [],
    ),
  );
  const overridingProjects =
    isProjectScope || context === null || scopedKeys.length === 0
      ? []
      : listProjectOverrides(context.connectedEnvironments, scopedKeys).flatMap((entry) => {
          const group = context.groups.find((candidate) =>
            candidate.memberProjects.some(
              (member) => member.environmentId === entry.environmentId && member.id === entry.projectId,
            ),
          );
          if (!group) return [];
          return [
            {
              ...entry,
              label: group.displayName,
              open: () =>
                context.selectScope({
                  project: group.projectKey,
                  ...(context.search.machine ? { machine: context.search.machine } : {}),
                }),
            },
          ];
        });
  const renderedReset = unavailable ? null : isProjectScope && scopedKeys.length > 0 ? (
    source === "project" || source === "mixed" ? (
      <SettingResetButton
        label={typeof title === "string" ? title : "override"}
        tooltip="Reset to inherited value"
        onClick={() => (onResetOverride ? onResetOverride() : clearOverrides(scopedKeys))}
      />
    ) : null
  ) : (
    resetAction
  );
  const inertMessage =
    unavailable && control
      ? !canWriteSettings
        ? `This connection lacks permission to change settings on ${
            context
              ? context.connectedEnvironments
                  .filter((target) => !writableIds.has(target.environmentId))
                  .map((target) => target.label)
                  .join(", ") || "the selected environment"
              : (primaryEnvironment?.label ?? "the primary environment")
          }.`
        : "Reconnect the selected environment to change this setting."
      : environmentWide && control
        ? "Environment-wide setting. Select an environment to change it."
        : null;
  const customized =
    context !== null &&
    settingKeys.some((key) =>
      context.targets.some((candidate) => {
        const environmentSettings = environmentSettingsById.get(candidate.environmentId);
        return environmentSettings !== undefined && !Equal.equals(environmentSettings[key], DEFAULT_SERVER_SETTINGS[key]);
      }),
    );
  const inheritance: { state: SettingInheritanceState; summary: string } = mixed
    ? { state: "mixed", summary: "Mixed across selected environments" }
    : source === "project"
      ? { state: "overridden", summary: "Overridden for this project" }
      : source === "t3.json"
        ? { state: "inherited", summary: "Inherited from the repository's t3.json" }
        : source === "environment" && scopedKeys.length > 0
          ? { state: "inherited", summary: `Inherited from ${inheritedFrom}` }
          : customized
            ? { state: "environment", summary: "Set on the environment" }
            : { state: "default", summary: "Built-in default" };
  const renderedInheritance =
    context && serverScoped && settingKeys.length > 0 ? (
      <SettingInheritance
        state={inheritance.state}
        summary={inheritance.summary}
        targets={context.targets}
        keys={settingKeys}
        overridingProjects={overridingProjects}
        {...(canWriteSettings
          ? { onClearOverrides: (entries: readonly ProjectOverrideEntry[]) => clearProjectOverrides(entries, scopedKeys) }
          : {})}
      />
    ) : null;

  const controlNode = control ? (
    inertMessage ? (
      <Tooltip content={inertMessage} side="top">
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, opacity: 0.5 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, pointerEvents: "none" }}>{control}</div>
        </div>
      </Tooltip>
    ) : (
      control
    )
  ) : null;

  return (
    <div
      ref={ref as never}
      testId={testId ?? (id ? `settings-row-${id}` : undefined)}
      style={{
        display: "flex",
        flexDirection: "column",
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: children ? 4 : 12,
        opacity: disabled ? 0.64 : 1,
        backgroundColor: highlighted ? alpha(theme.primary, 0.1) : "#00000000",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 }}>
            {typeof title === "string" ? (
              <Text weight={500} color={disabled ? theme.mutedForeground : theme.foreground}>
                {title}
              </Text>
            ) : (
              title
            )}
            {renderedInheritance ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0 }}>
                {renderedInheritance}
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0 }}>
              {renderedReset}
            </div>
          </div>
          {description ? (
            typeof description === "string" ? (
              <Text size="xs" color={alpha(theme.mutedForeground, 0.8)} style={{ lineHeight: 18, maxWidth: 576 }}>
                {description}
              </Text>
            ) : (
              <div style={{ maxWidth: 576 }}>{description}</div>
            )
          ) : null}
          {status ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 2 }}>
              {typeof status === "string" ? (
                <Text size="xs" color={theme.mutedForeground}>
                  {status}
                </Text>
              ) : (
                status
              )}
            </div>
          ) : null}
        </div>
        {controlNode ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              flexShrink: 0,
              minWidth: 160,
              ...(controlWidth ? { width: controlWidth } : {}),
            }}
          >
            {controlNode}
          </div>
        ) : null}
      </div>
      {children ? (
        <div style={{ display: "flex", flexDirection: "column", ...(unavailable ? { opacity: 0.5, pointerEvents: "none" } : {}) }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Undo2 12px icon-micro ghost-muted, tooltip "Reset to default". */
export function SettingResetButton({
  label,
  tooltip = "Reset to default",
  disabled = false,
  onClick,
}: {
  label: string;
  tooltip?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={tooltip} side="top">
      <IconButton icon="undo-2" size={20} iconSize={12} disabled={disabled} onClick={onClick} testId={`reset-${label.replace(/\s+/g, "-").toLowerCase()}`} />
    </Tooltip>
  );
}

/** InfoIcon 14px in an icon-micro button with a tooltip. */
export function PolicyTooltip({ children }: { children: string }) {
  return (
    <Tooltip content={children} side="top">
      <IconButton icon="info" size={20} iconSize={14} />
    </Tooltip>
  );
}

/** Shown above controls that are inert in the current scope. */
export function SettingsUnavailableGroup({ children, message }: { children: ReactNode; message?: ReactNode }) {
  const theme = useTheme();
  if (message === undefined) return <>{children}</>;
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingTop: 6, paddingBottom: 6, backgroundColor: alpha(theme.muted, 0.2) }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
        <div style={{ paddingTop: 2 }}>
          <Icon name="info" size={14} color={theme.warning} />
        </div>
        {typeof message === "string" ? (
          <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 19 }}>
            {message}
          </Text>
        ) : (
          message
        )}
      </div>
      <div style={{ opacity: 0.64 }}>{children}</div>
    </div>
  );
}

// ── Inheritance badge (SettingInheritance.tsx) ──────────────────────────

export type SettingInheritanceState = "default" | "environment" | "inherited" | "overridden" | "mixed";

interface InheritanceLayer {
  readonly key: "project" | "environment" | "t3.json" | "built-in";
  readonly label: string;
  readonly value: string;
  readonly effective: boolean;
  readonly set: boolean;
}

const WRITING_STYLE_LABELS: Record<string, string> = {
  repo_conventions: "Repository conventions",
  conventional_commits: "Conventional Commits",
  custom: "Custom instructions",
};

const ENV_MODE_LABELS: Record<string, string> = { local: "Current checkout", worktree: "New worktree" };
const SUBMODULE_LABELS: Record<string, string> = { recursive: "Recursive", none: "None", top_level: "Top level" };

function formatValue(key: keyof ServerSettings, value: unknown): string {
  if (value === null || value === undefined) {
    return key === "pullRequestMergeMethod"
      ? "Last selected"
      : key === "sidebarAutoSettleAfterDays"
        ? "Never"
        : key === "defaultModelSelection"
          ? "Automatic"
          : key === "sourceControlWriterModelSelection"
            ? "Text generation model"
            : key === "reviewGuideModelSelection"
              ? "Source control writer model"
              : key === "defaultThreadEnvMode" || key === "worktreeSubmodules"
                ? "Inherit"
                : "Not set";
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") {
    return key === "sidebarAutoSettleAfterDays" ? `${value} ${value === 1 ? "day" : "days"}` : String(value);
  }
  if (typeof value === "string") {
    if (key === "defaultThreadEnvMode" && value in ENV_MODE_LABELS) return ENV_MODE_LABELS[value]!;
    if (key === "worktreeSubmodules" && value in SUBMODULE_LABELS) return SUBMODULE_LABELS[value]!;
    return value === "" ? "Empty" : value;
  }
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object") {
    if ("model" in value && typeof value.model === "string") return value.model;
    if ("mode" in value && typeof value.mode === "string") return WRITING_STYLE_LABELS[value.mode] ?? value.mode;
  }
  return "Custom";
}

function isProjectFileBackedSettingKey(key: keyof ServerSettings): key is ProjectFileBackedSettingKey {
  return Object.hasOwn(PROJECT_FILE_BACKED_SETTINGS, key);
}

function settingInheritanceLayers(
  target: ScopedSettingsTarget,
  environmentSettings: ServerSettings,
  key: keyof ServerSettings,
): readonly InheritanceLayer[] {
  const environmentValue = environmentSettings[key];
  const source = isProjectScopedSettingKey(key) ? target.sources[key] : "environment";
  const environmentSet = !Equal.equals(environmentValue, DEFAULT_SERVER_SETTINGS[key]);
  const fileBacked = isProjectFileBackedSettingKey(key);
  const layers: InheritanceLayer[] = [];
  if (target.projectId !== null && isProjectScopedSettingKey(key)) {
    layers.push({
      key: "project",
      label: "Project",
      value: source === "project" ? formatValue(key, target.settings[key]) : "Inherits",
      effective: source === "project",
      set: source === "project",
    });
  }
  layers.push({
    key: "environment",
    label: target.label,
    value: environmentSet ? formatValue(key, environmentValue) : "Inherits",
    effective: source === "environment" && environmentSet,
    set: environmentSet,
  });
  if (fileBacked && target.projectId !== null) {
    layers.push({
      key: "t3.json",
      label: "t3.json",
      value: source === "t3.json" ? formatValue(key, target.settings[key]) : "Inherits",
      effective: source === "t3.json",
      set: source === "t3.json",
    });
  }
  const builtIn = fileBacked ? PROJECT_FILE_BACKED_SETTINGS[key].builtIn : DEFAULT_SERVER_SETTINGS[key];
  layers.push({
    key: "built-in",
    label: "Default",
    value: formatValue(key, builtIn),
    effective: source === "environment" && !environmentSet,
    set: true,
  });
  return layers;
}

interface OverridingProject extends ProjectOverrideEntry {
  readonly label: string;
  readonly open: () => void;
}

function SettingInheritance({
  state,
  summary,
  targets,
  keys,
  overridingProjects,
  onClearOverrides,
}: {
  state: SettingInheritanceState;
  summary: string;
  targets: readonly ScopedSettingsTarget[];
  keys: readonly (keyof ServerSettings)[];
  overridingProjects: readonly OverridingProject[];
  onClearOverrides?: (entries: readonly ProjectOverrideEntry[]) => void;
}) {
  const theme = useTheme();
  const context = useOptionalSettingsScope();
  const [open, setOpen] = useState(false);
  const key = keys[0];
  if (!key || targets.length === 0 || context === null) return null;
  const overrideSummary =
    overridingProjects.length > 0
      ? `${summary} · ${overridingProjects.length} project ${overridingProjects.length === 1 ? "override" : "overrides"}`
      : summary;
  const chains = targets.flatMap((target) => {
    const environment = context.connectedEnvironments.find((candidate) => candidate.environmentId === target.environmentId);
    if (!environment?.serverConfig) return [];
    return [{ id: `${target.environmentId}:${target.projectId ?? ""}`, target, layers: settingInheritanceLayers(target, environment.serverConfig.settings, key) }];
  });
  const iconColor = state === "overridden" ? theme.primary : state === "mixed" ? theme.warning : theme.mutedForeground;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      style={{ width: 320, padding: 0 }}
      trigger={
        <Tooltip content={overrideSummary} side="top">
          <IconButton icon="layers" size={20} iconSize={12} color={iconColor} onClick={() => setOpen(!open)} />
        </Tooltip>
      }
    >
      {chains.map(({ id, target, layers }, index) => {
        const overriding = overridingProjects.filter((project) => project.environmentId === target.environmentId);
        return (
          <div
            key={id}
            style={{
              display: "flex",
              flexDirection: "column",
              paddingLeft: 12,
              paddingRight: 12,
              paddingTop: 10,
              paddingBottom: 10,
              ...(index > 0 ? { borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) } : {}),
            }}
          >
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 6 }}>
              <Icon name={machineIcon(context.connectedEnvironments.find((environment) => environment.environmentId === target.environmentId)?.serverConfig ?? null)} size={14} color={theme.mutedForeground} />
              <Text size="xs" weight={500} color={theme.mutedForeground} truncate>
                {target.label}
              </Text>
            </div>
            {layers.map((layer) => (
              <div
                key={layer.key}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 4,
                  paddingBottom: 4,
                  borderRadius: RADIUS.sm,
                  backgroundColor: layer.effective ? alpha(theme.foreground, 0.06) : "#00000000",
                }}
              >
                <Text
                  weight={layer.effective ? 500 : 400}
                  color={layer.effective ? theme.foreground : theme.mutedForeground}
                  truncate
                  style={{ flexGrow: 1 }}
                >
                  {layer.key === "environment" ? "Environment" : layer.label}
                </Text>
                <Text
                  color={
                    layer.effective ? theme.foreground : layer.set ? theme.mutedForeground : alpha(theme.mutedForeground, 0.6)
                  }
                  truncate
                  style={{ maxWidth: 128 }}
                >
                  {layer.value}
                </Text>
                {layer.effective ? <Icon name="check" size={14} color={theme.primary} /> : <div style={{ width: 14 }} />}
              </div>
            ))}
            {overriding.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: alpha(theme.border, 0.6) }}>
                <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", paddingLeft: 8, paddingRight: 8 }}>
                  <Text size="xs" color={theme.mutedForeground}>
                    Overridden by
                  </Text>
                  {onClearOverrides ? (
                    <div onClick={() => onClearOverrides(overriding)} style={{ cursor: "pointer" }}>
                      <Text size="xs" weight={500}>
                        {`Reset ${overriding.length === 1 ? "it" : "all"}`}
                      </Text>
                    </div>
                  ) : null}
                </div>
                {overriding.map((project) => (
                  <div
                    key={`${project.environmentId}:${project.projectId}`}
                    style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}
                  >
                    <div onClick={project.open} style={{ flexGrow: 1, minWidth: 0, cursor: "pointer" }}>
                      <Text weight={500} truncate>
                        {project.label}
                      </Text>
                    </div>
                    <Text color={theme.mutedForeground} truncate style={{ maxWidth: 128 }}>
                      {isProjectScopedSettingKey(key)
                        ? formatValue(
                            key,
                            context.connectedEnvironments.find((environment) => environment.environmentId === project.environmentId)
                              ?.serverConfig?.settings.projectSettingsOverrides[project.projectId]?.[key],
                          )
                        : ""}
                    </Text>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </Popover>
  );
}

// ── Scope sentence (SettingsScopeSentence.tsx) ──────────────────────────

/** Pages whose settings live on this device only: no scope sentence. */
export const SETTINGS_DEVICE_ONLY_PAGES: ReadonlySet<string> = new Set(["appearance", "snap-shot", "connections"]);

interface ScopeOption {
  value: string;
  label: string;
  secondary?: string;
  icon?: ReactNode;
  offline?: boolean;
}

/**
 * The project / environment picker in the scope sentence. Up to six options it
 * is a menu; more turn it into a searchable list, like the web's Combobox.
 */
function ScopeMenu({
  testId,
  icon,
  label,
  value,
  options,
  allOption,
  searchLabel,
  onChange,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  value: string;
  options: ScopeOption[];
  allOption: ScopeOption | null;
  searchLabel: string;
  onChange: (next: string) => void;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchable = options.length > 6;
  const choices = allOption ? [allOption, ...options] : options;
  const needle = query.trim().toLowerCase();
  const visible = searchable
    ? choices.filter((option) => `${option.label} ${option.secondary ?? ""} ${option.value}`.toLowerCase().includes(needle))
    : choices;
  const setOpenState = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpenState}
      align="start"
      testId={`${testId}-menu`}
      style={{ padding: 4, width: searchable ? 320 : 288, maxHeight: 420, overflowY: "scroll" }}
      trigger={
        <div
          testId={testId}
          onClick={() => setOpenState(!open)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, cursor: "pointer", minWidth: 0, maxWidth: 288 }}
        >
          {icon}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            {/* JS truncation: ellipsis text inside nested shrinking flex costs hundreds of ms per frame in gpuix. */}
            <Text size="base" weight={600}>
              {label.length > 30 ? `${label.slice(0, 29).trimEnd()}…` : label}
            </Text>
            <div style={{ height: 1, marginTop: -2, backgroundColor: hover || open ? theme.foreground : alpha(theme.foreground, 0.3) }} />
          </div>
          <Icon name="chevron-down" size={14} color={theme.mutedForeground} />
        </div>
      }
    >
      {searchable ? (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            height: 36,
            marginBottom: 4,
            paddingLeft: 8,
            paddingRight: 8,
            borderBottomWidth: 1,
            borderColor: theme.primary,
          }}
        >
          <Icon name="search" size={14} color={theme.mutedForeground} />
          <input
            testId={`${testId}-search`}
            autoFocus
            value={query}
            placeholder={searchLabel}
            theme={{ caret: theme.foreground, textMuted: theme.mutedForeground, appearance: theme.appearance }}
            onChange={(event) => setQuery(event.value ?? "")}
            onSubmit={() => {
              const first = visible[0];
              if (first) {
                onChange(first.value);
                setOpenState(false);
              }
            }}
            style={{ flexGrow: 1, minWidth: 0, height: 34, fontSize: 14, lineHeight: 34, color: theme.foreground }}
          />
        </div>
      ) : null}
      {visible.length === 0 ? (
        <div style={{ padding: 12 }}>
          <Text size="sm" color={theme.mutedForeground}>
            No matches found.
          </Text>
        </div>
      ) : null}
      {visible.map((option, index) => (
        <ScopeMenuRow
          key={option.value}
          option={option}
          checked={option.value === value}
          separatorAfter={!searchable && index === 0 && allOption !== null}
          onSelect={() => {
            onChange(option.value);
            setOpenState(false);
          }}
        />
      ))}
    </Popover>
  );
}

function ScopeMenuRow({
  option,
  checked,
  separatorAfter,
  onSelect,
}: {
  option: ScopeOption;
  checked: boolean;
  separatorAfter: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  return (
    <>
      <div
        testId={`scope-option-${option.label}`}
        onClick={onSelect}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: option.secondary ? "flex-start" : "center",
          gap: 8,
          minHeight: 28,
          paddingTop: option.secondary ? 6 : 0,
          paddingBottom: option.secondary ? 6 : 0,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: RADIUS.sm,
          backgroundColor: checked ? alpha(theme.foreground, 0.06) : "#00000000",
          cursor: "pointer",
          flexShrink: 0,
          hover: { backgroundColor: theme.accent },
        }}
      >
        {option.icon ? <div style={{ display: "flex", alignItems: "center", height: 20 }}>{option.icon}</div> : null}
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          <Text>{option.label}</Text>
          {option.secondary ? (
            <Text size="xs" color={theme.mutedForeground}>
              {option.secondary}
            </Text>
          ) : null}
        </div>
        {option.offline ? (
          <Text size="xs" color={theme.mutedForeground}>
            Offline
          </Text>
        ) : null}
        {checked ? <Icon name="check" size={14} color={theme.foreground} /> : null}
      </div>
      {separatorAfter ? <MenuSeparator /> : null}
    </>
  );
}

const MACHINE_ICONS: Record<EnvironmentMachineKind, IconName> = {
  server: "server",
  cloud: "cloud",
  linux: "terminal",
  desktop: "monitor",
  laptop: "laptop",
  "mac-mini": "rectangle-horizontal",
  "mac-studio": "square",
};

/** EnvironmentMachineIcon as a lucide name (Linux and the Mac shapes are custom on the web). */
export function machineIcon(config: Parameters<typeof resolveEnvironmentMachineKind>[0]): IconName {
  return MACHINE_ICONS[resolveEnvironmentMachineKind(config)] ?? "server";
}

export function SettingsScopeSentence() {
  const theme = useTheme();
  const scope = useOptionalSettingsScope();
  const showScope = useContext(PageScopeSentenceContext);
  const { environments } = useEnvironments();
  if (scope === null || !showScope) return null;
  const value = scope.search;
  const groups = scope.groups;
  // Project axis
  const selectedProject = groups.find((group) => group.projectKey === value.project);
  const projects = projectScopeMenuGroups(groups, value).map((group) => ({
    group,
    machines: settingsScopeProjectMachines(group, environments, true).join(", "),
  }));
  // Environment axis
  const resolved = resolveSettingsScope(value, groups, environments);
  const environmentValue = environmentAxisValue(value, resolved.kind === "checkout" ? resolved.environmentId : null);
  const selectedEnvironment = environments.find((environment) => environment.environmentId === environmentValue);
  const memberEnvironmentIds = selectedProject
    ? new Set(selectedProject.memberProjects.map((member) => member.environmentId))
    : null;
  const environmentOptions = memberEnvironmentIds
    ? environments.filter((environment) => memberEnvironmentIds.has(environment.environmentId))
    : environments;
  return (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 4, paddingLeft: 16, paddingRight: 16 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Text size="base" color={theme.mutedForeground}>
          Applying settings for
        </Text>
        <ScopeMenu
          testId="settings-scope-project"
          icon={selectedProject ? <ProjectFavicon project={{ ...selectedProject, title: selectedProject.displayName }} size={14} /> : null}
          searchLabel="Search projects"
          label={selectedProject?.displayName ?? (value.project ? "Unavailable project" : "All projects")}
          value={projectAxisValue(value)}
          onChange={(next) => scope.selectScope(selectProjectAxis(value, next))}
          allOption={{ value: ALL_PROJECTS_VALUE, label: "All projects" }}
          options={projects.map(({ group, machines }) => {
            const sameName = projects.filter(
              (other) => other.group.projectKey !== group.projectKey && other.group.displayName === group.displayName,
            );
            return {
              value: group.projectKey,
              label: group.displayName,
              secondary:
                sameName.length === 0
                  ? environments.length > 1
                    ? group.workspaceRoot
                    : ""
                  : sameName.some((other) => other.machines === machines)
                    ? `${machines} · ${group.workspaceRoot}`
                    : machines,
              icon: <ProjectFavicon project={{ ...group, title: group.displayName }} size={14} />,
            };
          })}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Text size="base" color={theme.mutedForeground}>
          {value.machine || scope.scope.kind === "checkout" || scope.singleEnvironment ? "on" : "across"}
        </Text>
        <ScopeMenu
          testId="settings-scope-environment"
          icon={selectedEnvironment ? <Icon name={machineIcon(selectedEnvironment.serverConfig)} size={14} color={theme.foreground} /> : null}
          searchLabel="Search environments"
          label={
            selectedEnvironment
              ? settingsScopeEnvironmentLabel(selectedEnvironment, environments)
              : environmentValue !== ALL_ENVIRONMENTS_VALUE
                ? "Unavailable environment"
                : scope.singleEnvironment
                  ? "No environments"
                  : "All environments"
          }
          value={environmentValue}
          onChange={(next) => scope.selectScope(selectEnvironmentAxis(value, next))}
          allOption={
            scope.singleEnvironment
              ? null
              : { value: ALL_ENVIRONMENTS_VALUE, label: "All environments", icon: <Icon name="layers" size={14} color={theme.mutedForeground} /> }
          }
          options={environmentOptions.map((environment) => {
            const { primary, secondary } = settingsScopeEnvironmentLabels(environment, environments);
            return {
              value: environment.environmentId,
              label: primary,
              secondary: environments.length <= 1 ? "" : secondary || settingsScopeEnvironmentAddress(environment),
              icon: <Icon name={machineIcon(environment.serverConfig)} size={14} color={theme.mutedForeground} />,
              offline: environment.connection.phase !== "connected",
            };
          })}
        />
      </div>
    </div>
  );
}

