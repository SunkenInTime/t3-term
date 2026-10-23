// apps/web/src/components/chat/ModelPickerSidebar.tsx: the 44px provider rail on the
// left of the model picker. Favorites star, a divider, then one square button per
// provider instance; a 3×20 primary bar marks the selected one.
import type { ProviderInstanceId } from "@t3tools/contracts";
import { memo, useState, type ReactNode } from "react";

import { LUCIDE } from "../../ui/lucide.gen.ts";
import { Tooltip } from "../../ui/overlay.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { describeUnavailableInstance } from "../../web/components/chat/ModelPickerContent.logic.ts";
import {
  isProviderInstancePickerReady,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../web/providerInstances.ts";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon.tsx";

const FILLED_STAR = LUCIDE["star"].replace('fill="none"', 'fill="#000"');

export const MODEL_PICKER_SIDEBAR_WIDTH = 44;

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedInstanceId: ProviderInstanceId | "favorites";
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  showFavorites?: boolean;
  disabledInstanceIds?: ReadonlySet<ProviderInstanceId> | undefined;
  selectableUnavailableInstanceIds?: ReadonlySet<ProviderInstanceId> | undefined;
  getDisabledInstanceTooltip?: (entry: ProviderInstanceEntry) => string;
}) {
  const theme = useTheme();
  const showFavorites = props.showFavorites ?? true;
  const [hoveredId, setHoveredId] = useState<ProviderInstanceId | "favorites" | null>(null);
  const muted = theme.muted;

  return (
    <div
      testId="model-picker-sidebar"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        width: MODEL_PICKER_SIDEBAR_WIDTH,
        flexShrink: 0,
        padding: 4,
        backgroundColor: alpha(muted, 0.3),
        overflow: "hidden",
      }}
    >
      {showFavorites ? (
        <>
          <SidebarButton
            testId="model-picker-provider-favorites"
            tooltip="Favorites"
            selected={props.selectedInstanceId === "favorites"}
            disabled={false}
            onClick={() => props.onSelectInstance("favorites")}
            onHover={(hovered) => setHoveredId((current) => (hovered ? "favorites" : current === "favorites" ? null : current))}
          >
            <svg source={FILLED_STAR} style={{ width: 20, height: 20, color: theme.foreground, pointerEvents: "none" }} />
          </SidebarButton>
          <div style={{ height: 1, flexShrink: 0, backgroundColor: alpha(theme.border, 0.7) }} />
        </>
      ) : null}
      {props.instanceEntries.map((entry) => {
        const isUnavailable = !isProviderInstancePickerReady(entry);
        const isContextDisabled = props.disabledInstanceIds?.has(entry.instanceId) ?? false;
        const unavailableSelectionIsReachable =
          props.selectableUnavailableInstanceIds?.has(entry.instanceId) ?? false;
        const isDisabled = (isUnavailable && !unavailableSelectionIsReachable) || isContextDisabled;
        const isSelected = props.selectedInstanceId === entry.instanceId;
        const isHovered = hoveredId === entry.instanceId;
        const tooltip = isUnavailable
          ? describeUnavailableInstance(entry)
          : isContextDisabled
            ? (props.getDisabledInstanceTooltip?.(entry) ?? entry.displayName)
            : entry.displayName;
        return (
          <SidebarButton
            key={entry.instanceId}
            testId={`model-picker-provider-${entry.instanceId}`}
            tooltip={tooltip}
            selected={isSelected}
            disabled={isDisabled}
            onClick={() => props.onSelectInstance(entry.instanceId)}
            onHover={(hovered) =>
              setHoveredId((current) => (hovered ? entry.instanceId : current === entry.instanceId ? null : current))
            }
          >
            <ProviderInstanceIcon
              driverKind={entry.driverKind}
              displayName={entry.displayName}
              accentColor={entry.accentColor}
              size={20}
              boxSize={24}
              showBadge={shouldShowInstanceBadge(entry, props.instanceEntries)}
              compactBadge={Boolean(entry.accentColor)}
              indicatorBackground={
                isHovered && !isDisabled ? muted : isSelected ? theme.background : alpha(muted, 0.3)
              }
            />
          </SidebarButton>
        );
      })}
    </div>
  );
});

function SidebarButton(props: {
  testId: string;
  tooltip: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <div style={{ position: "relative", display: "flex", flexShrink: 0 }}>
      <Tooltip content={props.tooltip} side="left">
        <div
          testId={props.testId}
          onClick={props.disabled ? undefined : props.onClick}
          onMouseEnter={() => props.onHover(true)}
          onMouseLeave={() => props.onHover(false)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: RADIUS.md,
            opacity: props.disabled ? 0.5 : 1,
            cursor: props.disabled ? "default" : "pointer",
            ...(props.disabled ? {} : { hover: { backgroundColor: alpha(theme.foreground, 0.1) } }),
          }}
        >
          {props.children}
        </div>
      </Tooltip>
      {props.selected ? (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: -4,
            width: 3,
            height: 20,
            borderTopLeftRadius: 2,
            borderBottomLeftRadius: 2,
            backgroundColor: theme.primary,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}
