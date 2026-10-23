// apps/web/src/components/chat/CompactComposerControlsMenu.tsx: the ⋯ menu holding the footer
// blocks that did not fit: the traits options, Chat/Plan mode and Access, as radio groups.
// Picking a trait closes it (web `closeOnClick` on those items); Mode and Access keep it open
// (Base UI radio items default to `closeOnClick={false}`).
import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Popover } from "../../ui/overlay.tsx";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl.tsx";
import { usePopoverSide, useReopenGuard } from "./ModelPickerPopover.ts";
import { TraitsGroupLabel, TraitsMenuSeparator, TraitsRadioItem } from "./TraitsPicker.tsx";

/** Estimated menu height for choosing which side of the trigger it opens on. */
const OVERFLOW_MENU_ESTIMATED_HEIGHT = 360;

export function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<{ readonly mode: RuntimeMode; readonly label: string }>;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  size?: ComposerControlSize;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const size = props.size ?? "sm";
  const guard = useReopenGuard(props.onOpenChange);
  const { side, onTriggerLayout } = usePopoverSide(OVERFLOW_MENU_ESTIMATED_HEIGHT);
  return (
    <Popover
      open={props.open}
      onOpenChange={guard.onOpenChange}
      side={side}
      align="start"
      sideOffset={4}
      testId="composer-overflow-menu"
      style={{ padding: 4, minWidth: 160 }}
      trigger={
        <div style={{ display: "flex" }} onLayout={onTriggerLayout}>
          <ComposerControl
            size={size}
            pressed={props.open}
            testId="composer-overflow"
            onClick={() => guard.toggle(props.open)}
          >
            <ComposerControlIcon name="ellipsis" size={size} />
          </ComposerControl>
        </div>
      }
    >
      {props.traitsMenuContent ? (
        <>
          {props.traitsMenuContent}
          <TraitsMenuSeparator />
        </>
      ) : null}
      {props.showInteractionModeToggle ? (
        <>
          <TraitsGroupLabel bottom={6}>Mode</TraitsGroupLabel>
          {(["default", "plan"] as const).map((mode) => (
            <OverflowRadioItem
              key={mode}
              testId={`composer-overflow-mode-${mode}`}
              label={mode === "plan" ? "Plan" : "Chat"}
              checked={props.interactionMode === mode}
              onSelect={() => {
                if (mode !== props.interactionMode) props.onToggleInteractionMode();
              }}
            />
          ))}
          <TraitsMenuSeparator />
        </>
      ) : null}
      <TraitsGroupLabel bottom={6}>Access</TraitsGroupLabel>
      {props.runtimeModeOptions.map((option) => (
        <OverflowRadioItem
          key={option.mode}
          testId={`composer-overflow-access-${option.mode}`}
          label={option.label}
          checked={props.runtimeMode === option.mode}
          onSelect={() => {
            if (option.mode !== props.runtimeMode) props.onRuntimeModeChange(option.mode);
          }}
        />
      ))}
    </Popover>
  );
}

function OverflowRadioItem(props: { testId: string; label: string; checked: boolean; onSelect: () => void }) {
  return (
    <TraitsRadioItem
      testId={props.testId}
      checked={props.checked}
      highlighted={false}
      disabled={false}
      label={props.label}
      isDefault={false}
      onHover={() => {}}
      onSelect={props.onSelect}
    />
  );
}
