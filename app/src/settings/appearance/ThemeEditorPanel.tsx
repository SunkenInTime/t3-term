// Port of apps/web/src/components/settings/ThemeEditorPanel.tsx: the floating
// "Create theme" / "Edit theme" panel. It paints in a window-filling deferred
// layer that lets clicks through everywhere except the panel, so the app stays
// usable under the live preview.
//
// Not ported: "Inspect" (click an element to jump to its color role) and the
// "· N uses" count. Both read the DOM's computed styles; gpuix paints resolved
// colors with no record of which theme role produced them.
import { useWindowSize, type EventPayload } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";

import { setThemePreview } from "../../state/clientSettings.ts";
import { Switch, Tooltip, dialogGlassShadow } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  THEME_EDITOR_SIMPLE_ROLES,
  filterThemeEditorGroups,
  getManagedEditorColors,
  getThemeEditorColorFamily,
  getThemeEditorColorsByAppearance,
  getThemeRoleLabel,
  isThemeEditorColor,
  type ThemeEditorColorFamily,
  type ThemeEditorColors,
  type ThemeEditorColorsByAppearance,
} from "../../web/components/settings/ThemeEditorPanel.logic.ts";
import {
  THEME_COLOR_ROLES,
  THEME_FILE_VERSION,
  getCustomThemes,
  getThemeColorsForMode,
  getThemeModes,
  installCustomTheme,
  isThemeColor,
  parseThemeFile,
  removeCustomTheme,
  themeIdFromName,
  updateCustomTheme,
  updateThemeColorFamily,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
} from "../../web/themePalette.ts";
import { ThemeColorField } from "./ThemeColorPicker.tsx";

const PANEL_MARGIN = 8;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 220;

// Kept out of the component, as on the web.
function retireMergedTheme(retired: ThemeDefinition, mergeTarget: ThemeDefinition) {
  try {
    removeCustomTheme(retired.id);
  } catch (cause) {
    // The merge already persisted. Leaving it while the edited theme
    // survives would collide on every retry, so the target goes back to
    // its pre-merge palettes before the failure surfaces.
    try {
      updateCustomTheme(mergeTarget);
    } catch {}
    throw cause;
  }
}

type Rect = { x: number; y: number; width: number; height: number };

