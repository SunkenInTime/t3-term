// Port of apps/web/src/components/preview/PreviewView.tsx for server tabs: the
// Browser surface in the right panel. The chrome row drives the tab through
// the stream (navigate/history/reload) and the preview RPCs (resize, adjust).
//
// Desktop-only parts of web's view are left out: Electron webview slots,
// recording/screenshot, element annotation, moving tabs between runtimes, the
// zoom indicator and DevTools. A PDF tab shows the page frames instead of
// web's <embed>.
import type { EventPayload } from "@gpuix/react";
import {
  AuthPreviewOperateScope,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_PREVIEW_ZOOM_FACTOR,
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_ZOOM_LEVELS,
  type EnvironmentId,
  type PreviewAdjustInput,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
  type ThreadId,
} from "@t3tools/contracts";
import { normalizePreviewUrl, resolveAddressBarInput, resolveSearchUrlTemplate } from "@t3tools/shared/preview";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRef, useState } from "react";

import { openExternalUrl } from "../pr/openExternal.ts";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  miniPlayerAtom,
  openPreviewSession,
  previewEnvironment,
  showPreviewPopup,
  threadRefOf,
  toggleMiniPlayer,
  usePreviewSession,
  usePreviewStreamAccess,
} from "../../state/preview.ts";
import { useEnvironmentScope } from "../../state/terminal.ts";
import { browserResponsiveViewportForToggle, useBrowserDefaults } from "../../web/browser/browserDefaults.ts";
import { getClientSettings } from "../../web/browser/clientSettings.ts";
import { BROWSER_DEVICE_TOOLBAR_HEIGHT } from "../../web/browser/browserViewportLayout.ts";
import { previewRuntimeTabId } from "../../web/browser/previewRuntimeTabId.ts";
import { shouldShowPreviewEmptyState } from "../../web/components/preview/previewEmptyStateLogic.ts";
import { rememberPreviewUrl, updatePreviewServerSnapshot, useThreadPreviewState } from "../../web/previewStateStore.ts";
import { previewStreamDownloadUrl, type PreviewStreamControl } from "@t3tools/client-runtime/preview/server-browser-stream";
import { Tooltip } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, useTheme } from "../../ui/theme.ts";
import { BrowserDeviceToolbar } from "./BrowserDeviceToolbar.tsx";
import { PreviewChromeRow } from "./PreviewChromeRow.tsx";
import { PreviewEmptyState } from "./PreviewEmptyState.tsx";
import { PreviewMoreMenu, type PreviewMoreMenuActions } from "./PreviewMoreMenu.tsx";
import { PreviewFileNotShown, PreviewUnreachable } from "./PreviewUnreachable.tsx";
import { saveDownload, ServerBrowserSurface, type ServerBrowserHandle } from "./ServerBrowserSurface.tsx";

function previewProfileName(profiles: ReadonlyArray<{ readonly id: string; readonly name: string }>, profileId: string): string {
  return profiles.find((profile) => profile.id === profileId)?.name ?? "Removed profile";
}

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

