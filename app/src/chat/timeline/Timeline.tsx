// OWNER: timeline agent. First-pass renderer; replace with the port of
// apps/web/src/components/chat/MessagesTimeline.tsx and its row components.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { memo } from "react";

import { environmentThreads } from "../../state/environment.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, LAYOUT, alpha, useTheme } from "../../ui/theme.ts";

export function Timeline({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const theme = useTheme();
  const result = useAtomValue(environmentThreads.stateAtom(environmentId, threadId));
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const items = projection?.visibleTurnItems ?? [];
  if (items.length === 0) {
    return (
      <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <Text color={alpha(theme.mutedForeground, 0.5)}>Send a message to start the conversation.</Text>
      </div>
    );
  }
  return <TimelineList items={items} />;
}

const TimelineList = memo(function TimelineList({ items }: { items: ReadonlyArray<OrchestrationV2ProjectedTurnItem> }) {
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