export function ThemeEditorPanel({
  onClose,
  onSaved,
  editingTheme,
  initialAppearance,
  seedTheme,
  seedName,
}: {
  onClose: () => void;
  onSaved: (
    theme: ThemeDefinition,
    context: {
      created: boolean;
      mergedAppearance?: ThemeAppearance;
    },
  ) => boolean;
  editingTheme: ThemeDefinition | null;
  initialAppearance: ThemeAppearance;
  seedTheme?: ThemeDefinition | null;
  seedName?: string | undefined;
}) {
  const theme = useTheme();
  const windowSize = useWindowSize();
  const isEditing = editingTheme !== null;

  // Seeded once per session (the host keys the panel by session id), like the
  // web's seed-during-render on open.
  const [initial] = useState(() => {
    const sourceTheme = editingTheme ?? seedTheme ?? null;
    const nextColors = getThemeEditorColorsByAppearance();
    const nextAppearance = sourceTheme
      ? getThemeColorsForMode(sourceTheme, initialAppearance)
        ? initialAppearance
        : sourceTheme.appearance
      : initialAppearance;
    if (sourceTheme) {
      nextColors[sourceTheme.appearance] = { ...sourceTheme.colors };
      for (const appearance of ["light", "dark"] as const) {
        const variantColors = sourceTheme.variants?.[appearance];
        if (variantColors) nextColors[appearance] = { ...variantColors };
      }
    }
    // Themes saved by the guided editor carry the managed flag; anything else
    // (imports, hand-edited files, built-ins) opens in advanced mode so
    // guided regeneration cannot silently discard hand-tuned colors.
    const unmanaged = sourceTheme !== null && sourceTheme.managed !== true;
    return { colors: nextColors, appearance: nextAppearance, unmanaged };
  });

  const [name, setName] = useState(editingTheme?.label ?? seedName ?? "");
  const [activeAppearance, setActiveAppearance] = useState<ThemeAppearance>(initial.appearance);
  const [isAdvanced, setIsAdvanced] = useState(initial.unmanaged);
  const [colorsByAppearance, setColorsByAppearance] = useState<ThemeEditorColorsByAppearance>(initial.colors);
  const [simpleColorsDirtyByAppearance, setSimpleColorsDirtyByAppearance] = useState<Record<ThemeAppearance, boolean>>({
    light: false,
    dark: false,
  });
  const [shouldRegenerateGuidedColors, setShouldRegenerateGuidedColors] = useState(initial.unmanaged);
  const [error, setError] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [roleQuery, setRoleQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState<ThemeColorRole | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(null);

  const nameTargetId = themeIdFromName(name);
  const normalizedName = name.trim().toLowerCase();
  const mergeTarget =
    normalizedName === ""
      ? null
      : (getCustomThemes().find(
          (candidate) =>
            candidate.id !== editingTheme?.id &&
            (candidate.id === nameTargetId || candidate.label.trim().toLowerCase() === normalizedName),
        ) ?? null);
  const takenAppearances = mergeTarget ? getThemeModes(mergeTarget) : [];
  const editableAppearances = editingTheme ? getThemeModes(editingTheme) : null;

  const appearanceLockReason = (appearance: ThemeAppearance): string | null => {
    if (editableAppearances && !editableAppearances.includes(appearance)) {
      return `“${editingTheme?.label}” has no ${appearance} palette. Create a theme with the same name to add one.`;
    }
    if (!isEditing && takenAppearances.includes(appearance)) {
      return `“${mergeTarget?.label}” already has a ${appearance} palette.`;
    }
    return null;
  };

  // Moves off a palette the merge target already has, once per target change.
  const mergeKey = isEditing || mergeTarget === null ? null : `${mergeTarget.id}:${takenAppearances.join(",")}`;
  const [appliedMergeKey, setAppliedMergeKey] = useState<string | null>(null);
  if (appliedMergeKey !== mergeKey) {
    setAppliedMergeKey(mergeKey);
    if (mergeKey !== null && takenAppearances.length === 1 && takenAppearances.includes(activeAppearance)) {
      setActiveAppearance(takenAppearances[0] === "light" ? "dark" : "light");
    }
  }

  // Live preview (applyThemeColorPreview). The web only writes valid colors to
  // the CSS variables, so a half-typed hex keeps the role's last valid color.
  const lastPreviewRef = useRef<ThemeColors | null>(null);
  useEffect(() => {
    const draft = colorsByAppearance[activeAppearance];
    const previous = lastPreviewRef.current;
    const colors = Object.fromEntries(
      THEME_COLOR_ROLES.map((role) => [
        role,
        isThemeColor(draft[role]) ? draft[role] : (previous?.[role] ?? getThemeEditorColorsByAppearance()[activeAppearance][role]),
      ]),
    ) as ThemeColors;
    lastPreviewRef.current = colors;
    setThemePreview({ colors, appearance: activeAppearance });
  }, [activeAppearance, colorsByAppearance]);
  // Closing (Cancel, X, save, the shortcut) restores the stored theme.
  useEffect(() => () => setThemePreview(null), []);

  const updateColor = (role: ThemeColorRole, value: string) => {
    setColorsByAppearance((current) => {
      const nextColors = { ...current[activeAppearance], [role]: value };
      const shouldManageColors = !isAdvanced && THEME_EDITOR_SIMPLE_ROLES.includes(role) && isThemeEditorColor(value);

      return {
        ...current,
        [activeAppearance]: isAdvanced
          ? updateThemeColorFamily(activeAppearance, current[activeAppearance], role, value)
          : shouldManageColors
            ? getManagedEditorColors(activeAppearance, nextColors)
            : nextColors,
      };
    });
    if (!isAdvanced && THEME_EDITOR_SIMPLE_ROLES.includes(role) && isThemeEditorColor(value)) {
      setSimpleColorsDirtyByAppearance((current) => ({
        ...current,
        [activeAppearance]: true,
      }));
    }
    if (isAdvanced) setShouldRegenerateGuidedColors(true);
  };

  const selectThemeRole = (role: ThemeColorRole) => {
    const visibleRole = getThemeEditorColorFamily(role)?.role ?? role;
    setSelectedRole(visibleRole);
    if (!THEME_EDITOR_SIMPLE_ROLES.includes(visibleRole)) {
      setIsAdvanced(true);
      setRoleQuery("");
    }
  };

  const toggleThemeRole = (role: ThemeColorRole) => {
    setSelectedRole((current) => (current === role ? null : role));
  };

  const handleAdvancedChange = (checked: boolean) => {
    setIsAdvanced(checked);
    if (checked) return;
    if (selectedRole && !THEME_EDITOR_SIMPLE_ROLES.includes(selectedRole)) {
      setSelectedRole(null);
    }
    if (!shouldRegenerateGuidedColors) return;

    const managedAppearances: ReadonlyArray<ThemeAppearance> =
      editingTheme && getThemeModes(editingTheme).length > 1 ? ["light", "dark"] : [activeAppearance];
    setSimpleColorsDirtyByAppearance((current) => {
      const next = { ...current };
      for (const appearance of managedAppearances) next[appearance] = true;
      return next;
    });
    setColorsByAppearance((current) => {
      const next = { ...current };
      for (const appearance of managedAppearances) {
        next[appearance] = getManagedEditorColors(appearance, current[appearance]);
      }
      return next;
    });
    setShouldRegenerateGuidedColors(false);
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      setError("Name your theme first.");
      return;
    }

    try {
      const colorsForSave: Record<ThemeAppearance, ThemeEditorColors> = !isAdvanced
        ? {
            light: simpleColorsDirtyByAppearance.light
              ? getManagedEditorColors("light", colorsByAppearance.light)
              : colorsByAppearance.light,
            dark: simpleColorsDirtyByAppearance.dark
              ? getManagedEditorColors("dark", colorsByAppearance.dark)
              : colorsByAppearance.dark,
          }
        : colorsByAppearance;

      let savedTheme: ThemeDefinition;
      let mergedAppearance: ThemeAppearance | null = null;
      let retiredTheme: ThemeDefinition | null = null;
      if (editingTheme && mergeTarget) {
        const editedModes = getThemeModes(editingTheme);
        const collision = editedModes.find((mode) => takenAppearances.includes(mode));
        if (collision) {
          setError(`“${mergeTarget.label}” already has a ${collision} palette. Pick another name.`);
          return;
        }
        mergedAppearance = editedModes[0] ?? null;
        savedTheme = updateCustomTheme({
          ...parseThemeFile({
            version: THEME_FILE_VERSION,
            id: mergeTarget.id,
            name: mergeTarget.label,
            appearance: mergeTarget.appearance,
            colors: mergeTarget.colors,
            variants: {
              ...mergeTarget.variants,
              ...Object.fromEntries(editedModes.map((mode) => [mode, colorsForSave[mode]])),
            },
            ...(mergeTarget.managed === true && !isAdvanced ? { managed: true } : {}),
          }),
          ...(mergeTarget.collection ? { collection: mergeTarget.collection } : {}),
        });
        retiredTheme = editingTheme;
        retireMergedTheme(editingTheme, mergeTarget);
      } else if (editingTheme) {
        const baseAppearance = editingTheme.appearance;
        const variantAppearance = baseAppearance === "light" ? "dark" : "light";
        savedTheme = updateCustomTheme({
          ...parseThemeFile({
            version: THEME_FILE_VERSION,
            id: editingTheme.id,
            name,
            appearance: baseAppearance,
            colors: colorsForSave[baseAppearance],
            ...(getThemeModes(editingTheme).length > 1
              ? { variants: { [variantAppearance]: colorsForSave[variantAppearance] } }
              : {}),
            ...(isAdvanced ? {} : { managed: true }),
          }),
          ...(editingTheme.collection ? { collection: editingTheme.collection } : {}),
        });
      } else if (mergeTarget) {
        if (takenAppearances.includes(activeAppearance)) {
          setError(`“${mergeTarget.label}” already has light and dark palettes. Pick another name.`);
          return;
        }
        mergedAppearance = activeAppearance;
        savedTheme = updateCustomTheme({
          ...parseThemeFile({
            version: THEME_FILE_VERSION,
            id: mergeTarget.id,
            name: mergeTarget.label,
            appearance: mergeTarget.appearance,
            colors: mergeTarget.colors,
            variants: {
              ...mergeTarget.variants,
              [activeAppearance]: colorsForSave[activeAppearance],
            },
            ...(mergeTarget.managed === true && !isAdvanced ? { managed: true } : {}),
          }),
          ...(mergeTarget.collection ? { collection: mergeTarget.collection } : {}),
        });
      } else {
        savedTheme = installCustomTheme(
          parseThemeFile({
            version: THEME_FILE_VERSION,
            name,
            appearance: activeAppearance,
            colors: colorsForSave[activeAppearance],
            ...(isAdvanced ? {} : { managed: true }),
          }),
        );
      }
      if (
        !onSaved(savedTheme, {
          created: editingTheme === null && mergedAppearance === null,
          ...(mergedAppearance ? { mergedAppearance } : {}),
        })
      ) {
        if (!editingTheme && mergedAppearance === null) {
          try {
            removeCustomTheme(savedTheme.id);
          } catch {}
        } else if (mergeTarget && mergedAppearance !== null) {
          try {
            updateCustomTheme(mergeTarget);
            if (retiredTheme) installCustomTheme(retiredTheme);
          } catch {}
        }
        setError("Theme saved, but it could not be made active. Try again.");
        return;
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : isEditing ? "Could not save the theme." : "Could not create the theme.");
    }
  };

  // ── Geometry: parked bottom-right until dragged or resized ──────────────

  const defaultWidth = Math.min(416, windowSize.width - 32);
  const width = size?.width ?? defaultWidth;
  const maxHeight = size ? windowSize.height - 16 : Math.min(672, windowSize.height - 96);
  const measured = panelSize ?? { width, height: 0 };
  const clampPosition = (x: number, y: number, widthOverride?: number) => ({
    x: Math.min(Math.max(x, PANEL_MARGIN), Math.max(PANEL_MARGIN, windowSize.width - (widthOverride ?? measured.width) - PANEL_MARGIN)),
    y: Math.min(Math.max(y, PANEL_MARGIN), Math.max(PANEL_MARGIN, windowSize.height - 48)),
  });
  const currentRect = (): Rect => ({
    x: position?.x ?? windowSize.width - 16 - measured.width,
    y: position?.y ?? windowSize.height - 16 - measured.height,
    width: measured.width,
    height: measured.height,
  });

  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ pointerX: number; pointerY: number; rect: Rect } | null>(null);

  const renderLabel = (label: string) => (
    <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
      <Text weight={500}>{label}</Text>
    </div>
  );

  const renderNameField = () => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
      {renderLabel("Theme name")}
      <div style={{ flexGrow: 2, flexBasis: 0, minWidth: 0 }}>
        <SmallInput
          testId="theme-editor-name"
          autoFocus
          value={name}
          placeholder={isEditing ? "Theme name" : "e.g. Aurora"}
          onChange={(next) => {
            setName(next);
            setError(null);
          }}
        />
      </div>
    </div>
  );

  const renderAppearanceButtons = () => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
      {renderLabel("Appearance")}
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 2, flexBasis: 0, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 2,
            padding: 2,
            borderRadius: RADIUS.lg,
            backgroundColor: alpha(theme.input, 0.4),
          }}
        >
          {(["light", "dark"] as const).map((appearance) => {
            const lockReason = appearanceLockReason(appearance);
            const item = (
              <SegmentedItem
                key={appearance}
                testId={`theme-editor-appearance-${appearance}`}
                label={appearance === "light" ? "Light" : "Dark"}
                pressed={activeAppearance === appearance}
                disabled={lockReason !== null}
                onClick={() => {
                  if (lockReason === null) setActiveAppearance(appearance);
                }}
              />
            );
            // A locked mode stays hoverable so the tooltip can say why it is off.
            return lockReason === null ? (
              item
            ) : (
              <Tooltip key={appearance} content={lockReason} side="top">
                {item}
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderColorsHeader = () => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <Text weight={500}>Colors</Text>
        {isAdvanced ? null : (
          <Text size="xs" color={theme.mutedForeground}>
            Two colors, rest derived
          </Text>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 12, flexGrow: 2, flexBasis: 0, minWidth: 0 }}>
        {isAdvanced ? (
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <SmallInput testId="theme-editor-filter" value={roleQuery} placeholder="Filter colors" onChange={setRoleQuery} />
          </div>
        ) : (
          <div style={{ flexGrow: 1 }} />
        )}
        <div
          testId="theme-editor-advanced"
          onClick={() => handleAdvancedChange(!isAdvanced)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2, flexShrink: 0, cursor: "pointer" }}
        >
          <Text weight={500}>Advanced</Text>
          {/* The row owns the click; the switch is its picture. */}
          <div style={{ pointerEvents: "none" }}>
            <Switch checked={isAdvanced} onChange={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );

  const renderRoleFields = (families: ReadonlyArray<ThemeEditorColorFamily>) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {families.map((family) => (
        <ThemeColorField
          key={family.id}
          label={family.label}
          onChange={updateColor}
          onSelect={selectThemeRole}
          onToggleSelected={toggleThemeRole}
          role={family.role}
          selected={selectedRole === family.role}
          value={colorsByAppearance[activeAppearance][family.role]}
        />
      ))}
    </div>
  );

  const renderColorFields = () => {
    if (!isAdvanced) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {THEME_EDITOR_SIMPLE_ROLES.map((role) => (
            <ThemeColorField
              key={role}
              onChange={updateColor}
              onSelect={selectThemeRole}
              onToggleSelected={toggleThemeRole}
              role={role}
              label={role === "canvas" ? "Background" : "Accent"}
              selected={selectedRole === role}
              value={colorsByAppearance[activeAppearance][role]}
            />
          ))}
        </div>
      );
    }
    const groups = filterThemeEditorGroups(roleQuery);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {groups.map((group) => (
          <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Text weight={500}>{group.title}</Text>
            {renderRoleFields(group.families)}
          </div>
        ))}
        {groups.length === 0 ? (
          <Text size="xs" color={theme.mutedForeground}>
            No matches.
          </Text>
        ) : null}
      </div>
    );
  };

  const subtitle = selectedRole
    ? isAdvanced
      ? (getThemeEditorColorFamily(selectedRole)?.label ?? getThemeRoleLabel(selectedRole))
      : getThemeRoleLabel(selectedRole)
    : "Select a color below";
  const dark = theme.appearance === "dark";
  const submitLabel = isEditing
    ? mergeTarget
      ? `Merge into “${mergeTarget.label}”`
      : "Save changes"
    : mergeTarget
      ? `Add ${activeAppearance} palette`
      : "Create theme";

  return (
    <anchored fill="window" deferred priority={0} occlude={false} style={{ backgroundColor: "transparent", pointerEvents: "none" }}>
      <div
        testId="theme-editor-panel"
        onLayout={(event: EventPayload) => {
          const { width: w, height: h } = event as EventPayload & { width?: number; height?: number };
          if (!w || !h) return;
          setPanelSize((current) =>
            current && Math.abs(current.width - w) < 0.5 && Math.abs(current.height - h) < 0.5 ? current : { width: w, height: h },
          );
        }}
        style={{
          position: "absolute",
          ...(position ? { left: position.x, top: position.y } : { right: 16, bottom: 16 }),
          display: "flex",
          flexDirection: "column",
          width,
          ...(size && !isMinimized ? { height: size.height } : {}),
          ...(isMinimized ? {} : { maxHeight }),
          overflow: "hidden",
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: dark ? alpha("#ffffff", 0.08) : alpha(theme.foreground, 0.1),
          // dialog-glass: background at 80% over a blur GPUI cannot do; opaque here.
          backgroundColor: theme.themeId === null ? (dark ? "#0f0f0f" : "#ffffff") : theme.background,
          boxShadow: dialogGlassShadow(theme),
          pointerEvents: "auto",
        }}
      >
        {/* Header: the title area drags the panel; the buttons sit beside it, not
            inside it, so the drag's pointer capture cannot swallow their clicks. */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            borderBottomWidth: isMinimized ? 0 : 1,
            borderColor: alpha(theme.border, 0.7),
            flexShrink: 0,
          }}
        >
          <div
            testId="theme-editor-drag"
            onMouseDown={(event: EventPayload) => {
              if ((event.button ?? 0) !== 0) return;
              const rect = currentRect();
              dragRef.current = { dx: (event.x ?? 0) - rect.x, dy: (event.y ?? 0) - rect.y };
            }}
            onMouseMove={(event: EventPayload) => {
              const offset = dragRef.current;
              if (!offset) return;
              if (event.pressedButton !== undefined && event.pressedButton !== 0) {
                dragRef.current = null;
                return;
              }
              setPosition(clampPosition((event.x ?? 0) - offset.dx, (event.y ?? 0) - offset.dy));
            }}
            onMouseUp={() => {
              dragRef.current = null;
            }}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "baseline",
              gap: 8,
              flexGrow: 1,
              minWidth: 0,
              height: 24,
              cursor: "grab",
            }}
          >
            <Text weight={500} style={{ flexShrink: 0 }}>
              {isEditing ? "Edit theme" : "Create theme"}
            </Text>
            {isMinimized ? null : (
              <Text size="xs" color={theme.mutedForeground} truncate>
                {subtitle}
              </Text>
            )}
          </div>
          <IconButton
            testId="theme-editor-minimize"
            icon={isMinimized ? "chevron-up" : "chevron-down"}
            size={24}
            iconSize={14}
            onClick={() => setIsMinimized(!isMinimized)}
          />
          <IconButton testId="theme-editor-close" icon="x" size={24} iconSize={14} onClick={onClose} />
        </div>

        {isMinimized ? null : (
          <>
            <div
              testId="theme-editor-body"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                flexGrow: 1,
                flexShrink: 1,
                minHeight: 0,
                overflowY: "scroll",
                scrollbarColor: theme.scrollbar,
                paddingTop: 12,
                paddingBottom: 12,
                paddingLeft: 12,
                paddingRight: 6,
              }}
            >
              {renderNameField()}
              {error ? (
                <Text color={theme.errorForeground} testId="theme-editor-error">
                  {error}
                </Text>
              ) : null}
              {renderAppearanceButtons()}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {renderColorsHeader()}
                {renderColorFields()}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 8,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 8,
                paddingBottom: 8,
                borderTopWidth: 1,
                borderColor: alpha(theme.border, 0.7),
                flexShrink: 0,
              }}
            >
              <Button testId="theme-editor-cancel" size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                testId="theme-editor-submit"
                size="sm"
                disabled={!name.trim()}
                icon={isEditing ? undefined : mergeTarget ? "plus" : "paintbrush"}
                onClick={handleSubmit}
              >
                {submitLabel}
              </Button>
            </div>
            <div
              testId="theme-editor-resize"
              onMouseDown={(event: EventPayload) => {
                if ((event.button ?? 0) !== 0) return;
                const rect = currentRect();
                // The grip drags the bottom-right corner, so the top-left must hold
                // still; the bottom-right parking spot converts to an explicit one.
                if (position === null) setPosition(clampPosition(rect.x, rect.y));
                resizeRef.current = { pointerX: event.x ?? 0, pointerY: event.y ?? 0, rect };
              }}
              onMouseMove={(event: EventPayload) => {
                const start = resizeRef.current;
                if (!start) return;
                if (event.pressedButton !== undefined && event.pressedButton !== 0) {
                  resizeRef.current = null;
                  return;
                }
                const maxWidth = Math.max(MIN_WIDTH, windowSize.width - PANEL_MARGIN - start.rect.x);
                const maxHeightForResize = Math.max(MIN_HEIGHT, windowSize.height - PANEL_MARGIN - start.rect.y);
                setSize({
                  width: Math.min(Math.max(start.rect.width + (event.x ?? 0) - start.pointerX, MIN_WIDTH), maxWidth),
                  height: Math.min(Math.max(start.rect.height + (event.y ?? 0) - start.pointerY, MIN_HEIGHT), maxHeightForResize),
                });
              }}
              onMouseUp={() => {
                resizeRef.current = null;
              }}
              style={{
                position: "absolute",
                right: 0,
                bottom: 0,
                width: 20,
                height: 20,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "flex-end",
                padding: 4,
                cursor: "nwse-resize",
              }}
            >
              <svg
                source={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.2"><path d="M7 1 1 7M7 4.5 4.5 7"/></svg>'}
                style={{ width: 10, height: 10, color: alpha(theme.mutedForeground, 0.7), pointerEvents: "none" }}
              />
            </div>
          </>
        )}
      </div>
    </anchored>
  );
}

