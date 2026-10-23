// apps/web/src/components/chat/ProviderModelPicker.tsx: the composer's model control
// (provider mark + model name + chevron) and the popover holding ModelPickerContent.
// Open state is controlled; Composer.tsx binds it to `modelPickerOpenAtom` so the
// mod+shift+M shortcut and the trigger share it.
import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { ANTIGRAVITY_DEFAULT_MODEL } from "@t3tools/contracts";

import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { ChatGptSharingControl } from "./ChatGptSharingControl.tsx";
import { alpha, useTheme } from "../../ui/theme.ts";
import { useSmallViewport } from "../../ui/viewport.tsx";
import { resolveModelPickerSelectedModel } from "../../web/components/chat/ModelPickerContent.logic.ts";
import {
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
} from "../../web/components/chat/providerIconUtils.ts";
import { shortcutLabelForCommand } from "../../web/keybindings.ts";
import type { AppModelOption } from "../../web/modelSelection.ts";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../web/providerInstances.ts";
import {
  COMPOSER_CONTROL_HIDDEN_STYLE,
  ComposerControl,
  ComposerControlChevron,
  type ComposerControlSize,
  composerControlLabelStyle,
} from "./ComposerControl.tsx";
import { MODEL_PICKER_MAX_HEIGHT, ModelPickerContent, SHORTCUT_PLATFORM } from "./ModelPickerContent.tsx";
import { OutlineBadge } from "./ModelPickerListRow.tsx";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon.tsx";
import { usePopoverSide, useReopenGuard } from "./ModelPickerPopover.ts";

export interface ProviderModelPickerProps {
  readonly environmentId: EnvironmentId | null;
  readonly activeInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly lockedContinuationGroupKey?: string | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly keybindings?: ResolvedKeybindingsConfig;
  readonly size?: ComposerControlSize;
  readonly disabled?: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  readonly onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  readonly onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  /** The footer's collapse layout reads the trigger's width and its label's clipped and natural widths. */
  readonly measure?: (part: ModelPickerMeasurePart, width: number) => void;
  /**
   * The resting strip on a composer under 640px shows the picker as its icon and chevron
   * (web `@max-[640px]/composer-surface:[&_[data-chat-provider-model-picker-label]]:w-0 flex-none`).
   */
  readonly collapseLabel?: boolean;
  /** web multiple-model mode: the models chosen for a draft send (only while there are 2+). */
  readonly selectedModels?: ReadonlyArray<{ readonly instanceId: ProviderInstanceId; readonly model: string }>;
  /** Shift-click / shift-Enter adds or removes a model (drafts on servers with worktree bootstrap). */
  readonly onToggleModel?: (instanceId: ProviderInstanceId, model: string) => void;
}

export type ModelPickerMeasurePart = "control" | "label" | "labelNatural";

/** web `min-w-13` on the composer's picker trigger: it shrinks to this before the label clips away. */
export const MODEL_PICKER_TRIGGER_MIN_WIDTH = 52;

const layoutWidth = (event: unknown) => {
  const width = (event as { width?: number }).width;
  return typeof width === "number" ? width : null;
};

