// Layout of the chat route, after apps/web/src/components/ChatView.tsx:
//   header
//   [ canvas (timeline + composer overlay + details card) / terminal drawer ] [ right panel ]
// Each region is owned by its own module.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { detailsPanelOpenAtom, rightPanelOpenAtom, terminalOpenAtom } from "../state/ui.ts";
import { RightPanel } from "../panels/RightPanel.tsx";
import { ThreadPreviewHost } from "../panels/browser/ThreadPreviewHost.tsx";
import { TerminalDrawer } from "../terminal/TerminalDrawer.tsx";
import { Composer } from "./composer/Composer.tsx";
import { reportTimelineWheel } from "./composer/composerResting.ts";
import { composerTargetKey } from "../state/composer.ts";
import { ThreadDetailsCard } from "./details/ThreadDetailsCard.tsx";
import { ChatHeader } from "./header/ChatHeader.tsx";
import { Timeline } from "./timeline/Timeline.tsx";

export function ChatView({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const detailsOpen = useAtomValue(detailsPanelOpenAtom);
  const terminalOpen = useAtomValue(terminalOpenAtom);
  const rightOpen = useAtomValue(rightPanelOpenAtom);
  return (
    <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <ChatHeader environmentId={environmentId} threadId={threadId} />
        <div
          style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, position: "relative" }}
          onScroll={(event) => reportTimelineWheel(composerTargetKey({ kind: "thread", environmentId, threadId }), event.deltaY ?? 0)}
        >
          <Timeline environmentId={environmentId} threadId={threadId} />
          <Composer target={{ kind: "thread", environmentId, threadId }} />
          {detailsOpen ? <ThreadDetailsCard environmentId={environmentId} threadId={threadId} /> : null}
          <ThreadPreviewHost environmentId={environmentId} threadId={threadId} />
        </div>
        {terminalOpen ? <TerminalDrawer environmentId={environmentId} threadId={threadId} /> : null}
      </div>
      {rightOpen ? <RightPanel environmentId={environmentId} threadId={threadId} /> : null}
    </div>
  );
}
