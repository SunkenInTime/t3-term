// apps/web/src/components/chat/ModelListRow.tsx, plus the "Legacy models" toggle row
// ModelPickerContent.tsx renders in the same list. Rows take the model's fields rather
// than an item object so memo holds while search rebuilds the item list.
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { memo } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { LUCIDE } from "../../ui/lucide.gen.ts";
import { Tooltip } from "../../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  getDisplayModelName,
  getProviderRowLabel,
  getTriggerDisplayModelLabel,
} from "../../web/components/chat/providerIconUtils.ts";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon.tsx";

// text-xs leading-snug is 16.5px; GPUI rounds a 16.5 line down, so the two lines of a
// row split the extra pixel to keep web's 45px row.
const LINE_SNUG_FIRST = 17;
const LINE_SNUG_SECOND = 16;

/** lucide `star` with `fill-current`: gpuix svg is a mask, so filling the path fills the glyph. */
const FILLED_STAR = LUCIDE["star"].replace('fill="none"', 'fill="#000"');

/** Base UI ComboboxItem: min-h 28, px 8 py 4, radius 6; selected fg/8%, highlighted accent. */
function rowBackground(theme: ReturnType<typeof useTheme>, highlighted: boolean, selected: boolean) {
  if (highlighted) return theme.accent;
  if (selected) return alpha(theme.foreground, 0.08);
  return "#00000000";
}

