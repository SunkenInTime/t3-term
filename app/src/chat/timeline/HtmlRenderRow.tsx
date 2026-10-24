// apps/web/src/components/chat/HtmlRenderFrame.tsx shows an agent's html_render
// page live in an iframe sized to the page. gpuix has no web view, but the
// server's browser (serverBrowser capability) can load the page and stream it
// into the Browser surface, the way the right panel's browser tabs work. So the
// row is the page's card, and "Open" loads the signed page URL in a server
// browser tab beside the chat (web's HtmlRenderDialog full-screen view). Without
// a server browser the page opens in the system browser.
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { HTML_RENDER_COLUMN_WIDTH, htmlRenderFileName, htmlRenderFrameHeight, type HtmlRenderReference } from "@t3tools/shared/htmlRender";
import * as Option from "effect/Option";
import { useState } from "react";

import { environmentSession } from "../../state/environment.ts";
import { openPreviewSession, useEnvironmentSupportsServerBrowser } from "../../state/preview.ts";
import { rightPanelActions } from "../../state/rightPanel.ts";
import { timelineAssets } from "../../state/timeline.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import { openExternalUrl } from "./system.ts";

function useHtmlRenderUrl(environmentId: EnvironmentId, reference: HtmlRenderReference): { url: string | null; failed: boolean } {
  const prepared = useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId));
  const resource = {
    _tag: "attachment" as const,
    attachmentId: reference.attachmentId,
    fileName: htmlRenderFileName(reference.title),
    mimeType: "text/html",
    disposition: "inline" as const,
  };
  const result = useAtomValue(timelineAssets.createUrl({ environmentId, input: { resource } } as never)) as {
    _tag: string;
    value?: { relativeUrl: string };
  };
  const base = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  if (result._tag === "Success" && result.value && base) return { url: resolveAssetUrl(base, result.value.relativeUrl), failed: false };
  return { url: null, failed: result._tag === "Failure" };
}

export function HtmlRenderCard({ threadRef, reference }: { threadRef: ScopedThreadRef; reference: HtmlRenderReference }) {
  const theme = useTheme();
  const { url, failed } = useHtmlRenderUrl(threadRef.environmentId, reference);
  const serverBrowser = useEnvironmentSupportsServerBrowser(threadRef.environmentId);
  const [opening, setOpening] = useState(false);
  const title = reference.title || "HTML preview";
  if (failed) {
    // HtmlRenderFrame keeps the page's height and says it could not load.
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: htmlRenderFrameHeight(reference, HTML_RENDER_COLUMN_WIDTH) }}>
        <Text size="xs" color={theme.mutedForeground}>{`Unable to load ${title}`}</Text>
      </div>
    );
  }
  const openInBrowserSurface = async () => {
    if (!url) return;
    setOpening(true);
    const result = await openPreviewSession({ threadRef, url });
    setOpening(false);
    if (result._tag === "Success") {
      rightPanelActions.openBrowser(scopedThreadKey(threadRef), (result.value as { tabId: string }).tabId);
    } else {
      toast({ type: "error", title: "Unable to open the page", description: "The server browser did not start. Opening it in your browser instead." });
      openExternalUrl(url);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 4, paddingRight: 4 }}>
      <div
        testId="html-render-card"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 12,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.8),
          backgroundColor: alpha(theme.card, 0.7),
        }}
      >
        <Icon name="app-window" size={16} color={theme.mutedForeground} />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1, flexBasis: 0 }}>
          <Text size="sm" weight={500} truncate>
            {title}
          </Text>
          <Text size="xs" color={theme.mutedForeground} truncate>
            {serverBrowser ? "Interactive page · opens in the browser panel" : "Interactive page · opens in your browser"}
          </Text>
        </div>
        {url ? (
          <div style={{ display: "flex", flexDirection: "row", gap: 6, flexShrink: 0 }}>
            {serverBrowser ? (
              <Button size="xs" variant="outline" icon="maximize-2" disabled={opening} onClick={() => void openInBrowserSurface()} testId="html-render-open">
                Open
              </Button>
            ) : null}
            <Button size="xs" variant="ghost-muted" icon="external-link" onClick={() => openExternalUrl(url)} testId="html-render-open-external">
              {serverBrowser ? undefined : "Open"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
