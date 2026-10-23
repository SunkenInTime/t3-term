// apps/web/src/components/chat/TraitsPicker.tsx (view; logic is in
// app/src/web/components/chat/TraitsPicker.logic.ts). The trigger is Brain + the
// trait summary + chevron; the menu lists every select descriptor (Effort/Reasoning,
// Context window, Agent, Service tier…) as a radio group and every boolean descriptor
// (Fast mode, Thinking…) as an On/Off group. Ultrathink is prompt-controlled for Claude.
import type { KeyEvent } from "@gpuix/react";
import {
  buildTraitsTriggerDisplay,
  getDescriptorStringValue,
  getTraitSelectChange,
  replaceDescriptorCurrentValue,
  selectableProviderOptionChoices,
} from "@t3tools/client-runtime/model-traits";
import type {
  ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentLabel,
} from "@t3tools/shared/model";
import { memo, useState, type ReactNode } from "react";

import { Popover, Tooltip } from "../../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  getTraitsSectionVisibility,
  type PromptUltrathink,
} from "../../web/components/chat/TraitsPicker.logic.ts";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
  ComposerControlLabel,
  type ComposerControlSize,
} from "./ComposerControl.tsx";
import { OutlineBadge } from "./ModelPickerListRow.tsx";
import { usePopoverSide, useReopenGuard } from "./ModelPickerPopover.ts";

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;
type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