/** web Input size="sm": 28 tall with its border, px 9, 14px, rounded-lg, input/32 fill in dark. */
function SmallInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const dark = theme.appearance === "dark";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: 28,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: focused ? theme.primary : theme.input,
        backgroundColor: dark ? alpha(theme.input, 0.32) : theme.background,
        boxShadow: focused ? { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 2, color: alpha(theme.primary, 0.24) } : undefined,
      }}
    >
      <input
        testId={testId}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        theme={{ caret: theme.foreground }}
        onChange={(event) => onChange(String(event.value ?? ""))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flexGrow: 1,
          minWidth: 0,
          height: 26,
          paddingLeft: 9,
          paddingRight: 9,
          fontSize: 14,
          fontFamily: FONTS.sans,
          color: theme.foreground,
        }}
      />
    </div>
  );
}

/** toggle variant="segmented": 24 tall, rounded-md, px 10; pressed fills input/72 (dark) or background. */
function SegmentedItem({
  label,
  pressed,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const dark = theme.appearance === "dark";
  const fill = pressed
    ? dark
      ? alpha(theme.input, 0.72)
      : theme.background
    : hovered && !disabled
      ? dark
        ? alpha(theme.input, 0.32)
        : alpha(theme.background, 0.55)
      : "#00000000";
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
        height: 24,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: RADIUS.md,
        backgroundColor: fill,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <Text weight={500} color={pressed || (hovered && !disabled) ? theme.foreground : theme.mutedForeground}>
        {label}
      </Text>
    </div>
  );
}

