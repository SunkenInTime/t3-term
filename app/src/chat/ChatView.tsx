// Layout of the chat route, after apps/web/src/components/ChatView.tsx:
//   header
//   [ canvas (timeline + composer overlay + details card) / terminal drawer ] [ right panel ]
// Each region is owned by its own module.
import { useAtom, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { detailsPanelOpenAtom, rightPanelOpenAtom, terminalOpenAtom } from "../state/ui.ts";
import { RightPanel } from "../panels/RightPanel.tsx";
import { RightPanelSheet } from "../panels/RightPanelSheet.tsx";
import { rightPanelSheetAtom } from "../ui/viewport.tsx";
import { ThreadPreviewHost } from "../panels/browser/ThreadPreviewHost.tsx";
import { DeviceThreadHost } from "../panels/device/DeviceThreadHost.tsx";
import { DeviceMiniPlayerHost } from "../panels/device/DeviceMiniPlayer.tsx";
import { TerminalDrawer } from "../terminal/TerminalDrawer.tsx";
import { Composer } from "./composer/Composer.tsx";
import { reportTimelineWheel } from "./composer/composerResting.ts";
import { composerTargetKey } from "../state/composer.ts";
import { ThreadDetailsCard } from "./details/ThreadDetailsCard.tsx";
import { ChatHeader, ChatPanelLayoutControls } from "./header/ChatHeader.tsx";
import { Timeline } from "./timeline/Timeline.tsx";
import { ChatBannerLane } from "./ChatBannerLane.tsx";
import { PerfRegion } from "../dev/PerfRegion.tsx";

export function ChatView({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const detailsOpen = useAtomValue(detailsPanelOpenAtom);
  const terminalOpen = useAtomValue(terminalOpenAtom);
  const [rightOpen, setRightOpen] = useAtom(rightPanelOpenAtom);
  const rightSheet = useAtomValue(rightPanelSheetAtom);
  return (
    <div style={{ display: "flex", flexDirection: "row", width: "100%", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <PerfRegion id="header">
          <ChatHeader environmentId={environmentId} threadId={threadId} />
        </PerfRegion>
        <div
          style={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, position: "relative" }}
          onScroll={(event) => reportTimelineWheel(composerTargetKey({ kind: "thread", environmentId, threadId }), event.deltaY ?? 0)}
        >
          <ChatBannerLane composerTargetKey={composerTargetKey({ kind: "thread", environmentId, threadId })} />
          <PerfRegion id="timeline">
            <Timeline environmentId={environmentId} threadId={threadId} />
          </PerfRegion>
          <PerfRegion id="composer">
            <Composer target={{ kind: "thread", environmentId, threadId }} />
          </PerfRegion>
          <PerfRegion id="details">
            {detailsOpen ? <ThreadDetailsCard environmentId={environmentId} threadId={threadId} /> : null}
          </PerfRegion>
          <ThreadPreviewHost environmentId={environmentId} threadId={threadId} />
          <DeviceThreadHost environmentId={environmentId} threadId={threadId} />
          <DeviceMiniPlayerHost environmentId={environmentId} threadId={threadId} />
        </div>
        {terminalOpen ? <TerminalDrawer environmentId={environmentId} threadId={threadId} /> : null}
      </div>
      <PerfRegion id="right">
        {rightSheet ? (
          <RightPanelSheet open={rightOpen} onClose={() => setRightOpen(false)}>
            <RightPanel
              environmentId={environmentId}
              threadId={threadId}
              sheet
              layoutControls={<ChatPanelLayoutControls environmentId={environmentId} threadId={threadId} />}
            />
          </RightPanelSheet>
        ) : rightOpen ? (
          <RightPanel environmentId={environmentId} threadId={threadId} />
        ) : null}
      </PerfRegion>
    </div>
  );
}
