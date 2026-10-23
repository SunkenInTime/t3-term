// OWNER: composer agent (traits sub-task). STUB: replace with the view port of
// apps/web/src/components/chat/TraitsPicker.tsx (logic is in
// app/src/web/components/chat/TraitsPicker.logic.ts). Keep this props contract.
import type {
  ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@t3tools/contracts";

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

export function TraitsPicker(props: TraitsPickerProps) {
  const selected = getTraitsSectionVisibility({
    provider: props.provider,
    models: props.models,
    model: props.model,
    promptUltrathink: props.promptUltrathink,
    modelOptions: props.modelOptions,
    planModeEnabled: props.planModeEnabled,
  });
  const label = selected.primarySelectDescriptor?.options.find((option) => option.id === selected.effort)?.label ?? selected.effort ?? "Traits";
  return (
    <ComposerControl size={props.size} testId="composer-traits" onClick={() => props.onOpenChange(!props.open)}>
      <ComposerControlIcon name="brain" size={props.size} />
      <ComposerControlLabel size={props.size}>{label}</ComposerControlLabel>
      <ComposerControlChevron size={props.size} />
    </ComposerControl>
  );
}
