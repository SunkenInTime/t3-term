// Port of apps/web/src/components/chat/ComposerCommandMenu.tsx (the view) and the
// attached ComposerBanner.Surface it renders into. Composer.tsx renders the panel in an
// anchored layer above the composer body while a trigger (/, @, $) is active, and owns
// the keyboard path: highlight moves and selection arrive through props.
//
// Web overlaps the drawer 17px under the composer (the composer paints over it). gpuix
// paints anchored layers last, so this panel stops at the composer's top edge instead:
// anchor it with no gap, width = composer width − 44, and it has no bottom border.
import {
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import type { PublicInstance } from "@gpuix/react";
import { memo, useEffect, useRef, type ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, useTheme, type Palette } from "../../ui/theme.ts";
import type { ComposerTriggerKind } from "../../web/composer-logic.ts";
import type { ComposerCommandItem } from "../../web/components/chat/ComposerCommandMenu.ts";
import { ComposerCommandMenuEntryIcon } from "./ComposerCommandMenuEntryIcon.tsx";

export interface ComposerCommandMenuProps {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly isLoading: boolean;
  readonly triggerKind: ComposerTriggerKind | null;
  readonly emptyStateText: string;
  readonly activeItemId: string | null;
  readonly onHighlightedItemChange: (itemId: string | null) => void;
  readonly onSelect: (item: ComposerCommandItem) => void;
}

/** max-h-72 on the web CommandList. */
const LIST_MAX_HEIGHT = 288;

/** Blends `over` (#rrggbb) at `amount` onto `base` (#rrggbb): overlays must paint opaque. */
function mix(base: string, over: string, amount: number): string {
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const out = [0, 1, 2].map((index) =>
    Math.round(channel(base, index) * (1 - amount) + channel(over, index) * amount)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${out.join("")}`;
}

/**
 * ComposerBanner.Surface (attached): the composer glass (card at 80%) over the page,
 * a white 5% outline in dark (black 8% in light), 18px top corners.
 */
export function composerAttachedSurfaceColors(theme: Palette) {
  const background = mix(theme.background, theme.card, 0.8);
  return {
    background,
    outline:
      theme.appearance === "dark" ? mix(background, "#ffffff", 0.05) : mix(background, "#000000", 0.08),
    /** bg-accent on a command item: foreground at 4%. */
    highlight: mix(background, theme.foreground.slice(0, 7), theme.appearance === "dark" ? 0.04 : 0.06),
  };
}

/**
 * ComposerCommandMenuLayer: pins the menu above the composer surface, inset 22px each side
 * (--chat-composer-drawer-inset). Render it as a child of the composer surface element
 * (position: relative, 1px border); `surfaceWidth` is that element's measured width.
 */
export function ComposerCommandMenuLayer(props: { surfaceWidth: number; children: ReactNode }) {
  return (
    // top -1: from the padding box out to the border edge, so the panel ends where the
    // composer's top border starts and that border stays visible as the seam.
    <div style={{ position: "absolute", top: -1, left: 21, right: 21, height: 0 }}>
      <anchored
        side="top"
        align="start"
        deferred
        priority={2}
        occlude
        // A raw <anchored> paints #1A1A1A behind its content; the panel paints itself.
        style={{ backgroundColor: "transparent", pointerEvents: "auto" }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: Math.max(0, props.surfaceWidth - 44) }}>
          {props.children}
        </div>
      </anchored>
    </div>
  );
}

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: ComposerCommandMenuProps) {
  const theme = useTheme();
  const surface = composerAttachedSurfaceColors(theme);
  const rowRefs = useRef(new Map<string, PublicInstance>());
  // Hover already has the row on screen; scrolling to it would move the list under the pointer.
  const hoveredItemIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!props.activeItemId || props.activeItemId === hoveredItemIdRef.current) return;
    rowRefs.current.get(props.activeItemId)?.scrollIntoView?.();
  }, [props.activeItemId]);

  const onHover = (itemId: string) => {
    hoveredItemIdRef.current = itemId;
    props.onHighlightedItemChange(itemId);
  };

  return (
    <div
      testId="composer-command-menu"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        backgroundColor: surface.background,
        borderTopLeftRadius: RADIUS["2xl"],
        borderTopRightRadius: RADIUS["2xl"],
        borderTopWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: surface.outline,
        boxShadow: { offsetX: 0, offsetY: 14, blurRadius: 32, spreadRadius: -18, color: "#000000bf" },
        overflow: "hidden",
        pointerEvents: "auto",
      }}
    >
      {props.items.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: LIST_MAX_HEIGHT,
            overflowY: "scroll",
            padding: 8,
            // web ScrollArea: the thumb shows while the pointer is over the list.
            scrollbarWidth: 6,
            scrollbarColor: "#00000000",
            hover: { scrollbarColor: theme.scrollbar },
          }}
        >
          {props.items.map((item, index) => (
            <ComposerCommandMenuItem
              key={item.id}
              index={index}
              item={item}
              triggerKind={props.triggerKind}
              isActive={props.activeItemId === item.id}
              highlight={surface.highlight}
              onHighlight={onHover}
              onSelect={props.onSelect}
              registerRef={(element) => {
                if (element) rowRefs.current.set(item.id, element);
                else rowRefs.current.delete(item.id);
              }}
            />
          ))}
        </div>
      ) : (
        <div style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 14, paddingBottom: 28 }}>
          <text
            testId="composer-command-menu-empty"
            style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}
          >
            {props.isLoading
              ? props.triggerKind === "skill"
                ? "Searching workspace skills..."
                : props.triggerKind === "pull-request"
                  ? "Finding pull request..."
                  : "Searching workspace files..."
              : props.emptyStateText}
          </text>
        </div>
      )}
    </div>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  index: number;
  item: ComposerCommandItem;
  triggerKind: ComposerTriggerKind | null;
  isActive: boolean;
  highlight: string;
  onHighlight: (itemId: string) => void;
  onSelect: (item: ComposerCommandItem) => void;
  registerRef: (element: PublicInstance | null) => void;
}) {
  const theme = useTheme();
  const { item } = props;
  const skillSourceKind = item.type === "skill" ? resolveProviderSkillSourceKind(item.skill) : null;
  const slashSkill = props.triggerKind === "slash-command" && item.type === "skill" ? item.skill : null;
  const labelText = { fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans } as const;

  return (
    <div
      ref={props.registerRef}
      testId={`composer-menu-item-${props.index}`}
      onMouseEnter={() => {
        if (!props.isActive) props.onHighlight(item.id);
      }}
      onClick={() => props.onSelect(item)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 28,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.lg,
        flexShrink: 0,
        cursor: "pointer",
        backgroundColor: props.isActive ? props.highlight : undefined,
      }}
    >
      {item.type === "path" ? (
        <ComposerCommandMenuEntryIcon pathValue={item.path} kind={item.pathKind} />
      ) : null}
      {item.type === "thread" ? <Icon name="messages-square" size={16} color={theme.mutedForeground} /> : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", flexShrink: 0, maxWidth: "45%", minWidth: 0, pointerEvents: "none" }}>
          {slashSkill ? (
            <>
              <text style={{ ...labelText, color: theme.mutedForeground, whiteSpace: "nowrap", flexShrink: 0 }}>/skill:</text>
              <text
                style={{ ...labelText, color: theme.foreground, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}
              >
                {formatProviderSkillDisplayName(slashSkill)}
              </text>
            </>
          ) : (
            <text
              style={{ ...labelText, color: theme.foreground, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}
            >
              {item.label}
            </text>
          )}
        </div>
        <text
          style={{
            color: theme.mutedForeground,
            fontSize: 12,
            lineHeight: 16,
            fontFamily: FONTS.sans,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
            pointerEvents: "none",
          }}
        >
          {item.description}
        </text>
        {skillSourceKind ? (
          <SkillSourceBadge kind={skillSourceKind} showSkillSuffix={props.triggerKind === "skill"} />
        ) : null}
      </div>
    </div>
  );
});

const SKILL_SOURCE_ICON_BY_KIND: Record<ProviderSkillSourceKind, IconName> = {
  app: "blocks",
  repo: "folder",
  project: "folder",
  personal: "user-round",
  system: "settings",
  other: "package",
};

const SKILL_SOURCE_LABEL_BY_KIND: Record<ProviderSkillSourceKind, string> = {
  app: "App",
  repo: "Repo",
  project: "Project",
  personal: "Personal",
  system: "System",
  other: "Provider",
};

/** Badge variant="secondary": h 18, px 3 (+1 transparent border), radius 6, 12px medium, 12px icon at 80%. */
function SkillSourceBadge(props: { kind: ProviderSkillSourceKind; showSkillSuffix: boolean }): ReactNode {
  const theme = useTheme();
  const surface = composerAttachedSurfaceColors(theme);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 18,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: RADIUS.sm,
        backgroundColor: mix(surface.background, "#ffffff", theme.appearance === "dark" ? 0.03 : 0),
        flexShrink: 0,
        pointerEvents: "none",
      }}
    >
      <Icon name={SKILL_SOURCE_ICON_BY_KIND[props.kind]} size={12} color={theme.foreground} opacity={0.8} />
      <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans, whiteSpace: "nowrap" }}>
        {`${SKILL_SOURCE_LABEL_BY_KIND[props.kind]}${props.showSkillSuffix ? " Skill" : ""}`}
      </text>
    </div>
  );
}
