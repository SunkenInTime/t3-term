// OWNER: composer agent (model picker sub-task). STUB: replace with the port of
// apps/web/src/components/chat/ProviderModelPicker.tsx + ModelPickerContent.tsx +
// ModelPickerSidebar.tsx. Keep this props contract; Composer.tsx renders it.
import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";

import type { AppModelOption } from "../../web/modelSelection.ts";
import type { ProviderInstanceEntry } from "../../web/providerInstances.ts";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlLabel,
  type ComposerControlSize,
} from "./ComposerControl.tsx";

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
}

export function ProviderModelPicker(props: ProviderModelPickerProps) {
  const options = props.modelOptionsByInstance.get(props.activeInstanceId) ?? [];
  const selected = options.find((option) => option.slug === props.model);
  return (
    <ComposerControl
      size={props.size}
      disabled={props.disabled}
      testId="composer-model-picker"
      onClick={() => props.onOpenChange(!props.open)}
      style={{ marginLeft: -10 }}
    >
      <ComposerControlLabel size={props.size}>{selected?.name ?? (props.model || "Choose model")}</ComposerControlLabel>
      <ComposerControlChevron size={props.size} />
    </ComposerControl>
  );
}
