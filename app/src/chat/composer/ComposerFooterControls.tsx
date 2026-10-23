// apps/web/src/components/chat/ComposerFooterControls.tsx (ComposerFooterModeControls):
// the runtime-mode select (Supervised / Auto-accept edits / Auto / Full access) and the
// Build/Plan toggle that follow the model and traits pickers in the composer footer.
import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";

import { Icon } from "../../ui/Icon.tsx";
import { Menu } from "../../ui/overlay.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, useTheme } from "../../ui/theme.ts";
import { runtimeModeConfig } from "../../web/components/chat/runtimeModeConfig.ts";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
  ComposerControlLabel,
  ComposerControlSeparator,
  type ComposerControlSize,
} from "./ComposerControl.tsx";

export type RuntimeModeOption = { mode: RuntimeMode } & (typeof runtimeModeConfig)[RuntimeMode];

const supervisedRuntimeModeOption: RuntimeModeOption = {
  mode: "approval-required",
  ...runtimeModeConfig["approval-required"],
};

export function ComposerFooterModeControls(props: {
  showInteractionModeToggle: boolean;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  size?: ComposerControlSize;
  modeMenuOpen: boolean;
  onModeMenuOpenChange: (open: boolean) => void;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const size = props.size ?? "sm";
  const option =
    props.runtimeModeOptions.find((candidate) => candidate.mode === props.runtimeMode) ??
    supervisedRuntimeModeOption;
  const interactionModeTooltip =
    props.interactionMode === "plan"
      ? "Plan mode. Click to return to normal build mode"
      : "Default mode. Click to enter plan mode";
  return (
    <>
      <ComposerControlSeparator size={size} />
      <Menu
        open={props.modeMenuOpen}
        onOpenChange={props.onModeMenuOpenChange}
        side="top"
        align="start"
        sideOffset={4}
        minWidth={256}
        testId="composer-runtime-mode-menu"
        trigger={({ toggle }) => {
          const control = (
            <ComposerControl size={size} pressed={props.modeMenuOpen} onClick={toggle} testId="composer-runtime-mode">
              <ComposerControlIcon name={option.icon} size={size} />
              <ComposerControlLabel size={size}>{option.label}</ComposerControlLabel>
              <ComposerControlChevron size={size} />
            </ComposerControl>
          );
          // The open menu replaces the description tooltip (web closes it on press).
          return props.modeMenuOpen ? (
            control
          ) : (
            <Tooltip content={option.description} side="top">
              {control}
            </Tooltip>
          );
        }}
      >
        {props.runtimeModeOptions.map((candidate) => (
          <RuntimeModeItem
            key={candidate.mode}
            option={candidate}
            selected={candidate.mode === props.runtimeMode}
            onSelect={() => {
              props.onModeMenuOpenChange(false);
              props.onRuntimeModeChange(candidate.mode);
            }}
          />
        ))}
      </Menu>
      {props.showInteractionModeToggle ? (
        <>
          <ComposerControlSeparator size={size} />
          <Tooltip content={interactionModeTooltip} side="top">
            <ComposerControl
              size={size}
              pressed={props.interactionMode === "plan"}
              onClick={props.onToggleInteractionMode}
              testId="composer-interaction-mode"
            >
              {props.interactionMode === "plan" ? (
                <ComposerControlIcon name="pencil-ruler" size={size} color={undefined} />
              ) : (
                <ComposerControlIcon name="bot" size={size} large={size !== "xs"} />
              )}
              <ComposerControlLabel size={size} pressed={props.interactionMode === "plan"}>
                {props.interactionMode === "plan" ? "Plan" : "Build"}
              </ComposerControlLabel>
            </ComposerControl>
          </Tooltip>
        </>
      ) : null}
    </>
  );
}

/** Select item without the check indicator (web `hideIndicator`): icon + label over a description. */
function RuntimeModeItem({
  option,
  selected,
  onSelect,
}: {
  option: RuntimeModeOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  return (
    <div
      testId={`composer-runtime-mode-${option.mode}`}
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 256,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        cursor: "pointer",
        backgroundColor: selected ? theme.accent : "#00000000",
        hover: { backgroundColor: theme.accent },
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, pointerEvents: "none" }}>
        <Icon name={option.icon} size={14} color={theme.mutedForeground} />
        <Text weight={500}>{option.label}</Text>
      </div>
      <Text size="xs" color={theme.mutedForeground} style={{ pointerEvents: "none" }}>
        {option.description}
      </Text>
    </div>
  );
}
