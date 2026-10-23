// Port of apps/web/src/components/chat/ChatGptSharingControl.tsx (with
// settings/ChatGptUsageButton.tsx): the model picker's footer when Codex runs on the
// user's ChatGPT plan, with a link to manage that plan's usage.
import type { ServerProvider } from "@t3tools/contracts";
import { CHATGPT_USAGE_URL, usesChatGptSharing } from "@t3tools/shared/usageLimits";

import { OPENAI_SVG } from "../../sidebar/providerMarks.gen.ts";
import { Button, Text } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { openExternalUrl } from "../../usage/openExternal.ts";

export function ChatGptSharingControl({ provider }: { provider: ServerProvider | null }) {
  const theme = useTheme();
  if (!usesChatGptSharing(provider)) return null;
  return (
    <div
      testId="chatgpt-sharing-control"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        borderTopWidth: 1,
        borderColor: theme.border,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <svg source={OPENAI_SVG} style={{ width: 14, height: 14, color: theme.mutedForeground }} />
        <Text size="xs" color={theme.mutedForeground}>
          Using ChatGPT plan
        </Text>
      </div>
      <Button size="xs" variant="ghost-muted" trailingIcon="external-link" onClick={() => openExternalUrl(CHATGPT_USAGE_URL)}>
        Manage usage
      </Button>
    </div>
  );
}