export const ModelPickerListRow = memo(function ModelPickerListRow(props: {
  index: number;
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  providerDisplayName: string;
  providerAccentColor?: string | undefined;
  isFavorite: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  showProvider: boolean;
  preferShortName?: boolean;
  useTriggerLabel?: boolean;
  showNewBadge?: boolean;
  unavailable?: boolean;
  jumpLabel?: string | null;
  disabledReason?: string | null;
  onSelect: (instanceId: ProviderInstanceId, slug: string) => void;
  onHighlight: (index: number) => void;
  onToggleFavorite: (instanceId: ProviderInstanceId, slug: string) => void;
}) {
  const theme = useTheme();
  const disabled = Boolean(props.disabledReason);
  const model = {
    slug: props.slug,
    name: props.name,
    shortName: props.shortName,
    subProvider: props.subProvider,
  };
  const label = props.useTriggerLabel
    ? getTriggerDisplayModelLabel(model)
    : getDisplayModelName(model, props.preferShortName ? { preferShortName: true } : undefined);
  const providerLabel = getProviderRowLabel(props.providerDisplayName, props.subProvider);
  const favoriteLabel = props.isFavorite ? "Remove from favorites" : "Add to favorites";

  // Button size="icon-xs" variant="ghost-muted" with a 12px star.
  const starButton = (
    <div
      testId={`model-picker-favorite-${props.slug}`}
      onClick={disabled ? undefined : () => props.onToggleFavorite(props.instanceId, props.slug)}
      style={{
        // GPUI delivers a press to every element under the pointer; a non-transparent
        // fill makes the star end the hit test so the row does not also pick the model.
        backgroundColor: "#00000001",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: RADIUS.md,
        flexShrink: 0,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      {props.isFavorite ? (
        <svg source={FILLED_STAR} style={{ width: 12, height: 12, color: theme.warning, pointerEvents: "none" }} />
      ) : (
        <Icon name="star" size={12} color={theme.mutedForeground} />
      )}
    </div>
  );

  const row = (
    <div
      testId={`model-picker-row-${props.slug}`}
      onClick={disabled ? undefined : () => props.onSelect(props.instanceId, props.slug)}
      onMouseEnter={() => props.onHighlight(props.index)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 28,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        // pr-2 plus the star's -mr-1. A negative margin zeroes the cluster's intrinsic
        // width in GPUI's layout, so the 4px comes off the padding instead.
        paddingRight: 4,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        backgroundColor: rowBackground(theme, props.isHighlighted && !disabled, props.isSelected),
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
          <text
            style={{
              color: theme.foreground,
              fontSize: 12,
              lineHeight: LINE_SNUG_FIRST,
              fontWeight: 500,
              fontFamily: FONTS.sans,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
              minWidth: 0,
              flexShrink: 1,
            }}
          >
            {label}
          </text>
          {props.showNewBadge ? <NewBadge /> : null}
          {props.unavailable ? <OutlineBadge>Unavailable</OutlineBadge> : null}
        </div>
        {props.showProvider ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, minWidth: 0 }}>
            <ProviderInstanceIcon
              driverKind={props.driverKind}
              displayName={props.providerDisplayName}
              size={12}
              color={theme.mutedForeground}
            />
            <text
              style={{
                color: alpha(theme.mutedForeground, 0.7),
                fontSize: 12,
                lineHeight: LINE_SNUG_SECOND,
                fontFamily: FONTS.sans,
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
                minWidth: 0,
              }}
            >
              {providerLabel}
            </text>
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {props.jumpLabel ? <JumpKbd>{props.jumpLabel}</JumpKbd> : null}
        {/* The tooltip root measures as zero width in a flex row, so the slot carries the size. */}
        <div style={{ display: "flex", width: 24, height: 24, flexShrink: 0 }}>
          <Tooltip content={favoriteLabel} side="top">
            {starButton}
          </Tooltip>
        </div>
      </div>
    </div>
  );

  if (!props.disabledReason) return row;
  return (
    <Tooltip content={props.disabledReason} side="left">
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>{row}</div>
    </Tooltip>
  );
});

export const ModelPickerLegacyRow = memo(function ModelPickerLegacyRow(props: {
  index: number;
  count: number;
  expanded: boolean;
  isHighlighted: boolean;
  onToggle: () => void;
  onHighlight: (index: number) => void;
}) {
  const theme = useTheme();
  return (
    <div
      testId="model-picker-legacy"
      onClick={props.onToggle}
      onMouseEnter={() => props.onHighlight(props.index)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 28,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        backgroundColor: props.isHighlighted ? theme.accent : "#00000000",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <text style={{ color: theme.foreground, fontSize: 12, lineHeight: LINE_SNUG_FIRST, fontWeight: 500, fontFamily: FONTS.sans }}>
          Legacy models
        </text>
        <text
          style={{
            color: alpha(theme.mutedForeground, 0.7),
            fontSize: 12,
            lineHeight: LINE_SNUG_SECOND,
            fontFamily: FONTS.sans,
            marginTop: 4,
          }}
        >
          {`${props.count} models`}
        </text>
      </div>
      <Icon name={props.expanded ? "chevron-down" : "chevron-right"} size={16} color={theme.mutedForeground} />
    </div>
  );
});

/** ModelListRow "New": rounded border update/35, bg update/15, 10px bold uppercase. */
function NewBadge() {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: alpha(theme.primary, 0.35),
        backgroundColor: alpha(theme.primary, 0.15),
        pointerEvents: "none",
      }}
    >
      <text style={{ color: theme.infoForeground, fontSize: 10, lineHeight: 10, fontWeight: 700, fontFamily: FONTS.sans }}>
        NEW
      </text>
    </div>
  );
}

/** Badge variant="outline" size="sm": h 16, radius 4, px 3, 10px medium, border input, bg input/32. */
export function OutlineBadge({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 16,
        minWidth: 16,
        paddingLeft: 3,
        paddingRight: 3,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: theme.appearance === "dark" ? alpha(theme.input, 0.32) : theme.background,
        flexShrink: 0,
        pointerEvents: "none",
      }}
    >
      <text style={{ color: theme.foreground, fontSize: 10, lineHeight: 10, fontWeight: 500, fontFamily: FONTS.sans }}>
        {children}
      </text>
    </div>
  );
}


/** ui/kbd.tsx: h 20, min-w 20, radius 4, px 4, bg muted, 12px medium muted. Click-through so the row gets the press. */
function JumpKbd({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 20,
        minWidth: 20,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: 4,
        backgroundColor: theme.muted,
        flexShrink: 0,
        pointerEvents: "none",
      }}
    >
      <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>
        {children}
      </text>
    </div>
  );
}
