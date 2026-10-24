// Port of apps/web/src/components/settings/ChatGptWelcomeCoordinator.tsx: once per
// connected ChatGPT plan (a Codex instance that uses ChatGPT sharing), explain that
// eligible usage draws on the plan. Mounted app-wide like web's __root.tsx does.
// Acknowledged profiles persist in $T3TERM_HOME/ui instead of localStorage.
import { useAtom, useAtomValue } from "@effect/atom-react";
import { usesChatGptSharing } from "@t3tools/shared/usageLimits";

import { environmentPresentations } from "../../state/settings.ts";
import { persistedAtom } from "../../state/persistedAtom.ts";
import { Dialog } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { BrandIcon } from "../brandIcons.tsx";
import { ChatGptUsageButton } from "./CodexSetupSection.tsx";

/** web: localStorage `t3:chatgpt-sharing-welcome:v1` */
const acknowledgedProfilesAtom = persistedAtom<ReadonlyArray<string>>("chatgpt-sharing-welcome-v1", [], (raw) =>
  Array.isArray(raw) ? raw.filter((key): key is string => typeof key === "string") : [],
);

export function ChatGptWelcomeCoordinator() {
  const theme = useTheme();
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const providersByEnvironment = useAtomValue(environmentPresentations.providersByEnvironmentAtom);
  const [acknowledged, setAcknowledged] = useAtom(acknowledgedProfilesAtom);
  const profiles = [...presentations].flatMap(([environmentId, presentation]) =>
    presentation.connection.phase !== "connected"
      ? []
      : (providersByEnvironment.get(environmentId) ?? []).filter(usesChatGptSharing).map((provider) => ({
          key: JSON.stringify([environmentId, provider.instanceId, provider.auth.profileId ?? provider.auth.email ?? "default"]),
          environmentLabel: presentation.entry.target.label,
          providerName: provider.displayName ?? "Codex",
        })),
  );
  const next = profiles.find((profile) => !acknowledged.includes(profile.key));
  const dismiss = () => {
    if (next) setAcknowledged([...acknowledged, next.key]);
  };
  return (
    <Dialog
      open={next !== undefined}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
      testId="chatgpt-welcome"
      footer={
        <>
          <ChatGptUsageButton />
          <Button onClick={dismiss} testId="chatgpt-welcome-continue">
            Continue
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", marginBottom: 8 }}>
          <BrandIcon name="openai" size={32} color={theme.foreground} />
        </div>
        <Text size="xl" weight={600}>
          Your ChatGPT plan is connected
        </Text>
        <Text color={theme.mutedForeground}>
          Eligible usage in T3 Code uses your ChatGPT plan. Manage your shared usage and any credit settings in ChatGPT.
        </Text>
        <Text size="xs" color={theme.mutedForeground}>
          {`${next?.providerName ?? ""} on ${next?.environmentLabel ?? ""}`}
        </Text>
      </div>
    </Dialog>
  );
}
