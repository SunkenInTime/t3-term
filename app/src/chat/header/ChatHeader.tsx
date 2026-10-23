// OWNER: header/git agent. Stub; replace with the port of apps/web/src/components/chat/ChatHeader.tsx
// and PanelLayoutControls.tsx.
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { MainHeader, ThreadCrumbs } from "../../app/MainView.tsx";

export function ChatHeader({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  return <MainHeader crumbs={<ThreadCrumbs environmentId={environmentId} threadId={threadId} />} />;
}
