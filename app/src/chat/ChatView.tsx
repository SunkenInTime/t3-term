// First-pass chat view. The faithful timeline port (work groups, folds, plans,
// approvals) replaces the row renderer; the data path stays the same.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { memo, useState } from "react";

import { MainHeader, ThreadCrumbs } from "../app/MainView.tsx";
import { environmentThreads } from "../state/environment.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text, VSeparator } from "../ui/primitives.tsx";
import { FONTS, LAYOUT, RADIUS, alpha, useTheme } from "../ui/theme.ts";

export function ChatView({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const theme = useTheme();
  const result = useAtomValue(environmentThreads.stateAtom(environmentId, threadId));
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const items = projection?.visibleTurnItems ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <MainHeader crumbs={<ThreadCrumbs environmentId={environmentId} threadId={threadId} />} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, position: "relative" }}>
        {items.length === 0 ? (
          <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
            <Text color={alpha(theme.mutedForeground, 0.5)}>Send a message to start the conversation.</Text>
          </div>
        ) : (
          <Timeline items={items} />
        )}
        <Composer />
      </div>
    </div>
  );
}

const Timeline = memo(function Timeline({ items }: { items: ReadonlyArray<OrchestrationV2ProjectedTurnItem> }) {
  const theme = useTheme();
  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <virtual-list
        alignment="bottom"
        followTail
        estimatedItemHeight={60}
        style={{ flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar }}
      >
        {items.map((projected) => (
          <div
            key={projected.item.id}
            style={{ display: "flex", flexDirection: "row", justifyContent: "center", paddingLeft: LAYOUT.chatLanePadding, paddingRight: LAYOUT.chatLanePadding }}
          >
            <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: LAYOUT.chatMaxWidth }}>
              <TimelineRow projected={projected} />
            </div>
          </div>
        ))}
        <div style={{ height: 180 }} />
      </virtual-list>
    </div>
  );
});

function TimelineRow({ projected }: { projected: OrchestrationV2ProjectedTurnItem }) {
  const theme = useTheme();
  const item = projected.item;
  switch (item.type) {
    case "user_message":
      return (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", paddingTop: 8, paddingBottom: 16 }}>
          <div style={{ maxWidth: "80%", borderRadius: 18, padding: 12, backgroundColor: theme.messageSurface }}>
            <Text style={{ lineHeight: 23 }}>{item.text}</Text>
          </div>
        </div>
      );
    case "assistant_message":
      return (
        <div style={{ paddingTop: 2, paddingBottom: 8, paddingLeft: 4, paddingRight: 4 }}>
          <markdown
            source={item.text}
            theme={{
              appearance: theme.appearance,
              text: alpha(theme.foreground, 0.8),
              bg: theme.background,
              accent: theme.infoForeground,
              fontSans: FONTS.sans,
              fontMono: FONTS.mono,
              metrics: { mdTextSize: 14, mdLineHeight: 23, mdBlockGap: 10, mdHeadingSizes: [20, 18, 16, 14] },
            }}
          />
        </div>
      );
    default:
      return (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24, paddingTop: 2, paddingBottom: 2 }}>
          <div style={{ display: "flex", width: 24, justifyContent: "center" }}>
            <Icon name="wrench" size={16} color={theme.mutedForeground} />
          </div>
          <Text color={theme.mutedForeground} truncate>
            {item.type.replaceAll("_", " ")}
          </Text>
        </div>
      );
  }
}

function Composer() {
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
