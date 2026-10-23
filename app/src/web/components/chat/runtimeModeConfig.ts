// apps/web/src/components/chat/runtimeModeConfig.ts, with lucide component icons
// swapped for t3-term icon names.
import type { RuntimeMode } from "@t3tools/contracts";

import type { IconName } from "../../../ui/Icon.tsx";

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: IconName }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: "lock",
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: "pen-line",
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: "sparkles",
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: "lock-open",
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];