export interface TraitsPickerProps {
  readonly provider: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly model: string;
  /** Already resolved through `withImplicitFastModeDefault`. */
  readonly modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  readonly reportedModelSelection?: ModelSelection | null;
  readonly promptUltrathink: PromptUltrathink;
  /** Receives an edit of the live prompt (Ultrathink prefix toggling). */
  readonly onPromptEdit: (edit: (prompt: string) => string) => void;
  /** Persists the next option selections for this instance + model. */
  readonly onModelOptionsChange: (next: ReadonlyArray<ProviderOptionSelection> | undefined) => void;
  readonly planModeEnabled: boolean;
  readonly size?: ComposerControlSize;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export interface TraitsMenuContentProps {
  readonly provider: ProviderDriverKind;
  readonly instanceId?: ProviderInstanceId;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly model: string | null | undefined;
  readonly promptUltrathink?: PromptUltrathink | undefined;
  readonly onPromptEdit?: (edit: (prompt: string) => string) => void;
  readonly modelOptions?: ProviderOptions | null | undefined;
  readonly reportedModelSelection?: ModelSelection | null | undefined;
  readonly allowPromptInjectedEffort?: boolean;
  readonly planModeEnabled: boolean;
  readonly onModelOptionsChange: (next: ProviderOptions | undefined) => void;
  /** Called after a pick; web's radio items use `closeOnClick`. */
  readonly onClose?: () => void;
}

/** Estimated menu height for choosing which side of the trigger it opens on. */
const TRAITS_MENU_ESTIMATED_HEIGHT = 320;

interface MenuEntry {
  readonly key: string;
  readonly disabled: boolean;
  readonly select: () => void;
}

export const TraitsMenuContent = memo(function TraitsMenuContent({
  provider,
  instanceId,
  models,
  model,
  promptUltrathink,
  onPromptEdit,
  modelOptions,
  reportedModelSelection,
  allowPromptInjectedEffort = true,
  planModeEnabled,
  onModelOptionsChange,
  onClose,
}: TraitsMenuContentProps) {
  const theme = useTheme();
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const modelSelection = instanceId && model ? { instanceId, model, options: modelOptions ?? [] } : null;
  const selected = getTraitsSectionVisibility({
    provider,
    models,
    model,
    promptUltrathink,
    modelOptions,
    allowPromptInjectedEffort,
    planModeEnabled,
  });
  const {
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    hasAnyControls,
    modelIsUnavailable,
  } = selected;

  const handleSelectChange = (descriptor: SelectDescriptor, value: string) => {
    // Whether a pick applies, and the options it writes, do not depend on the prompt text.
    const change = getTraitSelectChange(selected, descriptor, "", value);
    if (!change) return;
    onPromptEdit?.((prompt) => getTraitSelectChange(selected, descriptor, prompt, value)?.prompt ?? prompt);
    if ("modelOptions" in change) onModelOptionsChange(change.modelOptions);
  };

  if (!hasAnyControls) return null;

  if (modelIsUnavailable) {
    return (
      <>
        {descriptors.map((descriptor, index) => {
          const value = getProviderOptionCurrentLabel(descriptor, modelSelection, reportedModelSelection);
          if (!value) return null;
          return (
            <div key={descriptor.id} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
              {index > 0 ? <TraitsMenuSeparator /> : null}
              <TraitsGroupLabel>{descriptor.label}</TraitsGroupLabel>
              <TraitsNote>{value}</TraitsNote>
            </div>
          );
        })}
      </>
    );
  }

  // Flat, in visual order, for arrow-key navigation.
  const entries: MenuEntry[] = [];
  const groups: ReactNode[] = [];

  selectDescriptors.forEach((descriptor, index) => {
    const isPrimary = descriptor.id === primarySelectDescriptor?.id;
    const selectedValue =
      ultrathinkPromptControlled && isPrimary
        ? "ultrathink"
        : (getDescriptorStringValue(descriptor, modelSelection, reportedModelSelection) ?? "");
    const lockedByPrompt = ultrathinkInBodyText && isPrimary;
    groups.push(
      <div key={descriptor.id} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {index > 0 ? <TraitsMenuSeparator /> : null}
        <TraitsGroupLabel>{descriptor.label}</TraitsGroupLabel>
        {lockedByPrompt ? (
          <TraitsNote>Your prompt contains "ultrathink" in the text. Remove it to change this option.</TraitsNote>
        ) : null}
        {selectableProviderOptionChoices(descriptor).map((option) => {
          const key = `${descriptor.id}:${option.id}`;
          const select = () => {
            handleSelectChange(descriptor, option.id);
            onClose?.();
          };
          entries.push({ key, disabled: lockedByPrompt, select });
          return (
            <TraitsRadioItem
              key={key}
              testId={`traits-option-${descriptor.id}-${option.id}`}
              checked={selectedValue === option.id}
              highlighted={highlightedKey === key}
              disabled={lockedByPrompt}
              label={option.label}
              isDefault={option.isDefault === true}
              description={option.description}
              onHover={() => setHighlightedKey(key)}
              onSelect={select}
            />
          );
        })}
      </div>,
    );
  });

  booleanDescriptors.forEach((descriptor, index) => {
    const selectedValue = descriptor.currentValue === true ? "on" : "off";
    groups.push(
      <div key={descriptor.id} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {index > 0 || selectDescriptors.length > 0 ? <TraitsMenuSeparator /> : null}
        <TraitsGroupLabel bottom={6}>{descriptor.label}</TraitsGroupLabel>
        {(["on", "off"] as const).map((value) => {
          const key = `${descriptor.id}:${value}`;
          const select = () => {
            onModelOptionsChange(
              buildProviderOptionSelectionsFromDescriptors(
                replaceDescriptorCurrentValue(descriptors, descriptor.id, value === "on"),
              ),
            );
            onClose?.();
          };
          entries.push({ key, disabled: false, select });
          return (
            <TraitsRadioItem
              key={key}
              testId={`traits-option-${descriptor.id}-${value}`}
              checked={selectedValue === value}
              highlighted={highlightedKey === key}
              disabled={false}
              label={value === "on" ? "On" : "Off"}
              isDefault={false}
              onHover={() => setHighlightedKey(key)}
              onSelect={select}
            />
          );
        })}
      </div>,
    );
  });

  const onKeyDown = (event: KeyEvent) => {
    const enabled = entries.filter((entry) => !entry.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex((entry) => entry.key === highlightedKey);
    if (event.key === "down" || event.key === "up") {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === "down" ? 1 : -1;
      const next = index < 0 ? (step === 1 ? 0 : enabled.length - 1) : (index + step + enabled.length) % enabled.length;
      setHighlightedKey(enabled[next]!.key);
      return;
    }
    if ((event.key === "enter" || event.key === "space") && index >= 0) {
      event.preventDefault();
      event.stopPropagation();
      enabled[index]!.select();
    }
  };

  return (
    <div
      testId="traits-menu"
      tabIndex={-1}
      autoFocus
      onKeyDown={onKeyDown}
      style={{ display: "flex", flexDirection: "column", minWidth: 0, color: theme.foreground }}
    >
      {groups}
    </div>
  );
});

export function TraitsPicker(props: TraitsPickerProps) {
  const size = props.size ?? "sm";
  const selected = getTraitsSectionVisibility({
    provider: props.provider,
    models: props.models,
    model: props.model,
    promptUltrathink: props.promptUltrathink,
    modelOptions: props.modelOptions,
    planModeEnabled: props.planModeEnabled,
  });
  const guard = useReopenGuard(props.onOpenChange);
  const { side, onTriggerLayout } = usePopoverSide(TRAITS_MENU_ESTIMATED_HEIGHT);
  if (!selected.hasAnyControls) return null;

  const { label: triggerLabel } = buildTraitsTriggerDisplay({
    provider: props.provider,
    descriptors: selected.descriptors,
    primarySelectDescriptorId: selected.primarySelectDescriptor?.id ?? null,
    ultrathinkPromptControlled: selected.ultrathinkPromptControlled,
    modelSelection: { instanceId: props.instanceId, model: props.model, options: props.modelOptions ?? [] },
    reportedModelSelection: props.reportedModelSelection,
  });
  // Codex labels can be long ("Extra High Fast · …"); web caps them at max-w-48 and truncates.
  const isCodexStyle = props.provider === "codex";

  const control = (
    <div style={{ display: "flex", flexShrink: isCodexStyle ? 1 : 0, minWidth: 0 }} onLayout={onTriggerLayout}>
      <ComposerControl
        size={size}
        testId="composer-traits"
        onClick={() => guard.toggle(props.open)}
        style={isCodexStyle ? { maxWidth: 192, flexShrink: 1, minWidth: 0, justifyContent: "flex-start" } : undefined}
      >
        <ComposerControlIcon name="brain" size={size} />
        <ComposerControlLabel size={size} truncate={isCodexStyle}>
          {triggerLabel}
        </ComposerControlLabel>
        <ComposerControlChevron size={size} />
      </ComposerControl>
    </div>
  );

  return (
    <Popover
      open={props.open}
      onOpenChange={guard.onOpenChange}
      side={side}
      align="start"
      sideOffset={4}
      testId="composer-traits-menu"
      style={{ padding: 4, minWidth: 160 }}
      // The tooltip would open under the menu, so it only exists while the menu is closed.
      trigger={
        props.open ? (
          control
        ) : (
          <Tooltip content={triggerLabel} side="top">
            {control}
          </Tooltip>
        )
      }
    >
      <TraitsMenuContent
        provider={props.provider}
        instanceId={props.instanceId}
        models={props.models}
        model={props.model}
        promptUltrathink={props.promptUltrathink}
        onPromptEdit={props.onPromptEdit}
        modelOptions={props.modelOptions}
        reportedModelSelection={props.reportedModelSelection}
        planModeEnabled={props.planModeEnabled}
        onModelOptionsChange={props.onModelOptionsChange}
        onClose={() => props.onOpenChange(false)}
      />
    </Popover>
  );
}

/** MenuRadioItem: min-h 28, px 8 py 4, radius 6, 14px; checked fg/8%, highlighted accent. */
export function TraitsRadioItem(props: {
  testId: string;
  checked: boolean;
  highlighted: boolean;
  disabled: boolean;
  label: string;
  isDefault: boolean;
  description?: string | undefined;
  onHover: () => void;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const background = props.highlighted && !props.disabled
    ? theme.accent
    : props.checked
      ? alpha(theme.foreground, 0.08)
      : "#00000000";
  return (
    <div
      testId={props.testId}
      onClick={props.disabled ? undefined : props.onSelect}
      onMouseEnter={props.onHover}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minHeight: 28,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
        backgroundColor: background,
        opacity: props.disabled ? 0.64 : 1,
        cursor: props.disabled ? "default" : "pointer",
        ...(props.disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
        <text
          style={{
            color: theme.foreground,
            fontSize: 14,
            lineHeight: 20,
            fontFamily: FONTS.sans,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {props.label}
        </text>
        {props.isDefault ? <OutlineBadge>Default</OutlineBadge> : null}
      </div>
      {props.description ? (
        // max-w-56 sits on the span; a gpuix <text> wraps to its parent's width.
        <div style={{ maxWidth: 224 }}>
          <text style={{ color: alpha(theme.mutedForeground, 0.8), fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>
            {withoutOrphan(props.description)}
          </text>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Web sets `text-pretty`, which keeps a lone word off the last line. gpuix has no
 * text-wrap, so the last two words are joined with a no-break space instead.
 */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

function withoutOrphan(text: string): string {
  return text.replace(/ (\S+)$/, `${NO_BREAK_SPACE}$1`);
}

/** Group label: px 8, pt 6 pb 4 (py 6 for On/Off groups), 12px medium muted. */
export function TraitsGroupLabel({ children, bottom = 4 }: { children: string; bottom?: number }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: bottom, flexShrink: 0 }}>
      <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>
        {children}
      </text>
    </div>
  );
}

function TraitsNote({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 6, flexShrink: 0, maxWidth: 240 }}>
      <text style={{ color: alpha(theme.mutedForeground, 0.8), fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>
        {children}
      </text>
    </div>
  );
}

/** MenuSeparator: mx 8, my 4, 1px border. */
export function TraitsMenuSeparator() {
  const theme = useTheme();
  return (
    <div
      style={{
        height: 1,
        flexShrink: 0,
        marginTop: 4,
        marginBottom: 4,
        marginLeft: 8,
        marginRight: 8,
        backgroundColor: theme.border,
      }}
    />
  );
}
