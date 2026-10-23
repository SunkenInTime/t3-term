// OWNER: composer agent. First-pass visual; replace with the port of
// apps/web/src/components/chat/ChatComposer.tsx and friends.
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Text, VSeparator } from "../../ui/primitives.tsx";
import { FONTS, LAYOUT, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

export type ComposerTarget =
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  | { readonly kind: "draft"; readonly environmentId: EnvironmentId | null; readonly projectId: ProjectId | null };

export function Composer(_props: { target: ComposerTarget }) {
  const theme = useTheme();
  const [draft, setDraft] = useState("");
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "row", justifyContent: "center", paddingLeft: LAYOUT.chatLanePadding, paddingRight: LAYOUT.chatLanePadding, paddingBottom: 20 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          maxWidth: LAYOUT.chatMaxWidth,
          borderRadius: RADIUS["3xl"],
          borderWidth: 1,
          borderColor: alpha("#ffffff", 0.05),
          backgroundColor: alpha(theme.card, 0.94),
          pointerEvents: "auto",
        }}
      >
        <div style={{ paddingTop: 16, paddingLeft: 16, paddingRight: 16, paddingBottom: 8 }}>
          <textarea
            value={draft}
            placeholder="Ask anything, @tag files/folders, $use skills, or / for commands"
            minRows={2}
            maxRows={10}
            testId="composer"
            theme={{ caret: theme.foreground }}
            style={{ fontSize: 14, lineHeight: 23, color: theme.foreground, fontFamily: FONTS.sans }}
            onChange={(e) => setDraft(e.value ?? "")}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -10 }}>
            <ComposerControl icon="sparkles" label="GPT-6-Astra" />
            <VSeparator />
            <ComposerControl icon="brain" label="Medium" />
            <VSeparator />
            <ComposerControl icon="lock-open" label="Full access" />
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="paperclip" size={16} color={theme.mutedForeground} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 16, backgroundColor: theme.messageAction, opacity: draft.trim() ? 1 : 0.64 }}>
              <Icon name="arrow-up" size={14} strokeWidth={1.8} color="#ffffff" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposerControl({ icon, label }: { icon: Parameters<typeof Icon>[0]["name"]; label: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: RADIUS.md, cursor: "pointer", hover: { backgroundColor: theme.accent } }}>
      <Icon name={icon} size={16} color={theme.mutedForeground} />
      <Text weight={500} color={theme.mutedForeground}>
        {label}
      </Text>
      <Icon name="chevron-down" size={14} strokeWidth={2.25} color={theme.mutedForeground} />
    </div>
  );
}