export function PreviewView({
  environmentId,
  threadId,
  tabId: requestedTabId,
  visible,
  configuredUrls,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  tabId?: string | null;
  visible: boolean;
  configuredUrls?: ReadonlyArray<string>;
}) {
  const theme = useTheme();
  const threadRef = threadRefOf(environmentId, threadId);
  const previewState = useThreadPreviewState(threadRef);
  const miniPlayer = useAtomValue(miniPlayerAtom(scopedThreadKey(threadRef)));
  const canOperate = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  usePreviewSession(threadRef);

  const tabId = requestedTabId ?? previewState.activeTabId;
  const runtimeTabId = tabId ? previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId) : null;
  const snapshot = tabId ? (previewState.sessions[tabId] ?? null) : null;
  const isServerTab = snapshot?.runtime === "server";
  const serverSurfaceRef = useRef<ServerBrowserHandle | null>(null);
  const [serverAspectRatioLocked, setServerAspectRatioLocked] = useState(false);
  const [bodySize, setBodySize] = useState<{ width: number; height: number } | null>(null);
  const [serverControlledTabId, setServerControlledTabId] = useState<string | null>(null);
  const serverInputDisabled = isServerTab && serverControlledTabId !== runtimeTabId;
  const [serverFrameTabId, setServerFrameTabId] = useState<string | null>(null);
  const navStatus = snapshot?.navStatus ?? { _tag: "Idle" as const };
  const url = navStatus._tag === "Idle" ? "" : navStatus.url;
  const loading = navStatus._tag === "Loading";
  const canGoBack = snapshot?.canGoBack ?? false;
  const canGoForward = snapshot?.canGoForward ?? false;
  const refreshDisabled = navStatus._tag === "Idle";
  const isUnreachable = navStatus._tag === "LoadFailed";
  const showEmptyState = shouldShowPreviewEmptyState(snapshot);
  const serverStreamPending = isServerTab && !showEmptyState && !isUnreachable && serverFrameTabId !== runtimeTabId;
  const viewport = snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT;
  const browserDefaults = useBrowserDefaults();
  const activeProfileId = snapshot?.profileId ?? DEFAULT_BROWSER_PROFILE_ID;
  const activeProfileName = previewProfileName(browserDefaults.profiles, activeProfileId);
  const access = usePreviewStreamAccess(environmentId);

  const navigateToResolvedUrl = async (resolvedUrl: string) => {
    if (isServerTab && serverSurfaceRef.current) {
      if (serverInputDisabled) return false;
      serverSurfaceRef.current.navigate(resolvedUrl);
      rememberPreviewUrl(threadRef, resolvedUrl);
      return true;
    }
    const result = await openPreviewSession({ threadRef, url: resolvedUrl });
    if (result._tag === "Failure") {
      toast({ type: "error", title: "Unable to open browser", description: errorDescription(squashAtomCommandFailure(result)) });
    }
    return result._tag === "Success";
  };

  const handleSubmitUrl = (next: string) => {
    try {
      void navigateToResolvedUrl(resolveAddressBarInput(next, resolveSearchUrlTemplate(getClientSettings())));
    } catch {}
  };

  const handleOpenServerUrl = (next: string) => {
    try {
      void navigateToResolvedUrl(normalizePreviewUrl(next));
    } catch {}
  };

  const handleRefresh = () => serverSurfaceRef.current?.reload();

  const adjustServerTab = async (change: Omit<PreviewAdjustInput, "threadId" | "tabId">) => {
    if (!tabId) return;
    const result = await runAtomCommand(appAtomRegistry, previewEnvironment.adjust, {
      environmentId,
      input: { threadId, tabId, ...change },
    } as never);
    if (result._tag === "Failure") {
      toast({ type: "error", title: "Unable to change the browser tab", description: errorDescription(squashAtomCommandFailure(result)) });
      return;
    }
    updatePreviewServerSnapshot(threadRef, result.value as PreviewSessionSnapshot);
  };

  const serverZoomFactor = snapshot?.zoomFactor ?? DEFAULT_PREVIEW_ZOOM_FACTOR;
  const stepServerZoom = (direction: -1 | 0 | 1) => {
    const index = PREVIEW_ZOOM_LEVELS.indexOf(serverZoomFactor);
    const next =
      direction === 0
        ? DEFAULT_PREVIEW_ZOOM_FACTOR
        : PREVIEW_ZOOM_LEVELS[Math.min(Math.max((index < 0 ? 7 : index) + direction, 0), PREVIEW_ZOOM_LEVELS.length - 1)]!;
    if (next !== serverZoomFactor) void adjustServerTab({ zoomFactor: next });
  };

  const handleViewportChange = async (nextViewport: PreviewViewportSetting) => {
    if (!tabId) return;
    const result = await runAtomCommand(appAtomRegistry, previewEnvironment.resize, {
      environmentId,
      input: { threadId, tabId, viewport: nextViewport },
    } as never);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toast({ type: "error", title: "Unable to resize browser viewport", description: errorDescription(error) });
      throw error;
    }
    updatePreviewServerSnapshot(threadRef, result.value as PreviewSessionSnapshot);
  };

  const handleToggleDeviceToolbar = () => {
    if (viewport._tag !== "fill") {
      void handleViewportChange(FILL_PREVIEW_VIEWPORT).catch(() => undefined);
      return;
    }
    void handleViewportChange(
      browserResponsiveViewportForToggle({ defaults: browserDefaults, panelRect: bodySize, zoomFactor: serverZoomFactor }),
    ).catch(() => undefined);
  };

  const moreMenuActions: PreviewMoreMenuActions = {
    hardReload: () => void adjustServerTab({ hardReload: true }),
    setColorScheme: (colorScheme) => void adjustServerTab({ colorScheme }),
    zoomIn: () => stepServerZoom(1),
    zoomOut: () => stepServerZoom(-1),
    resetZoom: () => stepServerZoom(0),
    clearCookies: () => void adjustServerTab({ clear: "cookies" }),
    clearCache: () => void adjustServerTab({ clear: "cache" }),
  };

  return (
    <div testId="preview-view" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, backgroundColor: theme.background }}>
      <PreviewChromeRow
        url={url}
        loading={loading || serverStreamPending}
        canGoBack={canGoBack && !serverInputDisabled}
        canGoForward={canGoForward && !serverInputDisabled}
        refreshDisabled={refreshDisabled || serverInputDisabled}
        inputDisabled={serverInputDisabled}
        onBack={() => serverSurfaceRef.current?.history(-1)}
        onForward={() => serverSurfaceRef.current?.history(1)}
        onRefresh={handleRefresh}
        onSubmit={handleSubmitUrl}
        onOpenInBrowser={tabId && url ? () => openExternalUrl(url) : undefined}
        onPictureInPicture={tabId && isServerTab ? () => toggleMiniPlayer(threadRef, tabId) : undefined}
        pictureInPicture={miniPlayer?.tabId === tabId}
        pictureInPictureDisabled={isUnreachable}
        leadingActions={
          activeProfileId !== browserDefaults.profileId ? (
            <Tooltip content={activeProfileName} side="top">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 18,
                  maxWidth: 112,
                  paddingLeft: 6,
                  paddingRight: 6,
                  borderRadius: RADIUS.sm,
                  borderWidth: 1,
                  borderColor: theme.input,
                  flexShrink: 0,
                }}
              >
                <Text size="xs" truncate>
                  {activeProfileName}
                </Text>
              </div>
            </Tooltip>
          ) : null
        }
        trailingActions={
          canOperate || isServerTab ? (
            <PreviewMoreMenu
              enabled={runtimeTabId !== null && isServerTab}
              actions={moreMenuActions}
              profileName={activeProfileName}
              zoomFactor={serverZoomFactor}
              colorScheme={snapshot?.colorScheme ?? "system"}
              deviceToolbarVisible={viewport._tag !== "fill"}
              onToggleDeviceToolbar={handleToggleDeviceToolbar}
            />
          ) : null
        }
      />

      <div
        onLayout={(event: EventPayload) => {
          const width = Math.round(event.width ?? 0);
          const height = Math.round(event.height ?? 0);
          if (width > 0 && height > 0) setBodySize({ width, height });
        }}
        style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden" }}
      >
        {showEmptyState ? (
          <PreviewEmptyState environmentId={environmentId} configuredUrls={configuredUrls} onOpenUrl={handleOpenServerUrl} />
        ) : null}
        {navStatus._tag === "LoadFailed" && navStatus.download ? (
          <PreviewFileNotShown
            url={navStatus.url}
            fileName={navStatus.download.fileName}
            onOpen={() => openExternalUrl(navStatus.url)}
            onDownload={
              access && snapshot
                ? () => {
                    const download = navStatus.download!;
                    void saveDownload({
                      fileName: download.fileName,
                      sizeBytes: 0,
                      url: previewStreamDownloadUrl({ access, threadId, tabId: snapshot.tabId }, download.id),
                    }).then(
                      (path) => toast({ type: "success", title: "Saved", description: path }),
                      (cause: unknown) => toast({ type: "error", title: "Could not save the download", description: errorDescription(cause) }),
                    );
                  }
                : null
            }
          />
        ) : navStatus._tag === "LoadFailed" ? (
          <PreviewUnreachable url={navStatus.url} code={navStatus.code} description={navStatus.description} onReload={handleRefresh} />
        ) : null}
        {runtimeTabId && snapshot && isServerTab ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              flexDirection: "column",
              pointerEvents: showEmptyState || isUnreachable ? "none" : "auto",
            }}
          >
            {viewport._tag !== "fill" && !showEmptyState && !isUnreachable ? (
              <BrowserDeviceToolbar
                setting={viewport}
                width={bodySize?.width ?? 0}
                aspectRatio={serverAspectRatioLocked ? viewport.width / viewport.height : null}
                onAspectRatioChange={(ratio) => setServerAspectRatioLocked(ratio !== null)}
                onChange={handleViewportChange}
              />
            ) : null}
            <ServerBrowserSurface
              key={runtimeTabId}
              handleRef={serverSurfaceRef}
              testId="preview-surface"
              environmentId={environmentId}
              threadId={threadId}
              tabId={snapshot.tabId}
              visible={visible}
              hidden={showEmptyState || isUnreachable}
              onFirstFrame={() => setServerFrameTabId(runtimeTabId)}
              onControl={(control: PreviewStreamControl | null) => setServerControlledTabId(control?.controller === "you" ? runtimeTabId : null)}
              onPopup={(popupTabId) => showPreviewPopup(threadRef, popupTabId, "panel")}
            />
          </div>
        ) : snapshot && !showEmptyState ? (
          <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
            <Text color={theme.mutedForeground} style={{ maxWidth: 384, textAlign: "center" }}>
              This tab is open in the T3 Code desktop app.
            </Text>
          </div>
        ) : null}
      </div>
    </div>
  );
}
