// apps/web/src/components/pullRequest/pullRequestLinkContextMenu.ts: a right click on a pull
// request's number offers Copy link and Open on <host>, at the pointer.
import { sourceControlClients, UNKNOWN_SOURCE_CONTROL_CLIENT } from "@t3tools/client-runtime/source-control-clients";

import { copyTextToClipboard } from "../chat/header/osActions.ts";
import { ContextMenu } from "../sidebar/ContextMenu.tsx";
import { toast } from "../ui/toast.tsx";
import { openExternalUrl } from "../usage/openExternal.ts";

export function openOnHostLabel(provider: string | undefined): string {
  const host = sourceControlClients.get(provider);
  return host === UNKNOWN_SOURCE_CONTROL_CLIENT ? "Open on host" : `Open on ${host.label}`;
}

export function PullRequestLinkContextMenu({
  url,
  provider,
  position,
  onClose,
  testId,
}: {
  url: string;
  provider: string | undefined;
  position: { readonly x: number; readonly y: number };
  onClose: () => void;
  testId?: string;
}) {
  return (
    <ContextMenu
      testId={testId ?? "pr-link-menu"}
      items={[
        { id: "copy-link", label: "Copy link", icon: "copy" },
        { id: "open-external", label: openOnHostLabel(provider) },
      ]}
      x={position.x}
      y={position.y}
      onSelect={(action) => {
        if (action === "open-external") {
          openExternalUrl(url);
          return;
        }
        // web writeTextToClipboard(url, "link"): a toast says it was copied.
        void copyTextToClipboard(url).then(
          () => toast({ type: "success", title: "Link copied", description: url }),
          () => toast({ type: "error", title: "Could not copy the link" }),
        );
      }}
      onClose={onClose}
    />
  );
}