export function ProviderModelPicker(props: ProviderModelPickerProps) {
  const theme = useTheme();
  const size = props.size ?? "sm";
  const open = props.open && !props.disabled;
  const activeEntry = props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null;
  const options = props.modelOptionsByInstance.get(props.activeInstanceId) ?? [];
  const selectedModel =
    resolveModelPickerSelectedModel({ driverKind: activeEntry?.driverKind, model: props.model, options }) ??
    (activeEntry?.driverKind === "opencode" || activeEntry?.driverKind === "antigravity" ? undefined : options[0]);
  const triggerTitle = selectedModel
    ? getTriggerDisplayModelName(selectedModel)
    : props.model === ANTIGRAVITY_DEFAULT_MODEL
      ? "Choose model"
      : props.model || "Choose model";
  const triggerLabel = selectedModel
    ? `${getTriggerDisplayModelLabel(selectedModel)}${selectedModel.isUnavailable ? " (Unavailable)" : ""}`
    : triggerTitle;
  const shortcutLabel = props.keybindings
    ? shortcutLabelForCommand(props.keybindings, "modelPicker.toggle", SHORTCUT_PLATFORM)
    : null;
  // web: with several models chosen the trigger names the first two and counts the rest.
  const selectedEntries = props.selectedModels?.map((selection) => {
    const entry = props.instanceEntries.find((candidate) => candidate.instanceId === selection.instanceId);
    const model = resolveModelPickerSelectedModel({
      driverKind: entry?.driverKind,
      model: selection.model,
      options: props.modelOptionsByInstance.get(selection.instanceId) ?? [],
    });
    return model ? `${getTriggerDisplayModelName(model)}${model.isUnavailable ? " (Unavailable)" : ""}` : selection.model;
  });
  const multipleLabel = selectedEntries
    ? selectedEntries.length === 0
      ? "Choose models"
      : `${selectedEntries.slice(0, 2).join(", ")}${selectedEntries.length > 2 ? `, ${selectedEntries.length - 2} more` : ""}`
    : undefined;
  const allModelNames = selectedEntries ? selectedEntries.join(", ") || "Choose models" : undefined;
  const tooltip = shortcutLabel
    ? `${allModelNames ?? triggerLabel} · ${shortcutLabel}`
    : (allModelNames ?? triggerLabel);

  const guard = useReopenGuard(props.onOpenChange);
  const { side, onTriggerLayout } = usePopoverSide(MODEL_PICKER_MAX_HEIGHT);

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    props.onInstanceModelChange(instanceId, model);
    props.onOpenChange(false);
  };

  const measure = props.measure;
  const control = (
    <div
      style={{ display: "flex", flexShrink: 1, minWidth: MODEL_PICKER_TRIGGER_MIN_WIDTH }}
      onLayout={(event) => {
        onTriggerLayout(event as { y?: number; height?: number });
        const width = layoutWidth(event);
        if (measure && width !== null) measure("control", width);
      }}
    >
      <ComposerControl
        size={size}
        disabled={props.disabled}
        testId="composer-model-picker"
        onClick={() => guard.toggle(open)}
        style={{ flexShrink: 1, minWidth: MODEL_PICKER_TRIGGER_MIN_WIDTH, justifyContent: "space-between" }}
      >
        {activeEntry ? (
          <ProviderInstanceIcon
            driverKind={activeEntry.driverKind}
            displayName={activeEntry.displayName}
            accentColor={activeEntry.accentColor}
            size={16}
            color={size === "xs" ? alpha(theme.mutedForeground, 0.7) : theme.mutedForeground}
            monochrome={size === "xs"}
            showBadge={shouldShowInstanceBadge(activeEntry, props.instanceEntries)}
            compactBadge
            indicatorBackground={theme.input}
          />
        ) : null}
        <ModelPickerTriggerLabel size={size} measure={measure} collapsed={props.collapseLabel ?? false}>
          {multipleLabel ?? triggerTitle}
        </ModelPickerTriggerLabel>
        {selectedModel?.isUnavailable ? <OutlineBadge>Unavailable</OutlineBadge> : null}
        <ComposerControlChevron size={size} />
      </ComposerControl>
    </div>
  );
  // The tooltip would open under the popover, so it only exists while the picker is closed.
  const trigger = open ? (
    control
  ) : (
    <Tooltip content={tooltip} side="top" rootStyle={{ flexShrink: 1, minWidth: MODEL_PICKER_TRIGGER_MIN_WIDTH }}>
      {control}
    </Tooltip>
  );

  return (
    <Popover
      open={open}
      onOpenChange={guard.onOpenChange}
      side={side}
      align="start"
      sideOffset={4}
      testId="composer-model-picker-popover"
      // -ms-2.5 aligns the expanded footer's first control with the editor text; the
      // xs resting strip has no such shift.
      rootStyle={{ marginLeft: size === "xs" ? 0 : -10, flexShrink: 1, minWidth: MODEL_PICKER_TRIGGER_MIN_WIDTH }}
      style={{ padding: 0, overflow: "hidden" }}
      trigger={trigger}
    >
      <ModelPickerContent
        environmentId={props.environmentId}
        activeInstanceId={props.activeInstanceId}
        model={props.model}
        lockedProvider={props.lockedProvider}
        lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
        instanceEntries={props.instanceEntries}
        keybindings={props.keybindings}
        modelOptionsByInstance={props.modelOptionsByInstance}
        onRequestClose={() => props.onOpenChange(false)}
        onOpenProviderSetup={props.onOpenProviderSetup}
        getModelDisabledReason={props.getModelDisabledReason}
        onInstanceModelChange={handleInstanceModelChange}
        {...(props.selectedModels !== undefined ? { selectedModels: props.selectedModels } : {})}
        {...(props.onToggleModel
          ? {
              onToggleModel: (instanceId: ProviderInstanceId, model: string) => {
                if (!props.disabled) props.onToggleModel?.(instanceId, model);
              },
            }
          : {})}
      />
      {props.selectedModels === undefined ? <ChatGptSharingControl provider={activeEntry?.snapshot ?? null} /> : null}
    </Popover>
  );
}


/**
 * web `data-chat-provider-model-picker-label`: `min-w-0 flex-1 truncate`. A hidden copy keeps
 * reporting the full width, which is what the footer compares against its space.
 */
function ModelPickerTriggerLabel({
  children,
  size,
  measure,
  collapsed,
}: {
  children: string;
  size: ComposerControlSize;
  measure: ProviderModelPickerProps["measure"];
  collapsed: boolean;
}) {
  const theme = useTheme();
  const style = composerControlLabelStyle(theme, size, undefined, undefined, useSmallViewport());
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        minWidth: 0,
        pointerEvents: "none",
        ...(collapsed
          ? { width: 0, flexGrow: 0, flexShrink: 0, overflow: "hidden" }
          : { flexGrow: 1, flexShrink: 1 }),
      }}
    >
      <text
        onLayout={
          measure
            ? (event) => {
                const width = layoutWidth(event);
                if (width !== null) measure("label", width);
              }
            : undefined
        }
        style={{ ...style, flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {children}
      </text>
      {measure ? (
        <text
          onLayout={(event) => {
            const width = layoutWidth(event);
            if (width !== null) measure("labelNatural", width);
          }}
          style={{ ...style, ...COMPOSER_CONTROL_HIDDEN_STYLE, top: 0, left: 0 }}
        >
          {children}
        </text>
      ) : null}
    </div>
  );
}
